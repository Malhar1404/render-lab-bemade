import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo, type CSSProperties } from 'react';

import { imageUrl } from '../api';
import { firstLine } from '../markup';
import type { Outcome } from '../types';
import { OUTCOME_ICON } from '../widgets';
import type { BoardBand, BoardNode } from './model';

export type CardData = {
  node: BoardNode;
  dim: boolean;
  selected: boolean;
};
export type CardFlowNode = Node<CardData>;

export type BandData = { band: BoardBand; odd: boolean; last: boolean; dim: boolean };
export type BandFlowNode = Node<BandData, 'band'>;
/** Everything on the board: the cards and the date bands behind them. */
export type FlowNode = CardFlowNode | BandFlowNode;

/** A small stable hash, so a card's tilt and pin colour do not change between renders. */
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

/** -2 to +2 degrees, seeded by id. */
export const tiltOf = (id: string) => ((hash(id) % 4001) / 1000 - 2).toFixed(2);
const PINS = ['red', 'blue', 'yellow', 'green'] as const;
const pinOf = (id: string) => PINS[hash(`${id}:pin`) % PINS.length];

const OUTCOME_WORD: Record<Outcome, string> = { worked: 'worked', failed: 'failed', partial: 'partial', open: 'open' };

const Stamp = ({ outcome, small = false }: { outcome: Outcome; small?: boolean }) => (
  <span className={`stamp outcome-${outcome} ${small ? 'small' : ''}`}>
    <span aria-hidden="true">{OUTCOME_ICON[outcome]}</span> {OUTCOME_WORD[outcome]}
  </span>
);

const Card = ({ data }: NodeProps<CardFlowNode>) => {
  const { node, dim, selected } = data;
  const e = node.entry;
  const title = e?.title ?? (node.kind === 'inbox' ? 'Not sorted yet' : 'Project');
  const summary = e ? (e.summary ?? firstLine(e.what)) : node.kind === 'inbox' ? 'Entries without a parent land here. Give them a parent to put them on the board.' : '';
  const style: CSSProperties = {
    width: node.w,
    height: node.h,
    ['--tilt' as string]: `${tiltOf(node.id)}deg`,
  };
  const cls = ['bc', `bc-${node.kind}`, `pin-${pinOf(node.id)}`, dim ? 'dim' : '', selected ? 'selected' : '', node.image ? 'has-photo' : ''].join(' ');

  return (
    <div className={cls} style={style} title={e ? undefined : title}>
      <Handle type="target" position={Position.Top} isConnectable={false} className="bc-handle" />
      <Handle type="source" position={Position.Bottom} isConnectable={false} className="bc-handle" />
      <span className="pin" aria-hidden="true" />
      {node.label && <span className="num">{node.label}</span>}
      {node.kind === 'root' && <span className="folder-tab">The whole project</span>}
      {node.kind === 'topic' && <span className="folder-tab">Topic</span>}
      {node.image && e && (
        <div className="photo">
          <img src={imageUrl(e.id, node.image.file)} alt="" loading="lazy" draggable={false} />
        </div>
      )}
      <h3 className="bc-title">{title}</h3>
      {node.kind !== 'sub' && summary && <p className="bc-sum">{summary}</p>}
      <div className="bc-foot">
        {e ? <Stamp outcome={e.outcome} small={node.kind === 'sub'} /> : <span />}
        {node.kind === 'topic' && node.childCount > 0 && (
          <span className="count">{node.childCount} {node.childCount === 1 ? 'step' : 'steps'}</span>
        )}
        {node.kind === 'step' && node.childCount > 0 && (
          <span className="count">{node.childCount} sub-{node.childCount === 1 ? 'task' : 'tasks'}</span>
        )}
      </div>
    </div>
  );
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "26 Nov 2026" and "Thu" from "2026-11-26". */
const dateParts = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return { day: date, weekday: '' };
  return { day: `${d} ${MONTHS[m - 1]} ${y}`, weekday: DAYS[new Date(y, m - 1, d).getDay()] };
};

/** A date band: a separator line, a big date label on the left, and faint shading. Not interactive. */
const Band = ({ data }: NodeProps<BandFlowNode>) => {
  const { band, odd, last, dim } = data;
  const { day, weekday } = dateParts(band.date);
  const cls = ['band', odd ? 'odd' : '', last ? 'last' : '', dim ? 'dim' : ''].join(' ');
  return (
    <div className={cls} style={{ width: band.w, height: band.h }}>
      <div className="band-label">
        <span className="band-date">{day}</span>
        <span className="band-sub">
          {weekday ? `${weekday} · ` : ''}
          {band.steps} {band.steps === 1 ? 'step' : 'steps'}
        </span>
      </div>
    </div>
  );
};

export const nodeTypes = {
  band: memo(Band),
  root: memo(Card),
  topic: memo(Card),
  step: memo(Card),
  sub: memo(Card),
  inbox: memo(Card),
};

