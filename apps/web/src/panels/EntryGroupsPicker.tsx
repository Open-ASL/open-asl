import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Action, Decision, HexId, QueryEnv, SideId } from '@asl/engine';
import { ENTRY_GROUPS_DECISION, entryCountsLegal, entryEdgeHexes, entryGroupsIllegal, entryGroupsParams, entryGroupsState, entryHexesFor, statics, type EntryPick } from '@asl/rules';
import { counterImage } from '../game/assets';
import { hexLabel } from '../game/describe';

/*
 * The secret entry choice on screen (S22 SSR 2): which groups come, on which turn, and the edge hex
 * each is recorded at, clicked on the map. Afterwards the choosing side's own online screen keeps
 * showing its recorded hexes; nobody else's does.
 */

interface Args {
  env: QueryEnv;
  decision: Decision | undefined;
  owner: SideId | undefined;
  /** The seated side online (null for a shared hotseat screen or a spectator). */
  viewer: SideId | null;
  run(a: Omit<Action, 'decisionId' | 'side'>): void;
  setError(m: string | null): void;
  plain(m: string | null | undefined): string | null;
}

export interface EntryGroupsUi {
  active: boolean;
  /** Hex → role: an edge hex a group may be recorded at, or a recorded hex (and the hexes beside it it may enter by). */
  highlights: Map<HexId, 'pick' | 'chosen' | 'near'>;
  onHexClick(hex: HexId): boolean;
  confirm: { label: string; icon: string; blocked: string | null; onClick(): void; hint?: string } | null;
  panel: ReactNode;
}

export function useEntryGroupsPicker({ env, decision, owner, viewer, run, setError, plain }: Args): EntryGroupsUi {
  const choosing = owner && decision?.kind === ENTRY_GROUPS_DECISION ? decision : null;
  const p = entryGroupsParams(env);
  const [picks, setPicks] = useState<Record<string, { turn: number; hex: HexId | null }>>({});
  const [placingFor, setPlacingFor] = useState<string | null>(null);
  useEffect(() => {
    setPicks({});
    setPlacingFor(null);
  }, [choosing?.id]);
  const edge = useMemo(() => new Set(choosing ? entryEdgeHexes(env) : []), [choosing, env]);

  const list: EntryPick[] = Object.entries(picks).map(([force, x]) => ({ force, turn: x.turn, hex: x.hex ?? '' }));
  const complete = list.every((x) => x.hex);
  const blocked = choosing ? (complete ? plain(entryGroupsIllegal(env, choosing.owner, list)) : 'Click an edge hex for every group you bring') : null;

  const toggle = (force: string) => {
    const next = { ...picks };
    if (next[force]) {
      delete next[force];
      if (placingFor === force) setPlacingFor(null);
    } else {
      next[force] = { turn: p!.turn, hex: null };
      setPlacingFor(force);
    }
    setPicks(next);
  };
  const setTurn = (force: string, turn: number) => setPicks({ ...picks, [force]: { ...picks[force]!, turn } });
  const pickHex = (hex: HexId) => {
    const id = statics(env).map.hex(hex)?.id;
    if (!placingFor) {
      setError('Tick a group first, then click the edge hex it enters at');
      return true;
    }
    if (!id || !edge.has(id)) {
      setError('The entry hex must be a hex along a board edge');
      return true;
    }
    const next = { ...picks, [placingFor]: { ...picks[placingFor]!, hex: id } };
    setPicks(next);
    setPlacingFor(Object.entries(next).find(([, x]) => !x.hex)?.[0] ?? null);
    setError(null);
    return true;
  };

  const highlights = new Map<HexId, 'pick' | 'chosen' | 'near'>();
  if (choosing) {
    if (placingFor) for (const h of edge) highlights.set(h, 'pick');
    for (const x of Object.values(picks)) if (x.hex) for (const h of entryHexesFor(env, x.hex)) highlights.set(h, h === x.hex ? 'chosen' : 'near');
  } else {
    // The recorded hexes of groups still to come, on the choosing side's own online screen only.
    const st = entryGroupsState(env);
    if (st && viewer === st.side) {
      const waiting = new Set(
        Object.values(env.state.pieces)
          .filter((pc) => pc.side === st.side && pc.loc.kind === 'offboard' && !pc.loc.hex && pc.loc.edge !== 'exited' && pc.tags['entryTurn'] !== undefined)
          .map((pc) => statics(env).scenario.forces[pc.tags['force'] as number]?.id),
      );
      for (const x of st.picks) if (waiting.has(x.force)) for (const h of entryHexesFor(env, x.hex)) highlights.set(h, h === x.hex ? 'chosen' : 'near');
    }
  }

  let panel: ReactNode = null;
  if (choosing && p) {
    const forces = statics(env).scenario.forces;
    const first = list.filter((x) => x.turn === p.turn).length;
    const later = list.filter((x) => x.turn === p.laterTurn).length;
    const options = Array.from({ length: p.maxDelayed + 1 }, (_, k) => `${p.choose - k} + ${2 * k}`).join(', ');
    panel = (
      <div className="composer entry-groups">
        <p className="hint">{statics(env).scenario.ssr.find((r) => r.module === 'entry-groups')?.text}</p>
        <p className="hint">
          Tick each group you bring, set its turn, and click the edge hex it enters at (it may enter there or beside it). Turn {p.turn} + Turn {p.laterTurn}: {options}. Now{' '}
          <b className={entryCountsLegal(p, first, later) ? '' : 'warn'}>
            {first} + {later}
          </b>
          . Nobody else sees the choice until a group sets up to enter.
        </p>
        <ul className="entry-groups-list">
          {p.forces.map((fid) => {
            const f = forces.find((x) => x.id === fid)!;
            const x = picks[fid];
            return (
              <li key={fid} className={`${x ? 'on' : ''} ${placingFor === fid ? 'placing' : ''}`}>
                <label>
                  <input type="checkbox" checked={!!x} onChange={() => toggle(fid)} /> <b>{f.group?.replace(/^.*: /, '') ?? fid}</b>
                </label>
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
                {x && (
                  <span className="entry-when">
                    {[p.turn, p.laterTurn].map((t) => (
                      <button key={t} className={`ghost small ${x.turn === t ? 'on' : ''}`} onClick={() => setTurn(fid, t)}>
                        Turn {t}
                      </button>
                    ))}{' '}
                    <button className={`ghost small ${placingFor === fid ? 'on' : ''}`} onClick={() => setPlacingFor(fid)} title="The next click on an edge hex records this group's entry">
                      {x.hex ? `at ${hexLabel(x.hex)}` : placingFor === fid ? 'click an edge hex…' : 'pick hex'}
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        {blocked && <div className="muted small">{blocked}</div>}
      </div>
    );
  }

  const confirm = choosing
    ? { label: 'Record entries', icon: '✔', blocked, onClick: () => run({ type: 'entryGroups.choose', picks: list }), hint: 'Lock in the groups, their turns and hexes (secret)' }
    : null;

  return { active: !!choosing, highlights, onHexClick: (hex) => (choosing ? pickHex(hex) : false), confirm, panel };
}
