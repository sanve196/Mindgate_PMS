import { useEffect, useState } from 'react';
import { Plus, CheckCircle2, Clock, Sparkles } from 'lucide-react';
import { api } from '../utils/api';

export default function ConnectsPage() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const load = () => api('/pms/connects').then(r => setData(r.connects)).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);

  if (err) return <p className="text-sm text-rose-600">{err}</p>;
  if (!data) return <p className="text-sm text-navy-400">Loading…</p>;

  // Fix guide item #8: the sign-off action already existed, but nothing
  // called out how many connects were still awaiting it — this makes that
  // visible at a glance instead of requiring a scroll through the whole list.
  const pendingCount = data.filter(cn => !cn.signed_off).length;

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold">Quarterly Connects</h2>
        {pendingCount > 0 && <span className="chip bg-amber-100 text-amber-700">{pendingCount} awaiting sign-off</span>}
        <button className="btn-pri" onClick={() => setShowNew(v => !v)}><Plus size={13} className="inline mr-1" />Log a connect</button>
      </div>
      {showNew && <NewConnectForm onSaved={() => { setShowNew(false); load(); }} />}
      {!data.length && <div className="card p-8 text-center text-sm text-navy-400">No connects logged yet.</div>}
      <div className="space-y-2">
        {data.map(cn => <ConnectRow key={cn.id} cn={cn} reload={load} />)}
      </div>
    </div>
  );
}

