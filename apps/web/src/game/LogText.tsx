import type { ReactNode } from 'react';
import { Die } from '../fx/DiceTray';

/**
 * The rolls a log line writes out, as the log draws them:
 *  - "5+3=8": a DR, colored die first (as `describe` writes every two-dice roll);
 *  - "dr 4", "colored dr 4": a single die, the colored one when it says so (ROF);
 *  - "colored 3", "white 4", "third die 2": a die named on its own (scatter, Bog removal, CC vs a vehicle).
 */
const ROLL = /\b([1-6])\+([1-6])=(\d{1,2})\b|\b(colored )?(dr|third die) ([1-6])\b|\b(colored|white) ([1-6])\b/g;

function LogDie({ value, colored }: { value: number; colored?: boolean }) {
  return (
    <span className="log-die" title={`${colored ? 'colored' : 'white'} die: ${value}`}>
      <Die value={value} colored={colored} />
    </span>
  );
}

/** A log line's text with every roll in it drawn as dice. */
export function LogText({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(ROLL)) {
    out.push(text.slice(last, m.index));
    const k = m.index;
    if (m[1]) {
      out.push(
        <span key={k} className="log-roll">
          <LogDie value={+m[1]} colored />
          <LogDie value={+m[2]!} />
          <span className="log-total">={m[3]}</span>
        </span>,
      );
    } else if (m[5]) {
      out.push(
        <span key={k} className="log-roll">
          {m[4] ? 'colored ' : ''}
          {m[5]} <LogDie value={+m[6]!} colored={!!m[4]} />
        </span>,
      );
    } else {
      out.push(
        <span key={k} className="log-roll">
          <LogDie value={+m[8]!} colored={m[7] === 'colored'} />
        </span>,
      );
    }
    last = k + m[0].length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}
