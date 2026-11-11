import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Timestamp, collection, getDocs, limit, onSnapshot, orderBy, query, startAfter, where, type DocumentData, type QueryDocumentSnapshot } from 'firebase/firestore';
import { Link, useNavigate } from 'react-router';
import { SCENARIO_CATALOG, scenarioById, type ScenarioCatalogEntry } from '@asl/content';
import { COL, RANDOM_SIDE, bookableStarts, defaultScenarioDuration, hasBookableStart, formatLeft, rankFor, type Competition, type GameListingDoc, type MatchVisibility, type PublicProfileDoc, type RulesetId } from '@asl/platform';
import { api, db, errorOf } from '../firebase';
import { useMember } from '../auth/AuthProvider';
import { toDate, useNow } from '../ui/time';
import { Modal } from '../ui/Modal';
import { ScenarioLink } from './ScenarioLink';
import { SideBadge } from './SideBadge';
import { Avatar } from '../profile/Avatar';
import { usePublicProfiles } from '../profile/usePublicProfiles';
import { useLobbyRuleset } from './ruleset';

const localValue = (date: Date) => {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
};

interface BoardFilters { scenario: string; competition: '' | Competition; timezone: string; from: string; to: string }
const NO_FILTERS: BoardFilters = { scenario: '', competition: '', timezone: '', from: '', to: '' };
/** Firestore allows this many ids in one `in` filter. */
const MAX_IDS = 30;
const SUGGESTIONS = 20;
const PAGE = 25;
const MY_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const ZONES: string[] = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [MY_ZONE];
const PLAYABLE = SCENARIO_CATALOG.filter((s) => s.playable).sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
const playableIn = (ruleset: RulesetId) => PLAYABLE.filter((s) => s.rulesetId === ruleset);
const entryLabel = (s: ScenarioCatalogEntry) => `${s.number} ${s.name}`;

/**
 * The catalogue entries a typed scenario search means: the one whose label was picked from the
 * suggestions, the one with exactly that number, or everything whose number or name contains
 * every word typed. The catalogue lives in the bundle; only the resolved ids go to the server.
 */
function matchScenarios(text: string, ruleset: RulesetId): ScenarioCatalogEntry[] {
  const q = text.trim().toLocaleLowerCase();
  if (!q) return [];
  const playable = playableIn(ruleset);
  const exact = playable.filter((s) => entryLabel(s).toLocaleLowerCase() === q || s.number.toLocaleLowerCase() === q);
  if (exact.length) return exact;
  const words = q.split(/\s+/);
  return playable.filter((s) => { const hay = entryLabel(s).toLocaleLowerCase(); return words.every((w) => hay.includes(w)); });
}

