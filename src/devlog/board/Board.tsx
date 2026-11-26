import {
  Controls,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getLayout, saveLayout, todayString } from '../api';
import { Detail } from '../Detail';
import { emptyFilters, isFiltering, matches, type Filters } from '../filters';
import { OUTCOMES, type Entry } from '../types';
import { OUTCOME_ICON } from '../widgets';
import { nodeTypes, type FlowNode } from './Cards';
import { edgeTypes, Markers, type LineEdge } from './Edges';
import { buildBoard, highlightFor, matchingNodes, type BoardNode } from './model';
import './board.css';

type Positions = Record<string, { x: number; y: number }>;

/** Bump this when the board layout changes; positions saved for another version are ignored. */
const LAYOUT_VERSION = 2;

/** A choice in the Date menu: the range it sets. */
type DateOption = { key: string; label: string; from: string; to: string };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

/** All dates, today, the last 7 days, then each day that has entries (newest first). */
const dateOptionsFor = (dates: string[]): DateOption[] => {
  const today = todayString();
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 6);
  return [
    { key: 'all', label: 'All dates', from: '', to: '' },
    { key: 'today', label: 'Today', from: today, to: today },
    { key: 'week', label: 'Last 7 days', from: todayString(weekAgo), to: today },
    ...dates.map((d) => ({ key: `day:${d}`, label: dayLabel(d), from: d, to: d })),
  ];
};

const px = (n: number): `${number}px` => `${n}px`;

const Legend = () => (
  <div className="legend" aria-label="How to read the board">
    <h4>How to read this board</h4>
    <ul>
      <li>
        <svg width="56" height="14" aria-hidden="true">
          <line x1="2" y1="7" x2="46" y2="7" stroke="var(--leg-ink)" strokeWidth="2.5" />
          <path d="M40,2 L52,7 L40,12 L43,7 z" fill="var(--leg-ink)" />
        </svg>
        <span><b>then</b>: the next step, done after the one above</span>
      </li>
      <li>
        <svg width="56" height="14" aria-hidden="true">
          <line x1="2" y1="7" x2="46" y2="7" stroke="var(--leg-blue)" strokeWidth="2.5" strokeDasharray="6 4" />
          <path d="M40,2 L52,7 L40,12 L43,7 z" fill="var(--leg-blue)" />
        </svg>
        <span><b>needed first</b>: it could not start before the card at the other end</span>
      </li>
      <li>
        <svg width="56" height="14" aria-hidden="true">
          <path d="M2,5 Q28,22 54,5" fill="none" stroke="var(--leg-red)" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <span><b>red string</b>: related, caused, fixed by, or the same issue</span>
      </li>
      <li>
        <svg width="56" height="14" aria-hidden="true">
          <line x1="2" y1="7" x2="54" y2="7" stroke="#6b5a45" strokeWidth="1.5" />
        </svg>
        <span>thin line: a smaller sub-task of a step</span>
      </li>
    </ul>
    <p className="legend-stamps">
      {OUTCOMES.map((o) => (
        <span key={o} className={`stamp small outcome-${o}`}>
          {OUTCOME_ICON[o]} {o}
        </span>
      ))}
    </p>
  </div>
);

type Props = {
  entries: Entry[];
  filters: Filters;
  setFilters: (f: Filters) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
};

