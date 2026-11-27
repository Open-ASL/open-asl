import type { Ctx, HexId, Piece, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { defOf, isVehicleDef, otherSide, personnelAt, statics, vehiclesAt } from '../common/pieces';
import { adjacentFor, hexOfLoc, isGroundLoc, locOf, parseLoc, type AdjacentPurpose, type LocId } from '../common/location';
import { cornerBetween, mod6, sideToward } from '../common/hexCorners';
import { gunHeldBy, isBroken, isGoodOrder, mmc, pieceOf, smc } from '../sk1/status';
import { storedControl as controlStateOf, type ControlState } from '../sk1/scenario';
import { FP, buildAttack, directorsOf, type ApplyResultFn, type AttackResolvedFn, type FireAttackCtx, type FireDeclaration, type FireMode, type ResolveFireFn } from '../sk1/fire';
import { eliminate } from '../sk1/morale';
import type { ShotCtx } from '../sk2/ordnance';
import { gun } from '../sk1/status';
import type { IftResult } from '../common/statics';
import { sw } from '../sk1/status';
import { T2, ordnanceOf } from '../sk2/status';
import { revealUnit } from '../sk2/hip';
import { hasLos, knownEnemyAt } from '../sk1/known';
import { smokeIn, terrainOf } from '../sk1/terrain';
import { levelOf } from '../sk2/elevation';
import { MOVE_ENTER, moveState, type MoveEnterFn, type MoveState } from '../sk1/movement';
import { inCoveredArc } from '../sk2/arc';
import { counterTerrainIllegal, entrenchmentAt, fortCounters as fortCountersOf, fortArea, fortificationView, fortificationsParams, isPillboxLoc, pillboxAt, pillboxCaHexsides, pillboxGray, pillboxLoc, removeFortification, revealFortification, seenByEnemy, shownCounter, type FortRecord } from './fortifications';
import { onWire, ownHiddenWire, wireKnownTo } from './wire';

/*
 * Pillboxes in play (ASLRB B30; full ASL only: neither Starter Kit has pillboxes or bunkers). The counter's record, its
 * setup and its Location (`<hex>:pb`, B30.1) are `asl/fortifications.ts`; this module is what the pillbox does once play
 * begins.
 *
 * - The Location (B30.1, B30.111, B30.12): a separate non-vertical-level Location of its hex, its terrain the `pillbox`
 *   Location (`PILLBOX_TERRAIN`): one MF in or out (B30.4), never Open Ground, a building for rout and rally (B30.5),
 *   Concealment Terrain (B30.7). Its capacity in squad-equivalents (A5.5) plus four SMC is its stacking limit (B30.111),
 *   per side and apart from the hex's own (A5.6, B30.111: never overstacked); no vehicle and no Gun enters or leaves it
 *   in play (B30.111, B30.45).
 * - ADJACENT (B30.2, B30.6): the pillbox and the same-level Location outside it in its hex are ADJACENT (built in
 *   `asl/fortifications.ts`); units in an adjacent ground-level Location within its Covered Arc are ADJACENT to the units
 *   inside, and they to them, but only "for purposes of Point Blank Fire, FPF, DM, rout, and for DC Placement vs the
 *   pillbox" (`pillboxAdjacentFor`, the `'loc.adjacentFor'` query).
 */

/** The spine of `sk2/arc.ts` (between its neighbour directions k and k+1) of a fortification's hexspine `ca` (corner `ca`, 0 east, clockwise). */
export const arcSpine = (ca: number) => mod6(ca + 1);

/** The inverse of `arcSpine`: the hexspine (corner, 0 east, clockwise) of a fortification whose Covered Arc is the `sk2/arc.ts` spine `spine` (B30.1, C3.2). */
export const caOfSpine = (spine: number) => mod6(spine - 1);

/**
 * Whether `hex` lies in the Covered Arc of the pillbox `pb` (B30.1, C3.2): the wedge between the two hexrows running out
 * through its CA hexsides, its own hex excluded ("Except for its two CA hexsides, the pillbox hex itself is not in the
 * pillbox CA").
 */
export function inPillboxCa(env: QueryEnv, pb: Pick<FortRecord, 'hex' | 'ca'>, hex: HexId): boolean {
  if (pb.ca === undefined || hex === pb.hex) return false;
  const map = statics(env).map;
  const a = map.hex(pb.hex);
  const b = map.hex(hex);
  return !!a && !!b && inCoveredArc(a.cube, arcSpine(pb.ca), b.cube);
}

/** The pillbox whose Location `loc` is, or null. */
export const pillboxOf = (env: QueryEnv, loc: LocId | null | undefined): FortRecord | null => (loc && isPillboxLoc(loc) ? pillboxAt(env, hexOfLoc(loc)) : null);

/** Whether a unit is inside a pillbox. */
export const inPillbox = (env: QueryEnv, p: Piece): boolean => !!pillboxOf(env, locOf(env.state, p));

/**
 * B30.2: a pillbox Location and an adjacent ground-level Location within its CA are ADJACENT for PBF, FPF, DM, rout and
 * DC Placement against the pillbox. Either order.
 */
export function pillboxAdjacentFor(env: QueryEnv, a: LocId, b: LocId, purpose: AdjacentPurpose): boolean {
  const [inside, outside] = isPillboxLoc(a) ? [a, b] : isPillboxLoc(b) ? [b, a] : [null, null];
  if (!inside || !outside) return false;
  // DC Placement only against the pillbox, from outside it (B30.31: "A DC cannot be Placed from inside to outside"), from
  // any adjacent hex: B30.31 gives the NCA DM to one "Placed/Thrown from any other adjacent hex" (and the Q&A [K33] to
  // A23 and B30.31 allows it).
  if (purpose === 'dc' && inside !== b) return false;
  const pb = pillboxOf(env, inside);
  if (!pb || !isGroundLoc(outside) || parseLoc(outside).level) return false;
  const map = statics(env).map;
  return map.distance(pb.hex, outside) === 1 && (purpose === 'dc' || inPillboxCa(env, pb, outside));
}

/** Why `units` may not go into the pillbox in `hex` as a matter of what they are (B30.111, B30.45), or null. */
export function pillboxUnitIllegal(env: QueryEnv, units: PieceId[], manhandle = false): string | null {
  if (units.some((u) => isVehicleDef(defOf(env, pieceOf(env, u))))) return 'No vehicle may occupy a pillbox (ASLRB B30.111)';
  if (manhandle || units.some((u) => gunHeldBy(env, u))) return 'No Gun may enter or leave a pillbox during play (ASLRB B30.45)';
  return null;
}

/** The pillbox of `hex` as `side` knows it: its own, or one revealed to it (A12.33), else null. */
export function pillboxKnownToSide(env: QueryEnv, hex: HexId, side: SideId | null): FortRecord | null {
  const pb = pillboxAt(env, hex);
  return pb && shownCounter(pb, side) ? pb : null;
}

/** Whether the pillbox is still hidden from the other side (A12.33). */
export const pillboxHidden = (pb: FortRecord): boolean => pb.hidden && !pb.revealed;

/**
 * Enemy ground units of `side` in the hex of `pb` outside it that bar movement into or out of it (B30.42, B30.6): Infantry
 * and vehicles [EXC: Disrupted, subterranean, Unarmed, an unarmored vehicle with no PRC: no such units exist yet], the
 * ones `side` knows of.
 */
export const enemyOutside = (env: QueryEnv, hex: HexId, side: SideId): Piece[] => knownEnemyAt(env, hex, side);

/** Enemy Infantry of `side` inside the pillbox of `hex` (B30.44). */
export const enemyInside = (env: QueryEnv, hex: HexId, side: SideId): Piece[] => personnelAt(env, pillboxLoc(hex), otherSide(env.state, side));

/** The MF to go into or out of the pillbox for `side`: one (B30.4), none while it is the side's own and still hidden (A12.33). */
export function pillboxMf(env: QueryEnv, pb: FortRecord, side: SideId): number {
  return pb.side === side && pillboxHidden(pb) ? 0 : 1;
}

/**
 * Why `units` of `side` may not go from the ground of the pillbox's hex into it now (B30.111, B30.42, B30.44, B30.45, B26.4),
 * or null. Only what `side` knows decides: a pillbox it has not been shown is no Location for it.
 */
export function pillboxEntryIllegal(env: QueryEnv, hex: HexId, side: SideId, units: Piece[], opts: { manhandle?: boolean; ignoreWire?: boolean } = {}): string | null {
  const pb = pillboxKnownToSide(env, hex, side);
  if (!pb) return 'That Location is not ADJACENT (ASLRB A.8)';
  const kind = pillboxUnitIllegal(env, units.map((u) => u.id), !!opts.manhandle);
  if (kind) return kind;
  // B30.44: never into a pillbox holding enemy Infantry (its occupancy is shown with the counter, B30.7).
  if (enemyInside(env, hex, side).length) return 'Enemy Infantry hold the pillbox: no unit may enter it (ASLRB B30.44)';
  // B30.42: nor while an enemy ground unit is in the hex outside it.
  if (enemyOutside(env, hex, side).length) return 'An enemy unit is in the hex outside the pillbox: no unit may enter it (ASLRB B30.42)';
  // B26.4: a unit on top of Wire may not enter a pillbox in that hex (Q&A [K33-ML] to B26.4); beneath it, it may.
  if (!opts.ignoreWire && units.some((u) => onWire(u))) return 'On top of the Wire: get beneath it before entering the pillbox (ASLRB B26.4)';
  return null;
}

/** Why units of `side` may not leave the pillbox of `hex` by moving or routing now (B30.6), or null. */
export function pillboxExitIllegal(env: QueryEnv, hex: HexId, side: SideId): string | null {
  if (enemyOutside(env, hex, side).length) return 'An enemy unit is in the hex outside the pillbox: a unit inside may only advance out (ASLRB B30.6)';
  return null;
}

/** The three vertices of a pillbox's own hex in its CA: the ends of its two CA hexsides (B30.2 "vertices of its CA"). */
export const pillboxCaVertices = (pb: Pick<FortRecord, 'ca'>): number[] => (pb.ca === undefined ? [] : [mod6(pb.ca - 1), mod6(pb.ca), mod6(pb.ca + 1)]);

/** The Location each firer of a declaration fires from (a SW's: its possessor's). */
function firingLocs(env: QueryEnv, decl: Pick<FireDeclaration, 'units' | 'sw'>): LocId[] {
  const out: LocId[] = [];
  for (const id of [...decl.units, ...decl.sw]) {
    const p = env.state.pieces[id];
    const l = p ? locOf(env.state, p) : null;
    if (l) out.push(l);
  }
  return out;
}

/**
 * B30.2: whether units inside the pillbox `pb` may fire at the ground of their own hex: only by PBF at units "currently
 * crossing the CA hexsides of its own hex" (the moving stack whose latest expenditure entered the hex across one of them),
 * or at a stack in Bypass at a vertex of its CA, traced to that vertex. (CC, SMOKE grenades and a Thrown DC are not fire on
 * the IFT here; a Thrown DC is not in the game yet.)
 */
export function pillboxOwnHexFire(env: QueryEnv, pb: FortRecord, decl: Pick<FireDeclaration, 'target' | 'at'>, mode: FireMode): boolean {
  if (decl.target !== pb.hex) return false;
  const ms = moveState(env);
  if (!ms || ms.hex !== pb.hex || ms.sub || ms.level) return false;
  if (mode !== 'first' && mode !== 'subsequentFirst' && mode !== 'fpf') return false;
  const map = statics(env).map;
  if (ms.bypass?.hex === pb.hex) {
    const at = decl.at?.[pb.hex];
    const corner = at ? cornerBetween(map, pb.hex, at[0], at[1]) : null;
    return corner !== null && corner === ms.bypass.at && pillboxCaVertices(pb).includes(corner);
  }
  if (!ms.from || pb.ca === undefined) return false;
  const last = ms.trail?.[ms.trail.length - 1];
  if (!last || last.hex !== ms.hex || last.mp !== ms.mfHere) return false;
  const side = sideToward(map, pb.hex, ms.from);
  return side !== null && pillboxCaHexsides(pb.ca).includes(side);
}

/**
 * Why units inside a pillbox may not make this IFT attack (B30.2, A7.5), or null: never with units outside it in one Fire
 * Group; LOS only within its CA; into its own hex only as `pillboxOwnHexFire` allows.
 */
export function pillboxFireIllegal(env: QueryEnv, decl: FireDeclaration, mode: FireMode): string | null {
  const locs = [...new Set([...firingLocs(env, decl), ...directorsOf(decl).map((d) => (env.state.pieces[d] ? locOf(env.state, env.state.pieces[d]!) : null)).filter((l): l is LocId => !!l)])];
  const inside = locs.filter((l) => isPillboxLoc(l));
  if (!inside.length) return null;
  if (inside.length !== locs.length || new Set(inside).size > 1) return 'Units inside a pillbox may not form a Fire Group with units outside it (ASLRB A7.5, B30.6)';
  const pb = pillboxOf(env, inside[0]!);
  if (!pb) return null;
  const tHex = hexOfLoc(decl.target);
  if (decl.target === inside[0]) return null;
  if (tHex !== pb.hex) return inPillboxCa(env, pb, tHex) ? null : "Outside the pillbox's Covered Arc: LOS from inside it is traced only within its CA (ASLRB B30.2)";
  return pillboxOwnHexFire(env, pb, decl, mode) ? null : 'From inside a pillbox fire into its own hex is limited to PBF at units crossing its CA hexsides or at its CA vertices (ASLRB B30.2, B30.44)';
}

// ---------------------------------------------------------------- the CA and NCA Defense Modifications (B30.112, B30.113)

/** Whether every firing hex of an attack is in the pillbox's CA (B30.112: "originate from a hex within the CA"). */
export const firedThroughCa = (env: QueryEnv, pb: FortRecord, attack: Pick<FireAttackCtx, 'parts'>): boolean =>
  attack.parts.length > 0 && attack.parts.every((p) => inPillboxCa(env, pb, p.hex));

const isFtPart = (env: QueryEnv, attack: Pick<FireAttackCtx, 'parts'>) => attack.parts.some((p) => p.kind === 'sw' && sw(env, pieceOf(env, p.piece))?.type === 'FT');

/** An AP-type round (B30.35: AP, APCR, APDS). */
const apType = (ammo: string | undefined) => ammo === 'AP' || ammo === 'APCR' || ammo === 'APDS';

/**
 * The Defense Modification an ordnance attack from `fromHex` meets (B30.112: non-Aerial Direct Fire from a hex in the CA,
 * the CA DM; B30.113: ordnance not from the CA, and Indirect Fire, the NCA DM), and whether it applies at all: an
 * AP/APCR/APDS round whose Basic TK# is more than twice that DM ignores it and every other TEM (B30.35).
 */
export function pillboxOrdnanceDm(env: QueryEnv, pb: FortRecord, o: { fromHex: HexId; indirect?: boolean; ammo?: string; weapon?: PieceId; range?: number }): { dm: number; through: 'ca' | 'nca'; apIgnores: boolean } {
  const f = pb.pillbox ?? { capacity: 1, ca: 3, nca: 5 };
  const through = !o.indirect && inPillboxCa(env, pb, o.fromHex) ? 'ca' : 'nca';
  const dm = through === 'ca' ? f.ca : f.nca;
  let apIgnores = false;
  if (apType(o.ammo) && o.weapon) {
    const w = env.state.pieces[o.weapon];
    const def = w ? ordnanceOf(env, w) : null;
    const tk = def ? statics(env).tables.toKill(def, o.ammo as 'AP' | 'APCR' | 'APDS', o.range ?? 1) : null;
    apIgnores = tk !== null && tk > 2 * dm;
  }
  return { dm, through, apIgnores };
}

/**
 * The pillbox TEM an ordnance hit's IFT attack on a pillbox Location takes (C3.33, B30.112, B30.113, C3.71): on the Infantry
 * Target Type the TEM went on the To Hit DR, so none, but a Critical Hit through the CA reverses the CA DM that applied
 * (zero if B30.35 removed it) and one through the NCA reverses zero ("the NCA TEM is considered to be zero for CH
 * resolution"); on the Area Target Type the DM by where the shot came from (an Indirect Fire hit: the NCA DM), and a
 * Critical Hit reverses it the same way.
 */
function pillboxOrdnanceIftDm(env: QueryEnv, pb: FortRecord, attack: FireAttackCtx): { dm: number; label: string } | null {
  const o = attack.ordnance!;
  const part = attack.parts[0];
  if (!part) return null;
  const d = pillboxOrdnanceDm(env, pb, { fromHex: part.hex, ...(o.indirect ? { indirect: true } : {}), ...(o.ammo ? { ammo: o.ammo } : {}), weapon: part.piece, range: part.dist });
  if (o.ch) {
    if (d.through === 'nca' || d.apIgnores) return null;
    return { dm: -d.dm, label: `-${d.dm} Critical Hit: pillbox CA Defense Modification reversed` };
  }
  if (o.targetType === 'ITT' || d.apIgnores) return null;
  return { dm: d.dm, label: `+${d.dm} pillbox ${d.through === 'ca' ? 'CA' : 'NCA'} Defense Modification` };
}

/**
 * The pillbox TEM an IFT attack (not ordnance: its TEM goes on the To Hit DR, C3.33) on a pillbox Location takes, or null
 * when none applies or the attack is NA (B30.112, B30.113, A22.2): Small Arms, MG and IFE through the CA take the CA DM
 * (through the NCA they are NA); a FT through the CA takes no TEM at all (A22.2), through the NCA the NCA DM.
 */
export function pillboxIftDm(env: QueryEnv, attack: FireAttackCtx): { dm: number; label: string } | null {
  const pb = pillboxOf(env, attack.target);
  if (!pb?.pillbox || attack.mine) return null;
  if (attack.ordnance) return pillboxOrdnanceIftDm(env, pb, attack);
  const ca = firedThroughCa(env, pb, attack);
  if (isFtPart(env, attack)) return ca ? null : { dm: pb.pillbox.nca, label: `+${pb.pillbox.nca} pillbox NCA Defense Modification (FT not from its Covered Arc)` };
  return ca ? { dm: pb.pillbox.ca, label: `+${pb.pillbox.ca} pillbox CA Defense Modification (fired from its Covered Arc)` } : null;
}

/** Whether an IFT attack on a pillbox Location is NA through its NCA (B30.113: "Canister, MG, IFE and Small Arms fire vs a pillbox ... are NA through its NCA"). */
export const naThroughNca = (env: QueryEnv, attack: FireAttackCtx): boolean => {
  const pb = pillboxOf(env, attack.target);
  return !!pb && !attack.ordnance && !attack.mine && !isFtPart(env, attack) && !firedThroughCa(env, pb, attack);
};

/**
 * Whether `side` cannot rule out a hidden enemy pillbox in `hex` (the Q&A to A7 and B30: "an IFT attack may be made at a
 * suspected, unknown pillbox Location"): the other side has pillboxes it has not shown, the hex is one it could set one up
 * in, and no Good Order unit of `side` has a LOS to it that would have revealed one (A12.33). Only what `side` may know.
 */
export function possiblePillbox(env: QueryEnv, side: SideId, hex: HexId): boolean {
  const enemy = otherSide(env.state, side);
  const own = fortificationsParams(env, enemy)?.pillboxes?.length ?? 0;
  const shown = fortificationView(env, side).filter((c) => c.kind === 'pillbox' && c.side === enemy);
  if (own - shown.length <= 0 || shown.some((c) => c.hex === hex)) return false;
  if (!fortArea(env, enemy).includes(hex)) return false;
  const probe: FortRecord = { id: `${enemy}.probe`, side: enemy, kind: 'pillbox', hex, hidden: true, ca: 0, pillbox: { capacity: 1, ca: 3, nca: 5 } };
  if (counterTerrainIllegal(env, probe)) return false;
  return !seenByEnemy(env, probe);
}

/**
 * Eliminate a pillbox and everything in it (B30.92: "When a pillbox is eliminated, all of its contents are also
 * eliminated"): its units (with the weapons they hold) and the weapons lying inside, then the counter.
 */
export function eliminatePillbox(ctx: Ctx, pb: FortRecord, reason: string) {
  const loc = pillboxLoc(pb.hex);
  const inside = Object.values(ctx.state.pieces).filter((p) => p.loc.kind === 'hex' && locOf(ctx.state, p) === loc).sort((a, b) => (a.id < b.id ? -1 : 1));
  ctx.emit('asl.pb.eliminated', { hex: pb.hex, reason, units: inside.map((p) => p.id) });
  for (const p of inside) {
    const held = Object.values(ctx.state.pieces).filter((w) => w.loc.kind === 'held' && w.loc.by === p.id).sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const w of held) ctx.emit('piece.eliminated', { id: w.id, reason: `in the pillbox (${reason})` });
    if (ctx.state.pieces[p.id]?.loc.kind !== 'hex') continue;
    if (isVehicleDef(defOf(ctx, p)) || gun(ctx, p) || !(personnelAt(ctx, loc).some((u) => u.id === p.id))) ctx.emit('piece.eliminated', { id: p.id, reason: `in the pillbox (${reason})` });
    else eliminate(ctx, p.id, `in the pillbox (${reason})`);
  }
  removeFortification(ctx, pb.id, reason);
}

