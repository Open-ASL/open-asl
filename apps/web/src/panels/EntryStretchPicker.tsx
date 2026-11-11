import { useEffect, useState, type ReactNode } from 'react';
import type { Action, Decision, HexId, QueryEnv, SideId } from '@asl/engine';
import { ENTRY_STRETCH_DECISION, entryStretchIllegal, entryStretchParams, statics } from '@asl/rules';
import { hexLabel } from '../game/describe';

/*
 * The entry stretch on screen (LMA2: "enter by the East edge, either between I and Q inclusive or between Q and Y
 * inclusive"): once the other side has set up, the entering side picks the stretch its whole force comes on by. The
 * card's stretches are drawn on the map; click one (or its button) and record it.
 */

interface Args {
  env: QueryEnv;
  decision: Decision | undefined;
  owner: SideId | undefined;
  run(a: Omit<Action, 'decisionId' | 'side'>): void;
  plain(m: string | null | undefined): string | null;
}

export interface EntryStretchUi {
  active: boolean;
  /** Hex → role: a hex of a stretch that may be picked, or of the picked one. */
  highlights: Map<HexId, 'pick' | 'chosen'>;
  onHexClick(hex: HexId): boolean;
  confirm: { label: string; icon: string; blocked: string | null; onClick(): void; hint?: string } | null;
  panel: ReactNode;
}

export function useEntryStretchPicker({ env, decision, owner, run, plain }: Args): EntryStretchUi {
  const choosing = owner && decision?.kind === ENTRY_STRETCH_DECISION ? decision : null;
  const p = entryStretchParams(env);
  const [option, setOption] = useState<number | null>(null);
  useEffect(() => setOption(null), [choosing?.id]);
  const highlights = new Map<HexId, 'pick' | 'chosen'>();
  if (!choosing || !p) return { active: false, highlights, onHexClick: () => false, confirm: null, panel: null };
  p.options.forEach((o, i) => {
    if (i !== option) for (const h of o.hexes) if (!highlights.has(h)) highlights.set(h, 'pick');
  });
  if (option !== null) for (const h of p.options[option]!.hexes) highlights.set(h, 'chosen');
  const forces = statics(env).scenario.forces.filter((f) => !!f.id && p.forces.includes(f.id));
  // A click on a stretch's hex picks it; a hex the stretches share switches to the other one.
  const onHexClick = (hex: HexId) => {
    const id = statics(env).map.hex(hex)?.id ?? hex;
    const hits = p.options.map((o, i) => (o.hexes.includes(id) ? i : -1)).filter((i) => i >= 0);
    if (!hits.length) return false;
    setOption(hits.find((i) => i !== option) ?? hits[0]!);
    return true;
  };
  const blocked = option === null ? 'Choose the stretch of the edge to enter by' : plain(entryStretchIllegal(env, choosing.owner, option));
  const panel = (
    <div className="composer entry-groups">
      <p className="hint">
        {forces.map((f) => `${f.group ?? f.id}: ${f.setup.kind === 'enter' ? (f.setup.description ?? '') : ''}`).join(' · ')}. Every unit enters through the stretch you pick.
      </p>
      <ul className="entry-groups-list">
        {p.options.map((o, i) => (
          <li key={o.label} className={option === i ? 'on' : ''}>
            <button className={`ghost small ${option === i ? 'on' : ''}`} onClick={() => setOption(i)}>
              {o.label}
            </button>
            <span className="muted small"> {hexLabel(o.hexes[0]!)}–{hexLabel(o.hexes[o.hexes.length - 1]!)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
  return {
    active: true,
    highlights,
    onHexClick,
    panel,
    confirm: { label: 'Record entry stretch', icon: '✔', blocked, onClick: () => option !== null && run({ type: 'entryStretch.choose', option }), hint: 'Lock in the stretch of the edge your force enters by' },
  };
}
