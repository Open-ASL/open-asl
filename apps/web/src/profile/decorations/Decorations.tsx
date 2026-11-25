import { useState } from 'react';
import { Link } from 'react-router';
import { COMPUTER_NAME, MEDALS, measureShare, type AwardedMedal, type Medal, type MedalId, type UserDoc } from '@asl/platform';
import { Modal } from '../../ui/Modal';
import { DecorationThumb, MedalImage, PartBars, Ribbon, awardedOn, heldById, levelLabel, nationName, useOwnMeasures } from './shared';

/** Ribbons to a row on the rack; the short row is worn on top, centred. */
const PER_ROW = 4;

/**
 * The decorations on a service record: the supreme ones as the medals themselves, the rest as a ribbon rack in order of
 * precedence with their stars. On the player's own record, the three decorations closest to coming next.
 */
export function Decorations({ medals, base, own }: { medals: AwardedMedal[]; base: string; own: Pick<UserDoc, 'service' | 'betaScenarios'> | null }) {
  const [open, setOpen] = useState<AwardedMedal | null>(null);
  const held = heldById(medals, MEDALS);
  const worn = MEDALS.filter((m) => held.has(m.id));
  const supreme = worn.filter((m) => m.art);
  const ribbons = worn.filter((m) => !m.art);
  const rows: Medal[][] = [];
  if (ribbons.length) {
    const top = ribbons.length % PER_ROW || PER_ROW;
    rows.push(ribbons.slice(0, top));
    for (let i = top; i < ribbons.length; i += PER_ROW) rows.push(ribbons.slice(i, i + PER_ROW));
  }
  const total = MEDALS.filter((m) => !m.beta).length;
  const earned = worn.filter((m) => !m.beta).length;
  const medal = open ? MEDALS.find((m) => m.id === open.id) : undefined;
  return <div className="decorations">
    <div className="decor-board">
      {supreme.length > 0 && <div className="decor-supreme" role="list" aria-label="Supreme decorations">
        {supreme.map((m) => <button key={m.id} type="button" role="listitem" className="decor-supreme-item" title={m.name} onClick={() => setOpen(held.get(m.id)!)}><MedalImage medal={m} /><span>{m.name}</span></button>)}
      </div>}
      {rows.length > 0 && <div className="rack" role="list" aria-label="Ribbon rack">
        {rows.map((row, i) => <div className="rack-row" key={i}>{row.map((m) => <button key={m.id} type="button" role="listitem" className="ribbon-btn" title={m.name} onClick={() => setOpen(held.get(m.id)!)}><Ribbon medal={m} level={held.get(m.id)!.level ?? 1} /></button>)}</div>)}
      </div>}
      {!worn.length && <p className="rack-empty">No decorations yet. They are earned in ranked matches against other players and in games against {COMPUTER_NAME}.</p>}
    </div>
    <div className="decor-foot">
      <span className="decor-count"><b>{earned}</b> of {total} decorations earned</span>
      <Link className="btn" to={`${base}/decorations`}>All decorations</Link>
    </div>
    {own && <Closest own={own} base={base} held={held} />}
    {open && medal && <Modal kicker={`${nationName(medal)} · ${medal.beta ? 'Beta decoration' : 'Decoration'}`} title={medal.name} onClose={() => setOpen(null)}>
      <div className="medal-detail">
        <DecorationThumb medal={medal} level={open.level ?? 1} size="large" />
        <p>{medal.criteria}</p>
        {(open.level ?? 1) > 1 && <small>{levelLabel(medal, open.level ?? 1)} · last on {awardedOn(open.levelAt)}</small>}
        <small>First awarded {awardedOn(open.awardedAt)}</small>
        <Link to={`${base}/decorations/${medal.id}`} onClick={() => setOpen(null)}>Progress and details</Link>
      </div>
    </Modal>}
  </div>;
}

/** The decorations nearest their next level, by how far along their counts are. */
function Closest({ own, base, held }: { own: Pick<UserDoc, 'service' | 'betaScenarios'>; base: string; held: Map<MedalId, AwardedMedal> }) {
  const measured = useOwnMeasures(own);
  if (!measured) return null;
  const near = MEDALS
    .filter((m) => !m.beta)
    .map((m) => ({ m, measure: measured.measures.get(m.id)! }))
    .filter(({ measure }) => measure.parts.length > 0 && measureShare(measure) > 0)
    .sort((a, b) => measureShare(b.measure) - measureShare(a.measure) || a.m.precedence - b.m.precedence)
    .slice(0, 3);
  if (!near.length) return <p className="decor-hint">Your first counted result starts the count toward every decoration. <Link to={`${base}/decorations`}>See what each one asks</Link>.</p>;
  return <div className="decor-closest">
    <h3>Closest to coming next</h3>
    <ul>
      {near.map(({ m, measure }) => <li key={m.id}>
        <Link to={`${base}/decorations/${m.id}`} className="decor-closest-card">
          <DecorationThumb medal={m} level={held.get(m.id)?.level ?? 1} size="card" />
          <span className="decor-closest-text"><b>{m.name}{held.has(m.id) ? ' · next star' : ''}</b><PartBars parts={measure.parts} /></span>
        </Link>
      </li>)}
    </ul>
  </div>;
}
