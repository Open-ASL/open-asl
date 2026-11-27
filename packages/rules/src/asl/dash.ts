import type { Action, HexId, PieceId, QueryEnv, RuleModule } from '@asl/engine';
import { sideToward } from '../common/hexCorners';
import { hexOfLoc, isGroundLoc, locOf, type LocId } from '../common/location';
import { statics } from '../common/pieces';
import { PHASE_DECISION } from '../common/turn';
import { firerLos, partLoc, type FireAttackCtx, type FirePart } from '../sk1/fire';
import { knownEnemyAt } from '../sk1/known';
import { MOVE_ENTERED, moveInternals, moveState, type MoveEnteredFn, type MoveState } from '../sk1/movement';
import { pieceOf } from '../sk1/status';
import { inPlay, isRoadHex } from '../sk1/terrain';
import { shotContext, type ShotCtx } from '../sk2/ordnance';

/*
 * Dash (ASLRB A4.63, A10.531, A8.15 EX, A8.2; the To Hit chart's Case J). Full ASL only: no Dash anywhere in SK1–SK4.
 * - "Infantry may declare a Dash through a road Location if it declares a Dash move to a particular Location prior to moving
 *   [errata], and then moves from a non-Open Ground Location on one side of the road directly into the road and then
 *   directly into a non-Open Ground Location on the other side of the road provided the normal MF expenditure for this
 *   two-hex move is ≤ the unit's available MF." The declaration (`move.dash`) names the road hex and the end hex and takes
 *   the stack into the road hex at once; every member of the stack Dashes (Q&A [K33] to A4.12, A4.2 & A4.63).
 * - The sides of the road are the arcs of the road hex between its road hexsides (a road that ends in the hex is taken
 *   straight on through its centre): the start and end hexes lie in different arcs, neither across a road hexside, so the
 *   two are never adjacent and a route along the road is no Dash.
 * - No MF before it "[EXC: SMOKE grenade placement attempt; 24.1]"; "no MF in the road or the Dashed-to location beyond the
 *   minimum required to enter"; it "must end its MPh in the non-Open Ground Location it Dashed to". Not beneath an
 *   entrenchment (Q&A [K33]: a unit in a Trench across a road is not in the road), not in Bypass, not into an enemy
 *   Location (Q&A [K33] to A4.15 & A4.63), not by a stack pushing a Gun or using Assault Movement (one hex, A4.61).
 * - What both players see decides the declaration: the geometry and the MF (Q&A on the board 4 diagram). Whether a Dash
 *   qualifies is judged per DEFENDING unit: "For purposes of determining the legality of a Dash move, any Location out of
 *   the LOS of a firer is also considered a non-Open Ground Location"; "Dash First-Fire penalties may apply to some
 *   DEFENDERS but not to others" (A10.531: Open Ground is where that enemy unit could apply the -1 FFMO). A firer for which
 *   the start and the end Location are both non-Open Ground (terrain, out of its LOS, or a Hindrance on its LOS) suffers
 *   the penalties; an end hex of Open Ground terrain is no refusal, only a warning in the app.
 * - "All non-ordnance Defensive First Fire vs a Dashing unit in the road Location is considered Area Fire except for Fire
 *   Lanes and pre-existing Residual FP, but FFMO/FFNAM DRM apply normally": ×½, cumulative with any other Area Fire
 *   halving (a Snap Shot at the hexside into the road is quartered, A8.15 EX). Residual FP is never halved (A8.2). The
 *   unit is still Dashing from the road Location as it crosses the hexside into the end hex, so a Snap Shot at that hexside
 *   is halved for Dash as well; once in the end hex it is "Dashing only in BB7—not in the hex it is moving to" (EX 1).
 * - "A weapon with a specified CA may not fire on a Dashing unit in the road Location if it must change its CA to do so."
 * - "An ordnance weapon that can fire on the Dashing unit in the road Location must use the Case J To Hit DRM (Cases J3
 *   and J4 do not apply in the road Location)": +2, and no FFNAM/FFMO (cases 19) there.
 * - "unless it becomes berserk, pinned, broken or wounded in the road Location, or otherwise unable to enter the Dashed-to
 *   Location, in which case Dash benefits immediately cease": a unit stopped in the road is no longer Dashing, and an attack
 *   on it is not halved; a stack whose units cannot pay for the end Location may end its move in the road, without the
 *   benefits; one forced back by a hidden unit in the end Location (A12.15) ends its MPh in the road without them.
 *   A member whose leader fell may Double Time to go on (EX 2; `asl/doubleTime.ts`).
 * Not here: Fire Lanes (A9.22), Dash with Bypass of a woods-road or building-road hex (Q&A [J1]), Woods-Road and
 * Orchard-Road hexes as the road Location, concealment lost or a "?" blocking the end Location (A12.14, A12.15), berserk
 * Dash (A15.43), Armored Assault (D9.31), Human Wave, Column and Narrow Street (A25.232, E11.52, B6).
 */

