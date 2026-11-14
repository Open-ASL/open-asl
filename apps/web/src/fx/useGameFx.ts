import { useEffect, useRef, useState } from 'react';
import type { Decision, GameState, HexId, LoggedEvent, PieceId, QueryEnv, SideId } from '@asl/engine';
import { defOf, type IftResult, type Statics, isVisibleTo } from '@asl/rules';
import { playSfx } from '../audio/engine';
import type { SfxName, SfxParams } from '../audio/sfx';
import { counterImage } from '../game/assets';
import { NATION, defLabel, entryRoll, hexLabel, humanize, pieceLabel, sideNameOf } from '../game/describe';
import type { FxLevel } from './settings';

/* ----------------------------------------------------------------------------- types */

/** A phase-wheel cinematic: the phase / player turn / deployment that just began. */
export interface WheelCue {
  id: number;
  kind: 'phase' | 'playerTurn' | 'setup';
  phase: string;
  turn: number;
  /** Side whose turn (or deployment) it now is. */
  side: SideId;
  defender: SideId;
  /** For a new player turn: whose turn just ended. */
  endedSide?: SideId;
  /** The turn chit on the hub still shows this side when the wheel comes in, then flips to `side`. */
  flipFrom?: SideId;
  /** Deployment of this turn's reinforcements (offboard setup), not the scenario setup. */
  reinforcements?: boolean;
}

/** A short banner for a decision handed to the other player mid-phase (e.g. Defensive First Fire). */
export interface Callout {
  id: number;
  side: SideId;
  title: string;
  text: string;
}

/** A counter shown on a toast: who fired, or who the roll happened to and how it went for them. */
export interface ToastUnit {
  id: PieceId;
  /** Counter image as the unit now stands (broken side, reduced counter, ...). */
  img: string | null;
  label: string;
  /** Short outcome under the counter, e.g. "broken", "1MC", "passed". */
  outcome?: string;
  tone?: 'good' | 'bad';
  dead?: boolean;
}

export interface DiceToast {
  id: number;
  label: string;
  dice: number[];
  /** Extra line under the total, e.g. "8 FP · 8 column · DRM +2". */
  detail?: string;
  /** The units firing (an attack roll). */
  firers: ToastUnit[];
  /** Where the fire went (an attack roll). */
  target?: string;
  /** The units the roll happened to. */
  units: ToastUnit[];
  /** Outcome lines (filled in by the events that follow the roll). */
  results: string[];
  tone: 'neutral' | 'good' | 'bad';
  /** How long (ms) the toast stays before fading. */
  hold: number;
}

/**
 * Pacing of the dice: one roll (with its outcome) per beat, so a volley of morale checks reads
 * one at a time instead of landing all at once.
 */
/**
 * `beat`: time between two rolls; `reveal`: from a roll appearing to its results showing on the
 * board (the dice have landed and the first result text is up); `quiet`: the slot of a beat
 * without dice (footsteps, a "no LOS" tracer), short so movement stays responsive.
 */
const PACE: Record<FxLevel, { beat: number; hold: number; reveal: number; quiet: number }> = {
  full: { beat: 1600, hold: 7000, reveal: 450, quiet: 500 },
  fast: { beat: 800, hold: 4200, reveal: 250, quiet: 250 },
  off: { beat: 0, hold: 0, reveal: 0, quiet: 0 },
};
/** Events that move the game to another phase or turn (or end it): they wait until the roll before them has played out. */
const PHASE_EVENTS = new Set(['turn.phaseEnded', 'turn.phaseStarted', 'turn.playerTurn', 'game.ended']);
const MAX_TOASTS = 3;
/** Rolls kept for the dice log the player can pull back up. */
export const DICE_LOG_LIMIT = 200;

/** Effects the board draws on the map. */
export type BoardFx =
  | { id: number; kind: 'tracer'; from: HexId[]; to: HexId; color: number }
  | { id: number; kind: 'text'; hex?: HexId; piece?: PieceId; text: string; color: number; delay: number; big?: boolean }
  | { id: number; kind: 'burst'; hex: HexId; color: number; delay: number }
  /** A player pointing a spot out: rings close in on it in their colour. `at` is the exact map point, else the hex centre. */
  | { id: number; kind: 'ping'; hex: HexId; color: number; at?: { x: number; y: number } }
  | { id: number; kind: 'face'; piece: PieceId; change: 'broken' | 'rallied' | 'reduced' | 'malf' | 'repaired' | 'eliminated' | 'wrecked'; delay: number };

export interface GameFx {
  wheel: WheelCue | null;
  dismissWheel(): void;
  callout: Callout | null;
  toasts: DiceToast[];
  /** The last rolls shown, oldest first, for the dice log. */
  history: DiceToast[];
  boardFx: BoardFx[];
  /** Whether a `face` effect for this piece is still waiting to play (the board keeps its old face until then). */
  holdsFace(piece: PieceId): boolean;
  /** Show everything now: the rolls still waiting go straight to the dice log, the board jumps to the outcome. */
  skip(): void;
  /** Pulse a spot in a player's colour, with a soft chime: a ping, ours or the opponent's. `at` is the exact map point, else the hex centre. */
  ping(hex: HexId, color: number, at?: { x: number; y: number }): void;
}

/** The part of the presentation the effects drive: what the screen shows and how to reveal more of it. */
export interface PresentationControl {
  state: GameState;
  reveal(seq: number): void;
  flush(): void;
}

/* ----------------------------------------------------------------------------- helpers */

const resultText = (r: IftResult) =>
  r.kind === 'none' ? 'no effect' : r.kind === 'KIA' ? `${r.n}KIA` : r.kind === 'K' ? `K/${r.n}` : r.kind === 'MC' ? `${r.n}MC` : r.kind;

const OUTCOME_TEXT: Record<string, { text: string; color: number; tone: DiceToast['tone'] }> = {
  passed: { text: 'PASSED', color: 0x9fe07a, tone: 'good' },
  pinned: { text: 'PINNED', color: 0xf0d060, tone: 'bad' },
  broken: { text: 'BROKEN', color: 0xff5f55, tone: 'bad' },
  reduced: { text: 'REDUCED', color: 0xff5f55, tone: 'bad' },
  eliminated: { text: 'ELIMINATED', color: 0xff3b30, tone: 'bad' },
  // A Japanese squad or crew's failed MC (SK4 8.1.2): a step down, not a break.
  stepReduced: { text: 'STEP REDUCED', color: 0xff8a65, tone: 'bad' },
};

const hexOfPiece = (state: GameState, id: PieceId): HexId | undefined => {
  const p = state.pieces[id];
  if (!p) return undefined;
  if (p.loc.kind === 'hex' || p.loc.kind === 'offboard') return p.loc.hex;
  if (p.loc.kind === 'held') return hexOfPiece(state, p.loc.by);
  return undefined;
};

/* ----------------------------------------------------------------------------- hook */

/**
 * The page is in a background tab. The browser pauses the board's animation frames and the audio there but still
 * runs (throttled) timers, so effects queued meanwhile would all play at once on return: while away, the game is
 * followed silently, as with effects off, and the rolls go to the dice log.
 */
const away = () => typeof document !== 'undefined' && document.hidden;

/**
 * Watches the game for things worth dramatising: phase and player-turn changes (phase wheel),
 * decisions handed to the other side (callouts), dice (toasts) and combat results (board effects).
 */
/**
 * `env` is the real game (the effects are built from the events that produced it); `present` is
 * what the screen shows, revealed beat by beat as the dice play, and `decision` its decision.
 */
/**
 * `seek`: a replay's jump counter (Session.seek). When it changes, the position jumped to is taken as it stands: no
 * wheel, callout, dice or board effect for what was jumped over, and whatever was still playing is dropped.
 */
