import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { banzaiModule, declareIllegal, hiddenUnitsModule, japaneseModule, sk2CoreModules, sk3CoreModules } from '@asl/rules';
import { makeEngine } from '../../../packages/rules/test/fixtures';
import { banzaiCandidates, toggleBanzaiHex, type BanzaiDraft } from '../src/game/banzaiDraft';

/**
 * Drawing up a Banzai Charge (SK4 8.1.8.6): the panel names each unit with the weapons it holds, greys a unit that may
 * not charge with the reason (one over its IPC is told to drop a SW, SK1 4.0), and a click on one of the side's hexes
 * ticks or unticks the units there. A 9-0 holding a captured mortar, a 10-1 and three squads (one with the LMG) in a
 * chain, a Marine squad ahead.
 */
describe('the Banzai Charge panel', () => {
  // Piece ids in the engine's own form, as messages name them.
  const L9 = 'ja.0.5.ja.L90.1';
  const game = () =>
    makeEngine({
      scenario: {
        firstSide: 'ja',
        sides: [
          { side: 'am', name: 'U.S. Marine Corps', nationality: 'am', elr: 5 },
          { side: 'ja', name: 'Japanese', nationality: 'ja', elr: 3 },
        ],
      },
      extra: [...sk2CoreModules, ...sk3CoreModules, hiddenUnitsModule, japaneseModule, banzaiModule],
      startPhase: 'MPh',
      pieces: [
        { id: L9, def: 'ja.L90', side: 'ja', hex: 'yK4' },
        { id: `${L9}.sw1`, def: 'am.MTR', side: 'am', heldBy: L9 },
        { id: 'l10', def: 'ja.L101', side: 'ja', hex: 'yL5' },
        { id: 's1', def: 'ja.347', side: 'ja', hex: 'yL4' },
        { id: 's2', def: 'ja.347', side: 'ja', hex: 'yL4' },
        { id: 'lmg', def: 'ja.LMG', side: 'ja', heldBy: 's2' },
        { id: 's3', def: 'ja.347', side: 'ja', hex: 'yL4' },
        { id: 'm', def: 'am.768', side: 'am', hex: 'yP5' },
      ],
    }) as { engine: Engine; state: GameState };

  it('names the squad holding the LMG, and greys the leader over his IPC with what to do', () => {
    const { engine, state } = game();
    const c = Object.fromEntries(banzaiCandidates(engine.env(state), 'ja').map((x) => [x.id, x]));
    expect(Object.keys(c).sort()).toEqual([L9, 'l10', 's1', 's2', 's3'].sort());
    expect(c['s2']!.label).toMatch(/LMG/);
    expect(c['s1']!.label).not.toMatch(/LMG/);
    expect(c[L9]!.label).toMatch(/MTR/);
    expect(c[L9]!.why).toMatch(/IPC.*drop/i);
    expect(c[L9]!.why).not.toMatch(/ja\.|am\./);
    for (const id of ['l10', 's1', 's2', 's3']) expect(c[id]!.why, id).toBeNull();
  });

  it('a click on a hex ticks its units, a second unticks them; the leader stays', () => {
    const { engine, state } = game();
    const env = engine.env(state);
    let d: BanzaiDraft = { leader: 'l10', units: ['l10'], target: 'yP5' };
    const click = (hex: string) => {
      const r = toggleBanzaiHex(env, 'ja', d, hex);
      if (r && 'draft' in r) d = r.draft;
      return r;
    };
    click('yL4');
    expect(d.units.sort()).toEqual(['l10', 's1', 's2', 's3']);
    // The panel's draft is what the engine is asked to declare.
    expect(declareIllegal(env, 'ja', d.leader, d.target!, d.units, undefined, { skipLos: true })).toBeNull();
    click('yL4');
    expect(d.units).toEqual(['l10']);
    // The leader's own hex: nothing else to tick there.
    expect(click('yL5')).toBeNull();
    // A hex whose only unit may not charge says why.
    expect(click('yK4')).toMatchObject({ error: expect.stringMatching(/IPC/) });
    expect(click('yA1')).toBeNull();
  });
});
