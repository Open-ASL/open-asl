import type { Ctx, Decision, HexId, Piece, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { byId, hexOf, isPersonnelDef, defOf, otherSide, personnelAt, personnelInHex, statics } from '../common/pieces';
import { locOf } from '../common/location';
import { PHASE_DECISION, askPhaseOwner } from '../common/turn';
import type { VictoryCondition } from '../common/statics';
import type { FireAttackCtx } from '../sk1/fire';
import { SETUP_PLACED, achieved, isImmediate, setupGeography, type SetupAction, type SetupPlacedFn } from '../sk1/scenario';
import { phaseOwner } from '../sk1/firePhases';
import { T, fireMarker, gun, gunHeldBy, isGoodOrder, isPinned, mmc, pieceOf, setTags } from '../sk1/status';
import { hasFeature, terrainOf } from '../sk1/terrain';
import { SPINES, inCoveredArc, nearestSpine, spineChange } from './arc';
import { T2, caTurnedIllegal, coveredArc, firePhaseKey, gunHex, gunManner, gunsOf, isEmplaced, isHidden, ACQ_CLEAR } from './status';

/*
 * Guns (SK4 1.2.6, 6.0): the state a Gun carries beyond a SW's: its Covered Arc, Emplacement and
 * Hidden Initial Placement at setup, capture, and the victory conditions cards write about Guns.
 * Firing them is `sk2.ordnance`; moving them `sk2.manhandle`.
 */

declare module '@asl/engine' {
  interface QueryCatalog {
    /** Why a Gun may not change its Covered Arc now (without firing), or null. */
    'gun.canChangeCa': { ctx: { gun: PieceId }; value: string | null };
    /** Whether a Gun set up in `hex` may use Hidden Initial Placement (SK4 6.4). */
    'hip.allowed': { ctx: { gun: PieceId; hex: HexId }; value: boolean };
  }
}

export type ChangeCaAction = { type: 'gun.changeCa'; gun: PieceId; ca: number };

/** Who may fire now: the phase owner of a fire phase. */
const firePhase = (env: QueryEnv) => env.state.phase === 'PFPh' || env.state.phase === 'DFPh' || env.state.phase === 'AFPh';

/** Why a Gun cannot change its CA (SK4 3.2.4: only at the end of a friendly fire phase, if it could still fire normally). */
export function caChangeIllegal(env: QueryEnv, gunId: PieceId, side: SideId): string | null {
  const g = env.state.pieces[gunId];
  if (!g || !gun(env, g)) return 'Not a Gun';
  if (g.side !== side) return 'Not your Gun';
  if (!firePhase(env) || phaseOwner(env) !== side) return 'A Covered Arc can only be changed in your own fire phase';
  const manner = gunManner(env, g);
  if (!manner || !mmc(env, manner)) return 'The Gun is not manned';
  if (!isGoodOrder(env, manner) || isPinned(manner)) return 'A pinned or broken unit cannot change a Covered Arc';
  if (fireMarker(g) || g.tags[T2.intensive]) return 'The Gun has fired this phase';
  if (fireMarker(manner)) return 'The manning unit has fired its inherent FP';
  if (g.tags[T2.caLocked]) return 'The Covered Arc has already been changed this Player Turn';
  return null;
}

/** Emplacement TEM (SK4 6.3) a crew manning an emplaced Gun gets on top of the hex's own: the better of the two, never both. */
export function emplacementDrm(env: QueryEnv, unit: PieceId): number {
  const p = env.state.pieces[unit];
  if (!p || mmc(env, p)?.kind !== 'crew') return 0;
  const g = gunHeldBy(env, unit);
  if (!g || !isEmplaced(g)) return 0;
  const hex = hexOf(env.state, p);
  if (!hex) return 0;
  return Math.max(0, 2 - env.query('hex.tem', { hex }, 0));
}

/**
 * Gunshield (SK4 6.6): +2 to the IFT DR for the Good Order crew of an AT/INF Gun against attacks
 * through the Gun's Covered Arc (not while manhandling); never on top of other TEM, but on top of
 * TEM that went on an ordnance To Hit DR.
 */
export function gunshieldDrm(env: QueryEnv, unit: PieceId, attack: FireAttackCtx): number {
  const p = env.state.pieces[unit];
  if (!p || mmc(env, p)?.kind !== 'crew' || !isGoodOrder(env, p) || p.tags[T2.hazardous]) return 0;
  const g = gunHeldBy(env, unit);
  if (!g || !gun(env, g)!.gunshield) return 0;
  const map = statics(env).map;
  const hex = hexOf(env.state, p);
  if (!hex || attack.parts.length === 0) return 0;
  const through = attack.parts.every((part) => inCoveredArc(map.hex(hex)!.cube, coveredArc(g), map.hex(part.hex)!.cube));
  if (!through) return 0;
  if (attack.parts.some((part) => part.kind === 'sw' && defOf(env, pieceOf(env, part.piece)).kind === 'sw' && (defOf(env, pieceOf(env, part.piece)) as { type?: string }).type === 'FT')) return 0;
  if (attack.ordnance?.targetType === 'ITT') return 2;
  return Math.max(0, 2 - env.query('hex.tem', { hex }, 0) - emplacementDrm(env, unit));
}

/** The Emplacement TEM an ordnance To Hit DR takes against a hex holding an emplaced Gun's crew (SK4 6.3 example). */
export function emplacementThDrm(env: QueryEnv, hex: HexId, side: SideId): number {
  let best = 0;
  for (const p of personnelAt(env, hex, otherSide(env.state, side))) best = Math.max(best, emplacementDrm(env, p.id));
  return best;
}

/** The Guns a victory condition is about: `of`'s Guns of the listed defs (all its Guns by default), captured ones included. */
function victoryGuns(env: QueryEnv, vc: Extract<VictoryCondition, { kind: 'gunsEliminatedOrCaptured' | 'occupyGunHexes' }>) {
  // A captured Gun has changed side: find Guns by their counter nationality and original owner.
  const ownerNats = new Set(
    (statics(env).scenario.sides.find((s) => s.side === vc.of)?.nationalities ?? [statics(env).scenario.sides.find((s) => s.side === vc.of)?.nationality]).filter(Boolean),
  );
  return Object.values(env.state.pieces)
    .filter((p) => gun(env, p) && ownerNats.has(defOf(env, p).nationality) && (!vc.defs || vc.defs.includes(p.defId)))
    .sort(byId);
}

function gunVictory(env: QueryEnv, vc: VictoryCondition): boolean | null {
  if (vc.kind === 'gunsEliminatedOrCaptured') {
    const guns = victoryGuns(env, vc);
    if (guns.length === 0) return false;
    return guns.every((g) => g.loc.kind === 'eliminated' || (!vc.eliminatedOnly && g.side === vc.side));
  }
  if (vc.kind === 'occupyGunHexes') {
    const guns = victoryGuns(env, vc).filter((g) => g.loc.kind !== 'eliminated' && g.side !== vc.side);
    if (guns.length === 0) return false;
    return guns.every((g) => {
      const hex = gunHex(env, g);
      if (!hex) return false;
      // "Occupy the hex": any Location of it.
      return personnelInHex(env, hex, vc.side).length > 0 && personnelInHex(env, hex, vc.of).length === 0;
    });
  }
  return null;
}

/** End the game at once when an immediate Gun condition holds (SK S13: "win immediately"). */
function checkImmediateGunVictory(ctx: Ctx) {
  if (ctx.state.result) return;
  for (const vc of statics(ctx).scenario.victory) {
    if (!isImmediate(vc)) continue;
    const kinds = vc.kind === 'any' || vc.kind === 'all' ? vc.of.map((c) => c.kind) : [vc.kind];
    if (!kinds.some((k) => k === 'gunsEliminatedOrCaptured' || k === 'occupyGunHexes')) continue;
    if (achieved(ctx, vc)) {
      ctx.endGame({ winner: vc.side, reason: 'sudden death' });
      return;
    }
  }
}

/** Why a Gun may not set up in `hex`: only small target Guns and (not large) AT/INF Guns may set up in a building hex. */
/** Why a Gun may not set up in `hex` (SK4 6.3: only small-target, AT and INF Guns in a building hex), or null. */
export function gunBuildingIllegal(env: QueryEnv, g: Piece, hex: HexId): string | null {
  const d = gun(env, g)!;
  if (statics(env).map.hex(hex)?.buildingId && d.targetSize !== 'small' && !((d.type === 'AT' || d.type === 'INF') && d.targetSize !== 'large')) {
    return `${g.id}: only small target Guns and AT/INF Guns may set up in a building hex`;
  }
  return null;
}

export const gunsModule: RuleModule = {
  id: 'sk2.guns',
  ref: 'SK4 1.2.6, 3.2.4, 5.5, 6.3, 6.4, 6.7',
  summary: 'Guns: Covered Arc, Emplacement and HIP at setup, capture, Gun victory conditions.',
  requires: ['sk1.scenario', 'sk1.fire', 'sk1.firePhases'],
  install(r) {
    r.event<{ gun: PieceId; from: number | null; to: number; spines: number; reason: 'setup' | 'phase' | 'fire' | 'manhandle' }>({
      type: 'sk2.gun.ca',
      apply(d, p) {
        d.pieces[p.gun]!.tags[T2.ca] = p.to;
      },
    });
    r.event<{ gun: PieceId; by: PieceId; side: SideId }>({ type: 'sk2.gun.captured', apply() {} });
    r.event<{ gun: PieceId; reason: string }>({ type: 'sk2.gun.destroyed', apply() {} });

    // ------------------------------------------------------------ setup
    r.contribute({
      id: 'sk2.hip.allowed.base',
      query: 'hip.allowed',
      layer: 0,
      // An Emplaced Gun may always set up hidden unless on a paved road (SK4 6.4).
      apply: (_v, { hex }, env) => !hasFeature(env, hex, 'road:paved'),
    });
    // A Gun's default post faces the enemy's front and hides where the rules allow (SK4 6.4): what a player would do.
    r.contribute({
      id: 'sk2.setup.defaults.guns',
      query: 'setup.defaults',
      apply(v, { side, todo, placements }, env) {
        const guns: Record<PieceId, { ca: number; hip?: boolean }> = {};
        const map = statics(env).map;
        const { front } = setupGeography(env, side);
        for (const id of todo) {
          const hex = placements[id];
          if (!hex) continue;
          for (const g of gunsOf(env)) {
            if (g.loc.kind !== 'held' || g.loc.by !== id) continue;
            const at = map.hex(hex);
            const near = at && front.length ? front.map((f) => map.hex(f)).filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => map.distance(hex, a.id) - map.distance(hex, b.id))[0] : undefined;
            const ca = at && near ? (nearestSpine(at.cube, 0, near.cube) ?? 0) : 0;
            const hip = env.query('hip.allowed', { gun: g.id, hex }, false);
            guns[g.id] = { ca, ...(hip ? { hip: true } : {}) };
          }
        }
        return Object.keys(guns).length ? { ...v, guns } : v;
      },
    });
    // The default placement keeps a Gun that may not be in a building out of building hexes.
    r.contribute({
      id: 'sk2.setup.hexIllegal.guns',
      query: 'setup.hexIllegal',
      apply(v, { unit, hex }, env) {
        if (v) return v;
        for (const g of gunsOf(env)) if (g.loc.kind === 'held' && g.loc.by === unit) return gunBuildingIllegal(env, g, hex);
        return null;
      },
    });
    r.contribute({
      id: 'sk2.setup.illegal.guns',
      query: 'setup.illegal',
      apply(v, { todo, action }, env) {
        if (v) return v;
        const a = action as SetupAction;
        for (const id of todo) {
          const hex = a.placements[id];
          if (!hex) continue;
          const holder = pieceOf(env, id);
          for (const g of gunsOf(env)) {
            const by = a.sw?.[g.id] ?? (g.loc.kind === 'held' ? g.loc.by : null);
            if (by !== id) continue;
            if (!mmc(env, holder)) return `${g.id}: only a MMC may possess a Gun`;
            const inBuilding = gunBuildingIllegal(env, g, hex);
            if (inBuilding) return inBuilding;
            const spec = a.guns?.[g.id];
            if (!spec || !Number.isInteger(spec.ca) || spec.ca < 0 || spec.ca >= SPINES) return `${g.id} needs a Covered Arc (hexspine 0-5)`;
            if (spec.hip && !env.query('hip.allowed', { gun: g.id, hex }, false)) return `${g.id} may not use Hidden Initial Placement there`;
          }
        }
        return null;
      },
    });
    r.procedure<SetupPlacedFn>(SETUP_PLACED, (next) => (ctx, action, decision: Decision) => {
      next?.(ctx, action, decision);
      for (const [id, spec] of Object.entries(action.guns ?? {}).sort()) {
        const g = ctx.state.pieces[id];
        if (!g || !gun(ctx, g)) continue;
        const hex = gunHex(ctx, g);
        if (!hex) continue;
        ctx.emit('sk2.gun.ca', { gun: id, from: null, to: spec.ca, spines: 0, reason: 'setup' });
        // Emplaced unless set up on a paved road (SK4 6.3); HIP on the Gun and its manning unit (6.4).
        const tags: Record<string, true> = {};
        // Not on a paved road (SK4 6.3), nor in bamboo (SK4 8.2.1: a Gun may set up HIP in bamboo but cannot be Emplaced).
        if (!hasFeature(ctx, hex, 'road:paved') && terrainOf(ctx, hex).id !== 'bamboo') tags[T2.emplaced] = true;
        if (spec.hip) tags[T2.hip] = true;
        if (Object.keys(tags).length) setTags(ctx, id, tags);
        const manner = gunManner(ctx, g);
        if (spec.hip && manner) setTags(ctx, manner.id, { [T2.hip]: true });
      }
    });

    // ------------------------------------------------------------ emplacement
    r.contribute({
      id: 'sk2.drm.emplacement',
      query: 'fire.unitDrm',
      ref: 'SK4 6.3',
      label: ({ unit }, env) => `+${emplacementDrm(env, unit)} Emplacement TEM`,
      when: ({ unit }, env) => emplacementDrm(env, unit) > 0,
      apply: (v, { unit }, env) => v + emplacementDrm(env, unit),
    });
    // On the Infantry Target Type the TEM (Emplacement included) went on the To Hit DR.
    r.suppress<'fire.unitDrm'>({ id: 'sk2.drm.emplacement.itt', query: 'fire.unitDrm', target: 'sk2.drm.emplacement', ref: 'SK4 6.3', when: ({ attack }) => attack.ordnance?.targetType === 'ITT' });
    r.contribute({
      id: 'sk2.drm.gunshield',
      query: 'fire.unitDrm',
      ref: 'SK4 6.6',
      label: ({ unit, attack }, env) => `+${gunshieldDrm(env, unit, attack)} Gunshield`,
      when: ({ unit, attack }, env) => gunshieldDrm(env, unit, attack) > 0,
      apply: (v, { unit, attack }, env) => v + gunshieldDrm(env, unit, attack),
    });
    // A Gun interdicts (SK4 3.6) when its crew could hit the hex through the To Hit process at under 17
    // hexes (or by IFE within 16) without a positive DRM: in its Covered Arc, manned by a crew, unpinned. Having
    // fired this Player Turn does not stop it (SK1/SK4 3.6, "even if they have exhausted all other fire options").
    r.contribute({
      id: 'sk2.rout.gun-interdicts',
      query: 'rout.canInterdict',
      ref: 'SK4 3.6',
      when: ({ interdictor, hex }, env) => {
        const e = pieceOf(env, interdictor);
        const eh = hexOf(env.state, e);
        if (!eh || mmc(env, e)?.kind !== 'crew' || isPinned(e) || !isGoodOrder(env, e) || e.tags[T.cx]) return false;
        const g = gunHeldBy(env, interdictor);
        if (!g || g.tags[T.malf] || g.tags[T2.intensive]) return false;
        const map = statics(env).map;
        if (map.distance(eh, hex) > 16) return false;
        return inCoveredArc(map.hex(eh)!.cube, coveredArc(g), map.hex(hex)!.cube);
      },
      apply: () => true,
    });
    r.contribute({
      id: 'sk2.rout.emplaced',
      query: 'rout.exemptOpenGround',
      ref: 'SK4 3.6',
      when: ({ unit }, env) => {
        const g = gunHeldBy(env, unit);
        return !!g && isEmplaced(g) && mmc(env, pieceOf(env, unit))?.kind === 'crew';
      },
      apply: () => true,
    });

    // ------------------------------------------------------------ Covered Arc change without firing
    // The Gun's crew may not fire its inherent FP (or another SW) after the end-of-phase CA change either.
    r.contribute({
      id: 'sk2.fire.illegal.caTurned',
      query: 'fire.illegal',
      apply: (v, { decl }, env) => {
        if (v) return v;
        for (const id of [...decl.units, ...decl.sw]) {
          const p = env.state.pieces[id];
          const why = p ? caTurnedIllegal(env, p) : null;
          if (why) return why;
        }
        return null;
      },
    });
    r.contribute({
      id: 'sk2.gun.canChangeCa.base',
      query: 'gun.canChangeCa',
      layer: 0,
      apply: (_v, { gun: id }, env) => caChangeIllegal(env, id, env.state.pieces[id]?.side ?? ''),
    });
    r.action<ChangeCaAction & { side: SideId; decisionId: string }>({
      type: 'gun.changeCa',
      decisionKinds: [PHASE_DECISION],
      // Each Gun that may still turn (SK4 3.2.4), to each of the five other hexspines.
      legal(env, d) {
        const out: ChangeCaAction[] = [];
        for (const g of gunsOf(env).sort(byId)) {
          if (g.side !== d.owner || caChangeIllegal(env, g.id, d.owner)) continue;
          const from = coveredArc(g);
          for (let ca = 0; ca < SPINES; ca++) if (ca !== from) out.push({ type: 'gun.changeCa', gun: g.id, ca });
        }
        return out;
      },
      validate(env, a) {
        const why = caChangeIllegal(env, a.gun, a.side);
        if (why) return why;
        if (!Number.isInteger(a.ca) || a.ca < 0 || a.ca >= SPINES) return 'Covered Arc is a hexspine 0-5';
        if (coveredArc(pieceOf(env, a.gun)) === a.ca) return 'The Gun already faces that way';
        return null;
      },
      resolve(ctx, a) {
        const g = pieceOf(ctx, a.gun);
        const from = coveredArc(g);
        ctx.emit('sk2.gun.ca', { gun: a.gun, from, to: a.ca, spines: spineChange(from, a.ca), reason: 'phase' });
        // The Gun and its manning Infantry cannot move this Player Turn; acquisition is lost (SK4 3.2.4, 6.10). The change
        // comes "at the end of a friendly fire phase", so neither fires again this phase (`caTurned`).
        const phase = firePhaseKey(ctx);
        setTags(ctx, a.gun, { [T2.caLocked]: true, [T2.caTurned]: phase, ...ACQ_CLEAR });
        const manner = gunManner(ctx, g);
        if (manner) setTags(ctx, manner.id, { [T2.caLocked]: true, [T2.caTurned]: phase });
        if (isHidden(g)) revealGun(ctx, g.id, 'ca');
        ctx.popDecision();
        askPhaseOwner(ctx, phaseOwner(ctx));
      },
    });

    // ------------------------------------------------------------ capture (SK1 5.5): recovery by the enemy changes the owner
    r.on<{ id: PieceId; side: SideId }>({
      id: 'sk2.gun.capture',
      event: 'sk1.sw.owner',
      handler(ctx, ev) {
        const g = ctx.state.pieces[ev.payload.id];
        if (!g || !gun(ctx, g) || g.loc.kind !== 'held') return;
        ctx.emit('sk2.gun.captured', { gun: g.id, by: g.loc.by, side: ev.payload.side });
        checkImmediateGunVictory(ctx);
      },
    });

    // ------------------------------------------------------------ victory
    r.contribute({
      id: 'sk2.vc.guns',
      query: 'vc.achieved',
      apply: (v, { vc }, env) => v ?? gunVictory(env, vc),
    });
    for (const event of ['piece.eliminated', 'piece.moved', 'sk2.gun.destroyed']) {
      r.on({ id: `sk2.vc.immediate.${event}`, event, handler: (ctx) => checkImmediateGunVictory(ctx) });
    }

    // ------------------------------------------------------------ Player Turn cleanup
    r.on<{ phase: string }>({
      id: 'sk2.guns.cleanup',
      event: 'turn.phaseEnded',
      handler(ctx, ev) {
        if (ev.payload.phase !== 'CCPh') return;
        for (const p of Object.values(ctx.state.pieces).sort(byId)) {
          const keys = [T2.caLocked, T2.caTurned, T2.intensive, T2.manhandled, T2.hazardous].filter((k) => p.tags[k] !== undefined);
          if (keys.length) setTags(ctx, p.id, Object.fromEntries(keys.map((k) => [k, null])));
        }
      },
    });
  },
};

