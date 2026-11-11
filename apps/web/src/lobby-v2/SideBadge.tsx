import type { ScenarioDef } from '@asl/rules';
import { Emblem } from '../fx/TurnChit';

/**
 * A scenario side as ASL players know it: the nationality's counter emblem beside its name. Used
 * wherever the lobby names a side, so the Balkenkreuz, star or roundel is always in view.
 */
export function SideBadge({ scenario, side, name = true }: { scenario: ScenarioDef | undefined; side: string; name?: boolean }) {
  const def = scenario?.sides.find((s) => s.side === side);
  return <span className={`side-badge side-${side}`}>
    <i className="side-emblem" aria-hidden><svg viewBox="-24 -24 48 48"><Emblem side={def?.nationality ?? side} /></svg></i>
    {name && <span>{def?.name ?? side}</span>}
  </span>;
}
