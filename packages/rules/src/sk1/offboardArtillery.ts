import { cubeNeighbors, type Action, type Cube, type Ctx, type HexId, type Piece, type PieceId, type QueryEnv, type RuleModule, type SideId } from '@asl/engine';
import { byId, statics } from '../common/pieces';
import { locKey, type LocId } from '../common/location';
import { PHASE_DECISION, askPhaseOwner } from '../common/turn';
import { FP, type ApplyResultFn, type FireAttackCtx } from './fire';
import { phaseOwner } from './firePhases';
import { hasLos } from './known';
import { P as MP, type FlushFn } from './morale';
import { northIndex } from './scatterSetup';
import { T, isGoodOrder, mmc, setTags, smc } from './status';
import { terrainOf } from './terrain';

/*
 * Off-board artillery fire missions a card gives a side (LMA9 SSR 2, a 120mm mortar battery):
 *
 * "The German player has 2 off-board mortar fire missions (at most 1 per Game Turn). At the start of one of his Prep
 * Fire Phases he may choose a target hex in the LOS of one of his leaders. He makes a dr; on 1-4 contact is made and
 * the mission is fired. At the start of the Advancing Fire Phase of the same turn the salvo arrives: he makes a dr with
 * a -2 drm; the result (0 to 4) is the distance in hexes from the target hex; if it is not 0, a last dr gives the
 * direction from the target hex (1 = N, 2 = NE, 3 = SE, 4 = S, 5 = SW, 6 = NW). Every unit in the hex hit AND the six
 * hexes around it takes a 120mm mortar attack (12 FP, one DR per hex, TEM applies). If contact is not made he may try
 * again in his next Prep Fire Phase, until both missions have been fired. The observing leader is marked Prep Fire."
 *
 * Readings: the attempt is open only before the side fires anything in that PFPh (its "start"); the observer is a
 * Good Order leader of the side on the map whose LOS reaches the target hex, and he is marked Prep Fire whatever the
 * dr; only a mission that makes contact is used up. A modified drift dr below 0 is 0. Each of the seven hexes with
 * personnel in it (of either side) takes its own attack on the IFT, as an Area Target Type ordnance hit (TEM, an Air
 * Burst in woods, no hindrance or leadership), each Location of a hex separately. Hexes of the blast that are off the
 * map are skipped; vehicles are not attacked (no rule for OBA against AFV yet).
 */

export const OFFBOARD_ARTILLERY_MODULE = 'offboard-artillery';
export interface OffboardArtilleryParams {
  side: SideId;
  /** What fires: "120mm Mortar". */
  label: string;
  /** Fire missions for the game. */
  missions: number;
  /** IFT column of each hex's attack. */
  fp: number;
  /** Contact on a dr at most this. */
  contact: number;
  /** drm on the drift distance dr (a result below 0 is 0). */
  driftDrm: number;
  rule?: string;
}

/** A mission in contact, to land at the start of the AFPh. */
export interface ArtilleryPending {
  target: HexId;
  observer: PieceId;
  turn: number;
}

/** Where the last mission landed, shown for the rest of that Player Turn. */
export interface ArtilleryImpact {
  target: HexId;
  landing: HexId | null;
  distance: number;
  /** Card direction 1-6 (1 = north), when the salvo drifted. */
  direction?: number;
  /** The blast hexes on the map. */
  hexes: HexId[];
  turn: number;
  attacker: SideId;
}

export interface ArtilleryState {
  used: number;
  pending: ArtilleryPending | null;
  /** `${turn}:${attacker}` of the last contact attempt (one per PFPh). */
  tried: string | null;
  last: ArtilleryImpact | null;
}

const KEY = 'ssr.oba';
/** `${turn}:${attacker}` of a PFPh in which the side has already fired: too late to call the mortars. */
const FIRED_KEY = 'ssr.oba.firedIn';

