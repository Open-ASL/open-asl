import type { Piece, PieceId, QueryEnv } from '@asl/engine';
import { isBroken, smc } from '@asl/rules';

export interface RallyRefusal {
  leader: PieceId;
  unit: PieceId;
  reason: string;
}

/**
 * The leader rallies the player cannot make here, for greyed "rallies" entries that give the engine's reason, rather
 * than letting them vanish from the wheel: a leader in Melee is not in Good Order and rallies no one (SK1 3.1 f,
 * glossary "Good Order"). For each unbroken leader of `side` here and each of `side`'s broken units here whose rally by
 * that leader is not on offer (`offered`): the reason `check` gives. A broken leader is left out (his own entries are
 * about rallying himself), and so is a unit that already tried to rally this Player Turn (SK1 3.1: once per Player Turn).
 */
export function rallyRefusals(
  env: QueryEnv,
  side: string,
  unitsHere: Piece[],
  offered: (leader: PieceId, unit: PieceId) => boolean,
  check: (leader: PieceId, unit: PieceId) => string | null,
): RallyRefusal[] {
  const own = unitsHere.filter((p) => p.side === side);
  const leaders = own.filter((p) => !!smc(env, p) && !isBroken(p));
  const broken = own.filter((p) => isBroken(p) && !p.tags['rallyTried']);
  const out: RallyRefusal[] = [];
  for (const l of leaders) {
    for (const u of broken) {
      if (u.id === l.id || offered(l.id, u.id)) continue;
      const reason = check(l.id, u.id);
      if (reason) out.push({ leader: l.id, unit: u.id, reason });
    }
  }
  return out;
}

/**
 * The refusals one greyed entry each: a leader's refusals with the same reason go together (a leader in Melee rallies
 * none of the broken units beside him, one entry saying why rather than one per unit).
 */
export function groupRallyRefusals(refusals: RallyRefusal[]): { leader: PieceId; units: PieceId[]; reason: string }[] {
  const out: { leader: PieceId; units: PieceId[]; reason: string }[] = [];
  for (const r of refusals) {
    const g = out.find((x) => x.leader === r.leader && x.reason === r.reason);
    if (g) g.units.push(r.unit);
    else out.push({ leader: r.leader, units: [r.unit], reason: r.reason });
  }
  return out;
}
