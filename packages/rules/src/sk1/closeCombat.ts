import type { Action, Ctx, HexId, Piece, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { byId, defOf, hexOf, isVehicleDef, otherSide, personnelAt, statics } from '../common/pieces';
import { isAt, locKey, locOf, type LocId } from '../common/location';
import { PHASE_DECISION, advancePhase } from '../common/turn';
import { P as MP, eliminate, type CasualtyFn, type RandomSelectFn } from './morale';
import { RP, type FieldPromotionFn } from './rally';
import { moveState } from './movement';
import { T, drmNotes, inMelee, isBroken, isCx, isPinned, mmc, pieceOf, setTags, smc, stackedOn, type DrmNote } from './status';
import { terrainOf } from './terrain';

declare module '@asl/engine' {
  interface QueryCatalog {
    /**
     * The MMC a Field Promotion in CC is based on, among the MMC that made the attack (SK1 5.3 "the best one"); the
     * default is the SK reading, the highest Morale (the first listed on a tie). Full ASL takes the highest BPV (A18.2).
     */
    'cc.promotionBase': { ctx: { units: PieceId[] }; value: PieceId | null };
    /** CC attack strength of one attacking unit. */
    'cc.attackFp': { ctx: { unit: PieceId }; value: number };
    /** CC defense strength of one target unit (`attackers`: who is attacking it; a vehicle's CC attack faces the unit's CCV, SK3). */
    'cc.defenseFp': { ctx: { unit: PieceId; attackers?: PieceId[] }; value: number };
    /** DRM for one CC attack. */
    'cc.drm': { ctx: { hex: HexId; attackers: PieceId[]; targets: PieceId[]; side: SideId }; value: number };
    /** Ambush drm for a side's force in a CC hex. */
    'cc.ambushDrm': { ctx: { hex: HexId; side: SideId; units: PieceId[] }; value: number };
    /** The units a side has in a hex for Close Combat purposes (personnel; the vehicle rules add non-wreck vehicles). */
    'cc.units': { ctx: { hex: HexId; side: SideId }; value: PieceId[] };
    /** Whether the hex's CC attacks are declared and resolved one at a time, alternating (a vehicle is present, SK4 3.8). */
    'cc.sequential': { ctx: { hex: HexId }; value: boolean };
    /** Whether a Melee holds in the hex after its CC (both sides still there with someone to hold them). */
    'cc.meleeHolds': { ctx: { hex: HexId }; value: boolean };
    /** Whether an ambush dr is made in this hex's new CC (SK1 3.8: woods/buildings; a hidden Gun walked into; SK4 8.3.2: any concealed combatant). */
    'cc.ambushPossible': { ctx: { hex: HexId }; value: boolean };
    /** Why one declared CC attack is not allowed beyond the Infantry rules (vehicle attacks and targets), or null. */
    'cc.attackIllegal': { ctx: { hex: HexId; side: SideId; attack: CcAttack }; value: string | null };
    /** The kill number of one CC attack: the CC Table's for its odds, unless a rule changes the table (SK4 8.1.8.4 Hand-to-Hand). */
    'cc.kill': { ctx: { hex: HexId; side: SideId; attackers: PieceId[]; targets: PieceId[]; odds: string }; value: number };
  }
}

export interface CcAttack {
  attackers: PieceId[];
  targets: PieceId[];
}

export const CCP = {
  /** (ctx, side, attack) => void: resolve one declared CC attack (the vehicle rules take over attacks on or by a vehicle). */
  resolveAttack: 'sk1.cc.resolveAttack',
} as const;
/** Resolve one declared CC attack. `plan` is the attack as worked out before any attack of the hex was resolved
 * (simultaneous CC, SK1 3.8); when it is omitted the attack is planned from the state as it stands, and null
 * means the attack has nobody left to make it. */
export type ResolveCcAttackFn = (ctx: Ctx, side: SideId, attack: CcAttack, plan?: CcAttackPlan | null) => void;

/** A CC attack worked out before its roll: the units in it, their strengths, the odds column and the DRM. */
export interface CcAttackPlan {
  attackers: PieceId[];
  targets: PieceId[];
  attackFp: number;
  defenseFp: number;
  odds: string;
  drm: number;
}

export const CC_HEX = 'ccHex';
export const CC_DECLARE = 'ccDeclare';
/** Before a hex's CC: a side may restack its leaders onto other MMC there (SK1 3.8). */
export const CC_ARRANGE = 'ccArrange';

const CC = 'sk1.cc';
interface CcState {
  /** Hexes still to resolve this CCPh. */
  pending: HexId[];
  hex?: HexId;
  ambusher?: SideId | null;
  /** Declarations received for the current hex. */
  declared: Partial<Record<SideId, CcAttack[]>>;
  /** Resolution order: ambush, simultaneous, or one attack at a time (a vehicle in the hex, SK4 3.8). */
  step?: 'arrange' | 'ambusher' | 'other' | 'simultaneous-attacker' | 'simultaneous-defender' | 'sequential';
  /** Sides that have finished arranging their leaders for the current hex. */
  arranged?: SideId[];
  /** Sequential CC: whose attack it is, who has passed (and is out), and who has attacked already. */
  turn?: SideId;
  passed?: SideId[];
  attacked?: PieceId[];
}
const ccState = (env: QueryEnv) => env.state.ext[CC] as CcState | undefined;
export const ccStateOf = ccState;

/**
 * A side's Close Combat units in a Location (ASLRB A11.1; `hex` is a LocId, the hex at ground level): its personnel,
 * plus whatever the installed rules add (vehicles). The CC state, markers and queries keep their `hex` names.
 */
export function ccUnits(env: QueryEnv, hex: LocId, side: SideId): Piece[] {
  const base = personnelAt(env, hex, side).map((p) => p.id);
  return env
    .query('cc.units', { hex, side }, base)
    .map((id) => env.state.pieces[id])
    .filter((p): p is Piece => !!p && isAt(p, hex))
    .sort(byId);
}

/** Locations with opposing CC units (personnel on both sides, or Infantry sharing a Location with an enemy vehicle). */
export function ccHexes(env: QueryEnv): LocId[] {
  const sides = env.state.sides;
  const hexes = new Set<LocId>();
  for (const p of Object.values(env.state.pieces)) if (p.loc.kind === 'hex') hexes.add(locKey(p.loc));
  return [...hexes]
    .filter((h) => {
      const units = sides.map((side) => ccUnits(env, h, side));
      if (units.some((u) => u.length === 0)) return false;
      // Two forces of nothing but vehicles never fight in CC (SK4 3.8: AFVs may not attack each other).
      return units.some((u) => u.some((p) => !isVehicleDef(defOf(env, p))));
    })
    .sort();
}

/** Parse "a:b" odds columns into ratios. */
const ratio = (col: string) => {
  const [a, b] = col.replace(/^[<>]/, '').split(':').map(Number);
  // "<1:8" is the floor column; ">10:1" needs odds strictly above 10:1.
  return col.startsWith('<') ? 0 : col.startsWith('>') ? a! / b! + 1e-6 : a! / b!;
};

/** Best odds column not exceeding attack:defense (rounded in the defender's favour). */
export function ccOdds(env: QueryEnv, attack: number, defense: number): string | null {
  if (defense <= 0) return statics(env).tables.ccOddsColumns.at(-1) ?? null;
  const r = attack / defense;
  let best: string | null = null;
  for (const c of statics(env).tables.ccOddsColumns) if (ratio(c) <= r + 1e-9) best = c;
  return best;
}

/**
 * The units that defend together with `unit` (SK1 3.8): a SMC defends as part of the group it
 * attacks with, adding its FP to the MMC it is stacked on top of. A SMC whose side has already
 * declared an attack without any MMC (alone, or with other SMC only) defends with that attack's
 * SMC instead. Every other unit defends alone.
 */
function defensiveGroup(env: QueryEnv, unit: PieceId): PieceId[] {
  const p = pieceOf(env, unit);
  const hex = locOf(env.state, p)!;
  const declared = ccState(env)?.declared[p.side] ?? [];
  const smcOnly = (id: PieceId) => declared.find((a) => a.attackers.includes(id) && !a.attackers.some((x) => mmc(env, pieceOf(env, x))));
  const own = smc(env, p) ? smcOnly(unit) : undefined;
  if (own) return [...own.attackers].sort();
  const anchor = smc(env, p) ? stackedOn(env, p) : unit;
  if (!anchor) return [unit];
  const riders = personnelAt(env, hex, p.side).filter((f) => smc(env, f) && stackedOn(env, f) === anchor && !smcOnly(f.id));
  return [anchor, ...riders.map((f) => f.id)].sort();
}

/** Whether a side has a leader to restack in a hex: a SMC and at least two friendly MMC there. */
function canArrange(env: QueryEnv, hex: HexId, side: SideId): boolean {
  const ps = personnelAt(env, hex, side);
  return ps.some((p) => smc(env, p)) && ps.filter((p) => mmc(env, p)).length >= 2;
}

/** Why a SMC may not be restacked onto an MMC now, or null. */
function restackIllegal(env: QueryEnv, side: SideId, leader: PieceId, on: PieceId, ccHex?: HexId): string | null {
  const l = env.state.pieces[leader];
  const m = env.state.pieces[on];
  if (!l || l.side !== side || !smc(env, l) || l.loc.kind !== 'hex') return 'Choose one of your leaders on the map';
  if (!m || m.side !== side || !mmc(env, m) || m.loc.kind !== 'hex' || locKey(m.loc) !== locKey(l.loc)) return 'He can only stack on one of your MMC in his hex';
  if (ccHex && locKey(l.loc) !== ccHex) return 'Only leaders in the Close Combat hex may be restacked now';
  if (moveState(env)) return 'Finish moving the current stack first';
  if (stackedOn(env, l) === on) return 'He is already stacked on that unit';
  return null;
}

function declarationIllegal(env: QueryEnv, side: SideId, hex: HexId, attacks: CcAttack[]): string | null {
  const st = ccState(env);
  const mine = ccUnits(env, hex, side);
  const theirs = ccUnits(env, hex, otherSide(env.state, side));
  const isPersonnel = (p: Piece) => !!(mmc(env, p) || smc(env, p));
  if (st?.step === 'sequential' && attacks.length > 1) return 'With a vehicle in the hex, attacks are declared one at a time';
  const usedA = new Set<PieceId>();
  const usedT = new Set<PieceId>();
  for (const at of attacks) {
    if (at.attackers.length === 0 || at.targets.length === 0) return 'Each attack needs attackers and targets';
    for (const a of at.attackers) {
      const p = mine.find((x) => x.id === a);
      if (!p) return `${a} is not one of your units in ${hex}`;
      if (isBroken(p)) return `${a} is broken and cannot attack`;
      if (usedA.has(a) || st?.attacked?.includes(a)) return `${a} may attack only once`;
      usedA.add(a);
    }
    // A leader may attack alone, but then defends alone; leaders with an MMC join its attack.
    for (const t of at.targets) {
      if (!theirs.some((x) => x.id === t)) return `${t} is not an enemy unit in ${hex}`;
      if (usedT.has(t)) return `${t} may be attacked only once`;
      usedT.add(t);
    }
    const personnelOnly = at.attackers.every((a) => isPersonnel(pieceOf(env, a))) && at.targets.every((t) => isPersonnel(pieceOf(env, t)));
    // A leader attacking with MMC defends with them, so the MMC he is stacked on must attack too.
    for (const a of at.attackers) {
      const p = pieceOf(env, a);
      if (!smc(env, p) || !at.attackers.some((x) => mmc(env, pieceOf(env, x)))) continue;
      const on = stackedOn(env, p);
      if (on && !at.attackers.includes(on) && personnelOnly) return `${a} is stacked on ${on}, which must join his attack (or restack him first)`;
    }
    if (personnelOnly) {
      for (const t of at.targets) {
        for (const g of defensiveGroup(env, t)) {
          if (!at.targets.includes(g)) return `${t} defends together with ${g}; target the whole group`;
        }
      }
    }
    const extra = env.query('cc.attackIllegal', { hex, side, attack: at }, null);
    if (extra) return extra;
    if (personnelOnly && ccOdds(env, attackFp(env, at.attackers), defenseFp(env, at.targets, at.attackers)) === null) return 'Odds are too low for a CC attack';
  }
  return null;
}

/** Every single attack a side could declare in the hex now (the simultaneous "everyone at everyone" first). */
export function declarationOptions(env: QueryEnv, hex: HexId, side: SideId): CcAttack[] {
  const st = ccState(env);
  const isPersonnel = (p: Piece) => !!(mmc(env, p) || smc(env, p));
  const mine = ccUnits(env, hex, side).filter((p) => !isBroken(p) && !st?.attacked?.includes(p.id));
  const theirs = ccUnits(env, hex, otherSide(env.state, side));
  const ablePersonnel = mine.filter(isPersonnel);
  // Everyone able attacks together, except a leader whose own MMC cannot attack (SK1 3.8).
  const group = ablePersonnel.filter((p) => !smc(env, p) || !stackedOn(env, p) || ablePersonnel.some((m) => m.id === stackedOn(env, p))).map((p) => p.id).sort();
  const enemyPersonnel = theirs.filter(isPersonnel).map((p) => p.id).sort();
  const enemyVehicles = theirs.filter((p) => !isPersonnel(p));
  const out: CcAttack[] = [];
  if (group.length && enemyPersonnel.length) out.push({ attackers: group, targets: enemyPersonnel });
  // Against a vehicle: one unit, or an MMC with a SMC (SK4 3.8).
  for (const v of enemyVehicles) {
    for (const m of ablePersonnel.filter((p) => mmc(env, p))) {
      out.push({ attackers: [m.id], targets: [v.id] });
      for (const l of ablePersonnel.filter((p) => smc(env, p))) out.push({ attackers: [m.id, l.id].sort(), targets: [v.id] });
    }
    for (const l of ablePersonnel.filter((p) => smc(env, p))) out.push({ attackers: [l.id], targets: [v.id] });
  }
  // A vehicle attacks the enemy Infantry with its machine guns.
  for (const v of mine.filter((p) => !isPersonnel(p))) if (enemyPersonnel.length) out.push({ attackers: [v.id], targets: enemyPersonnel });
  const seen = new Set<string>();
  return out.filter((at) => {
    const k = JSON.stringify(at);
    if (seen.has(k)) return false;
    seen.add(k);
    return !declarationIllegal(env, side, hex, [at]);
  });
}

/**
 * Leadership DRM of the unpinned leaders among `units` for the MMC among them (SK1 3.8): the best
 * leader's, taken for the MMC he does least for (a leader may not lead every nationality, SSR).
 */
function ccLeadership(env: QueryEnv, units: Piece[]): number {
  const leaders = units.filter((p) => smc(env, p) && !isPinned(p));
  const led = units.filter((p) => mmc(env, p));
  if (!leaders.length || !led.length) return 0;
  return Math.max(...led.map((m) => Math.min(0, ...leaders.map((l) => env.query('unit.leadership', { unit: l.id, for: m.id }, smc(env, l)!.leadership)))));
}

const attackFp = (env: QueryEnv, ids: PieceId[]) =>
  ids.reduce((a, id) => a + env.query('cc.attackFp', { unit: id }, smc(env, pieceOf(env, id)) ? 1 : (mmc(env, pieceOf(env, id))?.fp ?? 0)), 0);
const defenseFp = (env: QueryEnv, ids: PieceId[], attackers?: PieceId[]) =>
  ids.reduce((a, id) => a + env.query('cc.defenseFp', { unit: id, ...(attackers ? { attackers } : {}) }, smc(env, pieceOf(env, id)) ? 1 : (mmc(env, pieceOf(env, id))?.fp ?? 0)), 0);

export const closeCombatModule: RuleModule = {
  id: 'sk1.cc',
  ref: 'SK1 3.8, 5.3, 5.4',
  summary: 'Close Combat: odds, ambush, simultaneous resolution, Melee, field promotion.',
  requires: ['sk1.morale', 'sk1.rally', 'common.turn'],
  install(r) {
    r.event<{ state: CcState | null }>({
      type: 'sk1.cc.state',
      apply(d, p) {
        if (p.state) d.ext[CC] = p.state;
        else delete d.ext[CC];
      },
    });
    r.event<{ hex: HexId; side: SideId; attack: CcAttack; odds: string; drm: number; dr: number; kill: number; result: string }>({
      type: 'sk1.cc.attack',
      apply() {},
    });

    r.procedure<ResolveCcAttackFn>(CCP.resolveAttack, () => (ctx, side, at, plan) => resolveAttackBase(ctx, side, at, plan));
    // Melee holds while both sides still have Infantry there and someone is unbroken (SK1 3.8).
    r.contribute({
      id: 'sk1.cc.melee-holds',
      query: 'cc.meleeHolds',
      layer: 0,
      apply(_v, { hex }, env) {
        const sides = new Map<SideId, Piece[]>();
        for (const p of personnelAt(env, hex)) sides.set(p.side, [...(sides.get(p.side) ?? []), p]);
        return sides.size > 1 && [...sides.values()].flat().some((p) => !isBroken(p));
      },
    });

    r.contribute({
      id: 'sk1.cc.pinned-half',
      query: 'cc.attackFp',
      layer: 200,
      label: '½ pinned',
      when: ({ unit }, env) => isPinned(pieceOf(env, unit)) && !!mmc(env, pieceOf(env, unit)),
      apply: (v) => v / 2,
    });
    r.contribute({
      id: 'sk1.cc.leader',
      query: 'cc.drm',
      ref: 'SK1 3.8',
      label: 'leadership',
      when: ({ attackers }, env) => attackers.some((a) => mmc(env, pieceOf(env, a))) && attackers.some((a) => smc(env, pieceOf(env, a))),
      apply: (v, { attackers }, env) => v + ccLeadership(env, attackers.map((a) => pieceOf(env, a)).filter((p) => !isPinned(p))),
    });
    r.contribute({
      id: 'sk1.cc.cx-attacker',
      query: 'cc.drm',
      ref: 'SK1 3.3',
      label: '+1 CX attacker',
      when: ({ attackers }, env) => attackers.some((a) => isCx(pieceOf(env, a))),
      apply: (v) => v + 1,
    });
    r.contribute({
      id: 'sk1.cc.cx-target',
      query: 'cc.drm',
      ref: 'SK1 3.3',
      label: '-1 vs CX',
      when: ({ targets }, env) => targets.some((t) => isCx(pieceOf(env, t))),
      apply: (v) => v - 1,
    });
    r.contribute({
      id: 'sk1.cc.vs-broken',
      query: 'cc.drm',
      ref: 'SK1 3.8',
      label: '-2 vs broken',
      when: ({ targets }, env) => targets.every((t) => isBroken(pieceOf(env, t))),
      apply: (v) => v - 2,
    });
    r.contribute({
      id: 'sk1.cc.ambush',
      query: 'cc.drm',
      ref: 'SK1 3.8',
      label: 'ambush',
      when: (_c, env) => !!ccState(env)?.ambusher,
      apply: (v, { side }, env) => v + (ccState(env)!.ambusher === side ? -1 : 1),
    });

    r.contribute({
      id: 'sk1.cc.ambush-drm',
      query: 'cc.ambushDrm',
      layer: 0,
      apply(_v, { units }, env) {
        let drm = 0;
        const ps = units.map((u) => pieceOf(env, u));
        if (ps.some(isCx)) drm += 1;
        if (ps.some(isPinned)) drm += 1;
        if (ps.some((p) => env.query('unit.inexperienced', { unit: p.id }, false))) drm += 1;
        const leaders = ps.filter((p) => smc(env, p) && !isBroken(p) && !isPinned(p));
        if (leaders.length && ps.some((p) => mmc(env, p))) drm += ccLeadership(env, [...leaders, ...ps.filter((p) => mmc(env, p))]);
        return drm;
      },
    });

    r.on<{ phase: string }>({
      id: 'sk1.cc.start',
      event: 'turn.phaseStarted',
      handler(ctx, ev) {
        if (ev.payload.phase !== 'CCPh') return;
        const hexes = ccHexes(ctx);
        if (hexes.length === 0) return;
        ctx.emit('sk1.cc.state', { state: { pending: hexes, declared: {} } });
        nextHex(ctx);
      },
    });
    r.on<{ phase: string }>({
      id: 'sk1.cc.end',
      event: 'turn.phaseEnded',
      handler(ctx, ev) {
        if (ev.payload.phase !== 'CCPh') return;
        ctx.emit('sk1.cc.state', { state: null });
        // Any CC counter still on the map becomes Melee if both sides are still there, else goes.
        for (const [hex, m] of Object.entries(ctx.state.hexMarkers).sort()) {
          if (!m['cc']) continue;
          settleCcMarker(ctx, hex as HexId);
        }
      },
    });

    // A Melee counter comes off as soon as the Melee no longer holds (SK1 3.8, SK4 3.8: "as soon as no unbroken
    // unit remains"; a vehicle holds Infantry only while it stays there Stopped), not at the next CCPh. The CCPh
    // settles its own hexes as each one finishes.
    for (const event of ['piece.moved', 'piece.eliminated', 'piece.replaced', 'piece.tagged', 'sk1.move.state']) {
      r.on({
        id: `sk1.cc.melee-release.${event}`,
        event,
        handler(ctx) {
          if (ctx.state.phase === 'CCPh') return;
          for (const [hex, m] of Object.entries(ctx.state.hexMarkers).sort()) {
            if (m['melee'] && !ctx.query('cc.meleeHolds', { hex: hex as HexId }, false)) ctx.emit('hex.marker', { hex, key: 'melee', value: null });
          }
        },
      });
    }

    r.action<Action & { hex: HexId }>({
      type: 'cc.chooseHex',
      decisionKinds: [CC_HEX],
      legal: (env) => (ccState(env)?.pending ?? []).map((hex) => ({ type: 'cc.chooseHex', hex })),
      validate: (env, a) => (ccState(env)?.pending.includes(a.hex) ? null : 'No CC to resolve there'),
      resolve(ctx, a) {
        ctx.popDecision();
        beginHex(ctx, a.hex);
      },
    });
    r.autoResolver({
      id: 'sk1.cc.single-hex',
      decisionKind: CC_HEX,
      resolve: (env) => {
        const pending = ccState(env)?.pending ?? [];
        return pending.length === 1 ? { type: 'cc.chooseHex', hex: pending[0]! } : null;
      },
    });

    // SK1 3.8: players may rearrange their stacks before the CCPh. A leader goes on top of another
    // friendly MMC in his hex: in the owner's own phases, or in the arrange step before a CC.
    r.action<Action & { leader: PieceId; on: PieceId }>({
      type: 'stack.leaderOn',
      decisionKinds: [PHASE_DECISION, CC_ARRANGE],
      validate: (env, a, d) => restackIllegal(env, d.owner, a.leader, a.on, d.kind === CC_ARRANGE ? ccState(env)?.hex : undefined),
      resolve(ctx, a) {
        setTags(ctx, a.leader, { [T.stackedOn]: a.on });
      },
    });
    r.action<Action>({
      type: 'cc.arranged',
      decisionKinds: [CC_ARRANGE],
      legal: () => [{ type: 'cc.arranged' }],
      resolve(ctx, _a, d) {
        ctx.popDecision();
        const st = ccState(ctx)!;
        ctx.emit('sk1.cc.state', { state: { ...st, arranged: [...(st.arranged ?? []), d.owner] } });
        nextArrange(ctx);
      },
    });
    // A clock running out leaves the stacks as they are.
    r.autoResolver({ id: 'sk1.cc.arrange-timeout', decisionKind: CC_ARRANGE, resolve: (_env, _d, reason) => (reason === 'timeout' ? { type: 'cc.arranged' } : null) });

    r.action<Action & { attacks: CcAttack[] }>({
      type: 'cc.declare',
      decisionKinds: [CC_DECLARE],
      legal(env, d) {
        const st = ccState(env);
        if (!st?.hex) return [];
        const opts: CcAttack[][] = [[], ...declarationOptions(env, st.hex, d.owner).map((at) => [at])];
        return opts.filter((attacks) => !declarationIllegal(env, d.owner, st.hex!, attacks)).map((attacks) => ({ type: 'cc.declare', attacks }));
      },
      validate(env, a, d) {
        const st = ccState(env);
        if (!st?.hex) return 'No CC in progress';
        return declarationIllegal(env, d.owner, st.hex, a.attacks);
      },
      resolve(ctx, a, d) {
        const st = ccState(ctx)!;
        ctx.popDecision();
        const declared = { ...st.declared, [d.owner]: a.attacks };
        ctx.emit('sk1.cc.state', { state: { ...st, declared } });
        continueHex(ctx);
      },
    });
    // Nothing to attack with → declare no attacks automatically.
    r.autoResolver({
      id: 'sk1.cc.no-attackers',
      decisionKind: CC_DECLARE,
      resolve(env, d) {
        const st = ccState(env);
        if (!st?.hex) return null;
        return declarationOptions(env, st.hex, d.owner).length === 0 ? { type: 'cc.declare', attacks: [] } : null;
      },
    });
  },
};

function nextHex(ctx: Ctx) {
  const st = ccState(ctx)!;
  if (st.pending.length === 0) {
    ctx.emit('sk1.cc.state', { state: { pending: [], declared: {} } });
    if (ctx.state.decisions.length === 0) advancePhase(ctx);
    return;
  }
  ctx.pushDecision({ kind: CC_HEX, owner: ctx.state.attacker, deadlineClass: 'turn', data: { hexes: st.pending } });
}

function beginHex(ctx: Ctx, hex: HexId) {
  const st = ccState(ctx)!;
  ctx.emit('sk1.cc.state', { state: { ...st, pending: st.pending.filter((h) => h !== hex), hex, ambusher: null, declared: {}, step: 'arrange', arranged: [], turn: undefined, passed: [], attacked: [] } });
  nextArrange(ctx);
}

/** Ask each side in turn (ATTACKER first) that has a leader to restack; then on to the ambush and declarations. */
function nextArrange(ctx: Ctx) {
  const st = ccState(ctx)!;
  const hex = st.hex!;
  const attacker = ctx.state.attacker;
  const side = [attacker, otherSide(ctx.state, attacker)].find((s) => !st.arranged?.includes(s) && canArrange(ctx, hex, s));
  if (side) {
    ctx.pushDecision({ kind: CC_ARRANGE, owner: side, deadlineClass: 'turn', data: { hex } });
    return;
  }
  startDeclarations(ctx, hex);
}

function startDeclarations(ctx: Ctx, hex: HexId) {
  const st = ccState(ctx)!;
  const attacker = ctx.state.attacker;
  const defender = otherSide(ctx.state, attacker);
  let ambusher: SideId | null = null;
  const newCc = !inMelee(ctx, hex);
  const advancedIn = personnelAt(ctx, hex, attacker).some((p) => p.tags[T.advancedInto] === hex);
  // An ambush can occur in woods/buildings (SK1 3.8) and rubble (ASLRB B24), or wherever a hidden Gun was walked into (SK2, SK4 6.4).
  const hipAmbush = ctx.state.hexMarkers[hex]?.['hipAmbush'] !== undefined;
  const terrain = terrainOf(ctx, hex);
  if (newCc && advancedIn && ctx.query('cc.ambushPossible', { hex }, terrain.rallyCover || terrain.ambush || hipAmbush)) {
    const units = (side: SideId) => personnelAt(ctx, hex, side).map((p) => p.id);
    const drA = ctx.roll(`Ambush dr (${attacker}) in ${hex}`, 1).total + ctx.query('cc.ambushDrm', { hex, side: attacker, units: units(attacker) }, 0);
    const drD = ctx.roll(`Ambush dr (${defender}) in ${hex}`, 1).total + ctx.query('cc.ambushDrm', { hex, side: defender, units: units(defender) }, 0);
    if (drA <= drD - 3) ambusher = attacker;
    else if (drD <= drA - 3) ambusher = defender;
  }
  if (hipAmbush) ctx.emit('hex.marker', { hex, key: 'hipAmbush', value: null });
  // A vehicle in the hex: one attack at a time, the non-vehicular player first (the ATTACKER when both have one; SK4 3.8).
  const sequential = !ambusher && ctx.query('cc.sequential', { hex }, false);
  if (sequential) {
    const hasVehicle = (side: SideId) => ccUnits(ctx, hex, side).some((p) => isVehicleDef(defOf(ctx, p)));
    const first = hasVehicle(attacker) && !hasVehicle(defender) ? defender : attacker;
    ctx.emit('sk1.cc.state', { state: { ...st, ambusher: null, step: 'sequential', arranged: undefined, turn: first, passed: [], attacked: [] } });
    askDeclare(ctx, first);
    return;
  }
  ctx.emit('sk1.cc.state', { state: { ...st, ambusher, step: ambusher ? 'ambusher' : 'simultaneous-attacker', arranged: undefined } });
  askDeclare(ctx, ambusher ?? attacker);
}

function askDeclare(ctx: Ctx, side: SideId) {
  const st = ccState(ctx)!;
  ctx.pushDecision({ kind: CC_DECLARE, owner: side, deadlineClass: 'turn', data: { hex: st.hex, ambusher: st.ambusher ?? null, ...(st.step === 'sequential' ? { sequential: true } : {}) } });
}

function continueHex(ctx: Ctx) {
  const st = ccState(ctx)!;
  const attacker = ctx.state.attacker;
  const defender = otherSide(ctx.state, attacker);
  switch (st.step) {
    case 'sequential': {
      const side = st.turn!;
      const other = otherSide(ctx.state, side);
      const attacks = st.declared[side] ?? [];
      const passed = attacks.length === 0 ? [...(st.passed ?? []), side] : (st.passed ?? []);
      let attacked = st.attacked ?? [];
      for (const at of attacks) {
        ctx.proc<ResolveCcAttackFn>(CCP.resolveAttack)(ctx, side, at);
        attacked = [...attacked, ...at.attackers];
      }
      ctx.emit('sk1.cc.state', { state: { ...ccState(ctx)!, passed, attacked, declared: {} } });
      const canGo = (x: SideId) => !passed.includes(x) && declarationOptions(ctx, st.hex!, x).length > 0;
      const next = canGo(other) ? other : canGo(side) ? side : null;
      if (next) {
        ctx.emit('sk1.cc.state', { state: { ...ccState(ctx)!, turn: next } });
        askDeclare(ctx, next);
        return;
      }
      break;
    }
    case 'simultaneous-attacker':
      ctx.emit('sk1.cc.state', { state: { ...st, step: 'simultaneous-defender' } });
      askDeclare(ctx, defender);
      return;
    case 'simultaneous-defender': {
      // Simultaneous (SK1 3.8): every attack of both sides is worked out from the units as they stand before any is
      // resolved, so a squad reduced, or a leader wounded or lost, by the other side's attack still strikes back at
      // full strength. The ATTACKER's rolls come first only for the record.
      const plans = [attacker, defender].flatMap((side) => (st.declared[side] ?? []).map((at) => ({ side, at, plan: planAttack(ctx, side, at) })));
      resolveAttackBatch(ctx, plans.flatMap((x) => (x.plan ? [{ ...x, plan: x.plan }] : [])));
      break;
    }
    case 'ambusher': {
      const amb = st.ambusher!;
      resolveAttacks(ctx, amb, st.declared[amb] ?? []);
      ctx.emit('sk1.cc.state', { state: { ...ccState(ctx)!, step: 'other' } });
      const other = otherSide(ctx.state, amb);
      if (personnelAt(ctx, st.hex!, other).some((p) => !isBroken(p)) && personnelAt(ctx, st.hex!, amb).length > 0) {
        askDeclare(ctx, other);
        return;
      }
      break;
    }
    case 'other': {
      const other = otherSide(ctx.state, st.ambusher!);
      resolveAttacks(ctx, other, st.declared[other] ?? []);
      break;
    }
  }
  finishHex(ctx);
  nextHex(ctx);
}

function resolveAttacks(ctx: Ctx, side: SideId, attacks: CcAttack[]) {
  for (const at of attacks) ctx.proc<ResolveCcAttackFn>(CCP.resolveAttack)(ctx, side, at);
}

/** Work out one declared CC attack from the state as it stands: the units still there, strengths, odds and DRM. */
export function planAttack(env: QueryEnv, side: SideId, at: CcAttack): CcAttackPlan | null {
  const hex = ccState(env)!.hex!;
  const attackers = at.attackers.filter((a) => env.state.pieces[a]?.loc.kind === 'hex');
  if (attackers.length === 0) return null;
  const targets = at.targets.filter((t) => env.state.pieces[t]?.loc.kind === 'hex');
  if (targets.length === 0) return null;
  const attackFp = attackers.reduce((x, id) => x + fpForCc(env, id, 'attack'), 0);
  const defenseFp = targets.reduce((x, id) => x + fpForCc(env, id, 'defense', attackers), 0);
  const odds = ccOdds(env, attackFp, defenseFp);
  if (!odds) return null;
  return { attackers, targets, attackFp, defenseFp, odds, drm: env.query('cc.drm', { hex, attackers, targets, side }, 0) };
}

/** One declared CC attack, planned and rolled, waiting for its result to be applied. */
interface CcAttackRoll {
  side: SideId;
  at: CcAttack;
  plan: CcAttackPlan;
  roll: ReturnType<Ctx['roll']>;
}

/** One CC attack on the odds table (SK1 3.8), resolved on its own (ambush, or one at a time with a vehicle). */
export function resolveAttackBase(ctx: Ctx, side: SideId, at: CcAttack, given?: CcAttackPlan | null) {
  const plan = given === undefined ? planAttack(ctx, side, at) : given;
  if (plan) resolveAttackBatch(ctx, [{ side, at, plan }]);
}

/**
 * The MMC among `units` (MMC only) a Field Promotion in CC is based on: the `cc.promotionBase` query, whose default is
 * the best Morale (SK1 5.3: "use the best one to base the dr on"; the first of equals).
 */
export function promotionBase(env: QueryEnv, units: PieceId[]): PieceId | null {
  const byMorale = [...units].sort((a, b) => mmc(env, pieceOf(env, b))!.morale - mmc(env, pieceOf(env, a))!.morale)[0] ?? null;
  return units.length ? env.query('cc.promotionBase', { units }, byMorale) : null;
}

/**
 * Resolve CC attacks that are simultaneous with each other (SK1 3.8): every DR is rolled, and every Field Promotion
 * made, before any result is applied. A leader created on an original 2 (SK1 5.3) then joins both attacks "just as if
 * he had been there all along" (ASLRB A18.12): his FP and leadership in his unit's attack, and his FP in the defence
 * of the enemy attack on the MMC he defends with, under which he may die at once. An MMC eliminated by the other
 * side's simultaneous attack still gets its Leader Creation dr this way.
 */
export function resolveAttackBatch(ctx: Ctx, items: { side: SideId; at: CcAttack; plan: CcAttackPlan }[]) {
  const hex = ccState(ctx)!.hex!;
  const tables = statics(ctx).tables;
  const rolled: CcAttackRoll[] = items.map((it) => ({ ...it, roll: ctx.roll(`CC ${it.side} in ${hex}`) }));
  for (const r of rolled) {
    if (r.roll.total !== 2) continue;
    // Field promotion: the dr is based on the best MMC of the attack (SK1 5.3), -1 drm per odds column below 1:1
    // (SK4 CC example).
    const mmcs = r.plan.attackers.map((id) => pieceOf(ctx, id)).filter((p) => mmc(ctx, p));
    const bestId = promotionBase(ctx, mmcs.map((p) => p.id));
    const best = bestId ? pieceOf(ctx, bestId) : undefined;
    if (!best) continue;
    const cols = tables.ccOddsColumns;
    const below = Math.max(0, cols.indexOf('1:1') - cols.indexOf(r.plan.odds));
    const leader = ctx.proc<FieldPromotionFn>(RP.fieldPromotion)(ctx, best.id, mmc(ctx, best)!.morale, { ccColumnsBelowEven: below });
    if (!leader) continue;
    // He defends with one of the MMC that made the attack (ASLRB A18.2: Random Selection when there are several).
    const [withMmc] = mmcs.length > 1 ? ctx.proc<RandomSelectFn>(MP.randomSelect)(ctx, mmcs.map((p) => p.id), 1, 'MMC the new leader defends with') : [best.id];
    setTags(ctx, leader, { [T.stackedOn]: withMmc! });
    r.at = { attackers: [...r.at.attackers, leader], targets: r.at.targets };
    r.plan = planAttack(ctx, r.side, r.at) ?? r.plan;
    for (const o of rolled) {
      if (o === r || !o.plan.targets.includes(withMmc!)) continue;
      o.at = { attackers: o.at.attackers, targets: [...o.at.targets, leader] };
      o.plan = planAttack(ctx, o.side, o.at) ?? o.plan;
    }
  }
  for (const r of rolled) applyAttack(ctx, r);
}

/** Apply one rolled CC attack: elimination below the kill number, Casualty Reduction on it (SK1 3.8). */
function applyAttack(ctx: Ctx, { side, plan, roll }: CcAttackRoll) {
  const hex = ccState(ctx)!.hex!;
  const { attackers, odds, drm } = plan;
  const targets = plan.targets.filter((t) => ctx.state.pieces[t]?.loc.kind === 'hex');
  if (targets.length === 0) return;
  const kill = ctx.query('cc.kill', { hex, side, attackers, targets, odds }, statics(ctx).tables.ccKill(odds));
  const final = roll.total + drm;
  let result = 'no effect';
  if (final < kill) {
    result = 'eliminated';
    for (const t of targets) eliminate(ctx, t, 'Close Combat');
  } else if (final === kill) {
    result = 'casualty reduction';
    // One of the attacked units (SK1 3.8); in full ASL "one (or more)", ties included (ASLRB A11.11, A.9).
    for (const victim of ctx.proc<RandomSelectFn>(MP.randomSelect)(ctx, targets, 1, 'CC casualty', { ties: true })) {
      ctx.proc<CasualtyFn>(MP.casualtyReduce)(ctx, victim, 'Close Combat');
    }
  }
  ctx.emit('sk1.cc.attack', { hex, side, attack: { attackers, targets }, odds, drm, dr: roll.total, kill, result });
}

/** CC strength: SMC = 1; MMC = FP (halved if pinned, via query). */
export function fpForCc(ctx: QueryEnv, id: PieceId, kind: 'attack' | 'defense', attackers?: PieceId[]): number {
  const p = ctx.state.pieces[id]!;
  const d = defOf(ctx, p);
  const base = d.kind === 'leader' ? 1 : d.kind === 'sw' || d.kind === 'gun' || d.kind === 'vehicle' || d.kind === 'unknown' ? 0 : d.fp;
  return kind === 'attack' ? ctx.query('cc.attackFp', { unit: id }, base) : ctx.query('cc.defenseFp', { unit: id, ...(attackers ? { attackers } : {}) }, base);
}

function finishHex(ctx: Ctx) {
  const st = ccState(ctx)!;
  settleCcMarker(ctx, st.hex!);
  ctx.emit('sk1.cc.state', { state: { ...ccState(ctx)!, hex: undefined, declared: {}, ambusher: null, step: undefined } });
}

/** After CC in a hex: the CC counter comes off; Melee goes on (or stays) if both sides are still there. */
function settleCcMarker(ctx: Ctx, hex: HexId) {
  if (ctx.query('cc.meleeHolds', { hex }, false)) ctx.emit('hex.marker', { hex, key: 'melee', value: true });
  else if (ctx.state.hexMarkers[hex]?.['melee']) ctx.emit('hex.marker', { hex, key: 'melee', value: null });
  if (ctx.state.hexMarkers[hex]?.['cc']) ctx.emit('hex.marker', { hex, key: 'cc', value: null });
}

/** The units that defend together with `unit` in CC (SK1 3.8): a SMC with the MMC he is stacked on. */
export const ccDefensiveGroup = defensiveGroup;
/** Why a whole CC declaration is not allowed now, or null. */
export const ccDeclarationIllegal = declarationIllegal;

export interface CcAttackPreview {
  attackFp: number;
  defenseFp: number;
  /** The CCT odds column ("3:2"), or null when the odds fall below the lowest column. */
  odds: string | null;
  /** The kill number of that column (0 when there is no column). */
  kill: number;
  drm: number;
  /** The DRM contributions that apply (leadership, CX, ambush, …). */
  drmNotes: DrmNote[];
  /** Why this attack, on its own, could not be declared now, or null. */
  illegal: string | null;
}

/** What one prospective CC attack would be: strengths, odds column, DRM and legality. Pure; for the interface. */
export function ccAttackPreview(env: QueryEnv, hex: HexId, side: SideId, attack: CcAttack): CcAttackPreview {
  const ids = (xs: PieceId[]) => xs.filter((id) => env.state.pieces[id]);
  const attackers = ids(attack.attackers);
  const targets = ids(attack.targets);
  const a = attackFp(env, attackers);
  const d = defenseFp(env, targets, attackers);
  const odds = attackers.length && targets.length ? ccOdds(env, a, d) : null;
  const res = attackers.length && targets.length ? env.explain('cc.drm', { hex, attackers, targets, side }, 0) : null;
  return {
    attackFp: a,
    defenseFp: d,
    odds,
    kill: odds ? env.query('cc.kill', { hex, side, attackers, targets, odds }, statics(env).tables.ccKill(odds)) : 0,
    drm: res?.value ?? 0,
    drmNotes: res ? drmNotes(res) : [],
    illegal: declarationIllegal(env, side, hex, [attack]),
  };
}

export const _cc = { declarationIllegal, defensiveGroup, ccOdds };
