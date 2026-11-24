import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { ScenarioDef } from '@asl/rules';
import { advancedBy, measureShare, medalById, type Pool, type UserDoc } from '@asl/platform';
import { useOwnMeasures } from './shared';

const SHOWN = 4;

/**
 * Before a game: the decorations a win from this side would move forward, with where each would stand after it.
 * Measured with the same rules the server awards by, so the hint never promises what a win will not give.
 */
export function DecorationHints({ user, scenario, side, sideName, pool, profileBase }: { user: Pick<UserDoc, 'service' | 'betaScenarios'>; scenario: ScenarioDef; side: string; sideName: string; pool: Pool; profileBase: string | null }) {
  const measured = useOwnMeasures(user);
  const [all, setAll] = useState(false);
  const moved = useMemo(() => {
    if (!measured || !measured.ctx.catalogue.some((s) => s.id === scenario.id)) return [];
    return advancedBy(measured.ctx, { pool, scenarioId: scenario.id, side, outcome: 'win', reason: 'scenario end', opponentBalance: false })
      .filter((a) => medalById(a.id).pool === pool)
      .sort((a, b) => b.after.level - b.before.level - (a.after.level - a.before.level) || measureShare(b.after) - measureShare(a.after));
  }, [measured, pool, scenario.id, side]);
  if (!moved.length) return null;
  const list = all ? moved : moved.slice(0, SHOWN);
  return <div className="decor-hints">
    <span className="option-label">A win as the {sideName} counts toward</span>
    <ul>
      {list.map(({ id, before, after }) => {
        const m = medalById(id);
        const earns = after.level > before.level;
        // Where the headline count would stand after the win.
        const part = after.parts.find((p) => p.label === before.parts[0]?.label) ?? before.parts[0];
        const text = earns ? (before.level ? (m.classes ? 'the next class' : 'another star') : 'earns it') : part ? `${Math.min(part.value, part.goal)} / ${part.goal} ${part.label.toLowerCase()}` : '';
        const label = <><b>{m.name}</b><small>{text}</small></>;
        return <li key={id} className={earns ? 'earns' : ''}>{profileBase ? <Link to={`${profileBase}/decorations/${id}`}>{label}</Link> : label}</li>;
      })}
    </ul>
    {moved.length > SHOWN && <button type="button" className="link" onClick={() => setAll(!all)}>{all ? 'Fewer' : `${moved.length - SHOWN} more`}</button>}
  </div>;
}
