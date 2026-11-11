import { Layer, type Ctx, type HexId, type Piece, type PieceId, type QueryEnv, type QueryResult, type RuleModule, type Scalar, type SideId } from '@asl/engine';
import {
  byId,
  defOf,
  hexOf,
  isGunDef,
  isMmcDef,
  isSmcDef,
  isSwDef,
  isWeaponDef,
  personnelAt,
  statics,
  swHeldBy,
} from '../common/pieces';
import type { GunDef, MmcDef, SideSetup, SmcDef, SwDef } from '../common/statics';
import { locOf, type LocId } from '../common/location';

/** Tag keys used by the SK1 rules. Other packs may add their own. */
export const T = {
  broken: 'broken',
  pinned: 'pinned',
  cx: 'cx',
  dm: 'dm',
  wounds: 'wounds',
  /** 'prep' | 'adv' | 'first' | 'final' | 'bff' — Prep Fire / Advancing Fire / First Fire / Final Fire / Bounding First Fire (SK3) marker. */
  fire: 'fire',
  /** SW malfunctioned (flipped). */
  malf: 'malf',
  /** Unit fired a SW this phase (counts as having fired for movement). */
  firedSw: 'firedSw',
  /** The fire marker that SW shot earned the holder ('prep' | 'adv' | 'first' | 'final'): SK1 3.2.2 marks "the firing unit (and SW)",
   *  so the counter is drawn on him even when the SW is gone, while his own FP stays free to fire separately. */
  firedSwAs: 'firedSwAs',
  /** Squad forfeited its own FP for the rest of the Player Turn by firing 2 SW. */
  ownFpForfeit: 'ownFpForfeit',
  /**
   * The fire marker a weapon (SW, Gun or vehicle MA) earned this phase but does not wear yet because it kept
   * ROF and may fire again (SK1 1.2.4). When the phase ends it has fired all the same, and the marker goes on.
   */
  rofFired: 'rofFired',
  /** Number of SW the unit voluntarily destroyed this fire phase (each counts as a SW use, SK1 4.0). */
  swDestroyed: 'swDestroyed',
  /** Moved during the current MPh (for MMG/HMG AFPh restriction etc.). */
  moved: 'moved',
  /** Was pinned during this Player Turn (cannot be pinned again). */
  pinnedThisTurn: 'pinnedThisTurn',
  /** Already attempted to rally this Player Turn. */
  rallyTried: 'rallyTried',
  /** Took its one Rally Phase action. */
  rphAction: 'rphAction',
  /** On a SW: a repair dr was made for it this Player Turn, its one attempt (A9.72). */
  repairTried: 'repairTried',
  /** SW recovered this phase (cannot be transferred in the same phase). */
  recoveredPhase: 'recoveredPhase',
  /** Advanced this APh (CC ambush eligibility). */
  advancedInto: 'advancedInto',
  /** SMC: the friendly MMC it is stacked on top of (SK1 3.8); see `stackedOn`. */
  stackedOn: 'stackedOn',
} as const;

export const SK1_PHASES = ['RPh', 'PFPh', 'MPh', 'DFPh', 'AFPh', 'RtPh', 'APh', 'CCPh'] as const;
export type Sk1Phase = (typeof SK1_PHASES)[number];

declare module '@asl/engine' {
  interface QueryCatalog {
    /** Current morale level (broken side when broken, wounds applied). */
    'unit.morale': { ctx: { unit: PieceId }; value: number };
    /**
     * Why a unit may take no action now (fire, move, advance, recover, repair, transfer or destroy a SW, charge), or
     * null. Routing and Close Combat are never barred by it. An SSR that halts some units (S64 SSR 3) contributes.
     */
    'unit.actionIllegal': { ctx: { unit: PieceId }; value: string | null };
    /** A SW's Portage Points (its counter's by default). */
    'sw.pp': { ctx: { sw: PieceId }; value: number };
    /**
     * Leadership DRM a leader currently exerts (wound applied); `for` names the unit receiving it
     * where there is one, so a rule can deny it to some units (SSR: no leadership across nationalities).
     */
    'unit.leadership': { ctx: { unit: PieceId; for?: PieceId }; value: number };
    /** Inexperienced penalties apply (SK1 5.4). */
    'unit.inexperienced': { ctx: { unit: PieceId }; value: boolean };
    /** Inherent Portage Capacity. */
    'unit.ipc': { ctx: { unit: PieceId }; value: number };
    /** Effective breakdown number of a SW for a given user (B# or X#). */
    'sw.breakdown': { ctx: { sw: PieceId; user?: PieceId }; value: number | null };
    /** Effective ROF of a SW. */
    'sw.rof': { ctx: { sw: PieceId; user?: PieceId }; value: number };
  }
}

