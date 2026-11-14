import type { Action, Ctx, Piece, QueryEnv, RuleModule } from '@asl/engine';
import { isFixedWeapon, otherSide, personnelAt, statics, swHeldBy } from '../common/pieces';
import { locKey, type LocId } from '../common/location';
import { isVisibleTo } from './known';
import { PHASE_DECISION, askPhaseOwner } from '../common/turn';
import { FP, iftColumn, simpleDeclarations, type ApplyResultFn, type AttackResolvedFn, type FireAttackCtx, type FireDeclaration, type FireMode, type ResolveFireFn } from './fire';
import { P as MP, type FlushFn } from './morale';
import { T, actionIllegal, fireMarker, gun, inMelee, isGoodOrder, mmc, pieceOf, setTags, smc, sw } from './status';

export type FireAction = Action & { decl: FireDeclaration };

declare module '@asl/engine' {
  interface QueryCatalog {
    /** A DRM to a placed DC's attack on `target` beyond its TEM and the placer's CX (S70: -2 against a Cave). */
    'dc.drm': { ctx: { target: LocId }; value: number };
  }
}

/** Fire mode used by the phase owner's `fire` action in each fire phase. */
export const PHASE_FIRE_MODE: Record<string, FireMode> = { PFPh: 'prep', DFPh: 'final', AFPh: 'advancing' };

/** Whose fire phase it is: the DEFENDER's in the DFPh, otherwise the ATTACKER's. */
export const phaseOwner = (ctx: { state: { phase: string; attacker: string; sides: string[] } }) =>
  ctx.state.phase === 'DFPh' ? otherSide(ctx.state as never, ctx.state.attacker) : ctx.state.attacker;

/** Re-ask the phase owner after each attack, so every action answers a fresh decision. */
const reAsk = (ctx: Ctx) => {
  ctx.popDecision();
  askPhaseOwner(ctx, phaseOwner(ctx));
};

/** SW uses a unit has made this fire phase: held SW it has fired (marked) plus SW it destroyed. */
export function swUsedThisPhase(env: QueryEnv, holder: Piece): number {
  const fired = swHeldBy(env.state, holder.id).filter((s) => fireMarker(s) !== undefined).length;
  return fired + ((holder.tags[T.swDestroyed] as number | undefined) ?? 0);
}

/** Hexes holding enemy units (or Melee hexes) the side might fire at. */
export const FPP = {
  /** (ctx, dc) => void: a placed DC's attack in the AFPh. */
  resolveDc: 'sk1.firePhases.resolveDc',
} as const;
export type ResolveDcFn = (ctx: Ctx, dc: Piece) => void;

/** The Locations a side may fire at (ASLRB A2.8: hex ids at ground level): every one with a visible enemy unit or in Melee. */
export function fireTargets(env: QueryEnv, side: string): string[] {
  const enemy = otherSide(env.state, side);
  const hexes = new Set<string>();
  for (const p of Object.values(env.state.pieces)) {
    if (p.loc.kind !== 'hex') continue;
    const loc = locKey(p.loc);
    if ((p.side === enemy && isVisibleTo(env, p, side)) || inMelee(env, loc)) hexes.add(loc);
  }
  return [...hexes].sort();
}

