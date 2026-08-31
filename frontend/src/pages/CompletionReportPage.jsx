import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../utils/api';

const STATUS_COLOR = {
  approved: 'bg-emerald-100 text-emerald-700', submitted: 'bg-emerald-100 text-emerald-700',
  returned: 'bg-rose-100 text-rose-700',
  in_progress: 'bg-amber-100 text-amber-700', draft: 'bg-amber-100 text-amber-700', pending: 'bg-amber-100 text-amber-700',
  not_started: 'bg-navy-50 text-navy-400',
};
function StatusChip({ value }) {
  return <span className={`chip ${STATUS_COLOR[value] || 'bg-navy-50 text-navy-600'}`}>{value.replace('_', ' ')}</span>;
}

// "PMS Completion Report" — who has and hasn't completed their PMS this
// cycle, per a direct request. Read-only over data that already exists
// (KRA/Dev Plan/Self-Appraisal/Manager Evaluation status per employee).
export default function CompletionReportPage() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [reseeding, setReseeding] = useState(false);
  const [reseedMsg, setReseedMsg] = useState(null);

  const load = () => api('/pms/reports/completion').then(setData).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);

  const reseed = async () => {
    setReseeding(true); setReseedMsg(null); setErr(null);
    try {
      const r = await api('/pms/hod/re-seed', { method: 'POST' });
      setReseedMsg(`Checked ${r.checked} submitted evaluation${r.checked === 1 ? '' : 's'} — created ${r.created} new queue entr${r.created === 1 ? 'y' : 'ies'}${r.skipped_no_head ? `, skipped ${r.skipped_no_head} (no department head assigned yet)` : ''}.`);
    } catch (e) { setErr(e.message); }
    setReseeding(false);
  };

  if (err && !data) return <p className="text-sm text-rose-600">{err}</p>;
  if (!data) return <p className="text-sm text-navy-400">Loading…</p>;
  if (!data.cycle) return <div className="card p-8 text-center text-sm text-navy-400">No active cycle.</div>;

  const completeCount = data.rows.filter(r => r.complete).length;

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold">PMS Completion Report</h2>
        <span className="chip bg-navy-50 text-navy-600">{data.cycle.name}</span>
        <span className="chip bg-emerald-100 text-emerald-700">{completeCount} / {data.rows.length} complete</span>
        <button className="btn-sec ml-auto" disabled={reseeding} onClick={reseed}>
          <RefreshCw size={13} className="inline mr-1" />{reseeding ? 'Re-seeding…' : 'Re-seed HOD evaluations'}
        </button>
      </div>
      <p className="text-xs text-navy-400 -mt-2">
        "Complete" means KRA approved, Development Plan approved, Self-Appraisal submitted, and Manager Evaluation submitted.
        Delivery Head Review isn't counted here — it isn't the employee's own action to finish.
      </p>
      {reseedMsg && <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">{reseedMsg}</p>}
      {err && <p className="text-xs text-rose-600">{err}</p>}
      <div className="card overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-navy-400 uppercase text-[10px] border-b border-navy-100">
              <th className="px-3 py-2">Employee</th><th className="px-3 py-2">Dept</th>
              <th className="px-3 py-2">KRA</th><th className="px-3 py-2">Dev Plan</th>
              <th className="px-3 py-2">Self-Appraisal</th><th className="px-3 py-2">Manager Eval</th>
              <th className="px-3 py-2">HOD</th><th className="px-3 py-2">Overall</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map(r => (
              <tr key={r.employee_id} className="border-b border-navy-50">
                <td className="px-3 py-2 font-semibold">{r.name}</td>
                <td className="px-3 py-2 text-navy-400">{r.department || '—'}</td>
                <td className="px-3 py-2"><StatusChip value={r.kra_status} /></td>
                <td className="px-3 py-2"><StatusChip value={r.devplan_status} /></td>
                <td className="px-3 py-2"><StatusChip value={r.self_appraisal_status} /></td>
                <td className="px-3 py-2"><StatusChip value={r.manager_eval_status} /></td>
                <td className="px-3 py-2"><StatusChip value={r.hod_status} /></td>
                <td className="px-3 py-2">
                  <span className={`chip ${r.complete ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{r.complete ? 'Complete' : 'Pending'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.rows.length && <p className="p-6 text-center text-sm text-navy-400">No active employees found.</p>}
      </div>
    </div>
  );
}
