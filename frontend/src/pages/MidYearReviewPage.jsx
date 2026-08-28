import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Clock } from 'lucide-react';
import { api } from '../utils/api';

export default function MidYearReviewPage() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { api('/pms/my/midyear-review').then(setData).catch(e => setErr(e.message)); }, []);

  if (err) return <p className="text-sm text-rose-600">{err}</p>;
  if (!data) return <p className="text-sm text-navy-400">Loading…</p>;
  if (!data.cycle) return <div className="card p-8 text-center text-sm text-navy-400">No active mid-year cycle.</div>;

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-bold">Mid-Year Review</h2>
        <span className="chip bg-cyan-100 text-cyan-700">{data.cycle.name}</span>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <SignOffCard title="Your sign-off" party={data.self} ratingLabel="Self rating" rating={data.self.overall_self_rating}
          narratives={[['Went well', data.self.went_well], ['Could improve', data.self.could_improve]]}
          editHref="/my/self-appraisal" editLabel="Go to Self-Appraisal" />
        <SignOffCard title="Manager sign-off" party={data.manager} ratingLabel="Manager rating" rating={data.manager.overall_rating}
          narratives={[['Strengths', data.manager.strengths], ['Improvement areas', data.manager.improvement_areas]]} />
      </div>

      <p className="text-xs text-navy-400">Both sides sign off independently — each is tracked as Pending or Signed until they submit their half.</p>
    </div>
  );
}

function SignOffCard({ title, party, ratingLabel, rating, narratives, editHref, editLabel }) {
  const signed = party.sign_off === 'Signed';
  return (
    <div className="card p-4 space-y-2">
      <div className="flex items-center justify-between">
        <p className="font-bold text-sm">{title}</p>
        <span className={`chip flex items-center gap-1 ${signed ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
          {signed ? <CheckCircle2 size={12} /> : <Clock size={12} />}{party.sign_off}
        </span>
      </div>
      {rating != null && <p className="text-xs">{ratingLabel}: <span className="font-mono font-semibold">{rating}</span></p>}
      {narratives.map(([label, text]) => text && <p key={label} className="text-xs"><b>{label}:</b> {text}</p>)}
      {!signed && party.status === 'not_started' && <p className="text-xs text-navy-400">Not started yet.</p>}
      {editHref && !signed && <Link to={editHref} className="btn-sec inline-block !py-1 !text-[11px]">{editLabel}</Link>}
    </div>
  );
}
