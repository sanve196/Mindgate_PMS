import { useEffect, useRef, useState } from 'react';
import { Sparkles, Send, ChevronDown, ChevronRight } from 'lucide-react';
import { api, phaseLabel, phaseColor, DraftBadge } from '../utils/api';

export default function TeamEvalPage() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [openId, setOpenId] = useState(null);

  const load = () => api('/pms/team/evaluations').then(r => { setData(r); setErr(null); }).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);

  if (err) return <p className="text-sm text-rose-600">{err}</p>;
  if (!data) return <p className="text-sm text-slate-400">Loading…</p>;
  if (!data.cycle) return <div className="card p-8 text-center text-sm text-slate-400">No active cycle.</div>;

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold">Team Evaluation</h2>
        <span className={`chip ${phaseColor(data.cycle.phase)}`}>{data.cycle.name} · {phaseLabel(data.cycle.phase)}</span>
      </div>
      {!data.team.length && <div className="card p-8 text-center text-sm text-slate-400">No direct reports found in the employee mirror.</div>}
      {data.team.map(t => (
        <div key={t.employee_id} className="card overflow-hidden">
          <button className="w-full flex items-center gap-2 px-4 py-3 text-left" onClick={() => setOpenId(v => v === t.employee_id ? null : t.employee_id)}>
            {openId === t.employee_id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span className="text-sm font-semibold flex-1">{t.name}</span>
            <span className={`chip ${t.self_status === 'submitted' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>self: {t.self_status || 'not started'}</span>
            <span className={`chip ${t.eval_status === 'submitted' ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-100 text-slate-600'}`}>eval: {t.eval_status || 'pending'}</span>
          </button>
          {openId === t.employee_id && <EvalEditor t={t} phase={data.cycle.phase} scale={data.cycle.rating_scale} reload={load} />}
        </div>
      ))}
    </div>
  );
}

function EvalEditor({ t, phase, scale, reload }) {
  const [f, setF] = useState({ overall_rating: t.overall_rating ?? '', strengths: t.strengths || '', improvement_areas: t.improvement_areas || '' });
  const [state, setState] = useState('idle');
  const [err, setErr] = useState(null);
  const [draft, setDraft] = useState(null);
  const [drafting, setDrafting] = useState(false);
  const timer = useRef(null);
  const editable = phase === 'manager_eval' && t.eval_status !== 'submitted';

  const persist = async (patch) => {
    setState('saving');
    try { await api(`/pms/team/evaluations/${t.employee_id}`, { method: 'PUT', body: JSON.stringify(patch) }); setState('saved'); }
    catch (e) { setState('error'); setErr(e.message); }
  };
  const setText = (k) => (e) => {
    const v = e.target.value; setF(s => ({ ...s, [k]: v })); setState('dirty');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => persist({ [k]: v }), 1200);
  };
  const askDraft = async () => {
    setDrafting(true); setErr(null);
    try { const r = await api('/agentic/appraisal-draft', { method: 'POST', body: JSON.stringify({ employee_id: t.employee_id }) }); setDraft(r.draft); }
    catch (e) { setErr(e.message); }
    setDrafting(false);
  };
  const badge = { idle: null, dirty: ['Unsaved…', 'text-slate-400'], saving: ['Saving…', 'text-amber-600'], saved: ['Saved ✓', 'text-emerald-600'], error: ['Save failed', 'text-rose-600'] }[state];

  return (
    <div className="border-t border-stone-100 p-4 space-y-3">
      {t.self_status === 'submitted' && (
        <div className="bg-stone-50 border border-stone-200 rounded-lg p-3 text-xs space-y-1">
          <p className="font-bold text-slate-500 uppercase text-[10px]">Their self-appraisal</p>
          {t.went_well && <p><b>Went well:</b> {t.went_well}</p>}
          {t.could_improve && <p><b>Could improve:</b> {t.could_improve}</p>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className="lbl mb-0">Overall rating *</label>
        <select className="inp w-auto" value={f.overall_rating} disabled={!editable}
          onChange={(e) => { setF(s => ({ ...s, overall_rating: e.target.value })); persist({ overall_rating: e.target.value === '' ? null : Number(e.target.value) }); }}>
          <option value="">—</option>
          {(scale || []).map(s => <option key={s.value} value={s.value}>{s.value} · {s.label}</option>)}
        </select>
        {editable && (
          <button className="btn-sec" disabled={drafting} onClick={askDraft}>
            <Sparkles size={13} className="inline mr-1 text-amber-500" />{drafting ? 'Drafting…' : 'Draft the writing'}
          </button>
        )}
        {badge && <span className={`text-[11px] font-medium ${badge[1]}`}>{badge[0]}</span>}
      </div>
      {draft && (
        <div className="bg-slate-900 text-slate-100 rounded-lg p-3 text-xs space-y-2">
          <DraftBadge />
          {draft.strengths && <p><b>Strengths:</b> {draft.strengths}</p>}
          {draft.improvement_areas && <p><b>Improvement areas:</b> {draft.improvement_areas}</p>}
          {(draft.gaps || []).length > 0 && <p className="text-amber-300">Input gaps: {draft.gaps.join(' · ')}</p>}
          <button className="btn-sec !bg-slate-800 !text-white !border-slate-600" onClick={() => {
            setF(s => ({ ...s, strengths: draft.strengths || s.strengths, improvement_areas: draft.improvement_areas || s.improvement_areas }));
            persist({ strengths: draft.strengths, improvement_areas: draft.improvement_areas });
          }}>Copy into fields (then edit)</button>
        </div>
      )}
      <div><label className="lbl">Strengths</label>
        <textarea className="inp" rows={3} value={f.strengths} onChange={setText('strengths')} disabled={!editable} /></div>
      <div><label className="lbl">Improvement areas</label>
        <textarea className="inp" rows={3} value={f.improvement_areas} onChange={setText('improvement_areas')} disabled={!editable} /></div>
      {err && <p className="text-xs text-rose-600">{err}</p>}
      {editable && (
        <button className="btn-pri" onClick={async () => {
          try { await api(`/pms/team/evaluations/${t.employee_id}/submit`, { method: 'POST' }); reload(); }
          catch (e) { setErr(e.message); }
        }}><Send size={13} className="inline mr-1" />Submit evaluation</button>
      )}
    </div>
  );
}
