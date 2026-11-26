// The dev log's file store: devlog/entries/<id>.json and devlog/images/<id>/<file>.
// Plain Node with no dependencies. Used by the CLI (add.mjs) and by the Vite
// plugin (vitePlugin.ts), so both write entries the same way.
import fs from 'node:fs';
import path from 'node:path';

import { ID_PATTERN, makeId } from './ids.mjs';

const AREAS = ['pipeline', 'lighting', 'viewer', 'materials', 'tooling', 'other'];
const OUTCOMES = ['worked', 'failed', 'partial', 'open'];
const AUTHORS = ['claude', 'user'];
const KINDS = ['before', 'after', 'render', 'capture', 'screenshot'];
const ENTRY_KINDS = ['topic', 'step', 'sub'];
const TECH_KINDS = ['library', 'tool', 'method'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
// SVG is left out on purpose: served inline, it could run script.
const IMAGE_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
};
const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export class DevlogError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Clean a file name for disk: no folders, a safe alphabet, an image extension. */
export function safeFileName(name) {
  let base = String(name ?? '').split(/[\\/]/).pop() ?? '';
  base = base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/\.{2,}/g, '.');
  base = base.replace(/^[^A-Za-z0-9]+/, '');
  let ext = path.extname(base).toLowerCase();
  if (!IMAGE_TYPES[ext]) {
    base = base.replace(/\.[A-Za-z0-9]*$/, '') + '.png';
    ext = '.png';
  }
  const stem = base.slice(0, base.length - ext.length).replace(/[-.]+$/, '').slice(0, 80) || 'image';
  return stem + ext;
}

