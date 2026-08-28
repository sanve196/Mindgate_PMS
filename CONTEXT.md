# Agentic PMS — READ THIS FIRST IN EVERY SESSION

Employee Performance Management System, extracted as a product from the AH
platform. Client-deliverable: dedicated instance per client, deploy-and-
transfer + AMC. Spec + extraction plan live with Nilesh (Agentic PMS
Product Specification v1.0; Extraction Plan) — ask if not provided.

## Session bootstrap
1. Read this file.
2. Skills auto-load from .claude/skills/ — trust them over improvisation:
   conventions · migrations · security-permissions · extraction-playbook ·
   secrets-and-shipping.
3. `cd server && npm test` — 9 tests must pass before and after your work.
4. Never commit node_modules/, dist/, or any secret (scan in the shipping skill).

## State (update this section every session)
- 28-Aug-2026: **Delivery Head relabeling done (BR-8.1)**. This was
  flagged in an earlier session as a naming-only fix since the feature
  itself (extra approval layer above the manager, before HR calibration)
  was already fully built under the internal name "HOD". On closer look
  this session, "HOD" turned out to appear in nearly every file in the
  codebase — but almost all of those are internal identifiers: the
  hod_eval PHASE VALUE persisted in pms.cycles.phase, the pms_hod
  PERMISSION STRING persisted in core.role_permissions, and the
  pms.hod_evaluations table/column names. Renaming any of those would
  need a real data migration for existing rows and change the API
  contract, for zero user-visible benefit — so they were deliberately
  left untouched. Only the actual DISPLAYED strings were changed to say
  "Delivery Head": App.jsx nav label, HodQueuePage.jsx's heading/column
  header/empty-state text, CalibrationPage.jsx's column header,
  utils/api.jsx's phaseLabel() (the phase stepper shown throughout the
  app), and one backend error message users can see directly
  ("Delivery Head evaluation is not open"). Verified: full backend test
  suite unaffected (no test asserted on the old exact string), clean
  frontend production build, and a live check confirming the internal
  /pms/hod/queue route and its response shape are completely unchanged.
  84/84 tests pass with DB attached.
- 28-Aug-2026: **Mid-Year 7-Parameter Pulse Check built (BRD Fig. 7b)**.
  "Employees complete a pulse check on their own experience, for their own
  reference... informational only, does not feed the Annual Review
  score." Built as a STRUCTURALLY isolated feature rather than trusting a
  runtime check: migrations/011-pulse-check.js adds pms.pulse_checks as a
  separate table from pms.parameter_scores (the Annual Review's engine,
  migration 008) — scoring a pulse check literally cannot write to
  pms.manager_evaluations because the code path never touches that table
  at all. Self-only routes: GET/PUT /pms/my/pulse-check (available only
  on an active MIDYEAR cycle via activeCycle(tenantId,'midyear'); shows
  the same 7 org-configured parameters as Annual, but a simple self-only
  average, not a weighted rating). Frontend: new PulseCheckPage.jsx (nav:
  My Performance > Pulse Check) — five-button 1-5 scoring per parameter,
  self-average shown for personal reflection. Verified with a clean
  production build. test/pulse-check.test.js: 4 integration tests, the
  critical one directly querying pms.manager_evaluations before/after
  maxing out every parameter to prove zero rows are ever created there.
  84/84 tests pass with DB attached (48/84, 36 skipped, without).
  FLAGGED, NOT YET BUILT: there is no dedicated Mid-Year Review page in
  the frontend at all (unlike Annual Review, which got a proper
  consolidated screen this session) — worth checking whether the
  project-plan items 27-30/32 marked "Completed" for Mid-Year are as real
  as they claim, same pattern as Development Plan turned out not to be.