/** One page of open posts matching the filters, soonest first; nothing beyond the page is ever loaded. */
function useListingPages(filters: BoardFilters, ruleset: RulesetId) {
  const starts = useRef<Array<QueryDocumentSnapshot<DocumentData> | null>>([null]);
  const [rows, setRows] = useState<Array<{ id: string; data: GameListingDoc }>>([]);
  const [page, setPage] = useState(0);
  const [canNext, setCanNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(filters);
  const load = useCallback(async (index: number) => {
    setLoading(true); setError(null);
    try {
      const constraints = [where('rulesetId', '==', ruleset), where('status', '==', 'open')];
      if (filters.scenario) {
        const ids = matchScenarios(filters.scenario, ruleset).slice(0, MAX_IDS).map((s) => s.id);
        // No catalogue match: nothing can be on the board for it.
        constraints.push(where('scenarioId', 'in', ids.length ? ids : ['-']));
      }
      if (filters.competition) constraints.push(where('competition', '==', filters.competition));
      if (filters.timezone) constraints.push(where('timezone', '==', filters.timezone));
      if (filters.from) constraints.push(where('windowStart', '>=', Timestamp.fromDate(new Date(`${filters.from}T00:00`))));
      if (filters.to) constraints.push(where('windowStart', '<=', Timestamp.fromDate(new Date(`${filters.to}T23:59:59`))));
      const cursor = starts.current[index] ?? null;
      const q = cursor
        ? query(collection(db, COL.listings), ...constraints, orderBy('windowStart'), startAfter(cursor), limit(PAGE + 1))
        : query(collection(db, COL.listings), ...constraints, orderBy('windowStart'), limit(PAGE + 1));
      const snap = await getDocs(q);
      const visible = snap.docs.slice(0, PAGE);
      if (snap.docs.length > PAGE && visible.length) starts.current[index + 1] = visible.at(-1)!;
      setRows(visible.map((d) => ({ id: d.id, data: d.data() as GameListingDoc })));
      setCanNext(snap.docs.length > PAGE);
      setPage(index);
    } catch (e) { setError(errorOf(e).message); } finally { setLoading(false); }
    // The filters are read through their serialised key so a new object with the same values does not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ruleset]);
  useEffect(() => { starts.current = [null]; void load(0); }, [load]);
  return { rows, page, loading, error, canPrevious: page > 0, canNext, previous: () => void load(page - 1), next: () => void load(page + 1), reload: () => void load(page) };
}

/** Everyone's open posts, filtered and paged on the server; the player's own posts and scheduled sessions beside them. */
export function ListingBoard() {
  const { user } = useMember();
  const navigate = useNavigate();
  const ruleset = useLobbyRuleset();
  const [filters, setFilters] = useState<BoardFilters>(NO_FILTERS);
  const board = useListingPages(filters, ruleset);
  const bookings = useBookings([user.uid, ...board.rows.map((r) => r.data.hostUid)]);
  const hosts = usePublicProfiles(board.rows.map((r) => r.data.hostUid));
  const [mine, setMine] = useState<Array<{ id: string; data: GameListingDoc }>>([]);
  const [error, setError] = useState<string | null>(null);
  const now = useNow(60_000);
  const rows = board.rows.filter((r) => stillOpen(r.data, now));
  const schedule = mine.filter((r) => stillOpen(r.data, now));
  useEffect(() => onSnapshot(query(collection(db, COL.listings), where('rulesetId', '==', ruleset), where('playerIds', 'array-contains', user.uid), where('status', 'in', ['open', 'scheduled']), orderBy('createdAt', 'desc')), (snap) => setMine(snap.docs.map((d) => ({ id: d.id, data: d.data() as GameListingDoc }))), (e) => setError(e.message)), [user.uid, ruleset]);
  const set = (patch: Partial<BoardFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const scenarioMatches = useMemo(() => matchScenarios(filters.scenario, ruleset), [filters.scenario, ruleset]);
  const filtering = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
  const run = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); board.reload(); } catch (e) { setError(errorOf(e).message); } };
  return <div className="listing-layout">
    <section className="command-card listing-board">
      <header><h2>Open game posts</h2><span className="card-tools">{board.loading ? 'Loading…' : `Page ${board.page + 1}${board.canNext ? ' · more available' : ''}`}</span></header>
      <div className="board-filters">
        <label><span>Scenario{scenarioMatches.length > MAX_IDS && <em className="board-hint">first {MAX_IDS} of {scenarioMatches.length} matches</em>}</span><input list="board-scenarios" placeholder="Number or title" value={filters.scenario} onChange={(e) => set({ scenario: e.target.value })} /><datalist id="board-scenarios">{scenarioMatches.slice(0, SUGGESTIONS).map((s) => <option key={s.id} value={entryLabel(s)} />)}</datalist></label>
        <label><span>Type</span><select value={filters.competition} onChange={(e) => set({ competition: e.target.value as BoardFilters['competition'] })}><option value="">Ranked or friendly</option><option value="ranked">Ranked</option><option value="friendly">Friendly</option></select></label>
        <label><span>Time zone <button type="button" className="text-button" onClick={() => set({ timezone: filters.timezone === MY_ZONE ? '' : MY_ZONE })}>{filters.timezone === MY_ZONE ? 'any' : 'mine'}</button></span><select value={filters.timezone} onChange={(e) => set({ timezone: e.target.value })}><option value="">Any time zone</option>{ZONES.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}</select></label>
        <label><span>Starting from</span><input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} /></label>
        <label><span>Until</span><input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => set({ to: e.target.value })} /></label>
        {filtering && <button type="button" className="text-button board-clear" onClick={() => setFilters(NO_FILTERS)}>Clear filters</button>}
      </div>
      {board.error && <p className="warn">{board.error}</p>}
      {rows.length
        ? rows.map((row) => <ListingRow key={row.id} listing={row.data} host={hosts.get(row.data.hostUid)} own={row.data.hostUid === user.uid} hostBooked={bookings.get(row.data.hostUid) ?? []} myBooked={bookings.get(user.uid) ?? []} onSchedule={(start) => run(() => api('scheduleGameListing', { listingId: row.id, start }))} />)
        : !board.loading && <p className="empty-state">{filtering ? 'No open posts match these filters.' : 'No open posts. Choose a scenario and post your availability to put one on the board.'}</p>}
      {(board.canPrevious || board.canNext) && <div className="live-page-controls">
        <button className="ghost" disabled={!board.canPrevious || board.loading} onClick={board.previous}>Previous {PAGE}</button>
        <button className="ghost" disabled={!board.canNext || board.loading} onClick={board.next}>Next {PAGE}</button>
      </div>}
      {error && <p className="warn">{error}</p>}
    </section>
    <section className="command-card"><header><h2>Your schedule</h2></header>{schedule.length ? schedule.map(({ id, data }) => <MyListing key={id} id={id} listing={data} onOpen={() => run(async () => { const { matchId } = await api('startScheduledGame', { listingId: id }); navigate(`/app/match/${matchId}`); })} onWithdraw={() => run(() => api('withdrawGameListing', { listingId: id }))} />) : <p className="empty-state">Nothing scheduled.</p>}</section>
  </div>;
}

