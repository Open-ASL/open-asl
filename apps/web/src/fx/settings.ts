import { useCallback, useEffect, useState } from 'react';

/** How much motion the UI plays: full cinematics, quick versions, or none. */
export type FxLevel = 'full' | 'fast' | 'off';

const KEY = 'asl.fx';

function read(): FxLevel {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'full' || v === 'fast' || v === 'off') return v;
  } catch {
    /* private mode etc. */
  }
  return 'full';
}

export function useFxLevel(): [FxLevel, (l: FxLevel) => void] {
  const [level, setLevel] = useState<FxLevel>(read);
  useEffect(() => {
    document.body.classList.toggle('fx-off', level === 'off');
  }, [level]);
  const set = useCallback((l: FxLevel) => {
    setLevel(l);
    try {
      localStorage.setItem(KEY, l);
    } catch {
      /* ignore */
    }
  }, []);
  return [level, set];
}

/** Durations (ms) for the phase wheel at each level. */
/** `flip`: delay after the wheel has entered before the turn chit flips to the new side. */
export const WHEEL_TIMING: Record<FxLevel, { enter: number; hold: number; holdTurn: number; exit: number; flip: number }> = {
  full: { enter: 420, hold: 2000, holdTurn: 2800, exit: 450, flip: 500 },
  fast: { enter: 220, hold: 900, holdTurn: 1300, exit: 300, flip: 250 },
  off: { enter: 0, hold: 0, holdTurn: 0, exit: 0, flip: 0 },
};

const CALL_STRIP_KEY = 'asl.yourCallStrip';

/** Whether a decision waiting on this player (Defensive First Fire and the like) shows the "your call" strip over the board. On by default. */
export function useYourCallStrip(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState<boolean>(() => {
    try {
      return localStorage.getItem(CALL_STRIP_KEY) !== 'off';
    } catch {
      return true;
    }
  });
  const set = useCallback((v: boolean) => {
    setOn(v);
    try {
      localStorage.setItem(CALL_STRIP_KEY, v ? 'on' : 'off');
    } catch {
      /* ignore */
    }
  }, []);
  return [on, set];
}

const WEATHER_KEY = 'asl.weatherFx';

/** Whether the map shows the weather (falling snow, rain, fog) as a visual effect. On by default. */
export function useWeatherFx(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState<boolean>(() => {
    try {
      return localStorage.getItem(WEATHER_KEY) !== 'off';
    } catch {
      return true;
    }
  });
  const set = useCallback((v: boolean) => {
    setOn(v);
    try {
      localStorage.setItem(WEATHER_KEY, v ? 'on' : 'off');
    } catch {
      /* ignore */
    }
  }, []);
  return [on, set];
}
