import { gameDecision, plural } from '@asl/aar';
import type { GameState, QueryEnv } from '@asl/engine';
import { PHASE_NAME, hasUnitsLeft, type ScenarioDef } from '@asl/rules';

/** The game-over screen's account of a finished game: why it ended, and the victory conditions that decided it. */
export interface GameOverText {
  reason: string;
  /** The winner's met conditions as the card words them; empty for a concession or a game no condition decided. */
  decidedBy: string[];
}

/**
 * Why the game ended, in the words the victory screen shows. Where the winner met a victory condition the screen lists
 * it, so a win under a second condition of the card (a special rule's) reads as that rather than as a bare "scenario end".
 */
export function gameOverText(env: QueryEnv, scenario: ScenarioDef, state: GameState, sideName: (s: string) => string): GameOverText | null {
  const result = state.result;
  if (!result) return null;
  const { how, decidedBy } = gameDecision(env, scenario, { winner: result.winner, reason: result.reason, turn: state.turn, phase: state.phase });
  const gone = state.sides.find((x) => !hasUnitsLeft(env, x));
  switch (result.reason) {
    case 'concession':
      return { reason: result.winner ? `The ${plural(sideName(state.sides.find((x) => x !== result.winner)!))} concede` : how, decidedBy: [] };
    case 'annihilation':
      return { reason: gone ? `The ${plural(sideName(gone))} have no units left` : how, decidedBy };
    case 'nothing left to play':
      return { reason: 'Nothing left on the map can change the result', decidedBy };
    case 'scenario end':
      return { reason: decidedBy.length ? `The game ended after Turn ${state.turn}` : how, decidedBy };
    case 'sudden death':
      return { reason: decidedBy.length ? `Won immediately in Turn ${state.turn} ${PHASE_NAME[state.phase] ?? state.phase}` : how, decidedBy };
    default:
      return { reason: how, decidedBy };
  }
}