function NewConnectForm({ onSaved }) {
  const [employeeId, setEmployeeId] = useState('');
  const [heldAt, setHeldAt] = useState(new Date().toISOString().slice(0, 10));
  const [durationMin, setDurationMin] = useState('30');
  const [topic, setTopic] = useState('');
  const [discussionNotes, setDiscussionNotes] = useState('');
  // Achievements/Blockers/Feedback are plain open boxes, typed directly —
  // per a direct follow-up request, reverted from the AI-draft-first flow
  // (the /connect-extract endpoint that used to fill these still exists
  // and works, just isn't called from this form anymore).
  const [achievements, setAchievements] = useState('');
  const [blockers, setBlockers] = useState('');
  const [feedback, setFeedback] = useState('');
  const [team, setTeam] = useState(null);
  const [kraOptions, setKraOptions] = useState([]);
  const [kraIds, setKraIds] = useState([]);
  // "Connect Cadence / Progress this cycle / Next due" header, per the
  // reference screenshot — meaningful once an employee is picked, since
  // it's cadence tracking FOR that specific report. Calculated from the
  // Date field entered per connect (held_at) — see connect-reminders.js's
  // computeCadenceProgress.
  const [cadence, setCadence] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { api('/pms/team/evaluations').then(r => setTeam(r.team || [])).catch(() => setTeam([])); }, []);

  useEffect(() => {
    setKraIds([]); setCadence(null);
    if (!employeeId) { setKraOptions([]); return; }
    api(`/pms/connects/kra-options/${employeeId}`).then(r => setKraOptions(r.kras || [])).catch(() => setKraOptions([]));
    api(`/pms/connects/cadence/${employeeId}`).then(setCadence).catch(() => setCadence(null));
  }, [employeeId]);

  const toggleKra = (id) => setKraIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);

  const save = async () => {
    setErr(null);
    if (!employeeId || !heldAt) { setErr('Employee and date are required.'); return; }
    try {
      await api('/pms/connects', {
        method: 'POST',
        body: JSON.stringify({
          employee_id: employeeId, held_at: heldAt, duration_min: durationMin || null, topic, discussion_notes: discussionNotes,
          achievements, blockers, feedback, kra_ids: kraIds,
        }),
      });
      onSaved();
    } catch (e) { setErr(e.message); }
  };

  return (
    <div className="card p-4 space-y-3">
      <div className="grid sm:grid-cols-3 gap-2">
        <select className="inp sm:col-span-1" value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
          <option value="">Select report…</option>
          {(team || []).map(t => <option key={t.employee_id} value={t.employee_id}>{t.name}</option>)}
        </select>
        <div>
          <label className="lbl">Date</label>
          <input className="inp" type="date" value={heldAt} onChange={e => setHeldAt(e.target.value)} />
        </div>
        <div>
          <label className="lbl">Duration (min)</label>
          <input className="inp" type="number" min="0" step="5" value={durationMin} onChange={e => setDurationMin(e.target.value)} />
        </div>
      </div>
      <div>
        <label className="lbl">Topic (optional)</label>
        <input className="inp" value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. Mid-quarter check-in" />
      </div>
      {employeeId && cadence && (
        <div className="grid sm:grid-cols-3 gap-2 bg-navy-50 rounded-xl p-3 text-xs">
          <div>
            <p className="lbl mb-0.5">Connect Cadence</p>
            <p className="font-semibold text-navy-700">Quarterly</p>
            <p className="text-navy-400">Every {cadence.cadence_days} days · {cadence.expected_total} expected this cycle</p>
          </div>
          <div>
            <p className="lbl mb-0.5">Progress this cycle</p>
            <p className={`font-semibold ${cadence.on_track ? 'text-emerald-700' : 'text-amber-700'}`}>{cadence.logged_count} of {cadence.expected_so_far} expected so far</p>
            <p className="text-navy-400">{cadence.on_track ? 'On track' : 'Behind'}</p>
          </div>
          <div>
            <p className="lbl mb-0.5">Next due</p>
            <p className="font-semibold text-navy-700">{new Date(cadence.next_due).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}</p>
          </div>
        </div>
      )}
      {employeeId && kraOptions.length > 0 && (
        <div>
          <label className="lbl">Link to KRA(s)</label>
          <div className="flex flex-wrap gap-1.5">
            {kraOptions.map(k => (
              <button key={k.id} type="button"
                className={`chip ${kraIds.includes(k.id) ? 'bg-brand-500 text-white' : 'bg-navy-50 text-navy-600'}`}
                onClick={() => toggleKra(k.id)}>{k.title}</button>
            ))}
          </div>
        </div>
      )}
      <div>
        <label className="lbl">What was discussed?</label>
        <textarea className="inp" rows={4} placeholder="Catch-all narrative — what came up in the conversation"
          value={discussionNotes} onChange={e => setDiscussionNotes(e.target.value)} />
      </div>
      <div className="grid sm:grid-cols-3 gap-2">
        <div>
          <label className="lbl text-emerald-600">Achievements</label>
          <textarea className="inp border-emerald-200" rows={3} placeholder="What went well…" value={achievements} onChange={e => setAchievements(e.target.value)} />
        </div>
        <div>
          <label className="lbl text-amber-600">Blockers</label>
          <textarea className="inp border-amber-200" rows={3} placeholder="What's stuck…" value={blockers} onChange={e => setBlockers(e.target.value)} />
        </div>
        <div>
          <label className="lbl text-blue-600">Feedback</label>
          <textarea className="inp border-blue-200" rows={3} placeholder="Coaching / direction…" value={feedback} onChange={e => setFeedback(e.target.value)} />
        </div>
      </div>
      {err && <p className="text-xs text-rose-600">{err}</p>}
      <button className="btn-pri" onClick={save}>Save connect</button>
    </div>
  );
}

