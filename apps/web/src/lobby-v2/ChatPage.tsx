import { ChatPanel } from '../chat/ChatPanel';
import { lobbyChannelId } from '@asl/platform';
import { LobbyUsers } from './LobbyUsers';
import { useLobbyRuleset } from './ruleset';

/** The Lobby chat full-screen with the roster beside it, filling the viewport; the dock covers the rest of the Lobby. */
export function ChatPage() {
  const ruleset = useLobbyRuleset();
  return <main className="page-frame chat-page">
    <div className="chat-layout">
      <ChatPanel key={ruleset} channelId={lobbyChannelId(ruleset)} title="Lobby chat" />
      <LobbyUsers />
    </div>
  </main>;
}
