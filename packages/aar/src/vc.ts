import type { QueryEnv } from '@asl/engine';
import { PHASE_NAME, achieved, casualtyVp, clearAreasTally, controlState, cvpGoal, exitVp, hasUnitsLeft, squadEquivalentsLost, statics, vpTally, type ScenarioDef, type VictoryCondition } from '@asl/rules';
import type { AarVictory, AarVictoryItem } from '@asl/platform';

/*
 * Victory conditions as the report words them: a short printed form of each, how it stood at the
 * end, and the one-line "how it was won". A reduced cousin of the briefing's describeVictory,
 * which lives in the web app and cannot be used by the server.
 */

export const hexLabelOf = (h: string) => h.replace(/^[a-z]/, '');

export function list(xs: string[]): string {
  return xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs.join('');
}

/** A building named the way the card names it: by the hex the victory text mentions, else its first hex. */
export function buildingLabel(env: QueryEnv, scenario: ScenarioDef, buildingId: string): string {
  const multi = scenario.boards.length > 1;
  const hexes = [...statics(env).map.hexes()].filter((h) => h.buildingId === buildingId).map((h) => (multi ? h.id : hexLabelOf(h.id)));
  if (hexes.length === 0) return buildingId;
  return hexes.find((h) => new RegExp(`\\b${h}\\b`).test(scenario.victoryText ?? '')) ?? hexes[0]!;
}

/** Top-level conditions with `all`/`any` opened up, each keeping its side. */
export function leaves(vcs: VictoryCondition[]): VictoryCondition[] {
  return vcs.flatMap((vc) => (vc.kind === 'all' || vc.kind === 'any' ? leaves(vc.of) : [vc]));
}

export function sideName(scenario: ScenarioDef, side: string): string {
  return scenario.sides.find((s) => s.side === side)?.name ?? side;
}

/** "Germans", "Russians", "Allies"; "Japanese" and "Free French" are already plural; a name ending in s gets "side". */
export function plural(name: string): string {
  if (/allied$/i.test(name)) return name.replace(/allied$/i, 'Allies');
  if (/(ese|ch|sh)$/i.test(name)) return name;
  if (/[sx]$/i.test(name)) return `${name} side`;
  return `${name}s`;
}

interface Standing {
  have: number;
  need: number;
  items: AarVictoryItem[];
}

/** How a condition stands now: what it needs, what the side has, and its parts. */
export function standing(env: QueryEnv, scenario: ScenarioDef, vc: VictoryCondition): Standing {
  const ctl = controlState(env);
  const map = statics(env).map;
  switch (vc.kind) {
    case 'controlBuildings': {
      const items = vc.buildings.map((b) => ({ label: buildingLabel(env, scenario, b), holder: ctl.buildings[b] ?? null }));
      return { have: items.filter((i) => i.holder === vc.side).length, need: vc.atLeast, items };
    }
    case 'controlHexes': {
      const held = vc.hexes.filter((h) => ctl.hexes[map.hex(h)?.id ?? h] === vc.side);
      const items = vc.hexes.length <= 12 ? vc.hexes.map((h) => ({ label: hexLabelOf(h), holder: ctl.hexes[map.hex(h)?.id ?? h] ?? null })) : [];
      return { have: held.length, need: vc.atLeast, items };
    }
    case 'eliminateCvp': {
      const other = scenario.sides.find((s) => s.side !== vc.side)?.side ?? vc.side;
      return { have: casualtyVp(env, other), need: cvpGoal(env, vc), items: [] };
    }
    case 'cvpBelow':
      return { have: casualtyVp(env, vc.side), need: vc.cvp, items: [] };
    case 'exitVp':
      return { have: exitVp(env, vc.side), need: vc.vp, items: [] };
    case 'vpTally': {
      const t = vpTally(env, vc);
      return { have: t.total, need: vc.vp, items: t.items.map((i) => ({ label: `${i.label}: ${i.vp} VP` })) };
    }
    case 'clearAreas': {
      const t = clearAreasTally(env, vc);
      return { have: t.clear, need: vc.atLeast, items: t.areas.map((a) => ({ label: `${a.label}: ${a.clear ? 'clear' : 'held'}` })) };
    }
    case 'fewerLosses': {
      const other = scenario.sides.find((s) => s.side !== vc.side)?.side ?? vc.side;
      return { have: squadEquivalentsLost(env, vc.side), need: squadEquivalentsLost(env, other), items: [] };
    }
    default:
      return { have: achieved(env, vc) ? 1 : 0, need: 1, items: [] };
  }
}

