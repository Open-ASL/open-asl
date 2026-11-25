import type { Ctx, HexId, Piece, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { byId, defOf, isVehicleDef, otherSide, personnelAt, statics } from '../common/pieces';
import { acrossSide, cornerPoint, sideToward } from '../common/hexCorners';
import { hexOfLoc, isGroundLoc, locOf, type LocId } from '../common/location';
import { hexPixel, hexsideBlocks, hexsideCrossing } from '../common/map';
import type { HexsideCrossing, HexsideObstacle, LosEnd } from '../common/statics';
import { FP, buildAttack, ffmoApplies, firerLos, iftColumn, type AttackResolvedFn, type FireAttackCtx, type FireDeclaration, type FireMode } from '../sk1/fire';
import { MOVE_ENTER, moveInternals, type MoveEnterFn } from '../sk1/movement';
import { isGoodOrder, isPinned, mmc, pieceOf, smc, sw } from '../sk1/status';
import { heightOf, levelOf } from '../sk2/elevation';
import { isEntrenched } from './entrenchments';
import { fortCounters, removeFortification, revealFortification, roadblockExtensionAt, roadblocks, shownCounter, type FortRecord } from './fortifications';
import { ammoColumn } from '../sk2/ammo';
import { OP, shotContext, toHitNumber, type ResolveHitFn, type ShotCtx } from '../sk2/ordnance';
import { acrossObstacle, hasWa, hasWaOver } from './wallAdvantage';

/*
 * Roadblocks in play (ASLRB B29.2–B29.5; full ASL only: neither Starter Kit rulebook has them).
 *
 * A roadblock is a stone wall across the hexside it points to (B29.2) "in all respects" (B29.3), extended along that
 * hexside to the centre dot of any woods or building hex at either of its vertices. Every rule reads it as a hexside
 * obstacle (`'los.hexsides'`, `HexsideObstacle`), so printed walls and hedges can join the same list:
 * - LOS (B29.2, B9.2, A6.21): a Half-Level obstacle to same-level LOS at its level, never through a hexside of the
 *   viewing or target hex, along the hexside only when neither end hex touches it, never seen over from above; the
 *   extension never blocks a LOS into or out of its own hex's centre (B9.2 read for the extension). A Hillside roadblock
 *   (B29.4, B9.6) is at the higher hex's level and ignored between ends a level or more apart.
 * - TEM (B29.3, B9.3, B9.31, B9.33, B9.42): +2 to a unit in either hex fired on across (or along) the hexside, the
 *   extension's +2 to a unit in its hex vs Direct Fire across it; with Wall Advantage the wall TEM instead of any in-hex
 *   TEM, without it the in-hex TEM or the wall TEM against firers without WA over the hexside, whichever is better; never
 *   with FFMO; reduced by a firer's elevation advantage; claimed against at least one firer, it lowers the Residual FP
 *   left (A8.26). A hidden roadblock is revealed when its TEM is claimed (A12.33). No wall TEM vs a DC (B9.3).
 * - Movement (B29.4, B9.4): Infantry crossing it pay one MF more (after the COT and any doubling, never doubled); no
 *   vehicle crosses it (a hidden one stops the vehicle and is revealed); a Bypass that passes through one of its vertices
 *   costs one MF more (the B29.4 EX). Nothing while it is hidden from the mover (A12.33).
 * - A12.33: a hidden roadblock is revealed when it blocks the LOS of a Good Order enemy ground unit to any Location.
 * - Removal (B29.5): a DC Placed through the hexside, on a Final KIA; Clearance in `asl/clearance.ts`; HE ordnance: a
 *   Direct Fire shot on the Infantry Target Type at the counter's hex whose line to its centre dot crosses the hexside
 *   (before or after that dot) is hit on the same Original To Hit DR against the roadblock's own number (the firer's DRM
 *   and its +2, none of the units'), and a KIA on the same IFT DR removes it (the B29.5 EX); with no Known enemy unit
 *   there the roadblock may be the shot's only target. Indirect Fire at either hex of the hexside: the IFT DR +2 vs the
 *   roadblock, the units there +1 (B9.34).
 * - Ordnance TEM (B29.3, C3.33, C3.7): on the Infantry Target Type the wall TEM is a To Hit DRM (each unit hit on its own
 *   number, C3.32), reversed on a Critical Hit; on a Direct Fire Area Target Type hit an IFT DRM, as for small arms.
 * - B9.21: a unit beneath an entrenchment and a non-adjacent Location no more than half a level above it do not see each other
 *   across a same-level wall hexside of its hex: such a unit is not attacked by that Direct Fire nor fires there.
 * - C8.31 (Q&A [VFTT #13] to B29.3 & C8.31): a roadblock is a wall for shaped-charge weapons, so a Panzerfaust may aim at
 *   Infantry receiving its TEM (an extension Location when the LOF crosses the extension).
 * - B9.36, D4.21: a vehicle subject to the wall TEM is HD to Direct Fire ordnance instead (`vehicleWallTem`, `asl/hullDown.ts`).
 * Not here: VBM (B29.4 "inclusive of vertices"), a SCW (LATW) against a roadblock (its HEAT is no HE
 * attack, B29.5), the elevation reduction (B9.33) of the Indirect Fire TEM.
 */

/** The roadblock records as hexside obstacles (B29.2): the hexside's two hexes, its level, its extension. */
export function roadblockObstacles(env: QueryEnv): HexsideObstacle[] {
  const map = statics(env).map;
  const out: HexsideObstacle[] = [];
  for (const c of roadblocks(env)) {
    if (c.hexside === undefined) continue;
    const b = acrossSide(map, c.hex, c.hexside);
    if (!b || !map.hex(b)) continue;
    const la = levelOf(env, c.hex);
    const lb = levelOf(env, b);
    out.push({ id: c.id, kind: 'roadblock', a: c.hex, b, k: c.hexside, level: Math.max(la, lb), hillside: la !== lb, tem: 2, extension: roadblockExtensionAt(env, c) });
  }
  return out.sort((x, y) => (x.id < y.id ? -1 : 1));
}

const recordOf = (env: QueryEnv, id: string): FortRecord | undefined => roadblocks(env).find((c) => c.id === id);
/** The roadblock on the hexside between two adjacent hexes, if any. */
export function roadblockBetween(env: QueryEnv, from: HexId, to: HexId): FortRecord | null {
  const map = statics(env).map;
  for (const c of roadblocks(env)) {
    if (c.hexside === undefined) continue;
    if ((c.hex === from && sideToward(map, from, to) === c.hexside) || (c.hex === to && sideToward(map, to, from) === c.hexside)) return c;
  }
  return null;
}
/** Known to `side`: its own (hidden or not) or one shown to it (A12.33). */
const knownTo = (c: FortRecord, side: SideId) => !!shownCounter(c, side);
/** Still hidden from the other side: a unit crossing it pays nothing (A12.33). */
const hiddenNow = (c: FortRecord) => c.hidden && !c.revealed;

// ---------------------------------------------------------------- TEM (B29.3, B9.3, B9.31, B9.33, B9.42)

/** The wall hexsides (and extensions) of the target Location a firer's LOS meets, with the TEM it gives there. */
interface WallTem {
  o: HexsideObstacle;
  tem: number;
  /** Against at least one firer that does not hold WA over the hexside. */
  vsNonWa: boolean;
  extension: boolean;
}

const firerPoint = (env: QueryEnv, firer: PieceId): LosEnd | null => {
  const loc = locOf(env.state, pieceOf(env, firer));
  return loc ? { hex: hexOfLoc(loc), height: heightOf(env, loc) } : null;
};

/** B9.42: a target at a vertex of the hexside gets its TEM along the hexside, or from across it when in one of its two hexes. */
function crossingApplies(c: HexsideCrossing, targetHex: HexId, o: HexsideObstacle): boolean {
  if (c.crossed || c.along) return true;
  if (c.vertexFrom === undefined) return false;
  if (c.vertexFrom === null) return true;
  return (targetHex === o.a || targetHex === o.b) && c.vertexFrom === acrossObstacle(o, targetHex);
}

/** The wall TEM `unit` could claim against this attack: the best over its hexsides and firers, and whether against non-WA firers. */
function wallTems(env: QueryEnv, attack: FireAttackCtx, unit: Piece): WallTem[] {
  if (attack.losBlind || !isGroundLoc(attack.target) || unit.loc.kind !== 'hex') return [];
  const hex = unit.loc.hex;
  const obs = env.query('los.hexsides', {}, []).filter((o) => ((o.a === hex || o.b === hex) && levelOf(env, hex) === o.level) || o.extension.some((e) => e.hex === hex));
  if (!obs.length) return [];
  const base = heightOf(env, hex);
  const map = statics(env).map;
  const out: WallTem[] = [];
  for (const o of obs) {
    const inWallHex = (o.a === hex || o.b === hex) && levelOf(env, hex) === o.level;
    let best: WallTem | null = null;
    for (const part of attack.parts) {
      const from = firerPoint(env, part.firer);
      if (!from) continue;
      const los = firerLos(env, locOf(env.state, pieceOf(env, part.firer))!, { target: attack.target, ...(attack.snap ? { snap: attack.snap } : {}) });
      const c = los.hexsides?.find((x) => x.id === o.id) ?? hexsideCrossing(map, from, { hex, height: base }, o);
      const wall = inWallHex && crossingApplies(c, hex, o);
      // The extension's TEM applies only to Direct Fire (B29.3 EXC), to a unit in its hex fired on across it.
      const ext = !wall && !attack.ordnance?.indirect && !!c.extension?.includes(hex);
      if (!wall && !ext) continue;
      // B9.33: one less per full level the firer's height above the target's base level exceeds the range.
      const red = Math.max(0, Math.floor(from.height - base) - map.distance(from.hex, hex));
      const tem = Math.max(0, o.tem - red);
      const firerWa = wall && hasWaOver(env, pieceOf(env, part.firer), o);
      const cand: WallTem = { o, tem: firerWa ? 0 : tem, vsNonWa: !firerWa, extension: ext };
      if (!best || cand.tem > best.tem) best = cand;
    }
    if (best) out.push(best);
  }
  return out;
}

/**
 * The wall TEM a vehicle in its hex would be subject to against Direct Fire from Location `from` (B9.36, D4.21), as for any
 * unit (B9.3, B9.31, B9.33, B9.42): the best over the wall hexsides (and extensions) of its hex the firer's LOS crosses
 * there, after the firer's elevation advantage; with WA over the hexside the vehicle has it, without WA only against a
 * firer without WA over it (`firerWaOver`). Null when no wall TEM is left (B9.33: "reduced to 0 ... any HD status is negated").
 */
export function vehicleWallTem(env: QueryEnv, vehicleId: PieceId, from: LocId, firerWaOver: (o: HexsideObstacle) => boolean): { tem: number; o: HexsideObstacle } | null {
  const v = pieceOf(env, vehicleId);
  if (v.loc.kind !== 'hex') return null;
  const hex = v.loc.hex;
  const obs = env.query('los.hexsides', {}, []).filter((o) => ((o.a === hex || o.b === hex) && levelOf(env, hex) === o.level) || o.extension.some((e) => e.hex === hex));
  if (!obs.length) return null;
  const map = statics(env).map;
  const base = heightOf(env, hex);
  const fromPt: LosEnd = { hex: hexOfLoc(from), height: heightOf(env, from) };
  if (fromPt.hex === hex) return null;
  const los = firerLos(env, from, { target: hex });
  let best: { tem: number; o: HexsideObstacle } | null = null;
  for (const o of obs) {
    const inWallHex = (o.a === hex || o.b === hex) && levelOf(env, hex) === o.level;
    const c = los.hexsides?.find((x) => x.id === o.id) ?? hexsideCrossing(map, fromPt, { hex, height: base }, o);
    const wall = inWallHex && crossingApplies(c, hex, o);
    const ext = !wall && !!c.extension?.includes(hex);
    if (!wall && !ext) continue;
    // B9.31: only a firer without WA over the hexside leaves the wall TEM to a target without it; the target holding WA
    // denies it to the firer (B9.321), so the firer's WA counts only where the vehicle has none.
    if (wall && !hasWaOver(env, v, o) && firerWaOver(o)) continue;
    const red = Math.max(0, Math.floor(fromPt.height - base) - map.distance(fromPt.hex, hex));
    const tem = Math.max(0, o.tem - red);
    if (tem > 0 && (!best || tem > best.tem)) best = { tem, o };
  }
  return best;
}

/** The DRM the wall (or extension) changes for `unit` against this attack, relative to the hex TEM already applied (B9.31). */
const temMemo = new WeakMap<FireAttackCtx, Map<string, { delta: number; tem: number; o: HexsideObstacle | null; wa: boolean }>>();
export function wallTemDelta(env: QueryEnv, attack: FireAttackCtx, unitId: PieceId): { delta: number; tem: number; o: HexsideObstacle | null; wa: boolean } {
  let m = temMemo.get(attack);
  if (!m) temMemo.set(attack, (m = new Map()));
  const key = `${env.state.seq}:${unitId}`;
  const hit = m.get(key);
  if (hit) return hit;
  const res = wallTemDeltaNow(env, attack, unitId);
  m.set(key, res);
  return res;
}
function wallTemDeltaNow(env: QueryEnv, attack: FireAttackCtx, unitId: PieceId): { delta: number; tem: number; o: HexsideObstacle | null; wa: boolean } {
  // Ordnance on the Infantry Target Type takes the TEM on its To Hit DR (C3.33; `asl.roadblock.th`), Indirect Fire the
  // B9.34 TEM (`asl.roadblock.indirect`); only a Direct Fire Area Target Type hit takes it on the IFT DR.
  if (attack.ordnance && (attack.ordnance.targetType !== 'ATT' || attack.ordnance.indirect)) return { delta: 0, tem: 0, o: null, wa: false };
  return wallTemCore(env, attack, unitId);
}
function wallTemCore(env: QueryEnv, attack: FireAttackCtx, unitId: PieceId): { delta: number; tem: number; o: HexsideObstacle | null; wa: boolean } {
  const p = pieceOf(env, unitId);
  // Beneath an entrenchment its +2 stands in for the hex TEM already (B27.3). A vehicle is HD to Direct Fire ordnance
  // through the wall instead (B9.36, `asl/hullDown.ts`); its wall TEM against non-ordnance waits for MG fire at vehicles
  // (A9.6), and its PRC never get one (B9.3).
  if (isEntrenched(p) || isVehicleDef(defOf(env, p))) return { delta: 0, tem: 0, o: null, wa: false };
  const walls = wallTems(env, attack, p);
  const hexTem = attack.snap ? 0 : Math.max(0, env.query('hex.tem', { hex: attack.target }, 0));
  const wa = p.loc.kind === 'hex' && walls.some((w) => !w.extension && hasWaOver(env, p, w.o));
  const waSides = env.query('los.hexsides', {}, []).filter((o) => hasWaOver(env, p, o));
  if (waSides.length) {
    // Claiming WA: the wall TEM where it applies, and no in-hex TEM at all (B9.31).
    const w = walls.filter((x) => !x.extension).sort((x, y) => y.tem - x.tem)[0];
    return { delta: (w?.tem ?? 0) - hexTem, tem: w?.tem ?? 0, o: w?.o ?? null, wa: true };
  }
  void wa;
  // Not claiming WA: the in-hex TEM, or the wall TEM against firers without WA over the hexside, whichever is better.
  const w = walls.filter((x) => x.vsNonWa).sort((x, y) => y.tem - x.tem)[0];
  if (!w || w.tem <= hexTem) return { delta: 0, tem: 0, o: null, wa: false };
  return { delta: w.tem - hexTem, tem: w.tem, o: w.o, wa: false };
}

// ---------------------------------------------------------------- A12.33: the roadblock that blocks a LOS

/** Whether hidden roadblock `c` blocks the LOS of a Good Order enemy ground unit to some Location (A12.33). */
export function roadblockBlocksEnemyLos(env: QueryEnv, c: FortRecord): boolean {
  const o = roadblockObstacles(env).find((x) => x.id === c.id);
  if (!o) return false;
  const map = statics(env).map;
  const enemy = otherSide(env.state, c.side);
  const viewers = Object.values(env.state.pieces)
    .filter((p) => p.side === enemy && p.loc.kind === 'hex' && !p.loc.level && !p.loc.sub && ((!!(mmc(env, p) || smc(env, p)) && isGoodOrder(env, p)) || (isVehicleDef(defOf(env, p)) && p.tags['wreck'] !== true)))
    .sort(byId);
  for (const v of viewers) {
    const vh = (v.loc as { hex: HexId }).hex;
    if (vh === o.a || vh === o.b) continue;
    const h = heightOf(env, vh);
    if (h !== o.level) continue;
    const d = map.distance(vh, o.a);
    for (const t of map.hexes()) {
      if (t.id === o.a || t.id === o.b || t.id === vh) continue;
      const dt = map.distance(vh, t.id);
      if (dt <= d - 1 || dt > d + 4) continue;
      const from: LosEnd = { hex: vh, height: h };
      const to: LosEnd = { hex: t.id, height: heightOf(env, t.id) };
      const cr = hexsideCrossing(map, from, to, o);
      if (!cr.crossed && !cr.along && !cr.extension) continue;
      if (!hexsideBlocks(map, from, to, o, cr)) continue;
      // Only where the roadblock is what blocks it: the terrain alone leaves the LOS open.
      if (map.losAt?.(from, to, {})?.clear) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------- B9.21: entrenched units behind a wall

/**
 * B9.21: "A unit in an entrenchment cannot see (or be seen) across a same-level wall/hedge hexside/hexspine forming a part
 * of the unit's hex to (or from) any non-adjacent same-level or lower Location—although an elevation advantage of at least
 * a half-level over the Entrenchment does allow such LOS. LOS is reciprocal." The wall the LOS crosses, or null when `unit`
 * (beneath an entrenchment) and Location `other` see each other.
 */
export function entrenchedWallBlock(env: QueryEnv, unit: Piece, other: LocId): HexsideObstacle | null {
  if (unit.loc.kind !== 'hex' || unit.loc.level || unit.loc.sub || !isEntrenched(unit)) return null;
  const hex = unit.loc.hex;
  const oHex = hexOfLoc(other);
  const map = statics(env).map;
  if (oHex === hex || map.distance(hex, oHex) <= 1) return null;
  const base = heightOf(env, hex);
  const h = heightOf(env, other);
  if (h - base >= 0.5) return null;
  const from: LosEnd = { hex: oHex, height: h };
  const to: LosEnd = { hex, height: base };
  for (const o of env.query('los.hexsides', {}, [])) {
    if ((o.a !== hex && o.b !== hex) || levelOf(env, hex) !== o.level) continue;
    if (hexsideCrossing(map, from, to, o).crossed) return o;
  }
  return null;
}
/** The targets of a declaration before and after B9.21. */
function buildAttackFor(env: QueryEnv, decl: FireDeclaration, mode: FireMode, side: SideId, moving?: PieceId[]): { full: PieceId[]; seen: PieceId[] } {
  const a = buildAttack(env, decl, mode, side, moving);
  const full = moving ?? personnelAt(env, decl.target, otherSide(env.state, side)).map((p) => p.id);
  return { full, seen: a.targets };
}
/** The firing Locations of an attack that is Direct Fire (B9.21 is about LOS: Indirect Fire needs none to the units). */
const directFireFroms = (env: QueryEnv, attack: FireAttackCtx): LocId[] =>
  attack.ordnance?.indirect ? [] : [...new Set(attack.parts.map((p) => locOf(env.state, pieceOf(env, p.firer))).filter((l): l is LocId => !!l))];
/** B9.21 for a whole attack: a target beneath an entrenchment is attacked only if every firing Location sees it (each firer needs LOS to its target). */
export function unseenTargets(env: QueryEnv, attack: FireAttackCtx): PieceId[] {
  const froms = directFireFroms(env, attack);
  if (!froms.length) return [];
  return attack.targets.filter((u) => {
    const p = env.state.pieces[u];
    return !!p && froms.some((f) => !!entrenchedWallBlock(env, p, f));
  });
}
/** B9.21 for a firer: why a unit beneath an entrenchment cannot fire at `target`, or null. */
export function entrenchedFirerBlocked(env: QueryEnv, firer: PieceId, target: LocId): string | null {
  const p = env.state.pieces[firer];
  const o = p ? entrenchedWallBlock(env, p, target) : null;
  return o ? `${firer} is beneath an entrenchment: it cannot see across the wall ${o.a}–${o.b} to a non-adjacent Location no higher than half a level above it (ASLRB B9.21)` : null;
}

// ---------------------------------------------------------------- B29.5: HE against the roadblock; B9.34; the TEM on the To Hit DR

/**
 * Whether the line from the centre of `fromHex` through the centre dot of the Roadblock counter's hex crosses the roadblock
 * hexside, before or after reaching that centre dot (B29.5: "its LOS must be traced to the center dot of the Roadblock
 * counter's hex and must also cross the roadblock hexside before/after reaching that center dot").
 */
export function roadblockLineCrosses(env: QueryEnv, c: Pick<FortRecord, 'hex' | 'hexside'>, fromHex: HexId): boolean {
  const map = statics(env).map;
  const h = map.hex(c.hex);
  const f = map.hex(fromHex) ?? map.offboardHex(fromHex);
  if (!h || !f || c.hexside === undefined || fromHex === c.hex) return false;
  const C = hexPixel(h.cube);
  const F = hexPixel(f.cube);
  const P = cornerPoint(h.cube, c.hexside);
  const Q = cornerPoint(h.cube, c.hexside + 1);
  const dx = C.x - F.x;
  const dy = C.y - F.y;
  const ex = Q.x - P.x;
  const ey = Q.y - P.y;
  const den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-9) return false;
  // F + t (C - F) meets P + u (Q - P): t < 1 before the centre dot, t > 1 after it; u in [0, 1] on the hexside (its vertices included).
  const t = ((P.x - F.x) * ey - (P.y - F.y) * ex) / den;
  const u = ((P.x - F.x) * dy - (P.y - F.y) * dx) / den;
  return t > 0 && u >= -1e-6 && u <= 1 + 1e-6;
}

/** The roadblocks an HE ordnance shot also attacks (B29.5): Direct Fire on the ITT at the counter's hex across its hexside; Indirect Fire at either hex of it. */
export function heRoadblocks(env: QueryEnv, sc: ShotCtx): { c: FortRecord; o: HexsideObstacle; indirect: boolean }[] {
  if (sc.ammo !== 'HE' || !isGroundLoc(sc.target)) return [];
  const hex = hexOfLoc(sc.target);
  const indirect = sc.def.type === 'MTR';
  if (!indirect && sc.shot.targetType !== 'ITT') return [];
  if (indirect && sc.shot.targetType !== 'ATT') return [];
  const obs = roadblockObstacles(env);
  const out: { c: FortRecord; o: HexsideObstacle; indirect: boolean }[] = [];
  for (const c of roadblocks(env)) {
    const o = obs.find((x) => x.id === c.id);
    if (!o) continue;
    if (indirect ? o.a === hex || o.b === hex : c.hex === hex && roadblockLineCrosses(env, c, sc.hex)) out.push({ c, o, indirect });
  }
  return out;
}

/** The To Hit DRM that belong to the units in the target Location, not to the roadblock (B29.5: they "may have different DRM"). */
const UNIT_TH = new Set([
  'sk2.th.tem',
  'sk2.th.emplacement',
  'sk2.th.ffnam',
  'sk2.th.ffmo',
  'sk2.th.acquired',
  'sk2.th.hazardous',
  'sk2.th.targetSize',
  'sk2.th.targetDrm',
  'sk2.th.heightAdvantage',
  'sk2.th.hip-target',
  'sk4.th.concealed-target',
  'sk4.th.bamboo-he',
  'ssr.fortified.th',
  'asl.ent.th',
  'asl.roadblock.th',
]);

/** The roadblock's own To Hit DRM (B29.5): the shot's firer-based DRM with "the roadblock's +2 TEM", none of the units'. */
export function roadblockThDrm(env: QueryEnv, sc: ShotCtx): number {
  const res = env.explain('ordnance.thDrm', sc, 0);
  let units = 0;
  for (const t of res.trace) if (UNIT_TH.has(t.id) && !t.suppressedBy) units += (t.after as number) - (t.before as number);
  return res.value - units + 2;
}

/** The units a shot at the Location can hit (as the ordnance procedure picks them): the moving stack, or the enemy there. */
const ittUnits = (env: QueryEnv, sc: ShotCtx): PieceId[] =>
  sc.moving ? sc.moving.filter((u) => env.state.pieces[u]?.loc.kind === 'hex') : personnelAt(env, sc.target, otherSide(env.state, sc.side)).map((p) => p.id);

/** The shot as an attack on the Location, for the wall TEM a unit there claims against it. */
const shotAttack = (sc: ShotCtx, units: PieceId[]): FireAttackCtx => ({
  mode: sc.mode,
  side: sc.side,
  target: sc.target,
  parts: [{ piece: sc.weapon, firer: sc.firer, kind: 'ordnance', hex: sc.hex, range: 99, dist: sc.range }],
  targets: units,
  hindrance: sc.hindrance,
  ...(sc.losBlind ? { losBlind: true } : {}),
});

/**
 * What the wall adds to `unit`'s To Hit DRM on the Infantry Target Type (B29.3, B9.31, C3.33): its TEM in place of the
 * hex TEM already on the DR, and, behind it, no FFMO (B9.33 allows FFMO only once the wall TEM is 0).
 */
function unitThExtra(env: QueryEnv, sc: ShotCtx, unit: PieceId, units: PieceId[]): { delta: number; ffmo: number } {
  const w = wallTemCore(env, shotAttack(sc, units), unit);
  const ffmo = w.tem > 0 && !!sc.movingInfo && !sc.movingInfo.pinned && sc.hindrance === 0 && env.query('hex.openGround', { hex: sc.target }, false) ? 1 : 0;
  return { delta: w.delta, ffmo };
}
/**
 * The part of the wall's To Hit DRM every unit shares (on the shot's DRM; FFMO taken off the shot when no unit is open to
 * it), and each unit's own extra beyond that (C3.32).
 */
function thExtras(env: QueryEnv, sc: ShotCtx): { common: number; noFfmo: boolean; units: Record<PieceId, number> } {
  const units = ittUnits(env, sc);
  const raw = units.map((u) => [u, unitThExtra(env, sc, u, units)] as const);
  const noFfmo = raw.length > 0 && raw.every(([, x]) => x.ffmo > 0);
  const per: Record<PieceId, number> = {};
  for (const [u, x] of raw) per[u] = x.delta + x.ffmo;
  const vals = Object.values(per);
  const common = vals.length ? Math.min(...vals) : 0;
  return { common: common - (noFfmo ? 1 : 0), noFfmo, units: Object.fromEntries(Object.entries(per).map(([u, v]) => [u, v - (noFfmo ? 1 : 0)])) };
}
const ittShot = (sc: ShotCtx) => sc.shot.targetType === 'ITT' && isGroundLoc(sc.target) && sc.def.type !== 'MTR';

/** B9.34: a unit in a hex of a roadblock hexside takes its TEM less one vs Indirect Fire, crossed or not, WA or not. */
function indirectDelta(env: QueryEnv, attack: FireAttackCtx, unitId: PieceId): number {
  const p = pieceOf(env, unitId);
  if (!attack.ordnance?.indirect || !isGroundLoc(attack.target) || p.loc.kind !== 'hex' || p.loc.level || p.loc.sub) return 0;
  if (isEntrenched(p) || isVehicleDef(defOf(env, p))) return 0;
  const hex = p.loc.hex;
  // "Only one wall/hedge TEM can be applied ... regardless of the number of such features present in the target hex."
  const o = env.query('los.hexsides', {}, []).filter((x) => (x.a === hex || x.b === hex) && levelOf(env, hex) === x.level).sort((x, y) => y.tem - x.tem)[0];
  if (!o) return 0;
  const tem = Math.max(0, o.tem - 1);
  // In woods the Air Burst applies "even if the unit has WA (but is combined with wall TEM if applicable)"; otherwise the
  // wall TEM is not cumulative with in-hex TEM (B9.31): with WA in place of it, without WA the better of the two.
  if (attack.ordnance.airBurst) return tem;
  const hexTem = Math.max(0, env.query('hex.tem', { hex: attack.target }, 0));
  return hasWa(env, p) ? tem - hexTem : Math.max(0, tem - hexTem);
}

/** A hidden roadblock of the hex whose TEM a unit there claimed is revealed (A12.33). */
function revealAround(ctx: Ctx, hex: HexId) {
  for (const o of roadblockObstacles(ctx)) {
    if (o.a !== hex && o.b !== hex) continue;
    const c = recordOf(ctx, o.id);
    if (c && hiddenNow(c)) revealFortification(ctx, c.id, 'tem');
  }
}

/** The IFT DR the base resolution of the shot rolled against the target Location, captured for the roadblock (B29.5 EX: "the IFT DR"). */
let heIft: { loc: LocId; dr?: number } | null = null;

// ---------------------------------------------------------------- the module

export const aslRoadblocksModule: RuleModule = {
  id: 'asl.roadblocks',
  ref: 'ASLRB B29.2–B29.5, B9.2–B9.4, B9.42, A12.33',
  summary: 'Roadblocks in play: a stone wall across the hexside (LOS, TEM with Wall Advantage, +1 MF), no vehicle crossing, the reveal by a blocked LOS, removal by DC.',
  requires: ['asl.fortifications', 'asl.wallAdvantage', 'asl.los', 'sk1.movement', 'sk1.fire'],
  install(r) {
    r.contribute({ id: 'asl.roadblock.los', query: 'los.hexsides', ref: 'ASLRB B29.2', apply: (v, _c, env) => [...v, ...roadblockObstacles(env)] });
    r.event<{ roadblock: string; a: HexId; b: HexId; indirect: boolean; th?: number | null; final?: number; hit: boolean; column?: number; dr?: number; iftFinal?: number; kia: boolean }>({ type: 'asl.roadblock.he', apply() {} });
    r.event<{ units: PieceId[]; final: number; th: number }>({ type: 'asl.roadblock.thMissed', apply() {} });

    // ---------------------------------------------------------------- TEM
    r.contribute({
      id: 'asl.roadblock.tem',
      query: 'fire.unitDrm',
      ref: 'ASLRB B29.3, B9.3, B9.31, B9.33',
      label: ({ attack, unit }, env) => {
        const w = wallTemDelta(env, attack, unit);
        if (!w.o) return w.wa ? 'claiming Wall Advantage: no in-hex TEM (B9.31)' : '';
        return `${w.delta >= 0 ? '+' : ''}${w.delta} ${w.wa ? 'wall TEM with Wall Advantage' : 'wall TEM'} (roadblock ${w.o.a}–${w.o.b}, +${w.tem} in place of the in-hex TEM)`;
      },
      when: ({ attack, unit }, env) => wallTemDelta(env, attack, unit).delta !== 0 || (wallTemDelta(env, attack, unit).tem > 0 && !attack.ordnance && ffmoApplies(env, attack)),
      apply(v, { attack, unit }, env) {
        const w = wallTemDelta(env, attack, unit);
        // Behind the wall the unit is not in Open Ground: no FFMO (B9.33 allows it only once the wall TEM is 0).
        const ffmo = w.tem > 0 && !attack.ordnance && ffmoApplies(env, attack) && !isPinned(pieceOf(env, unit)) ? 1 : 0;
        return v + w.delta + ffmo;
      },
    });
    // A8.26: the Residual FP left across the hexside is lowered by its TEM where it could have been claimed vs a firer.
    r.contribute({
      id: 'asl.roadblock.residual',
      query: 'fire.residualBonus',
      ref: 'ASLRB A8.26, B9.31',
      apply(v, { attack }, env) {
        if (!attack) return v;
        const units = attack.targets.map((u) => env.state.pieces[u]).filter((p): p is Piece => !!p);
        const tem = Math.max(0, ...units.map((p) => Math.max(0, ...wallTems(env, attack, p).filter((w) => w.vsNonWa && !w.extension).map((w) => w.tem))));
        return v - tem;
      },
    });
    // A hidden roadblock whose TEM a target claimed is revealed (A12.33).
    r.on<{ explain?: { id: string }[]; unit: PieceId }>({
      id: 'asl.roadblock.temReveal',
      event: 'sk1.fire.result',
      handler(ctx, ev) {
        if (!ev.payload.explain?.some((n) => n.id === 'asl.roadblock.tem' || n.id === 'asl.roadblock.indirect' || n.id === 'asl.roadblock.chReversed')) return;
        const p = ctx.state.pieces[ev.payload.unit];
        if (!p || p.loc.kind !== 'hex') return;
        const hex = p.loc.hex;
        for (const o of roadblockObstacles(ctx)) {
          if (o.a !== hex && o.b !== hex && !o.extension.some((e) => e.hex === hex)) continue;
          const c = recordOf(ctx, o.id);
          if (c && hiddenNow(c)) revealFortification(ctx, c.id, 'tem');
        }
      },
    });

    // ---------------------------------------------------------------- C8.31: HEAT at Infantry behind the roadblock
    // A roadblock is a wall for shaped-charge weapons (B29.3; Q&A [VFTT #13] to B29.3 & C8.31): a Panzerfaust may aim at
    // Infantry that would receive its TEM against this firer, a unit in an extension Location included when the LOF
    // crosses the extension (the B29.4 EX). Only a roadblock the firing side knows of counts.
    r.contribute({
      id: 'asl.roadblock.heat',
      query: 'pf.infantryCover',
      ref: 'ASLRB C8.31, B29.3',
      apply(v, { firer, target, units }, env) {
        if (v) return v;
        const side = pieceOf(env, firer).side;
        const attack = { target, parts: [{ firer }], mode: 'prep', side, hindrance: 0 } as unknown as FireAttackCtx;
        return units.some((u) =>
          wallTems(env, attack, pieceOf(env, u)).some((w) => {
            const rec = recordOf(env, w.o.id);
            return w.tem > 0 && (!rec || knownTo(rec, side));
          }),
        );
      },
    });

    // ---------------------------------------------------------------- movement (B29.4, B9.4)
    r.contribute({
      id: 'asl.roadblock.cross',
      query: 'move.cost',
      ref: 'ASLRB B29.4, B9.4',
      label: '+1 MF crossing a roadblock (a wall, B9.4)',
      when: ({ unit, from, to }, env) => {
        if (!from || from === to) return false;
        const c = roadblockBetween(env, from, to);
        const p = env.state.pieces[unit];
        return !!c && !!p && !isVehicleDef(defOf(env, p)) && knownTo(c, p.side) && !(c.side === p.side && hiddenNow(c));
      },
      apply: (v) => v + 1,
    });
    r.contribute({
      id: 'asl.roadblock.vehicle',
      query: 'vehicle.stepIllegal',
      ref: 'ASLRB B29.4',
      apply(v, { ms, to }, env) {
        if (v || !ms.hex) return v;
        const c = roadblockBetween(env, ms.hex, to);
        return c && knownTo(c, env.state.attacker) ? `No vehicle may cross a roadblock hexside (${ms.hex}–${to}; ASLRB B29.4)` : null;
      },
    });
    // A vehicle that tries to cross a roadblock it cannot know of is stopped and the roadblock revealed: no vehicle may
    // cross it "even if HIP" (B29.4).
    r.procedure<MoveEnterFn>(MOVE_ENTER, (next) => (ctx, ms, to, cost, woods, extra) => {
      const c = ms.vehicle && ms.hex && isGroundLoc(to) ? roadblockBetween(ctx, ms.hex, hexOfLoc(to)) : null;
      if (!c) return next?.(ctx, ms, to, cost, woods, extra);
      revealFortification(ctx, c.id, 'entry');
      ctx.emit('sk1.move.state', { state: { ...ms, halted: true } });
      moveInternals.reAskMover(ctx);
    });
    // B29.4 EX: a Bypass through (not just to) a vertex of the roadblock hexside costs one MF more.
    r.contribute({
      id: 'asl.roadblock.bypass',
      query: 'bypass.cornerCost',
      ref: 'ASLRB B29.4',
      apply(v, { hex, corner }, env) {
        const map = statics(env).map;
        const h = map.hex(hex);
        if (!h) return v;
        const p = cornerPoint(h.cube, corner);
        let n = 0;
        for (const c of roadblocks(env)) {
          if (c.hexside === undefined || !knownTo(c, env.state.attacker) || (c.side === env.state.attacker && hiddenNow(c))) continue;
          const a = map.hex(c.hex)!;
          if ([c.hexside, c.hexside + 1].some((k) => Math.hypot(cornerPoint(a.cube, k).x - p.x, cornerPoint(a.cube, k).y - p.y) < 2)) n++;
        }
        return v + n;
      },
    });

    // ---------------------------------------------------------------- A12.33: revealed by blocking an enemy LOS
    const reveal = (ctx: Ctx) => {
      if (ctx.state.phase === 'setup') return;
      for (const c of roadblocks(ctx)) if (hiddenNow(c) && roadblockBlocksEnemyLos(ctx, c)) revealFortification(ctx, c.id, 'los');
    };
    for (const event of ['piece.moved', 'turn.phaseStarted', 'turn.playerTurn']) r.on({ id: `asl.roadblock.reveal.${event}`, event, handler: reveal });

    // ---------------------------------------------------------------- B9.21
    r.contribute({
      id: 'asl.wall.entrenchedLos',
      query: 'fire.targetsSeen',
      ref: 'ASLRB B9.21',
      apply(v, { attack }, env) {
        const unseen = unseenTargets(env, { ...attack, targets: v });
        return unseen.length ? v.filter((u) => !unseen.includes(u)) : v;
      },
    });
    r.contribute({
      id: 'asl.wall.entrenchedFirer',
      query: 'fire.illegal',
      ref: 'ASLRB B9.21',
      apply(v, { decl, mode, side, moving }, env) {
        if (v) return v;
        const firers = [...decl.units, ...decl.sw.map((w) => { const s = env.state.pieces[w]; return s?.loc.kind === 'held' ? s.loc.by : w; })];
        for (const f of firers) {
          const why = entrenchedFirerBlocked(env, f, decl.target);
          if (why) return why;
        }
        // Every enemy unit there beneath an entrenchment out of the firers' sight: nothing to attack.
        if (!env.query('los.hexsides', {}, []).length || !personnelAt(env, decl.target).some(isEntrenched)) return null;
        const all = buildAttackFor(env, decl, mode, side, moving);
        if (all.full.length && !all.seen.length) return `No LOS to the units beneath the entrenchment in ${decl.target}: the wall of its hex is between (ASLRB B9.21)`;
        return null;
      },
    });
    r.contribute({
      id: 'asl.wall.entrenchedGun',
      query: 'ordnance.illegal',
      ref: 'ASLRB B9.21',
      apply(v, { shot, side }, env) {
        if (v) return v;
        const g = env.state.pieces[shot.weapon];
        const firer = g?.loc.kind === 'held' ? g.loc.by : shot.weapon;
        const why = entrenchedFirerBlocked(env, firer, shot.target);
        if (why) return why;
        if (shot.targetType === 'ITT' && isGroundLoc(shot.target)) {
          const fl = g ? locOf(env.state, g) : null;
          const units = personnelAt(env, shot.target, otherSide(env.state, side));
          if (fl && units.length && units.every((p) => !!entrenchedWallBlock(env, p, fl))) return `No LOS to the units beneath the entrenchment in ${shot.target}: the wall of its hex is between (ASLRB B9.21)`;
        }
        return null;
      },
    });

    // ---------------------------------------------------------------- B29.5 HE; the wall TEM on ordnance (B29.3, B9.34, C3.33)
    // An ITT shot at a Location with no Known enemy unit may be aimed at the roadblock (B29.5); the reason when it cannot.
    r.contribute({
      id: 'asl.roadblock.target',
      query: 'ordnance.noUnitTarget',
      ref: 'ASLRB B29.5',
      apply(v, { shot, mode, side }, env) {
        if (!v || !isGroundLoc(shot.target)) return v;
        const hex = hexOfLoc(shot.target);
        const mine = roadblocks(env).filter((c) => c.hexside !== undefined && knownTo(c, side));
        const here = mine.filter((c) => c.hex === hex);
        if (!here.length) {
          const across = mine.find((c) => acrossSide(statics(env).map, c.hex, c.hexside!) === hex);
          return across ? `No Known enemy unit there; a Direct Fire attack on the roadblock is aimed at the centre dot of its counter's hex, ${across.hex} (ASLRB B29.5)` : v;
        }
        const sc = shotContext(env, shot, mode, side);
        if (sc.def.type === 'MTR') return v;
        if (sc.ammo !== 'HE') return `No Known enemy unit there, and only an HE attack can remove the roadblock (ASLRB B29.5)`;
        const o = roadblockObstacles(env).find((x) => x.id === here[0]!.id)!;
        if (!here.some((c) => roadblockLineCrosses(env, c, sc.hex))) return `No Known enemy unit there; the line to the roadblock must cross its hexside ${o.a}–${o.b}, before or after the centre dot of ${hex} (ASLRB B29.5)`;
        return null;
      },
    });
    r.contribute({
      id: 'asl.roadblock.also',
      query: 'ordnance.alsoAttacks',
      ref: 'ASLRB B29.5, B9.34',
      apply(v, sc, env) {
        const out = [...v];
        const known = heRoadblocks(env, sc).filter((x) => knownTo(x.c, sc.side));
        for (const { o, indirect } of known) {
          if (indirect) out.push(`A hit also attacks the roadblock ${o.a}–${o.b}: the same IFT DR +2 (its TEM only), removed by a KIA; units there take +1 for it (ASLRB B29.5, B9.34)`);
          else {
            const thn = toHitNumber(env, sc);
            const drm = roadblockThDrm(env, sc);
            if (thn) out.push(`Also attacks the roadblock ${o.a}–${o.b}: hit on an original TH DR ≤ ${thn.th - drm} (its own +2 TEM, not the units' DRM), removed by a KIA on the same IFT DR (ASLRB B29.5)`);
          }
        }
        if (!known.length && sc.ammo === 'HE' && sc.def.type !== 'MTR' && sc.shot.targetType === 'ATT' && isGroundLoc(sc.target) && roadblocks(env).some((c) => c.hex === hexOfLoc(sc.target) && knownTo(c, sc.side)))
          out.push('The roadblock is not attacked: Direct Fire at a roadblock uses the Infantry Target Type (ASLRB B29.5)');
        return out;
      },
    });
    // The wall TEM is a To Hit DRM on the Infantry Target Type (C3.33): the part every unit there shares goes on the DR.
    r.contribute({
      id: 'asl.roadblock.th',
      query: 'ordnance.thDrm',
      ref: 'ASLRB B29.3, B29.5, B9.31, C3.33',
      label: (sc, env) => `${thExtras(env, sc).common >= 0 ? '+' : ''}${thExtras(env, sc).common} wall TEM (roadblock, in place of the hex TEM)`,
      when: (sc, env) => ittShot(sc) && thExtras(env, sc).common !== 0,
      apply: (v, sc, env) => v + thExtras(env, sc).common,
    });
    // Behind the wall no FFMO (B9.33: only once the wall TEM is reduced to 0 in an otherwise Open Ground hex).
    r.suppress<'ordnance.thDrm'>({ id: 'asl.roadblock.th.noFfmo', query: 'ordnance.thDrm', target: 'sk2.th.ffmo', ref: 'ASLRB B9.33', label: 'no FFMO behind the roadblock', when: (sc, env) => ittShot(sc) && thExtras(env, sc).noFfmo });
    // On a Critical Hit the TEM is reversed (C3.7): the wall's part, beyond the hex TEM the base reverses.
    r.contribute({
      id: 'asl.roadblock.chReversed',
      query: 'fire.unitDrm',
      ref: 'ASLRB B29.3, C3.7',
      label: ({ attack, unit }, env) => `-${wallTemCore(env, attack, unit).delta} Critical Hit: wall TEM reversed`,
      when: ({ attack, unit }, env) => !!attack.ordnance?.ch && attack.ordnance.targetType === 'ITT' && !attack.ordnance.indirect && wallTemCore(env, attack, unit).delta > 0,
      apply: (v, { attack, unit }, env) => v - wallTemCore(env, attack, unit).delta,
    });
    r.contribute({
      id: 'asl.roadblock.indirect',
      query: 'fire.unitDrm',
      ref: 'ASLRB B9.34, B29.5',
      label: ({ attack, unit }, env) => `${indirectDelta(env, attack, unit) >= 0 ? '+' : ''}${indirectDelta(env, attack, unit)} roadblock TEM vs Indirect Fire (+1, in place of the in-hex TEM)`,
      when: ({ attack, unit }, env) => indirectDelta(env, attack, unit) !== 0,
      apply: (v, { attack, unit }, env) => v + indirectDelta(env, attack, unit),
    });
    // A hidden roadblock whose TEM went on the To Hit DR is revealed (A12.33).
    r.on<{ target: LocId; explain: { id: string }[] }>({
      id: 'asl.roadblock.thReveal',
      event: 'sk2.ordnance.shot',
      handler(ctx, ev) {
        if (!ev.payload.explain?.some((n) => n.id === 'asl.roadblock.th') || !isGroundLoc(ev.payload.target)) return;
        revealAround(ctx, hexOfLoc(ev.payload.target));
      },
    });
    // C3.32: one To Hit DR against each unit's own number; the roadblock is hit on its own number and shares the IFT DR (B29.5 EX).
    r.procedure<ResolveHitFn>(OP.resolveHit, (next) => (ctx, sc, h, targets, results) => {
      // B9.21: a Direct Fire shot does not reach units beneath an entrenchment it cannot see.
      const from = sc.loc ?? sc.hex;
      let kept = sc.def.type === 'MTR' ? targets : targets.filter((u) => !ctx.state.pieces[u] || !entrenchedWallBlock(ctx, ctx.state.pieces[u]!, from));
      const thn = toHitNumber(ctx, sc);
      if (h.hit && thn && ittShot(sc)) {
        const ex = thExtras(ctx, sc);
        const missed = targets.filter((u) => (ex.units[u] ?? ex.common) > ex.common && h.original + h.drm + (ex.units[u]! - ex.common) > thn.th);
        if (targets.some((u) => (ex.units[u] ?? ex.common) > ex.common)) revealAround(ctx, hexOfLoc(sc.target));
        if (missed.length) {
          ctx.emit('asl.roadblock.thMissed', { units: missed, final: h.original + h.drm, th: thn.th });
          kept = targets.filter((u) => !missed.includes(u));
        }
      }
      const rbs = heRoadblocks(ctx, sc);
      if (!rbs.length) return next!(ctx, sc, h, kept, results);
      const extraDie = ctx.query('ordnance.thExtra', { sc, dice: h.dice }, 0);
      const losClear = ctx.query('los.trace', { from: sc.loc ?? sc.hex, to: sc.target }, { clear: true, hindrance: 0, parts: [] }).clear;
      const rbDrm = rbs.some((x) => !x.indirect) ? roadblockThDrm(ctx, sc) : 0;
      const stash: { loc: LocId; dr?: number } = { loc: sc.target };
      heIft = stash;
      let cols: number[];
      try {
        cols = next!(ctx, sc, h, kept, results);
      } finally {
        heIft = null;
      }
      let dr = stash.dr;
      for (const { c, o, indirect } of rbs) {
        if (!fortCounters(ctx).some((x) => x.id === c.id)) continue;
        const final = h.original + rbDrm + extraDie;
        const hit = indirect ? h.hit : losClear && !!thn && final <= thn.th;
        const column = ammoColumn(ctx, sc.def, 'HE', indirect ? 'ATT' : 'ITT', false);
        if (!hit || column === null) {
          ctx.emit('asl.roadblock.he', { roadblock: c.id, a: o.a, b: o.b, indirect, ...(indirect ? {} : { th: thn?.th ?? null, final }), hit: false, kia: false });
          continue;
        }
        if (dr === undefined) dr = ctx.roll(`IFT vs roadblock ${o.a}–${o.b} (ASLRB B29.5)`).total;
        const iftFinal = dr + (indirect ? 2 : 0);
        const kia = statics(ctx).tables.ift(column, iftFinal).kind === 'KIA';
        ctx.emit('asl.roadblock.he', { roadblock: c.id, a: o.a, b: o.b, indirect, ...(indirect ? {} : { th: thn?.th ?? null, final }), hit: true, column, dr, iftFinal, kia });
        if (kia) removeFortification(ctx, c.id, `HE ${indirect ? 'Indirect Fire' : 'Direct Fire'}: IFT DR ${dr}${indirect ? ' +2' : ''}, KIA (ASLRB B29.5)`);
        else if (hiddenNow(c)) revealFortification(ctx, c.id, 'attack');
      }
      return cols;
    });

    // ---------------------------------------------------------------- B29.5: a DC Placed through the hexside
    // Against the roadblock the DC's Final DR is its Original DR plus the placer's CX: no wall TEM vs a DC (B9.3).
    r.procedure<AttackResolvedFn>(FP.attackResolved, (next) => (ctx, info) => {
      if (heIft && heIft.dr === undefined && info.by === 'he' && info.target === heIft.loc && info.originalDr !== undefined) heIft.dr = info.originalDr;
      next?.(ctx, info);
      if (info.by !== 'dc' || info.malfunctioned || info.originalDr === undefined || !isGroundLoc(info.target)) return;
      const placedFrom = (ctx.state.ext[DC_FROM] as Record<string, HexId> | undefined)?.[info.target];
      const c = placedFrom ? roadblockBetween(ctx, placedFrom, hexOfLoc(info.target)) : null;
      if (!c) return;
      const dc = Object.values(ctx.state.pieces).find((p) => p.loc.kind === 'hex' && locOf(ctx.state, p) === info.target && p.tags['dcPlacer'] !== undefined);
      const fp = dc ? (sw(ctx, dc)?.fp ?? 30) : 30;
      const column = iftColumn(ctx, fp);
      if (column === null) return;
      const final = info.originalDr + (dc?.tags['dcCx'] ? 1 : 0);
      if (statics(ctx).tables.ift(column, final).kind === 'KIA') removeFortification(ctx, c.id, `a DC Placed through its hexside: Final DR ${final}, KIA (ASLRB B29.5)`);
    });
    // Where each Placed DC came from (the placer's hex), for B29.5's "Placed through the roadblock hexside".
    r.event<{ target: LocId; from: HexId | null }>({
      type: 'asl.roadblock.dcFrom',
      apply(d, p) {
        const cur = { ...((d.ext[DC_FROM] as Record<string, HexId> | undefined) ?? {}) };
        if (p.from) cur[p.target] = p.from;
        else delete cur[p.target];
        if (Object.keys(cur).length) d.ext[DC_FROM] = cur;
        else delete d.ext[DC_FROM];
      },
    });
    r.on<{ dc: PieceId; placer: PieceId; target: LocId }>({
      id: 'asl.roadblock.dcPlaced',
      event: 'sk1.move.state',
      handler(ctx) {
        const ms = ctx.state.ext['sk1.move'] as { dcPending?: { target: LocId }; hex?: HexId | null } | undefined;
        const pend = ms?.dcPending;
        if (!pend || !ms?.hex) return;
        const cur = (ctx.state.ext[DC_FROM] as Record<string, HexId> | undefined)?.[pend.target];
        if (cur !== ms.hex && roadblockBetween(ctx, ms.hex, hexOfLoc(pend.target))) ctx.emit('asl.roadblock.dcFrom', { target: pend.target, from: ms.hex });
      },
    });
    r.on({
      id: 'asl.roadblock.dcFromGone',
      event: 'turn.playerTurn',
      handler(ctx) {
        for (const t of Object.keys((ctx.state.ext[DC_FROM] as Record<string, HexId> | undefined) ?? {})) ctx.emit('asl.roadblock.dcFrom', { target: t, from: null });
      },
    });
  },
};

const DC_FROM = 'asl.roadblock.dcFrom';
