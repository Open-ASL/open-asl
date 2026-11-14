import { expect } from 'vitest';
import type { Action, Engine, GameState } from '@asl/engine';
import { moveState, playerTurnLeftovers, statics, unlistedTags } from '@asl/rules';

/**
 * The Location model's Starter Kit invariant (packages/rules/docs/location-model.md): an SK game plays at
 * ground level only, so no piece is ever at a level, sub-Location or position, and every hex marker is
 * keyed by a plain hex id. Null when it holds, else what breaks it.
 */
export function skLocationViolation(state: GameState): string | null {
  for (const p of Object.values(state.pieces)) if (p.loc.kind === 'hex' && ('level' in p.loc || 'sub' in p.loc || 'pos' in p.loc)) return `${p.id} at ${JSON.stringify(p.loc)}`;
  for (const k of Object.keys(state.hexMarkers)) if (k.includes(':')) return `hex marker key ${k}`;
  return null;
}

/**
 * Checks every Player Turn boundary of a game (call it after each action): when a new Player Turn's Rally Phase
 * begins, no piece may keep a tag that belongs to the last Player Turn, and every tag on a piece must have a
 * lifecycle in `TAG_LIFECYCLE`: every piece of state needs a lifecycle. A Bounding First Fire marker
 * nothing cleared once froze vehicles for the rest of a game; this is the check that would have caught it.
 */
export function turnBoundaryCheck(id: string) {
  let last = '';
  return (state: GameState, events: readonly { type: string; payload?: unknown }[] = []) => {
    const turn = `${state.turn}:${state.attacker}`;
    if (state.phase !== 'RPh' || turn === last) return;
    last = turn;
    expect(unlistedTags(state), `${id}: tags with no lifecycle (add each to TAG_LIFECYCLE in packages/rules/src/common/tagLifecycle.ts)`).toEqual([]);
    // A tag this very step put on in the new Rally Phase is the new Player Turn's (a pin from a Morale Check an SSR
    // calls for as the RPh opens), not a leftover of the last one.
    const fresh = new Set<string>();
    for (const ev of events) {
      if (ev.type !== 'piece.tagged') continue;
      const { id: pid, tags } = ev.payload as { id: string; tags: Record<string, unknown> };
      for (const [k, v] of Object.entries(tags)) if (v !== null && v !== undefined) fresh.add(`${pid} ${k}=${JSON.stringify(v)}`);
    }
    expect(playerTurnLeftovers(state).filter((x) => !fresh.has(x)), `${id}: Player Turn tags still on as Player Turn ${turn} begins`).toEqual([]);
  };
}

/**
 * Weights for random play between tank forces, like a player: enter and move the tanks (never ending the MPh while
 * one can still start), shoot when offered at a target in LOS, end a phase when little else is left.
 */
export function tankWeights(a: Action, legal: Action[], state: GameState, engine: Engine): number {
  const idle = new Set(['endPhase', 'vmove.ce', 'vmove.turn', 'vmove.turret', 'vmove.smoke']);
  const busy = legal.some((x) => !idle.has(x.type));
  const seesTarget = (): boolean => {
    const shot = a['shot'] as { weapon: string; target: string } | undefined;
    if (!shot) return true;
    const w = state.pieces[shot.weapon];
    const at = w && (w.loc.kind === 'hex' ? w.loc.hex : w.loc.kind === 'held' ? (state.pieces[w.loc.by]?.loc as { hex?: string } | undefined)?.hex : undefined);
    return !at || at === shot.target || engine.env(state).query('los.trace', { from: at, to: shot.target }, { clear: true, hindrance: 0, parts: [] }).clear;
  };
  // A tank closes on the nearest enemy vehicle, as a player's would; a step that does not is a rarer choice.
  const closes = (): boolean => {
    const env = engine.env(state);
    const from = moveState(env)?.hex;
    const to = String(a['to']).split(':')[0]!;
    if (!from) return true;
    const map = statics(env).map;
    const enemy = Object.values(state.pieces).filter((p) => p.side !== state.attacker && p.loc.kind === 'hex' && p.tags['vca'] !== undefined);
    if (enemy.length === 0) return true;
    const near = (h: string) => Math.min(...enemy.map((p) => map.distance(h, (p.loc as { hex: string }).hex)));
    return near(to) < near(from);
  };
  const canStep = legal.some((x) => x.type === 'move.step');
  return a.type === 'move.step' ? (closes() ? 20 : 3) : a.type === 'vmove.start' ? 10 : /^(fire|defFire|ordnance|vmove\.bff)/.test(a.type) ? (seesTarget() ? 12 : 0.2) : a.type === 'endPhase' ? (busy ? 0 : 1) : a.type === 'vmove.ce' ? 0.2 : a.type === 'vmove.turn' || a.type === 'vmove.turret' ? 0.5 : /^(vmove\.(end|stop)|move\.end)$/.test(a.type) ? (canStep ? 0.05 : 1) : 1;
}
