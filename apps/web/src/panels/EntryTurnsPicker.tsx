import { useEffect, useState, type ReactNode } from 'react';
import type { Action, Decision, QueryEnv, SideId } from '@asl/engine';
import { SECRET_ENTRY_TURNS_DECISION, secretEntryTurnsIllegal, secretEntryTurnsParams, statics } from '@asl/rules';
import { counterImage } from '../game/assets';

/*
 * The secret entry turns on screen (S26 SSR 1): before setup, which group enters on which turn. Nobody
 * else sees the choice until a group sets up to enter.
 */

interface Args {
  env: QueryEnv;
  decision: Decision | undefined;
  owner: SideId | undefined;
  run(a: Omit<Action, 'decisionId' | 'side'>): void;
  plain(m: string | null | undefined): string | null;
}

export interface EntryTurnsUi {
  panel: ReactNode;
  confirm: { label: string; icon: string; blocked: string | null; onClick(): void; hint?: string } | null;
}

export function useEntryTurnsPicker({ env, decision, owner, run, plain }: Args): EntryTurnsUi {
  const choosing = owner && decision?.kind === SECRET_ENTRY_TURNS_DECISION ? decision : null;
  const p = secretEntryTurnsParams(env);
  const [turns, setTurns] = useState<Record<string, number>>({});
  useEffect(() => {
    setTurns(p ? Object.fromEntries(p.forces.map((f, i) => [f, p.turns[i]!])) : {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choosing?.id]);
  if (!choosing || !p) return { panel: null, confirm: null };
  const blocked = plain(secretEntryTurnsIllegal(env, choosing.owner, turns));
  const forces = statics(env).scenario.forces;
  // Giving a group a turn another group holds swaps them, so every turn stays taken once.
  const give = (force: string, turn: number) => {
    const other = Object.keys(turns).find((f) => f !== force && turns[f] === turn);
    setTurns({ ...turns, [force]: turn, ...(other ? { [other]: turns[force]! } : {}) });
  };
  const panel = (
    <div className="composer entry-groups">
      <p className="hint">{statics(env).scenario.ssr.find((r) => r.module === 'secret-entry-turns')?.text}</p>
      <ul className="entry-groups-list">
        {p.forces.map((fid) => {
          const f = forces.find((x) => x.id === fid)!;
          return (
            <li key={fid} className="on">
              <b>{f.group}</b>
              <span className="muted small"> {f.setup.kind === 'enter' ? f.setup.description : ''}</span>
              <span className="entry-chits">
                {f.units.flatMap((u) => [u.def, ...(u.withSw ?? [])].map((d) => ({ d, n: u.count }))).map(({ d, n }, i) => {
                  const img = counterImage(d, false);
                  return (
                    <span key={`${d}-${i}`} className="entry-chit" title={d}>
                      {img ? <img src={img} alt={d} /> : d}
                      {n > 1 && <span className="count">{n}</span>}
                    </span>
                  );
                })}
              </span>
              <span className="entry-when">
                {p.turns.map((t) => (
                  <button key={t} className={`ghost small ${turns[fid] === t ? 'on' : ''}`} onClick={() => give(fid, t)}>
                    Turn {t}
                  </button>
                ))}
              </span>
            </li>
          );
        })}
      </ul>
      {blocked && <div className="muted small">{blocked}</div>}
    </div>
  );
  return { panel, confirm: { label: 'Record entry turns', icon: '✔', blocked, onClick: () => run({ type: 'entryTurns.choose', turns }), hint: 'Lock in which group enters on which turn (secret)' } };
}