export const artilleryParams = (env: QueryEnv, side: SideId): OffboardArtilleryParams | null =>
  (statics(env)
    .scenario.ssr.filter((s) => s.module === OFFBOARD_ARTILLERY_MODULE && s.params)
    .map((s) => s.params as unknown as OffboardArtilleryParams)
    .find((p) => p.side === side) ?? null);

export const artilleryState = (env: QueryEnv, side: SideId): ArtilleryState =>
  ((env.state.ext[KEY] as Record<SideId, ArtilleryState> | undefined)?.[side] ?? { used: 0, pending: null, tried: null, last: null });

const stamp = (env: QueryEnv) => `${env.state.turn}:${env.state.attacker}`;

/** The side's fire missions left of its total, or null when no rule gives it any. Public to both players. */
export function artilleryMissions(env: QueryEnv, side: SideId): { left: number; total: number; label: string; pending: ArtilleryPending | null } | null {
  const p = artilleryParams(env, side);
  if (!p) return null;
  const st = artilleryState(env, side);
  return { left: Math.max(0, p.missions - st.used), total: p.missions, label: p.label, pending: st.pending };
}

/** The mission that landed this Player Turn, if any (for the map: target, drift, blast). */
export function artilleryImpact(env: QueryEnv, side: SideId): ArtilleryImpact | null {
  const last = artilleryState(env, side).last;
  return last && last.turn === env.state.turn && last.attacker === env.state.attacker ? last : null;
}

/** Leaders of the side that may observe now (ignoring the target): Good Order, on the map, not yet fired. */
const observers = (env: QueryEnv, side: SideId): Piece[] =>
  Object.values(env.state.pieces)
    .filter((p) => p.side === side && p.loc.kind === 'hex' && !!smc(env, p) && isGoodOrder(env, p) && !p.tags[T.fire])
    .sort(byId);

/** Why the side may not call a mission on `hex` with `observer` now, or null. */
export function artilleryCallIllegal(env: QueryEnv, side: SideId, hex: HexId, observer?: PieceId): string | null {
  const p = artilleryParams(env, side);
  if (!p) return 'No special rule gives this fire mission';
  if (env.state.phase !== 'PFPh' || phaseOwner(env) !== side) return 'Only at the start of your Prep Fire Phase';
  const st = artilleryState(env, side);
  if (st.used >= p.missions) return 'No fire missions left';
  if (st.pending) return 'A fire mission is already on its way';
  if (st.tried === stamp(env)) return 'One contact attempt per Prep Fire Phase';
  if (env.state.ext[FIRED_KEY] === stamp(env) || firedThisPhase(env, side)) return 'Only at the start of the Prep Fire Phase, before any fire';
  if (!statics(env).map.hex(hex)) return 'Not a hex on the map';
  const ok = observers(env, side);
  if (ok.length === 0) return 'No Good Order leader to observe';
  if (observer === undefined) return ok.some((l) => sees(env, l, hex)) ? null : 'No leader of yours has a LOS to that hex';
  const l = ok.find((x) => x.id === observer);
  if (!l) return 'The observer must be a Good Order leader that has not fired';
  return sees(env, l, hex) ? null : 'The observer has no LOS to that hex';
}

/** The leaders that could observe a mission on `hex` now. */
export function artilleryObservers(env: QueryEnv, side: SideId, hex: HexId): Piece[] {
  if (artilleryCallIllegal(env, side, hex)) return [];
  return observers(env, side).filter((l) => sees(env, l, hex));
}

const sees = (env: QueryEnv, leader: Piece, hex: HexId) => leader.loc.kind === 'hex' && hasLos(env, locKey(leader.loc), hex);

const firedThisPhase = (env: QueryEnv, side: SideId) =>
  Object.values(env.state.pieces).some((p) => p.side === side && (!!p.tags[T.fire] || !!p.tags[T.firedSw] || !!p.tags[T.rofFired]));

/** The cube `n` hexes from `from` in card direction `dir` (1 = north, clockwise). */
function stepCube(env: QueryEnv, from: Cube, dir: number, n: number): Cube {
  const i = (northIndex(env) + dir - 1) % 6;
  let c = from;
  for (let k = 0; k < n; k++) c = cubeNeighbors(c)[i]!;
  return c;
}

