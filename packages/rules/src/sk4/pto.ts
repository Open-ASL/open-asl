import type { Ctx, HexId, PieceId, QueryEnv, RuleModule } from '@asl/engine';
import { defOf, hexOf, isVehicleDef, personnelAt, statics } from '../common/pieces';
import { hexOfLoc } from '../common/location';
import { isBroken, isCx, isPinned, mmc, pieceOf, setTags, smc, T } from '../sk1/status';
import { terrainOf } from '../sk1/terrain';
import { MOVE_ENTER, MOVE_ENTERED, MOVE_FINISH, type MoveEnterFn, type MoveEnteredFn, type MoveFinishFn, type MoveState } from '../sk1/movement';
import { moveState } from '../sk1/moveState';
import { AP, type AdvanceEnterFn } from '../sk1/advance';
import { isDc, type FireAttackCtx } from '../sk1/fire';
import type { IftResult } from '../common/statics';
import { T2 } from '../sk2/status';
import { T3, isCe, isRecalled, vehicle } from '../sk3/status';

export const PTO_TERRAIN_MODULE = 'pto-terrain';

/** Hex marker: the hut in this hex has Collapsed (SK4 8.2.1). Lasting; the terrain reads as `hut-collapsed` from then on. */
export const COLLAPSED_HUT = 'collapsedHut';

const isHut = (env: QueryEnv, hex: HexId) => terrainOf(env, hex).id === 'hut';
const isHutHex = (env: QueryEnv, hex: HexId) => !!terrainOf(env, hex).building;
const isJungleLike = (env: QueryEnv, hex: HexId) => !!terrainOf(env, hex).noMultiHexFg;
const isBamboo = (env: QueryEnv, hex: HexId) => !!terrainOf(env, hex).allMf;
const isInfantry = (env: QueryEnv, p: ReturnType<typeof pieceOf>) => !!mmc(env, p) || !!smc(env, p);

/**
 * A hut Collapses (SK4 8.2.1): the Collapsed Hut marker goes on (no TEM, a normal Hindrance across the depiction, still
 * a hut for Victory Conditions) and every Infantry unit in it takes a PTC with no leadership modifier, at a morale of
 * 8 for that check only; a failed PTC pins the unit, even one normally immune to Pin results (a Japanese leader, a
 * Banzai unit, a broken unit, which then cannot rout).
 */
export function collapseHut(ctx: Ctx, hex: HexId, why: 'kia' | 'afv-entered' | 'afv-left' | 'afv-turned', afv?: PieceId) {
  if (!isHut(ctx, hex)) return;
  ctx.emit('hex.marker', { hex, key: COLLAPSED_HUT, value: true });
  const ptc: { unit: PieceId; dr: [number, number]; pinned: boolean }[] = [];
  for (const side of ctx.state.sides) {
    for (const u of personnelAt(ctx, hex, side).sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const roll = ctx.roll(`PTC (hut collapses) ${u.id}`, 2);
      const pinned = roll.total > 8;
      // A pin nothing can refuse: not through the pin procedure (which skips broken units and the pin-exempt).
      if (pinned) setTags(ctx, u.id, { [T.pinned]: true, [T.pinnedThisTurn]: true });
      ptc.push({ unit: u.id, dr: roll.dice as [number, number], pinned });
    }
  }
  ctx.emit('sk4.hut.collapsed', { hex, why, ...(afv ? { afv } : {}), ptc });
}

/**
 * PTO Terrain is in effect (SK4 8.2). The map transform (woods → jungle, brush → bamboo, orchards → palm trees, grain →
 * kunai, hut clusters → huts, roads → none, Woods-Roads → paths) is done by the content package when it builds the map
 * (`buildMap({ pto })`), and the terrain table carries each terrain's numbers (`PTO_TERRAIN`). This module holds the
 * rules those numbers cannot express: paths, stacking, Recovery, Fire Groups, ambush, mortars, bamboo entry, huts
 * collapsing, vehicles. Installed with the SK4 rules whenever a scenario lists the `pto-terrain` SSR.
 */
