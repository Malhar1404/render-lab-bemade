#!/usr/bin/env node
// Add or update a dev log entry. Plain Node, no dependencies, no dev server needed.
//   npm run log -- --title "..." --area lighting --outcome worked \
//     --what "..." --why "..." --how "..." --parent <id> --image path.png::Caption::render
// Prints the entry id on stdout. See --help.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DevlogError, createStore, normalizeEntry } from './store.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const store = createStore(ROOT);

const HELP = `Usage: node devlog/add.mjs [flags]     (or: npm run log -- [flags])

Write in plain, simple English that a non-technical reader can follow. Put the jargon
in --tech cards and in --files / --meta.

New entry (required unless --json or --update gives them):
  --title <t>  --area <pipeline|lighting|viewer|materials|tooling|other>
  --outcome <worked|failed|partial|open>  --what <t>  --why <t>  --how <t>

Where it goes on the board:
  --kind <topic|step|sub>     default: step. topic = a branch header, sub = a smaller task
  --parent <id>               a topic's parent is the root project, a step's parent is its
                              topic, a sub-task's parent is its step
  --order <n>                 sorts steps inside one parent (else date and time decide)
  --follows a,b               ids in OTHER branches that had to be done first
                              (dashed "needed first" arrows)
  --link <id>::<label>        a red string to a related entry; repeatable. Labels are short:
                              caused, fixed by, led to, same issue
  --tree                      print the entries as topic > step > sub with their ids, then exit

Plain-language fields:
  --summary <t>               the whole entry in one plain sentence
  --before-text <t>  --after-text <t>   what it was like before and after (beside the images)
  --tech "<name>::<library|tool|method>::<one-line plain explanation>"   repeatable

Optional:
  --wrong <t>  --fix <t>  --next <t>        what went wrong, the fix, follow-ups
  --tags a,b   --files x,y   --commit <hash>
  --date YYYY-MM-DD  --time HH:MM           default: now
  --author <claude|user>                    default: claude
  --image <path>[::caption[::kind]]         repeatable; copied into devlog/images/<id>/
                                            kind: before|after|render|capture|screenshot
  --meta '<json>'                           an object, e.g. '{"samples":1024}'
  --json <file>                             a whole entry from a JSON file (flags override it);
                                            image "file" paths (absolute, repo-relative or
                                            next to the JSON) are copied
  --update <id>                             merge into an existing entry; images are appended,
                                            meta is merged, other fields are replaced
                                            (--link, --tech and --follows replace the whole list)

Example:
  npm run log -- --kind step --parent 2026-11-26-topic-lighting-moods --order 4 \\
    --title "Warm up the evening lamps" --area lighting --outcome worked \\
    --summary "Made the evening lamps a little warmer." \\
    --what "..." --why "..." --how "..." \\
    --tech "Cycles::tool::Blender's realistic renderer that follows light rays" \\
    --link "2026-11-26-evening-mood-late-dusk-with-lamps-baked-and-wired::led to" \\
    --follows 2026-11-26-room-built-in-blender-with-build-room-py

Text fields take plain text with light markdown: "- " bullets, **bold**, \`code\`,
blank-line paragraphs.
`;

const fail = (msg) => {
  console.error(`devlog: ${msg}`);
  process.exit(1);
};

// ---- arguments ----
const VALUE_FLAGS = new Set([
  'title', 'area', 'outcome', 'what', 'why', 'how', 'wrong', 'fix', 'next', 'tags', 'files',
  'commit', 'date', 'time', 'author', 'image', 'meta', 'json', 'update',
  'kind', 'parent', 'follows', 'order', 'summary', 'before-text', 'after-text', 'link', 'tech',
]);
const BOOL_FLAGS = new Set(['tree']);
const REPEAT_FLAGS = new Set(['image', 'link', 'tech']);

