// Cycle phase machine — PURE logic, no db, so it is unit-tested directly.
// Faithful to the AH production machine (spec §3.1): forward transitions in
// order, rollback one step (HR-controlled, audited by the caller), cancel
// from any non-closed phase. Downstream gates use phaseAllows().

const ORDER = ['draft', 'kra_open', 'self_appraisal', 'manager_eval', 'hod_eval', 'calibration', 'publish', 'closed'];

function canAdvance(from, to) {
  const i = ORDER.indexOf(from), j = ORDER.indexOf(to);
  if (i === -1 || j === -1) return { ok: false, reason: `unknown phase` };
  if (from === 'closed') return { ok: false, reason: 'cycle is closed' };
  if (j !== i + 1) return { ok: false, reason: `can only advance ${from} → ${ORDER[i + 1]}` };
  return { ok: true };
}

function canRollback(from, to) {
  const i = ORDER.indexOf(from), j = ORDER.indexOf(to);
  if (i === -1 || j === -1) return { ok: false, reason: 'unknown phase' };
  if (from === 'closed') return { ok: false, reason: 'closed cycles cannot roll back' };
  if (j !== i - 1) return { ok: false, reason: `can only roll back ${from} → ${ORDER[i - 1] || '(nothing)'}` };
  return { ok: true };
}

function canCancel(from) {
  return from === 'closed' ? { ok: false, reason: 'closed cycles cannot be cancelled' } : { ok: true };
}

// What each phase permits (gates for downstream endpoints). Development
// Plans reuse the kra_open window — same employee-authors/manager-approves
// shape as KRAs, opened at the same point in the cycle per the BRD's
// process flow (BR-2.1-2.3 alongside KRA setting), so no new phase is
// needed, just new action names within the existing one.
const ALLOWS = {
  kra_open:       ['kra_edit', 'kra_submit', 'kra_decide', 'devplan_edit', 'devplan_submit', 'devplan_decide'],
  self_appraisal: ['self_edit', 'self_submit'],
  manager_eval:   ['manager_edit', 'manager_submit'],
  hod_eval:       ['hod_edit', 'hod_submit'],
  calibration:    ['calibrate', 'adjust', 'top_talent'],
  publish:        ['publish'],
};
function phaseAllows(phase, action) {
  return (ALLOWS[phase] || []).includes(action);
}

// KRA weight rule: total must be exactly 100 to submit (tolerance for
// numeric drift: 0.01).
function weightsValid(kras) {
  const total = kras.reduce((s, k) => s + Number(k.weight || 0), 0);
  return { ok: Math.abs(total - 100) < 0.01, total: +total.toFixed(2) };
}

module.exports = { ORDER, canAdvance, canRollback, canCancel, phaseAllows, weightsValid };
