/** The dev log's data model, shared by the UI, the Vite plugin and the lab. */
export type Area = 'pipeline' | 'lighting' | 'viewer' | 'materials' | 'tooling' | 'other';
export type Outcome = 'worked' | 'failed' | 'partial' | 'open';
export type ImageKind = 'before' | 'after' | 'render' | 'capture' | 'screenshot';
/** topic = a branch header, step = one thing done in a topic, sub = a smaller task inside a step. */
export type EntryKind = 'topic' | 'step' | 'sub';
export type TechKind = 'library' | 'tool' | 'method';

/** One piece of technology, in plain words. */
export type TechItem = {
  name: string;
  kind: TechKind;
  /** One line a non-technical reader can follow. */
  plain: string;
};

/** A red string on the board: another entry and a short handwritten label ("caused", "fixed by"). */
export type EntryLink = {
  id: string;
  label: string;
};

export type DevlogImage = {
  /** File name inside devlog/images/<entry id>/. */
  file: string;
  caption?: string;
  kind?: ImageKind;
};

export type Entry = {
  /** YYYY-MM-DD-<slug>, with a numeric suffix if the slug is taken. */
  id: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM */
  time?: string;
  title: string;
  /** Default 'step'. */
  kind?: EntryKind;
  /** Parent id: a topic's parent is the root project, a step's is its topic, a sub-task's is its step. */
  parent?: string;
  /** Sorts steps inside one parent. Without it, date and time decide. */
  order?: number;
  area: Area;
  outcome: Outcome;
  author: 'claude' | 'user';
  /** One plain sentence. */
  summary?: string;
  what: string;
  why: string;
  how: string;
  /** Plain description of the state before and after (shown beside the before / after images). */
  beforeText?: string;
  afterText?: string;
  /** What went wrong. */
  wrong?: string;
  /** How it was fixed. */
  fix?: string;
  /** Follow-ups. */
  next?: string;
  /** Ids of entries in other branches that had to be done first (dashed "needed first" arrows). */
  follows?: string[];
  /** Red strings to related entries. */
  links?: EntryLink[];
  /** Libraries, tools and methods used, in plain words. */
  tech?: TechItem[];
  files?: string[];
  commit?: string;
  tags?: string[];
  images?: DevlogImage[];
  /** Free-form facts: slider values, camera, mood, bake samples. */
  meta?: Record<string, unknown>;
};

export const AREAS: Area[] = ['pipeline', 'lighting', 'viewer', 'materials', 'tooling', 'other'];
export const OUTCOMES: Outcome[] = ['worked', 'failed', 'partial', 'open'];
export const IMAGE_KINDS: ImageKind[] = ['before', 'after', 'render', 'capture', 'screenshot'];
export const ENTRY_KINDS: EntryKind[] = ['topic', 'step', 'sub'];
export const TECH_KINDS: TechKind[] = ['library', 'tool', 'method'];

export const kindOf = (e: Pick<Entry, 'kind'>): EntryKind => e.kind ?? 'step';
