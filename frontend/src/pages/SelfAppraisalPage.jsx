import { useEffect, useRef, useState } from 'react';
import { Send, Paperclip, Trash2, Download } from 'lucide-react';
import { api, phaseLabel, phaseColor, API_BASE } from '../utils/api';

export default function SelfAppraisalPage() {
  const [data, setData] = useState(null);
  const [entries, setEntries] = useState({});
  const [f, setF] = useState({ went_well: '', could_improve: '' });
  const [state, setState] = useState('idle');
  const [err, setErr] = useState(null);
  const timer = useRef(null);

  useEffect(() => {
    api('/pms/my/self-appraisal').then(r => {
      setData(r);
      if (r.appraisal) { setEntries(r.appraisal.entries || {}); setF({ went_well: r.appraisal.went_well || '', could_improve: r.appraisal.could_improve || '' }); }
    }).catch(e => setErr(e.message));
  }, []);

  const persist = async (patch) => {
    setState('saving');
    try { await api('/pms/my/self-appraisal', { method: 'PUT', body: JSON.stringify(patch) }); setState('saved'); }
    catch (e) { setState('error'); setErr(e.message); }
  };
  const queue = (patch) => {
    setState('dirty');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => persist(patch), 1200);
  };
  const setEntry = (kraId, k) => (e) => {
    const next = { ...entries, [kraId]: { ...(entries[kraId] || {}), [k]: e.target.value } };
    setEntries(next); queue({ entries: next });
  };
  const setField = (k) => (e) => { const next = { ...f, [k]: e.target.value }; setF(next); queue({ [k]: e.target.value }); };

  if (err && !data) return <p className="text-sm text-rose-600">{err}</p>;
  if (!data) return <p className="text-sm text-navy-400">Loading…</p>;
  if (!data.cycle) return <div className="card p-8 text-center text-sm text-navy-400">No active cycle.</div>;

  const a = data.appraisal;
  const open = data.cycle.phase === 'self_appraisal' && a.status !== 'submitted';
  const badge = { idle: null, dirty: ['Unsaved…', 'text-navy-400'], saving: ['Saving…', 'text-amber-600'], saved: ['Saved ✓', 'text-emerald-600'], error: ['Save failed', 'text-rose-600'] }[state];

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold">Self-Appraisal</h2>
        <span className={`chip ${phaseColor(data.cycle.phase)}`}>{data.cycle.name} · {phaseLabel(data.cycle.phase)}</span>
        {a.status === 'submitted' && <span className="chip bg-emerald-100 text-emerald-700">submitted — locked</span>}
        {badge && <span className={`text-[11px] font-medium ${badge[1]}`}>{badge[0]}</span>}
      </div>
      {err && <p className="text-xs text-rose-600">{err}</p>}
      {!data.kras.length && <div className="card p-4 text-sm text-amber-700 bg-amber-50 border-amber-200">No approved KRAs found — complete KRA setting first.</div>}
      {data.kras.map(k => (
        <div key={k.id} className="card p-3 space-y-2">
          <div className="flex justify-between items-baseline">
            <p className="text-sm font-semibold">{k.title}</p>
            <span className="text-[11px] text-navy-400">{k.weight}%</span>
          </div>
          <textarea className="inp" rows={3} placeholder="What you achieved against this KRA — be specific, name evidence"
            value={(entries[k.id] || {}).narrative || ''} onChange={setEntry(k.id, 'narrative')} disabled={!open} />
        </div>
      ))}
      <div className="card p-3 space-y-2">
        <label className="lbl">What went well this cycle</label>
        <textarea className="inp" rows={3} value={f.went_well} onChange={setField('went_well')} disabled={!open} />
        <label className="lbl">What could improve</label>
        <textarea className="inp" rows={3} value={f.could_improve} onChange={setField('could_improve')} disabled={!open} />
      </div>
      <EvidenceSection editable={open} />
      {open && (
        <button className="btn-pri" onClick={async () => {
          try { await api('/pms/my/self-appraisal/submit', { method: 'POST' }); location.reload(); }
          catch (e) { setErr(e.message); }
        }}><Send size={13} className="inline mr-1" />Submit — locks your appraisal</button>
      )}
    </div>
  );
}

function EvidenceSection({ editable }) {
  const [files, setFiles] = useState(null);
  const [err, setErr] = useState(null);
  const load = () => api('/pms/my/self-appraisal/evidence').then(r => setFiles(r.evidence)).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);

  const onUpload = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setErr(null);
    const fd = new FormData(); fd.append('file', file);
    try { await api('/pms/my/self-appraisal/evidence', { method: 'POST', body: fd }); load(); }
    catch (err2) { setErr(err2.message); }
  };
  const remove = async (id) => {
    try { await api(`/pms/my/self-appraisal/evidence/${id}`, { method: 'DELETE' }); load(); }
    catch (e2) { setErr(e2.message); }
  };
  const token = localStorage.getItem('apms_token');

  return (
    <div className="card p-3 space-y-2">
      <label className="lbl">Supporting evidence</label>
      {(files || []).map(f => (
        <div key={f.id} className="flex items-center justify-between text-xs bg-navy-50 rounded-lg px-2 py-1.5">
          <span className="flex items-center gap-1"><Paperclip size={12} className="text-navy-400" />{f.filename} <span className="text-navy-400">({Math.round(f.file_size / 1024)} KB)</span></span>
          <span className="flex items-center gap-1">
            <a href={`${API_BASE}/pms/evidence/${f.id}/download?token=${token}`} className="btn-sec !p-1" target="_blank" rel="noreferrer"><Download size={12} /></a>
            {editable && <button className="btn-sec !p-1" onClick={() => remove(f.id)}><Trash2 size={12} /></button>}
          </span>
        </div>
      ))}
      {editable && <input type="file" onChange={onUpload} className="text-xs" />}
      {err && <p className="text-xs text-rose-600">{err}</p>}
    </div>
  );
}