/** The condition in a few words, for the report's victory card. */
export function conditionText(env: QueryEnv, scenario: ScenarioDef, vc: VictoryCondition): string {
  const other = scenario.sides.find((s) => s.side !== vc.side)?.side ?? vc.side;
  switch (vc.kind) {
    case 'controlBuildings': {
      const names = vc.buildings.map((b) => buildingLabel(env, scenario, b));
      return `Control ${vc.atLeast >= names.length ? `buildings ${list(names)}` : `${vc.atLeast} of buildings ${list(names)}`}${vc.immediate ? '' : ' at game end'}`;
    }
    case 'controlHexes':
      return `Control ${vc.atLeast >= vc.hexes.length ? 'all' : `≥ ${vc.atLeast}`} of ${vc.hexesLabel ? `the ${vc.hexes.length} ${vc.hexesLabel}` : vc.hexes.length > 12 ? `${vc.hexes.length} hexes` : list(vc.hexes.map(hexLabelOf))}${vc.immediate ? '' : vc.atEndOfTurn ? ` at the end of Turn ${vc.atEndOfTurn}` : ' at game end'}`;
    case 'eliminateCvp':
      return `Eliminate ${cvpGoal(env, vc)} CVP of ${plural(sideName(scenario, other))}${vc.immediate ? '' : ' by game end'}`;
    case 'cvpBelow':
      return `Lose fewer than ${vc.cvp} CVP`;
    case 'exitVp':
      return `Exit ${vc.vp} VP off the ${{ N: 'north', E: 'east', S: 'south', W: 'west' }[vc.edge] ?? vc.edge} edge${vc.immediate ? '' : ' by game end'}`;
    case 'exitForce':
      return `Exit ${vc.hsEquivalents} half-squad equivalents and ${vc.smc} leader${vc.smc === 1 ? '' : 's'}${vc.immediate ? '' : ' by game end'}`;
    case 'noGoodOrderEnemyIn':
      return `${enemyLimit(scenario, vc, other)} in ${vc.hexesLabel ? `the ${vc.hexes.length} ${vc.hexesLabel}` : vc.buildings ? 'the objective buildings' : vc.hexes.length > 12 ? 'the objective' : list(vc.hexes.map(hexLabelOf))} at game end`;
    case 'clearAreas':
      return `No Good Order ${plural(sideName(scenario, other))} on ${vc.atLeast} of the ${vc.areas.length} ${vc.areasLabel ?? 'areas'} at game end`;
    case 'fewerLosses':
      return `Lose fewer squad equivalents than the ${plural(sideName(scenario, other))}`;
    case 'vpTally':
      return `Amass ${vc.vp} VP at game end`;
    case 'losFirepower':
      return `Bring ${vc.fp} FP to bear on ${vc.hexesLabel ?? 'the objective'} at game end`;
    case 'goodOrderVp':
      return `Hold ${vc.vp} VP of Good Order Infantry in ${vc.hexesLabel ?? 'the objective'} at game end`;
    case 'squadEquivalentsIn':
      return `Hold ${vc.atLeast} unbroken squad equivalents in ${vc.hexesLabel ?? 'the objective'} at game end${vc.afvSe ? ` (an armed mobile AFV counts ${vc.afvSe})` : ''}`;
    case 'gunsEliminatedOrCaptured':
      return `Eliminate${vc.eliminatedOnly ? '' : ' or capture'} every ${sideName(scenario, vc.of)} Gun`;
    case 'occupyGunHexes':
      return `Occupy every hex holding a ${sideName(scenario, vc.of)} Gun`;
    case 'afvLead':
      return 'Eliminate more AFV than they lose';
    case 'mobileAfv':
      return `Keep ${vc.atLeast} AFV mobile`;
    case 'forcesInBuilding':
      return `Bring a unit of each of ${list(vc.groups.map((g) => g.label))} into one building`;
    case 'fewerMmcLost':
      return `Lose fewer MMC than the ${plural(sideName(scenario, other))}`;
    case 'all':
    case 'any':
      return leaves([vc]).map((c) => conditionText(env, scenario, c)).join(vc.kind === 'all' ? ' and ' : ' or ');
    case 'custom':
      return scenario.victoryText ?? 'Scenario victory conditions';
  }
}

