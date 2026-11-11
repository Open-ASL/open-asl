import type { Ping, Session } from '../game/session';

export interface ComputerSeat {
  side: string;
  bot: string;
}

export type ComputerSpeed = 'slow' | 'normal' | 'fast';

export const BOT_VERSION = 'none';

/** This build has no computer opponent: nothing plays the computer's side. */
export function useComputerOpponent(_session: Session, _scenarioId: string, _balance: string[], _seat: ComputerSeat | null, _opts: { budgetMs?: number; speed?: ComputerSpeed; paused?: boolean; onMove?: (thinkMs: number) => void } = {}) {
  return { thinking: false, error: null as string | null, stalled: true, caption: null as string | null, pings: [] as Ping[] };
}
