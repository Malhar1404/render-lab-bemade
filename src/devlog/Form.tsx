import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';

import { imageUrl, newEntryId, saveEntry, timeString, todayString, uploadImage } from './api';
import { EntryPicker } from './EntryPicker';
import {
  AREAS, ENTRY_KINDS, IMAGE_KINDS, OUTCOMES, TECH_KINDS, kindOf,
  type Area, type Entry, type EntryKind, type ImageKind, type Outcome, type TechKind,
} from './types';

/** One image row in the form: already stored (`stored`) or picked and waiting to upload (`file`). */
type Item = {
  key: string;
  stored?: string;
  file?: File;
  preview: string;
  caption: string;
  kind: ImageKind | '';
};

let counter = 0;
const nextKey = () => `i${++counter}`;

type LinkRow = { key: string; id: string; label: string };
type TechRow = { key: string; name: string; kind: TechKind; plain: string };

type State = {
  title: string;
  summary: string;
  kind: EntryKind;
  parent: string;
  order: string;
  follows: string[];
  links: LinkRow[];
  tech: TechRow[];
  beforeText: string;
  afterText: string;
  date: string;
  time: string;
  area: Area;
  outcome: Outcome;
  author: 'claude' | 'user';
  what: string;
  why: string;
  how: string;
  wrong: string;
  fix: string;
  next: string;
  tags: string;
  files: string;
  commit: string;
  meta: string;
};

const blank = (): State => ({
  title: '', summary: '', kind: 'step', parent: '', order: '', follows: [], links: [], tech: [], beforeText: '', afterText: '', date: todayString(), time: timeString(), area: 'other', outcome: 'open', author: 'user',
  what: '', why: '', how: '', wrong: '', fix: '', next: '', tags: '', files: '', commit: '', meta: '',
});

const fromEntry = (e: Entry): State => ({
  title: e.title, summary: e.summary ?? '', kind: kindOf(e), parent: e.parent ?? '', order: e.order === undefined ? '' : String(e.order),
  follows: e.follows ?? [],
  links: (e.links ?? []).map((l) => ({ key: nextKey(), id: l.id, label: l.label })),
  tech: (e.tech ?? []).map((t) => ({ key: nextKey(), ...t })),
  beforeText: e.beforeText ?? '', afterText: e.afterText ?? '', date: e.date, time: e.time ?? '', area: e.area, outcome: e.outcome, author: e.author,
  what: e.what, why: e.why, how: e.how, wrong: e.wrong ?? '', fix: e.fix ?? '', next: e.next ?? '',
  tags: (e.tags ?? []).join(', '), files: (e.files ?? []).join('\n'), commit: e.commit ?? '',
  meta: e.meta ? JSON.stringify(e.meta, null, 2) : '',
});

const TEXT_FIELDS: { key: 'what' | 'why' | 'how' | 'beforeText' | 'afterText' | 'wrong' | 'fix' | 'next'; label: string; hint: string; rows: number }[] = [
  { key: 'what', label: 'What we did', hint: 'In plain words. Required.', rows: 3 },
  { key: 'why', label: 'Why we did it', hint: 'The reason or goal, in plain words.', rows: 3 },
  { key: 'how', label: 'How we did it', hint: 'The steps, in plain words. Keep jargon for the tech cards and settings.', rows: 5 },
  { key: 'beforeText', label: 'Before', hint: 'What it was like before. Optional.', rows: 2 },
  { key: 'afterText', label: 'After', hint: 'What it is like now. Optional.', rows: 2 },
  { key: 'wrong', label: 'What went wrong', hint: 'Bugs, dead ends, surprises. Optional.', rows: 3 },
  { key: 'fix', label: 'How we fixed it', hint: 'Optional.', rows: 3 },
  { key: 'next', label: 'What comes next', hint: 'Follow-ups. Optional.', rows: 3 },
];

