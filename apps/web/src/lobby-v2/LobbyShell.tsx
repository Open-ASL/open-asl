import { useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useParams } from 'react-router';
import { isRulesetId, rankFor } from '@asl/platform';
import { useMember, signOut } from '../auth/AuthProvider';
import { Avatar } from '../profile/Avatar';
import { Emblem } from '../ui/Emblem';
import { GearIcon } from '../ui/GearIcon';
import { SettingsPanel } from '../settings/SettingsPanel';
import { useFxLevel, useWeatherFx, useYourCallStrip } from '../fx/settings';
import { usePublicProfile } from '../profile/usePublicProfile';
import { LobbyIdleGuard } from './LobbyIdleGuard';
import { OutgoingInvites } from '../invites/InviteListener';
import { LobbyChatDock } from './LobbyChatDock';
import { rulesetName, useFullAslGate } from './ruleset';

const NAV = [
  ['home', 'Home'],
  ['scenarios', 'Scenarios'],
  ['games', 'Games'],
  ['chat', 'Chat'],
  // News is held back for now: `NewsPage` and the home news card return when the desk is ready.
] as const;

export function LobbyShell() {
  const { ruleset = 'starter-kit' } = useParams<{ ruleset: string }>();
  const fullAsl = useFullAslGate();
  const { user, profile } = useMember();
  const [settings, setSettings] = useState(false);
  const [fx, setFx] = useFxLevel();
  const [weatherFx, setWeatherFx] = useWeatherFx();
  const [callStrip, setCallStrip] = useYourCallStrip();
  const rank = rankFor(profile.xp);
  const publicRecord = usePublicProfile(user.uid, true).profile;
  // Full ASL is open only behind the development gate; anything else unknown goes back to the choice.
  if (ruleset === 'full-asl' && fullAsl === null) return null;
  if (!isRulesetId(ruleset) || (ruleset === 'full-asl' && !fullAsl)) return <Navigate to="/app?change=1" replace />;
  return (
    <div className="command-shell">
      <LobbyIdleGuard />
      <header className="command-topbar">
        <Link to={`/app/${ruleset}/home`} className="command-brand" aria-label="Open ASL Lobby">
          <Emblem />
          <span><b>OPEN ASL</b><small>Lobby</small></span>
        </Link>
        <nav className="command-nav" aria-label="Lobby">
          {NAV.map(([path, label]) => <NavLink key={path} to={`/app/${ruleset}/${path}`}>{label}</NavLink>)}
        </nav>
        <div className="command-account">
          <Link to={publicRecord ? `/profile/${publicRecord.nicknameNormalized}` : `/app/profile/${user.uid}`} className="command-profile">
            <Avatar profile={profile} size={36} xp={profile.xp} />
            <span><b>{publicRecord?.nickname ?? profile.displayName}</b><small>{rank.title} · {profile.elo}</small></span>
          </Link>
          <button className="icon-button" onClick={() => setSettings(true)} aria-label="Settings"><GearIcon /></button>
          <button className="text-button" onClick={() => signOut()}>Sign out</button>
        </div>
      </header>
      <div className="ruleset-ribbon">
        <span>Ruleset</span><b>{rulesetName(ruleset)}</b>{ruleset === 'full-asl' && <small className="ruleset-dev">In development</small>}
        <Link to="/app?change=1">Change</Link>
      </div>
      {settings && <SettingsPanel fx={fx} onFx={setFx} weatherFx={weatherFx} onWeatherFx={setWeatherFx} callStrip={callStrip} onCallStrip={setCallStrip} onClose={() => setSettings(false)} />}
      <div className="shell-notices"><OutgoingInvites /></div>
      <Outlet />
      <LobbyChatDock />
    </div>
  );
}