function parseArgs(argv) {
  const flags = { image: [], link: [], tech: [] };
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log(HELP);
      process.exit(0);
    }
    if (!arg.startsWith('--')) fail(`unexpected argument ${JSON.stringify(arg)} (try --help)`);
    let name = arg.slice(2);
    let value;
    const eq = name.indexOf('=');
    if (eq >= 0) {
      value = name.slice(eq + 1);
      name = name.slice(0, eq);
    }
    if (BOOL_FLAGS.has(name)) {
      flags[name] = true;
      continue;
    }
    if (!VALUE_FLAGS.has(name)) fail(`unknown flag --${name} (try --help)`);
    if (value === undefined) {
      if (i + 1 >= argv.length) fail(`--${name} needs a value`);
      value = argv[++i];
    }
    if (REPEAT_FLAGS.has(name)) flags[name].push(value);
    else flags[name] = value;
  }
  return flags;
}

const splitList = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);

function parseImageArg(spec) {
  const [file, caption, kind] = spec.split('::');
  const im = { file };
  if (caption) im.caption = caption;
  if (kind) im.kind = kind;
  return im;
}

function parseLinkArg(spec) {
  const at = spec.indexOf('::');
  if (at < 0) fail(`--link needs id::label, got ${JSON.stringify(spec)}`);
  return { id: spec.slice(0, at).trim(), label: spec.slice(at + 2).trim() };
}

function parseTechArg(spec) {
  const parts = spec.split('::');
  if (parts.length < 3) fail(`--tech needs "name::library|tool|method::plain explanation", got ${JSON.stringify(spec)}`);
  const [name, kind, ...rest] = parts;
  return { name: name.trim(), kind: kind.trim(), plain: rest.join('::').trim() };
}

/** Find an image source on disk: absolute, relative to cwd, the repo root or a base folder. */
function findSource(file, baseDir) {
  const candidates = path.isAbsolute(file)
    ? [file]
    : [path.resolve(file), path.resolve(ROOT, file), ...(baseDir ? [path.resolve(baseDir, file)] : [])];
  return candidates.find((p) => fs.existsSync(p) && fs.statSync(p).isFile()) ?? null;
}

const siblingOrder = (a, b) => {
  if (a.order !== undefined && b.order !== undefined && a.order !== b.order) return a.order - b.order;
  return `${a.date} ${a.time ?? ''}`.localeCompare(`${b.date} ${b.time ?? ''}`) || a.id.localeCompare(b.id);
};

/** Print the entries as an indented tree (topic > step > sub) so ids are easy to find. */
function printTree() {
  const all = store.listEntries();
  const byId = new Map(all.map((e) => [e.id, e]));
  const kids = new Map();
  const roots = [];
  for (const e of all) {
    if (e.parent && byId.has(e.parent)) {
      if (!kids.has(e.parent)) kids.set(e.parent, []);
      kids.get(e.parent).push(e);
    } else roots.push(e);
  }
  const seen = new Set();
  const walk = (e, depth) => {
    if (seen.has(e.id)) return;
    seen.add(e.id);
    console.log(`${'  '.repeat(depth)}${e.kind ?? 'step'}: ${e.title}  [${e.id}]`);
    for (const k of (kids.get(e.id) ?? []).sort(siblingOrder)) walk(k, depth + 1);
  };
  const topLevel = roots.filter((e) => e.kind === 'topic');
  const loose = roots.filter((e) => e.kind !== 'topic');
  for (const e of topLevel.sort(siblingOrder)) walk(e, 0);
  if (loose.length) {
    console.log('(no parent yet)');
    for (const e of loose.sort(siblingOrder)) walk(e, 1);
  }
}

// ---- main ----
const flags = parseArgs(process.argv.slice(2));

if (flags.tree) {
  printTree();
  process.exit(0);
}

