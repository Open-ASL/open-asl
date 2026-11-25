import type { Timestamp } from './types';

/**
 * Super spectators: commentators who stream a match (live or finished) and work its board for their audience. They
 * hold the `superSpectator` custom claim (granted by an administrator, account-wide). Every super spectator watching a
 * match shares one room: the board position they look at, their pings and ink, and the checks they run. The players of
 * the match never see any of it, and a seated player gets none of it in their own match.
 */
export const SS_COL = {
  /** Subcollection of a match: `state` holds the room's shared board (see SsRoomDoc). */
  room: 'ssRoom',
  /** Subcollection of a match, one doc per super spectator present (see SsMemberDoc). */
  members: 'ssMembers',
  /** Subcollection of a match, one doc per super spectator: their last ping. */
  pings: 'ssPings',
  /** Subcollection of a match, one doc per stroke of ink on the map. */
  strokes: 'ssStrokes',
} as const;

/** The room's one document. */
export const SS_ROOM_DOC = 'state';

/** Ink and ping colours, handed out in the order commentators join; each stands out on any terrain and from the players' own ping colours. */
export const SS_COLORS = [0xff7a00, 0x00e676, 0xff1744, 0x2979ff, 0xffea00, 0xd500f9, 0x00e5ff, 0xffffff] as const;

/** The colour for the `n`th commentator to join (0-based), cycling when there are more than colours. */
export function ssColor(n: number): number {
  return SS_COLORS[((n % SS_COLORS.length) + SS_COLORS.length) % SS_COLORS.length]!;
}

/** Ink line widths offered, in screen pixels at 100% zoom. */
export const SS_WIDTHS = [3, 6, 10, 16] as const;

/** A member doc older than this is someone who has left (its colour may be handed out again). */
export const SS_MEMBER_STALE_MS = 60 * 60 * 1000;

/** Where the room's board stands: following the live game, or a step of the recording. */
export type SsCursor = 'live' | number;

/** A piece moved or taken off in the room's virtual board: its new location, or `null` for removed. */
export type SsVirtualLoc = { kind: 'hex'; hex: string } | null;

/**
 * The room's virtual board: changes made by hand to the position at step `base`, seen only in the room. Snapping back
 * clears it.
 */
export interface SsVirtual {
  /** The step of the recording the changes were made to. */
  base: number;
  /** Piece id → where it now is (`null`: off the board). */
  moves: Record<string, SsVirtualLoc>;
}

/**
 * A check the room is looking at; every client works its result out from the displayed position. An empty `to` or
 * `target` is a check still being set up (its first hexes picked).
 */
export type SsCheck =
  | { kind: 'los'; from: string; to: string; n: number }
  | {
      kind: 'shot';
      /** The firing hexes. */
      firers: string[];
      /** Pieces there left out of the attack. */
      exclude: string[];
      target: string;
      /** A FireMode of the rules ('prep', 'first', 'subsequentFirst', 'fpf', 'final', 'advancing'). */
      mode: string;
      areaFire: boolean;
      moving: 'none' | 'moving' | 'assault';
      /** An ordnance weapon checked on its To Hit Table instead (null: the IFT attack of the rest). */
      weapon?: string | null;
      n: number;
    };

/** The danger map shown: the fire the side's enemy can put on each hex. One side at a time. */
export interface SsHeat {
  /** The side under threat. */
  side: string;
  /** Prep Fire or Defensive First Fire (the full FP), or Advancing Fire (half). */
  mode: 'prep' | 'first' | 'advancing';
  sw: boolean;
  /**
   * What colours a hex: the chance a Good Order squad there is broken or worse ('break': TEM, hindrance and leadership
   * counted), or the FP that can reach it ('fp'). Absent on a room set before there was a choice: 'break'.
   */
  measure?: 'break' | 'fp';
}

export interface SsRoomDoc {
  cursor: SsCursor;
  virtual: SsVirtual | null;
  /** Per side: whether that side's hidden information (concealed and hidden units, secret choices) is shown. */
  show: Record<string, boolean>;
  /** Rises with "erase all": ink from an earlier epoch is no longer drawn. */
  epoch: number;
  check: SsCheck | null;
  heat: SsHeat | null;
  /**
   * Autoplay: the commentator whose board steps the shared cursor on (null: paused). One board drives it, so the room's
   * boards never race each other; anyone may take it over by pressing Play.
   */
  play?: string | null;
  /** Autoplay speed, an index into the replay bar's speeds; shared, so every board moves at one pace. */
  speed?: number;
  by: string;
  at: Timestamp;
}


export interface SsMemberDoc {
  uid: string;
  name: string;
  /** Index into SS_COLORS. */
  color: number;
  at: Timestamp;
}

export interface SsPingDoc {
  uid: string;
  hex: string;
  /** Rises with every ping (the sender's clock), so a repeat of the same hex is still seen. */
  n: number;
  color: number;
  x?: number;
  y?: number;
  at: Timestamp;
}

export interface SsStrokeDoc {
  uid: string;
  color: number;
  /** Line width in map pixels. */
  width: number;
  /** x0, y0, x1, y1, … in map pixels (the board's own coordinates, the same on every screen whatever its zoom or turn). */
  points: number[];
  epoch: number;
  at: Timestamp;
}

/** Most points a stroke keeps: a long scribble is thinned to this many so one stroke stays a small document. */
export const SS_STROKE_POINTS = 600;

/** The room as it starts: following the live game, nothing hidden shown, no ink, no checks. */
export function emptySsRoom(): Omit<SsRoomDoc, 'by' | 'at'> {
  return { cursor: 'live', virtual: null, show: {}, epoch: 0, check: null, heat: null, play: null, speed: 0 };
}

/** The colour index a newcomer takes: the lowest one no member present is using. */
export function freeSsColor(taken: number[]): number {
  for (let i = 0; i < SS_COLORS.length; i++) if (!taken.includes(i)) return i;
  return taken.length % SS_COLORS.length;
}

/**
 * Thin a stroke's points (flat x, y pairs) to at most `max` points, keeping the first and last, and drop points closer
 * than `minGap` to the one kept before them (a pointer that barely moved).
 */
export function thinStroke(points: number[], max = SS_STROKE_POINTS, minGap = 1.5): number[] {
  const kept: number[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    const x = points[i]!;
    const y = points[i + 1]!;
    const n = kept.length;
    const last = i + 2 >= points.length;
    if (n >= 2 && !last && Math.hypot(x - kept[n - 2]!, y - kept[n - 1]!) < minGap) continue;
    kept.push(x, y);
  }
  const count = kept.length / 2;
  if (count <= max) return kept;
  const out: number[] = [];
  for (let k = 0; k < max; k++) {
    const i = Math.round((k * (count - 1)) / (max - 1));
    out.push(kept[2 * i]!, kept[2 * i + 1]!);
  }
  return out;
}