/** The first reason any of `units` may take no action now (`unit.actionIllegal`), or null. */
export const actionIllegal = (env: QueryEnv, units: readonly PieceId[]): string | null => {
  for (const unit of units) {
    const why = env.query('unit.actionIllegal', { unit }, null);
    if (why) return why;
  }
  return null;
};

export const pieceOf = (env: { state: { pieces: Record<string, Piece> } }, id: PieceId): Piece => {
  const p = env.state.pieces[id];
  if (!p) throw new Error(`No piece ${id}`);
  return p;
};

export const mmc = (env: QueryEnv, p: Piece): MmcDef | null => {
  const d = defOf(env, p);
  return isMmcDef(d) ? d : null;
};
export const smc = (env: QueryEnv, p: Piece): SmcDef | null => {
  const d = defOf(env, p);
  return isSmcDef(d) ? d : null;
};
export const sw = (env: QueryEnv, p: Piece): SwDef | null => {
  const d = defOf(env, p);
  return isSwDef(d) ? d : null;
};
export const gun = (env: QueryEnv, p: Piece): GunDef | null => {
  const d = defOf(env, p);
  return isGunDef(d) ? d : null;
};
/** A SW or a Gun (SK4 4.0: "Weapons"). */
export const weapon = (env: QueryEnv, p: Piece): SwDef | GunDef | null => {
  const d = defOf(env, p);
  return isWeaponDef(d) ? d : null;
};
/**
 * A vehicle's Main Armament with an Infantry Firepower Equivalent (SK4 6.8, e.g. the PSW 234/1's
 * 20L(6)): the vehicle piece fires it on the IFT as if it were a MG. Null for anything else.
 */
export const vehicleIfe = (env: QueryEnv, p: Piece): { ife: number; rof: number } | null => {
  const d = defOf(env, p);
  return d.kind === 'vehicle' && d.ma?.ife ? { ife: d.ma.ife, rof: d.ma.rof ?? 0 } : null;
};
/** Portage Points a weapon costs its carrier; Guns are not carried (they are manhandled, SK4 6.5). */
/** A SW's Portage Points: its counter's, unless a rule changes them (`sw.pp`: a disassembled mortar, S66 SSR 2). */
export const ppOf = (env: QueryEnv, p: Piece): number => env.query('sw.pp', { sw: p.id }, sw(env, p)?.pp ?? 0);
/** The Gun a unit possesses, if any. */
export const gunHeldBy = (env: QueryEnv, unit: PieceId): Piece | undefined => swHeldBy(env.state, unit).find((w) => gun(env, w));

/**
 * Stacking size of a group (SK1 3.3, SK4 3.3.1): a squad counts 1, a half-squad or crew ½, and a
 * half-squad or crew possessing a Gun a full squad.
 */
export function squadEquivalents(env: QueryEnv, pieces: Piece[]): number {
  return pieces.reduce((n, p) => {
    const m = mmc(env, p);
    if (!m) return n;
    if (m.kind === 'squad') return n + 1;
    return n + (gunHeldBy(env, p.id) ? 1 : 0.5);
  }, 0);
}

/**
 * The friendly MMC a SMC is stacked on top of (SK1 3.8: it defends in CC with that unit). The
 * `stackedOn` tag names it while the two share a location; otherwise, or when it is unset, the SMC
 * sits on the first friendly MMC there (unbroken first). Null when no friendly MMC is there.
 */
