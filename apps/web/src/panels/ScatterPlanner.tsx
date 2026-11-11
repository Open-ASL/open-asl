import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Action, Decision, HexId, PieceId, QueryEnv, SideId } from '@asl/engine';
import {
  SCATTER_PLAN_DECISION,
  SCATTER_ROLL_DECISION,
  defaultScatterPlan,
  scatterKind,
  scatterMembers,
  scatterParams,
  scatterPlanIllegal,
  scatterState,
  stackIllegal,
  statics,
  type ScatterPlan,
} from '@asl/rules';
import { counterImage } from '../game/assets';
import { hexLabel, pieceLabel } from '../game/describe';

/*
 * The scatter setup's two steps on screen (S22 SSR 1 and 3). The plan: every unit and SW of the side's
 * groups in stacks of at most one MMC, SMC and SW (counters of a pool force may go in either group),
 * and a rendezvous hex per group, clicked on the map. The later roll: one button. GameScreen asks the
 * hook for the board highlights, a hex click handler, the top-bar confirm button and the panel.
 */

interface Args {
  env: QueryEnv;
  decision: Decision | undefined;
  /** The side this screen gives orders for, if any. */
  owner: SideId | undefined;
  /** The seated side online (null for a shared hotseat screen or a spectator). */
  viewer: SideId | null;
  run(a: Omit<Action, 'decisionId' | 'side'>): void;
  setError(m: string | null): void;
  plain(m: string | null | undefined): string | null;
}

export interface ScatterUi {
  active: boolean;
  /** Hex → highlight role: a group's rendezvous hex, or every hex while one is being picked. */
  highlights: Map<HexId, 'pick' | 'chosen' | 'chosenSecret'>;
  onHexClick(hex: HexId): boolean;
  confirm: { label: string; icon: string; blocked: string | null; onClick(): void; hint?: string } | null;
  panel: ReactNode;
}

