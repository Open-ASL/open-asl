import type { Action, Ctx, Decision, HexId, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { adjacentLocs, hexOfLoc, isGroundLoc, locKey, type LocId } from '../common/location';
import { acrossSide, cornerHexes, mod6 } from '../common/hexCorners';
import { hexPixel } from '../common/map';
import { byId, otherSide, personnelAt, statics } from '../common/pieces';
import { PHASE_DECISION, askPhaseOwner } from '../common/turn';
import { AP, type AdvanceEnterFn } from '../sk1/advance';
import { FP, discloseDrm, iftColumn, withoutSecrets, type ApplyResultFn, type AttackResolvedFn, type BeforeApplyFn, type FireAttackCtx } from '../sk1/fire';
import { FPP, type ResolveDcFn } from '../sk1/firePhases';
import { fortifiableBuildings, fortifiableLocations, fortifiedKnownTo, fortifiedParams, fortifiedState, isFortified, revealFortified } from '../sk1/fortified';
import { knownEnemyAt } from '../sk1/known';
import { P as MP, type FlushFn } from '../sk1/morale';
import { MOVE_ENTER, MOVE_FINISH, leftUnits, moveInternals, moveLoc, moveState, type MoveEnterFn, type MoveFinishFn, type MoveState } from '../sk1/movement';
import { drmNotes, gun, isGoodOrder, isPinned, mmc, pieceOf, setTags, squadEquivalents, sw } from '../sk1/status';
import { revealHex } from '../sk2/hip';
import { T4 } from '../sk4/status';
import { hasWa } from './wallAdvantage';

/*
 * Fortified Building Locations in full ASL (ASLRB B23.9), beyond the shared designation and +1 TEM of
 * `sk1/fortified.ts`:
 *
 * - B23.922 ENTRY: Infantry may not enter a Fortified Building Location, in any phase, while an unpinned, Good Order,
 *   armed enemy squad (or its equivalent) is inside, unless through a Breach. A unit that attempts to loses that MPh
 *   (its MF are spent in its present hex, where it may be fired on, and its move is over) or APh (it stays put, its
 *   advance used up). The attempt reveals the Location (B23.911) and anything hidden inside (A12.15 applies "even
 *   though the Fortified Location cannot be entered"). A Location whose fortification the moving side has already
 *   seen is refused up front, with the reason; one it has not seen is never refused by legality, so that no refusal
 *   leaks the secret to a client that validates on its own, redacted view: the attempt is resolved and refused.
 * - B23.9221 BREACH: unpinned Good Order Infantry with a DC may Place it against a hexside of a Fortified Location
 *   for one MF (B23.711), declaring the hexside (the one toward its own hex, at its own level). In the AFPh one DR
 *   resolves the DC against the hexside (30 FP, the Location's TEM with the fortification's +1, CX) and, as Area Fire
 *   with the same DR, against the units inside (the A23.3 example). A NMC or better Breaches the hexside; an Original
 *   12 (10 captured) does neither. Nothing in B23.711 or B23.9221 asks the attacker to know the Location is fortified
 *   (official Q&A [K33] to A23.3, B23.711 & B23.9221: "the attempt can be made regardless"; against a Location that is
 *   not fortified the DC is "resolved with the same strength ... using Area Fire, but with no breach possible"). So
 *   the attempt is offered against any building Location the attacker cannot rule out (`fortifiedPossibleTo`), and
 *   nothing the attacker is shown tells the two apart until the DR decides: the hexside's DR always takes the
 *   Fortified TEM (B23.921 "including vs DC Breach attempt"), and the Area Fire at the units shows the fortification's
 *   +1 only when it changes a result (B23.911). A DR that Breaches a Fortified Location places the Breach, which shows
 *   the Location; the same DR against one that is not fortified Breaches nothing, which shows the attacker that it is
 *   not (recorded, so it is no longer offered); any other DR shows nothing. A hexside is also Breached by the line of fire of a HE attack whose
 *   Final IFT DR is a KIA (ordnance and on-board mortar HE; the firer chooses one of the two hexsides along a
 *   hexspine). A Breach of a Location the firer has not been shown to be fortified stays secret with it (B23.911): the
 *   firer is asked along a hexspine whenever the Location might be fortified, as far as he knows, and the record and
 *   its event show the other side a Breach only once the Location is revealed. A Breach lasts the game and lets either
 *   side through that hexside at that level; every other
 *   benefit of the fortification remains. A plain DC may still be Placed on a Fortified Location at the building's
 *   entry cost, whether or not the placer could enter it.
 * - B23.93 GUNS: any Gun may set up in a fortified ground Location; ART/AT/INF Guns of at most 76mm may set up at a
 *   fortified upper level of a stone multi-level building, and never move from it; no Gun may be moved into a
 *   Fortified Building Location during play. A mortar there has no Indirect Fire, which the shared rule that a
 *   mortar may not fire from a building already covers.
 * - A12.151 BYPASS: going round a fortified hex in Bypass is not entering it. A unit forced to end its MPh in Bypass
 *   there (broken, pinned, stranded) is in the obstacle after its MPh (A4.32, A4.33); if that Location is fortified and
 *   held by an enemy squad it cannot enter, it is forced back to the last Location it previously occupied that it may
 *   enter (A12.151 "e.g., a Fortified Building Location containing an enemy squad"), and the Location is revealed.
 * - Elsewhere: B23.94 (a Flame in a fortified Location, -1 DRM) is in `asl/fire.ts`; B24.3/B24.5 (the rubble of a
 *   fortified building has no fortification) in `asl/rubble.ts`.
 * - Not here: the reveal by Searching, Mopping Up and Snipers (A12.152, A12.153, A14.21: with those rules) and a
 *   berserk unit's charge (A15.43).
 */

declare module '@asl/engine' {
  interface QueryCatalog {
    /** The Breach records in play (B23.9221). */
    'fortified.breaches': { ctx: Record<string, never>; value: Breach[] };
  }
}

/** A breached hexside: of `loc`, toward the adjacent hex `toward` (at `loc`'s level). */
export interface Breach {
  loc: LocId;
  toward: HexId;
  by: 'dc' | 'he';
}

const EXT = 'asl.breach';
/** Locations a Breach DR has shown not to be fortified (B23.9221 with B23.911): public, both sides know it. */
const UNFORTIFIED = 'asl.breach.unfortified';
/** A hexspine Breach choice waiting for the firing action to finish (its decision goes on top of whatever it asks next). */
const PENDING = 'asl.breach.pending';
export const BREACH_SIDE_DECISION = 'breachSide';

export const breaches = (env: QueryEnv): Breach[] => (env.state.ext[EXT] as Breach[] | undefined) ?? [];

/** The Breaches `viewer` may know of: those of Locations it knows are fortified (B23.911). */
export const breachesKnownTo = (env: QueryEnv, viewer: SideId | null): Breach[] => breaches(env).filter((b) => fortifiedKnownTo(env, b.loc, viewer));

/**
 * Whether `side` may believe `loc` is fortified, judged only on what it may know: a Location it has been shown, or one
 * of the fortifying side's that it cannot rule out (the designation is secret, B23.911, until all of them are shown).
 */
export function fortifiedPossibleTo(env: QueryEnv, loc: LocId, side: SideId): boolean {
  const st = fortifiedState(env);
  if (!st) return false;
  if (fortifiedKnownTo(env, loc, side)) return true;
  if (side === st.side) return false;
  const count = fortifiedParams(env)?.count ?? 0;
  const map = statics(env).map;
  const ruledOut = shownUnfortified(env);
  if (st.locations) return (st.revealedLocs ?? []).length < count && fortifiableLocations(env, st.side).includes(loc) && !ruledOut.includes(loc);
  const b = map.hex(hexOfLoc(loc))?.buildingId;
  // A building-wide designation: one Location shown not fortified shows its whole building.
  return !!b && st.revealed.length < count && fortifiableBuildings(env, st.side).includes(b) && !ruledOut.some((l) => map.hex(hexOfLoc(l))?.buildingId === b);
}

/** The Locations a Breach DR has shown not to be fortified (B23.9221). */
export const shownUnfortified = (env: QueryEnv): LocId[] => (env.state.ext[UNFORTIFIED] as LocId[] | undefined) ?? [];

/** Whether the hexside between `loc` and the adjacent hex `from` has been Breached. */
export const breachedToward = (env: QueryEnv, loc: LocId, from: HexId): boolean => breaches(env).some((b) => b.loc === loc && b.toward === from);

/** The hexes a stack would be entering `to` from: its own hex, or the two hexes at its Bypass corner (A4.3). */
function entryHexes(env: QueryEnv, ms: MoveState, to: LocId): HexId[] {
  if (ms.bypass && ms.bypass.hex === hexOfLoc(to)) return cornerHexes(statics(env).map, ms.bypass.hex, ms.bypass.at);
  return ms.hex ? [ms.hex] : [];
}

/**
 * A12.151: units whose MPh ends in Bypass of a fortified hex are then in the obstacle (A4.32, A4.33); if that Location
 * cannot be entered (B23.922: held by an enemy squad, no Breach on a hexside they went along) they are "forced back to
 * the last previously occupied Location it may enter". The attempt reveals the Location and what hides in it (B23.911,
 * A12.15), as an entry attempt does.
 */
function forceBackFromBypass(ctx: Ctx, ms: MoveState, units: PieceId[]) {
  const hex = ms.hex!;
  const side = ctx.state.attacker;
  const here = units.filter((u) => ctx.state.pieces[u]?.loc.kind === 'hex' && locKey(ctx.state.pieces[u]!.loc as never) === hex);
  if (here.length === 0 || !fortifiedState(ctx) || fortifiedState(ctx)!.side === side || !isFortified(ctx, hex)) return;
  const map = statics(ctx).map;
  const sides = new Set<number>([...(ms.bypass && ms.bypass.hex === hex ? ms.bypass.sides : []), ...here.flatMap((u) => ms.stoppedBypass?.[u] ?? [])]);
  const along = [...sides].map((k) => acrossSide(map, hex, k)).filter((h): h is HexId => !!h);
  if (fortifiedEntryBarred(ctx, hex, side, along, false) === null) {
    // In the obstacle after its MPh (A4.32, A4.33): the Location has been entered (B23.911).
    revealFortified(ctx, hex, 'entered');
    return;
  }
  revealFortified(ctx, hex, 'attempt');
  revealHex(ctx, hex, side, 'entered', hex);
  // The last Location occupied before this hex that the units may enter: back along the hexes of the move.
  const before = [ms.from, ...[...(ms.trail ?? [])].reverse().map((t) => t.hex)].filter((h): h is HexId => !!h && h !== hex && !!map.hex(h));
  const back = [...new Set(before)].find((h) => knownEnemyAt(ctx, h, side).length === 0 && fortifiedEntryBarred(ctx, h, side, [hex], false) === null);
  ctx.emit('asl.fortified.refused', { units: here, loc: hex, phase: 'MPh', side, reason: 'held' });
  if (!back) return;
  for (const u of here) ctx.emit('piece.moved', { id: u, loc: { kind: 'hex', hex: back } });
}

/** Unpinned, Good Order, armed enemy MMC in `loc` totalling at least a squad (B23.922 "a squad (or its equivalent)"). */
export function heldBySquad(env: QueryEnv, loc: LocId, side: SideId, knownOnly = false): boolean {
  const enemy = otherSide(env.state, side);
  const there = knownOnly ? knownEnemyAt(env, loc, side) : personnelAt(env, loc, enemy);
  // A squad claiming Wall Advantage no longer holds the Location against entry (official Q&A to B23.922 [An95w; An96]:
  // an enemy unit may advance in "if the squad is still marked with a Wall Advantage counter").
  const good = there.filter((p) => mmc(env, p) && isGoodOrder(env, p) && !isPinned(p) && !hasWa(env, p));
  return squadEquivalents(env, good) >= 1;
}

/**
 * Why Infantry may not enter `loc` from `from` (B23.922), or null. `known`: judge only by what `side` has seen (for
 * legality), else by the real state (for the attempt).
 */
export function fortifiedEntryBarred(env: QueryEnv, loc: LocId, side: SideId, from: HexId[], known: boolean): string | null {
  if (known ? !fortifiedKnownTo(env, loc, side) : !isFortified(env, loc)) return null;
  if (!heldBySquad(env, loc, side, known)) return null;
  if (from.some((h) => breachedToward(env, loc, h))) return null;
  return 'A Fortified Building Location held by an unpinned Good Order enemy squad cannot be entered: Breach it, or pin, break or reduce them first (ASLRB B23.922)';
}

/**
 * The hexside(s) of `target` the line of fire from `from` crosses: one, or the two either side of a corner when the
 * line runs along a hexspine (B23.9221: the firer chooses). Hexside k runs from corner k to corner k + 1, corners
 * clockwise from the east; a corner lies at 60k degrees from the hex centre (y down).
 */
export function lofSides(target: HexId, from: HexId, map: { hex(id: HexId): { cube: { q: number; r: number; s: number } } | undefined }): number[] {
  const a = map.hex(target);
  const b = map.hex(from);
  if (!a || !b) return [];
  const pa = hexPixel(a.cube);
  const pb = hexPixel(b.cube);
  let deg = (Math.atan2(pb.y - pa.y, pb.x - pa.x) * 180) / Math.PI;
  deg = ((deg % 360) + 360) % 360;
  const k = Math.round(deg / 60);
  if (Math.abs(deg - k * 60) < 0.5) return [mod6(k - 1), mod6(k)];
  return [Math.floor(deg / 60) % 6];
}

export const aslFortifiedModule: RuleModule = {
  id: 'asl.fortified',
  ref: 'ASLRB B23.9, B23.911, B23.922, B23.9221, B23.711, B23.93',
  summary: 'Fortified Building Locations: no entry while an enemy squad holds one, Breach by DC or HE KIA, Guns in them.',
  requires: ['asl.locations', 'sk1.movement', 'sk1.advance', 'sk1.firePhases'],
  install(r) {
    r.event<{ breach: Breach }>({
      type: 'asl.breach',
      apply(d, p) {
        const list = (d.ext[EXT] as Breach[] | undefined) ?? [];
        if (!list.some((b) => b.loc === p.breach.loc && b.toward === p.breach.toward)) d.ext[EXT] = [...list, p.breach];
      },
    });
    // A HE KIA's Breach (B23.9221), recorded whether or not the Location is fortified so that the other side cannot tell
    // the two apart: `breached` only when it is.
    r.event<{ loc: LocId; toward: HexId; breached: boolean }>({
      type: 'asl.breach.he',
      apply(d, p) {
        const list = (d.ext[EXT] as Breach[] | undefined) ?? [];
        d.ext[EXT] = p.breached && !list.some((b) => b.loc === p.loc && b.toward === p.toward) ? [...list, { loc: p.loc, toward: p.toward, by: 'he' }] : list;
      },
    });
    // What a viewer may see of the Breaches: those of the Locations it knows are fortified (B23.911).
    r.redact({
      id: 'asl.breach.redact',
      ext: EXT,
      redactExt: (slice, viewer, env) => (slice as Breach[]).filter((b) => fortifiedKnownTo(env, b.loc, viewer)),
      events: ['asl.breach.he'],
      redactEvent(ev, viewer, env) {
        const p = ev.payload as { loc: LocId; breached: boolean };
        return p.breached && !fortifiedKnownTo(env, p.loc, viewer) ? { ...ev, payload: { ...p, breached: false } } : ev;
      },
    });
    r.event<{ dc: PieceId; placer: PieceId; loc: LocId; toward: HexId }>({ type: 'asl.breach.declared', apply() {} });
    // `unfortified`: the DR would have Breached a Fortified Location, and Breached nothing (B23.9221).
    r.event<{ dc: PieceId; loc: LocId; toward: HexId; dr: [number, number]; drm: number; result: string | null; breached: boolean; malfunctioned: boolean; unfortified?: true }>({
      type: 'asl.breach.attempt',
      apply(d, p) {
        if (!p.unfortified) return;
        const list = (d.ext[UNFORTIFIED] as LocId[] | undefined) ?? [];
        if (!list.includes(p.loc)) d.ext[UNFORTIFIED] = [...list, p.loc].sort();
      },
    });
    r.event<{ units: PieceId[]; loc: LocId; phase: 'MPh' | 'APh'; side: SideId; reason: 'held' | 'gun' }>({ type: 'asl.fortified.refused', apply() {} });
    r.contribute({ id: 'asl.fortified.breaches', query: 'fortified.breaches', layer: 0, apply: (_v, _c, env) => breaches(env) });

    // ---------------------------------------------------------------- B23.922: entry in the MPh
    // A Location the moving side knows is fortified: a Gun push is refused up front (B23.93). Infantry entering a held
    // Location is already refused by A4.14 when the occupants are Known; hidden occupants are found by the attempt.
    r.contribute({
      id: 'asl.fortified.gun-push',
      query: 'move.stepIllegal',
      ref: 'ASLRB B23.93',
      when: ({ ms, to }, env) => !!ms.manhandle && fortifiedKnownTo(env, to, env.state.attacker),
      apply: () => 'No Gun may be moved into a Fortified Building Location during play (ASLRB B23.93)',
    });
    r.procedure<MoveEnterFn>(MOVE_ENTER, (next) => (ctx, ms, to, cost, woods, extra) => {
      const side = ctx.state.attacker;
      // Going round the hex in Bypass is not entering it (A4.3); a vehicle is not Infantry (B23.41 governs it).
      if (extra?.bypass || ms.vehicle || !fortifiedState(ctx) || !isFortified(ctx, to)) return next?.(ctx, ms, to, cost, woods, extra);
      const gunPush = !!ms.manhandle;
      const barred = gunPush || fortifiedEntryBarred(ctx, to, side, entryHexes(ctx, ms, to), false) !== null;
      if (!barred) return next?.(ctx, ms, to, cost, woods, extra);
      // The attempt reveals the Location (B23.911) and what hides in it (A12.15); the MF are spent in the present
      // hex, where Residual FP, Defensive First Fire, SFF and FPF may attack the stack, and then its MPh is over.
      revealFortified(ctx, to, 'attempt');
      revealHex(ctx, hexOfLoc(to), side, 'entered', to);
      ctx.emit('asl.fortified.refused', { units: ms.units, loc: to, phase: 'MPh', side, reason: gunPush ? 'gun' : 'held' });
      moveInternals.spendInPlace(ctx, moveState(ctx) ?? ms, cost, { halted: true, residualDrmHere: null });
      moveInternals.afterMfExpenditure(ctx);
      const after = moveState(ctx);
      if (after && ctx.state.decisions[ctx.state.decisions.length - 1]?.kind !== 'firstFire') {
        moveInternals.finishStack(ctx);
        moveInternals.reAskMover(ctx);
      }
    });

    // A12.151: the end of the MPh of units still in Bypass (stranded with the stack, or broken or pinned there).
    r.procedure<MoveFinishFn>(MOVE_FINISH, (next) => (ctx) => {
      const ms = moveState(ctx);
      // Units left in Bypass of a hex the stack moved on from stay in its open part until the end of their MPh (A4.32,
      // A4.33): now, each in the hex it was left in, with the hexes the stack had come by up to there.
      for (const r of ms?.leftBypass ?? []) {
        const units = leftUnits(ctx, r);
        if (units.length) forceBackFromBypass(ctx, { ...ms!, hex: r.hex, bypass: undefined, stoppedBypass: r.units, from: r.from, trail: (ms!.trail ?? []).slice(0, r.trailAt) }, units.sort());
      }
      if (ms?.hex && !ms.vehicle) forceBackFromBypass(ctx, ms, [...(ms.bypass ? ms.units : []), ...Object.keys(ms.stoppedBypass ?? {})].sort());
      next?.(ctx);
    });

    // ---------------------------------------------------------------- B23.922: entry in the APh
    r.contribute({
      id: 'asl.fortified.advance',
      query: 'advance.illegal',
      ref: 'ASLRB B23.922',
      when: ({ units, to, side }, env) => {
        const from = units.map((u) => env.state.pieces[u]).filter((p) => p?.loc.kind === 'hex').map((p) => (p!.loc as { hex: HexId }).hex);
        return !!fortifiedState(env) && fortifiedEntryBarred(env, to, side, [...new Set(from)], true) !== null;
      },
      apply: (_v, { units, to, side }, env) => {
        const from = units.map((u) => env.state.pieces[u]).filter((p) => p?.loc.kind === 'hex').map((p) => (p!.loc as { hex: HexId }).hex);
        return fortifiedEntryBarred(env, to, side, [...new Set(from)], true);
      },
    });
    r.procedure<AdvanceEnterFn>(AP.enter, (next) => (ctx, a) => {
      const map = statics(ctx).map;
      if (!fortifiedState(ctx) || !map.hex(hexOfLoc(a.to)) || !isFortified(ctx, a.to)) return next?.(ctx, a);
      const from = [...new Set(a.units.map((u) => pieceOf(ctx, u)).filter((p) => p.loc.kind === 'hex').map((p) => (p.loc as { hex: HexId }).hex))];
      if (fortifiedEntryBarred(ctx, a.to, a.side, from, false) === null) return next?.(ctx, a);
      // "loses that APh capability for that turn and must remain in its present hex": every unit of the attempt.
      revealFortified(ctx, a.to, 'attempt');
      revealHex(ctx, hexOfLoc(a.to), a.side, 'advanced', a.to);
      ctx.emit('asl.fortified.refused', { units: [...a.units].sort(), loc: a.to, phase: 'APh', side: a.side, reason: 'held' });
      for (const id of [...a.units].sort()) setTags(ctx, id, { advanced: true });
      ctx.popDecision();
      askPhaseOwner(ctx, ctx.state.attacker);
    });

    // A Breach attempt is something a moving stack may still do where it stands (the move.breach check).
    r.contribute({
      id: 'asl.fortified.more-to-do',
      query: 'move.moreToDo',
      ref: 'ASLRB B23.9221',
      apply(v, _ctx, env) {
        if (v) return v;
        const ms = moveState(env);
        if (!ms || !ms.hex || ms.bypass || ms.dcPending || !fortifiedState(env)) return false;
        return ms.units.some((u) =>
          Object.values(env.state.pieces).some((p) => p.loc.kind === 'held' && p.loc.by === u && sw(env, p)?.type === 'DC' && adjacentLocs(env, moveLoc(ms)!).some((t) => !breachIllegal(env, ms, p.id, t))),
        );
      },
    });

    // ---------------------------------------------------------------- B23.9221: a Breach attempt with a DC
    r.action<Action & { type: 'move.breach'; dc: PieceId; target: LocId }>({
      type: 'move.breach',
      decisionKinds: [PHASE_DECISION],
      legal(env) {
        const ms = moveState(env);
        if (!ms || !ms.hex || ms.bypass || ms.dcPending || !fortifiedState(env)) return [];
        const out: { type: 'move.breach'; dc: PieceId; target: LocId }[] = [];
        for (const u of ms.units) {
          for (const dc of Object.values(env.state.pieces).filter((p) => p.loc.kind === 'held' && p.loc.by === u && sw(env, p)?.type === 'DC').sort(byId)) {
            for (const target of adjacentLocs(env, moveLoc(ms)!)) {
              if (!breachIllegal(env, ms, dc.id, target)) out.push({ type: 'move.breach', dc: dc.id, target });
            }
          }
        }
        return out;
      },
      validate(env, a) {
        const ms = moveState(env);
        if (!ms || !ms.hex) return 'No stack is moving on the map';
        return breachIllegal(env, ms, a.dc, a.target);
      },
      resolve(ctx, a) {
        const ms = moveState(ctx)!;
        const placer = (pieceOf(ctx, a.dc).loc as { by: PieceId }).by;
        // The attempt itself shows nothing of the Location: it may be made whether or not it is fortified (B23.9221).
        ctx.emit('asl.breach.declared', { dc: a.dc, placer, loc: a.target, toward: ms.hex! });
        // One MF, spent in the placer's hex (B23.711; the DC is operably Placed once the stack has survived the fire there).
        moveInternals.spendInPlace(ctx, ms, 1, { dcPending: { dc: a.dc, placer, target: a.target, breach: ms.hex! } });
        moveInternals.afterMfExpenditure(ctx);
      },
    });
    r.procedure<ResolveDcFn>(FPP.resolveDc, (next) => (ctx, dc) => {
      const toward = dc.tags['dcBreach'] as HexId | undefined;
      if (!toward) return next?.(ctx, dc);
      resolveBreachDc(ctx, dc, toward);
    });

    // ---------------------------------------------------------------- B23.9221: a Breach by a HE KIA
    r.procedure<AttackResolvedFn>(FP.attackResolved, (next) => (ctx, info) => {
      next?.(ctx, info);
      // Everything up to the event is decided on what the firer may know, so that nothing it is shown or asked tells
      // it whether a Location it has not been shown is fortified (B23.911).
      if (info.by !== 'he' || info.result !== 'KIA' || !info.from || !info.side || !fortifiedPossibleTo(ctx, info.target, info.side)) return;
      const map = statics(ctx).map;
      const target = hexOfLoc(info.target);
      const sides = lofSides(target, info.from, map);
      const known = breachesKnownTo(ctx, info.side);
      const options = sides.map((k) => acrossSide(map, target, k)).filter((h): h is HexId => !!h && !!map.hex(h) && !known.some((b) => b.loc === info.target && b.toward === h));
      if (options.length === 0) return;
      if (options.length === 1) {
        ctx.emit('asl.breach.he', { loc: info.target, toward: options[0]!, breached: isFortified(ctx, info.target) });
        return;
      }
      // Along a hexspine: the firer chooses which of the two hexsides at that corner is Breached. The choice is asked once
      // the firing action has put its next decision up (it pops and re-asks its own when the shot is over), so that the
      // question sits on top.
      ctx.emit('asl.breach.pending', { pending: { loc: info.target, options, owner: info.side } });
    });
    r.event<{ pending: { loc: LocId; options: HexId[]; owner: SideId } | null }>({
      type: 'asl.breach.pending',
      apply(d, p) {
        if (p.pending) d.ext[PENDING] = p.pending;
        else delete d.ext[PENDING];
      },
    });
    r.on<{ decision: Decision }>({
      id: 'asl.breach.ask',
      event: 'decision.pushed',
      handler(ctx, ev) {
        const pending = ctx.state.ext[PENDING] as { loc: LocId; options: HexId[]; owner: SideId } | undefined;
        if (!pending || ev.payload.decision.kind === BREACH_SIDE_DECISION) return;
        ctx.emit('asl.breach.pending', { pending: null });
        // `known`: the firer knows the Location is fortified; else it is asked as for any Location that might be.
        ctx.pushDecision({ kind: BREACH_SIDE_DECISION, owner: pending.owner, deadlineClass: 'interrupt', data: { loc: pending.loc, options: pending.options, known: fortifiedKnownTo(ctx, pending.loc, pending.owner) } });
      },
    });
    r.action<Action & { type: 'breach.choose'; toward: HexId }>({
      type: 'breach.choose',
      decisionKinds: [BREACH_SIDE_DECISION],
      legal(_env, d) {
        return ((d.data?.['options'] as HexId[] | undefined) ?? []).map((toward) => ({ type: 'breach.choose', toward }));
      },
      validate: (_env, a, d) => (((d.data?.['options'] as HexId[] | undefined) ?? []).includes(a.toward) ? null : 'Not one of the hexsides the line of fire crossed'),
      resolve(ctx, a, d: Decision) {
        const loc = d.data!['loc'] as LocId;
        ctx.emit('asl.breach.he', { loc, toward: a.toward, breached: isFortified(ctx, loc) });
        ctx.popDecision(d.id);
      },
    });

    // ---------------------------------------------------------------- B23.93: Guns
    r.contribute({
      id: 'asl.fortified.gun-setup',
      query: 'gun.setupIllegal',
      layer: 100,
      ref: 'ASLRB B23.93',
      apply(v, { gun: id, loc }, env) {
        if (!v || !fortifiedState(env) || !isFortified(env, loc)) return v;
        if (isGroundLoc(loc)) return null;
        // An upper level: ART/AT/INF Guns of at most 76mm, in a stone multi-level building.
        const d = gun(env, pieceOf(env, id))!;
        const hex = statics(env).map.hex(hexOfLoc(loc));
        const stone = hex?.terrain === 'building-stone';
        return (d.type === 'ART' || d.type === 'AT' || d.type === 'INF') && d.caliber <= 76 && stone ? null : `${id}: only an ART/AT/INF Gun of at most 76mm may set up in the fortified upper level of a stone building (ASLRB B23.93)`;
      },
    });
    r.contribute({
      id: 'asl.fortified.gun-fixed',
      query: 'move.cannotStart',
      ref: 'ASLRB B23.93',
      apply(v, { units }, env) {
        if (v) return v;
        for (const u of units) {
          const g = Object.values(env.state.pieces).find((p) => p.loc.kind === 'held' && p.loc.by === u && gun(env, p));
          const at = g ? pieceOf(env, u).loc : null;
          if (g && at?.kind === 'hex' && at.level) return `${g.id} was set up in a fortified upper level and cannot be moved from it (ASLRB B23.93)`;
        }
        return null;
      },
    });
  },
};

/** Why a Breach attempt is illegal (B23.711, B23.9221, A23.3), or null. */
export function breachIllegal(env: QueryEnv, ms: MoveState, dcId: PieceId, target: LocId): string | null {
  const dc = env.state.pieces[dcId];
  if (!dc || dc.loc.kind !== 'held' || !ms.units.includes(dc.loc.by) || sw(env, dc)?.type !== 'DC') return 'No DC carried by the moving stack';
  if (ms.bypass) return 'A Breach attempt is made from a hex, not from Bypass';
  const placer = pieceOf(env, dc.loc.by);
  if (!isGoodOrder(env, placer) || isPinned(placer)) return 'Only unpinned Good Order Infantry may attempt a Breach (ASLRB B23.711)';
  if (ms.dcPending) return 'A DC placement is already in progress';
  if (hexOfLoc(target) === ms.hex) return 'A stairwell is not a hexside: a Breach is made from the next hex at the same level (ASLRB B23.9221)';
  if (!adjacentLocs(env, moveLoc(ms)!).includes(target)) return 'The hexside must be one of the placer’s own Location (ADJACENT, at the same level)';
  if (!fortifiedState(env)) return 'No building here can be fortified: a Breach is made only in a Fortified Building Location (ASLRB B23.9221)';
  if (!fortifiedPossibleTo(env, target, env.state.attacker)) return 'That Location is not fortified, as far as your side can tell: a Breach is made only in a Fortified Building Location (ASLRB B23.9221)';
  if (breachedToward(env, target, ms.hex!)) return 'That hexside is already Breached';
  if (moveInternals.remaining(ms, dc.loc.by) < 1) return 'Not enough MF to place the DC (one MF)';
  return null;
}

/**
 * The AFPh resolution of a Breach DC (B23.711 via B23.9221, and the A23.3 example): one Original DR, resolved on the
 * DC's full column against the hexside (NMC or better Breaches it) and, as Area Fire, against the units in the
 * Location, both with the Location's TEM, the fortification's +1 and the placer's CX; no leadership. An Original
 * malfunction DR removes the DC without either.
 *
 * A Location the attacker has not been shown to be fortified (B23.911, B23.9221): the hexside's DR takes the
 * Fortified TEM whether or not the Location is fortified (a Breach is attempted only against one, B23.921), so its
 * DRM and result read alike either way. Only its outcome tells: a Breach of a Fortified Location (placed, and the
 * Location shown), or, the same DR against one that is not fortified, no Breach and the Location shown unfortified.
 * The Area Fire at the units takes the real TEM, the fortification's +1 told of only when it changes a result.
 */
function resolveBreachDc(ctx: Ctx, dc: { id: PieceId; loc: { kind: string }; tags: Record<string, unknown> }, toward: HexId) {
  const loc = locKey(dc.loc as { kind: 'hex'; hex: HexId; level?: number });
  const d = sw(ctx, pieceOf(ctx, dc.id))!;
  const placer = dc.tags['dcPlacer'] as PieceId;
  const placerDef = ctx.state.pieces[placer] ? mmc(ctx, ctx.state.pieces[placer]!) : null;
  const x = (dc.tags['dcX'] as number | undefined) ?? (d.x ?? 12) - (placerDef && placerDef.quality !== 'E' ? 2 : 0);
  const side = ctx.state.attacker;
  const enemy = otherSide(ctx.state, side);
  const targets = personnelAt(ctx, loc, enemy).map((p) => p.id).sort();
  const attack: FireAttackCtx = { mode: 'advancing', side, target: loc, parts: [], targets, hindrance: 0, residual: true };
  const known = fortifiedKnownTo(ctx, loc, side);
  const fortified = isFortified(ctx, loc);
  const extraRes = ctx.explain('dc.drm', { target: loc }, 0);
  const tem = ctx.query('hex.tem', { hex: loc }, 0);
  const cx = dc.tags['dcCx'] ? 1 : 0;
  // The units' DRM: the real TEM (the fortification's +1 secret while the Location is unshown).
  const full = { value: tem + cx + extraRes.value, trace: extraRes.trace };
  // The hexside's: a known Fortified Location as it is; otherwise the visible DRM and the Fortified +1 (B23.921).
  const shownExtra = withoutSecrets(extraRes);
  const wallDrm = known ? full.value : tem + cx + shownExtra.value + 1;
  const roll = ctx.roll(`Breach attempt on ${loc}`);
  const column = iftColumn(ctx, d.fp);
  const detonated = roll.total < x && column !== null;
  const wall = detonated ? statics(ctx).tables.ift(column!, roll.total + wallDrm) : null;
  const wouldBreach = !!wall && wall.kind !== 'none' && wall.kind !== 'PTC';
  const breached = wouldBreach && fortified;
  ctx.emit('sk1.fire.attack', {
    attack: { mode: 'advancing', target: loc, parts: [dc.id] },
    fp: d.fp,
    column,
    dr: roll.dice as [number, number],
    drm: wallDrm,
    cowered: false,
    explain: [
      { id: 'asl.breach', label: `Breach attempt: DC ${d.fp} FP vs the hexside toward ${toward}` },
      ...(tem ? [{ id: 'sk1.drm.tem', label: `+${tem} TEM` }] : []),
      ...(cx ? [{ id: 'sk1.drm.cx', label: '+1 CX' }] : []),
      ...(known ? drmNotes(extraRes) : [...drmNotes(shownExtra), { id: 'asl.breach.fortifiedTem', label: '+1 Fortified Building (a Breach attempt takes it, ASLRB B23.921)' }]),
    ],
  });
  // A Breach of a Location not shown till now shows it (B23.911: the result is the fortification's).
  if (breached && !known) revealFortified(ctx, loc, 'fire');
  ctx.emit('asl.breach.attempt', { dc: dc.id, loc, toward, dr: roll.dice as [number, number], drm: wallDrm, result: wall?.kind ?? null, breached, malfunctioned: !detonated, ...(wouldBreach && !fortified ? { unfortified: true as const } : {}) });
  if (breached) ctx.emit('asl.breach', { breach: { loc, toward, by: 'dc' } });
  // The DC explodes in the Location: an Original KIA on the column of its Area Fire attack there may rubble it first
  // (A23.41, B24.11; the concealment halving does not count for rubble, A23.1), its occupants then eliminated instead.
  const area = iftColumn(ctx, d.fp / 2);
  const rubbled = detonated && area !== null && ctx.proc<BeforeApplyFn>(FP.beforeApply)(ctx, { target: loc, by: 'dc', column: area, originalDr: roll.total, side });
  // The same DR attacks the units inside as Area Fire (halved again if they were concealed when the DC was Placed).
  if (detonated && !rubbled && targets.length) {
    const fp = d.fp / 2 / (dc.tags[T4.dcVsConcealed] ? 2 : 1);
    const half = iftColumn(ctx, fp);
    const shown = discloseDrm(ctx, attack, half, roll.total, full);
    ctx.emit('sk1.fire.attack', {
      attack: { mode: 'advancing', target: loc, parts: [dc.id] },
      fp,
      column: half,
      dr: roll.dice as [number, number],
      drm: shown.value,
      cowered: false,
      explain: [{ id: 'asl.breach.area', label: `Area Fire at the units: ${fp} FP (the same DR)` }, ...drmNotes(shown)],
    });
    if (half !== null) {
      ctx.proc<ApplyResultFn>(FP.applyResult)(ctx, attack, half, roll.total + shown.value, {});
      ctx.proc<FlushFn>(MP.flushLeaderLoss)(ctx);
    }
  }
  // Its Original KIA there may Flame the Location (A23.41, B25.13).
  ctx.proc<AttackResolvedFn>(FP.attackResolved)(ctx, {
    target: loc,
    by: 'dc',
    result: wall?.kind ?? null,
    malfunctioned: !detonated,
    originalResult: detonated && area !== null ? statics(ctx).tables.ift(area, roll.total).kind : null,
    originalDr: roll.total,
    side,
    ...(rubbled ? { rubbled: true } : {}),
  });
  ctx.emit('piece.eliminated', { id: dc.id, reason: detonated ? 'DC detonated' : 'DC malfunctioned' });
}

/** The fortified Locations and Breaches a viewer may know of, for the board. */
export function fortifiedView(env: QueryEnv, viewer: SideId | null): { loc: LocId; breached: HexId[] }[] {
  const st = fortifiedState(env);
  if (!st) return [];
  const out: { loc: LocId; breached: HexId[] }[] = [];
  const seen = new Set<LocId>();
  for (const loc of st.locations ?? []) {
    if (!fortifiedKnownTo(env, loc, viewer) || seen.has(loc)) continue;
    seen.add(loc);
    out.push({ loc, breached: breachesKnownTo(env, viewer).filter((b) => b.loc === loc).map((b) => b.toward) });
  }
  return out;
}
