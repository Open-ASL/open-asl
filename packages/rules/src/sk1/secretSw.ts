import type { Ctx, Decision, Piece, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { byId, defOf, hexOf, otherSide, statics } from '../common/pieces';
import { SETUP_PLACED, type SetupAction, type SetupPlacedFn } from './scenario';
import { isBroken, mmc, setTags, smc, sw } from './status';

/*
 * Support weapons whose possession is recorded secretly by SSR (S34 SSR 2: "The American player may secretly record which
 * units possess Bazookas during setup. They are revealed if the possessing unit fires them, becomes broken, or an enemy
 * unit enters its hex."). Every such weapon of the side set up on the map is hidden from the enemy (hiding them has no
 * cost, so the engine records them all) until it fires, its possessor breaks, an enemy unit enters the hex, or it is
 * no longer possessed. Like Hidden Initial Placement it is hidden by the client; an online recording still has it.
 */

export const SECRET_SW_MODULE = 'secret-sw';
export interface SecretSwParams {
  side: SideId;
  /** SW types recorded secretly, e.g. ['BAZ']. */
  types: string[];
  /** The card's name for the rule, e.g. 'SSR 2'. */
  rule?: string;
}

/** The tag on a weapon whose possession is still secret. */
export const SECRET_SW = 'secretSw';

const paramsOf = (env: QueryEnv): SecretSwParams[] =>
  statics(env)
    .scenario.ssr.filter((s) => s.module === SECRET_SW_MODULE && s.params)
    .map((s) => s.params as unknown as SecretSwParams);

export const isSecretSw = (p: Piece) => p.tags[SECRET_SW] === true;

function reveal(ctx: Ctx, w: Piece, reason: 'fired' | 'broken' | 'enemy' | 'unpossessed') {
  if (!isSecretSw(w)) return;
  const holder = w.loc.kind === 'held' ? w.loc.by : null;
  ctx.emit('ssr.secret-sw.revealed', { weapon: w.id, holder, hex: hexOf(ctx.state, w), reason });
  setTags(ctx, w.id, { [SECRET_SW]: null });
}

/** Reveal every secret weapon whose secret no longer holds. */
function sweep(ctx: Ctx) {
  if (ctx.state.phase === 'setup') return;
  for (const w of Object.values(ctx.state.pieces).filter(isSecretSw).sort(byId)) {
    const holder = w.loc.kind === 'held' ? ctx.state.pieces[w.loc.by] : undefined;
    if (!holder || holder.loc.kind !== 'hex') {
      reveal(ctx, w, 'unpossessed');
      continue;
    }
    if (isBroken(holder)) {
      reveal(ctx, w, 'broken');
      continue;
    }
    const hex = holder.loc.hex;
    const enemy = otherSide(ctx.state, w.side);
    const here = Object.values(ctx.state.pieces).some((e) => e.side === enemy && e.loc.kind === 'hex' && e.loc.hex === hex && (mmc(ctx, e) || smc(ctx, e) || defOf(ctx, e).kind === 'vehicle'));
    if (here) reveal(ctx, w, 'enemy');
  }
}

export const secretSwModule: RuleModule = {
  id: 'ssr.secret-sw',
  summary: 'A side’s SW of listed types are possessed in secret until they fire, their possessor breaks or an enemy unit enters the hex (SSR).',
  requires: ['sk1.scenario', 'sk1.status', 'sk1.fire'],
  install(r) {
    r.event<{ weapon: PieceId; holder: PieceId | null; hex: string | null; reason: string }>({ type: 'ssr.secret-sw.revealed', apply() {} });
    r.contribute({
      id: 'ssr.secret-sw.visible',
      query: 'piece.visibleTo',
      layer: 0,
      apply(v, { piece, viewer }, env) {
        const p = env.state.pieces[piece];
        if (!p || !isSecretSw(p)) return v;
        return viewer === p.side;
      },
    });
    // At setup: the side's listed weapons on the map go secret.
    r.procedure<SetupPlacedFn>(SETUP_PLACED, (next) => (ctx: Ctx, action: SetupAction, decision: Decision) => {
      next?.(ctx, action, decision);
      for (const rule of paramsOf(ctx)) {
        if (decision.owner !== rule.side) continue;
        for (const w of Object.values(ctx.state.pieces).sort(byId)) {
          if (w.side !== rule.side || w.loc.kind !== 'held' || isSecretSw(w)) continue;
          const d = sw(ctx, w);
          const holder = ctx.state.pieces[w.loc.by];
          if (d && rule.types.includes(d.type) && holder?.loc.kind === 'hex' && action.placements[holder.id]) setTags(ctx, w.id, { [SECRET_SW]: true });
        }
      }
    });
    // Firing it: as an ordnance SW (a Bazooka's To Hit) or on the IFT.
    for (const event of ['sk2.ordnance.shot', 'sk2.ordnance.noLos'])
      r.on<{ weapon: PieceId }>({
        id: event === 'sk2.ordnance.shot' ? 'ssr.secret-sw.shot' : 'ssr.secret-sw.shot-noLos',
        event,
        handler(ctx, ev) {
          const w = ctx.state.pieces[ev.payload.weapon];
          if (w) reveal(ctx, w, 'fired');
        },
      });
    for (const event of ['sk1.fire.attack', 'sk1.fire.noLos'])
      r.on<{ attack: { parts: PieceId[] } }>({
        id: event === 'sk1.fire.attack' ? 'ssr.secret-sw.attack' : 'ssr.secret-sw.attack-noLos',
        event,
        handler(ctx, ev) {
          for (const id of ev.payload.attack.parts) {
            const w = ctx.state.pieces[id];
            if (w && isSecretSw(w)) reveal(ctx, w, 'fired');
          }
        },
      });
    for (const event of ['piece.moved', 'piece.tagged', 'piece.eliminated', 'piece.replaced', 'turn.phaseStarted']) r.on({ id: `ssr.secret-sw.sweep.${event}`, event, handler: (ctx) => sweep(ctx) });
  },
};
