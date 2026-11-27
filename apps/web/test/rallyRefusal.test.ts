import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { makeEngine } from '../../../packages/rules/test/fixtures';
import { groupRallyRefusals, rallyRefusals } from '../src/game/rallyRefusal';

/*
 * A leader in Melee is not in Good Order (SK1 glossary: "neither broken nor marked with a Melee counter"), and only a
 * Good Order leader rallies other units (SK1 3.1 f). The wheel keeps his rally entry, greyed with that reason, rather
 * than dropping it so that the unbroken leader looks broken.
 */
describe('the greyed rally entry of a leader who may not rally', () => {
  const game = (melee: boolean) =>
    makeEngine({
      startPhase: 'RPh',
      ...(melee ? { hexMarkers: { yO5: { melee: true } } } : {}),
      pieces: [
        { id: 'aL', def: 'am.L91', side: 'am', hex: 'yO5' },
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yO5', tags: { broken: true } },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yO5' },
      ],
    });
  const refusals = (engine: Engine, s: GameState) => {
    const d = engine.currentDecision(s)!;
    const legal = engine.legalActions(s, 'am');
    const here = ['aL', 'a1', 'g1'].map((id) => s.pieces[id]!);
    return {
      legal: legal.filter((a) => a.type === 'rally.rally'),
      refusals: rallyRefusals(
        engine.env(s),
        'am',
        here,
        (leader, unit) => legal.some((a) => a.type === 'rally.rally' && a['leader'] === leader && a['unit'] === unit),
        (leader, unit) => engine.validate(s, { type: 'rally.rally', leader, unit, side: 'am', decisionId: d.id } as never),
      ),
    };
  };

  it('in Melee: no rally is offered, and the entry says the leader is not in Good Order', () => {
    const { engine, state } = game(true);
    const r = refusals(engine, state);
    expect(r.legal).toEqual([]);
    expect(r.refusals).toEqual([{ leader: 'aL', unit: 'a1', reason: 'A leader in Melee is not in Good Order, so he cannot rally others (SK1 3.1, glossary)' }]);
  });

  it('out of Melee the rally is offered and nothing is greyed', () => {
    const { engine, state } = makeEngine({
      startPhase: 'RPh',
      pieces: [
        { id: 'aL', def: 'am.L91', side: 'am', hex: 'yO5' },
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yO5', tags: { broken: true } },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
      ],
    });
    const r = refusals(engine, state);
    expect(r.legal).toContainEqual(expect.objectContaining({ leader: 'aL', unit: 'a1' }));
    expect(r.refusals).toEqual([]);
  });

  it('one greyed entry per leader and reason, naming the units it covers', () => {
    const reason = 'A leader in Melee is not in Good Order, so he cannot rally others (SK1 3.1, glossary)';
    expect(
      groupRallyRefusals([
        { leader: 'aL', unit: 'a1', reason },
        { leader: 'aL', unit: 'a2', reason },
        { leader: 'aL', unit: 'a3', reason: 'other' },
      ]),
    ).toEqual([
      { leader: 'aL', units: ['a1', 'a2'], reason },
      { leader: 'aL', units: ['a3'], reason: 'other' },
    ]);
  });
});
