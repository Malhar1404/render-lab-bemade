import type { Entry } from '../src/devlog/types';

export class DevlogError extends Error {
  status: number;
  constructor(message: string, status?: number);
}

export function safeFileName(name: string): string;
export function imageType(file: string): string;
export function normalizeEntry(input: unknown): Entry | (Omit<Entry, 'id'> & { id?: string });
export function readBody(req: unknown, limit: number): Promise<Uint8Array>;

export type BoardLayout = { positions: Record<string, { x: number; y: number }> };

export type Store = {
  ids(): string[];
  newId(date: string, title: string): string;
  getEntry(id: string): Entry | null;
  listEntries(): Entry[];
  saveEntry(input: unknown, options?: { prune?: boolean }): Entry;
  deleteEntry(id: string): boolean;
  saveImage(id: string, name: string, bytes: Uint8Array): string;
  copyImage(id: string, srcPath: string): string;
  hasImage(id: string, file: string): boolean;
  readImage(id: string, file: string): { data: Uint8Array; type: string } | null;
  listPlans(): Record<string, unknown>[];
  setPlanStep(planId: string, stepId: string, status: string): Record<string, unknown>;
  readPlanImage(planId: string, file: string): { data: Uint8Array; type: string } | null;
  getLayout(): BoardLayout;
  saveLayout(input: unknown): BoardLayout;
};

export function createStore(root: string): Store;
