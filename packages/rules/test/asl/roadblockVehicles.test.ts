import { describe, expect, it } from 'vitest';
import type { Action, Engine, GameState, RuleModule } from '@asl/engine';
import { aslCoreModules, fortCounters, hasWa, hullDownToFirer, hullDownToLoc, piecesModule, sideToward, statics, turnModule, waClaimIllegal, waIneligible, type FortPlacement, type HexTerrainSpec } from '../../src';
import { sk1CoreModules } from '../../src/sk1';
import { sk2CoreModules } from '../../src/sk2';
import { sk3CoreModules } from '../../src/sk3';
import { act, makeEngine, type PieceSpec } from '../fixtures';

/*
 * Vehicles behind a roadblock (ASLRB B9.32, B9.321, B9.323, B9.36, D4.21, B29.3): Wall Advantage for a vehicle and the
 * Hull Down status it gives against Direct Fire ordnance across the wall. The ground is a stretch of board u, Open Ground
 * except where named; the roadblock stands on the uN5–uN6 hexside (N5 north of N6), both road hexes.
 */

const SK: RuleModule[] = [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules];
const ASL: RuleModule[] = [...SK, ...aslCoreModules];
const GROUND: Record<string, HexTerrainSpec> = {
  uN5: { terrain: 'open', features: ['road:dirt'] },
  uN6: { terrain: 'open', features: ['road:dirt'] },
};

const testModule: RuleModule = {
  id: 'test.roadblockVehicles',
  install(r) {
    r.action<Action & { fortSide: string; counters: FortPlacement[] }>({
      type: 'test.fortPlace',
      decisionKinds: ['phase', 'firstFire'],
      resolve(ctx, a) {
        const n = fortCounters(ctx).length;
        ctx.emit('asl.fort.placed', { side: a.fortSide, counters: a.counters.map((c, i) => ({ ...c, id: `${a.fortSide}.fort${n + i + 1}`, side: a.fortSide })) });
      },
    });
    r.action<Action & { id: string; tags: Record<string, unknown> }>({
      type: 'test.tag',
      decisionKinds: ['phase'],
      resolve(ctx, a) {
        ctx.emit('piece.tagged', { id: a.id, tags: a.tags as Record<string, never> });
      },
    });
  },
};

type Eng = Engine;
const ev = (r: { events: { type: string; payload: unknown }[] }, type: string) => r.events.filter((e) => e.type === type).map((e) => e.payload as Record<string, unknown>);
const far: PieceSpec[] = [
  { id: 'gfar', def: 'ge.467', side: 'ge', hex: 'uGG1' },
  { id: 'rfar', def: 'ru.447', side: 'ru', hex: 'uA10' },
];
const pz = (hex = 'uN6'): PieceSpec => ({ id: 'pz', def: 'ge.pzivf2', side: 'ge', hex, tags: { vca: 0, ca: 0 } });
const t34 = (hex = 'uN6'): PieceSpec => ({ id: 't34', def: 'ru.T34M43', side: 'ru', hex, tags: { vca: 0, ca: 0 } });
/** A German 75L AT Gun and its crew in `hex`. */
const atGun = (hex: string): PieceSpec[] => [{ id: 'crew', def: 'ge.228c', side: 'ge', hex }, { id: 'at', def: 'ge.AT75L', side: 'ge', heldBy: 'crew', tags: { ca: 0 } }];

/** The roadblock on N5–N6 with `pieces`, the WA sweep run once (as after any move or phase start). */
function bed(pieces: PieceSpec[], opts: { dice?: number[]; phase?: string; first?: 'ge' | 'ru'; terrain?: Record<string, HexTerrainSpec> } = {}) {
  const scenario = {
    firstSide: opts.first ?? 'ru',
    sides: [
      { side: 'ge', name: 'German', nationality: 'ge', elr: 3 },
      { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 },
    ],
    forces: [],
  };
  const g = makeEngine({ board: 'u', terrain: { ...GROUND, ...opts.terrain }, roadHexsides: [['uN5', 'uN6']], scenario, modules: ASL, extra: [testModule], pieces: [...pieces, ...far], startPhase: opts.phase ?? 'PFPh', dice: opts.dice ?? [] });
  const rb: FortPlacement = { kind: 'roadblock', hex: 'uN5', hidden: false, hexside: sideToward(statics(g.engine.env(g.state)).map, 'uN5', 'uN6')! };
  let s = act(g.engine, g.state, { type: 'test.fortPlace', fortSide: 'ru', counters: [rb] }).state;
  s = act(g.engine, s, { type: 'test.tag', id: 'gfar', tags: {} }).state;
  return { engine: g.engine, state: s };
}
/** The engine's own shot by `weapon` at `target` on `targetType`, turning the Gun if it must. */
function shotOf(engine: Eng, s: GameState, weapon: string, target: string, targetType = 'VTT') {
  const a = engine.legalActions(s, engine.currentDecision(s)!.owner).find((x) => x.type === 'fire.ordnance' && (x['shot'] as Record<string, unknown>)['weapon'] === weapon && (x['shot'] as Record<string, unknown>)['target'] === target && (x['shot'] as Record<string, unknown>)['targetType'] === targetType);
  if (!a) throw new Error(`no ${targetType} shot by ${weapon} at ${target}`);
  return a['shot'] as Record<string, unknown>;
}

