import { useState, type KeyboardEvent } from 'react';
import { Emblem } from '../fx/TurnChit';
import { NATION, type LogLine, type LogRow, type LogSection } from './describe';
import { LogText } from './LogText';

/** A counter nationality's emblem, as a small chit at the start of a log line. */
export function NationBadge({ nation }: { nation: string | undefined }) {
  if (!nation) return <span className="log-nat none" aria-hidden />;
  return (
    <span className="log-nat" title={NATION[nation] ?? nation} aria-label={NATION[nation] ?? nation} role="img">
      <svg viewBox="-24 -24 48 48">
        <Emblem side={nation} />
      </svg>
    </span>
  );
}

/** A log entry: the line that opens it (a shot, a check, a move) and the indented lines after it (its results). */
export function logEntries(lines: LogLine[]): LogLine[][] {
  const out: LogLine[][] = [];
  for (const l of lines) {
    if (l.opens || !out.length) out.push([l]);
    else out[out.length - 1]!.push(l);
  }
  return out;
}

/** An entry has more to show expanded when it has results, notes or rows beyond its one line. */
const expandable = (entry: LogLine[]) => entry.length > 1 || entry.some((l) => l.detail || l.rows?.length);

/** A modifier's chip, tinted by its sign: "+2 TEM (trench)", "-1 vs FT possessor", "x2 Point Blank Fire". */
function Mod({ label }: { label: string }) {
  const sign = /^\s*\+/.test(label) ? 'plus' : /^\s*[-−]/.test(label) ? 'minus' : label === 'none' ? 'zero' : '';
  return <span className={`log-mod ${sign}`}>{label === 'none' ? 'no modifiers' : label}</span>;
}

/** What a line without rows is called in the expanded entry. */
const KIND_ROW: Record<LogLine['kind'], string> = { fire: 'After', check: 'Check', move: 'Move', info: 'Then', cc: 'CC', end: 'End', phase: '' };

function Row({ row }: { row: LogRow }) {
  return (
    <div className="log-row">
      <span className="log-k">{row.k}</span>
      <span className="log-v">
        <LogText text={row.v} />
        {row.mods?.map((m, i) => <Mod key={i} label={m} />)}
        {row.out && <span className="log-out">{row.out}</span>}
      </span>
    </div>
  );
}

/** The entry expanded: who did what to whom, then every figure behind it, one labelled row each. */
function LogCard({ entry, onClose }: { entry: LogLine[]; onClose: () => void }) {
  const [head, ...rest] = entry as [LogLine, ...LogLine[]];
  const rowsOf = (l: LogLine, first: boolean): LogRow[] => {
    if (l.rows?.length) return l.rows;
    const own: LogRow[] = first ? [] : [{ k: KIND_ROW[l.kind], v: l.text.trim() }];
    return l.detail ? [...own, { k: 'Notes', v: l.detail }] : own;
  };
  return (
    <div className={`log-card side-${head.nation ?? 'none'}`}>
      <button type="button" className="log-card-title" onClick={onClose} title="Collapse">
        <NationBadge nation={head.nation} />
        <span className="log-card-name">
          <LogText text={head.title ?? head.text.trim()} />
        </span>
        <span className="log-chev" aria-hidden>
          ▾
        </span>
      </button>
      {rowsOf(head, true).map((r, i) => (
        <Row key={`h${i}`} row={r} />
      ))}
      {rest.map((l) => (
        <div key={l.seq + l.text} className={`log-card-line log-${l.kind}`}>
          <NationBadge nation={l.nation} />
          <div>
            {rowsOf(l, false).map((r, i) => (
              <Row key={i} row={r} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The log's phases, each entry one line per event with its nationality's emblem. Clicking an entry with more to it
 * spells it out (every FP and DRM modifier, each target's result) and shows its LOS on the map; clicking it again
 * folds it back.
 */
export function LogSections({
  sections,
  sideName,
  losReview,
  onLosReview,
}: {
  sections: LogSection[];
  sideName: (side: string) => string;
  losReview: number | null;
  onLosReview: (seq: number | null) => void;
}) {
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const toggle = (entry: LogLine[]) => {
    const head = entry[0]!;
    const los = entry.find((l) => l.los);
    const opening = expandable(entry) ? !open.has(head.seq) : losReview !== los?.seq;
    if (expandable(entry)) setOpen((s) => {
      const n = new Set(s);
      if (opening) n.add(head.seq);
      else n.delete(head.seq);
      return n;
    });
    if (los) onLosReview(opening ? los.seq : losReview === los.seq ? null : losReview);
  };
  const keyToggle = (entry: LogLine[]) => (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    toggle(entry);
  };
  return (
    <>
      {sections.map((sec) => (
        <section key={sec.head ? `p${sec.head.seq}` : 'pre'} className={`log-sec ${sec.lines.length ? '' : 'empty'}`}>
          {sec.head?.phase ? (
            <h4 className={`log-head side-${sec.head.phase.side}`}>
              <NationBadge nation={sec.head.nation} />
              <span className="log-turn">Turn {sec.head.phase.turn}</span>
              <span className="log-side">{sideName(sec.head.phase.side)}</span>
              <span className="log-phase-name">{sec.head.phase.name}</span>
            </h4>
          ) : sec.head ? (
            <h4 className="log-head">{sec.head.text}</h4>
          ) : null}
          {sec.lines.length > 0 && (
            <ol>
              {logEntries(sec.lines).map((entry) => {
                const head = entry[0]!;
                const more = expandable(entry);
                const los = entry.find((l) => l.los);
                const isOpen = more && open.has(head.seq);
                const reviewing = !!los && los.seq === losReview;
                const clickable = more || !!los;
                return (
                  <li
                    key={head.seq + head.text}
                    className={`log-entry log-${head.kind} ${isOpen ? 'open' : ''} ${clickable ? 'clickable' : ''} ${reviewing ? 'reviewing' : ''}`}
                    {...(clickable && !isOpen
                      ? {
                          onClick: () => toggle(entry),
                          onKeyDown: keyToggle(entry),
                          role: 'button',
                          tabIndex: 0,
                          'aria-expanded': more ? false : undefined,
                          title: more ? (los ? 'Show every modifier, and the LOS on the map' : 'Show every modifier') : reviewing ? 'Hide the LOS' : head.kind === 'fire' ? "Show this shot's LOS on the map" : 'Show the Interdiction LOS on the map',
                        }
                      : {})}
                  >
                    {isOpen ? (
                      <LogCard entry={entry} onClose={() => toggle(entry)} />
                    ) : (
                      entry.map((l, i) => (
                        <div key={l.seq + l.text} className={`log-line log-${l.kind} ${i ? 'cont' : ''}`}>
                          <NationBadge nation={l.nation} />
                          <span className="log-txt">
                            <LogText text={l.text.trim()} />
                          </span>
                          {i === 0 && more && (
                            <span className="log-chev" aria-hidden>
                              ▸
                            </span>
                          )}
                        </div>
                      ))
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      ))}
    </>
  );
}
