/**
 * Core engine data model.
 *
 * Everything in GameState is plain, JSON-serializable data. The only way to change
 * state is to apply an Event; rule modules decide *which* events happen.
 */

export type SideId = string;
export type PieceId = string;
/** Fully-qualified hex id: board letter(s) + column + row, e.g. "yK2". */
export type HexId = string;

export type Scalar = string | number | boolean | null;

/** Where a piece currently is. */
export type Location =
  /**
   * On the map. `level`, `sub` and `pos` place it within the hex (ASLRB A2.8: upper building levels, a pillbox,
   * a rooftop or bridge are Locations of their own; a foxhole or trench is a position within one, B27.13). They
   * are never written as 0 or false: a piece at ground level is `{ kind: 'hex', hex }`, as in the Starter Kit.
   */
  | { kind: 'hex'; hex: HexId; level?: number; sub?: 'pb' | 'roof' | 'bridge' | 'cave'; pos?: { ent?: 'foxhole' | 'trench' | 'ditch' } }
  /** Off the map. `hex` is a virtual offboard hex beside the entry edge once the unit is set up there. */
  | { kind: 'offboard'; edge?: string; hex?: HexId }
  | { kind: 'held'; by: PieceId }
  | { kind: 'eliminated' };

/**
 * A game piece instance (squad, leader, SW, ...). Static numbers live in the
 * counter definition (`defId`); `tags` carries mutable status (broken, pinned,
 * CX, DM, wounded, ...). Rule modules own the meaning of their tags.
 */
export interface Piece {
  id: PieceId;
  defId: string;
  side: SideId;
  loc: Location;
  tags: Record<string, Scalar>;
}

/** A question the engine is waiting for a specific side to answer. */
export interface Decision {
  id: string;
  kind: string;
  owner: SideId;
  /** Drives async time controls: main turns forfeit on timeout, interrupts fall back to a default. */
  deadlineClass: 'turn' | 'interrupt';
  data?: Record<string, unknown>;
}

export interface RngState {
  /** xoshiro128** state words. */
  s: [number, number, number, number];
  /** Antithetic dice: every die turned over (`seedRng`'s `MIRROR` seeds). */
  mirror?: true;
}

export interface GameResult {
  winner: SideId | null;
  reason: string;
}

export interface GameState {
  rulesetId: string;
  scenarioId: string;
  /** Number of events applied so far. */
  seq: number;
  turn: number;
  phase: string;
  /** Side whose Player Turn it is (the ATTACKER). */
  attacker: SideId;
  sides: SideId[];
  pieces: Record<PieceId, Piece>;
  /** Per-location markers that aren't attached to a piece (Smoke, Residual FP, Melee, ...). */
  hexMarkers: Record<HexId, Record<string, Scalar>>;
  /** Stack of outstanding decisions; the last element is the one being asked. */
  decisions: Decision[];
  rng: RngState;
  result: GameResult | null;
  /** State slices owned by rule modules, keyed by module id. */
  ext: Record<string, unknown>;
}

export interface GameEvent<P = unknown> {
  type: string;
  payload: P;
  /** Id of the module/handler that produced the event, for logs and debugging. */
  source?: string;
}

/** Event as recorded in a game log (sequence-numbered). */
export interface LoggedEvent<P = unknown> extends GameEvent<P> {
  seq: number;
}

/** A player intent. Must answer the current decision. */
export interface Action {
  type: string;
  side: SideId;
  decisionId: string;
  [key: string]: unknown;
}

export class RuleError extends Error {
  constructor(
    message: string,
    readonly code = 'illegal',
  ) {
    super(message);
    this.name = 'RuleError';
  }
}