export const firePhasesModule: RuleModule = {
  id: 'sk1.firePhases',
  ref: 'SK1 3.2.2, 3.4, 3.5',
  summary: 'Prep Fire, Defensive (Final) Fire and Advancing Fire phases.',
  requires: ['sk1.fire', 'common.turn'],
  install(r) {
    r.procedure<ResolveDcFn>(FPP.resolveDc, () => (ctx, dc) => resolveDcBase(ctx, dc));
    r.on<{ phase: string }>({
      id: 'sk1.firePhases.start',
      event: 'turn.phaseStarted',
      handler(ctx, ev) {
        if (ev.payload.phase === 'AFPh') resolvePlacedDcs(ctx);
        if (ev.payload.phase in PHASE_FIRE_MODE) askPhaseOwner(ctx, phaseOwner(ctx));
      },
    });

    r.action<FireAction>({
      type: 'fire',
      decisionKinds: [PHASE_DECISION],
      legal(env) {
        const mode = PHASE_FIRE_MODE[env.state.phase];
        if (!mode) return [];
        const side = phaseOwner(env);
        return simpleDeclarations(env, side, fireTargets(env, side), mode).map((decl) => ({ type: 'fire', decl }));
      },
      validate(env, a) {
        const mode = PHASE_FIRE_MODE[env.state.phase];
        if (!mode) return 'No fire attacks in this phase';
        return env.query('fire.illegal', { decl: a.decl, mode, side: a.side }, null);
      },
      resolve(ctx, a) {
        ctx.proc<ResolveFireFn>(FP.resolve)(ctx, a.decl, PHASE_FIRE_MODE[ctx.state.phase]!);
        if (!ctx.state.result) reAsk(ctx);
      },
    });

    // SK1 4.0: SW may be voluntarily destroyed by their possessing unit during the PFPh or DFPh;
    // doing so counts as use of a SW (the unit has "fired" a SW; a HS, or a squad on its second
    // SW use, forfeits its own FP; a leader forfeits his leadership DRM for the phase). Guns are
    // "destroyed as if a SW" (SK4 1.2.6), so a Gun its possessor holds (a captured one too) goes the same way.
    r.action<Action & { type: 'sw.destroy'; sw: string }>({
      type: 'sw.destroy',
      decisionKinds: [PHASE_DECISION],
      validate(env, a) {
        if (env.state.phase !== 'PFPh' && env.state.phase !== 'DFPh') return 'A SW or Gun can only be destroyed in the PFPh or DFPh';
        const s = env.state.pieces[a.sw];
        if (!s || !(sw(env, s) || gun(env, s)) || s.loc.kind !== 'held') return 'Not a possessed SW or Gun';
        if (isFixedWeapon(env, s)) return 'A vehicular MG is part of its vehicle';
        const holder = pieceOf(env, s.loc.by);
        if (holder.side !== phaseOwner(env) || s.side !== holder.side) return 'Not your unit';
        if (!isGoodOrder(env, holder)) return 'Only a Good Order unit may destroy a SW';
        const halted = actionIllegal(env, [holder.id]);
        if (halted) return halted;
        if (fireMarker(holder) && env.state.phase === 'PFPh') return 'Unit has already fired this phase';
        const used = swUsedThisPhase(env, holder);
        if (smc(env, holder) && used >= 1) return 'A SMC may use only one SW';
        if (mmc(env, holder)?.kind === 'hs' && used >= 1) return 'A half-squad may use only one SW';
        if (used >= 2) return 'A squad may use at most two SW';
        return null;
      },
      resolve(ctx, a) {
        const holder = pieceOf(ctx, (pieceOf(ctx, a.sw).loc as { by: string }).by);
        const used = swUsedThisPhase(ctx, holder) + 1;
        ctx.emit('piece.eliminated', { id: a.sw, reason: 'voluntarily destroyed' });
        const m = mmc(ctx, holder);
        setTags(ctx, holder.id, {
          [T.firedSw]: true,
          [T.firedSwAs]: ctx.state.phase === 'PFPh' ? 'prep' : 'first',
          [T.swDestroyed]: ((holder.tags[T.swDestroyed] as number | undefined) ?? 0) + 1,
          ...((m?.kind === 'hs' && used >= 1) || (m?.kind === 'squad' && used >= 2) ? { [T.ownFpForfeit]: true } : {}),
        });
        reAsk(ctx);
      },
    });

    // Marker cleanup (SK1 3.4, 3.5, 3.8).
    r.on<{ phase: string }>({
      id: 'sk1.firePhases.cleanup',
      event: 'turn.phaseEnded',
      handler(ctx, ev) {
        const clear = (pred: (p: Piece) => boolean, tags: Record<string, null>) => {
          for (const p of Object.values(ctx.state.pieces).filter(pred).sort((a, b) => (a.id < b.id ? -1 : 1))) {
            setTags(ctx, p.id, tags);
          }
        };
        switch (ev.payload.phase) {
          case 'PFPh':
          case 'MPh': {
            // A weapon that kept ROF stayed unmarked while it could fire again (SK1 1.2.4). After the PFPh it
            // has fired all the same: Prep Fire (no move, no CE change, no AFPh fire, SK1 3.5). After the MPh it
            // stays unmarked: only a unit or SW "that has fired and exhausted its ROF" takes a First Fire counter
            // (SK1 3.3.1, SK4 3.3.3), so it fires in the DFPh as if it had not fired. Bounding First Fire with ROF
            // kept may still fire in the AFPh (SK4 3.3.2.2), so a 'bff' record only comes off. In the PFPh a unit that fired only a SW is
            // marked with it (SK1 3.2.2 "the firing unit (and SW)"): its own FP was free this phase, not the
            // next (3.5: "units/MGs that did not fire in the PFPh may fire"). Defensive First Fire marks only
            // "any unit or SW that has fired" (SK1 3.3.1), so a DEFENDER whose MG alone fired keeps its own FP
            // for the DFPh (SK1 4.0: one SW "at no cost to its own FP").
            const want = ev.payload.phase === 'PFPh' ? 'prep' : 'first';
            const holderMarked = ev.payload.phase === 'PFPh';
            for (const p of Object.values(ctx.state.pieces).sort((a, b) => (a.id < b.id ? -1 : 1))) {
              const rof = p.tags[T.rofFired];
              const held = p.tags[T.firedSwAs];
              if (rof === undefined && (!holderMarked || held !== want)) continue;
              const tags: Record<string, string | null> = {};
              if (rof !== undefined) tags[T.rofFired] = null;
              if (!fireMarker(p) && holderMarked && (rof === want || held === want)) tags[T.fire] = want;
              setTags(ctx, p.id, tags);
            }
            break;
          }
          case 'DFPh':
            clear((p) => p.tags[T.rofFired] !== undefined, { [T.rofFired]: null });
            clear((p) => fireMarker(p) === 'first' || fireMarker(p) === 'final', { [T.fire]: null });
            clear((p) => p.side !== ctx.state.attacker && (p.tags[T.firedSw] === true || p.tags[T.swDestroyed] !== undefined), {
              [T.firedSw]: null,
              [T.firedSwAs]: null,
              [T.swDestroyed]: null,
            });
            break;
          case 'AFPh':
            clear((p) => p.tags[T.rofFired] !== undefined, { [T.rofFired]: null });
            // Bounding First Fire's marker (SK4 3.3.2.2) lasts through the AFPh like Prep and Advancing Fire's. Left on,
            // a vehicle that fired Bounding First Fire could not move or fire again for the rest of the game.
            clear((p) => fireMarker(p) === 'prep' || fireMarker(p) === 'adv' || fireMarker(p) === 'bff', { [T.fire]: null });
            clear((p) => p.side === ctx.state.attacker && (p.tags[T.firedSw] === true || p.tags[T.swDestroyed] !== undefined), {
              [T.firedSw]: null,
              [T.firedSwAs]: null,
              [T.swDestroyed]: null,
            });
            break;
          case 'CCPh':
            clear(
              (p) =>
                [T.pinned, T.pinnedThisTurn, T.ownFpForfeit, T.rallyTried, T.rphAction, T.moved, T.advancedInto].some(
                  (k) => p.tags[k] !== undefined,
                ),
              {
                [T.pinned]: null,
                [T.pinnedThisTurn]: null,
                [T.ownFpForfeit]: null,
                [T.rallyTried]: null,
                [T.rphAction]: null,
                [T.moved]: null,
                [T.advancedInto]: null,
              },
            );
            break;
        }
      },
    });
  },
};

