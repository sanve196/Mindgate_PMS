import { useEffect, useState } from 'react';
import { Plus, ArrowRight, RotateCcw, Rocket, Activity, Sparkles } from 'lucide-react';
import { api, PHASES, phaseLabel, phaseColor, DraftBadge } from '../utils/api';

export default function CycleAdminPage() {
  const [cycles, setCycles] = useState(null);
  const [err, setErr] = useState(null);
  const [health, setHealth] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api('/pms/cycles').then(r => setCycles(r.cycles)).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);

  const create = async () => {
    const name = prompt('Cycle name (e.g. FY26 Annual Appraisal)'); if (!name) return;
    const fy = prompt('Fiscal year label (e.g. FY26)') || 'FY26';
    try { await api('/pms/cycles', { method: 'POST', body: JSON.stringify({ name, fiscal_year: fy }) }); load(); }
    catch (e) { setErr(e.message); }
  };
  const phase = async (c, to, rollback) => {
    setErr(null);
    try { await api(`/pms/cycles/${c.id}/phase`, { method: 'POST', body: JSON.stringify({ to, rollback }) }); load(); }
    catch (e) { setErr(e.message); }
  };
  const publish = async () => {
    if (!confirm('Publish ratings to all employees? This writes performance history and notifies everyone rated.')) return;
    setBusy(true); setErr(null);
    try {
      const r = await api('/pms/publish', { method: 'POST' });
      alert(`Published: ${r.published}. ${r.failures.length ? `Failed: ${r.failures.length} — ` + r.failures.slice(0, 3).map(f => f.reason).join('; ') : ''}`);
      load();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const cycleHealth = async () => {
    setBusy(true); setErr(null);
    try { const r = await api('/agentic/cycle-health', { method: 'POST' }); setHealth(r); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  };

  if (err && !cycles) return <p className="text-sm text-rose-600">{err}</p>;
  if (!cycles) return <p className="text-sm text-slate-400">Loading…</p>;

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold">Appraisal Cycles</h2>
        <button className="btn-pri" onClick={create}><Plus size={13} className="inline mr-1" />New cycle</button>
        <button className="btn-sec" disabled={busy} onClick={cycleHealth}><Activity size={13} className="inline mr-1" />{busy ? 'Working…' : 'Cycle health (agent)'}</button>
      </div>
      {err && <p className="text-xs text-rose-600">{err}</p>}
      {health?.draft && (
        <div className="bg-slate-900 text-slate-100 rounded-xl p-4 text-xs space-y-2">
          <div className="flex items-center gap-2"><Sparkles size={13} className="text-amber-300" /><DraftBadge /></div>
          <p className="text-sm font-semibold">{health.draft.headline}</p>
          {health.draft.bottleneck && <p><b>Bottleneck:</b> {health.draft.bottleneck}</p>}
          {(health.draft.chase_this_week || []).map((c, i) => <p key={i}>→ {c}</p>)}
          {(health.draft.caveats || []).length > 0 && <p className="text-slate-400">Caveats: {health.draft.caveats.join(' · ')}</p>}
        </div>
      )}
      {cycles.map(c => {
        const i = PHASES.indexOf(c.phase);
        const next = i >= 0 && i < PHASES.length - 1 ? PHASES[i + 1] : null;
        const prev = i > 0 ? PHASES[i - 1] : null;
        return (
          <div key={c.id} className="card p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-bold flex-1">{c.name} <span className="text-slate-400 font-normal">· {c.fiscal_year} · {c.cycle_type}</span></p>
              <span className={`chip ${phaseColor(c.phase)}`}>{phaseLabel(c.phase)}</span>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[10px]">
              {PHASES.map((p, j) => (
                <span key={p} className={`px-2 py-1 rounded ${j < i ? 'bg-emerald-50 text-emerald-600' : j === i ? 'bg-slate-800 text-white' : 'bg-stone-100 text-slate-400'}`}>{phaseLabel(p)}</span>
              ))}
            </div>
            {!['closed', 'cancelled'].includes(c.phase) && (
              <div className="flex flex-wrap gap-2">
                {next && <button className="btn-pri" onClick={() => phase(c, next, false)}><ArrowRight size={13} className="inline mr-1" />Advance to {phaseLabel(next)}</button>}
                {prev && <button className="btn-sec" onClick={() => phase(c, prev, true)}><RotateCcw size={13} className="inline mr-1" />Roll back to {phaseLabel(prev)}</button>}
                {c.phase === 'publish' && <button className="btn-pri !bg-emerald-700" disabled={busy} onClick={publish}><Rocket size={13} className="inline mr-1" />Publish ratings</button>}
              </div>
            )}
          </div>
        );
      })}
      {!cycles.length && <div className="card p-8 text-center text-sm text-slate-400">No cycles yet. Create one to begin — it starts in Draft; advance to KRA Setting when ready.</div>}
    </div>
  );
}
