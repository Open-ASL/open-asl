/**
 * Time controls for online matches. Every decision gets a deadline from the match's pace and
 * the decision's class. A lapsed deadline does nothing by itself: it only lets the waiting
 * opponent claim the win, or, for an "interrupt" (the defender's first-fire window), pass it on
 * the defender's behalf. Friendly games may ignore the clock entirely.
 */
export type Pace = 'live' | 'daily';
export type DeadlineClass = 'turn' | 'interrupt';

export interface PaceDef {
  id: Pace;
  name: string;
  blurb: string;
  /** Seconds allowed per decision class. */
  limits: Record<DeadlineClass, number>;
  /** Set while the pace cannot be chosen yet: why, shown in the lobby. */
  soon?: string;
}

const MIN = 60;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const PACES: PaceDef[] = [
  { id: 'live', name: 'Live', blurb: '10 minutes per move, 2 for a first-fire call', limits: { turn: 10 * MIN, interrupt: 2 * MIN } },
  {
    id: 'daily',
    name: 'Correspondence',
    blurb: '3 days per move, 1 for a first-fire call',
    limits: { turn: 3 * DAY, interrupt: 1 * DAY },
    // Correspondence play needs the play-ahead model (the mover plays on past first-fire
    // windows; the defender reviews step by step) before it is playable at this pace.
    soon: 'Play-ahead for correspondence games is still being built',
  },
];

export const DEFAULT_PACE: Pace = 'live';

/** The paces a new match may be given. */
export const availablePace = (pace: Pace) => !paceDef(pace).soon;

export const paceDef = (pace: Pace | undefined): PaceDef => PACES.find((p) => p.id === pace) ?? PACES.find((p) => p.id === DEFAULT_PACE)!;

/** Milliseconds allowed for a decision of the given class at this pace. */
export const allowanceMs = (pace: Pace | undefined, cls: DeadlineClass) => paceDef(pace).limits[cls] * 1000;

/** "9:41", "2 d 3 h", "17 h", or "0:00" once passed. */
export function formatLeft(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s >= 2 * DAY) return `${Math.floor(s / DAY)} d ${Math.floor((s % DAY) / HOUR)} h`;
  if (s >= 2 * HOUR) return `${Math.floor(s / HOUR)} h ${Math.floor((s % HOUR) / MIN)} min`;
  return `${Math.floor(s / MIN)}:${String(s % MIN).padStart(2, '0')}`;
}
