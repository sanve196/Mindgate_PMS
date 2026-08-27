// Agentic PMS — Phase 0 frontend shell.
// Deliberately minimal: login (dev), employee directory, CSV import with the
// dry-run validation report. The real product UI arrives in Phases 1–2 by
// lifting the AH pages (UI preservation is a spec requirement); this shell
// exists so Phase 0's exit test is clickable, not curl-able.

import { useEffect, useState } from 'react';

const api = async (path, opts = {}) => {
  const token = localStorage.getItem('apms_token');
  const res = await fetch(`/api/v1${path}`, {
    ...opts,
    headers: { ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
               ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { data });
  return data;
};

export default function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('directory');
  useEffect(() => {
    if (localStorage.getItem('apms_token')) {
      api('/me').then(r => setUser(r.user)).catch(() => localStorage.removeItem('apms_token'));
    }
  }, []);
  if (!user) return <Login onUser={setUser} />;
  return (
    <div className="shell">
      <header>
        <h1>Agentic PMS</h1>
        <nav>
          <button className={view === 'directory' ? 'on' : ''} onClick={() => setView('directory')}>Directory</button>
          <button className={view === 'import' ? 'on' : ''} onClick={() => setView('import')}>Import</button>
        </nav>
        <span className="who">{user.name} · {user.role}
          <button onClick={() => { localStorage.removeItem('apms_token'); setUser(null); }}>Sign out</button>
        </span>
      </header>
      {view === 'directory' ? <Directory /> : <ImportCsv />}
    </div>
  );
}

function Login({ onUser }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [err, setErr] = useState(null);
  const go = async () => {
    setErr(null);
    try {
      const r = await api('/auth/dev-login', { method: 'POST', body: JSON.stringify({ email, password }) });
      localStorage.setItem('apms_token', r.token); onUser(r.user);
    } catch (e) { setErr(e.message); }
  };
  return (
    <div className="login">
      <h1>Agentic PMS</h1>
      <input placeholder="email" value={email} onChange={e => setEmail(e.target.value)} />
      <input placeholder="password" type="password" value={password} onChange={e => setPassword(e.target.value)}
             onKeyDown={e => e.key === 'Enter' && go()} />
      {err && <p className="err">{err}</p>}
      <button onClick={go}>Sign in</button>
      <p className="hint">Dev login — production instances authenticate via the client's identity provider.</p>
    </div>
  );
}

function Directory() {
  const [rows, setRows] = useState(null); const [err, setErr] = useState(null);
  useEffect(() => { api('/employees').then(r => setRows(r.employees)).catch(e => setErr(e.message)); }, []);
  if (err) return <p className="err">{err}</p>;
  if (!rows) return <p>Loading…</p>;
  if (!rows.length) return <p>No employees yet — use Import to load the client CSV.</p>;
  return (
    <table>
      <thead><tr><th>Code</th><th>Name</th><th>Email</th><th>Department</th><th>Designation</th><th>Manager</th><th>Status</th></tr></thead>
      <tbody>{rows.map(r => (
        <tr key={r.id}><td>{r.emp_code || '—'}</td><td>{r.name}</td><td>{r.email}</td>
          <td>{r.department || '—'}</td><td>{r.designation || '—'}</td><td>{r.manager_name || '—'}</td><td>{r.status}</td></tr>
      ))}</tbody>
    </table>
  );
}

function ImportCsv() {
  const [report, setReport] = useState(null); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const send = async (file, commit) => {
    setBusy(true); setErr(null);
    const fd = new FormData(); fd.append('file', file);
    try { setReport(await api(`/employees/import${commit ? '?commit=1' : ''}`, { method: 'POST', body: fd })); }
    catch (e) { setErr(e.message); setReport(e.data && e.data.errors ? e.data : null); }
    setBusy(false);
  };
  const [file, setFile] = useState(null);
  return (
    <div>
      <h2>Employee CSV import</h2>
      <p>Columns: emp_code, name*, email*, department, designation, role_band, manager_email, date_of_joining (any common format), status. Dry run first; commit only when clean.</p>
      <input type="file" accept=".csv" onChange={e => setFile(e.target.files[0])} />
      <button disabled={!file || busy} onClick={() => send(file, false)}>Validate (dry run)</button>
      <button disabled={!file || busy || !(report && report.ok && !report.committed)} onClick={() => send(file, true)}>Commit load</button>
      {err && <p className="err">{err}</p>}
      {report && (
        <div className="report">
          <p><b>{report.committed ? 'LOADED' : report.ok ? 'VALID (dry run)' : 'REJECTED'}</b>
            {report.summary && ` — ${report.summary.total} rows, ${report.summary.errors} errors, ${report.summary.warnings} warnings, ${report.summary.departments} departments`}</p>
          {(report.errors || []).map((e, i) => <p key={i} className="err">line {e.line}: {e.error}</p>)}
          {(report.warnings || []).map((w, i) => <p key={i} className="warn">line {w.line}: {w.warning}</p>)}
        </div>
      )}
    </div>
  );
}
