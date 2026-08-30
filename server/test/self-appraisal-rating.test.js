// node --test — Self-Appraisal overall self-rating (BR-5.3/5.4).
// Reported live with a screenshot: the rating column and cycle.rating_scale
// were already returned by GET, and PUT already accepted the field — but
// nothing on the page let an employee actually set it. This covers the
// backend side of that fix: validation against the cycle's own scale,
// reusing the same validateRating() helper Mid-Year Review uses. Real
// Postgres, real HTTP surface, skips cleanly without DATABASE_URL.
const { test, after, before } = require('node:test');
const assert = require('node:assert');

const HAS_DB = !!process.env.DATABASE_URL;
const skip = !HAS_DB && 'DATABASE_URL not set — see file header';

let db, server, base, cycleId;

before(async () => {
  if (!HAS_DB) return;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-sar';
  process.env.TENANT_SLUG = 'sar-test-' + Date.now();
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

  const emp = (await db.query(`INSERT INTO core.employees (tenant_id, name, email, status) VALUES ($1,'SAR Emp','sar-emp@x.com','active') RETURNING id`, [t.id])).rows[0];
  await db.query(`INSERT INTO core.local_credentials (tenant_id, email, password_hash) VALUES ($1,'sar-emp@x.com',$2)`, [t.id, await bcrypt.hash('pass', 10)]);

  const scale = JSON.stringify([{ value: 6, label: 'A+' }, { value: 5, label: 'A' }, { value: 4, label: 'B+' }, { value: 3, label: 'B' }, { value: 2, label: 'C' }, { value: 1, label: 'D' }]);
  const cycle = (await db.query(
    `INSERT INTO pms.cycles (tenant_id, name, fiscal_year, cycle_type, phase, rating_scale) VALUES ($1,'SAR Cycle','FYSAR','annual','self_appraisal',$2) RETURNING id`,
    [t.id, scale])).rows[0];
  cycleId = cycle.id;

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
async function api(path, token, opts = {}) {
  const r = await fetch(`${base}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
  return { status: r.status, body: await r.json() };
}

test('GET returns the cycle rating_scale, needed for the self-rating chips', { skip }, async () => {
  const { token } = await login('sar-emp@x.com');
  const r = await api('/pms/my/self-appraisal', token);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.cycle.rating_scale));
  assert.equal(r.body.cycle.rating_scale.length, 6);
});

test('PUT accepts a rating that matches the cycle scale, and it round-trips', { skip }, async () => {
  const { token } = await login('sar-emp@x.com');
  const put = await api('/pms/my/self-appraisal', token, { method: 'PUT', body: JSON.stringify({ overall_self_rating: 5 }) });
  assert.equal(put.status, 200);
  const get = await api('/pms/my/self-appraisal', token);
  assert.equal(Number(get.body.appraisal.overall_self_rating), 5);
});

test('PUT rejects a rating not on the cycle scale, instead of silently storing garbage', { skip }, async () => {
  const { token } = await login('sar-emp@x.com');
  const put = await api('/pms/my/self-appraisal', token, { method: 'PUT', body: JSON.stringify({ overall_self_rating: 3.7 }) });
  assert.equal(put.status, 422);
  assert.match(put.body.error, /rating must be one of/);
});

test('omitting overall_self_rating on an unrelated PUT leaves the existing rating untouched', { skip }, async () => {
  const { token } = await login('sar-emp@x.com');
  await api('/pms/my/self-appraisal', token, { method: 'PUT', body: JSON.stringify({ went_well: 'Shipped the launch on time.' }) });
  const get = await api('/pms/my/self-appraisal', token);
  assert.equal(Number(get.body.appraisal.overall_self_rating), 5, 'still the value set two tests ago');
  assert.equal(get.body.appraisal.went_well, 'Shipped the launch on time.');
});
