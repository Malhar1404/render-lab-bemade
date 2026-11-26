import { useCallback, useEffect, useState } from 'react';

import { ApiError, listPlans, planImageUrl, setPlanStep, type Plan, type PlanImage } from './api';
import { Lightbox } from './widgets';

const doneCount = (p: Plan) => p.steps.filter((s) => s.status === 'done').length;

type Zoom = { planId: string; images: PlanImage[]; index: number };

const Thumbs = ({ planId, images, large = false, onZoom }: { planId: string; images?: PlanImage[]; large?: boolean; onZoom: (z: Zoom) => void }) =>
  images && images.length > 0 ? (
    <div className={`plan-thumbs ${large ? 'large' : ''}`}>
      {images.map((im, i) => (
        <figure key={im.file}>
          <button className="zoom" onClick={() => onZoom({ planId, images, index: i })} aria-label={`Zoom: ${im.caption ?? im.file}`}>
            <img src={planImageUrl(planId, im.file)} alt={im.caption ?? im.file} loading="lazy" />
          </button>
          {im.caption && <figcaption>{im.caption}</figcaption>}
        </figure>
      ))}
    </div>
  ) : null;

export const PlanPage = ({ planId }: { planId?: string }) => {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<Zoom | null>(null);

  const reload = useCallback(async () => {
    try {
      setPlans(await listPlans());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void reload();
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, [reload]);

  const tick = async (plan: Plan, stepId: string, done: boolean) => {
    try {
      const saved = await setPlanStep(plan.id, stepId, done ? 'done' : 'todo');
      setPlans((all) => all?.map((p) => (p.id === saved.id ? saved : p)) ?? all);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    }
  };

  if (error) {
    return (
      <div className="notice">
        <strong>Could not load the plans.</strong>
        <p>{error}</p>
      </div>
    );
  }
  if (!plans) return <p className="muted">Loading…</p>;
  if (plans.length === 0) return <p className="muted">No plans yet. Add one as devlog/plans/&lt;id&gt;.json.</p>;

  // Default to the first one (the active plan comes first).
  const plan = plans.find((p) => p.id === planId) ?? plans[0];
  const done = doneCount(plan);
  const total = plan.steps.length;

  return (
    <div className="plan-layout">
      <aside className="plan-list" aria-label="Plans">
        {plans.map((p) => (
          <a
            key={p.id}
            className={`plan-item ${p.id === plan.id ? 'on' : ''}`}
            href={`#plan/${encodeURIComponent(p.id)}`}
            aria-current={p.id === plan.id ? 'page' : undefined}
          >
            <strong>{p.title}</strong>
            <span className="muted">
              {doneCount(p)}/{p.steps.length} done · {p.status}
            </span>
          </a>
        ))}
      </aside>

      <article className="plan">
        <h1>{plan.title}</h1>
        <div className="plan-progress">
          <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
            <div style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
          </div>
          <span>
            {done} of {total} done
          </span>
        </div>

        {(plan.goal || plan.target?.length) && (
          <section className="plan-sec">
            <h2>Goal</h2>
            {plan.goal && <p>{plan.goal}</p>}
            <Thumbs planId={plan.id} images={plan.target} large onZoom={setZoom} />
          </section>
        )}

        <section className="plan-sec">
          <h2>Checklist</h2>
          <ul className="plan-steps">
            {plan.steps.map((s) => (
              <li key={s.id} className={`plan-step ${s.status}`}>
                <label>
                  <input type="checkbox" checked={s.status === 'done'} onChange={(e) => void tick(plan, s.id, e.target.checked)} />
                  <span className="plan-step-title">{s.title}</span>
                  {(s.status === 'doing' || s.status === 'next') && <span className={`plan-pill ${s.status}`}>{s.status}</span>}
                </label>
                <Thumbs planId={plan.id} images={s.images} onZoom={setZoom} />
              </li>
            ))}
          </ul>
        </section>

        {plan.decisions && plan.decisions.length > 0 && (
          <section className="plan-sec">
            <h2>Decisions</h2>
            <ul className="plan-decisions">
              {plan.decisions.map((d, i) => (
                <li key={i}>
                  {d.text}
                  <Thumbs planId={plan.id} images={d.images} onZoom={setZoom} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>

      {zoom && (
        <Lightbox
          id={zoom.planId}
          images={zoom.images}
          index={zoom.index}
          urlFor={(file) => planImageUrl(zoom.planId, file)}
          onChange={(i) => setZoom({ ...zoom, index: i })}
          onClose={() => setZoom(null)}
        />
      )}
    </div>
  );
};
