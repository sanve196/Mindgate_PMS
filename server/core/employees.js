// Employee mirror + bulk import (CSV and Excel) — People Core.
//
// The employee master is IMPORTED from the client's HRMS, never maintained
// here. Correctness of the manager chain and departments is a stated
// implementation prerequisite (it routes the entire appraisal workflow), so
// the importer VALIDATES and reports per-row reasons — the no-silent-failure
// rule. Nothing loads unless the file is coherent; dry-run is the default.
//
// Accepted formats: .csv, .xlsx, .xls (BR-1.1 — "a bulk Excel upload option
// must be made available"). Both formats resolve to the same row shape and
// share one validator, so behaviour (required columns, manager-chain checks,
// date parsing, dry-run default) is identical regardless of file type.
//
// Columns (header row, case-insensitive, order-free):
//   emp_code, name, email, department, designation, role_band,
//   manager_email, date_of_joining (flexible formats), status
//
// validateEmployeeRows() is a PURE function — no db — so it is unit-tested
// directly and reused by the standalone tool in /tools.

const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const db = require('./db');
const logger = require('./logger');
const { authenticate } = require('./auth');
const { apiPermissionParity, hasPermission } = require('./permissions');

// ---------- CSV parsing (self-contained; handles quotes and commas) --------
function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur.replace(/\r$/, '')); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

// Flexible date → yyyy-mm-dd or null (subset of the proven AH parser:
// ISO first, dd-mm-yyyy with swap, "26 Aug 2026", ordinals, rollover rejected).
const MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
function flexDate(v) {
  if (v == null || String(v).trim() === '') return null;
  const iso = (y, mo, d) => {
    const dt = new Date(Date.UTC(y, mo, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo || dt.getUTCDate() !== d) return null;
    return dt.toISOString().slice(0, 10);
  };
  const s = String(v).trim().replace(/(\d)(st|nd|rd|th)\b/gi, '$1');
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return iso(+m[1], +m[2] - 1, +m[3]);
  if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/))) {
    let [, d, mo, y] = m; d = +d; mo = +mo; y = +y; if (y < 100) y += 2000;
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    return iso(y, mo - 1, d);
  }
  if ((m = s.match(/^(\d{1,2})[\-\s]+([A-Za-z]{3,})[\-\s,]+(\d{2,4})$/))) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo != null) { let y = +m[3]; if (y < 100) y += 2000; return iso(y, mo, +m[1]); }
  }
  const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// ---------- Validation (pure) ----------------------------------------------
const REQUIRED = ['name', 'email'];
const KNOWN = ['emp_code','name','email','department','designation','role_band','manager_email','date_of_joining','status'];

// ---------- Excel (.xlsx/.xls) parsing — same array-of-rows shape as parseCsv
// so both formats feed the one validator below. Dates come back as either a
// real Date (Excel serial dates) or text; both are normalised to strings
// here so flexDate() in the shared validator handles them identically to a
// CSV cell, with no format-specific branching downstream.
async function parseExcelBuffer(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells = [];
    // row.cellCount reflects the last populated column; iterate by number so
    // gaps (skipped cells) still line up with the header's column positions.
    for (let c = 1; c <= row.cellCount; c++) {
      const cell = row.getCell(c);
      let v = cell.value;
      if (v == null) v = '';
      else if (v instanceof Date) v = v.toISOString().slice(0, 10); // -> yyyy-mm-dd, flexDate handles it
      else if (typeof v === 'object' && 'text' in v) v = v.text; // rich text
      else if (typeof v === 'object' && 'result' in v) v = v.result; // formula cell
      else v = String(v);
      cells.push(v);
    }
    if (cells.some((c) => String(c).trim() !== '')) rows.push(cells);
  });
  return rows;
}

