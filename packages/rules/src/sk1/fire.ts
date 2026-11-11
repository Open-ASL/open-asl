import type { Ctx, HexId, Piece, PieceId, QueryEnv, QueryResult, RuleModule, SideId } from '@asl/engine';
import { isMmcDef, byId, defOf, hexOf, isVehicleDef, otherSide, personnelAt, statics, swHeldBy, unitsAt, vehiclesAt } from '../common/pieces';
import type { IftResult, Mount, SwDef } from '../common/statics';
import { adjacentLocs, hexOfLoc, locExists, locOf, type LocId } from '../common/location';
import { P as MP, casualtyMc, eliminate, type CasualtyFn, type CheckGroupFn, type CheckOutcome, type CheckUnitFn, type FailMcFn, type FlushFn, type RandomSelectFn, type UnitFn } from './morale';
import {
  T,
  drmNotes,
  type DrmNote,
  fireMarker,
  hasDm,
  inMelee,
  isBroken,
  isCx,
  isGoodOrder,
  isMalf,
  isPinned,
  mmc,
  pieceOf,
  setTags,
  smc,
  sw,
  vehicleIfe,
  weapon,
  actionIllegal,
} from './status';
import { expenditureKey } from './moveState';
import { terrainOf, type LosPoint, type LosTrace } from './terrain';

/** `bounding`: Bounding First Fire by a vehicle in its own MPh (SK4 3.3.2.2). */
export type FireMode = 'prep' | 'first' | 'subsequentFirst' | 'fpf' | 'final' | 'advancing' | 'bounding';

/** One firing component: a unit's inherent FP, a SW (or a Gun's IFE) it fires, or an ordnance hit (SK2). */
export interface FirePart {
  piece: PieceId;
  /** The unit doing the firing (the piece itself for inherent FP; the possessor for SW). */
  firer: PieceId;
  kind: 'inherent' | 'sw' | 'ordnance';
  /** The firer's hex (its Location, which LOS is traced from, is `locOf` the firer: `partLoc`). */
  hex: HexId;
  range: number;
  /** Hex distance to the target's hex. */
  dist: number;
}

/** Context shared by fire queries. */
export interface FireAttackCtx {
  mode: FireMode;
  side: SideId;
  /** The target Location (ASLRB A2.8; the hex id at ground level). */
  target: LocId;
  parts: FirePart[];
  /**
   * Leaders directing the attack: one in every firing hex (SK1 3.2). The worst leadership DRM
   * among them applies and the attack cannot cower.
   */
  directors?: PieceId[];
  /** Units that will be affected. */
  targets: PieceId[];
  /**
   * Defensive First Fire vs moving units: details of the movement (`hazardous`: manhandling a Gun,
   * SK4 6.5; `from`: the hex the stack entered the target hex from, for the Crest Line exception;
   * `pinned`: every target was pinned by earlier Defensive First Fire here, so no FFNAM/FFMO, SK1 3.3.1).
   */
  moving?: { assault: boolean; viaRoadIntoWoodsRoad: boolean; viaRoadIntoOrchardRoad?: boolean; hazardous?: boolean; from?: HexId | null; vehicle?: boolean; pinned?: boolean };
  /** Worst LOS hindrance among firers. */
  hindrance: number;
  /** Residual FP attack (no FG, no cowering). */
  residual?: boolean;
  /** An ordnance hit being resolved on the IFT (SK4 3.2.4): the Target Type, whether it was a Critical Hit, and the column. */
  ordnance?: {
    targetType: 'ITT' | 'ATT';
    ch: boolean;
    column: number;
    /** The To Hit dice [white, colored] (SK3 7.11: hull/turret location of an Area Target Type hit on an AFV). */
    thDice?: [number, number];
    /** The ammunition the hit used (SK4 6.2); HE when absent. */
    ammo?: 'HE' | 'AP' | 'HEAT' | 'APCR' | 'APDS';
    /** A Mortar's hit on a woods hex: Air Burst, -1 instead of the woods TEM (SK4 1.1.1). */
    airBurst?: boolean;
    /** Indirect Fire: a mortar or OBA (ASLRB C.1), which attacks every level of a building hex (B23.32). */
    indirect?: boolean;
  };
  /** A Gun that changed its Covered Arc for this shot (SK4 3.2.4 case 8). */
  caChange?: { weapon: PieceId; spines: number; mount: Mount };
  /** The turret hexspine a vehicle's MG/IFE attack turns to first (`FireDeclaration.tca`). */
  tca?: number;
}

export interface FireDeclaration {
  /** Units firing their inherent FP. */
  units: PieceId[];
  /** SW fired (each must be possessed by a firing-capable unit). */
  sw: PieceId[];
  /** The target Location: a hex id at ground level, 'uK4:1' for level 1 (ASLRB A2.8, A7.212). */
  target: LocId;
  /** Directing leaders, one per firing hex (SK1 3.2). */
  directors?: PieceId[];
  /** @deprecated Older declarations named a single director; `directorsOf` reads both forms. */
  director?: PieceId;
  /** A Gun firing its IFE after turning: the hexspine changes made for this shot (SK2). */
  caChange?: { weapon: PieceId; spines: number; mount: Mount };
  /** A vehicle's MG/IFE attack turning the turret to this hexspine first (SK4 3.2.4 case 8 on the IFT; sk3.vehicleMg). */
  tca?: number;
  /** A Flamethrower predesignating an AFV in the target hex (SK4 4.2): the attack is a To Kill roll on the vehicle, not IFT fire. */
  vsVehicle?: PieceId;
  /**
   * Full ASL, fire at a stack in Bypass (ASLRB A4.34): the corner each firing hex traces its LOS to, named by the two other
   * hexes that meet there, keyed by the firing hex; a firing hex not listed traces to the hex centre (read here as
   * "each firing hex chooses its own LOS target"). Chosen after the fire is declared, before any LOS check
   * (A6.11). Never set in the Starter Kit.
   */
  at?: Record<HexId, [HexId, HexId]>;
}

const NO_LOS_DATA: LosTrace = { clear: true, hindrance: 0, parts: [] };
/**
 * The LOS of one firing Location to the target of a declaration. The Starter Kit traces it to the target Location's centre;
 * in full ASL a stack in Bypass is traced to the point the firing hex chose (`FireDeclaration.at`), with the A4.34 rule
 * for the centre (`'fire.los'`, `asl/bypass.ts`).
 */
export const firerLos = (env: QueryEnv, from: LocId, decl: Pick<FireDeclaration, 'target' | 'at'>): LosTrace =>
  env.query('fire.los', { from, decl }, env.query('los.trace', { from, to: decl.target }, NO_LOS_DATA));

/** The directing leaders of a declaration (accepts the old single-director form). */
export const directorsOf = (decl: Pick<FireDeclaration, 'directors' | 'director'>): PieceId[] =>
  decl.directors ?? (decl.director ? [decl.director] : []);

declare module '@asl/engine' {
  interface QueryCatalog {
    /**
     * Extra IFT columns of Residual FP an attack leaves (SK4 1.1.1 Air Bursts: a Mortar's fire into woods; SK4 8.2.1: a DC or
     * Ordnance HE attack that took the bamboo -1 TEM). `attack` for IFT fire; `ordnance` for a Gun's hit.
     */
    'fire.residualBonus': { ctx: { target: LocId; attack?: FireAttackCtx; ordnance?: { ammo: string; airBurst: boolean } }; value: number };
    /** FP of one part of an attack after all modifiers (fractions kept). */
    'fire.partFp': { ctx: { attack: FireAttackCtx; part: FirePart }; value: number };
    /**
     * The Locations an Indirect Fire hit on Location `target` attacks, each with the same IFT DR (mortars and OBA;
     * ASLRB C.1, B23.32). The Starter Kit's hexes have one Location: the target alone.
     */
    'fire.indirectLocations': { ctx: { target: LocId }; value: LocId[] };
    /** The Locations an Area Target Type hit on `target`, fired from `from`, attacks (the target's alone by default). */
    'fire.areaLocations': { ctx: { target: LocId; from: LocId }; value: LocId[] };
    /** DRM applying to the whole attack. */
    'fire.drm': { ctx: { attack: FireAttackCtx }; value: number };
    /** Additional DRM vs one specific target unit (e.g. FT possession). */
    'fire.unitDrm': { ctx: { attack: FireAttackCtx; unit: PieceId }; value: number };
    /** Column shift when the attack cowers (0 = cannot cower). */
    'fire.cowerShift': { ctx: { attack: FireAttackCtx }; value: number };
    /** Whether a squad has Assault Fire capability (its counter's underlined FP; SSRs may grant it). */
    'unit.assaultFire': { ctx: { unit: PieceId }; value: boolean };
    /** Effective breakdown number for a SW used in this attack (null = cannot break down). */
    'fire.breakdown': { ctx: { attack: FireAttackCtx; sw: PieceId }; value: number | null };
    /** Whether a unit may fire into its own Location at the enemy there: Infantry only at a vehicle (SK4 3.2.2.1), unless a rule opens it (SK4 8.1.8.7). */
    'fire.ownHexAllowed': { ctx: { firer: PieceId; target: LocId }; value: boolean };
    /** Reason a declaration is illegal, or null. Contributions return the first problem found. */
    'fire.illegal': { ctx: { decl: FireDeclaration; mode: FireMode; side: SideId; moving?: PieceId[] }; value: string | null };
    /** The LOS of a firing Location to a declaration's target (see `firerLos`); the default is the centre-to-centre trace. */
    'fire.los': { ctx: { from: LocId; decl: Pick<FireDeclaration, 'target' | 'at'> }; value: LosTrace };
    /**
     * Full ASL: the points other than the centre a firer may trace its LOS to in a target Location (ASLRB A4.34: the corners
     * of the hexsides a stack in Bypass went along there), as `FireDeclaration.at` values. None in the Starter Kit.
     */
    'fire.targetPoints': { ctx: { target: LocId }; value: [HexId, HexId][] };
    /**
     * Full ASL: the second point a firer may trace to in a target the moving stack entered at the road rate (ASLRB A4.132
     * b: where the hexside crossed meets the road), or null. None in the Starter Kit.
     */
    'fire.roadPoint': { ctx: { target: LocId }; value: LosPoint | null };
  }
}

export const FP = {
  /** (ctx, decl, mode, opts) => FireOutcome */
  resolve: 'sk1.fire.resolve',
  /** (ctx, attack, column, finalDr per unit) => void */
  applyResult: 'sk1.fire.applyResult',
  /** (ctx, info: AttackResolvedInfo) => void, after an attack on a Location has resolved; a no-op by default. */
  attackResolved: 'sk1.fire.attackResolved',
} as const;

/**
 * An attack on a Location, once resolved (its results applied), for rules that look at the attack as a whole: S70's caves
 * ("Any HE, DC or FT KIA eliminates the Cave"). `by`: the weapon that counts (a FT taking part, a DC, HE ordnance);
 * `result`: the attack's IFT result before each unit's own DRM (null when nothing was rolled on the IFT); `malfunctioned`:
 * that weapon broke down or the DC did not detonate. The base procedure does nothing and emits nothing, so calling it
 * leaves recordings unchanged.
 */