function ConnectRow({ cn, reload }) {
  const [insight, setInsight] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const signOff = async () => {
    setErr(null);
    try { await api(`/pms/connects/${cn.id}/sign-off`, { method: 'POST' }); reload(); }
    catch (e) { setErr(e.message); }
  };
  const askInsights = async () => {
    setBusy(true); setErr(null);
    try { const r = await api('/agentic/connect-insights', { method: 'POST', body: JSON.stringify({ employee_id: cn.employee_id }) }); setInsight(r); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <div className="card p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">{cn.employee_name} <span className="text-navy-400 font-normal">with {cn.manager_name}</span></p>
          <p className="text-xs text-navy-400">
            {new Date(cn.held_at).toLocaleDateString()}
            {cn.duration_min != null && ` · ${cn.duration_min} min`}
            {cn.topic && ` · ${cn.topic}`}
          </p>
        </div>
        <span className={`chip flex items-center gap-1 ${cn.signed_off ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
          {cn.signed_off ? <CheckCircle2 size={12} /> : <Clock size={12} />}{cn.signed_off ? 'Signed off' : 'Pending sign-off'}
        </span>
      </div>
      {cn.discussion_notes && <p className="text-xs text-navy-500 italic">"{cn.discussion_notes}"</p>}
      <div className="text-xs text-navy-600 space-y-1">
        {cn.achievements && <p><b className="text-navy-500">Achievements:</b> {cn.achievements}</p>}
        {cn.blockers && <p><b className="text-navy-500">Blockers:</b> {cn.blockers}</p>}
        {cn.feedback && <p><b className="text-navy-500">Feedback:</b> {cn.feedback}</p>}
        {!cn.achievements && !cn.blockers && !cn.feedback && cn.notes && <p>{cn.notes}</p>}
      </div>
      {Array.isArray(cn.kra_ids) && cn.kra_ids.length > 0 && (
        <p className="text-[11px] text-navy-400">Linked to {cn.kra_ids.length} KRA{cn.kra_ids.length === 1 ? '' : 's'}</p>
      )}
      <div className="flex gap-2">
        {!cn.signed_off && <button className="btn-sec" onClick={signOff}>Sign off</button>}
        <button className="btn-sec" disabled={busy} onClick={askInsights}><Sparkles size={12} className="inline mr-1 text-amber-500" />{busy ? 'Thinking…' : 'AI insights'}</button>
      </div>
      {insight && <AiInsightsPanel insight={insight} onRefresh={askInsights} busy={busy} />}
      {err && <p className="text-xs text-rose-600">{err}</p>}
    </div>
  );
}

// Matches a reference screenshot's layout precisely: a status badge next
// to the "AI Insights" label, an italic one-line verdict on the
// employee's progress/performance, and two columns (Themes / Suggested
// Follow-ups) rather than a flat list.
const INSIGHT_STATUS_COLOR = {
  'On Track': 'bg-emerald-100 text-emerald-700',
  Excelling: 'bg-emerald-100 text-emerald-700',
  Concerned: 'bg-amber-100 text-amber-700',
  'At Risk': 'bg-rose-100 text-rose-700',
};
function AiInsightsPanel({ insight, onRefresh, busy }) {
  return (
    <div className="bg-indigo-50/60 border border-indigo-100 rounded-xl p-4 text-xs space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles size={13} className="text-indigo-500" />
        <span className="font-bold tracking-wide text-indigo-700 text-[11px] uppercase">AI Insights</span>
        {insight.status && <span className={`chip ${INSIGHT_STATUS_COLOR[insight.status] || 'bg-navy-50 text-navy-600'}`}>{insight.status}</span>}
        <button className="ml-auto text-indigo-500 font-semibold flex items-center gap-1" disabled={busy} onClick={onRefresh}>
          <Sparkles size={11} />refresh
        </button>
      </div>
      {insight.headline && <p className="italic text-navy-700">"{insight.headline}"</p>}
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <p className="font-bold text-indigo-700 text-[11px] uppercase tracking-wide mb-1">Themes</p>
          <div className="space-y-1">
            {(insight.themes || []).map((t, i) => (
              <p key={i}>• <b>{t.name}</b>{t.summary ? `: ${t.summary}` : ''}{t.related_kra && <span className="text-amber-600"> (linked: {t.related_kra})</span>}</p>
            ))}
            {!(insight.themes || []).length && <p className="text-navy-400">No recurring themes yet.</p>}
          </div>
        </div>
        <div>
          <p className="font-bold text-indigo-700 text-[11px] uppercase tracking-wide mb-1">Suggested Follow-ups</p>
          <div className="space-y-1">
            {(insight.suggested_followups || []).map((f, i) => <p key={i}>→ {f}</p>)}
            {!(insight.suggested_followups || []).length && <p className="text-navy-400">Nothing specific suggested yet.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
