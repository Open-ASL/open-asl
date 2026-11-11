import type { GameState } from '@asl/engine';

/**
 * How long each piece tag lives. Every tag a rules module sets must be listed here (the random self-play tests fail on
 * an unlisted one), so whoever adds a tag decides when it comes off:
 * - `playerTurn`: it belongs to one Player Turn (a fire marker, "moved", "used its smoke dispenser"). It must be gone
 *   when the next Player Turn's Rally Phase begins: the self-play tests check every turn boundary.
 * - `lasting`: it may stay across Player Turns (broken, CX until the next MPh, a Covered Arc, a wreck, scenario data).
 *   Tags keyed by a turn or phase string (`ceChanged`, `radioTurn`) are lasting: the key expires them.
 * A Bounding First Fire marker that nothing cleared froze vehicles for the rest of a game;
 * this list and its check exist so that cannot happen again unnoticed.
 */
export const TAG_LIFECYCLE: Record<string, 'playerTurn' | 'lasting'> = {
  // SK1 (sk1/status T)
  broken: 'lasting',
  pinned: 'playerTurn',
  cx: 'lasting',
  cxPrev: 'playerTurn',
  dm: 'lasting',
  wounds: 'lasting',
  fire: 'playerTurn',
  malf: 'lasting',
  firedSw: 'playerTurn',
  firedSwAs: 'playerTurn',
  ownFpForfeit: 'playerTurn',
  rofFired: 'playerTurn',
  swDestroyed: 'playerTurn',
  moved: 'playerTurn',
  pinnedThisTurn: 'playerTurn',
  rallyTried: 'playerTurn',
  rphAction: 'playerTurn',
  repairTried: 'playerTurn',
  recoveredPhase: 'lasting',
  advancedInto: 'playerTurn',
  advanced: 'playerTurn',
  stackedOn: 'lasting',
  portaged: 'playerTurn',
  lastHex: 'playerTurn',
  secretSw: 'lasting',
  prepared: 'lasting',
  // Scenario setup and entry
  force: 'lasting',
  entryTurn: 'lasting',
  entryEdge: 'lasting',
  entryFrom: 'lasting',
  entryRoll: 'lasting',
  entryHexes: 'lasting',
  entryMfSpent: 'lasting',
  // SK2 (sk2/status T2)
  ca: 'lasting',
  emplaced: 'lasting',
  hip: 'lasting',
  acq: 'lasting',
  acqHex: 'lasting',
  acqUnits: 'lasting',
  acqLevel: 'lasting',
  ammoOut: 'lasting',
  intensive: 'playerTurn',
  caLocked: 'playerTurn',
  caTurned: 'playerTurn',
  // S66 SSR 2: a weapon that entered disassembled (off once assembled), and the fire phase it was assembled in.
  disassembled: 'lasting',
  assembledIn: 'playerTurn',
  manhandled: 'playerTurn',
  hazardous: 'playerTurn',
  firedNonSmoke: 'playerTurn',
  // SK3 (sk3/status T3)
  vca: 'lasting',
  ce: 'lasting',
  motion: 'lasting',
  movingTarget: 'lasting',
  bog: 'lasting',
  immob: 'lasting',
  dugIn: 'lasting',
  shock: 'lasting',
  stun: 'lasting',
  recall: 'lasting',
  wreck: 'lasting',
  ceChanged: 'lasting',
  smokeUsed: 'playerTurn',
  maDisabled: 'lasting',
  lowAmmo: 'lasting',
  bff: 'playerTurn',
  bffRof: 'playerTurn',
  mgDisabled: 'lasting',
  stalled: 'playerTurn',
  mpTrail: 'playerTurn',
  motionTried: 'playerTurn',
  radioOk: 'lasting',
  radioTurn: 'lasting',
  tcaTurnPhase: 'playerTurn',
  tcaTurnSpines: 'playerTurn',
  tcaTurnPaid: 'playerTurn',
  // SK4 (sk4/status T4)
  concealed: 'lasting',
  dcVsConcealed: 'playerTurn',
  hipFired: 'playerTurn',
  banzai: 'playerTurn',
  recombined: 'lasting',
  deployedFrom: 'lasting',
};

/** A tag's lifecycle; per-weapon variants such as `repairTried_ma` take their stem's. Undefined when unlisted. */
export function tagLifecycle(key: string): 'playerTurn' | 'lasting' | undefined {
  return TAG_LIFECYCLE[key] ?? TAG_LIFECYCLE[key.split('_')[0]!];
}

/** Tags on pieces still in play that no lifecycle lists: each must be added to `TAG_LIFECYCLE`. */
export function unlistedTags(state: GameState): string[] {
  const out = new Set<string>();
  for (const p of Object.values(state.pieces)) for (const k of Object.keys(p.tags)) if (!tagLifecycle(k)) out.add(k);
  return [...out].sort();
}

/** Player Turn tags still on pieces in play: "<piece> <tag>=<value>", empty when the turn has been cleaned up. */
export function playerTurnLeftovers(state: GameState): string[] {
  const out: string[] = [];
  for (const p of Object.values(state.pieces)) {
    if (p.loc.kind === 'eliminated') continue;
    for (const [k, v] of Object.entries(p.tags)) if (tagLifecycle(k) === 'playerTurn') out.push(`${p.id} ${k}=${JSON.stringify(v)}`);
  }
  return out.sort();
}
