import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { playSfx } from '../audio/engine';

/**
 * An entry on the action wheel: either something to do, or a category that opens a nested ring.
 * Categories can nest arbitrarily deep, so phases with many options stay readable.
 */
export type WheelItem =
  | { kind: 'action'; label: string; icon?: string; hint?: string; disabled?: boolean; active?: boolean; /** The wheel stays open (back at its top ring) after this: a choice that changes what it offers. */ stay?: boolean; onSelect(): void }
  | { kind: 'group'; label: string; icon?: string; hint?: string; children: WheelItem[] };

export const action = (label: string, onSelect: () => void, extra: Partial<Omit<Extract<WheelItem, { kind: 'action' }>, 'kind' | 'label' | 'onSelect'>> = {}): WheelItem => ({
  kind: 'action',
  label,
  onSelect,
  ...extra,
});
export const group = (label: string, children: WheelItem[], extra: { icon?: string; hint?: string } = {}): WheelItem => ({ kind: 'group', label, children, ...extra });

interface Props {
  /** Where the wheel is centred, in board-pane pixels. */
  at: { x: number; y: number };
  /** Shown in the hub at the top level (the hex). */
  title: string;
  items: WheelItem[];
  onClose(): void;
  /** Said when there is nothing to offer here: what the player can do instead. */
  emptyHint?: string;
}

/** How long the "nothing to do" note stays up on its own. */
const EMPTY_MS = 2600;

const RADIUS = 92;
/** More than this many entries on one ring gets a second, wider ring. */
const PER_RING = 8;
/** Clearance kept between the wheel and the edge of what can be seen. */
const EDGE = 8;
/** Half the hub's footprint, its dark halo included. */
const HUB = 44;

/**
 * Radial context menu. Click an action to run it (the wheel closes), click a category to open
 * its ring in place; the hub shows where you are and takes you back up a level. Escape, a
 * click elsewhere or the wheel button closes it.
 */
export function ActionWheel(props: Props) {
  // Nothing to offer: a short note where the player clicked, not an empty wheel.
  if (props.items.length === 0) return <EmptyWheel {...props} />;
  return <Wheel {...props} />;
}

