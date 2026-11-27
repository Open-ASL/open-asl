import type { Action, Ctx, Decision, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { hexOfLoc } from '../common/location';
import { pieceOf } from '../sk1/status';
import { terrainOf } from '../sk1/terrain';
import { OP, enemyVehicleAt, gunFirstFireMode, shotContext, toHitNumber, type OrdnanceAction, type OrdnancePauseFn, type OrdnanceResumeFn, type OrdnanceShot } from '../sk2/ordnance';
import { PHASE_FIRE_MODE } from '../sk1/firePhases';
import { firstFireTargets, firstFireView, moveState, movingInfo } from '../sk1/movement';
import type { PfShot } from '../sk3/panzerfaust';
import { entrenchmentAt, shownCounter } from './fortifications';
import { HD_CHOICE_EXT, hullDownLabel, hullDownToFirer, type HdChoiceState, type HullDown } from './hullDown';

/*
 * Hull Down or in-hex TEM (ASLRB B9.36, D4.2): "if also able to claim in-hex TEM (9.31), the player may choose in-hex TEM
 * instead of HD benefits (D4.2)—after the attack declaration, but before the attack DR is made"; D4.2: a HD target "may
 * claim an in-hex Case Q TH DRM in lieu of HD status". So once a Direct Fire ordnance shot on the Vehicle Target Type is
 * declared at a vehicle that is HD to it and stands in a hex whose TEM is at least +1, the shot waits while the vehicle's
 * owner chooses (`hdChoice` decision): HD (only a turret hit counts, no Case Q) or the in-hex TEM as Case Q (every hit
 * counts). HD is the answer when time runs out. On the Area Target Type the choice gives nothing (Case Q never applies
 * to its To Hit DR, C3.331, and the in-hex TEM reaches its Effects DR either way), so it is not asked. While a trench
 * that makes the vehicle HD is hidden from the firer, no question is put (it would give the trench away; A12.33): the
 * engine applies HD.
 * The choice holds for that one shot: `ext['asl.hd.choice']` is set as the shot resolves and cleared once it has.
 */

export const HD_CHOICE_DECISION = 'hdChoice';
const PENDING_EXT = 'asl.hd.pending';
export type HdChooseAction = Action & { type: 'hd.choose'; choice: 'hd' | 'tem' };
interface Pending {
  action: Action;
  decisionId: string;
}
export interface HdQuestion {
  vehicle: PieceId;
  firer: PieceId;
  hd: HullDown;
  /** The hex's TEM taken as Case Q instead (D4.2). */
  tem: number;
  terrain: string;
  /** The Final To Hit DR the shot needs with HD, and with the in-hex TEM (null when not worked out here, as for a Panzerfaust). */
  needHd: number | null;
  needTem: number | null;
}

/** The ordnance shot an action declares, the side firing, and the firing unit. */
function declared(env: QueryEnv, a: Action): { shot?: OrdnanceShot; pf?: PfShot; side: SideId } | null {
  const side = (a as { side?: SideId }).side;
  if (!side) return null;
  if (a.type === 'fire.ordnance' || a.type === 'defFire.ordnance' || a.type === 'vmove.bff') return { shot: (a as OrdnanceAction).shot, side };
  if (a.type === 'fire.pf' || a.type === 'defFire.pf') return { pf: (a as Action & { pf: PfShot }).pf, side };
  void env;
  return null;
}

/** The question a declared shot puts to its target's owner, or null when there is none to put (B9.36, D4.2, A12.33). */
export function hdQuestion(env: QueryEnv, a: Action): HdQuestion | null {
  const d = declared(env, a);
  if (!d) return null;
  const targetType = d.shot?.targetType ?? d.pf?.targetType;
  if (targetType !== 'VTT') return null;
  const target = d.shot?.target ?? d.pf!.target;
  // In Defensive First Fire the vehicle aimed at is the moving one (SK4 3.3.3).
  const ms = a.type.startsWith('defFire.') ? moveState(env) : null;
  const moving = ms?.hex ? firstFireTargets(env, firstFireView(env, ms, target) ?? ms) : undefined;
  const vehicleId = (d.shot?.targetUnit ?? d.pf?.targetUnit) ?? enemyVehicleAt(env, target, d.side, moving)?.id;
  if (!vehicleId) return null;
  const g = d.shot ? env.state.pieces[d.shot.weapon] : undefined;
  const firer = d.shot ? (g?.loc.kind === 'held' ? g.loc.by : d.shot.weapon) : d.pf!.unit;
  const hd = hullDownToFirer(env, vehicleId, firer, { choice: false });
  if (!hd) return null;
  const hex = hexOfLoc(target);
  const tem = env.query('hex.tem', { hex }, 0);
  if (tem < 1) return null;
  // No question while the trench that makes it HD is hidden from the firer: asking would reveal it.
  if (hd.kind === 'trench') {
    const c = entrenchmentAt(env, hex);
    if (c && !shownCounter(c, d.side)) return null;
  }
  let needHd: number | null = null;
  let needTem: number | null = null;
  if (d.shot) {
    // The shot as it will be resolved: Bounding First Fire, Defensive First Fire at the moving stack, or a fire phase's.
    const ms = moveState(env);
    const view = a.type === 'defFire.ordnance' && ms ? (firstFireView(env, ms, d.shot.target) ?? ms) : null;
    const mode = a.type === 'vmove.bff' ? 'bounding' : view ? gunFirstFireMode(env, d.shot) : (PHASE_FIRE_MODE[env.state.phase] ?? 'prep');
    const sc = shotContext(env, d.shot, mode, d.side, view ? { moving: firstFireTargets(env, view), movingInfo: movingInfo(env, view) } : {});
    const th = toHitNumber(env, sc);
    if (th) {
      needHd = th.th - env.query('ordnance.thDrm', sc, 0);
      needTem = needHd - tem;
    }
  }
  return { vehicle: vehicleId, firer, hd, tem, terrain: terrainOf(env, hex).name, needHd, needTem };
}

export const aslHullDownChoiceModule: RuleModule = {
  id: 'asl.hullDownChoice',
  ref: 'ASLRB B9.36, D4.2',
  summary: 'The owner of a vehicle HD to a Direct Fire ordnance shot may take the in-hex TEM (Case Q) instead, after the declaration and before the To Hit DR.',
  requires: ['asl.hullDown'],
  install(r) {
    r.event<{ action: Action | null; decisionId?: string }>({
      type: 'asl.hd.pending',
      apply(d, p) {
        if (p.action) d.ext[PENDING_EXT] = { action: p.action, decisionId: p.decisionId! } satisfies Pending;
        else delete d.ext[PENDING_EXT];
      },
    });
    r.event<{ vehicle: PieceId; choice: 'hd' | 'tem' | null }>({
      type: 'asl.hd.chosen',
      apply(d, p) {
        if (p.choice) d.ext[HD_CHOICE_EXT] = { vehicle: p.vehicle, choice: p.choice } satisfies HdChoiceState;
        else delete d.ext[HD_CHOICE_EXT];
      },
    });

    r.procedure<OrdnancePauseFn>(OP.pause, (next) => (ctx: Ctx, a, d) => {
      if (next?.(ctx, a, d)) return true;
      // Resuming the shot the owner has answered for: it goes ahead.
      if (ctx.state.ext[HD_CHOICE_EXT]) return false;
      const q = hdQuestion(ctx, a);
      if (!q) return false;
      ctx.emit('asl.hd.pending', { action: a, decisionId: d.id });
      ctx.pushDecision({
        kind: HD_CHOICE_DECISION,
        owner: pieceOf(ctx, q.vehicle).side,
        deadlineClass: 'interrupt',
        data: { vehicle: q.vehicle, firer: q.firer, kind: q.hd.kind, label: hullDownLabel(q.hd), tem: q.tem, terrain: q.terrain, needHd: q.needHd, needTem: q.needTem },
      });
      return true;
    });

    r.action<HdChooseAction>({
      type: 'hd.choose',
      decisionKinds: [HD_CHOICE_DECISION],
      legal: () => [
        { type: 'hd.choose', choice: 'hd' },
        { type: 'hd.choose', choice: 'tem' },
      ],
      validate: (_env, a) => (a.choice === 'hd' || a.choice === 'tem' ? null : 'Choose Hull Down or the in-hex TEM'),
      resolve(ctx, a, d: Decision) {
        const pending = ctx.state.ext[PENDING_EXT] as Pending | undefined;
        ctx.popDecision();
        ctx.emit('asl.hd.pending', { action: null });
        if (!pending) return;
        const vehicleId = d.data?.['vehicle'] as PieceId;
        ctx.emit('asl.hd.chosen', { vehicle: vehicleId, choice: a.choice });
        const original = ctx.state.decisions.find((x) => x.id === pending.decisionId) ?? ctx.state.decisions[ctx.state.decisions.length - 1]!;
        ctx.proc<OrdnanceResumeFn>(OP.resume)(ctx, pending.action, original);
        if (ctx.state.ext[HD_CHOICE_EXT]) ctx.emit('asl.hd.chosen', { vehicle: vehicleId, choice: null });
      },
    });
    // Time running out: Hull Down.
    r.autoResolver({
      id: 'asl.hd.choice.auto',
      decisionKind: HD_CHOICE_DECISION,
      resolve: (_env, _d, reason) => (reason === 'timeout' ? { type: 'hd.choose', choice: 'hd' } : null),
    });
  },
};