const hexAtCube = (env: QueryEnv, c: Cube): HexId | null => {
  for (const h of statics(env).map.hexes()) if (h.cube.q === c.q && h.cube.r === c.r) return h.id;
  return null;
};

function setState(ctx: Ctx, side: SideId, st: ArtilleryState) {
  ctx.emit('ssr.oba.state', { side, state: st });
}

/** Land the side's pending mission: drift, then one attack per Location with personnel in the seven hexes. */
function land(ctx: Ctx, side: SideId) {
  const p = artilleryParams(ctx, side)!;
  const st = artilleryState(ctx, side);
  const pending = st.pending!;
  const rule = p.rule ?? 'SSR';
  const map = statics(ctx).map;
  const target = map.hex(pending.target)!;
  const dr = ctx.roll(`${p.label} (${rule}): drift distance from ${pending.target} (dr ${p.driftDrm >= 0 ? '+' : ''}${p.driftDrm})`, 1).total;
  const distance = Math.max(0, dr + p.driftDrm);
  let direction: number | undefined;
  let centre: Cube = target.cube;
  if (distance > 0) {
    direction = ctx.roll(`${p.label} (${rule}): drift direction (1 = north, clockwise)`, 1).total;
    centre = stepCube(ctx, target.cube, direction, distance);
  }
  const landing = hexAtCube(ctx, centre);
  const hexes = [centre, ...cubeNeighbors(centre)].map((c) => hexAtCube(ctx, c)).filter((h): h is HexId => !!h);
  const impact: ArtilleryImpact = { target: pending.target, landing, distance, ...(direction ? { direction } : {}), hexes, turn: ctx.state.turn, attacker: ctx.state.attacker };
  ctx.emit('ssr.oba.landed', { side, label: p.label, rule, dr, drm: p.driftDrm, ...impact });
  setState(ctx, side, { ...st, pending: null, last: impact });
  for (const hex of hexes) {
    // Every Location of the hex with personnel in it, of either side.
    const byLoc = new Map<LocId, PieceId[]>();
    for (const u of Object.values(ctx.state.pieces).sort(byId)) {
      if (u.loc.kind !== 'hex' || u.loc.hex !== hex || !(mmc(ctx, u) || smc(ctx, u))) continue;
      const loc = locKey(u.loc);
      byLoc.set(loc, [...(byLoc.get(loc) ?? []), u.id]);
    }
    // Indirect Fire (ASLRB C.1): every level of a building hex takes the same Original Resolution DR (B23.32; only the
    // highest level of an Interior Building Hex), so the hex's DR is rolled once, at its first attacked Location.
    let ift: ReturnType<Ctx['roll']> | undefined;
    for (const [loc, units] of [...byLoc].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const targets = units.filter((u) => ctx.state.pieces[u]?.loc.kind === 'hex');
      if (targets.length === 0) continue;
      if (!ctx.query('fire.indirectLocations', { target: loc }, [loc]).includes(loc)) continue;
      const airBurst = terrainOf(ctx, hex).id === 'woods';
      const attack: FireAttackCtx = {
        mode: 'final',
        side,
        target: loc,
        parts: [],
        targets,
        hindrance: 0,
        ordnance: { targetType: 'ATT', ch: false, column: p.fp, ...(airBurst ? { airBurst } : {}), indirect: true },
      };
      const drm = ctx.explain('fire.drm', { attack }, 0);
      ift ??= ctx.roll(`${p.label} (${rule}) on ${hex}: ${p.fp} column`);
      ctx.emit('sk1.fire.attack', {
        attack: { mode: 'final', target: loc, parts: [] },
        from: [],
        fp: p.fp,
        column: p.fp,
        dr: ift.dice as [number, number],
        drm: drm.value,
        cowered: false,
        explain: [{ id: 'ssr.oba', label: `${p.label} (${rule}): ${p.fp} FP` }, ...drm.trace.filter((t) => !t.suppressedBy && t.label && t.before !== t.after).map((t) => ({ id: t.id, label: t.label! }))],
      });
      ctx.proc<ApplyResultFn>(FP.applyResult)(ctx, attack, p.fp, ift.total + drm.value, {});
      ctx.proc<FlushFn>(MP.flushLeaderLoss)(ctx);
      if (ctx.state.result) return;
    }
  }
}

