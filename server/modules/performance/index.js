// Performance & Growth — module router. The appraisal spine (spec §3):
// cycles/phases → KRA sheets → self-appraisal → manager eval → HOD eval →
// calibration (+ adjustments, top talent) → publish (history + rating
// mirror) → my rating/history. Connects and PIPs included; letters generate
// a record now and the branded PDF at Phase 4 (template engine decision).
//
// Guards: phase gates via the pure machine; role gates via hasPermission
// (pms_admin / pms_team_eval / pms_hod / pms_self per the seed bundles);
// row scope (my sheet, my team) in handlers per the security skill.

const express = require('express');
const db = require('../../core/db');
const logger = require('../../core/logger');
const { authenticate } = require('../../core/auth');
const { apiPermissionParity, hasPermission } = require('../../core/permissions');
const { notify } = require('../../core/notifications');
const { requireConsent } = require('../../core/consent');
const { isSuper50Eligible } = require('./rating-rules');
const pm = require('./phase-machine');

const router = express.Router();
router.use(authenticate, apiPermissionParity);

const T = (req) => req.user.tenant_id;
const audit = (req, action, cycleId, employeeId, details) =>
  db.query(`INSERT INTO pms.audit_log (tenant_id, actor_email, action, cycle_id, employee_id, details)
            VALUES ($1,$2,$3,$4,$5,$6)`,
    [T(req), req.user.email, action, cycleId || null, employeeId || null, details ? JSON.stringify(details) : null])
    .catch(e => logger.warn('pms audit failed', { error: e.message }));

async function activeCycle(tenantId, type = null) {
  const r = await db.query(
    `SELECT * FROM pms.cycles WHERE tenant_id=$1 AND phase NOT IN ('closed','cancelled')
      ${type ? "AND cycle_type=$2" : ''} ORDER BY created_at DESC LIMIT 1`,
    type ? [tenantId, type] : [tenantId]);
  return r.rows[0] || null;
}

// BR-6.6: "For employees flagged under BR-6.5 [Super 50], proactively
// alert HR/Management to consider retention actions." Fans out an in-app
// notification to every employee holding the hr or admin role in this
// tenant (core.user_roles) — not a single fixed recipient, since who holds
// those roles varies per client/tenant. Best-effort: a failed notify() for
// one HR user must not roll back the publish that triggered it.
async function alertHrOfRetentionRisk(tenantId, employee) {
  const hrAndAdmin = (await db.query(
    `SELECT e.id FROM core.employees e JOIN core.user_roles ur ON ur.tenant_id=e.tenant_id AND LOWER(ur.email)=LOWER(e.email)
      WHERE e.tenant_id=$1 AND e.status='active' AND ur.role IN ('hr','admin')`, [tenantId])).rows;
  const title = `Retention alert: ${employee.name} is a consistent top performer`;
  const body = 'Flagged on the Super 50 watchlist (3 consecutive top-tier ratings, most recently the highest grade). Consider retention actions — a bonus, fast-track promotion, or a leadership succession conversation.';
  await Promise.all(hrAndAdmin.map((h) =>
    notify(tenantId, h.id, 'retention_alert', title, body, '/pms/watchlist').catch((e) => logger.warn('retention alert notify failed', { error: e.message }))));
  return hrAndAdmin.length;
}

// ---------------- Cycles -----------------------------------------------------
router.get('/cycles', async (req, res) => {
  const r = await db.query(`SELECT * FROM pms.cycles WHERE tenant_id=$1 ORDER BY created_at DESC`, [T(req)]);
  res.json({ cycles: r.rows });
});

router.post('/cycles', async (req, res) => {
  try {
    if (!(await hasPermission(req.user, 'pms_admin'))) return res.status(403).json({ error: "Requires 'pms_admin'" });
    const { name, fiscal_year, cycle_type, rating_scale, bell_curve, opens_at, closes_at, pip_threshold } = req.body || {};
    if (!name || !fiscal_year) return res.status(400).json({ error: 'name and fiscal_year required' });
    const r = await db.query(
      `INSERT INTO pms.cycles (tenant_id, name, fiscal_year, cycle_type, rating_scale, bell_curve, opens_at, closes_at, pip_threshold, created_by)
       VALUES ($1,$2,$3,COALESCE($4,'annual'),COALESCE($5,DEFAULT),COALESCE($6,DEFAULT),$7,$8,COALESCE($9,DEFAULT),$10) RETURNING *`
        .replace('COALESCE($5,DEFAULT)', `COALESCE($5, '[{"value":1,"label":"Needs Improvement"},{"value":2,"label":"Developing"},{"value":3,"label":"Meets Expectations"},{"value":4,"label":"Exceeds"},{"value":5,"label":"Outstanding"}]'::jsonb)`)
        .replace('COALESCE($6,DEFAULT)', `COALESCE($6, '{"1":5,"2":15,"3":55,"4":20,"5":5}'::jsonb)`)
        .replace('COALESCE($9,DEFAULT)', `COALESCE($9, 3.0)`),
      [T(req), name, fiscal_year, cycle_type || null, rating_scale ? JSON.stringify(rating_scale) : null,
       bell_curve ? JSON.stringify(bell_curve) : null, opens_at || null, closes_at || null, pip_threshold ?? null, req.user.email]);
    audit(req, 'CYCLE_CREATED', r.rows[0].id, null, { name, fiscal_year });
    res.json({ ok: true, cycle: r.rows[0] });
  } catch (e) { logger.error('cycle create', { error: e.message }); res.status(500).json({ error: e.message }); }
});

