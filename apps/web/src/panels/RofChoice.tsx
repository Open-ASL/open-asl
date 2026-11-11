import type { HexId, PieceId } from '@asl/engine';
import { hexLabel } from '../game/describe';

export interface RofChoiceItem {
  sw: PieceId;
  label: string;
  /** The weapon's hex (to line it up for another shot). */
  at: HexId;
  /** The attack's target hex, where the Residual FP would go. */
  target: HexId;
  /** Residual FP giving the ROF up would leave there. */
  residual: number;
  /** The weapon can fire again at the stack from here (an infantry SW; Guns use their own menu). */
  canFire: boolean;
}

/**
 * A weapon that kept its Rate of Fire in Defensive First Fire may give it up and leave the attack's
 * Residual FP instead (SK1 3.3.1: "a SW that ... chooses to retain ROF leaves no Residual FP"). Shown
 * on the map while the defender is still deciding, beside the dice: firing the weapon again or passing
 * keeps the ROF, so the choice costs nothing unless it is taken.
 */
export function RofChoice({ choices, onDecline, onFire, onKeep }: { choices: RofChoiceItem[]; onDecline(sw: PieceId): void; onFire(c: RofChoiceItem): void; onKeep: (() => void) | null }) {
  return (
    <div className="rof-choice" role="group" aria-label="Rate of Fire kept">
      {choices.map((c) => (
        <div key={c.sw} className="rof-choice-row">
          <span className="rof-choice-text">
            <b>{c.label}</b> kept ROF
          </span>
          {c.canFire && (
            <button onClick={() => onFire(c)} title={`Line the ${c.label} up for another shot at ${hexLabel(c.target)} (it keeps its ROF)`}>
              Fire again
            </button>
          )}
          <button
            className="rof-choice-decline"
            onClick={() => onDecline(c.sw)}
            title={`Give up the Rate of Fire: the ${c.label} is marked as having fired and ${c.residual} Residual FP is left in ${hexLabel(c.target)} (SK1 3.3.1)`}
          >
            Leave {c.residual} Residual FP instead
          </button>
        </div>
      ))}
      {onKeep && (
        <button className="rof-choice-keep" onClick={onKeep} title="Keep the Rate of Fire: the weapon stays unmarked and may fire again this phase (P)">
          Keep ROF <span aria-hidden="true">—</span>
        </button>
      )}
    </div>
  );
}
