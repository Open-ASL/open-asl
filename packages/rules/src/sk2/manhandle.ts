import type { Action, Ctx, HexId, PieceId, QueryEnv, RuleModule } from '@asl/engine';
import { statics } from '../common/pieces';
import { PHASE_DECISION } from '../common/turn';
import { P as MP, type UnitFn } from '../sk1/morale';
import { MANHANDLE_STARTED, moveInternals, moveState, ppCarried, type MoveState } from '../sk1/movement';
import { T, gun, gunHeldBy, mmc, pieceOf, setTags } from '../sk1/status';
import { terrainOf } from '../sk1/terrain';
import { SPINES, spineChange } from './arc';
import { revealGun } from './guns';
import { T2, coveredArc, isHidden, ACQ_CLEAR } from './status';

/*
 * Gun movement (SK4 6.5): a Quick Set Up Gun is manhandled by the MMC possessing it, hex by hex,
 * at double the terrain cost, each hex on a manhandling DR against the Gun's M# (chart: +TEM of
 * the hex entered, +MF cost, -1 per extra crew/HS and -2 per extra squad in the stack up to -4,
 * -2 crossing a road hexside). Below the M# the push goes on; equal, it moves and stops; above,
 * nothing moves. Manhandling is Hazardous Movement: -2 to fire against the stack until it is
 * pinned, no FFMO/FFNAM; the manhandlers may neither fire in the AFPh nor advance.
 */

declare module '@asl/engine' {
  interface QueryCatalog {
    /** Manhandling DRM for pushing a Gun from `from` into `to` with `units` (SK4 6.5, chart). */
    'manhandle.drm': { ctx: { gun: PieceId; units: PieceId[]; from: HexId; to: HexId; cost: number }; value: number };
  }
}

export type ManhandleAction = Action & { type: 'move.manhandle'; to: HexId; ca?: number };

/** Why a stack cannot start manhandling `gunId` (null when it may). */
export function manhandleStartIllegal(env: QueryEnv, units: PieceId[], gunId: PieceId, assault: boolean): string | null {
  const g = env.state.pieces[gunId];
  if (!g || !gun(env, g)) return 'Not a Gun';
  if (g.loc.kind !== 'held' || !units.includes(g.loc.by)) return 'The Gun must be possessed by one of the moving units';
  if (!gun(env, g)!.qsu) return 'This Gun cannot move during the scenario (it must be limbered)';
  if (g.tags[T.malf] === undefined && g.tags[T2.caLocked]) return 'The Gun changed its Covered Arc this Player Turn and cannot move';
  if (assault) return 'A manhandling unit cannot use Assault Movement';
  if (!units.some((u) => mmc(env, pieceOf(env, u)))) return 'A Gun is manhandled by a MMC';
  for (const u of units) {
    const p = pieceOf(env, u);
    if (p.tags[T2.caLocked]) return `${u} turned a Gun this Player Turn and cannot move`;
    if (ppCarried(env, u) > 0) return `${u} cannot carry any PP while manhandling (drop its SW first)`;
  }
  return null;
}

