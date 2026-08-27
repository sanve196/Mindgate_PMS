// 002 — default permission bundles per tenant. Seeded for every tenant row
// present at migration time; new tenants get them via ensureTenantSeeds()
// (future) or a re-run of the seed values. Data, not code: clients edit.
const BUNDLES = {
  employee: ['pms_self', 'engagement_take', 'people_view'],
  manager:  ['pms_self', 'pms_team_eval', 'engagement_take', 'people_view'],
  hod:      ['pms_self', 'pms_team_eval', 'pms_hod', 'engagement_take', 'people_view'],
  hr:       ['pms_self', 'pms_admin', 'pms_team_eval', 'pms_hod', 'engagement_admin', 'engagement_take', 'people_admin', 'people_view', 'letters_admin'],
  admin:    ['*'],
};
module.exports.up = async (db) => {
  const tenants = (await db.query(`SELECT id FROM core.tenants`)).rows;
  for (const t of tenants) {
    for (const [role, perms] of Object.entries(BUNDLES)) {
      for (const p of perms) {
        await db.query(
          `INSERT INTO core.role_permissions (tenant_id, role, permission)
           VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [t.id, role, p]);
      }
    }
  }
};
module.exports.BUNDLES = BUNDLES;
