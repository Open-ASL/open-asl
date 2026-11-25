import { useEffect, useRef, useState } from 'react';
import type { TurnMark } from '../match/replayTimeline';
import type { SsCheck, SsHeat } from '@asl/platform';
import type { SsMember } from './useSsRoom';
import type { ShotFirer } from './checks';

/** A commentator's tool on the map. */
export type SsTool = 'look' | 'ping' | 'draw' | 'los' | 'shot' | 'move';

/** What the controls show: sent by the board window to its controls, docked or popped out. */
export interface SsControlsState {
  title: string;
  sides: { side: string; name: string }[];
  /** Per side, whether its hidden information is shown. */
  show: Record<string, boolean>;
  /** Following the live game (or the end of a finished one). */
  following: boolean;
  /** The step shown, and the last one recorded. */
  step: number;
  last: number;
  /** The match is still being played. */
  live: boolean;
  marks: TurnMark[];
  /** Where the step shown stands ("Turn 2 · German Movement Phase"). */
  where: string;
  tool: SsTool;
  /** Index into SS_WIDTHS. */
  width: number;
  color: number;
  members: SsMember[];
  hideUnits: boolean;
  hideMarkers: boolean;
  /** The check the room is looking at, and for a shot the pieces in its firing hexes. */
  check: SsCheck | null;
  firers: ShotFirer[];
  /** The virtual board: the step it was made from and how many actions the game has gone on since; null when live. */
  virtual: { base: number; changes: number; behind: number } | null;
  /** The hex picked with the Move tool and its counters (a held weapon goes with its holder). */
  picked: { hex: string; pieces: { id: string; label: string; held: boolean }[] } | null;
  /** Counters picked up to be put down on the next hex clicked. */
  carrying: string[];
  /** Autoplay: whether the room is playing, who drives it, and the speed (an index into the replay bar's SPEEDS). */
  playing: boolean;
  driver: string | null;
  speed: number;
  /** The danger map shown (one side's at a time) and how far its working out has got (1: done). */
  heat: SsHeat | null;
  heatProgress: number;
  error: string | null;
}

/** What the controls ask of the board window. */
export type SsCommand =
  | { type: 'tool'; tool: SsTool }
  | { type: 'width'; width: number }
  | { type: 'show'; side: string; on: boolean }
  | { type: 'seek'; step: number }
  | { type: 'follow' }
  | { type: 'play' }
  | { type: 'speed'; speed: number }
  | { type: 'erase' }
  | { type: 'hideUnits'; on: boolean }
  | { type: 'hideMarkers'; on: boolean }
  | { type: 'shot'; mode?: string; areaFire?: boolean; moving?: 'none' | 'moving' | 'assault'; weapon?: string | null }
  | { type: 'shotExclude'; id: string; out: boolean }
  | { type: 'clearCheck' }
  | { type: 'snapBack' }
  | { type: 'remove'; ids: string[] }
  | { type: 'carry'; ids: string[] }
  | { type: 'heat'; side?: string | null; mode?: SsHeat['mode']; sw?: boolean; measure?: SsHeat['measure'] }

type Message = { kind: 'state'; state: SsControlsState } | { kind: 'command'; command: SsCommand } | { kind: 'hello' } | { kind: 'bye' };

const channelName = (matchId: string) => `asl-ss:${matchId}`;
/** The controls window says it is there this often; silence for three beats means it was closed. */
const BEAT_MS = 1500;

/**
 * The board window's end of the link to a popped-out controls window (same browser, same match): it sends the
 * controls' state whenever it changes and runs the commands that come back. `popped` is true while a controls window
 * is open, so the board stops showing its docked controls.
 */
export function useBoardBridge(matchId: string, state: SsControlsState, run: (c: SsCommand) => void): { popped: boolean } {
  const [popped, setPopped] = useState(false);
  const chan = useRef<BroadcastChannel | null>(null);
  const latest = useRef(state);
  latest.current = state;
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const c = new BroadcastChannel(channelName(matchId));
    chan.current = c;
    let heard = 0;
    c.onmessage = (e: MessageEvent<Message>) => {
      const m = e.data;
      if (m.kind === 'hello') {
        heard = Date.now();
        setPopped(true);
        c.postMessage({ kind: 'state', state: latest.current } satisfies Message);
      } else if (m.kind === 'bye') {
        heard = 0;
        setPopped(false);
      } else if (m.kind === 'command') runRef.current(m.command);
    };
    const watch = setInterval(() => {
      if (heard && Date.now() - heard > BEAT_MS * 3) {
        heard = 0;
        setPopped(false);
      }
    }, BEAT_MS);
    return () => {
      clearInterval(watch);
      c.close();
      chan.current = null;
    };
  }, [matchId]);
  useEffect(() => {
    if (popped) chan.current?.postMessage({ kind: 'state', state } satisfies Message);
  }, [state, popped]);
  return { popped };
}

/** The controls window's end: the board's latest state (null until it answers) and a way to send it commands. */
export function useControlsBridge(matchId: string): { state: SsControlsState | null; send(c: SsCommand): void } {
  const [state, setState] = useState<SsControlsState | null>(null);
  const chan = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const c = new BroadcastChannel(channelName(matchId));
    chan.current = c;
    let last = Date.now();
    c.onmessage = (e: MessageEvent<Message>) => {
      if (e.data.kind === 'state') {
        last = Date.now();
        setState(e.data.state);
      }
    };
    const hello = () => c.postMessage({ kind: 'hello' } satisfies Message);
    hello();
    const beat = setInterval(() => {
      hello();
      // The board window was closed or went elsewhere.
      if (Date.now() - last > BEAT_MS * 4) setState(null);
    }, BEAT_MS);
    const bye = () => c.postMessage({ kind: 'bye' } satisfies Message);
    window.addEventListener('pagehide', bye);
    return () => {
      clearInterval(beat);
      window.removeEventListener('pagehide', bye);
      bye();
      c.close();
      chan.current = null;
    };
  }, [matchId]);
  return { state, send: (command) => chan.current?.postMessage({ kind: 'command', command } satisfies Message) };
}