- 28-Aug-2026: **Quarterly Connect reminders built (BR-4.4)**. No separate
  worker/cron service exists in this deploy (deploy/render.yaml only
  defines api + frontend web services), so this runs in-process: an
  interval in index.js checks once at boot and then daily, plus a manual
  HR-triggered POST /pms/connects/check-reminders as a backup/testing
  path. modules/performance/connect-reminders.js: pure isConnectDue()
  (default 90-day cadence; never-held is always due) and
  shouldRemindAgain() (default 7-day cooldown so the same person isn't
  reminded every single day) — 8 unit tests, no DB. Orchestration
  (checkAndSendConnectReminders, in modules/performance/index.js) finds
  every active employee with a manager, checks their most recent connect
  against the cadence and their most recent reminder against the
  cooldown, and notifies BOTH the employee and their manager when due.
  migrations/010-connect-reminders.js: pms.connect_reminders_log is the
  cooldown record (auditable history, not a stateful flag). Verified the
  server actually boots cleanly with the new interval and that the
  boot-time check correctly fired against this session's real,
  persistent test tenant (an employee overdue since earlier testing
  triggered a real reminder on boot). test/connect-reminders-integration.test.js:
  3 integration tests (only overdue/never-held employees are reminded,
  not a recently-connected one; running the check again immediately
  doesn't double-remind; the manager is notified too, not just the
  employee). Caught the same role-seeding + missing-credentials mistake
  as earlier sessions in my own test before trusting the first run.
  80/80 tests pass with DB attached (48/80, 32 skipped, without).
