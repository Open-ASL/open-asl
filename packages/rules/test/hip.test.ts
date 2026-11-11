import { describe, expect, it } from 'vitest';
import type { Action, Ctx, Engine, GameState, RuleModule } from '@asl/engine';
import { FP, isVisibleTo, sk2CoreModules, type FireDeclaration, type FireMode, type ResolveFireFn } from '../src';
import { GE_VS_BR, act, makeEngine } from './fixtures';

const testFire: RuleModule = {
  id: 'test.fire',
  install(r) {
    r.action<Action & { decl: FireDeclaration; mode: FireMode }>({
      type: 'test.fire',
      decisionKinds: ['phase'],
      validate: (env, a) => env.query('fire.illegal', { decl: a.decl, mode: a.mode, side: a.side }, null),
      resolve(ctx: Ctx, a) {
        ctx.proc<ResolveFireFn>(FP.resolve)(ctx, a.decl, a.mode);
      },
    });
  },
};
const extra = [...sk2CoreModules, testFire];
const settle = (engine: Engine, state: GameState) => {
  let s = state;
  while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
  return s;
};
/** A hidden British crew and 40L in woods at yM5 (not Open Ground, so no LOS reveal), Germans about. */
const hidden = (gunHex = 'yM5', extraTags: Record<string, unknown> = {}) => [
  { id: 'c1', def: 'br.228c', side: 'br', hex: gunHex, tags: { hip: true } },
  { id: 'g40', def: 'br.AA40L', side: 'br', heldBy: 'c1', tags: { ca: 0, hip: true, emplaced: true, ...extraTags } },
];

