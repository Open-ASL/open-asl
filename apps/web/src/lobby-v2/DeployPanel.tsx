import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { fixturesFor, infantryOnly } from '@asl/content';
import { scenarioRuleset, type ScenarioDef } from '@asl/rules';
import { COMPUTER_AVAILABLE, COMPUTER_NAME, COMPUTER_OPPONENTS, RANDOM_SIDE, rankFor, type Competition, type MatchMode, type MatchVisibility, type Pace } from '@asl/platform';
import { useMember } from '../auth/AuthProvider';
import { api, errorOf } from '../firebase';
import { UserPicker } from '../lobby/UserPicker';
import { Avatar } from '../profile/Avatar';
import { usePublicProfile } from '../profile/usePublicProfile';
import { ListingComposer } from './GameListings';
import { SideBadge } from './SideBadge';

type Mode = 'hotseat' | 'computer' | 'person';

/**
 * The scenario is chosen; now how to play it. Hotseat and the computer start at once. Against a
 * person: a direct challenge, an open seat anyone can take, or a posted session to schedule.
 */
export function DeployPanel({ scenario, challengeUid }: { scenario: ScenarioDef; challengeUid?: string }) {
  const { profile } = useMember();
  const navigate = useNavigate();
  const [balance, setBalance] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode | null>(challengeUid ? 'person' : null);
  const [competition, setCompetition] = useState<Competition>('ranked');
  const [visibility, setVisibility] = useState<MatchVisibility>('public');
  const [side, setSide] = useState<string>(RANDOM_SIDE);
  const [picking, setPicking] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Correspondence isn't ready: every online match is Live until the Clock picker returns.
  const pace: Pace = 'live';
  const taken = !!profile.activeMatchId;
  const target = usePublicProfile(challengeUid).profile;

  const rulesetId = scenarioRuleset(scenario);
  // The computer plays only the Starter Kit until Chapter A is done: the Full ASL lobby does not offer it.
  const offerComputer = COMPUTER_AVAILABLE && rulesetId === 'starter-kit';
  const sideName = (id: string) => scenario.sides.find((s) => s.side === id)?.name ?? id;
  const badge = (id: string) => <SideBadge scenario={scenario} side={id} />;
  const otherSide = (id: string) => scenario.sides.find((s) => s.side !== id)?.side ?? '';
  /** You play: each side with its emblem, or a random draw. */
  const sidePicker = <div><span className="option-label">You play</span><div className="seg">{scenario.sides.map((s) => <button key={s.side} className={side === s.side ? 'on' : ''} onClick={() => setSide(s.side)}>{badge(s.side)}</button>)}<button className={side === RANDOM_SIDE ? 'on' : ''} onClick={() => setSide(RANDOM_SIDE)}>Random</button></div></div>;
  // The computer opponent plays Infantry-only scenarios for now (no Guns, no vehicles).
  const computerSides = infantryOnly(scenario) ? (COMPUTER_OPPONENTS[scenario.id] ?? []) : [];
  // Against the computer the player may take any side it can play against; the first side the card lists by default.
  const humanChoices = scenario.sides.filter((s) => computerSides.includes(otherSide(s.side))).map((s) => s.side);
  const [computerSide, setComputerSide] = useState<string | null>(null);
  // Games against the computer are public unless the player says otherwise: public ones get a report and a record entry.
  const [computerVisibility, setComputerVisibility] = useState<MatchVisibility>('public');
  const humanSide = computerSide && humanChoices.includes(computerSide) ? computerSide : (humanChoices[0] ?? scenario.sides[0]!.side);
  const effectiveVisibility = competition === 'ranked' ? 'public' : visibility;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError(errorOf(e).message); } finally { setBusy(false); }
  };
  const start = (as: MatchMode, openSeat = false, asSide = side, asVisibility: MatchVisibility = effectiveVisibility, fixture?: string) => run(async () => {
    const { matchId } = await api('createMatch', { mode: as, scenarioId: scenario.id, rulesetId, balance, openSeat, side: asSide, pace, competition, visibility: asVisibility });
    navigate(`/app/match/${matchId}${fixture ? `?fixture=${encodeURIComponent(fixture)}` : ''}`);
  });
  // Development builds only: hotseat games that start at a dev fixture position (@asl/content fixtures.ts).
  const devFixtures = import.meta.env.DEV ? fixturesFor(scenario.id) : [];
  const invite = (toUid: string, name: string) => run(async () => {
    await api('sendInvite', { toUid, scenarioId: scenario.id, rulesetId, balance, side, pace, competition, visibility: effectiveVisibility });
    setPicking(false);
    setSentTo(name);
  });

  const options = (
      <div className="person-options">
        <div><span className="option-label">Game type</span><div className="seg"><button className={competition === 'ranked' ? 'on' : ''} onClick={() => { setCompetition('ranked'); setVisibility('public'); }}>Ranked</button><button className={competition === 'friendly' ? 'on' : ''} onClick={() => setCompetition('friendly')}>Friendly</button></div></div>
        <div><span className="option-label">Visibility</span><div className="seg"><button className={effectiveVisibility === 'public' ? 'on' : ''} onClick={() => setVisibility('public')}>Public</button><button disabled={competition === 'ranked'} className={effectiveVisibility === 'private' ? 'on' : ''} onClick={() => setVisibility('private')}>Private</button></div></div>
        {sidePicker}
        <p className="deploy-note">
          {competition === 'ranked' ? 'Ranked games are public, count for Elo, and feed the scenario record.' : effectiveVisibility === 'private' ? 'Private friendly games award experience but cannot be watched or counted.' : 'Public friendly games award experience without touching Elo.'}{' '}
          {side === RANDOM_SIDE ? 'Sides are drawn by lot when the opponent arrives.' : <>Your opponent takes the {badge(otherSide(side))}.</>}
        </p>
      </div>
  );

  return <div className="deploy-panel">
    {!!scenario.balance?.length && <div className="deploy-balance">
      <h3>Balance</h3>
      {scenario.balance.map((b) => <label key={b.side} className={`switch ${b.unavailable ? 'off' : ''}`} title={b.unavailable}>
        <input type="checkbox" disabled={!!b.unavailable || busy} checked={!b.unavailable && balance.includes(b.side)} onChange={(e) => setBalance(e.target.checked ? [...balance, b.side] : balance.filter((x) => x !== b.side))} />
        <span className="knob" />
        <span><b>{sideName(b.side)}</b>: {b.text}{b.unavailable && <span className="muted small"> (not available yet: {b.unavailable})</span>}</span>
      </label>)}
    </div>}

    {challengeUid ? <section className="command-card person-panel challenge-panel">
      <header className="challenge-head">
        {target
          ? <div className="challenge-target"><Avatar profile={{ ...target, displayName: target.nickname, gravatarHash: '' }} size={44} xp={target.xp} /><div><b>Challenge {target.nickname}</b><small>{rankFor(target.xp).title} · {target.elo} Elo · {target.wins}–{target.losses}–{target.draws}</small></div></div>
          : <p className="deploy-note">Finding the player…</p>}
      </header>
      {options}
      {taken && <p className="warn">You are already seated in an online match. <Link to={`/app/match/${profile.activeMatchId}`}>Open it</Link> and finish or leave it before challenging anyone.</p>}
      {sentTo
        ? <p className="sent-note">Challenge sent to <b>{sentTo}</b>. They get a pop-up wherever they are in the Lobby; you will be taken to the table when they accept. Cancel it from the strip above. <Link to={`/app/${rulesetId}/home`}>Back to Home</Link></p>
        : <div className="buttons"><button className="primary" disabled={busy || taken || !target} onClick={() => target && invite(target.uid, target.nickname)}>{busy ? 'Sending…' : `Send challenge${target ? ` to ${target.nickname}` : ''}`}</button><Link className="btn" to={`/app/${rulesetId}/games?scenario=${scenario.id}`}>Play it another way</Link></div>}
      {error && <p className="warn">{error}</p>}
    </section>
    : <div className={`mode-cards ${offerComputer ? '' : 'two'}`}>
      <button className="mode-card" disabled={busy} onClick={() => { setMode('hotseat'); void start('hotseat'); }}>
        <span className="mode-kicker">Play now</span>
        <b>Hotseat</b>
        <p>Both sides at this screen. The game is saved as you play and can be resumed from Home. Hotseat games always get an after action report; only you see them on your record.</p>
        <span className="mode-cta">{busy && mode === 'hotseat' ? 'Opening the table…' : 'Start hotseat game ▶'}</span>
      </button>
      {offerComputer && <div className={`mode-card ${busy || !humanChoices.length ? 'off' : ''}`} role="button" tabIndex={busy || !humanChoices.length ? -1 : 0} aria-disabled={busy || !humanChoices.length}
        onClick={() => { if (busy || !humanChoices.length) return; setMode('computer'); void start('computer', false, humanSide, computerVisibility); }}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !busy && humanChoices.length) { e.preventDefault(); setMode('computer'); void start('computer', false, humanSide, computerVisibility); } }}>
        <span className="mode-kicker">Play now</span>
        <b>{COMPUTER_NAME}</b>
        {humanChoices.length
          ? <p>You command the {sideName(humanSide)}; {COMPUTER_NAME} takes the {sideName(otherSide(humanSide))}. Same rules and dice. No rating, experience or medals.</p>
          : <p>{COMPUTER_NAME} cannot play this scenario yet: it plays the infantry-only scenarios so far.</p>}
        {humanChoices.length > 1 && <div className="mode-side" onClick={(e) => e.stopPropagation()}><span className="option-label">You play</span><div className="seg">{humanChoices.map((id) => <button key={id} type="button" className={humanSide === id ? 'on' : ''} disabled={busy} onClick={() => setComputerSide(id)}>{badge(id)}</button>)}</div></div>}
        {humanChoices.length > 0 && <div className="mode-side" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}><span className="option-label">Visibility</span><div className="seg"><button type="button" className={computerVisibility === 'public' ? 'on' : ''} disabled={busy} onClick={() => setComputerVisibility('public')}>Public</button><button type="button" className={computerVisibility === 'private' ? 'on' : ''} disabled={busy} onClick={() => setComputerVisibility('private')}>Private</button></div></div>}
        {humanChoices.length > 0 && <p className="deploy-note mode-note">{computerVisibility === 'public' ? `Public games against ${COMPUTER_NAME} get an after action report and show on your service record.` : `A private game against ${COMPUTER_NAME} gets no report and stays off your record.`}</p>}
        <span className="mode-cta">{busy && mode === 'computer' ? 'Opening the table…' : humanChoices.length ? `Start vs ${COMPUTER_NAME} ▶` : 'Not available'}</span>
      </div>}
      <button className={`mode-card ${mode === 'person' ? 'on' : ''}`} disabled={busy} onClick={() => setMode(mode === 'person' ? null : 'person')}>
        <span className="mode-kicker">Online</span>
        <b>Another player</b>
        <p>Challenge someone directly, open a seat for whoever is free, or post times and schedule a session.</p>
        <span className="mode-cta">{mode === 'person' ? 'Choose below ▼' : 'Play a person ▶'}</span>
      </button>
    </div>}

    {!challengeUid && devFixtures.length > 0 && <section className="command-card dev-fixtures">
      <h3>Dev fixtures <small className="muted">development build only</small></h3>
      <p className="deploy-note">A hotseat game that starts at a set position, built from legal actions and recorded like any other.</p>
      <div className="buttons">
        {devFixtures.map((f) => <button key={f.id} disabled={busy} title={f.description} onClick={() => { setMode('hotseat'); void start('hotseat', false, side, effectiveVisibility, f.id); }}>{f.title}</button>)}
      </div>
    </section>}

    {!challengeUid && mode === 'person' && <section className="command-card person-panel">
      {options}
      {taken && <p className="warn">You are already seated in an online match. <Link to={`/app/match/${profile.activeMatchId}`}>Open it</Link> and finish or leave it before starting another.</p>}

      <div className="person-actions">
        <article className="person-action">
          <h3>Challenge a player</h3>
          {target
            ? <div className="challenge-target"><Avatar profile={{ ...target, displayName: target.nickname, gravatarHash: '' }} size={36} xp={target.xp} /><div><b>{target.nickname}</b><small>{rankFor(target.xp).title} · {target.elo} Elo · {target.wins}–{target.losses}–{target.draws}</small></div></div>
            : <p>They get a pop-up wherever they are in the Lobby. Accepting opens the board for you both.</p>}
          {sentTo
            ? <p className="sent-note">Challenge sent to <b>{sentTo}</b>. You will be taken to the table when they accept; cancel it from the strip above.</p>
            : <div className="buttons">
              {target && <button className="primary" disabled={busy || taken} onClick={() => invite(target.uid, target.nickname)}>Send challenge</button>}
              <button className={target ? '' : 'primary'} disabled={busy || taken} onClick={() => setPicking(true)}>{target ? 'Someone else…' : 'Choose a player…'}</button>
            </div>}
        </article>
        <article className={`person-action ${effectiveVisibility === 'private' ? 'off' : ''}`}>
          <h3>Open a seat</h3>
          {effectiveVisibility === 'private'
            ? <p>A private game cannot be found from the Lobby, so there is no seat to open. Challenge a player or post times instead, or make the game public.</p>
            : <p>Post a public table right now. The first free player to join sits down and the game begins.</p>}
          <div className="buttons"><button className="primary" disabled={busy || taken || effectiveVisibility === 'private'} onClick={() => start('online', true)}>Open a seat</button></div>
        </article>
        <article className="person-action">
          <h3>Schedule a session</h3>
          <p>Offer the times you can play; an opponent picks a start and you both get a reminder.</p>
          <div className="buttons"><button className={scheduling ? '' : 'primary'} disabled={busy} onClick={() => setScheduling((v) => !v)}>{scheduling ? 'Hide the form' : 'Post availability…'}</button></div>
        </article>
      </div>
      {scheduling && <ListingComposer scenarioId={scenario.id} competition={competition} visibility={effectiveVisibility} side={side} onPosted={() => setScheduling(false)} />}
      {error && <p className="warn">{error}</p>}
    </section>}
    {!challengeUid && error && mode !== 'person' && <p className="warn">{error}</p>}
    {picking && <UserPicker title="Challenge a player" busy={busy} onPick={(uid, user) => invite(uid, user.nickname)} onClose={() => setPicking(false)} />}
  </div>;
}
