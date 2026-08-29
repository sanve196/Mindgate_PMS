// node --test — Manager sign-off on Quarterly Connect (BR-4.3), found
// missing during a full BRD re-audit. Real Postgres, skips cleanly
// without DATABASE_URL.
const { test, after, before } = require('node:test');
const assert = require('node:assert');

const HAS_DB = !!process.env.DATABASE_URL;
const skip = !HAS_DB && 'DATABASE_URL not set — see file header';

let db, server, base, empId;

before(async () => {
  if (!HAS_DB) return;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-signoff';
  process.env.TENANT_SLUG = 'signoff-test-' + Date.now();
  process.env.AUTH_DEV = 'true';
  db = require('../core/db');
  const bcrypt = require('bcryptjs');
  const express = require('express');
  const cors = require('cors');
  const { runMigrations } = require('../core/migrate');
  const { devLogin } = require('../core/auth');
  await runMigrations();

  const t = (await db.query(`INSERT INTO core.tenants (name, slug) VALUES ($1,$1) RETURNING id`, [process.env.TENANT_SLUG])).rows[0];
  await require('../migrations/002-default-permission-bundles').ensureTenantSeeds(db, t.id);

  const mgr = (await db.query(`INSERT INTO core.employees (tenant_id, name, email, status) VALUES ($1,'SO Mgr','so-mgr@x.com','active') RETURNING id`, [t.id])).rows[0];
  const emp = (await db.query(`INSERT INTO core.employees (tenant_id, name, email, status, manager_id) VALUES ($1,'SO Emp','so-emp@x.com','active',$2) RETURNING id`, [t.id, mgr.id])).rows[0];
  const stranger = (await db.query(`INSERT INTO core.employees (tenant_id, name, email, status) VALUES ($1,'SO Stranger','so-stranger@x.com','active') RETURNING id`, [t.id])).rows[0];
  empId = emp.id;
  await db.query(`INSERT INTO core.user_roles (tenant_id, email, role) VALUES ($1,'so-mgr@x.com','manager')`, [t.id]);
  const hash = await bcrypt.hash('pass', 10);
  for (const email of ['so-mgr@x.com', 'so-emp@x.com', 'so-stranger@x.com']) {
    await db.query(`INSERT INTO core.local_credentials (tenant_id, email, password_hash) VALUES ($1,$2,$3)`, [t.id, email, hash]);
  }

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use((req, _res, next) => { req.tenantId = t.id; next(); });
  app.post('/api/v1/auth/dev-login', devLogin);
  app.use('/api/v1/pms', require('../modules/performance').router);
  app.use('/api/v1/notifications', require('../core/notifications').router);
  server = app.listen(0);
  base = `http://localhost:${server.address().port}/api/v1`;
});

after(async () => {
  if (!HAS_DB) return;
  server.close();
  await db.pool.end();
});

async function login(email) {
  const r = await fetch(`${base}/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'pass' }) });
  return r.json();
}
async function api(path, token, opts = {}) {
  const r = await fetch(`${base}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
  return { status: r.status, body: await r.json() };
}

test('connect sign-off: a logged connect starts unsigned, manager can sign it off, employee is notified', { skip }, async () => {
  const mgrAuth = await login('so-mgr@x.com');
  const empAuth = await login('so-emp@x.com');

  const created = await api('/pms/connects', mgrAuth.token, { method: 'POST', body: JSON.stringify({ employee_id: empId, held_at: '2026-09-01', notes: 'good chat' }) });
  assert.equal(created.status, 200);

  const list = await api('/pms/connects', mgrAuth.token);
  const cn = list.body.connects[0];
  assert.equal(cn.signed_off, false, 'not signed off at creation');

  const signOff = await api(`/pms/connects/${cn.id}/sign-off`, mgrAuth.token, { method: 'POST' });
  assert.equal(signOff.status, 200);

  const list2 = await api('/pms/connects', mgrAuth.token);
  assert.equal(list2.body.connects[0].signed_off, true);
  assert.ok(list2.body.connects[0].signed_off_at);

  const empNotifs = await api('/notifications', empAuth.token);
  assert.ok(empNotifs.body.notifications.some((n) => n.kind === 'connect_signed_off'));
});

test('connect sign-off: cannot sign off twice, and an unrelated manager cannot sign someone else\'s connect', { skip }, async () => {
  const mgrAuth = await login('so-mgr@x.com');
  const strangerAuth = await login('so-stranger@x.com');
  const list = await api('/pms/connects', mgrAuth.token);
  const cn = list.body.connects[0];

  const again = await api(`/pms/connects/${cn.id}/sign-off`, mgrAuth.token, { method: 'POST' });
  assert.equal(again.status, 409);

  const created2 = await api('/pms/connects', mgrAuth.token, { method: 'POST', body: JSON.stringify({ employee_id: empId, held_at: '2026-10-01', notes: 'another chat' }) });
  const list2 = await api('/pms/connects', mgrAuth.token);
  const newCn = list2.body.connects.find((c) => c.notes === 'another chat');
  const wrongUser = await api(`/pms/connects/${newCn.id}/sign-off`, strangerAuth.token, { method: 'POST' });
  assert.equal(wrongUser.status, 403);
});

// Requested with a reference screenshot: Date/Duration/Topic/"What was
// discussed?" as their own fields, separate from the derived Achievements/
// Blockers/Feedback (migration 017).
test('connect: duration, topic, and discussion notes round-trip through create and list', { skip }, async () => {
  const mgrAuth = await login('so-mgr@x.com');
  const created = await api('/pms/connects', mgrAuth.token, {
    method: 'POST',
    body: JSON.stringify({
      employee_id: empId, held_at: '2026-11-01', duration_min: 30, topic: 'Mid-quarter check-in',
      discussion_notes: 'Discussed the Q3 launch timeline and blockers with legal.',
      achievements: 'Shipped the beta', blockers: 'Waiting on legal sign-off', feedback: 'Keep pushing on the timeline',
    }),
  });
  assert.equal(created.status, 200);

  const list = await api('/pms/connects', mgrAuth.token);
  const cn = list.body.connects.find((c) => c.topic === 'Mid-quarter check-in');
  assert.ok(cn, 'the new connect should be in the list');
  assert.equal(cn.duration_min, 30);
  assert.equal(cn.discussion_notes, 'Discussed the Q3 launch timeline and blockers with legal.');
  assert.equal(cn.achievements, 'Shipped the beta');
  assert.equal(cn.blockers, 'Waiting on legal sign-off');
  assert.equal(cn.feedback, 'Keep pushing on the timeline');
});
