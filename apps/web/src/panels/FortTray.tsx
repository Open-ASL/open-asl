import type { ReactElement } from 'react';
import type { QueryEnv, SideId } from '@asl/engine';
import { fortKindName, fortPools, type FortPlacement, type FortificationsParams, type MineFactors, type PillboxFactors } from '@asl/rules';
import { markerImage } from '../game/assets';
import { hexLabel } from '../game/describe';

/** What a tray tile puts down when a hex is clicked: the kind and, where the tile chooses it, the size or strength. */
export type FortSpec = Pick<FortPlacement, 'kind' | 'capacity' | 'pillbox' | 'mines'>;

/** The marker key of a counter's art (`assets.json`), as the board and the tray draw it. */
export function fortMarker(c: Pick<FortPlacement, 'kind' | 'capacity' | 'pillbox' | 'mines'>, revealedStrength = true): string {
  switch (c.kind) {
    case 'foxhole':
      return `Foxhole${c.capacity ?? 1}S`;
    case 'trench':
      return 'Trench';
    case 'ditch':
      return 'ATditch';
    case 'wire':
      return 'Wire';
    case 'roadblock':
      return 'Roadblock';
    case 'pillbox':
      return `Pillbox${c.pillbox?.capacity ?? 1}${c.pillbox?.ca ?? 3}${c.pillbox?.nca ?? 5}`;
    case 'mines': {
      const m = c.mines ?? {};
      if (!revealedStrength || (!m.ap && !m.at && !m.dummy)) return 'Mine';
      if (m.dummy) return 'MineD';
      if (m.ap) return `MineAP${String(m.ap).padStart(2, '0')}`;
      return `MineAT${m.at ?? 1}`;
    }
  }
}

interface Props {
  env: QueryEnv;
  side: SideId;
  params: FortificationsParams;
  /** The counters placed in this draft, in order. */
  placed: FortPlacement[];
  /** Counters already sent to the engine (a setup resumed): shown placed, nothing to take back. */
  locked: boolean;
  picked: FortSpec | null;
  onPick(spec: FortSpec | null): void;
  onUnplace(index: number): void;
  /** Change a placed foxhole's size or a minefield's factors. */
  onChange(index: number, patch: Partial<FortPlacement>): void;
  /** The Known belt tool (ASLRB B28.46): null when off; its first hex, then its second when a zigzag is to be chosen. */
  belt?: { from?: string; to?: string } | null;
  onBelt?(): void;
  onGrain?(grain: 'alt-left' | 'alt-right'): void;
}

const AP: MineFactors['ap'][] = [6, 8, 12];
const AT: NonNullable<MineFactors['at']>[] = [1, 2, 3, 4, 5];
const pillKey = (p: PillboxFactors) => `${p.capacity}+${p.ca}+${p.nca}`;

/**
 * The fortification counters a special rule gives the side, as tiles under the unit tray (full ASL A12.33, B26–B30):
 * click a tile then a hex. Each tile shows what its pool has left; a foxhole tile chooses its size, the mine tiles
 * their strength (A-P 6/8/12, or A-T factors by exchange). Placed counters are listed with their hex, hidden or open,
 * and can be taken back. Hidden or open, a roadblock's hexside and a pillbox's arc are set on the map (the hex wheel).
 */
