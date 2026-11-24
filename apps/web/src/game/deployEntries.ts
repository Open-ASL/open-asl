import type { Action, GameState, Piece, QueryEnv } from '@asl/engine';
import { defOf, deployLeaders, pieceLabel, squadOf, statics, swHeldBy } from '@asl/rules';

/** One choice of a Deploy entry: the leader who directs it, and the action it sends. */
export interface DeployOption {
  label: string;
  hint: string;
  action: Record<string, unknown>;
  /** The squad holds two or more weapons: ask how they are shared before sending (ASLRB A1.31). */
  askSplit: boolean;
}
/** A Deploy or Recombine wheel entry for a stack in the RPh: offered (with its options) or greyed with the reason. */
export interface DeployEntry {
  kind: 'deploy' | 'recombine';
  label: string;
  hint: string;
  disabled: boolean;
  options: DeployOption[];
}

const sf = (d: { fp: number; range: number; morale: number }) => `${d.fp}-${d.range}-${d.morale}`;
/** "4-6-7", "2-2-6" for a MMC, "9-2" for a leader: the counter's numbers, no nationality. */
const short = (env: QueryEnv, p: Piece) => {
  const d = defOf(env, p) as { kind: string; fp?: number; range?: number; morale?: number };
  if ((d.kind === 'squad' || d.kind === 'hs') && d.fp !== undefined) return sf(d as { fp: number; range: number; morale: number });
  return pieceLabel(env, p).replace(/^\S+ /, '').replace(/ leader$/, '');
};
const byId = (a: Piece, b: Piece) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The full ASL Deploy and Recombine entries for the units of `side` in one stack, in the RPh (ASLRB A1.31, A1.32, A2.52).
 * Deploy: one entry per squad, only for the ATTACKER (the DEFENDER never Deploys, ASOP 1.21A, so nothing is shown him); an
 * option per leader who may direct it, with the NTC number; refused squads greyed with the engine's reason. Recombine: one
 * entry per pair of the side's HS on the map here, either side; refused pairs greyed with the reason. `check` is the
 * engine's validation of an action for the player who would send it.
 */
export function deployEntries(env: QueryEnv, state: GameState, legal: Action[], check: (a: Record<string, unknown>) => string | null, unitsHere: Piece[], side: string): DeployEntry[] {
  const out: DeployEntry[] = [];
  const counters = statics(env).counters;
  if (side === state.attacker) {
    for (const sq of unitsHere.filter((p) => p.side === side && defOf(env, p).kind === 'squad').sort(byId)) {
      const m = defOf(env, sq) as { morale: number; reducesTo?: string };
      const morale = env.query('unit.morale', { unit: sq.id }, m.morale);
      const hs = m.reducesTo ? (counters[m.reducesTo] as { fp: number; range: number; morale: number } | undefined) : undefined;
      const label = `Deploy ${short(env, sq)}${hs ? ` into two ${sf(hs)}` : ''}`;
      const options = legal
        .filter((a) => a.type === 'rally.deploy' && a['unit'] === sq.id)
        .map((a): DeployOption => {
          const l = state.pieces[a['leader'] as string]!;
          const drm = env.query('unit.leadership', { unit: l.id, for: sq.id }, (defOf(env, l) as { leadership: number }).leadership);
          const signed = `${drm >= 0 ? '+' : ''}${drm}`;
          return {
            label: `Directed by ${short(env, l)} (${signed}): NTC ≤ ${morale - drm}`,
            hint: `NTC: DR ${signed} ≤ Morale ${morale}. Pass or fail, the squad and the ${short(env, l)} take no other action this RPh (ASLRB A1.31)`,
            action: { type: 'rally.deploy', unit: sq.id, leader: l.id, second: (a['second'] as string[] | undefined) ?? [] },
            askSplit: swHeldBy(state, sq.id).length >= 2,
          };
        });
      if (options.length) {
        out.push({ kind: 'deploy', label: options.length === 1 ? `${label} (${options[0]!.label.replace(/^Directed by /, '')})` : `${label}…`, hint: options.length === 1 ? options[0]!.hint : 'Pick the leader who directs the NTC (ASLRB A1.31)', disabled: false, options });
        continue;
      }
      const why = check({ type: 'rally.deploy', unit: sq.id, leader: deployLeaders(env, sq.id)[0]?.id ?? null });
      out.push({ kind: 'deploy', label, hint: why ?? 'Not now', disabled: true, options: [] });
    }
  }
  const hs = unitsHere.filter((p) => p.side === side && p.loc.kind === 'hex' && defOf(env, p).kind === 'hs').sort(byId);
  const leader = unitsHere.filter((p) => p.side === side && defOf(env, p).kind === 'leader').sort(byId)[0];
  for (let i = 0; i < hs.length; i++)
    for (let j = i + 1; j < hs.length; j++) {
      const [a, b] = [hs[i]!, hs[j]!];
      const sq = a.defId === b.defId ? squadOf(env, a.defId) : null;
      const into = sq && counters[sq] ? ` into a ${sf(counters[sq] as { fp: number; range: number; morale: number })}` : '';
      const label = `Recombine ${short(env, a)} + ${short(env, b)}${into}`;
      const offer = legal.find((x) => x.type === 'rally.recombine' && (x['units'] as string[]).join() === [a.id, b.id].join());
      if (offer) {
        const l = state.pieces[offer['leader'] as string]!;
        const hint = `Their sole action this RPh; the ${short(env, l)} may do nothing else this RPh but permit other Recombinations here (ASLRB A1.32). No casualty.`;
        out.push({ kind: 'recombine', label: `${label} (${short(env, l)} permits)`, hint, disabled: false, options: [{ label: `${short(env, l)} permits`, hint, action: { type: 'rally.recombine', units: [a.id, b.id], leader: l.id }, askSplit: false }] });
        continue;
      }
      const why = check({ type: 'rally.recombine', units: [a.id, b.id], leader: leader?.id ?? null });
      out.push({ kind: 'recombine', label, hint: why ?? 'Not now', disabled: true, options: [] });
    }
  return out;
}
