import { Link, useParams } from 'react-router';
import { nextRank, rankFor } from '@asl/platform';
import { useMember } from '../auth/AuthProvider';
import { Splash } from '../auth/RequireMember';
import { Avatar } from './Avatar';
import { AvatarUpload } from './AvatarUpload';
import { Medals } from './Medals';
import { RankInsignia } from './RankInsignia';
import { useUserDoc } from './useUserDoc';

/** /app/profile/:uid — a player's service record. */
export function ProfilePage() {
  const { uid } = useParams<{ uid: string }>();
  const me = useMember();
  const own = uid === me.user.uid;
  const fetched = useUserDoc(own ? undefined : uid);
  const profile = own ? me.profile : fetched;
  if (!uid) return null;
  if (!profile) return <Splash text="Pulling the file…" />;

  const rank = rankFor(profile.xp);
  const next = nextRank(profile.xp);
  const games = profile.onlineGames + profile.hotseatGames;

  return (
    <div className="lobby-stack profile">
      <section className="card">
        <div className="profile-head">
          <div className="profile-pic">
            <Avatar profile={profile} size={128} />
            <RankInsignia rank={rank} />
          </div>
          <div className="profile-id">
            <span className="rank-title">{rank.title}</span>
            <h1 className="profile-name">{profile.displayName}</h1>
            <div className="profile-meta">
              <span>
                Rating <b>{profile.elo}</b>
              </span>
              <span>
                Record <b>{profile.wins}–{profile.losses}–{profile.draws}</b>
              </span>
              <span>
                Games <b>{games}</b>
              </span>
              {profile.streak >= 2 && (
                <span>
                  Streak <b>{profile.streak}</b>
                </span>
              )}
              {profile.activeMatchId && (
                <span>
                  <Link to={`/app/match/${profile.activeMatchId}`}>In a match</Link>
                </span>
              )}
            </div>
            <div className="xp">
              <div className="xp-bar">
                <span style={{ width: `${Math.round((next?.progress ?? 1) * 100)}%` }} />
              </div>
              <span className="muted small">
                {profile.xp} XP
                {next ? ` · ${next.remaining} to ${next.rank.title}` : ' · top of the ladder'}
              </span>
            </div>
            {own && <AvatarUpload uid={uid} hasPhoto={!!profile.photoURL} />}
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Decorations</h2>
        <Medals profile={profile} />
        <p className="muted small">
          The beta ribbons are for the players who helped test the game, and can only be earned while the beta runs. The other award
          criteria are placeholders while the achievement system is designed.
        </p>
      </section>

      <section className="card">
        <h2>Service record</h2>
        <dl className="service">
          <dt>Matches against players</dt>
          <dd>{profile.onlineGames}</dd>
          <dt>Hotseat games completed</dt>
          <dd>{profile.hotseatGames}</dd>
          <dt>Games abandoned</dt>
          <dd>{profile.abandoned}</dd>
          <dt>Scenarios completed</dt>
          <dd>{profile.scenariosCompleted.length ? profile.scenariosCompleted.join(', ') : 'none yet'}</dd>
        </dl>
      </section>
    </div>
  );
}