/** "No Good Order Germans", or with a limit "No more than 1 Good Order German" (`atMost`). */
function enemyLimit(scenario: ScenarioDef, vc: Extract<VictoryCondition, { kind: 'noGoodOrderEnemyIn' }>, other: string): string {
  const kind = vc.unbroken ? 'unbroken' : 'Good Order';
  if (!vc.atMost) return `No ${kind} ${plural(sideName(scenario, other))}`;
  return `No more than ${vc.atMost} ${kind} ${vc.atMost === 1 ? sideName(scenario, other) : plural(sideName(scenario, other))}`;
}

/**
 * The conditions that carried a met victory condition: of an `any`, only the first branch met; of an `all`, every part.
 * A part met inside a branch that failed as a whole did not win anything.
 */
export function metLeaves(env: QueryEnv, vcs: VictoryCondition[]): VictoryCondition[] {
  return vcs.flatMap((vc): VictoryCondition[] => {
    if (!achieved(env, vc)) return [];
    if (vc.kind === 'any') {
      const branch = vc.of.find((c) => achieved(env, c));
      return branch ? metLeaves(env, [branch]) : [];
    }
    if (vc.kind === 'all') return metLeaves(env, vc.of);
    return [vc];
  });
}

/** Every condition of the scenario, as it stood at game end. */
export function victoryStandings(env: QueryEnv, scenario: ScenarioDef): AarVictory[] {
  return leaves(scenario.victory).map((vc) => {
    const s = standing(env, scenario, vc);
    return { side: vc.side, text: conditionText(env, scenario, vc), met: achieved(env, vc), have: s.have, need: s.need, items: s.items };
  });
}

/** How a game ended: the side that won (null for a draw), why the engine or the server ended it, and when. */
export interface GameEnding {
  winner: string | null;
  /** 'scenario end' | 'sudden death' | 'annihilation' | 'nothing left to play' | 'concession' | 'timeout'. */
  reason: string;
  turn: number;
  phase: string;
  /** Who gave up or ran out the clock; the losing side's name when not given. */
  loserName?: string;
}

/** What decided a game: the one-line "how it was won", and the winner's victory conditions that carried it. */
export interface GameDecision {
  how: string;
  /** The met conditions as the card words them (every part of a met `all`, the branch met of an `any`); empty for a concession. */
  decidedBy: string[];
}

