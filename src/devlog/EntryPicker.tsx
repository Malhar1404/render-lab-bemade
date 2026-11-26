import { useMemo, useRef, useState } from 'react';

import { ancestors, buildIndex } from './tree';
import { kindOf, type Entry } from './types';

const KIND_WORD = { topic: 'topic', step: 'step', sub: 'sub-task' } as const;

/** A searchable select of the existing entries. */
export const EntryPicker = ({
  entries,
  value,
  onChange,
  exclude = [],
  placeholder = 'Search',
  keepEmpty = false,
}: {
  entries: Entry[];
  /** The chosen entry id, or ''. */
  value: string;
  onChange: (id: string) => void;
  exclude?: string[];
  placeholder?: string;
  /** Stay empty after a choice (for "add another" pickers). */
  keepEmpty?: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const index = useMemo(() => buildIndex(entries), [entries]);
  const chosen = value ? index.byId.get(value) : undefined;

  const options = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return entries
      .filter((e) => !exclude.includes(e.id))
      .map((e) => ({ e, trail: ancestors(index, e).map((a) => a.title).join(' › ') }))
      .filter(({ e, trail }) => {
        const h = `${e.title} ${e.id} ${kindOf(e)} ${trail}`.toLowerCase();
        return terms.every((t) => h.includes(t));
      })
      .slice(0, 40);
  }, [entries, exclude, index, q]);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setQ('');
  };

  return (
    <div
      className="picker"
      ref={box}
      onBlur={(ev) => {
        if (!box.current?.contains(ev.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <input
        value={open ? q : keepEmpty ? '' : (chosen?.title ?? value)}
        placeholder={chosen && !open ? chosen.title : placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
          if (e.key === 'Enter' && open && options[0]) {
            e.preventDefault();
            pick(options[0].e.id);
          }
        }}
        role="combobox"
        aria-expanded={open}
        aria-label={placeholder}
      />
      {value && !keepEmpty && (
        <button type="button" className="picker-clear" aria-label="Clear" onClick={() => pick('')}>
          ×
        </button>
      )}
      {open && (
        <ul className="picker-list" role="listbox">
          {options.length === 0 && <li className="muted picker-empty">Nothing matches.</li>}
          {options.map(({ e, trail }) => (
            <li key={e.id} role="option" aria-selected={e.id === value}>
              <button type="button" onMouseDown={(ev) => ev.preventDefault()} onClick={() => pick(e.id)}>
                <span className={`kind-chip kind-${kindOf(e)}`}>{KIND_WORD[kindOf(e)]}</span>
                <span className="picker-title">{e.title}</span>
                {trail && <span className="picker-trail">{trail}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
