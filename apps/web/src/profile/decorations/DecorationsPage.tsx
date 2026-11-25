import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { scenarioById } from '@asl/content';
import { COMPUTER_NAME, MEDALS, THEATRES, TIERS, betaOpen, emptyServiceRecord, isMedalId, measureShare, type ChecklistRow, type Measure, type Medal, type PublicProfileDoc, type UserDoc } from '@asl/platform';
import { useAuth } from '../../auth/AuthProvider';
import { ScenarioLink } from '../../lobby-v2/ScenarioLink';
import { SideBadge } from '../../lobby-v2/SideBadge';
import { PublicProfileFrame, useProfileByNickname } from '../PublicProfilePage';
import { DecorationThumb, PartBars, awardedOn, deployLink, heldById, levelLabel, nationName, useOwnMeasures } from './shared';

type Filter = 'all' | 'earned' | 'open' | 'human' | 'bot';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'earned', label: 'Earned' },
  { id: 'open', label: 'Not yet' },
  { id: 'human', label: 'Against players' },
  { id: 'bot', label: `Against ${COMPUTER_NAME}` },
];

const poolLabel = (m: Medal) => (m.pool === 'bot' ? `Against ${COMPUTER_NAME}` : m.pool === 'human' ? 'Against players' : 'Beta');

/**
 * Every decoration a player can earn, by tier, with how far along they are: on their own record the full counts and,
 * for each decoration, the scenarios still to win; on anyone else's, the headline counts only.
 */
export function DecorationsPage() {
  const { nickname = '', id } = useParams<{ nickname: string; id?: string }>();
  const profile = useProfileByNickname(nickname, id ? `/decorations/${id}` : '/decorations');
  const auth = useAuth();
  const own = profile && auth.status === 'member' && auth.user.uid === profile.uid ? auth.profile : null;
  if (profile === undefined) return <PublicProfileFrame><p className="profile-loading">Reading service record…</p></PublicProfileFrame>;
  if (!profile) return <PublicProfileFrame><div className="profile-missing"><h1>No such player</h1><Link to="/">Return home</Link></div></PublicProfileFrame>;
  const base = `/profile/${profile.nicknameNormalized}`;
  const medal = id && isMedalId(id) ? MEDALS.find((m) => m.id === id) : undefined;
  return <PublicProfileFrame>
    <main className="public-profile decorations-page">
      {medal ? <AwardDetail medal={medal} profile={profile} own={own} base={base} /> : <AwardList profile={profile} own={own} base={base} />}
    </main>
  </PublicProfileFrame>;
}

function AwardList({ profile, own, base }: { profile: PublicProfileDoc; own: UserDoc | null; base: string }) {
  const [filter, setFilter] = useState<Filter>('all');
  const measured = useOwnMeasures(own);
  const held = heldById(profile.medals, MEDALS);
  const open = betaOpen();
  const shown = MEDALS.filter((m) => {
    // A closed beta's ribbons stay listed only for those who earned them.
    if (m.beta && !open && !held.has(m.id)) return false;
    if (filter === 'earned') return held.has(m.id);
    if (filter === 'open') return !held.has(m.id);
    if (filter === 'human' || filter === 'bot') return m.pool === filter;
    return true;
  });
  const total = MEDALS.filter((m) => !m.beta).length;
  const earned = MEDALS.filter((m) => !m.beta && held.has(m.id)).length;
  return <>
    <header className="decorations-head">
      <Link className="decorations-back" to={base}>← {profile.nickname}’s service record</Link>
      <h1>Ribbons &amp; medals</h1>
      <p>{earned} of {total} decorations earned. {own ? `Each counts ranked matches against players or games against ${COMPUTER_NAME}, from the day decorations began; open one to see the scenarios still to win.` : `Only ${profile.nickname} sees the scenario-by-scenario detail.`}</p>
      <div className="seg decorations-filter" role="tablist" aria-label="Show">
        {FILTERS.map((f) => <button key={f.id} role="tab" aria-selected={filter === f.id} className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id)}>{f.label}</button>)}
      </div>
    </header>
    {TIERS.map((tier) => {
      const list = shown.filter((m) => m.tier === tier.id);
      if (!list.length) return null;
      return <section key={tier.id} className="decorations-tier">
        <h2>{tier.name}</h2>
        <ul className="award-grid">
          {list.map((m) => {
            const award = held.get(m.id);
            const measure = measured?.measures.get(m.id);
            const pub = profile.awardProgress?.[m.id];
            const parts = measure ? measure.parts : !award && pub ? [{ label: 'Progress', value: pub[0], goal: pub[1] }] : [];
            return <li key={m.id}>
              <Link to={`${base}/decorations/${m.id}`} className={`award-card ${award ? 'earned' : ''} ${m.art ? 'supreme' : ''}`}>
                <DecorationThumb medal={m} level={award?.level ?? 1} size="card" />
                <span className="award-card-text">
                  <b>{m.name}</b>
                  <small className="award-meta">{nationName(m)} · {poolLabel(m)}</small>
                  <span className="award-criteria">{m.criteria}</span>
                  {award && <small className="decoration-award">Awarded {awardedOn(award.awardedAt)}{(award.level ?? 1) > 1 ? ` · ${levelLabel(m, award.level ?? 1)}` : ''}</small>}
                  {parts.length > 0 && <PartBars parts={parts} />}
                </span>
              </Link>
            </li>;
          })}
        </ul>
      </section>;
    })}
  </>;
}