/** SK1 4.3: operably placed DCs attack in the AFPh with 30 FP (TEM and placer CX apply; no leadership/cowering). */
function resolvePlacedDcs(ctx: Ctx) {
  const dcs = Object.values(ctx.state.pieces)
    .filter((p) => p.side === ctx.state.attacker && p.tags['dcPlaced'] === true && p.loc.kind === 'hex')
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const dc of dcs) ctx.proc<ResolveDcFn>(FPP.resolveDc)(ctx, dc);
}

/** One placed DC's attack on its Location (the vehicle rules wrap this for a DC placed against an AFV). */
export function resolveDcBase(ctx: Ctx, dc: Piece) {
  const hex = locKey(dc.loc as Extract<Piece['loc'], { kind: 'hex' }>);
  const placer = dc.tags['dcPlacer'] as string;
  const d = sw(ctx, dc)!;
  // X# as fixed when the DC was placed (non-elite -2, Inexperienced -1, captured -2; SK1 4.0, 4.3, 5.4, 5.5).
  const placerDef = ctx.state.pieces[placer] ? mmc(ctx, ctx.state.pieces[placer]!) : null;
  const x = (dc.tags['dcX'] as number | undefined) ?? (d.x ?? 12) - (placerDef && placerDef.quality !== 'E' ? 2 : 0);
  const targets = personnelAt(ctx, hex, otherSide(ctx.state, ctx.state.attacker)).map((p) => p.id).sort();
  const attack: FireAttackCtx = { mode: 'advancing', side: ctx.state.attacker, target: hex, parts: [], targets, hindrance: 0, residual: true };
  const drm = ctx.query('hex.tem', { hex }, 0) + (dc.tags['dcCx'] ? 1 : 0) + ctx.query('dc.drm', { target: hex }, 0);
  const roll = ctx.roll(`DC attack on ${hex}`);
  const column = iftColumn(ctx, d.fp);
  ctx.emit('sk1.fire.attack', {
    attack: { mode: 'advancing', target: hex, parts: [dc.id] },
    fp: d.fp,
    column,
    dr: roll.dice as [number, number],
    drm,
    cowered: false,
    explain: [{ id: 'sk1.dc', label: `DC ${d.fp} FP` }],
  });
  if (roll.total < x && column !== null && targets.length) {
    ctx.proc<ApplyResultFn>(FP.applyResult)(ctx, attack, column, roll.total + drm, {});
    ctx.proc<FlushFn>(MP.flushLeaderLoss)(ctx);
  }
  const detonated = roll.total < x && column !== null;
  ctx.proc<AttackResolvedFn>(FP.attackResolved)(ctx, { target: hex, by: 'dc', result: detonated ? statics(ctx).tables.ift(column!, roll.total + drm).kind : null, malfunctioned: !detonated });
  ctx.emit('piece.eliminated', { id: dc.id, reason: 'DC detonated' });
}