function validateEmployeeRows(rows) {
  if (!rows.length) return { ok: false, fatal: 'Empty file', rows: [], errors: [], warnings: [] };
  const header = rows[0].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const missing = REQUIRED.filter(c => !header.includes(c));
  if (missing.length) return { ok: false, fatal: `Missing required column(s): ${missing.join(', ')}`, rows: [], errors: [], warnings: [] };
  const unknown = header.filter(h => !KNOWN.includes(h));

  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const out = []; const errors = []; const warnings = [];
  const seenEmails = new Map();

  rows.slice(1).forEach((r, n) => {
    const line = n + 2; // 1-based + header
    const get = (c) => (idx[c] != null ? (r[idx[c]] || '').trim() : '');
    const rec = {
      line,
      emp_code: get('emp_code') || null,
      name: get('name'),
      email: get('email').toLowerCase(),
      department: get('department') || null,
      designation: get('designation') || null,
      role_band: get('role_band') || null,
      manager_email: (get('manager_email') || '').toLowerCase() || null,
      date_of_joining_raw: get('date_of_joining') || null,
      date_of_joining: flexDate(get('date_of_joining')),
      status: (get('status') || 'active').toLowerCase(),
    };
    if (!rec.name) errors.push({ line, error: 'name is empty' });
    if (!rec.email) errors.push({ line, error: 'email is empty' });
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rec.email)) errors.push({ line, error: `invalid email "${rec.email}"` });
    else if (seenEmails.has(rec.email)) errors.push({ line, error: `duplicate email "${rec.email}" (first at line ${seenEmails.get(rec.email)})` });
    else seenEmails.set(rec.email, line);
    if (rec.date_of_joining_raw && !rec.date_of_joining) warnings.push({ line, warning: `unparseable date_of_joining "${rec.date_of_joining_raw}" — will be stored empty` });
    if (!['active', 'inactive'].includes(rec.status)) { warnings.push({ line, warning: `status "${rec.status}" not active|inactive — treated as active` }); rec.status = 'active'; }
    out.push(rec);
  });

  // Manager references + chain cycles (the routing prerequisite).
  const byEmail = new Map(out.map(r => [r.email, r]));
  for (const r of out) {
    if (!r.manager_email) continue;
    if (r.manager_email === r.email) { errors.push({ line: r.line, error: 'employee is their own manager' }); continue; }
    if (!byEmail.has(r.manager_email)) errors.push({ line: r.line, error: `manager_email "${r.manager_email}" not present in this file` });
  }
  // Cycle detection over manager edges.
  const state = new Map(); // email -> 0 visiting, 1 done
  for (const r of out) {
    if (state.get(r.email) === 1) continue;
    const path = [];
    let cur = r;
    while (cur) {
      if (state.get(cur.email) === 1) break;
      if (state.get(cur.email) === 0) {
        const cycle = path.slice(path.indexOf(cur.email)).concat(cur.email);
        errors.push({ line: cur.line, error: `manager chain cycle: ${cycle.join(' → ')}` });
        break;
      }
      state.set(cur.email, 0); path.push(cur.email);
      cur = cur.manager_email ? byEmail.get(cur.manager_email) : null;
    }
    for (const e of path) state.set(e, 1);
  }

  const noManager = out.filter(r => !r.manager_email).length;
  if (noManager > 1) warnings.push({ line: 0, warning: `${noManager} employees have no manager (expected ~1 top of org) — verify` });
  if (unknown.length) warnings.push({ line: 1, warning: `ignored unknown column(s): ${unknown.join(', ')}` });

  return { ok: errors.length === 0, fatal: null, rows: out, errors, warnings,
    summary: { total: out.length, errors: errors.length, warnings: warnings.length, departments: new Set(out.map(r => r.department).filter(Boolean)).size } };
}

// Format-specific entry points — both funnel into validateEmployeeRows so
// CSV and Excel get identical validation, identical error messages, and
// identical dry-run behaviour. Existing callers/tests keep using
// validateEmployeeCsv(text) unchanged.
function validateEmployeeCsv(text) {
  return validateEmployeeRows(parseCsv(text));
}
async function validateEmployeeXlsx(buffer) {
  let rows;
  try { rows = await parseExcelBuffer(buffer); }
  catch (e) { return { ok: false, fatal: `Could not read Excel file: ${e.message}`, rows: [], errors: [], warnings: [] }; }
  return validateEmployeeRows(rows);
}

// Sniff format from filename/mimetype rather than trusting one signal alone
// (some browsers send a generic octet-stream mimetype for .xlsx).
//
// NOTE on legacy .xls: that extension is the old pre-2007 binary format, not
// a variant of .xlsx — it needs a different parser entirely. The only
// actively-maintained npm option for it (`xlsx`/SheetJS) currently ships two
// unpatched high-severity advisories (prototype pollution, ReDoS) with no
// fix available, so it is deliberately not used here (see package.json —
// exceljs only). A real, uploaded .xls is therefore detected and rejected
// with a clear message rather than mis-parsed or silently mishandled.
function detectFormat(file) {
  const name = (file.originalname || '').toLowerCase();
  if (name.endsWith('.csv')) return 'csv';
  if (name.endsWith('.xlsx')) return 'xlsx';
  if (name.endsWith('.xls')) return 'xls-legacy';
  if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx';
  if (file.mimetype === 'application/vnd.ms-excel') return 'xls-legacy';
  return 'csv'; // default: treat unrecognised uploads as CSV text, as before
}