interface Booked { start: number; end: number; listingId: string }

/** Every booked session of the given players (host of each post on the page, plus the viewer), live, keyed by uid. */
function useBookings(uids: string[]): Map<string, Booked[]> {
  const [booked, setBooked] = useState<Map<string, Booked[]>>(new Map());
  const key = [...new Set(uids)].sort().join('\n');
  useEffect(() => {
    const ids = key ? key.split('\n') : [];
    if (!ids.length) { setBooked(new Map()); return; }
    // Firestore allows 30 values in one `in`; a page holds at most 25 hosts plus the viewer.
    return onSnapshot(query(collection(db, COL.bookingSlots), where('uid', 'in', ids.slice(0, 30))), (snap) => {
      const next = new Map<string, Booked[]>();
      const seen = new Set<string>();
      snap.docs.forEach((d) => {
        const data = d.data() as { uid: string; listingId: string; start: unknown; expiresAt: unknown };
        const dedupe = `${data.uid}:${data.listingId}`;
        if (seen.has(dedupe)) return;
        seen.add(dedupe);
        const start = toDate(data.start)?.getTime(); const end = toDate(data.expiresAt)?.getTime();
        if (start === undefined || end === undefined) return;
        next.set(data.uid, [...(next.get(data.uid) ?? []), { start, end, listingId: data.listingId }]);
      });
      setBooked(next);
    }, () => setBooked(new Map()));
  }, [key]);
  return booked;
}

/** The table of a scheduled session opens 15 minutes before the start and stays open 30 minutes after it (the server enforces the same). */
const OPENS_BEFORE_MS = 15 * 60_000;
const CLOSES_AFTER_MS = 30 * 60_000;