function AwardDetail({ medal, profile, own, base }: { medal: Medal; profile: PublicProfileDoc; own: UserDoc | null; base: string }) {
  const measured = useOwnMeasures(own);
  const award = heldById(profile.medals, MEDALS).get(medal.id);
  const measure = measured?.measures.get(medal.id);
  const pub = profile.awardProgress?.[medal.id];
  const level = award?.level ?? (award ? 1 : 0);
  return <>
    <header className="decorations-head">
      <Link className="decorations-back" to={`${base}/decorations`}>← All decorations</Link>
    </header>
    <section className={`award-hero ${award ? 'earned' : ''}`}>
      <DecorationThumb medal={medal} level={Math.max(1, level)} size="large" />
      <div>
        <p className="eyebrow">{nationName(medal)} · {TIERS.find((t) => t.id === medal.tier)!.name} · {poolLabel(medal)}</p>
        <h1>{medal.name}</h1>
        <p className="award-criteria">{medal.criteria}</p>
        {award
          ? <p className="decoration-award">Awarded {awardedOn(award.awardedAt)}{level > 1 ? ` · ${levelLabel(medal, level)}, last on ${awardedOn(award.levelAt)}` : ''}</p>
          : <p className="award-not-yet">Not yet earned.</p>}
        {measure && measure.parts.length > 0 && <><h3>{award ? (medal.classes ? 'Toward the next class' : 'Toward the next star') : 'Progress'}</h3><PartBars parts={measure.parts} /></>}
        {!measure && !award && pub && <PartBars parts={[{ label: 'Progress', value: pub[0], goal: pub[1] }]} />}
        {measure && award && measure.parts.length === 0 && <p className="award-not-yet">Complete: nothing further to earn.</p>}
      </div>
    </section>
    {own && measure ? <AwardWork medal={medal} measure={measure} own={own} /> : !own && <p className="decor-hint">Only {profile.nickname} sees which scenarios count toward this.</p>}
  </>;
}

