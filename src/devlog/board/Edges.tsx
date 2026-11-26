import { EdgeLabelRenderer, getBezierPath, useInternalNode, Position, type Edge, type EdgeProps } from '@xyflow/react';
import { memo } from 'react';

import type { EdgeKind } from './model';

export type LineData = { kind: EdgeKind; label?: string; dim: boolean; hot: boolean };
export type LineEdge = Edge<LineData>;

type Box = { x: number; y: number; w: number; h: number };

/** The live box of a card (it follows the card while it is dragged). */
const useBox = (id: string): Box | null => {
  const n = useInternalNode(id);
  if (!n) return null;
  const w = n.measured.width ?? n.width ?? 0;
  const h = n.measured.height ?? n.height ?? 0;
  if (!w || !h) return null;
  return { x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, w, h };
};

type Anchor = { sx: number; sy: number; tx: number; ty: number; sp: Position; tp: Position };

/** Bottom of the card above to the top of the card below; sideways if the cards sit side by side. */
const anchorBetween = (a: Box, b: Box): Anchor => {
  if (b.y >= a.y + a.h - 8) return { sx: a.x + a.w / 2, sy: a.y + a.h, tx: b.x + b.w / 2, ty: b.y, sp: Position.Bottom, tp: Position.Top };
  if (a.y >= b.y + b.h - 8) return { sx: a.x + a.w / 2, sy: a.y, tx: b.x + b.w / 2, ty: b.y + b.h, sp: Position.Top, tp: Position.Bottom };
  const right = b.x > a.x;
  return {
    sx: right ? a.x + a.w : a.x,
    sy: a.y + a.h / 2,
    tx: right ? b.x : b.x + b.w,
    ty: b.y + b.h / 2,
    sp: right ? Position.Right : Position.Left,
    tp: right ? Position.Left : Position.Right,
  };
};

const Label = ({ x, y, text, className }: { x: number; y: number; text: string; className: string }) => (
  <EdgeLabelRenderer>
    <div
      className={`edge-label ${className} nodrag nopan`}
      style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}
    >
      {text}
    </div>
  </EdgeLabelRenderer>
);

const state = (d: LineData | undefined) => `${d?.dim ? 'dim' : ''} ${d?.hot ? 'hot' : ''}`;

/** Solid arrows: topic to its first step, and step to step ("then"). */
const FlowLine = ({ id, source, target, data }: EdgeProps<LineEdge>) => {
  const a = useBox(source);
  const b = useBox(target);
  if (!a || !b || !data) return null;
  const p = anchorBetween(a, b);
  // Stop at the pin of the card below, so the arrowhead is not hidden under it.
  const [path, lx, ly] = getBezierPath({
    sourceX: p.sx, sourceY: p.sy, sourcePosition: p.sp, targetX: p.tx, targetY: p.ty + (p.tp === Position.Top ? -2 : 2), targetPosition: p.tp,
  });
  const then = data.kind === 'then';
  return (
    <g className={`line line-${data.kind} ${state(data)}`}>
      <path id={id} d={path} fill="none" className="stroke" markerEnd={`url(#${then ? 'dl-arrow-ink' : 'dl-arrow-soft'})`} />
      {then && data.label && <Label x={lx} y={ly} text={data.label} className={`then ${state(data)}`} />}
    </g>
  );
};

/** A step to one of its sub-tasks: a thin pencil line from the step's side. */
const SubLine = ({ source, target, data }: EdgeProps<LineEdge>) => {
  const a = useBox(source);
  const b = useBox(target);
  if (!a || !b || !data) return null;
  const sx = a.x + a.w;
  const sy = a.y + Math.min(a.h / 2, 60);
  const [path] = getBezierPath({
    sourceX: sx, sourceY: sy, sourcePosition: Position.Right, targetX: b.x, targetY: b.y + b.h / 2, targetPosition: Position.Left,
  });
  return (
    <g className={`line line-sub ${state(data)}`}>
      <path d={path} fill="none" className="stroke" />
    </g>
  );
};

/** Dashed blue arrow: this card could not start until the card at the other end was done. */
const NeededLine = ({ source, target, data }: EdgeProps<LineEdge>) => {
  const a = useBox(source);
  const b = useBox(target);
  if (!a || !b || !data) return null;
  let path: string;
  let lx: number;
  let ly: number;
  const sameColumn = Math.abs(a.x - b.x) < 30 && (b.y > a.y + a.h + 24 || a.y > b.y + b.h + 24);
  if (sameColumn) {
    // Two cards in one column: loop out to the left, so the arrow does not run behind the cards between them.
    const sx = a.x;
    const sy = a.y + a.h / 2;
    const ty = b.y + b.h / 2;
    const bulge = 90;
    path = `M ${sx} ${sy} C ${sx - bulge} ${sy}, ${sx - bulge} ${ty}, ${sx} ${ty}`;
    lx = sx - bulge * 0.75;
    ly = (sy + ty) / 2;
    return (
      <g className={`line line-needed ${state(data)}`}>
        <path d={path} fill="none" className="stroke" markerEnd="url(#dl-arrow-blue)" />
        {data.label && <Label x={lx} y={ly} text={data.label} className={`needed ${state(data)}`} />}
      </g>
    );
  }
  const p = anchorBetween(a, b);
  [path, lx, ly] = getBezierPath({
    sourceX: p.sx, sourceY: p.sy, sourcePosition: p.sp, targetX: p.tx, targetY: p.ty, targetPosition: p.tp, curvature: 0.35,
  });
  return (
    <g className={`line line-needed ${state(data)}`}>
      <path d={path} fill="none" className="stroke" markerEnd="url(#dl-arrow-blue)" />
      {data.label && <Label x={lx} y={ly} text={data.label} className={`needed ${state(data)}`} />}
    </g>
  );
};

/** Red string from pin to pin, with a slight sag. */
const StringLine = ({ source, target, data }: EdgeProps<LineEdge>) => {
  const a = useBox(source);
  const b = useBox(target);
  if (!a || !b || !data) return null;
  const sx = a.x + a.w / 2;
  const sy = a.y + 10;
  const tx = b.x + b.w / 2;
  const ty = b.y + 10;
  const dist = Math.hypot(tx - sx, ty - sy);
  const sag = Math.min(110, Math.max(26, dist * 0.2));
  const mx = (sx + tx) / 2;
  const my = (sy + ty) / 2;
  const path = `M ${sx} ${sy} Q ${mx} ${my + sag * 2} ${tx} ${ty}`;
  return (
    <g className={`line line-string ${state(data)}`}>
      <path d={path} fill="none" className="stroke" />
      {data.label && <Label x={mx} y={my + sag} text={data.label} className={`string ${state(data)}`} />}
    </g>
  );
};

export const edgeTypes = {
  tree: memo(FlowLine),
  then: memo(FlowLine),
  sub: memo(SubLine),
  needed: memo(NeededLine),
  string: memo(StringLine),
};

/** Arrowheads, drawn once and referenced by the lines. */
export const Markers = () => (
  <svg className="dl-markers" width="0" height="0" aria-hidden="true">
    <defs>
      {(
        [
          ['dl-arrow-ink', 'var(--line-ink)'],
          ['dl-arrow-soft', 'var(--line-soft)'],
          ['dl-arrow-blue', 'var(--line-blue)'],
        ] as const
      ).map(([id, colour]) => (
        <marker key={id} id={id} viewBox="0 0 12 12" refX="10" refY="6" markerWidth="12" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto">
          <path d="M1,1 L11,6 L1,11 L4,6 z" style={{ fill: colour }} />
        </marker>
      ))}
    </defs>
  </svg>
);
