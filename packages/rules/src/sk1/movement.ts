import type { Action, Ctx, HexId, Piece, PieceId, QueryEnv, RuleModule, Scalar, SideId } from '@asl/engine';
import { byId, defOf, hexOf, isFixedWeapon, isVehicleDef, otherSide, personnelAt, statics, swHeldBy, unpossessedSwAt } from '../common/pieces';
import { AP, type PaatcFn } from './advance';
import { visibleEnemyAt, knownEnemyAt } from './known';
import { PHASE_DECISION, askPhaseOwner } from '../common/turn';
import { FP, attackFp, buildAttack, directorsOf, firerLos, discloseDrm, iftColumn, simpleDeclarations, type FireAttackCtx, type FireDeclaration, type FireMode, type ResolveFireFn, type ApplyResultFn, weaponRange } from './fire';
import { P as MP, type FlushFn, type UnitFn } from './morale';
import {
  T,
  drmNotes,
  fireMarker,
  isBroken,
  isCx,
  isGoodOrder,
  isPinned,
  mmc,
  pieceOf,
  setTags,
  smc,
  squadEquivalents,
  gun,
  sw,
  wounds,
  restack,
  actionIllegal,
  ppOf,
} from './status';
import { MOVE, firstFireTargets, moveLoc, moveState } from './moveState';
import { LEVEL_CHANGE_MF, adjacentLocs, hexOfLoc, isGroundLoc, levelOfLoc, locKey, locOf, locationAt, parseLoc, type LocId, type SubLoc } from '../common/location';
import { inPlay, isOrchardRoad, isRoadHex, isWoodsRoad, smokeDrm, smokeGrenades, smokeIn, terrainOf } from './terrain';

declare module '@asl/engine' {
  interface QueryCatalog {
    /** MF allowance for a unit at the start of its move. */
    'unit.mf': { ctx: { unit: PieceId; stack: PieceId[]; doubleTime: boolean }; value: number };
    /** Reason the stack cannot begin moving, or null. */
    'move.cannotStart': { ctx: { units: PieceId[]; doubleTime: boolean; assault: boolean; manhandle?: PieceId }; value: string | null };
    /**
     * The MF/MP a step of the moving stack into Location `to` costs (`declared`: extra MP a vehicle announces, SK4
     * 3.3.2). `to` is a hex id at ground level; full ASL steps may name an upper building level ('uK4:1').
     */
    'move.stepCost': { ctx: { ms: MoveState; to: LocId; declared?: number; woods?: boolean; bypass?: HexId[] }; value: number };
    /** Why a moving stack may not step into Location `to` beyond the base rules, or null (PTO: a Gun manhandled into bamboo). */
    'move.stepIllegal': { ctx: { ms: MoveState; to: LocId }; value: string | null };
    /**
     * Infantry stacking limit in a hex for a side: squad equivalents and SMC (SK4 2.0: three and four; PTO Dense jungle and
     * bamboo two squad equivalents, SK4 8.2.1).
     */
    'stack.limit': { ctx: { hex: HexId; side: SideId }; value: { se: number; smc: number } };
    /** Why a moving vehicle may not step into `to`, or null (SK3; the Infantry checks do not apply to it). */
    'vehicle.stepIllegal': { ctx: { ms: MoveState; to: HexId; declared?: number }; value: string | null };
    /** Whether the defender has any legal, plausible Defensive First Fire shot at the moving stack (so it is asked); `hex` is its Location. */
    'move.firstFireAvailable': { ctx: { hex: LocId; units: PieceId[]; side: SideId }; value: boolean };
    /**
     * Why the moving stack may not step from its hex into the offboard hex `to`, leaving the map. The scenario's exit
     * rules answer (they own where and when a side may exit); with none, a stack never leaves the map.
     */
    'move.exitIllegal': { ctx: { ms: MoveState; to: HexId }; value: string | null };
    /** Smoke Exponent of a unit (0 when it has none); SSRs may raise it. */
    'unit.smoke': { ctx: { unit: PieceId }; value: number };
    /**
     * Full ASL Bypass (ASLRB A4.3): the `move.step` actions that put the moving stack in Bypass of an obstacle hex, or take
     * it further round the one it is bypassing. The Starter Kit has no Bypass: none.
     */
    'move.bypassSteps': { ctx: { ms: MoveState }; value: { type: 'move.step'; to: LocId; bypass: HexId[] }[] };
    /**
     * Why a step is refused for Bypass reasons (ASLRB A4.3, A4.31, A4.32): a `bypass` step, or any step of a stack that is
     * in Bypass (only the obstacle of its hex or a hex at its corner may be entered from there). Null when it is not.
     */
    'move.bypassIllegal': { ctx: { ms: MoveState; to: LocId; bypass?: HexId[] }; value: string | null };
    /** Whether the stack in Bypass must still leave it (ASLRB A4.32): it may stop there only when stranded. */
    'move.bypassMustLeave': { ctx: { ms: MoveState }; value: boolean };
  }
}

/** State of the stack currently moving (ext slice). */
import { recoverDrm } from './rally';

export interface MoveState {
  /** A Gun being manhandled by the stack (SK2, SK4 6.5): which, and whether the last push ended its movement. */
  manhandle?: { gun: PieceId; mustStop: boolean };
  /** Movement ended where it stands (bounced off a hidden Gun's hex, SK4 6.4): no more steps. */
  halted?: boolean;
  /**
   * Movement declared over where it stands (SK1 3.3.1): the defender is getting a last chance to fire
   * at the stack there before another unit moves; `halted` then finishes it.
   */
  ending?: boolean;
  /** The hex the stack was in before its last step (for crest and Covered Arc questions). */
  from?: HexId | null;
  units: PieceId[];
  /**
   * Units of the stack broken or pinned by Defensive First Fire in the current Location: they move no further
   * but may be fired on again there by other Defensive First Fire, until another unit moves (SK1 3.3.1, ASLRB
   * A8.14). `firstFireTargets` joins them to `units`; a step to a new Location leaves them behind.
   */
  stopped?: PieceId[];
  /** The units the move started with: the stack's identity as a Defensive First Fire target (`expenditureKey`). */
  started?: PieceId[];
  hex: HexId | null;
  /**
   * The building level the stack is at in `hex` (ASLRB A2.8); absent at ground level, never 0. `moveLoc` gives
   * the stack's Location, which First Fire targets and the MF/fire bookkeeping below are kept for.
   */
  level?: number;
  /** The sub-Location the stack is in (a cave, S70 SSR 2; ASLRB G11); absent elsewhere. */
  sub?: SubLoc;
  /** While still offboard: the virtual offboard hex the stack is in. */
  off?: HexId | null;
  allowance: Record<PieceId, number>;
  spent: Record<PieceId, number>;
  doubleTime: boolean;
  assault: boolean;
  hexesEntered: number;
  /** Every hexside crossed so far was a road hexside. */
  roadOnly: boolean;
  /** Entered the current hex along a road (Woods-Road TEM rule). */
  viaRoad: boolean;
  /** MF expended in the current Location (a level change starts a new one, ASLRB A8.12). */
  mfHere: number;
  /** Defender piece → First Fire attacks made against this stack in this location. */
  firedHere: Record<PieceId, number>;
  /** Best (lowest) Residual FP DRM already suffered in this location; null if none. */
  residualDrmHere: number | null;
  /** Some unit of the stack has attempted Smoke this MPh (kept for the frozen computer opponents). */
  smokeTried: boolean;
  /** The units that have attempted Smoke: "No unit may attempt to place Smoke grenades more than once per MPh" (SK1 3.3). */
  smokeTriedBy?: PieceId[];
  /** Units that started with a leader (2 MF bonus) — lose it if the leader leaves. */
  leaderBonus: PieceId[];
  /** Pending DC placement awaiting survival of Defensive First Fire (`vehicle`: predesignated against that AFV, SK4 4.3); `target` is a LocId. */
  dcPending?: { dc: PieceId; placer: PieceId; target: LocId; vehicle?: PieceId };
  /** Every MF/MP expenditure this move, by the map hex it was made in (SK3: "MP spent in the firer's LOS"). */
  trail?: { hex: HexId; mp: number }[];
  /** A vehicle on the move (SK3 3.3.2): its start/stop state; `allowance`/`spent` are MP. */
  vehicle?: VehicleMoveState;
  /**
   * Full ASL: the stack is in Bypass of the obstacle in `hex` (ASLRB A4.3; `asl/bypass.ts`): the hexsides it has gone along
   * there this MPh (`sides`, 0–5 as in `hexCorners.ts`), the corner it has reached (`at`) and the hex's Bypass cost for one
   * or two hexsides (`base`, doubled from the third, A4.31). Never set in the Starter Kit.
   */
  bypass?: BypassPos;
  /** Units broken or pinned while in Bypass (ASLRB A4.32, A4.33): the hexsides they had gone along when they stopped. */
  stoppedBypass?: Record<PieceId, number[]>;
  /**
   * What `move.start` changed before any MF was spent, so the choice of stack can be taken back (`move.cancel`):
   * the MF each unit started with (an entering force may start with some spent) and the tags the start set
   * (Double Time's CX, the leaders restacked onto the moving MMC), as they were before. Gone with the move.
   */
  cancel?: { spent: Record<PieceId, number>; tags: Record<PieceId, Record<string, Scalar>> };
}

/** Where a stack in Bypass is (see `MoveState.bypass`). */
export interface BypassPos {
  hex: HexId;
  sides: number[];
  at: number;
  base: number;
}

/** The vehicle part of a move (SK4 3.3.2), kept by the SK3 vehicle movement module. */
export interface VehicleMoveState {
  /** Paid its start MP (or began in Motion): may enter hexes and change its VCA. */
  started: boolean;
  /** Stopped (paid the stop MP, or never started): may Delay; must start again to move. */
  stopped: boolean;
  /** MP expenditures since the turret was last pointed: one TCA change per expenditure (3.3.2). */
  sinceTurret: number;
  /**
   * The turret has been pointed since the last MP expenditure. The one change that expenditure earns may
   * be any number of hexspines (3.3.2 "freely"), so further turns before the next expenditure only refine
   * where it was announced to point.
   */
  turretTurned?: boolean;
  /** Entered a woods hex at all its MP: the stop MP is free (SK4 1.1.1). */
  freeStop?: boolean;
  /** Bounding First Fire this MPh: the hex the first MA shot was fired from, and MP spent since the last shot (another is needed to fire again). */
  bffFrom?: HexId;
  sinceBff?: number;
  /** Tried its smoke dispenser this MPh. */
  smokeTried?: boolean;
  /** Ending the move: when the defender has had its say, the stack is finished (`halted` does the rest). */
  ending?: boolean;
  /** Changed its VCA this move: the one-hex minimum move at all its MP is no longer available (3.3.2). */
  turned?: boolean;
}

export { firstFireTargets, moveLoc, moveState } from './moveState';

export const FIRST_FIRE = 'firstFire';
/**
 * The defender's choice, once the moving stack is gone or nothing can fire at it any more, between keeping a
 * weapon's ROF and leaving its Residual FP (SK1 3.3.1). While the stack can still be fired on, the same choice
 * is offered inside the First Fire decision itself.
 */
export const ROF_RESIDUAL = 'rofResidual';

/**
 * A Defensive First Fire attack whose ROF-keeping weapons have yet to choose between the ROF and the
 * Residual FP they would leave by giving it up (SK1 3.3.1: "a SW that ... chooses to retain ROF leaves no
 * Residual FP"; SK4 3.3.5 the same for a Gun). Passing keeps the ROF; firing the weapon again uses it.
 */
export interface RofChoice {
  /** The attack's target Location (field name kept), where the Residual FP would go. */
  hex: LocId;
  /** The attack's weapons that kept ROF and have not chosen yet. */
  pending: PieceId[];
  /** Those of the attack that already gave their ROF up. */
  declined: PieceId[];
  /** Residual FP the attack leaves when these weapons (sorted ids, comma-joined) decline, the rest keeping ROF. */
  table: Record<string, number>;
}
const ROF_CHOICE = 'sk1.rofChoice';
export const rofChoices = (env: QueryEnv) => (env.state.ext[ROF_CHOICE] as RofChoice[] | undefined) ?? [];
const existingResidual = (env: QueryEnv, hex: HexId) => (env.state.hexMarkers[hex]?.['residualFp'] as number | undefined) ?? 0;
/** The Residual FP `sw` would add to its hex by giving up its ROF now (0 when the hex already holds as much). */
export function rofDeclineResidual(env: QueryEnv, sw: PieceId): { hex: HexId; residual: number } | null {
  const c = rofChoices(env).find((x) => x.pending.includes(sw));
  if (!c) return null;
  const residual = c.table[[...c.declined, sw].sort().join(',')] ?? 0;
  return { hex: c.hex, residual: residual > existingResidual(env, c.hex) ? residual : 0 };
}

