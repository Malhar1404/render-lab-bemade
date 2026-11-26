import dagre from '@dagrejs/dagre';

import { buildIndex, compareSiblings, stepLabel, type Index } from '../tree';
import { kindOf, type DevlogImage, type Entry } from '../types';

export type NodeKind = 'root' | 'topic' | 'step' | 'sub' | 'inbox';
export type EdgeKind = 'tree' | 'then' | 'sub' | 'needed' | 'string';

export type BoardNode = {
  id: string;
  kind: NodeKind;
  /** Absent for the two made-up cards: the project root (when no root entry exists) and "Not sorted yet". */
  entry?: Entry;
  /** "3" for the third step, "3.2" for its second sub-task. */
  label: string | null;
  image?: DevlogImage;
  /** Steps in a topic, or sub-tasks in a step. */
  childCount: number;
  /** The id of the topic header whose column this card is in (the root card is its own column). */
  column: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type BoardEdge = {
  id: string;
  kind: EdgeKind;
  source: string;
  target: string;
  label?: string;
};

/** One horizontal stripe of the board: all the steps done on one date. */
export type BoardBand = {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  /** Steps in this band (sub-tasks are not counted). */
  steps: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type Board = {
  nodes: BoardNode[];
  edges: BoardEdge[];
  bands: BoardBand[];
  index: Index;
};

export const ROOT_NODE_ID = 'board-root';
export const INBOX_NODE_ID = 'inbox-unsorted';

// Card sizes. The cards are drawn at exactly these sizes (see board.css), so dagre can lay them out.
export const SIZE = {
  rootW: 480,
  rootH: 180,
  topicW: 360,
  topicH: 205,
  stepW: 360,
  stepH: 270,
  stepImgH: 450,
  subW: 270,
  subH: 130,
  subGapX: 46,
  subGapY: 18,
  /** Vertical space between the steps of a column (room for the "then" arrow and its label). */
  rowGap: 130,
  /** Room on the left of the first column for a band's date label. */
  bandLabelW: 190,
} as const;

/** Space above and below the cards of a band; twice this is the gap between steps of a column. */
const BAND_PAD = SIZE.rowGap / 2;

const thumbOf = (e: Entry): DevlogImage | undefined =>
  e.images?.find((i) => i.kind === 'after') ?? e.images?.[0];

type Piece = { node: BoardNode; dx: number; dy: number };
type Block = { id: string; w: number; h: number; pieces: Piece[] };

/**
 * Turn the entries into cards and lines. Dagre lays out one block per topic header and one per step
 * (a step block holds the step and its sub-tasks). Dagre only decides where the topic headers go;
 * the steps are then placed by hand in one horizontal band per date, oldest at the top, each topic's
 * steps for that date stacked down its column in the order they were done.
 */
export function buildBoard(entries: Entry[]): Board {
  const index = buildIndex(entries);
  const placed = new Set<string>();
  const blocks: Block[] = [];
  const edges: BoardEdge[] = [];
  const topLevel = new Set<string>(); // headers of columns that hang directly off the root
  const dagreEdges: { a: string; b: string; weight: number }[] = [];

  const addEdge = (kind: EdgeKind, source: string, target: string, label?: string) => {
    edges.push({ id: `${kind}:${source}>${target}`, kind, source, target, label });
  };

  const makeNode = (id: string, kind: NodeKind, entry: Entry | undefined, childCount: number, column = id): BoardNode => {
    const image = entry && kind === 'step' ? thumbOf(entry) : undefined;
    const w = kind === 'root' ? SIZE.rootW : kind === 'topic' || kind === 'inbox' ? SIZE.topicW : kind === 'step' ? SIZE.stepW : SIZE.subW;
    const h =
      kind === 'root' ? SIZE.rootH : kind === 'topic' || kind === 'inbox' ? SIZE.topicH : kind === 'step' ? (image ? SIZE.stepImgH : SIZE.stepH) : SIZE.subH;
    return { id, kind, entry, label: entry ? stepLabel(index, entry) : null, image, childCount, column, x: 0, y: 0, w, h };
  };

  const addBlock = (block: Block) => {
    blocks.push(block);
    for (const p of block.pieces) {
      placed.add(p.node.id);
    }
  };

  /** A column: the topic header, then its steps top to bottom. */
  const addTopic = (header: BoardNode, kids: Entry[], parentBlockId: string, useSides: boolean) => {
    const chain = kids.filter((c) => kindOf(c) !== 'topic');
    const subTopics = kids.filter((c) => kindOf(c) === 'topic');
    const sidesOf = (c: Entry) =>
      useSides ? (index.children.get(c.id) ?? []).filter((k) => kindOf(k) !== 'topic' && !placed.has(k.id)) : [];
    const anySides = chain.some((c) => sidesOf(c).length > 0);
    const colW = Math.max(SIZE.topicW, SIZE.stepW + (anySides ? SIZE.subGapX + SIZE.subW : 0));

    const headBlock: Block = { id: header.id, w: colW, h: header.h, pieces: [{ node: header, dx: 0, dy: 0 }] };
    addBlock(headBlock);
    if (parentBlockId) {
      if (parentBlockId === rootId) topLevel.add(header.id);
      dagreEdges.push({ a: parentBlockId, b: header.id, weight: 10 });
      addEdge('tree', parentBlockId, header.id);
    }

    let prevId = header.id;
    for (const c of chain) {
      if (placed.has(c.id)) continue;
      const sides = sidesOf(c);
      const stepNode = makeNode(c.id, kindOf(c), c, sides.length, header.id);
      const pieces: Piece[] = [{ node: stepNode, dx: 0, dy: 0 }];
      let sidesH = 0;
      sides.forEach((s, i) => {
        placed.add(s.id); // reserve so a sub-task is not placed twice
        const n = makeNode(s.id, 'sub', s, 0, header.id);
        pieces.push({ node: n, dx: SIZE.stepW + SIZE.subGapX, dy: i * (SIZE.subH + SIZE.subGapY) });
        sidesH = (i + 1) * SIZE.subH + i * SIZE.subGapY;
      });
      addBlock({ id: c.id, w: colW, h: Math.max(stepNode.h, sidesH), pieces });
      dagreEdges.push({ a: prevId, b: c.id, weight: 10 });
      addEdge(prevId === header.id ? 'tree' : 'then', prevId, c.id, prevId === header.id ? undefined : 'then');
      for (const s of sides) addEdge('sub', c.id, s.id);
      prevId = c.id;
    }
    for (const t of subTopics) {
      if (placed.has(t.id)) continue;
      addTopic(makeNode(t.id, 'topic', t, index.children.get(t.id)?.length ?? 0), index.children.get(t.id) ?? [], header.id, true);
    }
  };

  // ---- root and topics ----
  const rootEntry = index.root;
  const rootId = rootEntry?.id ?? ROOT_NODE_ID;
  const rootNode = makeNode(rootId, 'root', rootEntry, 0);
  addBlock({ id: rootNode.id, w: SIZE.rootW, h: SIZE.rootH, pieces: [{ node: rootNode, dx: 0, dy: 0 }] });

  const topics = entries
    .filter((e) => kindOf(e) === 'topic' && e.id !== rootEntry?.id && (!e.parent || !index.byId.has(e.parent) || e.parent === rootEntry?.id))
    .sort(compareSiblings);
  for (const t of topics) {
    if (placed.has(t.id)) continue;
    addTopic(makeNode(t.id, 'topic', t, index.children.get(t.id)?.length ?? 0), index.children.get(t.id) ?? [], rootNode.id, true);
  }

  // ---- anything not reached: "Not sorted yet" ----
  const loose = entries.filter((e) => !placed.has(e.id)).sort(compareSiblings);
  if (loose.length) {
    const header = makeNode(INBOX_NODE_ID, 'inbox', undefined, loose.length);
    addTopic(header, loose, rootNode.id, false);
  }

  // ---- needed-first dashed arrows and red strings ----
  const thenPairs = new Set(edges.filter((e) => e.kind === 'then' || e.kind === 'tree').map((e) => `${e.source}>${e.target}`));
  const seenStrings = new Set<string>();
  for (const e of entries) {
    if (!placed.has(e.id)) continue;
    for (const f of e.follows ?? []) {
      if (!placed.has(f) || f === e.id || thenPairs.has(`${f}>${e.id}`)) continue;
      addEdge('needed', f, e.id, 'needed first');
    }
    for (const l of e.links ?? []) {
      if (!placed.has(l.id) || l.id === e.id) continue;
      const pair = [e.id, l.id].sort().join('|');
      if (seenStrings.has(pair)) continue;
      seenStrings.add(pair);
      addEdge('string', e.id, l.id, l.label);
    }
  }

  // ---- dagre: top to bottom ----
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 90, ranksep: 110, marginx: 60, marginy: 70, rankalign: 'top' });
  g.setDefaultEdgeLabel(() => ({}));
  for (const b of blocks) g.setNode(b.id, { width: b.w, height: b.h });
  const seenDagre = new Set<string>();
  for (const d of dagreEdges) {
    const key = `${d.a}>${d.b}`;
    if (seenDagre.has(key) || d.a === d.b) continue;
    seenDagre.add(key);
    g.setEdge(d.a, d.b, { weight: d.weight });
  }
  // Keep the topics in the order they were given, left to right.
  const headers = [...topLevel];
  const constraints = headers.slice(1).map((right, i) => ({ left: headers[i], right }));
  dagre.layout(g, { constraints });

  const place = new Map<string, { left: number; top: number }>();
  for (const b of blocks) {
    const p = g.node(b.id);
    place.set(b.id, { left: p.x - b.w / 2, top: p.y - b.h / 2 });
  }
  // Dagre only gets the headers right. Put the steps into one band per date, oldest at the top.
  const columns = new Map<string, Block[]>(); // header block first, then its steps in order
  for (const b of blocks) {
    const col = b.pieces[0].node.column;
    columns.set(col, [...(columns.get(col) ?? []), b]);
  }
  const cols = [...columns.values()].filter((list) => list[0].id !== rootNode.id);
  const dateOf = (b: Block) => b.pieces[0].node.entry?.date ?? '';
  const dates = [...new Set(cols.flatMap((list) => list.slice(1).map(dateOf)))].sort();

  const bands: BoardBand[] = [];
  if (cols.length) {
    const lefts = cols.map((list) => place.get(list[0].id)!.left);
    const left = Math.min(...lefts);
    const right = Math.max(...cols.map((list, i) => lefts[i] + list[0].w));
    // The bands start under the lowest header.
    let y = Math.max(...cols.map((list) => place.get(list[0].id)!.top + list[0].h)) + BAND_PAD;
    for (const date of dates) {
      let tallest = 0;
      let steps = 0;
      cols.forEach((list, i) => {
        let cy = y + BAND_PAD;
        const mine = list.slice(1).filter((b) => dateOf(b) === date);
        mine.forEach((b, k) => {
          if (k) cy += SIZE.rowGap;
          const at = place.get(b.id)!;
          at.top = cy;
          at.left = lefts[i]; // one straight column
          cy += b.h;
        });
        tallest = Math.max(tallest, cy - (y + BAND_PAD));
        steps += mine.length;
      });
      const h = tallest + 2 * BAND_PAD;
      bands.push({ id: `band:${date}`, date, steps, x: Math.round(left - SIZE.bandLabelW), y: Math.round(y), w: Math.round(right - left + SIZE.bandLabelW), h });
      y += h;
    }
  }

  const nodes: BoardNode[] = [];
  for (const b of blocks) {
    const { left, top } = place.get(b.id)!;
    for (const p of b.pieces) {
      p.node.x = Math.round(left + p.dx);
      p.node.y = Math.round(top + p.dy);
      nodes.push(p.node);
    }
  }
  return { nodes, edges, bands, index };
}

