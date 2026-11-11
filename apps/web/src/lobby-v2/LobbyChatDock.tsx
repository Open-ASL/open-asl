import { useLocation } from 'react-router';
import { ChatDock } from '../chat/ChatDock';
import { lobbyChannelId } from '@asl/platform';
import { LobbyUsers, useLobbyUsers } from './LobbyUsers';
import { useLobbyRuleset } from './ruleset';

/**
 * The Lobby chat on every lobby page (each ruleset's lobby has its own channel), so that being "in the Lobby" means the chat can reach you.
 * Who is here rides on the bar and as a second pane. On the atlas it starts collapsed; on the
 * Chat page, which shows the same channel full-size, it is hidden.
 */
export function LobbyChatDock() {
  const { pathname } = useLocation();
  const ruleset = useLobbyRuleset();
  const lobby = useLobbyUsers();
  const here = lobby.players.length;
  return <ChatDock
    key={ruleset}
    channelId={lobbyChannelId(ruleset)}
    title="Lobby chat"
    storageKey="asl.chatDock"
    meta={`${here} here`}
    extraPane={{ id: 'roster', label: <>Who's here · {here}</>, node: <LobbyUsers /> }}
    forceCollapsed={pathname.includes('/scenarios')}
    hidden={pathname.endsWith('/chat')}
  />;
}
