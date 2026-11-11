import type { Action, Ctx, Decision, Piece, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { byId, statics } from '../common/pieces';
import { OFFBOARD_SETUP_DECISION, SETUP_DECISION } from './scenario';
import { mmc } from './status';

declare module '@asl/engine' {
  interface QueryCatalog {
    /** Whether a rule (not an SSR) lets this squad deploy at setup or on entry (SK4 8.4: a Good Order U.S.M.C. 7-6-8). */
    'deploy.allowed': { ctx: { side: SideId; unit: PieceId }; value: boolean };
  }
}

/*
 * Squads deployed as half-squads at setup by SSR (LMA7 SSR 3: "Durant son placement, le joueur allemand peut scinder
 * jusqu'à 3 squads en 6 demi-squads": during his setup the German player may split up to 3 squads into 6 half-squads).
 * While the side's setup decision is open, each `setup.deploy` replaces one squad still to be placed by the half-squad
 * it reduces to and creates a second one beside it; SW it was given stay with the first. Undoing the action takes it back.
 */

export const SETUP_DEPLOY_MODULE = 'setup-deploy';
export interface SetupDeployParams {
  side: SideId;
  /** How many squads may be split. */
  squads: number;
  /** The card's name for the rule, e.g. 'SSR 3'. */
  rule?: string;
}

/** The tag on both half-squads of a deployed squad: the squad counter it was. */
export const DEPLOYED_FROM = 'deployedFrom';

const paramsOf = (env: QueryEnv): SetupDeployParams[] =>
  statics(env)
    .scenario.ssr.filter((s) => s.module === SETUP_DEPLOY_MODULE && s.params)
    .map((s) => s.params as unknown as SetupDeployParams);

export const setupDeployParams = (env: QueryEnv, side: SideId): SetupDeployParams | undefined => paramsOf(env).find((p) => p.side === side);

/** Squads the side has deployed so far (the first half-squad of each keeps the squad's id). */
export const squadsDeployed = (env: QueryEnv, side: SideId): number =>
  Object.values(env.state.pieces).filter((p) => p.side === side && p.tags[DEPLOYED_FROM] !== undefined && !p.id.endsWith('.d')).length;

/** Why `unit` may not be deployed now by `side` (null if it may). */
export function deployIllegal(env: QueryEnv, side: SideId, unit: PieceId): string | null {
  const rule = setupDeployParams(env, side);
  const p = env.state.pieces[unit];
  if (!p || p.side !== side) return 'Not one of your units';
  // A rule may let the squad itself deploy (SK4 8.4): at setup, or as a reinforcement still to enter.
  const granted = env.query('deploy.allowed', { side, unit }, false);
  if (!rule && !granted) return 'No special rule lets this side deploy squads at setup';
  if (!granted && env.state.phase !== 'setup') return 'Squads are deployed during setup only';
  if (p.loc.kind !== 'offboard' || (!granted && p.loc.edge !== 'setup') || (granted && p.loc.edge !== 'setup' && !p.loc.hex)) return 'Only a squad still to be set up may be deployed';
  const d = mmc(env, p);
  if (d?.kind !== 'squad' || !d.reducesTo) return 'Only a squad may be deployed as two half-squads';
  if (!granted && rule && squadsDeployed(env, side) >= rule.squads) return `At most ${rule.squads} squads may be deployed (${rule.rule ?? 'SSR'})`;
  return null;
}

/** The squads a side may deploy now. */
export const deployableSquads = (env: QueryEnv, side: SideId): Piece[] =>
  Object.values(env.state.pieces)
    .filter((p) => p.side === side && deployIllegal(env, side, p.id) === null)
    .sort(byId);

export const setupDeployModule: RuleModule = {
  id: 'ssr.setup-deploy',
  ref: 'LMA7 SSR 3',
  summary: 'A side may split some of its squads into two half-squads each while setting up (SSR).',
  requires: ['sk1.scenario'],
  install(r) {
    r.event<{ side: SideId; squad: PieceId; from: string; to: string; halves: PieceId[]; rule: string | null }>({ type: 'ssr.setup-deploy', apply() {} });
    r.action<Action & { unit: PieceId }>({
      type: 'setup.deploy',
      decisionKinds: [SETUP_DECISION, OFFBOARD_SETUP_DECISION],
      legal: (env, d) => deployableSquads(env, d.owner).map((p) => ({ type: 'setup.deploy', unit: p.id })),
      validate: (env, a, d: Decision) => deployIllegal(env, d.owner, a.unit),
      resolve(ctx: Ctx, a, d: Decision) {
        const p = ctx.state.pieces[a.unit]!;
        const hs = mmc(ctx, p)!.reducesTo!;
        const second = `${p.id}.d`;
        ctx.emit('piece.replaced', { id: p.id, defId: hs, from: p.defId, reason: 'deploy' });
        ctx.emit('piece.tagged', { id: p.id, tags: { [DEPLOYED_FROM]: p.defId } });
        ctx.emit('piece.created', { piece: { id: second, defId: hs, side: p.side, loc: { ...p.loc }, tags: { ...p.tags, [DEPLOYED_FROM]: p.defId } } });
        const rule = setupDeployParams(ctx, d.owner)?.rule ?? null;
        ctx.emit('ssr.setup-deploy', { side: d.owner, squad: p.id, from: p.defId, to: hs, halves: [p.id, second], rule });
      },
    });
  },
};
