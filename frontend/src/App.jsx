import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { Target, ClipboardList, Users, Landmark, Sparkles, BarChart3, HeartHandshake, Star, LogOut, Upload, User, ShieldAlert, Award, Grid3x3, TrendingUp } from 'lucide-react';
import { api } from './utils/api';
import MyKRASheetPage from './pages/MyKRASheetPage';
import SelfAppraisalPage from './pages/SelfAppraisalPage';
import TeamEvalPage from './pages/TeamEvalPage';
import HodQueuePage from './pages/HodQueuePage';
import CycleAdminPage from './pages/CycleAdminPage';
import CalibrationPage from './pages/CalibrationPage';
import MyRatingPage from './pages/MyRatingPage';
import EngagementPage from './pages/EngagementPage';
import PeopleHubPage from './pages/PeopleHubPage';
import DirectoryPage from './pages/DirectoryPage';
import PIPPage from './pages/PIPPage';
import WatchlistPage from './pages/WatchlistPage';
import NotificationBell from './pages/NotificationBell';
import NineBoxPage from './pages/NineBoxPage';
import MyGrowthPage from './pages/MyGrowthPage';
import KraOrgOverviewPage from './pages/KraOrgOverviewPage';

const NAV = [
  { group: 'My Performance', items: [
    { to: '/my/kras', label: 'My KRAs', icon: Target },
    { to: '/my/self-appraisal', label: 'Self-Appraisal', icon: ClipboardList },
    { to: '/my/rating', label: 'My Rating', icon: Star },
    { to: '/my/growth', label: 'My Growth', icon: TrendingUp },
  ]},
  { group: 'Team', items: [
    { to: '/team/eval', label: 'Team Evaluation', icon: Users },
    { to: '/hod', label: 'HOD Review', icon: Landmark },
    { to: '/pip', label: 'Improvement Plans', icon: ShieldAlert },
  ]},
  { group: 'HR Admin', items: [
    { to: '/admin/cycles', label: 'Cycles', icon: BarChart3 },
    { to: '/admin/calibration', label: 'Calibration', icon: Sparkles },
    { to: '/admin/directory', label: 'Employees', icon: Upload },
    { to: '/admin/kra-overview', label: 'KRA Overview', icon: ClipboardList },
    { to: '/admin/watchlist', label: 'Super 50', icon: Award },
    { to: '/admin/nine-box', label: '9-Box Grid', icon: Grid3x3 },
  ]},
  { group: 'Engagement & People', items: [
    { to: '/engagement', label: 'Engagement', icon: HeartHandshake },
    { to: '/people', label: 'People Hub', icon: User },
  ]},
];

export default function App() {
  const [user, setUser] = useState(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    const t = localStorage.getItem('apms_token');
    if (!t) { setChecked(true); return; }
    api('/me').then(r => setUser(r.user)).catch(() => localStorage.removeItem('apms_token')).finally(() => setChecked(true));
  }, []);
  if (!checked) return null;
  if (!user) return <Login onUser={setUser} />;
  return (
    <BrowserRouter>
      <div className="min-h-screen lg:flex">
        <aside className="lg:w-56 lg:shrink-0 bg-white border-b lg:border-b-0 lg:border-r border-stone-200">
          <div className="px-4 py-4 flex items-center justify-between">
            <h1 className="text-base font-bold flex items-center gap-2"><Sparkles size={16} className="text-amber-500" /> Agentic PMS</h1>
            <div className="flex items-center gap-1">
              <NotificationBell />
              <button className="lg:hidden btn-sec" onClick={() => { localStorage.removeItem('apms_token'); location.href = '/'; }}><LogOut size={12} /></button>
            </div>
          </div>
          <nav className="px-2 pb-4 flex lg:block overflow-x-auto gap-1">
            {NAV.map(g => (
              <div key={g.group} className="lg:mb-3 flex lg:block gap-1">
                <p className="hidden lg:block px-2 text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">{g.group}</p>
                {g.items.map(it => (
                  <NavLink key={it.to} to={it.to}
                    className={({ isActive }) => `flex items-center gap-2 px-3 py-2 rounded-lg text-sm whitespace-nowrap ${isActive ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-stone-100'}`}>
                    <it.icon size={14} />{it.label}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
          <div className="hidden lg:block px-4 py-3 border-t border-stone-100 text-xs text-slate-500">
            {user.name} · {user.role}
            <button className="block mt-1 text-amber-700 font-medium" onClick={() => { localStorage.removeItem('apms_token'); location.href = '/'; }}>Sign out</button>
          </div>
        </aside>
        <main className="flex-1 min-w-0 p-4 lg:p-6">
          <Routes>
            <Route path="/" element={<Navigate to="/my/kras" replace />} />
            <Route path="/my/kras" element={<MyKRASheetPage />} />
            <Route path="/my/self-appraisal" element={<SelfAppraisalPage />} />
            <Route path="/my/rating" element={<MyRatingPage />} />
            <Route path="/my/growth" element={<MyGrowthPage />} />
            <Route path="/team/eval" element={<TeamEvalPage user={user} />} />
            <Route path="/hod" element={<HodQueuePage />} />
            <Route path="/pip" element={<PIPPage />} />
            <Route path="/admin/cycles" element={<CycleAdminPage />} />
            <Route path="/admin/calibration" element={<CalibrationPage />} />
            <Route path="/admin/directory" element={<DirectoryPage />} />
            <Route path="/admin/kra-overview" element={<KraOrgOverviewPage />} />
            <Route path="/admin/watchlist" element={<WatchlistPage />} />
            <Route path="/admin/nine-box" element={<NineBoxPage />} />
            <Route path="/engagement" element={<EngagementPage />} />
            <Route path="/people" element={<PeopleHubPage user={user} />} />
            <Route path="*" element={<Navigate to="/my/kras" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

function Login({ onUser }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [err, setErr] = useState(null);
  const go = async () => {
    setErr(null);
    try {
      const r = await api('/auth/dev-login', { method: 'POST', body: JSON.stringify({ email, password }) });
      localStorage.setItem('apms_token', r.token); onUser(r.user);
    } catch (e) { setErr(e.message); }
  };
  return (
    <div className="max-w-xs mx-auto mt-[14vh] flex flex-col gap-3">
      <h1 className="text-lg font-bold flex items-center gap-2"><Sparkles size={18} className="text-amber-500" /> Agentic PMS</h1>
      <input className="inp" placeholder="email" value={email} onChange={e => setEmail(e.target.value)} />
      <input className="inp" type="password" placeholder="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} />
      {err && <p className="text-xs text-rose-600">{err}</p>}
      <button className="btn-pri" onClick={go}>Sign in</button>
      <p className="text-[11px] text-slate-400">Production instances sign in with your organisation's identity provider.</p>
    </div>
  );
}
