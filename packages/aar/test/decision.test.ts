import { describe, expect, it } from 'vitest';
import { newGame, scenarioById } from '@asl/content';
import type { GameState, Piece } from '@asl/engine';
import type { ScenarioDef } from '@asl/rules';
import { gameDecision } from '../src';

/** LMA6: the Free French win at game end if no Good Order German is left in the buildings of hexrows I to P. */
const LMA6 = scenarioById('lma-6')!;
/** LMA5: the Americans win at the end of their MPh with a unit of each company in one building and fewer MMC lost. */
const LMA5 = scenarioById('lma-5')!;

/** The scenario's opening position with `side`'s pieces all eliminated (or none when null), at Turn 5 of the RPh. */
function envOf(scenario: ScenarioDef, gone: string | null) {
  const { engine, state } = newGame(scenario, 'decision', { los: 'grid' });
  const pieces: Record<string, Piece> = {};
  for (const p of Object.values(state.pieces)) pieces[p.id] = p.side === gone ? { ...p, loc: { kind: 'eliminated' } } : p;
  const s: GameState = { ...state, pieces, turn: 5, phase: 'RPh' };
  return engine.env(s);
}

describe('what decided a game, for the report and the game-over screen', () => {
  it('scenario end won on a condition: the condition met is named', () => {
    const d = gameDecision(envOf(LMA6, 'ge'), LMA6, { winner: 'br', reason: 'scenario end', turn: 5, phase: 'RPh' });
    expect(d.decidedBy).toEqual(['No Good Order Germans in the 27 buildings of hexrows I to P of board U at game end']);
    expect(d.how).toBe('No Good Order Germans left in the objective at game end');
  });

  it('scenario end won by holding on: nothing the winner met, so the attacker\'s failed condition is the account', () => {
    const d = gameDecision(envOf(LMA6, null), LMA6, { winner: 'ge', reason: 'scenario end', turn: 5, phase: 'RPh' });
    expect(d.decidedBy).toEqual([]);
    expect(d.how).toBe('The Free French never cleared the objective');
  });

  it('a draw: neither side met its conditions', () => {
    const d = gameDecision(envOf(LMA6, null), LMA6, { winner: null, reason: 'scenario end', turn: 5, phase: 'RPh' });
    expect(d).toEqual({ how: 'Neither side met its victory conditions', decidedBy: [] });
  });

  it('a concession names who gave up and no condition', () => {
    const d = gameDecision(envOf(LMA6, 'ge'), LMA6, { winner: 'br', reason: 'concession', turn: 3, phase: 'MPh', loserName: 'Kurt' });
    expect(d).toEqual({ how: 'Kurt conceded in Turn 3 Movement Phase', decidedBy: [] });
    expect(gameDecision(envOf(LMA6, null), LMA6, { winner: 'ge', reason: 'concession', turn: 3, phase: 'MPh' }).how).toBe('Free French conceded in Turn 3 Movement Phase');
  });

  it('annihilation names the side wiped out, and the condition it settled', () => {
    const d = gameDecision(envOf(LMA6, 'ge'), LMA6, { winner: 'br', reason: 'annihilation', turn: 4, phase: 'PFPh' });
    expect(d.how).toBe('The last German unit died in Turn 4');
    expect(d.decidedBy).toEqual(['No Good Order Germans in the 27 buildings of hexrows I to P of board U at game end']);
  });

  it('nothing left to play: the condition that settled it, and why the game stopped', () => {
    const d = gameDecision(envOf(LMA6, 'ge'), LMA6, { winner: 'br', reason: 'nothing left to play', turn: 4, phase: 'PFPh' });
    expect(d.how).toBe('No Good Order Germans left in the objective at game end; with nothing left to play, the game ended in Turn 4');
    expect(d.decidedBy).toHaveLength(1);
  });

  it('an immediate win with nothing met says when, and lists nothing', () => {
    const d = gameDecision(envOf(LMA5, null), LMA5, { winner: 'am', reason: 'sudden death', turn: 2, phase: 'MPh' });
    expect(d).toEqual({ how: 'Won immediately in Turn 2 Movement Phase', decidedBy: [] });
  });

  it('a timeout names who ran out the clock', () => {
    expect(gameDecision(envOf(LMA6, null), LMA6, { winner: 'br', reason: 'timeout', turn: 2, phase: 'MPh', loserName: 'Kurt' })).toEqual({ how: 'Kurt ran out the clock in Turn 2', decidedBy: [] });
  });
});
