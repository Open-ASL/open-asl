import { describe, expect, it } from 'vitest';
import type { Action, Ctx, Engine, GameState, PieceId, RuleModule } from '@asl/engine';
import { OP, STRAY_HIT_EVENT, aslCoreModules, firerPenalty, panzerfaustModule, piecesModule, shotContext, simplePfShots, simpleShots, toHitNumber, turnModule, type FireMode, type HitInfo, type ResolveHitFn, type StrayHitEvent } from '../../src';
import { sk1CoreModules } from '../../src/sk1';
import { sk2CoreModules } from '../../src/sk2';
import { sk3CoreModules } from '../../src/sk3';
import { RU_VS_GE, act, makeEngine, type PieceSpec } from '../fixtures';

/*
 * Vehicles and overstacking (ASLRB A5.2, A5.11, A5.12, A5.132). Board y, open ground. The Russians move first.
 */

const SK: RuleModule[] = [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules];
const ASL: RuleModule[] = [...SK, ...aslCoreModules];

/** Test action: resolve a German VTT shot at `target` that missed by `by` (the A5.132 check comes after a miss). */
const testModule: RuleModule = {
  id: 'test.stray',
  install(r) {
    r.action<Action & { target: string; vehicle: string; by: number; targetType?: 'VTT' | 'ITT'; mode?: FireMode }>({
      type: 'test.miss',
      decisionKinds: ['phase', 'firstFire'],
      resolve(ctx: Ctx, a) {
        const sc = shotContext(ctx, { weapon: 'g', target: a.target, targetType: a.targetType ?? 'VTT', ...(a.targetType === 'ITT' ? {} : { targetUnit: a.vehicle }) }, a.mode ?? 'prep', 'ge');
        const th = toHitNumber(ctx, sc)!.th;
        const hit: HitInfo = { hit: false, ch: false, dice: [3, 3], original: th + a.by, drm: 0, mode: a.mode ?? 'prep' };
        ctx.proc<ResolveHitFn>(OP.resolveHit)(ctx, sc, hit, [a.vehicle], {});
      },
    });
  },
};

const tank = (id: string, hex: string, def = 'ru.T34M43', tags: Record<string, string | number | boolean> = {}): PieceSpec => ({ id, def, side: 'ru', hex, tags: { vca: 0, ca: 0, ...tags } });
const gun: PieceSpec[] = [{ id: 'gc', def: 'ge.228c', side: 'ge', hex: 'yM8' }, { id: 'g', def: 'ge.AT75L', side: 'ge', heldBy: 'gc', tags: { ca: 0 } }];

function game(pieces: PieceSpec[], opts: { asl?: boolean; dice?: number[]; startPhase?: string } = {}) {
  return makeEngine({ pieces, scenario: RU_VS_GE, modules: opts.asl === false ? SK : ASL, extra: [testModule], startPhase: opts.startPhase ?? 'MPh', dice: opts.dice ?? [] });
}
const strays = (events: { type: string; payload: unknown }[]) => events.filter((e) => e.type === STRAY_HIT_EVENT).map((e) => e.payload as StrayHitEvent);
const killed = (events: { type: string; payload: unknown }[]) => events.filter((e) => e.type === 'sk3.toKill').map((e) => (e.payload as { target: PieceId }).target);
const playTo = (engine: Engine, s0: GameState, until: (s: GameState) => boolean) => {
  let s = s0;
  for (let i = 0; i < 400 && !until(s); i++) {
    const d = engine.currentDecision(s)!;
    const legal = engine.legalActions(s, d.owner);
    const a = legal.find((x) => x.type === 'defPass') ?? legal.find((x) => x.type === 'vmove.end') ?? legal.find((x) => x.type === 'move.end') ?? legal.find((x) => x.type === 'endPhase') ?? legal[0]!;
    s = act(engine, s, a).state;
  }
  return s;
};