export function stackedOn(env: QueryEnv, p: Piece): PieceId | null {
  const loc = locOf(env.state, p);
  if (!loc || !smc(env, p)) return null;
  const set = p.tags[T.stackedOn] as PieceId | undefined;
  const mmcs = personnelAt(env, loc, p.side).filter((x) => mmc(env, x) && x.loc.kind === p.loc.kind);
  if (set && mmcs.some((x) => x.id === set)) return set;
  return mmcs.sort((a, b) => Number(isBroken(a)) - Number(isBroken(b)) || mmcRank(env, a) - mmcRank(env, b) || byId(a, b))[0]?.id ?? null;
}
const mmcRank = (env: QueryEnv, p: Piece) => (mmc(env, p)?.kind === 'squad' ? 0 : 1);

/**
 * One side's personnel in a location in stacking order, bottom to top: each MMC with the SMC
 * stacked on it above it, the MMC carrying SMC uppermost (so a leader is the top counter), and
 * SMC with no MMC to stand on at the very top.
 */
export function stackOrder(env: QueryEnv, units: Piece[]): Piece[] {
  const mmcs = units.filter((p) => mmc(env, p));
  const smcs = units.filter((p) => smc(env, p)).sort(byId);
  const on = new Map(smcs.map((p) => [p.id, stackedOn(env, p)]));
  const carried = (m: Piece) => smcs.filter((s) => on.get(s.id) === m.id);
  const groups = mmcs
    .sort((a, b) => Number(carried(a).length > 0) - Number(carried(b).length > 0) || mmcRank(env, a) - mmcRank(env, b) || byId(a, b))
    .flatMap((m) => [m, ...carried(m)]);
  const placed = new Set(groups.map((p) => p.id));
  return [...groups, ...units.filter((p) => !placed.has(p.id)).sort(byId)];
}

/**
 * Units moving off together (a stack moving, advancing or routing): each SMC among them goes on
 * top of an MMC moving with it (the one it is already on, if that one comes along), or on none.
 * SMC staying behind come off any MMC that leaves them.
 */
export function restack(ctx: Ctx, units: PieceId[]) {
  const moving = units.map((id) => pieceOf(ctx, id));
  const mmcs = moving.filter((p) => mmc(ctx, p)).sort((a, b) => mmcRank(ctx, a) - mmcRank(ctx, b) || byId(a, b));
  for (const p of moving.filter((x) => smc(ctx, x))) {
    const cur = p.tags[T.stackedOn] as PieceId | undefined;
    const next = cur && mmcs.some((m) => m.id === cur) ? cur : (mmcs[0]?.id ?? null);
    if ((cur ?? null) !== next) setTags(ctx, p.id, { [T.stackedOn]: next });
  }
  const left = new Set(mmcs.map((m) => m.id));
  for (const p of Object.values(ctx.state.pieces).sort(byId)) {
    if (!units.includes(p.id) && left.has(p.tags[T.stackedOn] as PieceId)) setTags(ctx, p.id, { [T.stackedOn]: null });
  }
}

export const isBroken = (p: Piece) => p.tags[T.broken] === true;
export const isPinned = (p: Piece) => p.tags[T.pinned] === true;
export const isCx = (p: Piece) => p.tags[T.cx] === true;
export const hasDm = (p: Piece) => p.tags[T.dm] === true;
export const wounds = (p: Piece) => (p.tags[T.wounds] as number | undefined) ?? 0;
export const isMalf = (p: Piece) => p.tags[T.malf] === true;
export const fireMarker = (p: Piece) => p.tags[T.fire] as 'prep' | 'adv' | 'first' | 'final' | 'bff' | undefined;
/**
 * The fire marker drawn on a piece: its own, else the Prep or Advancing Fire its SW fire earned it (SK1 3.2.2
 * marks "the firing unit (and SW)"). Defensive fire marks only "any unit or SW that has fired" (SK1 3.3.1), and
 * a squad fires one SW "at no cost to its own FP" (SK1 4.0), so a holder whose MG alone fired wears nothing.
 */
