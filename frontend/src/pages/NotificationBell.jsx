import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { api } from '../utils/api';

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [err, setErr] = useState(null);
  const ref = useRef(null);

  const load = () => api('/notifications').then(r => setItems(r.notifications)).catch(e => setErr(e.message));
  useEffect(() => {
    load();
    const t = setInterval(load, 60000); // simple poll — no push channel exists yet
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const unread = items.filter(i => !i.read_at).length;

  const markRead = async (id) => {
    try { await api(`/notifications/${id}/read`, { method: 'POST' }); load(); } catch { /* non-critical */ }
  };

  return (
    <div className="relative" ref={ref}>
      <button className="relative p-2 rounded-lg hover:bg-stone-100" onClick={() => setOpen(o => !o)} aria-label="Notifications">
        <Bell size={16} className="text-slate-500" />
        {unread > 0 && <span className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-rose-500 text-white text-[9px] leading-4 text-center font-bold">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-80 max-h-96 overflow-y-auto bg-white border border-stone-200 rounded-lg shadow-lg z-20">
          <div className="px-3 py-2 border-b border-stone-100 text-xs font-bold text-slate-500 uppercase tracking-wide">Notifications</div>
          {err && <p className="p-3 text-xs text-rose-600">{err}</p>}
          {!err && !items.length && <p className="p-4 text-xs text-slate-400 text-center">Nothing yet.</p>}
          {items.map(n => (
            <a key={n.id} href={n.link || '#'} onClick={() => !n.read_at && markRead(n.id)}
              className={`block px-3 py-2 border-b border-stone-50 last:border-0 hover:bg-stone-50 ${!n.read_at ? 'bg-amber-50/50' : ''}`}>
              <p className="text-xs font-semibold">{n.title}</p>
              {n.body && <p className="text-[11px] text-slate-500 mt-0.5">{n.body}</p>}
              <p className="text-[10px] text-slate-400 mt-0.5">{new Date(n.created_at).toLocaleString()}</p>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
