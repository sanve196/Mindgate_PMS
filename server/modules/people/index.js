// People — the culture layer (spec §5): awards, events + RSVPs, CSR,
// campus, appraisal queries, career matrix/paths. Straightforward CRUD with
// the standard gates: people_view to read, people_admin to administer;
// employees act on their own rows (RSVP, participate, nominate, query).

const express = require('express');
const db = require('../../core/db');
const logger = require('../../core/logger');
const { authenticate } = require('../../core/auth');
const { apiPermissionParity, hasPermission } = require('../../core/permissions');
const { notify } = require('../../core/notifications');

const router = express.Router();
router.use(authenticate, apiPermissionParity);
const T = (req) => req.user.tenant_id;
const adminOnly = async (req, res) => {
  if (await hasPermission(req.user, 'people_admin')) return true;
  res.status(403).json({ error: "Requires 'people_admin'" }); return false;
};

// ---- Awards -----------------------------------------------------------------
router.get('/awards', async (req, res) => {
  try {
    const progs = (await db.query(`SELECT * FROM people.award_programs WHERE tenant_id=$1 AND active ORDER BY name`, [T(req)])).rows;
    const cycles = (await db.query(
      `SELECT c.*, p.name AS program_name,
              (SELECT COUNT(*)::int FROM people.award_nominations n WHERE n.cycle_id=c.id) AS nominations
         FROM people.award_cycles c JOIN people.award_programs p ON p.id=c.program_id
        WHERE c.tenant_id=$1 ORDER BY c.opens_at DESC NULLS LAST`, [T(req)])).rows;
    res.json({ programs: progs, cycles });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/awards/programs', async (req, res) => {
  try {
    if (!(await adminOnly(req, res))) return;
    const { name, description } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name required' });
    const r = await db.query(`INSERT INTO people.award_programs (tenant_id, name, description) VALUES ($1,$2,$3) RETURNING *`,
      [T(req), name, description || null]);
    res.json({ ok: true, program: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/awards/cycles', async (req, res) => {
  try {
    if (!(await adminOnly(req, res))) return;
    const { program_id, name, opens_at, closes_at } = req.body || {};
    if (!program_id || !name) return res.status(400).json({ error: 'program_id and name required' });
    const r = await db.query(
      `INSERT INTO people.award_cycles (tenant_id, program_id, name, opens_at, closes_at) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [T(req), program_id, name, opens_at || null, closes_at || null]);
    res.json({ ok: true, cycle: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/awards/cycles/:cycleId/nominate', async (req, res) => {
  try {
    const { nominee_id, citation } = req.body || {};
    if (!nominee_id || !citation || !citation.trim()) return res.status(400).json({ error: 'nominee_id and citation required — a nomination without a why is noise' });
    const c = (await db.query(`SELECT status FROM people.award_cycles WHERE id=$1 AND tenant_id=$2`, [req.params.cycleId, T(req)])).rows[0];
    if (!c) return res.status(404).json({ error: 'cycle not found' });
    if (c.status !== 'open') return res.status(409).json({ error: `cycle is ${c.status}, not open` });
    if (nominee_id === req.user.id) return res.status(422).json({ error: 'Self-nomination is not accepted' });
    const r = await db.query(
      `INSERT INTO people.award_nominations (tenant_id, cycle_id, nominee_id, nominated_by, citation)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`, [T(req), req.params.cycleId, nominee_id, req.user.id, citation.trim()]);
    res.json({ ok: true, id: r.rows[0].id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/awards/nominations/:id/decide', async (req, res) => {
  try {
    if (!(await adminOnly(req, res))) return;
    const { status } = req.body || {};
    if (!['shortlisted', 'won', 'not_selected'].includes(status)) return res.status(400).json({ error: 'status must be shortlisted|won|not_selected' });
    const r = await db.query(
      `UPDATE people.award_nominations SET status=$1, decided_by=$2, decided_at=now() WHERE id=$3 AND tenant_id=$4 RETURNING nominee_id`,
      [status, req.user.email, req.params.id, T(req)]);
    if (!r.rows.length) return res.status(404).json({ error: 'nomination not found' });
    if (status === 'won') await notify(T(req), r.rows[0].nominee_id, 'award_won', 'Congratulations — you have won an award!', null, '/people');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Events + RSVP ---------------------------------------------------------
router.get('/events', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT e.*, (SELECT COUNT(*)::int FROM people.event_rsvps r WHERE r.event_id=e.id AND r.response='yes') AS yes_count,
              (SELECT response FROM people.event_rsvps r WHERE r.event_id=e.id AND r.employee_id=$2) AS my_rsvp
         FROM people.events e WHERE e.tenant_id=$1 ORDER BY e.starts_at DESC LIMIT 100`, [T(req), req.user.id]);
    res.json({ events: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/events', async (req, res) => {
  try {
    if (!(await adminOnly(req, res))) return;
    const { title, description, location, starts_at, ends_at } = req.body || {};
    if (!title || !starts_at) return res.status(400).json({ error: 'title and starts_at required' });
    const r = await db.query(
      `INSERT INTO people.events (tenant_id, title, description, location, starts_at, ends_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [T(req), title, description || null, location || null, starts_at, ends_at || null, req.user.email]);
    res.json({ ok: true, event: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/events/:id/rsvp', async (req, res) => {
  try {
    const response = (req.body && req.body.response) || 'yes';
    if (!['yes', 'no', 'maybe'].includes(response)) return res.status(400).json({ error: 'response must be yes|no|maybe' });
    await db.query(
      `INSERT INTO people.event_rsvps (tenant_id, event_id, employee_id, response) VALUES ($1,$2,$3,$4)
       ON CONFLICT (event_id, employee_id) DO UPDATE SET response=EXCLUDED.response, at=now()`,
      [T(req), req.params.id, req.user.id, response]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- CSR --------------------------------------------------------------------
router.get('/csr', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT c.*, (SELECT COUNT(*)::int FROM people.csr_participations p WHERE p.csr_event_id=c.id) AS participants,
              (SELECT hours FROM people.csr_participations p WHERE p.csr_event_id=c.id AND p.employee_id=$2) AS my_hours
         FROM people.csr_events c WHERE c.tenant_id=$1 ORDER BY c.event_date DESC NULLS LAST LIMIT 100`, [T(req), req.user.id]);
    res.json({ csr: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/csr', async (req, res) => {
  try {
    if (!(await adminOnly(req, res))) return;
    const { title, description, event_date, hours_credit } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title required' });
    const r = await db.query(
      `INSERT INTO people.csr_events (tenant_id, title, description, event_date, hours_credit) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [T(req), title, description || null, event_date || null, hours_credit || 0]);
    res.json({ ok: true, csr: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/csr/:id/participate', async (req, res) => {
  try {
    const hours = req.body && req.body.hours;
    await db.query(
      `INSERT INTO people.csr_participations (tenant_id, csr_event_id, employee_id, hours) VALUES ($1,$2,$3,$4)
       ON CONFLICT (csr_event_id, employee_id) DO UPDATE SET hours=EXCLUDED.hours, at=now()`,
      [T(req), req.params.id, req.user.id, hours != null ? Number(hours) : null]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Campus -----------------------------------------------------------------
router.get('/campus', async (req, res) => {
  try {
    if (!(await adminOnly(req, res))) return;
    const drives = (await db.query(
      `SELECT d.*, (SELECT COUNT(*)::int FROM people.campus_candidates c WHERE c.drive_id=d.id) AS candidates
         FROM people.campus_drives d WHERE d.tenant_id=$1 ORDER BY d.drive_date DESC NULLS LAST`, [T(req)])).rows;
    res.json({ drives });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/campus/drives', async (req, res) => {
  try {
    if (!(await adminOnly(req, res))) return;
    const { college, drive_date, roles } = req.body || {};
    if (!college) return res.status(400).json({ error: 'college required' });
    const r = await db.query(
      `INSERT INTO people.campus_drives (tenant_id, college, drive_date, roles) VALUES ($1,$2,$3,$4) RETURNING *`,
      [T(req), college, drive_date || null, roles || null]);
    res.json({ ok: true, drive: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/campus/drives/:driveId/candidates', async (req, res) => {
  try {
    if (!(await adminOnly(req, res))) return;
    const { name, email, phone, stage, notes } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name required' });
    const r = await db.query(
      `INSERT INTO people.campus_candidates (tenant_id, drive_id, name, email, phone, stage, notes)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,'applied'),$7) RETURNING *`,
      [T(req), req.params.driveId, name, email || null, phone || null, stage || null, notes || null]);
    res.json({ ok: true, candidate: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Appraisal queries ------------------------------------------------------
router.get('/queries', async (req, res) => {
  try {
    const admin = await hasPermission(req.user, 'people_admin');
    const r = await db.query(
      `SELECT q.*, e.name AS employee_name,
              (SELECT COUNT(*)::int FROM people.appraisal_query_messages m WHERE m.query_id=q.id) AS messages
         FROM people.appraisal_queries q JOIN core.employees e ON e.id=q.employee_id
        WHERE q.tenant_id=$1 ${admin ? '' : 'AND q.employee_id=$2'} ORDER BY q.created_at DESC`,
      admin ? [T(req)] : [T(req), req.user.id]);
    res.json({ queries: r.rows, admin });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/queries', async (req, res) => {
  try {
    const { subject, cycle_id, body } = req.body || {};
    if (!subject || !body) return res.status(400).json({ error: 'subject and body required' });
    const q = (await db.query(
      `INSERT INTO people.appraisal_queries (tenant_id, employee_id, cycle_id, subject) VALUES ($1,$2,$3,$4) RETURNING *`,
      [T(req), req.user.id, cycle_id || null, subject])).rows[0];
    await db.query(`INSERT INTO people.appraisal_query_messages (tenant_id, query_id, author_id, body) VALUES ($1,$2,$3,$4)`,
      [T(req), q.id, req.user.id, body]);
    res.json({ ok: true, query: q });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/queries/:id/reply', async (req, res) => {
  try {
    const { body, close } = req.body || {};
    const q = (await db.query(`SELECT * FROM people.appraisal_queries WHERE id=$1 AND tenant_id=$2`, [req.params.id, T(req)])).rows[0];
    if (!q) return res.status(404).json({ error: 'query not found' });
    const admin = await hasPermission(req.user, 'people_admin');
    if (!admin && q.employee_id !== req.user.id) return res.status(403).json({ error: 'Not your query' });
    if (body && body.trim()) {
      await db.query(`INSERT INTO people.appraisal_query_messages (tenant_id, query_id, author_id, body) VALUES ($1,$2,$3,$4)`,
        [T(req), q.id, req.user.id, body.trim()]);
      if (admin && q.status === 'open') await db.query(`UPDATE people.appraisal_queries SET status='answered' WHERE id=$1`, [q.id]);
      if (admin) await notify(T(req), q.employee_id, 'query_reply', `Reply on: ${q.subject}`, null, '/people/queries');
    }
    if (close) await db.query(`UPDATE people.appraisal_queries SET status='closed' WHERE id=$1`, [q.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/queries/:id/messages', async (req, res) => {
  try {
    const q = (await db.query(`SELECT * FROM people.appraisal_queries WHERE id=$1 AND tenant_id=$2`, [req.params.id, T(req)])).rows[0];
    if (!q) return res.status(404).json({ error: 'query not found' });
    const admin = await hasPermission(req.user, 'people_admin');
    if (!admin && q.employee_id !== req.user.id) return res.status(403).json({ error: 'Not your query' });
    const r = await db.query(
      `SELECT m.*, e.name AS author_name FROM people.appraisal_query_messages m
         JOIN core.employees e ON e.id=m.author_id WHERE m.query_id=$1 ORDER BY m.at`, [q.id]);
    res.json({ query: q, messages: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Career -----------------------------------------------------------------
router.get('/career/matrix', async (req, res) => {
  try {
    const r = await db.query(`SELECT role_band, level, expectations FROM people.career_matrix WHERE tenant_id=$1 ORDER BY role_band, level`, [T(req)]);
    res.json({ matrix: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/career/matrix', async (req, res) => {
  try {
    if (!(await adminOnly(req, res))) return;
    const { role_band, level, expectations } = req.body || {};
    if (!role_band || !level) return res.status(400).json({ error: 'role_band and level required' });
    await db.query(
      `INSERT INTO people.career_matrix (tenant_id, role_band, level, expectations) VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id, role_band, level) DO UPDATE SET expectations=EXCLUDED.expectations`,
      [T(req), role_band, level, expectations || null]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = { router };
