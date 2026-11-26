import { useState, type MouseEvent, type ReactNode } from 'react';

import { imageUrl } from './api';
import { firstLine } from './markup';
import { ancestors, neighbours, stepLabel, type Index } from './tree';
import { kindOf, type Entry, type TechKind } from './types';
import { BeforeAfter, Lightbox, OUTCOME_ICON, OutcomeBadge, Rich } from './widgets';

export const dateLabel = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
};

const isPlain = (v: unknown): v is string | number | boolean | null =>
  v === null || ['string', 'number', 'boolean'].includes(typeof v);

const MetaTable = ({ meta }: { meta: Record<string, unknown> }) => (
  <table className="meta">
    <tbody>
      {Object.entries(meta).map(([key, value]) => (
        <tr key={key}>
          <th scope="row">{key}</th>
          <td>{isPlain(value) ? String(value) : <pre>{JSON.stringify(value, null, 2)}</pre>}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

const KIND_WORD = { topic: 'Topic', step: 'Step', sub: 'Sub-task' } as const;
const TECH_WORD: Record<TechKind, string> = { library: 'Library', tool: 'Tool', method: 'Method' };

const Section = ({ id, title, hint, children, className = '' }: { id: string; title: string; hint?: string; children: ReactNode; className?: string }) => (
  <section className={`dl-sec ${className}`} aria-labelledby={`sec-${id}`}>
    <h2 id={`sec-${id}`}>
      {title}
      {hint && <em>{hint}</em>}
    </h2>
    {children}
  </section>
);

export const Detail = ({
  entry,
  index,
  onOpen,
  onEdit,
  onDelete,
  panel = false,
}: {
  entry: Entry;
  /** Lookups for the related entries. */
  index: Index;
  /** In the board's side panel this selects the card; on the full page it follows the link. */
  onOpen?: (id: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  panel?: boolean;
}) => {
  const [zoom, setZoom] = useState<number | null>(null);
  const images = entry.images ?? [];
  const kind = kindOf(entry);
  const label = stepLabel(index, entry);

  // Exactly one before and one after: show them as a slider, the rest as a gallery.
  const befores = images.filter((i) => i.kind === 'before');
  const afters = images.filter((i) => i.kind === 'after');
  const pair = befores.length === 1 && afters.length === 1 ? { before: befores[0], after: afters[0] } : null;
  const gallery = pair ? images.filter((i) => i !== pair.before && i !== pair.after) : images;
  const hasBeforeAfter = !!(entry.beforeText || entry.afterText || pair);

  const crumbs = ancestors(index, entry);
  const children = index.children.get(entry.id) ?? [];
  const { prev, next } = neighbours(index, entry);
  const needed = (entry.follows ?? []).map((id) => index.byId.get(id)).filter((e): e is Entry => !!e);
  const neededBy = index.neededBy.get(entry.id) ?? [];
  const linksOut = (entry.links ?? []).map((l) => ({ e: index.byId.get(l.id), label: l.label })).filter((l): l is { e: Entry; label: string } => !!l.e);
  const linksIn = (index.linkedFrom.get(entry.id) ?? []).map((l) => ({ e: l.entry, label: l.label }));
  const hasRelated = crumbs.length || children.length || prev || next || needed.length || neededBy.length || linksOut.length || linksIn.length;
  const hasSettings = !!(entry.files?.length || entry.commit || (entry.meta && Object.keys(entry.meta).length));

  const Ref = ({ to, children: content }: { to: Entry; children?: ReactNode }) => (
    <a
      className="ref"
      href={`#${to.id}`}
      onClick={(ev: MouseEvent) => {
        if (onOpen && panel && !ev.metaKey && !ev.ctrlKey) {
          ev.preventDefault();
          onOpen(to.id);
        }
      }}
    >
      <span className={`ref-dot outcome-${to.outcome}`} aria-hidden="true">
        {OUTCOME_ICON[to.outcome]}
      </span>
      {content ?? to.title}
    </a>
  );

  return (
    <article className={`detail ${panel ? 'is-panel' : ''}`}>
      <header className="detail-head">
        {crumbs.length > 0 && (
          <nav className="crumbs" aria-label="Where this sits">
            {crumbs.map((c) => (
              <span key={c.id}>
                <Ref to={c} /> <span aria-hidden="true">›</span>{' '}
              </span>
            ))}
          </nav>
        )}
        <div className="detail-meta">
          <span className={`kind-chip kind-${kind}`}>{KIND_WORD[kind]}{label ? ` ${label}` : ''}</span>
          <OutcomeBadge outcome={entry.outcome} />
          <span className="area">{entry.area}</span>
          <span>
            {dateLabel(entry.date)}
            {entry.time && `, ${entry.time}`}
          </span>
          <span className={`author ${entry.author}`}>{entry.author === 'user' ? 'Added by you' : 'Added by Claude'}</span>
        </div>
        <h1>{entry.title}</h1>
        {entry.tags && entry.tags.length > 0 && (
          <div className="tags">
            {entry.tags.map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
          </div>
        )}
        <div className="actions">
          <button className="btn" onClick={onEdit}>
            Edit
          </button>
          <button
            className="btn danger"
            onClick={() => {
              if (window.confirm(`Delete "${entry.title}" and its images? This cannot be undone.`)) onDelete();
            }}
          >
            Delete
          </button>
        </div>
      </header>

      <Section id="line" title="In one line" className="one-line">
        <p>{entry.summary ?? firstLine(entry.what)}</p>
      </Section>

      <Section id="wwh" title="What, why and how" className="wwh">
        <div className="wwh-grid">
          <div className="wwh-card">
            <h3>What we did</h3>
            <Rich text={entry.what} />
          </div>
          {entry.why && (
            <div className="wwh-card">
              <h3>Why we did it</h3>
              <Rich text={entry.why} />
            </div>
          )}
          {entry.how && (
            <div className="wwh-card">
              <h3>How we did it</h3>
              <Rich text={entry.how} />
            </div>
          )}
        </div>
      </Section>

      {hasBeforeAfter && (
        <Section id="ba" title="Before → After">
          <div className="ba-layout">
            <div className="ba-text">
              <div className="ba-card before">
                <h3>Before</h3>
                {entry.beforeText ? <Rich text={entry.beforeText} /> : <p className="muted">See the picture.</p>}
              </div>
              <div className="ba-arrow" aria-hidden="true">
                ↓
              </div>
              <div className="ba-card after">
                <h3>After</h3>
                {entry.afterText ? <Rich text={entry.afterText} /> : <p className="muted">See the picture.</p>}
              </div>
            </div>
            {pair && (
              <div className="ba-media">
                <BeforeAfter id={entry.id} before={pair.before} after={pair.after} />
              </div>
            )}
          </div>
        </Section>
      )}

      {gallery.length > 0 && (
        <Section id="pics" title="Pictures">
          <div className="gallery">
            {gallery.map((im) => (
              <figure key={im.file}>
                <button className="zoom" onClick={() => setZoom(images.indexOf(im))} aria-label={`Zoom: ${im.caption ?? im.file}`}>
                  <img src={imageUrl(entry.id, im.file)} alt={im.caption ?? im.file} loading="lazy" />
                </button>
                <figcaption>
                  {im.kind && <span className="kind">{im.kind}</span>}
                  {im.caption}
                </figcaption>
              </figure>
            ))}
          </div>
        </Section>
      )}

      {(entry.wrong || entry.fix) && (
        <Section id="fix" title="Problems and fixes">
          <div className="pf-grid">
            {entry.wrong && (
              <div className="pf-box wrong">
                <h3>✗ What went wrong</h3>
                <Rich text={entry.wrong} />
              </div>
            )}
            {entry.fix && (
              <div className="pf-box fix">
                <h3>✓ How we fixed it</h3>
                <Rich text={entry.fix} />
              </div>
            )}
          </div>
        </Section>
      )}

      {entry.next && (
        <Section id="next" title="What comes next">
          <div className="pf-box next">
            <Rich text={entry.next} />
          </div>
        </Section>
      )}

      {entry.tech && entry.tech.length > 0 && (
        <Section id="tech" title="Tech used" hint="in plain words">
          <ul className="tech-grid">
            {entry.tech.map((t) => (
              <li key={t.name} className="tech-card">
                <div className="tech-top">
                  <strong>{t.name}</strong>
                  <span className={`tech-kind tech-${t.kind}`}>{TECH_WORD[t.kind]}</span>
                </div>
                <p>{t.plain}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {hasRelated ? (
        <Section id="related" title="Related">
          <div className="related">
            {crumbs.length > 0 && (
              <div className="rel-group">
                <h3>Part of</h3>
                <ul>
                  {[...crumbs].reverse().map((c) => (
                    <li key={c.id}>
                      <Ref to={c} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {children.length > 0 && (
              <div className="rel-group">
                <h3>{kind === 'topic' ? 'Steps in this topic' : 'Sub-tasks'}</h3>
                <ul>
                  {children.map((c) => (
                    <li key={c.id}>
                      <Ref to={c}>
                        {stepLabel(index, c) && <b className="rel-num">{stepLabel(index, c)}</b>} {c.title}
                      </Ref>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(prev || next) && (
              <div className="rel-group">
                <h3>Steps before and after</h3>
                <ul>
                  {prev && (
                    <li>
                      <span className="rel-tag">done just before</span> <Ref to={prev} />
                    </li>
                  )}
                  {next && (
                    <li>
                      <span className="rel-tag">done right after</span> <Ref to={next} />
                    </li>
                  )}
                </ul>
              </div>
            )}
            {needed.length > 0 && (
              <div className="rel-group">
                <h3>Needed first</h3>
                <ul>
                  {needed.map((n) => (
                    <li key={n.id}>
                      <Ref to={n} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {neededBy.length > 0 && (
              <div className="rel-group">
                <h3>Other work that needed this</h3>
                <ul>
                  {neededBy.map((n) => (
                    <li key={n.id}>
                      <Ref to={n} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(linksOut.length > 0 || linksIn.length > 0) && (
              <div className="rel-group">
                <h3>Red strings</h3>
                <ul>
                  {linksOut.map((l) => (
                    <li key={`o-${l.e.id}`}>
                      <span className="rel-string">{l.label}</span> <Ref to={l.e} />
                    </li>
                  ))}
                  {linksIn.map((l) => (
                    <li key={`i-${l.e.id}`}>
                      <Ref to={l.e} /> <span className="rel-string">{l.label}</span> <span className="muted">(pointing here)</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Section>
      ) : null}

      <details className="dl-sec settings">
        <summary>
          <h2>Files and settings</h2>
          <em>for the technical details</em>
        </summary>
        {hasSettings ? (
          <>
            {entry.files && entry.files.length > 0 && (
              <>
                <h3>Files</h3>
                <ul className="files">
                  {entry.files.map((f) => (
                    <li key={f}>
                      <code>{f}</code>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {entry.commit && (
              <>
                <h3>Commit</h3>
                <p>
                  <code>{entry.commit}</code>
                </p>
              </>
            )}
            {entry.meta && Object.keys(entry.meta).length > 0 && (
              <>
                <h3>Settings and numbers</h3>
                <MetaTable meta={entry.meta} />
              </>
            )}
          </>
        ) : (
          <p className="muted">No files, commit or settings were recorded.</p>
        )}
        <p className="entry-id">
          Entry id: <code>{entry.id}</code>
        </p>
      </details>

      {zoom !== null && <Lightbox id={entry.id} images={images} index={zoom} onChange={setZoom} onClose={() => setZoom(null)} />}
    </article>
  );
};
