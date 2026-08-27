const { test } = require('node:test');
const assert = require('node:assert');
const pm = require('../modules/performance/phase-machine');

test('forward transitions in order only', () => {
  assert.equal(pm.canAdvance('draft', 'kra_open').ok, true);
  assert.equal(pm.canAdvance('kra_open', 'self_appraisal').ok, true);
  assert.equal(pm.canAdvance('draft', 'calibration').ok, false);
  assert.equal(pm.canAdvance('publish', 'closed').ok, true);
  assert.equal(pm.canAdvance('closed', 'draft').ok, false);
});

test('rollback exactly one step, never from closed', () => {
  assert.equal(pm.canRollback('calibration', 'hod_eval').ok, true);
  assert.equal(pm.canRollback('calibration', 'manager_eval').ok, false);
  assert.equal(pm.canRollback('closed', 'publish').ok, false);
});

test('cancel from any phase except closed', () => {
  assert.equal(pm.canCancel('draft').ok, true);
  assert.equal(pm.canCancel('calibration').ok, true);
  assert.equal(pm.canCancel('closed').ok, false);
});

test('phase gates', () => {
  assert.equal(pm.phaseAllows('kra_open', 'kra_edit'), true);
  assert.equal(pm.phaseAllows('self_appraisal', 'kra_edit'), false);
  assert.equal(pm.phaseAllows('calibration', 'adjust'), true);
  assert.equal(pm.phaseAllows('publish', 'publish'), true);
});

test('weights: exactly 100 with tolerance', () => {
  assert.equal(pm.weightsValid([{ weight: 40 }, { weight: 60 }]).ok, true);
  assert.equal(pm.weightsValid([{ weight: 33.33 }, { weight: 33.33 }, { weight: 33.34 }]).ok, true);
  assert.equal(pm.weightsValid([{ weight: 50 }, { weight: 40 }]).ok, false);
  assert.equal(pm.weightsValid([]).ok, false);
});
