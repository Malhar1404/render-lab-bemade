// Entry ids. Plain JS with no Node imports: the CLI, the Vite plugin and the
// browser (the lab's snapshot button, the dev log form) all use it.

/** Lower-case words joined by dashes, at most 50 characters, cut at a word boundary. */
export function slugify(title) {
  let slug = String(title)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length > 50) {
    const cut = slug.lastIndexOf('-', 50);
    slug = slug.slice(0, cut >= 20 ? cut : 50);
  }
  return slug.replace(/-+$/g, '') || 'entry';
}

/** YYYY-MM-DD-<slug>; a numeric suffix (-2, -3, ...) if `taken` has it. */
export function makeId(date, title, taken) {
  const base = `${date}-${slugify(title)}`;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** Ids become folder and file names, so keep them to a safe alphabet. */
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;
