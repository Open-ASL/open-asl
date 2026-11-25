import type { Action, Ctx, Decision, Piece, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { byId, statics, swHeldBy } from '../common/pieces';
import { OFFBOARD_SETUP_DECISION, SETUP_DECISION } from './scenario';
import { mmc, pieceOf } from './status';

declare module '@asl/engine' {
  interface QueryCatalog {
    /** Whether a rule (not an SSR) lets this squad deploy at setup or on entry (SK4 8.4: a Good Order U.S.M.C. 7-6-8). */
    'deploy.allowed': { ctx: { side: SideId; unit: PieceId }; value: boolean };
    /**
     * How many squads of the group `unit` sets up with may be deployed at setup, and how many have been: the card's
     * SSR count in the Starter Kit (null without one); full ASL adds the A2.9 10% per setup group.
     */
    'setup.deployQuota': { ctx: { side: SideId; unit: PieceId }; value: DeployQuota | null };
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

/** A setup deployment allowance: `max` squads of the group, `used` so far, under `rule`. */
export interface DeployQuota {
  max: number;
  used: number;
  rule: string;
  /** The allowance covers units entering this Player Turn, before their offboard setup (ASLRB A2.9). */
  entry?: boolean;
  /** Why this unit may not be deployed at all (a nationality that may not Deploy). */
  refused?: string;
  /** The reason given once `used` reaches `max` (default: "At most N squads may be deployed (rule)"). */
  full?: string;
}

/**
 * Replace a squad by the two half-squads it reduces to (ASLRB A1.3: "the corresponding HS for that Class and type"): the
 * squad's piece becomes the first, keeping its id, Location and weapons; `second` is created beside it with the same
 * tags. Both carry `deployedFrom`. Returns the half-squad def.
 */
export function splitSquad(ctx: Ctx, squad: PieceId, second: PieceId): string {
  const p = pieceOf(ctx, squad);
  const hs = mmc(ctx, p)!.reducesTo!;
  ctx.emit('piece.replaced', { id: p.id, defId: hs, from: p.defId, reason: 'deploy' });
  ctx.emit('piece.tagged', { id: p.id, tags: { [DEPLOYED_FROM]: p.defId } });
  ctx.emit('piece.created', { piece: { id: second, defId: hs, side: p.side, loc: { ...p.loc }, tags: { ...pieceOf(ctx, p.id).tags, [DEPLOYED_FROM]: p.defId } } });
  return hs;
}

/** Two half-squads become one squad (ASLRB A1.32; SK4 8.4.1): `gone`'s weapons go to `keep`, which becomes `squad`. */
export function mergeHalfSquads(ctx: Ctx, keep: PieceId, gone: PieceId, squad: string) {
  for (const w of swHeldBy(ctx.state, gone).sort(byId)) ctx.emit('piece.moved', { id: w.id, loc: { kind: 'held', by: keep } });
  ctx.emit('piece.replaced', { id: keep, defId: squad, from: pieceOf(ctx, keep).defId, reason: 'recombine' });
}

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
  const p = env.state.pieces[unit];
  if (!p || p.side !== side) return 'Not one of your units';
  const quota = deployQuota(env, side, unit);
  // A rule may let the squad itself deploy (SK4 8.4): at setup, or as a reinforcement still to enter.
  const granted = env.query('deploy.allowed', { side, unit }, false);
  if (!granted && quota?.refused) return quota.refused;
  if (!quota && !granted) return 'No special rule lets this side deploy squads at setup';
  // Entering units are deployed before their offboard setup, in the RPh of their entry turn (ASLRB A2.9).
  const entering = !granted && !!quota?.entry && p.loc.kind === 'offboard' && !p.loc.hex && p.loc.edge !== 'setup' && p.tags['entryTurn'] === env.state.turn;
  if (!granted && !entering && env.state.phase !== 'setup') return 'Squads are deployed during setup only';
  if (p.loc.kind !== 'offboard' || (!granted && !entering && p.loc.edge !== 'setup') || (granted && p.loc.edge !== 'setup' && !p.loc.hex)) return 'Only a squad still to be set up may be deployed';
  const d = mmc(env, p);
  if (d?.kind !== 'squad' || !d.reducesTo) return 'Only a squad may be deployed as two half-squads';
  if (!granted && quota && quota.used >= quota.max) return quota.full ?? `At most ${quota.max} squads may be deployed (${quota.rule})`;
  return null;
}

/** The setup deployment allowance for `unit`'s group (`setup.deployQuota`): the card's SSR count by default. */
export function deployQuota(env: QueryEnv, side: SideId, unit: PieceId): DeployQuota | null {
  const rule = setupDeployParams(env, side);
  return env.query('setup.deployQuota', { side, unit }, rule ? { max: rule.squads, used: squadsDeployed(env, side), rule: rule.rule ?? 'SSR' } : null);
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
        const second = `${p.id}.d`;
        const hs = splitSquad(ctx, p.id, second);
        const rule = setupDeployParams(ctx, d.owner)?.rule ?? null;
        ctx.emit('ssr.setup-deploy', { side: d.owner, squad: p.id, from: p.defId, to: hs, halves: [p.id, second], rule });
      },
    });
  },
};