export type DashAction = Action & { type: 'move.dash'; road: HexId; to: HexId };

/** Whether hexsides `s` and `e` of the road hex lie on opposite sides of its road: no way round from one to the other misses a road hexside. */
function oppositeSides(roadSides: number[], s: number, e: number): boolean {
  const reach = (dir: 1 | 5) => {
    for (let i = 1, k = (s + dir) % 6; i < 6; i++, k = (k + dir) % 6) {
      if (roadSides.includes(k)) return false;
      if (k === e) return true;
    }
    return false;
  };
  return !reach(1) && !reach(5);
}

/** The hexsides (0–5) of `road` along which its road runs; one hexside is extended straight through the centre (A4.63). */
export function roadSidesOf(env: QueryEnv, road: HexId): number[] {
  const map = statics(env).map;
  const sides = map
    .neighbors(road)
    .filter((n) => map.roadHexside?.(road, n))
    .map((n) => sideToward(map, road, n))
    .filter((k): k is number => k !== null);
  return sides.length === 1 ? [sides[0]!, (sides[0]! + 3) % 6] : sides;
}

/** Why a step from `from` across road hex `road` into `to` is not a Dash's route (A4.63), or null. */
export function dashGeometryIllegal(env: QueryEnv, from: HexId, road: HexId, to: HexId): string | null {
  const map = statics(env).map;
  if (!map.hex(road) || !isRoadHex(env, road)) return `${road} is not a road hex (ASLRB A4.63)`;
  if (!map.neighbors(from).includes(road)) return `${road} is not next to ${from}`;
  if (!map.hex(to) || !map.neighbors(road).includes(to) || to === from) return `${to} is not on the far side of ${road}`;
  const roadSides = roadSidesOf(env, road);
  const s = sideToward(map, road, from);
  const e = sideToward(map, road, to);
  if (s === null || e === null || roadSides.length < 2) return `${road} is not a road hex (ASLRB A4.63)`;
  if (roadSides.includes(s)) return 'A Dash starts beside the road, not on it (ASLRB A4.63)';
  if (roadSides.includes(e)) return 'A Dash crosses the road: it may not go on along it (ASLRB A4.63)';
  if (!oppositeSides(roadSides, s, e)) return `${to} is on the same side of the road as ${from} (ASLRB A4.63)`;
  return null;
}

/** The stack as it would stand in the road hex after the Dash's first step (for the second step's cost and refusals). */
function inRoad(ms: MoveState, road: HexId, cost: number): MoveState {
  const { level: _l, sub: _s, ent: _e, ...rest } = ms;
  return { ...rest, hex: road, from: ms.hex, spent: Object.fromEntries(ms.units.map((u) => [u, (ms.spent[u] ?? 0) + cost])), hexesEntered: ms.hexesEntered + 1, roadOnly: false, viaRoad: false, mfHere: cost, firedHere: {}, residualDrmHere: null };
}

/** The stack has spent no MF except on a SMOKE grenade attempt (A4.63 EXC, A24.1). */
const onlySmokeSpent = (ms: MoveState) => ms.hexesEntered === 0 && (ms.mfHere === 0 || (!!ms.smokeTriedBy?.length && (ms.trail?.length ?? 0) === 1));

