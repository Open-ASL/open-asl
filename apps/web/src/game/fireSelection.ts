import type { HexId, Piece, PieceId, QueryEnv, SideId } from '@asl/engine';
import { UNKNOWN_DEF_ID, defOf, enemyVehicleAt, fireGroupContiguous, fireMarker, hexOf, hexOfLoc, isGoodOrder, isRofShot, mmc, ordnanceOf, personnelInHex, smc, statics, swHeldBy, unitsInHex, vehicle } from '@asl/rules';

/**
 * What a click on an own stack picks up in a fire phase, so the stack is ready to shoot as
 * selected: Good Order units (not broken, not in Melee) that have not finished firing this
 * phase, with their working SW. A unit marked First Fire may still fire again (Subsequent First
 * Fire, FPF, Final Fire). `here` is the acting side's personnel in the hex.
 */
export function fireSelectable(env: QueryEnv, here: Piece[], opts: { firstFire: boolean; phase: string }): PieceId[] {
  const done = (p: Piece) => {
    const m = fireMarker(p);
    return opts.firstFire ? false : opts.phase === 'DFPh' ? m === 'final' : !!m;
  };
  // A Gun or Light Mortar fires on its own, through its "Fire …" entry; a unit's other SW fire with it.
  // A DC cannot fire at all: it only attacks by being placed (the "Place DC…" entry in the MPh),
  // so it is never picked up here or it would make every shot from the stack illegal.
  const isDc = (sw: Piece) => (defOf(env, sw) as { type?: string }).type === 'DC';
  // An ATR is both: its "Fire ATR" entry at a vehicle, and a 1 FP SW firing with its unit at Infantry (SK4 4.4.4).
  const isAtr = (sw: Piece) => (defOf(env, sw) as { type?: string }).type === 'ATR';
  const swReady = (p: Piece) => swHeldBy(env.state, p.id).filter((sw) => !sw.tags['malf'] && (!ordnanceOf(env, sw) || isAtr(sw)) && !isDc(sw) && !done(sw)).map((sw) => sw.id);
  // A unit that has fired keeps offering the SW it has not fired, and one that kept its Rate of Fire (left
  // unmarked, SK1 1.2.4): a squad may fire its own FP and its SW in separate attacks (SK1 3.2, 4.2; player
  // report 2026-11-06: a Para's FT after the squad fired). The rules judge whether its holder still may.
  const pick = (ps: Piece[]) => ps.filter((p) => isGoodOrder(env, p)).flatMap((p) => (!done(p) ? [p.id, ...swReady(p)] : swReady(p)));
  // Beside Infantry that may fire, a vehicle and the weapons it holds stay out: its MG/IFE form Fire Groups only with
  // each other (SK4 3.2), and it fires from its own entries (MA, MGs, IFE + MGs). A vehicle alone in the hex is picked up.
  const infantry = pick(here.filter((p) => !vehicle(env, p)));
  return infantry.length ? infantry : pick(here);
}

/**
 * Why a stack cannot join the declared fire group, or null when it can: every firing hex must be next to another one
 * holding a squad, HS or crew of the group (SK1 3.2; a leader alone is no link). The group is built one stack at a
 * time, so a stack two hexes away joins only after one in between.
 */
export function addToGroupBlocked(env: QueryEnv, selected: Iterable<PieceId>, own: PieceId[]): string | null {
  // As the engine counts firers: the units, and a SW's holder; a leader who only directs is not one (ASLRB A7.5: a
  // leader alone is a link only when he fires a SW).
  const firers = [...selected, ...own].filter((id) => {
    const p = env.state.pieces[id];
    return !!p && (p.loc.kind === 'held' || !smc(env, p));
  });
  return fireGroupContiguous(env, firers) ? null : 'Not next to the fire group: each firing hex must be adjacent to another with a squad, HS or crew in it (SK1 3.2). Add a stack in between first';
}

/**
 * The units among `ids` that only carry a ticked weapon: a half-squad or crew that has fired a SW this phase has
 * forfeited its own FP (SK1 4.0), so ticked with that weapon it adds no FP; the weapon fires alone.
 */
export function swCarriers(env: QueryEnv, ids: Iterable<PieceId>): PieceId[] {
  const all = [...ids];
  return all.filter((id) => env.state.pieces[id]?.tags['ownFpForfeit'] === true && all.some((w) => { const l = env.state.pieces[w]?.loc; return l?.kind === 'held' && l.by === id; }));
}

