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
