import { describe, expect, it } from 'vitest';
import type { Engine, GameState, RuleModule } from '@asl/engine';
import { TAG_LIFECYCLE, aslCoreModules, piecesModule, routEscorts, turnModule, type HexTerrainSpec } from '../../src';
import { planRout } from '../../src/sk1/rout';
import { sk1CoreModules } from '../../src/sk1';
import { sk2CoreModules } from '../../src/sk2';
import { sk3CoreModules } from '../../src/sk3';
import { act, makeEngine, type PieceSpec } from '../fixtures';

/*
 * Voluntary Rout (ASLRB A10.711) and the leader's own portage (A4.42): "The leader, if already in possession of a SW, may
 * portage it, but cannot improve the broken unit's portage capacity"; a SMC has an IPC of one PP, loses one MF for each
 * PP beyond it, and may never portage more than two; "He must remain with the broken unit throughout the RtPh". The
 * broken Russian squad b stands in Open Ground in uO5; the only woods is `woods` (everything else Open Ground).
 */

const SK: RuleModule[] = [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules];
const ASL: RuleModule[] = [...SK, ...aslCoreModules];

function game(leaderSw: number, woods: string, modules = ASL) {
  const terrain: Record<string, HexTerrainSpec> = { [woods]: { terrain: 'woods' } };
  const pieces: PieceSpec[] = [
    { id: 'b', def: 'ru.447', side: 'ru', hex: 'uO5', tags: { broken: true, dm: true } },
    { id: 'l', def: 'ru.L91', side: 'ru', hex: 'uO5' },
    ...Array.from({ length: leaderSw }, (_, i): PieceSpec => ({ id: `lmg${i + 1}`, def: 'ru.LMG', side: 'ru', heldBy: 'l' })),
    { id: 'gfar', def: 'ge.467', side: 'ge', hex: 'uGG1' },
    { id: 'rfar', def: 'ru.447', side: 'ru', hex: 'uA1' },
  ];
  const scenario = { firstSide: 'ru', sides: [{ side: 'ge', name: 'German', nationality: 'ge', elr: 3 }, { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 }], forces: [] };
  return makeEngine({ board: 'u', terrain, scenario, modules, pieces, startPhase: 'RtPh' });
}
const check = (engine: Engine, s: GameState, a: Record<string, unknown>) => engine.validate(s, { side: 'ru', decisionId: engine.currentDecision(s)!.id, ...a } as never);
const firstSteps = (engine: Engine, s: GameState) => engine.legalActions(s, 'ru').filter((a) => a.type === 'rout.step' && a['unit'] === 'b' && !a['lowCrawl']);
/** Route b (and whoever routs with it) on to the end of its rout, `leaders` named on the first step. */
function routAll(engine: Engine, s: GameState, leaders: string[]): GameState {
  const [first] = firstSteps(engine, s);
  s = act(engine, s, { ...first!, leaders } as never).state;
  for (let i = 0; i < 12; i++) {
    const next = engine.legalActions(s, 'ru').find((a) => a.type === 'rout.step' && a['unit'] === 'b');
    const stop = engine.legalActions(s, 'ru').find((a) => a.type === 'rout.stop' && a['unit'] === 'b');
    if (stop) return act(engine, s, stop).state;
    if (!next) return s;
    s = act(engine, s, next).state;
  }
  return s;
}

describe('A leader routing voluntarily portages his own SW (A10.711, A4.42)', () => {
  it('two PP: he may rout with the unit, on one MF less; where the shelter needs all six MF the two may not rout together and the unit routs alone', () => {
    // J5 is the nearest woods, six MF away: four Open Ground hexes and the woods.
    const { engine, state } = game(2, 'uJ5');
    const env = engine.env(state);
    expect(planRout(env, 'b').cost.get('uJ5')).toBe(6);
    expect(env.query('rout.escortMf', { leader: 'l' }, null)).toBe(5);
    expect(routEscorts(env, 'b')).toEqual(['l']);
    const [first] = firstSteps(engine, state);
    expect(check(engine, state, { ...first!, leaders: ['l'] })).toMatch(/nearest/);
    expect(check(engine, state, { ...first! })).toBeNull();
    const alone = routAll(engine, state, []);
    expect(alone.pieces['b']!.loc).toMatchObject({ hex: 'uJ5' });
    expect(alone.pieces['l']!.loc).toMatchObject({ hex: 'uO5' });
  });

  it('one PP: he keeps all six MF and routs with the unit to the woods six MF away, still holding his SW; into the next Player Turn he moves and the rout leaves no record', () => {
    const { engine, state } = game(1, 'uJ5');
    expect(engine.env(state).query('rout.escortMf', { leader: 'l' }, null)).toBe(6);
    let s = routAll(engine, state, ['l']);
    expect(s.pieces['b']!.loc).toMatchObject({ hex: 'uJ5' });
    expect(s.pieces['l']!.loc).toMatchObject({ hex: 'uJ5' });
    expect(s.pieces['lmg1']!.loc).toEqual({ kind: 'held', by: 'l' });
    for (let i = 0; i < 400 && !(s.turn > 1 && s.attacker === 'ru' && s.phase === 'MPh'); i++) {
      const d = engine.currentDecision(s)!;
      const legal = engine.legalActions(s, d.owner);
      s = act(engine, s, legal.find((x) => x.type === 'defPass') ?? legal.find((x) => x.type === 'move.end') ?? legal.find((x) => x.type === 'endPhase') ?? legal[0]!).state;
    }
    expect([s.turn, s.attacker, s.phase]).toEqual([2, 'ru', 'MPh']);
    expect(s.ext['sk1.rout']).toBeFalsy();
    expect(Object.keys(s.pieces['l']!.tags).filter((t) => TAG_LIFECYCLE[t] !== 'lasting')).toEqual([]);
    expect(engine.legalActions(s, 'ru').some((a) => a.type === 'move.start' && (a['units'] as string[]).includes('l'))).toBe(true);
  });

  it('two PP with the shelter near: the two rout together, the leader with both SW', () => {
    const { engine, state } = game(2, 'uM6');
    const s = routAll(engine, state, ['l']);
    expect(s.pieces['b']!.loc).toMatchObject({ hex: 'uM6' });
    expect(s.pieces['l']!.loc).toMatchObject({ hex: 'uM6' });
    expect(['lmg1', 'lmg2'].map((id) => s.pieces[id]!.loc)).toEqual([{ kind: 'held', by: 'l' }, { kind: 'held', by: 'l' }]);
  });

  it('more than two PP: he may not rout with the unit, and the reason is given', () => {
    const { engine, state } = game(3, 'uM6');
    expect(routEscorts(engine.env(state), 'b')).toEqual([]);
    const [first] = firstSteps(engine, state);
    expect(check(engine, state, { ...first!, leaders: ['l'] })).toMatch(/more than two PP.*A4.42/);
  });

  it('the Starter Kit is unchanged: no portage limit of the leader\'s own', () => {
    const { engine, state } = game(3, 'uJ5', SK);
    expect(engine.env(state).query('rout.escortMf', { leader: 'l' }, null)).toBeNull();
    expect(routEscorts(engine.env(state), 'b')).toEqual(['l']);
  });
});
