import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { panzerfaustModule } from '../src';
import { sk2CoreModules } from '../src/sk2';
import { sk3CoreModules } from '../src/sk3';
import { RU_VS_GE, act, makeEngine, type PieceSpec } from './fixtures';

/*
 * Defensive First Fire "can be used only versus a moving unit(s)" and affects "only the moving unit(s) regardless of
 * other units that occupy the same hex" (SK4 3.3.3; ASLRB A8.1). An enemy AFV that sits in the hex an infantry unit
 * moves into is not moving: no Vehicle Target Type shot, BAZ or PF, may be aimed at it then.
 */

const extra = [...sk2CoreModules, ...sk3CoreModules, panzerfaustModule];
const t34 = (hex: string): PieceSpec => ({ id: 't34', def: 'ru.T34M43', side: 'ru', hex, tags: { vca: 0, ca: 0 } });

/** Russians move; the German 4-6-7 in K5 holds a BAZ; a T-34 stands in K7. */
function game(pieces: PieceSpec[] = [], pf = false) {
  return makeEngine({
    scenario: {
      ...RU_VS_GE,
      date: '10 October 1944',
      month: 10,
      // German squads in the OB and an enemy AFV: the Germans have Panzerfausts (SK4 4.4.2).
      ...(pf
        ? {
            forces: [
              { id: 'ge', group: 'G', side: 'ge', units: [{ def: 'ge.467', count: 1 }], setup: { kind: 'area', description: '', hexes: [] } },
              { id: 'ru', group: 'R', side: 'ru', units: [{ def: 'ru.T34M43', count: 1 }], setup: { kind: 'area', description: '', hexes: [] } },
            ],
          }
        : {}),
    },
    extra,
    startPhase: 'MPh',
    dice: Array(60).fill(4),
    pieces: [
      { id: 'g', def: 'ge.467', side: 'ge', hex: 'yK5' },
      { id: 'z', def: 'ge.BAZ43', side: 'ge', heldBy: 'g' },
      t34('yK7'),
      { id: 'r', def: 'ru.447', side: 'ru', hex: 'yK8' },
      ...pieces,
    ],
  });
}
const passFirstFire = (engine: Engine, s: GameState) => {
  while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
  return s;
};
/** The Russian squad steps from K8 into the T-34's hex. */
function infantryIntoTankHex(pf = false) {
  const { engine, state } = game([], pf);
  let s = passFirstFire(engine, act(engine, state, { type: 'move.start', units: ['r'] }).state);
  s = act(engine, s, { type: 'move.step', to: 'yK7' }).state;
  expect(engine.currentDecision(s)).toMatchObject({ kind: 'firstFire', owner: 'ge' });
  return { engine, s };
}
const validate = (engine: Engine, s: GameState, a: Record<string, unknown>) => engine.validate(s, { ...a, side: 'ge', decisionId: engine.currentDecision(s)!.id } as never);

describe('Defensive First Fire at a vehicle that is not moving (SK4 3.3.3; ASLRB A8.1)', () => {
  it('a BAZ may not aim at the stationary AFV in the hex an infantry unit moves into, nor is that shot offered', () => {
    const { engine, s } = infantryIntoTankHex();
    expect(validate(engine, s, { type: 'defFire.ordnance', shot: { weapon: 'z', target: 'yK7', targetType: 'VTT' } })).toMatch(/only the moving unit/);
    expect(validate(engine, s, { type: 'defFire.ordnance', shot: { weapon: 'z', target: 'yK7', targetType: 'VTT', targetUnit: 't34' } })).toMatch(/only the moving unit/);
    expect(engine.legalActions(s, 'ge').filter((a) => a.type === 'defFire.ordnance')).toHaveLength(0);
    // The squad's own FP at the moving squad is untouched.
    expect(validate(engine, s, { type: 'defFire', decl: { units: ['g'], sw: [], target: 'yK7' } })).toBeNull();
  });

  it('a PF may not aim at it either', () => {
    const { engine, s } = infantryIntoTankHex(true);
    expect(validate(engine, s, { type: 'defFire.pf', pf: { unit: 'g', target: 'yK7', targetType: 'VTT' } })).toMatch(/only the moving unit/);
    expect(engine.legalActions(s, 'ge').filter((a) => a.type === 'defFire.pf' && (a as unknown as { pf: { targetType: string } }).pf.targetType === 'VTT')).toHaveLength(0);
  });

  it('the moving AFV itself may be shot, and is the default target when another vehicle shares its hex', () => {
    const { engine, state } = game([{ id: 'su', def: 'ru.T34M43', side: 'ru', hex: 'yK6', tags: { vca: 0, ca: 0 } }]);
    let s = passFirstFire(engine, act(engine, state, { type: 'vmove.start', vehicle: 't34' }).state);
    s = act(engine, s, { type: 'move.step', to: 'yK6' }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'firstFire', owner: 'ge' });
    expect(validate(engine, s, { type: 'defFire.ordnance', shot: { weapon: 'z', target: 'yK6', targetType: 'VTT' } })).toBeNull();
    expect(validate(engine, s, { type: 'defFire.ordnance', shot: { weapon: 'z', target: 'yK6', targetType: 'VTT', targetUnit: 'su' } })).toMatch(/only the moving unit/);
    const r = act(engine, s, { type: 'defFire.ordnance', shot: { weapon: 'z', target: 'yK6', targetType: 'VTT' } });
    expect(r.events.find((e) => e.type === 'sk2.ordnance.shot')!.payload).toMatchObject({ target: 'yK6' });
  });

  it('through to the next Player Turn: the squad and its BAZ fire normally, at the T-34 now that it moves', () => {
    const { engine, s: start } = infantryIntoTankHex();
    let s = act(engine, start, { type: 'defFire', decl: { units: ['g'], sw: [], target: 'yK7' } }).state;
    for (let i = 0; i < 120 && !(s.attacker === 'ru' && s.turn === 2 && s.phase === 'MPh'); i++) {
      const d = engine.currentDecision(s)!;
      const l = engine.legalActions(s, d.owner);
      const pick = l.find((a) => a.type === 'defPass') ?? l.find((a) => a.type === 'move.end') ?? l.find((a) => a.type === 'endPhase') ?? l[0]!;
      s = engine.submit(s, pick).state;
    }
    expect(s).toMatchObject({ attacker: 'ru', turn: 2, phase: 'MPh' });
    expect(s.pieces['g']!.tags).not.toHaveProperty('firedSw');
    s = passFirstFire(engine, act(engine, s, { type: 'vmove.start', vehicle: 't34' }).state);
    s = act(engine, s, { type: 'move.step', to: 'yK6' }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'firstFire', owner: 'ge' });
    expect(validate(engine, s, { type: 'defFire.ordnance', shot: { weapon: 'z', target: 'yK6', targetType: 'VTT' } })).toBeNull();
  });
});