/** The tag a DC Placed against a pillbox keeps: the Location its placer stood in (B30.31). */
export const PB_DC_FROM = 'pbDcFrom';

/** The DM of a Placed DC's attack on a pillbox Location (B30.31): by the placer's hex, the CA DM from a CA hex or the pillbox hex, else the NCA DM. */
export function dcDm(env: QueryEnv, target: LocId, dc?: PieceId): { dm: number; through: 'ca' | 'nca' } | null {
  const pb = pillboxOf(env, target);
  const p = dc ? env.state.pieces[dc] : undefined;
  if (!pb?.pillbox || !p) return null;
  const from = p.tags[PB_DC_FROM] as LocId | undefined;
  const fromHex = from ? hexOfLoc(from) : null;
  const ca = fromHex === pb.hex || (!!fromHex && inPillboxCa(env, pb, fromHex));
  return ca ? { dm: pb.pillbox.ca, through: 'ca' } : { dm: pb.pillbox.nca, through: 'nca' };
}

// ---------------------------------------------------------------- inspection and Known (B30.7)

/**
 * Whether `side` may know the units in pillbox `pb` (B30.7): its own; else only once an attack has been made (or SMOKE
 * placed) from within it (`known`, for the rest of the game), and then for the units of `side` within 16 hexes that have a
 * LOS to it, inside its CA or not. Read per side: Known to the side when any of its units is so placed.
 */