export const shownFireMarker = (p: Piece) => {
  const held = p.tags[T.firedSwAs] as string | undefined;
  return fireMarker(p) ?? (held === 'prep' || held === 'adv' ? held : undefined);
};

/** Whether a Location is in Melee (its Melee counter; ASLRB A2.8: per Location, the hex in the Starter Kit). */
export const inMelee = (env: QueryEnv, loc: LocId | null) =>
  !!loc && env.state.hexMarkers[loc]?.['melee'] === true;

/** Good Order: neither broken nor in Melee. */
export const isGoodOrder = (env: QueryEnv, p: Piece) => !isBroken(p) && !inMelee(env, locOf(env.state, p));

export const sideSetup = (env: QueryEnv, side: SideId): SideSetup => {
  const s = statics(env).scenario.sides.find((x) => x.side === side);
  if (!s) throw new Error(`Scenario has no side ${side}`);
  return s;
};

/** Unbroken, unpinned, Good Order leaders in a Location for a side (a leader affects his own Location only, ASLRB A2.8). */
export function goodOrderLeadersAt(env: QueryEnv, loc: LocId, side: SideId): Piece[] {
  return personnelAt(env, loc, side).filter(
    (p) => smc(env, p) && isGoodOrder(env, p) && !isPinned(p),
  );
}

/** The best (most negative) leadership DRM among usable leaders, or 0. */
export function bestLeadership(env: QueryEnv, leaders: Piece[]): { leader: Piece | null; drm: number } {
  let best: Piece | null = null;
  let drm = 0;
  for (const l of [...leaders].sort(byId)) {
    const v = env.query('unit.leadership', { unit: l.id }, smc(env, l)!.leadership);
    if (best === null || v < drm) {
      best = l;
      drm = v;
    }
  }
  return { leader: best, drm: best ? drm : 0 };
}

export const setTags = (ctx: Ctx, id: PieceId, tags: Record<string, Scalar>) =>
  ctx.emit('piece.tagged', { id, tags });

/** Pieces carried by a unit (and the unit itself) — a unit "and its SW". */
export const withSw = (env: QueryEnv, id: PieceId) => [pieceOf(env, id), ...swHeldBy(env.state, id)];