export function imageType(file) {
  return IMAGE_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

const str = (v) => (typeof v === 'string' ? v : undefined);
const clean = (v) => (str(v) ?? '').trim();
const list = (v) =>
  Array.isArray(v) ? v.map((x) => clean(x)).filter(Boolean) : undefined;

/**
 * Check an entry and return it in canonical form (known fields only, empty
 * optional fields dropped). Throws DevlogError listing every problem.
 * `id` may be missing: the caller then generates one.
 */
export function normalizeEntry(input) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new DevlogError('Entry must be a JSON object');
  }
  const e = {};
  const id = clean(input.id);
  if (id && !ID_PATTERN.test(id)) errors.push('id may only use letters, digits, - and _');
  if (id) e.id = id;

  const date = clean(input.date);
  if (!DATE_RE.test(date)) errors.push('date must be YYYY-MM-DD');
  e.date = date;
  const time = clean(input.time);
  if (time && !TIME_RE.test(time)) errors.push('time must be HH:MM');
  if (time) e.time = time;

  const title = clean(input.title);
  if (!title) errors.push('title is required');
  e.title = title;

  if (input.kind != null && input.kind !== '') {
    if (!ENTRY_KINDS.includes(input.kind)) errors.push(`kind must be one of ${ENTRY_KINDS.join(', ')}`);
    else e.kind = input.kind;
  }
  const parent = clean(input.parent);
  if (parent && !ID_PATTERN.test(parent)) errors.push('parent must be an entry id');
  else if (parent && parent === id) errors.push('an entry cannot be its own parent');
  else if (parent) e.parent = parent;
  if (input.order != null && input.order !== '') {
    const n = typeof input.order === 'number' ? input.order : Number(input.order);
    if (!Number.isFinite(n)) errors.push('order must be a number');
    else e.order = n;
  }

  if (!AREAS.includes(input.area)) errors.push(`area must be one of ${AREAS.join(', ')}`);
  e.area = input.area;
  if (!OUTCOMES.includes(input.outcome)) errors.push(`outcome must be one of ${OUTCOMES.join(', ')}`);
  e.outcome = input.outcome;
  if (!AUTHORS.includes(input.author)) errors.push(`author must be one of ${AUTHORS.join(', ')}`);
  e.author = input.author;

  if (input.summary != null && typeof input.summary !== 'string') errors.push('summary must be a string');
  if (clean(input.summary)) e.summary = clean(input.summary);

  for (const key of ['what', 'why', 'how']) {
    if (typeof input[key] !== 'string') errors.push(`${key} must be a string`);
    e[key] = clean(input[key]);
  }
  if (!e.what) errors.push('what is required');
  for (const key of ['beforeText', 'afterText']) {
    if (input[key] != null && typeof input[key] !== 'string') errors.push(`${key} must be a string`);
    if (clean(input[key])) e[key] = clean(input[key]);
  }

  for (const key of ['wrong', 'fix', 'next']) {
    if (input[key] != null && typeof input[key] !== 'string') errors.push(`${key} must be a string`);
    if (clean(input[key])) e[key] = clean(input[key]);
  }

  if (input.follows != null) {
    if (!Array.isArray(input.follows)) errors.push('follows must be an array of entry ids');
    else {
      const ids = [...new Set(list(input.follows))];
      for (const f of ids) if (!ID_PATTERN.test(f)) errors.push(`follows: bad id ${JSON.stringify(f)}`);
      if (ids.includes(id)) errors.push('an entry cannot follow itself');
      if (ids.length) e.follows = ids;
    }
  }
  if (input.links != null) {
    if (!Array.isArray(input.links)) errors.push('links must be an array of { id, label }');
    else {
      const links = [];
      for (const l of input.links) {
        const lid = clean(l?.id);
        const label = clean(l?.label);
        if (!ID_PATTERN.test(lid)) errors.push(`links: bad id ${JSON.stringify(l?.id)}`);
        else if (lid === id) errors.push('an entry cannot link to itself');
        else if (!label) errors.push(`links: ${lid} needs a short label, such as "caused" or "same issue"`);
        else links.push({ id: lid, label });
      }
      if (links.length) e.links = links;
    }
  }
  if (input.tech != null) {
    if (!Array.isArray(input.tech)) errors.push('tech must be an array of { name, kind, plain }');
    else {
      const tech = [];
      for (const t of input.tech) {
        const name = clean(t?.name);
        const plain = clean(t?.plain);
        if (!name || !plain) errors.push('each tech item needs a name and a plain one-line explanation');
        else if (!TECH_KINDS.includes(t.kind)) errors.push(`tech kind must be one of ${TECH_KINDS.join(', ')}`);
        else tech.push({ name, kind: t.kind, plain });
      }
      if (tech.length) e.tech = tech;
    }
  }

  for (const key of ['files', 'tags']) {
    if (input[key] != null && !Array.isArray(input[key])) errors.push(`${key} must be an array of strings`);
    const arr = list(input[key]);
    if (arr?.length) e[key] = arr;
  }
  if (input.commit != null && typeof input.commit !== 'string') errors.push('commit must be a string');
  if (clean(input.commit)) e.commit = clean(input.commit);

  if (input.images != null) {
    if (!Array.isArray(input.images)) {
      errors.push('images must be an array');
    } else {
      const images = [];
      for (const im of input.images) {
        const file = clean(im?.file);
        if (!SAFE_FILE.test(file)) {
          errors.push(`bad image file name: ${JSON.stringify(im?.file)}`);
          continue;
        }
        const out = { file };
        if (clean(im.caption)) out.caption = clean(im.caption);
        if (im.kind != null && im.kind !== '') {
          if (KINDS.includes(im.kind)) out.kind = im.kind;
          else errors.push(`image kind must be one of ${KINDS.join(', ')}`);
        }
        images.push(out);
      }
      if (images.length) e.images = images;
    }
  }
  if (input.meta != null) {
    if (typeof input.meta !== 'object' || Array.isArray(input.meta)) errors.push('meta must be an object');
    else if (Object.keys(input.meta).length) e.meta = input.meta;
  }

  if (errors.length) throw new DevlogError(errors.join('; '));
  return e;
}

