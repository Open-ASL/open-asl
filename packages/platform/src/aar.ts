import type { MatchMode, Timestamp } from './types';
import type { Competition } from './lobby';

/*
 * aars/{matchId}: the after action report of a finished public (or hotseat, or computer) match,
 * computed once on the server when the match completes and stored whole. Everything the report
 * page and the share card show is here, so a report survives ruleset upgrades that would stop
 * the recording replaying. Readable by anyone, written only by the server.
 */

/** 2: control.byTurn rows became { holders } objects (Firestore rejects arrays of arrays). */
export const AAR_VERSION = 2;

export interface AarPlayer {
  uid: string | null;
  nickname: string;
  /** Rating going into the match (ranked only). */
  elo?: number;
  /** Signed rating change (ranked only). */
  eloDelta?: number;
  /** The seat was the computer opponent's. */
  computer?: boolean;
}

export interface AarSide {
  side: string;
  /** The card's name for the side ("German", "Allied"). */
  name: string;
  nationality: string;
  player: AarPlayer;
  /** Moved first. */
  attacker: boolean;
}

export interface AarResult {
  winner: string | null;
  /** 'scenario end' | 'sudden death' | 'annihilation' | 'concession' | 'timeout'. */
  reason: string;
  /** One sentence on how the game was decided, e.g. "Held F8, L6 and O6 at the end of Turn 6". */
  how: string;
  endedTurn: number;
  endedPhase: string;
  /** The side whose player turn it was when the game ended. */
  endedAttacker: string;
}

export interface AarVictoryItem {
  /** A building or hex ("F8"), or a tally line ("Exit VP"). */
  label: string;
  /** The side holding it at the end, for Control conditions. */
  holder?: string | null;
  /** When it changed hands last ("T3"), for Control conditions. */
  since?: string;
}

/** One victory condition as printed, and how it stood at the end. */
export interface AarVictory {
  side: string;
  text: string;
  met: boolean;
  have: number;
  need: number;
  items: AarVictoryItem[];
}

/** Who held each objective at the end of every Game Turn (null: nobody yet). */
export interface AarControl {
  kind: 'buildings' | 'hexes';
  labels: string[];
  /** byTurn[turn - 1].holders[objective] = side id | null. Rows are objects: Firestore does not store arrays of arrays. */
  byTurn: { holders: (string | null)[] }[];
}

/** A race of two tallies per player turn (CVP inflicted, exit VP earned), for scenarios without Control objectives. */
export interface AarRace {
  kind: 'cvp' | 'exitVp' | 'vp';
  /** What is counted, e.g. "Casualty VP inflicted". */
  label: string;
  labels: string[];
  sides: Record<string, number[]>;
  /** The number a side needs, when one is printed. */
  goal?: Record<string, number>;
}

/** A per-player-turn series: labels[0] is the setup, then "1 Ge", "1 Ru"... */
export interface AarSeries {
  labels: string[];
  sides: Record<string, number[]>;
}

/** Squad-equivalents on the board (half-squads ½, leaders not counted) per player turn, and the player turns with a loss. */
export interface AarStrength extends AarSeries {
  losses: Record<string, number[]>;
}

export interface AarDice {
  /** Two-dice rolls. */
  drs: number;
  /** Mean DR over `drs`; 0 when none. */
  avg: number;
  /** Counts of DR 2 … 12 (11 entries). */
  hist: number[];
  twos: number;
  twelves: number;
  mc: { passed: number; failed: number };
  rally: { made: number; failed: number };
  /** ELR replacements suffered. */
  elr: number;
  /** Leaders created (Heat of Battle / field promotion). */
  hob: number;
  /** Longest run of morale checks passed. */
  streak: number;
}

/** Running total of (7 − DR) per player turn, and the original 2s and 12s along the way. */
export interface AarLuck extends AarSeries {
  marks: Record<string, { at: number; v: 2 | 12 }[]>;
}

export interface AarCasualty {
  side: string;
  turn: number;
  phase: string;
  /** The counter when the loss was taken ("ge.467"), for its image. */
  def: string;
  /** The counter it became when Casualty Reduced. */
  to?: string;
  /** "4-6-7", "8-1 leader", "PzKpfw IVH". */
  label: string;
  /** Weapons it was carrying ("LMG", "DC"). */
  sw?: string;
  /** The hex it died in, without its board letter; null when unknown. */
  hex: string | null;
  kind: 'eliminated' | 'reduced';
  leader?: boolean;
  vehicle?: boolean;
  /** In plain words: "KIA · 12 FP from L7, DR 3". */
  cause: string;
  cvp: number;
}

export interface AarHighlight {
  /** The side it favoured, or null for a neutral event. */
  side: string | null;
  turn: number;
  phase: string;
  title: string;
  text: string;
  /** Higher is more notable; the page shows the top few. */
  weight: number;
}

export interface AarDoc {
  version: number;
  matchId: string;
  scenario: { id: string; number: string; title: string; place: string; date: string; turns: number; victoryText: string };
  mode: MatchMode;
  competition: Competition;
  /** Date the match completed. */
  playedAt: Timestamp;
  /** Wall-clock length of the match, when known. */
  durationMin: number | null;
  sides: AarSide[];
  result: AarResult;
  victory: AarVictory[];
  control: AarControl | null;
  race: AarRace | null;
  strength: AarStrength;
  dice: Record<string, AarDice>;
  luck: AarLuck;
  casualties: AarCasualty[];
  highlights: AarHighlight[];
  createdAt: Timestamp;
}