function MyListing({ id: _id, listing, onOpen, onWithdraw }: { id: string; listing: GameListingDoc; onOpen(): void; onWithdraw(): void }) {
  const { user } = useMember();
  const scheduled = listing.status === 'scheduled' ? toDate(listing.scheduledAt)?.getTime() : undefined;
  const now = useNow(scheduled ? 1000 : 60_000);
  const other = listing.hostUid === user.uid ? listing.opponentNickname : listing.hostNickname;
  const [ask, setAsk] = useState(false);
  let table: ReactNode = null;
  if (scheduled) {
    if (now < scheduled - OPENS_BEFORE_MS) table = <button className="btn" disabled title="The table opens 15 minutes before the start">Opens in {formatLeft(scheduled - OPENS_BEFORE_MS - now)}</button>;
    else if (now <= scheduled + CLOSES_AFTER_MS) table = <button className="btn primary" onClick={onOpen}>Open table</button>;
    else table = <span className="my-listing__closed">Table closed · start time passed</span>;
  }
  return <article className="my-listing">
    <b><ScenarioLink scenarioId={listing.scenarioId} balance={listing.balance}>{listing.scenarioTitle}</ScenarioLink></b>
    <small>{scheduled ? `${new Date(scheduled).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · with ${other}` : 'Posted · waiting for an opponent to pick a time'}</small>
    <div>{table}<button className="btn" onClick={() => (scheduled ? setAsk(true) : onWithdraw())}>{scheduled ? 'Cancel' : 'Withdraw'}</button></div>
    {ask && scheduled && <Modal kicker={listing.scenarioTitle} title="Cancel this session?" onClose={() => setAsk(false)}>
      <p>{other} is expecting you {new Date(scheduled).toLocaleString([], { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}. {listing.hostUid === user.uid ? 'Cancelling takes the game off both your schedules and your post comes down.' : `Cancelling takes it off both your schedules; ${other}'s post goes back on the board for someone else.`}</p>
      <div className="buttons">
        <button className="ghost" onClick={() => setAsk(false)}>Keep it</button>
        <button className="primary" onClick={() => { setAsk(false); onWithdraw(); }}>Cancel session</button>
      </div>
    </Modal>}
  </article>;
}
interface ComposerProps {
  scenarioId: string;
  competition: Competition;
  visibility: MatchVisibility;
  side: string;
  onPosted(): void;
}

/** Post the times you can play a chosen scenario; the game type and side come from the deploy panel. */
export function ListingComposer({ scenarioId, competition, visibility, side, onPosted }: ComposerProps) {
  const meta = SCENARIO_CATALOG.find((s) => s.id === scenarioId);
  const scenario = scenarioById(scenarioId);
  const durationDefault = meta ? defaultScenarioDuration(meta.turns, meta.unitCount) : 240;
  const tomorrow = useMemo(() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(18, 0, 0, 0); return d; }, []);
  const [duration, setDuration] = useState(durationDefault);
  const [availability, setAvailability] = useState(() => [{ start: localValue(tomorrow), end: localValue(new Date(tomorrow.getTime() + 6 * 60 * 60_000)) }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDuration(durationDefault), [durationDefault]);
  if (!scenario) return null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      await api('createGameListing', { scenarioId: scenario.id, rulesetId: meta?.rulesetId, competition, visibility, durationMinutes: duration, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, availability: availability.map((block) => ({ start: new Date(block.start).toISOString(), end: new Date(block.end).toISOString() })), side, balance: [] });
      onPosted();
    } catch (e) { setError(errorOf(e).message); } finally { setBusy(false); }
  };
  const updateBlock = (index: number, key: 'start' | 'end', value: string) => setAvailability((blocks) => blocks.map((block, i) => i === index ? { ...block, [key]: value } : block));
  const addBlock = () => setAvailability((blocks) => {
    const prior = blocks.at(-1)!;
    const start = new Date(prior.start); start.setDate(start.getDate() + 1);
    const end = new Date(prior.end); end.setDate(end.getDate() + 1);
    return [...blocks, { start: localValue(start), end: localValue(end) }];
  });
  const sideLabel = side === RANDOM_SIDE ? 'random sides' : <>you play the <SideBadge scenario={scenario} side={side} /></>;
  return <form className="listing-composer" onSubmit={submit}>
    <p className="deploy-note">Posting <b><ScenarioLink scenarioId={scenario.id}>{scenario.title}</ScenarioLink></b> as a {competition} {visibility} game, {sideLabel}. Each block is a range of times you are willing to start; an opponent picks one, and the table opens 15 minutes before it.</p>
    <div className="two-fields">
      <label>Expected length<select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>{Array.from({ length: 23 }, (_, i) => 60 + i * 30).map((m) => <option value={m} key={m}>{m / 60} hours{m === durationDefault ? ' · suggested' : ''}</option>)}</select></label>
      <label>Your time zone<input value={Intl.DateTimeFormat().resolvedOptions().timeZone} readOnly /></label>
    </div>
    <fieldset className="availability-blocks"><legend>Times you can start</legend>{availability.map((block, index) => <div className="availability-block" key={index}><div className="two-fields"><label>Earliest start<input type="datetime-local" value={block.start} onChange={(e) => updateBlock(index, 'start', e.target.value)} /></label><label>Latest start<input type="datetime-local" value={block.end} onChange={(e) => updateBlock(index, 'end', e.target.value)} /></label></div>{availability.length > 1 && <button type="button" className="text-button" onClick={() => setAvailability((blocks) => blocks.filter((_, i) => i !== index))}>Remove block</button>}</div>)}{availability.length < 8 && <button type="button" className="btn" onClick={addBlock}>+ Add another time block</button>}</fieldset>
    {error && <p className="warn">{error}</p>}
    <div className="buttons"><button className="primary" disabled={busy}>Post game</button></div>
  </form>;
}

const dayLabel = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const timeLabel = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** Every start the host's window still allows (`bookableStarts`), up to the window's end. The session may run past it. */
function startSlots(block: { start: unknown; end: unknown }, now = Date.now()): Date[] {
  const start = toDate(block.start); const end = toDate(block.end);
  return start && end ? bookableStarts(start.getTime(), end.getTime(), now).map((at) => new Date(at)) : [];
}