export const ptoModule: RuleModule = {
  id: 'sk4.pto',
  ref: 'SK4 8.2',
  summary: 'PTO Terrain (SSR): jungle, bamboo, palm trees, kunai, huts and paths; roads do not exist.',
  requires: ['sk1.terrain', 'sk1.movement', 'sk1.advance', 'sk1.fire', 'sk1.cc', 'sk1.rally'],
  install(r) {
    r.event<{ hex: HexId; why: string; afv?: PieceId; ptc: { unit: PieceId; dr: [number, number]; pinned: boolean }[] }>({ type: 'sk4.hut.collapsed', apply() {} });
    r.event<{ units: PieceId[]; hex: HexId }>({ type: 'sk4.bamboo.entered', apply() {} });

    // ---------------------------------------------------------------- the collapsed hut reads as its own terrain
    r.contribute({
      id: 'sk4.pto.collapsed-hut',
      query: 'hex.terrain',
      layer: 5,
      label: 'Collapsed Hut',
      when: ({ hex }, env) => env.state.hexMarkers[hex]?.[COLLAPSED_HUT] === true,
      apply: () => 'hut-collapsed',
    });

    // ---------------------------------------------------------------- paths (8.2.1): Infantry enter a jungle hex along one for 1 MF
    r.contribute({
      id: 'sk4.pto.path',
      query: 'move.cost',
      layer: 1,
      ref: 'SK4 8.2.1',
      label: 'along a path',
      when: ({ from, to, unit }, env) => !!from && !!statics(env).map.pathHexside?.(from, to) && terrainOf(env, to).id.startsWith('jungle') && isInfantry(env, pieceOf(env, unit)),
      apply: () => 1,
    });

    // ---------------------------------------------------------------- bamboo (8.2.1): all of a unit's MF, then CX and Pinned
    // A rout or advance: the unit's whole allowance (so a rout into bamboo is a rout of one hex, or a Low Crawl).
    r.contribute({
      id: 'sk4.pto.bamboo-all-mf',
      query: 'move.cost',
      layer: 2,
      ref: 'SK4 8.2.1',
      label: 'all MF (bamboo)',
      when: ({ to, unit }, env) => isBamboo(env, to) && isInfantry(env, pieceOf(env, unit)),
      apply: (_v, { unit }, env) => Math.max(1, env.query('unit.mf', { unit, stack: [unit], doubleTime: false }, 0)),
    });
    // The MPh step: the whole allowance of the stack's units, the leader bonus included ("including the MF bonus gained
    // for moving with a leader"), so only a stack that has spent nothing yet can enter.
    r.contribute({
      id: 'sk4.pto.bamboo-step',
      query: 'move.stepCost',
      layer: 2,
      ref: 'SK4 8.2.1',
      label: 'all MF (bamboo)',
      when: ({ ms, to }, env) => !ms.vehicle && isBamboo(env, to) && !statics(env).map.offboardHex(to),
      apply: (_v, { ms }) => Math.max(1, ...ms.units.map((u) => ms.allowance[u] ?? 0)),
    });
    // A Gun may not be manhandled into bamboo.
    r.contribute({
      id: 'sk4.pto.no-manhandle-bamboo',
      query: 'move.stepIllegal',
      ref: 'SK4 8.2.1',
      when: ({ ms, to }, env) => !!ms.manhandle && isBamboo(env, to),
      apply: () => 'A Gun may not be manhandled into bamboo',
    });
    // For Defensive First Fire the entering unit "is considered to spend all of its MF +1".
    r.procedure<MoveEnteredFn>(MOVE_ENTERED, (next) => (ctx, ms) => {
      next?.(ctx, ms);
      const cur = moveState(ctx);
      if (!cur || !cur.hex || cur.vehicle || !isBamboo(ctx, cur.hex)) return;
      ctx.emit('sk1.move.state', { state: { ...cur, mfHere: cur.mfHere + 1 } });
      ctx.emit('sk4.bamboo.entered', { units: cur.units, hex: cur.hex });
    });
    // "After all Defensive First Fire, mark an unbroken unit that entered bamboo with CX and Pin counters."
    r.procedure<MoveFinishFn>(MOVE_FINISH, (next) => (ctx) => {
      const ms = moveState(ctx);
      const entered = ms && !ms.vehicle && ms.hex && ms.hexesEntered > 0 && isBamboo(ctx, ms.hex) ? [...ms.units, ...(ms.stopped ?? [])] : [];
      next?.(ctx);
      for (const u of entered) {
        const p = ctx.state.pieces[u];
        if (!p || p.loc.kind !== 'hex' || isBroken(p)) continue;
        setTags(ctx, u, { [T.cx]: true, [T.pinned]: true, [T.pinnedThisTurn]: true });
      }
    });
    // "A unit may not advance into bamboo in the APh if it is already marked with a CX counter. If it does enter in the
    // APh, mark the unit with a CX counter."
    r.contribute({
      id: 'sk4.pto.advance-bamboo',
      query: 'advance.illegal',
      ref: 'SK4 8.2.1',
      when: ({ units, to }, env) => isBamboo(env, hexOfLoc(to)) && units.some((u) => isCx(pieceOf(env, u))),
      apply: () => 'A CX unit may not advance into bamboo',
    });
    r.procedure<AdvanceEnterFn>(AP.enter, (next) => (ctx, a) => {
      next?.(ctx, a);
      if (!isBamboo(ctx, hexOfLoc(a.to))) return;
      for (const u of a.units) if (ctx.state.pieces[u]?.loc.kind === 'hex' && hexOf(ctx.state, pieceOf(ctx, u)) === hexOfLoc(a.to)) setTags(ctx, u, { [T.cx]: true });
    });
    // A Gun in bamboo cannot change its Covered Arc and fire in the same Player Turn.
    r.contribute({
      id: 'sk4.pto.bamboo-gun-ca',
      query: 'ordnance.illegal',
      ref: 'SK4 8.2.1',
      when: ({ shot }, env) => {
        const g = env.state.pieces[shot.weapon];
        const hex = g ? hexOf(env.state, g) : null;
        return !!g && !!hex && isBamboo(env, hex) && g.tags[T2.caLocked] === true && !(defOf(env, g).kind === 'vehicle');
      },
      apply: () => 'A Gun in bamboo cannot change its Covered Arc and fire in the same Player Turn',
    });

    // ---------------------------------------------------------------- stacking (8.2.1): two squad equivalents in Dense jungle/bamboo
    r.contribute({
      id: 'sk4.pto.stacking',
      query: 'stack.limit',
      ref: 'SK4 8.2.1',
      label: 'two squad equivalents (Dense jungle / bamboo)',
      when: ({ hex }, env) => terrainOf(env, hex).stackingSe !== undefined && !statics(env).map.hex(hexOfLoc(hex))?.buildingId,
      apply: (v, { hex }, env) => ({ ...v, se: Math.min(v.se, terrainOf(env, hex).stackingSe!) }),
    });

    // ---------------------------------------------------------------- Recovery +2 in jungle, kunai, bamboo (8.2)
    r.contribute({
      id: 'sk4.pto.recovery',
      query: 'recover.drm',
      ref: 'SK4 8.2',
      label: ({ hex }, env) => `+${terrainOf(env, hex).recoveryDrm} Recovery in ${terrainOf(env, hex).name}`,
      when: ({ hex }, env) => !!statics(env).map.hex(hex) && (terrainOf(env, hex).recoveryDrm ?? 0) > 0,
      apply: (v, { hex }, env) => v + terrainOf(env, hex).recoveryDrm!,
    });

    // ---------------------------------------------------------------- no multi-hex Fire Group across Dense jungle / kunai / bamboo (8.2)
    r.contribute({
      id: 'sk4.pto.fire-group',
      query: 'fire.illegal',
      ref: 'SK4 8.2',
      apply(v, { decl }, env) {
        if (v) return v;
        const hexes = new Set<HexId>();
        for (const id of [...decl.units, ...decl.sw]) {
          const p = env.state.pieces[id];
          if (!p) continue;
          const holder = p.loc.kind === 'held' ? env.state.pieces[p.loc.by] : p;
          const hex = holder ? hexOf(env.state, holder) : null;
          if (hex && isJungleLike(env, hex)) hexes.add(hex);
        }
        return hexes.size > 1 ? 'No multi-hex Fire Group between units in different Dense jungle, kunai or bamboo hexes' : null;
      },
    });

    // ---------------------------------------------------------------- ambush: the ATTACKER adds +1 in jungle, kunai, bamboo (8.2)
    r.contribute({
      id: 'sk4.pto.ambush-attacker',
      query: 'cc.ambushDrm',
      ref: 'SK4 8.2',
      label: '+1 ATTACKER in jungle/kunai/bamboo',
      when: ({ hex, units }, env) => (terrainOf(env, hex).ambushAttackerDrm ?? 0) > 0 && units.some((u) => env.state.pieces[u]?.tags[T.advancedInto] === hex),
      apply: (v, { hex }, env) => v + terrainOf(env, hex).ambushAttackerDrm!,
    });

    // ---------------------------------------------------------------- mortars: no fire from Dense jungle or bamboo (8.2.1)
    r.contribute({
      id: 'sk4.pto.no-mortar',
      query: 'ordnance.illegal',
      ref: 'SK4 8.2.1',
      when: ({ shot }, env) => {
        const g = env.state.pieces[shot.weapon];
        const d = g ? defOf(env, g) : null;
        const hex = g ? hexOf(env.state, g) : null;
        const type = d?.kind === 'sw' || d?.kind === 'gun' ? d.type : null;
        return type === 'MTR' && !!hex && (terrainOf(env, hex).id === 'jungle' || isBamboo(env, hex));
      },
      apply: () => 'No mortar may fire from a Dense jungle or bamboo hex',
    });

    // ---------------------------------------------------------------- bamboo -1 TEM for DC and Ordnance HE vs an unarmored target; Residual FP a column up
    const heAttack = (attack: FireAttackCtx, env: QueryEnv) =>
      attack.parts.some((p) => p.kind === 'sw' && isDc(env, p.piece)) || (!!attack.ordnance && attack.ordnance.targetType === 'ATT' && (attack.ordnance.ammo ?? 'HE') === 'HE');
    const heTemHex = (env: QueryEnv, hex: HexId) => terrainOf(env, hex).heTem !== undefined;
    r.contribute({
      id: 'sk4.drm.bamboo-he',
      query: 'fire.drm',
      ref: 'SK4 8.2.1',
      label: ({ attack }, env) => `${terrainOf(env, attack.target).heTem} TEM (bamboo vs DC/HE) instead of +${terrainOf(env, attack.target).tem}`,
      when: ({ attack }, env) => heTemHex(env, attack.target) && heAttack(attack, env),
      apply: (v, { attack }, env) => v - terrainOf(env, attack.target).tem + terrainOf(env, attack.target).heTem!,
    });
    // An ITT hit took the TEM on the To Hit DR: there the bamboo -1 replaces the +1.
    r.contribute({
      id: 'sk4.th.bamboo-he',
      query: 'ordnance.thDrm',
      ref: 'SK4 8.2.1',
      label: (sc, env) => `${terrainOf(env, sc.target).heTem} TEM (bamboo vs HE) instead of +${terrainOf(env, sc.target).tem}`,
      when: (sc, env) => sc.shot.targetType === 'ITT' && heTemHex(env, sc.target) && sc.ammo === 'HE' && !sc.def.latw,
      apply: (v, sc, env) => v - terrainOf(env, sc.target).tem + terrainOf(env, sc.target).heTem!,
    });
    r.contribute({
      id: 'sk4.residual.bamboo-he',
      query: 'fire.residualBonus',
      ref: 'SK4 8.2.1',
      when: ({ target, attack, ordnance }, env) => heTemHex(env, hexOfLoc(target)) && (attack ? heAttack(attack, env) : !!ordnance && (ordnance.ammo === 'HE' || ordnance.ammo === 'he')),
      apply: (v) => v + 1,
    });

    // ---------------------------------------------------------------- huts collapsing (8.2.1)
    // Any KIA result vs a unit in a hut Collapses it.
    r.on<{ unit: PieceId; result: IftResult }>({
      id: 'sk4.pto.hut-kia',
      event: 'sk1.fire.result',
      handler(ctx, ev) {
        if (ev.payload.result.kind !== 'KIA') return;
        const p = ctx.state.pieces[ev.payload.unit];
        const hex = p ? hexOf(ctx.state, p) : null;
        if (hex && isHut(ctx, hex)) collapseHut(ctx, hex, 'kia');
      },
    });
    // An AFV entering a hut Collapses it before Defensive First Fire; one that set up in a hut Collapses it by leaving.
    r.procedure<MoveEnteredFn>(MOVE_ENTERED, (next) => (ctx, ms) => {
      if (ms.vehicle && ms.hex && isHut(ctx, ms.hex)) collapseHut(ctx, ms.hex, 'afv-entered', ms.units[0]);
      next?.(ctx, moveState(ctx) ?? ms);
    });
    r.procedure<MoveEnterFn>(MOVE_ENTER, (next) => (ctx, ms, to, cost, woods) => {
      if (ms.vehicle && ms.hex && isHut(ctx, ms.hex)) collapseHut(ctx, ms.hex, 'afv-left', ms.units[0]);
      next?.(ctx, moveState(ctx) ?? ms, to, cost, woods);
    });
    // ... or by changing any Covered Arc while in it.
    r.on<{ id: PieceId; tags: Record<string, unknown> }>({
      id: 'sk4.pto.hut-afv-turned',
      event: 'piece.tagged',
      handler(ctx, ev) {
        if (!(T3.vca in ev.payload.tags) && !('tca' in ev.payload.tags)) return;
        const p = ctx.state.pieces[ev.payload.id];
        if (!p || !isVehicleDef(defOf(ctx, p))) return;
        const hex = hexOf(ctx.state, p);
        if (hex && isHut(ctx, hex) && ctx.state.phase !== 'setup') collapseHut(ctx, hex, 'afv-turned', p.id);
      },
    });

    // ---------------------------------------------------------------- vehicles (the PTO Terrain Effects Chart)
    // A hut: 2 MP fully tracked, 4 an Armored Car (a collapsed one 4 MP and a Bog Check for an AC), only BU and not Recalled.
    r.contribute({
      id: 'sk4.pto.vehicle-hut-mp',
      query: 'vehicle.terrainMp',
      ref: 'SK4 8.2.1',
      when: ({ hex }, env) => isHutHex(env, hex),
      apply: (_v, { vehicle: id, hex }, env) => (vehicle(env, pieceOf(env, id))!.tracked && isHut(env, hex) ? 2 : 4),
    });
    r.contribute({
      id: 'sk4.pto.vehicle-step',
      query: 'vehicle.stepIllegal',
      ref: 'SK4 8.2.1',
      apply(v, { ms, to }, env) {
        if (v || !ms.vehicle || !statics(env).map.hex(to)) return v;
        const p = pieceOf(env, ms.units[0]!);
        const d = vehicle(env, p)!;
        const t = terrainOf(env, to).id;
        if (!d.tracked && (t === 'jungle' || t === 'bamboo')) return 'An Armored Car cannot enter Dense jungle or bamboo';
        if (isHut(env, to) && (isCe(p) || isRecalled(p))) return 'An AFV enters a hut only Buttoned Up and not Recalled';
        return null;
      },
    });
    // Bog: +2 for a fully tracked vehicle entering (or changing VCA in) Dense jungle or bamboo.
    r.contribute({
      id: 'sk4.pto.bog',
      query: 'vehicle.bogDrm',
      ref: 'SK4 8.2.1',
      label: '+2 Dense jungle / bamboo',
      when: ({ hex, vehicle: id }, env) => (terrainOf(env, hex).id === 'jungle' || isBamboo(env, hex)) && vehicle(env, pieceOf(env, id))!.tracked,
      apply: (v) => v + 2,
    });
  },
};

/** Whether PTO Terrain is in effect for this scenario (the `pto-terrain` SSR). */
export const ptoInEffect = (env: QueryEnv) => statics(env).scenario.ssr.some((s) => s.module === PTO_TERRAIN_MODULE);

/** The Collapsed Hut hexes of the map (for the board). */
export const collapsedHuts = (env: QueryEnv): HexId[] => Object.entries(env.state.hexMarkers).filter(([, m]) => m[COLLAPSED_HUT] === true).map(([h]) => h);

// The moving stack type is re-exported for the module's wrappers' callers.
export type { MoveState };
