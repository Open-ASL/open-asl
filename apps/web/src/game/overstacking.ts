import type { PieceId, QueryEnv, SideId } from '@asl/engine';
import { advanceTerms, defOf, hexOfLoc, isKnownTo, levelOfLoc, locOf, otherSide, overstackBy, overstackEntryMf, pieceLabel, type MoveState } from '@asl/rules';

/*
 * What a player sees of full ASL overstacking (ASLRB A5.1, A5.11, A5.12, A5.131, A5.132, A4.72, A10.62). No step asks for a
 * confirmation: the board marks every overstacked Location, a step or advance into one names its extra MF and what it
 * brings, and the fire and CC panels list the DRM. Pure functions of the engine's view, so the app and its tests read the
 * same answers. Full ASL only: the Starter Kit has a hard cap (its steps are refused instead).
 */

const hexName = (h: string) => hexOfLoc(h).replace(/^[a-z]/, '');
const levelNote = (loc: string) => (levelOfLoc(loc) > 0 ? ` level ${levelOfLoc(loc)}` : '');

/** A board badge on an overstacked Location. */
export interface OverstackBadge {
  hex: string;
  loc: string;
  side: SideId;
  text: string;
  hint: string;
}

/**
 * Each Location a side has overstacked, as `viewer` knows it (null: every unit the view holds): "OVERSTACKED +1", the A5.12
 * attack penalty (Personnel and vehicles beyond the limits). Hidden units of the other side never count for a viewer.
 */
export function overstackBadges(env: QueryEnv, viewer: SideId | null): OverstackBadge[] {
  const seen = new Set<string>();
  const out: OverstackBadge[] = [];
  const pieces = Object.values(env.state.pieces)
    .filter((p) => p.loc.kind === 'hex' && (viewer === null || p.side === viewer || isKnownTo(env, p, viewer)))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const p of pieces) {
    const loc = locOf(env.state, p);
    if (!loc || seen.has(`${loc}|${p.side}`)) continue;
    seen.add(`${loc}|${p.side}`);
    const o = overstackBy(env, loc, p.side, viewer ?? undefined);
    if (o.personnel + o.vehicles === 0) continue;
    const parts = [...(o.personnel ? [`${o.personnel} squad-equivalent${o.personnel > 1 ? 's' : ''}`] : []), ...(o.vehicles ? [`${o.vehicles} vehicle${o.vehicles > 1 ? 's' : ''}`] : [])];
    out.push({
      hex: hexOfLoc(loc),
      loc,
      side: p.side,
      text: `OVERSTACKED +${o.personnel + o.vehicles}${levelNote(loc)}`,
      hint: `${hexName(loc)}${levelNote(loc)} is overstacked by ${parts.join(' and ')}: +${o.personnel + o.vehicles} to every attack from it (A5.12)${o.personnel ? `, -${o.personnel} to attacks on its Personnel (A5.131; in the MPh only on the moving units, A5.13)` : ''}${o.vehicles ? '; a Vehicle Target Type shot that just misses may hit another vehicle there (A5.132)' : ''}`,
    });
  }
  return out;
}

/** The A5.11 note on a step of the moving stack into `to`: its extra MF and what overstacking brings, or null. */
export function overstackStepNote(env: QueryEnv, ms: MoveState, to: string): { badge: string; warning: string } | null {
  const side = env.state.attacker;
  const mf = overstackEntryMf(env, to, ms.vehicle ? [] : ms.units, side);
  if (mf <= 0) return null;
  const cost = env.query('move.stepCost', { ms, to }, 1);
  const unit = ms.vehicle ? 'MP' : 'MF';
  const after = ms.vehicle ? null : overstackAfter(env, to, ms.units, side);
  return {
    badge: `${cost} ${unit} (+${mf} overstacked, A5.11)`,
    warning: after
      ? `Overstacks ${hexName(to)} by ${after}: +${after} to its attacks, -${after} to attacks on it (A5.12, A5.131)`
      : `${hexName(to)} is overstacked by Personnel: +${mf} ${unit} to enter (A5.11)`,
  };
}

/** By how much `side` would overstack `loc` once `movers` are in it (FRU): the A5.11 MF less the Known enemy's own excess. */
function overstackAfter(env: QueryEnv, loc: string, movers: PieceId[], side: SideId): number {
  return Math.max(0, overstackEntryMf(env, loc, movers, side) - overstackBy(env, loc, otherSide(env.state, side), side).personnel);
}

/**
 * The note on an advance of `units` into `to` (A5.11, A4.72): its cost when overstacking adds to it, and who becomes CX
 * ("4 MF: the 4-4-7 becomes CX (A4.72)"); null when neither applies.
 */
export function advanceNote(env: QueryEnv, units: PieceId[], to: string): string | null {
  const terms = advanceTerms(env, units, to).filter((t) => Number.isFinite(t.cost));
  if (!terms.length) return null;
  const extra = overstackEntryMf(env, to, units, env.state.attacker);
  const cx = terms.filter((t) => t.cx && !env.state.pieces[t.unit]?.tags['cx']);
  if (!extra && !cx.length) return null;
  const cost = Math.max(...terms.map((t) => t.cost));
  const who = cx.map((t) => shortName(env, t.unit)).join(', ');
  return `${cost} MF${extra ? ` (+${extra} overstacked, A5.11)` : ''}${cx.length ? `: the ${who} ${cx.length > 1 ? 'become' : 'becomes'} CX (A4.72)` : ''}`;
}

/** A counter's short name: "4-6-7", "PzKpfw IVF2". */
function shortName(env: QueryEnv, id: PieceId): string {
  const p = env.state.pieces[id];
  if (!p) return id;
  const d = defOf(env, p) as { kind: string; fp?: number; range?: number; morale?: number };
  if ((d.kind === 'squad' || d.kind === 'hs' || d.kind === 'crew') && d.fp !== undefined) return `${d.fp}-${d.range}-${d.morale}`;
  return pieceLabel(env, p).replace(/^\S+ /, '').replace(/ leader$/, '');
}

/**
 * The enemy vehicles a Vehicle Target Type shot (or a PF) at `loc` must name one of (A5.2): each with its label; empty when
 * the Location holds at most one (the shot takes it).
 */
export function vehicleTargets(env: QueryEnv, loc: string, side: SideId): { id: PieceId; label: string }[] {
  const ids = env.query('ordnance.vttTargets', { target: loc, side }, [] as PieceId[]);
  return ids.map((id) => ({ id, label: shortName(env, id) }));
}

/** The log line of an A5.132 dr after a Vehicle Target Type miss. */
export function strayHitText(p: { target: string; by: number; vehicles: number; dr: number; hit: string | null }, name: (id: string) => string): string {
  const missed = `Missed the ${name(p.target).replace(/^\S+ /, '')} by ${p.by} (< ${p.vehicles} vehicles in the hex)`;
  return p.hit ? `  ↯ ${missed}: overstack dr ${p.dr} < ${p.vehicles} hits the ${name(p.hit).replace(/^\S+ /, '')} (A5.132)` : `  ↯ ${missed}: overstack dr ${p.dr}, no other vehicle hit (A5.132)`;
}
