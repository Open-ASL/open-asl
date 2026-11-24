import { Fragment } from 'react';

/**
 * Text shown inside a container that capitalises its lettering (a status line, a counter tag, a dice result), with
 * any lowercase "stun" / "stunned" kept as written: a stun is not a STUN, and the case is what tells them apart
 * (SK4 7.7; ASLRB D5.34). The one place that keeps a stun out of the capitals; a STUN is written in capitals already.
 */
export function StunCase({ text }: { text: string }) {
  const parts = text.split(/\b(stun(?:ned)?)\b/);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((s, i) => (i % 2 ? <span key={i} className="keep-case">{s}</span> : <Fragment key={i}>{s}</Fragment>))}
    </>
  );
}