/** The one-line account of how the game was decided, and the conditions behind it, for the report and the game-over screen. */
export function gameDecision(env: QueryEnv, scenario: ScenarioDef, end: GameEnding): GameDecision {
  const { winner, reason, turn } = end;
  const name = (s: string) => sideName(scenario, s);
  const loser = winner ? (scenario.sides.find((s) => s.side !== winner)?.side ?? null) : null;
  const loserName = end.loserName ?? (loser ? name(loser) : '');
  const phaseName = PHASE_NAME[end.phase] ?? end.phase;
  // The conditions that carried the win: of an `any`, the branch met, not a part met inside a branch that failed.
  const met = winner ? metLeaves(env, scenario.victory.filter((vc) => vc.side === winner)) : [];
  const offensive = leaves(scenario.victory).filter((vc) => vc.side === loser);
  const decidedBy = reason === 'concession' || reason === 'timeout' ? [] : met.map((vc) => conditionText(env, scenario, vc));
  let how: string;
  switch (reason) {
    case 'scenario end':
      if (!winner) how = 'Neither side met its victory conditions';
      else if (met[0]) how = `${winningClause(env, scenario, met[0], true)}${met[0].kind === 'controlBuildings' || met[0].kind === 'controlHexes' ? ` at the end of Turn ${turn}` : ''}`;
      else if (offensive[0] && loser) how = `The ${plural(name(loser))} never ${winningClause(env, scenario, offensive[0], false)}`;
      else how = `${plural(name(winner))} held on to the end of Turn ${turn}`;
      break;
    case 'sudden death':
      how = `Won immediately in Turn ${turn} ${phaseName}${met[0] ? `: ${winningClause(env, scenario, met[0], true).replace(/^./, (c) => c.toLowerCase())}` : ''}`;
      break;
    case 'annihilation': {
      // The side wiped out, which the VC then settled may still favour (the game ends only where they are settled).
      const gone = scenario.sides.map((x) => x.side).find((x) => !hasUnitsLeft(env, x));
      how = gone ? `The last ${name(gone)} unit died in Turn ${turn}` : `Both sides were wiped out in Turn ${turn}`;
      break;
    }
    case 'nothing left to play':
      // One side's units had all exited or died with the result settled (sk1.vc.nothing-left): the VC decided it there.
      how = `${winner ? (met[0] ? winningClause(env, scenario, met[0], true) : `${plural(name(winner))} held on`) : 'Neither side met its victory conditions'}; with nothing left to play, the game ended in Turn ${turn}`;
      break;
    case 'concession':
      how = `${loserName} conceded in Turn ${turn} ${phaseName}`;
      break;
    case 'timeout':
      how = `${loserName} ran out the clock in Turn ${turn}`;
      break;
    default:
      how = reason;
  }
  return { how, decidedBy };
}

/** The clause after "Held …" / "never …" for a condition the winner met (or the loser failed). */
export function winningClause(env: QueryEnv, scenario: ScenarioDef, vc: VictoryCondition, met: boolean): string {
  const s = standing(env, scenario, vc);
  const other = scenario.sides.find((x) => x.side !== vc.side)?.side ?? vc.side;
  switch (vc.kind) {
    case 'controlBuildings': {
      const held = s.items.filter((i) => i.holder === vc.side).map((i) => i.label);
      const all = s.items.map((i) => i.label);
      if (met) return vc.atLeast >= all.length ? `Held ${list(held)}` : `Held ${held.length} of the ${all.length} buildings (${list(held)})`;
      return vc.atLeast >= all.length ? `took ${list(all)}` : `took ${vc.atLeast} of the ${all.length} buildings`;
    }
    case 'controlHexes': {
      const what = vc.hexesLabel ? `the ${vc.hexes.length} ${vc.hexesLabel}` : vc.hexes.length > 12 ? `${vc.hexes.length} hexes` : list(vc.hexes.map(hexLabelOf));
      return met ? `Controlled ${s.have} of ${what}` : `controlled ${vc.atLeast} of ${what} (${s.have} at the end)`;
    }
    case 'eliminateCvp':
      return met ? `Inflicted ${s.have} CVP, ${s.need} needed` : `inflicted ${s.need} CVP (${s.have} by game end)`;
    case 'cvpBelow':
      return met ? `Kept their losses to ${s.have} CVP, under ${s.need}` : `kept their losses under ${s.need} CVP`;
    case 'exitVp':
      return met ? `Exited ${s.have} VP, ${s.need} needed` : `exited ${s.need} VP (${s.have} by game end)`;
    case 'noGoodOrderEnemyIn':
      return met ? `${enemyLimit(scenario, vc, other)} left in the objective at game end` : vc.atMost ? `left no more than ${vc.atMost} in the objective` : 'cleared the objective';
    case 'clearAreas':
      return met ? `Cleared ${s.have} of the ${vc.areas.length} ${vc.areasLabel ?? 'areas'}, ${s.need} needed` : `cleared ${s.need} of the ${vc.areas.length} ${vc.areasLabel ?? 'areas'} (${s.have} by game end)`;
    case 'fewerLosses':
      return met ? `Lost ${s.have} squad equivalents to the enemy's ${s.need}` : `lost fewer squad equivalents (${s.have} against ${s.need})`;
    case 'vpTally':
      return met ? `Amassed ${s.have} VP, ${s.need} needed` : `amassed ${s.need} VP (${s.have} by game end)`;
    default:
      return met ? 'Met their victory conditions' : 'met their victory conditions';
  }
}
