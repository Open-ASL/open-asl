/**
 * US Army ranks as they stood in the Second World War (1942-48 grades), climbed by experience.
 * Technician grades are left out so the ladder is linear.
 */
export interface Rank {
  id: string;
  title: string;
  /** Short form as it would appear on a roster. */
  abbr: string;
  /** Enlisted ranks wear chevrons; officers wear bars, leaves, eagles and stars. */
  kind: 'enlisted' | 'officer';
  minXp: number;
}

export const RANKS: readonly Rank[] = [
  { id: 'pvt', title: 'Private', abbr: 'Pvt.', kind: 'enlisted', minXp: 0 },
  { id: 'pfc', title: 'Private First Class', abbr: 'Pfc.', kind: 'enlisted', minXp: 100 },
  { id: 'cpl', title: 'Corporal', abbr: 'Cpl.', kind: 'enlisted', minXp: 300 },
  { id: 'sgt', title: 'Sergeant', abbr: 'Sgt.', kind: 'enlisted', minXp: 700 },
  { id: 'ssg', title: 'Staff Sergeant', abbr: 'S/Sgt.', kind: 'enlisted', minXp: 1300 },
  { id: 'tsg', title: 'Technical Sergeant', abbr: 'T/Sgt.', kind: 'enlisted', minXp: 2100 },
  { id: 'msg', title: 'Master Sergeant', abbr: 'M/Sgt.', kind: 'enlisted', minXp: 3100 },
  { id: '2lt', title: 'Second Lieutenant', abbr: '2nd Lt.', kind: 'officer', minXp: 4400 },
  { id: '1lt', title: 'First Lieutenant', abbr: '1st Lt.', kind: 'officer', minXp: 6000 },
  { id: 'cpt', title: 'Captain', abbr: 'Capt.', kind: 'officer', minXp: 7900 },
  { id: 'maj', title: 'Major', abbr: 'Maj.', kind: 'officer', minXp: 10100 },
  { id: 'ltc', title: 'Lieutenant Colonel', abbr: 'Lt. Col.', kind: 'officer', minXp: 12700 },
  { id: 'col', title: 'Colonel', abbr: 'Col.', kind: 'officer', minXp: 15700 },
  { id: 'bg', title: 'Brigadier General', abbr: 'Brig. Gen.', kind: 'officer', minXp: 19200 },
  { id: 'mg', title: 'Major General', abbr: 'Maj. Gen.', kind: 'officer', minXp: 23300 },
  { id: 'ltg', title: 'Lieutenant General', abbr: 'Lt. Gen.', kind: 'officer', minXp: 28100 },
  { id: 'gen', title: 'General', abbr: 'Gen.', kind: 'officer', minXp: 33700 },
  { id: 'ga', title: 'General of the Army', abbr: 'Gen. Army', kind: 'officer', minXp: 41100 },
];

/** The highest rank whose threshold the experience meets. */
export function rankFor(xp: number): Rank {
  let r = RANKS[0]!;
  for (const rank of RANKS) if (xp >= rank.minXp) r = rank;
  return r;
}

/** The next rank up and how far away it is, or null at the top. */
export function nextRank(xp: number): { rank: Rank; remaining: number; progress: number } | null {
  const current = rankFor(xp);
  const idx = RANKS.indexOf(current);
  const next = RANKS[idx + 1];
  if (!next) return null;
  const span = next.minXp - current.minXp;
  return { rank: next, remaining: next.minXp - xp, progress: Math.min(1, (xp - current.minXp) / span) };
}
