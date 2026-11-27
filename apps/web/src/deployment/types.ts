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
  /** What the game screen shows besides the board (a bug report records it). */
  ui?: HudUi;
}

/** The game screen's own state: what the orders panel and the map are showing. */
export interface HudUi {
  /** The kind of decision the game waits on, if any. */
  decision: string | null;
  /** Dice still being shown: orders wait until they are. */
  resolving: boolean;
  /** An action wheel open on the map. */
  wheel: boolean;
  /** The phase wheel playing (the cinematic that announces a new phase or Player Turn). */
  phaseWheel: boolean;
  /** The orders panel folded away. */
  sideCollapsed: boolean;
}

export interface HudToolsProps {
  game: HudGame;
}