/** Read a request stream into bytes, refusing more than `limit`. */
export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new DevlogError(`Body is larger than ${Math.round(limit / 1048576)} MB`, 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

/** A store rooted at the repo folder (the one holding devlog/). */
export function createStore(root) {
  const entriesDir = path.join(root, 'devlog', 'entries');
  const imagesDir = path.join(root, 'devlog', 'images');
  const entryPath = (id) => path.join(entriesDir, `${id}.json`);
  const requireId = (id) => {
    if (!ID_PATTERN.test(String(id))) throw new DevlogError('Invalid entry id');
    return id;
  };

  const ids = () =>
    fs.existsSync(entriesDir)
      ? fs.readdirSync(entriesDir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5))
      : [];

  const newId = (date, title) => makeId(date, title, new Set(ids()));

  const getEntry = (id) => {
    requireId(id);
    const p = entryPath(id);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  };

  const listEntries = () => {
    const entries = [];
    for (const id of ids()) {
      try {
        entries.push(JSON.parse(fs.readFileSync(entryPath(id), 'utf8')));
      } catch (err) {
        console.warn(`[devlog] skipping ${id}.json: ${err.message}`);
      }
    }
    const key = (e) => `${e.date ?? ''} ${e.time ?? ''}`;
    return entries.sort((a, b) => key(b).localeCompare(key(a)) || String(b.id).localeCompare(String(a.id)));
  };

  /**
   * Create or update. A missing id is generated from the date and title; an
   * existing id replaces that entry. `prune` deletes image files the entry no
   * longer lists (the UI's remove button).
   */
  const saveEntry = (input, { prune = false } = {}) => {
    const entry = normalizeEntry(input);
    if (!entry.id) entry.id = newId(entry.date, entry.title);
    // A parent chain must not loop back to this entry.
    for (let p = entry.parent, hops = 0; p; hops++) {
      if (p === entry.id || hops > 50) throw new DevlogError('parent would make a loop');
      p = getEntry(p)?.parent;
    }
    fs.mkdirSync(entriesDir, { recursive: true });
    // Keep the id first in the file, then the rest in schema order.
    const { id, ...rest } = entry;
    fs.writeFileSync(entryPath(id), JSON.stringify({ id, ...rest }, null, 2) + '\n');
    if (prune) {
      const keep = new Set((entry.images ?? []).map((i) => i.file));
      const dir = path.join(imagesDir, id);
      if (fs.existsSync(dir)) {
        for (const f of fs.readdirSync(dir)) if (!keep.has(f)) fs.rmSync(path.join(dir, f), { force: true });
      }
    }
    return { id, ...rest };
  };

  const deleteEntry = (id) => {
    requireId(id);
    const existed = fs.existsSync(entryPath(id));
    fs.rmSync(entryPath(id), { force: true });
    fs.rmSync(path.join(imagesDir, id), { recursive: true, force: true });
    return existed;
  };

  /** Save image bytes as devlog/images/<id>/<name>, never overwriting; returns the file name. */
  const saveImage = (id, name, bytes) => {
    requireId(id);
    const dir = path.join(imagesDir, id);
    fs.mkdirSync(dir, { recursive: true });
    const file = freeName(dir, safeFileName(name));
    fs.writeFileSync(path.join(dir, file), bytes);
    return file;
  };

  /** Copy an existing file into the entry's image folder (the CLI); returns the file name. */
  const copyImage = (id, srcPath) => {
    requireId(id);
    const dir = path.join(imagesDir, id);
    fs.mkdirSync(dir, { recursive: true });
    const file = freeName(dir, safeFileName(path.basename(srcPath)));
    fs.copyFileSync(srcPath, path.join(dir, file));
    return file;
  };

  const hasImage = (id, file) => SAFE_FILE.test(file) && fs.existsSync(path.join(imagesDir, id, file));

  /** Bytes and content type of a stored image; null if missing. Safe against path traversal. */
  const readImage = (id, file) => {
    if (!ID_PATTERN.test(id) || !SAFE_FILE.test(file) || file.includes('..')) return null;
    const full = path.resolve(imagesDir, id, file);
    if (!full.startsWith(path.resolve(imagesDir) + path.sep)) return null;
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
    return { data: fs.readFileSync(full), type: imageType(file) };
  };

  // Board card positions the user has dragged: devlog/board-layout.json { version, positions: { <id>: { x, y } } }.
  const layoutPath = path.join(root, 'devlog', 'board-layout.json');

  const getLayout = () => {
    try {
      const data = JSON.parse(fs.readFileSync(layoutPath, 'utf8'));
      return { version: Number.isInteger(data?.version) ? data.version : undefined, positions: normalizePositions(data?.positions) };
    } catch {
      return { positions: {} };
    }
  };

  /** Replace the saved layout. An empty `positions` resets it. */
  const saveLayout = (input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input) || !input.positions || typeof input.positions !== 'object') {
      throw new DevlogError('Layout must be { "positions": { "<id>": { "x": 0, "y": 0 } } }');
    }
    const layout = { version: Number.isInteger(input.version) ? input.version : undefined, positions: normalizePositions(input.positions, true) };
    fs.mkdirSync(path.dirname(layoutPath), { recursive: true });
    fs.writeFileSync(layoutPath, JSON.stringify(layout, null, 2) + '\n');
    return layout;
  };

  // Plans: devlog/plans/<id>.json, images in devlog/images/plans/<id>/<file>.
  const plansDir = path.join(root, 'devlog', 'plans');
  const planPath = (id) => path.join(plansDir, `${id}.json`);
  const STEP_STATUS = ['done', 'doing', 'next', 'todo'];

  const listPlans = () => {
    const plans = [];
    if (fs.existsSync(plansDir)) {
      for (const f of fs.readdirSync(plansDir).filter((n) => n.endsWith('.json'))) {
        try {
          plans.push(JSON.parse(fs.readFileSync(path.join(plansDir, f), 'utf8')));
        } catch (err) {
          console.warn(`[devlog] skipping plan ${f}: ${err.message}`);
        }
      }
    }
    const active = (p) => (p.status === 'active' ? 0 : 1);
    return plans.sort((a, b) => active(a) - active(b) || String(b.updated ?? '').localeCompare(String(a.updated ?? '')));
  };

  /** Set one step to done or todo. Edits only that step's status text, so the rest of the file keeps its layout. */
  const setPlanStep = (planId, stepId, status) => {
    if (!ID_PATTERN.test(String(planId))) throw new DevlogError('Invalid plan id');
    if (!ID_PATTERN.test(String(stepId))) throw new DevlogError('Invalid step id');
    if (status !== 'done' && status !== 'todo') throw new DevlogError('status must be "done" or "todo"');
    const p = planPath(planId);
    if (!fs.existsSync(p)) throw new DevlogError('Plan not found', 404);
    const text = fs.readFileSync(p, 'utf8');
    const plan = JSON.parse(text);
    const step = Array.isArray(plan.steps) ? plan.steps.find((s) => s.id === stepId) : null;
    if (!step) throw new DevlogError('Step not found', 404);
    let out;
    const from = text.indexOf('"steps"');
    const re = new RegExp('("id":\\s*"' + stepId + '"[^\\n]*?"status":\\s*")(?:done|doing|next|todo)(")');
    const tail = from >= 0 ? text.slice(from) : '';
    if (re.test(tail)) out = text.slice(0, from) + tail.replace(re, `$1${status}$2`);
    if (out === undefined || JSON.parse(out).steps.find((s) => s.id === stepId)?.status !== status) {
      step.status = status;
      out = JSON.stringify(plan, null, 2) + '\n';
    }
    fs.writeFileSync(p, out);
    return JSON.parse(out);
  };

  /** Bytes of a plan image; null if missing. Safe against path traversal. */
  const readPlanImage = (planId, file) => {
    if (!ID_PATTERN.test(planId) || !SAFE_FILE.test(file) || file.includes('..')) return null;
    const base = path.resolve(imagesDir, 'plans');
    const full = path.resolve(base, planId, file);
    if (!full.startsWith(base + path.sep)) return null;
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
    return { data: fs.readFileSync(full), type: imageType(file) };
  };

  return {
    listPlans, setPlanStep, readPlanImage,
    ids, newId, getEntry, listEntries, saveEntry, deleteEntry, saveImage, copyImage, hasImage, readImage,
    getLayout, saveLayout,
  };
}

/** Keep valid { x, y } pairs only; with `strict`, a bad one is an error instead of being dropped. */
function normalizePositions(raw, strict = false) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const entries = Object.entries(raw);
  if (entries.length > 5000) throw new DevlogError('Too many positions');
  for (const [id, p] of entries) {
    const ok = ID_PATTERN.test(id) && p && Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) < 1e6 && Math.abs(p.y) < 1e6;
    if (ok) out[id] = { x: Math.round(p.x), y: Math.round(p.y) };
    else if (strict) throw new DevlogError(`Bad position for ${JSON.stringify(id)}`);
  }
  return out;
}

/** name, or name-2.ext, name-3.ext ... whichever does not exist in dir. */
function freeName(dir, name) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let file = name;
  for (let n = 2; fs.existsSync(path.join(dir, file)); n++) file = `${stem}-${n}${ext}`;
  return file;
}
