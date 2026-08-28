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
  if (!data) return <p className="text-sm text-navy-400">Loading…</p>;
  if (!data.cycle) return <div className="card p-8 text-center text-sm text-navy-400">No active cycle.</div>;

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold">Team Evaluation</h2>
        <span className={`chip ${phaseColor(data.cycle.phase)}`}>{data.cycle.name} · {phaseLabel(data.cycle.phase)}</span>
      </div>
      {!data.team.length && <div className="card p-8 text-center text-sm text-navy-400">No direct reports found in the employee mirror.</div>}
      {data.team.map(t => (
        <div key={t.employee_id} className="card overflow-hidden">
          <button className="w-full flex items-center gap-2 px-4 py-3 text-left" onClick={() => setOpenId(v => v === t.employee_id ? null : t.employee_id)}>
            {openId === t.employee_id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span className="text-sm font-semibold flex-1">{t.name}</span>
            <span className={`chip ${t.self_status === 'submitted' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>self: {t.self_status || 'not started'}</span>
            <span className={`chip ${t.eval_status === 'submitted' ? 'bg-emerald-100 text-emerald-700' : 'bg-navy-50 text-navy-600'}`}>eval: {t.eval_status || 'pending'}</span>
          </button>
          {openId === t.employee_id && <EvalEditor t={t} phase={data.cycle.phase} scale={data.cycle.rating_scale} cycleType={data.cycle.cycle_type} reload={load} />}
        </div>
      ))}
    </div>
  );
}

function EvalEditor({ t, phase, scale, cycleType, reload }) {
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
  const badge = { idle: null, dirty: ['Unsaved…', 'text-navy-400'], saving: ['Saving…', 'text-amber-600'], saved: ['Saved ✓', 'text-emerald-600'], error: ['Save failed', 'text-rose-600'] }[state];

  return (
    <div className="border-t border-navy-100 p-4 space-y-3">
      {t.self_status === 'submitted' && (
        <div className="bg-navy-50 border border-navy-100 rounded-lg p-3 text-xs space-y-1">
          <p className="font-bold text-navy-500 uppercase text-[10px]">Their self-appraisal</p>
          {t.went_well && <p><b>Went well:</b> {t.went_well}</p>}
          {t.could_improve && <p><b>Could improve:</b> {t.could_improve}</p>}
        </div>
      )}
      {cycleType === 'annual' ? (
        <ParameterScoring employeeId={t.employee_id} editable={editable} initialRating={t.overall_rating} />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label className="lbl mb-0">Overall rating *</label>
          <select className="inp w-auto" value={f.overall_rating} disabled={!editable}
            onChange={(e) => { setF(s => ({ ...s, overall_rating: e.target.value })); persist({ overall_rating: e.target.value === '' ? null : Number(e.target.value) }); }}>
            <option value="">—</option>
            {(scale || []).map(s => <option key={s.value} value={s.value}>{s.value} · {s.label}</option>)}
          </select>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {editable && (
          <button className="btn-sec" disabled={drafting} onClick={askDraft}>
            <Sparkles size={13} className="inline mr-1 text-amber-500" />{drafting ? 'Drafting…' : 'Draft the writing'}
          </button>
        )}
        {badge && <span className={`text-[11px] font-medium ${badge[1]}`}>{badge[0]}</span>}
      </div>
      {draft && (
        <div className="bg-navy-800 text-slate-100 rounded-lg p-3 text-xs space-y-2">
          <DraftBadge />
          {draft.strengths && <p><b>Strengths:</b> {draft.strengths}</p>}
          {draft.improvement_areas && <p><b>Improvement areas:</b> {draft.improvement_areas}</p>}
          {(draft.gaps || []).length > 0 && <p className="text-amber-300">Input gaps: {draft.gaps.join(' · ')}</p>}
          <button className="btn-sec !bg-navy-700 !text-white !border-navy-600" onClick={() => {
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

// BR-6.2/6.3: on an annual cycle the overall rating is computed from the 7
// Organizational Driver parameters, not typed directly — this replaces the
// plain rating <select> for annual cycles. Every parameter must be scored
// before the weighted rating counts as complete (and only then does it
// flow into overall_rating server-side, gating Submit evaluation below).
function ParameterScoring({ employeeId, editable, initialRating }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const load = () => api(`/pms/team/parameter-scores/${employeeId}`).then(setData).catch(e => setErr(e.message));
  useEffect(() => { load(); }, [employeeId]);

  const setScore = async (parameterId, value) => {
    try {
      const r = await api(`/pms/team/parameter-scores/${employeeId}`, { method: 'PUT', body: JSON.stringify({ scores: { [parameterId]: Number(value) } }) });
      setData(d => d ? { ...d, scores: { ...d.scores, [parameterId]: Number(value) }, weighted_rating: r.weighted_rating, complete: r.complete, missing: r.missing } : d);
    } catch (e) { setErr(e.message); }
  };

  if (err) return <p className="text-xs text-rose-600">{err}</p>;
  if (!data) return <p className="text-xs text-navy-400">Loading parameters…</p>;

  return (
    <div className="space-y-2">
      <p className="lbl mb-0">7 Organizational Parameters {!data.complete && <span className="text-amber-600 font-normal">— {data.missing.length} not yet scored</span>}</p>
      <div className="grid sm:grid-cols-2 gap-2">
        {data.parameters.map(p => (
          <div key={p.id} className="flex items-center justify-between gap-2 bg-navy-50 rounded-lg px-2 py-1.5">
            <span className="text-xs">{p.name} <span className="text-navy-400">({p.weight_pct}%)</span></span>
            <select className="inp !py-1 w-16" value={data.scores[p.id] ?? ''} disabled={!editable} onChange={e => setScore(p.id, e.target.value)}>
              <option value="">—</option>
              {[1, 2, 3, 4, 5].map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        ))}
      </div>
      <p className="text-sm">
        <span className="font-semibold">Weighted overall rating: </span>
        <span className={data.complete ? 'text-emerald-700 font-bold' : 'text-navy-400'}>{data.weighted_rating ?? '—'}</span>
        {!data.complete && <span className="text-[11px] text-navy-400"> (updates live as parameters are scored; final once all 7 are)</span>}
      </p>
    </div>
  );
}
