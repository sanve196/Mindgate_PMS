import { useEffect, useState } from 'react';
import { Plus, Trash2, Send, CheckCircle2, RotateCcw } from 'lucide-react';
import { api } from '../utils/api';

const STATUS_COLOR = {
  draft: 'bg-slate-100 text-slate-600',
  submitted: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  returned: 'bg-rose-100 text-rose-700',
};

export default function MyGrowthPage() {
  return (
    <div className="space-y-4 max-w-6xl">
      <h2 className="text-lg font-bold">My Growth</h2>
      <div className="grid lg:grid-cols-2 gap-4">
        <DevelopmentPlanCard />
        <CareerPathCard />
      </div>
      <TeamDevelopmentPlans />
    </div>
  );
}

// ---------------- Development Plan (BR-2.1/2.2/2.3) ------------------------
function DevelopmentPlanCard() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const load = () => api('/pms/my/development-plan').then(setData).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);

  if (err) return <div className="card p-4"><p className="text-sm text-rose-600">{err}</p></div>;
  if (!data) return <div className="card p-4"><p className="text-sm text-slate-400">Loading…</p></div>;
  if (!data.cycle) return <div className="card p-8 text-center text-sm text-slate-400">No active cycle.</div>;

  const editable = data.plan.status === 'draft' || data.plan.status === 'returned';

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <p className="font-bold text-sm flex-1">Development Plan</p>
        <span className={`chip ${STATUS_COLOR[data.plan.status]}`}>{data.plan.status}</span>
      </div>
      {data.plan.status === 'returned' && data.plan.manager_comment && (
        <p className="text-xs bg-rose-50 text-rose-700 rounded-lg p-2"><b>Returned:</b> {data.plan.manager_comment}</p>
      )}
      <GoalList goals={data.goals} editable={editable} onSaved={load} />
      {editable && (
        <button className="btn-pri" disabled={!data.goals.length} onClick={async () => {
          try { await api('/pms/my/development-plan/submit', { method: 'POST' }); load(); }
          catch (e) { setErr(e.message); }
        }}><Send size={13} className="inline mr-1" />Submit for approval</button>
      )}
    </div>
  );
}