/**
 * After a Defensive First Fire attack: the weapons that fired have used any ROF they were still deciding on,
 * and those that kept ROF this time get the choice (`rofResidual` from the resolver; nothing when the attack
 * could leave no Residual FP anyway).
 */
export function recordRofChoice(ctx: Ctx, hex: HexId, fired: PieceId[], rofResidual: { sws: PieceId[]; residual: number }[] | undefined) {
  const before = rofChoices(ctx);
  const choices = before.map((c) => ({ ...c, pending: c.pending.filter((id) => !fired.includes(id)) })).filter((c) => c.pending.length > 0);
  const pending = [...new Set(rofResidual?.flatMap((r) => r.sws) ?? [])].sort();
  if (pending.length && rofResidual!.some((r) => r.residual > existingResidual(ctx, hex))) {
    choices.push({ hex, pending, declined: [], table: Object.fromEntries(rofResidual!.map((r) => [[...r.sws].sort().join(','), r.residual])) });
  }
  if (choices.length || before.length) ctx.emit('sk1.rofChoice', { choices: choices.length ? choices : null });
}

export type MoveAction =
  | (Action & { type: 'move.start'; units: PieceId[]; doubleTime?: boolean; assault?: boolean; manhandle?: PieceId })
  /**
   * `to`: the Location entered, a hex id at ground level. In full ASL it may be another level of the stack's own hex
   * (up or down the stairs, ASLRB B23.4) or the same level of an adjacent hex of its building (B23.25).
   * `woods`: into a Woods-Road hex along the road, but into its woods (woods MF and TEM, no road bonus; SK1 1.1.1).
   * `bypass` (full ASL): in Bypass of the obstacle hex `to` along the hexsides it shares with these hexes, in order
   * (ASLRB A2.2 "R3-R4": `to` first); `to` the hex already bypassed goes further round it.
   */
  | (Action & { type: 'move.step'; to: LocId; declared?: number; woods?: boolean; bypass?: HexId[] })
  | (Action & { type: 'move.stopUnits'; units: PieceId[] })
  | (Action & { type: 'move.end' })
  /** Takes back the choice of the stack now moving, while it has spent no MF (see `cancelRefusal`). */
  | (Action & { type: 'move.cancel' })
  /**
   * Smoke grenades: `unit` throws into `target`, or every unit of `throws` into its own target, all for the one
   * "simultaneous" MF expenditure of the stack (ASLRB A4.2), before any placement dr is rolled.
   */
  | (Action & { type: 'move.smoke'; target?: HexId; unit?: PieceId; throws?: SmokeThrow[] })
  | (Action & { type: 'move.recover'; unit: PieceId; sw: PieceId })
  | (Action & { type: 'move.drop'; sw: PieceId })
  /** `target`: the ADJACENT Location the DC is placed in (a hex id at ground level). */
  | (Action & { type: 'move.placeDc'; dc: PieceId; target: LocId; vehicle?: PieceId });

/** One unit's Smoke grenade attempt and the hex it is thrown into (its own or an adjacent one, SK1 3.3). */
export interface SmokeThrow {
  unit: PieceId;
  target: HexId;
}

/** The throws of a `move.smoke` action, in the order rolled. */
export const smokeThrows = (a: { unit?: PieceId; target?: HexId; throws?: SmokeThrow[] }): SmokeThrow[] =>
  a.throws ?? (a.unit && a.target ? [{ unit: a.unit, target: a.target }] : []);

const MMC_BASE_MF = 4;
const SMC_BASE_MF = 6;

/** SW tag: a unit already tried to recover it this MPh (prefix + unit id); cleared at the end of the MPh. */
const RECOVER_TRIED = 'recoverTried_';
/** SW tag: carried into a hex this MPh (SK1 4.0: portaged at most once per MPh); cleared at the end of the MPh. */
const PORTAGED = 'portaged';

const isLeader = (env: QueryEnv, id: PieceId) => !!smc(env, pieceOf(env, id));

/** PP carried by a unit. */
export const ppCarried = (env: QueryEnv, unit: PieceId) =>
  swHeldBy(env.state, unit).reduce((a, s) => a + ppOf(env, s), 0);

/** Effective IPC including a leader's +1 lent to one MMC in a combined stack (SK1 4.0). */
function ipcFor(env: QueryEnv, unit: PieceId, stack: PieceId[]): number {
  const base = env.query('unit.ipc', { unit }, 0);
  if (isLeader(env, unit)) return base;
  // The MMC carrying the most excess PP borrows one leader's IPC.
  const lenders = stack.filter((id) => isLeader(env, id) && isGoodOrder(env, pieceOf(env, id)) && ppCarried(env, id) === 0);
  if (lenders.length === 0) return base;
  const mmcs = stack
    .filter((id) => mmc(env, pieceOf(env, id)))
    .sort((a, b) => ppCarried(env, b) - env.query('unit.ipc', { unit: b }, 0) - (ppCarried(env, a) - env.query('unit.ipc', { unit: a }, 0)) || (a < b ? -1 : 1));
  return mmcs[0] === unit ? base + 1 : base;
}