export const statusModule: RuleModule = {
  id: 'sk1.status',
  ref: 'SK1 1.2, 3.2.1, 5.4',
  requires: ['common.pieces'],
  install(r) {
    r.contribute({
      id: 'sk1.morale.base',
      query: 'unit.morale',
      layer: 0,
      apply(_v, { unit }, env) {
        const p = pieceOf(env, unit);
        const d = defOf(env, p) as MmcDef | SmcDef;
        return isBroken(p) ? d.brokenMorale : d.morale;
      },
    });
    r.contribute({
      id: 'sk1.morale.wounded',
      query: 'unit.morale',
      ref: 'SK1 3.2.1',
      label: '-1 wounded',
      when: ({ unit }, env) => wounds(pieceOf(env, unit)) > 0,
      apply: (v) => v - 1,
    });
    // ASLRB A.18: a Morale Level can never be raised beyond 10 (Commissar, Fanatic, heroic, Human Wave);
    // SK is silent.
    r.contribute({
      id: 'sk1.morale.ceiling',
      query: 'unit.morale',
      ref: 'ASLRB A.18',
      layer: Layer.Clamp,
      apply: (v) => Math.min(v, 10),
    });
    r.contribute({
      id: 'sk1.leadership.wounded',
      query: 'unit.leadership',
      ref: 'SK1 3.2.1',
      label: '+1 wounded',
      when: ({ unit }, env) => wounds(pieceOf(env, unit)) > 0,
      apply: (v) => v + 1,
    });
    r.contribute({
      id: 'sk1.inexperienced.base',
      query: 'unit.inexperienced',
      ref: 'SK1 5.4',
      layer: 0,
      apply(_v, { unit }, env) {
        const p = pieceOf(env, unit);
        const d = mmc(env, p);
        if (!d) return false;
        if (d.quality === 'C') return true;
        if (d.quality !== 'G') return false;
        // "Not stacked with a Good Order leader" (SK1/SK4 5.4): a pinned leader is still Good Order.
        const loc = locOf(env.state, p);
        return !loc || !personnelAt(env, loc, p.side).some((l) => smc(env, l) && isGoodOrder(env, l));
      },
    });
    r.contribute({
      id: 'sk1.ipc.base',
      query: 'unit.ipc',
      ref: 'SK1 4.0',
      layer: 0,
      apply(_v, { unit }, env) {
        const p = pieceOf(env, unit);
        if (smc(env, p)) return wounds(p) > 0 ? 0 : 1;
        return 3;
      },
    });
    r.contribute({
      id: 'sk1.ipc.cx',
      query: 'unit.ipc',
      ref: 'SK1 3.3',
      label: '-1 CX',
      layer: 150,
      when: ({ unit }, env) => isCx(pieceOf(env, unit)),
      apply: (v) => Math.max(0, v - 1),
    });
    r.contribute({
      id: 'sk1.sw.breakdown.base',
      query: 'sw.breakdown',
      layer: 0,
      apply(_v, { sw: id }, env) {
        const d = weapon(env, pieceOf(env, id));
        // Not a SW or Gun (a vehicle's Main Armament, SK3): the vehicle rules answer.
        if (!d) return null;
        if (d.b !== undefined) return d.b;
        // Guns and SW Mortars without a B# have an inherent B# of 12 (SK4 6.12).
        if (d.kind === 'gun' || d.type === 'MTR') return 12;
        if (d.x !== undefined) return d.x;
        // MGs, and an ATR with no B# printed (normal breakdown, SK4 4.4.4), break down on a 12.
        return d.type === 'LMG' || d.type === 'MMG' || d.type === 'HMG' || d.type === 'ATR' ? 12 : null;
      },
    });
    r.contribute({
      id: 'sk1.sw.breakdown.inexperienced',
      query: 'sw.breakdown',
      ref: 'SK1 5.4',
      label: '-1 Inexperienced user',
      when: ({ user }, env) => !!user && env.query('unit.inexperienced', { unit: user }, false),
      apply: (v) => (v === null ? v : v - 1),
    });
    r.contribute({
      id: 'sk1.sw.breakdown.captured',
      query: 'sw.breakdown',
      ref: 'SK1 5.5',
      label: '-2 captured',
      when: ({ sw: id }, env) => isCaptured(env, pieceOf(env, id)),
      apply: (v) => (v === null ? v : v - 2),
    });
    r.contribute({
      id: 'sk1.sw.rof.base',
      query: 'sw.rof',
      layer: 0,
      apply: (_v, { sw: id }, env) => {
        const p = pieceOf(env, id);
        return weapon(env, p)?.rof ?? vehicleIfe(env, p)?.rof ?? 0;
      },
    });
    r.contribute({
      id: 'sk1.sw.rof.captured',
      query: 'sw.rof',
      ref: 'SK1 5.5',
      when: ({ sw: id }, env) => isCaptured(env, pieceOf(env, id)),
      apply: (v) => Math.max(0, v - 1),
    });
  },
};

/** The nationalities a side fields (SK2 cards mix counter sets, e.g. British and Allied Minor). */
export const sideNationalities = (env: QueryEnv, side: SideId): string[] => {
  const s = sideSetup(env, side);
  return s.nationalities ?? [s.nationality];
};

/** A weapon is captured when its owner's side fields no units of the counter's nationality (SK1 5.5). */
export function isCaptured(env: QueryEnv, swPiece: Piece): boolean {
  const d = defOf(env, swPiece);
  return !sideNationalities(env, swPiece.side).includes(d.nationality);
}

/** A DRM modifier as shown to players: the contribution id and its label (e.g. "+4 Desperation Morale"). */
export interface DrmNote {
  id: string;
  label?: string;
}

/** The applied contributions of an explained query, for event payloads the client turns into detail text. */
export const drmNotes = (res: QueryResult<number>): DrmNote[] =>
  res.trace.filter((t) => !t.suppressedBy).map((t) => ({ id: t.id, ...(t.label ? { label: t.label } : {}) }));
