import { useMemo } from 'react';
import { Link } from 'react-router';
import { rankFor, type MatchDoc } from '@asl/platform';
import { MatchList } from '../lobby/MatchList';
import { useLiveMatches, useMyMatches } from '../lobby/useMatches';
import { useMember } from '../auth/AuthProvider';
import { Avatar } from '../profile/Avatar';
import { usePublicProfile } from '../profile/usePublicProfile';
import { presenceUnavailable, useLobbyUsers } from './LobbyUsers';
import { rulesetName, useLobbyRuleset } from './ruleset';

const SHOWN_GAMES = 6;
const SHOWN_LIVE = 4;
const SHOWN_ONLINE = 8;

/** The home dashboard: what needs the player's attention first, then what is going on around them. */
export function LobbyHome() {
  const { user, profile } = useMember();
  const ruleset = useLobbyRuleset();
  const publicRecord = usePublicProfile(user.uid, true).profile;
  const mine = useMyMatches(user.uid, ruleset);
  const live = useLiveMatches(ruleset);
  const lobby = useLobbyUsers();
  const rank = rankFor(profile.xp);
  const nickname = publicRecord?.nickname ?? profile.displayName;

  // Games waiting on this player come first, then other online matches, open seats, and finally solo games.
  const yourMove = (m: MatchDoc) => m.mode === 'online' && m.status === 'active' && !!m.summary.toMove && m.seats[m.summary.toMove]?.uid === user.uid;
  const priority = (m: MatchDoc) => (yourMove(m) ? 0 : m.mode === 'online' && m.status === 'active' ? 1 : m.status === 'open' ? 2 : 3);
  const games = useMemo(() => [...mine.rows].sort((a, b) => priority(a.match) - priority(b.match)), [mine.rows]);
  const waiting = games.filter((r) => yourMove(r.match)).length;
  const others = live.rows.filter((r) => !r.match.playerIds.includes(user.uid));

  return (
    <main className="lobby-dashboard">
      <section className="dashboard-status">
        <Avatar profile={profile} size={58} xp={profile.xp} />
        <div>
          <p className="eyebrow">{rulesetName(ruleset)}</p>
          <h1>Welcome back, {nickname}.</h1>
          <p className="dashboard-record">{rank.title} · {profile.elo} Elo · {profile.wins}–{profile.losses}–{profile.draws} ranked</p>
        </div>
        <div className="hero-actions"><Link className="btn primary" to={`/app/${ruleset}/scenarios`}>Explore scenarios</Link><Link className="btn" to={`/app/${ruleset}/games`}>Find a game</Link></div>
      </section>

      <div className="dashboard-grid">
        <div className="dashboard-main">
          <section className="command-card dashboard-games">
            <header>
              <h2>Your games</h2>
              <div className="card-tools">
                {mine.ready && games.length > 0 && <span className={waiting ? 'attention' : ''}>{waiting ? `${waiting} awaiting your move` : `${games.length} in progress`}</span>}
                <Link to={`/app/${ruleset}/games`}>Games desk</Link>
              </div>
            </header>
            {mine.ready && !games.length && !mine.error
              ? <div className="dashboard-empty"><p>No games in progress.</p><div><Link className="btn primary" to={`/app/${ruleset}/scenarios`}>Pick a scenario</Link><Link className="btn" to={`/app/${ruleset}/games`}>Join an open table</Link></div></div>
              : <MatchList rows={games.slice(0, SHOWN_GAMES)} error={mine.error} empty="Loading…" />}
            {games.length > SHOWN_GAMES && <Link className="card-more" to={`/app/${ruleset}/games`}>Show all {games.length} games</Link>}
          </section>

          <section className="command-card dashboard-live">
            <header>
              <h2>Live tables</h2>
              <div className="card-tools"><span className="live-dot">● Live</span><Link to={`/app/${ruleset}/games#live-games`}>Browse all</Link></div>
            </header>
            <MatchList rows={others.slice(0, SHOWN_LIVE)} error={live.error} empty={live.ready ? 'No public games are under way. Post one from the games desk.' : 'Loading…'} />
          </section>
        </div>

        <aside className="dashboard-side">
          <section className="command-card dashboard-online">
            <header><h2>In the Lobby</h2><span className="online-count">{lobby.players.length} online</span></header>
            {lobby.players.length
              ? <ul className="lobby-roster">{lobby.players.slice(0, SHOWN_ONLINE).map((p) => <li key={p.uid}><Avatar profile={{ ...p, displayName: p.nickname, gravatarHash: '' }} size={28} xp={p.xp} /><Link to={`/profile/${p.nicknameNormalized}`}>{p.uid === user.uid ? 'You' : p.nickname}</Link></li>)}{lobby.players.length > SHOWN_ONLINE && <li className="roster-more">+{lobby.players.length - SHOWN_ONLINE} more</li>}</ul>
              : <p className="empty-state">{lobby.unavailable ? presenceUnavailable(lobby.unavailable) : lobby.ready ? 'The Lobby is quiet.' : 'Checking who is here…'}</p>}
            <Link className="btn" to={`/app/${ruleset}/chat`}>Open lobby chat</Link>
          </section>
        </aside>
      </div>
    </main>
  );
}
