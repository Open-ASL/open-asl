import type { Action, Ctx, Decision, HexId, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { defOf, isVehicleDef, statics } from '../common/pieces';
import { hexOfLoc, isGroundLoc, levelOfLoc, locId, locationsOf, parseLoc, type LocId } from '../common/location';
import { storedControl } from './scenario';
import { mmc, pieceOf, smc } from './status';

declare module '@asl/engine' {
  interface QueryCatalog {
    /** Whether a hex is part of a fortified building (designated, revealed or not). */
    'hex.fortified': { ctx: { hex: HexId }; value: boolean };
    /**
     * Whether a piece just moved into `hex` has entered it for the reveal on entry. Full ASL: a unit going round the
     * obstacle in Bypass has not (ASLRB A4.3, A12.151). The Starter Kit has no Bypass: always.
     */
    'fortified.entered': { ctx: { piece: PieceId; hex: HexId }; value: boolean };
  }
}

/*
 * Fortified Building Locations (ASLRB B23.9, and the Starter Kit scenario special rules that introduce them).
 * Only a scenario that lists the `fortified-buildings` SSR has them: that side secretly pre-designates them in its
 * setup area before setting up. A fortified Location gives an additional +1 TEM to every attack against a unit
 * inside it that takes the building's TEM (small arms, a Placed DC, the To Hit DR of ordnance; a Critical Hit
 * reverses it too, B23.921). The designation is hidden from the other side until it makes a difference: an attack
 * whose result the +1 changes (the DRM is `secret`; the fire modules apply it but tell of it only then), or an
 * enemy unit entering it. Fire the +1 did not change is reported, and shown to the firer beforehand, without it.
 *
 * Two units of designation (`FortifiedParams.unit`):
 * - `building` (the Starter Kit cards: "pre-designate 2 buildings"): whole buildings, every Location of their hexes.
 * - `location` (B23.911: "the number of Fortified Building Locations is specified by SSR"): single Locations, an
 *   upper level only above a fortified ground level (B23.912). The entry restriction, Breach and the Gun rules of
 *   B23.922–B23.93 are the full ASL module `asl/fortified.ts`.
 */

export const FORTIFIED_MODULE = 'fortified-buildings';
export const FORTIFY_DECISION = 'fortify';
/** Id of the +1 TEM contribution; its presence in a fire event's `explain` is what reveals a building. */
export const FORTIFIED_DRM = 'ssr.fortified.drm';
/** The same +1 against a Placed DC's attack (`dc.drm`), on an ordnance To Hit DR vs the Infantry Target Type (`ordnance.thDrm`) and, reversed, on a Critical Hit's IFT DR. */
export const FORTIFIED_DC_DRM = 'ssr.fortified.dc';
export const FORTIFIED_TH_DRM = 'ssr.fortified.th';
export const FORTIFIED_CH_DRM = 'ssr.fortified.ch';
/** Every contribution id whose presence in an attack's reported `explain` reveals the building. */
export const FORTIFIED_REVEAL_IDS: readonly string[] = [FORTIFIED_DRM, FORTIFIED_DC_DRM, FORTIFIED_TH_DRM, FORTIFIED_CH_DRM];

export interface FortifiedParams {
  /** The side that fortifies. */
  side: SideId;
  /** How many buildings (or, with `unit: 'location'`, Locations) it may fortify. */
  count: number;
  /** What is designated: whole buildings (default, the Starter Kit cards) or single Locations (B23.911). */
  unit?: 'building' | 'location';
  /** Exactly `count` must be designated (B23.911 "the number ... is specified"), not up to it. */
  exact?: boolean;
  /** Where the buildings must be: within the side's setup area (any hex of the building in it). */
  within?: 'setup';
  /** Only these buildings may be chosen ("either P9 or O6"), by building id. */
  buildings?: string[];
  /** The designation is public (the card says which buildings may be fortified): revealed from the start. */
  open?: boolean;
  /** The fortifying side Controls the buildings at start (S16 SSR 2). */
  control?: boolean;
}

const EXT = 'sk1.fortified';

export interface FortifiedState {
  side: SideId;
  /** Building ids designated as fortified (every Location of their hexes; with `locations`, the buildings those are in). */
  buildings: string[];
  /** Those the other side has been shown. */
  revealed: string[];
  /** Fortified Locations, when the designation is by Location (B23.911); absent in a building-wide designation. */
  locations?: LocId[];
  /** The fortified Locations the other side has been shown. */
  revealedLocs?: LocId[];
}

export type FortifyAction = Action & { buildings?: string[]; locations?: LocId[] };

/** Whether the scenario designates fortified Locations one by one (B23.911) rather than whole buildings. */
export const fortifiesLocations = (env: QueryEnv): boolean => fortifiedParams(env)?.unit === 'location';

/** The ground Location of a building hex and, with an upper level, that level: the Locations a hex offers to fortify. */
export function fortifiableLocations(env: QueryEnv, side: SideId): LocId[] {
  const out: LocId[] = [];
  const map = statics(env).map;
  for (const b of fortifiableBuildings(env, side)) {
    for (const h of map.hexes()) {
      if (h.buildingId !== b) continue;
      // A rooftop may not be fortified (B23.81); none exists on these boards.
      for (const loc of locationsOf(env, h.id)) if (!parseLoc(loc).sub) out.push(loc);
    }
  }
  return out.sort();
}

export function fortifiedParams(env: QueryEnv): FortifiedParams | null {
  const s = statics(env).scenario.ssr.find((r) => r.module === FORTIFIED_MODULE);
  return s ? (s.params as unknown as FortifiedParams) : null;
}

export const fortifiedState = (env: QueryEnv): FortifiedState | null => (env.state.ext[EXT] as FortifiedState | undefined) ?? null;

/** Buildings a side may fortify: the card's list, else every building with a hex in the side's at-start setup area. */
export function fortifiableBuildings(env: QueryEnv, side: SideId): string[] {
  const sc = statics(env).scenario;
  const map = statics(env).map;
  const p = fortifiedParams(env);
  if (p?.side === side && p.buildings) return [...p.buildings].sort();
  const area = new Set<HexId>();
  for (const f of sc.forces) {
    if (f.side !== side || f.setup.kind === 'enter' || f.setup.kind === 'scatter') continue;
    for (const h of f.setup.hexes) {
      const hex = map.hex(h);
      if (hex) area.add(hex.id);
    }
  }
  const out = new Set<string>();
  for (const h of map.hexes()) if (h.buildingId && area.has(h.id)) out.add(h.buildingId);
  return [...out].sort();
}

/**
 * The fortified building a Location is part of, if that Location is fortified (designated, revealed or not). A hex
 * id is its ground Location. With a building-wide designation every Location of the building's hexes is fortified;
 * with one by Location (B23.911) only the designated Locations are.
 */
export function fortifiedBuildingOf(env: QueryEnv, loc: HexId | LocId): string | null {
  const b = statics(env).map.hex(hexOfLoc(loc))?.buildingId;
  const st = fortifiedState(env);
  if (!b || !st) return null;
  if (st.locations) return st.locations.includes(loc) ? b : null;
  return st.buildings.includes(b) ? b : null;
}

export const isFortified = (env: QueryEnv, loc: HexId | LocId): boolean => fortifiedBuildingOf(env, loc) !== null;

/** Whether a fortified Location (or its building, in a building-wide designation) has been shown to the other side. */
export function fortifiedRevealed(env: QueryEnv, loc: HexId | LocId): boolean {
  const st = fortifiedState(env);
  if (!st) return false;
  if (st.locations) return (st.revealedLocs ?? []).includes(loc);
  const b = fortifiedBuildingOf(env, loc);
  return !!b && st.revealed.includes(b);
}

/**
 * Whether a viewer may know a Location (a hex: its ground Location) is fortified: the fortifying side's own online
 * screen always, anyone once it has been revealed. A `null` viewer (a hotseat game's shared screen, a spectator)
 * sees only what has been revealed, so neither hotseat player is shown the choice once it is made.
 */
export function fortifiedKnownTo(env: QueryEnv, loc: HexId | LocId, viewer: SideId | null): boolean {
  if (!isFortified(env, loc)) return false;
  return viewer === fortifiedState(env)!.side || fortifiedRevealed(env, loc);
}

/** Why a designation is illegal, or null: whole buildings (a plain list), or Locations with `unit: 'location'` (B23.911, B23.912). */
export function fortifyIllegal(env: QueryEnv, side: SideId, picks: string[] | { buildings?: string[]; locations?: LocId[] }): string | null {
  const a = Array.isArray(picks) ? { buildings: picks } : picks;
  const p = fortifiedParams(env);
  if (!p || p.side !== side) return 'This side does not fortify buildings';
  if (p.unit === 'location') {
    const locs = a.locations ?? [];
    if (a.buildings?.length) return 'This scenario fortifies Locations, not whole buildings';
    if (locs.length > p.count) return `At most ${p.count} Location${p.count === 1 ? '' : 's'} may be fortified`;
    if (p.exact && locs.length < p.count) return `Choose ${p.count} Location${p.count === 1 ? '' : 's'} to fortify`;
    if (new Set(locs).size !== locs.length) return 'A Location can only be fortified once';
    const allowed = fortifiableLocations(env, side);
    for (const loc of locs) {
      if (!allowed.includes(loc)) return `${loc} is not a building Location in your setup area`;
      // Improvements are made from the ground up: an upper level only above a fortified ground level (B23.912).
      const { hex, level } = parseLoc(loc);
      if (level > 0 && !locs.includes(locId(hex, level - 1))) return `${loc}: fortify the level below first (ASLRB B23.912)`;
    }
    return null;
  }
  const buildings = a.buildings ?? [];
  if (a.locations?.length) return 'This scenario fortifies whole buildings';
  if (buildings.length > p.count) return `At most ${p.count} building${p.count === 1 ? '' : 's'} may be fortified`;
  if (p.buildings && buildings.length < Math.min(p.count, p.buildings.length)) return p.count === 1 ? 'Choose the building to fortify' : `Choose ${p.count} buildings to fortify`;
  if (new Set(buildings).size !== buildings.length) return 'A building can only be fortified once';
  const allowed = fortifiableBuildings(env, side);
  for (const b of buildings) if (!allowed.includes(b)) return `${b} is not a building in your setup area`;
  return null;
}

/** Reveal a fortified Location (by Location, B23.911) or its whole building (a building-wide designation) to the other side. */
export function revealFortified(ctx: Ctx, loc: HexId | LocId, reason: 'fire' | 'entered' | 'attempt') {
  const st = fortifiedState(ctx);
  const building = fortifiedBuildingOf(ctx, loc);
  if (!st || !building || fortifiedRevealed(ctx, loc)) return;
  ctx.emit('sk1.fortified.revealed', { building, hex: hexOfLoc(loc), reason, ...(st.locations ? { loc } : {}) });
}

export const fortifiedModule: RuleModule = {
  id: 'ssr.fortified-buildings',
  ref: 'ASL B23.9; SK S3 SSR 1',
  summary: 'Fortified buildings (SSR): secretly pre-designated buildings with +1 TEM, revealed when it matters.',
  requires: ['sk1.scenario', 'sk1.fire'],
  install(r) {
    r.event<{ state: FortifiedState }>({
      type: 'sk1.fortified',
      apply(d, p) {
        d.ext[EXT] = p.state;
      },
    });
    // What the other side (or a spectator) may see of the designation: only the buildings (Locations) already revealed.
    const shown = (st: FortifiedState, viewer: SideId | null): FortifiedState =>
      viewer === st.side ? st : { ...st, buildings: [...st.revealed], ...(st.locations ? { locations: [...(st.revealedLocs ?? [])] } : {}) };
    r.redact({
      id: 'sk1.fortified.redact',
      ext: EXT,
      redactExt: (slice, viewer) => shown(slice as FortifiedState, viewer),
      events: ['sk1.fortified'],
      redactEvent: (ev, viewer) => ({ ...ev, payload: { state: shown((ev.payload as { state: FortifiedState }).state, viewer) } }),
    });
    // A fortified Location that no longer exists as a building Location (full ASL: rubbled, ASLRB B24.5; rubble from a
    // Fortified Building gets no +1, B24.3). Emitted by the rubble rules; nothing in the Starter Kit ever does.
    r.event<{ loc: LocId }>({
      type: 'sk1.fortified.removed',
      apply(d, p) {
        const st = d.ext[EXT] as FortifiedState | undefined;
        if (!st?.locations?.includes(p.loc)) return;
        st.locations = st.locations.filter((l) => l !== p.loc);
        if (st.revealedLocs) st.revealedLocs = st.revealedLocs.filter((l) => l !== p.loc);
      },
    });
    r.event<{ building: string; hex: HexId; reason: 'fire' | 'entered' | 'attempt'; loc?: LocId }>({
      type: 'sk1.fortified.revealed',
      apply(d, p) {
        const st = d.ext[EXT] as FortifiedState | undefined;
        if (!st) return;
        if (p.loc !== undefined && st.locations) {
          // By Location: the Location itself joins the shown list; its building is shown as such only once every one of its
          // fortified Locations is (`revealed` keeps its building-wide meaning for the Starter Kit cards).
          if (!(st.revealedLocs ??= []).includes(p.loc)) st.revealedLocs.push(p.loc);
          const hexes = new Set<string>();
          for (const l of st.locations) if (st.revealedLocs.includes(l)) hexes.add(l);
          if (st.locations.every((l) => hexes.has(l)) && !st.revealed.includes(p.building)) st.revealed.push(p.building);
          return;
        }
        if (!st.revealed.includes(p.building)) st.revealed.push(p.building);
      },
    });

    // The designation is asked for before the fortifying side sets up (it is a pre-designation);
    // this hook runs after the scenario's own setup hook, so the decision sits on top of the stack.
    r.setup({
      id: 'ssr.fortified.ask',
      priority: 10,
      run(ctx) {
        const p = fortifiedParams(ctx);
        if (!p || p.count <= 0) return;
        ctx.emit('sk1.fortified', { state: { side: p.side, buildings: [], revealed: [], ...(p.unit === 'location' ? { locations: [], revealedLocs: [] } : {}) } });
        ctx.pushDecision({ kind: FORTIFY_DECISION, owner: p.side, deadlineClass: 'turn', data: { count: p.count, ...(p.unit === 'location' ? { unit: 'location', exact: !!p.exact } : {}) } });
      },
    });

    r.action<FortifyAction>({
      type: 'fortify.designate',
      decisionKinds: [FORTIFY_DECISION],
      legal(env, d) {
        const p = fortifiedParams(env);
        if (!p) return [];
        if (p.unit === 'location') {
          // Ground Locations first, so the first `count` of them respect B23.912 (an upper level needs its ground).
          const all = fortifiableLocations(env, d.owner);
          const picks: LocId[] = [];
          for (const loc of all) if (picks.length < p.count && isGroundLoc(loc)) picks.push(loc);
          for (const loc of all) if (picks.length < p.count && !isGroundLoc(loc) && picks.includes(locId(parseLoc(loc).hex, levelOfLoc(loc) - 1))) picks.push(loc);
          return [{ type: 'fortify.designate', locations: picks }];
        }
        const all = fortifiableBuildings(env, d.owner);
        return [{ type: 'fortify.designate', buildings: all.slice(0, p.count) }];
      },
      validate: (env, a, d) => fortifyIllegal(env, d.owner, a),
      resolve(ctx, a, d: Decision) {
        const st = fortifiedState(ctx)!;
        const p = fortifiedParams(ctx)!;
        const map = statics(ctx).map;
        const locations = p.unit === 'location' ? [...(a.locations ?? [])].sort() : undefined;
        const buildings = locations ? [...new Set(locations.map((l) => map.hex(hexOfLoc(l))!.buildingId!))].sort() : [...(a.buildings ?? [])].sort();
        ctx.emit('sk1.fortified', {
          state: { ...st, buildings, revealed: p.open ? [...buildings] : st.revealed, ...(locations ? { locations, revealedLocs: p.open ? [...locations] : st.revealedLocs ?? [] } : {}) },
        });
        if (p.control && buildings.length) {
          // "The Free French control this building at start": Control before anyone has set up.
          const prev = storedControl(ctx);
          const next = { hexes: { ...prev.hexes }, buildings: { ...prev.buildings } };
          for (const b of buildings) {
            next.buildings[b] = st.side;
            for (const h of statics(ctx).map.hexes()) if (h.buildingId === b) next.hexes[h.id] = st.side;
          }
          ctx.emit('sk1.control', { state: next });
        }
        ctx.popDecision(d.id);
        if (ctx.state.decisions.length === 0) ctx.proc<(c: Ctx) => void>('sk1.scenario.begin')(ctx);
      },
    });

    // Whether any Location of the hex is fortified (the computer opponent and setup constraints ask by hex).
    r.contribute({
      id: 'ssr.fortified.hex',
      query: 'hex.fortified',
      layer: 0,
      apply: (_v, { hex }, env) => (fortifiedState(env)?.locations ? locationsOf(env, hex).some((l) => isFortified(env, l)) : isFortified(env, hex)),
    });

    // +1 TEM on top of the building's own, for fire attacks that use TEM (a FT ignores it). Secret
    // until revealed: the fire module leaves it out of what it reports unless it changed a result.
    r.contribute({
      id: FORTIFIED_DRM,
      query: 'fire.drm',
      ref: 'B23.9',
      label: '+1 Fortified Building',
      when: ({ attack }, env) => isFortified(env, attack.target) && !attack.parts.some((p) => p.kind === 'sw' && isFt(env, p.piece)),
      secret: ({ attack }, env) => !fortifiedRevealed(env, attack.target),
      apply: (v) => v + 1,
    });

    // The same +1 against a Placed DC (the card: "an additional +1 to the regular building TEM"; ASLRB B23.921
    // "including vs DC Breach attempt"; SK1 4.3 a DC attack takes the TEM). Secret in the same way: the DC attack
    // discloses it only when it changes a result.
    r.contribute({
      id: FORTIFIED_DC_DRM,
      query: 'dc.drm',
      ref: 'B23.921',
      label: '+1 Fortified Building',
      when: ({ target }, env) => isFortified(env, target),
      secret: ({ target }, env) => !fortifiedRevealed(env, target),
      apply: (v) => v + 1,
    });
    // Ordnance takes the TEM on its To Hit DR against the Infantry and Vehicle Target Types (SK4 3.2.4 case 17; ASLRB
    // C3.5 case 17, C6.8), so the +1 goes there too; the ordnance module tells of it only when it changes the hit or the Critical Hit.
    r.contribute({
      id: FORTIFIED_TH_DRM,
      query: 'ordnance.thDrm',
      ref: 'B23.921',
      label: '+1 Fortified Building',
      when: (sc, env) => (sc.shot.targetType === 'ITT' || sc.shot.targetType === 'VTT') && isFortified(env, sc.shot.target),
      secret: (sc, env) => !fortifiedRevealed(env, sc.shot.target),
      apply: (v) => v + 1,
    });
    // A Critical Hit reverses the TEM, the fortification's +1 included: -4 for stone, -3 for wood (B23.921; SK4 6.1
    // reverses the TEM). The ordnance module reverses the building's own TEM; this is the extra -1.
    r.contribute({
      id: FORTIFIED_CH_DRM,
      query: 'fire.drm',
      ref: 'B23.921',
      label: '-1 Critical Hit: Fortified Building TEM reversed',
      when: ({ attack }, env) => !!attack.ordnance?.ch && !attack.ordnance.airBurst && isFortified(env, attack.target),
      secret: ({ attack }, env) => !fortifiedRevealed(env, attack.target),
      apply: (v) => v - 1,
    });

    // Revealed by a fire attack (small arms, a DC, an ordnance hit) whose reported DRM carries the +1: the fire
    // modules only put it there when it made a difference to the attack (or the building is known already)...
    r.on<{ attack: { target: HexId }; explain: { id: string }[] }>({
      id: 'ssr.fortified.reveal.fire',
      event: 'sk1.fire.attack',
      handler(ctx, ev) {
        if (!ev.payload.explain.some((n) => FORTIFIED_REVEAL_IDS.includes(n.id))) return;
        revealFortified(ctx, ev.payload.attack.target, 'fire');
      },
    });
    // ...or by an ordnance To Hit DR whose reported DRM carries it (a hit or a Critical Hit the +1 decided)...
    r.on<{ target: LocId; explain: { id: string }[] }>({
      id: 'ssr.fortified.reveal.th',
      event: 'sk2.ordnance.shot',
      handler(ctx, ev) {
        if (!ev.payload.explain.some((n) => n.id === FORTIFIED_TH_DRM)) return;
        revealFortified(ctx, ev.payload.target, 'fire');
      },
    });
    // ...or by an enemy unit entering any hex of it (a building-wide designation: the card says "when an American unit
    // enters it"), or that fortified Location itself (by Location, B23.911: "an enemy unit", a vehicle too).
    r.on<{ id: PieceId; loc: { kind: string; hex?: HexId; level?: number; sub?: string } }>({
      id: 'ssr.fortified.reveal.entered',
      event: 'piece.moved',
      handler(ctx, ev) {
        const { loc } = ev.payload;
        if (loc.kind !== 'hex' || !loc.hex) return;
        const p = ctx.state.pieces[ev.payload.id];
        const st = fortifiedState(ctx);
        if (!p || !st || p.side === st.side) return;
        if (!ctx.query('fortified.entered', { piece: p.id, hex: loc.hex }, true)) return;
        if (st.locations) {
          if (!(mmc(ctx, p) || smc(ctx, p) || isVehicleDef(defOf(ctx, p)))) return;
          const at = loc.sub ? `${loc.hex}:${loc.sub}` : locId(loc.hex, loc.level ?? 0);
          revealFortified(ctx, at, 'entered');
          return;
        }
        if (!(mmc(ctx, p) || smc(ctx, p))) return;
        const b = fortifiedBuildingOf(ctx, loc.hex);
        if (b) revealFortified(ctx, loc.hex, 'entered');
      },
    });
  },
};

const isFt = (env: QueryEnv, id: PieceId) => {
  const d = defOf(env, pieceOf(env, id));
  return d.kind === 'sw' && d.type === 'FT';
};
