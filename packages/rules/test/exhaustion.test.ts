import { describe, expect, it } from 'vitest';
import { CONSIDERED_CX_MODULE, LEADER_PTC_DECISION, LEADER_PTC_MODULE, NO_DOUBLE_TIME_MODULE, consideredCxModule, leaderPtcModule, noDoubleTimeModule } from '../src';
import { act, makeEngine, type PieceSpec } from './fixtures';

/** S68 SSR 2 and 3: no Double Time, considered CX (in CC, or always), and the 10-2's 1PTC each American RPh. */
const SC = {
  firstSide: 'am',
  sides: [
    { side: 'am', name: 'American', nationality: 'am', elr: 2 },
    { side: 'ge', name: 'German', nationality: 'ge', elr: 3 },
  ],
};
const game = (pieces: PieceSpec[], ssr: unknown[], startPhase = 'MPh', dice?: number[]) =>
  makeEngine({ scenario: { ...SC, ssr } as never, extra: [noDoubleTimeModule, consideredCxModule, leaderPtcModule], terrain: {}, startPhase, pieces, ...(dice ? { dice } : {}) });

describe('S68 SSR 2: no Double Time', () => {
  it('refuses a Double Time start for the side, not a normal one', () => {
    const { engine, state } = game([{ id: 'a', def: 'am.747', side: 'am', hex: 'yL4' }, { id: 'g', def: 'ge.467', side: 'ge', hex: 'yA1' }], [{ module: NO_DOUBLE_TIME_MODULE, params: { side: 'am', rule: 'SSR 2' } }]);
    expect(() => act(engine, state, { type: 'move.start', units: ['a'], doubleTime: true })).toThrow(/SSR 2: these units may not use Double Time/);
    expect(engine.legalActions(state, 'am').some((a) => a.type === 'move.start' && a['doubleTime'])).toBe(false);
    expect(act(engine, state, { type: 'move.start', units: ['a'] }).state).toBeDefined();
  });
});

describe('S68 SSR 2: considered CX', () => {
  const pieces: PieceSpec[] = [
    { id: 'a', def: 'am.747', side: 'am', hex: 'yL4' },
    { id: 'c', def: 'am.747', side: 'am', hex: 'yL4', tags: { cx: true } },
    { id: 'g', def: 'ge.467', side: 'ge', hex: 'yL4' },
  ];
  const cc = (ccOnly: boolean) => game(pieces, [{ module: CONSIDERED_CX_MODULE, params: { side: 'am', ccOnly, rule: 'SSR 2' } }], 'CCPh');

  it('in CC: +1 to their attacks, -1 to attacks on them, +1 to their ambush dr; not twice where one is CX already', () => {
    const env = cc(true).engine.env(cc(true).state);
    expect(env.query('cc.drm', { hex: 'yL4', attackers: ['a'], targets: ['g'] } as never, 0)).toBe(1);
    expect(env.query('cc.drm', { hex: 'yL4', attackers: ['g'], targets: ['a'] } as never, 0)).toBe(-1);
    expect(env.query('cc.ambushDrm', { hex: 'yL4', side: 'am', units: ['a'] }, 0)).toBe(1);
    // A real CX counter in the attack: its own +1 only.
    expect(env.query('cc.drm', { hex: 'yL4', attackers: ['a', 'c'], targets: ['g'] } as never, 0)).toBe(1);
    expect(env.query('cc.ambushDrm', { hex: 'yL4', side: 'am', units: ['a', 'c'] }, 0)).toBe(1);
    // Germans are untouched.
    expect(env.query('cc.ambushDrm', { hex: 'yL4', side: 'ge', units: ['g'] }, 0)).toBe(0);
  });

  it('fire: CX only with the balance ("In CC," deleted)', () => {
    const attack = { target: 'yL6', parts: [{ firer: 'a', piece: 'a', kind: 'unit', fp: 7 }], directors: [] };
    const onlyCc = cc(true);
    const always = cc(false);
    const drm = (g: ReturnType<typeof cc>) => g.engine.env(g.state).explain('fire.drm', { attack } as never, 0).trace.some((t: { label?: string }) => /CX firer \(SSR\)/.test(t.label ?? ''));
    expect(drm(onlyCc)).toBe(false);
    expect(drm(always)).toBe(true);
  });
});

describe('S68 SSR 3: the 10-2 takes a 1PTC as the American player’s first action in each American RPh', () => {
  const pieces: PieceSpec[] = [
    { id: 'L', def: 'am.L102', side: 'am', hex: 'yL4' },
    { id: 'g', def: 'ge.467', side: 'ge', hex: 'yA1' },
  ];
  const SSR = [{ module: LEADER_PTC_MODULE, params: { side: 'am', leader: 'am.L102', drm: 1, rule: 'SSR 3' } }];
  /** End phases from the American APh of Turn 1 until the next American RPh asks for the PTC. */
  const toAmericanRph = (dice: number[]) => {
    const { engine, state } = game(pieces, SSR, 'APh', dice);
    let s = state;
    for (let i = 0; i < 60 && engine.currentDecision(s)?.kind !== LEADER_PTC_DECISION; i++) {
      const d = engine.currentDecision(s)!;
      const l = engine.legalActions(s, d.owner);
      s = engine.submit(s, l.find((a) => a.type === 'endPhase') ?? l.find((a) => a.type === 'defPass') ?? l[0]!).state;
    }
    return { engine, s };
  };

  it('asked of the Americans at the start of their RPh (not the Germans’); failed (6+5+1 = 12 > 10): pinned', () => {
    const { engine, s } = toAmericanRph([6, 5]);
    expect([s.turn, s.attacker, s.phase, engine.currentDecision(s)!.owner]).toEqual([2, 'am', 'RPh', 'am']);
    expect(engine.legalActions(s, 'am').map((a) => a.type)).toEqual(['leaderPtc.take']);
    const r = act(engine, s, { type: 'leaderPtc.take' });
    expect(r.state.pieces['L']!.tags['pinned']).toBe(true);
    expect(r.events.find((e) => e.type === 'ssr.leaderPtc')?.payload).toMatchObject({ final: 12, morale: 10, pinned: true, rule: 'SSR 3' });
    // The RPh goes on.
    expect(engine.currentDecision(r.state)!.kind).toBe('phase');
  });

  it('passed (4+4+1 = 9): nothing; and a pin is gone by the next Player Turn', () => {
    const passed = toAmericanRph([4, 4]);
    expect(act(passed.engine, passed.s, { type: 'leaderPtc.take' }).state.pieces['L']!.tags['pinned']).toBeUndefined();
    const { engine, s } = toAmericanRph([6, 5]);
    let t = act(engine, s, { type: 'leaderPtc.take' }).state;
    for (let i = 0; i < 40 && !(t.attacker === 'ge' && t.phase === 'RPh'); i++) {
      const d = engine.currentDecision(t)!;
      const l = engine.legalActions(t, d.owner);
      t = engine.submit(t, l.find((a) => a.type === 'endPhase') ?? l.find((a) => a.type === 'defPass') ?? l[0]!).state;
    }
    expect([t.attacker, t.phase]).toEqual(['ge', 'RPh']);
    expect(t.pieces['L']!.tags['pinned']).toBeUndefined();
  });
});
