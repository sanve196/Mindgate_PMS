import { useEffect, useState, Fragment } from 'react';
import { KeyRound } from 'lucide-react';
import { api } from '../utils/api';

const ROLES = ['employee', 'manager', 'hod', 'hr', 'admin'];

export default function DirectoryPage() {
  const [rows, setRows] = useState(null);
  const [report, setReport] = useState(null);
  const [file, setFile] = useState(null);
  const [err, setErr] = useState(null);
  const [openId, setOpenId] = useState(null);
  const load = () => api('/employees').then(r => setRows(r.employees)).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);

  const send = async (commit) => {
    setErr(null);
    const fd = new FormData(); fd.append('file', file);
    try { setReport(await api(`/employees/import${commit ? '?commit=1' : ''}`, { method: 'POST', body: fd })); if (commit) load(); }
    catch (e) { setErr(e.message); setReport(e.data && e.data.errors ? e.data : null); }
  };

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <h2 className="text-lg font-bold">Employees</h2>
      <div className="card p-4 space-y-2">
        <p className="lbl">Bulk import — CSV or Excel (.xlsx), synced from your HRMS, dry run first</p>
        <div className="flex flex-wrap items-center gap-2">
          <input type="file" accept=".csv,.xlsx,.xls" onChange={e => { setFile(e.target.files[0]); setReport(null); }} className="text-xs" />
          <button className="btn-sec" disabled={!file} onClick={() => send(false)}>Validate</button>
          <button className="btn-pri" disabled={!file || !(report && report.ok && !report.committed)} onClick={() => send(true)}>Commit load</button>
        </div>
        <p className="text-[11px] text-navy-400">Legacy .xls files aren't supported — save as .xlsx first (File → Save As → Excel Workbook).</p>
        {err && <p className="text-xs text-rose-600">{err}</p>}
        {report && (
          <div className="text-xs space-y-1">
            <p className="font-semibold">{report.committed ? 'LOADED' : report.ok ? 'VALID — commit to load' : 'REJECTED'}
              {report.summary && ` · ${report.summary.total} rows · ${report.summary.errors} errors · ${report.summary.warnings} warnings`}</p>
            {(report.errors || []).map((e, i) => <p key={i} className="text-rose-600">line {e.line}: {e.error}</p>)}
            {(report.warnings || []).map((w, i) => <p key={i} className="text-amber-700">line {w.line}: {w.warning}</p>)}
          </div>
        )}
      </div>
      {!rows ? <p className="text-sm text-navy-400">Loading…</p> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-navy-50 text-[10px] uppercase tracking-wide text-navy-500">
              <tr><th className="text-left px-3 py-2">Name</th><th className="text-left px-3 py-2">Email</th>
                <th className="text-left px-3 py-2">Department</th><th className="text-left px-3 py-2">Manager</th>
                <th className="text-left px-3 py-2">Status</th><th className="text-left px-3 py-2">Login</th>
                <th className="text-left px-3 py-2">Role</th><th className="px-3 py-2" /></tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {rows.map(r => (
                <Fragment key={r.id}>
                  <tr>
                    <td className="px-3 py-2 font-semibold">{r.name}</td><td className="px-3 py-2">{r.email}</td>
                    <td className="px-3 py-2">{r.department || '—'}</td>
                    <td className="px-3 py-2">{r.manager_name || '—'}</td><td className="px-3 py-2">{r.status}</td>
                    <td className="px-3 py-2">
                      <span className={`chip ${r.has_login ? 'bg-leaf-50 text-leaf-600' : 'bg-navy-50 text-navy-500'}`}>{r.has_login ? 'Active' : 'None yet'}</span>
                    </td>
                    <td className="px-3 py-2 capitalize">{r.role}</td>
                    <td className="px-3 py-2 text-right">
                      <button className="btn-sec !py-1" onClick={() => setOpenId(v => v === r.id ? null : r.id)}>
                        <KeyRound size={12} className="inline mr-1" />Manage access
                      </button>
                    </td>
                  </tr>
                  {openId === r.id && (
                    <tr><td colSpan={8} className="px-3 pb-3 bg-navy-50/50"><ManageAccess employee={r} onDone={() => { setOpenId(null); load(); }} /></td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ManageAccess({ employee, onDone }) {
  const [password, setPassword] = useState('');
  const [role, setRole] = useState(employee.role);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);

  const setLogin = async () => {
    setErr(null); setMsg(null);
    if (password.length < 8) { setErr('Password must be at least 8 characters.'); return; }
    try { await api(`/employees/${employee.id}/credentials`, { method: 'POST', body: JSON.stringify({ password }) }); setMsg('Login set.'); setPassword(''); }
    catch (e) { setErr(e.message); }
  };
  const saveRole = async () => {
    setErr(null); setMsg(null);
    try { await api(`/employees/${employee.id}/role`, { method: 'PUT', body: JSON.stringify({ role }) }); setMsg('Role updated.'); onDone(); }
    catch (e) { setErr(e.message); }
  };

  return (
    <div className="p-3 space-y-3 text-xs">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="lbl">Set login password for {employee.email}</label>
          <input className="inp w-56" type="password" placeholder="min 8 characters" value={password} onChange={e => setPassword(e.target.value)} />
        </div>
        <button className="btn-pri" onClick={setLogin}>Set password</button>
        <p className="text-[11px] text-navy-400 max-w-xs">Chosen by you on their behalf — no company SSO is wired up yet, so this is the only way to give someone a real login right now.</p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="lbl">Role</label>
          <select className="inp w-40" value={role} onChange={e => setRole(e.target.value)}>
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <button className="btn-sec" onClick={saveRole}>Save role</button>
      </div>
      {err && <p className="text-rose-600">{err}</p>}
      {msg && <p className="text-leaf-600">{msg}</p>}
    </div>
  );
}
