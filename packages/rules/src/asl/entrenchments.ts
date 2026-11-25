import type { Action, Ctx, HexId, Piece, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { byId, defOf, isVehicleDef, otherSide, personnelAt, statics, swHeldBy, unpossessedWeaponsAt } from '../common/pieces';
import { adjacentLocs, hexOfLoc, isGroundLoc, locOf, locationAt, type LocId } from '../common/location';
import { PHASE_DECISION } from '../common/turn';
import { AP, type AdvanceAction, type AdvanceEnterFn } from '../sk1/advance';
import { ffmoApplies, type FireAttackCtx } from '../sk1/fire';
import { MOVE_ENTER, afterMfExpenditure, inPlaceIllegal, moveInternals, remaining, spendInPlace, type MoveEnterFn, type MoveState } from '../sk1/movement';
import { expenditureKey, moveLoc, moveState } from '../sk1/moveState';
import { ROUT_ENTERED, type RoutEnteredFn } from '../sk1/rout';
import { T, fireMarker, gun, gunHeldBy, isBroken, isGoodOrder, isPinned, mmc, pieceOf, setTags, smc, squadEquivalents } from '../sk1/status';
import { smokeIn, terrainOf } from '../sk1/terrain';
import { heightAdvantage, heightOf, levelOf } from '../sk2/elevation';
import { OP, toHitNumber, type ResolveHitFn, type ShotCtx } from '../sk2/ordnance';
import { vehicle } from '../sk3/status';
import { counterTerrainIllegal, entrenchmentAt, fortCounters, fortHiddenAt, removeFortification, revealFortification, shownCounter, type FortRecord } from './fortifications';
import { isTi, laborTag, parseLabor, tiIllegal } from './labor';
import { onWire, ownHiddenWire, wireKnownTo } from './wire';
import { bunkerMove } from './pillboxes';

/*
 * Foxholes and trenches in play, and Entrenching (ASLRB B27; full ASL only).
 *
 * A unit beneath a foxhole, trench or A-T Ditch counter has `loc.pos.ent` (B27.1: "placed beneath a foxhole counter";
 * set up so with the counters, or put there here). It is in the same Location as the units on top for every purpose but TEM
 * and weapon Recovery (B27.13; A2.8: "not considered different Locations"), so stacking, targets, CC, Melee and
 * leadership are untouched and only the rules below read the position:
 * - TEM (B27.3): +2 against any attack but CC and a FT, in place of the hex's positive TEM, together with an Air Burst's
 *   -1 (B13.3), reduced by a firer's elevation advantage (B9.33), never with Height Advantage (B10.31). The +4 against an
 *   OVR or OBA attack waits for vehicle Overrun (D7) and Chapter C1 OBA, neither of which exists here. A vehicle beneath a
 *   trench is HD to Direct Fire ordnance instead of taking the +2 (B27.52, `asl/hullDown.ts`).
 * - Moving in and out (B27.4): one MF paid separately in the hex, after the hex's own cost and any Defensive First Fire
 *   it drew (A8.12 makes the MF a First Fire target of its own); two MF for an A-T Ditch (B27.56); nothing while the
 *   counter is a hidden one of the unit's own side (A12.33). Under Assault Movement, and in the RtPh, the MF may be
 *   combined with the entrance cost of the next hex (B27.4), the stack arriving beneath: Residual FP and a Snap Shot
 *   still attack it on the way in, and a unit they pin or break stays on top. FFMO applies only while the unit is on
 *   top (B27.42); a unit beneath takes FFNAM alone. Leaving the entrenchment makes a unit "more vulnerable", so
 *   Residual FP attacks it again (A8.2); entering does not.
 * - Capacity per side (B27.12, B27.44, A5.6): a 1S/2S/3S foxhole holds that many squad-equivalents of one side plus four
 *   SMC; a trench three squads and four SMC (B27.51); the units of the other side count separately. A stack pushing a
 *   Gun never goes beneath a foxhole (B27.1: only a mortar may be there, and it may not enter or leave in play), and
 *   a Gun beneath a trench stays there (B27.51).
 * - Connected trenches (B27.54): adjacent trench counters connect; Infantry beneath one moves beneath the next for one
 *   MF (two uphill, plus SMOKE), with no FFNAM, FFMO, Snap Shot or Interdiction. The trench TEM holds beside an enemy in
 *   a connecting trench (B27.53): nothing to do, the TEM goes by the unit's own position.
 * - Rout (B27.41, A10.5, A10.531): a routing unit may pay the extra MF to go beneath the foxhole of the hex it enters,
 *   which "nullifies any Interdiction in that hex"; the MF to leave one is combined with the next hex's cost, so
 *   Interdiction is judged there; a unit beneath an entrenchment is not in Open Ground for Failure to Rout. Beneath a
 *   trench a unit rallies at -1 (A10.61) and may not keep its DM (A10.62).
 * - Advance (A4.7, B27.44): an advance may end beneath the entrenchment of the hex entered, even an enemy-held one, or
 *   change position within the unit's own hex as its one Location change.
 * - Entrenching (B27.11): in the ATTACKER's PFPh any unbroken Infantry MMC that has attempted nothing yet (no fire, no
 *   Kindling, not TI), not in an entrenchment nor on Wire, in a hex that may take a foxhole (B27.1, B23.5) and holds no
 *   trench or pillbox, may try to dig: a Final DR of 5 or less places a 1S foxhole of its side (open: A12.33 hides
 *   only counters set up before play) or grows the hex's foxhole by one size up to 3S (B27.12), and puts the digger and
 *   its directing leader beneath it. A lone HS or crew adds +1; an unused leader in the Location may direct every
 *   attempt there with his leadership, taking part (TI, beneath the foxhole) as he does; Labor Status counts (B24.8);
 *   Russian units take -1 (A25.21). Every participant is TI whatever the outcome (A4.8). The EC Chart (B25.5) has no
 *   entry for Entrenching; the +1 in Mud (E3.63), the +2 under Ground Snow (E3.722) and the ban in Extreme Winter
 *   (E3.743) wait for a weather model, as does the Sniper a matching Original DR wakes (A14.2).
 * - Falling rubble removes the entrenchment of the hex it lands in (B24.121); its units stand in the rubble.
 */

declare module '@asl/engine' {
  interface QueryCatalog {
    /** The DRM of one Entrenching DR beyond the rulebook's own (B27.11, B24.8, A25.21): weather (Chapter E) adds here. */
    'entrench.drm': { ctx: { loc: LocId; unit: PieceId; director?: PieceId }; value: number };
  }
}

export const ENTRENCH_EXT = 'asl.entrenchments';
interface EntrenchState {
  /** The expenditure a Snap Shot just hit while the stack was arriving beneath an entrenchment (B27.4: a unit it pins or breaks stays on top). */
  snapEntry?: string;
}

export type EntrenchAttempt = { unit: PieceId; director?: PieceId };
export type EntrenchAction = Action & { type: 'entrench.attempt'; loc: LocId; attempts: EntrenchAttempt[] };
export type EntrenchmentMoveAction = Action & { type: 'move.entrenchment'; beneath: boolean };

export const ENTRENCH_KINDS = ['foxhole', 'trench', 'ditch'] as const;
export type EntKind = (typeof ENTRENCH_KINDS)[number];

/** Beneath the foxhole, trench or A-T Ditch of its hex. */
export const isEntrenched = (p: Piece): boolean => p.loc.kind === 'hex' && !!p.loc.pos?.ent;
/** A vehicle beneath a trench or A-T Ditch (B27.51, B27.52: only at setup, and it never leaves). */
export const isEntrenchedVehicle = (env: QueryEnv, p: Piece | undefined): boolean => !!p && isEntrenched(p) && p.loc.kind === 'hex' && p.loc.pos?.ent !== 'foxhole' && isVehicleDef(defOf(env, p));

/** The side's vehicles beneath the trench of `hex` (B27.52). */
export const entrenchedVehiclesAt = (env: QueryEnv, hex: HexId, side?: SideId): Piece[] =>
  Object.values(env.state.pieces).filter((p) => (!side || p.side === side) && p.loc.kind === 'hex' && p.loc.hex === hex && isEntrenchedVehicle(env, p)).sort(byId);

/** The side's Infantry beneath the entrenchment of `hex`. */
export const entrenchedAt = (env: QueryEnv, hex: HexId, side?: SideId): Piece[] => personnelAt(env, hex, side).filter(isEntrenched);

const entName = (c: Pick<FortRecord, 'kind' | 'capacity'>) => (c.kind === 'foxhole' ? `foxhole ${c.capacity ?? 1}S` : c.kind === 'ditch' ? 'A-T Ditch' : 'trench');
export const entrenchmentName = entName;

/** The entrenchment of a hex as `side` knows it: its own, or one the other side has shown (A12.33). */
export function entrenchmentKnownTo(env: QueryEnv, hex: HexId, side: SideId | null): FortRecord | null {
  const c = entrenchmentAt(env, hex);
  return c && shownCounter(c, side) ? c : null;
}

/** Room left beneath the entrenchment of `hex` for `side` (B27.12, B27.44: capacity per side; four SMC besides). */
export function entrenchmentRoom(env: QueryEnv, hex: HexId, side: SideId): { counter: FortRecord; se: number; smc: number } | null {
  const c = entrenchmentAt(env, hex);
  if (!c) return null;
  const beneath = entrenchedAt(env, hex, side);
  const cap = c.capacity ?? 3;
  return { counter: c, se: cap - squadEquivalents(env, beneath), smc: 4 - beneath.filter((p) => smc(env, p)).length };
}

/** Why `units` of `side` may not go beneath the entrenchment of `hex`, or null (B27.1, B27.12, B27.44, B27.51). */
export function beneathIllegal(env: QueryEnv, hex: HexId, side: SideId, units: Piece[], manhandle = false): string | null {
  const room = entrenchmentRoom(env, hex, side);
  if (!room) return `No foxhole or trench in ${hex}`;
  const c = room.counter;
  if (!shownCounter(c, side)) return `No foxhole or trench in ${hex}`;
  if (units.some((p) => isVehicleDef(defOf(env, p)))) return `A vehicle cannot go beneath a ${entName(c)}`;
  if (manhandle || units.some((p) => gunHeldBy(env, p.id))) return c.kind === 'foxhole' ? 'A Gun cannot go beneath a foxhole: only a mortar may be there, and not enter it in play (ASLRB B27.1)' : 'A Gun is not pushed beneath a trench in play (ASLRB B27.51)';
  const se = squadEquivalents(env, units);
  const smcs = units.filter((p) => smc(env, p)).length;
  if (se > room.se) return `The ${entName(c)} in ${hex} has room for ${room.se > 0 ? `${room.se} squad${room.se === 1 ? '' : 's'}` : 'no more squads'} of your side (ASLRB B27.12)`;
  if (smcs > room.smc) return `The ${entName(c)} in ${hex} has room for ${room.smc} more SMC (ASLRB B27.12)`;
  return null;
}

/** MF to go beneath or come out from beneath the entrenchment of `hex` for `side`: one, two for an A-T Ditch (B27.56), none while it is hidden and the side's own (A12.33). */
export function entrenchmentMf(env: QueryEnv, hex: HexId, side: SideId): number {
  const c = entrenchmentAt(env, hex);
  if (!c) return 0;
  if (c.side === side && fortHiddenAt(env, hex, c.kind)) return 0;
  return c.kind === 'ditch' ? 2 : 1;
}

/** Trenches (and A-T Ditches) adjacent to the one in `hex`, which connect to it (B27.54; no cliffs or Water Obstacles on boards t–z). */
export function connectedTrenches(env: QueryEnv, hex: HexId): HexId[] {
  const c = entrenchmentAt(env, hex);
  if (!c || c.kind === 'foxhole') return [];
  return adjacentLocs(env, hex)
    .filter((l) => isGroundLoc(l))
    .filter((h) => {
      const n = entrenchmentAt(env, h);
      return !!n && n.kind !== 'foxhole';
    })
    .sort();
}
const trenchToTrench = (env: QueryEnv, from: HexId | null | undefined, to: HexId) => !!from && connectedTrenches(env, from).includes(to);
/** The cost of a move between connecting trenches: one MF, two uphill, plus one for SMOKE (B27.54). */
const trenchMoveCost = (env: QueryEnv, from: HexId, to: HexId) => (levelOf(env, to) > levelOf(env, from) ? 2 : 1) + (smokeIn(env, to) ? 1 : 0);

function placeBeneath(ctx: Ctx, units: PieceId[], hex: HexId, beneath: boolean) {
  const c = entrenchmentAt(ctx, hex);
  for (const id of [...units].sort()) {
    const p = ctx.state.pieces[id];
    if (!p || p.loc.kind !== 'hex' || p.loc.hex !== hex) continue;
    const { pos: was, ...loc } = p.loc;
    const pos = { ...(was ?? {}) };
    if (beneath && c) pos.ent = c.kind as EntKind;
    else delete pos.ent;
    if (!!was?.ent === !!pos.ent) continue;
    ctx.emit('piece.moved', { id, loc: Object.keys(pos).length ? { ...loc, pos } : loc });
  }
}

// ---------------------------------------------------------------- B27.11 Entrenching

/** Why an entrenching attempt may not be made in `hex` at all (B27.1, B23.5, B27.12, B27.51), or null; a pillbox hex may take one (B30.8). */
export function entrenchHexIllegal(env: QueryEnv, hex: HexId): string | null {
  const why = counterTerrainIllegal(env, { kind: 'foxhole', hex, hidden: false, capacity: 1 });
  if (why) return why;
  const c = entrenchmentAt(env, hex);
  if (c && c.kind !== 'foxhole') return `A ${entName(c)} hex takes no foxhole (ASLRB B27.51)`;
  if (c && (c.capacity ?? 1) >= 3) return 'The foxhole here is 3S already, the most a hex holds (ASLRB B27.12)';
  return null;
}

/** Why `p` may not attempt to entrench now (B27.11), or null. */
export function entrenchUnitIllegal(env: QueryEnv, p: Piece): string | null {
  if (!mmc(env, p)) return `${p.id} is not an Infantry MMC: a squad or its equivalent entrenches (ASLRB B27.11)`;
  if (isBroken(p)) return `${p.id} is broken`;
  if (!isGoodOrder(env, p) || isPinned(p)) return `${p.id} must be unpinned and in Good Order`;
  if (fireMarker(p) || p.tags[T.firedSw]) return `${p.id} has already attempted an action this phase (ASLRB B27.11)`;
  const ti = tiIllegal(p);
  if (ti) return ti;
  if (isEntrenched(p)) return `${p.id} is already beneath the ${entName(entrenchmentAt(env, p.loc.kind === 'hex' ? p.loc.hex : '')!)} (ASLRB B27.11)`;
  if (p.loc.kind === 'hex' && p.loc.pos?.wire === 'on') return `${p.id} is on top of the Wire (ASLRB B27.11, B26.4)`;
  return null;
}
/** Why a leader may not direct the attempts in his Location (B27.11: "a similarly unused leader"), or null. */
export function entrenchDirectorIllegal(env: QueryEnv, p: Piece): string | null {
  if (defOf(env, p).kind !== 'leader') return `${p.id} is not a leader`;
  if (isBroken(p) || !isGoodOrder(env, p) || isPinned(p)) return `${p.id} must be unpinned and in Good Order`;
  if (fireMarker(p) || p.tags[T.firedSw]) return `${p.id} has already attempted an action this phase (ASLRB B27.11)`;
  const ti = tiIllegal(p);
  if (ti) return ti;
  if (p.loc.kind === 'hex' && p.loc.pos?.wire === 'on') return `${p.id} is on top of the Wire (ASLRB B26.4)`;
  return null;
}

/** The units of `side` in `loc` that may take part in Entrenching now: the MMC that may attempt, the leaders that may direct. */
export function entrenchers(env: QueryEnv, loc: LocId, side: SideId): { mmcs: Piece[]; leaders: Piece[] } {
  const here = personnelAt(env, loc, side);
  return { mmcs: here.filter((p) => entrenchUnitIllegal(env, p) === null), leaders: here.filter((p) => entrenchDirectorIllegal(env, p) === null) };
}

/**
 * The Labor DRM of an Entrenching attempt at `loc` (B24.8): the best Labor counter for that Task among the units making
 * the attempt together, since a unit that earned one "may add the -1 ... even if joined by new units".
 */
export function entrenchLabor(env: QueryEnv, loc: LocId, units: PieceId[]): number {
  return Math.min(0, ...units.map((u) => {
    const l = parseLabor(env.state.pieces[u]?.tags['labor']);
    return l && l.task === `entrench:${loc}` ? l.drm : 0;
  }));
}

/**
 * The DRM of one Entrenching DR (B27.11, B24.8, A25.21): +1 for a lone HS or crew, the director's leadership, Labor, -1
 * Russian. `joint` lists the other MMC attempting at the same time (their Labor counter applies to the newcomers too).
 */
export function entrenchDrm(env: QueryEnv, loc: LocId, unit: PieceId, director?: PieceId, joint: PieceId[] = []): { drm: number; explain: string[] } {
  const explain: string[] = [];
  let drm = 0;
  const p = pieceOf(env, unit);
  const m = mmc(env, p);
  if (m && m.kind !== 'squad') {
    drm += 1;
    explain.push(`+1 ${m.kind === 'crew' ? 'crew' : 'HS'}`);
  }
  if (director) {
    const l = env.query('unit.leadership', { unit: director, for: unit }, smc(env, pieceOf(env, director))?.leadership ?? 0);
    if (l) {
      drm += l;
      explain.push(`${l > 0 ? '+' : ''}${l} leadership`);
    }
  }
  const labor = entrenchLabor(env, loc, [unit, ...joint]);
  if (labor) {
    drm += labor;
    explain.push(`${labor} Labor`);
  }
  if (defOf(env, p).nationality === 'ru') {
    drm -= 1;
    explain.push('-1 Russian');
  }
  // Weather (Chapter E: Mud +1, Ground Snow +2, none in Extreme Winter) is not modelled; a weather module adds to this query.
  drm = env.query('entrench.drm', { loc, unit, ...(director ? { director } : {}) }, drm);
  return { drm, explain };
}

/** Why an Entrenching action is refused, or null. */
export function entrenchIllegal(env: QueryEnv, a: { loc: LocId; attempts: EntrenchAttempt[]; side: SideId }): string | null {
  if (env.state.phase !== 'PFPh') return 'Entrenching Attempts are made in the Prep Fire Phase (ASLRB B27.11)';
  if (a.side !== env.state.attacker) return 'Only the ATTACKER entrenches, in his own PFPh (ASLRB B27.11)';
  if (!isGroundLoc(a.loc)) return 'A foxhole is dug at ground level (ASLRB B27.1)';
  const hex = hexOfLoc(a.loc);
  const why = entrenchHexIllegal(env, hex);
  if (why) return why;
  if (a.attempts.length === 0) return 'No unit is attempting';
  const seen = new Set<PieceId>();
  const directors = new Set<PieceId>();
  for (const at of a.attempts) {
    const p = env.state.pieces[at.unit];
    if (!p || p.side !== a.side) return `${at.unit} is not yours`;
    if (locOf(env.state, p) !== a.loc) return `${at.unit} is not in ${a.loc}`;
    if (seen.has(at.unit)) return `${at.unit} attempts once`;
    seen.add(at.unit);
    const u = entrenchUnitIllegal(env, p);
    if (u) return u;
    if (at.director) {
      const d = env.state.pieces[at.director];
      if (!d || d.side !== a.side || locOf(env.state, d) !== a.loc) return `${at.director} is not a leader of yours in ${a.loc}`;
      const dw = entrenchDirectorIllegal(env, d);
      if (dw) return dw;
      directors.add(at.director);
    }
  }
  if (directors.size > 1) return 'One leader directs the attempts in a Location (ASLRB B27.11)';
  const c = entrenchmentAt(env, hex);
  const room = 3 - (c?.capacity ?? 0);
  if (a.attempts.length > room) return `At most ${room} foxhole${room === 1 ? '' : 's'} more can be dug here: a hex holds three squads of foxhole (ASLRB B27.12)`;
  return null;
}

function nextFortId(env: QueryEnv, side: SideId): string {
  const n = fortCounters(env)
    .filter((c) => c.side === side)
    .map((c) => Number(c.id.replace(/^.*fort/, '')))
    .filter((x) => Number.isFinite(x));
  return `${side}.fort${(n.length ? Math.max(...n) : 0) + 1}`;
}

// ---------------------------------------------------------------- B27.4: into and out of the entrenchment during the MPh

/** Why the moving stack may not go beneath (`beneath`) or come out from beneath the entrenchment of its hex as a separate MF (B27.4), or null. */
export function entrenchmentMoveIllegal(env: QueryEnv, beneath: boolean): string | null {
  const ms = moveState(env);
  if (!ms || !ms.hex || ms.off) return 'No stack is moving on the map';
  if (ms.vehicle) return 'A vehicle is never beneath a foxhole or trench (ASLRB B27.1)';
  if (ms.bypass) return 'A stack in Bypass is not in the hex (ASLRB A4.3)';
  if (ms.halted) return 'The stack has ended its movement';
  if (ms.level || ms.sub) return 'A foxhole is at ground level (ASLRB B27.1)';
  const side = env.state.attacker;
  const c = entrenchmentKnownTo(env, ms.hex, side);
  if (!c) return `No foxhole or trench in ${ms.hex}`;
  if (beneath === !!ms.ent) return beneath ? `Already beneath the ${entName(c)}` : `Not beneath the ${entName(c)}`;
  if (ms.units.length === 0) return 'No unit is still moving';
  if (beneath) {
    // On top of Wire a unit may not enter an entrenchment (B26.4): first beneath the Wire.
    const wire = wireKnownTo(env, ms.hex, side);
    if (wire && !ownHiddenWire(wire, side) && ms.units.some((u) => onWire(pieceOf(env, u)))) return 'Units on top of the Wire cannot enter an entrenchment: get beneath the Wire first (ASLRB B26.4)';
    const why = beneathIllegal(env, ms.hex, side, ms.units.map((u) => pieceOf(env, u)), !!ms.manhandle);
    if (why) return why;
  } else if (ms.manhandle) {
    return c.kind === 'foxhole' ? 'A mortar beneath a foxhole may not leave it in play (ASLRB B27.1)' : 'A Gun beneath a trench may not be removed from it (ASLRB B27.51)';
  }
  const mf = entrenchmentMf(env, ms.hex, side);
  for (const u of ms.units) if (remaining(env, ms, u) < mf) return `${u} lacks the MF (${mf}) to ${beneath ? 'enter' : 'leave'} the ${entName(c)} (ASLRB B27.4)`;
  // A4.61 EXC: a MF spent within the Location does not void Assault Movement unless it is the unit's last (which may be spent).
  return inPlaceIllegal(env, ms, mf);
}

// ---------------------------------------------------------------- the module

export const aslEntrenchmentsModule: RuleModule = {
  id: 'asl.entrenchments',
  ref: 'ASLRB B27, A4.8, A25.21, B24.8',
  summary: 'Foxholes and trenches in play: TEM, moving in and out, capacity per side, connected trenches, rout and advance beneath, and Entrenching in the PFPh.',
  requires: ['asl.fortifications', 'asl.labor', 'sk1.movement', 'sk1.rout', 'sk1.advance', 'sk1.rally', 'sk1.fire'],
  install(r) {
    r.event<{ loc: LocId; unit: PieceId; director?: PieceId; dr: [number, number]; drm: number; explain: string[]; success: boolean; capacity?: 1 | 2 | 3; labor?: number }>({ type: 'asl.entrench.attempt', apply() {} });
    r.event<{ units: PieceId[]; hex: HexId; beneath: boolean; mf: number; phase: string }>({ type: 'asl.entrench.move', apply() {} });
    /** C3.32: units beneath an entrenchment the To Hit DR missed, though it hit the units on top (`extra`: their +2 over the hex TEM). */
    r.event<{ units: PieceId[]; final: number; extra: number; th: number }>({ type: 'asl.entrench.thMissed', apply() {} });
    r.event<{ snapEntry: string | null }>({
      type: 'asl.entrench.snap',
      apply(d, p) {
        if (p.snapEntry) d.ext[ENTRENCH_EXT] = { snapEntry: p.snapEntry } satisfies EntrenchState;
        else delete d.ext[ENTRENCH_EXT];
      },
    });

    // What the other side may see: a move beneath a hidden counter of the mover's own side (0 MF, A12.33) shows neither the
    // move event nor the stack's position in the moving state.
    r.redact({
      id: 'asl.ent.redact',
      ext: 'sk1.move',
      redactExt(slice, viewer, env) {
        const ms = slice as MoveState | undefined;
        if (!ms?.ent || !ms.hex) return slice;
        const c = entrenchmentAt(env, ms.hex);
        if (!c || shownCounter(c, viewer)) return slice;
        const { ent: _hidden, ...rest } = ms;
        void _hidden;
        return rest;
      },
      events: ['asl.entrench.move'],
      redactEvent(ev, viewer, env) {
        const c = entrenchmentAt(env, (ev.payload as { hex: HexId }).hex);
        return !c || shownCounter(c, viewer) ? ev : null;
      },
    });

    // ---------------------------------------------------------------- B27.11: Entrenching Attempts in the ATTACKER's PFPh
    r.action<EntrenchAction>({
      type: 'entrench.attempt',
      decisionKinds: [PHASE_DECISION],
      legal(env) {
        if (env.state.phase !== 'PFPh') return [];
        const side = env.state.attacker;
        const out: EntrenchAction[] = [];
        const locs = new Set<LocId>();
        for (const p of Object.values(env.state.pieces).sort(byId)) {
          if (p.side !== side || p.loc.kind !== 'hex' || p.loc.level || p.loc.sub) continue;
          locs.add(p.loc.hex);
        }
        for (const loc of [...locs].sort()) {
          if (entrenchHexIllegal(env, loc)) continue;
          const { mmcs, leaders } = entrenchers(env, loc, side);
          const room = 3 - (entrenchmentAt(env, loc)?.capacity ?? 0);
          const diggers = mmcs.slice(0, room);
          if (!diggers.length) continue;
          const director = leaders[0];
          const a = { type: 'entrench.attempt', loc, attempts: diggers.map((m) => ({ unit: m.id, ...(director ? { director: director.id } : {}) })) } as EntrenchAction;
          if (!entrenchIllegal(env, { ...a, side })) out.push(a);
        }
        return out;
      },
      validate: (env, a) => entrenchIllegal(env, a),
      resolve(ctx, a) {
        const side = a.side;
        const hex = hexOfLoc(a.loc);
        const participants = new Set<PieceId>();
        const joint = a.attempts.map((x) => x.unit);
        // The Labor counter of the attempt (B24.8): a failure flips it one step further for every unit beneath it,
        // newcomers included. Failures are marked once all the DRs are made, so one unit's failure does not change
        // the DRM of another's DR made at the same time.
        const failed: { unit: PieceId; labor: number }[] = [];
        for (const at of [...a.attempts].sort((x, y) => (x.unit < y.unit ? -1 : 1))) {
          participants.add(at.unit);
          if (at.director) participants.add(at.director);
          const { drm, explain } = entrenchDrm(ctx, a.loc, at.unit, at.director, joint);
          const roll = ctx.roll(`Entrenching Attempt by ${at.unit}`);
          const success = roll.total + drm <= 5;
          let capacity: 1 | 2 | 3 | undefined;
          let labor: number | undefined;
          if (success) {
            const c = entrenchmentAt(ctx, hex);
            if (c) {
              // The new foxhole replaces the 1S counter by a 2S or 3S one (B27.12): a counter created in play is placed
              // openly (only setup may be hidden, A12.33), so a hidden foxhole grown this way is revealed.
              revealFortification(ctx, c.id, 'grown');
              capacity = Math.min(3, (c.capacity ?? 1) + 1) as 1 | 2 | 3;
              ctx.emit('asl.fort.grown', { id: c.id, capacity });
            } else {
              capacity = 1;
              ctx.emit('asl.fort.placed', { side, counters: [{ id: nextFortId(ctx, side), side, kind: 'foxhole', hex, hidden: false, capacity: 1 }] });
            }
            // The Task is achieved: the Labor counters for it come off (B24.8), failures earlier in this attempt included.
            for (const p of personnelAt(ctx, a.loc, side)) if (parseLabor(p.tags['labor'])?.task === `entrench:${a.loc}`) setTags(ctx, p.id, { labor: null });
            failed.length = 0;
            placeBeneath(ctx, [at.unit, ...(at.director ? [at.director] : [])], hex, true);
          } else {
            labor = Math.max(-2, entrenchLabor(ctx, a.loc, joint) - 1);
            failed.push({ unit: at.unit, labor });
          }
          ctx.emit('asl.entrench.attempt', { loc: a.loc, unit: at.unit, ...(at.director ? { director: at.director } : {}), dr: roll.dice as [number, number], drm, explain, success, ...(capacity ? { capacity } : {}), ...(labor !== undefined ? { labor } : {}) });
        }
        for (const f of failed) setTags(ctx, f.unit, { labor: laborTag(`entrench:${a.loc}`, f.labor) });
        // Regardless of the outcome, all participating units are TI (B27.11, A4.8).
        for (const id of [...participants].sort()) setTags(ctx, id, { ti: true });
      },
    });

    // ---------------------------------------------------------------- B27.4: a separate MF into or out of the entrenchment
    r.action<EntrenchmentMoveAction>({
      type: 'move.entrenchment',
      decisionKinds: [PHASE_DECISION],
      legal(env) {
        const ms = moveState(env);
        if (!ms || env.state.phase !== 'MPh' || !ms.hex) return [];
        const beneath = !ms.ent;
        return entrenchmentMoveIllegal(env, beneath) ? [] : [{ type: 'move.entrenchment', beneath }];
      },
      validate: (env, a) => entrenchmentMoveIllegal(env, a.beneath),
      resolve(ctx, a) {
        const ms = moveState(ctx)!;
        const hex = ms.hex!;
        const mf = entrenchmentMf(ctx, hex, ctx.state.attacker);
        // Leaving makes the units more vulnerable, so Residual FP here attacks them again (A8.2); entering never does.
        spendInPlace(ctx, ms, mf, a.beneath ? { ent: true } : { residualDrmHere: null });
        if (!a.beneath) {
          const { ent: _was, ...rest } = moveState(ctx)!;
          void _was;
          ctx.emit('sk1.move.state', { state: rest });
        }
        placeBeneath(ctx, ms.units, hex, a.beneath);
        ctx.emit('asl.entrench.move', { units: ms.units, hex, beneath: a.beneath, mf, phase: 'MPh' });
        afterMfExpenditure(ctx);
      },
    });

    // A stack starts beneath the entrenchment when its units are (B27.4: it leaves for the exit MF).
    r.contribute({
      id: 'asl.ent.startState',
      query: 'move.startState',
      ref: 'ASLRB B27.4',
      apply: (v, { units }, env): Partial<MoveState> => (units.length && units.every((u) => isEntrenched(pieceOf(env, u))) ? { ...v, ent: true as const } : v),
    });
    // Units in and out of the entrenchment need different MF to leave the Location (A15.431; A4.12 wants the same
    // entrenchment status for the leader bonus): a stack shares one position. A Gun beneath a trench stays (B27.51).
    r.contribute({
      id: 'asl.ent.cannotStart',
      query: 'move.cannotStart',
      ref: 'ASLRB A4.12, A15.431, B27.51',
      apply(v, { units, manhandle }, env) {
        if (v) return v;
        const ps = units.map((u) => env.state.pieces[u]).filter((p): p is Piece => !!p);
        if (new Set(ps.map((p) => (isEntrenched(p) ? 'in' : 'out'))).size > 1) return 'Units beneath the foxhole and units on top of it move as separate stacks (ASLRB B27.4, A4.12)';
        if (manhandle) {
          const g = env.state.pieces[manhandle];
          const holder = g?.loc.kind === 'held' ? env.state.pieces[g.loc.by] : undefined;
          if (holder && isEntrenched(holder)) return holder.loc.kind === 'hex' && holder.loc.pos?.ent === 'foxhole' ? 'A mortar beneath a foxhole may not leave it in play (ASLRB B27.1)' : 'A Gun beneath a trench may not be removed from it (ASLRB B27.51)';
        }
        return null;
      },
    });
    // The combined forms of the MF (B27.4): under Assault Movement a step straight beneath the entrenchment of the hex
    // entered, or out of the one the stack stands beneath; between connecting trenches at any time (B27.54).
    r.contribute({
      id: 'asl.ent.stepVariants',
      query: 'move.stepVariants',
      ref: 'ASLRB B27.4, B27.54',
      apply(v, { ms, to }, env) {
        if (ms.vehicle || !ms.hex || !isGroundLoc(to) || !entrenchmentKnownTo(env, hexOfLoc(to), env.state.attacker)) return v;
        if (!ms.assault && !(ms.ent && trenchToTrench(env, ms.hex, to))) return v;
        return [...v, { type: 'move.step' as const, to, beneath: true as const }];
      },
    });
    // B27.56: "no vehicle may enter an unbridged A-T Ditch" (there are no bridges yet); B27.55: "Wheeled vehicles or
    // halftracks may not enter a trench hex". Both bind while the counter is hidden (Q&A [K33] to A12.33, B27.55, B27.56:
    // a HIP A-T Ditch prohibits vehicular movement; a HIP trench prohibits entrance). Legality refuses only what the
    // moving side knows; a counter it cannot see is found by the attempt (below), so no refusal leaks it.
    const vehicleBarred = (env: QueryEnv, vid: PieceId, c: FortRecord | null): string | null => {
      if (!c) return null;
      if (c.kind === 'ditch') return `No vehicle may enter an A-T Ditch (${c.hex}; ASLRB B27.56)`;
      if (c.kind === 'trench' && !vehicle(env, pieceOf(env, vid))?.tracked) return `Wheeled vehicles and halftracks may not enter a trench hex (${c.hex}; ASLRB B27.55)`;
      return null;
    };
    /** B27.43: a foxhole slows an Armored Car (2 MP + COT); a tracked vehicle pays nothing for it. */
    const foxholeSlows = (env: QueryEnv, vid: PieceId, c: FortRecord): boolean => {
      const d = vehicle(env, pieceOf(env, vid));
      return c.kind === 'foxhole' && !!d && !d.tracked && !d.unarmored;
    };
    r.contribute({
      id: 'asl.ent.ditchVehicle',
      query: 'vehicle.stepIllegal',
      ref: 'ASLRB B27.55, B27.56',
      apply(v, { ms, to }, env) {
        if (v) return v;
        return vehicleBarred(env, ms.units[0]!, entrenchmentKnownTo(env, to, env.state.attacker));
      },
    });
    // The attempt on a counter the mover cannot see: it is revealed (the vehicle at its edge is a Good Order enemy ground
    // unit with a LOS to its Location, A12.33), the step is not taken and nothing is spent; the vehicle moves on knowing.
    r.procedure<MoveEnterFn>(MOVE_ENTER, (next) => (ctx, ms, to, cost, woods, extra) => {
      const c = ms.vehicle && isGroundLoc(to) ? entrenchmentAt(ctx, hexOfLoc(to)) : null;
      if (!c || shownCounter(c, ctx.state.attacker) || (!vehicleBarred(ctx, ms.units[0]!, c) && !foxholeSlows(ctx, ms.units[0]!, c))) return next?.(ctx, ms, to, cost, woods, extra);
      revealFortification(ctx, c.id, 'attempt');
      ctx.emit('asl.ent.vehicleRefused', { vehicle: ms.units[0]!, hex: c.hex, kind: c.kind });
      moveInternals.reAskMover(ctx);
    });
    r.event<{ vehicle: PieceId; hex: HexId; kind: string }>({ type: 'asl.ent.vehicleRefused', apply() {} });
    // B27.52: "Any vehicle beneath a trench counter is considered HD, but may not change its VCA or expend a Start MP" (HD:
    // `asl/hullDown.ts`). Nor may it attempt Motion (Q&A [K33] to B27.52 & D2.401), or pivot its hull to fire (an NT
    // vehicle's CA is its VCA, C3.22); the turret turns freely (D4.221 "the vehicle's TCA may be"). The Infantry in its
    // Location get no +1 from it (D9.3: "that AFV/wreck is entrenched (B27.52)"); its Hindrance is unchanged. The pivot to
    // fire is refused with every other hull turn, by `vehicle.cannotTurn` (`hullTurnRefusal`).
    const trenchVehicle = (env: QueryEnv, id: PieceId) => isEntrenchedVehicle(env, env.state.pieces[id]);
    r.contribute({ id: 'asl.ent.vehicleNoStart', query: 'vehicle.cannotStart', ref: 'ASLRB B27.52', apply: (v, { vehicle: id }, env) => v ?? (trenchVehicle(env, id) && env.state.pieces[id]!.side === env.state.attacker && env.state.phase === 'MPh' ? 'Beneath the trench: no Start MP (ASLRB B27.52)' : null) });
    r.contribute({ id: 'asl.ent.vehicleNoTurn', query: 'vehicle.cannotTurn', ref: 'ASLRB B27.52', apply: (v, { vehicle: id }, env) => v ?? (trenchVehicle(env, id) ? 'Beneath the trench: no VCA change (ASLRB B27.52)' : null) });
    r.contribute({ id: 'asl.ent.vehicleNoMotion', query: 'vehicle.cannotAttemptMotion', ref: 'ASLRB B27.52, D2.401', apply: (v, { vehicle: id }, env) => v ?? (trenchVehicle(env, id) ? 'Beneath the trench: no Motion attempt (ASLRB B27.52; Q&A [K33] to B27.52 & D2.401)' : null) });
    r.contribute({ id: 'asl.ent.vehicleNoCover', query: 'vehicle.givesCover', ref: 'ASLRB D9.3, B27.52', apply: (v, { vehicle: id }, env) => v && !trenchVehicle(env, id) });

    // B27.43: "Foxholes are not a movement obstacle to tracked vehicles, but do slow down other vehicles": the Movement
    // Costs Chart (Terrain Chart row 27) gives an Armored Car 2 MP + COT, a fully-tracked vehicle the COT alone, and no
    // Bog Check on the foxhole line. A foxhole the vehicle's side knows of (its own hidden one too: A12.33's free entry is
    // Infantry's, Q&A [K33] to A12.33 "This is not the case for vehicles", as for Wire) costs it the 2 MP; one it cannot
    // know of is found by the attempt above. The chart's other vehicle types (Truck 4 + COT, Motorcycle 2 + COT,
    // Halftrack COT, Cavalry and Horse Drawn 1 + COT) have no counters yet: only an armored, non-tracked vehicle pays.
    r.contribute({
      id: 'asl.ent.foxholeVehicleMp',
      query: 'vehicle.extraMp',
      ref: 'ASLRB B27.43',
      apply(v, { vehicle: vid, hex }, env) {
        const c = entrenchmentKnownTo(env, hex, pieceOf(env, vid).side);
        return c && foxholeSlows(env, vid, c) ? v + 2 : v;
      },
    });
    // B27.55: a fully-tracked vehicle enters a trench hex at the COT of its other terrain, is never beneath the trench, and
    // chances a Bog DR on entering and on changing VCA there, hidden trench or not (Q&A [K33] to A12.33, B27.55).
    r.contribute({
      id: 'asl.ent.trenchBog',
      query: 'vehicle.bogIn',
      ref: 'ASLRB B27.55, D8.2',
      apply: (v, { hex }, env) => v || entrenchmentAt(env, hex)?.kind === 'trench',
    });
    r.contribute({
      id: 'asl.ent.stepIllegal',
      query: 'move.stepIllegal',
      ref: 'ASLRB B27.4, B27.54',
      apply(v, { ms, to, beneath }, env) {
        if (v || ms.vehicle || !ms.hex) return v;
        const side = env.state.attacker;
        const toHex = hexOfLoc(to);
        // B30.8: between a bunker and its trench "as if the bunker were also a trench": no separate trench MF.
        const bunker = bunkerMove(env, ms.sub === 'pb' ? `${ms.hex}:pb` : ms.hex, !!ms.ent, to, !!beneath);
        if (bunker) return bunker === 'out' ? beneathIllegal(env, toHex, side, ms.units.map((u) => pieceOf(env, u)), !!ms.manhandle) : null;
        const trench = !!ms.ent && trenchToTrench(env, ms.hex, toHex);
        if (beneath) {
          if (!isGroundLoc(to)) return 'A foxhole is at ground level (ASLRB B27.1)';
          if (!trench && !ms.assault) return 'The MF to go beneath a foxhole is paid separately after entering the hex, unless the stack is Assault Moving (ASLRB B27.4)';
          return beneathIllegal(env, toHex, side, ms.units.map((u) => pieceOf(env, u)), !!ms.manhandle);
        }
        // Out of the entrenchment and into the next hex: separately in the MPh (B27.4), combined only under Assault Movement.
        if (ms.ent && !ms.assault) {
          const c = entrenchmentAt(env, ms.hex);
          return `Leave the ${c ? entName(c) : 'entrenchment'} first: its MF is paid separately (ASLRB B27.4)`;
        }
        if (ms.ent && ms.manhandle) return 'A Gun beneath a trench may not be removed from it (ASLRB B27.51)';
        return null;
      },
    });
    r.contribute({
      id: 'asl.ent.stepCost',
      query: 'move.stepCost',
      ref: 'ASLRB B27.4, B27.54, B27.56, A12.33',
      layer: 10,
      apply(v, { ms, to, beneath }, env) {
        if (ms.vehicle || !ms.hex || !isGroundLoc(to)) return v;
        const side = env.state.attacker;
        const toHex = hexOfLoc(to);
        if (beneath && ms.ent && trenchToTrench(env, ms.hex, toHex)) return trenchMoveCost(env, ms.hex, toHex);
        let cost = v;
        if (beneath) cost += entrenchmentMf(env, toHex, side);
        if (ms.ent) cost += entrenchmentMf(env, ms.hex, side);
        return cost;
      },
    });
    // On arrival: beneath the entrenchment, after the Residual FP of the hex has had its say (B27.4: a unit it pins or
    // breaks stays on top); a move between connecting trenches is marked for the First Fire that follows (B27.54).
    r.procedure<MoveEnterFn>(MOVE_ENTER, (next) => (ctx, ms, to, cost, woods, extra) => {
      const toHex = hexOfLoc(to);
      const trench = !!extra?.ent && !!ms.ent && !!ms.hex && trenchToTrench(ctx, ms.hex, toHex);
      next?.(ctx, ms, to, cost, woods, trench ? { ...extra, trenchMove: true } : extra);
      if (!extra?.ent) return;
      const after = moveState(ctx);
      if (!after || after.hex !== toHex) return;
      placeBeneath(ctx, after.units, toHex, true);
      ctx.emit('asl.entrench.move', { units: after.units, hex: toHex, beneath: true, mf: entrenchmentMf(ctx, toHex, ctx.state.attacker), phase: 'MPh' });
    });
    // A Snap Shot at the stack arriving beneath (B27.4 EXC): note the expenditure, so a unit it pins or breaks is put back on top.
    r.on<{ attack: { target: LocId; snap?: [HexId, HexId] } }>({
      id: 'asl.ent.snapAttack',
      event: 'sk1.fire.attack',
      handler(ctx, ev) {
        const ms = moveState(ctx);
        if (!ev.payload.attack.snap || !ms?.ent || !ms.hex || moveLoc(ms) !== ev.payload.attack.target) return;
        const last = ms.trail?.[ms.trail.length - 1];
        if (!last || last.hex !== ms.hex || last.mp !== ms.mfHere) return;
        ctx.emit('asl.entrench.snap', { snapEntry: expenditureKey(ctx) ?? null });
      },
    });
    r.on<{ id: PieceId; tags: Record<string, unknown> }>({
      id: 'asl.ent.snapPinned',
      event: 'piece.tagged',
      handler(ctx, ev) {
        const st = ctx.state.ext[ENTRENCH_EXT] as EntrenchState | undefined;
        if (!st?.snapEntry || (ev.payload.tags['pinned'] !== true && ev.payload.tags['broken'] !== true)) return;
        const ms = moveState(ctx);
        if (!ms?.hex || expenditureKey(ctx) !== st.snapEntry) return;
        const p = ctx.state.pieces[ev.payload.id];
        if (p && p.loc.kind === 'hex' && p.loc.hex === ms.hex && isEntrenched(p)) placeBeneath(ctx, [p.id], ms.hex, false);
      },
    });

    // ---------------------------------------------------------------- B27.3: the TEM, per unit
    const partsFt = (env: QueryEnv, attack: FireAttackCtx) => attack.parts.some((p) => p.kind === 'sw' && (defOf(env, pieceOf(env, p.piece)) as { type?: string }).type === 'FT');
    /** A Direct Fire ordnance attack on a vehicle beneath a trench: HD, not the +2 (B27.52, C3.331). */
    const hdInstead = (env: QueryEnv, attack: FireAttackCtx, unit: PieceId) => !!attack.ordnance && !attack.ordnance.indirect && isEntrenchedVehicle(env, env.state.pieces[unit]);
    const elevationReduction = (env: QueryEnv, attack: FireAttackCtx, hex: HexId): number => {
      // B9.33: one per full level by which the firer's height above the target hex's base level exceeds the range; a Fire
      // Group from several heights takes the kindest for the target.
      const base = heightOf(env, hex);
      const map = statics(env).map;
      const reductions = attack.parts.map((p) => {
        const loc = locOf(env.state, pieceOf(env, p.firer));
        if (!loc) return 0;
        return Math.max(0, Math.floor(heightOf(env, loc) - base) - map.distance(hexOfLoc(loc), hex));
      });
      return reductions.length ? Math.min(...reductions) : 0;
    };
    // Ordnance on the Infantry Target Type: TEM is a To Hit DRM (case 17; C3.33), not an IFT DRM, and a Critical Hit
    // reverses it (C3.7). When every unit the shot can hit is beneath the entrenchment, its +2 is that TEM (not
    // cumulative with a positive hex TEM, B27.3): on the To Hit DR, reversed on a CH, never on the IFT DR. With units on
    // top as well (C3.32 and its EX), the one To Hit DR is compared with each target's own To Hit number: those on top
    // with the hex TEM, those beneath with the +2; every unit hit takes the one Effects DR (`OP.resolveHit` below).
    const entTemOf = (env: QueryEnv, hex: HexId, from: LocId | null): number => {
      if (!from) return 2;
      const red = Math.max(0, Math.floor(heightOf(env, from) - heightOf(env, hex)) - statics(env).map.distance(hexOfLoc(from), hex));
      return 2 - red;
    };
    const ittAllBeneath = (env: QueryEnv, target: LocId, side: SideId, moving?: PieceId[]): boolean => {
      const units = moving?.length ? moving.map((u) => env.state.pieces[u]).filter((p): p is Piece => !!p && p.loc.kind === 'hex') : personnelAt(env, target, otherSide(env.state, side));
      return units.length > 0 && units.every(isEntrenched);
    };
    const thExtra = (env: QueryEnv, sc: ShotCtx): number => {
      const tem = Math.max(0, env.query('hex.tem', { hex: sc.target }, 0));
      return Math.max(0, entTemOf(env, hexOfLoc(sc.target), sc.loc ?? sc.hex) - tem);
    };
    r.contribute({
      id: 'asl.ent.th',
      query: 'ordnance.thDrm',
      ref: 'ASLRB B27.3, C3.33',
      label: (sc, env) => `+${thExtra(env, sc)} TEM (entrenchment, in place of the hex TEM)`,
      when: (sc, env) => sc.shot.targetType === 'ITT' && isGroundLoc(sc.target) && ittAllBeneath(env, sc.target, sc.side, sc.moving) && thExtra(env, sc) > 0,
      apply: (v, sc, env) => v + thExtra(env, sc),
    });
    /** An ordnance attack on the Infantry Target Type at a ground Location: its TEM went on the To Hit DR. */
    const ittAttack = (attack: FireAttackCtx): boolean => attack.ordnance?.targetType === 'ITT' && isGroundLoc(attack.target);
    const ittOnTh = (env: QueryEnv, attack: FireAttackCtx): boolean => {
      if (attack.ordnance?.targetType !== 'ITT' || !isGroundLoc(attack.target)) return false;
      const firer = attack.parts[0] ? locOf(env.state, pieceOf(env, attack.parts[0].firer)) : null;
      const side = attack.parts[0] ? pieceOf(env, attack.parts[0].firer).side : env.state.attacker;
      return ittAllBeneath(env, attack.target, side, attack.moving ? moveState(env)?.units : undefined) && !!firer;
    };
    r.contribute({
      id: 'asl.ent.ch-reversed',
      query: 'fire.drm',
      ref: 'ASLRB B27.3, C3.7',
      label: '-2 Critical Hit: entrenchment TEM reversed',
      when: ({ attack }, env) => !!attack.ordnance?.ch && !attack.ordnance.airBurst && ittOnTh(env, attack),
      apply(v, { attack }, env) {
        const tem = Math.max(0, env.query('hex.tem', { hex: attack.target }, 0));
        const from = locOf(env.state, pieceOf(env, attack.parts[0]!.firer));
        return v - Math.max(0, entTemOf(env, hexOfLoc(attack.target), from) - tem);
      },
    });
    // ... and in a mixed Location each unit beneath has its own TEM reversed on a Critical Hit: the +2 in place of the hex's.
    r.contribute({
      id: 'asl.ent.ch-reversed.unit',
      query: 'fire.unitDrm',
      ref: 'ASLRB B27.3, C3.7, C3.32',
      label: ({ attack }, env) => `-${Math.max(0, entTemOf(env, hexOfLoc(attack.target), locOf(env.state, pieceOf(env, attack.parts[0]!.firer))) - Math.max(0, env.query('hex.tem', { hex: attack.target }, 0)))} Critical Hit: entrenchment TEM reversed`,
      when: ({ attack, unit }, env) => !!attack.ordnance?.ch && !attack.ordnance.airBurst && ittAttack(attack) && !ittOnTh(env, attack) && isEntrenched(pieceOf(env, unit)) && attack.parts.length > 0,
      apply(v, { attack }, env) {
        const tem = Math.max(0, env.query('hex.tem', { hex: attack.target }, 0));
        return v - Math.max(0, entTemOf(env, hexOfLoc(attack.target), locOf(env.state, pieceOf(env, attack.parts[0]!.firer))) - tem);
      },
    });
    // C3.32: in a Location with units both on top and beneath, a unit beneath is hit only if the To Hit DR also beats
    // the To Hit number its own +2 gives it; the units hit share the one Effects DR. Claiming that +2 reveals a hidden
    // entrenchment (A12.33).
    r.procedure<ResolveHitFn>(OP.resolveHit, (next) => (ctx, sc, h, targets, results) => {
      if (!h.hit || sc.shot.targetType !== 'ITT' || !isGroundLoc(sc.shot.target)) return next!(ctx, sc, h, targets, results);
      const beneath = targets.filter((u) => isEntrenched(pieceOf(ctx, u)));
      if (beneath.length === 0 || beneath.length === targets.length) return next!(ctx, sc, h, targets, results);
      const c = entrenchmentAt(ctx, hexOfLoc(sc.shot.target));
      if (c && c.hidden && !c.revealed) revealFortification(ctx, c.id, 'tem');
      const extra = thExtra(ctx, sc);
      const th = toHitNumber(ctx, sc)?.th ?? -Infinity;
      const missed = extra > 0 && h.original + h.drm + extra > th ? beneath : [];
      if (missed.length) ctx.emit('asl.entrench.thMissed', { units: missed, final: h.original + h.drm, extra, th });
      return next!(ctx, sc, h, targets.filter((u) => !missed.includes(u)), results);
    });
    r.contribute({
      id: 'asl.ent.tem',
      query: 'fire.unitDrm',
      ref: 'ASLRB B27.3, B13.3, B9.33, B10.31, B27.42',
      label: ({ attack, unit }, env) => {
        const p = pieceOf(env, unit);
        const c = p.loc.kind === 'hex' ? entrenchmentAt(env, p.loc.hex) : null;
        const notes = [`+2 TEM (${c ? entName(c) : 'entrenchment'})`];
        const hex = hexOfLoc(attack.target);
        const tem = env.query('hex.tem', { hex: attack.target }, 0);
        if (!attack.ordnance?.airBurst && tem > 0) notes.push(`not with the +${tem} ${terrainOf(env, hex).name} TEM`);
        const red = elevationReduction(env, attack, hex);
        if (red) notes.push(`-${red} firer's elevation advantage (B9.33)`);
        if (ffmoApplies(env, attack) && !isPinned(p)) notes.push('no FFMO beneath it');
        return notes.join(', ');
      },
      when: ({ attack, unit }, env) => !attack.snap && isEntrenched(pieceOf(env, unit)) && !partsFt(env, attack) && !ittAttack(attack) && !hdInstead(env, attack, unit),
      apply(v, { attack, unit }, env) {
        const hex = hexOfLoc(attack.target);
        const tem = env.query('hex.tem', { hex: attack.target }, 0);
        // The +4 against an OVR or OBA attack (B27.3) waits for vehicle Overrun (D7) and Chapter C1 OBA (radios, Battery
        // Access, FFE): neither attack exists here. A scenario's off-board mortar special rule is no C1 OBA and takes the +2.
        let drm = v + 2 - Math.max(0, elevationReduction(env, attack, hex));
        // Not cumulative with other positive TEM (B27.3); an Air Burst's -1 stays (B13.3), as does FFNAM (A8.2's example).
        if (!attack.ordnance?.airBurst) drm -= Math.max(0, tem);
        // No Height Advantage against a unit with a positive TEM (B10.31): the +1 was added for an Open Ground hex.
        if (tem <= 0 && heightAdvantage(env, attack)) drm -= 1;
        // FFMO only while on top (B27.42); the pinned-mover rule has already given it back to a pinned unit (A7.83).
        if (ffmoApplies(env, attack) && !isPinned(pieceOf(env, unit))) drm += 1;
        return drm;
      },
    });
    // A vehicle beneath a trench is HD to Direct Fire ordnance in place of the +2 (B27.52; no choice of the +2 instead, Q&A
    // [K33] to B27.52; C3.331: TEM that grants HD does not reach the Effects DR), and keeps it against Indirect Fire and
    // attacks on the IFT (Q&A [K33] to B27.52, C1.55 & D9.54: +2 against an on-board mortar). Its CE crew takes the +2 alone:
    // the CE DRM "is not cumulative with any positive TEM" (D5.3).
    r.suppress<'fire.unitDrm'>({
      id: 'asl.ent.vehicleNoCe',
      query: 'fire.unitDrm',
      target: 'sk3.drm.ce',
      ref: 'ASLRB D5.3, B27.3',
      when: ({ attack, unit }, env) => isEntrenchedVehicle(env, env.state.pieces[unit]) && !attack.snap && !partsFt(env, attack) && !hdInstead(env, attack, unit),
    });
    // A hidden entrenchment is revealed when its TEM is claimed (A12.33): any attack resolved on a Location with a unit
    // beneath it, except one against which the TEM cannot be claimed: a Snap Shot (A8.15) or a FT (B27.3 EXC, A22.1).
    r.on<{ attack: { target: LocId; parts: PieceId[]; snap?: unknown } }>({
      id: 'asl.ent.temReveal',
      event: 'sk1.fire.attack',
      handler(ctx, ev) {
        const { attack } = ev.payload;
        if (attack.snap || attack.parts.some((id) => (defOf(ctx, pieceOf(ctx, id)) as { type?: string }).type === 'FT')) return;
        const hex = hexOfLoc(attack.target);
        const c = entrenchmentAt(ctx, hex);
        if (!c || !c.hidden || c.revealed) return;
        // A vehicle beneath claims the +2 only for a crew it reaches: Crew Exposed (a Buttoned Up AFV is immune, B27.52's HD
        // against Direct Fire ordnance being revealed by the shot itself, below).
        if (entrenchedAt(ctx, hex, c.side).length || entrenchedVehiclesAt(ctx, hex, c.side).some((v) => v.tags['ce'] === true)) revealFortification(ctx, c.id, 'tem');
      },
    });
    // ... and a Direct Fire ordnance shot at a vehicle beneath it, hit or miss, claims its HD (B27.52, A12.33).
    r.on<{ target: LocId; targetType?: string; weapon: PieceId }>({
      id: 'asl.ent.hdReveal',
      event: 'sk2.ordnance.shot',
      handler(ctx, ev) {
        if (ev.payload.targetType !== 'VTT' && ev.payload.targetType !== 'ATT') return;
        const w = ctx.state.pieces[ev.payload.weapon];
        if (w && (defOf(ctx, w) as { type?: string }).type === 'MTR') return;
        const hex = hexOfLoc(ev.payload.target);
        const c = entrenchmentAt(ctx, hex);
        if (c && c.hidden && !c.revealed && entrenchedVehiclesAt(ctx, hex, c.side).length) revealFortification(ctx, c.id, 'tem');
      },
    });

    // ...or when its TEM is claimed on an ordnance To Hit DR (B27.3, A12.33), hit or miss.
    r.on<{ target: LocId; explain: { id: string }[] }>({
      id: 'asl.ent.thReveal',
      event: 'sk2.ordnance.shot',
      handler(ctx, ev) {
        if (!ev.payload.explain?.some((n) => n.id === 'asl.ent.th')) return;
        const c = entrenchmentAt(ctx, hexOfLoc(ev.payload.target));
        if (c && c.hidden && !c.revealed) revealFortification(ctx, c.id, 'tem');
      },
    });

    // ---------------------------------------------------------------- B27.13: Recovery across the rim
    r.contribute({
      id: 'asl.ent.recover',
      query: 'recover.illegal',
      ref: 'ASLRB B27.13',
      apply(v, { unit, sw }, env) {
        if (v) return v;
        const u = env.state.pieces[unit];
        const w = env.state.pieces[sw];
        if (!u || !w || u.loc.kind !== 'hex' || w.loc.kind !== 'hex') return null;
        const uIn = !!u.loc.pos?.ent;
        const wIn = !!w.loc.pos?.ent;
        if (uIn === wIn) return null;
        return wIn ? 'The weapon lies beneath the foxhole: only a unit beneath it may Recover it (ASLRB B27.13)' : 'A unit beneath the foxhole cannot Recover a weapon lying outside it (ASLRB B27.13)';
      },
    });

    // ---------------------------------------------------------------- B27.41, A10.5, A10.531, A10.61, A10.62: rout and rally
    r.contribute({
      id: 'asl.ent.routBeneath',
      query: 'rout.beneath',
      ref: 'ASLRB B27.41, B27.54',
      apply(v, { unit, from, to }, env) {
        if (v !== null || !isGroundLoc(to)) return v;
        const p = pieceOf(env, unit);
        const toHex = hexOfLoc(to);
        const c = entrenchmentKnownTo(env, toHex, p.side);
        if (!c) return null;
        const why = beneathIllegal(env, toHex, p.side, [p]);
        if (why) return why;
        if (isEntrenched(p) && trenchToTrench(env, from, toHex)) return { cost: trenchMoveCost(env, from, toHex) };
        return { cost: env.query('move.cost', { unit, from, to: toHex, viaRoad: false }, 1) + entrenchmentMf(env, toHex, p.side) };
      },
    });
    r.contribute({
      id: 'asl.ent.routExit',
      query: 'rout.exitCost',
      ref: 'ASLRB B27.41',
      // Not into a bunker its trench connects to (B30.8: as if the bunker were also a trench).
      apply: (v, { unit, from, toLoc }, env) => (isEntrenched(pieceOf(env, unit)) && !(toLoc && bunkerMove(env, from, true, toLoc, false)) ? v + entrenchmentMf(env, from, pieceOf(env, unit).side) : v),
    });
    r.contribute({
      id: 'asl.ent.routExempt',
      query: 'rout.exemptOpenGround',
      ref: 'ASLRB A10.5, A10.531',
      when: ({ unit }, env) => isEntrenched(pieceOf(env, unit)),
      apply: () => true,
    });
    r.procedure<RoutEnteredFn>(ROUT_ENTERED, (next) => (ctx, units, loc, beneath) => {
      next?.(ctx, units, loc, beneath);
      if (!beneath) return;
      // Routing beneath the entrenchment nullifies any Interdiction there (B27.41): a protective benefit claimed, so a
      // hidden counter is revealed (A12.33).
      const c = entrenchmentAt(ctx, hexOfLoc(loc));
      if (c) revealFortification(ctx, c.id, 'rout');
      placeBeneath(ctx, units, hexOfLoc(loc), true);
      ctx.emit('asl.entrench.move', { units, hex: hexOfLoc(loc), beneath: true, mf: entrenchmentMf(ctx, hexOfLoc(loc), pieceOf(ctx, units[0]!).side), phase: 'RtPh' });
    });
    const beneathTrench = (p: Piece) => p.loc.kind === 'hex' && (p.loc.pos?.ent === 'trench' || p.loc.pos?.ent === 'ditch');
    r.contribute({
      id: 'asl.ent.rallyTrench',
      query: 'rally.drm',
      ref: 'ASLRB A10.61',
      label: '-1 trench',
      // One -1 for "building, pillbox, trench or woods" (A10.61): none more for a trench in a woods or building hex.
      when: ({ unit }, env) => {
        const p = pieceOf(env, unit);
        return beneathTrench(p) && !(p.loc.kind === 'hex' && terrainOf(env, p.loc.hex).rallyCover);
      },
      apply: (v) => v - 1,
    });
    r.contribute({
      id: 'asl.ent.dmKeep',
      query: 'rally.dmKeepIllegal',
      ref: 'ASLRB A10.62',
      apply: (v, { unit }, env) => v ?? (beneathTrench(pieceOf(env, unit)) ? 'Beneath a trench: its DM comes off at the end of the RPh (ASLRB A10.62)' : null),
    });

    // ---------------------------------------------------------------- A4.7, B27.44: advancing beneath, and within the hex
    r.contribute({
      id: 'asl.ent.advanceVariants',
      query: 'advance.variants',
      ref: 'ASLRB A4.7, B27.44',
      apply(v, { side, units, to }, env) {
        if (!isGroundLoc(to) || !units.length) return v;
        const toHex = hexOfLoc(to);
        if (!entrenchmentKnownTo(env, toHex, side)) return v;
        const ps = units.map((u) => pieceOf(env, u));
        const own = ps.every((p) => locOf(env.state, p) === to);
        const out = [...v];
        if (own) {
          // Within the hex the shared list has not vetted the stack: Good Order, unpinned, not advanced, not TI (A4.7, A4.8).
          if (ps.some((p) => !isGoodOrder(env, p) || isPinned(p) || p.tags['advanced'] || env.query('unit.cannotAdvance', { unit: p.id }, null))) return v;
          const beneath = !ps.every(isEntrenched);
          if (!env.query('advance.illegal', { units, to, side, beneath }, null)) out.push({ type: 'advance', units, to, beneath });
        } else if (!env.query('advance.illegal', { units, to, side, beneath: true }, null)) out.push({ type: 'advance', units, to, beneath: true });
        return out;
      },
    });
    r.contribute({
      id: 'asl.ent.advanceIllegal',
      query: 'advance.illegal',
      ref: 'ASLRB A4.7, B27.44',
      apply(v, { units, to, side, beneath }, env) {
        if (v || beneath === undefined || !units.length) return v;
        if (!isGroundLoc(to)) return 'A foxhole is at ground level (ASLRB B27.1)';
        const toHex = hexOfLoc(to);
        const ps = units.map((u) => pieceOf(env, u));
        const own = ps.every((p) => locOf(env.state, p) === to);
        if (own && ps.every((p) => isEntrenched(p) === beneath)) return beneath ? 'Already beneath it' : 'Not beneath it';
        if (!beneath) return own ? null : 'An advance into a hex arrives on top of its entrenchment unless beneath is chosen';
        return beneathIllegal(env, toHex, side, ps);
      },
    });
    r.procedure<AdvanceEnterFn>(AP.enter, (next) => (ctx, a: AdvanceAction) => {
      next?.(ctx, a);
      if (a.beneath === undefined || !isGroundLoc(a.to)) return;
      const hex = hexOfLoc(a.to);
      const there = a.units.filter((u) => ctx.state.pieces[u]?.loc.kind === 'hex' && (ctx.state.pieces[u]!.loc as { hex: HexId }).hex === hex);
      if (!there.length) return;
      placeBeneath(ctx, there, hex, a.beneath);
      ctx.emit('asl.entrench.move', { units: there, hex, beneath: a.beneath, mf: 0, phase: 'APh' });
    });

    // ---------------------------------------------------------------- B24.121: falling rubble removes the entrenchment it lands on
    r.on<{ hex: HexId; falls: boolean; to?: HexId }>({
      id: 'asl.ent.rubble',
      event: 'asl.rubble.falling',
      handler(ctx, ev) {
        if (!ev.payload.falls || !ev.payload.to) return;
        const c = entrenchmentAt(ctx, ev.payload.to);
        if (!c) return;
        placeBeneath(ctx, personnelAt(ctx, ev.payload.to).map((p) => p.id), ev.payload.to, false);
        for (const w of unpossessedWeaponsAt(ctx, ev.payload.to)) if (isEntrenched(w)) placeBeneath(ctx, [w.id], ev.payload.to, false);
        removeFortification(ctx, c.id, 'falling rubble (ASLRB B24.121)');
      },
    });
    void isTi;
    void swHeldBy;
    void gun;
    void locationAt;
  },
};

/** The stack's current position for the UI: beneath its hex's entrenchment or not, and what it would cost to change. */
export function stackEntrenchment(env: QueryEnv, ms: Pick<MoveState, 'hex' | 'ent'> | undefined): { counter: FortRecord; beneath: boolean; mf: number } | null {
  if (!ms?.hex) return null;
  const c = entrenchmentKnownTo(env, ms.hex, env.state.attacker);
  return c ? { counter: c, beneath: !!ms.ent, mf: entrenchmentMf(env, ms.hex, env.state.attacker) } : null;
}
