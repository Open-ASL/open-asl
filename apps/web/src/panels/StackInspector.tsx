import type { CSSProperties } from 'react';
import type { HexId, Piece, PieceId, QueryEnv } from '@asl/engine';
import { AMMO_NAME, isCaveLoc, ppOf, terrainOf, acquisitionsAt, ammoOut, coveredArc, defOf, fireMarker, gunIdent, isWeaponDef, levelOfLoc, locOf, locationsOf, moveState, shownFireMarker, smokeDrm, smokeGrenades, stackOrder, swHeldBy, unitsInHex, unpossessedWeaponsAt, unpossessedWeaponsInHex, type Statics } from '@asl/rules';
import { counterImage, markerImage } from '../game/assets';
import { defLabel, nationName, pieceLabel } from '../game/describe';
import { smoke58Chits } from '../game/smoke';

interface Props {
  env: QueryEnv;
  hex: HexId | null;
  selected: Set<PieceId>;
  onToggle(id: PieceId): void;
  actingSide?: string;
  /**
   * A carried SW goes wherever its holder goes (movement, advance, rout), so its row shows the holder's tick;
   * only when firing is it ticked on its own (fired with its holder's FP or held back).
   */
  swWithHolder?: boolean;
}

const STATUS: [string, string][] = [
  ['broken', 'Broken'],
  ['dm', 'DM'],
  ['pinned', 'Pinned'],
  ['cx', 'CX'],
  ['wounds', 'Wounded'],
  // SSR (LMA5 SSR 4): a leader pinned for the rest of the game.
  ['relieved', 'Relieved of command (pinned for the rest of the game)'],
  ['malf', 'Malfunctioned'],
  ['intensive', 'Intensive Fire'],
  ['emplaced', 'Emplaced'],
  ['hip', 'Hidden (HIP)'],
  ['concealed', 'Concealed (SK4 8.3)'],
  ['banzai', 'Banzai Charge (SK4 8.1.8.6)'],
  ['caLocked', 'Turned (cannot move)'],
  ['hazardous', 'Hazardous Movement'],
  ['manhandled', 'Manhandled'],
  // SK3 vehicles.
  ['ce', 'CE'],
  ['motion', 'In Motion'],
  ['bog', 'Bogged'],
  ['immob', 'Immobilized'],
  ['dugIn', 'Dug in'],
  ['shock', 'Shocked'],
  ['stun', 'Stunned'],
  ['recall', 'Recalled'],
  ['wreck', 'Wreck'],
  ['bff', 'Bounding First Fire'],
  ['lowAmmo', 'Low Ammo'],
  ['maDisabled', 'MA disabled'],
  ['stalled', 'Stalled'],
];
/** A vehicular MG piece: part of its vehicle, not a counter of its own. */
const isFixedMg = (d: { kind: string; fixed?: boolean }) => d.kind === 'sw' && !!d.fixed;
const SPINE_NAME = ['NE', 'E', 'SE', 'SW', 'W', 'NW'];
/** The chit colour of each nationality's own markers (CE, the hidden "?"), as the board draws them (art/markers). */
const CHIT: Record<string, string> = { ge: '#97d0f5', ru: '#d78f1e', am: '#cad842', br: '#e5d0a5', it: '#aab0b5', al: '#8aefc2' };
/** Where the board's marker for a status says something more particular (Mired, not Bogged; Unconfirmed Kill, not Shocked). */
const VALUE_LABEL: Record<string, string> = { 'bog-mired': 'Mired', 'shock-uk': 'Unconfirmed Kill', 'stun-plus1': 'Stunned (+1)' };
const FIRE_LABEL = { prep: 'Prep Fire', adv: 'Advancing Fire', first: 'First Fire', final: 'Final Fire' } as const;

