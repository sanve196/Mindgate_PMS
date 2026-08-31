import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../utils/api';

// The missing HR-facing screen for people.career_matrix — GET/PUT already
// existed and worked, just had no UI anywhere calling them (confirmed by
// searching the whole frontend and finding nothing). Scoped deliberately
// narrow per a follow-up conversation: add/edit/delete role bands and
// levels only. Expected-timelines and richer guardrail rules (level-skip
// prevention, time-in-role minimums) are explicit non-goals here, tracked
// as a separate follow-up rather than folded in.
export default function CareerFrameworkPage() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [form, setForm] = useState({ role_band: '', level: '', expectations: '' });
  const [saving, setSaving] = useState(false);

  const load = () => api('/people/career/matrix').then(r => setRows(r.matrix)).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);

  const save = async () => {
    setErr(null); setMsg(null);
    if (!form.role_band.trim() || !form.level.trim()) { setErr('Role band and level are both required.'); return; }
    setSaving(true);
    try {
      await api('/people/career/matrix', {
        method: 'PUT',
        body: JSON.stringify({ role_band: form.role_band.trim(), level: form.level.trim(), expectations: form.expectations.trim() || null }),
      });
      setMsg(`Saved ${form.role_band} / ${form.level}.`);
      setForm({ role_band: '', level: '', expectations: '' });
      load();
    } catch (e) { setErr(e.message); }
    setSaving(false);
  };

  const edit = (row) => setForm({ role_band: row.role_band, level: row.level, expectations: row.expectations || '' });

  const remove = async (row) => {
    setErr(null); setMsg(null);
    try {
      await api(`/people/career/matrix/${encodeURIComponent(row.role_band)}/${encodeURIComponent(row.level)}`, { method: 'DELETE' });
      load();
    } catch (e) { setErr(e.message); }
  };

  if (err && !rows) return <p className="text-sm text-rose-600">{err}</p>;
  if (!rows) return <p className="text-sm text-navy-400">Loading…</p>;

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div>
        <h2 className="text-lg font-bold">Career Framework</h2>
        <p className="text-xs text-navy-400">
          Role bands and levels employees' Career Path target roles are checked against (BR-3.2). Leave this empty and nothing is
          blocked — an unconfigured guardrail can't guard anything yet.
        </p>
      </div>

      <div className="card p-4 space-y-2">
        <p className="lbl">{form.role_band || form.level ? 'Edit entry' : 'Add a role band / level'}</p>
        <div className="grid sm:grid-cols-2 gap-2">
          <div>
            <label className="lbl">Role band</label>
            <input className="inp" value={form.role_band} onChange={e => setForm(f => ({ ...f, role_band: e.target.value }))} placeholder="e.g. L4" />
          </div>
          <div>
            <label className="lbl">Level</label>
            <input className="inp" value={form.level} onChange={e => setForm(f => ({ ...f, level: e.target.value }))} placeholder="e.g. Senior" />
          </div>
        </div>
        <div>
          <label className="lbl">Expectations (optional)</label>
          <textarea className="inp" rows={2} value={form.expectations} onChange={e => setForm(f => ({ ...f, expectations: e.target.value }))} placeholder="What this band/level is expected to own" />
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-pri" disabled={saving} onClick={save}><Plus size={13} className="inline mr-1" />{saving ? 'Saving…' : 'Save entry'}</button>
          {(form.role_band || form.level || form.expectations) && (
            <button className="btn-sec" onClick={() => setForm({ role_band: '', level: '', expectations: '' })}>Clear</button>
          )}
          {msg && <span className="text-xs text-emerald-600 font-medium">{msg}</span>}
        </div>
        {err && <p className="text-xs text-rose-600">{err}</p>}
      </div>

      {!rows.length && <div className="card p-8 text-center text-sm text-navy-400">No role bands configured yet — Career Path guardrails are currently unrestricted.</div>}
      {rows.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-navy-400 uppercase text-[10px] border-b border-navy-100">
                <th className="px-3 py-2">Role band</th><th className="px-3 py-2">Level</th>
                <th className="px-3 py-2">Expectations</th><th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={`${r.role_band}-${r.level}`} className="border-b border-navy-50">
                  <td className="px-3 py-2 font-semibold">{r.role_band}</td>
                  <td className="px-3 py-2">{r.level}</td>
                  <td className="px-3 py-2 text-navy-500">{r.expectations || '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <button className="btn-sec !p-1.5 mr-1" onClick={() => edit(r)}>Edit</button>
                    <button className="btn-sec !p-1.5 !text-rose-600 !border-rose-200" onClick={() => remove(r)}><Trash2 size={12} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
