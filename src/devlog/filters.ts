import type { Area, Entry, Outcome } from './types';

export type Filters = {
  q: string;
  areas: Set<Area>;
  outcomes: Set<Outcome>;
  tags: Set<string>;
  /** Earliest and latest date, YYYY-MM-DD; '' means no limit. */
  from: string;
  to: string;
};

export const emptyFilters = (): Filters => ({ q: '', areas: new Set(), outcomes: new Set(), tags: new Set(), from: '', to: '' });

export const isFiltering = (f: Filters) => !!f.q.trim() || f.areas.size > 0 || f.outcomes.size > 0 || f.tags.size > 0 || !!f.from || !!f.to;

/** Everything searchable about an entry, lower-cased. */
const haystack = (e: Entry) =>
  [
    e.id, e.title, e.kind, e.area, e.outcome, e.author, e.summary, e.what, e.why, e.how, e.beforeText, e.afterText,
    e.wrong, e.fix, e.next, e.commit,
    ...(e.files ?? []), ...(e.tags ?? []), ...(e.images ?? []).map((i) => i.caption),
    ...(e.tech ?? []).flatMap((t) => [t.name, t.plain]), ...(e.links ?? []).map((l) => l.label),
    e.meta ? JSON.stringify(e.meta) : '',
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();

const cache = new WeakMap<Entry, string>();
const text = (e: Entry) => {
  let h = cache.get(e);
  if (h === undefined) cache.set(e, (h = haystack(e)));
  return h;
};

/**
 * Does the entry pass the filters? `skip` leaves one group out, so a chip's
 * count shows what clicking it would give with the other filters unchanged.
 */
export function matches(e: Entry, f: Filters, skip?: 'area' | 'outcome' | 'tag'): boolean {
  if (skip !== 'area' && f.areas.size && !f.areas.has(e.area)) return false;
  if (skip !== 'outcome' && f.outcomes.size && !f.outcomes.has(e.outcome)) return false;
  // Tags: an entry needs every selected tag.
  if (skip !== 'tag' && f.tags.size && ![...f.tags].every((t) => e.tags?.includes(t))) return false;
  // Dates are YYYY-MM-DD, so comparing them as strings is enough.
  if (f.from && e.date < f.from) return false;
  if (f.to && e.date > f.to) return false;
  const terms = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length) {
    const h = text(e);
    if (!terms.every((t) => h.includes(t))) return false;
  }
  return true;
}