export interface AttackResolvedInfo {
  target: LocId;
  by: 'dc' | 'ft' | 'he' | 'other';
  result: IftResult['kind'] | null;
  malfunctioned: boolean;
}
export type AttackResolvedFn = (ctx: Ctx, info: AttackResolvedInfo) => void;

export interface FireOutcome {
  column: number | null;
  dr: [number, number];
  cowered: boolean;
  results: Record<PieceId, IftResult>;
  rofKept: PieceId[];
  malfunctioned: PieceId[];
  residualFp: number;
  /**
   * Defensive First Fire / SFF / FPF only: the Residual FP the attack would leave if the listed weapons
   * (among those that kept ROF) chose not to retain it (SK1 3.3.1 "chooses to retain ROF"), the rest
   * keeping theirs. One entry per non-empty subset of `rofKept`, so the choice can be made weapon by weapon.
   */
  rofResidual?: { sws: PieceId[]; residual: number }[];
}

export type ResolveFireFn = (
  ctx: Ctx,
  decl: FireDeclaration,
  mode: FireMode,
  opts?: { moving?: PieceId[]; movingInfo?: FireAttackCtx['moving'] },
) => FireOutcome;

const FIRE_LOG = 'sk1.fireLog';
interface FireLog {
  /** "firer Location>target Location[@stack#expenditure]" pairs fired this phase (`pairKey`), with the units involved. */
  pairs: Record<string, PieceId[]>;
  /** Leader → firers he directed this Player Turn (defensive reuse rule). */
  directed: Record<PieceId, PieceId[]>;
}

const fireLog = (env: QueryEnv): FireLog =>
  (env.state.ext[FIRE_LOG] as FireLog | undefined) ?? { pairs: {}, directed: {} };

/**
 * Fire log key of a firing Location and its target Location (the hexes in the Starter Kit); a moving target is
 * the stack on one expenditure (`expenditureKey`).
 */
const pairKey = (loc: LocId, target: LocId, expenditure?: string) => `${loc}>${target}${expenditure ? `@${expenditure}` : ''}`;
/** The pieces that have attacked `target` from `loc` this phase on the IFT (a moving target: on this MF/MP expenditure). */
export const firedAt = (env: QueryEnv, loc: LocId, target: LocId, moving: boolean): PieceId[] =>
  fireLog(env).pairs[pairKey(loc, target, moving ? expenditureKey(env) : undefined)] ?? [];
/** A vehicle's own IFT armament, its MA's IFE or a vehicular MG: these form Fire Groups only with each other (SK4 7.8). */
const vehicleArmament = (env: QueryEnv, id: PieceId): boolean => {
  const p = env.state.pieces[id];
  return !!p && ((p.loc.kind === 'hex' && !!vehicleIfe(env, p)) || !!sw(env, p)?.fixed);
};
const firerLoc = (env: QueryEnv, id: PieceId): LocId => locOf(env.state, pieceOf(env, id))!;
/**
 * The Location a fire part is fired from, which its LOS is traced from (ASLRB A6.1: the firer's own Location, its height
 * included; a SW's or Gun's is its possessor's). The hex itself in the Starter Kit.
 */
export const partLoc = (env: QueryEnv, part: FirePart): LocId => firerLoc(env, part.firer);
/** The SW a unit holds that have already fired this phase, in attacks before this one (the fire log is per phase). */
const swFiredEarlier = (env: QueryEnv, holder: PieceId, now: PieceId[]): number => {
  const fired = new Set(Object.values(fireLog(env).pairs).flat());
  return swHeldBy(env.state, holder).filter((s) => fired.has(s.id) && !now.includes(s.id)).length;
};

/**
 * Why a leader cannot direct fire now, whatever the target (SK1 3.2, 4.0), or null if he can:
 * he must be Good Order and unpinned, not have used a SW this phase, and not have directed
 * already this Player Turn (defensive fire may repeat the same firers). Without `firers` the
 * repeat check is skipped, for callers that do not know the group yet.
 */
/** A SW firing again on the ROF it kept (SK1 1.2.4): the weapons alone, every one of them under its kept ROF. */
export const isRofShot = (env: QueryEnv, decl: Pick<FireDeclaration, 'units' | 'sw'>) =>
  decl.units.length === 0 && decl.sw.length > 0 && decl.sw.every((id) => env.state.pieces[id]?.tags[T.rofFired] !== undefined);

/**
 * May this leader direct an attack now? Once per phase, except that he may use his leadership again "to direct ROF
 * and/or Defensive Fire attacks" (SK1 1.2.1, ASLRB A10.7 "Multiple ROF"): a SW's ROF shot (`rofShot`), or the same
 * firers' SFF/FPF/Final Fire.
 */
export function directorIllegal(env: QueryEnv, leader: PieceId, mode: FireMode, firers?: PieceId[], rofShot = false): string | null {
  const l = env.state.pieces[leader];
  if (!l) return 'No such leader';
  if (isBroken(l) || isPinned(l) || !isGoodOrder(env, l)) return 'Director must be Good Order and unpinned';
  // SK1 4.0: a SMC who uses a SW loses his leadership DRM for that fire phase.
  if (l.tags[T.firedSw]) return 'A leader who used a SW this phase cannot direct fire';
  const prior = fireLog(env).directed[leader];
  const defensiveReuse = mode === 'subsequentFirst' || mode === 'fpf' || mode === 'final';
  if (prior && !rofShot && !(defensiveReuse && (!firers || firers.every((f) => prior.includes(f))))) {
    return 'That leader has already directed an attack this Player Turn';
  }
  return null;
}

export const isSw = (env: QueryEnv, id: PieceId) => !!sw(env, pieceOf(env, id));

/**
 * Is this piece firing again after First Fire (SFF, FPF, or Final Fire under a
 * First Fire marker)? Markers are per piece: a squad marked First Fire does not
 * mark its unfired MG until it uses Subsequent First Fire (which flips both).
 */
export function firingAgain(env: QueryEnv, attack: FireAttackCtx, piece: PieceId): boolean {
  if (attack.mode === 'prep' || attack.mode === 'advancing' || attack.residual) return false;
  const m = fireMarker(pieceOf(env, piece));
  return m === 'first' || m === 'final';
}

/** IFT column for a total FP (rightmost column not exceeding it), null if below the first. */
export function iftColumn(env: QueryEnv, fp: number, shift = 0): number | null {
  const cols = statics(env).tables.iftColumns;
  let idx = -1;
  for (let i = 0; i < cols.length; i++) if (cols[i]! <= fp) idx = i;
  idx -= shift;
  return idx < 0 ? null : cols[idx]!;
}

const severity = (r: IftResult) =>
  r.kind === 'KIA' ? 5 : r.kind === 'K' ? 4 : r.kind === 'NMC' || r.kind === 'MC' ? 3 : r.kind === 'PTC' ? 1 : 0;

/**
 * An explained DRM without its secret contributions (`Contribution.secret`, e.g. an unrevealed
 * fortified building's +1): the DRM the players are shown while the secret part changes nothing.
 */
export function withoutSecrets(res: QueryResult<number>): QueryResult<number> {
  let value = res.value;
  for (const t of res.trace) if (t.secret && !t.suppressedBy) value -= (t.after as number) - (t.before as number);
  return { value, trace: res.trace.filter((t) => !t.secret) };
}

/** What the IFT gives each target at a final DR, each unit's own DRM included (no side effects). */
function iftResults(env: QueryEnv, attack: FireAttackCtx, column: number, baseFinal: number): Record<PieceId, IftResult> {
  const out: Record<PieceId, IftResult> = {};
  for (const u of attack.targets) {
    if (env.state.pieces[u]?.loc.kind === 'eliminated') continue;
    out[u] = statics(env).tables.ift(column, baseFinal + env.query('fire.unitDrm', { attack, unit: u }, 0));
  }
  return out;
}

/**
 * The DRM an attack is resolved and reported with. A secret modifier is applied in full only when
 * it makes a difference: some target would get another IFT result with it than without (or
 * `forced`, for a difference found earlier, such as whether a broken target becomes DM). Otherwise
 * the attack is resolved with the visible DRM, which by construction gives the same results, and
 * nothing in the event tells of the secret.
 */
export function discloseDrm(env: QueryEnv, attack: FireAttackCtx, column: number | null, dieTotal: number, full: QueryResult<number>, forced = false): QueryResult<number> {
  const shown = withoutSecrets(full);
  if (shown.value === full.value) return full;
  if (forced) return full;
  if (column === null) return shown;
  const a = iftResults(env, attack, column, dieTotal + full.value);
  const b = iftResults(env, attack, column, dieTotal + shown.value);
  const differs = Object.keys(a).some((u) => a[u]!.kind !== b[u]!.kind || (a[u]!.n ?? 0) !== (b[u]!.n ?? 0));
  return differs ? full : shown;
}

/** Build the parts/targets for a declaration (no legality checks). */
/**
 * SK1 1.1.1 Woods-Road (ASLRB B13.31): a moving unit that entered its Woods-Road hex along the road is out
 * on the road, with no woods TEM and subject to FFMO, against a firer whose LOS does not cross a green woods
 * symbol in that hex. A Fire Group from several hexes is judged by the LOS kindest to the target (as for
 * Hindrances, the worst among firers): any firer seeing it through the woods leaves it the woods TEM.
 */
export function onWoodsRoad(env: QueryEnv, moving: FireAttackCtx['moving'], firerLocs: LocId[], target: LocId): boolean {
  if (!moving?.viaRoadIntoWoodsRoad) return false;
  return !firerLocs.some((h) => !roadPoints(env, target).some((toAt) => !env.query('los.trace', { from: h, to: target, ...(toAt ? { toAt } : {}) }, NO_LOS_DATA).woods?.includes(hexOfLoc(target))));
}

/**
 * The points of a target a firer may trace to against a unit that entered it at the road rate: the centre and, in full
 * ASL, where the hexside crossed meets the road (ASLRB A4.132 b; `'fire.roadPoint'`). The Starter Kit has the centre only.
 */
const roadPoints = (env: QueryEnv, target: LocId): (LosPoint | undefined)[] => {
  const pt = env.query('fire.roadPoint', { target }, null);
  return pt ? [undefined, pt] : [undefined];
};

/**
 * SK4 1.1.1 Orchard-Road (ASLRB B14.6): a moving unit that entered its Orchard-Road hex along the road is subject to
 * FFMO against a firer whose LOS stays on the road in that hex (and, the orchard hindering nowhere else, has no
 * Hindrance). A Fire Group is judged by the LOS kindest to the target, as on a Woods-Road.
 */
export function onOrchardRoad(env: QueryEnv, moving: FireAttackCtx['moving'], firerLocs: LocId[], target: LocId): boolean {
  if (!moving?.viaRoadIntoOrchardRoad) return false;
  return !firerLocs.some((h) => !roadPoints(env, target).some((toAt) => !env.query('los.trace', { from: h, to: target, ...(toAt ? { toAt } : {}) }, NO_LOS_DATA).orchard?.includes(hexOfLoc(target))));
}

