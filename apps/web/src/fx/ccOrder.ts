/**
 * The order the dice of a simultaneous Close Combat are played to the player in. The engine rolls every DR of the
 * batch before it applies any result (SK1 3.8: CC is simultaneous), so its log reads: one side's roll, the other
 * side's roll, then the first attack's results, then the second's. Played in that order the two rolls land a beat
 * apart and every outcome arrives at once, which is hard to follow. Shown instead, each side's roll is followed by
 * its own outcome before the next roll appears. Results are unchanged (they were fixed before either was applied);
 * only the telling is.
 *
 * A batch is a run of "CC <side> in <hex>" rolls followed by one `sk1.cc.attack` per rolled side (the events between
 * them, Random Selection included, go with the attack they precede). A Field Promotion (an original 2, SK1 5.3) is made
 * for every such roll before any result is applied, so the engine logs it ahead of the first side's result whichever
 * side rolled it: its dr and what follows it (the new leader) go with the side whose attack it was made for, after that
 * side's roll. Anything else (a lone roll, as in an ambush's sequential CC, or a log that does not match) is played as
 * logged.
 */
export interface FxEvent {
  type: string;
  payload: unknown;
}

const ccRollSide = (e: FxEvent): string | null => {
  if (e.type !== 'dice.rolled') return null;
  const m = /^CC (\S+) in /.exec(String((e.payload as { label?: unknown }).label ?? ''));
  return m ? m[1]! : null;
};

const attackSide = (e: FxEvent): string | null => (e.type === 'sk1.cc.attack' ? String((e.payload as { side?: unknown }).side) : null);
/** The MMC a Field Promotion dr is rolled for ("Leader Creation for <unit>"), or null. */
const promotionUnit = (e: FxEvent): string | null => {
  if (e.type !== 'dice.rolled') return null;
  const m = /^Leader Creation for (\S+)$/.exec(String((e.payload as { label?: unknown }).label ?? ''));
  return m ? m[1]! : null;
};

const partOfPromotion = (e: FxEvent): boolean => {
  const p = e.payload as { label?: unknown };
  if (e.type === 'piece.created' || e.type === 'sk1.leaderCreation' || e.type === 'piece.tagged') return true;
  return e.type === 'dice.rolled' && String(p.label ?? '').includes('MMC the new leader defends with');
};

export function ccPlayOrder<E extends FxEvent>(events: E[]): E[] {
  const out: E[] = [];
  let i = 0;
  while (i < events.length) {
    if (!ccRollSide(events[i]!)) {
      out.push(events[i++]!);
      continue;
    }
    let j = i;
    const rolls = new Map<string, E>();
    while (j < events.length && ccRollSide(events[j]!) && !rolls.has(ccRollSide(events[j]!)!)) rolls.set(ccRollSide(events[j]!)!, events[j++]!);
    // The batch's attacks, to tell whose attack a Field Promotion was made for (the MMC it is based on attacked in it).
    const attackers = new Map<string, string[]>();
    for (let a = j; a < events.length && attackers.size < rolls.size && !ccRollSide(events[a]!); a++) {
      const side = attackSide(events[a]!);
      if (side && rolls.has(side) && !attackers.has(side)) attackers.set(side, ((events[a]!.payload as { attack?: { attackers?: string[] } }).attack?.attackers ?? []).map(String));
    }
    const sideOfUnit = (unit: string) => [...attackers].find(([, units]) => units.includes(unit))?.[0] ?? null;
    const segments: { side: string; events: E[] }[] = [];
    let current: E[] = [];
    /** A Field Promotion's events, held for the side it belongs to. */
    const promotions = new Map<string, E[]>();
    let promoting: string | null = null;
    let k = j;
    while (k < events.length && segments.length < rolls.size && !ccRollSide(events[k]!)) {
      const e = events[k++]!;
      const side = attackSide(e);
      const unit = promotionUnit(e);
      if (unit) promoting = sideOfUnit(unit);
      // A Field Promotion is its dr, the leader it creates, his MMC picked by Random Selection and his stacking on it;
      // whatever else follows (the first result) is not part of it.
      else if (promoting && !partOfPromotion(e)) promoting = null;
      if (side && rolls.has(side) && !segments.some((s) => s.side === side)) {
        promoting = null;
        segments.push({ side, events: [...(promotions.get(side) ?? []), ...current, e] });
        promotions.delete(side);
        current = [];
      } else if (promoting && !segments.some((s) => s.side === promoting)) promotions.set(promoting, [...(promotions.get(promoting) ?? []), e]);
      else current.push(e);
    }
    if (rolls.size < 2 || segments.length !== rolls.size || promotions.size) {
      out.push(...events.slice(i, j));
      i = j;
      continue;
    }
    for (const s of segments) out.push(rolls.get(s.side)!, ...s.events);
    i = k;
  }
  return out;
}
