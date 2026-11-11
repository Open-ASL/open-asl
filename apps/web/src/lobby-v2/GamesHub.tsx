import { Link, useSearchParams } from 'react-router';
import { SCENARIO_CATALOG, isPlayable, scenarioById, scenarioName, scenarioNumber } from '@asl/content';
import { scenarioRuleset } from '@asl/rules';
import { COMPUTER_AVAILABLE, COMPUTER_NAME, rankFor } from '@asl/platform';
import { useMember } from '../auth/AuthProvider';
import { MatchList } from '../lobby/MatchList';
import { useLiveMatchPages, useMyMatches, useRecentResults } from '../lobby/useMatches';
import { ago } from '../ui/time';
import { aarPath } from '../aar/links';
import { BriefingDialog } from '../panels/Briefing';
import { Avatar } from '../profile/Avatar';
import { usePublicProfile } from '../profile/usePublicProfile';
import { useState } from 'react';
import { DeployPanel } from './DeployPanel';
import { ListingBoard } from './GameListings';
import { ScenarioLink } from './ScenarioLink';
import { SideBadge } from './SideBadge';
import { useLobbyRuleset } from './ruleset';

/**
 * The games desk. With a scenario chosen it is only the deploy desk, so starting a match is not buried
 * under the game lists; without one it shows your games, open posts and live tables.
 */
export function GamesHub() {
  const { user } = useMember();
  const ruleset = useLobbyRuleset();
  const [params] = useSearchParams();
  const challenge = params.get('challenge') ?? undefined;
  const selected = params.get('scenario');
  const scenario = selected ? scenarioById(selected) : undefined;
  const meta = SCENARIO_CATALOG.find((s) => s.id === selected);
  // A scenario of another ruleset is not deployed from this lobby.
  const playable = !!scenario && isPlayable(scenario) && scenarioRuleset(scenario) === ruleset;
  const atlas = `/app/${ruleset}/scenarios`;
  const atlasLink = challenge ? `${atlas}?challenge=${challenge}` : atlas;
  const [briefing, setBriefing] = useState(false);
  const mine = useMyMatches(user.uid, ruleset);

  return (
    <main className="games-hub page-frame">
      {scenario && playable
        && <header className="page-heading deploy-heading">
          <div>
            <h1><span className="deploy-kicker">{challenge ? 'Challenge' : 'Deploy'}</span><ScenarioLink scenarioId={scenario.id}>{scenarioNumber(scenario)} {scenarioName(scenario)}</ScenarioLink></h1>
            <p className="deploy-facts">{[meta?.place, meta?.year, meta?.turns ? `${meta.turns} turns` : null].filter(Boolean).join(' · ')}<span className="deploy-sides">{scenario.sides.map((s, i) => <span key={s.side}>{i > 0 && <span className="muted"> vs </span>}<SideBadge scenario={scenario} side={s.side} /></span>)}</span></p>
          </div>
          <div className="hero-actions"><button className="btn" onClick={() => setBriefing(true)}>Read briefing</button><Link className="btn" to={atlasLink}>Change scenario</Link></div>
        </header>}
      {scenario && playable ? <DeployPanel key={`${scenario.id}:${challenge ?? ''}`} scenario={scenario} challengeUid={challenge} /> : <StartPrompt challengeUid={challenge} atlasLink={atlasLink} unplayable={!!selected && !playable} />}
      {briefing && scenario && <BriefingDialog scenario={scenario} onClose={() => setBriefing(false)} />}

      {!(scenario && playable) && <>
        <section className="command-card games-mine" id="your-games">
          <header><h2>Your games</h2><span className="card-tools">{mine.ready ? `${mine.rows.length} in progress` : ''}</span></header>
          <MatchList rows={mine.rows} error={mine.error} empty={mine.ready ? 'No games in progress.' : 'Loading…'} />
        </section>
        <ListingBoard />
        <LiveGamesBrowser />
        <RecentResults />
      </>}
    </main>
  );
}

