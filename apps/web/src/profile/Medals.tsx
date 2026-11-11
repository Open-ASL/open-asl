import { useState } from 'react';
import { ALL_SCENARIOS, scenarioNumber } from '@asl/content';
import { BETA_CAMPAIGN_GOAL, MEDALS, betaOpen, medalById, type AwardedMedal, type Medal, type UserDoc } from '@asl/platform';
import { Modal } from '../ui/Modal';
import { toDate } from '../ui/time';

/** What progress toward a decoration can be measured from: a player's own full stats, or the public record of someone else. */
export type MedalStats = Partial<Pick<UserDoc, 'elo' | 'wins' | 'losses' | 'draws' | 'onlineGames' | 'hotseatGames' | 'abandoned' | 'streak' | 'scenariosCompleted' | 'betaScenarios'>>;

/**
 * The ribbon rack as worn: only the decorations earned, in order of precedence, three to a row
 * with the short top row centred. Click a ribbon for its name, how it is earned and when it was.
 * "All decorations" opens the full list, with progress toward the ones not yet earned.
 */
export function Medals({ profile, stats }: { profile: Pick<UserDoc, 'medals'>; stats?: MedalStats }) {
  const [open, setOpen] = useState<AwardedMedal | null>(null);
  const [all, setAll] = useState(false);
  const earned = [...profile.medals]
    .filter((m) => MEDALS.some((d) => d.id === m.id))
    .sort((a, b) => medalById(a.id).precedence - medalById(b.id).precedence);
  const rows: AwardedMedal[][] = [];
  if (earned.length) {
    const top = earned.length % 3 || 3;
    rows.push(earned.slice(0, top));
    for (let i = top; i < earned.length; i += 3) rows.push(earned.slice(i, i + 3));
  }
  const medal = open ? medalById(open.id) : null;
  return <>
    {earned.length
      ? <div className="rack" role="list" aria-label="Ribbon rack">
        {rows.map((row, i) => <div className="rack-row" key={i}>{row.map((m) => { const d = medalById(m.id); return <button key={m.id} type="button" role="listitem" className="ribbon-btn" title={d.name} onClick={() => setOpen(m)}><Ribbon medal={d} /></button>; })}</div>)}
      </div>
      : <p className="rack-empty">No decorations yet. Ribbons are awarded for play against other players.</p>}
    <div className="rack-foot"><button type="button" className="text-button" onClick={() => setAll(true)}>All decorations ({earned.length} of {MEDALS.length} earned)</button></div>
    {open && medal && <Modal kicker={medal.beta ? 'Beta decoration' : 'Decoration'} title={medal.name} onClose={() => setOpen(null)}>
      <div className="medal-detail">
        <Ribbon medal={medal} large />
        <p>{medal.criteria}</p>
        <small>Awarded {awardedOn(open)}</small>
      </div>
    </Modal>}
    {all && <AllDecorations held={profile.medals} stats={stats} onClose={() => setAll(false)} />}
  </>;
}

const awardedOn = (m: AwardedMedal) => toDate(m.awardedAt)?.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) ?? 'recently';

/** Every decoration in order of precedence: earned ones with their date, the rest with how to earn them and how far along the player is. */
function AllDecorations({ held, stats, onClose }: { held: AwardedMedal[]; stats?: MedalStats; onClose(): void }) {
  const got = new Map(held.map((m) => [m.id, m]));
  const open = betaOpen();
  return <Modal wide kicker="Decorations" title="Ribbons & medals" onClose={onClose}>
    <ol className="decoration-list">
      {[...MEDALS].sort((a, b) => a.precedence - b.precedence).map((m) => {
        const award = got.get(m.id);
        const progress = award ? null : medalProgress(m, stats);
        return <li key={m.id} className={`decoration ${award ? 'earned' : ''} ${m.beta && !award && !open ? 'closed' : ''}`}>
          <Ribbon medal={m} />
          <div className="decoration-text">
            <b>{m.name}{m.beta && <span className="ribbon-tag">{open ? 'Beta only' : 'Beta'}</span>}</b>
            <span>{m.criteria}</span>
            {award && <small className="decoration-award">Awarded {awardedOn(award)}</small>}
            {!award && m.beta && !open && <small>The beta has closed; this ribbon can no longer be earned.</small>}
            {progress && <div className="ribbon-progress"><div className="xp-bar"><span style={{ width: `${Math.min(100, Math.round((progress.value / progress.goal) * 100))}%` }} /></div><small>{progress.label}</small></div>}
          </div>
        </li>;
      })}
    </ol>
  </Modal>;
}

