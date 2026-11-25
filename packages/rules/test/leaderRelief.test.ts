import { describe, expect, it } from 'vitest';
import type { Action, Ctx, RuleModule } from '@asl/engine';
import { P, leaderReliefModule, type CheckUnitFn, type LeaderReliefEvent } from '../src';
import { act, makeEngine, type PieceSpec } from './fixtures';

/** Test-only action: a unit takes a Morale Check as fire would make it (a "combat" MC). */
const testMc: RuleModule = {
  id: 'test.mc',
  install(r) {
    r.action<Action & { unit: string }>({
      type: 'test.mc',
      decisionKinds: ['phase'],
      resolve(ctx: Ctx, a) {
        ctx.proc<CheckUnitFn>(P.checkUnit)(ctx, a.unit, { kind: 'MC', mod: 0, reason: 'fire' });
      },
    });
  },
};

// The rule's leader is the first counter of its def created with its force: force 0 ('easy'), so 'am.0.<unit>.<def>.1'.
const DIKE = 'am.0.0.am.L91.1';
const SPEIRS = 'am.1.0.am.L80.1';
const SCENARIO = {
  forces: [
    {
      id: 'easy',
      side: 'am',
      units: [],
      setup: { kind: 'area' as const, description: '', hexes: [] },
    },
    {
      id: 'speirs',
      side: 'am',
      units: [],
      setup: { kind: 'enter' as const, turn: 3, edge: 'N', provisional: 'ssr' as const },
    },
  ],
  ssr: [
    {
      module: 'leader-relief',
      params: {
        side: 'am',
        force: 'easy',
        leader: 'am.L91',
        name: 'Lt Dike',
        fromTurn: 1,
        replacement: { force: 'speirs', name: 'Lt Speirs' },
        rule: 'SSR 4',
      },
      text: 'SSR 4',
    },
  ],
};
const PIECES: PieceSpec[] = [
  { id: DIKE, def: 'am.L91', side: 'am', hex: 'yN5', tags: { force: 0 } },
  { id: 'am.0.1.am.747.1', def: 'am.747', side: 'am', hex: 'yN5', tags: { force: 0 } },
  {
    id: SPEIRS,
    def: 'am.L80',
    side: 'am',
    tags: { force: 1, entryRoll: 'ssr', entryFrom: 3, entryTurn: 0, entryEdge: 'N' },
  },
  { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
];
const setup = (startPhase: string, dice: number[]) =>
  makeEngine({
    scenario: SCENARIO,
    extra: [leaderReliefModule, testMc],
    startPhase,
    pieces: PIECES,
    dice,
  });
const relief = (events: { type: string; payload: unknown }[]) =>
  events.filter((e) => e.type === 'ssr.leaderRelief').map((e) => e.payload as LeaderReliefEvent);

describe('leader relieved of command by SSR (LMA5 SSR 4)', () => {
  it('takes a MC as his side’s Rally Phase starts; failing it pins him for good and the replacement is due the next turn', () => {
    // Morale 9: 6+6 = 12 fails.
    const { engine, state } = setup('RPh', [6, 6]);
    const dike = state.pieces[DIKE]!;
    expect(dike.tags).toMatchObject({ pinned: true, relieved: expect.stringContaining('SSR 4') });
    expect(dike.tags['broken']).toBeUndefined();
    expect(state.pieces[SPEIRS]!.tags['entryTurn']).toBe(2);
    // The Pin comes off at the end of the CCPh as every Pin does; his comes straight back.
    const env = engine.env(state);
    expect(env.state.ext['ssr.leaderRelief']).toEqual({ easy: true });
  });

  it('passes on a DR under his morale; exactly his morale pins him for this turn only', () => {
    const passed = setup('RPh', [2, 3]).state;
    expect(passed.pieces[DIKE]!.tags['pinned']).toBeUndefined();
    expect(passed.pieces[SPEIRS]!.tags['entryTurn']).toBe(0);
    const equal = setup('RPh', [4, 5]).state;
    expect(equal.pieces[DIKE]!.tags['pinned']).toBe(true);
    expect(equal.pieces[DIKE]!.tags['relieved']).toBeUndefined();
    expect(equal.pieces[SPEIRS]!.tags['entryTurn']).toBe(0);
  });

  it('is relieved too by any other failed MC, whose result stands; rallied, he is pinned again', () => {
    const { engine, state } = setup('PFPh', [6, 5]);
    const t = act(engine, state, { type: 'test.mc', unit: DIKE });
    expect(relief(t.events)).toEqual([
      expect.objectContaining({
        unit: DIKE,
        why: 'combat',
        replacement: { name: 'Lt Speirs', turn: 2, units: [SPEIRS] },
      }),
    ]);
    const dike = t.state.pieces[DIKE]!;
    expect(dike.tags['broken']).toBe(true);
    expect(dike.tags['pinned']).toBeUndefined();
    expect(t.state.pieces[SPEIRS]!.tags['entryTurn']).toBe(2);
    // A second failure brings nobody else.
    const again = act(engine, t.state, { type: 'test.mc', unit: 'am.0.1.am.747.1' });
    expect(relief(again.events)).toEqual([]);
  });

  it('a passed combat MC changes nothing', () => {
    const { engine, state } = setup('PFPh', [1, 2]);
    const t = act(engine, state, { type: 'test.mc', unit: DIKE });
    expect(relief(t.events)).toEqual([]);
    expect(t.state.pieces[SPEIRS]!.tags['entryTurn']).toBe(0);
  });

  it('stays pinned through the end of the Player Turn', () => {
    const { engine, state } = setup('RPh', [6, 6]);
    let s = state;
    for (let i = 0; i < 12 && !(s.phase === 'RPh' && s.attacker === 'ge'); i++)
      s = act(engine, s, { type: 'endPhase' }).state;
    expect(s.attacker).toBe('ge');
    expect(s.pieces[DIKE]!.tags['pinned']).toBe(true);
  });
});

/*
 * A replacement that appears on map hexes (LMA5 SSR 4: "appears as a reinforcement the following turn on the X0-CC3
 * row"): set up on one of them by its owner as the first act of his RPh when due, as entering units set up offboard
 * then (ASLRB A2.51); if none can take it, it comes a Game Turn later (A2.5).
 */
describe('a replacement that appears on map hexes', () => {
  const ROW = ['yN5', 'yN6'];
  const scenario = {
    ...SCENARIO,
    forces: [SCENARIO.forces[0]!, { ...SCENARIO.forces[1]!, setup: { kind: 'enter' as const, turn: 3, edge: 'N', hexes: ROW, appear: true, provisional: 'ssr' as const } }],
  };
  const speirs = (tags: Record<string, string | number> = {}): PieceSpec => ({ id: SPEIRS, def: 'am.L80', side: 'am', tags: { force: 1, entryRoll: 'ssr', entryFrom: 3, entryTurn: 0, appearHexes: ROW.join(','), ...tags } });
  const play = (pieces: PieceSpec[], dice: number[]) => makeEngine({ scenario, extra: [leaderReliefModule, testMc], startPhase: 'RPh', pieces, dice });
  const toNextAmRph = (engine: ReturnType<typeof play>['engine'], s0: ReturnType<typeof play>['state']) => {
    let s = s0;
    for (let i = 0; i < 30 && !(s.turn === 2 && s.phase === 'RPh' && s.attacker === 'am'); i++) {
      const d = engine.currentDecision(s)!;
      s = act(engine, s, { type: 'endPhase', side: d.owner }).state;
    }
    return s;
  };

  it('Dike fails his MC: next turn the American sets Speirs up on a row hex (not offboard), and he then moves and plays on', () => {
    const { engine, state } = play([...PIECES.filter((p) => p.id !== SPEIRS), speirs()], [6, 6]);
    expect(state.pieces[SPEIRS]!.tags['entryTurn']).toBe(2);
    let s = toNextAmRph(engine, state);
    const d = engine.currentDecision(s)!;
    expect(d).toMatchObject({ kind: 'offboardSetup', owner: 'am' });
    // What he is offered: a placement on a row hex, never an offboard hex.
    const [auto] = engine.legalActions(s, 'am') as unknown as [{ placements: Record<string, string> }];
    expect(ROW).toContain(auto.placements[SPEIRS]);
    // Not off the row, nor in a hex the enemy holds.
    expect(engine.validate(s, { type: 'setup.offboard', placements: { [SPEIRS]: 'yP9' }, side: 'am', decisionId: d.id } as Action)).toMatch(/not a setup hex/);
    const t = act(engine, s, { type: 'setup.offboard', placements: { [SPEIRS]: 'yN6' } });
    s = t.state;
    expect(s.pieces[SPEIRS]!.loc).toEqual({ kind: 'hex', hex: 'yN6' });
    expect(s.pieces[SPEIRS]!.tags['appearHexes']).toBeUndefined();
    expect(t.events.filter((e) => e.type === 'sk1.appeared').map((e) => e.payload)).toEqual([{ side: 'am', units: [SPEIRS], hexes: ['yN6'] }]);
    // On through the RPh and PFPh to the MPh: he moves like any unit on the map.
    for (let i = 0; i < 6 && s.phase !== 'MPh'; i++) s = act(engine, s, { type: 'endPhase' }).state;
    expect(s.phase).toBe('MPh');
    expect(engine.legalActions(s, 'am').some((a) => a.type === 'move.start' && (a['units'] as string[]).includes(SPEIRS))).toBe(true);
    s = act(engine, s, { type: 'move.start', units: [SPEIRS] }).state;
    s = act(engine, s, { type: 'move.step', to: 'yN7' }).state;
    expect(s.pieces[SPEIRS]!.loc).toMatchObject({ kind: 'hex', hex: 'yN7' });
  });

  it('a row hex the enemy holds is refused; with every row hex held he comes a Game Turn later', () => {
    const held = makeEngine({ scenario, extra: [leaderReliefModule, testMc], startPhase: 'RPh', pieces: [...PIECES.filter((p) => p.id !== SPEIRS && p.id !== DIKE), speirs({ entryTurn: 1 }), { id: 'g2', def: 'ge.467', side: 'ge', hex: 'yN5' }], dice: [] });
    const d = held.engine.currentDecision(held.state)!;
    expect(d).toMatchObject({ kind: 'offboardSetup', owner: 'am' });
    expect(held.engine.validate(held.state, { type: 'setup.offboard', placements: { [SPEIRS]: 'yN5' }, side: 'am', decisionId: d.id } as Action)).toMatch(/held by the enemy/);
    const blocked = makeEngine({ scenario, extra: [leaderReliefModule, testMc], startPhase: 'RPh', pieces: [...PIECES.filter((p) => p.id !== SPEIRS && p.id !== DIKE), speirs({ entryTurn: 1 }), { id: 'g2', def: 'ge.467', side: 'ge', hex: 'yN5' }, { id: 'g3', def: 'ge.467', side: 'ge', hex: 'yN6' }], dice: [] });
    expect(blocked.engine.currentDecision(blocked.state)?.kind).not.toBe('offboardSetup');
    expect(blocked.state.pieces[SPEIRS]!).toMatchObject({ loc: { kind: 'offboard' }, tags: { entryTurn: 2 } });
  });
});

