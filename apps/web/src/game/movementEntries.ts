import type { PieceId, QueryEnv } from '@asl/engine';
import {
  dashIllegal,
  dashOptions,
  defOf,
  hexOfLoc,
  knownEnemyAt,
  lateDoubleTimeIllegal,
  mandatoryTpbfOf,
  minimumMovers,
  moveState,
  ovrIllegal,
  ovrNtcDrm,
  ovrTarget,
  pieceLabel,
  slipAwayIllegal,
  statics,
  type MoveState,
} from '@asl/rules';

/*
 * The wheel entries and labels of the full ASL movement options (ASLRB A4.134, A4.5, A4.63, A4.15, A4.151, A8.312): what
 * the mover is offered for a step, a late Double Time or a Dash, what the DEFENDER is asked when overrun, each with the
 * reason when it is refused. Pure functions of the engine's view, so the app and its tests read the same answers.
 */

/** A counter's short name: "4-6-7", "7-0". */
export function shortName(env: QueryEnv, id: PieceId): string {
  const p = env.state.pieces[id];
  if (!p) return id;
  const d = defOf(env, p) as { kind: string; fp?: number; range?: number; morale?: number };
  if ((d.kind === 'squad' || d.kind === 'hs' || d.kind === 'crew') && d.fp !== undefined) return `${d.fp}-${d.range}-${d.morale}`;
  return pieceLabel(env, p).replace(/^\S+ /, '').replace(/ leader$/, '');
}
const names = (env: QueryEnv, ids: PieceId[]) => ids.map((u) => shortName(env, u)).join(', ');
const hexName = (h: string) => hexOfLoc(h).replace(/^[a-z]/, '');

/** The label of a step that is a Minimum Move for some of the stack (A4.134), or null. */
export function minimumMoveNote(env: QueryEnv, ms: MoveState, to: string): string | null {
  if (ms.vehicle) return null;
  const cost = env.query('move.stepCost', { ms, to }, 1);
  const mins = minimumMovers(env, ms, to, cost);
  if (mins.length === 0) return null;
  return `Minimum Move into ${hexName(to)} (${cost} MF): the ${names(env, mins)} ${mins.length > 1 ? 'end' : 'ends'} pinned and CX (A4.134)`;
}

/** One way to make an Infantry OVR step (A4.15). */
export interface OvrStepOption {
  action: { type: 'move.step'; to: string; ovr?: 'each' };
  label: string;
  hint: string;
}

/**
 * The Infantry OVR step into `to` (A4.15): the entries (the leader's NTC, each MMC's own) with the NTC DRM and the doubled
 * cost, or the reason there is none; null when `to` holds no Known enemy unit (an ordinary step).
 */
export function ovrStep(env: QueryEnv, ms: MoveState, to: string, check: (a: Record<string, unknown>) => string | null): { options: OvrStepOption[]; refusal: string | null } | null {
  if (!knownEnemyAt(env, to, env.state.attacker).length) return null;
  const why = ovrIllegal(env, ms, to);
  if (why) return { options: [], refusal: `${why}` };
  const smcP = ovrTarget(env, to)!;
  const { drm, notes } = ovrNtcDrm(env, to);
  const cost = env.query('move.stepCost', { ms, to }, 1);
  const base = { type: 'move.step' as const, to };
  const refused = check(base);
  if (refused) return { options: [], refusal: /lacks the MF/.test(refused) ? `Not enough MF: double cost ${cost} (A4.15)` : refused };
  const drmText = drm ? `NTC ${drm > 0 ? '+' : ''}${drm}${notes.length ? ` ${notes.map((n) => n.replace(/^[+-]?\d+ /, '')).join(', ')}` : ''}` : 'NTC';
  const leaderHere = ms.units.some((u) => defOf(env, env.state.pieces[u]!).kind === 'leader');
  const options: OvrStepOption[] = [];
  const title = `Overrun the ${shortName(env, smcP.id)} (${drmText}; ${cost} MF)`;
  if (leaderHere && !check({ ...base, ovr: 'each' })) {
    options.push({ action: base, label: `${title}: leader takes the NTC (exempts all)`, hint: 'One NTC by the leader for every MMC with him; if he fails none of them may move or act again this phase (A4.15, A10.1)' });
    options.push({ action: { ...base, ovr: 'each' }, label: `${title}: each squad takes its own NTC`, hint: 'Each MMC its own NTC, with the leader\'s DRM; those that fail stop where they are for the rest of the phase (A4.15, A10.7)' });
  } else options.push({ action: base, label: title, hint: 'A NTC first; on a pass the entry at double cost; the SMC may slip away, then CC at once if he stays (A4.15, A4.151, A4.152)' });
  return { options, refusal: null };
}