export function useGameFx(env: QueryEnv, log: LoggedEvent[], decision: Decision | undefined, level: FxLevel, viewer: SideId | null, present: PresentationControl, seek = 0): GameFx {
  const enabled = level !== 'off';
  const state = env.state;
  const shownState = present.state;
  const presentRef = useRef(present);
  presentRef.current = present;
  const nextId = useRef(1);
  /** Toast-expiry timers; the beat and reveal timers still to fire; when the last scheduled beat ends (so new rolls queue behind it). */
  const timers = useRef<number[]>([]);
  const scheduled = useRef<number[]>([]);
  /** Toasts scheduled but not shown yet (a skip sends them to the dice log). */
  const unshown = useRef<DiceToast[]>([]);
  const queueEnd = useRef(0);
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      scheduled.current.forEach(clearTimeout);
    },
    [],
  );
  const [wheel, setWheel] = useState<WheelCue | null>(null);
  const [callout, setCallout] = useState<Callout | null>(null);
  const [toasts, setToasts] = useState<DiceToast[]>([]);
  const [history, setHistory] = useState<DiceToast[]>([]);
  const [boardFx, setBoardFx] = useState<BoardFx[]>([]);
  /** Pieces with face effects scheduled but not yet shown: how many, and a deadline in case one never plays. */
  const faceHolds = useRef(new Map<PieceId, { n: number; until: number }>());
  const holdsFace = (piece: PieceId) => {
    const h = faceHolds.current.get(piece);
    return !!h && h.n > 0 && performance.now() < h.until;
  };

  // --- phase wheel: driven by state transitions, not events, so skipped phases collapse into one cue.
  // Deployments are cues of their own: the scenario setup, and each turn's reinforcements set up
  // offboard at the start of the attacker's RPh. The player turn is announced once they are done.
  const setupKind = decision?.kind === 'setup' || decision?.kind === 'offboardSetup' ? decision.kind : null;
  const setupKey = setupKind ? `${setupKind}:${decision!.owner}:${shownState.turn}` : null;
  const prevTurn = useRef<{ phase: string; turn: number; attacker: SideId; setupKey: string | null } | null>(null);
  /** The last player turn the wheel announced, so the next one can say whose turn ended. */
  const lastPlayerTurn = useRef<{ turn: number; attacker: SideId } | null>(null);
  /** The side the turn chit on the wheel's hub last showed; it flips whenever the active side changes. */
  const chitSide = useRef<SideId | null>(null);
  const chitFlip = (side: SideId): { flipFrom?: SideId } => {
    const from = chitSide.current;
    chitSide.current = side;
    return from && from !== side ? { flipFrom: from } : {};
  };
  const wheelSeek = useRef(seek);
  useEffect(() => {
    const now = { phase: shownState.phase, turn: shownState.turn, attacker: shownState.attacker, setupKey };
    const prev = prevTurn.current;
    prevTurn.current = now;
    const sides = shownState.sides;
    const defender = sides.find((s) => s !== shownState.attacker) ?? shownState.attacker;
    if (seek !== wheelSeek.current || away()) {
      // A replay jump, or a change while the tab is in the background: the wheel takes up the new position
      // silently, so the next phase change reads from here.
      wheelSeek.current = seek;
      setWheel(null);
      if (now.phase !== 'setup' && !setupKey) lastPlayerTurn.current = { turn: now.turn, attacker: now.attacker };
      chitSide.current = setupKind && decision ? decision.owner : now.attacker;
      return;
    }
    if (shownState.result) return;
    if (setupKind && decision) {
      if (prev?.setupKey === setupKey) return;
      const owner = decision.owner;
      const other = sides.find((s) => s !== owner) ?? owner;
      setWheel({
        id: nextId.current++,
        kind: 'setup',
        phase: 'setup',
        turn: now.turn,
        side: owner,
        defender: other,
        ...(setupKind === 'offboardSetup' ? { reinforcements: true } : {}),
        ...chitFlip(owner),
      });
      return;
    }
    // Coming out of a deployment, the player turn it opened has not been announced yet.
    const afterSetup = !prev || prev.phase === 'setup' || !!prev.setupKey;
    if (prev && !afterSetup && prev.phase === now.phase && prev.turn === now.turn && prev.attacker === now.attacker) return;
    const playerTurn = afterSetup || prev.attacker !== now.attacker || prev.turn !== now.turn;
    const ended = lastPlayerTurn.current;
    if (playerTurn) lastPlayerTurn.current = { turn: now.turn, attacker: now.attacker };
    setWheel({
      id: nextId.current++,
      kind: playerTurn ? 'playerTurn' : 'phase',
      phase: now.phase,
      turn: now.turn,
      side: now.attacker,
      defender,
      ...(playerTurn && ended && (ended.turn !== now.turn || ended.attacker !== now.attacker) ? { endedSide: ended.attacker } : {}),
      ...chitFlip(now.attacker),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownState.phase, shownState.turn, shownState.attacker, shownState.result, shownState.sides, setupKey, seek]);

  // --- callouts for decisions that switch the acting player inside a phase.
  const prevDecision = useRef<string | undefined>(undefined);
  const calloutSeek = useRef(seek);
  useEffect(() => {
    const key = decision ? `${decision.id}` : undefined;
    if (key === prevDecision.current) return;
    prevDecision.current = key;
    const jumped = seek !== calloutSeek.current;
    calloutSeek.current = seek;
    if (jumped) setCallout(null);
    if (!decision || !enabled || jumped || away()) return;
    const name = sideNameOf(env, decision.owner);
    let c: Omit<Callout, 'id'> | null = null;
    const at = decision.data?.['hex'] ? hexLabel(String(decision.data['hex'])) : '';
    // The player it waits on has the standing "your call" cue (with its Pass or Done button) for Defensive First
    // Fire and the defender's rallies; the banner is news for the other side and for spectators.
    // That player still hears the chime.
    const theirs = viewer !== decision.owner;
    // The RPh is shared: once the attacker has rallied, the defender gets their turn at it.
    const defenderRally = decision.kind === 'phase' && shownState.phase === 'RPh' && decision.owner !== shownState.attacker;
    if (decision.kind === 'firstFire' && theirs) c = { side: decision.owner, title: name, text: decision.data?.['ending'] ? `Move over in ${at} · last First Fire chance` : `Defensive First Fire · ${at}` };
    else if (decision.kind === 'ccArrange') c = { side: decision.owner, title: name, text: `Arrange leaders for Close Combat · ${at}` };
    else if (decision.kind === 'ccDeclare') c = { side: decision.owner, title: name, text: `Declare Close Combat · ${at}` };
    else if (defenderRally && theirs) c = { side: decision.owner, title: name, text: 'Rally Phase · their rallies' };
    else if (decision.kind === 'firstFire' || defenderRally) playSfx('callout');
    if (c) {
      const id = nextId.current++;
      playSfx('callout');
      setCallout({ id, ...c });
      const t = setTimeout(() => setCallout((cur) => (cur?.id === id ? null : cur)), 2700);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [decision, enabled, seek]);

  // --- events → dice toasts and board effects.
  const seen = useRef(0);
  const eventSeek = useRef(seek);
  useEffect(() => {
    // After an undo the log is shorter than what was seen: start again from its new end, so
    // the actions replayed from there play their effects.
    const last = log[log.length - 1]?.seq ?? 0;
    const reveal = (seq: number) => presentRef.current.reveal(seq);
    if (seek !== eventSeek.current) {
      // A replay jump: drop what was still to play and start again from where it landed.
      eventSeek.current = seek;
      seen.current = last;
      scheduled.current.forEach(clearTimeout);
      scheduled.current = [];
      unshown.current = [];
      faceHolds.current.clear();
      queueEnd.current = 0;
      setToasts([]);
      setBoardFx([]);
      reveal(last);
      return;
    }
    if (last < seen.current) {
      // Whatever was still to be revealed belonged to the undone action.
      seen.current = last;
      scheduled.current.forEach(clearTimeout);
      scheduled.current = [];
      unshown.current = [];
      faceHolds.current.clear();
      queueEnd.current = 0;
      return;
    }
    const fresh = log.filter((e) => e.seq > seen.current);
    if (fresh.length === 0) return;
    // The first batch is the game being set up (or restored): nothing to dramatise or hear.
    const firstBatch = seen.current === 0;
    seen.current = last;
    if (firstBatch) {
      reveal(last);
      return;
    }
    const pace = PACE[level];
    /** Run `f` at time `at` (performance.now() clock), or now if that has passed. */
    const at = (when: number, f: () => void) => {
      const t = window.setTimeout(() => {
        scheduled.current = scheduled.current.filter((x) => x !== t);
        f();
      }, Math.max(0, when - performance.now()));
      scheduled.current.push(t);
    };
    // Events are grouped into beats: each die roll starts one, and the effects that follow
    // (attack, results, checks) belong to it until the next roll.
    // Each beat also reveals its events on the board: up to `endSeq`, the events before it included
    // (beats with nothing to show fold into the next one). A phase change inside a beat (`splitSeq`:
    // the last event before it) waits until the beat has played out.
    interface Beat {
      toast: DiceToast | null;
      fx: BoardFx[];
      sounds: { name: SfxName; delay: number; params?: SfxParams }[];
      endSeq: number;
      splitSeq?: number;
    }
    const beats: Beat[] = [];
    let beat: Beat = { toast: null, fx: [], sounds: [], endSeq: 0 };
    const closeBeat = (endSeq: number) => {
      beat.endSeq = endSeq;
      if (beat.toast || beat.fx.length || beat.sounds.length) beats.push(beat);
      else if (beat.splitSeq !== undefined && beats.length) beats[beats.length - 1]!.splitSeq ??= beat.splitSeq;
      beat = { toast: null, fx: [], sounds: [], endSeq: 0 };
    };
    const fx = { push: (f: BoardFx) => beat.fx.push(f) };
    let delay = 0;
    let lastToast: DiceToast | null = null;
    const ccToasts: Record<string, DiceToast> = {};
    /** Broken targets the current attack put under DM (SK1 3.2.1): their result reads "… · DM". */
    const desperate = new Set<PieceId>();
    const snd = (name: SfxName, at = delay, params?: SfxParams) => beat.sounds.push({ name, delay: at, ...(params ? { params } : {}) });
    // Counters as they stood at each roll. The state in hand is the one after the whole batch, so
    // a chip would otherwise show the half-squad a unit becomes two rolls later: the batch's face
    // changes are replayed backwards to where it began, then forwards as the beats are built.
    interface Face {
      defId: string;
      broken: boolean;
      malf: boolean;
      dead: boolean;
    }
    const counters = (env.statics as Statics).counters;
    const faceNow = new Map<PieceId, Face>();
    const faceAt = (id: PieceId): Face => {
      let f = faceNow.get(id);
      if (!f) {
        const pc = state.pieces[id];
        f = { defId: pc?.defId ?? '', broken: pc?.tags['broken'] === true, malf: pc?.tags['malf'] === true, dead: pc?.loc.kind === 'eliminated' };
        faceNow.set(id, f);
      }
      return f;
    };
    for (const e of [...fresh].reverse()) {
      const p = e.payload as Record<string, unknown>;
      const id = p['id'] as PieceId;
      if (e.type === 'piece.tagged') {
        const tags = p['tags'] as Record<string, unknown>;
        if ('broken' in tags) faceAt(id).broken = tags['broken'] !== true;
        if ('malf' in tags) faceAt(id).malf = tags['malf'] !== true;
      } else if (e.type === 'piece.replaced' && typeof p['from'] === 'string') faceAt(id).defId = p['from'];
      else if (e.type === 'piece.eliminated') faceAt(id).dead = false;
    }
    /** A unit's name as it stood at this point of the batch. */
    const labelOf = (id: PieceId): string => {
      const d = counters[faceAt(id).defId];
      return d ? `${NATION[d.nationality] ?? d.nationality} ${defLabel(d)}` : pieceLabel(env, state.pieces[id]);
    };
    /** A unit as a toast chip, as it stood at this point of the batch. */
    const chip = (id: PieceId): ToastUnit => {
      const f = faceAt(id);
      return { id, img: counterImage(f.defId, f.broken || f.malf), label: labelOf(id), ...(f.dead ? { dead: true } : {}) };
    };
    /** Note on the current toast what happened to a unit (one chip per unit, the latest word wins). */
    const affected = (id: PieceId, outcome?: string, tone?: ToastUnit['tone']) => {
      if (!lastToast || hiddenFrom(id)) return;
      let u = lastToast.units.find((x) => x.id === id);
      if (!u) {
        u = chip(id);
        lastToast.units.push(u);
      } else Object.assign(u, chip(id));
      if (outcome) u.outcome = outcome;
      if (tone) u.tone = tone;
    };
    /** The counter's face changes (or it leaves the board) in step with the text and sound. */
    const face = (unit: PieceId, change: Extract<BoardFx, { kind: 'face' }>['change']) => {
      // One flip per unit per beat: a unit reduced and broken by the same roll turns over once,
      // to the face it ends up with (an elimination still burns it away).
      const prior = beat.fx.find((f): f is Extract<BoardFx, { kind: 'face' }> => f.kind === 'face' && f.piece === unit);
      if (prior) {
        if (change === 'eliminated') prior.change = change;
        return;
      }
      fx.push({ id: nextId.current++, kind: 'face', piece: unit, change, delay });
      const h = faceHolds.current.get(unit);
      faceHolds.current.set(unit, { n: (h?.n ?? 0) + 1, until: performance.now() + 30000 });
    };
    /** A unit still hidden from the viewer (SK2 HIP) gets no floating text or chip. */
    const hiddenFrom = (unit: PieceId) => {
      const pc = state.pieces[unit];
      return !!pc && !isVisibleTo(env, pc, viewer);
    };
    /** A vehicular MG piece (SK4 7.8): the vehicle holding it and its kind (BMG, CMG, AAMG, RMG), else null. */
    const vehicleMgHolder = (id: PieceId): { vehicle: PieceId; type: string } | null => {
      const pc = state.pieces[id];
      if (!pc || pc.loc.kind !== 'held') return null;
      const d = defOf(env, pc);
      if (d.kind !== 'sw' || !d.fixed || state.pieces[pc.loc.by]?.tags['vca'] === undefined) return null;
      return { vehicle: pc.loc.by, type: d.type };
    };
    const unitText = (unit: PieceId, text: string, color: number, big = false, sound?: SfxName) => {
      if (hiddenFrom(unit)) return;
      fx.push({ id: nextId.current++, kind: 'text', piece: unit, ...(hexOfPiece(state, unit) ? { hex: hexOfPiece(state, unit)! } : {}), text, color, delay, big });
      if (sound) snd(sound, delay);
      delay += 420;
    };
    /** What the firing units sound like: their nation's small arms, plus each machine gun / weapon they used. */
    const weaponSounds = (parts: PieceId[]): { name: SfxName; params: SfxParams }[] => {
      const out: { name: SfxName; params: SfxParams }[] = [];
      let squads = 0;
      let nation: string | undefined;
      let leaders = 0;
      for (const id of parts) {
        const pc = state.pieces[id];
        if (!pc) continue;
        const d = defOf(env, pc);
        if (d.kind === 'gun') {
          // A Gun: its IFE sounds like a heavy MG; an ordnance shot has its own beat.
          out.push({ name: 'fire.hmg', params: { nation: d.nationality } });
        } else if (d.kind === 'sw') {
          // A captured MG42 still sounds like an MG42: the weapon's own nationality.
          const params = { nation: d.nationality };
          if (d.type === 'LMG') out.push({ name: 'fire.lmg', params });
          else if (d.type === 'MMG') out.push({ name: 'fire.mmg', params });
          else if (d.type === 'HMG') out.push({ name: 'fire.hmg', params });
          else if (d.type === 'FT') out.push({ name: 'fire.ft', params });
          else if (d.type === 'DC') out.push({ name: 'fire.explosion', params });
        } else {
          nation = d.nationality;
          if (d.kind === 'squad') squads += 1;
          else if (d.kind === 'hs' || d.kind === 'crew') squads += 0.5;
          else leaders++;
        }
      }
      if (squads) out.push({ name: 'fire.rifle', params: { nation, intensity: squads } });
      else if (leaders) out.push({ name: 'fire.pistol', params: { nation } });
      return out;
    };
    // One footstep sound per batch even when a whole stack moves.
    let stepped = false;
    for (const e of fresh) {
      const p = e.payload as Record<string, unknown>;
      if (PHASE_EVENTS.has(e.type) && beat.splitSeq === undefined) beat.splitSeq = e.seq - 1;
      switch (e.type) {
        case 'dice.rolled': {
          closeBeat(e.seq - 1);
          delay = 300;
          desperate.clear();
          snd('dice.roll', 0);
          const dice = p['dice'] as number[];
          lastToast = { id: nextId.current++, label: humanize(env, p['label'] as string), dice, firers: [], units: [], results: [], tone: 'neutral', hold: pace.hold };
          beat.toast = lastToast;
          // Simultaneous CC rolls every DR before any result: each result goes back to its own side's roll.
          const cc = /^CC (\S+) in /.exec(p['label'] as string);
          if (cc) ccToasts[cc[1]!] = lastToast;
          // A provisional reinforcement's entry dr: say whether the force comes on this turn.
          const entry = entryRoll(p['label'] as string, dice[0]!);
          if (entry) {
            lastToast.results.push(entry.enters ? 'ENTERS THIS TURN' : 'NOT THIS TURN');
            lastToast.tone = entry.enters ? 'good' : 'neutral';
          }
          break;
        }
        case 'sk1.fire.attack': {
          const attack = p['attack'] as { target: HexId; parts: PieceId[] };
          const from = [...new Set(attack.parts.map((id) => hexOfPiece(state, id)).filter((h): h is HexId => !!h))];
          fx.push({ id: nextId.current++, kind: 'tracer', from, to: attack.target, color: 0xffc85a });
          fx.push({ id: nextId.current++, kind: 'burst', hex: attack.target, color: 0xffa040, delay: 180 });
          for (const w of weaponSounds(attack.parts)) snd(w.name, 0, w.params);
          delay = 450;
          if (lastToast) {
            const drm = p['drm'] as number;
            const labels = (xs: unknown) => ((xs as { label?: string }[] | undefined) ?? []).map((x) => x.label).filter(Boolean).join(', ');
            const fpx = labels(p['fpExplain']);
            const drmx = labels(p['explain']);
            lastToast.detail = `${p['fp']} FP${fpx ? ` (${fpx})` : ''} · ${p['column'] ?? '—'} column · DRM ${drm >= 0 ? '+' : ''}${drm}${drmx ? ` (${drmx})` : ''}${p['cowered'] ? ' · cowers' : ''}`;
            lastToast.firers = attack.parts.map(chip);
            lastToast.target = hexLabel(attack.target);
          }
          break;
        }
        case 'sk1.fire.rof': {
          if (!lastToast) break;
          const kept = (p['kept'] as { sw: PieceId }[]).map((k) => k.sw);
          const lost = p['lost'] as { sw: PieceId; why: string }[];
          const notes = [
            ...(kept.length ? [`${kept.map((id) => chip(id).label).join(', ')} keeps ROF`] : []),
            ...lost.filter((l) => l.why !== 'exceeded').map((l) => `${chip(l.sw).label} loses ROF (${l.why})`),
          ];
          if (notes.length) lastToast.detail = `${lastToast.detail ?? ''} · ${notes.join(' · ')}`;
          break;
        }
        case 'sk1.fire.rofDeclined': {
          fx.push({ id: nextId.current++, kind: 'text', hex: p['hex'] as HexId, text: `${p['residual']} RESIDUAL FP`, color: 0xf0cf72, delay: 0 });
          delay = 300;
          break;
        }
        case 'sk1.fire.noLos': {
          const target = (p['attack'] as { target: HexId }).target;
          const from = p['from'] as HexId[];
          fx.push({ id: nextId.current++, kind: 'tracer', from, to: target, color: 0xff4040 });
          for (const h of from) fx.push({ id: nextId.current++, kind: 'text', hex: h, text: 'NO LOS', color: 0xff6a6a, delay: 350, big: true });
          for (const w of weaponSounds((p['attack'] as { parts: PieceId[] }).parts)) snd(w.name, 0, w.params);
          snd('hit.none', 400);
          delay = 450;
          break;
        }
        case 'sk1.fire.dm':
          for (const u of p['units'] as PieceId[]) desperate.add(u);
          break;
        case 'sk1.fire.result': {
          const r = p['result'] as IftResult;
          const text = (p['critical'] ? 'eliminated (Critical Hit)' : resultText(r)) + (desperate.has(p['unit'] as PieceId) ? ' · DM' : '');
          const bad = r.kind !== 'none';
          unitText(p['unit'] as string, text.toUpperCase(), bad ? 0xffb347 : 0xa8b098, r.kind === 'KIA' || r.kind === 'K', r.kind === 'none' ? 'hit.none' : r.kind === 'KIA' || r.kind === 'K' ? 'hit.kia' : 'hit.mc');
          if (lastToast) {
            const own = ((p['explain'] as { label?: string }[] | undefined) ?? []).map((x) => x.label).filter(Boolean).join(', ');
            lastToast.results.push(`${labelOf(p['unit'] as string)}: ${text}${own ? ` (final ${p['finalDr']}: ${own})` : ''}`);
            if (bad) lastToast.tone = 'bad';
          }
          affected(p['unit'] as string, text, bad ? 'bad' : undefined);
          break;
        }
        case 'sk1.check': {
          const kind = p['kind'] as string;
          const rally = kind === 'rally';
          const outcome = p['outcome'] as string;
          // Rally outcomes are their own words (SK1 3.1); morale/pin checks use the IFT outcome table.
          const o = rally
            ? outcome === 'rallied'
              ? { text: 'RALLIED', color: 0x9fe07a, tone: 'good' as const }
              : outcome === 'reduced'
                ? { text: 'REDUCED', color: 0xff5f55, tone: 'bad' as const }
                : { text: 'NOT RALLIED', color: 0xf0d060, tone: 'bad' as const }
            : OUTCOME_TEXT[outcome];
          if (!o) break;
          const good = o.tone === 'good';
          const sound: SfxName = rally
            ? good
              ? 'rally'
              : 'rally.fail'
            : good
              ? 'hit.pass'
              : outcome === 'pinned'
                ? 'hit.pin'
                : outcome === 'broken'
                  ? 'hit.break'
                  : 'hit.kia';
          const unit = p['unit'] as string;
          unitText(unit, o.text, good ? 0x9fe07a : o.color, !good && !rally, sound);
          if (lastToast) {
            // Like a fire attack's detail line: what was needed and every DRM that went into the roll.
            const drm = (p['drm'] as number | undefined) ?? (p['final'] as number) - (p['dr'] as number);
            const notes = ((p['explain'] as { label?: string }[] | undefined) ?? []).map((n) => n.label).filter(Boolean);
            const fpf = p['reason'] === 'FPF';
            if (fpf) {
              // No roll of its own: the FPF attack's Original DR is a NMC on its firers (SK1 3.3.1), so it
              // joins the attack's card rather than replacing what the attack was.
              const line = `then FPF NMC on the firers: Original DR ${p['dr']}${notes.length ? ` (${notes.join(', ')})` : ''}`;
              if (!lastToast.detail?.includes(line)) lastToast.detail = `${lastToast.detail ?? ''} · ${line}`;
            } else {
              const need = rally ? `morale ${p['target']}` : `${kind} vs ${p['target']}`;
              lastToast.detail = [need, `DRM ${drm >= 0 ? '+' : ''}${drm}`, ...notes].join(' · ');
            }
            const leader = p['leader'] as string | null | undefined;
            if (leader && !lastToast.firers.some((u) => u.id === leader)) lastToast.firers.push(chip(leader));
            const why = rally && outcome === 'reduced' ? 'original 12: casualty reduced' : `${fpf ? 'FPF NMC ' : ''}${o.text.toLowerCase()} (${p['final']} vs ${p['target']})`;
            lastToast.results.push(`${labelOf(unit)}: ${why}`);
            lastToast.tone = good ? (lastToast.tone === 'bad' ? 'bad' : 'good') : 'bad';
          }
          affected(unit, o.text.toLowerCase(), good ? 'good' : 'bad');
          break;
        }
        case 'ssr.variableReinforcements': {
          // The toast for the dr says what it brought.
          const v = p as { def: string; count: number; rule: string };
          const d = counters[v.def];
          if (lastToast) {
            lastToast.results.push(`${v.count}× ${d ? defLabel(d) : v.def} enter this turn (${v.rule})`);
            lastToast.tone = 'good';
          }
          break;
        }
        case 'ssr.entryOrderDr': {
          const v = p as { turns: Record<string, number> };
          const forces = (env.statics as Statics).scenario.forces;
          if (lastToast) {
            for (const [f, t] of Object.entries(v.turns)) lastToast.results.push(`${forces.find((x) => x.id === f)?.group ?? f}: Turn ${t}`);
            lastToast.tone = 'good';
          }
          break;
        }
        case 'ssr.entryLosses': {
          const v = p as { count: number; from: string; to: string };
          const from = counters[v.from];
          const to = counters[v.to];
          if (lastToast) {
            lastToast.results.push(`${v.count}× ${from ? defLabel(from) : v.from} → ${to ? defLabel(to) : v.to}`);
            lastToast.tone = v.count ? 'bad' : 'good';
          }
          break;
        }

        case 'ssr.leaderRelief': {
          // LMA5 SSR 4: the leader relieved of command and who comes in his place.
          const v = p as { unit: string; name: string; rule: string; replacement: { name: string; turn: number } };
          if (lastToast) {
            lastToast.results.push(`${v.name} relieved: Pinned for the rest of the game · ${v.replacement.name} enters on Turn ${v.replacement.turn} (${v.rule})`);
            lastToast.tone = 'bad';
          }
          unitText(v.unit, 'RELIEVED', 0xff8a65);
          affected(v.unit, 'relieved', 'bad');
          break;
        }
        case 'ssr.forceChart': {
          const v = p as { counts: Record<string, number>; vp: number | null; chart: string };
          if (lastToast) {
            lastToast.results.push(
              `${Object.entries(v.counts)
                .map(([def, n]) => `${n}× ${counters[def] ? defLabel(counters[def]!) : def}`)
                .join(', ')}${v.vp !== null ? ` · ${v.vp} VP to win` : ''} (${v.chart})`,
            );
            lastToast.tone = 'good';
          }
          break;
        }
        case 'sk1.leaderCreation': {
          const leader = p['leader'] as string | null;
          const unit = p['unit'] as string;
          if (lastToast) {
            lastToast.results.push(leader ? `${labelOf(leader)} created: field promotion for ${labelOf(unit)}` : `no leader created (dr ${p['dr']})`);
            if (leader) lastToast.tone = lastToast.tone === 'bad' ? 'bad' : 'good';
          }
          if (leader) {
            unitText(leader, 'LEADER CREATED', 0x9fe07a, true, 'hit.pass');
            affected(leader, 'created', 'good');
          }
          break;
        }
        case 'piece.eliminated': {
          const id = p['id'] as string;
          const pc = state.pieces[id];
          faceAt(id).dead = true;
          face(id, 'eliminated');
          if (pc && pc.loc.kind === 'eliminated' && (pc.defId.includes('.L') || !/sw/.test(id))) {
            unitText(id, 'ELIMINATED', 0xff3b30, true, 'hit.kia');
            affected(id, 'eliminated', 'bad');
          }
          break;
        }
        case 'piece.tagged': {
          // Flips: a unit breaking or rallying, a weapon malfunctioning or repaired.
          const id = p['id'] as string;
          const tags = p['tags'] as Record<string, unknown>;
          if ('broken' in tags) {
            faceAt(id).broken = tags['broken'] === true;
            face(id, tags['broken'] === true ? 'broken' : 'rallied');
          } else if ('malf' in tags) {
            faceAt(id).malf = tags['malf'] === true;
            // A vehicular MG (SK4 7.8) has no counter of its own: its vehicle reports the malfunction
            // (a repair has its own event below).
            const mg = vehicleMgHolder(id);
            if (mg && tags['malf'] === true) {
              unitText(mg.vehicle, `${mg.type} MALFUNCTION`, 0xff8a65, true, 'hit.break');
              affected(mg.vehicle, `${mg.type} malfunctioned`, 'bad');
            } else if (!mg) face(id, tags['malf'] === true ? 'malf' : 'repaired');
          }
          break;
        }
        case 'sk3.vehicle.repair': {
          // RPh repair of a vehicle's MA or MG (SK4 3.1 c, 7.8): a dr of 1 repairs, a 6 disables it for good.
          const vehicle = p['vehicle'] as PieceId;
          const weapon = p['weapon'] as PieceId | 'ma';
          const what = weapon === 'ma' ? 'MA' : (vehicleMgHolder(weapon)?.type ?? 'MG');
          const result = p['result'] as 'repaired' | 'disabled' | 'none';
          if (result === 'repaired') {
            unitText(vehicle, `${what} REPAIRED`, 0x9fe07a, true);
            affected(vehicle, `${what} repaired`, 'good');
          } else if (result === 'disabled') {
            unitText(vehicle, `${what} DISABLED`, 0xff3b30, true, 'hit.break');
            affected(vehicle, `${what} disabled${weapon === 'ma' ? ' · Recalled' : ''}`, 'bad');
          } else affected(vehicle, `${what} still malfunctioned`);
          break;
        }
        case 'sk1.cc.attack': {
          const hex = p['hex'] as HexId;
          fx.push({ id: nextId.current++, kind: 'burst', hex, color: 0xff6a3a, delay });
          fx.push({ id: nextId.current++, kind: 'text', hex, text: String(p['result']).toUpperCase(), color: 0xffa070, delay: delay + 150, big: true });
          snd('cc', delay);
          delay += 500;
          const toast = ccToasts[p['side'] as string] ?? lastToast;
          if (toast) {
            toast.detail = `${p['odds']} · kill ≤ ${p['kill']}`;
            toast.results.push(String(p['result']));
          }
          break;
        }
        case 'piece.replaced':
          // Losses before entry (SSR) strike counters still offboard: the dr's toast says what they were.
          if (p['reason'] === 'ssr') break;
          faceAt(p['id'] as string).defId = p['defId'] as string;
          face(p['id'] as string, 'reduced');
          // An ELR replacement is not a Casualty Reduction: its own event (next) says what happened; nor is a squad deployed at setup,
          // nor a Japanese Step Reduction (its check's outcome already said so, SK4 8.1.2).
          if (p['reason'] === 'elr' || p['reason'] === 'deploy' || p['reason'] === 'step') break;
          unitText(p['id'] as string, p['reason'] === 'rally' ? 'REPLACED' : 'REDUCED', 0xff8a65, false, 'hit.break');
          affected(p['id'] as string, 'reduced', 'bad');
          break;
        case 'sk1.elr': {
          const unit = p['unit'] as string;
          const was = counters[p['from'] as string];
          const from = was ? `${NATION[was.nationality] ?? was.nationality} ${defLabel(was)}` : (p['from'] as string);
          unitText(unit, 'ELR', 0xff8a65);
          if (lastToast) lastToast.results.push(`${from} → ${labelOf(unit)}: ELR replacement (failed by ${p['failedBy']}, ELR ${p['elr']})`);
          affected(unit, 'elr', 'bad');
          break;
        }
        case 'piece.moved': {
          // Units on the move (the first of a stack sounds for all); counters set down during setup.
          const pc = state.pieces[p['id'] as string];
          const loc = p['loc'] as { kind: string };
          if (stepped || !pc || defOf(env, pc).kind === 'sw') break;
          stepped = true;
          if (state.phase === 'setup' || loc.kind === 'offboard') snd('ui.place', 0);
          else if (loc.kind === 'hex') snd(state.phase === 'RtPh' ? 'rout' : 'move.step', 0);
          break;
        }
        case 'hex.marker':
          if (p['key'] === 'smoke' && p['value']) snd('move.smoke', 0);
          break;
        // ---------------------------------------------------------------- SK2: Guns and ordnance
        case 'sk2.ordnance.shot': {
          const weapon = p['weapon'] as PieceId;
          const target = p['target'] as HexId;
          const outcome = p['outcome'] as string;
          const ammo = p['ammo'] as string | undefined;
          // The Gun never had the Special Ammo it announced: it has not fired (SK4 6.2).
          if (outcome === 'noAmmo') {
            fx.push({ id: nextId.current++, kind: 'text', hex: hexOfPiece(state, weapon) ?? target, text: `NO ${ammo === 'SMOKE' ? 'SMOKE' : ammo ?? 'AMMO'}`, color: 0xb0b0b0, delay: 0, big: true });
            snd('hit.none', 0);
            delay = 450;
            if (lastToast) {
              lastToast.target = hexLabel(target);
              lastToast.results.push(`no ${ammo === 'SMOKE' ? 'Smoke' : ammo} (not fired)`);
              lastToast.tone = 'neutral';
            }
            break;
          }
          const hit = outcome !== 'miss';
          const from = hexOfPiece(state, weapon);
          if (from) fx.push({ id: nextId.current++, kind: 'tracer', from: [from], to: target, color: hit ? 0xffc85a : 0xb0b0b0 });
          fx.push({ id: nextId.current++, kind: 'text', hex: target, text: hit && (ammo === 'SMOKE' || ammo === 'WP') ? (ammo === 'WP' ? 'WP' : 'SMOKE') : outcome === 'ch' ? 'CRITICAL HIT!' : hit ? 'HIT' : 'MISS', color: outcome === 'ch' ? 0xff5f55 : hit ? 0xffb347 : 0xa8b098, delay: 250, big: hit });
          snd('fire.explosion', 0);
          if (!hit) snd('hit.none', 300);
          delay = 500;
          if (lastToast) {
            const drm = p['drm'] as number;
            const notes = ((p['explain'] as { label?: string }[] | undefined) ?? []).map((x) => x.label).filter(Boolean).join(', ');
            lastToast.detail = `${p['intensive'] ? 'Intensive Fire · ' : ''}${p['targetType']}${ammo && ammo !== 'HE' ? ` · ${ammo === 'SMOKE' ? 'Smoke' : ammo}` : ''} · range ${p['range']} · TH ${p['th']}${p['red'] ? ' (red)' : ''} · DRM ${drm >= 0 ? '+' : ''}${drm}${notes ? ` (${notes})` : ''}`;
            lastToast.firers = [chip(weapon), ...(p['firer'] ? [chip(p['firer'] as PieceId)] : [])];
            lastToast.target = hexLabel(target);
            lastToast.results.push(hit && (ammo === 'SMOKE' || ammo === 'WP') ? `${ammo === 'WP' ? 'WP' : 'Smoke'} placed${outcome === 'ch' ? ' (Critical Hit)' : ''}` : outcome === 'ch' ? 'CRITICAL HIT' : hit ? 'HIT' : 'miss');
            lastToast.tone = hit ? 'bad' : 'neutral';
          }
          break;
        }
        case 'sk2.ordnance.noLos': {
          const weapon = p['weapon'] as PieceId;
          const target = p['target'] as HexId;
          const from = hexOfPiece(state, weapon);
          if (from) {
            fx.push({ id: nextId.current++, kind: 'tracer', from: [from], to: target, color: 0xff4040 });
            fx.push({ id: nextId.current++, kind: 'text', hex: from, text: 'NO LOS', color: 0xff6a6a, delay: 350, big: true });
          }
          snd('hit.none', 400);
          delay = 450;
          break;
        }
        case 'sk2.ordnance.rof': {
          if (!lastToast) break;
          const kept = p['kept'] as boolean;
          const why = p['why'] as string | null;
          if (kept) lastToast.detail = `${lastToast.detail ?? ''} · keeps ROF`;
          else if (why && why !== 'exceeded') lastToast.detail = `${lastToast.detail ?? ''} · loses ROF (${why})`;
          break;
        }
        case 'sk2.acquired': {
          if (!lastToast) break;
          lastToast.results.push(`acquired (-${p['level']})`);
          break;
        }
        case 'sk2.gun.malf': {
          const gun = p['gun'] as PieceId;
          unitText(gun, p['removed'] ? 'GUN REMOVED' : 'GUN MALFUNCTION', 0xff8a65, true, 'hit.break');
          affected(gun, p['removed'] ? 'removed' : 'malfunctioned', 'bad');
          break;
        }
        case 'sk2.gun.destroyed': {
          const gun = p['gun'] as PieceId;
          unitText(gun, 'GUN DESTROYED', 0xff3b30, true, 'hit.kia');
          affected(gun, 'destroyed', 'bad');
          break;
        }
        case 'sk2.gun.captured': {
          const gun = p['gun'] as PieceId;
          unitText(gun, 'CAPTURED', 0xffc85a, true, 'ui.place');
          break;
        }
        case 'sk2.gun.ca':
          if (p['reason'] !== 'setup') snd('ui.flip', 0);
          break;
        case 'sk2.gun.manhandle': {
          const gun = p['gun'] as PieceId;
          const outcome = p['outcome'] as string;
          unitText(gun, outcome === 'failed' ? 'STUCK' : outcome === 'stopped' ? 'PUSHED (STOPS)' : 'PUSHED', outcome === 'failed' ? 0xff8a65 : 0x9fe07a, false, outcome === 'failed' ? 'ui.deny' : 'move.step');
          if (lastToast) {
            lastToast.detail = `M${p['m']} · DRM ${(p['drm'] as number) >= 0 ? '+' : ''}${p['drm']}`;
            lastToast.results.push(outcome === 'failed' ? 'the Gun does not move' : outcome === 'stopped' ? 'moved, and stops' : 'moved');
            lastToast.tone = outcome === 'failed' ? 'bad' : 'good';
          }
          break;
        }
        case 'sk3.toKill': {
          const target = p['target'] as PieceId;
          const result = p['result'] as string;
          const tk = p['finalTk'] as number | null;
          if (lastToast) {
            lastToast.label = `To Kill: ${p['location']} ${p['facing']}`;
            lastToast.detail = tk === null ? `${p['ammo']} has no To Kill number` : `${p['ammo']}${p['ch'] ? ' Critical Hit ×2' : ''} TK ${p['modifiedTk']} − AF ${p['af']} = Final TK ${tk} · kills below ${tk}`;
            lastToast.target = chip(target).label;
            lastToast.results.push(
              result === 'kill' ? 'DESTROYED' : result === 'immobilized' ? 'IMMOBILIZED' : result === 'shock' ? 'SHOCK' : result === 'stun' ? 'STUN' : result === 'possibleShock' ? (p['shocked'] ? 'Possible Shock: crew fails → SHOCK' : 'Possible Shock: crew holds') : result === 'dud' ? 'dud (12)' : 'no effect',
            );
            lastToast.tone = result === 'none' || result === 'dud' || (result === 'possibleShock' && !p['shocked']) ? 'neutral' : 'bad';
          }
          affected(target, result === 'kill' ? 'destroyed' : result === 'none' || result === 'dud' ? undefined : result, result === 'none' || result === 'dud' ? undefined : 'bad');
          if (result === 'kill') snd('hit.kia', 0);
          else if (result !== 'none' && result !== 'dud') snd('hit.break', 200);
          break;
        }
        case 'sk3.paatc': {
          const unit = p['unit'] as PieceId;
          const passed = p['passed'] as boolean;
          unitText(unit, passed ? 'PAATC PASSED' : 'PAATC FAILED · PINNED', passed ? 0x9fe07a : 0xff8a65, !passed, passed ? 'ui.flip' : 'ui.deny');
          if (lastToast) {
            lastToast.label = `PAATC: ${chip(unit).label} vs ${chip(p['vehicle'] as PieceId).label}`;
            lastToast.detail = `morale ${p['morale']}${(p['drm'] as number) ? ` · DRM ${(p['drm'] as number) > 0 ? '+' : ''}${p['drm']}` : ''}`;
            lastToast.results.push(passed ? 'passes' : 'fails: pinned');
            lastToast.tone = passed ? 'good' : 'bad';
            lastToast.units = [chip(unit)];
          }
          break;
        }
        case 'sk3.cc.vsVehicle': {
          const hex = hexOfPiece(state, p['vehicle'] as PieceId);
          const result = p['result'] as string;
          if (hex) {
            fx.push({ id: nextId.current++, kind: 'burst', hex, color: 0xff6a3a, delay });
            fx.push({ id: nextId.current++, kind: 'text', hex, text: result === 'eliminated' ? 'DESTROYED' : result === 'immobilized' ? 'IMMOBILIZED' : result === 'casualtyReduction' ? 'CASUALTY REDUCTION' : 'NO EFFECT', color: 0xffa070, delay: delay + 150, big: true });
            snd('cc', delay);
            delay += 500;
          }
          if (lastToast) {
            lastToast.label = `${p['reaction'] ? 'CC Reaction Fire' : 'Close Combat'} vs ${chip(p['vehicle'] as PieceId).label}`;
            lastToast.detail = `CCV ${p['ccv']} · DRM ${(p['drm'] as number) >= 0 ? '+' : ''}${p['drm']}${p['third'] !== undefined ? ` · third die ${p['third']}` : ''}`;
            lastToast.results.push(result === 'eliminated' ? 'DESTROYED' : result === 'immobilized' ? 'IMMOBILIZED' : result === 'casualtyReduction' ? 'original 12: Casualty Reduction' : 'no effect');
            lastToast.tone = result === 'none' ? 'neutral' : result === 'casualtyReduction' ? 'bad' : 'good';
          }
          break;
        }
        case 'sk3.dcPlacement': {
          if (lastToast) {
            const r = p['result'] as string;
            lastToast.label = `DC placement vs ${chip(p['vehicle'] as PieceId).label}`;
            lastToast.detail = `DRM ${(p['drm'] as number) >= 0 ? '+' : ''}${p['drm']} · ${p['final']}`;
            lastToast.results.push(r === 'armor' ? 'against the armor' : r === 'crew' ? 'on the CE crew only' : 'area attack, the AFV is spared');
          }
          break;
        }
        case 'sk3.vehicle.wrecked': {
          const v = p['vehicle'] as PieceId;
          unitText(v, 'KNOCKED OUT', 0xff3b30, true, 'hit.kia');
          face(v, 'wrecked');
          break;
        }
        case 'sk3.vehicle.status': {
          const v = p['vehicle'] as PieceId;
          const st = p['status'] as string;
          const label = st === 'immobilized' ? 'IMMOBILIZED' : st === 'shock' ? 'SHOCK' : st === 'stun' ? 'STUN' : st === 'STUN' ? 'STUN · RECALL' : st === 'bu' ? 'BUTTONS UP' : st === 'uk' ? 'UNCONFIRMED KILL' : 'RECOVERED';
          unitText(v, label, st === 'bu' || st === 'recovered' ? 0xffe066 : 0xff8a65, st !== 'bu', st === 'bu' || st === 'recovered' ? 'ui.flip' : 'hit.break');
          break;
        }
        case 'sk3.vehicle.check': {
          if (lastToast) {
            lastToast.label = `${p['kind']} for the crew of ${chip(p['vehicle'] as PieceId).label}`;
            lastToast.detail = `crew morale ${p['morale']}${p['mod'] ? ` · +${p['mod']}` : ''}`;
            lastToast.results.push(p['passed'] ? 'passes' : 'fails');
            lastToast.tone = p['passed'] ? 'good' : 'bad';
            lastToast.units = [chip(p['vehicle'] as PieceId)];
          }
          break;
        }
        case 'sk3.collateral': {
          if (lastToast) {
            const res = p['result'] as { kind: string; n?: number };
            lastToast.results.push(`collateral on the CE crew: ${p['column']} column +${p['drm']} → ${res.kind === 'none' ? 'no effect' : res.kind === 'MC' ? `${res.n}MC` : res.kind === 'K' ? `K/${res.n}` : res.kind === 'KIA' ? `${res.n ?? ''}KIA` : res.kind}`);
          }
          break;
        }
        case 'sk3.areaHit': {
          const eff = p['effect'] as string;
          if (lastToast) lastToast.results.push(`AFV ${p['location']} hit: ${eff === 'kill' ? 'DESTROYED' : eff === 'shock' ? 'SHOCK' : eff === 'immobilized' ? 'IMMOBILIZED' : 'no effect on the AFV'}`);
          break;
        }
        case 'sk3.vehicle.recuperation': {
          const v = p['vehicle'] as PieceId;
          const res = p['result'] as string;
          if (lastToast) {
            lastToast.results.push(res === 'recovered' ? 'recovers' : res === 'uk' ? 'Unconfirmed Kill' : 'burns out: a wreck');
            lastToast.tone = res === 'recovered' ? 'good' : 'bad';
            lastToast.units = [chip(v)];
          }
          if (res === 'recovered') unitText(v, 'RECOVERED', 0x9fe07a, false, 'ui.flip');
          else if (res === 'uk') unitText(v, 'UNCONFIRMED KILL', 0xff8a65, false, 'hit.break');
          break;
        }
        case 'sk3.vehicle.reliability': {
          const r = p['result'] as string;
          if (lastToast) {
            lastToast.results.push(r === 'ok' ? 'the engine runs' : r === 'stall' ? `stalls: ${p['wasted']} MP wasted` : 'breaks down: Immobilized');
            lastToast.tone = r === 'ok' ? 'good' : 'bad';
            lastToast.firers = [chip(p['vehicle'] as PieceId)];
          }
          if (r !== 'ok') unitText(p['vehicle'] as PieceId, r === 'stall' ? 'STALLED' : 'IMMOBILIZED', 0xff8a65, true, 'ui.deny');
          break;
        }
        case 'sk3.vehicle.bog': {
          const bogged = p['bogged'] as boolean;
          if (lastToast) {
            const labels = ((p['explain'] as { label?: string }[] | undefined) ?? []).map((x) => x.label).filter(Boolean).join(', ');
            lastToast.detail = `DRM ${(p['drm'] as number) >= 0 ? '+' : ''}${p['drm']}${labels ? ` (${labels})` : ''} · bogs on 12`;
            lastToast.results.push(bogged ? 'BOGGED' : 'passes');
            lastToast.tone = bogged ? 'bad' : 'good';
            lastToast.firers = [chip(p['vehicle'] as PieceId)];
          }
          if (bogged) unitText(p['vehicle'] as PieceId, 'BOGGED', 0xff8a65, true, 'ui.deny');
          break;
        }
        case 'sk3.vehicle.unbog': {
          const r = p['result'] as string;
          if (lastToast) {
            lastToast.results.push(r === 'freed' ? `freed (${p['mp']} MP)` : r === 'mired' ? 'MIRED' : 'IMMOBILIZED');
            lastToast.tone = r === 'freed' ? 'good' : 'bad';
            lastToast.firers = [chip(p['vehicle'] as PieceId)];
          }
          unitText(p['vehicle'] as PieceId, r === 'freed' ? 'FREED' : r === 'mired' ? 'MIRED' : 'IMMOBILIZED', r === 'freed' ? 0x9fe07a : 0xff8a65, r !== 'freed', r === 'freed' ? 'move.step' : 'ui.deny');
          break;
        }
        case 'sk3.vehicle.move': {
          const kind = p['kind'] as string;
          if (kind === 'motion') unitText(p['vehicle'] as PieceId, 'IN MOTION', 0xffe066, false, 'ui.flip');
          else if (kind === 'turn' || kind === 'turret') snd('ui.flip', 0);
          else if (kind === 'start' || kind === 'restart') snd('move.step', 0);
          break;
        }
        case 'sk2.smoke.placed':
          snd('move.smoke', 0);
          break;
        case 'sk3.vehicle.smoke': {
          const placed = p['placed'] as boolean;
          if (lastToast) {
            lastToast.detail = `${p['kind']}${p['n']}${(p['drm'] as number) ? ` · DRM +${p['drm']}` : ''}`;
            lastToast.results.push(placed ? 'Dispersed Smoke placed' : 'no smoke');
            lastToast.tone = placed ? 'good' : 'neutral';
            lastToast.units = [chip(p['vehicle'] as PieceId)];
          }
          if (placed) snd('ui.place', 0);
          break;
        }
        case 'sk3.vehicle.motionAttempt': {
          if (lastToast) {
            lastToast.detail = `needs ≤ ${p['mp']} (MP/MF spent in its LOS)`;
            lastToast.results.push(p['success'] ? 'IN MOTION' : 'fails');
            lastToast.tone = p['success'] ? 'good' : 'neutral';
            lastToast.units = [chip(p['vehicle'] as PieceId)];
          }
          if (p['success']) unitText(p['vehicle'] as PieceId, 'IN MOTION', 0xffe066, false, 'ui.flip');
          break;
        }
        case 'sk3.vehicle.ce':
          unitText(p['vehicle'] as PieceId, p['ce'] ? 'CE' : 'BU', 0xffe066, false, 'ui.flip');
          break;
        case 'sk2.hip.revealed': {
          const gun = p['gun'] as PieceId;
          unitText(gun, 'REVEALED', 0xffe066, true, 'ui.flip');
          break;
        }
        case 'sk2.hip.unitRevealed':
          unitText(p['unit'] as PieceId, 'REVEALED', 0xffe066, true, 'ui.flip');
          break;
        case 'game.ended':
          snd('game.end', 0);
          break;
      }
    }
    closeBeat(last);
    // Effects off, or the tab in the background: nothing plays, but the rolls still go to the dice log (players keep it
    // open to see them all).
    if (!enabled || away()) {
      const rolls = beats.flatMap((b) => (b.toast ? [b.toast] : []));
      if (rolls.length) setHistory((h) => [...h, ...rolls].slice(-DICE_LOG_LIMIT));
      faceHolds.current.clear();
      reveal(last);
      return;
    }
    // Play the beats one after another, queued behind anything still playing; the board follows.
    let time = Math.max(performance.now(), queueEnd.current);
    let revealedAt = time;
    for (const b of beats) {
      const start = time;
      // A beat with dice lasts until the next roll, and at least until its last text has shown.
      const lastDelay = Math.max(0, ...b.fx.map((f) => ('delay' in f ? f.delay : 0)), ...b.sounds.map((s) => s.delay));
      const length = b.toast ? Math.max(pace.beat, lastDelay + 600) : Math.min(pace.beat, Math.max(pace.quiet, lastDelay + 300));
      const resultsAt = start + (b.toast ? pace.reveal : 0);
      if (b.toast) unshown.current.push(b.toast);
      const show = () => {
        if (b.toast) {
          const toast = b.toast;
          unshown.current = unshown.current.filter((x) => x !== toast);
          setToasts((t) => [...t, toast].slice(-MAX_TOASTS));
          setHistory((h) => [...h, toast].slice(-DICE_LOG_LIMIT));
          timers.current.push(window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== toast.id)), pace.hold + 400));
        }
        if (b.fx.length) {
          setBoardFx((f) => [...f.slice(-40), ...b.fx]);
          for (const f of b.fx) {
            if (f.kind !== 'face') continue;
            const h = faceHolds.current.get(f.piece);
            if (h && h.n > 1) h.n--;
            else faceHolds.current.delete(f.piece);
          }
        }
        for (const s of b.sounds) playSfx(s.name, s.delay, s.params);
      };
      at(start, show);
      if (b.splitSeq !== undefined) {
        // The rolls of the old phase show their results; the new phase waits for the beat to end.
        at(resultsAt, () => reveal(b.splitSeq!));
        at(start + length, () => reveal(b.endSeq));
        revealedAt = start + length;
      } else {
        at(resultsAt, () => reveal(b.endSeq));
        revealedAt = resultsAt;
      }
      time = start + length;
    }
    // Whatever follows the last beat (or a batch with nothing to show) is revealed after it.
    at(revealedAt, () => reveal(last));
    queueEnd.current = Math.max(time, revealedAt);
    timers.current = timers.current.slice(-200);
  }, [log, env, state, enabled, level, seek]);

  const skip = () => {
    scheduled.current.forEach(clearTimeout);
    scheduled.current = [];
    if (unshown.current.length) setHistory((h) => [...h, ...unshown.current].slice(-DICE_LOG_LIMIT));
    unshown.current = [];
    faceHolds.current.clear();
    queueEnd.current = 0;
    presentRef.current.flush();
  };

  // Leaving the tab ends what was still playing: the board jumps to the outcome, as with Skip.
  const skipRef = useRef(skip);
  skipRef.current = skip;
  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden) return;
      skipRef.current();
      setToasts([]);
      setBoardFx([]);
      setWheel(null);
      setCallout(null);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const ping = (hex: HexId, color: number, at?: { x: number; y: number }) => {
    if (away()) return;
    setBoardFx((f) => [...f.slice(-40), { id: nextId.current++, kind: 'ping', hex, color, ...(at ? { at } : {}) }]);
    playSfx('ping');
  };

  return { wheel: enabled ? wheel : null, dismissWheel: () => setWheel(null), callout, toasts, history, boardFx, holdsFace, skip, ping };
}
