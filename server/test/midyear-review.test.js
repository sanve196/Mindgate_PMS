// node --test — Mid-Year Review dual sign-off consolidation (BR-5.1/5.2).
// Real Postgres, real HTTP surface, skips cleanly without DATABASE_URL.
const { test, after, before } = require('node:test');
const assert = require('node:assert');

const HAS_DB = !!process.env.DATABASE_URL;
const skip = !HAS_DB && 'DATABASE_URL not set — see file header';

let db, server, base, empId;

before(async () => {
  if (!HAS_DB) return;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-midyear';
  process.env.TENANT_SLUG = 'midyear-test-' + Date.now();
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

  const mgr = (await db.query(`INSERT INTO core.employees (tenant_id, name, email, status) VALUES ($1,'MY Mgr','my-mgr@x.com','active') RETURNING id`, [t.id])).rows[0];
  const emp = (await db.query(`INSERT INTO core.employees (tenant_id, name, email, status, manager_id) VALUES ($1,'MY Emp','my-emp@x.com','active',$2) RETURNING id`, [t.id, mgr.id])).rows[0];
  const stranger = (await db.query(`INSERT INTO core.employees (tenant_id, name, email, status) VALUES ($1,'MY Stranger','my-stranger@x.com','active') RETURNING id`, [t.id])).rows[0];
  empId = emp.id;
  await db.query(`INSERT INTO core.user_roles (tenant_id, email, role) VALUES ($1,'my-mgr@x.com','manager')`, [t.id]);
  const hash = await bcrypt.hash('pass', 10);
  for (const email of ['my-mgr@x.com', 'my-emp@x.com', 'my-stranger@x.com']) {
    await db.query(`INSERT INTO core.local_credentials (tenant_id, email, password_hash) VALUES ($1,$2,$3)`, [t.id, email, hash]);
  }

  const cycle = (await db.query(`INSERT INTO pms.cycles (tenant_id, name, fiscal_year, cycle_type, phase) VALUES ($1,'MY Cycle','FYMY','midyear','manager_eval') RETURNING id`, [t.id])).rows[0];
  await db.query(`INSERT INTO pms.self_appraisals (tenant_id, cycle_id, employee_id, status, overall_self_rating, went_well) VALUES ($1,$2,$3,'submitted',4,'Great quarter')`, [t.id, cycle.id, emp.id]);
  // Manager hasn't submitted yet — status stays 'pending' by default.
  await db.query(`INSERT INTO pms.manager_evaluations (tenant_id, cycle_id, employee_id, manager_id, status) VALUES ($1,$2,$3,$4,'pending')`, [t.id, cycle.id, emp.id, mgr.id]);

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use((req, _res, next) => { req.tenantId = t.id; next(); });
  app.post('/api/v1/auth/dev-login', devLogin);
  app.use('/api/v1/pms', require('../modules/performance').router);
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
async function api(path, token) {
  const r = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: r.status, body: await r.json() };
}

test('midyear review: dual sign-off correctly shows Signed for employee, Pending for manager', { skip }, async () => {
  const { token } = await login('my-emp@x.com');
  const r = await api('/pms/my/midyear-review', token);
  assert.equal(r.status, 200);
  assert.equal(r.body.self.sign_off, 'Signed');
  assert.equal(r.body.self.overall_self_rating, '4.0');
  assert.equal(r.body.manager.sign_off, 'Pending');
});

test('midyear review: manager can view a report\'s dual status; an unrelated employee cannot', { skip }, async () => {
  const mgrAuth = await login('my-mgr@x.com');
  const strangerAuth = await login('my-stranger@x.com');

  const asManager = await api(`/pms/team/midyear-review/${empId}`, mgrAuth.token);
  assert.equal(asManager.status, 200);
  assert.equal(asManager.body.self.sign_off, 'Signed');

  const asStranger = await api(`/pms/team/midyear-review/${empId}`, strangerAuth.token);
  assert.equal(asStranger.status, 403);
});

test('midyear review: an employee with nothing started yet gets not_started/Pending, not an error', { skip }, async () => {
  const t = (await db.query(`SELECT tenant_id FROM core.employees WHERE id=$1`, [empId])).rows[0].tenant_id;
  const bcrypt = require('bcryptjs');
  const fresh = (await db.query(`INSERT INTO core.employees (tenant_id, name, email, status) VALUES ($1,'MY Fresh','my-fresh@x.com','active') RETURNING id`, [t])).rows[0];
  await db.query(`INSERT INTO core.local_credentials (tenant_id, email, password_hash) VALUES ($1,'my-fresh@x.com',$2)`, [t, await bcrypt.hash('pass', 10)]);
  const { token } = await login('my-fresh@x.com');
  const r = await api('/pms/my/midyear-review', token);
  assert.equal(r.status, 200);
  assert.equal(r.body.self.status, 'not_started');
  assert.equal(r.body.self.sign_off, 'Pending');
  assert.equal(r.body.manager.status, 'not_started');
});
