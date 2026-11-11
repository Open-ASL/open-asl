import { useEffect, useState, type ReactNode } from 'react';
import type { Action, Decision, QueryEnv, SideId } from '@asl/engine';
import { SECRET_LENGTH_DECISION, secretLengthParams, statics } from '@asl/rules';

/*
 * The secret game length on screen (S36 SSR 1): before setup, how long the game will be, which sets the boards in play
 * and what leaves the order of battle. Nobody else sees the choice until it is revealed after the other side's setup.
 */

interface Args {
  env: QueryEnv;
  decision: Decision | undefined;
  owner: SideId | undefined;
  run(a: Omit<Action, 'decisionId' | 'side'>): void;
}

export interface GameLengthUi {
  panel: ReactNode;
  confirm: { label: string; icon: string; blocked: string | null; onClick(): void; hint?: string } | null;
}

export function useGameLengthPicker({ env, decision, owner, run }: Args): GameLengthUi {
  const choosing = owner && decision?.kind === SECRET_LENGTH_DECISION ? decision : null;
  const p = secretLengthParams(env);
  const [option, setOption] = useState<number | null>(null);
  useEffect(() => setOption(null), [choosing?.id]);
  if (!choosing || !p) return { panel: null, confirm: null };
  const counters = statics(env).counters;
  const name = (def: string) => {
    const d = counters[def];
    if (!d) return def;
    if (d.kind === 'vehicle') return d.name;
    if (d.kind === 'leader') return `${d.morale}-${d.leadership > 0 ? '+' : ''}${d.leadership}`.replace('-+', '+');
    if (d.kind === 'sw') return d.type;
    return 'fp' in d ? `${d.fp}-${d.range}-${d.morale}` : def;
  };
  const panel = (
    <div className="composer entry-groups">
      <p className="hint">{statics(env).scenario.ssr.find((r) => r.module === 'secret-length')?.text?.split('\n')[0]}</p>
      <ul className="entry-groups-list">
        {p.options.map((o, i) => (
          <li key={o.label} className={option === i ? 'on' : ''}>
            <button className={`ghost small ${option === i ? 'on' : ''}`} onClick={() => setOption(i)}>
              {o.label} turns
            </button>
            <span className="muted small">
              {' '}Boards: {o.boards} · Remove: {o.remove?.length ? o.remove.map((r) => `${r.count > 1 ? `${r.count} × ` : ''}${name(r.def)}`).join(', ') : 'nothing'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
  return {
    panel,
    confirm: {
      label: 'Record game length',
      icon: '✔',
      blocked: option === null ? 'Choose the game length' : null,
      onClick: () => option !== null && run({ type: 'length.choose', option }),
      hint: 'Lock in the game length (secret until the German setup is done)',
    },
  };
}