/**
 * An open post nobody can book any more (every window's last start is past) is over though the server has not
 * expired it yet: it leaves the board and its host's schedule at once (user report 2026-11-06).
 */
function stillOpen(listing: GameListingDoc, now: number): boolean {
  if (listing.status !== 'open') return true;
  const windows = listing.availability.flatMap((b) => { const start = toDate(b.start); const end = toDate(b.end); return start && end ? [{ start: start.getTime(), end: end.getTime() }] : []; });
  return hasBookableStart(windows, now);
}

function ListingRow({ listing, host, own, hostBooked, myBooked, onSchedule }: { listing: GameListingDoc; host?: PublicProfileDoc; own: boolean; hostBooked: Booked[]; myBooked: Booked[]; onSchedule(start: string): void }) {
  const [picked, setPicked] = useState<number | null>(null);
  const scenario = scenarioById(listing.scenarioId);
  const blocks = listing.availability.map((block) => ({ start: toDate(block.start), end: toDate(block.end), slots: startSlots(block) }));
  const hours = listing.durationMinutes / 60;
  const chosen = picked === null ? null : new Date(picked);
  const length = listing.durationMinutes * 60_000;
  const overlaps = (t: number, list: Booked[]) => list.some((b) => t < b.end && t + length > b.start);
  /** Why a start cannot be taken: the viewer or the host is already playing then. */
  const blocked = (slot: Date) => (overlaps(slot.getTime(), myBooked) ? 'You already have a game then' : overlaps(slot.getTime(), hostBooked) ? `${listing.hostNickname} already has a game then` : null);
  return <article className="listing-row">
    <div className="listing-row__main">
      <p className="eyebrow">{listing.competition} · {listing.visibility}</p>
      <h3><ScenarioLink scenarioId={listing.scenarioId} balance={listing.balance}>{listing.scenarioTitle}</ScenarioLink></h3>
      <div className="listing-host">
        <Avatar profile={{ photoURL: host?.photoURL ?? null, gravatarHash: '', displayName: listing.hostNickname }} size={34} xp={host?.xp} />
        <div><Link to={`/profile/${listing.hostNickname.toLowerCase()}`}>{listing.hostNickname}</Link><small>{host ? `${rankFor(host.xp).title} · ${host.elo} Elo` : '…'}</small></div>
      </div>
      <p className="listing-sides">{scenario?.sides.map((s, i) => <span key={s.side}>{i > 0 && <span className="muted"> vs </span>}<SideBadge scenario={scenario} side={s.side} /></span>)}{listing.side !== RANDOM_SIDE && scenario ? <> · host plays <SideBadge scenario={scenario} side={listing.side} /></> : ' · sides by lot'}</p>
      <small>About {hours} hours · host in {listing.timezone.replace(/_/g, ' ')}</small>
    </div>
    <div className="listing-slots">
      {blocks.map((block, index) => <div className="slot-block" key={index}>
        <div className="slot-block__head"><b>{block.start ? dayLabel(block.start) : ''}</b><small>{block.start && block.end ? `${timeLabel(block.start)} – ${timeLabel(block.end)}` : ''}</small></div>
        {own || !block.slots.length
          ? <small className="slot-none">{own ? 'Opponents pick a start time in this window.' : 'This window has passed.'}</small>
          : block.slots.every((slot) => blocked(slot))
            ? <small className="slot-none">No free start in this window: {blocked(block.slots[0]!)?.toLowerCase()}.</small>
            : <div className="slot-chips">{block.slots.map((slot) => { const why = blocked(slot); return <button type="button" key={slot.getTime()} className={`${picked === slot.getTime() ? 'on' : ''} ${why ? 'busy' : ''}`} disabled={!!why} onClick={() => setPicked(slot.getTime())} title={why ?? `${timeLabel(slot)} to ${timeLabel(new Date(slot.getTime() + length))}`}>{timeLabel(slot)}</button>; })}</div>}
      </div>)}
      {own
        ? <div className="listing-own">Your post</div>
        : <div className="slot-confirm">
          <button className="btn primary" disabled={!chosen} onClick={() => chosen && onSchedule(chosen.toISOString())}>{chosen ? `Schedule ${dayLabel(chosen)}, ${timeLabel(chosen)}` : 'Pick a start time'}</button>
          {chosen && <small>Plays until about {timeLabel(new Date(chosen.getTime() + listing.durationMinutes * 60_000))} your time.</small>}
        </div>}
    </div>
  </article>;
}