/**
 * Take a Gun (and its manning unit) out of Hidden Initial Placement. The HIP module wraps this
 * to report it; without it, the tags simply come off.
 */
export function revealGun(ctx: Ctx, gunId: PieceId, reason: string) {
  const g = ctx.state.pieces[gunId];
  if (!g || !isHidden(g)) return;
  ctx.proc<(c: Ctx, gun: PieceId, reason: string) => void>(REVEAL_GUN)(ctx, gunId, reason);
}
export const REVEAL_GUN = 'sk2.gun.reveal';

/** Base reveal: clear the HIP tags on the Gun and whatever unit mans it. */
export const revealBase: RuleModule = {
  id: 'sk2.guns.reveal',
  requires: ['sk2.guns'],
  install(r) {
    r.procedure<(c: Ctx, gun: PieceId, reason: string) => void>(REVEAL_GUN, () => (ctx, gunId) => {
      const g = pieceOf(ctx, gunId);
      setTags(ctx, gunId, { [T2.hip]: null });
      const manner = gunManner(ctx, g);
      if (manner && isHidden(manner)) setTags(ctx, manner.id, { [T2.hip]: null });
      // Anyone else in its Location who was hidden with it (the crew that dropped it) is revealed too.
      const loc = locOf(ctx.state, g);
      if (loc) for (const p of personnelAt(ctx, loc, g.side)) if (isHidden(p)) setTags(ctx, p.id, { [T2.hip]: null });
    });
  },
};

export const isPersonnel = (env: QueryEnv, id: PieceId) => isPersonnelDef(defOf(env, pieceOf(env, id)));