export const movementModule: RuleModule = {
  id: 'sk1.movement',
  ref: 'SK1 3.3, 3.3.1, 4.0',
  summary: 'Movement Phase: stacks, leader bonus, Double Time, Assault Movement, road bonus, portage, Smoke, SW recovery, DC placement and Defensive First Fire.',
  requires: ['sk1.fire', 'sk1.terrain', 'common.turn'],
  install(r) {
    /** A Smoke grenade attempt (SK1 3.3): the dr and whether Smoke went down (Concealment: an attempt costs the "?"). */
    r.event<{ unit: PieceId; target: HexId; dr: number; placed: boolean }>({ type: 'sk1.move.smoke', apply() {} });
    /** A DC placement attempt (SK1 4.3), before any PAATC: the attempt itself costs a concealed placer its "?". */
    r.event<{ dc: PieceId; placer: PieceId; target: LocId }>({ type: 'sk1.move.dcAttempt', apply() {} });
    r.event<{ state: MoveState | null }>({
      type: 'sk1.move.state',
      apply(d, p) {
        if (p.state) d.ext[MOVE] = p.state;
        else delete d.ext[MOVE];
      },
    });
    r.event<{ choices: RofChoice[] | null }>({
      type: 'sk1.rofChoice',
      apply(d, p) {
        if (p.choices) d.ext[ROF_CHOICE] = p.choices;
        else delete d.ext[ROF_CHOICE];
      },
    });
    /** A weapon gave up the ROF it had kept and left its attack's Residual FP (SK1 3.3.1). */
    r.event<{ sw: PieceId; hex: HexId; residual: number }>({ type: 'sk1.fire.rofDeclined', apply() {} });

    r.procedure<(c: Ctx, gun: PieceId, units: PieceId[]) => void>(MANHANDLE_STARTED, () => () => {});
    r.procedure<MoveEnterFn>(MOVE_ENTER, () => (ctx, ms, to, cost, woods, extra) => enterHex(ctx, ms, to, cost, woods, extra));
    r.procedure<MoveEnteredFn>(MOVE_ENTERED, () => () => {});
    r.procedure<MoveFinishFn>(MOVE_FINISH, () => (ctx) => finishStackBase(ctx));
    r.contribute({ id: 'sk1.move.stepCost.base', query: 'move.stepCost', layer: 0, apply: (_v, { ms, to, woods }, env) => stepCost(env, ms, to, woods) });

    // ---------------------------------------------------------------- Smoke Exponent
    r.contribute({
      id: 'sk1.smoke.base',
      query: 'unit.smoke',
      layer: 0,
      apply: (_v, { unit }, env) => mmc(env, pieceOf(env, unit))?.smoke ?? 0,
    });

    // ---------------------------------------------------------------- MF allowance
    r.contribute({
      id: 'sk1.mf.base',
      query: 'unit.mf',
      layer: 0,
      apply(_v, { unit }, env) {
        const p = pieceOf(env, unit);
        if (smc(env, p)) return wounds(p) > 0 ? 3 : SMC_BASE_MF;
        return env.query('unit.inexperienced', { unit }, false) ? 3 : MMC_BASE_MF;
      },
    });
    r.contribute({
      id: 'sk1.mf.leader-bonus',
      query: 'unit.mf',
      ref: 'SK1 3.3',
      label: '+2 MF moving with a leader',
      // A wounded leader still gives the bonus (ASLRB A17.2; SK1 3.3 is silent), though his own 3 MF bound the stack.
      when: ({ unit, stack }, env) => !!mmc(env, pieceOf(env, unit)) && stack.some((id) => isLeader(env, id) && isGoodOrder(env, pieceOf(env, id))),
      // A Green MMC with a leader isn't Inexperienced, so its base is 4 → 6.
      apply: (v, { unit, stack }, env) => {
        const greenWithLeader = mmc(env, pieceOf(env, unit))?.quality === 'G';
        void stack;
        return (greenWithLeader ? Math.max(v, MMC_BASE_MF) : v) + 2;
      },
    });
    r.contribute({
      id: 'sk1.mf.wounded-leader-cap',
      query: 'unit.mf',
      layer: 150,
      when: ({ unit }, env) => !!smc(env, pieceOf(env, unit)) && wounds(pieceOf(env, unit)) > 0,
      apply: () => 3,
    });
    r.contribute({
      id: 'sk1.mf.double-time',
      query: 'unit.mf',
      layer: 160,
      ref: 'SK1 3.3',
      label: '+2 MF Double Time',
      when: ({ doubleTime }) => doubleTime,
      apply: (v) => v + 2,
    });
    r.contribute({
      id: 'sk1.mf.portage',
      query: 'unit.mf',
      layer: 170,
      ref: 'SK1 4.0',
      label: '-1 MF per PP over IPC',
      apply(v, { unit, stack, doubleTime }, env) {
        const ipc = ipcFor(env, unit, stack) - (doubleTime && !isCx(pieceOf(env, unit)) ? 1 : 0);
        return v - Math.max(0, ppCarried(env, unit) - ipc);
      },
    });

    r.contribute({
      id: 'sk1.move.can-start',
      query: 'move.cannotStart',
      layer: 0,
      apply(v, { units, doubleTime, assault }, env) {
        if (v) return v;
        if (units.length === 0) return 'Select units to move';
        const halted = actionIllegal(env, units);
        if (halted) return halted;
        const where = (id: PieceId) => {
          const l = pieceOf(env, id).loc;
          return l.kind === 'hex' ? locKey(l) : l.kind === 'offboard' ? `off:${l.hex ?? id}` : id;
        };
        // One Location (ASLRB A2.8; the hex in the Starter Kit).
        if (new Set(units.map(where)).size > 1) return 'Units moving together must start in the same hex';
        for (const id of units) {
          const p = env.state.pieces[id];
          if (!p || p.side !== env.state.attacker) return `${id} is not yours`;
          if (!mmc(env, p) && !smc(env, p)) return `${id} is not Infantry`;
          if (p.loc.kind !== 'hex' && p.loc.kind !== 'offboard') return `${id} cannot move`;
          if (isBroken(p)) return `${id} is broken`;
          if (isPinned(p)) return `${id} is pinned`;
          if (!isGoodOrder(env, p)) return `${id} is in Melee`;
          if (p.tags[T.moved]) return `${id} has already moved this phase`;
          if (p.loc.kind === 'offboard' && (p.tags['entryTurn'] as number | undefined ?? 0) > env.state.turn) return `${id} enters on turn ${p.tags['entryTurn']}`;
          if (p.loc.kind === 'offboard' && (p.loc.edge === 'setup' || p.loc.edge === 'exited')) return `${id} cannot move`;
          if (p.loc.kind === 'offboard' && !p.loc.hex) return `${id} has not been set up offboard`;
          if (fireMarker(p) || p.tags[T.firedSw]) return `${id} fired in the PFPh`;
          // No Double Time while wounded or CX, nor in the MPh that took the CX counter off (SK1 3.3: the
          // counter "does not affect that unit during that MPh other than prohibiting its use of Double Time").
          if (doubleTime && (wounds(p) > 0 || isCx(p) || p.tags['cxPrev'] !== undefined)) return `${id} cannot Double Time`;
          if (smc(env, p) && ppCarried(env, id) > 2) return `${id}: a SMC may never carry more than 2 PP`;
        }
        if (doubleTime && assault) return 'Assault Movement and Double Time are exclusive';
        return null;
      },
    });

    // ---------------------------------------------------------------- MPh flow
    r.on<{ phase: string }>({
      id: 'sk1.movement.start',
      event: 'turn.phaseStarted',
      handler(ctx, ev) {
        if (ev.payload.phase !== 'MPh') return;
        // CX is removed at the start of the unit's next MPh (SK1 3.3).
        for (const p of Object.values(ctx.state.pieces).filter((x) => x.side === ctx.state.attacker && isCx(x)).sort(byId)) {
          setTags(ctx, p.id, { [T.cx]: null, cxPrev: true });
        }
        askPhaseOwner(ctx, ctx.state.attacker);
      },
    });
    r.on<{ phase: string }>({
      id: 'sk1.movement.end',
      event: 'turn.phaseEnded',
      handler(ctx, ev) {
        if (ev.payload.phase !== 'MPh') return;
        if (moveState(ctx)) finishStack(ctx);
        for (const [hex, m] of Object.entries(ctx.state.hexMarkers).sort()) {
          if (m['smoke'] !== undefined) ctx.emit('hex.marker', { hex, key: 'smoke', value: null });
          if (m['residualFp'] !== undefined) ctx.emit('hex.marker', { hex, key: 'residualFp', value: null });
        }
        for (const p of Object.values(ctx.state.pieces).filter((x) => x.tags['cxPrev'] !== undefined).sort(byId)) {
          setTags(ctx, p.id, { cxPrev: null });
        }
        // Per-MPh SW bookkeeping: failed recovery attempts and the once-per-MPh portage limit.
        for (const p of Object.values(ctx.state.pieces).sort(byId)) {
          const keys = Object.keys(p.tags).filter((k) => k === PORTAGED || k.startsWith(RECOVER_TRIED));
          if (keys.length) setTags(ctx, p.id, Object.fromEntries(keys.map((k) => [k, null])));
        }
        // Offboard units due to enter this turn that did not enter are eliminated (unless they may still enter in the APh).
      },
    });

    r.action<MoveAction & { type: 'move.start' }>({
      type: 'move.start',
      decisionKinds: [PHASE_DECISION],
      legal(env) {
        if (env.state.phase !== 'MPh' || moveState(env)) return [];
        const out: Omit<MoveAction & { type: 'move.start' }, 'side' | 'decisionId'>[] = [];
        // A unit that may not start on its own may still start by manhandling something it holds
        // (a Quick Set Up Gun, SK4 6.5): the sk2 module's `move.cannotStart` says which.
        const manhandleFor = (p: Piece): PieceId | null => {
          for (const sw of swHeldBy(env.state, p.id))
            if (!env.query('move.cannotStart', { units: [p.id], doubleTime: false, assault: false, manhandle: sw.id }, null)) return sw.id;
          return null;
        };
        const byHex = new Map<string, { p: Piece; manhandle: PieceId | null }[]>();
        for (const p of Object.values(env.state.pieces).sort(byId)) {
          if (p.side !== env.state.attacker || !(mmc(env, p) || smc(env, p))) continue;
          let manhandle: PieceId | null = null;
          if (env.query('move.cannotStart', { units: [p.id], doubleTime: false, assault: false }, null)) {
            manhandle = manhandleFor(p);
            if (!manhandle) continue;
          }
          const k = p.loc.kind === 'hex' ? locKey(p.loc) : `off:${(p.loc.kind === 'offboard' && p.loc.hex) || p.id}`;
          byHex.set(k, [...(byHex.get(k) ?? []), { p, manhandle }]);
        }
        for (const ps of byHex.values()) {
          for (const { p, manhandle } of ps) out.push({ type: 'move.start', units: [p.id], ...(manhandle ? { manhandle } : {}) });
          if (ps.length > 1) {
            // The whole stack: pushing the one Gun among them (a stack cannot push two).
            const guns = [...new Set(ps.map((x) => x.manhandle).filter((g): g is PieceId => !!g))];
            const units = ps.map((x) => x.p.id);
            if (guns.length === 0) out.push({ type: 'move.start', units });
            else if (guns.length === 1 && !env.query('move.cannotStart', { units, doubleTime: false, assault: false, manhandle: guns[0]! }, null)) out.push({ type: 'move.start', units, manhandle: guns[0]! });
          }
        }
        return out;
      },
      validate: (env, a) =>
        env.state.phase !== 'MPh'
          ? 'Not the Movement Phase'
          : moveState(env)
            ? 'Finish moving the current stack first'
            : env.query('move.cannotStart', { units: a.units, doubleTime: !!a.doubleTime, assault: !!a.assault, ...(a.manhandle ? { manhandle: a.manhandle } : {}) }, null),
      resolve(ctx, a) {
        const units = [...a.units].sort();
        const before = ctx.state.pieces;
        const allowance: Record<PieceId, number> = {};
        for (const id of units) {
          allowance[id] = ctx.query('unit.mf', { unit: id, stack: units, doubleTime: !!a.doubleTime }, 0);
        }
        const leaderBonus = units.filter((id) => mmc(ctx, pieceOf(ctx, id)) && units.some((l) => isLeader(ctx, l)));
        if (a.doubleTime) for (const id of units) setTags(ctx, id, { [T.cx]: true });
        restack(ctx, units);
        const tagsBefore = changedTagsSince(before, ctx.state.pieces);
        // A force that enters "having already expended" MF starts its entry move with them spent.
        const spent = Object.fromEntries(
          units.map((u) => {
            const p = pieceOf(ctx, u);
            return [u, p.loc.kind === 'offboard' ? ((p.tags['entryMfSpent'] as number | undefined) ?? 0) : 0];
          }),
        );
        const first = pieceOf(ctx, units[0]!);
        ctx.emit('sk1.move.state', {
          state: {
            units,
            hex: first.loc.kind === 'hex' ? first.loc.hex : null,
            ...(first.loc.kind === 'hex' && first.loc.level ? { level: first.loc.level } : {}),
            ...(first.loc.kind === 'hex' && first.loc.sub ? { sub: first.loc.sub as SubLoc } : {}),
            off: first.loc.kind === 'offboard' ? (first.loc.hex ?? null) : null,
            allowance,
                spent,
            started: units,
            doubleTime: !!a.doubleTime,
            assault: !!a.assault,
            hexesEntered: 0,
            // No road bonus where a rule treats roads as Open Ground (SSR).
            roadOnly: ctx.query('move.roadRate', {}, true),
            viaRoad: false,
            mfHere: 0,
            firedHere: {},
            residualDrmHere: null,
            smokeTried: false,
            leaderBonus,
            from: null,
            // Manhandling a Gun: no road bonus (SK4 6.5); the push steps are the sk2 module's.
            ...(a.manhandle ? { manhandle: { gun: a.manhandle, mustStop: false }, roadOnly: false } : {}),
            cancel: { spent, tags: tagsBefore },
          } satisfies MoveState,
        });
        if (a.manhandle) ctx.proc<(c: Ctx, gun: PieceId, units: PieceId[]) => void>(MANHANDLE_STARTED)(ctx, a.manhandle, units);
        reAskMover(ctx);
      },
    });

    r.action<MoveAction & { type: 'move.step' }>({
      type: 'move.step',
      decisionKinds: [PHASE_DECISION],
      legal(env) {
        const ms = moveState(env);
        if (!ms || env.state.phase !== 'MPh') return [];
        // The ADJACENT Locations (ASLRB A.8): the neighbouring hexes in the Starter Kit; in full ASL also the other
        // levels of a building hex (B23.4) and, from an upper level, only its own floor of the building (B23.25).
        // From the map also the offboard hexes beyond the edge (exiting, where the scenario allows it).
        const cands = ms.hex ? [...adjacentLocs(env, moveLoc(ms)!), ...exitTargets(env, ms)] : offboardTargets(env, ms);
        // Full ASL Bypass: the stack in Bypass may also enter the obstacle of its hex (ASLRB A4.3).
        if (ms.bypass) cands.push(ms.bypass.hex);
        return [
          ...cands.flatMap((to) => [
            ...(stepRefusal(env, ms, to) ? [] : [{ type: 'move.step', to }]),
            ...(woodsRoadChoice(env, ms, to) && !stepRefusal(env, ms, to, undefined, true) ? [{ type: 'move.step', to, woods: true }] : []),
          ]),
          ...(ms.hex && !ms.vehicle ? env.query('move.bypassSteps', { ms }, []) : []),
        ];
      },
      validate(env, a) {
        const ms = moveState(env);
        if (!ms) return 'No stack is moving';
        return stepRefusal(env, ms, a.to, a.declared, !!a.woods, a.bypass);
      },
      resolve(ctx, a) {
        const ms = moveState(ctx)!;
        const cost = ctx.query('move.stepCost', { ms, to: a.to, ...(a.declared !== undefined ? { declared: a.declared } : {}), ...(a.woods ? { woods: true } : {}), ...(a.bypass ? { bypass: a.bypass } : {}) }, 1);
        // Full ASL Bypass (`asl/bypass.ts`): into Bypass, further round, or into the obstacle of the hex bypassed.
        if (a.bypass || (ms.bypass && hexOfLoc(a.to) === ms.bypass.hex)) {
          ctx.proc<MoveBypassFn>(MOVE_BYPASS)(ctx, ms, a.to, a.bypass, cost);
          return;
        }
        // From the map into an offboard hex: the whole stack exits.
        if (ms.hex && isGroundLoc(a.to) && statics(ctx).map.offboardHex(a.to)) {
          ctx.proc<MoveExitFn>(MOVE_EXIT)(ctx, ms, a.to, cost);
          return;
        }
        if (isGroundLoc(a.to) && statics(ctx).map.offboardHex(a.to)) {
          // Sideways along the edge while still offboard: Open Ground cost (or the hex's own terrain where an
          // SSR says off-board terrain exists), no Defensive First Fire.
          for (const id of ms.units) {
            const l = pieceOf(ctx, id).loc;
            ctx.emit('piece.moved', { id, loc: { kind: 'offboard', edge: l.kind === 'offboard' ? l.edge : undefined, hex: a.to } });
          }
          ctx.emit('sk1.move.state', {
            state: { ...ms, off: a.to, spent: Object.fromEntries(ms.units.map((u) => [u, (ms.spent[u] ?? 0) + cost])), roadOnly: false, mfHere: cost },
          });
          reAskMover(ctx);
          return;
        }
        ctx.proc<MoveEnterFn>(MOVE_ENTER)(ctx, ms, a.to, cost, !!a.woods);
      },
    });

    // SK1 3.3: a moving stack may break up during the MPh; the rest carry on moving.
    r.action<MoveAction & { type: 'move.stopUnits' }>({
      type: 'move.stopUnits',
      decisionKinds: [PHASE_DECISION],
      legal(env) {
        const ms = moveState(env);
        if (!ms || env.state.phase !== 'MPh' || ms.units.length < 2 || ms.dcPending || mustLeaveBypass(env, ms)) return [];
        return ms.units.map((u) => ({ type: 'move.stopUnits', units: [u] }));
      },
      validate(env, a) {
        const ms = moveState(env);
        if (!ms) return 'No stack is moving';
        if (ms.dcPending) return 'Finish the DC placement first';
        if (mustLeaveBypass(env, ms)) return BYPASS_NO_STOP;
        if (a.units.length === 0) return 'Choose the units that stop here';
        if (!a.units.every((u) => ms.units.includes(u))) return 'Units are not part of the moving stack';
        return null;
      },
      resolve(ctx, a) {
        const ms = moveState(ctx)!;
        for (const u of a.units) {
          setTags(ctx, u, { [T.moved]: true });
          for (const s of swHeldBy(ctx.state, u)) setTags(ctx, s.id, { [T.moved]: true });
        }
        const { units: remaining, allowance } = withoutLeaderBonus(ctx, ms, ms.units.filter((u) => !a.units.includes(u)));
        if (remaining.length === 0) {
          endStack(ctx);
          return;
        }
        ctx.emit('sk1.move.state', { state: { ...ms, units: remaining, allowance } });
        reAskMover(ctx);
      },
    });

    r.action<MoveAction & { type: 'move.end' }>({
      type: 'move.end',
      decisionKinds: [PHASE_DECISION],
      legal: (env) => (moveState(env) && !mustLeaveBypass(env, moveState(env)!) ? [{ type: 'move.end' }] : []),
      validate: (env) => (!moveState(env) ? 'No stack is moving' : mustLeaveBypass(env, moveState(env)!) ? BYPASS_NO_STOP : null),
      resolve(ctx) {
        endStack(ctx);
      },
    });

    // Choosing a stack to move is not yet movement: a unit moves by expending MF (ASLRB A4.1, A4.11; SK1 3.3), so
    // until it has spent any the choice may be taken back and the units are free to move later this MPh. Not in
    // `legal()`: it undoes a choice rather than making a move, so the computer opponent never needs it.
    r.action<MoveAction & { type: 'move.cancel' }>({
      type: 'move.cancel',
      decisionKinds: [PHASE_DECISION],
      validate: (env) => cancelRefusal(env),
      resolve(ctx) {
        const ms = moveState(ctx)!;
        for (const [id, tags] of Object.entries(ms.cancel!.tags).sort(([a], [b]) => (a < b ? -1 : 1))) setTags(ctx, id as PieceId, tags);
        ctx.emit('sk1.move.state', { state: null });
        reAskMover(ctx);
      },
    });

    r.action<MoveAction & { type: 'move.smoke' }>({
      type: 'move.smoke',
      decisionKinds: [PHASE_DECISION],
      validate(env, a) {
        const ms = moveState(env);
        if (!ms || !ms.hex) return 'No stack is moving on the map';
        const throws = smokeThrows(a);
        if (throws.length === 0) return 'No Smoke grenade attempt declared';
        if (new Set(throws.map((t) => t.unit)).size !== throws.length) return 'A unit may attempt Smoke only once per MPh';
        // Units moving as a stack spend each MF together, and "need not spend MF for the same purpose": every attempt
        // declared at once is one expenditure of the costliest of them (ASLRB A4.2; SK1 3.3 is silent on stacks).
        const cost = smokeCost(ms, throws);
        for (const t of throws) {
          if (!ms.units.includes(t.unit)) return 'Unit is not moving';
          if (!env.query('unit.smoke', { unit: t.unit }, 0)) return 'Unit has no Smoke exponent';
          if (ms.smokeTriedBy?.includes(t.unit)) return 'This unit has already attempted Smoke this MPh';
          if (t.target !== ms.hex && !statics(env).map.neighbors(ms.hex).includes(t.target)) return 'Smoke target must be own or adjacent hex';
          if (remaining(env, ms, t.unit) < cost) return 'Not enough MF';
        }
        return assaultAllMf(ms, cost);
      },
      resolve(ctx, a) {
        const ms = moveState(ctx)!;
        const throws = smokeThrows(a);
        const sixes: PieceId[] = [];
        // Every attempt is rolled and placed before the defender may fire at the expenditure (ASLRB A8.1).
        for (const t of throws) {
          const exponent = ctx.query('unit.smoke', { unit: t.unit }, 0);
          const dr = ctx.roll(`Smoke grenades by ${t.unit}`, 1).total;
          const final = dr + (isCx(pieceOf(ctx, t.unit)) ? 1 : 0);
          if (ctx.query('events.optional', {}, false)) ctx.emit('sk1.move.smoke', { unit: t.unit, target: t.target, dr, placed: final <= exponent });
          // Each success is another counter in the hex (ASLRB A24.2: no limit on the number placed).
          if (final <= exponent) ctx.emit('hex.marker', { hex: t.target, key: 'smoke', value: smokeGrenades(ctx.state.hexMarkers[t.target]) + 1 });
          if (dr === 6) sixes.push(t.unit);
        }
        spendInPlace(ctx, ms, smokeCost(ms, throws), { smokeTried: true, smokeTriedBy: [...(ms.smokeTriedBy ?? []), ...throws.map((t) => t.unit)] });
        // A placement dr of 6 ends that unit's MPh where it stands (SK1 3.3); the rest of the stack may go on.
        if (sixes.length) {
          for (const u of sixes) setTags(ctx, u, { [T.moved]: true });
          const after = moveState(ctx)!;
          const rest = after.units.filter((u) => !sixes.includes(u));
          if (rest.length === 0) {
            finishStack(ctx);
            reAskMover(ctx);
            return;
          }
          ctx.emit('sk1.move.state', { state: { ...after, units: rest } });
        }
        afterMfExpenditure(ctx);
      },
    });

    r.action<MoveAction & { type: 'move.recover' }>({
      type: 'move.recover',
      decisionKinds: [PHASE_DECISION],
      validate(env, a) {
        const ms = moveState(env);
        if (!ms || !ms.hex) return 'No stack is moving on the map';
        if (!ms.units.includes(a.unit)) return 'Unit is not moving';
        // ASLRB A4.44: Recovery only by a non-Bypassing unit.
        if (ms.bypass) return 'A unit in Bypass may not Recover a SW (ASLRB A4.44)';
        if (!unpossessedSwAt(env, moveLoc(ms)!).some((s) => s.id === a.sw)) return 'No such unpossessed SW here';
        const s = pieceOf(env, a.sw);
        if (s.tags[RECOVER_TRIED + a.unit]) return 'Already attempted';
        if (s.tags[PORTAGED]) return 'No SW can be portaged more than once per MPh';
        const u = pieceOf(env, a.unit);
        if (gun(env, s) && !mmc(env, u)) return 'Only a MMC may possess a Gun';
        if (smc(env, u) && ppCarried(env, a.unit) + ppOf(env, s) > 2) return 'A SMC may never carry more than 2 PP';
        if (remaining(env, ms, a.unit) < 1) return 'Not enough MF';
        return assaultAllMf(ms, 1);
      },
      resolve(ctx, a) {
        const ms = moveState(ctx)!;
        const dr = ctx.roll(`Recover ${a.sw}`, 1).total + recoverDrm(ctx, a.unit);
        setTags(ctx, a.sw, { [RECOVER_TRIED + a.unit]: true });
        if (dr < 6) {
          ctx.emit('piece.moved', { id: a.sw, loc: { kind: 'held', by: a.unit } });
          if (pieceOf(ctx, a.sw).side !== ctx.state.attacker) ctx.emit('sk1.sw.owner', { id: a.sw, side: ctx.state.attacker });
        }
        spendInPlace(ctx, ms, 1, {});
        afterMfExpenditure(ctx);
      },
    });

    // SK1 4.0: an unbroken unit may drop a SW at no MF cost during its MPh (while moving) or APh.
    r.action<MoveAction & { type: 'move.drop' }>({
      type: 'move.drop',
      decisionKinds: [PHASE_DECISION],
      validate(env, a) {
        const s = env.state.pieces[a.sw];
        if (!s || s.loc.kind !== 'held') return 'Not a carried SW';
        if (isFixedWeapon(env, s)) return 'A vehicular MG is part of its vehicle';
        // The APh, and the MPh before the unit moves: "An unbroken unit may drop possession of a Weapon at no MF cost during
        // its MPh or APh"; dropped "at the start of an allowed phase prior to expending MF", the Weapon was never possessed
        // that phase (SK4 4.0). This is how a unit holding a Gun it cannot move (no QSU) gets free to move.
        const ms = moveState(env);
        if (env.state.phase === 'APh' || (env.state.phase === 'MPh' && !ms)) {
          const holder = pieceOf(env, s.loc.by);
          if (holder.side !== env.state.attacker || holder.loc.kind !== 'hex') return 'Not your unit on the map';
          if (isBroken(holder)) return 'A broken unit cannot drop a SW';
          if (env.state.phase === 'MPh' && holder.tags[T.moved]) return 'That unit has already moved this phase';
          return null;
        }
        if (!ms || !ms.units.includes(s.loc.by)) return 'Not carried by the moving stack';
        return null;
      },
      resolve(ctx, a) {
        const holder = (pieceOf(ctx, a.sw).loc as { by: PieceId }).by;
        if (ctx.state.phase === 'APh' || !moveState(ctx)) {
          ctx.emit('piece.moved', { id: a.sw, loc: locationAt(locOf(ctx.state, pieceOf(ctx, holder))!) });
          ctx.popDecision();
          askPhaseOwner(ctx, ctx.state.attacker);
          return;
        }
        const ms = moveState(ctx)!;
        ctx.emit('piece.moved', { id: a.sw, loc: ms.hex ? locationAt(moveLoc(ms)!) : { kind: 'eliminated' } });
        // Dropping before expending MF means the SW wasn't portaged: recompute allowance.
        if ((ms.spent[holder] ?? 0) === 0) {
          ctx.emit('sk1.move.state', {
            state: { ...ms, allowance: { ...ms.allowance, [holder]: ctx.query('unit.mf', { unit: holder, stack: ms.units, doubleTime: ms.doubleTime }, 0) } },
          });
        }
        reAskMover(ctx);
      },
    });

    r.action<MoveAction & { type: 'move.placeDc' }>({
      type: 'move.placeDc',
      decisionKinds: [PHASE_DECISION],
      validate(env, a) {
        const ms = moveState(env);
        if (!ms || !ms.hex) return 'No stack is moving on the map';
        const dc = env.state.pieces[a.dc];
        if (!dc || dc.loc.kind !== 'held' || !ms.units.includes(dc.loc.by) || sw(env, dc)?.type !== 'DC') return 'No DC carried by the moving stack';
        if (!adjacentLocs(env, moveLoc(ms)!).includes(a.target)) return 'DC target must be adjacent';
        const cost = env.query('move.cost', { unit: dc.loc.by, from: ms.hex, to: hexOfLoc(a.target), viaRoad: false, ...(isGroundLoc(a.target) ? {} : { loc: a.target }) }, 0);
        if (remaining(env, ms, dc.loc.by) < cost) return 'Not enough MF to place the DC';
        if (ms.dcPending) return 'A DC placement is already in progress';
        const assaultAll = assaultAllMf(ms, cost);
        if (assaultAll) return assaultAll;
        if (a.vehicle) {
          const v = env.state.pieces[a.vehicle];
          if (!v || v.side === a.side || locOf(env.state, v) !== a.target || !isVehicleDef(defOf(env, v)) || v.tags['wreck'] === true) return 'The predesignated AFV is not in the target hex';
        }
        return null;
      },
      resolve(ctx, a) {
        const ms = moveState(ctx)!;
        const placer = (pieceOf(ctx, a.dc).loc as { by: PieceId }).by;
        if (ctx.query('events.optional', {}, false)) ctx.emit('sk1.move.dcAttempt', { dc: a.dc, placer, target: a.target });
        // Against an AFV an MMC first passes a PAATC (SK4 4.3); a failure pins it and the DC stays in hand.
        if (a.vehicle && mmc(ctx, pieceOf(ctx, placer)) && !ctx.proc<PaatcFn>(AP.paatc)(ctx, placer, a.vehicle, 'dc')) {
          reAskMover(ctx);
          return;
        }
        const cost = ctx.query('move.cost', { unit: placer, from: ms.hex, to: hexOfLoc(a.target), viaRoad: false, ...(isGroundLoc(a.target) ? {} : { loc: a.target }) }, 0);
        spendInPlace(ctx, ms, cost, { dcPending: { dc: a.dc, placer, target: a.target, ...(a.vehicle ? { vehicle: a.vehicle } : {}) } });
        afterMfExpenditure(ctx);
      },
    });

    r.event<{ id: PieceId; side: SideId }>({
      type: 'sk1.sw.owner',
      apply(d, p) {
        d.pieces[p.id]!.side = p.side;
      },
    });

    // ---------------------------------------------------------------- Defensive First Fire
    r.action<Action & { decl: FireDeclaration }>({
      type: 'defFire',
      decisionKinds: [FIRST_FIRE],
      legal(env) {
        const ms = moveState(env);
        if (!ms || !ms.hex) return [];
        const side = otherSide(env.state, env.state.attacker);
        const out: { type: string; decl: FireDeclaration }[] = [];
        const seen = new Set<string>();
        for (const mode of ['first', 'subsequentFirst', 'fpf'] as FireMode[]) {
          for (const decl of simpleDeclarations(env, side, [moveLoc(ms)!], mode, firstFireTargets(env, ms))) {
            const key = JSON.stringify(decl);
            if (seen.has(key) || firstFireIllegal(env, ms, decl, side)) continue;
            seen.add(key);
            out.push({ type: 'defFire', decl });
          }
        }
        return out;
      },
      validate(env, a) {
        const ms = moveState(env);
        if (!ms || !ms.hex) return 'Nothing is moving';
        if (a.decl.target !== moveLoc(ms)) return 'Defensive First Fire must target the moving stack';
        return firstFireIllegal(env, ms, a.decl, a.side);
      },
      resolve(ctx, a) {
        const ms = moveState(ctx)!;
        const mode = firstFireMode(ctx, a.decl);
        const targets = firstFireTargets(ctx, ms);
        const out = ctx.proc<ResolveFireFn>(FP.resolve)(ctx, a.decl, mode, {
          moving: targets,
          movingInfo: movingInfo(ctx, ms),
        });
        recordRofChoice(ctx, a.decl.target, a.decl.sw, out.rofResidual);
        finishDefensiveFire(ctx, [...a.decl.units, ...a.decl.sw, ...directorsOf(a.decl)]);
      },
    });
    r.contribute({
      id: 'sk1.move.firstFire.available',
      query: 'move.firstFireAvailable',
      layer: 0,
      apply(v, { hex, units, side }, env) {
        if (v) return v;
        const ms = moveState(env);
        if (!ms) return false;
        return (['first', 'subsequentFirst', 'fpf'] as FireMode[]).some((mode) =>
          simpleDeclarations(env, side, [hex], mode, units).some((d) => !firstFireIllegal(env, ms, d, side) && plausibleLos(env, d)),
        );
      },
    });

    // Passing keeps any ROF still being decided on (the weapon stays unmarked, no Residual FP).
    r.action<Action>({
      type: 'defPass',
      decisionKinds: [FIRST_FIRE, ROF_RESIDUAL],
      legal: () => [{ type: 'defPass' }],
      resolve(ctx) {
        if (rofChoices(ctx).length) ctx.emit('sk1.rofChoice', { choices: null });
        ctx.popDecision();
        completeDcPlacement(ctx);
        reAskMover(ctx);
      },
    });

    // ---------------------------------------------------------------- ROF or Residual FP
    // A weapon that kept ROF in Defensive First Fire may give it up to leave the attack's Residual FP
    // instead (SK1 3.3.1, SK4 3.3.5): it is marked as it would have been, the counter goes down, and the
    // defender goes on deciding (other firers, or passing).
    r.action<Action & { type: 'defRofDecline'; sw: PieceId }>({
      type: 'defRofDecline',
      decisionKinds: [FIRST_FIRE, ROF_RESIDUAL],
      legal(env) {
        return rofChoices(env)
          .flatMap((c) => c.pending)
          .filter((sw) => (rofDeclineResidual(env, sw)?.residual ?? 0) > 0)
          .sort()
          .map((sw) => ({ type: 'defRofDecline' as const, sw }));
      },
      validate(env, a) {
        const p = env.state.pieces[a.sw];
        if (!p || p.side !== a.side) return `${a.sw} is not yours`;
        const r = rofDeclineResidual(env, a.sw);
        if (!r) return `${a.sw} has no ROF to give up`;
        if (r.residual <= 0) return `${r.hex} already holds as much Residual FP as ${a.sw} would leave`;
        return null;
      },
      resolve(ctx, a) {
        const { hex, residual } = rofDeclineResidual(ctx, a.sw)!;
        const choices = rofChoices(ctx)
          .map((c) => (c.pending.includes(a.sw) ? { ...c, pending: c.pending.filter((id) => id !== a.sw), declined: [...c.declined, a.sw].sort() } : c))
          .filter((c) => c.pending.length > 0);
        ctx.emit('sk1.rofChoice', { choices: choices.length ? choices : null });
        ctx.emit('hex.marker', { hex, key: 'residualFp', value: residual });
        ctx.emit('sk1.fire.rofDeclined', { sw: a.sw, hex, residual });
        // Marked as the attack would have marked it (`markFirers`): the marker it earned, or Final Fire
        // for a weapon that was already marked and fired again.
        const p = pieceOf(ctx, a.sw);
        const earned = p.tags[T.rofFired] as string | undefined;
        if (earned !== undefined) setTags(ctx, a.sw, { [T.rofFired]: null, ...(fireMarker(p) ? {} : { [T.fire]: earned }) });
        else if (fireMarker(p) === 'first') setTags(ctx, a.sw, { [T.fire]: 'final' });
        // With nothing left to decide and nothing left to shoot at, the mover gets its turn back.
        const top = ctx.state.decisions[ctx.state.decisions.length - 1];
        if (top?.kind === ROF_RESIDUAL && choices.length === 0) {
          ctx.popDecision();
          completeDcPlacement(ctx);
          reAskMover(ctx);
        }
      },
    });

    // Standing orders: by default an unanswered First Fire opportunity is passed on timeout.
    for (const decisionKind of [FIRST_FIRE, ROF_RESIDUAL]) {
      r.autoResolver({
        id: `sk1.${decisionKind}.timeout-pass`,
        decisionKind,
        resolve: (env, d, reason) => {
          const orders = (env.state.ext['sk1.orders'] as Record<SideId, string> | undefined)?.[d.owner] ?? 'ask';
          if (reason === 'timeout' || orders === 'pass') return { type: 'defPass' };
          return null;
        },
      });
    }
    r.event<{ side: SideId; orders: 'ask' | 'pass' }>({
      type: 'sk1.orders',
      apply(d, p) {
        const o = (d.ext['sk1.orders'] as Record<string, string> | undefined) ?? {};
        o[p.side] = p.orders;
        d.ext['sk1.orders'] = o;
      },
    });
  },
};