/** Out on a road through other terrain, as Open Ground for FFMO: a Woods-Road or an Orchard-Road (SK1/SK4 1.1.1). */
export const onRoadInTheOpen = (env: QueryEnv, moving: FireAttackCtx['moving'], firerLocs: LocId[], target: LocId): boolean =>
  onWoodsRoad(env, moving, firerLocs, target) || onOrchardRoad(env, moving, firerLocs, target);

const attackFirerLocs = (env: QueryEnv, attack: FireAttackCtx) => [...new Set(attack.parts.map((p) => partLoc(env, p)))];
const attackOnWoodsRoad = (env: QueryEnv, attack: FireAttackCtx) => onWoodsRoad(env, attack.moving, attackFirerLocs(env, attack), attack.target);

/** FFNAM (SK1 3.3.1): Defensive First Fire at Infantry not using Assault Movement (nor all pinned there already). */
const ffnamApplies = (attack: FireAttackCtx) => !!attack.moving && !attack.moving.assault && !attack.moving.vehicle && !attack.moving.pinned;
/** FFMO (SK1 3.3.1): the same at a target in Open Ground, or on the road through a Woods-Road or Orchard-Road hex (SK1/SK4 1.1.1). */
const ffmoApplies = (env: QueryEnv, attack: FireAttackCtx) =>
  !!attack.moving &&
  !attack.moving.vehicle &&
  !attack.moving.pinned &&
  attack.hindrance === 0 &&
  (env.query('hex.openGround', { hex: attack.target }, false) || onRoadInTheOpen(env, attack.moving, attackFirerLocs(env, attack), attack.target));
export function buildAttack(
  env: QueryEnv,
  decl: FireDeclaration,
  mode: FireMode,
  side: SideId,
  moving?: PieceId[],
  movingInfo?: FireAttackCtx['moving'],
): FireAttackCtx {
  const map = statics(env).map;
  const parts: FirePart[] = [];
  const targetHex = hexOfLoc(decl.target);
  for (const id of [...decl.units].sort()) {
    const p = pieceOf(env, id);
    const hex = hexOf(env.state, p)!;
    const d = mmc(env, p);
    parts.push({ piece: id, firer: id, kind: 'inherent', hex, range: d?.range ?? 0, dist: map.distance(hex, targetHex) });
  }
  for (const id of [...decl.sw].sort()) {
    const s = pieceOf(env, id);
    const holder = s.loc.kind === 'held' ? s.loc.by : id;
    const hex = hexOf(env.state, s)!;
    parts.push({ piece: id, firer: holder, kind: 'sw', hex, range: weaponRange(env, id), dist: map.distance(hex, targetHex) });
  }
  // Everyone in the target Location (every enemy unit, vehicles included; both sides' Infantry in Melee there).
  // Another Location of the same hex is not attacked (ASLRB A2.8).
  // A mover wrecked on its way is no longer a unit: the rest of the moving stack is the target.
  const targets =
    moving?.filter((id) => env.state.pieces[id]?.tags['wreck'] !== true) ??
    (inMelee(env, decl.target)
      ? [...personnelAt(env, decl.target), ...vehiclesAt(env, decl.target, otherSide(env.state, side), true)].map((p) => p.id)
      : unitsAt(env, decl.target, otherSide(env.state, side)).map((p) => p.id));
  let hindrance = 0;
  for (const from of new Set(parts.map((p) => partLoc(env, p)))) {
    const los = firerLos(env, from, decl);
    hindrance = Math.max(hindrance, los.hindrance);
  }
  return {
    mode,
    side,
    target: decl.target,
    parts,
    ...(directorsOf(decl).length ? { directors: directorsOf(decl) } : {}),
    targets: [...targets].sort(),
    ...(movingInfo ? { moving: movingInfo } : {}),
    hindrance,
    ...(decl.caChange ? { caChange: decl.caChange } : {}),
    ...(decl.tca !== undefined ? { tca: decl.tca } : {}),
  };
}

/** FP a weapon fires on the IFT: a SW's printed FP, a Gun's (or a vehicle MA's) Infantry Firepower Equivalent (SK4 6.8). */
export function weaponFp(env: QueryEnv, id: PieceId): number {
  const d = weapon(env, pieceOf(env, id));
  if (!d) return vehicleIfe(env, pieceOf(env, id))?.ife ?? 0;
  return d.kind === 'gun' ? (d.ife ?? 0) : d.fp;
}
/** Normal range of a weapon on the IFT: a SW's printed range; IFE has a normal range of 16 hexes (SK4 6.8). */
export function weaponRange(env: QueryEnv, id: PieceId): number {
  const d = weapon(env, pieceOf(env, id));
  if (!d) return vehicleIfe(env, pieceOf(env, id)) ? 16 : 0;
  return d.kind === 'gun' ? 16 : d.range;
}

const firerFpParts = (a: FireAttackCtx) => a.parts.filter((p) => p.kind !== 'ordnance');

const partBaseFp = (env: QueryEnv, part: FirePart) =>
  part.kind === 'inherent' ? mmc(env, pieceOf(env, part.piece))!.fp : weaponFp(env, part.piece);

export const attackFp = (env: QueryEnv, a: FireAttackCtx, exclude: PieceId[] = []) =>
  firerFpParts(a)
    .filter((p) => !exclude.includes(p.piece))
    .reduce((sum, part) => sum + env.query('fire.partFp', { attack: a, part }, partBaseFp(env, part)), 0);

/** What changed the firers' FP (½ Advancing Fire, +1 Assault Fire, x2 Point Blank Fire ...), one note per kind, for the log. */
export function fpNotes(env: QueryEnv, a: FireAttackCtx): DrmNote[] {
  const out: DrmNote[] = [];
  for (const part of firerFpParts(a)) {
    for (const n of drmNotes(env.explain('fire.partFp', { attack: a, part }, partBaseFp(env, part)))) {
      if (!out.some((o) => o.id === n.id && o.label === n.label)) out.push(n);
    }
  }
  return out;
}

/** Leadership DRM of the directing leaders: that of the lowest quality one (SK1 3.2), or null if undirected. */
export function directionDrm(env: QueryEnv, a: FireAttackCtx): number | null {
  // The FG gets the least favourable DRM a director gives any of its firing units.
  const drms = (a.directors ?? []).flatMap((id) => {
    const l = pieceOf(env, id);
    const d = smc(env, l);
    return d ? a.parts.map((p) => env.query('unit.leadership', { unit: l.id, for: p.firer }, d.leadership)) : [];
  });
  return drms.length ? Math.max(...drms) : null;
}

const isFt = (env: QueryEnv, id: PieceId) => sw(env, pieceOf(env, id))?.type === 'FT';
export const isDc = (env: QueryEnv, id: PieceId) => sw(env, pieceOf(env, id))?.type === 'DC';
/** An Anti-Tank Rifle on the IFT (SK4 4.4.4): 1 FP, no long range, no Residual FP. */
const isAtr = (env: QueryEnv, id: PieceId) => sw(env, pieceOf(env, id))?.type === 'ATR';
/** A machine gun, or a Gun firing its IFE "as if the weapon were a MG" (SK4 6.8). */
const isMg = (env: QueryEnv, id: PieceId) => {
  const d = weapon(env, pieceOf(env, id));
  if (!d) return !!vehicleIfe(env, pieceOf(env, id));
  if (d.kind === 'gun') return true;
  // Infantry MGs and a vehicle's BMG/CMG/AAMG/RMG (SK3) alike.
  return d.type === 'LMG' || d.type === 'MMG' || d.type === 'HMG' || d.type === 'BMG' || d.type === 'CMG' || d.type === 'AAMG' || d.type === 'RMG';
};