describe('A5.2: friendly vehicles may share a Location', () => {
  it('two vehicles left in one hex do not block the end of the MPh in full ASL (no wreck flip); the Starter Kit blocks it (SK4 3.3.2)', () => {
    const pieces = [tank('a', 'yM5', 'ru.T34M43', { immob: true }), tank('b', 'yM5', 'ru.T34M43', { immob: true })];
    const { engine, state } = game(pieces);
    expect(engine.legalActions(state, 'ru').some((a) => a.type === 'endPhase')).toBe(true);
    expect(engine.legalActions(state, 'ru').some((a) => a.type === 'vmove.wreck')).toBe(false);
    const sk = game(pieces, { asl: false });
    expect(sk.engine.legalActions(sk.state, 'ru').some((a) => a.type === 'vmove.wreck')).toBe(true);
  });

  it('a vehicle pays one MP per excess squad-equivalent of Personnel in the hex it enters (A5.11)', () => {
    const squads = Array.from({ length: 4 }, (_, i): PieceSpec => ({ id: `s${i}`, def: 'ru.447', side: 'ru', hex: 'yM4' }));
    const { engine, state } = game([tank('a', 'yM5'), ...squads]);
    expect(engine.env(state).query('vehicle.extraMp', { vehicle: 'a', hex: 'yM4' }, 0)).toBe(1);
    expect(engine.env(state).query('vehicle.extraMp', { vehicle: 'a', hex: 'yM6' }, 0)).toBe(0);
  });

  it('a second vehicle in the firer\'s Location is +1 to its attacks, an Infantry unit\'s there included (A5.12)', () => {
    const { engine, state } = game([tank('a', 'yM5'), tank('b', 'yM5'), { id: 's', def: 'ru.447', side: 'ru', hex: 'yM5' }]);
    expect(firerPenalty(engine.env(state), 'yM5', 'ru')).toBe(1);
  });

  it('across turns: two vehicles end the MPh together, then next Player Turn one moves away and the penalty is gone', () => {
    const { engine, state } = game([tank('a', 'yM5'), tank('b', 'yM5'), { id: 'x', def: 'ge.467', side: 'ge', hex: 'yA10' }]);
    let s = playTo(engine, state, (x) => x.phase === 'PFPh');
    expect(s.pieces['b']!.loc).toMatchObject({ hex: 'yM5' });
    s = playTo(engine, s, (x) => x.turn === 2 && x.attacker === 'ru' && x.phase === 'MPh');
    s = act(engine, s, { type: 'vmove.start', vehicle: 'b' }).state;
    while (engine.currentDecision(s)?.owner === 'ge') s = act(engine, s, { type: 'defPass' }).state;
    const step = engine.legalActions(s, 'ru').find((a) => a.type === 'move.step')!;
    s = act(engine, s, step).state;
    expect(s.pieces['b']!.loc).not.toMatchObject({ hex: 'yM5' });
    expect(firerPenalty(engine.env(s), 'yM5', 'ru')).toBe(0);
  });
});