/** Why the moving stack may not Dash across `road` to `to` now (A4.63), or null. */
export function dashIllegal(env: QueryEnv, road: HexId, to: HexId): string | null {
  const ms = moveState(env);
  if (env.state.phase !== 'MPh' || !ms) return 'No stack is moving';
  if (!ms.hex || ms.off) return 'A Dash starts on the map';
  if (ms.vehicle) return 'Only Infantry Dash (ASLRB A4.63)';
  if (ms.dash) return 'The stack has declared its Dash';
  if (ms.halted || ms.ending) return 'The stack has ended its movement';
  if (ms.assault) return 'Assault Movement is a move of one hex: no Dash (ASLRB A4.61, A4.63)';
  if (ms.manhandle) return 'No Dash while pushing a Gun (ASLRB A4.63, C10.3)';
  if (ms.bypass) return 'No Dash from Bypass (ASLRB A4.63)';
  if (ms.level || ms.sub) return 'A Dash starts at ground level (ASLRB A4.63)';
  if (ms.ent) return 'A unit beneath an entrenchment is not beside the road: no Dash (ASLRB A4.63)';
  if (ms.dcPending) return 'Finish the DC placement first';
  if (!onlySmokeSpent(ms)) return 'Already spent MF this MPh: a Dash is declared before moving (a SMOKE grenade attempt excepted, ASLRB A4.63)';
  if (!inPlay(env, road) || !inPlay(env, to)) return 'That hex is not in play';
  const geo = dashGeometryIllegal(env, ms.hex, road, to);
  if (geo) return geo;
  if (knownEnemyAt(env, to, env.state.attacker).length) return 'No Dash into an enemy Location (ASLRB A4.15, A4.63)';
  const first = moveInternals.stepRefusal(env, ms, road);
  if (first) return first;
  const c1 = env.query('move.stepCost', { ms, to: road }, 1);
  const there = inRoad(ms, road, c1);
  const c2 = env.query('move.stepCost', { ms: there, to }, 1);
  for (const u of ms.units) {
    const left = (ms.allowance[u] ?? 0) - (ms.spent[u] ?? 0);
    if (c1 + c2 > left) return `${u} lacks the MF (${left}) for the two-hex move (${c1} + ${c2}) (ASLRB A4.63)`;
  }
  return moveInternals.stepRefusal(env, there, to);
}

/** The Dashes the moving stack may declare: each road hex beside it and end hex beyond (with the two-hex cost), for the app. */
export function dashOptions(env: QueryEnv): { road: HexId; to: HexId; cost: number; openGround: boolean }[] {
  const ms = moveState(env);
  if (!ms?.hex || ms.dash) return [];
  const map = statics(env).map;
  const out: { road: HexId; to: HexId; cost: number; openGround: boolean }[] = [];
  for (const road of map.neighbors(ms.hex).filter((h) => isRoadHex(env, h)).sort()) {
    for (const to of map.neighbors(road).filter((h) => h !== ms.hex).sort()) {
      if (dashIllegal(env, road, to)) continue;
      const c1 = env.query('move.stepCost', { ms, to: road }, 1);
      out.push({ road, to, cost: c1 + env.query('move.stepCost', { ms: inRoad(ms, road, c1), to }, 1), openGround: env.query('hex.openGround', { hex: to }, false) });
    }
  }
  return out;
}

/** Whether `hex` is Open Ground to a firer in `from` (A10.531): Open Ground terrain it sees with no Hindrance (where FFMO would apply). */
function openGroundTo(env: QueryEnv, from: LocId, hex: HexId): boolean {
  if (!env.query('hex.openGround', { hex }, false)) return false;
  const los = firerLos(env, from, { target: hex });
  return los.clear && los.hindrance === 0;
}

/** Whether the stack's Dash qualifies against a firer in `from`: start and end non-Open Ground to it (A4.63, A10.531). */
export function dashQualifiesFor(env: QueryEnv, from: LocId, dash: NonNullable<MoveState['dash']>): boolean {
  return !openGroundTo(env, from, dash.from) && !openGroundTo(env, from, dash.to);
}

/**
 * The Dash a First Fire attack at `target` (all of `targets` Dashing) is subject to, or null: the stack is Dashing in the
 * road Location, or crossing the hexside out of it (`snap`), its benefits not lost.
 */
