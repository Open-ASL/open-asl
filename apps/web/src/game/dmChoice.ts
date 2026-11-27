import type { Piece, PieceId, QueryEnv } from '@asl/engine';
import { dmChoiceIllegal, hexOfLoc, locOf, overstackBy, terrainOf } from '@asl/rules';

/** The DM choice the Rally Phase offers on one broken unit: remove its DM, or keep it after all. */
export interface DmChoice {
  unit: PieceId;
  /** `remove` while it keeps DM; `keep` once its removal is chosen (the choice can be taken back). */
  kind: 'remove' | 'keep';
  /** Why the choice cannot be made (the rules decide the DM themselves), or null. */
  why: string | null;
  label: string;
  hint: string;
}

/**
 * The DM choices for `side`'s broken units under DM among `units` (SK1 3.1 g): "All DM counters are removed at the
 * end of the RPh unless the DM unit is adjacent to a Known Enemy Unit. A broken unit may opt to keep its DM status
 * unless in woods or building." The game keeps DM until the owner chooses "Remove DM" (only a unit under DM may rout,
 * SK1 3.6); where the rules leave no choice, the entry is shown disabled with the reason.
 */
export function dmChoices(env: QueryEnv, side: string, units: Piece[]): DmChoice[] {
  return units
    .filter((p) => p.side === side && p.tags['dm'] && p.tags['broken'])
    .map((p) =>
      p.tags['dmRemove']
        ? {
            unit: p.id,
            kind: 'keep' as const,
            why: null,
            label: overstackedShelter(env, p) ? 'Keep DM (overstacked, A10.62)' : 'Keep DM',
            hint: "Its DM comes off at the end of the Rally Phase. Keep it so the unit may still rout in this turn's Rout Phase (its next rally is then at +4)",
          }
        : (() => {
            const why = dmChoiceIllegal(env, side, p.id);
            return {
              unit: p.id,
              kind: 'remove' as const,
              why,
              label: !why && overstackedShelter(env, p) ? 'Remove DM (overstacked: it may keep it, A10.62)' : 'Remove DM',
              hint:
                why ??
                (overstackedShelter(env, p)
                  ? "Overstacked in woods or a building, it may keep its DM there (ASLRB A10.62): it keeps it unless you remove it. With DM it may rout in this turn's Rout Phase, but its next rally attempt is at +4. Removed, it comes off at the end of the Rally Phase"
                  : "It keeps its DM unless you remove it (SK1 3.1 g): with DM it may rout in this turn's Rout Phase, but its next rally attempt is at +4. Removed, it comes off at the end of the Rally Phase"),
            };
          })(),
    );
}

/** Whether `p` is in woods or a building its side has overstacked (full ASL A10.62: it may then keep its DM there). */
function overstackedShelter(env: QueryEnv, p: Piece): boolean {
  const loc = p.loc.kind === 'hex' ? locOf(env.state, p) : null;
  return !!loc && !!terrainOf(env, hexOfLoc(loc)).routShelter && overstackBy(env, loc, p.side).personnel > 0;
}