export function StackInspector({ env, hex, selected, onToggle, actingSide, swWithHolder = false }: Props) {
  if (!hex) {
    return (
      <section className="panel inspector">
        <h3>Stack</h3>
        <p className="muted">Hover or click a hex.</p>
      </section>
    );
  }
  const map = (env.statics as Statics).map;
  const h = map.hex(hex);
  const off = !h && !!map.offboardHex(hex);
  // Offboard entry hexes hold units waiting to enter.
  const here = off
    ? Object.values(env.state.pieces).filter((p) => p.loc.kind === 'offboard' && p.loc.hex === hex && !isWeaponDef(defOf(env, p)))
    : unitsInHex(env, hex);
  // Read from the top of each side's stack down, as the board stacks it: a vehicle at the bottom, a leader on
  // the MMC he is stacked on (SK1 3.8), and each unit's SW above it (ASLRB A4.43: a SW belongs to the unit beneath it).
  const isVeh = (p: Piece) => defOf(env, p).kind === 'vehicle';
  const units = [...new Set(here.map((p) => p.side))]
    .sort()
    .flatMap((side) => {
      const mine = here.filter((p) => p.side === side);
      return [...mine.filter(isVeh), ...stackOrder(env, mine.filter((p) => !isVeh(p)))].reverse();
    });
  /** A unit's SW, top first: a SW lies above the Gun it is possessed with. */
  const heldTopDown = (u: Piece) =>
    swHeldBy(env.state, u.id)
      .filter((w) => !isFixedMg(defOf(env, w)))
      .sort((a, b) => Number(defOf(env, a).kind === 'gun') - Number(defOf(env, b).kind === 'gun'));
  const loose = off ? [] : unpossessedWeaponsInHex(env, hex);
  // The enemy's concealed stacks (SK4 8.3.2): one "?" counter each, nothing to inspect beneath it.
  const standIns = off ? [] : Object.values(env.state.pieces).filter((p) => p.loc.kind === 'hex' && p.loc.hex === hex && defOf(env, p).kind === 'unknown');
  const qmarkOf = (p: Piece) => markerImage(`qmark-${(env.statics as Statics).scenario.sides.find((x) => x.side === p.side)?.nationality ?? defOf(env, p).nationality}`);
  const markers = env.state.hexMarkers[hex] ?? {};
  // Full ASL: a building hex with upper levels is listed Location by Location, the highest first (ASLRB A2.8).
  const locs = off ? [hex] : [...locationsOf(env, hex)].reverse();
  const acquired = off ? [] : acquisitionsAt(env, hex);
  // No Motion counter on the vehicle while it moves (ASLRB D2.4).
  const moving = moveState(env)?.units[0];

  /**
   * A SW's ROF, and its B# when lowered, for the unit holding it: Inexperienced (SK1 5.4), captured (SK1 5.5), a Japanese
   * MMG/HMG/ATR in a squad's hands (SK4 8.1.8.2). The hover names the reasons.
   */
  const swUse = (p: Piece, printedRof?: number) => {
    const user = p.loc.kind === 'held' ? p.loc.by : undefined;
    const b = env.explain('sw.breakdown', { sw: p.id, ...(user ? { user } : {}) }, null);
    const rof = env.explain('sw.rof', { sw: p.id, ...(user ? { user } : {}) }, 0);
    const why = [...b.trace, ...rof.trace].filter((t) => t.label && !t.suppressedBy && !t.secret && t.before !== t.after).map((t) => `${t.label}${t.ref ? ` (${t.ref})` : ''}`);
    const lowered = why.length > 0;
    const text = `${rof.value ? ` ROF${rof.value}` : printedRof ? ' no ROF' : ''}${lowered && b.value !== null ? ` B${b.value}` : ''}`;
    return lowered ? (
      <span className="sw-lowered" title={`Lowered for ${user ? pieceLabel(env, env.state.pieces[user]) : 'this weapon'}: ${[...new Set(why)].join('; ')}`}>
        {text}
      </span>
    ) : (
      text
    );
  };

  const row = (p: Piece, nested = false) => {
    const d = defOf(env, p);
    const flipped = p.tags['broken'] === true || (p.tags['malf'] === true && d.kind !== 'vehicle') || p.tags['wreck'] === true;
    const img = counterImage(p.defId, flipped);
    const fire = shownFireMarker(p);
    const mine = p.side === actingSide;
    const holder = swWithHolder && nested && p.loc.kind === 'held' ? p.loc.by : undefined;
    const ticked = selected.has(holder ?? p.id);
    return (
      <li key={p.id} className={`piece ${nested ? 'nested' : ''} ${ticked ? 'sel' : ''} ${p.tags['broken'] === true ? 'broken' : ''}`} title={holder ? 'Carried: goes with the unit holding it' : undefined}>
        <label>
          <input type="checkbox" disabled={!mine || !!holder} checked={ticked} onChange={() => onToggle(p.id)} />
          {img ? <img src={img} alt="" width={36} height={36} /> : <span className="noimg" />}
          <span className="pname">
            <span className={`nat nat-${d.nationality}`}>{nationName(env, d.nationality)}</span> {defLabel(d)}
            {d.kind === 'sw' && <span className="muted small"> {d.fp}-{d.range}{swUse(p, d.rof)} {ppOf(env, p)}PP{p.tags['disassembled'] ? ' · disassembled' : ''}</span>}
            {d.kind === 'vehicle' && (
              <span className="muted small">
                {' '}
                {gunIdent(env, p) ? `${gunIdent(env, p)} · ` : ''}{d.mp} MP · AF {d.af.hull.front}/{d.af.hull.side}{d.ma ? ` · ${d.ma.caliber}${d.ma.barrel ?? ''}${d.ma.rof ? ` ROF${d.ma.rof}` : ''}` : ''}
                {p.tags['vca'] !== undefined ? ` · VCA ${SPINE_NAME[Number(p.tags['vca'])]}` : ''}
                {d.turret !== 'NT' && p.tags['ca'] !== undefined && p.tags['ca'] !== p.tags['vca'] ? ` · TCA ${SPINE_NAME[Number(p.tags['ca'])]}` : ''}
                {p.tags['acqHex'] ? ` · has acquired ${String(p.tags['acqHex']).replace(/^[a-z]/, '')} (-${p.tags['acqLevel']})` : ''}
              </span>
            )}
            {d.kind === 'gun' && (
              <span className="muted small">
                {' '}
                Gun {gunIdent(env, p)} · {d.rof ? `ROF${d.rof} ` : ''}{d.ife ? `IFE ${d.ife} ` : ''}· CA {SPINE_NAME[coveredArc(p)]}{p.tags['acqHex'] ? ` · has acquired ${String(p.tags['acqHex']).replace(/^[a-z]/, '')} (-${p.tags['acqLevel']})` : ''}
              </span>
            )}
          </span>
        </label>
        <span className="tags">
          {STATUS.filter(([k]) => p.tags[k] && !(k === 'motion' && p.id === moving)).map(([k, label]) => (
            <span
              key={k}
              className={`tag tag-${k}${typeof p.tags[k] === 'string' ? ` tag-${k}-${p.tags[k]}` : ''}${d.kind === 'vehicle' ? ` vehicle-${k}` : ''}`}
              style={k === 'ce' || k === 'hip' ? ({ '--chit': CHIT[d.nationality] } as CSSProperties) : undefined}
            >
              {VALUE_LABEL[`${k}-${String(p.tags[k])}`] ?? label}
            </span>
          ))}
          {p.loc.kind === 'hex' && p.tags['prepared'] === p.loc.hex && (
            <span className="tag tag-dugIn" title="In its prepared position: +TEM against fire until it leaves this hex, never regained (SSR)">
              Dug in
            </span>
          )}
          {ammoOut(p).length > 0 && <span className="tag tag-malf">Out of {ammoOut(p).map((k) => AMMO_NAME[k]).join(', ')}</span>}
          {/* A unit that fired only its SW keeps its own FP until the phase ends (SK4 4.0), when the marker goes on. */}
          {fire && fire !== 'bff' && (fireMarker(p) || d.kind === 'sw' ? <span className={`tag tag-fire-${fire}`}>{FIRE_LABEL[fire]}</span> : <span className={`tag tag-fire-${fire}`} title="Its SW has fired; its own FP may still fire this phase">SW fired</span>)}
        </span>
      </li>
    );
  };

  return (
    <section className="panel inspector">
      <h3>
        {hex} <span className="muted">{off ? 'offboard' : h ? terrainOf(env, h.id).name : ''}{h?.features.length ? ` · ${h.features.join(', ')}` : ''}{h?.elevation ? ` · level ${h.elevation}` : ''}{locs.some(isCaveLoc) ? ' · Cave hex' : locs.length > 1 ? (h?.building?.upper === 2 ? ' · Multi-Story Building' : ' · Two Story House') : ''}</span>
      </h3>
      {(Object.keys(markers).length > 0 || acquired.length > 0) && (
        <div className="hexmarkers">
          {acquired.map((a) => (
            <span key={a.gun.id} className="tag tag-acq">Acquired -{a.level} by Gun {gunIdent(env, a.gun)}{a.type === 'ATT' ? ' (Area)' : ''}</span>
          ))}
          {smokeGrenades(markers) > 0 ? <span className="tag tag-smoke">{smokeGrenades(markers) > 1 ? `${smokeGrenades(markers)} Smoke grenades (+2 each)` : 'Smoke grenades (+2)'}</span> : null}
          {smoke58Chits(markers).map((c, i) => <span key={`s58-${i}`} className="tag tag-smoke">{c.label}</span>)}
          {smokeGrenades(markers) + smoke58Chits(markers).length > 1 ? <span className="tag tag-smoke">Smoke +{smokeDrm(env, hex)} in all (at most +3)</span> : null}
          {markers['cc'] ? <span className="tag tag-cc">Close Combat</span> : null}
          {markers['melee'] ? <span className="tag tag-melee">Melee</span> : null}
          {markers['residualFp'] ? <span className="tag tag-rfp">Residual {String(markers['residualFp'])} FP</span> : null}
        </div>
      )}
      {standIns.length > 0 && (
        <ul className="pieces">
          {standIns.map((p) => (
            <li key={p.id} className="piece unknown" title="A concealed enemy stack may not be inspected (SK4 8.3.2): fire at it as Area Fire, or move in and find out">
              <label>
                <input type="checkbox" disabled />
                {qmarkOf(p) ? <img src={qmarkOf(p)!} alt="" width={36} height={36} /> : <span className="noimg" />}
                <span className="pname">
                  <span className={`nat nat-${(env.statics as Statics).scenario.sides.find((x) => x.side === p.side)?.nationality ?? ''}`}>{nationName(env, (env.statics as Statics).scenario.sides.find((x) => x.side === p.side)?.nationality ?? '')}</span> concealed stack
                  <span className="muted small">
                    {typeof p.tags['counters'] === 'number' ? ` · ${p.tags['counters']} counter${p.tags['counters'] === 1 ? '' : 's'} under the "?"` : ''} · cannot be inspected (SK4 8.3.2)
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {locs.length < 2 ? (
        <ul className="pieces">
          {units.map((u) => [...heldTopDown(u).map((s) => row(s, true)), row(u)])}
          {/* An unpossessed weapon: its own row (an <li> already). */}
          {loose.map((s) => row(s))}
          {units.length === 0 && loose.length === 0 && standIns.length === 0 && <li className="muted">Empty</li>}
        </ul>
      ) : (
        locs.map((loc) => {
          const level = levelOfLoc(loc);
          const inLoc = units.filter((u) => locOf(env.state, u) === loc);
          const looseHere = unpossessedWeaponsAt(env, loc);
          const m = env.state.hexMarkers[loc] ?? {};
          return (
            <div key={loc} className={`loc-section ${level ? 'upper' : 'ground'}`}>
              <h4 className="loc-head">
                {level ? <img src={markerImage(`Lev${level}`) ?? ''} alt="" width={18} height={18} /> : null}
                {isCaveLoc(loc) ? <img src={markerImage('Cave') ?? ''} alt="" width={18} height={18} /> : null}
                {isCaveLoc(loc) ? 'Cave Location (+2 TEM)' : level ? `Level ${level}` : locs.some(isCaveLoc) ? `Hill (level ${h?.elevation ?? 1})` : 'Ground level'}
                {level && m['melee'] ? <span className="tag tag-melee">Melee</span> : null}
                {level && m['cc'] ? <span className="tag tag-cc">Close Combat</span> : null}
              </h4>
              <ul className="pieces">
                {inLoc.map((u) => [...heldTopDown(u).map((s) => row(s, true)), row(u)])}
                {/* An unpossessed weapon: its own row (an <li> already). */}
                {looseHere.map((s) => row(s))}
                {inLoc.length === 0 && looseHere.length === 0 && <li className="muted">Empty</li>}
              </ul>
            </div>
          );
        })
      )}
    </section>
  );
}