describe('B9.32, B9.323: Wall Advantage for a vehicle', () => {
  it('a PzKpfw IVF2 stopped in Open Ground behind the roadblock claims WA (mandatory: no in-hex TEM)', () => {
    const { engine, state } = bed([pz(), ...atGun('uN3')]);
    expect(hasWa(engine.env(state), state.pieces['pz']!)).toBe(true);
  });

  it('a vehicle in a hex with an in-hex TEM of +1 or more may not claim it, with the reason', () => {
    const { engine, state } = bed([pz(), ...atGun('uN3')], { terrain: { uN6: { terrain: 'woods' } } });
    const env = engine.env(state);
    expect(hasWa(env, state.pieces['pz']!)).toBe(false);
    expect(waIneligible(env, state.pieces['pz']!)).toMatch(/In-hex TEM of \+1 or more: no WA for a vehicle \(ASLRB B9.32\)/);
    expect(waClaimIllegal(env, state.pieces['pz']!)).toMatch(/no WA for a vehicle/);
  });

  it('opposing vehicles never both hold WA over the shared hexside: the ATTACKER claims first, the other is denied (B9.321)', () => {
    const { engine, state } = bed([pz('uN6'), { id: 't34', def: 'ru.T34M43', side: 'ru', hex: 'uN5', tags: { vca: 3, ca: 3 } }], { first: 'ru' });
    const env = engine.env(state);
    expect(hasWa(env, state.pieces['t34']!)).toBe(true);
    expect(hasWa(env, state.pieces['pz']!)).toBe(false);
    expect(waClaimIllegal(env, state.pieces['pz']!)).toMatch(/Denied: the enemy across uN5 claims WA over the shared hexside \(ASLRB B9.321\)/);
  });
});

