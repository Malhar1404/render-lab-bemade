import { useCallback, useEffect, useRef, useState } from 'react';

import { imageUrl } from './api';
import { renderRich } from './markup';
import type { DevlogImage, Outcome } from './types';

/** A text field rendered with the safe light-markdown renderer. */
export const Rich = ({ text, className = '' }: { text: string; className?: string }) => (
  <div className={`rich ${className}`} dangerouslySetInnerHTML={{ __html: renderRich(text) }} />
);

export const OUTCOME_ICON: Record<Outcome, string> = { worked: '✓', failed: '✗', partial: '◐', open: '●' };

export const OutcomeBadge = ({ outcome }: { outcome: Outcome }) => (
  <span className={`badge outcome-${outcome}`}>
    <span aria-hidden="true">{OUTCOME_ICON[outcome]}</span> {outcome}
  </span>
);

/** Click-to-zoom viewer with arrow keys and Escape. */
export const Lightbox = ({
  id,
  images,
  index,
  onChange,
  onClose,
  urlFor = (file) => imageUrl(id, file),
}: {
  id: string;
  images: DevlogImage[];
  index: number;
  onChange: (i: number) => void;
  onClose: () => void;
  /** Where an image file comes from; defaults to the entry's images. */
  urlFor?: (file: string) => string;
}) => {
  const step = useCallback((d: number) => onChange((index + d + images.length) % images.length), [index, images.length, onChange]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, onClose]);

  const image = images[index];
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Image viewer" onClick={onClose}>
      <button className="lightbox-close" onClick={onClose} aria-label="Close">
        ×
      </button>
      {images.length > 1 && (
        <>
          <button
            className="lightbox-nav prev"
            aria-label="Previous image"
            onClick={(e) => {
              e.stopPropagation();
              step(-1);
            }}
          >
            ‹
          </button>
          <button
            className="lightbox-nav next"
            aria-label="Next image"
            onClick={(e) => {
              e.stopPropagation();
              step(1);
            }}
          >
            ›
          </button>
        </>
      )}
      <figure className="lightbox-figure" onClick={(e) => e.stopPropagation()}>
        <img src={urlFor(image.file)} alt={image.caption ?? image.file} />
        <figcaption>
          {image.kind && <span className="kind">{image.kind}</span>}
          {image.caption ?? image.file}
          {images.length > 1 && (
            <span className="count">
              {index + 1} / {images.length}
            </span>
          )}
        </figcaption>
      </figure>
    </div>
  );
};

/** Drag the handle (or use the slider below) to compare a before and an after image. */
export const BeforeAfter = ({ id, before, after }: { id: string; before: DevlogImage; after: DevlogImage }) => {
  const [pos, setPos] = useState(50);
  const stage = useRef<HTMLDivElement>(null);

  const move = (clientX: number) => {
    const box = stage.current?.getBoundingClientRect();
    if (!box || !box.width) return;
    setPos(Math.min(100, Math.max(0, ((clientX - box.left) / box.width) * 100)));
  };

  return (
    <figure className="ba">
      <div
        className="ba-stage"
        ref={stage}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          move(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons) move(e.clientX);
        }}
      >
        <img className="ba-after" src={imageUrl(id, after.file)} alt={after.caption ?? 'After'} draggable={false} />
        <img
          className="ba-before"
          src={imageUrl(id, before.file)}
          alt={before.caption ?? 'Before'}
          draggable={false}
          style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
        />
        <div className="ba-handle" style={{ left: `${pos}%` }} aria-hidden="true">
          <span />
        </div>
        <span className="ba-label left">Before</span>
        <span className="ba-label right">After</span>
      </div>
      <input
        className="ba-range"
        type="range"
        min={0}
        max={100}
        step={0.5}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        aria-label="Before and after position"
      />
      {(before.caption || after.caption) && (
        <figcaption>
          {before.caption && <span>Before: {before.caption}</span>}
          {after.caption && <span>After: {after.caption}</span>}
        </figcaption>
      )}
    </figure>
  );
};