export const fireModule: RuleModule = {
  id: 'sk1.fire',
  ref: 'SK1 3.2, 3.2.1, 3.3.1, 3.4, 3.5, 4.0-4.2',
  summary: 'Fire attacks: FP modifiers, DRMs, cowering, IFT results, ROF, breakdown, Residual FP and FPF.',
  requires: ['sk1.status', 'sk1.terrain', 'sk1.morale'],
  install(r) {
    r.event<{ log: FireLog | null }>({
      type: 'sk1.fireLog',
      apply(d, p) {
        if (p.log) d.ext[FIRE_LOG] = p.log;
        else delete d.ext[FIRE_LOG];
      },
    });
    r.event<{
      attack: { mode: FireMode; target: HexId; parts: PieceId[]; directors?: PieceId[] };
      /** The hexes fired from (so the LOS can be shown again later, whoever has moved since). */
      from?: HexId[];
      fp: number;
      column: number | null;
      dr: [number, number];
      drm: number;
      cowered: boolean;
      explain: { label?: string; id: string }[];
    }>({ type: 'sk1.fire.attack', apply() {} });
    /** A declared attack (or part of one) whose LOS turned out blocked: the firers have still fired. */
    r.event<{
      attack: { mode: FireMode; target: HexId; parts: PieceId[]; directors?: PieceId[] };
      from: HexId[];
      blockedBy: string[];
      /** When nothing in the attack had LOS, the DR still made for breakdown and ROF (ASLRB A6.11). */
      dr?: [number, number];
      cowered?: boolean;
    }>({ type: 'sk1.fire.noLos', apply() {} });
    // `drm` and `explain`: the unit's own modifiers to the attack's final DR (e.g. -1 vs a FT possessor).
    // `critical`: a Critical Hit destroyed this Gun crew outright (SK4 6.1), whatever the IFT DR.
    r.event<{ unit: PieceId; result: IftResult; finalDr: number; drm?: number; explain?: DrmNote[]; critical?: boolean }>({ type: 'sk1.fire.result', apply() {} });
    /** Broken targets placed under DM because the attack could have inflicted a NMC (SK1 3.2.1), whatever it rolled. */
    r.event<{ units: PieceId[] }>({ type: 'sk1.fire.dm', apply() {} });
    /**
     * Rate of Fire outcome for every SW with a ROF in the attack (SK1 1.2.4): kept when the colored dr
     * is within the ROF, otherwise lost and the reason why. A SW that kept ROF stays unmarked and may fire again.
     */
    r.event<{ colored: number; kept: { sw: PieceId; rof: number }[]; lost: { sw: PieceId; rof: number; why: RofLoss }[] }>({
      type: 'sk1.fire.rof',
      apply() {},
    });

    // ---------------------------------------------------------------- FP modifiers
    r.contribute({
      id: 'sk1.fp.pbf',
      query: 'fire.partFp',
      layer: 200,
      ref: 'SK1 3.2',
      label: 'x2 Point Blank Fire',
      when: ({ part, attack }, env) =>
        part.dist === 1 && !(part.kind === 'sw' && (isFt(env, part.piece) || isDc(env, part.piece))) && !attack.residual,
      apply: (v) => v * 2,
    });
    r.contribute({
      id: 'sk1.fp.long-range',
      query: 'fire.partFp',
      layer: 200,
      ref: 'SK1 3.2',
      label: '½ long range (Area Fire)',
      when: ({ part }) => part.dist > part.range,
      apply: (v) => v / 2,
    });
    r.contribute({
      id: 'sk1.fp.pinned',
      query: 'fire.partFp',
      layer: 200,
      ref: 'SK1 3.2.1',
      label: '½ pinned',
      when: ({ part }, env) => isPinned(pieceOf(env, part.firer)),
      apply: (v) => v / 2,
    });
    r.contribute({
      id: 'sk1.fp.advancing',
      query: 'fire.partFp',
      layer: 200,
      ref: 'SK1 3.5',
      label: '½ Advancing Fire',
      when: ({ part, attack }, env) => attack.mode === 'advancing' && !(part.kind === 'sw' && (isFt(env, part.piece) || isDc(env, part.piece))),
      apply: (v) => v / 2,
    });
    r.contribute({
      id: 'sk1.fp.subsequent',
      query: 'fire.partFp',
      layer: 200,
      ref: 'SK1 3.3.1, 3.4',
      label: ({ attack }) => (attack.mode === 'fpf' ? '½ FPF' : attack.mode === 'subsequentFirst' ? '½ Subsequent First Fire' : '½ Final Fire after First Fire'),
      when: ({ attack, part }, env) => firingAgain(env, attack, part.piece),
      apply: (v) => v / 2,
    });
    r.contribute({
      id: 'sk1.fp.smc-mg-area',
      query: 'fire.partFp',
      layer: 200,
      ref: 'SK1 4.1',
      label: '½ lone SMC firing MG',
      when: ({ part, attack }, env) => {
        if (part.kind !== 'sw' || !isMg(env, part.piece)) return false;
        if (!smc(env, pieceOf(env, part.firer))) return false;
        // Two SMC stacked together may fire one MG at full FP.
        const here = firerLoc(env, part.firer);
        const smcFirers = attack.parts.filter((p) => firerLoc(env, p.firer) === here && smc(env, pieceOf(env, p.firer)));
        const leadersHere = personnelAt(env, here, attack.side).filter((p) => smc(env, p) && isGoodOrder(env, p));
        return smcFirers.length < 2 && leadersHere.length < 2;
      },
      apply: (v) => v / 2,
    });
    r.contribute({
      id: 'sk1.fp.mg-over-16',
      query: 'fire.partFp',
      layer: 200,
      ref: 'SK1 4.1',
      label: '½ MG beyond 16 hexes undirected',
      when: ({ part, attack }, env) => part.kind === 'sw' && isMg(env, part.piece) && part.dist > 16 && !attack.directors?.length,
      apply: (v) => v / 2,
    });
    r.contribute({
      id: 'sk1.fp.assault-fire',
      query: 'fire.partFp',
      layer: 300,
      ref: 'SK1 3.5',
      label: '+1 Assault Fire',
      when: ({ part, attack }, env) =>
        attack.mode === 'advancing' &&
        part.kind === 'inherent' &&
        part.dist <= part.range &&
        mmc(env, pieceOf(env, part.piece))?.kind === 'squad' &&
        env.query('unit.assaultFire', { unit: part.piece }, false),
      apply: (v) => Math.ceil(v + 1),
    });
    r.contribute({
      id: 'sk1.assault-fire.counter',
      query: 'unit.assaultFire',
      layer: 0,
      apply: (_v, { unit }, env) => !!mmc(env, pieceOf(env, unit))?.assaultFire,
    });

    // ---------------------------------------------------------------- DRMs
    r.contribute({
      id: 'sk1.drm.tem',
      query: 'fire.drm',
      ref: 'SK1 1.1.1',
      label: ({ attack }, env) => `+${env.query('hex.tem', { hex: attack.target }, 0)} TEM (${terrainOf(env, attack.target).name})`,
      when: ({ attack }, env) => !attack.parts.some((p) => p.kind === 'sw' && isFt(env, p.piece)),
      apply: (v, { attack }, env) => v + env.query('hex.tem', { hex: attack.target }, 0),
    });
    r.contribute({
      id: 'sk1.drm.hindrance',
      query: 'fire.drm',
      ref: 'SK1 3.2',
      label: ({ attack }) => `+${attack.hindrance} LOS Hindrance`,
      when: ({ attack }) => attack.hindrance > 0,
      apply: (v, { attack }) => v + attack.hindrance,
    });
    r.contribute({
      id: 'sk1.drm.leadership',
      query: 'fire.drm',
      ref: 'SK1 3.2',
      label: ({ attack }, env) => `${directionDrm(env, attack)! > 0 ? '+' : ''}${directionDrm(env, attack)} leadership`,
      when: ({ attack }, env) => directionDrm(env, attack) !== null && !attack.parts.some((p) => p.kind === 'sw' && isFt(env, p.piece)),
      apply: (v, { attack }, env) => v + directionDrm(env, attack)!,
    });
    r.contribute({
      id: 'sk1.drm.cx',
      query: 'fire.drm',
      ref: 'SK1 3.3',
      label: '+1 CX firer',
      when: ({ attack }, env) =>
        attack.parts.some((p) => isCx(pieceOf(env, p.firer))) || !!attack.directors?.some((d) => isCx(pieceOf(env, d))),
      apply: (v) => v + 1,
    });
    r.contribute({
      id: 'sk1.drm.ffnam',
      query: 'fire.drm',
      ref: 'SK1 3.3.1',
      label: '-1 FFNAM',
      when: ({ attack }) => ffnamApplies(attack),
      apply: (v) => v - 1,
    });
    r.contribute({
      id: 'sk1.drm.ffmo',
      query: 'fire.drm',
      ref: 'SK1 3.3.1',
      label: '-1 FFMO',
      when: ({ attack }, env) => ffmoApplies(env, attack),
      apply: (v) => v - 1,
    });
    // A target pinned by earlier Defensive First Fire there "is not subject to any further FFNAM or FFMO while
    // pinned" (SK1 3.3.1, ASLRB A7.83), though the rest of the stack still is: it gets back what the attack took.
    r.contribute({
      id: 'sk1.drm.pinned-mover',
      query: 'fire.unitDrm',
      ref: 'SK1 3.3.1',
      label: 'pinned: no FFNAM/FFMO',
      when: ({ attack, unit }, env) => !!attack.moving && isPinned(pieceOf(env, unit)) && !isBroken(pieceOf(env, unit)),
      apply: (v, { attack }, env) => v + Number(ffnamApplies(attack)) + Number(ffmoApplies(env, attack)),
    });
    r.contribute({
      id: 'sk1.drm.woods-road',
      query: 'fire.drm',
      ref: 'SK1 1.1.1',
      label: 'no Woods TEM: moving along Woods-Road',
      when: ({ attack }, env) => attackOnWoodsRoad(env, attack),
      apply: (v, { attack }, env) => v - env.query('hex.tem', { hex: attack.target }, 0),
    });
    r.contribute({
      id: 'sk1.drm.vs-ft',
      query: 'fire.unitDrm',
      ref: 'SK1 4.2',
      label: '-1 vs FT possessor',
      apply: (v, { unit }, env) =>
        v - swHeldBy(env.state, unit).filter((s) => sw(env, s)?.type === 'FT').length,
    });

    // ---------------------------------------------------------------- cowering & breakdown
    r.contribute({
      id: 'sk1.cower.base',
      query: 'fire.cowerShift',
      layer: 0,
      ref: 'SK1 3.2',
      apply(_v, { attack }, env) {
        if (attack.residual || attack.directors?.length) return 0;
        const mmcFiring = attack.parts.filter((p) => mmc(env, pieceOf(env, p.firer)));
        if (mmcFiring.length === 0) return 0;
        const inexp = mmcFiring.some((p) => env.query('unit.inexperienced', { unit: p.firer }, false));
        return inexp ? 2 : 1;
      },
    });
    r.contribute({
      id: 'sk1.breakdown.base',
      query: 'fire.breakdown',
      layer: 0,
      apply(_v, { sw: id, attack }, env) {
        const part = attack.parts.find((p) => p.piece === id)!;
        return env.query('sw.breakdown', { sw: id, user: part.firer }, null);
      },
    });
    r.contribute({
      id: 'sk1.breakdown.subsequent',
      query: 'fire.breakdown',
      ref: 'SK1 3.3.1, 4.1',
      label: 'B# -2 firing again after First Fire',
      when: ({ attack, sw: id }, env) => isMg(env, id) && firingAgain(env, attack, id),
      apply: (v) => (v === null ? v : v - 2),
    });
    r.contribute({
      id: 'sk1.breakdown.ft-non-elite',
      query: 'fire.breakdown',
      ref: 'SK1 4.2, 4.3',
      label: 'X# -2 non-elite user',
      when: ({ attack, sw: id }, env) => {
        if (!(isFt(env, id) || isDc(env, id))) return false;
        const part = attack.parts.find((p) => p.piece === id)!;
        const m = mmc(env, pieceOf(env, part.firer));
        return !!m && m.quality !== 'E';
      },
      apply: (v) => (v === null ? v : v - 2),
    });

    // ---------------------------------------------------------------- legality
    r.contribute({
      id: 'sk1.fire.legal.basic',
      query: 'fire.illegal',
      layer: 0,
      apply: (v, { decl, mode, side, moving }, env) => v ?? basicIllegal(env, decl, mode, side, !!moving),
    });
    // A unit that may take no action (`unit.actionIllegal`) neither fires, nor fires its SW, nor directs.
    r.contribute({
      id: 'sk1.fire.legal.action',
      query: 'fire.illegal',
      layer: 0,
      apply: (v, { decl }, env) =>
        v ??
        actionIllegal(env, [
          ...decl.units,
          ...decl.sw.map((id) => env.state.pieces[id]?.loc).flatMap((l) => (l?.kind === 'held' ? [l.by] : [])),
          ...directorsOf(decl),
        ]),
    });

    // ---------------------------------------------------------------- resolution
    r.procedure<ResolveFireFn>(FP.resolve, () => (ctx, decl, mode, opts) => resolveFire(ctx, decl, mode, opts));

    // Fire log is per phase.
    r.on<{ phase: string }>({
      id: 'sk1.fire.clear-log',
      event: 'turn.phaseEnded',
      handler(ctx, ev) {
        if (!ctx.state.ext[FIRE_LOG]) return;
        const log = fireLog(ctx);
        // Same-hex FG pairs reset every phase; leader direction lasts the Player Turn.
        const keep = ev.payload.phase !== 'CCPh' && Object.keys(log.directed).length > 0;
        ctx.emit('sk1.fireLog', { log: keep ? { pairs: {}, directed: log.directed } : null });
      },
    });
  },
};

// --------------------------------------------------------------------------------------

/** Why a SW with a ROF did not keep it this attack. */
export type RofLoss = 'exceeded' | 'cowered' | 'pinned' | 'fpf';