describe('B9.36, D4.21: HD to Direct Fire ordnance through the roadblock', () => {
  it('the T-34 with WA is HD to the AT Gun across the roadblock: a hull hit misses; from beside it, the same hit is resolved', () => {
    const across = bed([t34(), ...atGun('uN3')], { first: 'ge', dice: [2, 3, 6, 6] });
    expect(hullDownToFirer(across.engine.env(across.state), 't34', 'crew')).toMatchObject({ kind: 'wall', tem: 2 });
    const r = act(across.engine, across.state, { type: 'fire.ordnance', shot: shotOf(across.engine, across.state, 'at', 'uN6') });
    expect(ev(r, 'asl.hd.hullHit')[0]).toMatchObject({ target: 't34', kind: 'wall' });
    expect(ev(r, 'sk3.toKill')).toHaveLength(0);
    const beside = bed([t34(), ...atGun('uN9')], { first: 'ge', dice: [2, 3, 6, 6] });
    expect(hullDownToFirer(beside.engine.env(beside.state), 't34', 'crew')).toBeNull();
    const r2 = act(beside.engine, beside.state, { type: 'fire.ordnance', shot: shotOf(beside.engine, beside.state, 'at', 'uN6') });
    expect(ev(r2, 'sk3.toKill')[0]).toMatchObject({ target: 't34', location: 'hull' });
  });

  it('in the woods beside the roadblock (no WA) it takes the woods TEM, or HD against a firer without WA, as its owner chooses', () => {
    const { engine, state } = bed([t34(), ...atGun('uN3')], { first: 'ge', terrain: { uN6: { terrain: 'woods' } }, dice: [2, 3, 6, 6] });
    expect(hullDownToFirer(engine.env(state), 't34', 'crew')).toMatchObject({ kind: 'wall' });
    const r = act(engine, state, { type: 'fire.ordnance', shot: shotOf(engine, state, 'at', 'uN6') });
    expect(engine.currentDecision(r.state)).toMatchObject({ kind: 'hdChoice', owner: 'ru', data: { vehicle: 't34', kind: 'wall', tem: 1 } });
    const hd = act(engine, r.state, { type: 'hd.choose', choice: 'hd' });
    expect(ev(hd, 'asl.hd.hullHit')).toHaveLength(1);
  });

  it('a firer holding WA over the hexside leaves the vehicle without it no wall TEM, so no HD (B9.31)', () => {
    // The Russian tank sits in the woods of N6 (no WA for it), a German squad with WA in N5 beside an AT Gun there.
    const { engine, state } = bed([t34(), { id: 'sq', def: 'ge.467', side: 'ge', hex: 'uN5' }, ...atGun('uN5')], { first: 'ge', terrain: { uN6: { terrain: 'woods' } } });
    const env = engine.env(state);
    expect(hasWa(env, state.pieces['crew']!)).toBe(true);
    expect(hullDownToFirer(env, 't34', 'crew')).toBeNull();
  });

  it('B9.33: a firer\'s elevation advantage beyond the range cuts the wall TEM: at +1 HD stays (the colored dr one less for the Location of Hit), at 0 it is negated', () => {
    // The Gun in N4, two hexes from the tank in N6, on a hill three levels up: 3 - 2 = one level of advantage beyond the range.
    const up = (elevation: number) => bed([t34(), ...atGun('uN4')], { first: 'ge', terrain: { uN4: { terrain: 'open', elevation } } });
    const one = up(3);
    expect(hullDownToFirer(one.engine.env(one.state), 't34', 'crew')).toMatchObject({ kind: 'wall', tem: 1 });
    const env = one.engine.env(one.state);
    expect(env.query('vehicle.hitLocation', { vehicle: 't34', dice: [3, 3], ch: false, from: 'uN4' }, 'hull')).toBe('turret');
    const two = up(4);
    expect(hullDownToFirer(two.engine.env(two.state), 't34', 'crew')).toBeNull();
  });
});

describe('B9.36 across Player Turns (B9.41)', () => {
  it('the IVF2 holds WA through the Russian turn, starts and leaves in its next MPh: its WA goes and it is HD to nothing in its new hex', () => {
    const { engine, state } = bed([pz(), { id: 'r', def: 'ru.447', side: 'ru', hex: 'uN3' }], { first: 'ru', dice: Array(60).fill(4) });
    let s = state;
    const advanceTo = (phase: string, attacker: string, turn: number) => {
      for (let i = 0; i < 800 && !(s.turn === turn && s.phase === phase && s.attacker === attacker && engine.currentDecision(s)?.kind === 'phase'); i++) {
        const d = engine.currentDecision(s)!;
        const legal = engine.legalActions(s, d.owner);
        const a = legal.find((x) => x.type === 'defPass') ?? legal.find((x) => x.type === 'hd.choose') ?? legal.find((x) => x.type === 'move.end' || x.type === 'vmove.end') ?? legal.find((x) => x.type === 'endPhase') ?? legal.find((x) => x.type === 'wa.done') ?? legal[0]!;
        s = act(engine, s, a).state;
      }
      expect(s).toMatchObject({ turn, phase, attacker });
    };
    expect(hullDownToLoc(engine.env(s), 'pz', 'uN3')).toMatchObject({ kind: 'wall' });
    advanceTo('MPh', 'ge', 1);
    expect(hasWa(engine.env(s), s.pieces['pz']!)).toBe(true);
    expect(hullDownToLoc(engine.env(s), 'pz', 'uN3')).toMatchObject({ kind: 'wall' });
    s = act(engine, s, { type: 'vmove.start', vehicle: 'pz' }).state;
    while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
    const to = engine.legalActions(s, 'ge').find((a) => a.type === 'move.step' && a['to'] !== 'uN5')!['to'] as string;
    s = act(engine, s, { type: 'move.step', to }).state;
    expect(s.pieces['pz']!.loc).toMatchObject({ hex: to });
    expect(s.pieces['pz']!.tags['wa']).toBeUndefined();
    expect(hullDownToLoc(engine.env(s), 'pz', 'uN3')).toBeNull();
  });
});