export function FortTray({ env, side, params, placed, locked, picked, onPick, onUnplace, onChange, belt, onBelt, onGrain }: Props) {
  const left = fortPools(env, side, placed);
  const pick = (spec: FortSpec) => onPick(picked && JSON.stringify(picked) === JSON.stringify(spec) ? null : spec);
  const same = (spec: FortSpec) => !!picked && JSON.stringify(picked) === JSON.stringify(spec);
  const tile = (spec: FortSpec, count: string, title: string, disabled: boolean, key: string) => (
    <button key={key} className={`tray-counter fort-tile ${same(spec) ? 'picked' : ''} ${disabled ? 'spent' : ''}`} title={title} disabled={disabled || locked} onClick={() => pick(spec)}>
      <img src={markerImage(fortMarker(spec)) ?? ''} alt={fortKindName(spec)} draggable={false} />
      <span className="tray-hex static">{count}</span>
    </button>
  );
  const tiles: ReactElement[] = [];
  if (params.foxholes) {
    const cap = Math.min(3, Math.max(1, left.foxholes)) as 1 | 2 | 3;
    const chosen = (picked?.kind === 'foxhole' ? picked.capacity : undefined) ?? cap;
    tiles.push(tile({ kind: 'foxhole', capacity: Math.min(chosen, Math.max(1, left.foxholes)) as 1 | 2 | 3 }, `${left.foxholes} sq`, `Foxholes: ${left.foxholes} of ${params.foxholes} squads of capacity left (ASLRB B27.1); the size is chosen on the placed counter`, left.foxholes <= 0, 'fox'));
  }
  if (params.trenches) tiles.push(tile({ kind: 'trench' }, `${left.trenches}`, `Trench counters: ${left.trenches} of ${params.trenches} left (ASLRB B27.51)`, left.trenches <= 0, 'trench'));
  if (params.ditch) tiles.push(tile({ kind: 'ditch' }, `${left.ditch}`, `A-T Ditch counters: ${left.ditch} of ${params.ditch} left (ASLRB B27.56)`, left.ditch <= 0, 'ditch'));
  if (params.wire) tiles.push(tile({ kind: 'wire' }, `${left.wire}`, `Wire: ${left.wire} of ${params.wire} left (ASLRB B26.1)`, left.wire <= 0, 'wire'));
  if (params.mines?.factors) {
    const ap = [...AP].reverse().find((a) => a! <= left.factors) ?? 6;
    tiles.push(tile({ kind: 'mines', mines: { ap: (picked?.kind === 'mines' && !picked.mines?.known && picked.mines?.ap && picked.mines.ap <= left.factors ? picked.mines.ap : ap) as 6 | 8 | 12 } }, `${left.factors} f`, `A-P minefield factors: ${left.factors} of ${params.mines.factors} left, 6, 8 or 12 per hex, recorded (ASLRB B28.1)${left.at ? '; or A-T mines, three factors each (B28.5)' : ''}; the strength is chosen on the placed counter`, left.factors < (left.at ? 3 : 6), 'ap'));
  }
  if (params.mines?.known) tiles.push(tile({ kind: 'mines', mines: { ap: ([...AP].reverse().find((a) => a! <= left.known) ?? 6) as 6 | 8 | 12, known: true } }, `Kn ${left.known}`, `Known minefield factors: ${left.known} of ${params.mines.known} left, on the board with the strength down (ASLRB B28.45)`, left.known < 6, 'known'));
  // B28.47: with no Dummy allotted, one free Dummy for every 24 Known minefield factors set up.
  const freeDummies = !params.mines?.dummies && !!params.mines?.known;
  if (left.dummies > 0 || params.mines?.dummies || freeDummies)
    tiles.push(tile({ kind: 'mines', mines: { known: true, dummy: true } }, `${left.dummies}`, `Dummy Minefield counters: ${left.dummies} left (ASLRB B28.47)${freeDummies ? ', one for every 24 Known minefield factors set up' : ''}; looks like a Known minefield to the enemy`, left.dummies <= 0, 'dummy'));
  if (params.roadblocks) tiles.push(tile({ kind: 'roadblock' }, `${left.roadblocks}`, `Roadblocks: ${left.roadblocks} of ${params.roadblocks} left; in a road hex, across a road hexside chosen on the map (ASLRB B29.1)`, left.roadblocks <= 0, 'rb'));
  for (const pb of [...new Map((params.pillboxes ?? []).map((p) => [pillKey(p), p])).values()]) {
    const n = left.pillboxes.filter((x) => pillKey(x) === pillKey(pb)).length;
    tiles.push(tile({ kind: 'pillbox', pillbox: pb }, `${n}`, `Pillbox ${pillKey(pb)}: ${n} left; in Open Ground, brush, orchard, grain or woods, its Covered Arc chosen on the map (ASLRB B30.1)`, n <= 0, `pb-${pillKey(pb)}`));
  }
  return (
    <div className="tray fort-tray">
      <h4>
        Fortifications <span className="muted">({params.rule ?? 'SSR'} · {placed.length} placed)</span>
      </h4>
      <p className="muted small">
        Click a tile, then a green hex. Hidden or open: right-click the hex (a minefield is always recorded, a Known or Dummy one always on the board). A roadblock asks for its road hexside, a pillbox for its Covered Arc, on the map. Units go beneath or inside a counter from the hex wheel once they are down. Unused counters are forfeited on Confirm.
      </p>
      <div className="tray-grid">{tiles}</div>
      {params.mines?.known && onBelt && !locked && (
        <div className="belt-tool">
          <button className={belt ? 'on' : ''} onClick={onBelt} title="Two arrowed Known counters along a Hex Grain (or Alternate Hex Grain): every hex between them, inclusive, is a Known minefield whose mines (or none) you record (ASLRB B28.46)">
            Known belt
          </button>
          {belt && !belt.from && <span className="muted small"> Click the first hex of the belt.</span>}
          {belt?.from && !belt.to && <span className="muted small"> From {hexLabel(belt.from)}: click the other end (same Hex Grain or Alternate Hex Grain).</span>}
          {belt?.from && belt.to && (
            <span className="small">
              {' '}
              {hexLabel(belt.from)}–{hexLabel(belt.to)} is on an Alternate Hex Grain: which zigzag (ASLRB A9.221)?{' '}
              <button onClick={() => onGrain?.('alt-left')}>Left</button> <button onClick={() => onGrain?.('alt-right')}>Right</button>
            </span>
          )}
        </div>
      )}
      {placed.length > 0 && (
        <>
          <div className="small muted">Placed</div>
          <ul className="fort-placed">
            {placed.map((c, i) => (
              <li key={i} className={`fort-row ${c.hidden ? 'hidden' : ''}`}>
                <img src={markerImage(fortMarker(c)) ?? ''} alt="" width={28} height={28} draggable={false} />
                <span className="fort-row-what">
                  {hexLabel(c.hex)} {fortKindName(c)}
                  {c.belt && <span className="muted"> · belt</span>}
                  {c.kind === 'roadblock' && c.hexside === undefined && <span className="amber"> · hexside?</span>}
                  {c.kind === 'pillbox' && c.ca === undefined && <span className="amber"> · arc?</span>}
                </span>
                {c.kind === 'foxhole' && !locked && (
                  <span className="chooser">
                    {([1, 2, 3] as const).map((cap) => (
                      <button key={cap} className={c.capacity === cap ? 'on' : ''} disabled={left.foxholes + (c.capacity ?? 1) < cap} onClick={() => onChange(i, { capacity: cap })} title={`${cap}S: room for ${cap} squad${cap === 1 ? '' : 's'}`}>
                        {cap}S
                      </button>
                    ))}
                  </span>
                )}
                {c.kind === 'mines' && c.belt && !locked && (
                  <span className="chooser" title={`On the Known belt ${c.belt}: record this hex's A-P mines, or none (ASLRB B28.46)`}>
                    <button className={c.mines?.dummy ? 'on' : ''} onClick={() => onChange(i, { mines: { known: true, dummy: true } })} title="No mines in this hex of the belt">
                      none
                    </button>
                    {AP.map((ap) => (
                      <button key={ap} className={c.mines?.ap === ap ? 'on' : ''} disabled={left.known + (c.mines?.ap ?? 0) < ap!} onClick={() => onChange(i, { mines: { known: true, ap } })} title={`${ap} Known A-P factors`}>
                        {ap}
                      </button>
                    ))}
                  </span>
                )}
                {c.kind === 'mines' && !c.mines?.dummy && !c.belt && !locked && (
                  <span className="chooser">
                    {AP.map((ap) => {
                      const pool = c.mines?.known ? left.known : left.factors;
                      const cost = (c.mines?.known ? 0 : 3 * (c.mines?.at ?? 0)) + ap!;
                      const spent = (c.mines?.ap ?? 0) + (c.mines?.known ? 0 : 3 * (c.mines?.at ?? 0));
                      return (
                        <button key={ap} className={c.mines?.ap === ap ? 'on' : ''} disabled={pool + spent < cost} onClick={() => onChange(i, { mines: { ...c.mines, ap: c.mines?.ap === ap && c.mines?.at ? undefined : ap } })} title={`${ap} A-P factors`}>
                          {ap}
                        </button>
                      );
                    })}
                    {left.at && !c.mines?.known &&
                      AT.map((at) => {
                        const spent = (c.mines?.ap ?? 0) + 3 * (c.mines?.at ?? 0);
                        return (
                          <button key={`at${at}`} className={c.mines?.at === at ? 'on' : ''} disabled={left.factors + spent < (c.mines?.ap ?? 0) + 3 * at} onClick={() => onChange(i, { mines: { ...c.mines, at: c.mines?.at === at && c.mines?.ap ? undefined : at } })} title={`${at} A-T factor${at === 1 ? '' : 's'} (three A-P factors each, ASLRB B28.5)`}>
                            AT{at}
                          </button>
                        );
                      })}
                  </span>
                )}
                <span className={`pill ${c.hidden ? 'on' : ''}`} title={c.kind === 'mines' && !c.mines?.known ? 'A minefield is recorded, never on the board until it attacks (ASLRB B28.1)' : c.mines?.known ? 'A Known or Dummy minefield is placed on the board (ASLRB B28.45, B28.47)' : 'Right-click the hex to set up hidden or in the open (ASLRB A12.33)'}>
                  {c.hidden ? (c.kind === 'mines' ? 'recorded' : 'hidden') : 'open'}
                </span>
                {!locked && (
                  <span className="tray-hex" role="button" title="Take back" onClick={() => onUnplace(i)}>
                    ×
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