// --------------------------------------------------------------------------------------

/**
 * The MF a unit of the moving stack needs to leave the map from `hex` (SK4 3.x: "as if the offboard hex
 * were Open Ground"; the offboard hex's own terrain where an SSR says off-board terrain exists), through
 * the cheapest offboard hex beside it, and the MF it has for that (the road bonus along a road hexside).
 */
export function exitMf(env: QueryEnv, ms: MoveState, unit: PieceId, hex: HexId): { cost: number; left: number } {
  const map = statics(env).map;
  let best: { cost: number; left: number } | null = null;
  for (const o of map.offboard('N,E,S,W')) {
    if (!map.offboardNeighbors(o.id).onboard.includes(hex)) continue;
    const viaRoad = map.roadHexside?.(hex, o.id) ?? false;
    const cost = env.query('move.cost', { unit, from: hex, to: o.id, viaRoad }, 1);
    const left = remaining(env, ms, unit) + (ms.roadOnly && viaRoad ? 1 : 0);
    if (!best || left - cost > best.left - best.cost) best = { cost, left };
  }
  return best ?? { cost: 1, left: remaining(env, ms, unit) };
}

/** MF left for spending other than a move step (Smoke, SW recovery, DC placement): the road bonus only pays for road steps. */
function remaining(_env: QueryEnv, ms: MoveState, unit: PieceId) {
  return (ms.allowance[unit] ?? 0) - (ms.spent[unit] ?? 0);
}

