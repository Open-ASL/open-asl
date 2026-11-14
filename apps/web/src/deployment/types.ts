/** Where a game stands, for tools a deployment adds to the in-game HUD. */
export interface HudGame {
  /** The match, when the game is one (a fixture or a watched replay has none). */
  matchId?: string;
  scenarioId: string;
  scenarioTitle: string;
  turn: number;
  phase: string;
  /** Actions recorded so far: the position the viewer is at. */
  actionCount: number;
  /** The side this browser plays: absent in a local game, null for a spectator. */
  mySide?: string | null;
  /** The ruleset's version hash, which the match pins. */
  ruleset: string;
}

export interface HudToolsProps {
  game: HudGame;
}
