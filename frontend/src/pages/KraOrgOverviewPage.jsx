import { useEffect, useState, Fragment } from 'react';
import { Search, UserCog, Plus, Trash2, Send } from 'lucide-react';
import { api } from '../utils/api';

const STATUS_COLOR = {
  not_started: 'bg-navy-50 text-navy-500',
  draft: 'bg-slate-100 text-navy-600',
  submitted: 'bg-amber-100 text-amber-700',
  returned: 'bg-rose-100 text-rose-700',
  approved: 'bg-emerald-100 text-emerald-700',
};

export default function KraOrgOverviewPage() {
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [err, setErr] = useState(null);
  const [editingId, setEditingId] = useState(null);
  // Fix guide item #4 (BR-1.1): bulk KRA upload, alongside the existing
  // single-employee "enter on behalf" already below. Mirrors DirectoryPage's
  // employee-import UI/flow exactly (same dry-run-first pattern) for
  // familiarity, but posts to the new /hr/kra-sheet/bulk-upload endpoint.
  const [kraFile, setKraFile] = useState(null);
  const [kraReport, setKraReport] = useState(null);
  const [kraErr, setKraErr] = useState(null);
  const load = (query) => api(`/pms/kra/org-overview${query ? `?q=${encodeURIComponent(query)}` : ''}`).then(setData).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);

  const sendKraBulk = async (commit) => {
    setKraErr(null);
    const fd = new FormData(); fd.append('file', kraFile);
    try {
      const r = await api(`/pms/hr/kra-sheet/bulk-upload${commit ? '?commit=1' : ''}`, { method: 'POST', body: fd });
      setKraReport(r);
      if (commit) load(q);
    } catch (e) { setKraErr(e.message); setKraReport(e.data && e.data.errors ? e.data : null); }
  };

  if (err && !data) return <p className="text-sm text-rose-600">{err}</p>;
  if (!data) return <p className="text-sm text-navy-400">Loading…</p>;
  if (!data.cycle) return <div className="card p-8 text-center text-sm text-navy-400">No active cycle.</div>;

  const COUNTER_ORDER = ['not_started', 'draft', 'submitted', 'returned', 'approved'];

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <div>
        <h2 className="text-lg font-bold">Org-wide KRA Overview</h2>
        <p className="text-xs text-navy-400">{data.cycle.name} · every active employee's KRA status, with search and the ability to enter KRAs on someone's behalf.</p>
      </div>
      <div className="card p-4 space-y-2">
        <p className="lbl">Bulk KRA upload — CSV or Excel (.xlsx), one row per KRA, dry run first (BR-1.1)</p>
        <div className="flex flex-wrap items-center gap-2">
          <input type="file" accept=".csv,.xlsx,.xls" onChange={e => { setKraFile(e.target.files[0]); setKraReport(null); }} className="text-xs" />
          <button className="btn-sec" disabled={!kraFile} onClick={() => sendKraBulk(false)}>Validate</button>
          <button className="btn-pri" disabled={!kraFile || !(kraReport && kraReport.ok && !kraReport.committed)} onClick={() => sendKraBulk(true)}>Commit load</button>
        </div>
        <p className="text-[11px] text-navy-400">Columns: employee_email, kra_title, weight, description, measures. Each employee's weights must total 100. Loaded KRAs land as Draft — the employee (or HR) still needs to Submit.</p>
        {kraErr && <p className="text-xs text-rose-600">{kraErr}</p>}
        {kraReport && (
          <div className="text-xs space-y-1">
            <p className="font-semibold">{kraReport.committed ? 'LOADED' : kraReport.ok ? 'VALID — commit to load' : 'REJECTED'}
              {kraReport.summary && ` · ${kraReport.summary.total_rows} rows · ${kraReport.summary.employees} employees · ${kraReport.summary.errors} errors · ${kraReport.summary.warnings} warnings`}</p>
            {(kraReport.errors || []).map((e, i) => <p key={i} className="text-rose-600">line {e.line}: {e.error}</p>)}
            {(kraReport.warnings || []).map((w, i) => <p key={i} className="text-amber-700">line {w.line}: {w.warning}</p>)}
            {(kraReport.skipped || []).map((s, i) => <p key={i} className="text-amber-700">skipped {s.email}: {s.reason}</p>)}
          </div>
        )}
      </div>
      <div className="flex gap-3 flex-wrap">
        {COUNTER_ORDER.map(k => (
          <div key={k} className="text-center">
            <p className="text-lg font-bold">{data.counters[k] || 0}</p>
            <p className="text-[10px] text-navy-400 capitalize">{k.replace('_', ' ')}</p>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Search size={14} className="text-navy-400" />
        <input className="inp max-w-xs" placeholder="Search by name, email, or department"
          value={q} onChange={e => { setQ(e.target.value); load(e.target.value); }} />
      </div>
      {err && <p className="text-xs text-rose-600">{err}</p>}
      <div className="card overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-navy-50 text-[10px] uppercase tracking-wide text-navy-500">
            <tr><th className="text-left px-3 py-2">Employee</th><th className="text-left px-3 py-2">Department</th>
              <th className="text-left px-3 py-2">Manager</th><th className="text-right px-3 py-2">KRAs</th>
              <th className="text-left px-3 py-2">Status</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody className="divide-y divide-navy-100">
            {data.employees.map(e => (
              <Fragment key={e.employee_id}>
                <tr>
                  <td className="px-3 py-2 font-semibold">{e.name}</td>
                  <td className="px-3 py-2">{e.department || '—'}</td>
                  <td className="px-3 py-2">{e.manager_name || '—'}</td>
                  <td className="px-3 py-2 text-right font-mono">{e.kra_count}</td>
                  <td className="px-3 py-2"><span className={`chip ${STATUS_COLOR[e.status]}`}>{e.status.replace('_', ' ')}</span></td>
                  <td className="px-3 py-2 text-right">
                    <button className="btn-sec !py-1" onClick={() => setEditingId(v => v === e.employee_id ? null : e.employee_id)}>
                      <UserCog size={12} className="inline mr-1" />Enter on behalf
                    </button>
                  </td>
                </tr>
                {editingId === e.employee_id && (
                  <tr><td colSpan={6} className="px-3 pb-3"><OnBehalfEditor employeeId={e.employee_id} onDone={() => { setEditingId(null); load(q); }} /></td></tr>
                )}
              </Fragment>
            ))}
            {!data.employees.length && <tr><td colSpan={6} className="p-6 text-center text-navy-400">No employees match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OnBehalfEditor({ employeeId, onDone }) {
  const [sheet, setSheet] = useState(null);
  const [kras, setKras] = useState([]);
  const [err, setErr] = useState(null);
  useEffect(() => {
    api(`/pms/hr/kra-sheet/${employeeId}`).then(r => { setSheet(r.sheet); setKras(r.kras.length ? r.kras : [{ title: '', weight: 0 }]); }).catch(e => setErr(e.message));
  }, [employeeId]);

  const update = (i, field, value) => setKras(ks => ks.map((k, j) => j === i ? { ...k, [field]: value } : k));
  const remove = (i) => setKras(ks => ks.filter((_, j) => j !== i));
  const add = () => setKras(ks => [...ks, { title: '', weight: 0 }]);
  const total = kras.reduce((s, k) => s + (Number(k.weight) || 0), 0);

  const save = async () => {
    setErr(null);
    try { const r = await api(`/pms/hr/kra-sheet/${employeeId}/kras`, { method: 'PUT', body: JSON.stringify({ kras }) }); setKras(r.kras); }
    catch (e) { setErr(e.message); }
  };
  const submit = async () => {
    setErr(null);
    try { await api(`/pms/hr/kra-sheet/${employeeId}/kras`, { method: 'PUT', body: JSON.stringify({ kras }) }); await api(`/pms/hr/kra-sheet/${employeeId}/submit`, { method: 'POST' }); onDone(); }
    catch (e) { setErr(e.message); }
  };

  if (!sheet) return <p className="text-xs text-navy-400">Loading…</p>;
  if (sheet.status === 'approved') return <p className="text-xs text-navy-400">Sheet is approved — return it before editing on behalf.</p>;

  return (
    <div className="bg-navy-50 rounded-lg p-3 space-y-2">
      {kras.map((k, i) => (
        <div key={i} className="flex gap-1.5 items-center">
          <input className="inp flex-1" placeholder="KRA title" value={k.title} onChange={e => update(i, 'title', e.target.value)} />
          <input className="inp w-20 text-right" type="number" value={k.weight} onChange={e => update(i, 'weight', e.target.value)} />
          <span className="text-[10px] text-navy-400">%</span>
          <button className="btn-sec !p-1.5" onClick={() => remove(i)}><Trash2 size={12} /></button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <button className="btn-sec" onClick={add}><Plus size={12} className="inline mr-1" />Add KRA</button>
        <span className={`text-xs font-semibold ${total === 100 ? 'text-emerald-700' : 'text-rose-600'}`}>Total: {total}%</span>
        <button className="btn-sec" onClick={save}>Save draft</button>
        <button className="btn-pri" disabled={total !== 100} onClick={submit}><Send size={12} className="inline mr-1" />Save & submit</button>
      </div>
      {err && <p className="text-xs text-rose-600">{err}</p>}
    </div>
  );
}