/** The road bonus has been earned: at least one hex entered, every hexside crossed a road hexside. */
export const roadBonusEarned = (ms: MoveState) => ms.roadOnly && ms.hexesEntered > 0;
/** The stack is on the move by Assault Movement (SK1 3.3): Defensive First Fire at it gets no FFNAM (3.3.1). */
export const assaultMoving = (ms: MoveState) => ms.assault && !ms.vehicle && ms.units.length > 0;

function entryHexes(env: QueryEnv, ms: MoveState): HexId[] {
  // A concealed stack coming on (SK4 8.3) is a "?" in the other side's redacted view: nothing of its to list there.
  const p = env.state.pieces[ms.units[0]!];
  return p ? entryHexesOf(env, p) : [];
}

/** The map hexes an entering piece may come onto the board by: its edge's hexes, cut to the card's ("on or west of J10") where it names them. */
export function entryHexesOf(env: QueryEnv, p: Piece): HexId[] {
  const edge = (p.loc.kind === 'offboard' && p.loc.edge) || (p.tags['entryEdge'] as string | undefined);
  if (!edge) return [];
  const allowed = p.tags['entryHexes'] as string | undefined;
  const hexes = edge.split(',').flatMap((e) => statics(env).map.edge(e));
  return allowed ? hexes.filter((h) => allowed.split(',').includes(h)) : hexes;
}

const EDGE_WORD: Record<string, string> = { N: 'north', E: 'east', S: 'south', W: 'west' };

/**
 * Why an offboard stack may not come onto the map at `to`. A card that names the entry hexes ("along the north
 * edge on or west of J10") leaves the road hex just beyond them looking like the obvious way in, so the refusal
 * quotes the card rather than saying "designated edge" to a stack already sitting on that edge.
 */
function entryRefusal(env: QueryEnv, ms: MoveState, to: HexId): string {
  const map = statics(env).map;
  if (!map.hex(to)) return ms.off ? 'Must move to an adjacent hex' : 'Must enter from the designated edge';
  const p = pieceOf(env, ms.units[0]!);
  const entry = entryHexesOf(env, p);
  if (entry.includes(to)) return `${to} is not next to the stack's offboard position: move along the edge first`;
  const force = statics(env).scenario.forces[p.tags['force'] as number];
  // A tactical reserve enters by its SSR's edges, not the force's ("enter on Turn 1 ... along the north edge").
  const reserve = p.tags['reserve'] as string | undefined;
  const rule = force?.setup.kind === 'enter' && !reserve ? force.setup.description : undefined;
  const edge = (p.loc.kind === 'offboard' && p.loc.edge) || (p.tags['entryEdge'] as string | undefined) || '';
  const by = rule
    ? rule.charAt(0).toLowerCase() + rule.slice(1)
    : `it enters along the ${edge.split(',').map((e) => EDGE_WORD[e] ?? e).join(' or ')} edge${reserve ? ` (${reserve})` : ''}`;
  return `${to} is not one of this group's entry hexes: ${by}`;
}

/** From an offboard hex: the entry hexes beside it, or another offboard hex along the same edge. */
function offboardTargets(env: QueryEnv, ms: MoveState): HexId[] {
  if (!ms.off) return entryHexes(env, ms);
  const n = statics(env).map.offboardNeighbors(ms.off);
  const entry = entryHexes(env, ms);
  return [...n.onboard.filter((h) => entry.includes(h)), ...n.offboard];
}

/** Whether a step crosses a road hexside (roads extend offboard, SK1 3.3). */
function roadSideTo(env: QueryEnv, ms: MoveState, to: LocId): boolean {
  // Stairs and upper floors are no road (full ASL; a Starter Kit step is always ground to ground).
  if (!isGroundLoc(to) || ms.level || ms.sub) return false;
  const map = statics(env).map;
  if (ms.hex) return map.roadHexside?.(ms.hex, to) ?? false;
  if (ms.off) return map.roadHexside?.(ms.off, to) ?? false;
  // Offboard with no particular offboard hex: on a road only if the road leaves the map beside `to`.
  const p = pieceOf(env, ms.units[0]!);
  const edge = (p.loc.kind === 'offboard' && p.loc.edge) || (p.tags['entryEdge'] as string | undefined);
  if (!edge) return false;
  return map.offboard(edge).some((o) => map.offboardNeighbors(o.id).onboard.includes(to) && (map.roadHexside?.(o.id, to) ?? false));
}

/**
 * May this step into a Woods-Road or Orchard-Road hex choose between the road and the other terrain? Infantry entering
 * it across a road hexside pay the road rate and are out on the road, or "may always choose to utilize the woods
 * movement rate and receive resultant TEM benefits" (SK1 1.1.1 Woods-Road). A vehicle is always on the road (B13.31).
 * In an Orchard-Road hex both cost one MF; claiming the orchard's non-Open Ground forfeits the road bonus (SK4 1.1.1
 * Roads and Orchard-Road, ASLRB B3.43, B14.6). The `woods` flag of `move.step` makes that choice in either hex.
 */
export function woodsRoadChoice(env: QueryEnv, ms: MoveState, to: LocId): boolean {
  return !ms.vehicle && isGroundLoc(to) && !statics(env).map.offboardHex(to) && (isWoodsRoad(env, to) || isOrchardRoad(env, to)) && roadSideTo(env, ms, to);
}

