import { Navigate, useParams } from 'react-router';
import { useMember } from '../auth/AuthProvider';
import { Splash } from '../auth/RequireMember';
import { usePublicProfile } from './usePublicProfile';

export function ProfileRedirect() {
  const { uid } = useParams<{ uid: string }>();
  const { user } = useMember();
  const { profile, ready } = usePublicProfile(uid, uid === user.uid);
  if (!ready) return <Splash text="Finding that service record…" />;
  return profile ? <Navigate to={`/profile/${profile.nicknameNormalized}`} replace /> : <Navigate to="/app/starter-kit/home" replace />;
}
