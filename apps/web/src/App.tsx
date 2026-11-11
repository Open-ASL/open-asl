import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router';
import { RequireMember, Splash } from './auth/RequireMember';
import { playSfx } from './audio/engine';
import { InviteListener } from './invites/InviteListener';
import { MatchRoute } from './match/MatchRoute';
import { Landing } from './pages/landing/Landing';
import { Login } from './pages/Login';
import { NotInvited } from './pages/NotInvited';
import { RulesetGate } from './lobby-v2/RulesetGate';
import { LobbyShell } from './lobby-v2/LobbyShell';
import { LobbyHome } from './lobby-v2/LobbyHome';
import { GamesHub } from './lobby-v2/GamesHub';
import { ChatPage } from './lobby-v2/ChatPage';
import { Presence } from './lobby-v2/Presence';
import { AdminAnnouncements } from './lobby-v2/AdminAnnouncements';
import { PublicReplay } from './match/PublicReplay';
import { ProfileRedirect } from './profile/ProfileRedirect';

const ScenarioExplorer = lazy(() => import('./lobby-v2/ScenarioExplorer').then((m) => ({ default: m.ScenarioExplorer })));
const PublicProfilePage = lazy(() => import('./profile/PublicProfilePage').then((m) => ({ default: m.PublicProfilePage })));
const AarPage = lazy(() => import('./aar/AarPage').then((m) => ({ default: m.AarPage })));

export function App() {
  useEffect(() => {
    // Every ordinary button clicks; the wheels and the board make their own sounds.
    const click = (e: MouseEvent) => {
      const b = (e.target as HTMLElement | null)?.closest?.('button');
      if (b && !b.disabled && !b.closest('.aw') && !b.closest('.stack-peek')) playSfx('ui.tick');
    };
    document.addEventListener('click', click, true);
    return () => document.removeEventListener('click', click, true);
  }, []);

  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/not-invited" element={<NotInvited />} />
      <Route path="/profile/:nickname" element={<Suspense fallback={<Splash text="Reading service record…" />}><PublicProfilePage /></Suspense>} />
      <Route path="/match/:id/replay" element={<PublicReplay />} />
      <Route path="/aar/:matchId" element={<Suspense fallback={<Splash text="Reading the after action report…" />}><AarPage /></Suspense>} />
      <Route
        path="/app"
        element={
          <RequireMember>
            <MemberArea />
          </RequireMember>
        }
      >
        <Route index element={<RulesetGate />} />
        <Route path=":ruleset" element={<LobbyShell />}>
          <Route index element={<Navigate to="home" replace />} />
          <Route path="home" element={<LobbyHome />} />
          <Route path="scenarios" element={<Suspense fallback={<Splash text="Unfolding the atlas…" />}><ScenarioExplorer /></Suspense>} />
          <Route path="games" element={<GamesHub />} />
          <Route path="players" element={<Navigate to="../home" replace />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="admin/announcements" element={<AdminAnnouncements />} />
        </Route>
        <Route path="profile/:uid" element={<ProfileRedirect />} />
        <Route path="match/:id" element={<MatchRoute />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/** Everything behind the gate shares the invite popup, whatever page is open. */
function MemberArea() {
  return (
    <>
      <Presence />
      <InviteListener />
      <Outlet />
    </>
  );
}
