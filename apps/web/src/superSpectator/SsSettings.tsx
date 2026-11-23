import { useNavigate } from 'react-router';
import type { MatchDoc } from '@asl/platform';
import { useAuth } from '../auth/AuthProvider';
import { ssBoardPath, useSsClaim } from './access';

/**
 * The Settings dialog's commentator switch for this match, shown only to an invited commentator who does not play in
 * it. On, it opens the commentators' board; off, it goes back to watching as everyone else does.
 */
export function SsSettings({ matchId, match, on }: { matchId: string; match: Pick<MatchDoc, 'mode' | 'visibility' | 'playerIds'>; on: boolean }) {
  const auth = useAuth();
  const user = 'user' in auth ? auth.user : null;
  const claim = useSsClaim(user);
  const navigate = useNavigate();
  if (!claim || !user || match.playerIds?.includes(user.uid)) return null;
  const leave = () => navigate(match.mode === 'online' ? `/app/match/${matchId}` : `/match/${matchId}/replay`);
  return (
    <section>
      <h3>Commentary</h3>
      <div className="set-row toggle">
        <span className="set-label">Super spectator mode</span>
        <label className="switch">
          <input type="checkbox" checked={on} onChange={(e) => (e.target.checked ? navigate(ssBoardPath(matchId)) : leave())} />
          <span className="knob" />
        </label>
      </div>
      <p className="muted small">
        The commentators' board for this match: the whole game, hidden units included when you choose, any step of it, with pings and drawings only the
        other commentators see. The players never see the room.
      </p>
    </section>
  );
}
