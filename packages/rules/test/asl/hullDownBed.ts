import type { Action, Engine, GameState, RuleModule } from '@asl/engine';
import { aslCoreModules, fortCounters, piecesModule, turnModule, type FortPlacement, type HexTerrainSpec } from '../../src';
import { sk1CoreModules } from '../../src/sk1';
import { sk2CoreModules } from '../../src/sk2';
import { sk3CoreModules } from '../../src/sk3';
import { act, makeEngine, type PieceSpec } from '../fixtures';

/** Shared ground for the Hull Down tests: board u with L4 woods and P3 a level 1 hill hex with a two-level stone house. */
const SK: RuleModule[] = [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules];
const ASL: RuleModule[] = [...SK, ...aslCoreModules];
const GROUND: Record<string, HexTerrainSpec> = {
  uL4: { terrain: 'woods' },
  uP3: { terrain: 'building-stone', buildingId: 'u-B99', building: { upper: 1, stairwell: 'inherent' }, obstacleHeight: 1.5, elevation: 1 },
};

const testModule: RuleModule = {
  id: 'test.hullDown',
  install(r) {
    r.action<Action & { fortSide: string; counters: FortPlacement[] }>({
      type: 'test.fortPlace',
      decisionKinds: ['phase', 'firstFire'],
      resolve(ctx, a) {
        const n = fortCounters(ctx).length;
        ctx.emit('asl.fort.placed', { side: a.fortSide, counters: a.counters.map((c, i) => ({ ...c, id: `${a.fortSide}.fort${n + i + 1}`, side: a.fortSide })) });
      },
    });
    r.action<Action & { id: string; hex: string; level?: number; ent?: 'trench' }>({
      type: 'test.teleport',
      decisionKinds: ['phase', 'firstFire'],
      resolve(ctx, a) {
        ctx.emit('piece.moved', { id: a.id, loc: { kind: 'hex', hex: a.hex, ...(a.level ? { level: a.level } : {}), ...(a.ent ? { pos: { ent: a.ent } } : {}) } });
      },
    });
  },
};

export type Eng = Engine;
export const ev = (r: { events: { type: string; payload: unknown }[] }, type: string) => r.events.filter((e) => e.type === type).map((e) => e.payload as Record<string, unknown>);
export const far: PieceSpec[] = [
  { id: 'gfar', def: 'ge.467', side: 'ge', hex: 'uY10' },
  { id: 'rfar', def: 'ru.447', side: 'ru', hex: 'uA1' },
];
export const t34 = (hex = 'uN5'): PieceSpec => ({ id: 't34', def: 'ru.T34M43', side: 'ru', hex, tags: { vca: 0, ca: 0 } });
export const pz = (hex = 'uN9'): PieceSpec => ({ id: 'pz', def: 'ge.pzivf2', side: 'ge', hex, tags: { vca: 0, ca: 0 } });

/** The T-34 in `hex` (beneath the Russian trench there unless `onTop`), the German PzKpfw IVF2 in N9, German PFPh. */
export function bed(opts: { hex?: string; onTop?: boolean; noTrench?: boolean; dice?: number[]; pieces?: PieceSpec[]; phase?: string; first?: 'ge' | 'ru'; hidden?: boolean } = {}) {
  const hex = opts.hex ?? 'uN5';
  const scenario = {
    firstSide: opts.first ?? 'ge',
    sides: [
      { side: 'ge', name: 'German', nationality: 'ge', elr: 3 },
      { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 },
    ],
    forces: [],
  };
  const g = makeEngine({ board: 'u', terrain: GROUND, scenario, modules: ASL, extra: [testModule], pieces: [t34(hex), pz(), ...(opts.pieces ?? []), ...far], startPhase: opts.phase ?? 'PFPh', dice: opts.dice ?? [] });
  let s = g.state;
  // The tank goes beneath first, so no reveal sweep (A12.33) runs between the hidden counter's placement and the shot.
  if (!opts.noTrench && !opts.onTop) s = act(g.engine, s, { type: 'test.teleport', id: 't34', hex, ent: 'trench' }).state;
  if (!opts.noTrench) s = act(g.engine, s, { type: 'test.fortPlace', fortSide: 'ru', counters: [{ kind: 'trench', hex, hidden: !!opts.hidden }] }).state;
  return { engine: g.engine, state: s };
}
/** The PzKpfw IVF2's shot at the T-34 on the Vehicle Target Type, turning its turret if it must (the engine's own list). */
export function vttShot(engine: Eng, s: GameState, weapon = 'pz', target = 'uN5', targetType: 'VTT' | 'ATT' | 'ITT' = 'VTT') {
  const shot = engine.legalActions(s, engine.currentDecision(s)!.owner).find((a) => a.type === 'fire.ordnance' && (a['shot'] as { weapon: string; target: string; targetType: string }).weapon === weapon && (a['shot'] as { target: string }).target === target && (a['shot'] as { targetType: string }).targetType === targetType);
  if (!shot) throw new Error(`no ${targetType} shot by ${weapon} at ${target}`);
  return shot['shot'] as Record<string, unknown>;
}