const BoardInner = ({ entries, filters, setFilters, selectedId, onSelect, onEdit, onDelete }: Props) => {
  const flow = useReactFlow();
  const board = useMemo(() => buildBoard(entries), [entries]);
  const [overrides, setOverrides] = useState<Positions | null>(null);
  const overridesRef = useRef<Positions>({});
  const saveTimer = useRef<number | undefined>(undefined);
  const [showLegend, setShowLegend] = useState(() => window.innerWidth > 900);
  const [layoutError, setLayoutError] = useState('');

  // Saved card positions (the cards the user dragged).
  useEffect(() => {
    let alive = true;
    getLayout()
      .then((l) => {
        if (!alive) return;
        // Positions saved for an older layout would put cards in the wrong places.
        const saved = l.version === LAYOUT_VERSION ? l.positions : {};
        overridesRef.current = saved;
        setOverrides(saved);
      })
      .catch(() => alive && setOverrides({}));
    return () => {
      alive = false;
    };
  }, []);

  const persist = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveLayout({ version: LAYOUT_VERSION, positions: overridesRef.current })
        .then(() => setLayoutError(''))
        .catch((err) => setLayoutError(err instanceof Error ? err.message : String(err)));
    }, 300);
  }, []);

  // React Flow reports each card's measured size; a controlled board has to hand it back.
  const [dims, setDims] = useState<Record<string, { width: number; height: number }>>({});

  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    const measured: Record<string, { width: number; height: number }> = {};
    const next = { ...overridesRef.current };
    let moved = false;
    for (const c of changes) {
      if (c.type === 'dimensions' && c.dimensions) measured[c.id] = c.dimensions;
      if (c.type === 'position' && c.position && !c.id.startsWith('band:')) {
        next[c.id] = { x: Math.round(c.position.x), y: Math.round(c.position.y) };
        moved = true;
      }
    }
    if (Object.keys(measured).length) setDims((prev) => ({ ...prev, ...measured }));
    if (moved) {
      overridesRef.current = next;
      setOverrides(next);
    }
  }, []);

  const hl = useMemo(() => (selectedId ? highlightFor(board, selectedId) : null), [board, selectedId]);
  const lit = useMemo(() => (isFiltering(filters) ? matchingNodes(board, (e) => matches(e, filters)) : null), [board, filters]);

  const outOfRange = useCallback((date: string) => (!!filters.from && date < filters.from) || (!!filters.to && date > filters.to), [filters.from, filters.to]);

  const nodes = useMemo<FlowNode[]>(() => {
    if (!overrides) return [];
    // The date bands go first so they sit behind the cards. They never move and are never saved.
    const bands = board.bands.map<FlowNode>((b, i) => ({
      id: b.id,
      type: 'band',
      position: { x: b.x, y: b.y },
      data: { band: b, odd: i % 2 === 0, last: i === board.bands.length - 1, dim: outOfRange(b.date) },
      style: { width: b.w, height: b.h, pointerEvents: 'none' },
      initialWidth: b.w,
      initialHeight: b.h,
      measured: dims[b.id],
      zIndex: -1,
      draggable: false,
      selectable: false,
      connectable: false,
      focusable: false,
      deletable: false,
    }));
    const cards = board.nodes.map<FlowNode>((n: BoardNode) => ({
      id: n.id,
      type: n.kind,
      position: overrides[n.id] ?? { x: n.x, y: n.y },
      data: { node: n, dim: (!!hl && !hl.nodes.has(n.id)) || (!!lit && !lit.has(n.id)), selected: n.id === selectedId },
      style: { width: n.w, height: n.h },
      initialWidth: n.w,
      initialHeight: n.h,
      measured: dims[n.id],
      selectable: true,
    }));
    return [...bands, ...cards];
  }, [board, overrides, hl, lit, selectedId, dims, outOfRange]);

  const edges = useMemo<LineEdge[]>(
    () =>
      board.edges.map((e) => ({
        id: e.id,
        type: e.kind,
        source: e.source,
        target: e.target,
        selectable: false,
        focusable: false,
        data: {
          kind: e.kind,
          label: e.label,
          hot: !!hl?.edges.has(e.id) && (e.kind === 'string' || e.kind === 'needed'),
          dim: (!!hl && !hl.edges.has(e.id)) || (!!lit && !(lit.has(e.source) && lit.has(e.target))),
        },
      })),
    [board, hl, lit],
  );

  const selectedEntry = selectedId ? board.index.byId.get(selectedId) : undefined;

  // Leave room for the key on the left.
  const fitPadding = useMemo(
    () => ({ top: px(30), right: px(30), bottom: px(30), left: px(showLegend && window.innerWidth > 900 ? 375 : 30) }),
    [showLegend],
  );
  const fit = useCallback(() => void flow.fitView({ padding: fitPadding, duration: 450 }), [flow, fitPadding]);

  const resetLayout = async () => {
    window.clearTimeout(saveTimer.current);
    overridesRef.current = {};
    setOverrides({});
    try {
      await saveLayout({ version: LAYOUT_VERSION, positions: {} });
      setLayoutError('');
    } catch (err) {
      setLayoutError(err instanceof Error ? err.message : String(err));
    }
    window.setTimeout(fit, 80);
  };

  // Escape closes the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) onSelect(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSelect]);

  const dateOptions = useMemo(
    () => dateOptionsFor([...new Set(entries.map((e) => e.date))].sort().reverse()),
    [entries],
  );
  // 'custom' stays chosen while the From/To pickers are open, even if they match a preset.
  const [customDates, setCustomDates] = useState(false);
  const preset = dateOptions.find((o) => o.from === filters.from && o.to === filters.to);
  const dateKey = customDates || !preset ? 'custom' : preset.key;
  const pickDate = (key: string) => {
    setCustomDates(key === 'custom');
    const o = dateOptions.find((d) => d.key === key);
    if (o) setFilters({ ...filters, from: o.from, to: o.to });
  };
  const filtering = isFiltering(filters);
  const shown = filtering ? entries.filter((e) => matches(e, filters)).length : entries.length;

  return (
    <div className={`board ${selectedEntry ? 'has-panel' : ''}`}>
      <div className="board-bar">
        <input
          type="search"
          className="search"
          placeholder="Search the board"
          value={filters.q}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
          aria-label="Search the board"
        />
        <label className="pick">
          Date
          <select value={dateKey} onChange={(e) => pickDate(e.target.value)} aria-label="Show only these dates">
            {dateOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
            <option value="custom">Pick a range…</option>
          </select>
        </label>
        {dateKey === 'custom' && (
          <>
            <input
              type="date"
              className="date-input"
              value={filters.from}
              max={filters.to || undefined}
              onChange={(e) => setFilters({ ...filters, from: e.target.value })}
              aria-label="From date"
            />
            <span className="muted">to</span>
            <input
              type="date"
              className="date-input"
              value={filters.to}
              min={filters.from || undefined}
              onChange={(e) => setFilters({ ...filters, to: e.target.value })}
              aria-label="To date"
            />
          </>
        )}
        {filtering && (
          <span className="result-count">
            {shown} of {entries.length} match
            <button className="link" onClick={() => { setCustomDates(false); setFilters(emptyFilters()); }}>
              Clear
            </button>
          </span>
        )}
        <span className="grow" />
        <button className="btn small" onClick={fit}>
          Fit view
        </button>
        <button className="btn small" onClick={() => void resetLayout()} title="Forget dragged positions and lay the cards out again">
          Reset layout
        </button>
        <button className="btn small" onClick={() => setShowLegend((v) => !v)} aria-pressed={showLegend}>
          {showLegend ? 'Hide key' : 'Show key'}
        </button>
      </div>
      {layoutError && <p className="form-error board-error">Could not save the layout: {layoutError}</p>}

      <div className="board-stage" onContextMenu={(e) => e.preventDefault()}>
        <Markers />
        {overrides && (
          <ReactFlow<FlowNode, LineEdge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onNodeClick={(_, n) => n.type !== 'band' && onSelect(n.id)}
            onPaneClick={() => onSelect(null)}
            // Right (or middle) drag pans; left click selects a card and left drag moves it.
            panOnDrag={[1, 2]}
            onNodeDragStop={persist}
            nodesConnectable={false}
            elementsSelectable
            fitView
            fitViewOptions={{ padding: fitPadding }}
            minZoom={0.08}
            maxZoom={2}
            colorMode="system"
            proOptions={{ hideAttribution: true }}
            className="board-flow"
            aria-label="Dev log board"
          >
            <Controls showInteractive={false} position="bottom-left" />
            {showLegend && (
              <Panel position="top-left">
                <Legend />
              </Panel>
            )}
          </ReactFlow>
        )}
        {!overrides && <p className="board-loading">Loading the board…</p>}

        {selectedEntry && (
          <aside className="board-panel" aria-label="Entry details">
            <div className="panel-bar">
              <a className="btn small" href={`#${selectedEntry.id}`}>
                Open full page ↗
              </a>
              <button className="btn small" onClick={() => onSelect(null)} aria-label="Close the panel">
                Close ✕
              </button>
            </div>
            <Detail
              key={selectedEntry.id}
              entry={selectedEntry}
              index={board.index}
              panel
              onOpen={(id) => onSelect(id)}
              onEdit={() => onEdit(selectedEntry.id)}
              onDelete={() => onDelete(selectedEntry.id)}
            />
          </aside>
        )}
      </div>
    </div>
  );
};

export const Board = (props: Props) => (
  <ReactFlowProvider>
    <BoardInner {...props} />
  </ReactFlowProvider>
);