export function useScatterPlanner({ env, decision, owner, viewer, run, setError, plain }: Args): ScatterUi {
  const planning = owner && decision?.kind === SCATTER_PLAN_DECISION ? decision : null;
  const rolling = owner && decision?.kind === SCATTER_ROLL_DECISION ? decision : null;
  const params = scatterParams(env);
  const [plan, setPlan] = useState<ScatterPlan>({ groups: [], rendezvous: [] });
  const [picking, setPicking] = useState(0);
  const [moving, setMoving] = useState<PieceId | null>(null);
  useEffect(() => {
    if (!planning) return;
    // Start from a legal split (each MMC with a SW, the pool shared out) and no rendezvous hexes.
    setPlan({ groups: defaultScatterPlan(env).groups, rendezvous: [] });
    setPicking(0);
    setMoving(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planning?.id]);

  const members = useMemo(() => new Map(planning ? scatterMembers(env).map((m) => [m.piece, m.group]) : []), [planning, env]);
  const blocked = planning ? plain(scatterPlanIllegal(env, planning.owner, plan)) : null;

  /** Move the counter being moved into a stack (`stack` = -1: a new stack) of a group. */
  const moveTo = (gi: number, stack: number) => {
    if (!moving) return;
    const home = members.get(moving);
    if (home !== null && home !== undefined && home !== gi) {
      setError(`${pieceLabel(env, env.state.pieces[moving])} belongs to ${params!.groups[home]!.label}`);
      return;
    }
    const groups = plan.groups.map((g) => g.map((s) => s.filter((id) => id !== moving)));
    const target = stack < 0 ? [] : [...(groups[gi]![stack] ?? [])];
    target.push(moving);
    const why = stackIllegal(env, target);
    if (why) {
      setError(why);
      return;
    }
    if (stack < 0) groups[gi]!.push(target);
    else groups[gi]![stack] = target;
    setPlan({ ...plan, groups: groups.map((g) => g.filter((s) => s.length > 0)) });
    setMoving(null);
    setError(null);
  };

  const pickHex = (hex: HexId) => {
    const map = statics(env).map;
    const id = map.hex(hex)?.id;
    if (!id) {
      setError('Pick a hex on the map');
      return true;
    }
    const rendezvous = [...plan.rendezvous];
    if (rendezvous.some((h, i) => h === id && i !== picking)) {
      setError('Each group needs a different rendezvous hex');
      return true;
    }
    rendezvous[picking] = id;
    setPlan({ ...plan, rendezvous });
    const next = params!.groups.findIndex((_, i) => !rendezvous[i]);
    if (next >= 0) setPicking(next);
    setError(null);
    return true;
  };

  // The later groups' rendezvous hexes are the side's secret: shown on its own online screen, and on a
  // shared screen only while it is that side's step.
  const st = scatterState(env);
  const highlights = new Map<HexId, 'pick' | 'chosen' | 'chosenSecret'>();
  if (planning) {
    plan.rendezvous.forEach((h, i) => h && highlights.set(h, params!.groups[i]!.later ? 'chosenSecret' : 'chosen'));
  } else if (st && params) {
    const mine = viewer === st.side || (viewer === null && rolling);
    st.rendezvous.forEach((h, i) => {
      if (st.rolled.includes(i)) return;
      if (params.groups[i]!.later && !mine) return;
      highlights.set(h, params.groups[i]!.later ? 'chosenSecret' : 'chosen');
    });
  }

  const counter = (id: PieceId) => {
    const p = env.state.pieces[id]!;
    const img = counterImage(p.defId, false);
    return (
      <button
        key={id}
        className={`tray-counter ${moving === id ? 'picked' : ''}`}
        title={`${pieceLabel(env, p)} (${scatterKind(env, id).toUpperCase()}${members.get(id) === null ? ', may join either group' : ''}): click, then click a stack to move it there`}
        onClick={(e) => {
          e.stopPropagation();
          setMoving(moving === id ? null : id);
        }}
      >
        {img ? <img src={img} alt={pieceLabel(env, p)} draggable={false} /> : <span className="noimg">{pieceLabel(env, p)}</span>}
      </button>
    );
  };

  let panel: ReactNode = null;
  if (planning && params) {
    panel = (
      <div className="composer scatter">
        <p className="hint">{statics(env).scenario.ssr.find((r) => r.module === 'scatter-setup')?.text}</p>
        <p className="hint">
          Click a counter, then a stack (or <b>new stack</b>) to move it: at most {params.stack.mmc} MMC, {params.stack.smc} SMC and {params.stack.sw} SW to a stack. Then click the map for each group’s rendezvous hex and <b>Confirm plan</b> in the top bar. The dice then place {params.groups.filter((g) => !g.later).map((g) => g.label).join(' and ')}.
        </p>
        {params.groups.map((g, gi) => (
          <div key={g.label} className="scatter-group">
            <div className="scatter-head">
              <b>{g.label}</b>
              {' · rendezvous '}
              {plan.rendezvous[gi] ? <b>{hexLabel(plan.rendezvous[gi]!)}</b> : <span className="muted">not picked</span>}
              {g.later ? <span className="muted"> (secret; lands after the {statics(env).scenario.sides.find((s) => s.side !== params.side)?.name ?? 'other'} choices)</span> : null}{' '}
              <button className={`ghost small ${picking === gi ? 'on' : ''}`} onClick={() => setPicking(gi)} title="The next map click sets this group's rendezvous hex">
                {picking === gi ? 'click the map…' : 'pick on map'}
              </button>
            </div>
            <ol className="scatter-stacks">
              {(plan.groups[gi] ?? []).map((stack, si) => (
                <li key={si} className={moving ? 'drop' : ''} onClick={() => moveTo(gi, si)} title={moving ? 'Move the chosen counter into this stack' : undefined}>
                  {stack.map(counter)}
                </li>
              ))}
              <li className={`new ${moving ? 'drop' : ''}`} onClick={() => moveTo(gi, -1)}>
                {moving ? '+ new stack' : <span className="muted">new stack</span>}
              </li>
            </ol>
          </div>
        ))}
        {blocked && <div className="muted small">{blocked}</div>}
      </div>
    );
  } else if (rolling && params) {
    const g = params.groups[rolling.data?.['group'] as number]!;
    panel = (
      <div className="composer scatter">
        <p className="hint">{statics(env).scenario.ssr.filter((r) => r.module === 'scatter-setup').at(-1)?.text}</p>
        <p className="hint">
          Roll for each stack of <b>{g.label}</b> around its rendezvous hex: <b>Roll for {g.label}</b> in the top bar.
        </p>
      </div>
    );
  }

  const confirm = planning
    ? { label: 'Confirm plan', icon: '✔', blocked, onClick: () => run({ type: 'scatter.plan', groups: plan.groups, rendezvous: plan.rendezvous }), hint: 'Lock in the stacks and rendezvous hexes; the dice place the first group' }
    : rolling && params
      ? { label: `Roll for ${params.groups[rolling.data?.['group'] as number]!.label}`, icon: '🎲', blocked: null, onClick: () => run({ type: 'scatter.roll', group: rolling.data?.['group'] as number }) }
      : null;

  return {
    active: !!(planning || rolling),
    highlights,
    onHexClick: (hex) => (planning ? pickHex(hex) : false),
    confirm,
    panel,
  };
}
