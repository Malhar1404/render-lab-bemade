import { kindOf, type Entry } from './types';

/** Steps inside one parent: `order` if both have it, otherwise date and time. */
export const compareSiblings = (a: Entry, b: Entry): number => {
  if (a.order !== undefined && b.order !== undefined && a.order !== b.order) return a.order - b.order;
  const ka = `${a.date} ${a.time ?? ''}`;
  const kb = `${b.date} ${b.time ?? ''}`;
  return ka.localeCompare(kb) || a.id.localeCompare(b.id);
};

export type Index = {
  byId: Map<string, Entry>;
  /** Children of each id, in step order. */
  children: Map<string, Entry[]>;
  /** The project root: a topic with no parent. */
  root?: Entry;
  /** Entries that list the key in `follows`. */
  neededBy: Map<string, Entry[]>;
  /** Entries that link to the key with a red string. */
  linkedFrom: Map<string, { entry: Entry; label: string }[]>;
};

export function buildIndex(entries: Entry[]): Index {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const children = new Map<string, Entry[]>();
  const neededBy = new Map<string, Entry[]>();
  const linkedFrom = new Map<string, { entry: Entry; label: string }[]>();
  for (const e of entries) {
    if (e.parent && byId.has(e.parent) && e.parent !== e.id) {
      const list = children.get(e.parent) ?? [];
      list.push(e);
      children.set(e.parent, list);
    }
    for (const f of e.follows ?? []) {
      if (!byId.has(f)) continue;
      const list = neededBy.get(f) ?? [];
      list.push(e);
      neededBy.set(f, list);
    }
    for (const l of e.links ?? []) {
      if (!byId.has(l.id)) continue;
      const list = linkedFrom.get(l.id) ?? [];
      list.push({ entry: e, label: l.label });
      linkedFrom.set(l.id, list);
    }
  }
  for (const list of children.values()) list.sort(compareSiblings);
  const roots = entries.filter((e) => kindOf(e) === 'topic' && !(e.parent && byId.has(e.parent))).sort(compareSiblings);
  return { byId, children, root: roots[0], neededBy, linkedFrom };
}

/** Parents from the top down, not including the entry itself. Stops on a loop. */
export function ancestors(index: Index, e: Entry): Entry[] {
  const out: Entry[] = [];
  const seen = new Set([e.id]);
  let p = e.parent ? index.byId.get(e.parent) : undefined;
  while (p && !seen.has(p.id)) {
    out.unshift(p);
    seen.add(p.id);
    p = p.parent ? index.byId.get(p.parent) : undefined;
  }
  return out;
}

/** The sibling before and after, in step order. */
export function neighbours(index: Index, e: Entry): { prev?: Entry; next?: Entry } {
  if (!e.parent) return {};
  const list = index.children.get(e.parent) ?? [];
  const at = list.findIndex((x) => x.id === e.id);
  if (at < 0) return {};
  return { prev: list[at - 1], next: list[at + 1] };
}

/** "3" for the third step of a topic, "3.2" for the second sub-task of that step; null for topics. */
export function stepLabel(index: Index, e: Entry): string | null {
  if (kindOf(e) === 'topic' || !e.parent) return null;
  const siblings = (index.children.get(e.parent) ?? []).filter((x) => kindOf(x) !== 'topic');
  const n = siblings.findIndex((x) => x.id === e.id) + 1;
  if (n <= 0) return null;
  const parent = index.byId.get(e.parent);
  if (parent && kindOf(parent) !== 'topic') {
    const up = stepLabel(index, parent);
    return up ? `${up}.${n}` : String(n);
  }
  return String(n);
}
