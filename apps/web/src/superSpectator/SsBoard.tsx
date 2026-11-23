import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { collection, doc, getDoc, onSnapshot, orderBy, query } from 'firebase/firestore';
import type { Action, Engine, GameState, HexId } from '@asl/engine';
import { hexOf, pieceLabel, redactState, type FireMode, type ScenarioDef } from '@asl/rules';
import { COL, SS_WIDTHS, type MatchActionDoc, type MatchDoc, type SsCheck } from '@asl/platform';
import { useMember } from '../auth/AuthProvider';
import { Splash } from '../auth/RequireMember';
import { db } from '../firebase';
import { GameScreen, type SsScreen } from '../GameScreen';
import type { Session } from '../game/session';
import { PHASE_NAME, phaseSide, sideNameOf } from '../game/describe';
import { matchScenario } from '../match/scenarios';
import { seatNames } from '../match/seatNames';
import { turnMarks } from '../match/replayTimeline';
import { useReplay } from '../match/useReplay';
import { SPEEDS } from '../match/ReplayBoard';
import { ssControlsPath, useSsClaim } from './access';
import { useBoardBridge, type SsCommand, type SsControlsState, type SsTool } from './bridge';
import { SsControls } from './SsControls';
import { SsBanner } from './SsBanner';
import { SsSettings } from './SsSettings';
import { useSsRoom } from './useSsRoom';
import { applyVirtual, withMoves } from './virtual';
import { CHANCE_LEGEND, DANGER_LEGEND, chanceColor, dangerColor, nextHeat, typicalMorale } from './danger';
import { useDanger } from './useDanger';
import { losCheck, ordnanceCheck, shotCheck, shotFirers } from './checks';
import { SsLosCard, SsOrdnanceCard, SsShotCard } from './SsCheckCard';

/** Firing hexes, target and LOS ends of a check, lit on the board. */
const FIRER_MARK = 0x3cc8ff;
const TARGET_MARK = 0xff4d4d;