/** What is left to do: the groups a decoration counts, and its scenarios with the sides that count and the wins so far. */
function AwardWork({ medal, measure, own }: { medal: Medal; measure: Measure; own: UserDoc }) {
  const record = own.service ?? emptyServiceRecord();
  return <>
    {measure.groups && <section className="profile-section">
      <header><div><h2>{measure.groupsTitle}</h2></div></header>
      <ul className="award-groups">
        {measure.groups.map((g) => <li key={g.label} className={g.value >= g.goal ? 'done' : ''}><b>{g.label}</b><PartBars parts={[{ label: 'Wins', value: g.value, goal: g.goal }]} /></li>)}
      </ul>
    </section>}
    {medal.id === 'us-silver-star' && <p className="decor-hint">Current run: {record.winRun.length ? record.winRun.map((sid) => scenarioById(sid)?.title ?? sid).join(' · ') : 'none'}. A loss or a draw ends it; a win in a scenario already in the run starts it again from that win.</p>}
    {(medal.id === 'us-presidential-unit-citation' || medal.id === 'us-soldiers-medal') && <p className="decor-hint">A sudden-death win is one the scenario's victory conditions end before the last turn. Won so far by sudden death: {(medal.pool === 'bot' ? record.suddenDeath.bot : record.suddenDeath.human).map((sid) => scenarioById(sid)?.title ?? sid).join(' · ') || 'none'}.</p>}
    {medal.id === 'us-good-conduct' && <p className="decor-hint">Every ranked match counts unless you concede before half its turns or run out of time; either starts the count again. An opponent who quits early or runs out of time leaves your count where it was.</p>}
    {measure.checklist && <Checklist rows={measure.checklist} vsComputer={medal.pool === 'bot'} complete={measure.level > 0 && measure.parts.length === 0} />}
  </>;
}

type Show = 'todo' | 'done' | 'all';

function Checklist({ rows, vsComputer, complete }: { rows: ChecklistRow[]; vsComputer: boolean; complete: boolean }) {
  const todo = rows.filter((r) => !r.done);
  // A complete decoration's list is a record of where it was won, not a list of games to find.
  const [show, setShow] = useState<Show>(todo.length && !complete ? 'todo' : complete ? 'done' : 'all');
  const [theatre, setTheatre] = useState('');
  const theatres = useMemo(() => THEATRES.filter((t) => rows.some((r) => r.scenario.theatre === t.id)), [rows]);
  const shown = rows.filter((r) => (show === 'all' || (show === 'done') === r.done) && (!theatre || r.scenario.theatre === theatre));
  return <section className="profile-section award-checklist">
    <header>
      <div><h2>Scenarios</h2><p className="muted">{rows.length - todo.length} of {rows.length} done. {vsComputer ? `Wins over ${COMPUTER_NAME} as the side shown.` : 'Wins against players as the side shown.'}</p></div>
      <div className="award-checklist-tools">
        <div className="seg" role="tablist" aria-label="Show">
          {(['todo', 'done', 'all'] as const).map((s) => <button key={s} role="tab" aria-selected={show === s} className={show === s ? 'on' : ''} onClick={() => setShow(s)}>{s === 'todo' ? `To do (${todo.length})` : s === 'done' ? `Done (${rows.length - todo.length})` : 'All'}</button>)}
        </div>
        {theatres.length > 1 && <select aria-label="Theatre" value={theatre} onChange={(e) => setTheatre(e.target.value)}><option value="">Every theatre</option>{theatres.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}
      </div>
    </header>
    {shown.length ? <ol className="award-rows">
      {shown.map((r) => {
        const def = scenarioById(r.scenario.id);
        return <li key={r.scenario.id} className={r.done ? 'done' : ''}>
          <span className="award-row-mark" aria-label={r.done ? 'Done' : 'To do'}>{r.done ? '✓' : ''}</span>
          <span className="award-row-what"><ScenarioLink scenarioId={r.scenario.id}>{r.scenario.title}</ScenarioLink><small>{THEATRES.find((t) => t.id === r.scenario.theatre)?.name} · {r.scenario.year}</small></span>
          <span className="award-row-sides">
            {r.sides.map((s) => <span key={s.side} className={`award-side ${s.wins ? 'won' : ''}`}>
              <SideBadge scenario={def} side={s.side} />
              <b>{s.wins} {s.wins === 1 ? 'win' : 'wins'}</b>
              {!s.wins && !complete && <Link className="btn small" to={deployLink(r.scenario.id, s.side, vsComputer)}>{vsComputer ? `Play ${COMPUTER_NAME}` : 'Find a game'}</Link>}
            </span>)}
          </span>
        </li>;
      })}
    </ol> : <p className="battle-empty">{show === 'todo' ? 'Every scenario done.' : 'Nothing here yet.'}</p>}
  </section>;
}