/** No scenario yet: point at the atlas, carrying along the player being challenged. */
function StartPrompt({ challengeUid, atlasLink, unplayable }: { challengeUid?: string; atlasLink: string; unplayable: boolean }) {
  const target = usePublicProfile(challengeUid).profile;
  // The computer plays only the Starter Kit for now: the Full ASL lobby does not offer it.
  const fullAsl = useLobbyRuleset() === 'full-asl';
  const opponents = !COMPUTER_AVAILABLE || fullAsl ? 'hotseat or against another player' : `hotseat, against ${COMPUTER_NAME}, or against another player`;
  return <section className="command-card start-prompt">
    <div>
      {target
        ? <><div className="challenge-target"><Avatar profile={{ ...target, displayName: target.nickname, gravatarHash: '' }} size={40} xp={target.xp} /><div><b>Challenge {target.nickname}</b><small>{rankFor(target.xp).title} · {target.elo} Elo · {target.wins}–{target.losses}–{target.draws}</small></div></div><p>Pick the scenario you want to fight on the atlas. You come straight back here to send the challenge.</p></>
        : <><h2>Start a game</h2><p>{unplayable ? 'That scenario cannot be deployed from this lobby. Choose another on the atlas.' : `Choose a scenario on the atlas, then play it ${opponents}.`}</p></>}
    </div>
    <Link className="btn primary" to={atlasLink}>Open the atlas</Link>
  </section>;
}

function LiveGamesBrowser() {
  const ruleset = useLobbyRuleset();
  const live = useLiveMatchPages(ruleset);
  return <section className="command-card live-games-browser" id="live-games">
    <header><h2>Live public tables</h2><span className="card-tools">Page {live.page + 1} · up to 25 at a time</span></header>
    <MatchList rows={live.rows} error={live.error} empty={live.loading ? 'Loading live tables…' : 'No public games are in progress.'} />
    {(live.canPrevious || live.canNext) && <div className="live-page-controls">
      <button className="ghost" disabled={!live.canPrevious || live.loading} onClick={live.previous}>Previous 25</button>
      <button className="ghost" disabled={!live.canNext || live.loading} onClick={live.next}>Next 25</button>
    </div>}
  </section>;
}

/** The latest public results, each with its after action report. Nothing is shown until there is one. */
function RecentResults() {
  const ruleset = useLobbyRuleset();
  const recent = useRecentResults(ruleset);
  const rows = recent.rows;
  if (!rows.length) return null;
  return <section className="command-card recent-results" id="recent-results">
    <header><h2>Recent results</h2><span className="card-tools">Public games · latest first</span></header>
    <div>
      {rows.map(({ id, match }) => {
        const scenario = scenarioById(match.scenarioId);
        const r = match.result;
        const name = (side: string | null) => (side ? match.seats[side]?.displayName ?? scenario?.sides.find((s) => s.side === side)?.name ?? side : '');
        const sides = Object.keys(match.seats);
        const winner = r?.winner ?? null;
        const loser = sides.find((s) => s !== winner) ?? null;
        const line = winner ? `${name(winner)} beat ${name(loser)}` : `${name(sides[0] ?? null)} and ${name(sides[1] ?? null)} drew`;
        return <div key={id} className={`lobby-result side-${winner ?? 'neutral'}`}>
          <SideBadge scenario={scenario} side={winner ?? sides[0] ?? ''} name={false} />
          <span><div className="l1">{line}</div><div className="l2">{match.scenarioTitle} · {r?.reason ?? 'finished'} · {ago(match.completedAt)}</div></span>
          <Link className="battle-aar" to={aarPath(id)}><svg viewBox="0 0 24 24" aria-hidden><path d="M4 19V5h16v14zM8 15V9M12 15v-4M16 15V7" /></svg>AAR</Link>
        </div>;
      })}
    </div>
  </section>;
}