/**
 * The units in a fire declaration that cannot reach its target: beyond twice their printed range, the limit of Long
 * Range Fire (SK1 3.2). They take no part in the attack, but the SW they hold may still fire at it on its own range
 * (SK1 4.0: a squad fires one SW at no cost to its own FP), so a stack picked up whole fires those weapons alone.
 */
export function beyondRange(env: QueryEnv, decl: { units: PieceId[]; target: HexId }): PieceId[] {
  const map = statics(env).map;
  const target = hexOfLoc(decl.target);
  // No range to a hex off the map (A2.6): nothing to leave out; the rules refuse such a shot on their own.
  if (!map.hex(target)) return [];
  return decl.units.filter((id) => {
    const p = env.state.pieces[id];
    const at = p ? hexOf(env.state, p) : null;
    const m = p ? mmc(env, p) : null;
    return !!at && !!m && map.distance(at, target) > m.range * 2;
  });
}

/** The declaration without its units beyond range (`beyondRange`): what the stack's weapons may still fire at the target. */
export function withinRange<D extends { units: PieceId[]; target: HexId }>(env: QueryEnv, decl: D): D {
  const far = beyondRange(env, decl);
  return far.length ? { ...decl, units: decl.units.filter((u) => !far.includes(u)) } : decl;
}

/**
 * The leaders in the hex a "Fire" entry offers to direct `units` (the fire selection there): those in the selection
 * or selectable themselves, and for weapons firing again alone on the ROF they kept, any leader there. He may direct
 * a MG "as many times as the MG can fire, even if he also directed other units as part of a FG in the MG's previous
 * attack" (ASLRB A7.53; SK1 1.2.1 "to direct ROF"), though his Prep Fire marker leaves him unselectable. Whether each
 * one may direct is the rules' call (`directorIllegal`), shown on the entry.
 */
export function fireLeaders(env: QueryEnv, leaders: Piece[], units: PieceId[], own: PieceId[]): Piece[] {
  const sws = units.filter((id) => env.state.pieces[id] && defOf(env, env.state.pieces[id]!).kind === 'sw');
  const carriers = swCarriers(env, units);
  const rofShot = sws.length > 0 && sws.length === units.filter((id) => !carriers.includes(id)).length && isRofShot(env, { units: [], sw: sws });
  return leaders.filter((l) => rofShot || units.includes(l.id) || own.includes(l.id));
}

/**
 * Whether blind fire (Area Fire at a hex where no enemy is seen) is offered at `hex` for `side`. Not where the side has
 * a unit of its own: no hidden enemy can be there, since a unit entering a hidden unit's hex reveals it (SK4 6.4; ASLRB
 * A12.15) and a hidden unit may not move and stay hidden (A12.32). The shot could only attack the side's own units.
 * Unpossessed weapons and wrecks do not count: they are not attacked.
 */
export function blindFireOffered(env: QueryEnv, hex: HexId, side: SideId): boolean {
  // An off-board hex (the imaginary one beyond an edge, ASLRB A2.6) is drawn but is no Location to fire at.
  if (!statics(env).map.hex(hex)) return false;
  return unitsInHex(env, hex, side).length === 0;
}

/**
 * Whether a click on `hex` aims the selected fire at it: enemy personnel there, an enemy's concealed "?" stack (Area
 * Fire, SK4 8.3.2), or an enemy vehicle. Infantry and MG fire on the IFT attacks a Crew Exposed crew (+2 DRM) and does
 * nothing to a Buttoned Up AFV (SK4 3.2.3, 7.7); Ordnance never attacks the crew alone (7.7), so a Gun's or a PF's
 * shot aims at a lone vehicle only on the Vehicle Target Type. `env` is the viewer's (redacted) position.
 */
export function aimsAt(env: QueryEnv, hex: HexId, side: SideId, special: { targetType: string } | null): boolean {
  const enemyThere = Object.values(env.state.pieces).filter((p) => p.side !== side && p.loc.kind === 'hex' && p.loc.hex === hex);
  if (enemyThere.some((p) => p.defId === UNKNOWN_DEF_ID)) return true;
  if (personnelInHex(env, hex).some((p) => p.side !== side)) return true;
  return !!enemyVehicleAt(env, hex, side) && (special ? special.targetType === 'VTT' : true);
}