export const offboardArtilleryModule: RuleModule = {
  id: 'ssr.offboard-artillery',
  summary: 'Off-board artillery fire missions called by a leader in the PFPh, landing with drift in the AFPh (SSR).',
  requires: ['sk1.fire', 'sk1.firePhases', 'sk1.morale'],
  install(r) {
    r.event<{ side: SideId; state: ArtilleryState }>({
      type: 'ssr.oba.state',
      apply(d, p) {
        d.ext[KEY] = { ...((d.ext[KEY] as Record<SideId, ArtilleryState> | undefined) ?? {}), [p.side]: p.state };
      },
    });
    r.event<{ stamp: string }>({
      type: 'ssr.oba.fired',
      apply(d, p) {
        d.ext[FIRED_KEY] = p.stamp;
      },
    });
    r.event<{ side: SideId; label: string; rule: string; hex: HexId; observer: PieceId; dr: number; need: number; contact: boolean; left: number }>({ type: 'ssr.oba.contact', apply() {} });
    r.event<{ side: SideId; label: string; rule: string; dr: number; drm: number } & ArtilleryImpact>({ type: 'ssr.oba.landed', apply() {} });

    // The PFPh's "start" ends with the side's first shot (or a shot that found no LOS).
    for (const event of ['sk1.fire.attack', 'sk1.fire.noLos'])
      r.on({
        id: `ssr.oba.window.${event}`,
        event,
        handler(ctx) {
          if (ctx.state.phase !== 'PFPh' || ctx.state.ext[FIRED_KEY] === stamp(ctx)) return;
          if (!artilleryParams(ctx, phaseOwner(ctx))) return;
          ctx.emit('ssr.oba.fired', { stamp: stamp(ctx) });
        },
      });

    r.action<Action & { type: 'ssr.oba'; hex: HexId; observer: PieceId }>({
      type: 'ssr.oba',
      decisionKinds: [PHASE_DECISION],
      validate: (env, a) => artilleryCallIllegal(env, a.side, a.hex, a.observer),
      resolve(ctx, a) {
        const p = artilleryParams(ctx, a.side)!;
        const st = artilleryState(ctx, a.side);
        const rule = p.rule ?? 'SSR';
        const dr = ctx.roll(`${p.label} (${rule}): contact for a mission on ${a.hex} (≤ ${p.contact})`, 1).total;
        const contact = dr <= p.contact;
        const next: ArtilleryState = { ...st, tried: stamp(ctx), used: st.used + (contact ? 1 : 0), pending: contact ? { target: a.hex, observer: a.observer, turn: ctx.state.turn } : null };
        ctx.emit('ssr.oba.contact', { side: a.side, label: p.label, rule, hex: a.hex, observer: a.observer, dr, need: p.contact, contact, left: p.missions - next.used });
        setState(ctx, a.side, next);
        // The observer is marked Prep Fire, contact or not.
        setTags(ctx, a.observer, { [T.fire]: 'prep' });
        ctx.popDecision();
        askPhaseOwner(ctx, phaseOwner(ctx));
      },
    });

    // The salvo lands at the start of the AFPh of the turn it was called.
    r.on<{ phase: string }>({
      id: 'ssr.oba.land',
      event: 'turn.phaseStarted',
      handler(ctx, ev) {
        if (ev.payload.phase !== 'AFPh') return;
        const side = ctx.state.attacker;
        if (!artilleryParams(ctx, side) || !artilleryState(ctx, side).pending) return;
        land(ctx, side);
      },
    });
  },
};