export function contentsKnownTo(env: QueryEnv, pb: FortRecord, side: SideId | null): boolean {
  if (side === pb.side) return true;
  if (!pb.known) return false;
  const viewer = side ?? otherSide(env.state, pb.side);
  const map = statics(env).map;
  const loc = pillboxLoc(pb.hex);
  return Object.values(env.state.pieces).some((p) => p.side === viewer && p.loc.kind === 'hex' && map.distance(p.loc.hex, pb.hex) <= 16 && hasLos(env, locOf(env.state, p)!, loc));
}

/** The pillbox `p` is inside (it, its weapons, a weapon lying in it), or null. */
const pillboxHolding = (env: QueryEnv, p: Piece): FortRecord | null => pillboxOf(env, locOf(env.state, p));

/** Mark a pillbox's contents Known (B30.7: an attack or SMOKE placement from within), showing a hidden one too. */
export function pillboxContentsRevealed(ctx: Ctx, pb: FortRecord, reason: 'attack' | 'smoke') {
  if (pb.known) return;
  ctx.emit('asl.fort.revealed', { counter: { ...pb, known: true, ...(pb.hidden ? { revealed: true } : {}) }, reason: reason === 'smoke' ? 'smoke' : 'attack' });
}

/**
 * The units of `side` inside the pillbox of `hex` that take part in the CC of its hex (B30.6): Infantry inside, while an
 * enemy Infantry unit is outside it in the hex and no friendly ground unit of `side` is [EXC: Disrupted, subterranean,
 * Unarmed, unarmored vehicle with no PRC: none in the game yet].
 */
export function pillboxCcUnits(env: QueryEnv, hex: LocId, side: SideId): PieceId[] {
  if (!isGroundLoc(hex)) return [];
  const pb = pillboxAt(env, hex);
  if (!pb) return [];
  const inside = personnelAt(env, pillboxLoc(hex), side);
  if (!inside.length) return [];
  const enemy = otherSide(env.state, side);
  if (personnelAt(env, hex, enemy).length === 0) return [];
  if (personnelAt(env, hex, side).length > 0 || vehiclesAt(env, hex, side, true).length > 0) return [];
  return inside.map((p) => p.id).sort();
}

// ---------------------------------------------------------------- bunkers (B30.8)

/** A trench or an A-T Ditch (B27.56: "treated the same as a trench"). */
const trenchIn = (env: QueryEnv, hex: HexId) => {
  const c = entrenchmentAt(env, hex);
  return !!c && (c.kind === 'trench' || c.kind === 'ditch');
};

/**
 * The trench hexes a pillbox in `pbHex` is a bunker for (B30.8: "in the same hex with a trench and/or in a hex Accessible
 * to a Trench counter's hex"): its own hex and the adjacent hexes holding a trench (no cliff or Water Obstacle on boards
 * t–z makes an adjacent hex inaccessible). Empty for a plain pillbox.
 */
export function bunkerTrenches(env: QueryEnv, pbHex: HexId): HexId[] {
  if (!pillboxAt(env, pbHex)) return [];
  return [pbHex, ...statics(env).map.neighbors(pbHex)].filter((h) => !!statics(env).map.hex(h) && trenchIn(env, h)).sort();
}

/**
 * A move between a bunker and one of its trenches "as if the bunker were also a trench" (B30.8): `in`, from beneath the
 * trench into the bunker; `out`, from the bunker to beneath the trench. Null for any other move. `from` is the mover's
 * Location (with `entrenched`: beneath its entrenchment), `to` the Location entered (with `beneath`).
 */
export function bunkerMove(env: QueryEnv, from: LocId, entrenched: boolean, to: LocId, beneath: boolean): 'in' | 'out' | null {
  if (isPillboxLoc(to) && entrenched && isGroundLoc(from) && trenchIn(env, from) && bunkerTrenches(env, hexOfLoc(to)).includes(from)) return 'in';
  if (isPillboxLoc(from) && beneath && isGroundLoc(to) && bunkerTrenches(env, hexOfLoc(from)).includes(to)) return 'out';
  return null;
}

/** The MF of a bunker move (B30.8, B27.54, Q&A [K33] to B30.8): within the hex the pillbox's one MF, no trench MF; to or from the next hex one MF, two uphill. */
export function bunkerMoveCost(env: QueryEnv, from: LocId, to: LocId, side: SideId): number {
  const a = hexOfLoc(from);
  const b = hexOfLoc(to);
  if (a === b) {
    const pb = pillboxAt(env, a);
    return pb ? pillboxMf(env, pb, side) : 1;
  }
  return levelOf(env, b) > levelOf(env, a) ? 2 : 1;
}

/** The squad-equivalents a pillbox holds (B30.111). */
export const pillboxCapacity = (pb: FortRecord): number => pb.pillbox?.capacity ?? 1;

