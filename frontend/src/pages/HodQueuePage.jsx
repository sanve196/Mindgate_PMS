import { useEffect, useState } from 'react';
import { api, phaseLabel, phaseColor } from '../utils/api';

export default function HodQueuePage() {
  const [data, setData] = useState(null); const [err, setErr] = useState(null);
  const load = () => api('/pms/hod/queue').then(setData).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);
  if (err) return <p className="text-sm text-rose-600">{err}</p>;
  if (!data) return <p className="text-sm text-navy-400">Loading…</p>;
  if (!data.cycle) return <div className="card p-8 text-center text-sm text-navy-400">No active cycle.</div>;
  const editable = data.cycle.phase === 'hod_eval';
  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold">Delivery Head Review</h2>
        <span className={`chip ${phaseColor(data.cycle.phase)}`}>{data.cycle.name} · {phaseLabel(data.cycle.phase)}</span>
        {data.departments?.length > 0 && <span className="text-xs text-navy-400">departments: {data.departments.join(', ')}</span>}
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-navy-50 text-[10px] uppercase tracking-wide text-navy-500">
            <tr><th className="text-left px-3 py-2">Employee</th><th className="text-left px-3 py-2">Dept</th>
              <th className="text-right px-3 py-2">Manager rating</th><th className="text-right px-3 py-2">Delivery Head rating</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody className="divide-y divide-navy-100">
            {data.queue.map(q => <Row key={q.employee_id} q={q} editable={editable} reload={load} />)}
            {!data.queue.length && <tr><td colSpan={5} className="p-6 text-center text-navy-400">Nothing awaiting Delivery Head review — manager evaluations feed this queue as they are submitted.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ q, editable, reload }) {
  const [v, setV] = useState(q.hod_rating ?? '');
  const [err, setErr] = useState(null);
  const save = async (submit) => {
    setErr(null);
    try {
      await api(`/pms/hod/queue/${q.employee_id}`, { method: 'PUT', body: JSON.stringify({ overall_rating: v === '' ? null : Number(v), submit }) });
      if (submit) reload();
    } catch (e) { setErr(e.message); }
  };
  return (
    <tr>
      <td className="px-3 py-2 font-semibold">{q.name}</td>
      <td className="px-3 py-2">{q.department || '—'}</td>
      <td className="px-3 py-2 text-right font-mono">{q.manager_rating}</td>
      <td className="px-3 py-2 text-right">
        {q.hod_status === 'submitted' ? <span className="font-mono">{q.hod_rating}</span> :
          <input className="inp w-16 text-right inline-block" type="number" step="0.5" min="1" max="5" value={v} onChange={e => setV(e.target.value)} disabled={!editable} />}
      </td>
      <td className="px-3 py-2 text-right">
        {q.hod_status !== 'submitted' && editable && <button className="btn-pri" onClick={() => save(true)}>Submit</button>}
        {err && <p className="text-[10px] text-rose-600">{err}</p>}
      </td>
    </tr>
  );
}
