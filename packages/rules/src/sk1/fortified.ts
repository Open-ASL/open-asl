import type { Action, Ctx, Decision, HexId, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { defOf, statics } from '../common/pieces';
import { hexOfLoc, type LocId } from '../common/location';
import { controlState } from './scenario';
import { mmc, pieceOf, smc } from './status';

declare module '@asl/engine' {
  interface QueryCatalog {
    /** Whether a hex is part of a fortified building (designated, revealed or not). */
    'hex.fortified': { ctx: { hex: HexId }; value: boolean };
  }
}

/*
 * Fortified Building Locations (ASL B23.9, and the SK scenario special rule that introduces them,
 * e.g. S3 SSR 1). Only a scenario that lists the `fortified-buildings` SSR has them: that side
 * secretly pre-designates up to `count` buildings in its setup area before setting up. A fortified
 * building gives an additional +1 TEM to every fire attack against a unit inside it. The
 * designation is hidden from the other side until it makes a difference: a fire attack against a
 * unit in the building whose IFT result the +1 changes (the DRM is `secret` to the fire module,
 * which applies it but tells of it only then), or an enemy unit entering it. Fire the +1 did not
 * change is reported, and shown to the firer beforehand, without it.
 *
 * Not yet implemented from B23.9: the MPh entry restriction and the CC effects of full ASL.
 */

export const FORTIFIED_MODULE = 'fortified-buildings';
export const FORTIFY_DECISION = 'fortify';
/** Id of the +1 TEM contribution; its presence in a fire event's `explain` is what reveals a building. */
export const FORTIFIED_DRM = 'ssr.fortified.drm';

export interface FortifiedParams {
  /** The side that fortifies. */
  side: SideId;
  /** How many buildings it may fortify. */
  count: number;
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
  /** Building ids designated as fortified. */
  buildings: string[];
  /** Those the other side has been shown. */
  revealed: string[];
}

export type FortifyAction = Action & { buildings: string[] };

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

/** The fortified building a hex is part of, if any (designated, revealed or not). */
export function fortifiedBuildingOf(env: QueryEnv, hex: HexId | LocId): string | null {
  // Every Location of a fortified building's hexes is fortified, upper levels included. INTERIM RULE for full ASL:
  // B23.911 fortifies building *Locations* by count; TODO: per-Location
  // designation and the upper-level rules of B23.9.
  const b = statics(env).map.hex(hexOfLoc(hex))?.buildingId;
  const st = fortifiedState(env);
  return b && st?.buildings.includes(b) ? b : null;
}

export const isFortified = (env: QueryEnv, hex: HexId): boolean => fortifiedBuildingOf(env, hex) !== null;

/**
 * Whether a viewer may know a hex's building is fortified: the fortifying side's own online
 * screen always, anyone once it has been revealed. A `null` viewer (a hotseat game's shared
 * screen, a spectator) sees only what has been revealed, so neither hotseat player is shown the
 * choice once it is made.
 */
export function fortifiedKnownTo(env: QueryEnv, hex: HexId, viewer: SideId | null): boolean {
  const b = fortifiedBuildingOf(env, hex);
  if (!b) return false;
  const st = fortifiedState(env)!;
  return viewer === st.side || st.revealed.includes(b);
}

/** Why a designation is illegal, or null. */
export function fortifyIllegal(env: QueryEnv, side: SideId, buildings: string[]): string | null {
  const p = fortifiedParams(env);
  if (!p || p.side !== side) return 'This side does not fortify buildings';
  if (buildings.length > p.count) return `At most ${p.count} building${p.count === 1 ? '' : 's'} may be fortified`;
  if (p.buildings && buildings.length < Math.min(p.count, p.buildings.length)) return p.count === 1 ? 'Choose the building to fortify' : `Choose ${p.count} buildings to fortify`;
  if (new Set(buildings).size !== buildings.length) return 'A building can only be fortified once';
  const allowed = fortifiableBuildings(env, side);
  for (const b of buildings) if (!allowed.includes(b)) return `${b} is not a building in your setup area`;
  return null;
}

function reveal(ctx: Ctx, building: string, hex: HexId, reason: 'fire' | 'entered') {
  const st = fortifiedState(ctx);
  if (!st || st.revealed.includes(building)) return;
  ctx.emit('sk1.fortified.revealed', { building, hex, reason });
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
    // What the other side (or a spectator) may see of the designation: only the buildings already revealed.
    const shown = (st: FortifiedState, viewer: SideId | null): FortifiedState => (viewer === st.side ? st : { ...st, buildings: [...st.revealed] });
    r.redact({
      id: 'sk1.fortified.redact',
      ext: EXT,
      redactExt: (slice, viewer) => shown(slice as FortifiedState, viewer),
      events: ['sk1.fortified'],
      redactEvent: (ev, viewer) => ({ ...ev, payload: { state: shown((ev.payload as { state: FortifiedState }).state, viewer) } }),
    });
    r.event<{ building: string; hex: HexId; reason: 'fire' | 'entered' }>({
      type: 'sk1.fortified.revealed',
      apply(d, p) {
        const st = d.ext[EXT] as FortifiedState | undefined;
        if (st && !st.revealed.includes(p.building)) st.revealed.push(p.building);
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
        ctx.emit('sk1.fortified', { state: { side: p.side, buildings: [], revealed: [] } });
        ctx.pushDecision({ kind: FORTIFY_DECISION, owner: p.side, deadlineClass: 'turn', data: { count: p.count } });
      },
    });

    r.action<FortifyAction>({
      type: 'fortify.designate',
      decisionKinds: [FORTIFY_DECISION],
      legal(env, d) {
        const p = fortifiedParams(env);
        if (!p) return [];
        const all = fortifiableBuildings(env, d.owner);
        return [{ type: 'fortify.designate', buildings: all.slice(0, p.count) }];
      },
      validate: (env, a, d) => fortifyIllegal(env, d.owner, a.buildings),
      resolve(ctx, a, d: Decision) {
        const st = fortifiedState(ctx)!;
        const p = fortifiedParams(ctx)!;
        const buildings = [...a.buildings].sort();
        ctx.emit('sk1.fortified', { state: { ...st, buildings, revealed: p.open ? [...buildings] : st.revealed } });
        if (p.control && buildings.length) {
          // "The Free French control this building at start": Control before anyone has set up.
          const prev = controlState(ctx);
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

    r.contribute({
      id: 'ssr.fortified.hex',
      query: 'hex.fortified',
      layer: 0,
      apply: (_v, { hex }, env) => isFortified(env, hex),
    });

    // +1 TEM on top of the building's own, for fire attacks that use TEM (a FT ignores it). Secret
    // until revealed: the fire module leaves it out of what it reports unless it changed a result.
    r.contribute({
      id: FORTIFIED_DRM,
      query: 'fire.drm',
      ref: 'B23.9',
      label: '+1 Fortified Building',
      when: ({ attack }, env) => isFortified(env, attack.target) && !attack.parts.some((p) => p.kind === 'sw' && isFt(env, p.piece)),
      secret: ({ attack }, env) => !fortifiedState(env)!.revealed.includes(fortifiedBuildingOf(env, attack.target)!),
      apply: (v) => v + 1,
    });

    // Revealed by a fire attack whose reported DRM carries the +1: the fire module only puts it
    // there when it made a difference to the attack (or the building is known already)...
    r.on<{ attack: { target: HexId }; explain: { id: string }[] }>({
      id: 'ssr.fortified.reveal.fire',
      event: 'sk1.fire.attack',
      handler(ctx, ev) {
        if (!ev.payload.explain.some((n) => n.id === FORTIFIED_DRM)) return;
        const b = fortifiedBuildingOf(ctx, ev.payload.attack.target);
        if (b) reveal(ctx, b, hexOfLoc(ev.payload.attack.target), 'fire');
      },
    });
    // ...or by an enemy unit entering any hex of it.
    r.on<{ id: PieceId; loc: { kind: string; hex?: HexId } }>({
      id: 'ssr.fortified.reveal.entered',
      event: 'piece.moved',
      handler(ctx, ev) {
        const { loc } = ev.payload;
        if (loc.kind !== 'hex' || !loc.hex) return;
        const p = ctx.state.pieces[ev.payload.id];
        const st = fortifiedState(ctx);
        if (!p || !st || p.side === st.side || !(mmc(ctx, p) || smc(ctx, p))) return;
        const b = fortifiedBuildingOf(ctx, loc.hex);
        if (b) reveal(ctx, b, loc.hex, 'entered');
      },
    });
  },
};

const isFt = (env: QueryEnv, id: PieceId) => {
  const d = defOf(env, pieceOf(env, id));
  return d.kind === 'sw' && d.type === 'FT';
};