export const aslPillboxesModule: RuleModule = {
  id: 'asl.pillboxes',
  ref: 'ASLRB B30',
  summary: 'Pillboxes in play: the Location and its capacity, entry and exit, fire out through the Covered Arc and in by the CA or NCA Defense Modification, rout, rally, Close Combat, Control, concealment and elimination.',
  requires: ['asl.fortifications', 'sk1.movement', 'sk1.fire', 'sk1.rout', 'sk1.rally', 'sk1.advance'],
  install(r) {
    // ---------------------------------------------------------------- B30.1, B30.111: the Location
    // The Location inside the counter is the `pillbox` terrain: one MF, no Open Ground, a building for rout and rally,
    // Concealment Terrain; the hex keeps its own terrain outside it.
    r.contribute({
      id: 'asl.pb.terrain',
      query: 'hex.terrain',
      ref: 'ASLRB B30.1, B30.5, B30.7',
      layer: 20,
      apply: (v, { loc }, env) => (loc && isPillboxLoc(loc) && pillboxAt(env, hexOfLoc(loc)) ? 'pillbox' : v),
    });
    // Its capacity is the stacking limit of the Location, per side (A5.6), separate from the hex's (B30.111); four SMC
    // count as nothing (A5.5; the Q&A to A5.5 fills a 1-squad pillbox with a squad and four SMC).
    r.contribute({
      id: 'asl.pb.capacity',
      query: 'stack.limit',
      ref: 'ASLRB B30.111, A5.5, A5.6',
      layer: 900,
      apply(v, { hex }, env) {
        const pb = pillboxOf(env, hex);
        if (!pb) return v;
        const se = pillboxCapacity(pb);
        return { se, smc: 4, note: `the pillbox holds ${se} squad${se === 1 ? '' : 's'}, ASLRB B30.111`, capacity: true };
      },
    });
    // No vehicle (B30.111) and no Gun (B30.45: "No 5/8" counter may enter or leave a pillbox during play") moves in or out.
    r.contribute({
      id: 'asl.pb.stepUnits',
      query: 'move.stepIllegal',
      ref: 'ASLRB B30.111, B30.45',
      layer: 0,
      apply(v, { ms, to }, env) {
        if (v || !ms.hex) return v;
        const into = isPillboxLoc(to) && !!pillboxOf(env, to);
        const outOf = !!ms.sub && ms.sub === 'pb' && hexOfLoc(to) === ms.hex;
        if (!into && !outOf) return null;
        return pillboxUnitIllegal(env, ms.units, !!ms.manhandle);
      },
    });
    // A Gun inside may not be pushed out of it (B30.45).
    r.contribute({
      id: 'asl.pb.cannotStart',
      query: 'move.cannotStart',
      ref: 'ASLRB B30.45',
      apply(v, { units, manhandle }, env) {
        if (v || !manhandle) return v;
        const holder = units.map((u) => env.state.pieces[u]).find((p) => p && inPillbox(env, p));
        return holder ? 'No Gun may enter or leave a pillbox during play (ASLRB B30.45)' : null;
      },
    });

    // ---------------------------------------------------------------- B30.4, B30.33, B30.42, B30.44, B30.6: in and out
    // One MF in, one MF out (the hex itself: no other MF combines with it, B30.33), none while the side's own pillbox is
    // still hidden (A12.33). Out into a hex with SMOKE at ground level: the SMOKE's MF to enter that Location (B30.4 EX).
    const pbStep = (ms: MoveState, to: LocId): 'in' | 'out' | null => {
      if (!ms.hex || ms.vehicle || hexOfLoc(to) !== ms.hex) return null;
      if (isPillboxLoc(to) && ms.sub !== 'pb') return 'in';
      if (ms.sub === 'pb' && isGroundLoc(to)) return 'out';
      return null;
    };
    r.contribute({
      id: 'asl.pb.stepCost',
      query: 'move.stepCost',
      ref: 'ASLRB B30.4, B30.8, A12.33, A24.7',
      layer: 20,
      apply(v, { ms, to, beneath }, env) {
        if (ms.vehicle || !ms.hex) return v;
        // A bunker move (B30.8): the pillbox's MF within the hex, one (two uphill) to or from the next hex; no trench MF.
        const bm = bunkerMove(env, ms.sub === 'pb' ? pillboxLoc(ms.hex) : ms.hex, !!ms.ent, to, !!beneath);
        if (bm) return bunkerMoveCost(env, ms.sub === 'pb' ? pillboxLoc(ms.hex) : ms.hex, to, env.state.attacker);
        const way = pbStep(ms, to);
        const pb = way ? pillboxAt(env, ms.hex) : null;
        if (!way || !pb) return v;
        return pillboxMf(env, pb, env.state.attacker) + (way === 'out' && smokeIn(env, ms.hex) ? 1 : 0);
      },
    });
    r.contribute({
      id: 'asl.pb.stepIllegal',
      query: 'move.stepIllegal',
      ref: 'ASLRB B30.42, B30.44, B30.6, B26.4',
      apply(v, { ms, to }, env) {
        if (v) return v;
        const way = pbStep(ms, to);
        if (!way) return null;
        const side = env.state.attacker;
        if (way === 'in') return pillboxEntryIllegal(env, ms.hex!, side, ms.units.map((u) => pieceOf(env, u)), { manhandle: !!ms.manhandle });
        return pillboxExitIllegal(env, ms.hex!, side);
      },
    });
    // The APh (B30.42, B30.44, B30.6): into the pillbox of the advancing units' own hex as their one Location, refused as
    // in the MPh; out of it only into its own hex ("it can only advance out of the pillbox and must halt in the pillbox
    // hex", the only Location ADJACENT to it), allowed even with an enemy there.
    r.contribute({
      id: 'asl.pb.advance',
      query: 'advance.illegal',
      ref: 'ASLRB B30.42, B30.44, B30.6',
      apply(v, { units, to, side }, env) {
        if (v || !isPillboxLoc(to) || !units.length) return v;
        const ps = units.map((u) => pieceOf(env, u));
        if (ps.every((p) => locOf(env.state, p) === to)) return null;
        return pillboxEntryIllegal(env, hexOfLoc(to), side, ps);
      },
    });

    // The step into or out of the side's own hidden pillbox spends no MF (A12.33): no expenditure, no Defensive First Fire
    // (A8.1) and nothing for the other side to see (the unit stays on the hex's ground in its view, `asl.fort.pieceRedact`).
    r.contribute({
      id: 'asl.pb.quietStep',
      query: 'move.firstFireAvailable',
      ref: 'ASLRB A12.33, A8.1',
      layer: 900,
      apply(v, { hex }, env) {
        const ms = moveState(env);
        if (!v || !ms || ms.mfHere !== 0 || !ms.hex || hexOfLoc(hex) !== ms.hex) return v;
        const pb = pillboxAt(env, ms.hex);
        return pb && pillboxHidden(pb) && pb.side === env.state.attacker && (ms.sub === 'pb' || ms.from === ms.hex) ? false : v;
      },
    });
    // The moving stack's Location inside a pillbox the viewer has not been shown: the hex's ground (A12.33), in the moving
    // state and in a First Fire decision about it.
    r.redact({
      id: 'asl.pb.moveRedact',
      redactDecision(d, viewer, env) {
        const hex = d.data?.['hex'];
        if (typeof hex !== 'string' || !isPillboxLoc(hex) || pillboxKnownToSide(env, hexOfLoc(hex), viewer)) return d;
        return { ...d, data: { ...d.data, hex: hexOfLoc(hex) } };
      },
      ext: 'sk1.move',
      redactExt(slice, viewer, env) {
        const ms = slice as MoveState | undefined;
        if (ms?.sub !== 'pb' || !ms.hex || pillboxKnownToSide(env, ms.hex, viewer)) return slice;
        const { sub: _sub, ...rest } = ms;
        void _sub;
        return rest;
      },
    });

    // ---------------------------------------------------------------- B30.2, A7.5: fire from inside
    // LOS from inside only within the CA, and to the same-level Location outside it in its hex (ADJACENT, B30.6). A LOS
    // traced from elsewhere to the pillbox is not limited (it is no obstacle, B30.2): ordnance and FT may fire at it
    // through the NCA (B30.113).
    r.contribute({
      id: 'asl.pb.los',
      query: 'los.trace',
      ref: 'ASLRB B30.2',
      layer: 950,
      apply(v, { from, to }, env) {
        const pb = pillboxOf(env, from);
        if (!pb || !v.clear) return v;
        const toHex = hexOfLoc(to);
        if (toHex === pb.hex || inPillboxCa(env, pb, toHex)) return v;
        return { ...v, clear: false, hindrance: 0, parts: [], blockedBy: "outside the pillbox's Covered Arc (ASLRB B30.2)" };
      },
    });
    r.contribute({
      id: 'asl.pb.fire',
      query: 'fire.illegal',
      ref: 'ASLRB B30.2, A7.5, B30.44',
      apply: (v, { decl, mode }, env) => v ?? pillboxFireIllegal(env, decl, mode),
    });
    // Ordnance from inside: within the CA, never at its own hex outside (no PBF), and no mortar fire (B30.2).
    r.contribute({
      id: 'asl.pb.ordnance',
      query: 'ordnance.illegal',
      ref: 'ASLRB B30.2',
      apply(v, { shot }, env) {
        if (v) return v;
        const w = env.state.pieces[shot.weapon];
        const pb = w ? pillboxOf(env, locOf(env.state, w)) : null;
        if (!w || !pb) return null;
        if (ordnanceOf(env, w)?.type === 'MTR') return 'Mortar fire is NA from inside a pillbox (ASLRB B30.2)';
        const tHex = hexOfLoc(shot.target);
        if (tHex === pb.hex) return 'From inside a pillbox fire into its own hex is limited to PBF at units crossing its CA hexsides or at its CA vertices (ASLRB B30.2)';
        return inPillboxCa(env, pb, tHex) ? null : "Outside the pillbox's Covered Arc: LOS from inside it is traced only within its CA (ASLRB B30.2)";
      },
    });
    // SMOKE grenades from inside: only into its own hex, the ADJACENT Location outside (two MF; B30.2, B30.34, A24.1).
    r.contribute({
      id: 'asl.pb.smokeAdjacent',
      query: 'move.smokeAdjacent',
      ref: 'ASLRB A24.1, B30.34',
      apply: (v, { ms }) => v || ms.sub === 'pb',
    });
    r.contribute({
      id: 'asl.pb.smokeIllegal',
      query: 'move.smokeIllegal',
      ref: 'ASLRB B30.2, B30.34',
      apply: (v, { ms, target }) => v ?? (ms.sub === 'pb' && target !== ms.hex ? 'From inside a pillbox SMOKE grenades go only into its own hex outside it (ASLRB B30.2, B30.34)' : null),
    });
    // C13.8, C13.81: a BAZ, PSK or PF fired from inside a pillbox only with the Desperation penalty.
    r.contribute({
      id: 'asl.pb.backblast',
      query: 'ordnance.backblastAt',
      ref: 'ASLRB C13.8, C13.81',
      apply: (v, { loc }, env) => (pillboxOf(env, loc) ? 'desperation' : v),
    });

    // ---------------------------------------------------------------- B30.112, B30.113, B30.3, B30.34, B30.7, A8.22: fire at it
    // The counter's DM is the TEM, by where the attack comes from; not cumulative with any other TEM (B30.3), so the hex's
    // own (woods), Height Advantage, a wall and an Emplacement do not add to it (C11.2 and its EX); cumulative with
    // Hindrances and SMOKE (on the hex's ground, hindering a LOS into the pillbox, A24.4). Secret while the pillbox is
    // hidden from the firer: told of only when it changes a result (and then claimed, A12.33).
    r.contribute({
      id: 'asl.pb.dm',
      query: 'fire.drm',
      ref: 'ASLRB B30.112, B30.113, B30.3, A22.2',
      label: ({ attack }, env) => pillboxIftDm(env, attack)?.label ?? 'pillbox',
      secret: ({ attack }, env) => !pillboxKnownToSide(env, hexOfLoc(attack.target), attack.side),
      when: ({ attack }, env) => !!pillboxIftDm(env, attack),
      apply: (v, { attack }, env) => v + pillboxIftDm(env, attack)!.dm,
    });
    const atPillbox = (attack: Pick<FireAttackCtx, 'target'>) => isPillboxLoc(attack.target);
    for (const target of ['sk1.drm.tem', 'sk1.drm.woods-road']) r.suppress<'fire.drm'>({ id: `asl.pb.no.${target}`, query: 'fire.drm', target, ref: 'ASLRB B30.3', label: 'pillbox TEM only', when: ({ attack }) => atPillbox(attack) });
    for (const target of ['sk2.drm.height-advantage', 'sk2.drm.emplacement', 'asl.roadblock.tem']) r.suppress<'fire.unitDrm'>({ id: `asl.pb.no.${target}`, query: 'fire.unitDrm', target, ref: 'ASLRB B30.3, C11.2', label: 'pillbox TEM only', when: ({ attack }) => atPillbox(attack) });
    // B30.113: Small Arms, MG and IFE are NA through the NCA: refused against a pillbox the firer knows (its CA is on the
    // counter); against one it has not been shown the attack is made and simply cannot affect it.
    r.contribute({
      id: 'asl.pb.nca',
      query: 'fire.illegal',
      ref: 'ASLRB B30.113',
      apply(v, { decl, mode, side, moving }, env) {
        if (v || !isPillboxLoc(decl.target)) return v;
        const pb = pillboxKnownToSide(env, hexOfLoc(decl.target), side);
        if (!pb) return null;
        const attack = buildAttack(env, decl, mode, side, moving);
        return naThroughNca(env, attack) ? 'Small Arms, MG and IFE fire is NA through the NCA of a pillbox: fire from its Covered Arc (ASLRB B30.113)' : null;
      },
    });
    // No Residual FP in the pillbox, nor in the hex outside from an attack on the pillbox (A8.22).
    r.contribute({
      id: 'asl.pb.noResidual',
      query: 'fire.leavesResidual',
      ref: 'ASLRB A8.22',
      apply: (v, { attack }) => v && !atPillbox(attack),
    });
    // B30.7: "?"/HIP in a pillbox neither halves the FP of an attack on it nor adds a To Hit DRM.
    r.contribute({
      id: 'asl.pb.noAreaFire',
      query: 'hip.areaFire',
      ref: 'ASLRB B30.7',
      apply: (v, { unit }, env) => v && !inPillbox(env, pieceOf(env, unit)),
    });
    // A pillbox the firer has not been shown (Q&A to A7 and B30): an IFT attack may be made at a "possible pillbox" in any
    // hex it cannot rule out. The attack is made against nothing it can see, so it reads alike whether a pillbox is there
    // or not; then, against a real one through its CA, a result of PTC or better (or one its DM turned to no effect: the
    // TEM claimed, A12.33) reveals it and the result applies to its contents.
    r.contribute({
      id: 'asl.pb.unseenTarget',
      query: 'fire.unseenTarget',
      ref: 'ASLRB B30.7, A12.33',
      apply: (v, { target, side }, env) => v || (isPillboxLoc(target) && !pillboxAt(env, hexOfLoc(target)) && possiblePillbox(env, side, hexOfLoc(target))),
    });
    r.contribute({
      id: 'asl.pb.unseenContents',
      query: 'fire.targetsSeen',
      ref: 'ASLRB B30.7',
      apply: (v, { attack }, env) => (atPillbox(attack) && !attack.moving && pillboxAt(env, hexOfLoc(attack.target)) && !pillboxKnownToSide(env, hexOfLoc(attack.target), attack.side) ? [] : v),
    });
    // A unit the firer sees on the ground of a hex may be inside a pillbox it has not been shown (A12.33: entering its own
    // hidden pillbox costs it nothing and shows nothing): fire at it is fire at the pillbox, whose TEM it claims, revealing
    // it (A12.33, Q&A [Kiri Naiman] to A12.33). Against the pillbox it is then judged as any attack there (B30.113).
    r.contribute({
      id: 'asl.pb.targetAs',
      query: 'fire.targetAs',
      ref: 'ASLRB A12.33, B30.7',
      apply(v, { target, side }, env) {
        if (v !== target || !isGroundLoc(target)) return v;
        const pb = pillboxAt(env, target);
        if (!pb || pillboxKnownToSide(env, pb.hex, side)) return v;
        const seen = personnelAt(env, pillboxLoc(pb.hex), otherSide(env.state, side)).some((p) => env.query('piece.visibleTo', { piece: p.id, viewer: side }, true));
        return seen ? pillboxLoc(pb.hex) : v;
      },
    });
    r.procedure<ResolveFireFn>(FP.resolve, (next) => (ctx, decl0, mode, opts) => {
      const side0 = ctx.state.pieces[decl0.units[0] ?? decl0.sw[0]!]?.side;
      let decl = decl0;
      if (side0) {
        const as = ctx.query('fire.targetAs', { target: decl0.target, side: side0 }, decl0.target);
        const pbAs = isPillboxLoc(as) ? pillboxAt(ctx, hexOfLoc(as)) : null;
        const claimed = pbAs && !pillboxKnownToSide(ctx, pbAs.hex, side0) && personnelAt(ctx, as, otherSide(ctx.state, side0)).some((p) => ctx.query('piece.visibleTo', { piece: p.id, viewer: side0 }, true));
        if (pbAs && claimed) {
          revealFortification(ctx, pbAs.id, 'tem');
          const retarget = { ...decl0, target: as };
          if (!ctx.query('fire.illegal', { decl: retarget, mode, side: side0, ...(opts?.moving ? { moving: opts.moving } : {}) }, null)) decl = retarget;
        }
      }
      const out = next!(ctx, decl, mode, opts);
      if (!isPillboxLoc(decl.target) || opts?.moving) return out;
      const pb = pillboxAt(ctx, hexOfLoc(decl.target));
      const side = ctx.state.pieces[decl.units[0] ?? decl.sw[0]!]?.side;
      if (!pb || !side || out.column === null || pillboxKnownToSide(ctx, pb.hex, side)) return out;
      unseenPillboxResults(ctx, pb, decl, mode, out.column, out.dr[0] + out.dr[1]);
      return out;
    });

    // ---------------------------------------------------------------- B30.32, B30.34, B30.35, B30.92, C3.71, C6.2, C6.7, C8.31: ordnance
    r.event<{ hex: HexId; reason: string; units: PieceId[] }>({ type: 'asl.pb.eliminated', apply() {} });
    // A pillbox the viewer was never shown goes without telling it (A12.33), as its counter's removal does.
    r.redact({
      id: 'asl.pb.eliminatedRedact',
      events: ['asl.pb.eliminated'],
      redactEvent: (ev, viewer, env) => (pillboxKnownToSide(env, (ev.payload as { hex: HexId }).hex, viewer) ? ev : null),
    });
    // The To Hit DR on the Infantry Target Type takes the pillbox's DM by where the shot comes from (B30.112, B30.113), or
    // none for an AP round that beats twice it (B30.35); no Target Size (Case P, B30.32), no concealment or HIP DRM (Case
    // K, B30.7), no other TEM (B30.3: the hex's, an Emplacement, Height Advantage, a wall).
    const shotDm = (env: QueryEnv, sc: ShotCtx) => {
      const pb = pillboxOf(env, sc.target);
      return pb && sc.shot.targetType === 'ITT' ? pillboxOrdnanceDm(env, pb, { fromHex: sc.hex, ammo: sc.ammo, weapon: sc.weapon, range: sc.range }) : null;
    };
    r.contribute({
      id: 'asl.pb.th',
      query: 'ordnance.thDrm',
      ref: 'ASLRB B30.112, B30.113, B30.35',
      label: (sc, env) => {
        const d = shotDm(env, sc)!;
        return `+${d.dm} pillbox ${d.through === 'ca' ? 'CA' : 'NCA'} Defense Modification`;
      },
      when: (sc, env) => {
        const d = shotDm(env, sc);
        return !!d && !d.apIgnores;
      },
      apply: (v, sc, env) => v + shotDm(env, sc)!.dm,
    });
    for (const target of ['sk2.th.tem', 'sk2.th.emplacement', 'sk2.th.heightAdvantage', 'sk2.th.targetSize', 'sk2.th.hip-target', 'sk4.th.concealed-target', 'asl.roadblock.th', 'asl.ent.th'])
      r.suppress<'ordnance.thDrm'>({ id: `asl.pb.no.${target}`, query: 'ordnance.thDrm', target, ref: 'ASLRB B30.3, B30.32, B30.7', label: 'pillbox TEM only', when: (sc) => isPillboxLoc(sc.target) });
    for (const target of ['sk2.drm.ch-reversed-tem', 'sk2.drm.air-burst', 'sk2.ordnance.suppress.airBurst-tem'])
      r.suppress<'fire.drm'>({ id: `asl.pb.no.${target}`, query: 'fire.drm', target, ref: 'ASLRB B30.3, C3.71, B13.3', label: 'pillbox TEM only', when: ({ attack }) => atPillbox(attack) });
    // B30.32: only the Infantry or Area Target Type vs a pillbox; a shot at one the firer has not been shown is a shot at
    // no Location it knows (the possible-pillbox attack is IFT fire only, Q&A to A7 and B30).
    r.contribute({
      id: 'asl.pb.ordnanceTarget',
      query: 'ordnance.illegal',
      ref: 'ASLRB B30.32',
      apply(v, { shot, side }, env) {
        if (v || !isPillboxLoc(shot.target)) return v;
        if (!pillboxKnownToSide(env, hexOfLoc(shot.target), side)) return 'Unknown target hex';
        if (shot.targetType === 'VTT') return 'Ordnance fires at a pillbox on the Infantry or Area Target Type (ASLRB B30.32)';
        return null;
      },
    });
    // B30.34 EXC: an Area Target Type (and an Indirect Fire) hit on the pillbox hex reaches the pillbox too, unless the
    // shot was predesignated at the pillbox itself, which reaches no other Location of its hex.
    const withPillbox = (v: LocId[], target: LocId, env: QueryEnv): LocId[] => {
      if (isPillboxLoc(target) || parseLoc(target).level) return v;
      const pb = pillboxAt(env, hexOfLoc(target));
      return pb && !v.includes(pillboxLoc(pb.hex)) ? [...v, pillboxLoc(pb.hex)] : v;
    };
    r.contribute({ id: 'asl.pb.att', query: 'fire.areaLocations', ref: 'ASLRB B30.34', apply: (v, { target }, env) => withPillbox(v, target, env) });
    r.contribute({ id: 'asl.pb.indirect', query: 'fire.indirectLocations', ref: 'ASLRB B30.34', layer: 200, apply: (v, { target }, env) => withPillbox(v, target, env) });
    // C8.31: HEAT may fire at Infantry receiving pillbox TEM.
    r.contribute({ id: 'asl.pb.heat', query: 'ordnance.heatTarget', ref: 'ASLRB C8.31', apply: (v, { target }, env) => v || !!pillboxOf(env, target) });
    r.contribute({ id: 'asl.pb.pf', query: 'pf.infantryCover', ref: 'ASLRB C8.31', apply: (v, { target }, env) => v || !!pillboxOf(env, target) });
    // A hidden pillbox whose DM a hit's IFT DR had to be told of (it changed a result) has had its TEM claimed (A12.33).
    r.on<{ attack: { target: LocId }; explain?: { id: string }[] }>({
      id: 'asl.pb.temReveal',
      event: 'sk1.fire.attack',
      handler(ctx, ev) {
        if (!ev.payload.explain?.some((n) => n.id === 'asl.pb.dm')) return;
        const pb = pillboxOf(ctx, ev.payload.attack.target);
        if (pb && pillboxHidden(pb)) revealFortification(ctx, pb.id, 'tem');
      },
    });
    // B30.92: a non-Area-Target-Type ordnance hit whose Original IFT DR is a KIA with a number ≥ the pillbox TEM that applied
    // to its To Hit DR eliminates the pillbox and its contents; so does an Indirect Fire Critical Hit by a Gun of ≥ 70mm
    // (≥ 100mm vs a gray pillbox). The hit is noted as it is announced and judged once its attack has resolved.
    const hits: { target: LocId; weapon: PieceId; targetType: string; ammo: string; ch: boolean; column: number; dr: [number, number] }[] = [];
    r.on<{ weapon: PieceId; target: LocId; targetType: string; ammo: string; ch: boolean; column: number; dr: [number, number] }>({
      id: 'asl.pb.hitNoted',
      event: 'sk2.ordnance.hit',
      handler(_ctx, ev) {
        if (isPillboxLoc(ev.payload.target)) hits.push(ev.payload);
      },
    });
    r.procedure<AttackResolvedFn>(FP.attackResolved, (next) => (ctx, info) => {
      next?.(ctx, info);
      if (!isPillboxLoc(info.target)) return;
      const i = hits.findIndex((h) => h.target === info.target);
      const hit = i >= 0 ? hits.splice(i, 1)[0]! : null;
      const pb = pillboxOf(ctx, info.target);
      if (!hit || !pb?.pillbox || !info.from) return;
      const w = ctx.state.pieces[hit.weapon];
      const def = w ? ordnanceOf(ctx, w) : null;
      const indirect = def?.type === 'MTR';
      if (indirect) {
        if (hit.ch && (def?.caliber ?? 0) >= (pillboxGray(pb.pillbox) ? 100 : 70)) eliminatePillbox(ctx, pb, `an Indirect Fire Critical Hit of ${def!.caliber}mm (ASLRB B30.92)`);
        return;
      }
      if (hit.targetType !== 'ITT') return;
      const d = pillboxOrdnanceDm(ctx, pb, { fromHex: info.from, ammo: hit.ammo, weapon: hit.weapon, range: statics(ctx).map.distance(info.from, pb.hex) });
      const tem = d.apIgnores ? 0 : d.dm;
      const original = statics(ctx).tables.ift(hit.column, hit.dr[0] + hit.dr[1]);
      if (original.kind === 'KIA' && (original.n ?? 1) >= tem) eliminatePillbox(ctx, pb, `an ordnance Original ${original.n ?? 1}KIA vs its ${tem} TEM (ASLRB B30.92)`);
    });

    // ---------------------------------------------------------------- B30.31, B30.92, A23.3: DC Placement
    // Placed against a pillbox the placer knows, from its hex or any adjacent one, never from inside to outside (B30.31).
    r.contribute({
      id: 'asl.pb.dcPlace',
      query: 'dc.placeIllegal',
      ref: 'ASLRB B30.31',
      apply(v, { placer, target }, env) {
        if (v) return v;
        const p = pieceOf(env, placer);
        const from = locOf(env.state, p);
        if (from && isPillboxLoc(from) && hexOfLoc(target) === hexOfLoc(from)) return 'A DC cannot be Placed from inside a pillbox to outside it (ASLRB B30.31)';
        if (isPillboxLoc(target) && !pillboxKnownToSide(env, hexOfLoc(target), p.side)) return 'DC target must be adjacent';
        return null;
      },
    });
    // Into the pillbox from the next hex: a DC Placed there costs the MF of entering the pillbox hex, not the pillbox's own
    // (Q&A [K33] to A23.3 and B30.4); a rout (the combined entry of B30.41, A10.531) costs both. From the pillbox hex
    // itself, the pillbox's own MF (B30.4; none while it is its side's own and hidden, A12.33); out of it into its hex, the
    // same.
    r.contribute({
      id: 'asl.pb.cost',
      query: 'move.cost',
      ref: 'ASLRB A23.3, B30.4, B30.41, A12.33',
      layer: 800,
      when: ({ loc, from, to }, env) => (!!loc && isPillboxLoc(loc) && !!from) || (!loc && from === to && !!pillboxAt(env, to)),
      apply(v, { unit, from, to, loc }, env) {
        const pb = pillboxAt(env, to);
        const p = env.state.pieces[unit];
        if (!pb || !p) return v;
        const own = pillboxMf(env, pb, p.side);
        if (!loc) return inPillbox(env, p) ? own : v;
        if (from === to) return own;
        // From beneath a connecting trench into the bunker (B30.8).
        if (from && p.loc.kind === 'hex' && p.loc.pos?.ent && bunkerMove(env, from, true, loc, false)) return bunkerMoveCost(env, from, loc, p.side);
        const hex = env.query('move.cost', { unit, from, to, viaRoad: false }, 1);
        return env.state.phase === 'RtPh' ? hex + own : hex;
      },
    });
    // The DM is fixed by where the placer stands (B30.31): an adjacent hex in the CA, or the pillbox hex itself, the CA DM;
    // any other adjacent hex the NCA DM. Noted on the DC as it is placed.
    r.on<{ id: PieceId; tags: Record<string, unknown> }>({
      id: 'asl.pb.dcFrom',
      event: 'piece.tagged',
      handler(ctx, ev) {
        if (ev.payload.tags['dcPlaced'] !== true) return;
        const dc = ctx.state.pieces[ev.payload.id];
        const placer = dc ? ctx.state.pieces[dc.tags['dcPlacer'] as PieceId] : undefined;
        if (!dc || !placer || dc.loc.kind !== 'hex' || !pillboxOf(ctx, locOf(ctx.state, dc))) return;
        ctx.emit('piece.tagged', { id: dc.id, tags: { [PB_DC_FROM]: locOf(ctx.state, placer) } });
      },
    });
    r.contribute({
      id: 'asl.pb.dcDm',
      query: 'dc.drm',
      ref: 'ASLRB B30.31',
      label: ({ target, dc }, env) => {
        const d = dcDm(env, target, dc);
        return `+${d?.dm ?? 0} pillbox ${d?.through === 'ca' ? 'CA' : 'NCA'} Defense Modification (where the DC was Placed from)`;
      },
      when: ({ target, dc }, env) => !!dcDm(env, target, dc),
      apply: (v, { target, dc }, env) => v + dcDm(env, target, dc)!.dm,
    });
    // B30.92: a Placed DC whose Original IFT DR is a KIA, its number raised by two, at least the DM that applied, eliminates
    // the pillbox and its contents (EX 1: an Original 1KIA is a 3KIA for this).
    const dcAttacks: { target: LocId; dc: PieceId; column: number; dr: [number, number] }[] = [];
    r.on<{ attack: { target: LocId; parts: PieceId[] }; column: number | null; dr: [number, number] }>({
      id: 'asl.pb.dcNoted',
      event: 'sk1.fire.attack',
      handler(ctx, ev) {
        const id = ev.payload.attack.parts[0];
        const w = id ? ctx.state.pieces[id] : undefined;
        if (!w || !isPillboxLoc(ev.payload.attack.target) || sw(ctx, w)?.type !== 'DC' || ev.payload.column === null) return;
        dcAttacks.push({ target: ev.payload.attack.target, dc: w.id, column: ev.payload.column, dr: ev.payload.dr });
      },
    });
    r.procedure<AttackResolvedFn>(FP.attackResolved, (next) => (ctx, info) => {
      const i = info.by === 'dc' ? dcAttacks.findIndex((a) => a.target === info.target) : -1;
      const a = i >= 0 ? dcAttacks.splice(i, 1)[0]! : null;
      next?.(ctx, info);
      const pb = pillboxOf(ctx, info.target);
      if (!a || !pb || info.malfunctioned) return;
      const d = dcDm(ctx, info.target, a.dc);
      const original = statics(ctx).tables.ift(a.column, a.dr[0] + a.dr[1]);
      if (original.kind !== 'KIA') return;
      const n = (original.n ?? 1) + 2;
      if (n >= (d?.dm ?? 0)) eliminatePillbox(ctx, pb, `a Placed DC's Original ${original.n ?? 1}KIA (${n}KIA vs the pillbox) vs its ${d?.dm ?? 0} TEM (ASLRB B30.92)`);
    });

    // ---------------------------------------------------------------- B30.7: inspection and Known
    // The other side may not inspect a pillbox's contents: units inside a pillbox it has been shown are not drawn for it
    // (the counter shows "occupied") until an attack or SMOKE placement from within makes them Known to its units within
    // 16 hexes with a LOS to it. In a pillbox still hidden from it a unit that walked in stays drawn on the hex's ground
    // (A12.33, `asl.fort.pieceRedact`); one that set up there is hidden in its own right (HIP).
    r.contribute({
      id: 'asl.pb.inspect',
      query: 'piece.visibleTo',
      ref: 'ASLRB B30.7',
      layer: 50,
      apply(v, { piece, viewer }, env) {
        const p = env.state.pieces[piece];
        if (!v || !p || viewer === p.side) return v;
        const pb = pillboxHolding(env, p);
        if (!pb || !pillboxKnownToSide(env, pb.hex, viewer)) return v;
        return contentsKnownTo(env, pb, viewer);
      },
    });
    r.contribute({
      id: 'asl.pb.occupied',
      query: 'pillbox.occupiedUnseen',
      ref: 'ASLRB B30.7',
      apply(v, { hex, viewer }, env) {
        const pb = pillboxAt(env, hex);
        if (v || !pb || viewer === pb.side || contentsKnownTo(env, pb, viewer)) return v;
        return personnelAt(env, pillboxLoc(hex)).length > 0;
      },
    });
    // An occupied pillbox the firer has been shown is a target for ordnance on the Infantry Target Type though its contents
    // may not be inspected (B30.7: the counter shows it occupied).
    r.contribute({
      id: 'asl.pb.ittTarget',
      query: 'ordnance.noUnitTarget',
      ref: 'ASLRB B30.7',
      apply: (v, { shot, side }, env) => (v && isPillboxLoc(shot.target) && pillboxKnownToSide(env, hexOfLoc(shot.target), side) && personnelAt(env, shot.target, otherSide(env.state, side)).length > 0 ? null : v),
    });
    // An attack (or no-LOS attack) made from within, by a unit, a weapon it holds or a Gun there; SMOKE placed from within.
    const fromWithin = (ctx: Ctx, ids: PieceId[]) => {
      for (const id of [...ids].sort()) {
        const p = ctx.state.pieces[id];
        const pb = p ? pillboxHolding(ctx, p) : null;
        if (pb) pillboxContentsRevealed(ctx, pb, 'attack');
      }
    };
    for (const event of ['sk1.fire.attack', 'sk1.fire.noLos'])
      r.on<{ attack: { parts: PieceId[] } }>({ id: `asl.pb.known.${event}`, event, handler: (ctx, ev) => fromWithin(ctx, ev.payload.attack.parts) });
    for (const event of ['sk2.ordnance.shot', 'sk2.ordnance.noLos'])
      r.on<{ weapon: PieceId }>({ id: `asl.pb.known.${event}`, event, handler: (ctx, ev) => fromWithin(ctx, [ev.payload.weapon]) });
    r.on<{ hex: HexId; key: string; value: unknown }>({
      id: 'asl.pb.known.smoke',
      event: 'hex.marker',
      handler(ctx, ev) {
        const ms = moveState(ctx);
        if (ev.payload.key !== 'smoke' || !ms || ms.sub !== 'pb' || ms.hex !== ev.payload.hex) return;
        const pb = pillboxAt(ctx, ms.hex);
        if (pb) pillboxContentsRevealed(ctx, pb, 'smoke');
      },
    });

    // ---------------------------------------------------------------- B30.5, B30.41, A10.5, A10.531, A10.61, A10.62: rout and rally
    // A pillbox is a building for rout (B30.5): its Location is a rout shelter (`PILLBOX_TERRAIN`); Known enemy units in it
    // (B30.7) are beside only the units ADJACENT to it through its CA or in its hex (B30.2, B30.6).
    r.contribute({ id: 'asl.pb.enemyNode', query: 'rout.enemyNode', ref: 'ASLRB B30.5, B30.2', apply: (v, { loc }) => (isPillboxLoc(loc) ? loc : v) });
    r.contribute({
      id: 'asl.pb.enemyNear',
      query: 'rout.enemyNear',
      ref: 'ASLRB B30.2, B30.6',
      apply: (v, { a, b }, env) => (isPillboxLoc(a) || isPillboxLoc(b) ? a === b || adjacentFor(env, a, b, 'rout') : v),
    });
    // "a broken unit inside a pillbox is never forced to rout" (B30.5); it may end its RtPh in one ADJACENT to a Known armed
    // enemy (Q&A [K33-ML] to A10.5 and B30.5: B30.5 takes precedence).
    r.contribute({ id: 'asl.pb.notForced', query: 'rout.notForced', ref: 'ASLRB B30.5', apply: (v, { unit }, env) => v || inPillbox(env, pieceOf(env, unit)) });
    r.contribute({ id: 'asl.pb.mayEndBeside', query: 'rout.mayEndBeside', ref: 'ASLRB B30.5, A10.5', apply: (v, { node }, env) => v || !!pillboxOf(env, node) });
    // The combined entry and exit of the RtPh (B30.33 EXC, B30.41, A10.531): straight into the pillbox of the next hex, or
    // out of the pillbox into the next hex, as one expenditure; Interdiction is judged where it ends (not in a pillbox).
    r.contribute({
      id: 'asl.pb.routNeighbours',
      query: 'rout.extraNeighbours',
      ref: 'ASLRB B30.41, A10.531',
      apply(v, { node }, env) {
        const map = statics(env).map;
        if (isPillboxLoc(node)) return pillboxOf(env, node) ? [...v, ...map.neighbors(hexOfLoc(node))] : v;
        if (!isGroundLoc(node)) return v;
        const near = map.neighbors(node).filter((h) => !!pillboxAt(env, h)).map((h) => pillboxLoc(h));
        return near.length ? [...v, ...near] : v;
      },
    });
    r.contribute({
      id: 'asl.pb.routExit',
      query: 'rout.exitCost',
      ref: 'ASLRB B30.4, B30.41',
      apply(v, { unit, from, to }, env) {
        const pb = pillboxOf(env, from);
        return pb && hexOfLoc(to) !== pb.hex ? v + pillboxMf(env, pb, pieceOf(env, unit).side) : v;
      },
    });
    // A10.531: the MF into a Fortification do not count toward the nearest building; a pillbox the unit cannot pay to enter
    // is no reachable building Location (Q&A [K33] to A10.51 and B30.5), which the MF it does spend decide.
    r.contribute({
      id: 'asl.pb.nearest',
      query: 'rout.nearestCost',
      ref: 'ASLRB A10.531',
      apply(v, { unit, node }, env) {
        const pb = pillboxOf(env, node);
        return pb ? v - pillboxMf(env, pb, pieceOf(env, unit).side) : v;
      },
    });
    // Into the pillbox: not while an enemy ground unit is outside it in the hex, never into enemy Infantry (B30.42, B30.44);
    // out of it: not while an enemy ground unit is in the hex (B30.6).
    r.contribute({
      id: 'asl.pb.routStep',
      query: 'rout.stepIllegal',
      ref: 'ASLRB B30.42, B30.44, B30.6',
      apply(v, { unit, from, to }, env) {
        if (v) return v;
        const p = pieceOf(env, unit);
        if (isPillboxLoc(to) && from !== to) {
          const hex = hexOfLoc(to);
          // From the next hex the unit would arrive on top of any Wire there first, and could go no further (B26.4).
          const combined = hexOfLoc(from) !== hex;
          if (combined && wireKnownTo(env, hex, p.side) && !ownHiddenWire(wireKnownTo(env, hex, p.side)!, p.side)) return 'It would arrive on top of the Wire, which bars the pillbox (ASLRB B26.4)';
          return pillboxEntryIllegal(env, hex, p.side, [p], { ignoreWire: combined });
        }
        if (isPillboxLoc(from) && !isPillboxLoc(to)) return pillboxExitIllegal(env, hexOfLoc(from), p.side);
        return null;
      },
    });
    // Rally: -1 in a pillbox (A10.61: one -1 for "building, pillbox, trench or woods", none more in woods), and no keeping DM
    // there (A10.62).
    r.contribute({
      id: 'asl.pb.rally',
      query: 'rally.drm',
      ref: 'ASLRB A10.61, B30.5',
      label: '-1 pillbox',
      when: ({ unit }, env) => {
        const p = pieceOf(env, unit);
        return inPillbox(env, p) && !terrainOf(env, hexOfLoc(locOf(env.state, p)!)).rallyCover;
      },
      apply: (v) => v - 1,
    });
    r.contribute({
      id: 'asl.pb.dmKeep',
      query: 'rally.dmKeepIllegal',
      ref: 'ASLRB A10.62',
      apply: (v, { unit }, env) => v ?? (inPillbox(env, pieceOf(env, unit)) ? 'In a pillbox: its DM comes off at the end of the RPh (ASLRB A10.62)' : null),
    });

    // ---------------------------------------------------------------- B30.6, A11.1, A11.15, A11.19: CC across the pillbox
    // In every CCPh in which opposing Infantry are inside a pillbox and outside it in its hex, CC is resolved between them
    // in the normal manner (A11.1 EXC: "between units in the same hex"), but with no Melee: the units outside are not held,
    // the units inside stay (B30.6). Not while a friendly ground unit of the side inside is outside it (B30.6: they "cannot
    // be attacked (nor attack)"), and never with a vehicle (B30.6: "CC is NA between a vehicle(s)/PRC and a unit(s) in a
    // pillbox").
    r.contribute({
      id: 'asl.pb.ccUnits',
      query: 'cc.units',
      ref: 'ASLRB B30.6, A11.1',
      apply: (v, { hex, side }, env) => {
        const inside = pillboxCcUnits(env, hex, side);
        return inside.length ? [...v, ...inside.filter((id) => !v.includes(id))] : v;
      },
    });
    r.contribute({
      id: 'asl.pb.ccAcross',
      query: 'cc.across',
      ref: 'ASLRB B30.6',
      apply: (v, { hex, unit }, env) => v || pillboxCcUnits(env, hex, pieceOf(env, unit).side).includes(unit),
    });
    r.contribute({
      id: 'asl.pb.ccVehicle',
      query: 'cc.attackIllegal',
      ref: 'ASLRB B30.6',
      apply(v, { attack }, env) {
        if (v) return v;
        const ps = [...attack.attackers, ...attack.targets].map((id) => pieceOf(env, id));
        return ps.some((p) => inPillbox(env, p)) && ps.some((p) => isVehicleDef(defOf(env, p))) ? 'CC is NA between a vehicle and a unit in a pillbox (ASLRB B30.6)' : null;
      },
    });
    // As the CCPh begins, CC that can occur across a pillbox brings its contents into the open: a hidden unit inside is
    // placed on the board (Q&A [K33] to A11.19 and B30.6) and the units inside are Known to the units they fight (B30.7: the
    // announced attack is verified).
    r.on<{ phase: string }>({
      id: 'asl.pb.ccStart',
      event: 'turn.phaseStarted',
      handler(ctx, ev) {
        if (ev.payload.phase !== 'CCPh') return;
        for (const pb of fortCountersOf(ctx).filter((c) => c.kind === 'pillbox')) {
          const inside = pillboxCcUnits(ctx, pb.hex, pb.side);
          if (!inside.length) continue;
          for (const id of inside) if (ctx.state.pieces[id]?.tags[T2.hip] === true) revealUnit(ctx, id, 'cc');
          const now = pillboxAt(ctx, pb.hex);
          if (now) pillboxContentsRevealed(ctx, now, 'attack');
        }
      },
    });

    // ---------------------------------------------------------------- B30.91, A26.11, A26.132: Control
    // A pillbox Location is Controlled by actually entering it (B30.91: the per-Location Control of A26.11, kept with the
    // upper building levels); its side Controls it from the start (A26.11: a side Controls the Locations of its setup
    // area). The hex: a player must also Control its pillbox (A26.132, B30.91); a Good Order MMC inside occupies the hex at
    // ground level, so one alone in the hex holds both (A26.13).
    r.contribute({
      id: 'asl.pb.control',
      query: 'control.adjust',
      ref: 'ASLRB B30.91, A26.11, A26.13, A26.132',
      apply(v, { prev }, env) {
        const pbs = fortCountersOf(env).filter((c) => c.kind === 'pillbox');
        const stale = Object.keys(v.locations ?? {}).filter((l) => isPillboxLoc(l) && !pillboxAt(env, hexOfLoc(l)));
        if (!pbs.length && !stale.length) return v;
        const locations = { ...(v.locations ?? {}) };
        for (const l of stale) delete locations[l];
        let hexes = v.hexes;
        for (const pb of pbs) {
          const loc = pillboxLoc(pb.hex);
          if (locations[loc] === undefined) locations[loc] = pb.side;
          const here = Object.values(env.state.pieces).filter((p) => p.loc.kind === 'hex' && p.loc.hex === pb.hex && (!!mmc(env, p) || !!smc(env, p)));
          const sides = new Set(here.map((p) => p.side));
          const good = here.filter((p) => !!mmc(env, p) && isGoodOrder(env, p) && !isBroken(p));
          if (sides.size !== 1 || !good.length) continue;
          const side = good[0]!.side;
          const want = locations[loc] === side ? side : prev.hexes[pb.hex];
          if (hexes[pb.hex] === want) continue;
          hexes = { ...hexes };
          if (want === undefined) delete hexes[pb.hex];
          else hexes[pb.hex] = want;
        }
        return { ...v, hexes, ...(Object.keys(locations).length ? { locations } : {}) };
      },
    });
    // A pillbox gone (B30.92, B24.121) takes its Location's Control with it, in the same step as the counter, so no view
    // ever holds the Control of a Location that is not there.
    r.replace<{ id: string; hex: HexId; kind: string }>({
      id: 'asl.pb.controlGone',
      event: 'asl.fort.removed',
      when: (env, ev) => ev.payload.kind === 'pillbox' && controlStateOf(env).locations?.[pillboxLoc(ev.payload.hex)] !== undefined,
      replace(env, ev) {
        const st = controlStateOf(env);
        const locations = Object.fromEntries(Object.entries(st.locations ?? {}).filter(([l]) => l !== pillboxLoc(ev.payload.hex)));
        const { locations: _l, ...rest } = st;
        void _l;
        return [{ type: 'sk1.control', payload: { state: Object.keys(locations).length ? { ...rest, locations } : rest } }, ev];
      },
    });
    // The Control of a pillbox Location the viewer has not been shown is not shown to it (A12.33).
    r.redact({
      id: 'asl.pb.controlRedact',
      ext: 'sk1.control',
      redactExt(slice, viewer, env) {
        const st = slice as ControlState | undefined;
        if (!st?.locations) return slice;
        const hidden = Object.keys(st.locations).filter((l) => isPillboxLoc(l) && !pillboxKnownToSide(env, hexOfLoc(l), viewer));
        if (!hidden.length) return slice;
        const locations = Object.fromEntries(Object.entries(st.locations).filter(([l]) => !hidden.includes(l)));
        const { locations: _l, ...rest } = st;
        void _l;
        return Object.keys(locations).length ? { ...rest, locations } : rest;
      },
    });

    // ---------------------------------------------------------------- B30.8: bunkers
    // A unit may move, rout or advance between a bunker and its trenches as if the bunker were a trench (B30.8): a bunker is
    // therefore ADJACENT to the trench Locations of the next hexes it connects to (A.8: a unit could advance between them).
    // The entry and exit limits of B30.42, B30.44 and B30.6 still apply (the pillbox's own rules above).
    r.contribute({
      id: 'asl.pb.bunkerAdjacent',
      query: 'loc.adjacent',
      ref: 'ASLRB B30.8, A.8',
      layer: 60,
      apply(v, { loc }, env) {
        if (isPillboxLoc(loc)) {
          const extra = bunkerTrenches(env, hexOfLoc(loc)).filter((h) => h !== hexOfLoc(loc) && !v.includes(h));
          return extra.length ? [...v, ...extra] : v;
        }
        if (!isGroundLoc(loc) || !trenchIn(env, loc)) return v;
        const near = statics(env).map.neighbors(loc).filter((h) => bunkerTrenches(env, h).includes(loc)).map((h) => pillboxLoc(h)).filter((l) => !v.includes(l));
        return near.length ? [...v, ...near] : v;
      },
    });
    // From the bunker, beneath one of its trenches (in its own hex or the next): offered as a step of its own.
    r.contribute({
      id: 'asl.pb.bunkerVariants',
      query: 'move.stepVariants',
      ref: 'ASLRB B30.8',
      apply(v, { ms, to }, env) {
        if (ms.vehicle || !ms.hex || ms.sub !== 'pb' || !isGroundLoc(to)) return v;
        return bunkerMove(env, pillboxLoc(ms.hex), false, to, true) ? [...v, { type: 'move.step' as const, to, beneath: true as const }] : v;
      },
    });
    // From beneath a trench in the next hex the bunker is entered only from beneath it; from the bunker the next hex only
    // beneath its trench (B30.8). B30.42, B30.44 (entering) and B30.6 (leaving) bind as for any pillbox.
    r.contribute({
      id: 'asl.pb.bunkerStep',
      query: 'move.stepIllegal',
      ref: 'ASLRB B30.8, B30.42, B30.44, B30.6',
      apply(v, { ms, to, beneath }, env) {
        if (v || !ms.hex || ms.vehicle) return v;
        const from = ms.sub === 'pb' ? pillboxLoc(ms.hex) : ms.hex;
        const side = env.state.attacker;
        if (isPillboxLoc(to) && hexOfLoc(to) !== ms.hex) {
          if (!bunkerMove(env, from, !!ms.ent, to, false)) return 'Only from beneath a connecting trench may a unit move into a bunker from the next hex (ASLRB B30.8)';
          return pillboxEntryIllegal(env, hexOfLoc(to), side, ms.units.map((u) => pieceOf(env, u)), { manhandle: !!ms.manhandle });
        }
        if (ms.sub === 'pb' && hexOfLoc(to) !== ms.hex) {
          if (!bunkerMove(env, from, false, to, !!beneath)) return 'From a bunker a unit moves into the next hex only beneath a connecting trench (ASLRB B30.8)';
          return pillboxExitIllegal(env, ms.hex, side);
        }
        return null;
      },
    });
    // No FFNAM, FFMO, Snap Shot, Interdiction or minefield attack on a move between the bunker and the trench of the next
    // hex (B27.54 via B30.8; Q&A [K33] to B30.8 & O.2 SSR RF6: it is trench movement).
    r.procedure<MoveEnterFn>(MOVE_ENTER, (next) => (ctx, ms, to, cost, woods, extra) => {
      const from = ms.sub === 'pb' && ms.hex ? pillboxLoc(ms.hex) : ms.hex;
      const way = from ? bunkerMove(ctx, from, !!ms.ent, to, !!extra?.ent) : null;
      next?.(ctx, ms, to, cost, woods, way && ms.hex && hexOfLoc(to) !== ms.hex ? { ...extra, trenchMove: true } : extra);
    });
    // In the RtPh: out of the bunker beneath a connecting trench (B30.8), at the trench move's cost.
    r.contribute({
      id: 'asl.pb.bunkerRout',
      query: 'rout.beneath',
      ref: 'ASLRB B30.8, B27.54',
      layer: 50,
      apply(v, { unit, from, to }, env) {
        if (v !== null || !isPillboxLoc(from)) return v;
        if (!bunkerMove(env, from, false, to, true)) return v;
        const p = pieceOf(env, unit);
        return pillboxExitIllegal(env, hexOfLoc(from), p.side) ?? { cost: bunkerMoveCost(env, from, to, p.side) };
      },
    });

    // ---------------------------------------------------------------- B24.121, B30.92: falling rubble
    // Falling rubble eliminates a pillbox and, with it, its contents (B24.121; B30.92: "all of its contents are also
    // eliminated").
    r.on<{ hex: HexId; falls: boolean; to?: HexId }>({
      id: 'asl.pb.fallingRubble',
      event: 'asl.rubble.falling',
      handler(ctx, ev) {
        const pb = ev.payload.falls && ev.payload.to ? pillboxAt(ctx, ev.payload.to) : null;
        if (pb) eliminatePillbox(ctx, pb, 'falling rubble (ASLRB B24.121, B30.92)');
      },
    });

    // ---------------------------------------------------------------- B30.1, B30.45, A12.34, C3.22: Guns in a pillbox
    // A Gun may set up in a pillbox (B30.45; one at most, B30.111, at setup in `asl/fortifications.ts`), HIP if it likes
    // (B30.45, A12.34), and takes the pillbox's Covered Arc, which it never changes (B30.1 "A pillbox may never change its
    // CA"; B30.2: no LOS outside it): it may not turn, between shots or to fire.
    const gunInPillbox = (env: QueryEnv, gunId: PieceId): FortRecord | null => {
      const g = env.state.pieces[gunId];
      return g ? pillboxOf(env, locOf(env.state, g)) : null;
    };
    r.contribute({
      id: 'asl.pb.gunSetup',
      query: 'gun.setupIllegal',
      ref: 'ASLRB B30.45',
      apply: (v, { loc }, env) => (isPillboxLoc(loc) && pillboxAt(env, hexOfLoc(loc)) ? null : v),
    });
    r.contribute({
      id: 'asl.pb.gunDefaults',
      query: 'setup.defaults',
      ref: 'ASLRB B30.1, C3.22',
      apply(v, { placements }, env) {
        const guns = (v as { guns?: Record<PieceId, { ca: number; hip?: boolean }> }).guns;
        if (!guns) return v;
        let changed = false;
        const next = { ...guns };
        for (const [id, spec] of Object.entries(guns)) {
          const g = env.state.pieces[id];
          const by = g?.loc.kind === 'held' ? g.loc.by : null;
          const loc = by ? placements[by] : undefined;
          const pb = loc && isPillboxLoc(loc) ? pillboxAt(env, hexOfLoc(loc)) : null;
          if (pb?.ca === undefined || spec.ca === arcSpine(pb.ca)) continue;
          next[id] = { ...spec, ca: arcSpine(pb.ca) };
          changed = true;
        }
        return changed ? { ...v, guns: next } : v;
      },
    });
    r.contribute({
      id: 'asl.pb.gunSetupCa',
      query: 'setup.illegal',
      ref: 'ASLRB B30.1',
      apply(v, { action }, env) {
        if (v) return v;
        const a = action as { placements: Record<PieceId, LocId>; sw?: Record<PieceId, PieceId>; guns?: Record<PieceId, { ca: number }> };
        for (const [id, spec] of Object.entries(a.guns ?? {}).sort()) {
          const g = env.state.pieces[id];
          const by = a.sw?.[id] ?? (g?.loc.kind === 'held' ? g.loc.by : null);
          const loc = by ? a.placements[by] : undefined;
          const pb = loc && isPillboxLoc(loc) ? pillboxAt(env, hexOfLoc(loc)) : null;
          if (pb?.ca !== undefined && spec.ca !== arcSpine(pb.ca)) return `${id}: a Gun in a pillbox takes the pillbox's Covered Arc (ASLRB B30.1)`;
        }
        return null;
      },
    });
    r.contribute({
      id: 'asl.pb.gunCa',
      query: 'gun.canChangeCa',
      ref: 'ASLRB B30.1',
      apply: (v, { gun: id }, env) => v ?? (gunInPillbox(env, id) ? "A Gun in a pillbox keeps the pillbox's Covered Arc (ASLRB B30.1)" : null),
    });
    r.contribute({
      id: 'asl.pb.gunTurn',
      query: 'ordnance.illegal',
      ref: 'ASLRB B30.1',
      apply(v, { shot }, env) {
        if (v || shot.ca === undefined) return v;
        const pb = gunInPillbox(env, shot.weapon);
        const g = env.state.pieces[shot.weapon];
        return pb && g && gun(env, g) && shot.ca !== (g.tags[T2.ca] as number | undefined ?? 0) ? "A Gun in a pillbox keeps the pillbox's Covered Arc (ASLRB B30.1)" : null;
      },
    });

    // ---------------------------------------------------------------- B30.2, B30.6: ADJACENT for some purposes
    r.contribute({
      id: 'asl.pb.adjacentFor',
      query: 'loc.adjacentFor',
      ref: 'ASLRB B30.2',
      apply: (v, { a, b, purpose }, env) => v || pillboxAdjacentFor(env, a, b, purpose),
    });
  },
};