describe('A5.132: a Vehicle Target Type miss may hit another vehicle', () => {
  // A T-34 M43 (the target), a T-34 M41 and a KV-2 (Very Large: +2 to its Random Selection dr) in yM4.
  const three = [tank('a', 'yM4'), tank('b', 'yM4', 'ru.T34M41'), tank('c', 'yM4', 'ru.KV2')];

  it('the EX: missing by one or two with three vehicles there, a dr < 3 hits one of the others (Random Selection by size)', () => {
    // dr 2 < 3; the T-34 M41 rolls 6, the KV-2 1 + 2 = 3: the T-34 M41 is hit, and its To Kill follows.
    const { engine, state } = game([...gun, ...three], { startPhase: 'PFPh', dice: [2, 6, 1, 3, 3, 3, 3] });
    const r = act(engine, state, { type: 'test.miss', target: 'yM4', vehicle: 'a', by: 2 });
    expect(strays(r.events)).toEqual([{ weapon: 'g', firer: 'gc', target: 'a', by: 2, vehicles: 3, dr: 2, hit: 'b' }]);
    expect(killed(r.events)).toEqual(['b']);
    // The KV-2's +2 wins a tie of the natural dr.
    const t = game([...gun, ...three], { startPhase: 'PFPh', dice: [1, 4, 4, 3, 3, 3, 3] });
    expect(strays(act(t.engine, t.state, { type: 'test.miss', target: 'yM4', vehicle: 'a', by: 1 }).events)[0]!.hit).toBe('c');
  });

  it('a dr of 3 or more hits nothing; a miss by three is no hit at all, with no dr', () => {
    const { engine, state } = game([...gun, ...three], { startPhase: 'PFPh', dice: [3] });
    const r = act(engine, state, { type: 'test.miss', target: 'yM4', vehicle: 'a', by: 1 });
    expect(strays(r.events)).toEqual([{ weapon: 'g', firer: 'gc', target: 'a', by: 1, vehicles: 3, dr: 3, hit: null }]);
    expect(killed(r.events)).toEqual([]);
    const far = game([...gun, ...three], { startPhase: 'PFPh' });
    expect(strays(act(far.engine, far.state, { type: 'test.miss', target: 'yM4', vehicle: 'a', by: 3 }).events)).toEqual([]);
  });

  it('a vehicle in the next hex is never counted (Q&A to A5: separate road hexes); a non-moving vehicle may be hit in Defensive First Fire', () => {
    const pieces = [...gun, tank('a', 'yM4'), tank('b', 'yM4', 'ru.T34M41'), tank('c', 'yM5', 'ru.KV2')];
    const { engine, state } = game(pieces, { startPhase: 'PFPh', dice: [1, 3, 3, 3, 3] });
    const r = act(engine, state, { type: 'test.miss', target: 'yM4', vehicle: 'a', by: 1, mode: 'first' });
    expect(strays(r.events)).toEqual([{ weapon: 'g', firer: 'gc', target: 'a', by: 1, vehicles: 2, dr: 1, hit: 'b' }]);
    const two = game(pieces, { startPhase: 'PFPh' });
    expect(strays(act(two.engine, two.state, { type: 'test.miss', target: 'yM4', vehicle: 'a', by: 2 }).events)).toEqual([]);
  });

  it('never on the Infantry Target Type (C3.32 EX); never in the Starter Kit', () => {
    const { engine, state } = game([...gun, ...three, { id: 's', def: 'ru.447', side: 'ru', hex: 'yM4' }], { startPhase: 'PFPh' });
    expect(strays(act(engine, state, { type: 'test.miss', target: 'yM4', vehicle: 's', by: 1, targetType: 'ITT' }).events)).toEqual([]);
    const sk = game([...gun, ...three], { asl: false, startPhase: 'PFPh' });
    expect(strays(act(sk.engine, sk.state, { type: 'test.miss', target: 'yM4', vehicle: 'a', by: 1 }).events)).toEqual([]);
  });

  it('the firer names which of several enemy vehicles in a hex it shoots at; the Starter Kit takes the one there', () => {
    const { engine, state } = game([...gun, ...three], { startPhase: 'PFPh' });
    const named = simpleShots(engine.env(state), 'ge', ['yM4'], 'prep').filter((s) => s.targetType === 'VTT' && !s.ammo && !s.intensive);
    expect(named.map((s) => s.targetUnit).sort()).toEqual(['a', 'b', 'c']);
    // A shot that names none is refused: the firer picks the vehicle, never the first of them by id.
    const unnamed = { ...named[0]!, targetUnit: undefined };
    expect(engine.env(state).query('ordnance.illegal', { shot: unnamed, mode: 'prep', side: 'ge' }, null)).toMatch(/name the one/);
    expect(engine.env(state).query('ordnance.illegal', { shot: named[0]!, mode: 'prep', side: 'ge' }, null)).toBeNull();
    const sk = game([...gun, tank('a', 'yM4')], { asl: false, startPhase: 'PFPh' });
    expect(simpleShots(sk.engine.env(sk.state), 'ge', ['yM4'], 'prep').filter((s) => s.targetType === 'VTT').every((s) => s.targetUnit === undefined)).toBe(true);
  });
});

describe('A5.2: a Panzerfaust names its vehicle among several', () => {
  const pfScenario = {
    firstSide: 'ge',
    date: '10 October 1944',
    month: 10,
    sides: [
      { side: 'ge', name: 'German', nationality: 'ge', elr: 3 },
      { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 },
    ],
    forces: [
      { id: 'ge', group: 'G', side: 'ge', units: [{ def: 'ge.467', count: 1 }], setup: { kind: 'area' as const, description: '', hexes: [] } },
      { id: 'ru', group: 'R', side: 'ru', units: [{ def: 'ru.T34M43', count: 2 }], setup: { kind: 'area' as const, description: '', hexes: [] } },
    ],
  };
  it('one PF try per enemy vehicle in the hex (full ASL); the Starter Kit names none', () => {
    const pieces = [{ id: 's', def: 'ge.467', side: 'ge', hex: 'yK5' }, tank('a', 'yK6'), tank('b', 'yK6')];
    const asl = makeEngine({ scenario: pfScenario, modules: [...ASL, panzerfaustModule], startPhase: 'PFPh', pieces });
    expect(simplePfShots(asl.engine.env(asl.state), 'ge', 'prep', ['yK6']).filter((p) => p.targetType === 'VTT').map((p) => p.targetUnit).sort()).toEqual(['a', 'b']);
    const sk = makeEngine({ scenario: pfScenario, modules: [...SK, panzerfaustModule], startPhase: 'PFPh', pieces });
    expect(simplePfShots(sk.engine.env(sk.state), 'ge', 'prep', ['yK6']).filter((p) => p.targetType === 'VTT').map((p) => p.targetUnit)).toEqual([undefined]);
  });
});