export const manhandleModule: RuleModule = {
  id: 'sk2.manhandle',
  ref: 'SK4 6.5',
  summary: 'Manhandling Guns: double MF, the manhandling DR per hex, Hazardous Movement.',
  requires: ['sk2.guns', 'sk1.movement', 'sk1.advance'],
  install(r) {
    r.event<{ gun: PieceId; units: PieceId[]; from: HexId; to: HexId; m: number; dr: number; drm: number; explain: { id: string; label?: string }[]; outcome: 'moved' | 'stopped' | 'failed' }>({
      type: 'sk2.gun.manhandle',
      apply() {},
    });

    // Starting a move with a Gun in the stack means manhandling it (and only a QSU Gun can).
    r.contribute({
      id: 'sk2.move.cannotStart.gun',
      query: 'move.cannotStart',
      apply(v, { units, assault, manhandle }, env) {
        if (v) return v;
        if (manhandle) return manhandleStartIllegal(env, units, manhandle, assault);
        for (const u of units) {
          const g = gunHeldBy(env, u);
          if (g) return gun(env, g)!.qsu ? `${u} possesses a Gun: manhandle it (double MF, manhandling DR) or drop it first` : `${u} possesses a Gun that cannot move; drop it first`;
          if (pieceOf(env, u).tags[T2.caLocked]) return `${u} turned a Gun this Player Turn and cannot move`;
        }
        return null;
      },
    });

    // The first attempt marks everyone: Hazardous Movement, and no AFPh fire or APh advance this Player Turn.
    r.procedure<(c: Ctx, gunId: PieceId, units: PieceId[]) => void>(MANHANDLE_STARTED, (next) => (ctx, gunId, units) => {
      next?.(ctx, gunId, units);
      setTags(ctx, gunId, { [T2.manhandled]: true });
      for (const u of units) setTags(ctx, u, { [T2.manhandled]: true, [T2.hazardous]: true });
      if (isHidden(pieceOf(ctx, gunId))) revealGun(ctx, gunId, 'manhandle');
    });

    r.contribute({
      id: 'sk2.manhandle.drm.base',
      query: 'manhandle.drm',
      layer: 0,
      apply: () => 0,
    });
    const drm = (id: string, label: string | ((c: { gun: PieceId; units: PieceId[]; from: HexId; to: HexId; cost: number }, env: QueryEnv) => string), when: (c: { gun: PieceId; units: PieceId[]; from: HexId; to: HexId; cost: number }, env: QueryEnv) => boolean, value: (c: { gun: PieceId; units: PieceId[]; from: HexId; to: HexId; cost: number }, env: QueryEnv) => number) =>
      r.contribute({ id: `sk2.manhandle.${id}`, query: 'manhandle.drm', ref: 'SK4 6.5 (chart)', label, when, apply: (v, c, env) => v + value(c, env) });
    drm('tem', (c, env) => `+${env.query('hex.tem', { hex: c.to }, 0)} TEM of ${terrainOf(env, c.to).name}`, (c, env) => env.query('hex.tem', { hex: c.to }, 0) > 0, (c, env) => env.query('hex.tem', { hex: c.to }, 0));
    drm('mf', (c) => `+${c.cost} MF to enter`, (c) => c.cost > 0, (c) => c.cost);
    drm('helpers', (c, env) => `${helpersDrm(env, c.gun, c.units)} extra units pushing`, (c, env) => helpersDrm(env, c.gun, c.units) < 0, (c, env) => helpersDrm(env, c.gun, c.units));
    drm('road', '-2 crossing a road hexside', (c, env) => !!statics(env).map.roadHexside?.(c.from, c.to), () => -2);
    /** -1 per extra crew/HS and -2 per extra squad beyond the possessor, at most -4. */
    function helpersDrm(env: QueryEnv, gunId: PieceId, units: PieceId[]): number {
      const g = pieceOf(env, gunId);
      const holder = g.loc.kind === 'held' ? g.loc.by : null;
      let d = 0;
      for (const u of units) {
        if (u === holder) continue;
        const m = mmc(env, pieceOf(env, u));
        if (!m) continue;
        d -= m.kind === 'squad' ? 2 : 1;
      }
      return Math.max(-4, d);
    }

    r.action<ManhandleAction>({
      type: 'move.manhandle',
      decisionKinds: [PHASE_DECISION],
      legal(env) {
        const ms = moveState(env);
        if (!ms || !ms.manhandle || !ms.hex || env.state.phase !== 'MPh') return [];
        return statics(env)
          .map.neighbors(ms.hex)
          .filter((to) => !pushIllegal(env, ms, to))
          .map((to) => ({ type: 'move.manhandle', to }));
      },
      validate(env, a) {
        const ms = moveState(env);
        if (!ms || !ms.manhandle) return 'No Gun is being manhandled';
        if (a.ca !== undefined && (!Number.isInteger(a.ca) || a.ca < 0 || a.ca >= SPINES)) return 'Covered Arc is a hexspine 0-5';
        return pushIllegal(env, ms, a.to);
      },
      resolve(ctx, a) {
        const ms = moveState(ctx)!;
        const gunId = ms.manhandle!.gun;
        const g = pieceOf(ctx, gunId);
        const def = gun(ctx, g)!;
        const from = ms.hex!;
        const cost = pushCost(ctx, ms, a.to);
        const drmRes = ctx.explain('manhandle.drm', { gun: gunId, units: ms.units, from, to: a.to, cost }, 0);
        const roll = ctx.roll(`Manhandle ${gunId} into ${a.to}`);
        const final = roll.total + drmRes.value;
        const outcome: 'moved' | 'stopped' | 'failed' = final < def.m ? 'moved' : final === def.m ? 'stopped' : 'failed';
        ctx.emit('sk2.gun.manhandle', {
          gun: gunId,
          units: ms.units,
          from,
          to: a.to,
          m: def.m,
          dr: roll.total,
          drm: drmRes.value,
          explain: drmRes.trace.filter((t) => !t.suppressedBy).map((t) => ({ id: t.id, ...(t.label ? { label: t.label } : {}) })),
          outcome,
        });
        if (outcome === 'failed') {
          // Nobody moves this turn: the MF are spent where they stand and the stack is done.
          moveInternals.spendInPlace(ctx, ms, cost, { manhandle: { gun: gunId, mustStop: true } });
          moveInternals.afterMfExpenditure(ctx);
          const after = moveState(ctx);
          if (after) {
            moveInternals.finishStack(ctx);
            moveInternals.reAskMover(ctx);
          }
          return;
        }
        for (const id of ms.units) ctx.emit('piece.moved', { id, loc: { kind: 'hex', hex: a.to } });
        // The Gun is no longer Emplaced and loses its acquisition (SK4 6.3, 6.10); it may face a new way (6.5).
        setTags(ctx, gunId, { [T2.emplaced]: null, ...ACQ_CLEAR, portaged: true });
        if (a.ca !== undefined && a.ca !== coveredArc(g)) ctx.emit('sk2.gun.ca', { gun: gunId, from: coveredArc(g), to: a.ca, spines: spineChange(coveredArc(g), a.ca), reason: 'manhandle' });
        const next: MoveState = {
          ...ms,
          from,
          hex: a.to,
          off: null,
          spent: Object.fromEntries(ms.units.map((u) => [u, (ms.spent[u] ?? 0) + cost])),
          hexesEntered: ms.hexesEntered + 1,
          roadOnly: false,
          viaRoad: false,
          mfHere: cost,
          firedHere: {},
          residualDrmHere: null,
          manhandle: { gun: gunId, mustStop: outcome === 'stopped' },
        };
        ctx.emit('sk1.move.state', { state: next });
        moveInternals.afterMfExpenditure(ctx);
        if (outcome === 'stopped' && moveState(ctx)) {
          moveInternals.finishStack(ctx);
          moveInternals.reAskMover(ctx);
        }
      },
    });

    /** Double the terrain cost (SK4 6.5), never the road rate. */
    function pushCost(env: QueryEnv, ms: MoveState, to: HexId): number {
      return Math.max(...ms.units.map((u) => env.query('move.cost', { unit: u, from: ms.hex, to, viaRoad: false }, 1))) * 2;
    }
    function pushIllegal(env: QueryEnv, ms: MoveState, to: HexId): string | null {
      if (!ms.manhandle) return 'No Gun is being manhandled';
      if (ms.manhandle.mustStop) return 'The Gun cannot be pushed any further this turn';
      if (!ms.hex) return 'The Gun must be on the map';
      const base = moveInternals.stepIllegal(env, ms, to);
      if (base) return base;
      const cost = pushCost(env, ms, to);
      for (const u of ms.units) {
        const left = (ms.allowance[u] ?? 0) - (ms.spent[u] ?? 0);
        if (cost > left) return `${u} lacks the MF (${left}) to push the Gun in (${cost})`;
      }
      return null;
    }

    // ---------------------------------------------------------------- Hazardous Movement (SK4 6.5)
    r.contribute({
      id: 'sk2.drm.hazardous',
      query: 'fire.unitDrm',
      ref: 'SK4 6.5',
      label: '-2 Hazardous Movement (manhandling a Gun)',
      when: ({ unit }, env) => pieceOf(env, unit).tags[T2.hazardous] === true,
      apply: (v) => v - 2,
    });
    r.suppress({ id: 'sk2.hazardous.no-ffmo', query: 'fire.drm', target: 'sk1.drm.ffmo', ref: 'SK4 6.5', when: ({ attack }) => !!attack.moving?.hazardous });
    r.suppress({ id: 'sk2.hazardous.no-ffnam', query: 'fire.drm', target: 'sk1.drm.ffnam', ref: 'SK4 6.5', when: ({ attack }) => !!attack.moving?.hazardous });
    // Hazardous Movement ends when the unit is pinned.
    r.procedure<UnitFn>(MP.pin, (next) => (ctx, unit, reason) => {
      next?.(ctx, unit, reason);
      if (ctx.state.pieces[unit]?.tags[T2.hazardous]) setTags(ctx, unit, { [T2.hazardous]: null });
    });

    // Manhandlers may not advance (6.5), nor may a unit possessing a Gun ("A Gun may not move in the APh").
    r.contribute({
      id: 'sk2.advance.manhandled',
      query: 'unit.cannotAdvance',
      ref: 'SK4 6.5',
      apply(v, { unit }, env) {
        if (v) return v;
        const p = pieceOf(env, unit);
        if (p.tags[T2.manhandled]) return 'attempted to manhandle a Gun this turn and cannot advance';
        if (gunHeldBy(env, unit)) return 'possesses a Gun, which cannot move in the APh (drop it first)';
        if (p.tags[T2.caLocked]) return 'turned a Gun this Player Turn and cannot move';
        return null;
      },
    });
    // Nor fire IFE in the AFPh (an ordnance shot is refused by the ordnance module).
    r.contribute({
      id: 'sk2.fire.illegal.manhandled',
      query: 'fire.illegal',
      apply(v, { decl, mode }, env) {
        if (v || mode !== 'advancing') return v;
        for (const id of decl.sw) {
          const w = env.state.pieces[id];
          if (w && gun(env, w) && w.tags[T2.manhandled]) return 'A manhandled Gun cannot fire in the AFPh';
        }
        return null;
      },
    });
  },
};