/**
 * The IFT results an attack at a pillbox the firer had not been shown would have had on its contents (see
 * `asl.pb.unseenTarget`): through the NCA, none (B30.113: NA); through the CA, a result of PTC or better, or one the
 * pillbox's DM turned to no effect (its TEM claimed, A12.33), reveals the pillbox and then applies to its contents.
 */
function unseenPillboxResults(ctx: Ctx, pb: FortRecord, decl: FireDeclaration, mode: FireMode, column: number, total: number) {
  const side = ctx.state.pieces[decl.units[0] ?? decl.sw[0]!]!.side;
  const attack: FireAttackCtx = { ...buildAttack(ctx, decl, mode, side), targets: personnelAt(ctx, pillboxLoc(pb.hex), otherSide(ctx.state, side)).map((p) => p.id).sort() };
  if (naThroughNca(ctx, attack)) return;
  const full = ctx.query('fire.drm', { attack }, 0);
  const dm = pillboxIftDm(ctx, attack)?.dm ?? 0;
  const tables = statics(ctx).tables;
  const unitDrm = (u: PieceId) => ctx.query('fire.unitDrm', { attack, unit: u }, 0);
  const withDm = (u: PieceId): IftResult => tables.ift(column, total + full + unitDrm(u));
  const withoutDm = (u: PieceId): IftResult => tables.ift(column, total + full - dm + unitDrm(u));
  const hit = tables.ift(column, total + full).kind !== 'none' || attack.targets.some((u) => withDm(u).kind !== 'none');
  const claimed = attack.targets.some((u) => withDm(u).kind === 'none' && withoutDm(u).kind !== 'none');
  if (!hit && !claimed) return;
  revealFortification(ctx, pb.id, claimed && !hit ? 'tem' : 'attack');
  if (!attack.targets.length) return;
  const results: Record<PieceId, IftResult> = {};
  ctx.proc<ApplyResultFn>(FP.applyResult)(ctx, attack, column, total + full, results);
}