function stepCost(env: QueryEnv, ms: MoveState, to: LocId, woods = false) {
  const map = statics(env).map;
  const toHex = hexOfLoc(to);
  // Off the map from an exit hex: the offboard hex's cost, at the road rate along a road leaving the map (SK4 3.x).
  if (map.offboardHex(toHex) && ms.hex && !ms.off) {
    const viaRoad = map.roadHexside?.(ms.hex, toHex) ?? false;
    return Math.max(...ms.units.map((u) => env.query('move.cost', { unit: u, from: ms.hex, to: toHex, viaRoad }, 1)));
  }
  // Offboard: Open Ground (SK4 3.x), unless the map gives the hex its printed terrain (SSR); no road there.
  if (map.offboardHex(toHex)) return Math.max(...ms.units.map((u) => env.query('move.cost', { unit: u, from: ms.off ?? null, to: toHex, viaRoad: false }, 1)));
  // Up or down a level within a building hex: one MF, in a printed or inherent stairwell (ASLRB B23.4). Full ASL only:
  // a Starter Kit step always enters another hex.
  if (toHex === ms.hex) return LEVEL_CHANGE_MF;
  // Along an upper floor the costs are the ground level's (B23.421), so a building hex costs its usual MF.
  const roadSide = roadSideTo(env, ms, to) && !woods;
  const loc = isGroundLoc(to) ? {} : { loc: to };
  return Math.max(...ms.units.map((u) => env.query('move.cost', { unit: u, from: ms.hex, to: toHex, viaRoad: roadSide, ...loc }, 1)));
}

const BYPASS_NO_STOP = 'Infantry may not end its move in Bypass (ASLRB A4.32): enter the obstacle, or step into a hex at the corner';
/** Full ASL: a stack in Bypass that could still leave it may not end its move or leave units there (ASLRB A4.32). */
const mustLeaveBypass = (env: QueryEnv, ms: MoveState) => !!ms.bypass && ms.units.length > 0 && !ms.halted && env.query('move.bypassMustLeave', { ms }, true);

/** Why a `move.step` is refused: the Bypass rules first where they apply (full ASL), then the ordinary ones. */
function stepRefusal(env: QueryEnv, ms: MoveState, to: LocId, declared?: number, woods = false, bypass?: HexId[]): string | null {
  if (bypass || ms.bypass) {
    const why = env.query('move.bypassIllegal', { ms, to, ...(bypass ? { bypass } : {}) }, bypass ? 'There is no Bypass in the Starter Kit rules' : null);
    if (why) return why;
    if (bypass || (ms.bypass && hexOfLoc(to) === ms.bypass.hex)) return null;
  }
  return stepIllegal(env, ms, to, false, declared, woods);
}

function stepIllegal(env: QueryEnv, ms: MoveState, to: LocId, pushing = false, declared?: number, woods = false): string | null {
  const map = statics(env).map;
  const toHex = hexOfLoc(to);
  const offTo = map.offboardHex(toHex);
  if (!map.hex(toHex) && !offTo) return 'No such hex';
  if (ms.hex) {
    // Stepping off the map is exiting it: the scenario's exit rules decide, for the whole stack (they check the MF too).
    if (offTo) return ms.halted ? 'The stack has ended its movement' : env.query('move.exitIllegal', { ms, to: toHex }, 'Units may not leave the map');
    // ADJACENT Locations only (ASLRB A.8): the neighbouring hexes in the Starter Kit (one Location each). In full ASL
    // an upper building level is left only by the stairs or along the same floor of the building (B23.25, B23.422).
    if (!adjacentLocs(env, moveLoc(ms)!).includes(to)) {
      if (ms.level) return 'From an upper level a stack may only take the stairs or move along the same floor of its building (ASLRB B23.25)';
      return toHex === ms.hex ? 'That Location is not ADJACENT (ASLRB A.8)' : 'Must move to an adjacent hex';
    }
  } else if (!isGroundLoc(to) || !offboardTargets(env, ms).includes(to)) {
    return entryRefusal(env, ms, toHex);
  }
  if (ms.halted) return 'The stack has ended its movement';
  if (!offTo && !inPlay(env, toHex)) return 'That hex is not in play';
  // A vehicle (SK3) has rules of its own: its Vehicle Covered Arc, MP costs, Bog, one vehicle per hex.
  if (woods && !woodsRoadChoice(env, ms, to)) return 'Only Infantry entering a Woods-Road (or Orchard-Road) hex along the road choose its woods (or orchard)';
  if (ms.vehicle && !isGroundLoc(to)) return parseLoc(to).sub === 'cave' ? 'A vehicle may not enter a Cave' : 'A vehicle may never occupy an upper building level (ASLRB B23.4)';
  if (ms.vehicle) return env.query('vehicle.stepIllegal', { ms, to: toHex, ...(declared !== undefined ? { declared } : {}) }, null);
  if (ms.dcPending) return 'Finish the DC placement first';
  if (ms.manhandle && !isGroundLoc(to)) return parseLoc(to).sub === 'cave' ? 'A Gun may not enter a Cave' : 'A Gun may not occupy an upper building level (ASLRB B23.423)';
  if (ms.manhandle && !pushing) return 'The stack is manhandling a Gun: push it (double MF, manhandling DR)';
  // Per Location (ASLRB A4.14): in full ASL an enemy on another level of the hex does not bar this one. A Location
  // holding only a concealed enemy stack may be *attempted* (SK4 8.3.2: both "?" come off and the mover stops short).
  if (knownEnemyAt(env, to, env.state.attacker).length > 0) return isGroundLoc(to) && !ms.level ? 'Cannot enter an enemy-occupied hex in the MPh' : 'Cannot enter an enemy-occupied Location in the MPh (ASLRB A4.14)';
  if (ms.assault && ms.hexesEntered >= 1) return 'Assault Movement is limited to one hex';
  const extra = env.query('move.stepIllegal', { ms, to }, null);
  if (extra) return extra;
  const cost = stepCost(env, ms, to, woods);
  // Road bonus is only usable if this step keeps the move on road hexsides (taking the woods of a Woods-Road
  // hex claims its protective benefits and gives up the bonus, SK1 3.3), and never for a step into Smoke:
  // the bonus is forfeited by a unit that "has to pay the extra movement costs for entering Smoke" (SK1 1.1.1).
  const bonusStep = !offTo && roadSideTo(env, ms, to) && !woods && !smokeIn(env, toHex);
  for (const u of ms.units) {
    const left = (ms.allowance[u] ?? 0) + (ms.roadOnly && bonusStep ? 1 : 0) - (ms.spent[u] ?? 0);
    // Always allowed to enter one hex if it costs all MF (minimum move) — not in SK1; must have the MF.
    if (cost > left) return `${u} lacks the MF (${left}) to enter (${cost})`;
  }
  const assaultAll = assaultAllMf(ms, cost);
  if (assaultAll) return assaultAll;
  // Stacking: three squad-equivalents and four SMC per side, per Location (ASLRB A5.1; "a hex", SK4 2.0, where
  // a hex is one Location), "at any time during the move" (SK4 3.3) and so offboard as well: A2.51 has offboard units
  // move "normally" over real hexes, which are Open Ground (no terrain lowers the limit).
  const here = (offTo ? offboardOccupants(env, to, env.state.attacker) : personnelAt(env, to, env.state.attacker)).filter((p) => !ms.units.includes(p.id));
  const all = [...here, ...ms.units.map((u) => pieceOf(env, u))];
  const se = squadEquivalents(env, all);
  const smcs = all.filter((p) => smc(env, p)).length;
  const limit = offTo ? OPEN_STACK_LIMIT : stackLimit(env, to, env.state.attacker);
  if (se > limit.se) return `Stacking limit: ${limit.se} squad-equivalents`;
  if (smcs > limit.smc) return `Stacking limit: ${limit.smc} SMC`;
  return null;
}

/** The Infantry stacking limit of a hex for a side (SK4 2.0; PTO terrain may lower it). */
export const stackLimit = (env: QueryEnv, hex: HexId, side: SideId) => env.query('stack.limit', { hex, side }, OPEN_STACK_LIMIT);

/** The Infantry stacking limit with no terrain to lower it, as offboard (SK4 2.0, 3.3; ASLRB A5.1). */
export const OPEN_STACK_LIMIT = { se: 3, smc: 4 } as const;

/** The side's Personnel waiting in an offboard hex (`except` left out). */
export const offboardOccupants = (env: QueryEnv, hex: HexId, side: SideId, except: Iterable<PieceId> = []): Piece[] => {
  const skip = new Set(except);
  return Object.values(env.state.pieces).filter((p) => p.side === side && p.loc.kind === 'offboard' && p.loc.hex === hex && !skip.has(p.id) && !!(mmc(env, p) || smc(env, p)));
};

/**
 * Assault Movement is a move of one hex that "does not take all of the unit's MF" (SK1 3.3; ASLRB A4.61): no step and
 * nothing spent in place (Smoke grenades, Recovery, a DC) may bring a unit of the stack to its whole allowance.
 */
function assaultAllMf(ms: MoveState, cost: number): string | null {
  if (!ms.assault) return null;
  return ms.units.some((u) => (ms.spent[u] ?? 0) + cost >= (ms.allowance[u] ?? 0)) ? 'Assault Movement may not use all MF (SK1 3.3)' : null;
}

/** SK1 3.3: one MF to place Smoke in the stack's own hex, two in an adjacent one. */
function smokeCost(ms: MoveState, throws: SmokeThrow[]): number {
  return throws.some((t) => t.target !== ms.hex) ? 2 : 1;
}

function spendInPlace(ctx: Ctx, ms: MoveState, cost: number, patch: Partial<MoveState>) {
  ctx.emit('sk1.move.state', {
    state: {
      ...ms,
      ...patch,
      spent: Object.fromEntries(ms.units.map((u) => [u, (ms.spent[u] ?? 0) + cost])),
      mfHere: ms.mfHere + cost,
      ...(ms.hex && cost > 0 ? { trail: [...(ms.trail ?? []), { hex: ms.hex, mp: cost }] } : {}),
    },
  });
}

export function movingInfo(env: QueryEnv, ms: MoveState): NonNullable<FireAttackCtx['moving']> {
  // Units broken here by Defensive First Fire are still subject to FFNAM/FFMO, and no longer using Assault
  // Movement; units pinned here are not subject to them while pinned (SK1 3.3.1). The DRM is the attack's, so
  // it goes by the targets as a whole: Assault Movement while any target is still moving, none if all are pinned.
  const targets = firstFireTargets(env, ms).map((u) => pieceOf(env, u));
  const assault = ms.assault && (ms.units.length > 0 || targets.some((p) => !isBroken(p)));
  const pinned = !!ms.stopped?.length && targets.length > 0 && targets.every((p) => isPinned(p) && !isBroken(p));
  return { assault, viaRoadIntoWoodsRoad: ms.viaRoad && !!ms.hex && isWoodsRoad(env, ms.hex), ...(ms.viaRoad && ms.hex && isOrchardRoad(env, ms.hex) ? { viaRoadIntoOrchardRoad: true } : {}), ...(ms.manhandle ? { hazardous: true } : {}), ...(ms.vehicle ? { vehicle: true } : {}), ...(pinned ? { pinned: true } : {}), from: ms.from ?? null };
}

/** Procedure run when a stack starts manhandling a Gun: (ctx, gun, units). Registered by the SK2 manhandling module. */
export const MANHANDLE_STARTED = 'sk1.move.manhandleStarted';

/**
 * Procedure that moves a stack into a map Location it has paid for: (ctx, moveState, to, cost). `to` is a LocId (the hex
 * id at ground level; vehicles stay at ground level). SK2's HIP wraps it.
 */
export const MOVE_ENTER = 'sk1.move.enter';
export type MoveEnterFn = (ctx: Ctx, ms: MoveState, to: LocId, cost: number, woods?: boolean, extra?: Partial<MoveState>) => void;
/**
 * Procedure for a full ASL Bypass step (`asl/bypass.ts`): (ctx, moveState, to, bypass hexsides or none, cost). With
 * `bypass` it puts the stack in Bypass of `to` or takes it further round; without, the stack in Bypass enters the
 * obstacle of its hex. Not registered in the Starter Kit, which never offers such a step.
 */