// BR-7.1: threshold is configurable by HR, per cycle — see migrations/006-pip.js
// for why this is a plain number on the existing 1-5 scale rather than a
// letter grade. Editable any time (not phase-gated) since the project plan
// expects it to be revisited during UAT once real test data exists.
router.put('/cycles/:id/pip-threshold', async (req, res) => {
  try {
    if (!(await hasPermission(req.user, 'pms_admin'))) return res.status(403).json({ error: "Requires 'pms_admin'" });
    const { threshold } = req.body || {};
    if (typeof threshold !== 'number' || threshold <= 0) return res.status(400).json({ error: 'threshold (positive number) required' });
    const r = await db.query(`UPDATE pms.cycles SET pip_threshold=$1, updated_at=now() WHERE id=$2 AND tenant_id=$3 RETURNING id, pip_threshold`,
      [threshold, req.params.id, T(req)]);
    if (!r.rows[0]) return res.status(404).json({ error: 'cycle not found' });
    audit(req, 'PIP_THRESHOLD_SET', req.params.id, null, { threshold });
    res.json({ ok: true, cycle_id: r.rows[0].id, pip_threshold: r.rows[0].pip_threshold });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Phase transitions: advance / rollback / cancel — audited, machine-checked.
router.post('/cycles/:id/phase', async (req, res) => {
  try {
    if (!(await hasPermission(req.user, 'pms_admin'))) return res.status(403).json({ error: "Requires 'pms_admin'" });
    const { to, rollback, cancel } = req.body || {};
    const c = (await db.query(`SELECT * FROM pms.cycles WHERE id=$1 AND tenant_id=$2`, [req.params.id, T(req)])).rows[0];
    if (!c) return res.status(404).json({ error: 'cycle not found' });
    let target = to, check;
    if (cancel) { check = pm.canCancel(c.phase); target = 'cancelled'; }
    else if (rollback) check = pm.canRollback(c.phase, to);
    else check = pm.canAdvance(c.phase, to);
    if (!check.ok) return res.status(409).json({ error: check.reason });
    await db.query(`UPDATE pms.cycles SET phase=$1, updated_at=now() WHERE id=$2`, [target, c.id]);
    audit(req, cancel ? 'CYCLE_CANCELLED' : rollback ? 'PHASE_ROLLBACK' : 'PHASE_ADVANCE', c.id, null, { from: c.phase, to: target });
    res.json({ ok: true, phase: target });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------- KRA sheets -------------------------------------------------
// My sheet for the active cycle (auto-created on first touch with my manager).
router.get('/my/kra-sheet', async (req, res) => {
  try {
    const c = await activeCycle(T(req));
    if (!c) return res.json({ cycle: null, sheet: null });
    let s = (await db.query(`SELECT * FROM pms.kra_sheets WHERE cycle_id=$1 AND employee_id=$2`, [c.id, req.user.id])).rows[0];
    if (!s) {
      const mgr = (await db.query(`SELECT manager_id FROM core.employees WHERE id=$1`, [req.user.id])).rows[0];
      s = (await db.query(
        `INSERT INTO pms.kra_sheets (tenant_id, cycle_id, employee_id, manager_id) VALUES ($1,$2,$3,$4) RETURNING *`,
        [T(req), c.id, req.user.id, mgr ? mgr.manager_id : null])).rows[0];
    }
    const kras = (await db.query(`SELECT * FROM pms.kras WHERE sheet_id=$1 ORDER BY sort_order`, [s.id])).rows;
    res.json({ cycle: { id: c.id, name: c.name, phase: c.phase }, sheet: s, kras, weights: pm.weightsValid(kras) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/my/kra-sheet/kras', async (req, res) => {
  try {
    const c = await activeCycle(T(req));
    if (!c || !pm.phaseAllows(c.phase, 'kra_edit')) return res.status(409).json({ error: `KRA editing is not open (phase: ${c ? c.phase : 'none'})` });
    const s = (await db.query(`SELECT * FROM pms.kra_sheets WHERE cycle_id=$1 AND employee_id=$2`, [c.id, req.user.id])).rows[0];
    if (!s) return res.status(404).json({ error: 'sheet not found — GET /my/kra-sheet first' });
    if (s.status === 'approved') return res.status(409).json({ error: 'sheet is approved — ask HR to return it for edits' });
    const kras = Array.isArray(req.body && req.body.kras) ? req.body.kras : [];
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM pms.kras WHERE sheet_id=$1`, [s.id]);
      let i = 0;
      for (const k of kras) {
        if (!k.title || !String(k.title).trim()) continue;
        await client.query(
          `INSERT INTO pms.kras (tenant_id, sheet_id, title, description, weight, measures, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [T(req), s.id, String(k.title).trim(), k.description || null, Number(k.weight) || 0, k.measures || null, (i += 10)]);
      }
      await client.query(`UPDATE pms.kra_sheets SET status='draft', updated_at=now() WHERE id=$1`, [s.id]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
    const saved = (await db.query(`SELECT * FROM pms.kras WHERE sheet_id=$1 ORDER BY sort_order`, [s.id])).rows;
    res.json({ ok: true, kras: saved, weights: pm.weightsValid(saved) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/my/kra-sheet/submit', async (req, res) => {
  try {
    const c = await activeCycle(T(req));
    if (!c || !pm.phaseAllows(c.phase, 'kra_submit')) return res.status(409).json({ error: 'KRA submission is not open' });
    const s = (await db.query(`SELECT * FROM pms.kra_sheets WHERE cycle_id=$1 AND employee_id=$2`, [c.id, req.user.id])).rows[0];
    if (!s) return res.status(404).json({ error: 'sheet not found' });
    const kras = (await db.query(`SELECT weight FROM pms.kras WHERE sheet_id=$1`, [s.id])).rows;
    const w = pm.weightsValid(kras);
    if (!kras.length) return res.status(422).json({ error: 'Add at least one KRA before submitting' });
    if (!w.ok) return res.status(422).json({ error: `KRA weights must total 100 (currently ${w.total})` });
    await db.query(`UPDATE pms.kra_sheets SET status='submitted', submitted_at=now(), updated_at=now() WHERE id=$1`, [s.id]);
    audit(req, 'KRA_SUBMITTED', c.id, req.user.id, { kras: kras.length });
    if (s.manager_id) await notify(T(req), s.manager_id, 'kra_submitted', `KRA sheet submitted by ${req.user.name}`, null, '/pms/team');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Manager: my team's sheets + approve/return.
router.get('/team/kra-sheets', async (req, res) => {
  try {
    if (!(await hasPermission(req.user, 'pms_team_eval'))) return res.status(403).json({ error: "Requires 'pms_team_eval'" });
    const c = await activeCycle(T(req));
    if (!c) return res.json({ cycle: null, sheets: [] });
    const r = await db.query(
      `SELECT s.*, e.name AS employee_name, e.email AS employee_email,
              (SELECT COUNT(*)::int FROM pms.kras k WHERE k.sheet_id=s.id) AS kra_count,
              (SELECT COALESCE(SUM(k.weight),0) FROM pms.kras k WHERE k.sheet_id=s.id) AS total_weight
         FROM pms.kra_sheets s JOIN core.employees e ON e.id=s.employee_id
        WHERE s.cycle_id=$1 AND s.manager_id=$2 ORDER BY e.name`, [c.id, req.user.id]);
    res.json({ cycle: { id: c.id, name: c.name, phase: c.phase }, sheets: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/team/kra-sheets/:sheetId/decide', async (req, res) => {
  try {
    if (!(await hasPermission(req.user, 'pms_team_eval'))) return res.status(403).json({ error: "Requires 'pms_team_eval'" });
    const { decision, comment } = req.body || {};
    if (!['approved', 'returned'].includes(decision)) return res.status(400).json({ error: "decision must be 'approved' or 'returned'" });
    const s = (await db.query(`SELECT * FROM pms.kra_sheets WHERE id=$1 AND tenant_id=$2`, [req.params.sheetId, T(req)])).rows[0];
    if (!s) return res.status(404).json({ error: 'sheet not found' });
    if (s.manager_id !== req.user.id && !(await hasPermission(req.user, 'pms_admin')))
      return res.status(403).json({ error: 'Not your report' });
    if (s.status !== 'submitted') return res.status(409).json({ error: `sheet is ${s.status}, not submitted` });
    if (decision === 'returned' && !(comment && comment.trim())) return res.status(422).json({ error: 'A return needs a comment — the employee must know why' });
    await db.query(`UPDATE pms.kra_sheets SET status=$1, manager_comment=$2, decided_at=now(), updated_at=now() WHERE id=$3`,
      [decision, comment || null, s.id]);
    audit(req, `KRA_${decision.toUpperCase()}`, s.cycle_id, s.employee_id, { comment: comment || null });
    await notify(T(req), s.employee_id, 'kra_decided', `Your KRA sheet was ${decision}`, comment || null, '/pms');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------- Self-appraisal --------------------------------------------
router.get('/my/self-appraisal', async (req, res) => {
  try {
    const c = await activeCycle(T(req));
    if (!c) return res.json({ cycle: null });
    let a = (await db.query(`SELECT * FROM pms.self_appraisals WHERE cycle_id=$1 AND employee_id=$2`, [c.id, req.user.id])).rows[0];
    if (!a) a = (await db.query(
      `INSERT INTO pms.self_appraisals (tenant_id, cycle_id, employee_id) VALUES ($1,$2,$3) RETURNING *`,
      [T(req), c.id, req.user.id])).rows[0];
    const sheet = (await db.query(`SELECT id FROM pms.kra_sheets WHERE cycle_id=$1 AND employee_id=$2`, [c.id, req.user.id])).rows[0];
    const kras = sheet ? (await db.query(`SELECT id, title, weight FROM pms.kras WHERE sheet_id=$1 ORDER BY sort_order`, [sheet.id])).rows : [];
    res.json({ cycle: { id: c.id, name: c.name, phase: c.phase, rating_scale: c.rating_scale }, appraisal: a, kras });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/my/self-appraisal', async (req, res) => {
  try {
    const c = await activeCycle(T(req));
    if (!c || !pm.phaseAllows(c.phase, 'self_edit')) return res.status(409).json({ error: `Self-appraisal is not open (phase: ${c ? c.phase : 'none'})` });
    const a = (await db.query(`SELECT * FROM pms.self_appraisals WHERE cycle_id=$1 AND employee_id=$2`, [c.id, req.user.id])).rows[0];
    if (!a) return res.status(404).json({ error: 'GET /my/self-appraisal first' });
    if (a.status === 'submitted') return res.status(409).json({ error: 'Already submitted — locked' });
    const b = req.body || {};
    await db.query(
      `UPDATE pms.self_appraisals SET status='in_progress',
         entries=COALESCE($2,entries), overall_self_rating=COALESCE($3,overall_self_rating),
         went_well=COALESCE($4,went_well), could_improve=COALESCE($5,could_improve), updated_at=now()
       WHERE id=$1`,
      [a.id, b.entries ? JSON.stringify(b.entries) : null, b.overall_self_rating ?? null, b.went_well ?? null, b.could_improve ?? null]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/my/self-appraisal/submit', async (req, res) => {
  try {
    const c = await activeCycle(T(req));
    if (!c || !pm.phaseAllows(c.phase, 'self_submit')) return res.status(409).json({ error: 'Self-appraisal submission is not open' });
    const a = (await db.query(`SELECT * FROM pms.self_appraisals WHERE cycle_id=$1 AND employee_id=$2`, [c.id, req.user.id])).rows[0];
    if (!a) return res.status(404).json({ error: 'nothing to submit' });
    if (a.status === 'submitted') return res.status(409).json({ error: 'already submitted' });
    await db.query(`UPDATE pms.self_appraisals SET status='submitted', submitted_at=now(), updated_at=now() WHERE id=$1`, [a.id]);
    audit(req, 'SELF_APPRAISAL_SUBMITTED', c.id, req.user.id, null);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------- Manager & HOD evaluation ----------------------------------
router.get('/team/evaluations', async (req, res) => {
  try {
    if (!(await hasPermission(req.user, 'pms_team_eval'))) return res.status(403).json({ error: "Requires 'pms_team_eval'" });
    const c = await activeCycle(T(req));
    if (!c) return res.json({ cycle: null, team: [] });
    const r = await db.query(
      `SELECT e.id AS employee_id, e.name, e.department,
              sa.status AS self_status, sa.entries AS self_entries, sa.overall_self_rating,
              sa.went_well, sa.could_improve,
              me.id AS eval_id, me.status AS eval_status, me.entries AS eval_entries,
              me.overall_rating, me.strengths, me.improvement_areas
         FROM core.employees e
         LEFT JOIN pms.self_appraisals sa ON sa.cycle_id=$1 AND sa.employee_id=e.id
         LEFT JOIN pms.manager_evaluations me ON me.cycle_id=$1 AND me.employee_id=e.id
        WHERE e.tenant_id=$2 AND e.manager_id=$3 AND e.status='active' ORDER BY e.name`,
      [c.id, T(req), req.user.id]);
    res.json({ cycle: { id: c.id, name: c.name, phase: c.phase, rating_scale: c.rating_scale }, team: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/team/evaluations/:employeeId', async (req, res) => {
  try {
    if (!(await hasPermission(req.user, 'pms_team_eval'))) return res.status(403).json({ error: "Requires 'pms_team_eval'" });
    const c = await activeCycle(T(req));
    if (!c || !pm.phaseAllows(c.phase, 'manager_edit')) return res.status(409).json({ error: `Manager evaluation is not open (phase: ${c ? c.phase : 'none'})` });
    const emp = (await db.query(`SELECT id, manager_id FROM core.employees WHERE id=$1 AND tenant_id=$2`, [req.params.employeeId, T(req)])).rows[0];
    if (!emp) return res.status(404).json({ error: 'employee not found' });
    if (emp.manager_id !== req.user.id && !(await hasPermission(req.user, 'pms_admin'))) return res.status(403).json({ error: 'Not your report' });
    const b = req.body || {};
    await db.query(
      `INSERT INTO pms.manager_evaluations (tenant_id, cycle_id, employee_id, manager_id, entries, overall_rating, strengths, improvement_areas, status)
       VALUES ($1,$2,$3,$4,COALESCE($5,'{}'::jsonb),$6,$7,$8,'pending')
       ON CONFLICT (cycle_id, employee_id) DO UPDATE SET
         entries=COALESCE($5,pms.manager_evaluations.entries),
         overall_rating=COALESCE($6,pms.manager_evaluations.overall_rating),
         strengths=COALESCE($7,pms.manager_evaluations.strengths),
         improvement_areas=COALESCE($8,pms.manager_evaluations.improvement_areas),
         updated_at=now()`,
      [T(req), c.id, emp.id, req.user.id, b.entries ? JSON.stringify(b.entries) : null,
       b.overall_rating ?? null, b.strengths ?? null, b.improvement_areas ?? null]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/team/evaluations/:employeeId/submit', async (req, res) => {
  try {
    if (!(await hasPermission(req.user, 'pms_team_eval'))) return res.status(403).json({ error: "Requires 'pms_team_eval'" });
    const c = await activeCycle(T(req));
    if (!c || !pm.phaseAllows(c.phase, 'manager_submit')) return res.status(409).json({ error: 'Manager evaluation is not open' });
    const ev = (await db.query(`SELECT * FROM pms.manager_evaluations WHERE cycle_id=$1 AND employee_id=$2`, [c.id, req.params.employeeId])).rows[0];
    if (!ev) return res.status(404).json({ error: 'no evaluation drafted' });
    if (ev.overall_rating == null) return res.status(422).json({ error: 'overall_rating required to submit' });
    await db.query(`UPDATE pms.manager_evaluations SET status='submitted', submitted_at=now(), updated_at=now() WHERE id=$1`, [ev.id]);
    audit(req, 'MANAGER_EVAL_SUBMITTED', c.id, req.params.employeeId, { rating: ev.overall_rating });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// HOD: department queue + decide.
router.get('/hod/queue', async (req, res) => {
  try {
    if (!(await hasPermission(req.user, 'pms_hod'))) return res.status(403).json({ error: "Requires 'pms_hod'" });
    const c = await activeCycle(T(req));
    if (!c) return res.json({ cycle: null, queue: [] });
    const depts = (await db.query(`SELECT department FROM core.department_heads WHERE tenant_id=$1 AND employee_id=$2`, [T(req), req.user.id])).rows.map(r => r.department);
    const isAdmin = await hasPermission(req.user, 'pms_admin');
    const r = await db.query(
      `SELECT e.id AS employee_id, e.name, e.department, me.overall_rating AS manager_rating,
              me.status AS manager_status, he.overall_rating AS hod_rating, he.status AS hod_status
         FROM core.employees e
         JOIN pms.manager_evaluations me ON me.cycle_id=$1 AND me.employee_id=e.id AND me.status='submitted'
         LEFT JOIN pms.hod_evaluations he ON he.cycle_id=$1 AND he.employee_id=e.id
        WHERE e.tenant_id=$2 ${isAdmin ? '' : 'AND e.department = ANY($3)'} ORDER BY e.department, e.name`,
      isAdmin ? [c.id, T(req)] : [c.id, T(req), depts]);
    res.json({ cycle: { id: c.id, name: c.name, phase: c.phase }, departments: depts, queue: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/hod/queue/:employeeId', async (req, res) => {
  try {
    if (!(await hasPermission(req.user, 'pms_hod'))) return res.status(403).json({ error: "Requires 'pms_hod'" });
    const c = await activeCycle(T(req));
    if (!c || !pm.phaseAllows(c.phase, 'hod_edit')) return res.status(409).json({ error: `HOD evaluation is not open (phase: ${c ? c.phase : 'none'})` });
    const { overall_rating, comment, submit } = req.body || {};
    await db.query(
      `INSERT INTO pms.hod_evaluations (tenant_id, cycle_id, employee_id, hod_id, overall_rating, comment, status, submitted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (cycle_id, employee_id) DO UPDATE SET
         overall_rating=COALESCE($5,pms.hod_evaluations.overall_rating),
         comment=COALESCE($6,pms.hod_evaluations.comment),
         status=$7, submitted_at=COALESCE($8,pms.hod_evaluations.submitted_at)`,
      [T(req), c.id, req.params.employeeId, req.user.id, overall_rating ?? null, comment ?? null,
       submit ? 'submitted' : 'pending', submit ? new Date() : null]);
    if (submit) audit(req, 'HOD_EVAL_SUBMITTED', c.id, req.params.employeeId, { rating: overall_rating });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------- Calibration ------------------------------------------------
router.get('/calibration', async (req, res) => {
  try {
    if (!(await hasPermission(req.user, 'pms_admin'))) return res.status(403).json({ error: "Requires 'pms_admin'" });
    const c = await activeCycle(T(req));
    if (!c) return res.json({ cycle: null });
    // Proposed = HOD rating where present, else manager rating; distribution vs bell curve.
    const rows = (await db.query(
      `SELECT e.id AS employee_id, e.name, e.department,
              me.overall_rating AS manager_rating, he.overall_rating AS hod_rating,
              COALESCE(adj.to_rating, he.overall_rating, me.overall_rating) AS proposed,
              tt.nine_box_cell, tt.potential_rating
         FROM core.employees e
         JOIN pms.manager_evaluations me ON me.cycle_id=$1 AND me.employee_id=e.id AND me.status='submitted'
         LEFT JOIN pms.hod_evaluations he ON he.cycle_id=$1 AND he.employee_id=e.id AND he.status='submitted'
         LEFT JOIN LATERAL (SELECT to_rating FROM pms.rating_adjustments ra
                             WHERE ra.cycle_id=$1 AND ra.employee_id=e.id ORDER BY at DESC LIMIT 1) adj ON true
         LEFT JOIN pms.top_talent tt ON tt.cycle_id=$1 AND tt.employee_id=e.id
        WHERE e.tenant_id=$2 ORDER BY e.department, e.name`, [c.id, T(req)])).rows;
    const dist = {};
    for (const r of rows) { const k = r.proposed == null ? 'unrated' : String(Math.round(r.proposed)); dist[k] = (dist[k] || 0) + 1; }
    res.json({ cycle: { id: c.id, name: c.name, phase: c.phase, bell_curve: c.bell_curve }, rows, distribution: dist });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/calibration/adjust', async (req, res) => {
  try {
    if (!(await hasPermission(req.user, 'pms_admin'))) return res.status(403).json({ error: "Requires 'pms_admin'" });
    const c = await activeCycle(T(req));
    if (!c || !pm.phaseAllows(c.phase, 'adjust')) return res.status(409).json({ error: `Calibration is not open (phase: ${c ? c.phase : 'none'})` });
    const { employee_id, from_rating, to_rating, reason, session_id } = req.body || {};
    if (!employee_id || to_rating == null) return res.status(400).json({ error: 'employee_id and to_rating required' });
    if (!reason || !reason.trim()) return res.status(422).json({ error: 'A reason is required — adjustments must answer "why did my rating change"' });
    await db.query(
      `INSERT INTO pms.rating_adjustments (tenant_id, cycle_id, employee_id, session_id, from_rating, to_rating, reason, adjusted_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [T(req), c.id, employee_id, session_id || null, from_rating ?? null, to_rating, reason.trim(), req.user.email]);
    audit(req, 'RATING_ADJUSTED', c.id, employee_id, { from: from_rating, to: to_rating, reason });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------- 9-Box Grid — BR-6.4 -------------------------------------
// Aggregates pms.top_talent entries (nine_box_cell values already captured
// via the existing top-talent endpoint above) into the grid, at whichever
// of the three levels the BRD names: org-wide, per-department, or per
// reporting-line (each employee's direct manager). HR and Delivery Head
// both get view access, per BR-6.4's stated audience — unlike /watchlist
// (BR-6.5/6.6), which is HR/Management only.
//
// nine_box_cell convention (see frontend CalibrationPage.jsx's NINE_BOX
// list, unchanged here): "<performance>-<potential>", each low|mid|high.
router.get('/nine-box', async (req, res) => {
  try {
    if (!(await hasPermission(req.user, 'pms_admin')) && !(await hasPermission(req.user, 'pms_hod'))) {
      return res.status(403).json({ error: "Requires 'pms_admin' or 'pms_hod'" });
    }
    const level = ['org', 'department', 'manager'].includes(req.query.level) ? req.query.level : 'org';
    const c = await activeCycle(T(req));
    if (!c) return res.status(409).json({ error: 'No active cycle' });
    const rows = (await db.query(
      `SELECT e.id, e.name, e.department, m.name AS manager_name, tt.nine_box_cell, tt.potential_rating
         FROM pms.top_talent tt JOIN core.employees e ON e.id=tt.employee_id
         LEFT JOIN core.employees m ON m.id=e.manager_id
        WHERE tt.tenant_id=$1 AND tt.cycle_id=$2 AND tt.nine_box_cell IS NOT NULL`,
      [T(req), c.id])).rows;

    const groupKey = (r) => (level === 'department' ? (r.department || 'Unassigned') : level === 'manager' ? (r.manager_name || 'No manager') : 'Organisation');
    const groups = new Map();
    for (const r of rows) {
      const key = groupKey(r);
      if (!groups.has(key)) groups.set(key, { key, total: 0, cells: {} });
      const g = groups.get(key);
      g.total++;
      const cellKey = r.nine_box_cell;
      if (!g.cells[cellKey]) g.cells[cellKey] = [];
      g.cells[cellKey].push({ id: r.id, name: r.name });
    }
    res.json({ cycle: { id: c.id, name: c.name }, level, groups: [...groups.values()].sort((a, b) => a.key.localeCompare(b.key)) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/calibration/top-talent', async (req, res) => {
  try {
    if (!(await hasPermission(req.user, 'pms_admin'))) return res.status(403).json({ error: "Requires 'pms_admin'" });
    const c = await activeCycle(T(req));
    if (!c || !pm.phaseAllows(c.phase, 'top_talent')) return res.status(409).json({ error: 'Calibration is not open' });
    const { employee_id, potential_rating, nine_box_cell } = req.body || {};
    if (!employee_id) return res.status(400).json({ error: 'employee_id required' });
    await db.query(
      `INSERT INTO pms.top_talent (tenant_id, cycle_id, employee_id, potential_rating, nine_box_cell, noted_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (cycle_id, employee_id) DO UPDATE SET
         potential_rating=EXCLUDED.potential_rating, nine_box_cell=EXCLUDED.nine_box_cell, noted_by=EXCLUDED.noted_by, at=now()`,
      [T(req), c.id, employee_id, potential_rating || null, nine_box_cell || null, req.user.email]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------- Publish ----------------------------------------------------
// Final rating = latest adjustment, else HOD, else manager. Writes history,
// mirrors to core.employees (the write-back set), creates letter records,
// notifies. Idempotent per employee via history PK.
router.post('/publish', async (req, res) => {
  try {
    if (!(await hasPermission(req.user, 'pms_admin'))) return res.status(403).json({ error: "Requires 'pms_admin'" });
    const c = await activeCycle(T(req));
    if (!c || !pm.phaseAllows(c.phase, 'publish')) return res.status(409).json({ error: `Publish is not open (phase: ${c ? c.phase : 'none'})` });
    const rows = (await db.query(
      `SELECT e.id AS employee_id, e.name AS employee_name,
              COALESCE(adj.to_rating, he.overall_rating, me.overall_rating) AS final_rating,
              tt.potential_rating, tt.nine_box_cell
         FROM core.employees e
         JOIN pms.manager_evaluations me ON me.cycle_id=$1 AND me.employee_id=e.id AND me.status='submitted'
         LEFT JOIN pms.hod_evaluations he ON he.cycle_id=$1 AND he.employee_id=e.id AND he.status='submitted'
         LEFT JOIN LATERAL (SELECT to_rating FROM pms.rating_adjustments ra
                             WHERE ra.cycle_id=$1 AND ra.employee_id=e.id ORDER BY at DESC LIMIT 1) adj ON true
         LEFT JOIN pms.top_talent tt ON tt.cycle_id=$1 AND tt.employee_id=e.id
        WHERE e.tenant_id=$2`, [c.id, T(req)])).rows;
    const scale = Array.isArray(c.rating_scale) ? c.rating_scale : [];
    const label = (v) => { const m = scale.find(s => Math.round(v) === s.value); return m ? m.label : null; };
    let published = 0; let pipsOpened = 0; let super50Flagged = 0; const failures = [];
    for (const r of rows) {
      if (r.final_rating == null) { failures.push({ employee_id: r.employee_id, reason: 'no rating at any layer' }); continue; }
      try {
        await db.query(
          `INSERT INTO pms.employee_performance_history (tenant_id, employee_id, cycle_id, final_rating, rating_label)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT (employee_id, cycle_id) DO UPDATE SET final_rating=EXCLUDED.final_rating, rating_label=EXCLUDED.rating_label, published_at=now()`,
          [T(req), r.employee_id, c.id, r.final_rating, label(r.final_rating)]);
        await db.query(
          `UPDATE core.employees SET last_appraisal_rating=$2, last_appraisal_cycle_id=$3, last_appraisal_at=now(),
                  potential_rating=COALESCE($4,potential_rating), nine_box_cell=COALESCE($5,nine_box_cell), updated_at=now()
            WHERE id=$1`, [r.employee_id, String(r.final_rating), c.id, r.potential_rating, r.nine_box_cell]);
        await db.query(
          `INSERT INTO pms.closure_letters (tenant_id, cycle_id, employee_id) VALUES ($1,$2,$3)
           ON CONFLICT (cycle_id, employee_id) DO NOTHING`, [T(req), c.id, r.employee_id]);
        // BR-6.5: Super 50 watchlist — recomputed from this employee's last 3
        // published ANNUAL cycles (midyear publishes don't touch this; see
        // rating-rules.js for the letter-grade mapping and why annual-only).
        // A lapsed streak un-flags automatically — this is "currently on
        // the watchlist", not a permanent badge.
        if (c.cycle_type === 'annual') {
          const hist = (await db.query(
            `SELECT h.final_rating FROM pms.employee_performance_history h JOIN pms.cycles hc ON hc.id=h.cycle_id
              WHERE h.tenant_id=$1 AND h.employee_id=$2 AND hc.cycle_type='annual'
              ORDER BY h.published_at DESC LIMIT 3`, [T(req), r.employee_id])).rows;
          const eligible = isSuper50Eligible(hist.map((x) => x.final_rating));
          const emp = (await db.query(`SELECT super50_flag FROM core.employees WHERE id=$1`, [r.employee_id])).rows[0];
          const wasFlagged = !!(emp && emp.super50_flag);
          if (eligible && !wasFlagged) {
            await db.query(`UPDATE core.employees SET super50_flag=true, super50_since=now() WHERE id=$1`, [r.employee_id]);
            super50Flagged++;
            audit(req, 'SUPER50_FLAGGED', c.id, r.employee_id, { ratings: hist.map((x) => x.final_rating) });
            await notify(T(req), r.employee_id, 'super50_flagged', 'You have been recognised as a consistent top performer', null, '/pms/my-rating');
            // BR-6.6: proactively alert HR/Management to consider retention
            // actions for this newly-flagged employee.
            const alerted = await alertHrOfRetentionRisk(T(req), { id: r.employee_id, name: r.employee_name });
            audit(req, 'RETENTION_ALERT_SENT', c.id, r.employee_id, { alerted_recipients: alerted });
          } else if (!eligible && wasFlagged) {
            await db.query(`UPDATE core.employees SET super50_flag=false, super50_since=NULL WHERE id=$1`, [r.employee_id]);
            audit(req, 'SUPER50_UNFLAGGED', c.id, r.employee_id, { ratings: hist.map((x) => x.final_rating) });
          }
        }
        // BR-7.1: automatic PIP trigger below the cycle's configured threshold.
        // ON CONFLICT DO NOTHING (unique on tenant/employee/cycle, migration
        // 006) makes this safe if publish is re-run — it won't reopen or
        // duplicate a PIP that already exists for this cycle.
        if (Number(r.final_rating) < Number(c.pip_threshold)) {
          const pipR = await db.query(
            `INSERT INTO pms.pip_records (tenant_id, employee_id, cycle_id, status, opened_by)
             VALUES ($1,$2,$3,'open',$4) ON CONFLICT (tenant_id, employee_id, cycle_id) DO NOTHING RETURNING id`,
            [T(req), r.employee_id, c.id, `system:publish (${req.user.email})`]);
          if (pipR.rows[0]) {
            pipsOpened++;
            await notify(T(req), r.employee_id, 'pip_opened', `A Performance Improvement Plan has been opened for ${c.name}`, null, '/pms/my-rating');
            audit(req, 'PIP_AUTO_OPENED', c.id, r.employee_id, { final_rating: r.final_rating, threshold: c.pip_threshold });
          }
        }
        await notify(T(req), r.employee_id, 'rating_published', `Your ${c.name} rating is published`, null, '/pms/my-rating');
        published++;
      } catch (e) { failures.push({ employee_id: r.employee_id, reason: e.message }); }
    }
    audit(req, 'CYCLE_PUBLISHED', c.id, null, { published, failed: failures.length, pips_opened: pipsOpened, super50_flagged: super50Flagged });
    res.json({ ok: true, published, pips_opened: pipsOpened, super50_flagged: super50Flagged, failures });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------- My rating & history / Connects / PIP ----------------------
router.get('/my/rating', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT h.cycle_id, c.name AS cycle_name, c.fiscal_year, h.final_rating, h.rating_label, h.published_at
         FROM pms.employee_performance_history h JOIN pms.cycles c ON c.id=h.cycle_id
        WHERE h.tenant_id=$1 AND h.employee_id=$2 ORDER BY h.published_at DESC`, [T(req), req.user.id]);
    res.json({ history: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// meeting_based=true marks this log as populated from a recorded/transcribed
// meeting or a calendar/meeting-tool pull (BRD §6 NFR) rather than typed in
// directly by the manager/employee. That path is gated on the employee's
// own explicit consent — requireConsent() 403s before anything is written
// if it is missing. A plain typed-in log (meeting_based omitted or false)
// is unaffected and needs no consent, since nothing is being
// recorded/transcribed on the employee's behalf in that case.
router.post('/connects', async (req, res) => {
  try {
    if (!(await hasPermission(req.user, 'pms_team_eval'))) return res.status(403).json({ error: "Requires 'pms_team_eval'" });
    const { employee_id, held_at, notes, kra_ids, meeting_based } = req.body || {};
    if (!employee_id || !held_at) return res.status(400).json({ error: 'employee_id and held_at required' });
    if (meeting_based) await requireConsent(T(req), employee_id);
    await db.query(
      `INSERT INTO pms.connects (tenant_id, manager_id, employee_id, held_at, notes, kra_ids, meeting_based)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6::uuid[],'{}'::uuid[]),$7)`,
      [T(req), req.user.id, employee_id, held_at, notes || null, Array.isArray(kra_ids) ? kra_ids : null, !!meeting_based]);
    res.json({ ok: true });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

router.get('/connects', async (req, res) => {
  try {
    const mine = req.query.employee_id;
    const r = await db.query(
      `SELECT cn.*, e.name AS employee_name, m.name AS manager_name
         FROM pms.connects cn JOIN core.employees e ON e.id=cn.employee_id JOIN core.employees m ON m.id=cn.manager_id
        WHERE cn.tenant_id=$1 AND (cn.employee_id=$2 OR cn.manager_id=$2) ${mine ? 'AND cn.employee_id=$3' : ''}
        ORDER BY cn.held_at DESC LIMIT 100`,
      mine ? [T(req), req.user.id, mine] : [T(req), req.user.id]);
    res.json({ connects: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------- PIP (Performance Improvement Plan) — BR-7.1/BR-7.2 -------
// Auto-opened at /publish (above) when final_rating < cycle.pip_threshold.
// Writers are the employee's manager or HR (BRD Owner/Approver column);
// the employee has read-only visibility into their own PIP and its weekly
// entries — matching "visible to the employee, manager, and HR."
async function isManagerOfOrAdmin(req, employeeId) {
  if (await hasPermission(req.user, 'pms_admin')) return true;
  const r = await db.query(`SELECT 1 FROM core.employees WHERE id=$1 AND tenant_id=$2 AND manager_id=$3`,
    [employeeId, T(req), req.user.id]);
  return !!r.rows[0];
}

router.get('/pip', async (req, res) => {
  try {
    const isAdmin = await hasPermission(req.user, 'pms_admin');
    const { employee_id, status } = req.query;
    const params = [T(req)]; const clauses = ['p.tenant_id=$1'];
    if (!isAdmin) {
      params.push(req.user.id);
      clauses.push(`(p.employee_id=$${params.length} OR EXISTS (SELECT 1 FROM core.employees me WHERE me.id=p.employee_id AND me.manager_id=$${params.length}))`);
    }
    if (employee_id) { params.push(employee_id); clauses.push(`p.employee_id=$${params.length}`); }
    if (status) { params.push(status); clauses.push(`p.status=$${params.length}`); }
    const r = await db.query(
      `SELECT p.*, e.name AS employee_name, e.department, c.name AS cycle_name
         FROM pms.pip_records p JOIN core.employees e ON e.id=p.employee_id
         LEFT JOIN pms.cycles c ON c.id=p.cycle_id
        WHERE ${clauses.join(' AND ')} ORDER BY p.opened_at DESC`, params);
    res.json({ pips: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/pip/:id', async (req, res) => {
  try {
    const p = (await db.query(`SELECT p.*, e.name AS employee_name FROM pms.pip_records p JOIN core.employees e ON e.id=p.employee_id
                                 WHERE p.id=$1 AND p.tenant_id=$2`, [req.params.id, T(req)])).rows[0];
    if (!p) return res.status(404).json({ error: 'PIP not found' });
    const isSelf = p.employee_id === req.user.id;
    if (!isSelf && !(await isManagerOfOrAdmin(req, p.employee_id))) return res.status(403).json({ error: 'Not visible to you' });
    const entries = (await db.query(
      `SELECT id, week_ending, notes, submitted_by, created_at FROM pms.pip_weekly_entries
        WHERE pip_id=$1 ORDER BY week_ending DESC`, [p.id])).rows;
    res.json({ pip: p, weekly_entries: entries });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Manager/HR only — plan text, and status transitions through to a
// documented closure (BR-7.2 "through to a documented closure": closing
// requires closed_reason, not just a status flip).
router.put('/pip/:id', async (req, res) => {
  try {
    const p = (await db.query(`SELECT * FROM pms.pip_records WHERE id=$1 AND tenant_id=$2`, [req.params.id, T(req)])).rows[0];
    if (!p) return res.status(404).json({ error: 'PIP not found' });
    if (!(await isManagerOfOrAdmin(req, p.employee_id))) return res.status(403).json({ error: 'Requires being this employee\'s manager, or pms_admin' });
    const { plan, status, closed_reason } = req.body || {};
    const VALID = ['open', 'in_progress', 'closed_successful', 'closed_unsuccessful'];
    if (status && !VALID.includes(status)) return res.status(400).json({ error: `status must be one of: ${VALID.join(', ')}` });
    if (status && status.startsWith('closed') && !closed_reason) return res.status(400).json({ error: 'closed_reason required to close a PIP' });
    const closing = status && status.startsWith('closed');
    await db.query(
      `UPDATE pms.pip_records SET plan=COALESCE($1,plan), status=COALESCE($2,status),
              closed_reason=COALESCE($3,closed_reason), closed_at=CASE WHEN $4 THEN now() ELSE closed_at END
        WHERE id=$5`, [plan || null, status || null, closed_reason || null, closing, p.id]);
    audit(req, closing ? 'PIP_CLOSED' : 'PIP_UPDATED', p.cycle_id, p.employee_id, { status, closed_reason });
    if (closing) await notify(T(req), p.employee_id, 'pip_closed', `Your Performance Improvement Plan has been closed (${status})`, null, '/pms/my-rating');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/pip/:id/entries', async (req, res) => {
  try {
    const p = (await db.query(`SELECT * FROM pms.pip_records WHERE id=$1 AND tenant_id=$2`, [req.params.id, T(req)])).rows[0];
    if (!p) return res.status(404).json({ error: 'PIP not found' });
    if (!(await isManagerOfOrAdmin(req, p.employee_id))) return res.status(403).json({ error: 'Requires being this employee\'s manager, or pms_admin' });
    if (p.status.startsWith('closed')) return res.status(409).json({ error: 'PIP is closed — no further entries' });
    const { week_ending, notes } = req.body || {};
    if (!week_ending || !notes) return res.status(400).json({ error: 'week_ending and notes required' });
    await db.query(
      `INSERT INTO pms.pip_weekly_entries (tenant_id, pip_id, week_ending, notes, submitted_by) VALUES ($1,$2,$3,$4,$5)`,
      [T(req), p.id, week_ending, notes, req.user.email]);
    if (p.status === 'open') await db.query(`UPDATE pms.pip_records SET status='in_progress' WHERE id=$1`, [p.id]);
    await notify(T(req), p.employee_id, 'pip_entry_added', 'A new weekly note was added to your Performance Improvement Plan', null, '/pms/my-rating');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------- Super 50 / High-Performer Watchlist — BR-6.5 -------------
// HR/Management view (matches the BRD's Owner/Approver column for this
// requirement). The flag itself is recomputed at /publish, above; this
// route just surfaces who is currently on it, for retention/succession
// planning. Retention Alerts (BR-6.6, next feature) reads this same flag.
router.get('/watchlist', async (req, res) => {
  try {
    if (!(await hasPermission(req.user, 'pms_admin'))) return res.status(403).json({ error: "Requires 'pms_admin'" });
    const r = await db.query(
      `SELECT e.id, e.name, e.email, e.department, e.designation, e.super50_since,
              e.last_appraisal_rating, e.last_appraisal_at
         FROM core.employees e WHERE e.tenant_id=$1 AND e.super50_flag=true
        ORDER BY e.super50_since ASC`, [T(req)]);
    res.json({ watchlist: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = { router };
