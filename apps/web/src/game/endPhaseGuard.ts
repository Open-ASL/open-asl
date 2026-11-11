import type { Action, PieceId, QueryEnv } from '@asl/engine';
import { moveState } from '@asl/rules';

/**
 * A "are you sure?" raised before the phase owner ends a phase with something still open.
 * None of these are rule violations: rally attempts are optional (SK1 3.1 e/f "may attempt")
 * and units need not move, so the engine allows the end and the UI merely asks first.
 */
export interface EndPhaseWarning {
  title: string;
  /** Paragraphs, in order. */
  lines: string[];
  /** The units concerned, for listing (and highlighting). */
  units: PieceId[];
  /** True when going ahead loses units for good (offboard reinforcements at the end of the APh). */
  severe?: boolean;
}

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/**
 * What the phase owner would be walking away from by ending the current phase now.
 * `legal` is the engine's legal action list for the owner; it already applies every
 * restriction (already moved, fired in the PFPh, already attempted to rally, entry turn...).
 */
export function endPhaseWarning(env: QueryEnv, legal: Omit<Action, 'side' | 'decisionId'>[]): EndPhaseWarning | null {
  const state = env.state;
  const phase = state.phase;

  if (phase === 'RPh') {
    const units = new Set<PieceId>();
    for (const a of legal) {
      if (a.type === 'rally.selfRally' || a.type === 'rally.rally') units.add(a['unit'] as PieceId);
    }
    if (units.size === 0) return null;
    return {
      title: 'Broken units could still rally',
      lines: [
        `${n(units.size, 'broken unit')} ${units.size === 1 ? 'has' : 'have'} not attempted to rally this turn. A rally attempt is optional (SK1 3.1), but a unit that stays broken cannot fire, move or advance and must rout away from the enemy.`,
        'End the Rally Phase anyway?',
      ],
      units: [...units],
    };
  }

  if (phase === 'MPh') {
    // Asked per unit rather than from the legal list: while a stack is mid-move the engine
    // offers no `move.start`, yet the other units could still move once it stops.
    const moving = moveState(env)?.units ?? [];
    const units = new Set<PieceId>();
    for (const p of Object.values(state.pieces).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
      if (p.side !== state.attacker || moving.includes(p.id)) continue;
      if (p.loc.kind !== 'hex' && p.loc.kind !== 'offboard') continue;
      const isVehicle = (env.statics as { counters: Record<string, { kind: string }> }).counters[p.defId]?.kind === 'vehicle';
      const canStart = () =>
        !env.query('move.cannotStart', { units: [p.id], doubleTime: false, assault: false }, null) ||
        // A unit possessing a Gun starts by manhandling it (SK4 6.5).
        Object.values(state.pieces).some((sw) => sw.loc.kind === 'held' && sw.loc.by === p.id && !env.query('move.cannotStart', { units: [p.id], doubleTime: false, assault: false, manhandle: sw.id }, null));
      if (isVehicle ? !env.query('vehicle.cannotStart', { vehicle: p.id }, null) : canStart()) units.add(p.id);
    }
    if (units.size === 0) return null;
    const off = [...units].filter((u) => state.pieces[u]?.loc.kind === 'offboard');
    const on = [...units].filter((u) => state.pieces[u]?.loc.kind === 'hex');
    const lines: string[] = [];
    if (off.length > 0) {
      lines.push(
        `${n(off.length, 'reinforcement')} ${off.length === 1 ? 'is' : 'are'} still off board. ${off.length === 1 ? 'It' : 'They'} can still enter in the Advance Phase, but only one hex deep, and any unit that has not entered by the end of this turn is eliminated (SK1 3.3).`,
      );
    }
    if (on.length > 0) lines.push(`${n(on.length, 'unit')} on the map ${on.length === 1 ? 'has' : 'have'} not moved.`);
    const motion = on.filter((u) => state.pieces[u]?.tags['motion']);
    if (motion.length > 0) lines.push(`${n(motion.length, 'vehicle')} in Motion must spend MP this phase, if only to stop (SK4 3.3.2).`);
    lines.push('End the Movement Phase anyway?');
    return {
      title: off.length > 0 ? 'Reinforcements have not entered' : 'Units have not moved',
      lines,
      units: [...off, ...on],
    };
  }

  if (phase === 'APh') {
    // Units due this turn that are still offboard are eliminated when the APh ends (SK1 3.3).
    const units = Object.values(state.pieces)
      .filter((p) => p.side === state.attacker && p.loc.kind === 'offboard' && p.loc.edge !== 'setup' && p.loc.edge !== 'exited' && p.tags['entryTurn'] === state.turn)
      .map((p) => p.id)
      .sort();
    if (units.length === 0) return noAdvance(env, legal);
    return {
      title: 'Reinforcements will be eliminated',
      lines: [
        `${n(units.length, 'reinforcement')} ${units.length === 1 ? 'is' : 'are'} still off board. This is the last phase in which ${units.length === 1 ? 'it' : 'they'} can enter: a unit that has not entered by the end of the Advance Phase of its turn of entry is eliminated (SK1 3.3).`,
        'End the Advance Phase and lose them?',
      ],
      units,
      severe: true,
    };
  }

  return null;
}

/**
 * The Advance Phase is easily ended by mistake right after the Rout Phase moves on by itself: ask
 * when units could still advance and none has yet. Once one has, ending the phase is deliberate.
 */
function noAdvance(env: QueryEnv, legal: Omit<Action, 'side' | 'decisionId'>[]): EndPhaseWarning | null {
  const state = env.state;
  if (Object.values(state.pieces).some((p) => p.side === state.attacker && p.tags['advanced'])) return null;
  const units = [...new Set(legal.filter((a) => a.type === 'advance').flatMap((a) => a['units'] as PieceId[]))].sort();
  if (units.length === 0) return null;
  return {
    title: 'No unit has advanced',
    lines: [
      `${n(units.length, 'unit')} could still advance one hex (SK1 3.7), and none has advanced this phase. Advancing is optional, but it is the only way into Close Combat this turn.`,
      'End the Advance Phase without advancing?',
    ],
    units,
  };
}