export const MOVE_BYPASS = 'sk1.move.bypass';
export type MoveBypassFn = (ctx: Ctx, ms: MoveState, to: LocId, bypass: HexId[] | undefined, cost: number) => void;
/** Procedure run once the stack stands in its new hex, before Defensive First Fire is offered: (ctx, moveState after the step). SK3's Bog Check wraps it. */
export const MOVE_ENTERED = 'sk1.move.entered';
export type MoveEnteredFn = (ctx: Ctx, ms: MoveState) => void;
/** Procedure for a stack stepping off the map into offboard hex `to` at `cost` MF: (ctx, ms, to, cost). The scenario's exit rules provide it. */
export const MOVE_EXIT = 'sk1.move.exit';
export type MoveExitFn = (ctx: Ctx, ms: MoveState, to: HexId, cost: number) => void;

/** The offboard hexes beyond the moving stack's hex (the hexes a step off the map would enter). */
export function exitTargets(env: QueryEnv, ms: Pick<MoveState, 'hex' | 'off'>): HexId[] {
  if (!ms.hex || ms.off) return [];
  const map = statics(env).map;
  const hex = ms.hex;
  return map
    .offboard('N,E,S,W')
    .filter((o) => map.offboardNeighbors(o.id).onboard.includes(hex))
    .map((o) => o.id);
}

/** Procedure that finishes the moving stack (its units have moved): (ctx). SK3 wraps it for a vehicle's Motion. */
export const MOVE_FINISH = 'sk1.move.finish';
export type MoveFinishFn = (ctx: Ctx) => void;

function enterHex(ctx: Ctx, ms: MoveState, toLoc: LocId, cost: number, woods = false, extra?: Partial<MoveState>) {
  const to = hexOfLoc(toLoc);
  const level = levelOfLoc(toLoc);
  const sub = parseLoc(toLoc).sub;
  // Into the woods of a Woods-Road hex: off the road from here on, as far as the road bonus goes (SK1 3.3).
  const roadSide = roadSideTo(ctx, ms, toLoc) && !woods;
  const viaRoad = roadSide && (isRoadHex(ctx, to) || isWoodsRoad(ctx, to));
  // Entering Smoke forfeits the road bonus for the MPh (SK1 1.1.1), though the unit is still on the road
  // for the Woods-Road TEM rule.
  const bonusStep = roadSide && !smokeIn(ctx, to);
  for (const id of ms.units) {
    ctx.emit('piece.moved', { id, loc: locationAt(toLoc) });
    // SK1 4.0: no SW can be portaged more than once per MPh.
    for (const s of swHeldBy(ctx.state, id).sort(byId)) if (!s.tags[PORTAGED]) setTags(ctx, s.id, { [PORTAGED]: true });
  }
  // A new Location: its MF and First Fire counts start afresh (ASLRB A8.12). `level` only above ground, never 0.
  // Units stopped in the old one stay behind: their MPh ends as the others move on (SK1 3.3.1).
  // A Bypass (full ASL) ends with its hex: the stack is out of it, or (`extra`) in Bypass of the next.
  const { level: _was, sub: _in, stopped: _left, bypass: _round, stoppedBypass: _strand, ...rest } = ms;
  const next: MoveState = {
    ...rest,
    from: ms.hex,
    hex: to,
    off: null,
    spent: Object.fromEntries(ms.units.map((u) => [u, (ms.spent[u] ?? 0) + cost])),
    hexesEntered: ms.hexesEntered + 1,
    roadOnly: ms.roadOnly && bonusStep,
    viaRoad,
    mfHere: cost,
    firedHere: {},
    residualDrmHere: null,
    trail: [...(ms.trail ?? []), { hex: to, mp: cost }],
    ...(level ? { level } : {}),
    ...(sub ? { sub } : {}),
    ...extra,
  };
  ctx.emit('sk1.move.state', { state: next });
  ctx.proc<MoveEnteredFn>(MOVE_ENTERED)(ctx, next);
  afterMfExpenditure(ctx);
}

/** Pieces of the movement machinery the SK2 manhandling module drives directly. */
export const moveInternals = {
  stepCost: (env: QueryEnv, ms: MoveState, to: HexId) => stepCost(env, ms, to),
  stepIllegal: (env: QueryEnv, ms: MoveState, to: HexId) => stepIllegal(env, ms, to, true),
  afterMfExpenditure: (ctx: Ctx) => afterMfExpenditure(ctx),
  finishStack: (ctx: Ctx) => finishStack(ctx),
  endStack: (ctx: Ctx) => endStack(ctx),
  reAskMover: (ctx: Ctx) => reAskMover(ctx),
  spendInPlace: (ctx: Ctx, ms: MoveState, cost: number, patch: Partial<MoveState>) => spendInPlace(ctx, ms, cost, patch),
  roadSideTo: (env: QueryEnv, ms: MoveState, to: HexId) => roadSideTo(env, ms, to),
  offerFirstFire: (ctx: Ctx) => offerFirstFire(ctx),
  offboardTargets: (env: QueryEnv, ms: MoveState) => offboardTargets(env, ms),
  entryHexes: (env: QueryEnv, ms: MoveState) => entryHexes(env, ms),
  remaining: (ms: MoveState, unit: PieceId) => (ms.allowance[unit] ?? 0) - (ms.spent[unit] ?? 0),
};

/** Units still able to move: drop broken/pinned/eliminated units from the moving stack. */
function pruneMovers(ctx: Ctx) {
  const ms = moveState(ctx);
  if (!ms) return;
  const alive = ms.units.filter((u) => {
    const p = ctx.state.pieces[u];
    return p && p.loc.kind !== 'eliminated';
  });
  const movers = alive.filter((u) => {
    const p = pieceOf(ctx, u);
    return !isBroken(p) && !isPinned(p);
  });
  for (const u of alive.filter((x) => !movers.includes(x))) setTags(ctx, u, { [T.moved]: true });
  // A SMC wounded on the way "is reduced to three MF ... and cannot Double Time" (SK1 3.3): his allowance
  // drops to a wounded SMC's at once, and he is finished if he has already spent that much. One who had
  // already spent more than that is also pinned (ASLRB A17.2; SK1 is silent).
  const capped = { ...ms.allowance };
  const walking = movers.filter((u) => {
    const p = pieceOf(ctx, u);
    if (!smc(ctx, p) || wounds(p) === 0) return true;
    const cap = ctx.query('unit.mf', { unit: u, stack: movers, doubleTime: false }, 0);
    if (cap < (capped[u] ?? 0)) capped[u] = cap;
    if ((ms.spent[u] ?? 0) < capped[u]!) return true;
    if ((ms.spent[u] ?? 0) > cap) ctx.proc<UnitFn>(MP.pin)(ctx, u);
    setTags(ctx, u, { [T.moved]: true });
    for (const sw of swHeldBy(ctx.state, u)) setTags(ctx, sw.id, { [T.moved]: true });
    return false;
  });
  // A leader pinned, broken, killed or stopped by a wound on the way takes the leader bonus with him.
  const { units: going, allowance } = withoutLeaderBonus(ctx, ms, walking, capped);
  // A broken/pinned DC placer cancels the placement.
  const dcPending = ms.dcPending && going.includes(ms.dcPending.placer) ? ms.dcPending : undefined;
  // Units broken or pinned by Defensive First Fire move no further, but "can be fired upon again in [their]
  // current location by other Defensive First Fire attacks" (SK1 3.3.1, ASLRB A8.14) until another unit moves.
  const stopped = [...(ms.stopped ?? []), ...alive.filter((u) => !movers.includes(u))].filter((u, i, all) => all.indexOf(u) === i && ctx.state.pieces[u]?.loc.kind === 'hex');
  // Full ASL: a unit broken or pinned in Bypass stays in the open part of the hex for the rest of its MPh, open to fire
  // traced to the hexsides it went along (ASLRB A4.32, A4.33).
  const stoppedBypass = ms.bypass
    ? { ...ms.stoppedBypass, ...Object.fromEntries(alive.filter((u) => !movers.includes(u) && !ms.stoppedBypass?.[u]).map((u) => [u, [...ms.bypass!.sides]])) }
    : undefined;
  if (going.length === 0) {
    // Nobody left to move on: the move ends here once the defender has had his follow-up shots (`halted`).
    const halted = ms.hex && stopped.length ? { ...ms, units: [], allowance, stopped, ...(stoppedBypass ? { stoppedBypass } : {}), halted: true, ending: true, dcPending: undefined } : null;
    ctx.emit('sk1.move.state', { state: halted });
    return;
  }
  ctx.emit('sk1.move.state', { state: { ...ms, units: going, allowance, ...(stopped.length ? { stopped } : {}), ...(stoppedBypass ? { stoppedBypass } : {}), ...(dcPending ? { dcPending } : { dcPending: undefined }) } });
}

/**
 * The units going on from a moving stack. MMC that no longer have a leader with them lose the
 * leader bonus: it needs them to begin and end the MPh with him, moving in a combined stack (SK1
 * 3.3, ASLRB A4.12). Each falls back to its own allowance, and stops if it has already spent it.
 */
function withoutLeaderBonus(ctx: Ctx, ms: MoveState, units: PieceId[], allowance: Record<PieceId, number> = { ...ms.allowance }): { units: PieceId[]; allowance: Record<PieceId, number> } {
  if (units.some((u) => isLeader(ctx, u))) return { units, allowance };
  for (const u of units.filter((x) => ms.leaderBonus.includes(x))) {
    allowance[u] = ctx.query('unit.mf', { unit: u, stack: [u], doubleTime: ms.doubleTime }, 0);
    if ((ms.spent[u] ?? 0) >= allowance[u]!) {
      setTags(ctx, u, { [T.moved]: true });
      for (const s of swHeldBy(ctx.state, u)) setTags(ctx, s.id, { [T.moved]: true });
    }
  }
  return { units: units.filter((u) => !pieceOf(ctx, u).tags[T.moved]), allowance };
}

function finishStack(ctx: Ctx) {
  if (!moveState(ctx)) return;
  ctx.proc<MoveFinishFn>(MOVE_FINISH)(ctx);
}

function finishStackBase(ctx: Ctx) {
  const ms = moveState(ctx);
  if (!ms) return;
  for (const u of ms.units) {
    const p = ctx.state.pieces[u];
    if (!p || p.loc.kind === 'eliminated') continue;
    setTags(ctx, u, { [T.moved]: true });
    for (const s of swHeldBy(ctx.state, u)) setTags(ctx, s.id, { [T.moved]: true });
  }
  ctx.emit('sk1.move.state', { state: null });
}

/**
 * The stack's movement is declared over where it stands. The defender gets a last chance to fire at it
 * there before another unit moves (SK1 3.3.1: the attacker "must give the DEFENDER ample opportunity to
 * declare his fire before moving on, and must declare the end of that unit's movement before moving
 * another unit"; ASLRB A8.1). Only the MF spent in that hex count (`firedHere` against `mfHere`), so a
 * stack that spent nothing there, or is still offboard, draws no fire and is simply finished.
 */
/**
 * Whether the stack could still have moved on: some unit has MF/MP left, or the road bonus is in hand.
 * The on-map MF/MP pill shows the defender the same figures.
 */
function movementLeft(ms: MoveState): boolean {
  return ms.units.some((u) => (ms.allowance[u] ?? 0) - (ms.spent[u] ?? 0) > 0) || (!ms.vehicle && roadBonusEarned(ms));
}

/**
 * The stack's move is declared over where it stands. When it stops with movement left, the defender gets a
 * last First Fire chance there first (SK1 3.3.1: the attacker "must declare the end of that unit's movement
 * before moving another unit", so a unit that halts early is still a legitimate target). A stack that used
 * its last MF/MP was already offered after that expenditure, and the defender could see it had none left, so
 * asking again would only repeat the same question.
 */
function endStack(ctx: Ctx) {
  const ms = moveState(ctx);
  if (!ms) return;
  if (!ms.hex || ms.mfHere <= 0 || ms.halted || !movementLeft(ms)) {
    finishStack(ctx);
    reAskMover(ctx);
    return;
  }
  ctx.emit('sk1.move.state', { state: { ...ms, ending: true, halted: true } });
  offerFirstFire(ctx);
}

/** The tags of `after`'s pieces that differ from `before`, with the values they had there (null: absent). */
function changedTagsSince(before: Record<PieceId, Piece>, after: Record<PieceId, Piece>): Record<PieceId, Record<string, Scalar>> {
  const out: Record<PieceId, Record<string, Scalar>> = {};
  for (const [id, p] of Object.entries(after)) {
    const was = before[id as PieceId]?.tags ?? {};
    if (p.tags === was) continue;
    const changed: Record<string, Scalar> = {};
    for (const k of new Set([...Object.keys(was), ...Object.keys(p.tags)])) if (was[k] !== p.tags[k]) changed[k] = was[k] ?? null;
    if (Object.keys(changed).length) out[id as PieceId] = changed;
  }
  return out;
}