function GoalList({ goals: initial, editable, onSaved }) {
  const [goals, setGoals] = useState(initial);
  const [err, setErr] = useState(null);
  useEffect(() => { setGoals(initial); }, [initial]);

  const update = (i, field, value) => setGoals(gs => gs.map((g, j) => j === i ? { ...g, [field]: value } : g));
  const remove = (i) => setGoals(gs => gs.filter((_, j) => j !== i));
  const add = () => setGoals(gs => [...gs, { title: '', description: '', target_date: '', progress_pct: 0 }]);

  const saveAll = async () => {
    setErr(null);
    try { await api('/pms/my/development-plan/goals', { method: 'PUT', body: JSON.stringify({ goals }) }); onSaved(); }
    catch (e) { setErr(e.message); }
  };
  const setProgress = async (goalId, pct) => {
    try { await api(`/pms/my/development-plan/goals/${goalId}/progress`, { method: 'PUT', body: JSON.stringify({ progress_pct: pct }) }); onSaved(); }
    catch (e) { setErr(e.message); }
  };

  if (!editable) {
    return (
      <div className="space-y-2">
        {!goals.length && <p className="text-xs text-slate-400">No development goals recorded.</p>}
        {goals.map(g => (
          <div key={g.id} className="text-xs bg-stone-50 rounded-lg p-2 space-y-1">
            <p className="font-semibold">{g.title}</p>
            {g.description && <p className="text-slate-500">{g.description}</p>}
            <ProgressBar value={g.progress_pct} onChange={(v) => setProgress(g.id, v)} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {goals.map((g, i) => (
        <div key={g.id || i} className="border border-stone-100 rounded-lg p-2 space-y-1.5">
          <div className="flex gap-1.5">
            <input className="inp flex-1" placeholder="Goal title" value={g.title} onChange={e => update(i, 'title', e.target.value)} />
            <input className="inp w-32" type="date" value={g.target_date || ''} onChange={e => update(i, 'target_date', e.target.value)} />
            <button className="btn-sec !p-1.5" onClick={() => remove(i)}><Trash2 size={13} /></button>
          </div>
          <input className="inp w-full" placeholder="Description (optional)" value={g.description || ''} onChange={e => update(i, 'description', e.target.value)} />
        </div>
      ))}
      <div className="flex gap-2">
        <button className="btn-sec" onClick={add}><Plus size={13} className="inline mr-1" />Add goal</button>
        <button className="btn-pri" onClick={saveAll}>Save goals</button>
      </div>
      {err && <p className="text-xs text-rose-600">{err}</p>}
    </div>
  );
}

function ProgressBar({ value, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-stone-200 rounded-full overflow-hidden">
        <div className="h-full bg-emerald-500" style={{ width: `${value}%` }} />
      </div>
      <input className="inp w-16 !py-0.5 text-right" type="number" min="0" max="100" value={value}
        onChange={e => onChange(Math.min(100, Math.max(0, Number(e.target.value) || 0)))} />
      <span className="text-[10px] text-slate-400">%</span>
    </div>
  );
}

// ---------------- Career Path (BR-3.1/3.2) ----------------------------------
function CareerPathCard() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ target_role: '', plan: '' });
  const [err, setErr] = useState(null);
  const [saved, setSaved] = useState(false);
  const load = () => api('/people/career/my-path').then(r => { setData(r); setForm({ target_role: r.path?.target_role || '', plan: r.path?.plan || '' }); }).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);

  const save = async () => {
    setErr(null); setSaved(false);
    if (!form.target_role.trim()) { setErr('A target role is required.'); return; }
    try { await api('/people/career/my-path', { method: 'PUT', body: JSON.stringify(form) }); setSaved(true); load(); }
    catch (e) { setErr(e.message); }
  };

  if (err && !data) return <div className="card p-4"><p className="text-sm text-rose-600">{err}</p></div>;
  if (!data) return <div className="card p-4"><p className="text-sm text-slate-400">Loading…</p></div>;

  return (
    <div className="card p-4 space-y-3">
      <p className="font-bold text-sm">Career Path</p>
      <div>
        <label className="lbl">Target role</label>
        {data.eligible_role_bands.length ? (
          <select className="inp" value={form.target_role} onChange={e => setForm(f => ({ ...f, target_role: e.target.value }))}>
            <option value="">—</option>
            {data.eligible_role_bands.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        ) : (
          <input className="inp" value={form.target_role} onChange={e => setForm(f => ({ ...f, target_role: e.target.value }))} placeholder="e.g. Staff Engineer" />
        )}
        {data.eligible_role_bands.length > 0 && <p className="text-[11px] text-slate-400 mt-1">Limited to your organisation's configured role bands (guardrails).</p>}
      </div>
      <div>
        <label className="lbl">Growth plan</label>
        <textarea className="inp" rows={4} value={form.plan} onChange={e => setForm(f => ({ ...f, plan: e.target.value }))} placeholder="How you plan to get there" />
      </div>
      {err && <p className="text-xs text-rose-600">{err}</p>}
      <button className="btn-pri" onClick={save}>Save</button>
      {saved && <span className="text-[11px] text-emerald-600 font-medium ml-2">Saved ✓</span>}
    </div>
  );
}

// ---------------- Manager view — approve/return reports' plans --------------
// Not part of the BRD's Fig. 5 (that's the employee's own view), but a
// Development Plan stuck at "submitted" with no way to decide it is not a
// usable feature — this closes that loop. Silently hidden for anyone
// without pms_team_eval (the request 403s and the section just doesn't render).
function TeamDevelopmentPlans() {
  const [data, setData] = useState(null);
  const [openId, setOpenId] = useState(null);
  const load = () => api('/pms/team/development-plans').then(setData).catch(() => setData({ cycle: null, plans: [] }));
  useEffect(() => { load(); }, []);

  if (!data || !data.plans?.length) return null;

  return (
    <div className="space-y-2">
      <p className="font-bold text-sm">Team Development Plans</p>
      {data.plans.map(p => (
        <div key={p.id} className="card">
          <button className="w-full flex items-center justify-between px-4 py-3 text-left" onClick={() => setOpenId(v => v === p.id ? null : p.id)}>
            <span className="text-sm font-semibold flex-1">{p.employee_name}</span>
            <span className="text-xs text-slate-400 mr-2">{p.goal_count} goals · {p.avg_progress}% avg</span>
            <span className={`chip ${STATUS_COLOR[p.status]}`}>{p.status}</span>
          </button>
          {openId === p.id && <TeamPlanDecide plan={p} reload={load} />}
        </div>
      ))}
    </div>
  );
}

function TeamPlanDecide({ plan, reload }) {
  const [err, setErr] = useState(null);
  const decide = async (decision) => {
    setErr(null);
    const comment = decision === 'returned' ? prompt('Reason for returning (required):') : null;
    if (decision === 'returned' && !comment) return;
    try { await api(`/pms/team/development-plans/${plan.id}/decide`, { method: 'POST', body: JSON.stringify({ decision, comment }) }); reload(); }
    catch (e) { setErr(e.message); }
  };
  if (plan.status !== 'submitted') return null;
  return (
    <div className="border-t border-stone-100 p-3 flex gap-2">
      <button className="btn-pri" onClick={() => decide('approved')}><CheckCircle2 size={13} className="inline mr-1" />Approve</button>
      <button className="btn-sec" onClick={() => decide('returned')}><RotateCcw size={13} className="inline mr-1" />Return with comment</button>
      {err && <p className="text-xs text-rose-600">{err}</p>}
    </div>
  );
}
