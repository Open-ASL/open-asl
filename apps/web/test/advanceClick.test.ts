import { describe, expect, it } from 'vitest';
import type { GameState, Piece } from '@asl/engine';
import { ASL_TESTBED_FIRE_SCENARIO, newGame } from '@asl/content';
import { advanceTos, clickLoc } from '../src/game/clickLoc';

/*
 * A click on a green hex in the APh advances the selected units into the Location the map stands for: for a stack
 * upstairs in a Two Story House, the same floor of the next building hex (ASLRB A4.7, B23.422: one Location). Only the
 * selected stack's advances count; another stack on the ground beside it may advance into that hex's ground level.
 */
const unit = (id: string, defId: string, hex: string, side: string, level?: number): Piece => ({ id, defId, side, loc: { kind: 'hex', hex, ...(level ? { level } : {}) }, tags: {} });

function aphWith(pieces: Piece[]) {
  const { engine, state } = newGame(ASL_TESTBED_FIRE_SCENARIO, 'advance-click');
  const s: GameState = { ...state, phase: 'APh', attacker: 'ru', decisions: [{ id: 'aph', kind: 'phase', owner: 'ru', deadlineClass: 'turn' }], pieces: Object.fromEntries(pieces.map((p) => [p.id, p])) };
  return { engine, state: s };
}

describe('the APh map click upstairs (ASLRB A4.7, B23.422)', () => {
  // Board u's L5–M5 house: one squad upstairs in M5, one on the ground below it.
  const pieces = [unit('up', 'ru.447', 'uM5', 'ru', 1), unit('down', 'ru.447', 'uM5', 'ru'), unit('g', 'ge.467', 'uY10', 'ge')];

  it('a click on L5 advances the squad upstairs into L5 level 1, though the squad on the ground may enter L5 itself', () => {
    const { engine, state } = aphWith(pieces);
    const legal = engine.legalActions(state, 'ru');
    expect(legal.some((a) => a.type === 'advance' && a['to'] === 'uL5')).toBe(true);
    const to = clickLoc(advanceTos(legal, ['up']), 'uL5', 'uM5');
    expect(to).toBe('uL5:1');
    const s = engine.submit(state, { type: 'advance', side: 'ru', decisionId: 'aph', units: ['up'], to }).state;
    expect(s.pieces['up']!.loc).toEqual({ kind: 'hex', hex: 'uL5', level: 1 });
  });

  it('the squad on the ground still advances into the ground level of L5', () => {
    const { engine, state } = aphWith(pieces);
    expect(clickLoc(advanceTos(engine.legalActions(state, 'ru'), ['down']), 'uL5', 'uM5')).toBe('uL5');
  });
});
