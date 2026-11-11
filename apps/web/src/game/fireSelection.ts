import type { Piece, PieceId, QueryEnv } from '@asl/engine';
import { defOf, fireMarker, isGoodOrder, ordnanceOf, swHeldBy } from '@asl/rules';

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
  return here.filter((p) => isGoodOrder(env, p)).flatMap((p) => (!done(p) ? [p.id, ...swReady(p)] : swReady(p)));
}
