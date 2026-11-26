import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, deleteEntry, imageUrl, listEntries } from './api';
import { Board } from './board/Board';
import { Detail, dateLabel } from './Detail';
import { emptyFilters, isFiltering, matches, type Filters } from './filters';
import { Form } from './Form';
import { PlanPage } from './Plan';
import { firstLine } from './markup';
import { buildIndex } from './tree';
import { AREAS, OUTCOMES, type Area, type Entry, type Outcome } from './types';
import { OutcomeBadge } from './widgets';

/** Location hash routes: "" (board), "#timeline", "#new", "#<id>" (detail), "#<id>/edit". */
type Route = { page: 'board' } | { page: 'list' } | { page: 'plan'; id?: string } | { page: 'new' } | { page: 'detail' | 'edit'; id: string };

const parseHash = (hash: string): Route => {
  const h = decodeURIComponent(hash.replace(/^#\/?/, ''));
  if (!h || h === 'board') return { page: 'board' };
  if (h === 'timeline') return { page: 'list' };
  if (h === 'new') return { page: 'new' };
  if (h === 'plan' || h.startsWith('plan/')) return { page: 'plan', id: h.slice(5) || undefined };
  if (h.endsWith('/edit')) return { page: 'edit', id: h.slice(0, -5) };
  return { page: 'detail', id: h };
};

const useRoute = () => {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
};

const go = (hash: string) => {
  window.location.hash = hash;
};

const toggle = <T,>(set: Set<T>, value: T) => {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
};

export const DevlogApp = () => {
  const route = useRoute();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [filters, setFilters] = useState<Filters>(emptyFilters);

  const reload = useCallback(async () => {
    try {
      setEntries(await listEntries());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(String(err), true));
    }
  }, []);

  useEffect(() => {
    void reload();
    // Entries added from the command line show up when you come back to the tab.
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, [reload]);

  const current = route.page === 'detail' || route.page === 'edit' ? entries?.find((e) => e.id === route.id) : undefined;
  const index = useMemo(() => buildIndex(entries ?? []), [entries]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const tab = route.page === 'list' ? 'timeline' : route.page === 'board' ? 'board' : route.page === 'plan' ? 'plan' : null;

  useEffect(() => {
    document.title = (current ? `${current.title} - ` : '') + 'BeMade Render Lab: Dev log';
  }, [current]);

  return (
    <>
      <header className="dl-top">
        <div className="dl-top-inner">
          <h1>
            <a href="#" onClick={() => setFilters(emptyFilters())}>
              BeMade Render Lab: Dev log
            </a>
          </h1>
          <nav className="tabs" aria-label="Views">
            <a className={`tab ${tab === 'board' ? 'on' : ''}`} href="#" aria-current={tab === 'board' ? 'page' : undefined}>
              Board
            </a>
            <a className={`tab ${tab === 'timeline' ? 'on' : ''}`} href="#timeline" aria-current={tab === 'timeline' ? 'page' : undefined}>
              Timeline
            </a>
            <a className={`tab ${tab === 'plan' ? 'on' : ''}`} href="#plan" aria-current={tab === 'plan' ? 'page' : undefined}>
              Plan
            </a>
          </nav>
          <nav>
            <a className="btn primary" href="#new">
              + New entry
            </a>
            <a className="btn" href="/">
              ← Back to the lab
            </a>
          </nav>
        </div>
      </header>

      <main className={`page ${route.page === 'board' && entries && !error ? 'wide' : ''}`}>
        {error?.unreachable ? (
          <div className="notice">
            <strong>Can't reach the dev log.</strong>
            <p>
              The dev log is saved by the dev server. Run <code>npm run dev</code> in the project folder, then open{' '}
              <code>http://localhost:5180/devlog.html</code>.
            </p>
            <button className="btn" onClick={() => void reload()}>
              Try again
            </button>
          </div>
        ) : error ? (
          <div className="notice">
            <strong>Something went wrong.</strong>
            <p>{error.message}</p>
          </div>
        ) : route.page === 'plan' ? (
          <PlanPage planId={route.id} />
        ) : !entries ? (
          <p className="muted">Loading…</p>
        ) : route.page === 'new' ? (
          <div className="single">
            <Form
              entries={entries}
              onSaved={async (id) => {
                await reload();
                go(id);
              }}
              onCancel={() => go('')}
            />
          </div>
        ) : route.page === 'edit' || route.page === 'detail' ? (
          !current ? (
            <div className="single">
              <p>No entry with id <code>{route.id}</code>.</p>
              <a href="#">← Back to the board</a>
            </div>
          ) : route.page === 'edit' ? (
            <div className="single">
              <Form
                entry={current}
                entries={entries}
                onSaved={async (id) => {
                  await reload();
                  go(id);
                }}
                onCancel={() => go(current.id)}
              />
            </div>
          ) : (
            <div className="single">
              <a className="back" href="#">
                ← Back to the board
              </a>
              <Detail
                entry={current}
                index={index}
                onEdit={() => go(`${current.id}/edit`)}
                onDelete={async () => {
                  try {
                    await deleteEntry(current.id);
                    await reload();
                    go('');
                  } catch (err) {
                    window.alert(err instanceof Error ? err.message : String(err));
                  }
                }}
              />
            </div>
          )
        ) : route.page === 'board' ? (
          <Board
            entries={entries}
            filters={filters}
            setFilters={setFilters}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onEdit={(id) => go(`${id}/edit`)}
            onDelete={async (id) => {
              const entry = entries.find((e) => e.id === id);
              try {
                await deleteEntry(id);
                setSelectedId(null);
                await reload();
              } catch (err) {
                window.alert(`${entry?.title ?? id}: ${err instanceof Error ? err.message : String(err)}`);
              }
            }}
          />
        ) : (
          <Browser entries={entries} filters={filters} setFilters={setFilters} />
        )}
      </main>
    </>
  );
};

const Browser = ({
  entries,
  filters,
  setFilters,
}: {
  entries: Entry[];
  filters: Filters;
  setFilters: (f: Filters) => void;
}) => {
  const shown = useMemo(() => entries.filter((e) => matches(e, filters)), [entries, filters]);

  // Counts on each chip: what you would get by choosing it, other filters as they are.
  const counts = useMemo(() => {
    const area = new Map<Area, number>();
    const outcome = new Map<Outcome, number>();
    const tag = new Map<string, number>();
    for (const e of entries) {
      if (matches(e, filters, 'area')) area.set(e.area, (area.get(e.area) ?? 0) + 1);
      if (matches(e, filters, 'outcome')) outcome.set(e.outcome, (outcome.get(e.outcome) ?? 0) + 1);
      if (matches(e, filters, 'tag')) for (const t of e.tags ?? []) tag.set(t, (tag.get(t) ?? 0) + 1);
    }
    return { area, outcome, tag };
  }, [entries, filters]);

  const tags = useMemo(() => {
    const all = new Set<string>(filters.tags);
    counts.tag.forEach((_, t) => all.add(t));
    return [...all].sort((a, b) => (counts.tag.get(b) ?? 0) - (counts.tag.get(a) ?? 0) || a.localeCompare(b));
  }, [counts.tag, filters.tags]);

  const days = useMemo(() => {
    const groups: { date: string; items: Entry[] }[] = [];
    for (const e of shown) {
      const last = groups[groups.length - 1];
      if (last?.date === e.date) last.items.push(e);
      else groups.push({ date: e.date, items: [e] });
    }
    return groups;
  }, [shown]);

  return (
    <div className="browser">
      <aside className="filters" aria-label="Filters">
        <input
          type="search"
          className="search"
          placeholder="Search everything"
          value={filters.q}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
          aria-label="Search"
        />
        <p className="result-count">
          {shown.length === entries.length ? `${entries.length} entries` : `${shown.length} of ${entries.length} entries`}
          {isFiltering(filters) && (
            <button className="link" onClick={() => setFilters(emptyFilters())}>
              Clear
            </button>
          )}
        </p>

        <h2>Area</h2>
        <div className="chips">
          {AREAS.map((a) => (
            <button
              key={a}
              className={`chip ${filters.areas.has(a) ? 'on' : ''}`}
              aria-pressed={filters.areas.has(a)}
              onClick={() => setFilters({ ...filters, areas: toggle(filters.areas, a) })}
            >
              {a} <span>{counts.area.get(a) ?? 0}</span>
            </button>
          ))}
        </div>

        <h2>Dates</h2>
        <div className="date-range">
          <label>
            From
            <input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
          </label>
          <label>
            To
            <input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
          </label>
        </div>

        <h2>Outcome</h2>
        <div className="chips">
          {OUTCOMES.map((o) => (
            <button
              key={o}
              className={`chip outcome-${o} ${filters.outcomes.has(o) ? 'on' : ''}`}
              aria-pressed={filters.outcomes.has(o)}
              onClick={() => setFilters({ ...filters, outcomes: toggle(filters.outcomes, o) })}
            >
              {o} <span>{counts.outcome.get(o) ?? 0}</span>
            </button>
          ))}
        </div>

        {tags.length > 0 && (
          <>
            <h2>Tags</h2>
            <div className="chips">
              {tags.map((t) => (
                <button
                  key={t}
                  className={`chip tagchip ${filters.tags.has(t) ? 'on' : ''}`}
                  aria-pressed={filters.tags.has(t)}
                  onClick={() => setFilters({ ...filters, tags: toggle(filters.tags, t) })}
                >
                  {t} <span>{counts.tag.get(t) ?? 0}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </aside>

      <div className="timeline">
        {entries.length === 0 ? (
          <div className="empty">
            <p>No entries yet.</p>
            <p className="muted">
              Add one with <strong>+ New entry</strong>, or from the command line: <code>npm run log -- --help</code>.
            </p>
          </div>
        ) : days.length === 0 ? (
          <div className="empty">
            <p>Nothing matches these filters.</p>
            <button className="btn" onClick={() => setFilters(emptyFilters())}>
              Clear filters
            </button>
          </div>
        ) : (
          days.map((day) => (
            <section className="day" key={day.date}>
              <h2>{dateLabel(day.date)}</h2>
              {day.items.map((e) => (
                <Card key={e.id} entry={e} />
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
};

const Card = ({ entry: e }: { entry: Entry }) => {
  const thumb = e.images?.[0];
  return (
    <a className="card" href={`#${e.id}`}>
      <div className="card-body">
        <div className="card-meta">
          <OutcomeBadge outcome={e.outcome} />
          {e.kind && e.kind !== 'step' && <span className={`kind-chip kind-${e.kind}`}>{e.kind === 'sub' ? 'sub-task' : e.kind}</span>}
          <span className="area">{e.area}</span>
          {e.time && <span className="time">{e.time}</span>}
          {e.author === 'user' && <span className="author user">you</span>}
        </div>
        <h3>{e.title}</h3>
        <p className="what">{e.summary ?? firstLine(e.what)}</p>
        {e.tags && e.tags.length > 0 && (
          <div className="tags">
            {e.tags.map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
      {thumb && (
        <div className="thumb">
          <img src={imageUrl(e.id, thumb.file)} alt="" loading="lazy" />
          {e.images!.length > 1 && <span>{e.images!.length}</span>}
        </div>
      )}
    </a>
  );
};