export function dashAt(env: QueryEnv, target: LocId, targets: PieceId[], snap: boolean): NonNullable<MoveState['dash']> | null {
  const ms = moveState(env);
  const d = ms?.dash;
  if (!ms || !d || d.void || ms.halted || ms.ending || !ms.hex || ms.level || ms.sub) return null;
  if (targets.length === 0 || !targets.every((u) => ms.units.includes(u))) return null;
  const inRoadNow = ms.hex === d.road && target === d.road;
  const leavingRoad = snap && ms.hex === d.to && ms.from === d.road && target === d.to;
  return inRoadNow || leavingRoad ? d : null;
}

const firstFireMode = (attack: Pick<FireAttackCtx, 'mode'>) => attack.mode === 'first' || attack.mode === 'subsequentFirst' || attack.mode === 'fpf';

/** A non-ordnance First Fire part halved for Dash (A4.63). */
export function dashHalves(env: QueryEnv, attack: FireAttackCtx, part: FirePart): boolean {
  if (!firstFireMode(attack) || attack.residual || attack.ordnance || part.kind === 'ordnance') return false;
  const d = dashAt(env, attack.target, attack.targets, !!attack.snap);
  return !!d && dashQualifiesFor(env, partLoc(env, part), d);
}

/** An ordnance First Fire shot at a Dashing unit in the road Location that the Dash qualifies against (A4.63). */
export function dashShot(env: QueryEnv, sc: ShotCtx): NonNullable<MoveState['dash']> | null {
  if (!firstFireMode(sc) || !sc.movingInfo || sc.shot.targetType === 'VTT') return null;
  const d = dashAt(env, sc.target, sc.moving ?? [], false);
  return d && dashQualifiesFor(env, sc.loc ?? locOf(env.state, pieceOf(env, sc.weapon)) ?? sc.hex, d) ? d : null;
}

export const DASH_EVENT = 'asl.move.dash';

