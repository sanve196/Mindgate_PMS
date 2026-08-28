import { useEffect, useState } from 'react';
import { Plus, CheckCircle2, Clock, Sparkles } from 'lucide-react';
import { api, DraftBadge } from '../utils/api';

export default function ConnectsPage() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const load = () => api('/pms/connects').then(r => setData(r.connects)).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);

  if (err) return <p className="text-sm text-rose-600">{err}</p>;
  if (!data) return <p className="text-sm text-navy-400">Loading…</p>;

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-bold">Quarterly Connects</h2>
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
  const [notes, setNotes] = useState('');
  const [team, setTeam] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { api('/pms/team/evaluations').then(r => setTeam(r.team || [])).catch(() => setTeam([])); }, []);

  const save = async () => {
    setErr(null);
    if (!employeeId || !heldAt) { setErr('Employee and date are required.'); return; }
    try { await api('/pms/connects', { method: 'POST', body: JSON.stringify({ employee_id: employeeId, held_at: heldAt, notes }) }); onSaved(); }
    catch (e) { setErr(e.message); }
  };

  return (
    <div className="card p-4 space-y-2">
      <div className="flex gap-2">
        <select className="inp" value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
          <option value="">Select report…</option>
          {(team || []).map(t => <option key={t.employee_id} value={t.employee_id}>{t.name}</option>)}
        </select>
        <input className="inp w-40" type="date" value={heldAt} onChange={e => setHeldAt(e.target.value)} />
      </div>
      <textarea className="inp" rows={3} placeholder="Achievements, blockers, feedback…" value={notes} onChange={e => setNotes(e.target.value)} />
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
          <p className="text-xs text-navy-400">{new Date(cn.held_at).toLocaleDateString()}</p>
        </div>
        <span className={`chip flex items-center gap-1 ${cn.signed_off ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
          {cn.signed_off ? <CheckCircle2 size={12} /> : <Clock size={12} />}{cn.signed_off ? 'Signed off' : 'Pending sign-off'}
        </span>
      </div>
      {cn.notes && <p className="text-xs text-navy-600">{cn.notes}</p>}
      <div className="flex gap-2">
        {!cn.signed_off && <button className="btn-sec" onClick={signOff}>Sign off</button>}
        <button className="btn-sec" disabled={busy} onClick={askInsights}><Sparkles size={12} className="inline mr-1 text-amber-500" />{busy ? 'Thinking…' : 'AI insights'}</button>
      </div>
      {insight && (
        <div className="bg-navy-800 text-slate-100 rounded-lg p-3 text-xs space-y-2">
          <DraftBadge />
          {(insight.themes || []).map((t, i) => (
            <p key={i}>• <b>{t.name}</b>: {t.summary}{t.related_kra && <span className="text-amber-300"> (linked: {t.related_kra})</span>}</p>
          ))}
          {insight.sentiment_trend && <p className="text-cyan-300">Trend: {insight.sentiment_trend}</p>}
          {(insight.suggested_followups || []).length > 0 && <p><b>Follow-ups:</b> {insight.suggested_followups.join(' · ')}</p>}
        </div>
      )}
      {err && <p className="text-xs text-rose-600">{err}</p>}
    </div>
  );
}