let base = {};
let jsonDir = null;
if (flags.json) {
  const jsonPath = path.resolve(flags.json);
  if (!fs.existsSync(jsonPath)) fail(`--json file not found: ${flags.json}`);
  try {
    base = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (err) {
    fail(`--json is not valid JSON: ${err.message}`);
  }
  jsonDir = path.dirname(jsonPath);
}

let existing = null;
if (flags.update) {
  existing = store.getEntry(flags.update);
  if (!existing) fail(`no entry with id ${flags.update}`);
}

// Flags override the JSON file.
const fromFlags = {};
for (const key of ['title', 'area', 'outcome', 'what', 'why', 'how', 'wrong', 'fix', 'next', 'commit', 'date', 'time', 'author', 'kind', 'parent', 'summary']) {
  if (flags[key] !== undefined) fromFlags[key] = flags[key];
}
if (flags['before-text'] !== undefined) fromFlags.beforeText = flags['before-text'];
if (flags['after-text'] !== undefined) fromFlags.afterText = flags['after-text'];
if (flags.order !== undefined) {
  const n = Number(flags.order);
  if (!Number.isFinite(n)) fail('--order must be a number');
  fromFlags.order = n;
}
if (flags.tags !== undefined) fromFlags.tags = splitList(flags.tags);
if (flags.files !== undefined) fromFlags.files = splitList(flags.files);
if (flags.follows !== undefined) fromFlags.follows = splitList(flags.follows);
if (flags.link.length) fromFlags.links = flags.link.map(parseLinkArg);
if (flags.tech.length) fromFlags.tech = flags.tech.map(parseTechArg);
if (flags.meta !== undefined) {
  try {
    fromFlags.meta = JSON.parse(flags.meta);
  } catch (err) {
    fail(`--meta is not valid JSON: ${err.message}`);
  }
}
const incoming = { ...base, ...fromFlags };

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const clock = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

let entry;
if (existing) {
  entry = { ...existing, ...incoming };
  delete entry.images;
  entry.id = existing.id;
  if (incoming.meta && existing.meta) entry.meta = { ...existing.meta, ...incoming.meta };
  entry.images = [...(existing.images ?? [])];
} else {
  entry = { author: 'claude', date: today, time: clock, ...incoming };
  delete entry.images;
  const missing = ['title', 'area', 'outcome', 'what', 'why', 'how'].filter((k) => !entry[k]);
  if (missing.length && !flags.json) fail(`missing ${missing.map((k) => '--' + k).join(', ')} (try --help)`);
}

// Validate before touching disk, then pick the id: images live in devlog/images/<id>/.
try {
  normalizeEntry({ ...entry, images: undefined });
} catch (err) {
  if (err instanceof DevlogError) fail(err.message);
  throw err;
}
if (!existing && entry.id && store.getEntry(entry.id)) fail(`entry ${entry.id} already exists (use --update ${entry.id})`);
const id = entry.id ?? store.newId(entry.date, entry.title);
entry.id = id;

// Images: from the JSON file, then from --image flags.
const wanted = [
  ...(Array.isArray(base.images) ? base.images : []).map((im) => (typeof im === 'string' ? parseImageArg(im) : im)),
  ...flags.image.map(parseImageArg),
];

try {
  const images = entry.images ?? [];
  for (const im of wanted) {
    if (!im?.file) fail('an image has no file');
    const src = findSource(im.file, jsonDir);
    let file;
    if (src) file = store.copyImage(id, src);
    else if (store.hasImage(id, im.file)) file = im.file;
    else fail(`image not found: ${im.file}`);
    images.push({ file, ...(im.caption ? { caption: im.caption } : {}), ...(im.kind ? { kind: im.kind } : {}) });
  }
  if (images.length) entry.images = images;
  const saved = store.saveEntry(entry);
  console.log(saved.id);
  console.error(`devlog: saved devlog/entries/${saved.id}.json (${saved.images?.length ?? 0} image(s)); view at http://localhost:5180/devlog.html#${saved.id}`);
  // Gentle checks: the entry is saved either way.
  const known = new Set(store.ids());
  const missingRefs = [
    ...(saved.parent && !known.has(saved.parent) ? [`parent ${saved.parent}`] : []),
    ...(saved.follows ?? []).filter((f) => !known.has(f)).map((f) => `follows ${f}`),
    ...(saved.links ?? []).filter((l) => !known.has(l.id)).map((l) => `link ${l.id}`),
  ];
  if (missingRefs.length) console.error(`devlog: warning, no such entry: ${missingRefs.join(', ')} (see --tree)`);
  if (!saved.parent && saved.kind !== 'topic') {
    console.error('devlog: note, no --parent, so this entry shows in "Not sorted yet" on the board (see --tree for ids)');
  }
} catch (err) {
  if (err instanceof DevlogError) fail(err.message);
  throw err;
}