- 28-Aug-2026: **Annual Review consolidation screen built (BR-6.1)** — "the
  system must support an end-of-year review workflow that consolidates
  KRA outcomes, development plan progress, and career path status." This
  was the one clearly-defined remaining piece from the original priority
  list once Development Plan, Career Path, and the 7-parameter engine
  existed to consolidate. Deliberately a READ-ONLY aggregation over
  already-existing sources of truth, not a new one: buildAnnualReviewSummary()
  in modules/performance/index.js pulls KRA definitions joined with their
  self_appraisals/manager_evaluations entries (keyed by kra_id in those
  tables' jsonb blobs) as "KRA outcomes", development plan goals +
  average progress, career path, the 7-parameter scores + live weighted
  rating, rating history, and the Super 50 flag — all into one call.
  New GET /pms/my/annual-review (self) and GET /pms/team/annual-review/
  :employeeId (manager/HOD/HR, with the same "not your report" 403 guard
  used everywhere else). Frontend: new AnnualReviewPage.jsx (nav: My
  Performance > Annual Review) — sectioned view (KRA outcomes,
  development plan with progress bars, career path, 7-parameter grid with
  live weighted total, rating history), Super 50 badge when flagged.
  Verified with a clean production build AND a live shape-check against
  real Postgres. test/annual-review.test.js: 3 integration tests
  (consolidation pulls real data correctly from all 4 sources in one
  call; manager can view a report's summary, unrelated employee correctly
  403s; a brand-new employee with zero cycle activity gets empty-but-valid
  sections rather than an error). All 3 passed on the first run. 69/69
  tests pass with DB attached (40/69, 29 skipped, without).
- 28-Aug-2026: **Org-wide KRA overview + enter-on-behalf built (BR-1.1/1.4)**
  — found to be another gap in the same vein as Development Plan/Career
  Path: /team/kra-sheets was manager-scoped only (WHERE manager_id=
  req.user.id), and every KRA edit/submit route was hardcoded to
  req.user.id, so HR had no org-wide view and literally could not enter a
  KRA on someone else's behalf despite BR-1.4 requiring it. New
  GET /pms/kra/org-overview (HR-only, status counters + search across
  every active employee, "not_started" for anyone with zero sheet rows —
  not just missing from the list); new GET/PUT/POST
  /pms/hr/kra-sheet/:employeeId(/kras)(/submit), mirroring the self-service
  routes but parameterized by employee_id and gated pms_admin. Frontend:
  new KraOrgOverviewPage.jsx (HR Admin > KRA Overview) — counters, search,
  inline "Enter on behalf" editor per row. Verified with a clean
  production build. test/kra-org-overview.test.js: 5 integration tests
  (org-wide visibility including HR/manager's own accounts correctly
  counted, search, admin-only gate, full enter-on-behalf lifecycle,
  manager blocked from the HR-only routes). Caught my own test's missing
  role-seed mistake (forgot to give the HR test user the 'hr' role) before
  trusting the result. 66/66 pass with DB attached (40/66, 26 skipped,
  without).
- 28-Aug-2026: **Development Plan (BR-2.1/2.2/2.3) + Career Path
  (BR-3.1/3.2) built** — found to be entirely missing (Development Plan)
  or half-built (Career Path — HR-admin matrix config existed, zero
  employee-facing route) despite BOTH being marked "Completed" in the
  project plan and in this file's own earlier Phase 0 notes. A full
  codebase search for "development", "IDP", "MyGrowth" turned up nothing
  before today.
  migrations/009-development-plan.js: pms.development_plans +
  pms.development_goals, mirroring pms.kra_sheets/pms.kras deliberately
  (same draft/submitted/approved/returned lifecycle, same one-row-per-
  employee-per-cycle shape). Reuses the kra_open phase window via new
  devplan_edit/devplan_submit/devplan_decide action names in
  phase-machine.js's ALLOWS table (tested). Progress updates (BR-2.3: "at
  any point in the year") are deliberately NOT phase-gated — either the
  employee or their manager can update progress_pct on an already-approved
  plan's goal at any time.
  ALSO FOUND AND FIXED in the same migration: people.career_paths
  (migration 004) had no unique constraint on (tenant_id, employee_id),
  so an upsert for "set my career path" would have failed at runtime the
  first time anyone tried it — added the missing constraint (idempotent
  via pg_constraint check, since Postgres has no ADD CONSTRAINT IF NOT
  EXISTS). Verified via a full fresh-database migration run (0->9 clean)
  to prove this is deployable, not just patched over the one already-
  migrated test database.
  New routes: GET/PUT /pms/my/development-plan(/goals)(/submit),
  PUT .../goals/:goalId/progress, GET /pms/team/development-plans +
  POST .../decide (mirrors KRA manager approval exactly). People module:
  GET/PUT /people/career/my-path (employee sets target_role + plan;
  "guardrails" BR-3.2 enforced softly — if HR has configured any
  career_matrix role_bands, target_role must match one; unconfigured
  matrix blocks nothing), GET /people/career/team (manager visibility).
  Frontend: new MyGrowthPage.jsx (nav: My Performance > My Growth) —
  side-by-side Development Plan (goal CRUD, progress bars, submit) and
  Career Path (role-band select or free text depending on whether
  guardrails are configured, plan textarea) per BRD Fig. 5, plus a
  manager-facing "Team Development Plans" approve/return section (not in
  the BRD's Fig. 5 itself, but a plan stuck at "submitted" with no way to
  decide it would not be a usable feature). Verified with a clean
  production build and a live shape-check against real Postgres
  confirming the exact JSON the frontend expects.
  test/development-plan.test.js (2 tests: full lifecycle including the
  approved-plan-still-allows-progress-updates case, and a genuine
  unrelated-employee 403 check) + test/career-path.test.js (4 tests:
  unconfigured guardrails accept anything, configured guardrails reject
  an unlisted role, manager visibility, upsert-not-duplicate). Caught and
  fixed a test-isolation bug identical in shape to earlier ones this
  session (an unscoped subquery picked up more than one row across
  repeated runs against the shared persistent test DB) before trusting
  the result. 61/61 tests pass with DB attached (40/61, 21 skipped,
  without).
- 28-Aug-2026: **7 Organizational Parameters weighted rating engine built
  (BR-6.2/BR-6.3)** — the biggest remaining piece from the priority order.
  migrations/008-review-parameters.js: pms.review_parameters (configurable
  name/weight_pct/sort_order, seeded with the 7 BRD-named drivers — My
  Organisation Culture, My Work, My Manager, My Organisation, My Senior
  Leadership, My Career & Learning, My Team — at BRD-default weights
  summing to exactly 100) and pms.parameter_scores. New tenants get the
  defaults via ensureDefaultParameters() at boot, same pattern as
  migration 002. computeWeightedRating() in rating-rules.js is a pure,
  unit-tested (13 tests) function — incomplete scoring (not every
  parameter scored) is explicitly flagged, never silently averaged over a
  gap. New routes: GET/PUT /pms/review-parameters (HR configures, reusing
  phase-machine's weightsValid() so this is held to the exact same
  "sums to 100" rule as KRA weights), GET/PUT /pms/team/parameter-scores/
  :employeeId (manager scores each of the 7, sees a live-recalculating
  weighted total per Fig. 8b — annual cycles only, 409s on midyear).
  CRITICAL DESIGN CHOICE: the computed weighted score writes directly into
  the EXISTING, already-tested pms.manager_evaluations.overall_rating
  column once complete — the exact same column PIP, Super 50, 9-Box, and
  /publish already read. Nothing downstream needed to change to consume a
  7-parameter-derived rating instead of a manager-typed one.
  Also added a guard: PUT /team/evaluations/:employeeId now 409s if a
  caller tries to set overall_rating directly on an annual cycle (must go
  through parameter-scores instead) — otherwise the whole weighting
  requirement would just be a UI suggestion nobody has to follow. Mid-Year's
  separate BR-5.4 self+manager rating is completely unaffected (guard is
  annual-only).
  THIS GUARD BROKE two previously-passing tests (pip.test.js, super50.test.js
  — both directly PUT overall_rating on annual cycles). Fixed properly, not
  papered over: both now use a scoreAllParamsTo() helper (scoring every
  parameter identically makes the weighted average exactly equal that
  value regardless of individual weights, since weights sum to 100) —
  correctly exercises the real, intended production path instead of the
  now-disallowed shortcut.
  Frontend: TeamEvalPage.jsx's plain rating <select> is now conditional —
  annual cycles get a new ParameterScoring component (grid of the 7
  parameters, 1-5 each, live weighted total, "N not yet scored" state);
  midyear cycles keep the original select unchanged. CycleAdminPage.jsx
  gained a ReviewParametersConfig section for HR (add/remove/reweight
  parameters, Save disabled until the total is exactly 100). Both verified
  with clean production builds. 55/55 backend tests pass with DB attached
  (40/55, 15 skipped, without).
- 28-Aug-2026: **9-Box Grid view built (BR-6.4)**. pms.top_talent already
  captured nine_box_cell per employee (entered via the existing
  Calibration screen) but there was no aggregated VIEW of it anywhere —
  only per-row entry. New GET /pms/nine-box?level=org|department|manager
  aggregates the current cycle's top_talent rows into named groups, each
  with counts and the actual people per cell (not just counts — HR needs
  to see who, not just how many). Access: HR or Delivery Head (pms_admin
  OR pms_hod) — wider than /watchlist's HR-only, matching BR-6.4's stated
  audience specifically. Frontend: NineBoxPage.jsx (HR Admin > 9-Box Grid)
  with a level toggle rendering an actual 3x3 grid per group. Verified via
  test/nine-box.test.js (5 tests: org/department/manager grouping, HOD can
  view, plain manager cannot, invalid level falls back to org rather than
  erroring). 44/44 pass with DB attached (34/44, 10 skipped, without).
- 28-Aug-2026: **Retention Alerts built (BR-6.6)** + **notification bell added
  to the frontend shell** (a cross-cutting gap found while building this:
  GET/POST /notifications had existed since Phase 0 with zero frontend
  surface — every notification created so far, PIP-opened, Super50-flagged,
  rating-published, was invisible to users until now).
  alertHrOfRetentionRisk() in modules/performance/index.js fans out an
  in-app notification to every employee holding the hr or admin role in
  the tenant (core.user_roles), the instant someone is newly Super50-
  flagged inside /publish — best-effort (a failed notify() for one HR user
  doesn't roll back the publish). Verified live + via super50.test.js
  (extended to assert exactly one retention_alert notification with the
  right employee name in the title lands on the HR user). Caught and fixed
  a real bug in my OWN test while doing this: the assertion query wasn't
  tenant-scoped, so a stale employee row with the same test email from an
  earlier run in this persistent test DB caused a false failure (count=2
  instead of 1) — fixed by scoping the query to the test's own tenant_id.
  frontend/src/pages/NotificationBell.jsx: polling dropdown (60s interval —
  no push channel exists), unread badge, click-to-mark-read, wired into
  App.jsx's header on both breakpoints. Verified with a clean production
  build. 39/39 backend tests pass with DB attached.
- 28-Aug-2026: **Super 50 / High-Performer Watchlist built (BR-6.5)**.
  migrations/007-super50.js adds core.employees.super50_flag/super50_since
  (persisted, alongside the existing potential_rating/nine_box_cell
  write-back columns, not computed fresh on read). Pure eligibility rule
  in modules/performance/rating-rules.js — isSuper50Eligible() — unit
  tested with no DB (7 tests). Recomputed at /publish for annual cycles
  only (midyear publishes don't touch it): flags true only on the 3rd
  consecutive top-tier (4=A or 5=A+) rating where the MOST RECENT one is
  specifically 5=A+; unflags automatically the moment the streak breaks
  (this is "currently on the watchlist", not a permanent badge). New
  GET /pms/watchlist (HR/Management only, matches BRD Owner column) feeds
  Retention Alerts (BR-6.6, next). Frontend: WatchlistPage.jsx (HR Admin >
  Super 50). Verified live across 4 real published cycles (2 top-tier ->
  not yet flagged -> 3rd cycle A+ -> flagged -> low rating -> unflagged);
  test/super50.test.js codifies this + the "most recent must be A+ not
  just A" edge case. 39/39 pass with DB attached (34/39, 5 skipped,
  without).
- 28-Aug-2026: **PIP module built (BR-7.1 auto-trigger + BR-7.2 weekly
  tracking through to closure)**. pms.pip_records existed since migration
  003 but had zero routes — nothing had ever written to it. Added:
  migration 006 (pip_threshold column on pms.cycles, pms.pip_weekly_entries
  table, unique index for idempotency, closed_reason column); auto-trigger
  wired into POST /publish (opens a PIP when final_rating < cycle's
  pip_threshold, ON CONFLICT DO NOTHING so re-publish never duplicates);
  full CRUD (GET /pip, GET /pip/:id, PUT /pip/:id, POST /pip/:id/entries)
  with employee=read-only-own, manager-of/HR=read+write, closing requires
  a closed_reason, closed PIPs reject further entries. Frontend: new
  PIPPage.jsx (nav: Team > Improvement Plans), wired into App.jsx.
  RATING-SCALE MAPPING DECISION (documented in migrations/006-pip.js):
  the BRD/plan describe the threshold in letter grades ("below B+") but
  the actual schema is numeric 1-5 with English labels — there is no
  letter-grade column anywhere. Used a configurable numeric threshold
  (default 3.0, i.e. below "Meets Expectations") as the closest reading;
  this is a judgment call to confirm with client HR during UAT, same as
  the plan itself flags. Same mapping question will recur for Super 50's
  "3 consecutive A/A+" — worth deciding once, consistently, when that's
  built next.
  test/pip.test.js: full lifecycle integration test (real Postgres, skips
  cleanly without DATABASE_URL) — auto-trigger, permission split, mandatory
  closure reason, post-closure lock, idempotent re-publish. 30/30 pass
  with DB attached (27/30, 3 skipped, without).
- 28-Aug-2026: **Ran against a real Postgres for the first time** (previously
  only ever tested against in-memory/no-DB unit tests). Migrations 001-005
  all run clean start-to-finish on Postgres 16. Found and fixed two real
  bugs only a real DB surfaces: (1) POST /pms/connects inserted kra_ids with
  an untyped NULL vs '{}' COALESCE, erroring "uuid[] vs text" on every call
  — BR-4.1 (Quarterly Connect logging) had never actually been exercised
  end-to-end despite being marked Completed. Fixed with explicit ::uuid[]
  casts. (2) New tenants created after migration 002 (i.e. every normal
  boot of a fresh deploy, since the tenant is created AFTER migrations run)
  got ZERO role_permissions rows — every route 403'd. Fixed: ensureTenantSeeds()
  now runs at boot right after tenant resolution, idempotent. This was a
  deploy-blocking bug that would have hit Bucket 2 (Deployment & Environment
  Setup) directly. test/consent.test.js integration-tests both fixes'
  surrounding behaviour live against Postgres (skips cleanly without
  DATABASE_URL so plain `npm test` still needs no DB).
- 28-Aug-2026: BR-1.1 bulk Excel upload — core/employees.js now accepts
  .xlsx (via exceljs; NOT the `xlsx`/SheetJS package, which has two
  unpatched high-severity advisories) alongside the existing CSV path, both
  funnelled into one validateEmployeeRows() so behaviour is identical.
  Legacy .xls is explicitly rejected with a clear message (that format
  needs a different parser entirely; no safe npm option currently exists).
  tools/sample-employees.xlsx added. 6 new tests (employees.test.js: 9→15).
- 28-Aug-2026: Employee consent capture (BRD §6 NFR) — core/consent.js.
  New core.employee_consents table (migration 005); hasConsent()/
  requireConsent() are the gate ANY meeting-recording/transcription/
  calendar-pull feature must call. Only the employee themself can grant/
  revoke their own consent (pms_self) — managers/HR get view-only. Wired
  into the one concrete point that exists today: POST /pms/connects
  meeting_based=true 403s without consent. No calendar/meeting-tool
  integration exists yet to consume this (that's still a separate, unbuilt
  item) — this lays the gate down ready for it. Verified end-to-end
  live against Postgres: grant → allowed, revoke → blocked again, audit_log
  captures both, manager view-only confirmed (no route exists for a manager
  to set it).
- Delivery Head (BR-8.1) — CORRECTION: this already exists, under the name
  "HOD" (pms.hod_evaluations, /pms/hod/queue, HodQueuePage.jsx). Functionally
  complete (routes to HOD before HR calibration/publish). Only a naming/
  relabelling task remains to align with BRD terminology, not a build task.
- Phase 0 (People Core): SCAFFOLDED 27-Aug-2026 — runner, schema 001,
  auth (JWT + dev-login), permissions (parity gate), employees mirror +
  validated CSV import (9/9 tests), seed 002, deploy files, frontend shell.
- Phase 0 COMPLETE in code 27-Aug: mail (send-mode, provider slots),
  notifications API. Storage iface deferred to first upload need (evidence).
  STILL PENDING: run against a real Postgres (exit test in plan §3).
- FRONTEND (product pages) 27-Aug: Tailwind + react-router + lucide added;
  App shell with grouped nav (My Performance / Team / HR Admin / Engagement
  & People) matching AH design language (stone/amber/slate). Pages: MyKRAs
  (weights chip, submit gated at 100, returned-with-comment banner),
  SelfAppraisal (per-KRA narratives, 1.2s auto-save badge, submit locks),
  MyRating, TeamEval (self-appraisal panel, rating select from cycle scale,
  "Draft the writing" agent button -> DRAFT card -> copy-into-fields,
  auto-save), HodQueue, CycleAdmin (phase strip, advance/rollback, publish
  w/ failure alert, cycle-health agent card), Calibration (distribution vs
  targets, adjust-with-required-reason prompt, 9-box select, session-brief
  agent), Engagement (invitations, take-flow with anonymity notice +
  opt-in checkbox, results w/ eNPS, theme-verbatims agent; prompt-based
  builder is INTERIM — real survey-builder screen still owed), PeopleHub
  (events RSVP, awards nominate, CSR, query threads), Directory (CSV
  import UI). Build clean. NOT YET: real survey/cycle builder screens
  (prompt()-based interim), evidence upload, connects UI, career UI,
  letter PDF, mobile pass, e2e against live server.
- Phase 3 DONE (backend) 27-Aug: core/ai.js — ONE narration entry point
  (Anthropic API via fetch, AI_MODEL env, 503 when no key so everything else
  works), parseAiJson + stripRatingSuggestions PURE+tested (no rating-shaped
  key survives any draft, second line of defence after the prompts), every
  draft stored in agentic.drafts with its deterministic input verbatim.
  modules/agentic: the five §5A features — appraisal-draft (manager-scoped,
  ignores self-RATINGS uses narratives), calibration-brief (distribution vs
  bell curve by dept), engagement-themes (verbatims only, anonymity by
  construction, one short quote max per theme), letter-draft (exact
  rating/label, template adds branding), cycle-health (coverage per stage +
  chase list). GET /agentic/drafts lists provenance. NOT YET: real API call
  ever made (no key in sandbox), frontend surfaces for drafts.
- Phase 2 STARTED 27-Aug: migration 004 (engagement + people schemas —
  anonymity STRUCTURAL: invitations/responses separate, employee_id on a
  response only via tested shouldAttribute()); engagement router (survey
  CRUD+questions, open builds invitations+notifies, take-flow with required-
  question check, results with eNPS + verbatims with no identity in reach);
  people router (awards programs/cycles/nominations+decide, events+RSVP,
  CSR+participation, campus drives/candidates, appraisal queries+threads,
  career matrix). 18/18 tests. NOT YET: engagement frontend, survey builder
  screen, people frontend, midyear, evidence upload, agentic module.
- Phase 1 STARTED 27-Aug: migration 003 (full pms schema), phase machine
  (pure, 5 tests), performance router: cycles+phase transitions/rollback,
  KRA sheets (edit/submit/approve-return, weight=100), self-appraisal,
  manager eval, HOD queue, calibration (distribution vs bell curve,
  adjustments with mandatory reason, top-talent/9-box), publish (history +
  rating mirror + letter records + notify, per-row failures), my-rating,
  connects. NOT YET: evidence upload, PIP routes, career framework, midyear
  specifics, closure-letter PDF, frontend pages (lift in P1 continuation),
  behavioural parity pass against AH source route-by-route.
- Phases 1-4: see Extraction Plan. Source repo for lifting:
  nileshsatpute82/agentic-humans-platform (route-prefix lifting only).

## Hard rules (details in skills)
tenant_id everywhere · modules never import each other's internals · boot
fails on migration error · per-row errors on batch ops · deterministic
numbers, AI narrates · employee master is a CSV-synced mirror · no dummy data
· no secrets in repo · no AH git history ever.
