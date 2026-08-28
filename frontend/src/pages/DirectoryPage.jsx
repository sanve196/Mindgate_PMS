import { useEffect, useState } from 'react';
import { api } from '../utils/api';

export default function DirectoryPage() {
  const [rows, setRows] = useState(null);
  const [report, setReport] = useState(null);
  const [file, setFile] = useState(null);
  const [err, setErr] = useState(null);
  const load = () => api('/employees').then(r => setRows(r.employees)).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);

  const send = async (commit) => {
    setErr(null);
    const fd = new FormData(); fd.append('file', file);
    try { setReport(await api(`/employees/import${commit ? '?commit=1' : ''}`, { method: 'POST', body: fd })); if (commit) load(); }
    catch (e) { setErr(e.message); setReport(e.data && e.data.errors ? e.data : null); }
  };

  return (
    <div className="space-y-4 max-w-4xl">
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
                <th className="text-left px-3 py-2">Department</th><th className="text-left px-3 py-2">Designation</th>
                <th className="text-left px-3 py-2">Manager</th><th className="text-left px-3 py-2">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {rows.map(r => (
                <tr key={r.id}><td className="px-3 py-2 font-semibold">{r.name}</td><td className="px-3 py-2">{r.email}</td>
                  <td className="px-3 py-2">{r.department || '—'}</td><td className="px-3 py-2">{r.designation || '—'}</td>
                  <td className="px-3 py-2">{r.manager_name || '—'}</td><td className="px-3 py-2">{r.status}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