function EmptyWheel({ at, title, onClose, emptyHint }: Props) {
  // Kept inside the visible part of the board, clear of its edges (and the strip along the bottom).
  const backdrop = useRef<HTMLDivElement>(null);
  const note = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  useLayoutEffect(() => {
    const bd = backdrop.current;
    const el = note.current;
    if (!bd || !el) return;
    const r = bd.getBoundingClientRect();
    const w = el.offsetWidth / 2 + EDGE;
    const h = el.offsetHeight / 2 + EDGE;
    const right = Math.min(r.right, window.innerWidth) - r.left;
    const bottom = Math.min(r.bottom, window.innerHeight) - r.top - 64;
    setPos({ x: Math.min(Math.max(at.x, w), right - w), y: Math.min(Math.max(at.y, h), bottom - h) });
  }, [at.x, at.y]);
  useEffect(() => {
    const t = setTimeout(onClose, EMPTY_MS);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);
  return (
    <div ref={backdrop} className="aw-backdrop" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div ref={note} className="aw-empty" style={{ left: pos.x, top: pos.y }} role="status">
        <b>Nothing to do in {title}</b>
        {emptyHint && <span>{emptyHint}</span>}
      </div>
    </div>
  );
}

function Wheel({ at, title, items, onClose }: Props) {
  const [path, setPath] = useState<number[]>([]);
  /** The reason a greyed entry the player clicked cannot be chosen (shown under the wheel; touch screens have no tooltips). */
  const [why, setWhy] = useState<string | null>(null);
  // The ring being shown: walk the path down through the groups.
  const level = useMemo(() => {
    let list = items;
    const crumbs: string[] = [];
    for (const i of path) {
      const it = list[i];
      if (!it || it.kind !== 'group') break;
      crumbs.push(it.label);
      list = it.children;
    }
    return { list, crumbs };
  }, [items, path]);

  useEffect(() => {
    // Deferred a tick so a mount that is immediately undone (dev double-mount) stays silent.
    let opened = false;
    const t = setTimeout(() => {
      opened = true;
      playSfx('ui.open');
    }, 0);
    return () => {
      clearTimeout(t);
      if (opened) playSfx('ui.close');
    };
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (path.length) setPath((p) => p.slice(0, -1));
        else onClose();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [path.length, onClose]);

  // Opened near an edge, the wheel slides inward until every entry can be clicked, and a tether
  // marks the hex or counter it belongs to. Measured per ring: a nested one has its own size.
  const backdrop = useRef<HTMLDivElement>(null);
  const wheel = useRef<HTMLDivElement>(null);
  const [centre, setCentre] = useState(at);
  useLayoutEffect(() => {
    const bd = backdrop.current;
    const w = wheel.current;
    if (!bd || !w) return;
    let [x0, y0, x1, y1] = [-HUB, -HUB, HUB, HUB];
    for (const el of w.querySelectorAll<HTMLElement>('.aw-item')) {
      const x = Number(el.dataset.x) + el.offsetLeft;
      const y = Number(el.dataset.y) + el.offsetTop;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + el.offsetWidth);
      y1 = Math.max(y1, y + el.offsetHeight);
    }
    // The visible part of the pane, in its own pixels.
    const r = bd.getBoundingClientRect();
    const left = Math.max(r.left, 0) - r.left + EDGE;
    const right = Math.min(r.right, window.innerWidth) - r.left - EDGE;
    const top = Math.max(r.top, 0) - r.top + EDGE;
    const bottom = Math.min(r.bottom, window.innerHeight) - r.top - EDGE;
    const fit = (c: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(Math.max(c, lo), hi));
    setCentre({ x: fit(at.x, left - x0, right - x1), y: fit(at.y, top - y0, bottom - y1) });
  }, [at.x, at.y, level]);
  const moved = Math.hypot(centre.x - at.x, centre.y - at.y);

  const n = level.list.length;
  /** Where the entry `i` of the current ring sits relative to the centre (see the layout below). */
  const place = (i: number) => {
    // Spread entries evenly, starting at 12 o'clock; a crowded ring spills onto an outer one.
    const ring = Math.floor(i / PER_RING);
    const inRing = Math.min(PER_RING, n - ring * PER_RING);
    const j = i - ring * PER_RING;
    const ang = (j / inRing) * 2 * Math.PI - Math.PI / 2 + (ring % 2 ? Math.PI / inRing : 0);
    // Entries are wider than tall, so a full ring sits on an ellipse: wide enough that the
    // neighbours of the top entry clear its width, tall enough that a side entry's clear its height.
    const sin = Math.sin(Math.min((2 * Math.PI) / inRing, Math.PI / 2));
    const rx = Math.max(RADIUS, Math.round(108 / sin)) + ring * 84;
    const ry = Math.max(RADIUS, Math.round(64 / sin)) + ring * 64;
    return { x: Math.cos(ang) * rx, y: Math.sin(ang) * ry };
  };
  // The note under the wheel clears its lowest entry (and the hub).
  const whyTop = Math.max(48, ...level.list.map((_, i) => place(i).y)) + 30;
  const hubLabel = level.crumbs.length ? level.crumbs[level.crumbs.length - 1]! : title;
  const hubSub = level.crumbs.length ? '◂ back' : n === 0 ? 'nothing to do' : `${n} option${n === 1 ? '' : 's'}`;

  return (
    <div ref={backdrop} className="aw-backdrop" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      {moved > 1 && (
        <>
          <div
            className="aw-tether"
            style={{ left: at.x, top: at.y, width: moved, transform: `rotate(${Math.atan2(centre.y - at.y, centre.x - at.x)}rad)` }}
          />
          <div className="aw-anchor" style={{ left: at.x, top: at.y }} />
        </>
      )}
      <div ref={wheel} className="aw" style={{ left: centre.x, top: centre.y }} onClick={(e) => e.stopPropagation()}>
        <button
          className={`aw-hub ${level.crumbs.length ? 'back' : ''}`}
          onClick={() => (path.length ? setPath((p) => p.slice(0, -1)) : onClose())}
          title={path.length ? 'Back' : 'Close'}
        >
          <span className="aw-hub-title">{hubLabel}</span>
          <span className="aw-hub-sub">{hubSub}</span>
        </button>
        {why && (
          <div className="aw-why" role="status" style={{ top: whyTop }}>
            {why}
          </div>
        )}
        {level.list.map((it, i) => {
          const { x, y } = place(i);
          const disabled = it.kind === 'action' && it.disabled;
          return (
            <button
              key={`${level.crumbs.join('/')}/${it.label}`}
              className={`aw-item ${it.kind} ${disabled ? 'disabled' : ''} ${it.kind === 'action' && it.active ? 'active' : ''}`}
              data-x={x}
              data-y={y}
              style={{ transform: `translate(${x}px, ${y}px)`, animationDelay: `${i * 22}ms` }}
              title={it.hint ?? it.label}
              aria-disabled={disabled || undefined}
              onPointerEnter={() => !disabled && playSfx('ui.tick')}
              onClick={() => {
                // A greyed entry is not chosen: clicking it says why it cannot be.
                if (disabled) {
                  setWhy(it.hint ?? `${it.label}: not possible now`);
                  return;
                }
                setWhy(null);
                if (it.kind === 'group') {
                  playSfx('ui.open');
                  setPath((p) => [...p, i]);
                } else {
                  playSfx('ui.select');
                  it.onSelect();
                  if (it.stay) setPath([]);
                  else onClose();
                }
              }}
            >
              {it.icon && <span className="aw-icon">{it.icon}</span>}
              <span className="aw-label">{it.label}</span>
              {it.kind === 'group' && <span className="aw-more">▸</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
