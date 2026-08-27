// Shared API client + tiny helpers for the product pages.
export const api = async (path, opts = {}) => {
  const token = localStorage.getItem('apms_token');
  const res = await fetch(`/api/v1${path}`, {
    ...opts,
    headers: {
      ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { data, status: res.status });
  return data;
};

export const PHASES = ['draft', 'kra_open', 'self_appraisal', 'manager_eval', 'hod_eval', 'calibration', 'publish', 'closed'];
export const phaseLabel = (p) => ({ draft: 'Draft', kra_open: 'KRA Setting', self_appraisal: 'Self-Appraisal', manager_eval: 'Manager Evaluation', hod_eval: 'HOD Review', calibration: 'Calibration', publish: 'Publish', closed: 'Closed', cancelled: 'Cancelled' }[p] || p);
export const phaseColor = (p) => ({ draft: 'bg-slate-100 text-slate-600', kra_open: 'bg-blue-100 text-blue-700', self_appraisal: 'bg-cyan-100 text-cyan-700', manager_eval: 'bg-amber-100 text-amber-700', hod_eval: 'bg-orange-100 text-orange-700', calibration: 'bg-purple-100 text-purple-700', publish: 'bg-emerald-100 text-emerald-700', closed: 'bg-stone-200 text-slate-600', cancelled: 'bg-rose-100 text-rose-700' }[p] || 'bg-slate-100 text-slate-600');

export function DraftBadge() {
  return <span className="chip bg-amber-100 text-amber-700">AI DRAFT — edit before use</span>;
}
