import type { Action, Ctx, Decision, HexId, Piece, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { adjacentLocs, hexOfLoc, isGroundLoc, levelOfLoc, locExists, locId, locOf, locationsOf, locationAt, parseLoc, type LocId } from '../common/location';
import { mod6, sideToward } from '../common/hexCorners';
import { byId, defOf, otherSide, personnelAt, personnelInHex, statics, unpossessedWeaponsAt } from '../common/pieces';
import { PHASE_DECISION, PHASE_DONE, askPhaseOwner, type PhaseDoneFn } from '../common/turn';
import { fortifiedRevealed, isFortified, revealFortified } from '../sk1/fortified';
import { knownEnemyAt } from '../sk1/known';
import { P as MP, eliminate, type FlushFn, type RandomSelectFn, type UnitFn } from '../sk1/morale';
import { ROUT_START_SIDE, interdicted, interdictionCheck, type RoutStartSideFn } from '../sk1/rout';
import { moveInternals, moveState, type MoveState } from '../sk1/movement';
import { updateControl, type ControlState } from '../sk1/scenario';
import { T, isCx, fireMarker, hasDm, inMelee, isBroken, isGoodOrder, isPinned, mmc, pieceOf, setTags, smc } from '../sk1/status';
import { isWoodsRoad, smoke58Counters, smoke58Markers, smokeGrenades, terrainOf, type LosTrace } from '../sk1/terrain';
import { heightOf } from '../sk2/elevation';
import { T2 } from '../sk2/status';
import { FP, type AttackResolvedFn, type AttackResolvedInfo } from '../sk1/fire';
import { downwind, ecDrm, gustDir, noWindHex, windAt, windDirectionDrm, windOf } from './wind';

/*
 * Fire in full ASL (ASLRB B25, with B24.6, B24.7, B24.72, B24.721, B24.8 for Flame clearance and A26.16 for Control).
 *
 * A Flame is a beginning Fire with no effect of its own; a Blaze is the full Fire: no entry, its occupants must leave,
 * smoke, spreading (B25.1). Records are per Location (`FireLoc`): several Flames may share one, a Blaze removes them all
 * (B25.15). Every record carries who deliberately Kindled it, or null for an accident (B25.11, A26.16, A26.161).
 *
 * - **Kindling** (B25.11): in the PFPh an unpinned Good Order Infantry unit stacked with a leader (or a SMC alone) may
 *   try to start a Flame in the Burnable Terrain it occupies: the leader's (or lone SMC's) NTC, then each unit's DR ≥ the
 *   terrain's Kindle # with the EC DRM (not in a building or rubble, B25.5), the leader's modifier reversed, -2 for a SMC,
 *   -1 for a HS/crew, -1 in a Fortified Building Location (B23.94). Every unit of the attempt and its director is marked
 *   Prep Fire whatever the outcome; all attempts in the Location are predesignated in one action.
 * - **Attack Fires** (B25.12, B25.13): a FT's Original K or KIA, a HE/HEAT or DC Original KIA (not a Collateral Attack,
 *   not one that made rubble, B24.6) rolls for a Flame: DR + EC DRM (a FT's not in a building but in rubble, per the official Q&A to B25.12; HE's not in a building) ≥ Kindle #.
 * - **Flame → Blaze** (B25.15, B25.151): at the end of every AFPh after the Player Turn it appeared, a non-Hampered Flame
 *   makes a DR + EC DRM (not in a building) -1 Fortified: ≥ the Spread # a Blaze, a Final DR ≤ 2 out. Wind: no effect.
 * - **Spreading** (B25.6–B25.651): every Player Turn after its first, at the end of each AFPh, a Blaze may spread to each
 *   adjacent Burnable Location not already ablaze (buildings horizontally and vertically, never diagonally; ground fires
 *   at ground level): one DR per target, from the source giving it the best chance: ≥ the target's Spread #, -2 not
 *   directly attached, -1 Fortified, ±1 for a lower/higher elevation, EC (not into a building), the Wind Direction DRM in
 *   a Mild Breeze (+2 downwind, +1 beside it, 0 beside upwind, -1 upwind). In Heavy Winds the three downwind hexes get a
 *   Flame outright and the upwind three never; neither wind matters within a building. Gusts (B25.651) put a Flame in the
 *   downwind hex of every Blaze, and one Blaze (Random Selection; ties all) two hexes downwind at ground level.
 * - **Smoke** (B25.2, A24.4): a Blaze is a +3 SMOKE Location for every LOS through its hex at the fire's level and up
 *   to four levels above it (two in a Mild Breeze, none in Heavy Winds), +1 more fired out of; Flames give none.
 * - **Entry and exit** (B25.4): a Blaze Location cannot be entered (moving, advancing, routing, Bypass of an Ablaze
 *   obstacle, A4.3); Infantry in one must leave by the end of the next RtPh or be eliminated, breaking voluntarily to rout
 *   out, or moving out when they cannot break; pinned units and units in Melee cannot leave. Unpossessed SW in a Blaze
 *   are removed (A4.44).
 * - **Clearance** (B25.7, B24.72, B24.7, B24.721, B24.8): unpinned Good Order Infantry (an MMC among them) that have
 *   not moved or fired may fight a Flame in their Location in their own MPh or the DFPh: one DR for all, with Labor,
 *   the directing leader's modifier, -1 for a squad, -1 per further HS/crew and -2 per further squad, the EC DRM: a Final
 *   DR ≤ 2 puts it out, 3–6 Hampers it for the Player Turn. The units are TI (no fire, movement or advance; CC +1/-1);
 *   their Hazardous Movement lasts only while engaged, which ends with the DR made at once, so no attack ever meets it (Q&A
 *   [K33] to B24.7: no MF spent, no First Fire before the DR, no fire in the DFPh); a failure earns a Labor counter (-1,
 *   then -2) for the task. A Blaze cannot be put out.
 * - **Control** (A26.16–A26.162, `'control.adjust'`): a side forfeits every Location/hex/building holding a Fire it
 *   Kindled (spread included) to its opponent while the Fire lasts; an area the Blazes make unenterable goes to the
 *   opponent of the kindler, or, accidental, to the side Controlling most of the hexes round it; a building unenterable
 *   by a Blaze to the side Controlling all its hexes; a chain of Fires started by both sides counts as accidental.
 *
 * The Starter Kit has no Fire at all: nothing here runs there.
 */

declare module '@asl/engine' {
  interface QueryCatalog {
    /** A DRM to a unit's Kindling DR beyond B25.11's own (a MOL's +2, ASLRB A22.613). */
    'fire.kindlingDrm': { ctx: { unit: PieceId; loc: LocId }; value: number };
  }
}

export const FIRE_EXT = 'asl.fire';
const ESCAPE_EXT = 'asl.fire.escape';
export const BLAZE_ESCAPE_DECISION = 'blazeEscape';

export interface TurnKey {
  turn: number;
  attacker: SideId;
}
export interface FlameRecord {
  id: number;
  since: TurnKey;
  /** The side that deliberately Kindled it (or the Fire it spread from), or null for an accidental Fire (A26.16, A26.161). */
  kindledBy: SideId | null;
  /** Hampered by a Clearance DR of 3–6 this Player Turn (B24.721): no Blaze DR until the next. */
  hampered?: true;
}
export interface BlazeRecord {
  since: TurnKey;
  kindledBy: SideId | null;
  /** Burning rubble (B24.6), or a Blaze a special rule placed at the start. */
  rubble?: true;
}
export interface FireLoc {
  blaze?: BlazeRecord;
  flames: FlameRecord[];
}
export type FireSource = 'kindle' | 'ft' | 'he' | 'dc' | 'wp' | 'spread' | 'heavy' | 'gust' | 'rubble' | 'ssr';

export const fireState = (env: QueryEnv): Record<LocId, FireLoc> => (env.state.ext[FIRE_EXT] as Record<LocId, FireLoc> | undefined) ?? {};
export const fireAt = (env: QueryEnv, loc: LocId): FireLoc | undefined => fireState(env)[loc];
/**
 * The Blaze a Location is in. A pillbox burns with its hex: its occupants are "fully affected" by a Blaze at the hex's ground
 * level, and leaving into it kills them (Q&A [K33] to B25.4), so a pillbox Location counts as in its hex's Blaze.
 */
export const blazeAt = (env: QueryEnv, loc: LocId): BlazeRecord | undefined => fireState(env)[loc]?.blaze ?? (parseLoc(loc).sub === 'pb' ? fireState(env)[hexOfLoc(loc)]?.blaze : undefined);
export const flamesAt = (env: QueryEnv, loc: LocId): FlameRecord[] => fireState(env)[loc]?.flames ?? [];
/** Whether any Location of the hex holds a Blaze (an obstacle "Ablaze", A4.3; the hex's smoke, B25.2). */
export const isAblaze = (env: QueryEnv, hex: HexId): boolean => Object.entries(fireState(env)).some(([loc, f]) => f.blaze && hexOfLoc(loc) === hex);
export const blazeLocations = (env: QueryEnv): LocId[] =>
  Object.entries(fireState(env))
    .filter(([, f]) => f.blaze)
    .map(([loc]) => loc)
    .sort();
/**
 * The levels a Blaze's smoke in `hex` rises above the Fire's level (B25.2: four; two in a Mild Breeze, A24.4; none in Heavy
 * Winds, B25.63), by the wind in effect there (No Wind in an Interior Building hex, B25.63).
 */
export const blazeSmokeLevels = (env: QueryEnv, hex: HexId): number => ({ none: 4, breeze: 2, heavy: 0 })[windAt(env, hex).force];
/**
 * Whether a Location is a SMOKE Location by a Blaze of its hex (B25.2): above the Fire's level, within the levels its smoke
 * reaches. The Blaze Location itself cannot be entered at all (B25.4).
 */
export function inBlazeSmoke(env: QueryEnv, loc: LocId): boolean {
  const hex = hexOfLoc(loc);
  const lvl = levelOfLoc(loc);
  const up = blazeSmokeLevels(env, hex);
  return blazeLocations(env).some((b) => hexOfLoc(b) === hex && b !== loc && levelOfLoc(b) < lvl && lvl <= levelOfLoc(b) + up);
}
/** Every Location with a Flame or a Blaze. */
export const fireLocations = (env: QueryEnv): LocId[] =>
  Object.entries(fireState(env))
    .filter(([, f]) => f.blaze || f.flames.length)
    .map(([loc]) => loc)
    .sort();

/** The Labor counter tag (B24.8): the Task it was earned for and its DRM, as "<task>@<drm>" (tags are scalars). */
export { laborTag, parseLabor } from './labor';
import { laborTag, parseLabor, tiIllegal } from './labor';

const turnKey = (env: QueryEnv): TurnKey => ({ turn: env.state.turn, attacker: env.state.attacker });
const sameTurn = (a: TurnKey, b: TurnKey) => a.turn === b.turn && a.attacker === b.attacker;

/** The Kindle # and Spread # of a Location's terrain (the Terrain Chart; a Woods-Road hex spreads at 8, B25.6's table). */
export function fireNumbers(env: QueryEnv, loc: LocId): { kindle: number; spread: number } | null {
  const t = terrainOf(env, loc);
  if (!t.fire) return null;
  if (t.id === 'woods' && isGroundLoc(loc) && isWoodsRoad(env, hexOfLoc(loc))) return { kindle: t.fire.kindle, spread: 8 };
  return t.fire;
}
/** Burnable Terrain (B25.1): terrain with a Kindle #. */
export const burnable = (env: QueryEnv, loc: LocId): boolean => fireNumbers(env, loc) !== null;
const inBuilding = (env: QueryEnv, loc: LocId) => terrainOf(env, loc).id.startsWith('building');
const inRubble = (env: QueryEnv, loc: LocId) => terrainOf(env, loc).id.startsWith('rubble');

/** Infantry: MMC and SMC (a vehicle's crew is not). */
const isInfantry = (env: QueryEnv, p: Piece) => !!mmc(env, p) || !!smc(env, p);

// ---------------------------------------------------------------- placing and removing fires

export function placeFlame(ctx: Ctx, loc: LocId, opts: { kindledBy: SideId | null; source: FireSource; from?: LocId; since?: TurnKey }): boolean {
  if (blazeAt(ctx, loc) || !burnable(ctx, loc)) return false;
  const flame: FlameRecord = { id: ctx.state.seq, since: opts.since ?? turnKey(ctx), kindledBy: opts.kindledBy };
  ctx.emit('asl.fire.flame', { loc, flame, source: opts.source, ...(opts.from ? { from: opts.from } : {}) });
  // Control follows the Fire at once (A26.16).
  updateControl(ctx);
  return true;
}

export function placeBlaze(ctx: Ctx, loc: LocId, opts: { kindledBy: SideId | null; source: FireSource; rubble?: boolean; since?: TurnKey }) {
  if (blazeAt(ctx, loc)) return;
  const blaze: BlazeRecord = { since: opts.since ?? turnKey(ctx), kindledBy: opts.kindledBy, ...(opts.rubble ? { rubble: true as const } : {}) };
  ctx.emit('asl.fire.blaze', { loc, blaze, source: opts.source });
  burnUnpossessed(ctx, loc);
  updateControl(ctx);
}

/** Unpossessed SW/Guns in a Blaze Location are removed from play (A4.44): when the Blaze comes, and whenever one is left there later. */
function burnUnpossessed(ctx: Ctx, loc: LocId) {
  for (const w of unpossessedWeaponsAt(ctx, loc).sort(byId)) ctx.emit('piece.eliminated', { id: w.id, reason: 'lost in the Blaze' });
}

/** Every Flame in the Location goes (falling rubble, B24.6; a Clearance DR; the Blaze DR). */
export function removeFlames(ctx: Ctx, loc: LocId, reason: 'out' | 'extinguished' | 'rubble') {
  for (const f of flamesAt(ctx, loc)) ctx.emit('asl.fire.flameGone', { loc, id: f.id, reason });
  updateControl(ctx);
}

// ---------------------------------------------------------------- Flames from attacks (B25.12, B25.13; the hook for FT, DC and WP)

export const FIRE_PROC = {
  /** (ctx, loc, opts) => boolean: roll for a Flame in a Burnable Location after an attack (B25.12, B25.13, A24.32). */
  tryFlame: 'asl.fire.tryFlame',
} as const;
export interface TryFlameOpts {
  source: 'ft' | 'he' | 'dc' | 'wp';
  /**
   * A FT's Flame (B25.12): the EC DRM applies in rubble too, but not in a building (official Q&A to B25.12 [Gen25.1; An89;
   * An95w; An96]: "Does the EC DRM modify the DR ... in a building hex? In a Rubble hex? A. No. Yes.").
   */
  ecInRubble?: boolean;
  /** DRM of the source's own (WP: -1 unless Very Dry, -2 in a building, A24.32). */
  drm?: number;
}
export type TryFlameFn = (ctx: Ctx, loc: LocId, opts: TryFlameOpts) => boolean;

function tryFlameBase(ctx: Ctx, loc: LocId, opts: TryFlameOpts): boolean {
  const n = fireNumbers(ctx, loc);
  if (!n || blazeAt(ctx, loc)) return false;
  const ec = opts.ecInRubble && !inBuilding(ctx, loc) ? ecDrm(ctx) : ecDrm(ctx, loc);
  const fort = isFortified(ctx, loc) ? -1 : 0;
  const drm = ec + fort + (opts.drm ?? 0);
  const roll = ctx.roll(`Flame DR in ${loc}`);
  const flame = roll.total + drm >= n.kindle;
  // The Fortified -1 is secret until it changes the outcome (B23.94, read with B23.911 as the +1 TEM): only then is it
  // shown in the DR, and the Location revealed.
  const decides = !!fort && flame !== roll.total + drm - fort >= n.kindle;
  if (decides) revealFortified(ctx, loc, 'fire');
  const shown = decides ? drm : drm - fort;
  ctx.emit('asl.fire.attackFlame', { loc, source: opts.source, dr: roll.dice as [number, number], drm: shown, needed: n.kindle, flame, explain: [...(ec ? [`EC ${ec > 0 ? '+' : ''}${ec}`] : []), ...(decides ? ['-1 Fortified Building (ASLRB B23.94)'] : []), ...(opts.drm ? [`${opts.drm > 0 ? '+' : ''}${opts.drm}`] : [])] });
  if (flame) placeFlame(ctx, loc, { kindledBy: null, source: opts.source });
  return flame;
}

// ---------------------------------------------------------------- Kindling (B25.11)

export interface KindleAttempt {
  unit: PieceId;
  /** The leader directing a MMC's attempt (B25.11); a SMC attempting alone has none. */
  director?: PieceId;
}
export type KindleAction = Action & { type: 'fire.kindle'; loc: LocId; attempts: KindleAttempt[] };

/** A unit may take part in a Kindling attempt this PFPh: unpinned Good Order Infantry that has not fired or been given a task. */
function canKindle(env: QueryEnv, p: Piece): string | null {
  if (!isInfantry(env, p)) return `${p.id} is not Infantry`;
  if (!isGoodOrder(env, p) || isPinned(p)) return `${p.id} must be unpinned and in Good Order (ASLRB B25.11)`;
  if (fireMarker(p) || p.tags[T.firedSw]) return `${p.id} has already fired this phase`;
  return tiIllegal(p);
}

export function kindleIllegal(env: QueryEnv, a: { loc: LocId; attempts: KindleAttempt[]; side: SideId }): string | null {
  if (env.state.phase !== 'PFPh') return 'Kindling is a Prep Fire Phase action (ASLRB B25.11)';
  if (a.side !== env.state.attacker) return 'Not your Prep Fire Phase';
  const n = fireNumbers(env, a.loc);
  if (!n) return `${terrainOf(env, a.loc).name} is not Burnable Terrain (ASLRB B25.1)`;
  if (blazeAt(env, a.loc)) return 'The Location is already ablaze';
  if (a.attempts.length === 0) return 'Name the units attempting to Kindle';
  if (kindledThisPhase(env, a.loc)) return 'Every Kindling attempt in a Location is predesignated together (ASLRB B25.11)';
  const seen = new Set<PieceId>();
  const directors = new Set<PieceId>();
  for (const at of a.attempts) {
    const p = env.state.pieces[at.unit];
    if (!p || p.side !== a.side) return `${at.unit} is not your unit`;
    if (locOf(env.state, p) !== a.loc) return `${at.unit} is not in ${a.loc}`;
    if (seen.has(at.unit)) return `${at.unit} is listed twice`;
    seen.add(at.unit);
    const why = canKindle(env, p);
    if (why) return why;
    if (mmc(env, p)) {
      if (!at.director) return `${at.unit} may Kindle only when a leader directs it (ASLRB B25.11)`;
      const d = env.state.pieces[at.director];
      if (!d || d.side !== a.side || !smc(env, d) || defOf(env, d).kind !== 'leader') return `${at.director} is not a leader of yours`;
      if (locOf(env.state, d) !== a.loc) return `${at.director} is not in ${a.loc}`;
      const dWhy = canKindle(env, d);
      if (dWhy) return dWhy;
      directors.add(at.director);
    } else if (at.director) return `${at.unit} attempts alone (a SMC needs no director)`;
  }
  for (const d of directors) if (seen.has(d)) return `${d} may not both make a Kindling attempt and direct one (ASLRB B25.11)`;
  return null;
}

/** A Kindling attempt was already made in the Location this phase (B25.11: all attempts there are predesignated). */
const kindledThisPhase = (env: QueryEnv, loc: LocId) => ((env.state.ext['asl.fire.kindled'] as LocId[] | undefined) ?? []).includes(loc);

/** The DRM of one unit's Kindling DR, with its explanation (B25.11, B25.5, B23.94, and the `fire.kindlingDrm` hook). */
export function kindlingDrm(env: QueryEnv, loc: LocId, unit: PieceId, director?: PieceId): { drm: number; explain: string[] } {
  const p = pieceOf(env, unit);
  const explain: string[] = [];
  let drm = 0;
  const m = mmc(env, p);
  if (!m) {
    drm -= 2;
    explain.push('-2 SMC');
  } else if (m.kind !== 'squad') {
    drm -= 1;
    explain.push(`-1 ${m.kind === 'hs' ? 'half-squad' : 'crew'}`);
  }
  if (director) {
    const l = smc(env, pieceOf(env, director))?.leadership ?? 0;
    if (l) {
      drm -= l;
      explain.push(`${-l > 0 ? '+' : ''}${-l} leadership reversed`);
    }
  }
  const ec = ecDrm(env, loc);
  if (ec) {
    drm += ec;
    explain.push(`EC ${ec > 0 ? '+' : ''}${ec}`);
  }
  if (isFortified(env, loc)) {
    drm -= 1;
    explain.push('-1 Fortified Building Location (ASLRB B23.94)');
  }
  const extra = env.query('fire.kindlingDrm', { unit, loc }, 0);
  if (extra) {
    drm += extra;
    explain.push(`${extra > 0 ? '+' : ''}${extra}`);
  }
  return { drm, explain };
}

/** The leaders and SMC that could take part in a Kindling attempt of `side` in `loc`, and the MMC. */
export function kindlers(env: QueryEnv, loc: LocId, side: SideId): { leaders: Piece[]; smcs: Piece[]; mmcs: Piece[] } {
  const here = personnelAt(env, loc, side).filter((p) => canKindle(env, p) === null);
  return {
    leaders: here.filter((p) => defOf(env, p).kind === 'leader'),
    smcs: here.filter((p) => !!smc(env, p)),
    mmcs: here.filter((p) => !!mmc(env, p)),
  };
}

// ---------------------------------------------------------------- spreading (B25.6)

/** The Locations a Blaze in `from` may spread to (B25.6): the same level next door in its building, the level above or below, or the ground of the neighbouring hexes. */
export function spreadTargets(env: QueryEnv, from: LocId): LocId[] {
  const map = statics(env).map;
  const hex = hexOfLoc(from);
  const level = levelOfLoc(from);
  const h = map.hex(hex);
  const out: LocId[] = [];
  if (inBuilding(env, from) || inRubble(env, from)) {
    // Horizontally (B25.6 "spread to any adjacent Burnable Terrain Location"; "Building Blazes spread horizontally and
    // vertically, but not diagonally"): from the ground to every neighbour's ground; from above it to the Location of each
    // adjacent hex at the same height, whatever building or hill it is in (-2 if not directly attached, B25.62).
    const height = heightOf(env, from);
    for (const n of map.neighbors(hex)) {
      if (level === 0) out.push(n);
      else out.push(...locationsOf(env, n).filter((l) => !parseLoc(l).sub && heightOf(env, l) === height));
    }
    const levels = locationsOf(env, hex).filter((l) => !parseLoc(l).sub);
    if (level > 0) out.push(locId(hex, level - 1));
    if (levels.includes(locId(hex, level + 1))) out.push(locId(hex, level + 1));
  } else {
    // Woods and orchard fires spread at ground level (B25.6); so does any other ground fire.
    for (const n of map.neighbors(hex)) out.push(n);
  }
  return out.filter((l) => burnable(env, l) && !blazeAt(env, l));
}

/** Whether two adjacent Locations' terrain is "directly attached" (B25.62): one building, touching depictions, or whole-hex terrain of one kind. */
export function directlyAttached(env: QueryEnv, from: LocId, to: LocId): boolean {
  const map = statics(env).map;
  const a = hexOfLoc(from);
  const b = hexOfLoc(to);
  if (a === b) return true;
  const ha = map.hex(a);
  const hb = map.hex(b);
  if (!ha || !hb) return false;
  if (ha.buildingId && ha.buildingId === hb.buildingId) return true;
  const ta = terrainOf(env, from).id;
  const tb = terrainOf(env, to).id;
  if (ta.startsWith('rubble') && tb.startsWith('rubble')) return true;
  const obstacle = (t: string) => t === 'woods' || t.startsWith('building');
  if (obstacle(ta) && obstacle(tb)) {
    // A building and woods never touch; two of a kind do when both depictions reach the shared hexside (the Bypass mask).
    if (ta === 'woods' !== (tb === 'woods')) return false;
    const k = sideToward(map, a, b);
    if (k === null || !map.bypassSides) return true;
    const closedA = (map.bypassSides(a) & (1 << k)) === 0;
    const closedB = (map.bypassSides(b) & (1 << mod6(k + 3))) === 0;
    return closedA && closedB;
  }
  return ta === tb;
}

/** The DRM of a Spreading Fire DR from `from` into `to` (B25.6–B25.64), with its explanation; `fortified` is listed separately for disclosure. */
export function spreadDrm(env: QueryEnv, from: LocId, to: LocId): { drm: number; fortified: number; explain: string[] } {
  const map = statics(env).map;
  const explain: string[] = [];
  let drm = 0;
  if (!directlyAttached(env, from, to)) {
    drm -= 2;
    explain.push('-2 not directly attached');
  }
  const up = heightOf(env, to) - heightOf(env, from);
  if (up > 0) {
    drm += 1;
    explain.push('+1 to a higher elevation');
  } else if (up < 0) {
    drm -= 1;
    explain.push('-1 to a lower elevation');
  }
  const ec = ecDrm(env, to);
  if (ec) {
    drm += ec;
    explain.push(`EC ${ec > 0 ? '+' : ''}${ec}`);
  }
  const a = hexOfLoc(from);
  const b = hexOfLoc(to);
  if (a !== b && !sameBuilding(env, a, b)) {
    const k = sideToward(map, a, b);
    const w = k === null ? 0 : windDirectionDrm(windOf(env), k);
    if (w) {
      drm += w;
      explain.push(`${w > 0 ? '+' : ''}${w} Wind Direction`);
    }
  }
  const fortified = isFortified(env, to) ? -1 : 0;
  return { drm: drm + fortified, fortified, explain };
}

const sameBuilding = (env: QueryEnv, a: HexId, b: HexId) => {
  const map = statics(env).map;
  const x = map.hex(a)?.buildingId;
  return !!x && x === map.hex(b)?.buildingId;
};

/** The hex across hexside `k` of `hex`, on the map. */
function across(env: QueryEnv, hex: HexId, k: number): HexId | undefined {
  const map = statics(env).map;
  return map.neighbors(hex).find((n) => sideToward(map, hex, n) === k);
}

/** The Location `from`'s Fire reaches in the hex across hexside `k`, if Burnable and not ablaze: the same level within its building, else the ground. */
function targetAcross(env: QueryEnv, from: LocId, k: number): LocId | undefined {
  const hex = hexOfLoc(from);
  const n = across(env, hex, k);
  if (!n) return undefined;
  const level = levelOfLoc(from);
  const loc = level > 0 ? (sameBuilding(env, hex, n) && locationsOf(env, n).includes(locId(n, level)) ? locId(n, level) : undefined) : n;
  return loc !== undefined && burnable(env, loc) && !blazeAt(env, loc) ? loc : undefined;
}

/** The Fire step at the end of an AFPh: spreading from the Blazes, then the Flame → Blaze DRs (B25.151, B25.6). */
function fireAfph(ctx: Ctx) {
  const key = turnKey(ctx);
  const state = fireState(ctx);
  const wind = windOf(ctx);
  const blazes = Object.entries(state)
    .filter(([, f]) => f.blaze)
    .map(([loc, f]) => ({ loc, blaze: f.blaze! }))
    .sort((a, b) => (a.loc < b.loc ? -1 : 1));
  const flames = Object.entries(state)
    .flatMap(([loc, f]) => f.flames.map((flame) => ({ loc, flame })))
    .sort((a, b) => (a.loc < b.loc ? -1 : a.loc > b.loc ? 1 : a.flame.id - b.flame.id));
  const gust = wind.gusts ? gustDir(wind) : undefined;

  // Spreading (B25.6): the Blazes older than this Player Turn; a Gust spreads every Blaze (B25.651).
  const candidates = new Map<LocId, { from: LocId; drm: number; fortified: number; needed: number; explain: string[] }>();
  const autos: { from: LocId; to: LocId; how: 'heavy' | 'gust' }[] = [];
  for (const { loc, blaze } of blazes) {
    const old = !sameTurn(blaze.since, key);
    // No Gust in an Interior Building hex, where No Wind is always in effect (B25.63).
    if (gust !== undefined && !noWindHex(ctx, hexOfLoc(loc))) {
      const to = targetAcross(ctx, loc, gust);
      if (to) autos.push({ from: loc, to, how: 'gust' });
    }
    if (!old) continue;
    for (const to of spreadTargets(ctx, loc)) {
      const building = sameBuilding(ctx, hexOfLoc(loc), hexOfLoc(to)) || hexOfLoc(loc) === hexOfLoc(to);
      if (wind.force === 'heavy' && !building) {
        // Heavy Winds: a Flame outright in the three downwind hexes, nothing in the upwind three (B25.63).
        const k = sideToward(statics(ctx).map, hexOfLoc(loc), hexOfLoc(to));
        if (k !== null && wind.dir !== undefined && Math.min(mod6(k - wind.dir), mod6(wind.dir - k)) <= 1) autos.push({ from: loc, to, how: 'heavy' });
        continue;
      }
      const n = fireNumbers(ctx, to)!;
      const d = spreadDrm(ctx, loc, to);
      const prev = candidates.get(to);
      // Several Blazes beside one Location: the one DR giving it the greatest chance (B25.6).
      if (!prev || n.spread - d.drm < prev.needed - prev.drm) candidates.set(to, { from: loc, drm: d.drm, fortified: d.fortified, needed: n.spread, explain: d.explain });
    }
  }
  for (const a of [...autos].sort((x, y) => (x.to < y.to ? -1 : x.to > y.to ? 1 : x.from < y.from ? -1 : 1))) {
    if (blazeAt(ctx, a.to) || !burnable(ctx, a.to)) continue;
    const kindledBy = blazeAt(ctx, a.from)?.kindledBy ?? null;
    ctx.emit('asl.fire.spread', { from: a.from, to: a.to, auto: a.how, flame: true });
    placeFlame(ctx, a.to, { kindledBy, source: a.how, from: a.from });
  }
  // A Gust also carries one Blaze (or every one tied, A.9) two hexes downwind, to ground level (B25.651).
  if (gust !== undefined) {
    const eligible = blazes.filter(({ loc }) => !noWindHex(ctx, hexOfLoc(loc)) && twoDownwind(ctx, loc, gust) !== undefined).map((b) => b.loc);
    if (eligible.length) {
      const chosen = eligible.length === 1 ? eligible : ctx.proc<RandomSelectFn>(MP.randomSelect)(ctx, eligible, 1, 'Gust: the Blaze spreading two hexes', { ties: true });
      ctx.emit('asl.fire.gustSelect', { candidates: eligible, chosen });
      for (const from of chosen) {
        const to = twoDownwind(ctx, from, gust);
        if (to === undefined) continue;
        ctx.emit('asl.fire.spread', { from, to, auto: 'gust', far: true, flame: true });
        placeFlame(ctx, to, { kindledBy: blazeAt(ctx, from)?.kindledBy ?? null, source: 'gust', from });
      }
    }
  }
  for (const [to, c] of [...candidates.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    if (blazeAt(ctx, to)) continue;
    const roll = ctx.roll(`Spreading Fire DR into ${to}`);
    const final = roll.total + c.drm;
    const spread = final >= c.needed;
    // The Fortified -1 is secret until it changes the outcome (B23.94, as the +1 TEM).
    const decides = !!c.fortified && spread !== roll.total + c.drm - c.fortified >= c.needed;
    const shown = decides ? c.drm : c.drm - c.fortified;
    const explain = decides ? [...c.explain, '-1 Fortified Building Location (ASLRB B23.94)'] : c.explain;
    if (decides && !fortifiedRevealed(ctx, to)) revealFortified(ctx, to, 'fire');
    ctx.emit('asl.fire.spread', { from: c.from, to, dr: roll.dice as [number, number], drm: shown, needed: c.needed, explain, flame: spread });
    if (spread) placeFlame(ctx, to, { kindledBy: blazeAt(ctx, c.from)?.kindledBy ?? null, source: 'spread', from: c.from });
  }

  // Flame → Blaze (B25.151): the Flames that existed before this step, not Hampered, not of this Player Turn.
  for (const { loc, flame } of flames) {
    if (sameTurn(flame.since, key) || flame.hampered || blazeAt(ctx, loc)) continue;
    if (!flamesAt(ctx, loc).some((f) => f.id === flame.id)) continue;
    const n = fireNumbers(ctx, loc);
    if (!n) continue;
    const ec = ecDrm(ctx, loc);
    const fort = isFortified(ctx, loc) ? -1 : 0;
    const roll = ctx.roll(`Blaze DR in ${loc}`);
    const final = roll.total + ec + fort;
    const outcome = final >= n.spread ? 'blaze' : final <= 2 ? 'out' : 'none';
    const without = roll.total + ec;
    const outcomeWithout = without >= n.spread ? 'blaze' : without <= 2 ? 'out' : 'none';
    const shown = fort && outcome === outcomeWithout ? ec : ec + fort;
    if (fort && outcome !== outcomeWithout && !fortifiedRevealed(ctx, loc)) revealFortified(ctx, loc, 'fire');
    const explain = [...(ec ? [`EC ${ec > 0 ? '+' : ''}${ec}`] : []), ...(shown !== ec ? ['-1 Fortified Building Location (ASLRB B23.94)'] : [])];
    ctx.emit('asl.fire.blazeCheck', { loc, id: flame.id, dr: roll.dice as [number, number], drm: shown, needed: n.spread, outcome, explain });
    if (outcome === 'blaze') placeBlaze(ctx, loc, { kindledBy: flame.kindledBy, source: 'kindle' });
    else if (outcome === 'out') {
      ctx.emit('asl.fire.flameGone', { loc, id: flame.id, reason: 'out' });
      updateControl(ctx);
    }
  }
}

/** The ground Location two hexes downwind of a Blaze, Burnable and not ablaze (B25.651). */
function twoDownwind(env: QueryEnv, from: LocId, dir: number): LocId | undefined {
  const one = across(env, hexOfLoc(from), dir);
  const two = one ? across(env, one, dir) : undefined;
  return two && burnable(env, two) && !blazeAt(env, two) ? two : undefined;
}

// ---------------------------------------------------------------- the RtPh escape (B25.4)

interface EscapeState {
  side: SideId;
  answered: PieceId[];
}
const escapeState = (env: QueryEnv) => env.state.ext[ESCAPE_EXT] as EscapeState | undefined;

/** Unbroken Infantry of `side` in a Blaze Location that may still choose how to leave: not pinned, not in Melee. */
function escapers(env: QueryEnv, side: SideId): Piece[] {
  const answered = escapeState(env)?.side === side ? (escapeState(env)?.answered ?? []) : [];
  return Object.values(env.state.pieces)
    .filter((p) => p.side === side && p.loc.kind === 'hex' && isInfantry(env, p) && !isBroken(p) && !isPinned(p) && !answered.includes(p.id))
    .filter((p) => !!blazeAt(env, locOf(env.state, p)!) && !inMelee(env, locOf(env.state, p)!))
    .sort(byId);
}

/**
 * A unit that cannot break voluntarily (A10.41: "only if breaking will not cause their immediate Reduction or
 * elimination"): one with no broken side, as Japanese MMC, which are Reduced instead (G1.13), and Japanese SMC (G1.4).
 * Heroes and berserk units will join here when they exist.
 */
const cannotBreak = (env: QueryEnv, p: Piece): boolean => {
  const d = defOf(env, p) as { brokenMorale?: number; noBrokenSide?: true };
  return d.brokenMorale === undefined || !!d.noBrokenSide;
};

/** Adjacent Locations a unit that cannot break may move out to (B25.4, A11.2: an Accessible Location, not ablaze, no Known enemy). */
export function escapeDestinations(env: QueryEnv, unit: PieceId): LocId[] {
  const p = pieceOf(env, unit);
  const from = locOf(env.state, p);
  if (!from) return [];
  return adjacentLocs(env, from).filter((l) => locExists(env, l) && !blazeAt(env, l) && knownEnemyAt(env, l, p.side).length === 0);
}

function askEscape(ctx: Ctx, side: SideId): boolean {
  const units = escapers(ctx, side);
  if (units.length === 0) return false;
  ctx.pushDecision({
    kind: BLAZE_ESCAPE_DECISION,
    owner: side,
    deadlineClass: 'interrupt',
    data: { units: units.map((p) => p.id), locs: Object.fromEntries(units.map((p) => [p.id, locOf(ctx.state, p)])) },
  });
  return true;
}

export const aslFireModule: RuleModule = {
  id: 'asl.fire',
  ref: 'ASLRB B25.1–B25.7, B24.6, B24.72, B24.721, B24.8, A4.3, A4.44, A26.16',
  summary: 'Fire: Kindling, Flames and Blazes, spreading with the wind, the smoke of a Blaze, no entry, Flame clearance, Control forfeiture.',
  requires: ['asl.labor', 'asl.wind', 'asl.locations', 'sk1.fire', 'sk1.firePhases', 'sk1.movement', 'sk1.advance', 'sk1.rout', 'sk1.scenario'],
  install(r) {
    r.event<{ loc: LocId; flame: FlameRecord; source: FireSource; from?: LocId }>({
      type: 'asl.fire.flame',
      apply(d, p) {
        const st = { ...((d.ext[FIRE_EXT] as Record<LocId, FireLoc> | undefined) ?? {}) };
        const cur = st[p.loc] ?? { flames: [] };
        st[p.loc] = { ...cur, flames: [...cur.flames, p.flame] };
        d.ext[FIRE_EXT] = st;
      },
    });
    r.event<{ loc: LocId; blaze: BlazeRecord; source: FireSource }>({
      type: 'asl.fire.blaze',
      apply(d, p) {
        const st = { ...((d.ext[FIRE_EXT] as Record<LocId, FireLoc> | undefined) ?? {}) };
        st[p.loc] = { blaze: p.blaze, flames: [] };
        d.ext[FIRE_EXT] = st;
      },
    });
    r.event<{ loc: LocId; id: number; reason: string }>({
      type: 'asl.fire.flameGone',
      apply(d, p) {
        const st = { ...((d.ext[FIRE_EXT] as Record<LocId, FireLoc> | undefined) ?? {}) };
        const cur = st[p.loc];
        if (!cur) return;
        const flames = cur.flames.filter((f) => f.id !== p.id);
        if (flames.length || cur.blaze) st[p.loc] = { ...cur, flames };
        else delete st[p.loc];
        d.ext[FIRE_EXT] = st;
      },
    });
    r.event<{ loc: LocId; id: number; hampered: boolean }>({
      type: 'asl.fire.hampered',
      apply(d, p) {
        const st = { ...((d.ext[FIRE_EXT] as Record<LocId, FireLoc> | undefined) ?? {}) };
        const cur = st[p.loc];
        if (!cur) return;
        st[p.loc] = { ...cur, flames: cur.flames.map((f) => (f.id === p.id ? (p.hampered ? { ...f, hampered: true } : (({ hampered: _h, ...rest }) => rest)(f)) : f)) };
        d.ext[FIRE_EXT] = st;
      },
    });
    r.event<{ locs: LocId[] }>({
      type: 'asl.fire.kindled',
      apply(d, p) {
        if (p.locs.length) d.ext['asl.fire.kindled'] = p.locs;
        else delete d.ext['asl.fire.kindled'];
      },
    });
    r.event<{ state: EscapeState | null }>({
      type: 'asl.fire.escapeState',
      apply(d, p) {
        if (p.state) d.ext[ESCAPE_EXT] = p.state;
        else delete d.ext[ESCAPE_EXT];
      },
    });
    r.event<{ loc: LocId; unit: PieceId; dr: [number, number]; target: number; passed: boolean }>({ type: 'asl.fire.ntc', apply() {} });
    r.event<{ loc: LocId; unit: PieceId; director?: PieceId; dr: [number, number]; drm: number; needed: number; flame: boolean; explain: string[] }>({ type: 'asl.fire.kindle', apply() {} });
    r.event<{ loc: LocId; source: string; dr: [number, number]; drm: number; needed: number; flame: boolean; explain: string[] }>({ type: 'asl.fire.attackFlame', apply() {} });
    r.event<{ loc: LocId; id: number; dr: [number, number]; drm: number; needed: number; outcome: string; explain: string[] }>({ type: 'asl.fire.blazeCheck', apply() {} });
    r.event<{ from: LocId; to: LocId; dr?: [number, number]; drm?: number; needed?: number; auto?: string; far?: boolean; flame: boolean; explain?: string[] }>({ type: 'asl.fire.spread', apply() {} });
    r.event<{ candidates: LocId[]; chosen: LocId[] }>({ type: 'asl.fire.gustSelect', apply() {} });
    r.event<{ units: PieceId[]; loc: LocId }>({ type: 'asl.fire.eliminated', apply() {} });
    r.event<{ unit: PieceId; choice: 'break' | 'stay' | 'move'; to?: LocId; interdicted?: PieceId[] }>({ type: 'asl.fire.escape', apply() {} });
    r.event<{ loc: LocId; id: number; units: PieceId[]; director?: PieceId; dr: [number, number]; drm: number; outcome: 'extinguished' | 'hampered' | 'failed'; explain: string[]; labor?: number }>({ type: 'asl.fire.extinguish', apply() {} });
    r.procedure<TryFlameFn>(FIRE_PROC.tryFlame, () => (ctx, loc, opts) => tryFlameBase(ctx, loc, opts));

    // ---------------------------------------------------------------- B25.12, B25.13: a Flame from a FT, HE or DC attack
    r.procedure<AttackResolvedFn>(FP.attackResolved, (next) => (ctx, info: AttackResolvedInfo) => {
      next?.(ctx, info);
      if (info.malfunctioned || info.rubbled || info.collateral || !burnable(ctx, info.target)) return;
      if (info.by === 'ft' && (info.originalResult === 'K' || info.originalResult === 'KIA')) ctx.proc<TryFlameFn>(FIRE_PROC.tryFlame)(ctx, info.target, { source: 'ft', ecInRubble: true });
      else if ((info.by === 'he' || info.by === 'dc') && info.originalResult === 'KIA') ctx.proc<TryFlameFn>(FIRE_PROC.tryFlame)(ctx, info.target, { source: info.by });
    });

    // ---------------------------------------------------------------- B25.11: Kindling
    r.action<KindleAction>({
      type: 'fire.kindle',
      decisionKinds: [PHASE_DECISION],
      legal(env) {
        if (env.state.phase !== 'PFPh') return [];
        const side = env.state.attacker;
        const out: KindleAction[] = [];
        const locs = new Set<LocId>();
        for (const p of Object.values(env.state.pieces)) if (p.side === side && p.loc.kind === 'hex' && isInfantry(env, p)) locs.add(locOf(env.state, p)!);
        for (const loc of [...locs].sort()) {
          if (!burnable(env, loc) || blazeAt(env, loc) || kindledThisPhase(env, loc)) continue;
          const { leaders, smcs, mmcs } = kindlers(env, loc, side);
          const lead = leaders[0];
          if (lead && mmcs.length) {
            const a: KindleAction = { type: 'fire.kindle', loc, attempts: mmcs.map((m) => ({ unit: m.id, director: lead.id })) } as KindleAction;
            if (!kindleIllegal(env, { ...a, side })) out.push(a);
          }
          for (const s of smcs) {
            const a: KindleAction = { type: 'fire.kindle', loc, attempts: [{ unit: s.id }] } as KindleAction;
            if (!kindleIllegal(env, { ...a, side })) out.push(a);
          }
        }
        return out;
      },
      validate: (env, a) => kindleIllegal(env, a),
      resolve(ctx, a) {
        const side = ctx.state.attacker;
        const n = fireNumbers(ctx, a.loc)!;
        // Every unit of the attempt is marked Prep Fire whatever happens (B25.11); the Location's attempts are spent.
        const involved = [...new Set(a.attempts.flatMap((at) => [at.unit, ...(at.director ? [at.director] : [])]))].sort();
        for (const id of involved) setTags(ctx, id, { [T.fire]: 'prep' });
        ctx.emit('asl.fire.kindled', { locs: [...((ctx.state.ext['asl.fire.kindled'] as LocId[] | undefined) ?? []), a.loc] });
        // The NTC of each director and lone SMC, once each (B25.11 "provided the SMC passes a NTC").
        const checkers = [...new Set(a.attempts.map((at) => at.director ?? at.unit))].sort();
        const passed = new Set<PieceId>();
        for (const id of checkers) {
          const p = pieceOf(ctx, id);
          if (!smc(ctx, p)) continue;
          const target = ctx.query('unit.morale', { unit: id }, defOf(ctx, p).kind === 'leader' ? (smc(ctx, p)?.morale ?? 0) : 0);
          const roll = ctx.roll(`Kindling NTC for ${id}`);
          const ok = roll.total <= target;
          ctx.emit('asl.fire.ntc', { loc: a.loc, unit: id, dr: roll.dice as [number, number], target, passed: ok });
          if (ok) passed.add(id);
        }
        for (const at of a.attempts) {
          if (!passed.has(at.director ?? at.unit)) continue;
          const { drm, explain } = kindlingDrm(ctx, a.loc, at.unit, at.director);
          const roll = ctx.roll(`Kindling DR by ${at.unit}`);
          const flame = roll.total + drm >= n.kindle;
          ctx.emit('asl.fire.kindle', { loc: a.loc, unit: at.unit, ...(at.director ? { director: at.director } : {}), dr: roll.dice as [number, number], drm, needed: n.kindle, flame, explain });
          if (flame) placeFlame(ctx, a.loc, { kindledBy: side, source: 'kindle' });
        }
        ctx.popDecision();
        askPhaseOwner(ctx, side);
      },
    });
    // A4.44: a SW/Gun left unpossessed in a Blaze Location later (its possessor eliminated or gone, a weapon dropped) is
    // removed as well.
    for (const event of ['piece.moved', 'piece.eliminated']) {
      r.on({
        id: `asl.fire.burnUnpossessed.${event}`,
        event,
        handler(ctx) {
          for (const loc of blazeLocations(ctx)) if (unpossessedWeaponsAt(ctx, loc).length) burnUnpossessed(ctx, loc);
        },
      });
    }
    r.on<{ phase: string }>({
      id: 'asl.fire.kindledReset',
      event: 'turn.phaseEnded',
      handler(ctx, ev) {
        if (ev.payload.phase === 'PFPh' && ctx.state.ext['asl.fire.kindled'] !== undefined) ctx.emit('asl.fire.kindled', { locs: [] });
      },
    });

    // ---------------------------------------------------------------- B25.151, B25.6: the AFPh step
    r.on<{ phase: string }>({
      id: 'asl.fire.afph',
      event: 'turn.phaseEnded',
      handler(ctx, ev) {
        if (ev.payload.phase === 'AFPh' && Object.keys(fireState(ctx)).length) fireAfph(ctx);
        // A Hampered Flame rolls again next Player Turn (B24.721); Labor counters for a Task that is over come off (B24.8).
        if (ev.payload.phase === 'CCPh') {
          for (const [loc, f] of Object.entries(fireState(ctx)).sort()) for (const fl of f.flames) if (fl.hampered) ctx.emit('asl.fire.hampered', { loc, id: fl.id, hampered: false });
          for (const p of Object.values(ctx.state.pieces).sort(byId)) {
            const labor = parseLabor(p.tags['labor']);
            if (!labor) continue;
            const loc = labor.task.replace(/^flame:/, '');
            if (p.loc.kind !== 'hex' || locOf(ctx.state, p) !== loc || flamesAt(ctx, loc).length === 0) setTags(ctx, p.id, { labor: null });
          }
        }
      },
    });

    // ---------------------------------------------------------------- A24.61: Smoke drifting from a Blaze in a Mild Breeze
    r.event<{ source: LocId; hexes: HexId[] }>({ type: 'asl.fire.drift', apply() {} });
    r.on<{ phase: string }>({
      id: 'asl.fire.drift.place',
      event: 'turn.phaseStarted',
      handler(ctx, ev) {
        const first = ev.payload.phase === 'RPh' && ctx.state.turn === 1 && ctx.state.attacker === statics(ctx).scenario.firstSide;
        if (ev.payload.phase === 'AFPh' || first) placeDrift(ctx);
      },
    });
    for (const event of ['asl.wind.set', 'asl.fire.blaze', 'asl.rubble']) r.on({ id: `asl.fire.drift.stale.${event}`, event, handler: (ctx) => clearStaleDrift(ctx) });

    // ---------------------------------------------------------------- B25.2, A24.4: the Blaze's smoke, and Smoke heights
    // A24.7: one more MF to enter a SMOKE Location, a level within a Blaze's smoke included (B25.2). An upper building level is
    // entered at the ground's cost (B23.421), never doubled, so the +1 is simply added.
    r.contribute({
      id: 'asl.move.blaze-smoke',
      query: 'move.stepCost',
      layer: 450,
      ref: 'ASLRB A24.7, B25.2',
      label: '+1 MF entering a Blaze\'s smoke',
      when: ({ ms, to, bypass }, env) => !bypass && !ms.vehicle && to !== (ms.hex ? locId(ms.hex, ms.level ?? 0) : null) && inBlazeSmoke(env, to),
      apply: (v) => v + 1,
    });
    // ... and for a routing unit taking the stairs into one (A10.5 rout is movement; the interim rule lets it climb a level).
    r.contribute({
      id: 'asl.rout.blaze-smoke',
      query: 'rout.stairsMf',
      ref: 'ASLRB A24.7, B25.2',
      when: ({ to }, env) => inBlazeSmoke(env, to),
      apply: (v) => v + 1,
    });
    r.contribute({
      id: 'asl.smoke.heights',
      query: 'smoke.reaches',
      ref: 'ASLRB A24.4',
      apply(_v, { hex, from, to }, env) {
        const m = env.state.hexMarkers[hex];
        const counters = smoke58Counters(m);
        const wp = counters.some((c) => c.kind === 'wp');
        // Drifting SMOKE is never a Hindrance below the Location of its source (A24.61): a hex holding only drift from
        // upper-level Blazes starts at the lowest of them.
        const drift = counters.map((c) => driftOf(c.side));
        const base = counters.length && smokeGrenades(m) === 0 && drift.every((d) => d) ? Math.min(...drift.map((d) => levelOfLoc(d!.source))) : 0;
        return smokeReaches(env, hex, from, to, base, wp ? 4 : 2);
      },
    });
    r.contribute({
      id: 'asl.los.blaze',
      query: 'los.trace',
      layer: 200,
      ref: 'ASLRB B25.2, A24.2, A24.4, A24.8',
      apply(v, c, env): LosTrace {
        if (!v.clear || c.noSmoke) return v;
        // Each Blaze hex by the wind in effect there (none in Heavy Winds; No Wind in an Interior Building hex, B25.63).
        const ablaze = new Map<HexId, number>();
        for (const loc of blazeLocations(env)) {
          const h = hexOfLoc(loc);
          if (blazeSmokeLevels(env, h) === 0) continue;
          ablaze.set(h, Math.min(ablaze.get(h) ?? Infinity, levelOfLoc(loc)));
        }
        if (ablaze.size === 0) return v;
        const parts = [...v.parts];
        const already = (h: HexId) => parts.filter((p) => p.hex === h && !p.terrain && /Smoke|Blaze/.test(p.label)).reduce((a, p) => a + p.drm, 0);
        const [from, to] = [hexOfLoc(c.from), hexOfLoc(c.to)];
        const map = statics(env).map;
        const push = (h: HexId, out: boolean) => {
          const cap = out ? 4 : 3;
          const add = Math.max(0, cap - already(h));
          if (add > 0) parts.push({ label: out ? `+${add} firing out of a Blaze` : `+${add} Blaze (smoke)`, hex: h, drm: add });
        };
        if (ablaze.has(from) && smokeReaches(env, from, c.from, c.to, ablaze.get(from)!, blazeSmokeLevels(env, from))) push(from, true);
        const steps = map.lineSteps ? map.lineSteps(from, to) : map.los(from, to).crossed.filter((x) => x.hex !== from && x.hex !== to).map((x) => [x.hex]);
        for (const step of c.noTargetSmoke ? steps : [...steps, [to]]) {
          const h = step.find((x) => ablaze.has(x) && smokeReaches(env, x, c.from, c.to, ablaze.get(x)!, blazeSmokeLevels(env, x)));
          if (h) push(h, false);
        }
        return parts.length === v.parts.length ? v : { ...v, parts, hindrance: parts.reduce((a, p) => a + p.drm, 0) };
      },
    });

    // ---------------------------------------------------------------- B25.4, A4.3: no entry into a Blaze
    const barred = (loc: LocId) => `${loc} is ablaze: a Blaze Location cannot be entered (ASLRB B25.4)`;
    r.contribute({
      id: 'asl.fire.noEntry',
      query: 'move.stepIllegal',
      ref: 'ASLRB B25.4',
      when: ({ to }, env) => !!blazeAt(env, to),
      apply: (v, { to }) => v ?? barred(to),
    });
    r.contribute({
      id: 'asl.fire.noAdvance',
      query: 'advance.illegal',
      ref: 'ASLRB B25.4',
      when: ({ to }, env) => !!blazeAt(env, to),
      apply: (v, { to }) => v ?? barred(to),
    });
    r.contribute({
      id: 'asl.fire.noSetupHex',
      query: 'setup.hexIllegal',
      ref: 'ASLRB B25.4',
      when: ({ hex }, env) => !!blazeAt(env, hex),
      apply: (v, { hex }) => v ?? barred(hex),
    });
    r.contribute({
      id: 'asl.fire.noSetup',
      query: 'setup.illegal',
      ref: 'ASLRB B25.4',
      apply(v, { action }, env) {
        if (v) return v;
        for (const [id, loc] of Object.entries((action as { placements: Record<string, string> }).placements).sort()) if (blazeAt(env, loc)) return `${id}: ${barred(loc)}`;
        return null;
      },
    });
    r.contribute({
      id: 'asl.fire.noRout',
      query: 'rout.stepIllegal',
      ref: 'ASLRB B25.4',
      when: ({ to }, env) => !!blazeAt(env, to),
      apply: (v, { to }) => v ?? barred(to),
    });

    // ---------------------------------------------------------------- B25.4: leaving a Blaze in the RtPh, or dying in it
    r.procedure<RoutStartSideFn>(ROUT_START_SIDE, (next) => (ctx, side) => {
      // A broken unit in a Blaze must leave (B25.4): under DM it may rout out whatever the SK rout rule asks.
      for (const p of Object.values(ctx.state.pieces).sort(byId)) {
        if (p.side === side && p.loc.kind === 'hex' && isBroken(p) && !hasDm(p) && isInfantry(ctx, p) && blazeAt(ctx, locOf(ctx.state, p)!)) setTags(ctx, p.id, { [T.dm]: true });
      }
      if (askEscape(ctx, side)) {
        if (!escapeState(ctx) || escapeState(ctx)!.side !== side) ctx.emit('asl.fire.escapeState', { state: { side, answered: [] } });
        return;
      }
      next?.(ctx, side);
    });
    const afterEscape = (ctx: Ctx, side: SideId) => {
      if (askEscape(ctx, side)) return;
      ctx.proc<RoutStartSideFn>(ROUT_START_SIDE)(ctx, side);
      if (ctx.state.decisions.length === 0) {
        const decision: Decision = { id: 'auto', kind: PHASE_DECISION, owner: side, deadlineClass: 'turn' };
        ctx.proc<PhaseDoneFn>(PHASE_DONE)(ctx, decision);
      }
    };
    const answered = (ctx: Ctx, unit: PieceId) => {
      const st = escapeState(ctx) ?? { side: ctx.state.pieces[unit]!.side, answered: [] };
      ctx.emit('asl.fire.escapeState', { state: { ...st, answered: [...st.answered, unit] } });
    };
    const escapeUnit = (_env: QueryEnv, d: Decision | undefined, unit: PieceId): string | null => {
      const units = (d?.data?.['units'] as PieceId[] | undefined) ?? [];
      if (!units.includes(unit)) return `${unit} is not in a Blaze awaiting a choice`;
      return null;
    };
    r.action<Action & { type: 'blaze.break'; unit: PieceId }>({
      type: 'blaze.break',
      decisionKinds: [BLAZE_ESCAPE_DECISION],
      legal: (env, d) => ((d.data?.['units'] as PieceId[] | undefined) ?? []).filter((u) => !cannotBreak(env, pieceOf(env, u))).map((unit) => ({ type: 'blaze.break', unit })),
      validate: (env, a, d) => escapeUnit(env, d, a.unit) ?? (cannotBreak(env, pieceOf(env, a.unit)) ? `${a.unit} cannot break voluntarily (ASLRB A10.41): it may move out instead` : null),
      resolve(ctx, a, d) {
        ctx.emit('asl.fire.escape', { unit: a.unit, choice: 'break' });
        ctx.proc<UnitFn>(MP.breakUnit)(ctx, a.unit, 'broke voluntarily to rout out of the Blaze (ASLRB B25.4)');
        answered(ctx, a.unit);
        ctx.popDecision(d.id);
        afterEscape(ctx, d.owner);
      },
    });
    r.action<Action & { type: 'blaze.stay'; unit: PieceId }>({
      type: 'blaze.stay',
      decisionKinds: [BLAZE_ESCAPE_DECISION],
      legal: (_env, d) => ((d.data?.['units'] as PieceId[] | undefined) ?? []).map((unit) => ({ type: 'blaze.stay', unit })),
      validate: (env, a, d) => escapeUnit(env, d, a.unit),
      resolve(ctx, a, d) {
        ctx.emit('asl.fire.escape', { unit: a.unit, choice: 'stay' });
        answered(ctx, a.unit);
        ctx.popDecision(d.id);
        afterEscape(ctx, d.owner);
      },
    });
    r.action<Action & { type: 'blaze.moveOut'; unit: PieceId; to: LocId }>({
      type: 'blaze.moveOut',
      decisionKinds: [BLAZE_ESCAPE_DECISION],
      legal: (env, d) =>
        ((d.data?.['units'] as PieceId[] | undefined) ?? [])
          .filter((u) => cannotBreak(env, pieceOf(env, u)))
          .flatMap((unit) => escapeDestinations(env, unit).map((to) => ({ type: 'blaze.moveOut', unit, to }))),
      validate(env, a, d) {
        const why = escapeUnit(env, d, a.unit);
        if (why) return why;
        if (!cannotBreak(env, pieceOf(env, a.unit))) return `${a.unit} can break voluntarily and rout out (ASLRB B25.4)`;
        return escapeDestinations(env, a.unit).includes(a.to) ? null : `${a.to} is not an Accessible Location out of the Blaze`;
      },
      resolve(ctx, a, d) {
        const p = pieceOf(ctx, a.unit);
        const from = hexOfLoc(locOf(ctx.state, p)!);
        const to = hexOfLoc(a.to);
        // "Such units are vulnerable to Interdiction" (B25.4, A10.53): an Open Ground hex entered in the LOS and Normal Range
        // of an enemy able to interdict.
        const by = from === to ? [] : interdicted(ctx, p.side, to, from).map((e) => e.id).sort();
        ctx.emit('asl.fire.escape', { unit: a.unit, choice: 'move', to: a.to, ...(by.length ? { interdicted: by } : {}) });
        ctx.emit('piece.moved', { id: a.unit, loc: locationAt(a.to) });
        if (by.length) {
          interdictionCheck(ctx, a.unit, 0, true);
          ctx.proc<FlushFn>(MP.flushLeaderLoss)(ctx);
        }
        answered(ctx, a.unit);
        ctx.popDecision(d.id);
        afterEscape(ctx, d.owner);
      },
    });
    r.on<{ phase: string }>({
      id: 'asl.fire.rtphEnd',
      event: 'turn.phaseEnded',
      handler(ctx, ev) {
        if (ev.payload.phase !== 'RtPh') return;
        if (escapeState(ctx)) ctx.emit('asl.fire.escapeState', { state: null });
        // Infantry still in a Blaze at the end of the RtPh are eliminated (B25.4).
        const byLoc = new Map<LocId, PieceId[]>();
        for (const p of Object.values(ctx.state.pieces).sort(byId)) {
          if (p.loc.kind !== 'hex' || !isInfantry(ctx, p)) continue;
          const loc = locOf(ctx.state, p)!;
          if (blazeAt(ctx, loc)) byLoc.set(loc, [...(byLoc.get(loc) ?? []), p.id]);
        }
        for (const [loc, units] of [...byLoc.entries()].sort()) {
          ctx.emit('asl.fire.eliminated', { units, loc });
          for (const u of units) if (ctx.state.pieces[u]?.loc.kind === 'hex') eliminate(ctx, u, 'caught in the Blaze (ASLRB B25.4)');
        }
        if (byLoc.size) ctx.proc<FlushFn>(MP.flushLeaderLoss)(ctx);
      },
    });

    // ---------------------------------------------------------------- B25.7, B24.72: Flame clearance
    r.action<Action & { type: 'fire.extinguish'; loc: LocId; flame: number; units: PieceId[]; director?: PieceId }>({
      type: 'fire.extinguish',
      decisionKinds: [PHASE_DECISION],
      legal(env) {
        const side = clearancePhaseSide(env);
        if (!side) return [];
        const out: (Action & { type: 'fire.extinguish'; loc: LocId; flame: number; units: PieceId[]; director?: PieceId })[] = [];
        for (const [loc, f] of Object.entries(fireState(env)).sort()) {
          if (!f.flames.length || f.blaze) continue;
          // Each Flame is cleared with its own DR, and every extinguishing unit may try each one (B24.72).
          for (const flame of f.flames) {
            const units = clearers(env, loc, side, flame.id);
            if (!units.some((p) => mmc(env, p))) continue;
            const director = units.find((p) => defOf(env, p).kind === 'leader');
            const ids = units.map((p) => p.id);
            const a = { type: 'fire.extinguish' as const, loc, flame: flame.id, units: director ? ids.filter((u) => u !== director.id) : ids, ...(director ? { director: director.id } : {}) };
            if (!extinguishIllegal(env, { ...a, side })) out.push(a as Action & typeof a);
          }
        }
        return out;
      },
      validate: (env, a) => extinguishIllegal(env, a),
      resolve(ctx, a) {
        const side = clearancePhaseSide(ctx)!;
        const all = [...a.units, ...(a.director ? [a.director] : [])].sort();
        const { drm, explain, labor } = clearanceDrm(ctx, a.loc, a.units, a.director);
        const roll = ctx.roll(`Flame Clearance DR in ${a.loc}`);
        const final = roll.total + drm;
        const outcome = final <= 2 ? 'extinguished' : final <= 6 ? 'hampered' : 'failed';
        // TI for the Player Turn (B24.72, B24.7). Flame clearance is Hazardous Movement (A4.62) only while the units are
        // engaged in it, and that ends with this DR (B24.7): it spends no MF, so the DEFENDER has no First Fire at it in the
        // MPh, nor any fire at it in the DFPh (Q&A [K33] to B24.7 & E1.21: "Correct. No. No. No.").
        for (const id of all) {
          const done = flamesFought(pieceOf(ctx, id), a.loc);
          setTags(ctx, id, { ti: true, flameClear: `${a.loc}|${[...done, a.flame].join(',')}` });
        }
        let nextLabor: number | undefined;
        if (outcome === 'failed') {
          nextLabor = Math.max(-2, labor - 1);
          for (const id of all) if (mmc(ctx, pieceOf(ctx, id))) setTags(ctx, id, { labor: laborTag(`flame:${a.loc}`, nextLabor) });
        }
        ctx.emit('asl.fire.extinguish', { loc: a.loc, id: a.flame, units: a.units, ...(a.director ? { director: a.director } : {}), dr: roll.dice as [number, number], drm, outcome, explain, ...(nextLabor !== undefined ? { labor: nextLabor } : {}) });
        if (outcome === 'extinguished') {
          ctx.emit('asl.fire.flameGone', { loc: a.loc, id: a.flame, reason: 'extinguished' });
          updateControl(ctx);
        } else if (outcome === 'hampered') ctx.emit('asl.fire.hampered', { loc: a.loc, id: a.flame, hampered: true });
        ctx.popDecision();
        askPhaseOwner(ctx, side);
      },
    });
    // ---------------------------------------------------------------- A26.16: Control forfeited by Fire
    r.contribute({
      id: 'asl.fire.control',
      query: 'control.adjust',
      ref: 'ASLRB A26.16, A26.161, A26.162',
      when: (_c, env) => Object.keys(fireState(env)).length > 0,
      apply: (v, _c, env) => forfeitControl(env, v),
    });
  },
};

/** Whose Flame clearance it could be now: the ATTACKER's in the MPh with no stack moving, the DEFENDER's in the DFPh. */
function clearancePhaseSide(env: QueryEnv): SideId | null {
  if (env.state.phase === 'MPh') return moveState(env) ? null : env.state.attacker;
  if (env.state.phase === 'DFPh') return otherSide(env.state, env.state.attacker);
  return null;
}

/** The Flames of `loc` a unit has fought this Player Turn (its `flameClear` tag), none elsewhere. */
function flamesFought(p: Piece, loc: LocId): number[] {
  const tag = p.tags['flameClear'];
  if (typeof tag !== 'string') return [];
  const [at, ids] = tag.split('|');
  return at === loc && ids ? ids.split(',').map(Number) : [];
}

/**
 * Units of `side` in `loc` that may fight a Flame there now (B24.72): unpinned Good Order Infantry, not moved, fired or
 * TI. "If more than one Flame counter exists in a Location, each must be cleared separately with its own separate DR,
 * although all extinguishing units may attempt to put out each Flame": a unit made TI by fighting a Flame there may
 * still fight each other Flame of that Location once. `flame`: for that Flame; absent, for any Flame there.
 */
export function clearers(env: QueryEnv, loc: LocId, side: SideId, flame?: number): Piece[] {
  const ids = flame !== undefined ? [flame] : (fireAt(env, loc)?.flames.map((f) => f.id) ?? []);
  return personnelAt(env, loc, side).filter((p) => (ids.length ? ids.some((id) => clearerIllegal(env, p, loc, id) === null) : clearerIllegal(env, p) === null));
}
function clearerIllegal(env: QueryEnv, p: Piece, loc?: LocId, flame?: number): string | null {
  if (!isInfantry(env, p)) return `${p.id} is not Infantry`;
  if (!isGoodOrder(env, p) || isPinned(p)) return `${p.id} must be unpinned and in Good Order (ASLRB B24.7)`;
  if (p.tags[T.moved]) return `${p.id} has moved this Player Turn (ASLRB B24.72)`;
  if (fireMarker(p) || p.tags[T.firedSw]) return `${p.id} has fired this Player Turn (ASLRB B24.72)`;
  if (p.tags['ti']) {
    const fought = loc ? flamesFought(p, loc) : [];
    if (!fought.length) return tiIllegal(p);
    if (flame !== undefined && fought.includes(flame)) return `${p.id} has already fought that Flame this Player Turn (ASLRB B24.72)`;
  }
  if (p.tags[T2.manhandled]) return `${p.id} is manhandling a Gun`;
  return null;
}

export function extinguishIllegal(env: QueryEnv, a: { loc: LocId; flame: number; units: PieceId[]; director?: PieceId; side: SideId }): string | null {
  const side = clearancePhaseSide(env);
  if (!side) return env.state.phase === 'MPh' ? 'A Flame is fought before any stack moves, or in the Defensive Fire Phase (ASLRB B24.72)' : 'A Flame is fought in the Movement or Defensive Fire Phase (ASLRB B24.72)';
  if (a.side !== side) return 'Not your phase';
  const f = fireAt(env, a.loc);
  if (f?.blaze) return 'A Blaze cannot be extinguished (ASLRB B25.7)';
  if (!f?.flames.some((x) => x.id === a.flame)) return `No such Flame in ${a.loc}`;
  const all = [...a.units, ...(a.director ? [a.director] : [])];
  if (all.length === 0) return 'Name the units fighting the fire';
  if (new Set(all).size !== all.length) return 'A unit is listed twice';
  for (const id of all) {
    const p = env.state.pieces[id];
    if (!p || p.side !== side) return `${id} is not your unit`;
    if (locOf(env.state, p) !== a.loc) return `${id} is not in ${a.loc}`;
    const why = clearerIllegal(env, p, a.loc, a.flame);
    if (why) return why;
  }
  if (a.director && defOf(env, pieceOf(env, a.director)).kind !== 'leader') return `${a.director} is not a leader`;
  if (!a.units.some((u) => mmc(env, pieceOf(env, u)))) return 'At least one MMC must take part in a Clearance attempt (ASLRB B24.7)';
  return null;
}

/**
 * The Clearance DRM of a Task (B24.7, B24.8, A4.51): Labor for that Task, the directing leader, the MMC at work, +1 when a
 * participant is CX ("any labor task ... DR they make or direct"), and the EC DRM for a Flame only (B24.7 †). `task` is the
 * Labor key (a Flame's `flame:<loc>` by default); `ec` false for every other Task.
 */
export function clearanceDrm(env: QueryEnv, loc: LocId, units: PieceId[], director?: PieceId, opts: { task?: string; ec?: boolean } = {}): { drm: number; explain: string[]; labor: number } {
  const explain: string[] = [];
  let drm = 0;
  const task = opts.task ?? `flame:${loc}`;
  const labor = Math.min(0, ...units.map((u) => {
    const l = parseLabor(env.state.pieces[u]?.tags['labor']);
    return l?.task === task ? l.drm : 0;
  }));
  if (labor) {
    drm += labor;
    explain.push(`${labor} Labor`);
  }
  if (director) {
    const l = smc(env, pieceOf(env, director))?.leadership ?? 0;
    if (l) {
      drm += l;
      explain.push(`${l > 0 ? '+' : ''}${l} leadership`);
    }
  }
  const kinds = units.map((u) => mmc(env, pieceOf(env, u))?.kind).filter((k): k is 'squad' | 'hs' | 'crew' => !!k);
  const squads = kinds.filter((k) => k === 'squad').length;
  const small = kinds.length - squads;
  if (squads > 0) {
    drm -= 1 + 2 * (squads - 1) + small;
    explain.push(`-${1 + 2 * (squads - 1) + small} ${squads === 1 && small === 0 ? 'one squad' : `${squads} squad${squads === 1 ? '' : 's'}${small ? ` and ${small} HS/crew` : ''}`}`);
  } else if (small > 1) {
    drm -= small - 1;
    explain.push(`-${small - 1} ${small - 1} further HS/crew`);
  }
  if ([...units, ...(director ? [director] : [])].some((u) => isCx(pieceOf(env, u)))) {
    drm += 1;
    explain.push('+1 CX');
  }
  const ec = opts.ec === false ? 0 : ecDrm(env);
  if (ec) {
    drm += ec;
    explain.push(`EC ${ec > 0 ? '+' : ''}${ec}`);
  }
  return { drm, explain, labor };
}

// ---------------------------------------------------------------- A24.61, B25.2: Smoke drifting from a Blaze

/**
 * Drifting Dispersed SMOKE (A24.61; B25.2: "Both Wreck and terrain Blazes can create drifting Dispersed Smoke ... in a Mild
 * Breeze"): gray Dispersed ⅝" counters, as many as the source's Hindrance DRM (+3 for a terrain Blaze), one in each hex
 * directly downwind. Each is a ⅝" counter whose side is `drift~<source Location>~<direction>`, so the Smoke rules apply
 * to it as to any Dispersed Smoke (+2, two levels, +1 MF, +1 out of) and the PFPh never disperses it; a Gust removes it
 * as Dispersed SMOKE (A24.62).
 */
const DRIFT = 'drift~';
const driftOf = (side: string): { source: LocId; dir: number } | null => {
  if (!side.startsWith(DRIFT)) return null;
  const [, source, dir] = side.split('~');
  return source && dir !== undefined ? { source, dir: Number(dir) } : null;
};

/** Removes drifting SMOKE whose source is gone, or whose wind has changed direction or force (A24.61). */
function clearStaleDrift(ctx: Ctx) {
  for (const [hex, m] of Object.entries(ctx.state.hexMarkers).sort()) {
    const counters = smoke58Counters(m);
    const kept = counters.filter((c) => {
      const d = driftOf(c.side);
      if (!d) return true;
      const w = windAt(ctx, d.source);
      return !!blazeAt(ctx, d.source) && w.force === 'breeze' && w.dir === d.dir;
    });
    if (kept.length !== counters.length) for (const e of smoke58Markers(hex as HexId, m, kept)) ctx.emit('hex.marker', e);
  }
}

/** Places the drifting SMOKE of every Blaze that has none, in a Mild Breeze (A24.61: the first RPh and each AFPh start). */
function placeDrift(ctx: Ctx) {
  clearStaleDrift(ctx);
  const map = statics(ctx).map;
  const drifting = new Set<LocId>();
  for (const m of Object.values(ctx.state.hexMarkers)) for (const c of smoke58Counters(m)) { const d = driftOf(c.side); if (d) drifting.add(d.source); }
  for (const source of blazeLocations(ctx)) {
    const hex = hexOfLoc(source);
    const w = windAt(ctx, source);
    // None from (or into) the non-rooftop Locations of an Interior Building hex (A24.61 EXC), where there is No Wind.
    if (w.force !== 'breeze' || w.dir === undefined || drifting.has(source)) continue;
    let at: HexId | undefined = hex;
    const placed: HexId[] = [];
    for (let n = 0; n < 3; n++) {
      at = at ? downwind(ctx, at, w.dir) : undefined;
      if (!at || !map.hex(at)) break;
      if (noWindHex(ctx, at)) continue;
      const m = ctx.state.hexMarkers[at];
      for (const e of smoke58Markers(at, m, [...smoke58Counters(m), { kind: 'smoke', dispersed: true, side: `${DRIFT}${source}~${w.dir}` }])) ctx.emit('hex.marker', e);
      placed.push(at);
    }
    if (placed.length) ctx.emit('asl.fire.drift', { source, hexes: placed });
  }
}

/**
 * Whether smoke at `hex` (its base at level `fireLevel` above the hex, reaching `levels` above that) is on a LOS between
 * `from` and `to`: the thread's height at the hex, between the two ends' heights (A24.4 "does not Hinder LOS occurring
 * above that elevation"; B25.2 "above the level of the Fire").
 */
function smokeReaches(env: QueryEnv, hex: HexId, from: LocId, to: LocId, fireLevel: number, levels: number): boolean {
  const map = statics(env).map;
  const base = (map.hex(hex)?.elevation ?? 0) + fireLevel;
  const a = hexOfLoc(from);
  const b = hexOfLoc(to);
  const hf = heightOf(env, from);
  const ht = heightOf(env, to);
  const total = map.distance(a, b);
  const h = hex === a ? hf : hex === b ? ht : total === 0 ? hf : hf + ((ht - hf) * map.distance(a, hex)) / total;
  return h >= base && h <= base + levels;
}

// ---------------------------------------------------------------- A26.16: Control

/** Each chain of adjacent hexes holding Fire, with the side it counts as deliberately started by (A26.162), or null. */
function fireChains(env: QueryEnv): { hexes: Set<HexId>; by: SideId | null }[] {
  const map = statics(env).map;
  const byHex = new Map<HexId, (SideId | null)[]>();
  for (const [loc, f] of Object.entries(fireState(env))) {
    const h = hexOfLoc(loc);
    const list = byHex.get(h) ?? [];
    if (f.blaze) list.push(f.blaze.kindledBy);
    for (const fl of f.flames) list.push(fl.kindledBy);
    byHex.set(h, list);
  }
  const seen = new Set<HexId>();
  const out: { hexes: Set<HexId>; by: SideId | null }[] = [];
  for (const start of [...byHex.keys()].sort()) {
    if (seen.has(start)) continue;
    const hexes = new Set<HexId>();
    const sides = new Set<SideId>();
    const stack = [start];
    while (stack.length) {
      const h = stack.pop()!;
      if (seen.has(h)) continue;
      seen.add(h);
      hexes.add(h);
      for (const s of byHex.get(h) ?? []) if (s) sides.add(s);
      for (const n of map.neighbors(h)) if (byHex.has(n) && !seen.has(n)) stack.push(n);
    }
    out.push({ hexes, by: sides.size === 1 ? [...sides][0]! : null });
  }
  return out;
}

/** Control after the Fire rules (A26.16–A26.162): see the module comment. */
export function forfeitControl(env: QueryEnv, next: ControlState): ControlState {
  const map = statics(env).map;
  const fires = fireState(env);
  const chains = fireChains(env);
  const chainOf = (h: HexId) => chains.find((c) => c.hexes.has(h));
  const hexes = { ...next.hexes };
  const buildings = { ...next.buildings };
  const locations = { ...(next.locations ?? {}) };
  let changed = false;
  const setHex = (h: HexId, side: SideId) => {
    if (hexes[h] !== side) {
      hexes[h] = side;
      changed = true;
    }
  };
  const setBuilding = (b: string, side: SideId) => {
    if (buildings[b] !== side) {
      buildings[b] = side;
      changed = true;
    }
  };
  const setLoc = (l: LocId, side: SideId) => {
    if (locations[l] !== side) {
      locations[l] = side;
      changed = true;
    }
  };
  // (a) A deliberately Kindled Fire forfeits its Location, hex and building to the opponent while it lasts.
  for (const [loc, f] of Object.entries(fires).sort()) {
    const h = hexOfLoc(loc);
    const by = chainOf(h)?.by ?? null;
    if (!by) continue;
    const opp = otherSide(env.state, by);
    setHex(h, opp);
    const b = map.hex(h)?.buildingId;
    if (b) setBuilding(b, opp);
    if (!isGroundLoc(loc)) setLoc(loc, opp);
    void f;
  }
  // (c) An upper Location unenterable by its Blaze is Controlled by the side Controlling its hex (A26.161).
  for (const [loc, f] of Object.entries(fires).sort()) {
    if (!f.blaze || isGroundLoc(loc) || chainOf(hexOfLoc(loc))?.by) continue;
    const owner = hexes[hexOfLoc(loc)];
    if (owner) setLoc(loc, owner);
  }
  // (d), (e) Areas no armed ground unit can enter: the Blaze hexes and whatever they cut off from the rest of the board.
  const blazeHexes = new Set(Object.entries(fires).filter(([loc, f]) => f.blaze && isGroundLoc(loc)).map(([loc]) => hexOfLoc(loc)));
  if (blazeHexes.size) {
    const all = [...map.hexes()].map((h) => h.id);
    const reachable = new Set<HexId>();
    const edge = all.filter((h) => map.neighbors(h).length < 6 && !blazeHexes.has(h));
    const stack = [...edge];
    while (stack.length) {
      const h = stack.pop()!;
      if (reachable.has(h)) continue;
      reachable.add(h);
      for (const n of map.neighbors(h)) if (!blazeHexes.has(n) && !reachable.has(n)) stack.push(n);
    }
    const unenterable = new Set(all.filter((h) => !reachable.has(h)));
    const seen = new Set<HexId>();
    for (const start of [...unenterable].sort()) {
      if (seen.has(start)) continue;
      const area = new Set<HexId>();
      const todo = [start];
      while (todo.length) {
        const h = todo.pop()!;
        if (seen.has(h)) continue;
        seen.add(h);
        area.add(h);
        for (const n of map.neighbors(h)) if (unenterable.has(n) && !seen.has(n)) todo.push(n);
      }
      const kindlers = new Set<SideId>();
      for (const h of area) {
        const c = blazeHexes.has(h) ? chainOf(h) : undefined;
        if (c?.by) kindlers.add(c.by);
      }
      let gains: SideId | undefined;
      if (kindlers.size === 1) gains = otherSide(env.state, [...kindlers][0]!);
      else {
        // Accidental: the side Controlling a majority of the hexes adjacent to the area (A26.161).
        const ring = new Set<HexId>();
        for (const h of area) for (const n of map.neighbors(h)) if (!area.has(n)) ring.add(n);
        const tally = new Map<SideId, number>();
        for (const h of ring) {
          const s = hexes[h];
          if (s) tally.set(s, (tally.get(s) ?? 0) + 1);
        }
        for (const [s, n] of tally) if (n > ring.size / 2) gains = s;
      }
      if (!gains) continue;
      for (const h of [...area].sort()) {
        setHex(h, gains);
        for (const l of locationsOf(env, h)) if (!isGroundLoc(l)) setLoc(l, gains);
      }
      // A building wholly within the area (A26.16), or unenterable by a Blaze and held hex by hex (A26.161).
      const buildingIds = new Set([...area].map((h) => map.hex(h)?.buildingId).filter((b): b is string => !!b));
      for (const b of [...buildingIds].sort()) {
        const bh = all.filter((h) => map.hex(h)?.buildingId === b);
        if (bh.every((h) => area.has(h))) setBuilding(b, gains);
        else if (bh.every((h) => hexes[h] === hexes[bh[0]!]) && hexes[bh[0]!]) setBuilding(b, hexes[bh[0]!]!);
      }
    }
  }
  if (!changed) return next;
  const out: ControlState = { ...next, hexes, buildings };
  if (Object.keys(locations).length) out.locations = locations;
  return out;
}

/** The Fire records a side may know of: all of them (every roll is public). Exposed for the board and the peek card. */
export function fireView(env: QueryEnv): { loc: LocId; blaze?: BlazeRecord; flames: FlameRecord[] }[] {
  return Object.entries(fireState(env))
    .map(([loc, f]) => ({ loc, ...(f.blaze ? { blaze: f.blaze } : {}), flames: f.flames }))
    .sort((a, b) => (a.loc < b.loc ? -1 : 1));
}

/** Infantry in a hex, for the escape decision's description. */
export const infantryInHex = (env: QueryEnv, hex: HexId, side?: SideId) => personnelInHex(env, hex, side).filter((p) => isInfantry(env, p));