/** /app/match/:id/ss — a commentator's board: the match whole, any step of it, with the room's tools. */
export function SsBoardRoute() {
  const { id } = useParams<{ id: string }>();
  const { user } = useMember();
  const claim = useSsClaim(user);
  const [match, setMatch] = useState<MatchDoc | null | undefined>(undefined);
  useEffect(() => {
    if (!id || !claim) return;
    return onSnapshot(doc(db, COL.matches, id), (snap) => setMatch((snap.data() as MatchDoc | undefined) ?? null), () => setMatch(null));
  }, [id, claim]);
  const balance = JSON.stringify(match?.balance ?? null);
  const scenario = useMemo(() => (match ? matchScenario(match.scenarioId, match.balance) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [match?.scenarioId, balance]);
  // The seed: on the match once it has ended (and always for hotseat and computer games), else in `private/game`.
  const [seed, setSeed] = useState<string | null>(null);
  const matchSeed = match?.seed;
  useEffect(() => {
    if (!id || match === undefined || match === null) return;
    if (matchSeed) return setSeed(matchSeed);
    let live = true;
    getDoc(doc(db, COL.matches, id, COL.private, 'game')).then(
      (s) => live && setSeed((s.data() as { seed?: string } | undefined)?.seed ?? ''),
      () => live && setSeed(''),
    );
    return () => {
      live = false;
    };
  }, [id, match === undefined || match === null, matchSeed]);
  const [actions, setActions] = useState<Action[] | null>(null);
  useEffect(() => {
    if (!id || !claim) return;
    return onSnapshot(query(collection(db, COL.matches, id, COL.actions), orderBy('seq')), (snap) => {
      setActions(snap.docs.map((d) => JSON.parse((d.data() as MatchActionDoc).json) as Action));
    });
  }, [id, claim]);

  if (!id || claim === null) return <Splash text="Checking your press pass…" />;
  if (!claim) return <Gate title="Commentators only" text="This board is for invited commentators." />;
  if (match === undefined) return <Splash text="Unpacking the map…" />;
  if (!match || !scenario) return <Gate title="Match unavailable" text="No such match, or its scenario is unknown here." />;
  // A commentator who plays in this match gets the board of a player, never the room (it would show them the other side).
  if (match.playerIds?.includes(user.uid)) return <Gate title="You play in this match" text="Commentary is closed to the match's own players." />;
  if (seed === null || actions === null) return <Splash text="Reading the recording…" />;
  if (!seed) return <Gate title="Recording unavailable" text="This match's dice could not be read." />;
  return <SsBoard matchId={id} match={match} scenario={scenario} seed={seed} actions={actions} />;
}

function Gate({ title, text }: { title: string; text: string }) {
  return (
    <div className="gate">
      <div className="gate-card">
        <h1>{title}</h1>
        <p className="warn">{text}</p>
        <Link to="/app" className="btn">Back to the lobby</Link>
      </div>
    </div>
  );
}

function SsBoard({ matchId, match, scenario, seed, actions }: { matchId: string; match: MatchDoc; scenario: ScenarioDef; seed: string; actions: Action[] }) {
  const navigate = useNavigate();
  const { user, profile } = useMember();
  const replay = useReplay(scenario, seed, actions);
  const room = useSsRoom(matchId, user.uid, profile.displayName || 'Commentator');
  const r = room.room;
  const last = replay.frames.length - 1;
  const live = match.status === 'active' || match.status === 'open';
  // A virtual board stays on the step it was made from, however far the game goes on.
  const virtual = r?.virtual ?? null;
  const following = !virtual && (!r || r.cursor === 'live');
  const step = virtual ? Math.min(last, virtual.base) : following ? last : Math.max(0, Math.min(last, r!.cursor as number));
  const marks = useMemo(() => turnMarks(replay.frames), [replay]);

  // A jump shows its position at once; one step on (the game going on, autoplay, Step forward) plays out as the players
  // saw it: dice, effects, the phase wheel.
  const [seek, setSeek] = useState(0);
  const shownStep = useRef(step);
  useEffect(() => {
    if (step !== shownStep.current && step !== shownStep.current + 1) setSeek((n) => n + 1);
    shownStep.current = step;
  }, [step]);
  /** The screen is still playing a step out; autoplay waits for it. */
  const [busy, setBusy] = useState(false);

  const frame = replay.frames[step]!;
  const state: GameState = useMemo(() => applyVirtual(frame.state, r?.virtual ?? null), [frame.state, r?.virtual]);
  const sides = scenario.sides.map((s) => s.side);
  const show = r?.show ?? {};
  const shownSides = sides.filter((s) => show[s]);
  const seeAs: string | null | 'all' = shownSides.length === sides.length ? 'all' : shownSides.length === 1 ? shownSides[0]! : null;

  // This commentator's own view: the tool, the pen, and what is hidden on the map.
  const [tool, setTool] = useState<SsTool>('look');
  const [width, setWidth] = useState(1);
  const [hideUnits, setHideUnits] = useState(false);
  const [hideMarkers, setHideMarkers] = useState(false);
  /** Move tool: the hex whose counters are listed, and the counters picked up to be put down on the next hex clicked. */
  const [picked, setPicked] = useState<HexId | null>(null);
  const [carrying, setCarrying] = useState<string[]>([]);
  /** Change the virtual board: started from the step shown if it is not virtual yet. */
  const moveVirtual = (ids: string[], to: HexId | null) => {
    if (!ids.length) return;
    room.patch({ virtual: withMoves(virtual, step, ids, to ? { kind: 'hex', hex: to } : null) });
  };

  const run = useCallback(
    (c: SsCommand) => {
      switch (c.type) {
        case 'tool':
          return setTool(c.tool);
        case 'width':
          return setWidth(c.width);
        case 'show':
          return room.patch({ show: { ...show, [c.side]: c.on } });
        // The timeline waits while the board is virtual: snap back first.
        case 'seek':
          return virtual ? undefined : room.patch({ cursor: c.step >= last && live ? 'live' : c.step });
        case 'follow':
          return virtual ? undefined : room.patch({ cursor: 'live', play: null });
        // Play makes this board the one that steps the room on; a finished game played from its end starts again.
        case 'play':
          if (r?.play) return room.patch({ play: null });
          if (virtual || following) return;
          return room.patch(step >= last ? { cursor: 0, play: user.uid } : { play: user.uid });
        case 'speed':
          return room.patch({ speed: c.speed });
        case 'erase':
          return room.eraseInk();
        case 'hideUnits':
          return setHideUnits(c.on);
        case 'hideMarkers':
          return setHideMarkers(c.on);
        case 'shot': {
          const ch = r?.check;
          if (ch?.kind !== 'shot') return;
          return room.patch({ check: { ...ch, ...(c.mode ? { mode: c.mode } : {}), ...(c.areaFire !== undefined ? { areaFire: c.areaFire } : {}), ...(c.moving ? { moving: c.moving } : {}), ...(c.weapon !== undefined ? { weapon: c.weapon } : {}), n: Date.now() } });
        }
        case 'shotExclude': {
          const ch = r?.check;
          if (ch?.kind !== 'shot') return;
          const exclude = c.out ? [...new Set([...ch.exclude, c.id])] : ch.exclude.filter((x) => x !== c.id);
          return room.patch({ check: { ...ch, exclude, n: Date.now() } });
        }
        case 'clearCheck':
          return room.patch({ check: null });
        case 'snapBack':
          setCarrying([]);
          // Back to the game as it stands, or (a finished game) to the step the changes were made to.
          return room.patch({ virtual: null, cursor: live ? 'live' : (virtual?.base ?? last) });
        case 'remove':
          setCarrying((cur) => cur.filter((id) => !c.ids.includes(id)));
          return moveVirtual(c.ids, null);
        case 'carry':
          return setCarrying(c.ids);
        case 'heat':
          return room.patch({ heat: nextHeat(r?.heat ?? null, c) });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [room, show, last, live, r?.check, r?.heat, r?.play, virtual, step, following],
  );

  // 1–3 pick a tool; Esc goes back to looking.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === ' ') {
        e.preventDefault();
        run({ type: 'play' });
        return;
      }
      if (e.key === 'Escape') {
        // Esc clears the check on the board first, then goes back to looking.
        if (checkRef.current) run({ type: 'clearCheck' });
        else setTool('look');
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && pickedRef.current) {
        run({ type: 'remove', ids: pickedRef.current });
        return;
      }
      const t = ({ '1': 'look', '2': 'ping', '3': 'draw', '4': 'los', '5': 'shot', '6': 'move' } as Record<string, SsTool>)[e.key];
      if (t) setTool(t);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run]);
  const checkRef = useRef<SsCheck | null>(null);
  checkRef.current = r?.check ?? null;
  /** The counters of the picked hex (Delete takes them off). */
  const pickedRef = useRef<string[] | null>(null);

  // The checks work on the position as shown, the virtual changes included, whatever hidden information is shown:
  // what is hidden is left out of what the card lists.
  const fullEnv = useMemo(() => replay.engine.env(state), [replay.engine, state]);
  const viewer = seeAs === 'all' ? null : seeAs;
  const visible = useMemo(() => (seeAs === 'all' ? null : new Set(Object.keys(redactState(replay.engine, state, viewer).pieces))), [replay.engine, state, seeAs, viewer]);
  const check = r?.check ?? null;
  const losView = useMemo(() => (check?.kind === 'los' && check.to ? losCheck(fullEnv, check.from, check.to) : null), [fullEnv, check]);
  const firers = useMemo(() => (check?.kind === 'shot' ? shotFirers(fullEnv, state, check.firers as HexId[]).filter((f) => !visible || visible.has(f.id)) : []), [fullEnv, state, check, visible]);
  const ordnanceView = useMemo(() => {
    if (check?.kind !== 'shot' || !check.target || !check.weapon || (visible && !visible.has(check.weapon))) return null;
    return ordnanceCheck(fullEnv, replay.engine, { firers: check.firers as HexId[], exclude: check.exclude, target: check.target, mode: check.mode as FireMode, areaFire: check.areaFire, moving: check.moving, weapon: check.weapon });
  }, [fullEnv, replay.engine, check, visible]);
  const shotView = useMemo(() => {
    if (check?.kind !== 'shot' || !check.target || check.weapon) return null;
    // A hidden firer takes no part either: the commentators see the shot the audience can see.
    const hidden = visible ? shotFirers(fullEnv, state, check.firers as HexId[]).filter((f) => !visible.has(f.id)).map((f) => f.id) : [];
    const view = shotCheck(fullEnv, replay.engine, { firers: check.firers as HexId[], exclude: [...check.exclude, ...hidden], target: check.target, mode: check.mode as FireMode, areaFire: check.areaFire, moving: check.moving }, { secrets: seeAs === 'all' });
    return view && visible ? { ...view, targets: view.targets.filter((t) => visible.has(t.id)) } : view;
  }, [fullEnv, replay.engine, state, check, visible, seeAs]);

  /** A click with the LOS or Shot tool: the first hexes set the check up, the last one completes it. */
  const checkClick = (hex: HexId, shift: boolean) => {
    const n = Date.now();
    if (tool === 'los') {
      if (check?.kind === 'los' && !check.to && check.from !== hex) room.patch({ check: { ...check, to: hex, n } });
      else room.patch({ check: { kind: 'los', from: hex, to: '', n } });
      return;
    }
    const base = check?.kind === 'shot' ? check : null;
    if (base && !base.target) {
      if (shift) {
        const firers = base.firers.includes(hex) ? base.firers.filter((h) => h !== hex) : [...base.firers, hex];
        room.patch({ check: firers.length ? { ...base, firers, n } : null });
      } else if (base.firers.includes(hex)) room.patch({ check: { ...base, firers: base.firers.filter((h) => h !== hex), n } });
      else room.patch({ check: { ...base, target: hex, n } });
      return;
    }
    // A new shot keeps the last one's mode and options.
    room.patch({ check: { kind: 'shot', firers: [hex], exclude: [], target: '', mode: base?.mode ?? 'prep', areaFire: base?.areaFire ?? false, moving: base?.moving ?? 'none', n } });
  };

  const checkMarks = useMemo(() => {
    const m = new Map<HexId, number>();
    if (check?.kind === 'los') {
      m.set(check.from as HexId, FIRER_MARK);
      if (check.to) m.set(check.to as HexId, TARGET_MARK);
    } else if (check?.kind === 'shot') {
      for (const h of check.firers) m.set(h as HexId, FIRER_MARK);
      if (check.target) m.set(check.target as HexId, TARGET_MARK);
    }
    return m;
  }, [check]);
  const checkLos = losView && check ? { key: check.n, ...losView.line } : null;

  // The danger map, on the position as shown (a virtual one too), and the hex under the pointer for its readout.
  const heatSetting = r?.heat ?? null;
  const danger = useDanger(fullEnv, replay.engine, heatSetting, visible, seeAs === 'all');
  const byFp = heatSetting?.measure === 'fp';
  const heatCells = useMemo(
    () =>
      danger.cells
        ? [...danger.cells].flatMap(([hex, c]) => {
            const color = byFp ? dangerColor(c.fp) : chanceColor(c.p);
            return color === null ? [] : [{ hex, color }];
          })
        : null,
    [danger.cells, byFp],
  );
  const pct = (p: number) => (p < 0.005 ? '<1%' : `${Math.round(p * 100)}%`);
  const [hoverHex, setHoverHex] = useState<HexId | null>(null);
  const hoverCell = hoverHex && danger.cells ? danger.cells.get(hoverHex) : undefined;

  // The Move tool: the counters of a hex (a held weapon listed under its holder, and going with it).
  const piecesAt = (hex: HexId) => Object.values(state.pieces).filter((p) => p.loc.kind === 'hex' && hexOf(state, p) === hex && (!visible || visible.has(p.id)));
  const pickedPieces = picked
    ? piecesAt(picked).flatMap((p) => [
        { id: p.id, label: pieceLabel(fullEnv, p), held: false },
        ...Object.values(state.pieces)
          .filter((w) => w.loc.kind === 'held' && w.loc.by === p.id)
          .map((w) => ({ id: w.id, label: pieceLabel(fullEnv, w), held: true })),
      ])
    : [];
  pickedRef.current = picked && tool === 'move' ? pickedPieces.filter((p) => !p.held).map((p) => p.id) : null;
  const boardMarks = picked && tool === 'move' ? new Map([...checkMarks, [picked, FIRER_MARK]]) : checkMarks;
  const card =
    check?.kind === 'los' && losView ? (
      <SsLosCard from={check.from} to={check.to} view={losView} />
    ) : check?.kind === 'shot' && ordnanceView ? (
      <SsOrdnanceCard target={check.target} view={ordnanceView} sideName={(s) => sideNameOf(fullEnv, s)} />
    ) : check?.kind === 'shot' && shotView ? (
      <SsShotCard target={check.target} view={shotView} sideName={(s) => sideNameOf(fullEnv, s)} />
    ) : null;

  // Autoplay: the driving board steps the room's cursor on once its screen has played the step out and the speed's pause
  // has passed; at the end it stops (a live game then follows the play as it comes).
  const amDriver = !!r?.play && r.play === user.uid;
  const speed = Math.max(0, Math.min(SPEEDS.length - 1, r?.speed ?? 0));
  useEffect(() => {
    if (!amDriver) return;
    if (virtual || following || step >= last) {
      room.patch({ play: null, ...(step >= last && live && !virtual ? { cursor: 'live' } : {}) });
      return;
    }
    if (busy) return;
    const t = window.setTimeout(() => room.patch({ cursor: step + 1 >= last && live ? 'live' : step + 1 }), SPEEDS[speed]!.pause);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amDriver, busy, step, last, speed, virtual, following, live]);
  // A driver leaving the board stops the play rather than leave the room waiting on nobody.
  const driving = useRef(false);
  driving.current = amDriver;
  useEffect(
    () => () => {
      if (driving.current) room.patch({ play: null });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const env = useMemo(() => replay.engine.env(frame.state), [replay.engine, frame.state]);
  const sideName = (s: string) => sideNameOf(env, s);
  // The Defensive Fire Phase is named for the DEFENDER, as in the replay bar.
  const where = frame.state.phase === 'setup' ? 'Setup' : `Turn ${frame.state.turn} · ${sideName(phaseSide(frame.state.phase, frame.state.attacker, frame.state.sides))} ${PHASE_NAME[frame.state.phase] ?? frame.state.phase}`;
  const controls: SsControlsState = {
    title: match.scenarioTitle,
    sides: sides.map((s) => ({ side: s, name: sideName(s) })),
    show,
    following,
    step,
    last,
    live,
    marks,
    where,
    tool,
    width,
    color: room.color,
    members: room.members,
    hideUnits,
    hideMarkers,
    error: room.error ?? replay.error,
    check,
    firers,
    virtual: virtual ? { base: virtual.base, changes: Object.keys(virtual.moves).length, behind: live ? last - virtual.base : 0 } : null,
    picked: picked && tool === 'move' ? { hex: picked, pieces: pickedPieces } : null,
    carrying,
    heat: heatSetting,
    heatProgress: danger.progress,
    playing: !!r?.play,
    driver: r?.play ? (r.play === user.uid ? 'you' : (room.members.find((m) => m.uid === r.play)?.name ?? 'a commentator who left')) : null,
    speed,
  };
  const { popped } = useBoardBridge(matchId, controls, run);
  const popOut = () => window.open(ssControlsPath(matchId), `asl-ss-${matchId}`, 'popup,width=560,height=980');

  const session: Session = useMemo(
    () => ({
      engine: replay.engine as Engine,
      state,
      log: replay.log.slice(0, frame.logLen),
      act: () => 'Commentators watch; the players play',
      check: () => 'Commentators watch; the players play',
      undo: () => {},
      canUndo: false,
      actionCount: step,
      replayError: replay.error,
      mySide: null,
      seek,
      seeAs,
      pingColor: room.color,
      pings: room.pings,
      sendPing: room.sendPing,
    }),
    [replay, state, frame.logLen, step, seek, seeAs, room.color, room.pings, room.sendPing],
  );

  const status: SsScreen['status'] = r?.virtual ? 'virtual' : following ? 'live' : 'rewound';
  const ss: SsScreen = {
    ink: room.ink,
    pen: tool === 'draw' ? { color: room.color, width: SS_WIDTHS[width] ?? 6 } : null,
    onInk: room.addInk,
    onHexClick: (hex, e) => {
      if (tool === 'move') {
        // Counters picked up are put down here; otherwise the hex's counters are listed in the controls.
        if (carrying.length) {
          moveVirtual(carrying, hex);
          setCarrying([]);
          setPicked(hex);
        } else setPicked(hex);
        return true;
      }
      if (tool === 'los' || tool === 'shot') {
        checkClick(hex, e.shift);
        return true;
      }
      return tool === 'ping' ? 'ping' : tool === 'draw';
    },
    drag:
      tool === 'move'
        ? {
            // Pressing a hex picks its stack up: its top counter is carried, the rest come with it.
            piece: (hex) => piecesAt(hex).filter((p) => p.loc.kind === 'hex').at(-1)?.id ?? null,
            drop: (hex, id) => {
              const p = state.pieces[id];
              const from = p ? hexOf(state, p) : null;
              if (!from || from === hex) return;
              moveVirtual(piecesAt(from).map((q) => q.id), hex);
              setPicked(hex);
            },
          }
        : undefined,
    banner: (
      <>
        <SsBanner status={status} live={live} where={where} behind={virtual && live ? last - virtual.base : 0} />
        {card && <div className="ss-card-slot">{card}</div>}
        {heatSetting && (
          <div className="ss-legend" role="status">
            <b>Danger to {sideName(heatSetting.side)} units</b>
            <span className="ss-legend-sub">
              {byFp
                ? `${sideName(sides.find((s) => s !== heatSetting.side) ?? '')} FP that can reach each hex`
                : `Chance a Good Order ${sideName(heatSetting.side)} squad (Morale ${typicalMorale(fullEnv, heatSetting.side)}) there is broken or worse: TEM, hindrance and leaders counted`}
              {' · '}
              {heatSetting.mode === 'advancing' ? 'Advancing Fire' : heatSetting.mode === 'first' ? 'Defensive First Fire' : 'Prep Fire'}
              {heatSetting.sw ? ', SW included' : ', units only'}
              {danger.progress < 1 ? ` · working out ${Math.round(danger.progress * 100)}%` : ''}
            </span>
            <div className="ss-legend-ramp">
              {(byFp ? DANGER_LEGEND : CHANCE_LEGEND).map((l) => (
                <span key={l.label} style={{ background: `#${l.color.toString(16).padStart(6, '0')}` }}>{l.label}</span>
              ))}
            </div>
            {hoverHex && (
              <span className="ss-legend-hover">
                {hoverHex.replace(/^[a-z]+/, '')}:{' '}
                {hoverCell
                  ? byFp
                    ? `${hoverCell.fp} FP from ${hoverCell.sources.map((s) => `${s.hex.replace(/^[a-z]+/, '')} (${s.fp})`).join(', ')}`
                    : `${pct(hoverCell.p)} from ${hoverCell.sources.map((s) => `${s.hex.replace(/^[a-z]+/, '')} ${s.fp} FP ${s.drm >= 0 ? '+' : ''}${s.drm} (${pct(s.p)})`).join(', ')}`
                  : 'no fire reaches it'}
              </span>
            )}
          </div>
        )}
      </>
    ),
    marks: boardMarks,
    heat: heatSetting ? heatCells : null,
    // Only while a danger map is up: the readout is its only use, and a hover then re-renders the screen.
    onHover: heatSetting ? setHoverHex : undefined,
    checkLos,
    status,
    hideUnits,
    hideMarkers,
  };

  return (
    <GameScreen
      scenario={scenario}
      players={seatNames(match)}
      session={session}
      viewKey={`ss.${matchId}`}
      onQuit={() => navigate('/app')}
      onResolvingChange={setBusy}
      ss={ss}
      aside={popped ? undefined : <SsControls state={controls} send={run} onPopOut={popOut} docked />}
      settingsExtra={<SsSettings matchId={matchId} match={match} on />}
    />
  );
}
