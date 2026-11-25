import type { HexId, PieceId, QueryEnv, SideId } from '@asl/engine';
import { chargerIllegal, humanize, isJapanese, mmc, pieceLabel, smc, swHeldBy } from '@asl/rules';

/** A Banzai Charge being drawn up (SK4 8.1.8.6): the leader, the units ticked so far, the target hex once clicked. */
export interface BanzaiDraft {
  leader: PieceId;
  units: PieceId[];
  target: HexId | null;
}

/** A unit the charge panel lists: its label with the weapons it holds, its hex, and why it may not charge (null: it may). */
export interface BanzaiCandidate {
  id: PieceId;
  hex: HexId;
  label: string;
  why: string | null;
}

/**
 * The side's Japanese Infantry a Banzai Charge could take, in id order: Good Order, unpinned and unmoved (the others
 * are left out, not greyed). Each is named with the weapons it holds, so a player can tell which squad has the LMG,
 * and greyed with the engine's reason when it still may not charge (over its IPC, sharing a hex with the enemy).
 */
export function banzaiCandidates(env: QueryEnv, side: SideId): BanzaiCandidate[] {
  return Object.values(env.state.pieces)
    .filter((p) => p.side === side && p.loc.kind === 'hex' && isJapanese(env, p) && !!(mmc(env, p) || smc(env, p)))
    .filter((p) => p.tags['broken'] !== true && p.tags['pinned'] !== true && p.tags['moved'] === undefined && p.tags['banzai'] === undefined)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((p) => {
      const held = swHeldBy(env.state, p.id).map((w) => pieceLabel(env, w).replace(/^\S+ /, ''));
      const why = chargerIllegal(env, side, p.id);
      return { id: p.id, hex: (p.loc as { hex: HexId }).hex, label: [pieceLabel(env, p), ...held].join(' · '), why: why ? humanize(env, why) : null };
    });
}

/**
 * A click on one of the side's own hexes while the charge is drawn up: ticks every unit there that may charge, or
 * unticks them all when they are all ticked already (the leader stays). An error says why when none of them may.
 */
export function toggleBanzaiHex(env: QueryEnv, side: SideId, draft: BanzaiDraft, hex: HexId): { draft: BanzaiDraft } | { error: string } | null {
  const here = banzaiCandidates(env, side).filter((c) => c.hex === hex && c.id !== draft.leader);
  if (here.length === 0) return null;
  const free = here.filter((c) => c.why === null).map((c) => c.id);
  if (free.length === 0) return { error: here[0]!.why! };
  const all = free.every((id) => draft.units.includes(id));
  const units = all ? draft.units.filter((u) => !free.includes(u)) : [...draft.units, ...free.filter((id) => !draft.units.includes(id))];
  return { draft: { ...draft, units } };
}