function basicIllegal(env: QueryEnv, decl: FireDeclaration, mode: FireMode, side: SideId, moving = false): string | null {
  const map = statics(env).map;
  if (decl.units.length + decl.sw.length === 0) return 'No firers';
  if (!locExists(env, decl.target)) return 'Unknown target hex';
  const targetHex = hexOfLoc(decl.target);
  const firers = new Set<PieceId>();
  for (const id of decl.units) {
    const p = env.state.pieces[id];
    if (!p || p.side !== side) return `${id} is not yours`;
    if (!mmc(env, p)) return `${id} has no inherent FP to fire`;
    // SK1 4.0: the forfeit does not apply to SFF, FPF, or Final Fire vs an adjacent hex.
    if (p.tags[T.ownFpForfeit]) {
      const at = hexOf(env.state, p);
      const adjacent = !!at && statics(env).map.distance(at, targetHex) === 1;
      if (!(mode === 'subsequentFirst' || mode === 'fpf' || (mode === 'final' && adjacent))) {
        return `${id} forfeited its own FP this Player Turn`;
      }
    }
    firers.add(id);
  }
  const swByHolder = new Map<PieceId, PieceId[]>();
  for (const id of decl.sw) {
    const s = env.state.pieces[id];
    // A vehicle firing its MA's IFE is its own firer (SK4 6.8).
    if (s && s.loc.kind === 'hex' && vehicleIfe(env, s)) {
      if (s.side !== side) return `${id} is not yours`;
      if (isMalf(s) || s.tags['maDisabled']) return `${id}: its MA is ${isMalf(s) ? 'malfunctioned' : 'disabled'}`;
      firers.add(id);
      continue;
    }
    if (!s || s.loc.kind !== 'held') return `${id} is not possessed`;
    if (s.side !== side) return `${id} is not yours`;
    if (isMalf(s)) return `${id} is malfunctioned`;
    const holder = s.loc.by;
    swByHolder.set(holder, [...(swByHolder.get(holder) ?? []), id]);
    firers.add(holder);
  }
  for (const [holder, list] of swByHolder) {
    const h = pieceOf(env, holder);
    const m = mmc(env, h);
    // SW the unit already voluntarily destroyed this phase count as SW uses (SK1 4.0), and so do other SW it fired
    // in earlier attacks this phase: the limit is per phase, not per attack (a HS may not fire
    // its HMG and its LMG in separate attacks of one fire phase).
    const destroyed = ((h.tags[T.swDestroyed] as number | undefined) ?? 0) + swFiredEarlier(env, holder, list);
    if (smc(env, h) && list.length + destroyed > 1) return 'A SMC may use only one SW per phase';
    if ((m?.kind === 'hs' || m?.kind === 'crew') && list.length + destroyed > 1) return `A ${m.kind === 'hs' ? 'half-squad' : 'crew'} may fire only one weapon per phase`;
    if (m?.kind === 'squad' && list.length + destroyed > 2) return 'A squad may use at most two SW per phase';
    if (list.filter((id) => isFt(env, id)).length > 1) return 'A unit may not use two FT';
    if (list.some((id) => isDc(env, id))) return 'DC attack in the AFPh only via DC placement';
    if (m?.kind === 'squad' && list.length + destroyed === 2 && decl.units.includes(holder)) {
      return 'A squad firing two SW forfeits its own FP';
    }
    if ((m?.kind === 'hs' || m?.kind === 'crew') && decl.units.includes(holder)) return `A ${m.kind === 'hs' ? 'half-squad' : 'crew'} firing a weapon forfeits its own FP`;
    // The same forfeit the other way round: a unit that already used its own FP (its fire marker; a SW firing
    // alone leaves none on its holder) may no longer pay for the SW with it, but for SFF, FPF or Final Fire vs an
    // adjacent hex as above. A squad may still fire one SW in a separate attack (SK1 3.2).
    if (fireMarker(h) && !decl.units.includes(holder) && (m?.kind === 'hs' || m?.kind === 'crew' || (m?.kind === 'squad' && list.length + destroyed >= 2))) {
      const at = hexOf(env.state, h);
      const adjacent = !!at && statics(env).map.distance(at, targetHex) === 1;
      if (!(mode === 'subsequentFirst' || mode === 'fpf' || (mode === 'final' && adjacent))) {
        return m.kind === 'squad' ? 'A squad that fired its own FP may not then fire two SW' : `A ${m.kind === 'hs' ? 'half-squad' : 'crew'} that fired its own FP may not then fire a weapon`;
      }
    }
    if (isPinned(h) && list.some((id) => isFt(env, id))) return 'A pinned unit cannot fire a FT';
    if (smc(env, h) && directorsOf(decl).includes(holder)) return 'A leader using a SW cannot direct fire';
  }
  const hasFt = decl.sw.some((id) => isFt(env, id));
  if (hasFt && decl.sw.length + decl.units.length > 1) {
    return 'A FT may not combine with any other attack';
  }

  for (const id of firers) {
    const p = pieceOf(env, id);
    const loc = locOf(env.state, p);
    if (!loc) return `${id} is not on the map`;
    // A vehicle is never held in Melee: in a Melee hex it may still fire, at that hex only (SK4 3.8).
    const vehicleFirer = isVehicleDef(defOf(env, p));
    if (isBroken(p)) return `${id} is not in Good Order`;
    if (inMelee(env, loc) && !(vehicleFirer && decl.target === loc)) return vehicleFirer ? `${id} may only fire at units in its own Melee hex` : `${id} is in Melee`;
  }
  if (decl.vsVehicle) {
    const v = env.state.pieces[decl.vsVehicle];
    if (!v || v.side === side || locOf(env.state, v) !== decl.target || !isVehicleDef(defOf(env, v)) || v.tags['wreck'] === true) return 'The predesignated vehicle is not in the target hex';
    if (!(decl.units.length === 0 && decl.sw.length === 1 && isFt(env, decl.sw[0]!))) return 'Only a Flamethrower attack may predesignate a vehicle';
  }
  // Fire marker eligibility per mode.
  const pieces = [...decl.units, ...decl.sw];
  for (const id of pieces) {
    const m = fireMarker(pieceOf(env, id));
    switch (mode) {
      case 'prep':
      case 'advancing':
        if (m) return `${id} has already fired this Player Turn`;
        break;
      case 'first':
        if (m) return `${id} is already marked ${m === 'first' ? 'First' : 'Final'} Fire`;
        break;
      // A Defensive First Fire group may mix units firing for the first time with units firing
      // again: SK1 3.3.1 defines Subsequent First Fire and FPF per unit ("a unit thus using SFF has
      // its FP halved"), and the Fire Group rules (3.2) ask only for adjacency and LOS. Each firer
      // is judged by its own marker; the group's mode is the strictest among them.
      case 'subsequentFirst':
        if (m && m !== 'first') return `${id} is already marked ${m === 'final' ? 'Final' : m} Fire`;
        break;
      case 'fpf':
        if (m === 'prep') return `${id} cannot fire`;
        if (m === 'final' && statics(env).map.distance(hexOf(env.state, pieceOf(env, id))!, targetHex) !== 1) {
          return 'Final Protective Fire is only possible against an adjacent hex';
        }
        break;
      case 'final': {
        if (m === 'final') return `${id} is marked Final Fire`;
        if (m === 'first') {
          const at = hexOf(env.state, pieceOf(env, id));
          if (!at || statics(env).map.distance(at, targetHex) !== 1) {
            return `${id} is marked First Fire and may only fire at an adjacent hex`;
          }
        }
        break;
      }
    }
  }
  if (mode === 'advancing') {
    for (const id of decl.sw) {
      const d = weapon(env, pieceOf(env, id));
      const at = pieceOf(env, id).loc;
      const holder = at.kind === 'held' ? pieceOf(env, at.by) : pieceOf(env, id);
      const heavy = d?.kind === 'gun' || d?.type === 'MMG' || d?.type === 'HMG';
      if (heavy && (holder.tags[T.moved] || pieceOf(env, id).tags[T.moved])) {
        return `${id}: a ${d?.kind === 'gun' ? 'Gun' : 'MMG/HMG'} that moved cannot fire in the AFPh`;
      }
    }
  }
  // Range. The LOS is deliberately not checked here: a player declares fire first and the
  // thread is only checked when the shot is resolved (SK1 3.2); a blocked LOS wastes the shot.
  // Fire into the firer's own Location: Infantry only at an enemy vehicle there (SK4 3.2.2.1 Triple Point Blank
  // Fire); a vehicle at any enemy unit sharing its hex (it is never held in Melee, SK4 3.8). Another Location of
  // the same hex (full ASL: the level above or below) is a target like any other, if ADJACENT (ASLRB A.8).
  const ownHexIllegal = (piece: Piece, firer: Piece): string | null => {
    const loc = locOf(env.state, piece)!;
    if (loc !== decl.target) return adjacentLocs(env, loc).includes(decl.target) ? null : 'Cannot fire into another Location of its hex that is not ADJACENT';
    const base = vehiclesAt(env, loc, otherSide(env.state, side), true).length > 0 || (isVehicleDef(defOf(env, firer)) && unitsAt(env, loc, otherSide(env.state, side)).length > 0);
    // A rule pack may open own-hex fire further (SK4 8.1.8.7: Banzai units in the AFPh).
    const ok = env.query('fire.ownHexAllowed', { firer: firer.id, target: decl.target }, base) && unitsAt(env, loc, otherSide(env.state, side)).length > 0;
    return ok ? null : 'Cannot fire into own hex outside Melee rules';
  };
  for (const id of decl.units) {
    const p = pieceOf(env, id);
    const dist = map.distance(hexOf(env.state, p)!, targetHex);
    if (dist > mmc(env, p)!.range * 2) return `${id} is out of range`;
    if (dist === 0) {
      const why = ownHexIllegal(p, p);
      if (why) return why;
    }
  }
  for (const id of decl.sw) {
    const s = pieceOf(env, id);
    const holder = s.loc.kind === 'held' ? pieceOf(env, s.loc.by) : s;
    const dist = map.distance(hexOf(env.state, s)!, targetHex);
    if (dist === 0) {
      const why = ownHexIllegal(s, holder);
      if (why) return why;
    }
    // IFE and an ATR have no long range fire (SK4 6.8, 4.4.4).
    if (dist > weaponRange(env, id) * (weapon(env, s)?.kind === 'gun' || vehicleIfe(env, s) || isAtr(env, id) ? 1 : 2)) return `${id} is out of range`;
  }
  // Fire Group contiguity (a leader alone cannot be a link): each firing Location ADJACENT to another (SK1 3.2 "adjacent
  // hexes"; ASLRB A7.5 "a Location ADJACENT to another participating unit"). In the Starter Kit a hex is one Location
  // and 'loc.adjacent' its neighbours, so this is the hex rule; in full ASL a level-1 unit and a ground unit next door
  // are not ADJACENT (B23.25) and cannot combine.
  const groupLocs = [...new Set([...firers].map((id) => locOf(env.state, pieceOf(env, id))!))];
  if (groupLocs.length > 1) {
    const linkLocs = new Set([...firers].filter((id) => mmc(env, pieceOf(env, id))).map((id) => locOf(env.state, pieceOf(env, id))!));
    const seen = new Set<LocId>([groupLocs[0]!]);
    const stack = [groupLocs[0]!];
    while (stack.length) {
      const h = stack.pop()!;
      for (const n of adjacentLocs(env, h)) {
        if (groupLocs.includes(n) && !seen.has(n) && (linkLocs.has(n) || linkLocs.has(h))) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    if (seen.size !== groupLocs.length) return 'Fire Group units must be in contiguous hexes';
  }
  // Leader direction (SK1 3.2): a multi-hex FG may only be directed if a directing leader is
  // present in every firing hex; the worst of their leadership DRMs applies (see directionDrm).
  // A leader directs the units of his own Location (ASLRB A2.8: one Location per hex in the Starter Kit).
  const locs = [...new Set([...firers].map((id) => firerLoc(env, id)))];
  const directors = directorsOf(decl);
  if (directors.length) {
    if (hasFt) return 'Leadership never modifies FT attacks';
    const covered = new Map<LocId, PieceId>();
    for (const id of directors) {
      const l = env.state.pieces[id];
      if (!l || !smc(env, l) || l.side !== side) return 'Director must be a friendly leader';
      const why = directorIllegal(env, id, mode, [...firers], isRofShot(env, decl));
      if (why) return why;
      const at = locOf(env.state, l);
      if (!at || !locs.includes(at)) return 'Director must be in a firing hex';
      if (covered.has(at)) return `Only one leader may direct the fire from ${at}`;
      covered.set(at, id);
    }
    const uncovered = locs.filter((h) => !covered.has(h));
    if (uncovered.length) return `A directed multi-hex Fire Group needs a directing leader in every hex (none in ${uncovered.join(', ')})`;
  }
  // Same-hex units attacking the same target must do so as one FG (SK1 1.2.4, ASLRB A7.55). A moving stack
  // is a target only on one MF expenditure: another stack entering the hex later, or the same stack spending
  // more MF there, may be attacked separately (`pairKey`). A FT attacks alone and is exempt (SK1 3.2: "unless
  // using FT"), so its shot leaves the hex's FG against that target to the other units.
  const log = fireLog(env);
  const exp = moving ? expenditureKey(env) : undefined;
  for (const hex of locs) {
    // A vehicle's IFE and MGs never join the other units in their hex, so their attacks bind only each other (sk3.vehicleMg).
    const used = log.pairs[pairKey(hex, decl.target, exp)]?.filter((id) => !(env.state.pieces[id] && isFt(env, id)) && !vehicleArmament(env, id));
    if (used?.length === 0) continue;
    if (used && mode !== 'subsequentFirst' && mode !== 'fpf' && !hasFt) {
      const allSwRof = decl.units.length === 0;
      if (!allSwRof) {
        return exp
          ? `Units in ${hex} already fired at this stack on this MF expenditure (must form one Fire Group)`
          : `Units in ${hex} already attacked ${decl.target} this phase (must form one Fire Group)`;
      }
    }
  }
  return null;
}

function resolveFire(
  ctx: Ctx,
  decl: FireDeclaration,
  mode: FireMode,
  opts: { moving?: PieceId[]; movingInfo?: FireAttackCtx['moving'] } = {},
): FireOutcome {
  let attack = buildAttack(ctx, decl, mode, ctx.state.pieces[decl.units[0] ?? decl.sw[0]!]!.side, opts.moving, opts.movingInfo);

  // Now the thread is checked. Firers without LOS have still fired "for all purposes" (SK1 3.2):
  // no attack comes from them, but the DR is still made for their breakdown and ROF (ASLRB A6.11),
  // so they stay in `whole`; the rest of the declaration goes ahead.
  const whole = attack;
  // Traced from each firing Location (its height included), the hex itself in the Starter Kit.
  const blocked = new Map<LocId, string>();
  for (const from of new Set(attack.parts.map((p) => partLoc(ctx, p)))) {
    const los = firerLos(ctx, from, decl);
    if (!los.clear) blocked.set(from, los.blockedBy ?? 'blocked');
  }
  if (blocked.size) {
    const blind = attack.parts.filter((p) => blocked.has(partLoc(ctx, p)));
    const sighted = attack.parts.filter((p) => !blocked.has(partLoc(ctx, p)));
    // A directing leader in a blind hex has fired for nothing with it; those in sighted hexes
    // still direct the smaller FG (it keeps a leader in each of its hexes).
    const blindDirectors = (attack.directors ?? []).filter((d) => blocked.has(locOf(ctx.state, pieceOf(ctx, d))!));
    const sightedDirectors = (attack.directors ?? []).filter((d) => !blindDirectors.includes(d));
    if (sighted.length === 0) {
      // Nothing can be attacked, but the DR is made: breakdown, ROF and cowering (for the markers).
      const cowerShift = ctx.query('fire.cowerShift', { attack }, 0);
      const roll = ctx.roll(`Fire attack on ${decl.target} (no LOS)`);
      const [white, colored] = roll.dice as [number, number];
      const cowered = white === colored && cowerShift > 0;
      ctx.emit('sk1.fire.noLos', {
        attack: { mode, target: decl.target, parts: blind.map((p) => p.piece), ...(blindDirectors.length ? { directors: blindDirectors } : {}), ...(decl.at ? { at: decl.at } : {}) },
        from: [...blocked.keys()].sort(),
        blockedBy: [...blocked.values()],
        dr: [white, colored],
        cowered,
      });
      const { malfunctioned, removed, rofKept } = breakdownAndRof(ctx, attack, mode, roll.total, colored, cowered);
      applyBreakdown(ctx, malfunctioned, removed);
      const fpfUsers = fpfUsersOf(ctx, attack, mode);
      markFirers(ctx, attack, mode, cowered, rofKept);
      fpfChecks(ctx, attack, fpfUsers, roll.total);
      ctx.proc<FlushFn>(MP.flushLeaderLoss)(ctx);
      return { column: null, dr: [white, colored], cowered, results: {}, rofKept, malfunctioned, residualFp: 0 };
    }
    ctx.emit('sk1.fire.noLos', {
      attack: { mode, target: decl.target, parts: blind.map((p) => p.piece), ...(blindDirectors.length ? { directors: blindDirectors } : {}), ...(decl.at ? { at: decl.at } : {}) },
      from: [...blocked.keys()].sort(),
      blockedBy: [...blocked.values()],
    });
    attack = { ...attack, parts: sighted, ...(sightedDirectors.length ? { directors: sightedDirectors } : { directors: undefined }) };
  }
  const fp = attackFp(ctx, attack);
  // The full DRM applies; a secret part of it (an unrevealed fortified building) is only told of,
  // and only then shown in the event, when it makes a difference (`discloseDrm`).
  const fullDrm = ctx.explain('fire.drm', { attack }, 0);
  let secretMatters = false;

  // A broken target not under DM becomes DM if the attack could possibly inflict a NMC, taking
  // Cowering into account (SK1 3.2.1): the best DR is snake eyes, which cowers, or a 3 on the
  // full column. Neither is always the worse: an Inexperienced firer's two-column cower, or a
  // cower off the 1 column, can leave the 3 as the only roll that reaches a NMC.
  const cowerShift = ctx.query('fire.cowerShift', { attack }, 0);
  const nmcAt = (col: number | null, dr: number) => col !== null && severity(statics(ctx).tables.ift(col, dr)) >= 3;
  const couldNmc = (drm: number) =>
    cowerShift > 0 ? nmcAt(iftColumn(ctx, fp, cowerShift), 2 + drm) || nmcAt(iftColumn(ctx, fp), 3 + drm) : nmcAt(iftColumn(ctx, fp), 2 + drm);
  const dmCandidates = attack.targets.filter((u) => isBroken(pieceOf(ctx, u)) && !hasDm(pieceOf(ctx, u)));
  const desperate = couldNmc(fullDrm.value) ? dmCandidates : [];
  for (const u of desperate) setTags(ctx, u, { [T.dm]: true });
  if (dmCandidates.length > 0 && couldNmc(fullDrm.value) !== couldNmc(withoutSecrets(fullDrm).value)) secretMatters = true;

  const roll = ctx.roll(`${mode === 'fpf' ? 'FPF attack' : 'Fire attack'} on ${decl.target}`);
  const [white, colored] = roll.dice as [number, number];
  const cowered = white === colored && cowerShift > 0;
  const column = iftColumn(ctx, fp, cowered ? cowerShift : 0);
  const drmRes = discloseDrm(ctx, attack, column, roll.total, fullDrm, secretMatters);
  const drm = drmRes.value;

  ctx.emit('sk1.fire.attack', {
    attack: { mode, target: decl.target, parts: attack.parts.map((p) => p.piece), ...(attack.directors?.length ? { directors: attack.directors } : {}), ...(decl.at ? { at: decl.at } : {}) },
    from: [...new Set(attack.parts.map((p) => partLoc(ctx, p)))].sort(),
    fp,
    fpExplain: fpNotes(ctx, attack),
    column,
    dr: [white, colored],
    drm,
    cowered,
    explain: drmNotes(drmRes),
  });
  if (desperate.length) ctx.emit('sk1.fire.dm', { units: desperate });

  // Breakdown and ROF (checked against the original DR), for every firer that declared the attack,
  // the ones without LOS included.
  const { malfunctioned, removed, rofKept } = breakdownAndRof(ctx, whole, mode, roll.total, colored, cowered);

  // Residual FP (Defensive First Fire / SFF / FPF only). A weapon that kept ROF leaves none unless its
  // owner chooses not to retain the ROF (SK1 3.3.1): the amount it would leave is reported for that choice.
  let residualFp = 0;
  let rofResidual: FireOutcome['rofResidual'];
  if ((mode === 'first' || mode === 'subsequentFirst' || mode === 'fpf') && column !== null) {
    // An ATR leaves no Residual FP (SK4 4.4.4).
    const atrs = attack.parts.filter((p) => p.kind === 'sw' && isAtr(ctx, p.piece)).map((p) => p.piece);
    const outside = outsideDrm(drmRes, ['sk1.drm.hindrance', 'sk1.drm.cx', 'sk1.drm.leadership']);
    const bonus = ctx.query('fire.residualBonus', { target: decl.target, attack }, 0);
    const left = (keeping: PieceId[]) => {
      const col = iftColumn(ctx, attackFp(ctx, attack, [...malfunctioned, ...removed, ...keeping, ...atrs]), cowered ? cowerShift : 0);
      return col === null ? 0 : residualFpLeft(ctx, col, outside, bonus);
    };
    residualFp = left(rofKept);
    const existing = (ctx.state.hexMarkers[decl.target]?.['residualFp'] as number | undefined) ?? 0;
    if (residualFp > existing) ctx.emit('hex.marker', { hex: decl.target, key: 'residualFp', value: residualFp });
    const choosers = rofKept.filter((id) => !atrs.includes(id));
    if (choosers.length) rofResidual = subsets(choosers).map((sws) => ({ sws, residual: left(rofKept.filter((id) => !sws.includes(id))) }));
  }

  // Results.
  const results: Record<PieceId, IftResult> = {};
  if (column !== null) {
    ctx.proc<ApplyResultFn>(FP.applyResult)(ctx, attack, column, roll.total + drm, results);
  }

  // Post-attack SW effects.
  applyBreakdown(ctx, malfunctioned, removed);
  const ft = attack.parts.find((p) => p.kind === 'sw' && isFt(ctx, p.piece))?.piece;
  ctx.proc<AttackResolvedFn>(FP.attackResolved)(ctx, {
    target: decl.target,
    by: ft ? 'ft' : 'other',
    result: column === null ? null : statics(ctx).tables.ift(column, roll.total + drm).kind,
    malfunctioned: !!ft && (malfunctioned.includes(ft) || removed.includes(ft)),
  });

  const fpfUsers = fpfUsersOf(ctx, whole, mode);

  // Fire markers (the firers without LOS too).
  markFirers(ctx, whole, mode, cowered, rofKept);
  fpfChecks(ctx, whole, fpfUsers, roll.total);

  ctx.proc<FlushFn>(MP.flushLeaderLoss)(ctx);

  // Log firing hexes for the same-hex FG rule and leader direction.
  const log = fireLog(ctx);
  const pairs = { ...log.pairs };
  const exp = opts.moving ? expenditureKey(ctx) : undefined;
  for (const p of attack.parts) {
    const k = pairKey(firerLoc(ctx, p.firer), decl.target, exp);
    pairs[k] = [...new Set([...(pairs[k] ?? []), p.piece])];
  }
  const directed = { ...log.directed };
  for (const d of attack.directors ?? []) directed[d] = [...new Set([...(directed[d] ?? []), ...attack.parts.map((p) => p.firer)])];
  ctx.emit('sk1.fireLog', { log: { pairs, directed } });

  return { column, dr: [white, colored], cowered, results, rofKept, malfunctioned, residualFp, ...(rofResidual ? { rofResidual } : {}) };
}

/** Every non-empty subset of `ids` (sorted within), smallest first. */
function subsets(ids: PieceId[]): PieceId[][] {
  const out: PieceId[][] = [];
  const sorted = [...ids].sort();
  for (let mask = 1; mask < 1 << sorted.length; mask++) out.push(sorted.filter((_, i) => mask & (1 << i)));
  return out.sort((a, b) => a.length - b.length);
}

/** An attack's breakdown and ROF, judged on its original DR (SK1 1.2.4, 3.2); emits the ROF event. */
function breakdownAndRof(ctx: Ctx, attack: FireAttackCtx, mode: FireMode, total: number, colored: number, cowered: boolean) {
  const malfunctioned: PieceId[] = [];
  const removed: PieceId[] = [];
  const swParts = attack.parts.filter((p) => p.kind !== 'inherent');
  const brokenDown = swParts.filter((p) => {
    const b = ctx.query('fire.breakdown', { attack, sw: p.piece }, null);
    return b !== null && total >= b;
  });
  if (brokenDown.length > 0) {
    const mgs = brokenDown.filter((p) => isMg(ctx, p.piece));
    const others = brokenDown.filter((p) => !isMg(ctx, p.piece));
    // One MG malfunctions (randomly selected if several; SK1 4.1). Full ASL may pick several on a tie (A9.71).
    if (mgs.length > 0) {
      const picks = mgs.length > 1 ? ctx.proc<RandomSelectFn>(MP.randomSelect)(ctx, mgs.map((p) => p.piece), 1, 'MG breakdown', { ties: true }) : [mgs[0]!.piece];
      for (const pick of picks) {
        // A B# lowered for this use (Sustained Fire, an Inexperienced user, captured) turns the printed B# into
        // an X#: an original DR ≥ it removes the MG (SK1 4.1 for Sustained Fire; ASLRB A.11 for every cause).
        // A vehicle's MA (no SW/Gun def) only malfunctions here; its Low Ammo disablement is the vehicle rules'.
        const w = weapon(ctx, pieceOf(ctx, pick));
        const printed = w?.b ?? 12;
        const used = ctx.query('fire.breakdown', { attack, sw: pick }, null);
        if (w && used !== null && used < printed && total >= printed) removed.push(pick);
        else malfunctioned.push(pick);
      }
    }
    // Other SW: an X# (FT, DC) removes it; a SW with a B# (an ATR's inherent 12, SK4 4.4.4 "normal breakdown and
    // repair rules") malfunctions, unless its B# was lowered for this use (A.11, as for a MG above).
    for (const p of others) {
      const w = weapon(ctx, pieceOf(ctx, p.piece));
      const printed = w?.b ?? (w?.type === 'ATR' ? 12 : undefined);
      if (printed === undefined) {
        removed.push(p.piece);
        continue;
      }
      const used = ctx.query('fire.breakdown', { attack, sw: p.piece }, null);
      if (used !== null && used < printed && total >= printed) removed.push(p.piece);
      else malfunctioned.push(p.piece);
    }
  }
  // ROF (SK1 1.2.4): the colored dr within the ROF keeps it. A cowering attack marks every firer
  // (SK1 3.2, and the 3.3.1 example: the MMG is marked unless it "neither malfunctions, cowers, nor
  // retains Rate of Fire"), a pinned unit's SW loses ROF (SK1 3.2.1) and FPF never retains it.
  const rofKept: PieceId[] = [];
  const rofLost: { sw: PieceId; rof: number; why: RofLoss }[] = [];
  const rofSeen: { sw: PieceId; rof: number }[] = [];
  for (const p of swParts) {
    if (malfunctioned.includes(p.piece) || removed.includes(p.piece)) continue;
    const rof = ctx.query('sw.rof', { sw: p.piece, user: p.firer }, 0);
    if (rof <= 0) continue;
    const firer = pieceOf(ctx, p.firer);
    const usingFpf = mode === 'fpf' && (fireMarker(firer) === 'final' || fireMarker(pieceOf(ctx, p.piece)) === 'final');
    const why: RofLoss | null = colored > rof ? 'exceeded' : cowered ? 'cowered' : isPinned(firer) ? 'pinned' : usingFpf ? 'fpf' : null;
    if (why) rofLost.push({ sw: p.piece, rof, why });
    else {
      rofKept.push(p.piece);
      rofSeen.push({ sw: p.piece, rof });
    }
  }
  if (rofKept.length + rofLost.length > 0) ctx.emit('sk1.fire.rof', { colored, kept: rofSeen, lost: rofLost });

  return { malfunctioned, removed, rofKept };
}

/**
 * FPF: the original DR (modified only by leadership) is a NMC on "the units using FPF (including any
 * directing leader)" (SK1 3.3.1): those marked Final Fire before the shot, so read before marking.
 */
function fpfUsersOf(ctx: Ctx, attack: FireAttackCtx, mode: FireMode): PieceId[] {
  if (mode !== 'fpf') return [];
  return [...new Set([...attack.parts.filter((p) => fireMarker(pieceOf(ctx, p.firer)) === 'final' || fireMarker(pieceOf(ctx, p.piece)) === 'final').map((p) => p.firer), ...(attack.directors ?? [])])];
}

function fpfChecks(ctx: Ctx, attack: FireAttackCtx, users: PieceId[], total: number) {
  if (!users.length) return;
  const lead = directionDrm(ctx, attack) ?? 0;
  for (const u of users.sort()) {
    if (ctx.state.pieces[u]?.loc.kind === 'eliminated') continue;
    // A leader never modifies his own DR (ASLRB A8.31 EX: the 8-1 is pinned on an Original DR of 8),
    // so a directing leader checks on the Original DR unless another leader also directed.
    const own = attack.directors?.includes(u) ? (directionDrm(ctx, { ...attack, directors: attack.directors.filter((d) => d !== u) }) ?? 0) : lead;
    fpfCheck(ctx, u, total, own);
  }
}

function applyBreakdown(ctx: Ctx, malfunctioned: PieceId[], removed: PieceId[]) {
  for (const id of malfunctioned) setTags(ctx, id, { [T.malf]: true });
  for (const id of removed) ctx.emit('piece.eliminated', { id, reason: 'SW removed (breakdown)' });
}

/**
 * The Residual FP an attack leaves (SK1 3.3.1, ASLRB A8.2, A8.26): half the IFT column used (at most
 * 12, rounded down to an IFT column), then one column less for each point of positive DRM caused
 * solely outside the target hex (a +2 Hindrance costs two columns: "changed to a 2 Residual FP
 * counter for a +2 DRM" from 6). `bonusColumns` adds columns back (Air Bursts, SK4 1.1.1).
 */
export function residualFpLeft(env: QueryEnv, column: number, outsidePoints: number, bonusColumns = 0): number {
  const cols = statics(env).tables.iftColumns;
  const half = Math.min(12, Math.floor(column / 2));
  const at = cols.filter((c) => c <= half).length - 1 - outsidePoints;
  if (at < 0) return 0;
  return bonusColumns > 0 ? cols[Math.min(cols.length - 1, at + bonusColumns)]! : cols[at]!;
}

/** Points of positive DRM from the listed (outside-the-target-hex) modifiers in a DRM trace. */
export const outsideDrm = (res: QueryResult<number>, ids: { has(id: string): boolean } | string[]): number =>
  res.trace
    .filter((t) => !t.suppressedBy && (Array.isArray(ids) ? ids.includes(t.id) : ids.has(t.id)))
    .reduce((n, t) => n + Math.max(0, (t.after as number) - (t.before as number)), 0);

/**
 * FPF self-check: uses the attack's original DR rather than rolling, modified only by `leadership` (SK1 3.3.1). It
 * is a NMC, so an original 12 is a Casualty MC like any other (SK1 3.2.1; ASLRB A10.31, ELR replacement first).
 */
export function fpfCheck(ctx: Ctx, unit: PieceId, original: number, leadership = 0) {
  const p = pieceOf(ctx, unit);
  const morale = ctx.query('unit.morale', { unit }, 0);
  const final = original + leadership;
  const explain: DrmNote[] = leadership ? [{ id: 'mc.leader', label: `${leadership > 0 ? '+' : ''}${leadership} leadership` }] : [];
  const check = (outcome: CheckOutcome) => {
    ctx.emit('sk1.check', { unit, kind: 'MC', dr: original, final, target: morale, outcome, reason: 'FPF', drm: leadership, explain });
    return outcome;
  };
  if (original === 12 && !isBroken(p)) {
    casualtyMc(ctx, unit, final - morale, 'FPF', check);
    return;
  }
  if (final > morale) {
    if (isBroken(p)) {
      check('broken');
      ctx.proc<CasualtyFn>(MP.casualtyReduce)(ctx, unit, 'FPF');
    } else {
      const d = defOf(ctx, p);
      check(isMmcDef(d) && d.kind !== 'hs' && (d.stepTo !== undefined || d.fullOf !== undefined) ? 'stepReduced' : 'broken');
      ctx.proc<FailMcFn>(MP.failMc)(ctx, unit, final - morale, 'FPF');
    }
  } else if (final === morale) {
    check('pinned');
    ctx.proc<UnitFn>(MP.pin)(ctx, unit);
  } else check('passed');
}

export type ApplyResultFn = (
  ctx: Ctx,
  attack: FireAttackCtx,
  column: number,
  finalDr: number,
  out: Record<PieceId, IftResult>,
) => void;

export function markFirers(ctx: Ctx, attack: FireAttackCtx, mode: FireMode, cowered: boolean, rofKept: PieceId[]) {
  // SK1 3.2.2 marks PFPh firers with Prep Fire; AFPh firers wear the Advancing Fire marker (as in full ASL /
  // VASL) so a unit cannot fire twice in the AFPh. Both come off at the end of the AFPh (SK1 3.5).
  // Defensive fire marks each piece by its own history: one firing again (marked First Fire, or
  // Final Fire for FPF) flips to Final Fire (SK1 3.3.1); one firing for the first time is marked
  // First Fire, Final Fire if the attack cowered.
  const again = (id: PieceId) => {
    const was = fireMarker(pieceOf(ctx, id));
    return was === 'first' || was === 'final';
  };
  const flipped = new Set<PieceId>();
  const markerFor = (id: PieceId) =>
    mode === 'prep' ? 'prep' : mode === 'advancing' ? 'adv' : mode === 'bounding' ? 'bff' : mode === 'final' ? 'final' : again(id) || flipped.has(id) || cowered ? 'final' : 'first';
  const pieces = new Set<PieceId>();
  for (const p of attack.parts) {
    if (p.kind !== 'inherent' && rofKept.includes(p.piece)) {
      // Unmarked while it may fire again; the phase's end marks it (sk1.firePhases.cleanup).
      if (!fireMarker(pieceOf(ctx, p.piece))) setTags(ctx, p.piece, { [T.rofFired]: markerFor(p.piece) });
      continue;
    }
    pieces.add(p.piece);
  }
  // Holders that fired a weapon have "fired" for movement purposes but keep their own FP.
  for (const p of attack.parts) {
    if (p.kind !== 'inherent' && ctx.state.pieces[p.firer]?.tags[T.firedSw] !== true) setTags(ctx, p.firer, { [T.firedSw]: true, [T.firedSwAs]: markerFor(p.firer) });
  }
  for (const d of attack.directors ?? []) pieces.add(d);
  // SFF / FPF / Final after First Fire: a unit firing again flips to Final Fire with all its SW,
  // "whether or not they all fired" (SK1 3.3.1); its fellows firing for the first time do not.
  if (mode === 'subsequentFirst' || mode === 'fpf' || mode === 'final') {
    for (const p of attack.parts) {
      if (!again(p.firer) && !again(p.piece)) continue;
      flipped.add(p.firer);
      for (const s of swHeldBy(ctx.state, p.firer)) flipped.add(s.id);
      for (const id of flipped) pieces.add(id);
    }
  }
  // Squads firing two SW (or HS firing one) forfeit own FP for the Player Turn.
  const swCount = new Map<PieceId, number>();
  for (const p of attack.parts) if (p.kind !== 'inherent') swCount.set(p.firer, (swCount.get(p.firer) ?? 0) + 1);
  for (const [holder, fired] of swCount) {
    const h = pieceOf(ctx, holder);
    const m = mmc(ctx, h);
    const n = fired + ((h.tags[T.swDestroyed] as number | undefined) ?? 0);
    if ((m?.kind === 'squad' && n >= 2) || ((m?.kind === 'hs' || m?.kind === 'crew') && n >= 1)) setTags(ctx, holder, { [T.ownFpForfeit]: true });
  }
  for (const id of [...pieces].sort()) {
    const p = ctx.state.pieces[id];
    if (!p || p.loc.kind === 'eliminated') continue;
    const marker = markerFor(id);
    // Never downgrade a Final Fire marker.
    if (fireMarker(p) === 'final' && marker !== 'final') continue;
    setTags(ctx, id, { [T.fire]: marker });
  }
}

/** Default IFT result application (SK1 3.2.1). Registered as a procedure so packs can replace it. */
export const applyIftResult: ApplyResultFn = (ctx, attack, column, baseFinal, out) => {
  const tables = statics(ctx).tables;
  // Group targets by their unit-specific DRM so each group shares one final DR.
  const groups = new Map<number, PieceId[]>();
  const notes = new Map<PieceId, DrmNote[]>();
  for (const u of attack.targets) {
    if (ctx.state.pieces[u]?.loc.kind === 'eliminated') continue;
    const d = ctx.explain('fire.unitDrm', { attack, unit: u }, 0);
    groups.set(d.value, [...(groups.get(d.value) ?? []), u]);
    notes.set(u, drmNotes(d));
  }
  for (const [extra, units] of [...groups].sort((a, b) => a[0] - b[0])) {
    const finalDr = baseFinal + extra;
    const res = tables.ift(column, finalDr);
    for (const u of units) {
      out[u] = res;
      ctx.emit('sk1.fire.result', { unit: u, result: res, finalDr, ...(extra ? { drm: extra, explain: notes.get(u) ?? [] } : {}) });
    }
    applyOneResult(ctx, attack, column, res, units);
  }
};

function applyOneResult(ctx: Ctx, attack: FireAttackCtx, column: number, res: IftResult, units: PieceId[]) {
  const check = ctx.proc<CheckGroupFn>(MP.checkGroup);
  const random = ctx.proc<RandomSelectFn>(MP.randomSelect);
  const cr = ctx.proc<CasualtyFn>(MP.casualtyReduce);
  const brk = ctx.proc<UnitFn>(MP.breakUnit);
  const tables = statics(ctx).tables;
  switch (res.kind) {
    case 'none':
      return;
    case 'PTC':
      check(ctx, units, { kind: 'PTC', mod: 0, reason: 'IFT PTC' });
      return;
    case 'NMC':
    case 'MC':
      check(ctx, units, { kind: 'MC', mod: res.n ?? 0, reason: `IFT ${res.n ? `${res.n}MC` : 'NMC'}` });
      return;
    case 'K': {
      // One unit (SK1 3.2.1); in full ASL "at least one", every unit tied for the pick (ASLRB A7.302, A.9).
      const victims = random(ctx, units, 1, 'K result', { ties: true });
      // An SMC chosen for the Casualty Reduction is wounded and takes no MC; the MC is for "all
      // other target units (including any just reduced HS)" (SK1 3.2.1, ASLRB A7.302).
      const wounded = victims.filter((v) => !!smc(ctx, pieceOf(ctx, v)));
      for (const v of victims) cr(ctx, v, 'IFT K');
      const rest = units.filter((u) => ctx.state.pieces[u]?.loc.kind !== 'eliminated' && !wounded.includes(u));
      check(ctx, rest, { kind: 'MC', mod: res.n ?? 0, reason: `IFT K/${res.n ?? 0}` });
      return;
    }
    case 'KIA': {
      // As many as the number (SK1 3.2.1); in full ASL "at least as many", ties for the last one too (ASLRB A7.301).
      const killed = random(ctx, units, res.n ?? 1, 'KIA result', { ties: true });
      for (const k of killed) {
        // Each SW possessed by a KIA'd unit: dr on the same IFT column (KIA destroys, K malfunctions).
        for (const s of swHeldBy(ctx.state, k).sort(byId)) {
          const dr = ctx.roll(`SW ${s.id} survival`, 1).total;
          const r = tables.ift(column, dr);
          if (r.kind === 'KIA') ctx.emit('piece.eliminated', { id: s.id, reason: 'destroyed by KIA' });
          else if (r.kind === 'K') setTags(ctx, s.id, { [T.malf]: true });
        }
        eliminate(ctx, k, 'IFT KIA');
      }
      for (const u of units) {
        if (killed.includes(u) || ctx.state.pieces[u]?.loc.kind === 'eliminated') continue;
        if (isBroken(pieceOf(ctx, u))) cr(ctx, u, 'IFT KIA (already broken)');
        else brk(ctx, u);
      }
      return;
    }
  }
}

export const fireResultModule: RuleModule = {
  id: 'sk1.fire.results',
  requires: ['sk1.fire'],
  install(r) {
    r.procedure<ApplyResultFn>(FP.applyResult, () => applyIftResult);
    r.procedure<AttackResolvedFn>(FP.attackResolved, () => () => {});
  },
};

/** Defensive helper: candidate fire declarations for AI/legal-move generation (one per firer stack & target Location). */
export function simpleDeclarations(env: QueryEnv, side: SideId, targets: LocId[], mode: FireMode, moving?: PieceId[]): FireDeclaration[] {
  const out: FireDeclaration[] = [];
  const mine = Object.values(env.state.pieces).filter(
    (p) => p.side === side && p.loc.kind === 'hex' && isGoodOrder(env, p),
  );
  // One stack per Location (the hex in the Starter Kit).
  const byHex = new Map<LocId, Piece[]>();
  for (const p of mine) {
    const h = locOf(env.state, p)!;
    byHex.set(h, [...(byHex.get(h) ?? []), p]);
  }
  // Which markers may still fire in this mode: a First Fire marker allows Subsequent First Fire, FPF
  // and Final Fire (vs an adjacent hex); a Final Fire marker only FPF. Legality judges the rest.
  const eligible = (p: Piece) => {
    const m = fireMarker(p);
    return !m || (m === 'first' && (mode === 'subsequentFirst' || mode === 'fpf' || mode === 'final')) || (m === 'final' && mode === 'fpf');
  };
  for (const [hex, ps] of [...byHex].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const units = ps.filter((p) => mmc(env, p) && eligible(p)).map((p) => p.id);
    const sws = ps.flatMap((p) => swHeldBy(env.state, p.id)).filter((s) => sw(env, s) && !isMalf(s) && eligible(s) && sw(env, s)?.type !== 'DC').map((s) => s.id);
    const leader = ps.find((p) => smc(env, p) && !isPinned(p));
    for (const t of targets) {
      // Into the firers' own Location only at an enemy vehicle there (SK4 3.2.2.1).
      if (t === hex && vehiclesAt(env, hex, otherSide(env.state, side), true).length === 0) continue;
      // Only the SWs that may fire on the IFT at this target: a BAZ, PSK or mortar fires on its own To Hit
      // Table and a short-ranged SW may be out of range, and either would make the whole stack's attack illegal.
      const iftSw = sws.filter(
        (id) => sw(env, pieceOf(env, id))?.type !== 'FT' && !env.query('fire.illegal', { decl: { units: [], sw: [id], target: t }, mode, side, ...(moving ? { moving } : {}) }, null),
      );
      // A HS or crew firing a SW, or a squad firing two, forfeits its own FP (SK1 4.0): leave it out
      // rather than make the whole attack illegal (or a HS holding an LMG is
      // never offered Defensive First Fire).
      const forfeits = (id: PieceId) => {
        const held = iftSw.filter((s) => { const l = pieceOf(env, s).loc; return l.kind === 'held' && l.by === id; }).length;
        const kind = mmc(env, pieceOf(env, id))?.kind;
        return held > 0 && (kind === 'hs' || kind === 'crew' || (kind === 'squad' && held > 1));
      };
      // Likewise a unit that cannot reach the target itself, a 5-2-7 six hexes from it, stays out while its LMG
      // fires (or enemies walk past an LMG in range that is never offered the shot).
      const reaches = (id: PieceId) => !env.query('fire.illegal', { decl: { units: [id], sw: [], target: t }, mode, side, ...(moving ? { moving } : {}) }, null);
      const base: FireDeclaration = { units: units.filter((id) => !forfeits(id) && (iftSw.length === 0 || reaches(id))), sw: iftSw, target: t };
      const variants: FireDeclaration[] = [base];
      if (leader) variants.push({ ...base, directors: [leader.id] });
      // A SW that kept ROF fires again on its own (SK1 1.2.4): its holder, having fired, may not join it anew.
      const rof = base.sw.filter((id) => pieceOf(env, id).tags[T.rofFired] !== undefined);
      if (rof.length && base.units.length) {
        variants.push({ units: [], sw: rof, target: t });
        if (leader) variants.push({ units: [], sw: rof, target: t, directors: [leader.id] });
      }
      for (const d of variants) {
        if (d.units.length + d.sw.length === 0) continue;
        if (!env.query('fire.illegal', { decl: d, mode, side, ...(moving ? { moving } : {}) }, null)) out.push(d);
      }
    }
  }
  return out;
}

export const swDefOf = (env: QueryEnv, p: Piece) => defOf(env, p) as SwDef;