export const Form = ({
  entry,
  entries,
  onSaved,
  onCancel,
}: {
  /** The entry being edited; absent for a new one. */
  entry?: Entry;
  /** Every entry, for the parent, needed-first and red-string pickers. */
  entries: Entry[];
  onSaved: (id: string) => void;
  onCancel: () => void;
}) => {
  const [s, setS] = useState<State>(() => (entry ? fromEntry(entry) : blank()));
  const [items, setItems] = useState<Item[]>(() =>
    (entry?.images ?? []).map((im) => ({
      key: nextKey(), stored: im.file, preview: imageUrl(entry!.id, im.file), caption: im.caption ?? '', kind: im.kind ?? '',
    })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const set = <K extends keyof State>(key: K, value: State[K]) => setS((prev) => ({ ...prev, [key]: value }));

  const addFiles = useCallback((files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (!images.length) return;
    setItems((prev) => [
      ...prev,
      ...images.map((file): Item => {
        // Clipboard images arrive as "image.png": give them a name that tells them apart.
        const ext = file.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
        const name = !file.name || /^image\.\w+$/.test(file.name) ? `pasted-${Date.now()}-${++counter}.${ext}` : file.name;
        return {
          key: nextKey(),
          file: new File([file], name, { type: file.type }),
          preview: URL.createObjectURL(file),
          caption: '',
          kind: '',
        };
      }),
    ]);
  }, []);

  // Paste from the clipboard anywhere on the form.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.some((f) => f.type.startsWith('image/'))) {
        e.preventDefault();
        addFiles(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addFiles]);

  // Free the blob URLs when the form goes away.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(
    () => () => itemsRef.current.forEach((i) => i.file && URL.revokeObjectURL(i.preview)),
    [],
  );

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(Array.from(e.dataTransfer.files));
  };

  const updateItem = (key: string, patch: Partial<Item>) =>
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  const removeItem = (key: string) => setItems((prev) => prev.filter((i) => i.key !== key));

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setError('');
    if (!s.title.trim()) return setError('Give the entry a title.');
    if (!s.what.trim()) return setError('"What we did" is required.');
    if (s.order.trim() && !Number.isFinite(Number(s.order))) return setError('Order must be a number.');
    if (s.links.some((l) => l.id && !l.label.trim())) return setError('Give every red string a short label, such as "caused" or "same issue".');
    if (s.tech.some((t) => !t.name.trim() !== !t.plain.trim())) return setError('Each tech card needs both a name and a plain explanation.');
    let meta: Record<string, unknown> | undefined;
    if (s.meta.trim()) {
      try {
        const parsed = JSON.parse(s.meta);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
        meta = parsed;
      } catch {
        return setError('Settings must be a JSON object, e.g. {"samples": 1024}.');
      }
    }

    setSaving(true);
    try {
      const id = entry?.id ?? (await newEntryId(s.date, s.title));
      const images: Entry['images'] = [];
      for (const item of items) {
        const file = item.file ? await uploadImage(id, item.file, item.file.name) : item.stored!;
        images.push({ file, ...(item.caption.trim() && { caption: item.caption.trim() }), ...(item.kind && { kind: item.kind }) });
      }
      const list = (text: string, sep: RegExp) => text.split(sep).map((x) => x.trim()).filter(Boolean);
      const saved = await saveEntry({
        id,
        date: s.date,
        ...(s.time && { time: s.time }),
        title: s.title.trim(),
        ...(s.kind !== 'step' && { kind: s.kind }),
        ...(s.parent && { parent: s.parent }),
        ...(s.order.trim() && { order: Number(s.order) }),
        area: s.area,
        outcome: s.outcome,
        author: s.author,
        ...(s.summary.trim() && { summary: s.summary.trim() }),
        what: s.what, why: s.why, how: s.how,
        ...(s.beforeText.trim() && { beforeText: s.beforeText }),
        ...(s.afterText.trim() && { afterText: s.afterText }),
        ...(s.wrong.trim() && { wrong: s.wrong }),
        ...(s.fix.trim() && { fix: s.fix }),
        ...(s.next.trim() && { next: s.next }),
        follows: s.follows,
        links: s.links.filter((l) => l.id).map((l) => ({ id: l.id, label: l.label.trim() })),
        tech: s.tech.filter((t) => t.name.trim()).map((t) => ({ name: t.name.trim(), kind: t.kind, plain: t.plain.trim() })),
        tags: list(s.tags, /,/),
        files: list(s.files, /[\n,]/),
        ...(s.commit.trim() && { commit: s.commit.trim() }),
        images,
        ...(meta && { meta }),
      });
      onSaved(saved.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <form className="form" onSubmit={submit}>
      <h1>{entry ? 'Edit entry' : 'New entry'}</h1>

      <label className="field">
        <span>Title</span>
        <input value={s.title} onChange={(e) => set('title', e.target.value)} autoFocus placeholder="What this entry is about" />
      </label>

      <label className="field">
        <span>
          In one line <em>the whole entry in one plain sentence</em>
        </span>
        <input value={s.summary} onChange={(e) => set('summary', e.target.value)} placeholder="Made the evening lamps a little warmer." />
      </label>

      <div className="row">
        <label className="field">
          <span>Kind</span>
          <select value={s.kind} onChange={(e) => set('kind', e.target.value as EntryKind)}>
            {ENTRY_KINDS.map((k) => (
              <option key={k} value={k}>
                {k === 'sub' ? 'sub-task' : k}
              </option>
            ))}
          </select>
        </label>
        <div className="field grow">
          <span>
            Parent <em>topic: the project. Step: its topic. Sub-task: its step.</em>
          </span>
          <EntryPicker entries={entries} value={s.parent} onChange={(id) => set('parent', id)} exclude={entry ? [entry.id] : []} placeholder="Search for a parent" />
        </div>
        <label className="field">
          <span>
            Order <em>optional</em>
          </span>
          <input type="number" step="any" value={s.order} onChange={(e) => set('order', e.target.value)} placeholder="1, 2, 3" />
        </label>
      </div>

      <div className="row">
        <label className="field">
          <span>Date</span>
          <input type="date" value={s.date} onChange={(e) => set('date', e.target.value)} required />
        </label>
        <label className="field">
          <span>Time</span>
          <input type="time" value={s.time} onChange={(e) => set('time', e.target.value)} />
        </label>
        <label className="field">
          <span>Area</span>
          <select value={s.area} onChange={(e) => set('area', e.target.value as Area)}>
            {AREAS.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Outcome</span>
          <select value={s.outcome} onChange={(e) => set('outcome', e.target.value as Outcome)}>
            {OUTCOMES.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Author</span>
          <select value={s.author} onChange={(e) => set('author', e.target.value as 'claude' | 'user')}>
            <option>user</option>
            <option>claude</option>
          </select>
        </label>
      </div>

      {TEXT_FIELDS.map(({ key, label, hint, rows }) => (
        <label className="field" key={key}>
          <span>
            {label} <em>{hint}</em>
          </span>
          <textarea rows={rows} value={s[key]} onChange={(e) => set(key, e.target.value)} />
        </label>
      ))}
      <p className="hint">Text fields take plain text with light markdown: “- ” bullets, **bold**, `code`, blank lines between paragraphs.</p>

      <fieldset className="images">
        <legend>Needed first</legend>
        <p className="hint">Entries in other branches that had to be done before this one. They draw dashed "needed first" arrows.</p>
        <div className="chip-list">
          {s.follows.map((id) => (
            <span className="pill" key={id}>
              {entries.find((e) => e.id === id)?.title ?? id}
              <button type="button" aria-label="Remove" onClick={() => set('follows', s.follows.filter((x) => x !== id))}>
                ×
              </button>
            </span>
          ))}
        </div>
        <EntryPicker
          entries={entries}
          value=""
          onChange={(id) => id && !s.follows.includes(id) && set('follows', [...s.follows, id])}
          exclude={[...(entry ? [entry.id] : []), ...s.follows]}
          placeholder="Add an entry that was needed first"
          keepEmpty
        />
      </fieldset>

      <fieldset className="images">
        <legend>Red strings</legend>
        <p className="hint">Related entries. Use a short label: caused, fixed by, led to, same issue.</p>
        {s.links.map((l) => (
          <div className="link-row" key={l.key}>
            <EntryPicker
              entries={entries}
              value={l.id}
              onChange={(id) => set('links', s.links.map((x) => (x.key === l.key ? { ...x, id } : x)))}
              exclude={entry ? [entry.id] : []}
              placeholder="Search for an entry"
            />
            <input
              value={l.label}
              onChange={(e) => set('links', s.links.map((x) => (x.key === l.key ? { ...x, label: e.target.value } : x)))}
              placeholder="label, e.g. fixed by"
              aria-label="String label"
            />
            <button type="button" className="btn small" onClick={() => set('links', s.links.filter((x) => x.key !== l.key))}>
              Remove
            </button>
          </div>
        ))}
        <button type="button" className="btn small" onClick={() => set('links', [...s.links, { key: nextKey(), id: '', label: '' }])}>
          + Add a red string
        </button>
      </fieldset>

      <fieldset className="images">
        <legend>Tech used</legend>
        <p className="hint">One card per library, tool or method, with a one-line plain explanation.</p>
        {s.tech.map((t) => (
          <div className="tech-row" key={t.key}>
            <input value={t.name} onChange={(e) => set('tech', s.tech.map((x) => (x.key === t.key ? { ...x, name: e.target.value } : x)))} placeholder="Name" aria-label="Tech name" />
            <select value={t.kind} onChange={(e) => set('tech', s.tech.map((x) => (x.key === t.key ? { ...x, kind: e.target.value as TechKind } : x)))} aria-label="Tech kind">
              {TECH_KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
            <input
              className="grow"
              value={t.plain}
              onChange={(e) => set('tech', s.tech.map((x) => (x.key === t.key ? { ...x, plain: e.target.value } : x)))}
              placeholder="What it is, in one plain line"
              aria-label="Plain explanation"
            />
            <button type="button" className="btn small" onClick={() => set('tech', s.tech.filter((x) => x.key !== t.key))}>
              Remove
            </button>
          </div>
        ))}
        <button type="button" className="btn small" onClick={() => set('tech', [...s.tech, { key: nextKey(), name: '', kind: 'tool', plain: '' }])}>
          + Add a tech card
        </button>
      </fieldset>

      <div className="row">
        <label className="field grow">
          <span>
            Tags <em>comma separated</em>
          </span>
          <input value={s.tags} onChange={(e) => set('tags', e.target.value)} placeholder="bake, evening" />
        </label>
        <label className="field">
          <span>Commit</span>
          <input value={s.commit} onChange={(e) => set('commit', e.target.value)} placeholder="abc1234" />
        </label>
      </div>
      <label className="field">
        <span>
          Files <em>one per line (technical)</em>
        </span>
        <textarea rows={3} value={s.files} onChange={(e) => set('files', e.target.value)} placeholder="pipeline/room/build_room.py" />
      </label>
      <label className="field">
        <span>
          Settings <em>optional JSON object (technical): slider values, camera, mood, samples</em>
        </span>
        <textarea rows={4} className="mono" value={s.meta} onChange={(e) => set('meta', e.target.value)} placeholder='{"mood": "evening"}' />
      </label>

      <fieldset className="images">
        <legend>Images</legend>
        <div
          className={`drop ${dragOver ? 'over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => picker.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && picker.current?.click()}
        >
          Drop images here, click to choose files, or paste from the clipboard (Ctrl+V).
          <input
            ref={picker}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
        </div>
        {items.map((item) => (
          <div className="image-row" key={item.key}>
            <img src={item.preview} alt="" />
            <div className="image-fields">
              <input
                value={item.caption}
                onChange={(e) => updateItem(item.key, { caption: e.target.value })}
                placeholder="Caption"
                aria-label="Caption"
              />
              <select
                value={item.kind}
                onChange={(e) => updateItem(item.key, { kind: e.target.value as ImageKind | '' })}
                aria-label="Kind"
              >
                <option value="">kind: none</option>
                {IMAGE_KINDS.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
              <button type="button" className="btn small" onClick={() => removeItem(item.key)}>
                Remove
              </button>
            </div>
          </div>
        ))}
      </fieldset>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button className="btn primary" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save entry'}
        </button>
        <button className="btn" type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
};
