import { useEffect, useRef } from 'react';
import type { DiceToast, ToastUnit } from './useGameFx';

const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

/**
 * The dice of a roll in display order. The engine keeps a DR as [white, colored]; the ASL
 * convention is to read the colored die first, so it is shown on the left.
 */
export const displayDice = (dice: number[]): { value: number; colored: boolean }[] =>
  dice.length > 1 ? [{ value: dice[1]!, colored: true }, { value: dice[0]!, colored: false }, ...dice.slice(2).map((value) => ({ value, colored: false }))] : dice.map((value) => ({ value, colored: false }));

export function Die({ value, colored }: { value: number; colored?: boolean }) {
  const on = new Set(PIPS[value] ?? []);
  return (
    <div className={`die ${colored ? 'colored' : ''}`} aria-label={String(value)}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={`pip ${on.has(i) ? '' : 'off'}`} />
      ))}
    </div>
  );
}

/** Recent dice rolls, newest at the bottom, each tumbling in and fading out on its own. */
export function DiceTray({ toasts }: { toasts: DiceToast[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="dice-tray">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </div>
  );
}

/**
 * The dice log: the last rolls pulled back up to read through, oldest at the top, opened
 * scrolled to the newest. The cards are the toasts as they were shown, held still.
 */
export function DiceLog({ toasts, limit, onClose }: { toasts: DiceToast[]; limit: number; onClose(): void }) {
  const list = useRef<HTMLDivElement>(null);
  const count = toasts.length;
  const newest = toasts[toasts.length - 1]?.id;
  /** Whether the list is scrolled to its end: new rolls then keep it there (a player reading back is left alone). */
  const atEnd = useRef(true);
  // Follow the newest roll, also once the log is full and its length no longer changes.
  useEffect(() => {
    const el = list.current;
    if (el && atEnd.current) el.scrollTop = el.scrollHeight;
  }, [newest]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="dice-log" role="dialog" aria-label="Dice log">
      <div className="dl-head">
        <span className="kicker">Dice log</span>
        <span className="dl-sub">{count === 0 ? 'no rolls yet' : count < limit ? `${count} roll${count === 1 ? '' : 's'}` : `last ${limit} rolls`}</span>
        <button className="ghost" onClick={onClose} aria-label="Close dice log" title="Close (L or Esc)">
          ✕
        </button>
      </div>
      <div
        className="dl-list"
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {count === 0 ? (
          <div className="dl-empty">Rolls made from here on are kept, the newest at the bottom.</div>
        ) : (
          toasts.map((t) => <ToastCard key={t.id} toast={t} still />)
        )}
      </div>
    </div>
  );
}

/** One roll: the dice, what was rolled for, who was involved and how it came out. `still`: no entrance or fade. */
function ToastCard({ toast: t, still }: { toast: DiceToast; still?: boolean }) {
  const total = t.dice.reduce((a, b) => a + b, 0);
  return (
    <div className={`dice-toast ${t.tone} ${still ? 'still' : ''}`} style={still ? undefined : { ['--hold' as string]: `${t.hold}ms` }}>
      <div className="dice">
        {displayDice(t.dice).map((d, i) => (
          <Die key={i} value={d.value} colored={d.colored} />
        ))}
      </div>
      <div>
        <div className="dt-label">{t.label}</div>
        <div className="dt-total">
          {total}
          {t.detail && <small>{t.detail}</small>}
        </div>
        {(t.firers.length > 0 || t.units.length > 0) && (
          <div className="dt-units">
            {t.firers.map((u) => (
              <Chip key={u.id} unit={u} />
            ))}
            {t.firers.length > 0 && <span className="dt-arrow">→{t.units.length === 0 && t.target ? ` ${t.target}` : ''}</span>}
            {t.units.map((u) => (
              <Chip key={u.id} unit={u} />
            ))}
          </div>
        )}
        {t.results.map((r, i) => (
          <div key={i} className="dt-result">
            {r}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A unit on a toast: its counter as it now stands, with what the roll did to it underneath. */
function Chip({ unit }: { unit: ToastUnit }) {
  return (
    <span className={`chip ${unit.tone ?? ''} ${unit.dead ? 'dead' : ''}`} title={unit.label}>
      {unit.img ? <img src={unit.img} alt={unit.label} /> : <i>{unit.label}</i>}
      {unit.outcome && <small>{unit.outcome}</small>}
    </span>
  );
}