export const aslDashModule: RuleModule = {
  id: 'asl.dash',
  ref: 'ASLRB A4.63, A10.531',
  summary: 'Dash across a road: declared to a Location, Area Fire and Case J against it in the road, no CA change to fire at it.',
  requires: ['sk1.movement', 'sk1.fire'],
  install(r) {
    r.event<{ units: PieceId[]; from: HexId; road: HexId; to: HexId }>({ type: DASH_EVENT, apply() {} });
    r.action<DashAction>({
      type: 'move.dash',
      decisionKinds: [PHASE_DECISION],
      legal: (env) => dashOptions(env).map(({ road, to }) => ({ type: 'move.dash', road, to })),
      validate: (env, a) => dashIllegal(env, a.road, a.to),
      resolve(ctx, a) {
        const ms = moveState(ctx)!;
        const dash = { from: ms.hex!, road: a.road, to: a.to };
        ctx.emit(DASH_EVENT, { units: [...ms.units], ...dash });
        const declared: MoveState = { ...ms, dash };
        ctx.emit('sk1.move.state', { state: declared });
        moveInternals.enter(ctx, declared, a.road, ctx.query('move.stepCost', { ms: declared, to: a.road }, 1));
      },
    });
    // In the road: the next step is the declared Location, nothing else (A4.63 "no other movement/MF-expenditure options").
    const locked = (ms: MoveState) => !!ms.dash && !ms.dash.void && ms.hex === ms.dash.road;
    const lockedWhy = (ms: MoveState) => `Dashing to ${ms.dash!.to} (ASLRB A4.63)`;
    r.contribute({
      id: 'asl.dash.step',
      query: 'move.stepIllegal',
      ref: 'ASLRB A4.63',
      apply: (v, { ms, to }) => v ?? (locked(ms) && !(isGroundLoc(to) && hexOfLoc(to) === ms.dash!.to) ? lockedWhy(ms) : null),
    });
    r.contribute({ id: 'asl.dash.no-bypass-steps', query: 'move.bypassSteps', ref: 'ASLRB A4.63', layer: 900, apply: (v, { ms }) => (ms.dash ? [] : v) });
    r.contribute({ id: 'asl.dash.no-bypass', query: 'move.bypassIllegal', ref: 'ASLRB A4.63', apply: (v, { ms }) => v ?? (ms.dash ? 'Dashing: no Bypass (ASLRB A4.63)' : null) });
    r.contribute({ id: 'asl.dash.no-smoke', query: 'move.smokeIllegal', ref: 'ASLRB A4.63', apply: (v, { ms }) => v ?? (ms.dash ? 'Dashing: no other MF expenditure (ASLRB A4.63)' : null) });
    r.contribute({ id: 'asl.dash.no-recover', query: 'recover.illegal', ref: 'ASLRB A4.63', apply: (v, _c, env) => v ?? (moveState(env)?.dash ? 'Dashing: no other MF expenditure (ASLRB A4.63)' : null) });
    r.contribute({ id: 'asl.dash.no-dc', query: 'dc.placeIllegal', ref: 'ASLRB A4.63', apply: (v, _c, env) => v ?? (moveState(env)?.dash ? 'Dashing: no other MF expenditure (ASLRB A4.63)' : null) });
    // It may stop in the road only when it cannot go on into the declared Location (A4.63, EX 2), losing the benefits.
    r.contribute({
      id: 'asl.dash.end',
      query: 'move.endIllegal',
      ref: 'ASLRB A4.63',
      apply: (v, { ms }, env) => v ?? (locked(ms) && !ms.vehicle && ms.units.length > 0 && !moveInternals.stepRefusal(env, ms, ms.dash!.to) ? `${lockedWhy(ms)}: it must end its MPh there` : null),
    });
    // In the declared Location its MPh is over (A4.63); the DEFENDER has his First Fire at that entry.
    r.procedure<MoveEnteredFn>(MOVE_ENTERED, (next) => (ctx, ms) => {
      next?.(ctx, ms);
      const cur = moveState(ctx);
      if (cur?.dash && cur.hex === cur.dash.to && !cur.halted) ctx.emit('sk1.move.state', { state: { ...cur, halted: true } });
    });
    // Area Fire (×½) at the Dashing unit in the road Location, for each firer the Dash qualifies against.
    r.contribute({
      id: 'asl.dash.area-fire',
      query: 'fire.partFp',
      layer: 200,
      ref: 'ASLRB A4.63',
      label: '×½ Dash (Area Fire, ASLRB A4.63)',
      when: ({ attack, part }, env) => dashHalves(env, attack, part),
      apply: (v) => v / 2,
    });
    // Ordnance: Case J (+2), and Cases J3/J4 (FFNAM/FFMO) do not apply there.
    r.contribute({
      id: 'asl.dash.case-j',
      query: 'ordnance.thDrm',
      ref: 'ASLRB A4.63, C6.1',
      label: '+2 Case J Dashing Infantry (ASLRB A4.63)',
      when: (sc, env) => !!dashShot(env, sc),
      apply: (v) => v + 2,
    });
    for (const target of ['sk2.th.ffnam', 'sk2.th.ffmo']) {
      r.suppress<'ordnance.thDrm'>({ id: `asl.dash.no.${target}`, query: 'ordnance.thDrm', target, ref: 'ASLRB A4.63', label: 'Dash: Case J3/J4 NA', when: (sc, env) => !!dashShot(env, sc) });
    }
    // No CA change to fire at the Dashing unit in the road Location.
    r.contribute({
      id: 'asl.dash.no-ca-change',
      query: 'ordnance.illegal',
      layer: 50,
      ref: 'ASLRB A4.63',
      apply(v, { shot, mode, side, moving }, env) {
        if (v || shot.ca === undefined || !moving?.length) return v;
        if (mode !== 'first' && mode !== 'subsequentFirst' && mode !== 'fpf') return v;
        const d = dashAt(env, shot.target, moving, false);
        if (!d) return v;
        const from = locOf(env.state, pieceOf(env, shot.weapon));
        if (!from || !dashQualifiesFor(env, from, d)) return v;
        return shotContext(env, shot, mode, side).spines > 0 ? 'Must change CA to fire at a Dashing unit (ASLRB A4.63)' : v;
      },
    });
  },
};