/** How far along a decoration is, where the stats to hand can say; null for event-based ones or when the figures are not public. */
function medalProgress(m: Medal, s: MedalStats | undefined): { value: number; goal: number; label: string } | null {
  if (!s) return null;
  const ranked = (s.wins ?? 0) + (s.losses ?? 0) + (s.draws ?? 0);
  const played = s.onlineGames !== undefined && s.hotseatGames !== undefined ? s.onlineGames + s.hotseatGames : ranked;
  const of = (value: number, goal: number, what: string) => ({ value, goal, label: `${Math.min(value, goal)} of ${goal} ${what}` });
  switch (m.id) {
    case 'moh': return s.elo === undefined ? null : { value: s.elo, goal: 1800, label: `Rating ${s.elo} of 1800` };
    case 'bronze-star': return s.wins === undefined ? null : of(s.wins, 5, 'wins');
    case 'silver-star': return s.streak === undefined ? null : of(s.streak, 3, 'in a row right now');
    case 'purple-heart': return s.losses === undefined ? null : of(s.losses, 1, 'losses');
    case 'cib': return of(s.onlineGames ?? ranked, 1, 'online matches');
    case 'puc': return of(played, 25, 'matches played');
    case 'good-conduct': return { value: played, goal: 10, label: `${Math.min(played, 10)} of 10 matches played${s.abandoned ? ` · ${s.abandoned} abandoned` : ''}` };
    case 'american-campaign': return s.hotseatGames === undefined ? null : of(s.hotseatGames, 5, 'hotseat games');
    case 'eame-campaign': {
      if (!s.scenariosCompleted) return null;
      const campaign = ALL_SCENARIOS.filter((sc) => sc.product === 'sk1');
      const done = campaign.filter((sc) => s.scenariosCompleted!.includes(sc.id));
      return { value: done.length, goal: campaign.length, label: `${done.length} of ${campaign.length} scenarios${done.length ? ` · ${done.map(scenarioNumber).join(', ')}` : ''}` };
    }
    case 'beta-service': return s.betaScenarios === undefined ? null : of(s.betaScenarios.length, 1, 'online matches in the beta');
    case 'beta-campaign': {
      if (!s.betaScenarios) return null;
      const played = s.betaScenarios.map((id) => ALL_SCENARIOS.find((sc) => sc.id === id)).map((sc, i) => (sc ? scenarioNumber(sc) : s.betaScenarios![i]!));
      return { value: played.length, goal: BETA_CAMPAIGN_GOAL, label: `${played.length} of ${BETA_CAMPAIGN_GOAL} scenarios${played.length ? ` · played ${played.join(', ')}` : ''}` };
    }
    default: return null;
  }
}

export function Ribbon({ medal, large = false }: { medal: Medal; large?: boolean }) {
  const stripes = [...medal.ribbon, ...medal.ribbon.slice(0, -1).reverse()];
  const w = 100 / stripes.length;
  const gradient = stripes.map((c, i) => `${c} ${i * w}% ${(i + 1) * w}%`).join(', ');
  return <span className={`ribbon ${large ? 'large' : ''}`} style={{ background: `linear-gradient(90deg, ${gradient})` }} aria-label={medal.short} />;
}