/** Everything under `id`, including it. */
function descendants(index: Index, id: string, out = new Set<string>()): Set<string> {
  if (out.has(id)) return out;
  out.add(id);
  for (const c of index.children.get(id) ?? []) descendants(index, c.id, out);
  return out;
}

export type Highlight = { nodes: Set<string>; edges: Set<string> };

/**
 * What lights up when a card is clicked: its whole branch (its topic column and the way up to the
 * project root) plus the needed-first arrows and red strings of the card and its sub-tasks, with
 * the cards at the other end of those lines.
 */
export function highlightFor(board: Board, selectedId: string): Highlight {
  const { index } = board;
  const selected = board.nodes.find((n) => n.id === selectedId);
  if (!selected) return { nodes: new Set(), edges: new Set() };

  const nodes = new Set<string>();
  const isRoot = selected.kind === 'root';
  const column = new Set(board.nodes.filter((n) => n.column === selected.column).map((n) => n.id));
  if (isRoot) board.nodes.forEach((n) => nodes.add(n.id));
  else {
    column.forEach((id) => nodes.add(id));
    // Up through the topic headers to the root.
    let header = selected.column;
    const seen = new Set<string>();
    while (!seen.has(header)) {
      seen.add(header);
      const up = board.edges.find((e) => e.kind === 'tree' && e.target === header);
      if (!up) break;
      nodes.add(up.source);
      header = up.source;
    }
  }

  // The card itself and what hangs under it; a topic or "Not sorted yet" owns its whole column.
  const core = selected.kind === 'topic' || selected.kind === 'inbox' ? new Set(column) : descendants(index, selectedId);
  const edges = new Set<string>();
  for (const e of board.edges) {
    if ((e.kind === 'needed' || e.kind === 'string') && (core.has(e.source) || core.has(e.target))) {
      edges.add(e.id);
      nodes.add(e.source);
      nodes.add(e.target);
    }
  }
  for (const e of board.edges) {
    if ((e.kind === 'tree' || e.kind === 'then' || e.kind === 'sub') && nodes.has(e.source) && nodes.has(e.target)) edges.add(e.id);
  }
  return { nodes, edges };
}

/** Topics and the root stay lit while any card below them matches the filters. */
export function matchingNodes(board: Board, test: (e: Entry) => boolean): Set<string> {
  const ok = new Set<string>();
  for (const n of board.nodes) if (n.entry && test(n.entry)) ok.add(n.id);
  // Light up the ancestors of every match so the way down stays readable.
  for (const id of [...ok]) {
    let e = board.index.byId.get(id);
    const seen = new Set<string>();
    while (e?.parent && !seen.has(e.id)) {
      seen.add(e.id);
      e = board.index.byId.get(e.parent);
      if (e) ok.add(e.id);
    }
  }
  for (const n of board.nodes) if (n.kind === 'root' || n.kind === 'inbox') ok.add(n.id);
  return ok;
}
