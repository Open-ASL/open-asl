import type { Action, Ctx, Decision, Piece, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { byId, personnelAt, statics, swHeldBy } from '../common/pieces';
import { locOf } from '../common/location';
import { PHASE_DECISION, askPhaseOwner } from '../common/turn';
import { DEPLOYED_FROM } from '../sk1/setupDeploy';
import { T, isGoodOrder, isPinned, mmc, pieceOf, setTags, smc } from '../sk1/status';

/*
 * The U.S. Marine Corps (SK4 8.4). Marine MMC are Elite Americans (counter data). A Good Order 7-6-8 may deploy
 * into two 3-4-8 HS at setup, reinforcements included (the `setup.deploy` action, granted here through
 * `deploy.allowed`), or in the American RPh as its sole action after all recovery attempts by passing a NTC (8.4).
 * Two Good Order 3-4-8 HS in one hex with a Good Order leader may recombine into a 7-6-8 in the American RPh as
 * their sole action, if the OB provides 7-6-8s (8.4.1). Raider MMC ambush at −1 (8.4.2). Early U.S. Army and
 * Paramarines are counters only (8.4.2, 8.4.3). Readings: "sole action" is the RPh action tag (`rphAction`), so a
 * unit that has recovered, repaired or rallied this RPh may not deploy or recombine, and vice versa; the recovery
 * attempts a deploying squad must wait for are its own (recovery is optional, so the player simply deploys when it
 * has none to make); the NTC takes the DRM of a Good Order unpinned leader in the hex, as other Task Checks do.
 */

export const USMC_MODULE = 'sk4.usmc';

declare module '@asl/engine' {
  interface QueryCatalog {
    /** Whether a unit counts as a Raider MMC for its -1 ambush drm (SK4 8.4.2): the counter, or an SSR. */
    'unit.raider': { ctx: { unit: PieceId }; value: boolean };
  }
}

/**
 * Raider ambush changed by the card (S64): `leaders` "Good Order American leaders are considered Raider MMC (8.4.2) for
 * the purpose of determining ambush" (SSR 5); `none` "Raider -1 ambush drm (8.4.2) is NA" (a balance, by `patchSsr`).
 */
export const RAIDER_AMBUSH_MODULE = 'raider-ambush';
export interface RaiderAmbushParams {
  side: SideId;
  leaders?: boolean;
  /** Every unit of the side, MMC and SMC ("Good Order American units are considered Raider MMC", S67 SSR 3). */
  units?: boolean;
  none?: boolean;
}
const raiderAmbushParams = (env: QueryEnv): RaiderAmbushParams[] =>
  statics(env)
    .scenario.ssr.filter((s) => s.module === RAIDER_AMBUSH_MODULE && s.params)
    .map((s) => s.params as unknown as RaiderAmbushParams);

export const raiderAmbushModule: RuleModule = {
  id: 'ssr.raider-ambush',
  summary: 'Raider ambush changed by SSR: a side’s Good Order leaders count as Raider MMC, or no Raider -1 at all (SK4 8.4.2).',
  requires: [USMC_MODULE],
  install(r) {
    r.contribute({
      id: 'ssr.raider-ambush',
      query: 'unit.raider',
      apply(v, { unit }, env) {
        const p = env.state.pieces[unit];
        if (!p) return v;
        for (const q of raiderAmbushParams(env)) {
          if (q.side !== p.side) continue;
          if (q.none) return false;
          if ((q.leaders || q.units) && smc(env, p)) return true;
          if (q.units && mmc(env, p)) return true;
        }
        return v;
      },
    });
  },
};
const SQUAD = 'am.768';
const HS = 'am.348h';

const rallySide = (env: QueryEnv, d: Decision): SideId => (d.data?.['side'] as SideId | undefined) ?? env.state.attacker;
/** Whether the OB of `side` has 7-6-8 squads at all (8.4.1). */
const obHasSquads = (env: QueryEnv, side: SideId) => statics(env).scenario.forces.some((f) => f.side === side && f.units.some((u) => u.def === SQUAD));
const freeThisRph = (p: Piece) => p.tags[T.rphAction] === undefined;

/** Why a 7-6-8 may not deploy by NTC now, or null. */
export function rphDeployIllegal(env: QueryEnv, side: SideId, unit: PieceId): string | null {
  if (env.state.phase !== 'RPh') return 'Only in the Rally Phase';
  if (env.state.attacker !== side) return 'Only in the American Player Turn';
  const p = env.state.pieces[unit];
  if (!p || p.side !== side) return 'Not one of your units';
  if (p.defId !== SQUAD) return 'Only a 7-6-8 squad deploys (SK4 8.4)';
  if (p.loc.kind !== 'hex') return 'The squad must be on the map';
  if (!isGoodOrder(env, p) || isPinned(p)) return 'The squad must be in Good Order and unpinned';
  if (!freeThisRph(p)) return 'Deploying is the squad’s sole Rally Phase action';
  return null;
}

/** Why two HS may not recombine under `leader` now, or null. */
export function recombineIllegal(env: QueryEnv, side: SideId, units: PieceId[], leader: PieceId): string | null {
  if (env.state.phase !== 'RPh') return 'Only in the Rally Phase';
  if (env.state.attacker !== side) return 'Only in the American Player Turn';
  if (units.length !== 2 || units[0] === units[1]) return 'Two half-squads recombine';
  const ps = units.map((u) => env.state.pieces[u]);
  if (ps.some((p) => !p || p.side !== side)) return 'Not your units';
  const [a, b] = ps as [Piece, Piece];
  if (a.defId !== HS || b.defId !== HS) return 'Only two 3-4-8 half-squads recombine (SK4 8.4.1)';
  if (a.loc.kind !== 'hex' || locOf(env.state, a) !== locOf(env.state, b)) return 'Both half-squads must be in the same hex';
  if (!isGoodOrder(env, a) || !isGoodOrder(env, b) || isPinned(a) || isPinned(b)) return 'Both half-squads must be in Good Order and unpinned';
  if (!freeThisRph(a) || !freeThisRph(b)) return 'Recombining is the half-squads’ sole Rally Phase action';
  const l = env.state.pieces[leader];
  if (!l || l.side !== side || !smc(env, l) || locOf(env.state, l) !== locOf(env.state, a) || !isGoodOrder(env, l)) return 'A Good Order leader must be in the hex with them';
  if (!obHasSquads(env, side)) return 'The order of battle provides no 7-6-8 squads to recombine into';
  return null;
}

export const usmcModule: RuleModule = {
  id: USMC_MODULE,
  ref: 'SK4 8.4',
  summary: 'U.S. Marine Corps: a 7-6-8 deploys into two 3-4-8 at setup or by NTC in the RPh; two 3-4-8 with a leader recombine in the RPh; Raiders ambush at -1.',
  requires: ['sk1.rally', 'ssr.setup-deploy'],
  install(r) {
    r.event<{ unit: PieceId; from: string; dr: [number, number]; drm: number; morale: number; passed: boolean; halves?: PieceId[] }>({ type: 'sk4.usmc.deploy', apply() {} });
    r.event<{ squad: PieceId; removed: PieceId; leader: PieceId }>({
      type: 'sk4.usmc.recombined',
      // The second half-squad is folded into the squad: off the map, no casualty (the squad is still there).
      apply(d, p) {
        const gone = d.pieces[p.removed];
        if (gone) {
          gone.loc = { kind: 'eliminated' };
          gone.tags = { recombined: true };
        }
      },
    });

    // 8.4: a Good Order 7-6-8 may deploy at setup, reinforcements included.
    r.contribute({
      id: 'sk4.usmc.setup-deploy',
      query: 'deploy.allowed',
      ref: 'SK4 8.4',
      when: ({ unit }, env) => env.state.pieces[unit]?.defId === SQUAD,
      apply: () => true,
    });
    // 8.4.2: Raiders ambush at -1.
    r.contribute({
      id: 'sk4.usmc.raider-ambush',
      query: 'cc.ambushDrm',
      ref: 'SK4 8.4.2',
      label: '-1 Raiders',
      when: ({ units }, env) =>
        units.some((u) => {
          const p = pieceOf(env, u);
          return isGoodOrder(env, p) && env.query('unit.raider', { unit: u }, !!mmc(env, p)?.raider);
        }),
      apply: (v) => v - 1,
    });

    // 8.4: deploy in the RPh by NTC.
    r.action<Action & { type: 'rally.deploy'; unit: PieceId }>({
      type: 'rally.deploy',
      decisionKinds: [PHASE_DECISION],
      legal(env, d) {
        if (env.state.phase !== 'RPh') return [];
        const side = rallySide(env, d);
        return Object.values(env.state.pieces)
          .filter((p) => p.side === side && !rphDeployIllegal(env, side, p.id))
          .sort(byId)
          .map((p) => ({ type: 'rally.deploy' as const, unit: p.id }));
      },
      validate: (env, a, d) => rphDeployIllegal(env, rallySide(env, d), a.unit),
      resolve(ctx, a, d) {
        const side = rallySide(ctx, d);
        const p = pieceOf(ctx, a.unit);
        const m = mmc(ctx, p)!;
        const morale = ctx.query('unit.morale', { unit: a.unit }, m.morale);
        const loc = locOf(ctx.state, p)!;
        const leaders = personnelAt(ctx, loc, side).filter((l) => l.id !== a.unit && smc(ctx, l) && isGoodOrder(ctx, l) && !isPinned(l));
        const drm = leaders.length ? Math.min(0, ...leaders.map((l) => ctx.query('unit.leadership', { unit: l.id, for: a.unit }, smc(ctx, l)!.leadership))) : 0;
        const roll = ctx.roll(`NTC to deploy ${a.unit}`);
        const passed = roll.total + drm <= morale;
        setTags(ctx, a.unit, { [T.rphAction]: true });
        if (!passed) {
          ctx.emit('sk4.usmc.deploy', { unit: a.unit, from: p.defId, dr: roll.dice as [number, number], drm, morale, passed: false });
          askPhaseOwner(ctx, side, { side });
          ctx.popDecision(d.id);
          return;
        }
        const hs = m.reducesTo!;
        const second = `${p.id}.d`;
        ctx.emit('piece.replaced', { id: p.id, defId: hs, from: p.defId, reason: 'deploy' });
        ctx.emit('piece.tagged', { id: p.id, tags: { [DEPLOYED_FROM]: p.defId } });
        ctx.emit('piece.created', { piece: { id: second, defId: hs, side: p.side, loc: { ...p.loc }, tags: { ...pieceOf(ctx, p.id).tags, [DEPLOYED_FROM]: p.defId } } });
        ctx.emit('sk4.usmc.deploy', { unit: a.unit, from: p.defId, dr: roll.dice as [number, number], drm, morale, passed: true, halves: [p.id, second] });
        ctx.popDecision(d.id);
        askPhaseOwner(ctx, side, { side });
      },
    });

    // 8.4.1: recombine in the RPh.
    r.action<Action & { type: 'rally.recombine'; units: PieceId[]; leader: PieceId }>({
      type: 'rally.recombine',
      decisionKinds: [PHASE_DECISION],
      legal(env, d) {
        if (env.state.phase !== 'RPh') return [];
        const side = rallySide(env, d);
        if (!obHasSquads(env, side)) return [];
        const out: { type: 'rally.recombine'; units: PieceId[]; leader: PieceId }[] = [];
        const hs = Object.values(env.state.pieces).filter((p) => p.side === side && p.defId === HS && p.loc.kind === 'hex').sort(byId);
        for (let i = 0; i < hs.length; i++)
          for (let j = i + 1; j < hs.length; j++) {
            const a = hs[i]!;
            const b = hs[j]!;
            if (locOf(env.state, a) !== locOf(env.state, b)) continue;
            const leader = personnelAt(env, locOf(env.state, a)!, side).filter((l) => smc(env, l)).sort(byId).find((l) => !recombineIllegal(env, side, [a.id, b.id], l.id));
            if (leader) out.push({ type: 'rally.recombine', units: [a.id, b.id], leader: leader.id });
          }
        return out;
      },
      validate: (env, a, d) => recombineIllegal(env, rallySide(env, d), a.units, a.leader),
      resolve(ctx, a, d) {
        const side = rallySide(ctx, d);
        const [keep, gone] = [...a.units].sort() as [PieceId, PieceId];
        // The second half-squad's weapons go to the squad.
        for (const w of swHeldBy(ctx.state, gone).sort(byId)) ctx.emit('piece.moved', { id: w.id, loc: { kind: 'held', by: keep } });
        ctx.emit('piece.replaced', { id: keep, defId: SQUAD, from: HS, reason: 'recombine' });
        setTags(ctx, keep, { [T.rphAction]: true, [DEPLOYED_FROM]: null });
        ctx.emit('sk4.usmc.recombined', { squad: keep, removed: gone, leader: a.leader });
        ctx.popDecision(d.id);
        askPhaseOwner(ctx, side, { side });
      },
    });
  },
};