// ---------- Load (transactional, two-pass for manager links) ---------------
async function loadEmployees(tenantId, rows) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    // Pass 1: upsert people without manager links.
    for (const r of rows) {
      await client.query(
        `INSERT INTO core.employees (tenant_id, emp_code, name, email, department, designation, role_band, date_of_joining, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (tenant_id, email) DO UPDATE SET
           emp_code=EXCLUDED.emp_code, name=EXCLUDED.name, department=EXCLUDED.department,
           designation=EXCLUDED.designation, role_band=EXCLUDED.role_band,
           date_of_joining=EXCLUDED.date_of_joining, status=EXCLUDED.status, updated_at=now()`,
        [tenantId, r.emp_code, r.name, r.email, r.department, r.designation, r.role_band, r.date_of_joining, r.status]);
    }
    // Pass 2: manager links by email.
    for (const r of rows) {
      await client.query(
        `UPDATE core.employees e SET manager_id = m.id, updated_at = now()
           FROM core.employees m
          WHERE e.tenant_id=$1 AND LOWER(e.email)=LOWER($2)
            AND m.tenant_id=$1 AND LOWER(m.email)=LOWER($3)`,
        [tenantId, r.email, r.manager_email || '']);
      if (!r.manager_email) {
        await client.query(`UPDATE core.employees SET manager_id=NULL, updated_at=now() WHERE tenant_id=$1 AND LOWER(email)=LOWER($2)`, [tenantId, r.email]);
      }
    }
    // Pass 3 (BR-1.5 — "KRA information should automatically update
    // whenever there is a change in the HRMS, such as an employee
    // changing their manager..."): propagate a manager change to any
    // still-open cycle's KRA sheet and development plan. Only OPEN
    // cycles (phase not closed/cancelled) are touched — a closed cycle's
    // sheet keeps the manager who actually reviewed it at the time, for
    // audit accuracy; that's history, not something a later reassignment
    // should silently rewrite.
    for (const r of rows) {
      await client.query(
        `UPDATE pms.kra_sheets ks SET manager_id = e.manager_id, updated_at = now()
           FROM core.employees e, pms.cycles c
          WHERE ks.employee_id = e.id AND ks.cycle_id = c.id
            AND e.tenant_id=$1 AND LOWER(e.email)=LOWER($2)
            AND c.phase NOT IN ('closed','cancelled')
            AND ks.manager_id IS DISTINCT FROM e.manager_id`,
        [tenantId, r.email]);
      await client.query(
        `UPDATE pms.development_plans dp SET manager_id = e.manager_id, updated_at = now()
           FROM core.employees e, pms.cycles c
          WHERE dp.employee_id = e.id AND dp.cycle_id = c.id
            AND e.tenant_id=$1 AND LOWER(e.email)=LOWER($2)
            AND c.phase NOT IN ('closed','cancelled')
            AND dp.manager_id IS DISTINCT FROM e.manager_id`,
        [tenantId, r.email]);
    }
    await client.query('COMMIT');
    return { loaded: rows.length };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
}

// ---------- Router ----------------------------------------------------------
const ALLOWED_EXT = /\.(csv|xlsx|xls)$/i;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_EXT.test(file.originalname || '')) return cb(new Error('Only .csv, .xlsx, or .xls files are accepted'));
    cb(null, true);
  },
});
const router = express.Router();
router.use(authenticate, apiPermissionParity);

router.get('/', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT e.id, e.emp_code, e.name, e.email, e.department, e.designation, e.role_band,
              e.status, e.date_of_joining, m.name AS manager_name, m.email AS manager_email
         FROM core.employees e LEFT JOIN core.employees m ON m.id = e.manager_id
        WHERE e.tenant_id = $1 ORDER BY e.name`, [req.user.tenant_id]);
    res.json({ employees: r.rows });
  } catch (e) { logger.error('employees list', { error: e.message }); res.status(500).json({ error: e.message }); }
});

// POST /employees/import  (multipart file, .csv/.xlsx/.xls) ?commit=1 to load; default DRY RUN.
router.post('/import', (req, res, next) => upload.single('file')(req, res, (err) => {
  if (err) return res.status(400).json({ error: err.message });
  next();
}), async (req, res) => {
  try {
    if (!(await hasPermission(req.user, 'people_admin'))) return res.status(403).json({ error: "Requires 'people_admin'" });
    if (!req.file) return res.status(400).json({ error: 'file required (multipart field "file")' });

    const format = detectFormat(req.file);
    if (format === 'xls-legacy') {
      return res.status(400).json({ error: 'Legacy .xls files are not supported — please re-save the file as .xlsx (File > Save As > Excel Workbook) and upload again.' });
    }
    const report = format === 'xlsx'
      ? await validateEmployeeXlsx(req.file.buffer)
      : validateEmployeeCsv(req.file.buffer.toString('utf8'));
    if (report.fatal) return res.status(400).json({ error: report.fatal });
    const commit = req.query.commit === '1';
    if (!report.ok) return res.status(422).json({ ok: false, committed: false, ...report });
    if (!commit) return res.json({ ok: true, committed: false, note: 'Dry run — pass ?commit=1 to load.', ...report });
    const loaded = await loadEmployees(req.user.tenant_id, report.rows);
    await db.query(`INSERT INTO core.audit_log (tenant_id, actor_email, action, entity, details)
                    VALUES ($1,$2,'EMPLOYEE_CSV_IMPORT','employees',$3)`,
      [req.user.tenant_id, req.user.email, JSON.stringify(report.summary)]);
    res.json({ ok: true, committed: true, ...loaded, warnings: report.warnings, summary: report.summary });
  } catch (e) { logger.error('employee import', { error: e.message }); res.status(500).json({ error: e.message }); }
});

module.exports = { router, validateEmployeeCsv, validateEmployeeXlsx, validateEmployeeRows, flexDate, parseCsv, detectFormat, loadEmployees };