describe('Hidden Initial Placement (SK4 6.4)', () => {
  it('hides the Gun and crew from the other side: not a target, not a Known Enemy Unit, not an obstacle to movement orders', () => {
    const { engine, state } = makeEngine({ scenario: GE_VS_BR, extra, terrain: { yM5: { terrain: 'woods' } }, startPhase: 'PFPh', pieces: [...hidden(), { id: 'e1', def: 'ge.467', side: 'ge', hex: 'yK5' }] });
    const env = engine.env(state);
    expect(isVisibleTo(env, state.pieces['c1']!, 'ge')).toBe(false);
    expect(isVisibleTo(env, state.pieces['c1']!, 'br')).toBe(true);
    expect(isVisibleTo(env, state.pieces['c1']!, null)).toBe(false);
    expect(engine.legalActions(state, 'ge').filter((a) => a.type === 'fire').map((a) => (a as unknown as { decl: { target: string } }).decl.target)).not.toContain('yM5');
  });

  it('is found in Open Ground by a Good Order enemy within 16 hexes with a LOS', () => {
    const { engine, state } = makeEngine({ scenario: GE_VS_BR, extra, startPhase: 'MPh', pieces: [...hidden('yM5'), { id: 'e1', def: 'ge.467', side: 'ge', hex: 'yA1' }] });
    // Nobody has seen it yet (the German is 12+ hexes off... in LOS on the fixture grid: it is seen at the first phase start).
    const seen = state.pieces['g40']!.tags['hip'] === undefined;
    expect(seen).toBe(true);
    const far = makeEngine({ scenario: GE_VS_BR, extra, startPhase: 'MPh', pieces: [...hidden('yM5'), { id: 'e1', def: 'ge.467', side: 'ge', hex: 'yGG10' }] });
    expect(far.state.pieces['g40']!.tags['hip']).toBe(true);
    let s = act(far.engine, far.state, { type: 'move.start', units: ['e1'] }).state;
    // Walk west until within 16 hexes and in LOS (board y fixture: grid LOS, open ground).
    for (let i = 0; i < 20 && s.pieces['g40']!.tags['hip']; i++) {
      const steps = far.engine.legalActions(s, 'ge').filter((a) => a.type === 'move.step') as unknown as { to: string }[];
      if (!steps.length) break;
      const map = (far.engine.statics as { map: { distance(a: string, b: string): number } }).map;
      const best = [...steps].sort((a, b) => map.distance(a.to, 'yM5') - map.distance(b.to, 'yM5'))[0]!;
      s = settle(far.engine, act(far.engine, s, { type: 'move.step', to: best.to }).state);
      if (!s.pieces['e1'] || far.engine.currentDecision(s)?.kind !== 'phase') break;
    }
    expect(s.pieces['g40']!.tags['hip']).toBeUndefined();
    expect(s.pieces['c1']!.tags['hip']).toBeUndefined();
  });

  it('turns back enemy Infantry that tries to enter its hex in the MPh: the Gun is revealed and may fire on them where they stand', () => {
    const { engine, state } = makeEngine({
      scenario: GE_VS_BR,
      extra,
      terrain: { yM5: { terrain: 'woods' } },
      startPhase: 'MPh',
      pieces: [...hidden('yM5'), { id: 'e1', def: 'ge.467', side: 'ge', hex: 'yK5' }],
    });
    let s = act(engine, state, { type: 'move.start', units: ['e1'] }).state;
    s = settle(engine, act(engine, s, { type: 'move.step', to: 'yL5' }).state);
    expect(s.pieces['g40']!.tags['hip']).toBe(true);
    // Entering M5 is offered (the hex looks empty) and costs the MF, but the stack stays in L5.
    expect(engine.legalActions(s, 'ge').some((a) => a.type === 'move.step' && (a as unknown as { to: string }).to === 'yM5')).toBe(true);
    const t = act(engine, s, { type: 'move.step', to: 'yM5' });
    expect(t.events.find((e) => e.type === 'sk2.hip.revealed')!.payload).toMatchObject({ gun: 'g40', crew: 'c1', hex: 'yM5', reason: 'entered' });
    expect(t.events.some((e) => e.type === 'sk2.hip.bounce')).toBe(true);
    expect(t.state.pieces['e1']!.loc).toEqual({ kind: 'hex', hex: 'yL5' });
    expect(t.state.pieces['g40']!.tags['hip']).toBeUndefined();
    // The defender is asked to fire at the halted stack in L5; afterwards the stack has ended its move.
    expect(engine.currentDecision(t.state)?.kind).toBe('firstFire');
    const shots = engine.legalActions(t.state, 'br').filter((a) => a.type === 'defFire.ordnance');
    expect(shots.length).toBeGreaterThan(0);
    s = act(engine, t.state, { type: 'defPass' }).state;
    expect(engine.currentDecision(s)?.kind).toBe('phase');
    expect(s.pieces['e1']!.tags['moved']).toBe(true);
    expect(engine.legalActions(s, 'ge').some((a) => a.type === 'move.step')).toBe(false);
  });

  it('attacks on a hex with hidden units are Area Fire (half FP) for small arms and +2 To Hit for ordnance', async () => {
    const { engine, state } = makeEngine({
      scenario: GE_VS_BR,
      extra,
      terrain: { yM5: { terrain: 'woods' } },
      dice: [3, 4, 6, 6],
      pieces: [...hidden('yM5'), { id: 'e1', def: 'ge.467', side: 'ge', hex: 'yL5' }],
    });
    // Fire that lands on the hex (the test action skips target checks) attacks the hidden crew on half the column.
    const t = act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: ['e1'], sw: [], target: 'yM5' } });
    const attack = t.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { column: number };
    expect(attack.column).toBe(8);
    const result = t.events.find((e) => e.type === 'sk1.fire.result')!.payload as { unit: string; result: { kind: string } };
    expect(result.unit).toBe('c1');
    // A German Gun firing on the ATT at the empty-looking hex takes +2.
    const g = makeEngine({
      scenario: GE_VS_BR,
      extra,
      terrain: { yM5: { terrain: 'woods' } },
      pieces: [...hidden('yM5'), { id: 'c2', def: 'ge.228c', side: 'ge', hex: 'yK5' }, { id: 'g75', def: 'ge.AT75L', side: 'ge', heldBy: 'c2', tags: { ca: 1 } }],
    });
    const env = g.engine.env(g.state);
    const illegal = env.query('ordnance.illegal', { shot: { weapon: 'g75', target: 'yM5', targetType: 'ITT', ca: 1 }, mode: 'prep', side: 'ge' }, null);
    expect(illegal).toMatch(/No target there/);
    const { shotContext } = await import('../src');
    const sc = shotContext(env, { weapon: 'g75', target: 'yM5', targetType: 'ATT', ca: 1 }, 'prep', 'ge');
    expect(env.explain('ordnance.thDrm', sc, 0).trace.some((x) => x.id === 'sk2.th.hip-target' && !x.suppressedBy)).toBe(true);
  });

  it('a router entering the hex is revealed to and eliminated for failure to rout; an advance into it is an ambush', () => {
    // Rout: the broken German must rout from L5 (adjacent to a known British squad in K5... use a woods target M5).
    const rout = makeEngine({
      scenario: GE_VS_BR,
      extra,
      terrain: { yM5: { terrain: 'woods' } },
      startPhase: 'RtPh',
      pieces: [...hidden('yM5'), { id: 'e1', def: 'ge.467', side: 'ge', hex: 'yL5', tags: { broken: true } }, { id: 'b2', def: 'br.457', side: 'br', hex: 'yK5' }],
    });
    const routs = rout.engine.legalActions(rout.state, 'ge').filter((a) => a.type === 'rout.step' && a['to'] === 'yM5' && !a['lowCrawl']);
    expect(routs.length).toBeGreaterThan(0);
    const t = act(rout.engine, rout.state, routs[0]!);
    expect(t.events.find((e) => e.type === 'sk2.hip.revealed')!.payload).toMatchObject({ reason: 'entered' });
    expect(t.state.pieces['e1']!.loc).toEqual({ kind: 'eliminated' });
    // Advance: the German walks into M5 (grain: not Open Ground, so the Gun was not spotted) for Close
    // Combat; the British get -2 on the ambush dr, in terrain where no ambush is otherwise possible.
    const adv = makeEngine({
      scenario: GE_VS_BR,
      extra,
      terrain: { yM5: { terrain: 'grain' } },
      startPhase: 'APh',
      pieces: [...hidden('yM5'), { id: 'e1', def: 'ge.467', side: 'ge', hex: 'yL5' }],
    });
    const a = act(adv.engine, adv.state, { type: 'advance', units: ['e1'], to: 'yM5' });
    expect(a.events.find((e) => e.type === 'sk2.hip.revealed')!.payload).toMatchObject({ reason: 'advanced' });
    expect(a.state.hexMarkers['yM5']).toMatchObject({ cc: true, hipAmbush: 'br' });
    const env = adv.engine.env(a.state);
    expect(env.query('cc.ambushDrm', { hex: 'yM5', side: 'br', units: ['c1'] }, 0)).toBe(-2);
    expect(env.query('cc.ambushDrm', { hex: 'yM5', side: 'ge', units: ['e1'] }, 0)).toBe(0);
  });
});