/** A "Double Time now" entry for the moving stack (A4.5 EXC). */
export interface LateDtEntry {
  units: PieceId[];
  label: string;
  disabled: string | null;
}

/** The late Double Time entries: the whole stack, and each unit when they differ (A4.5, A4.51, A4.61, B26.46). */
export function lateDoubleTimeEntries(env: QueryEnv): LateDtEntry[] {
  const ms = moveState(env);
  if (!ms || ms.vehicle || !ms.hex) return [];
  const why = ms.units.map((u) => ({ u, why: lateDoubleTimeIllegal(env, u) }));
  const ok = why.filter((x) => !x.why).map((x) => x.u);
  if (ok.length === ms.units.length) return [{ units: ok, label: 'Double Time now (+1 MF, CX)', disabled: null }];
  if (ok.length === 0) return [{ units: ms.units, label: 'Double Time now (+1 MF, CX)', disabled: why[0]!.why }];
  return why.map((x) => ({ units: [x.u], label: `Double Time now: ${shortName(env, x.u)} (+1 MF, CX)`, disabled: x.why }));
}

/** The "Dash…" entry of the moving stack (A4.63): enabled with its end hexes, or greyed with why. */
export function dashEntry(env: QueryEnv): { label: string; disabled: string | null; hint: string } | null {
  const ms = moveState(env);
  if (!ms?.hex || ms.vehicle) return null;
  if (ms.dash) return { label: `Dashing to ${hexName(ms.dash.to)}`, disabled: `Dashing to ${hexName(ms.dash.to)} (A4.63)`, hint: '' };
  const map = statics(env).map;
  const roads = map.neighbors(ms.hex).filter((h) => (map.hex(h)?.features ?? []).some((f) => f === 'road' || f.startsWith('road:')));
  if (roads.length === 0) return null;
  const opts = dashOptions(env);
  if (opts.length) return { label: 'Dash…', disabled: null, hint: 'Across the road to a hex on its far side: choose the end hex (two-hex cost shown). Non-ordnance First Fire at the stack in the road is Area Fire, ordnance +2 (Case J), for each firer to which both ends are non-Open Ground (A4.63)' };
  // The first refusal for a road hex beside it, to say why.
  const why = roads.flatMap((road) => map.neighbors(road).filter((t) => t !== ms.hex).map((to) => dashIllegal(env, road, to))).find((w) => !!w && !/same side|along it|not on the far side/.test(w));
  return { label: 'Dash…', disabled: why ?? 'No end hex across the road from here (A4.63)', hint: '' };
}

/** The end hexes a Dash may be declared to, with their badge and the Open Ground warning (A4.63, A10.531). */
export function dashTargets(env: QueryEnv): { road: string; to: string; badge: string; warning: string | null }[] {
  return dashOptions(env).map((o) => ({
    road: o.road,
    to: o.to,
    badge: `Dash ${o.cost} MF`,
    warning: o.openGround ? `${hexName(o.to)} is Open Ground: Dash benefits apply only against units that cannot see it (A4.63, A10.531)` : null,
  }));
}

/** The overrun SMC's choice (A4.151): its two answers, slipping away greyed with the reason. */
export function evadeEntries(env: QueryEnv, smc: PieceId): { stay: string; slip: string; slipDisabled: string | null } {
  return { stay: `The ${shortName(env, smc)} stays and fights`, slip: `The ${shortName(env, smc)} slips away (the ATTACKER picks the hex)`, slipDisabled: slipAwayIllegal(env, smc) };
}

/** The mandatory TPBF panel (A8.312): who must fire, which SW must and which may join. */
export function tpbfPanel(env: QueryEnv, loc: string): { required: string; optional: PieceId[]; text: string } | null {
  const m = mandatoryTpbfOf(env, loc);
  if (!m) return null;
  const required = [...m.units.map((u) => shortName(env, u)), ...m.sw.map((w) => shortName(env, w)), ...Object.entries(m.pickOne).map(([l, ws]) => `${shortName(env, l)} with ${ws.map((w) => shortName(env, w)).join(' or ')}`)].join(', ');
  return { required, optional: m.optional, text: `Mandatory TPBF (A8.312): ${required} must attack the units that entered ${hexName(loc)} at once; no other First Fire until it is made` };
}
