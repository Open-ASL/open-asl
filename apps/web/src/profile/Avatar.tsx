import { gravatarUrl, rankFor, type UserDoc } from '@asl/platform';
import { RankInsignia } from './RankInsignia';

/**
 * A player's picture: their upload, or their Gravatar (an identicon when they have none).
 * With `xp` the rank insignia sits on its corner, as it does wherever a player is shown in the Lobby.
 */
export function Avatar({ profile, size = 40, xp }: { profile: Pick<UserDoc, 'photoURL' | 'gravatarHash' | 'displayName'>; size?: number; xp?: number }) {
  const src = profile.photoURL ?? gravatarUrl(profile.gravatarHash, size * 2);
  const img = <img className="avatar" src={src} width={size} height={size} alt="" title={profile.displayName} style={{ width: size, height: size }} />;
  if (xp === undefined) return img;
  return <span className="avatar-wrap" style={{ width: size, height: size }}>{img}<RankInsignia rank={rankFor(xp)} size={Math.round(size * 0.46)} /></span>;
}
