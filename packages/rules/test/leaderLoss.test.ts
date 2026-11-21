import { describe, expect, it } from 'vitest';
import { RU_VS_GE, act, makeEngine } from './fixtures';

/**
 * Leader Loss checks during Defensive First Fire (SK1 3.2.1; ASLRB A10.2): a leader broken or eliminated by First Fire
 * at a moving stack causes a LLTC/LLMC only in the units moving with him, not in the units already in that Location
 * (A10.2 "does not cause other units in the same Location to take a LLMC/LLTC unless they were moving with him"),
 * just as the attack itself affects only units moving together (SK1 3.2).
 */
describe('Leader Loss checks during Defensive First Fire', () => {
  // A Russian 8-1 and a 4-4-7 move from I4 into the stone building J3, where a 2-3-7 half-squad already is; a German
  // 4-6-7 in K5 First Fires at them.
  const setup = (dice: number[]) =>
    makeEngine({
      board: 'z',
      terrain: { zJ3: { terrain: 'building-stone' }, zK5: { terrain: 'building-stone' } },
      scenario: RU_VS_GE,
      startPhase: 'MPh',
      dice,
      pieces: [
        { id: 'rL', def: 'ru.L81', side: 'ru', hex: 'zI4' },
        { id: 'r1', def: 'ru.447', side: 'ru', hex: 'zI4' },
        { id: 'rHS', def: 'ru.237', side: 'ru', hex: 'zJ3' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'zK5' },
      ],
    });
  const checks = (events: { type: string; payload: unknown }[]) =>
    events.filter((e) => e.type === 'sk1.check').map((e) => e.payload as { unit: string; reason?: string });

  it('a leader broken by First Fire: the squad moving with him takes the LLTC, the half-squad already there does not', () => {
    // Attack DR 1+1 (+2: TEM +3, FFNAM -1) → 4 on the 4 column: 1MC. The 8-1 rolls 6+5 and breaks; the 4-4-7 passes
    // with 1+2; its LLTC 1+1 (+1 for the 8-1's -1 reversed) passes.
    const { engine, state } = setup([1, 1, 6, 5, 1, 2, 1, 1]);
    let s = act(engine, state, { type: 'move.start', units: ['rL', 'r1'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'zJ3' }).state;
    const t = act(engine, s, { type: 'defFire', decl: { units: ['g1'], sw: [], target: 'zJ3' } });
    expect(t.state.pieces['rL']!.tags['broken']).toBe(true);
    const cs = checks(t.events);
    expect(cs.filter((c) => c.reason === 'LLTC').map((c) => c.unit)).toEqual(['r1']);
    expect(cs.some((c) => c.unit === 'rHS')).toBe(false);
    expect(t.state.pieces['rHS']!.tags['pinned']).toBeUndefined();
    expect(t.state.ext['sk1.leaderLoss']).toBeUndefined();
  });

  it('outside the MPh the attack is on the whole Location: every lower-morale unit there takes the LLTC', () => {
    // DFPh: all three in J3. Attack DR 1+1 (+3 TEM) → 5 on the 4 column. The 8-1 breaks on 6+5; both MMC pass their
    // MC and their LLTC.
    const { engine, state } = makeEngine({
      board: 'z',
      terrain: { zJ3: { terrain: 'building-stone' }, zK5: { terrain: 'building-stone' } },
      scenario: RU_VS_GE,
      startPhase: 'DFPh',
      dice: [1, 1, 6, 5, 1, 2, 1, 2, 1, 1, 1, 1],
      pieces: [
        { id: 'rL', def: 'ru.L81', side: 'ru', hex: 'zJ3' },
        { id: 'r1', def: 'ru.447', side: 'ru', hex: 'zJ3' },
        { id: 'rHS', def: 'ru.237', side: 'ru', hex: 'zJ3' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'zK5' },
      ],
    });
    const t = act(engine, state, { type: 'fire', decl: { units: ['g1'], sw: [], target: 'zJ3' } });
    expect(t.state.pieces['rL']!.tags['broken']).toBe(true);
    expect(checks(t.events).filter((c) => c.reason === 'LLTC').map((c) => c.unit).sort()).toEqual(['r1', 'rHS']);
  });
});
