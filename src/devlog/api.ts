import { makeId } from '../../devlog/ids.mjs';
import type { Entry } from './types';

/** `version` says which board layout the positions were made for; the board ignores other versions. */
export type BoardLayout = { version?: number; positions: Record<string, { x: number; y: number }> };

/** The dev log API only exists under `npm run dev`. */
export class ApiError extends Error {
  constructor(
    message: string,
    /** True when the server did not answer like the dev log API at all. */
    readonly unreachable = false,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError('Could not reach the dev server.', true);
  }
  if (!(res.headers.get('content-type') ?? '').includes('application/json')) {
    throw new ApiError('The dev log API is not available here.', true);
  }
  const data = await res.json();
  if (!res.ok) throw new ApiError(data?.error ?? res.statusText);
  return data as T;
}

export const listEntries = () => request<Entry[]>('/api/devlog/entries');

export const saveEntry = (entry: Omit<Entry, 'id'> & { id?: string }) =>
  request<Entry>('/api/devlog/entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  });

export const deleteEntry = (id: string) =>
  request<{ deleted: string }>(`/api/devlog/entries/${encodeURIComponent(id)}`, { method: 'DELETE' });

/** Upload one image for an entry id; resolves to the file name it was stored under. */
export const uploadImage = async (id: string, data: Blob, name: string) =>
  (await request<{ file: string }>(`/api/devlog/images/${encodeURIComponent(id)}?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': data.type || 'application/octet-stream' },
    body: data,
  })).file;

/** Card positions the user dragged on the board (devlog/board-layout.json). */
export const getLayout = () => request<BoardLayout>('/api/devlog/layout');

/** Replace the saved positions. An empty `positions` resets the layout. */
export const saveLayout = (layout: BoardLayout) =>
  request<BoardLayout>('/api/devlog/layout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(layout),
  });

export const imageUrl = (id: string, file: string) => `/devlog-images/${encodeURIComponent(id)}/${encodeURIComponent(file)}`;

const pad = (n: number) => String(n).padStart(2, '0');
export const todayString = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const timeString = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** An id for a new entry that no existing entry uses. */
export const newEntryId = async (date: string, title: string) =>
  makeId(date, title, new Set((await listEntries()).map((e) => e.id)));

export type PlanImage = { file: string; caption?: string };
export type StepStatus = 'done' | 'doing' | 'next' | 'todo';
export type Plan = {
  id: string;
  title: string;
  status: string;
  updated?: string;
  goal?: string;
  target?: PlanImage[];
  decisions?: { text: string; images?: PlanImage[] }[];
  steps: { id: string; title: string; status: StepStatus; images?: PlanImage[] }[];
};

export const listPlans = () => request<Plan[]>('/api/devlog/plans');

/** Tick (done) or untick (todo) one step; resolves to the saved plan. */
export const setPlanStep = (planId: string, stepId: string, status: 'done' | 'todo') =>
  request<Plan>(`/api/devlog/plans/${encodeURIComponent(planId)}/steps/${encodeURIComponent(stepId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });

export const planImageUrl = (planId: string, file: string) =>
  `/devlog-images/plans/${encodeURIComponent(planId)}/${encodeURIComponent(file)}`;
