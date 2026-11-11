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