/**
 * Why the stack now moving may not be taken back (`move.cancel`), or null. Once any MF is spent (a step, Smoke, a
 * recovery, a DC) the move is under way and ends only with `move.end`. Not either once anything else has happened
 * to it: a unit stopped or pinned, a Gun manhandled (its first push marks the crew and reveals it, SK4 6.5) or a
 * vehicle started.
 */
export function cancelRefusal(env: QueryEnv): string | null {
  const ms = moveState(env);
  if (!ms) return 'No stack is moving';
  const c = ms.cancel;
  if (!c || ms.vehicle || ms.manhandle || ms.bypass || ms.dcPending || ms.halted || ms.ending) return 'This move can no longer be cancelled';
  const spentAny = ms.units.some((u) => (ms.spent[u] ?? 0) !== (c.spent[u] ?? 0)) || ms.hexesEntered > 0 || ms.mfHere > 0 || (ms.trail?.length ?? 0) > 0;
  if (spentAny) return 'MF have been spent: the move can only be ended';
  if (ms.units.length !== (ms.started ?? ms.units).length || ms.stopped?.length || ms.smokeTriedBy?.length) return 'This move can no longer be cancelled';
  if (ms.units.some((u) => isPinned(pieceOf(env, u)) || isBroken(pieceOf(env, u)))) return 'This move can no longer be cancelled';
  return null;
}

function reAskMover(ctx: Ctx) {
  // A stack whose movement ended where it stands (bounced off a hidden Gun, a vehicle ending its move) is done once the defender has had its say.
  const cur = moveState(ctx);
  if (cur?.halted || cur?.vehicle?.ending) finishStack(ctx);
  const top = ctx.state.decisions[ctx.state.decisions.length - 1];
  if (top?.kind === 'phase') ctx.popDecision(top.id);
  if (!ctx.state.result) askPhaseOwner(ctx, ctx.state.attacker);
}

/** After any MF expenditure: Residual FP attack, then offer Defensive First Fire. */
function afterMfExpenditure(ctx: Ctx) {
  residualAttack(ctx);
  pruneMovers(ctx);
  if (!moveState(ctx)) {
    reAskMover(ctx);
    return;
  }
  offerFirstFire(ctx);
}

function residualAttack(ctx: Ctx) {
  const ms = moveState(ctx);
  if (!ms || !ms.hex) return;
  // Residual FP lies in a Location (ASLRB A8.2): the stack's own.
  const here = moveLoc(ms)!;
  const fp = ctx.state.hexMarkers[here]?.['residualFp'] as number | undefined;
  if (!fp) return;
  // Build a pseudo-attack: no firers, just TEM/Smoke + FFNAM/FFMO.
  const attack: FireAttackCtx = {
    mode: 'first',
    side: otherSide(ctx.state, ctx.state.attacker),
    target: here,
    parts: [],
    targets: ms.units.filter((u) => ctx.state.pieces[u]?.loc.kind === 'hex'),
    moving: movingInfo(ctx, ms),
    hindrance: smokeDrm(ctx, ms.hex),
    residual: true,
  };
  const fullDrm = ctx.explain('fire.drm', { attack }, 0);
  // Once per location, unless later MF expenditure makes the DRM worse for the mover.
  if (ms.residualDrmHere !== null && fullDrm.value >= ms.residualDrmHere) return;
  ctx.emit('sk1.move.state', { state: { ...ms, residualDrmHere: fullDrm.value } });
  const roll = ctx.roll(`Residual FP ${fp} in ${ms.hex}`);
  const column = iftColumn(ctx, fp);
  // A secret DRM (a fortified building the mover's own side holds) is told of only when it matters.
  const drmRes = discloseDrm(ctx, attack, column, roll.total, fullDrm);
  const drm = drmRes.value;
  ctx.emit('sk1.fire.attack', {
    attack: { mode: 'first', target: here, parts: [] },
    fp,
    column,
    dr: roll.dice as [number, number],
    drm,
    cowered: false,
    // Every DRM is named (TEM, Smoke, FFNAM, FFMO: SK1 3.3.1), as for any fire attack.
    explain: [{ id: 'sk1.residual', label: `Residual FP ${fp} (${terrainOf(ctx, ms.hex).name})` }, ...drmNotes(drmRes)],
  });
  if (column !== null) ctx.proc<ApplyResultFn>(FP.applyResult)(ctx, attack, column, roll.total + drm, {});
  ctx.proc<FlushFn>(MP.flushLeaderLoss)(ctx);
}

/** Mode implied by the firers' markers (any Final → FPF, any First → SFF). */
export function firstFireMode(env: QueryEnv, decl: FireDeclaration): FireMode {
  const marks = [...decl.units, ...decl.sw].map((id) => fireMarker(pieceOf(env, id)));
  if (marks.includes('final')) return 'fpf';
  if (marks.includes('first')) return 'subsequentFirst';
  return 'first';
}

export function firstFireIllegal(env: QueryEnv, ms: MoveState, decl: FireDeclaration, side: SideId): string | null {
  if (!ms.hex) return 'Moving units are offboard';
  const mode = firstFireMode(env, decl);
  const base = env.query('fire.illegal', { decl, mode, side, moving: firstFireTargets(env, ms) }, null);
  if (base) return base;
  const map = statics(env).map;
  const firers = [...decl.units, ...decl.sw];
  // A unit/SW may not fire on the moving stack in this location more times than MF expended here.
  for (const id of [...firers, ...directorsOf(decl)]) {
    if ((ms.firedHere[id] ?? 0) >= ms.mfHere) return `${id} cannot fire again at this location`;
  }
  // Units using Subsequent First Fire (marked First Fire, in a FPF group too) fire only within normal
  // range and no further than the closest Known Enemy Unit (SK1 3.3.1); units firing for the first
  // time alongside them are not so limited.
  if (mode === 'subsequentFirst' || mode === 'fpf') {
    for (const id of firers) {
      const p = pieceOf(env, id);
      if (fireMarker(p) !== 'first') continue;
      const at = hexOf(env.state, p)!;
      // LOS from and to Locations (heights in full ASL); range between their hexes.
      const from = locOf(env.state, p)!;
      const dist = map.distance(at, ms.hex);
      const range = mmc(env, p)?.range ?? weaponRange(env, id);
      if (dist > range) return 'Subsequent First Fire is limited to normal range';
      // Not at a range greater than the closest Known Enemy Unit.
      const enemy = env.state.attacker;
      const closest = Math.min(
        ...Object.values(env.state.pieces)
          .filter((x) => x.side === enemy && x.loc.kind === 'hex' && (mmc(env, x) || smc(env, x) || (isVehicleDef(defOf(env, x)) && x.tags['wreck'] !== true)))
          .map((x) => locOf(env.state, x)!)
          .filter((h) => env.query('los.trace', { from, to: h }, { clear: true, hindrance: 0, parts: [] }).clear)
          .map((h) => map.distance(at, hexOfLoc(h))),
      );
      if (dist > closest) return 'Subsequent First Fire must target the closest Known Enemy Unit';
    }
  }
  return null;
}

/**
 * Whether every firer in a declaration has at least a plausible LOS to the target: clear, or
 * blocked only just (see LosResult.near). Shots are legal regardless; this only decides whether
 * the defender is interrupted at all, so movement is not halted for shots that are plainly blocked.
 */
function plausibleLos(env: QueryEnv, decl: FireDeclaration): boolean {
  const locs = new Set([...decl.units, ...decl.sw].map((id) => locOf(env.state, pieceOf(env, id))!));
  for (const from of locs) {
    if (!plausibleFrom(env, from, decl.target)) return false;
  }
  return true;
}

/**
 * A firing Location has a plausible LOS to a target: to its centre, or (full ASL, a stack in Bypass) to any corner the
 * firer may choose instead (ASLRB A4.34). Only whether to ask the defender at all: no LOS is told to him (A6.11).
 */
function plausibleFrom(env: QueryEnv, from: LocId, target: LocId): boolean {
  const ok = (los: { clear: boolean; near?: boolean }) => los.clear || !!los.near;
  if (ok(firerLos(env, from, { target }))) return true;
  const hex = hexOfLoc(from);
  return env.query('fire.targetPoints', { target }, []).some((pt) => ok(firerLos(env, from, { target, at: { [hex]: pt } })));
}

/**
 * After a Defensive First Fire shot: count it against the location for every firer, drop
 * movers it stopped, and give the defender the next opportunity (or the mover its turn back).
 */
export function finishDefensiveFire(ctx: Ctx, firers: PieceId[]) {
  const after = moveState(ctx);
  if (after) {
    const fired = { ...after.firedHere };
    for (const id of firers) fired[id] = (fired[id] ?? 0) + 1;
    ctx.emit('sk1.move.state', { state: { ...after, firedHere: fired } });
  }
  ctx.popDecision();
  pruneMovers(ctx);
  offerFirstFire(ctx);
}

/** Whether every firer in a declaration has at least a plausible LOS to the target (see `plausibleLos`). */
export const plausibleShot = (env: QueryEnv, firerLocs: LocId[], target: LocId) => firerLocs.every((from) => plausibleFrom(env, from, target));

/** Push a First Fire opportunity to the defender if any legal, plausible shot exists. */
function offerFirstFire(ctx: Ctx) {
  const ms = moveState(ctx);
  const defender = otherSide(ctx.state, ctx.state.attacker);
  const any = !!ms?.hex && ctx.query('move.firstFireAvailable', { hex: moveLoc(ms)!, units: firstFireTargets(ctx, ms), side: defender }, false);
  if (!any) {
    // No shot to offer, but a weapon that kept ROF may still give it up for Residual FP (SK1 3.3.1).
    const choices = rofChoices(ctx);
    if (choices.length) {
      const top = ctx.state.decisions[ctx.state.decisions.length - 1];
      if (top?.kind === 'phase') ctx.popDecision(top.id);
      ctx.pushDecision({ kind: ROF_RESIDUAL, owner: defender, deadlineClass: 'interrupt', data: { hex: choices[0]!.hex, sws: choices.flatMap((c) => c.pending) } });
      return;
    }
    completeDcPlacement(ctx);
    reAskMover(ctx);
    return;
  }
  // Pop the mover's decision while the defender considers firing; it is re-pushed afterwards.
  const top = ctx.state.decisions[ctx.state.decisions.length - 1];
  if (top?.kind === 'phase') ctx.popDecision(top.id);
  // `ending`: the stack has declared its movement over there (its last chance to be fired on this MPh).
  ctx.pushDecision({ kind: FIRST_FIRE, owner: defender, deadlineClass: 'interrupt', data: { hex: moveLoc(ms!), units: firstFireTargets(ctx, ms!), ...(ms!.ending ? { ending: true } : {}) } });
}

/** A DC whose placer survived all Defensive First Fire becomes operably placed (attacks in the AFPh). */
function completeDcPlacement(ctx: Ctx) {
  const ms = moveState(ctx);
  if (!ms?.dcPending) return;
  const { dc, placer, target, vehicle } = ms.dcPending;
  const p = ctx.state.pieces[placer];
  if (p && p.loc.kind === 'hex' && !isBroken(p) && !isPinned(p)) {
    // X# for the AFPh attack, fixed now while the placer's status is known: the counter's X#
    // less Inexperienced/captured penalties (SK1 4.0, 5.4, 5.5) and 2 for a non-elite MMC (4.3).
    const base = ctx.query('sw.breakdown', { sw: dc, user: placer }, 12) ?? 12;
    const m = mmc(ctx, p);
    const dcX = base - (m && m.quality !== 'E' ? 2 : 0);
    ctx.emit('piece.moved', { id: dc, loc: locationAt(target) });
    // Against an AFV the hexside it was placed through fixes the target facing, whatever the AFV does later (SK4 4.3).
    const v = vehicle ? ctx.state.pieces[vehicle] : undefined;
    setTags(ctx, dc, { dcPlaced: true, dcPlacer: placer, dcCx: isCx(p), dcX, ...(v ? { dcVehicle: vehicle, dcFrom: p.loc.hex, dcVca: (v.tags['vca'] as number | undefined) ?? 0 } : {}) });
  }
  ctx.emit('sk1.move.state', { state: { ...ms, dcPending: undefined } });
}

export const _test = { attackFp, buildAttack };
