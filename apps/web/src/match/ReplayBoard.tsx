import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Action } from '@asl/engine';
import type { ScenarioDef } from '@asl/rules';
import type { MatchDoc } from '@asl/platform';
import { GameScreen } from '../GameScreen';
import { seatNames } from './seatNames';
import type { Session } from '../game/session';
import { PHASE_NAME, sideNameOf } from '../game/describe';
import { buildReplay, extendReplay, nextTurnStep, prevTurnStep, turnMarks, type Replay, type TurnMark } from './replayTimeline';

/** Autoplay: the pause after each step has finished playing, by speed. */
const SPEEDS = [
  { label: '1×', pause: 1400 },
  { label: '2×', pause: 600 },
  { label: '4×', pause: 150 },
] as const;
const SPEED_KEY = 'asl.replaySpeed';

function readSpeed(): number {
  try {
    const n = Number(localStorage.getItem(SPEED_KEY));
    return Number.isInteger(n) && n >= 0 && n < SPEEDS.length ? n : 0;
  } catch {
    return 0;
  }
}

/** The step a replay link asks for (`?step=`), else the start. */
function readStep(): number {
  const n = Number(new URLSearchParams(window.location.search).get('step'));
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/**
 * A finished (or open legacy) match played back step by step. One GameScreen stays mounted throughout, so the watcher's
 * zoom, scroll, rotation and panels survive every step. Stepping forward plays the step as it was played (dice, effects,
 * phase wheel); any other move (a scrub, a step back, a turn skipped) is a jump and shows its position at once.
 */
export function ReplayBoard({ matchId, match, scenario, actions }: { matchId: string; match: MatchDoc; scenario: ScenarioDef; actions: Action[] }) {
  const navigate = useNavigate();
  // A finished match has its seed on the document (written back when it ended); the empty string never reaches a live one.
  const seed = match.seed ?? '';
  // The recording is replayed once; actions recorded later (a match still being played) carry it on.
  const built = useRef<{ actions: Action[]; replay: Replay } | null>(null);
  const replay = useMemo(() => {
    const prev = built.current;
    const kept = prev ? prev.replay.frames.length - 1 : 0;
    const same = prev && actions.length >= kept && (kept === 0 || JSON.stringify(actions[kept - 1]) === JSON.stringify(prev.actions[kept - 1]));
    const next = prev && same ? extendReplay(prev.replay, actions) : buildReplay(scenario, seed, actions);
    built.current = { actions, replay: next };
    return next;
  }, [scenario, seed, actions]);
  const last = replay.frames.length - 1;
  const marks = useMemo(() => turnMarks(replay.frames), [replay]);

  const [cursor, setCursor] = useState(() => readStep());
  const step = Math.min(cursor, last);
  const [seek, setSeek] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(readSpeed);
  /** The screen is still playing out a step (dice, effects, the phase wheel). */
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(busy);
  busyRef.current = busy;

  /** Show `to` at once (a jump). */
  const jump = useCallback((to: number) => {
    setCursor(Math.max(0, Math.min(last, to)));
    setSeek((n) => n + 1);
  }, [last]);
  /** One step on: played out as it happened, unless the last one is still playing (then the watcher wants it done). */
  const forward = useCallback(() => {
    if (busyRef.current) return jump(step + 1);
    setCursor(Math.min(last, step + 1));
  }, [jump, step, last]);
  const back = useCallback(() => jump(step - 1), [jump, step]);
  const prevTurn = useCallback(() => jump(prevTurnStep(marks, step)), [jump, marks, step]);
  const nextTurn = useCallback(() => jump(nextTurnStep(marks, step, last)), [jump, marks, step, last]);
  const togglePlay = useCallback(() => {
    if (!playing && step >= last) jump(0);
    setPlaying((p) => !p);
  }, [playing, step, last, jump]);

  // Autoplay: the next step once this one has played out and the pause has passed; stops at the end.
  useEffect(() => {
    if (!playing) return;
    if (step >= last) {
      setPlaying(false);
      return;
    }
    if (busy) return;
    const t = window.setTimeout(() => setCursor((c) => Math.min(last, c + 1)), SPEEDS[speed]!.pause);
    return () => clearTimeout(t);
  }, [playing, busy, step, last, speed]);

  useEffect(() => {
    try {
      localStorage.setItem(SPEED_KEY, String(speed));
    } catch {
      /* the speed is simply not remembered */
    }
  }, [speed]);

  // The position is kept in the address, so a reload or a shared link opens at the same step.
  useEffect(() => {
    const t = window.setTimeout(() => {
      const url = new URL(window.location.href);
      if (step) url.searchParams.set('step', String(step));
      else url.searchParams.delete('step');
      window.history.replaceState(window.history.state, '', url);
    }, 300);
    return () => clearTimeout(t);
  }, [step]);

  // Space plays or pauses; the arrows step; Shift+arrows (or PageUp/PageDown) skip a Player Turn; Home/End.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'range'))) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const run = (f: () => void) => {
        e.preventDefault();
        f();
      };
      if (e.key === ' ') run(togglePlay);
      else if (e.key === 'ArrowRight') run(e.shiftKey ? nextTurn : forward);
      else if (e.key === 'ArrowLeft') run(e.shiftKey ? prevTurn : back);
      else if (e.key === 'PageDown') run(nextTurn);
      else if (e.key === 'PageUp') run(prevTurn);
      else if (e.key === 'Home') run(() => jump(0));
      else if (e.key === 'End') run(() => jump(last));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, forward, back, nextTurn, prevTurn, jump, last]);

  const frame = replay.frames[step]!;
  const session: Session = useMemo(
    () => ({
      engine: replay.engine,
      state: frame.state,
      log: replay.log.slice(0, frame.logLen),
      act: () => 'Replay is read-only',
      check: () => 'Replay is read-only',
      undo: () => {},
      canUndo: false,
      actionCount: step,
      replayError: replay.error,
      mySide: null,
      seek,
    }),
    [replay, frame, step, seek],
  );

  const state = frame.state;
  const env = useMemo(() => replay.engine.env(state), [replay.engine, state]);
  const where = state.phase === 'setup' ? 'Setup' : `Turn ${state.turn} · ${sideNameOf(env, state.attacker)} ${PHASE_NAME[state.phase] ?? state.phase}`;
  const outcome = match.result ? (match.result.winner ? `${sideNameOf(env, match.result.winner)} victory · ${match.result.reason}` : `Draw · ${match.result.reason}`) : 'Live recording';

  return (
    <>
      <GameScreen scenario={scenario} players={seatNames(match)} session={session} matchId={undefined} viewKey={`watch.${matchId}`} onQuit={() => navigate(-1)} onResolvingChange={setBusy} />
      <div className="replay-controls" role="toolbar" aria-label="Replay">
        <div className="replay-head">
          <div className="replay-title">
            <b>{match.scenarioTitle}</b>
            <span>{outcome}</span>
          </div>
          <div className="replay-where" aria-live="polite">
            <b>{where}</b>
            <span>Step {step} of {last}</span>
            {replay.error && <span className="replay-warn" title={replay.error}>· the rest of the recording needs older rules</span>}
          </div>
        </div>
        <div className="replay-row">
          <div className="replay-buttons">
            <button onClick={() => jump(0)} disabled={step === 0} title="Start (Home)" aria-label="Start"><Icon d="M6 5v14M19 5 9 12l10 7z" /></button>
            <button onClick={prevTurn} disabled={step === 0} title="Previous Player Turn (Shift+←)" aria-label="Previous Player Turn">«</button>
            <button onClick={back} disabled={step === 0} title="Step back (←)" aria-label="Step back">‹</button>
            <button className="replay-play" onClick={togglePlay} disabled={last === 0} title={playing ? 'Pause (Space)' : 'Play (Space)'} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Icon d="M8 5v14M16 5v14" /> : <Icon d="M7 5l12 7-12 7z" />}</button>
            <button onClick={forward} disabled={step >= last} title="Step forward (→)" aria-label="Step forward">›</button>
            <button onClick={nextTurn} disabled={step >= last} title="Next Player Turn (Shift+→)" aria-label="Next Player Turn">»</button>
            <button onClick={() => jump(last)} disabled={step >= last} title="End (End)" aria-label="End"><Icon d="M18 5v14M5 5l10 7-10 7z" /></button>
          </div>
          <Timeline step={step} last={last} marks={marks} onJump={jump} sideName={(s) => sideNameOf(env, s)} />
          <div className="replay-speed" role="group" aria-label="Autoplay speed">
            {SPEEDS.map((s, i) => (
              <button key={s.label} className={i === speed ? 'on' : ''} onClick={() => setSpeed(i)} aria-pressed={i === speed}>{s.label}</button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function Icon({ d }: { d: string }) {
  return <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d={d} fill="currentColor" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" /></svg>;
}

/** The scrubber: a range over every step, with a tick where each Player Turn begins and the Game Turn numbers above. */
function Timeline({ step, last, marks, onJump, sideName }: { step: number; last: number; marks: TurnMark[]; onJump(step: number): void; sideName(side: string): string }) {
  const at = (s: number) => `${last ? (s / last) * 100 : 0}%`;
  return (
    <div className="replay-timeline">
      <div className="replay-track">
        <div className="replay-fill" style={{ width: at(step) }} />
        {marks.map((m) => (
          <span key={m.step} className={`replay-tick${m.gameTurn ? ' turn' : ''}`} style={{ left: at(m.step) }} />
        ))}
      </div>
      <input aria-label="Replay position" type="range" min={0} max={last} value={step} onChange={(e) => onJump(Number(e.target.value))} />
      <div className="replay-turns">
        {marks.filter((m) => m.gameTurn).map((m) => (
          <button key={m.step} style={{ left: at(m.step) }} onClick={() => onJump(m.step)} title={`Turn ${m.turn} · ${sideName(m.side)}`}>{m.turn}</button>
        ))}
      </div>
    </div>
  );
}
