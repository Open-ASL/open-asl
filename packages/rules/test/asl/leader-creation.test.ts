import { describe, expect, it } from 'vitest';
import type { GameState } from '@asl/engine';
import { aslCoreModules } from '../../src';
import { act, makeEngine } from '../fixtures';

/*
 * The MMC a Field Promotion in CC is based on. SK1/SK4 5.3: "If more than one type of MMC made the CC
 * attack, use the best one to base the dr on" (the SK rules read "best" as the best Morale). ASLRB A18.2: "the MMC
 * with the highest BPV involved is used to determine any Leader Creation drm" (asl/leaderCreation.ts).
 */
describe('A18.2 Leader Creation: the base MMC of a CC attack', () => {
  // An American 6-6-6 (Morale 6, BPV 11) and 4-4-7 (Morale 7, BPV 7) attack a German 4-6-7 together and roll an
  // original 2; the German attack misses (6,6). The stub table names the leader after the Morale it was given.
  const run = (extra: typeof aslCoreModules) => {
    const { engine, state } = makeEngine({
      startPhase: 'APh',
      extra,
      dice: [1, 1, 6, 6, 6, 6, 6, 6],
      tables: { leaderCreation: (nat, morale) => `${nat}.L${morale >= 7 ? 91 : 80}` },
      pieces: [
        { id: 'a1', def: 'am.666', side: 'am', hex: 'yO5' },
        { id: 'a2', def: 'am.447', side: 'am', hex: 'yO5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yO5' },
      ],
    });
    let s: GameState = act(engine, state, { type: 'endPhase' }).state;
    s = act(engine, s, { type: 'cc.declare', attacks: [{ attackers: ['a1', 'a2'], targets: ['g1'] }] }).state;
    const t = act(engine, s, { type: 'cc.declare', attacks: [{ attackers: ['g1'], targets: ['a1'] }] });
    return t.events.find((e) => e.type === 'sk1.leaderCreation')!.payload as { unit: string; defId: string | null };
  };

  it('SK: the best Morale (the 4-4-7)', () => {
    expect(run([])).toMatchObject({ unit: 'a2', defId: 'am.L91' });
  });

  it('full ASL: the highest BPV (the 6-6-6), with its own Morale for the drm', () => {
    expect(run(aslCoreModules)).toMatchObject({ unit: 'a1', defId: 'am.L80' });
  });
});
