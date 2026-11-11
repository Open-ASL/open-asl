import type { Ctx, Decision, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { statics } from '../common/pieces';
import { SETUP_DECISION, SETUP_PLACED, type SetupPlacedFn } from './scenario';

/*
 * An order of battle a die decides (S20 SSR 1: "After German setup, the American player openly
 * makes a die roll on Chart 1 to determine the number of units he receives and the victory points
 * required to win"). A general rule: the parameters name the side, the force the counters join,
 * the counters of the chart's columns and its rows. The counters do not exist until the roll: they
 * are created then with that force (offboard, to enter with it), so the order of battle shows "?"
 * until then. A row's VP, where the chart has them, is what the side's `eliminateCvp` condition asks for.
 */

export const FORCE_CHART_MODULE = 'force-chart';
const EXT = 'ssr.forceChart';

export interface ForceChartRow {
  dr: number;
  /** How many of each of `defs` the row gives, column by column. */
  counts: number[];
  /** Victory points the side then needs, where the chart has a VP column. */
  vp?: number;
}

export interface ForceChartParams {
  side: SideId;
  /** Id of the force the counters join (its setup or entry, its tray group). */
  force: string;
  /** The roll is made once this side has set up. */
  afterSetupOf: SideId;
  /** The chart's columns: the counter def each one counts out. */
  defs: string[];
  rows: ForceChartRow[];
  /** Added to every VP value (a balance provision: "Reduce all VP values on Chart 1 by 2"). */
  vpAdd?: number;
  /** The card's names for the rule and the chart, e.g. 'SSR 1' and 'Chart 1'. */
  rule?: string;
  chart?: string;
}

export interface ForceChartEvent {
  side: SideId;
  force: string;
  dr: number;
  /** Counter def → number received. */
  counts: Record<string, number>;
  vp: number | null;
  rule: string;
  chart: string;
  pieces: PieceId[];
}

export function forceChartParams(env: QueryEnv): ForceChartParams | null {
  const s = statics(env).scenario.ssr.find((r) => r.module === FORCE_CHART_MODULE);
  return s ? (s.params as unknown as ForceChartParams) : null;
}

/** The roll once made, or null before it. */
export const forceChartResult = (env: QueryEnv): ForceChartEvent | null => (env.state.ext[EXT] as ForceChartEvent | undefined) ?? null;

/** A row's VP with any balance adjustment. */
export const forceChartVp = (p: ForceChartParams, row: ForceChartRow): number | null => (row.vp === undefined ? null : row.vp + (p.vpAdd ?? 0));

function rollChart(ctx: Ctx, p: ForceChartParams) {
  const sc = statics(ctx).scenario;
  const fi = sc.forces.findIndex((f) => f.id === p.force);
  const force = sc.forces[fi];
  if (!force) throw new Error(`force-chart: unknown force ${p.force}`);
  const rule = p.rule ?? 'SSR';
  const chart = p.chart ?? 'chart';
  const dr = ctx.roll(`${rule}: ${chart} (units received and VP required)`, 1).dice[0]!;
  const row = p.rows.find((x) => x.dr === dr);
  const counts: Record<string, number> = {};
  p.defs.forEach((d, i) => (counts[d] = row?.counts[i] ?? 0));
  const made = p.defs.flatMap((defId) => Array.from({ length: counts[defId]! }, (_, i) => ({ id: `${p.side}.${fi}.c.${defId}.${i + 1}`, defId })));
  const ev: ForceChartEvent = { side: p.side, force: p.force, dr, counts, vp: row ? forceChartVp(p, row) : null, rule, chart, pieces: made.map((m) => m.id) };
  ctx.emit('ssr.forceChart', ev);
  for (const { id, defId } of made) {
    const tags: Record<string, string | number> = { force: fi };
    if (force.setup.kind === 'enter') {
      tags['entryTurn'] = force.setup.turn;
      tags['entryEdge'] = force.setup.edge;
      if (force.setup.hexes) tags['entryHexes'] = force.setup.hexes.join(',');
    }
    const loc = force.setup.kind === 'enter' ? ({ kind: 'offboard', edge: force.setup.edge } as const) : ({ kind: 'offboard', edge: 'setup' } as const);
    ctx.emit('piece.created', { piece: { id, defId, side: p.side, loc, tags } });
  }
}

export const forceChartModule: RuleModule = {
  id: 'ssr.force-chart',
  ref: 'SK3 S20 SSR 1',
  summary: 'An order of battle and VP goal a die roll on the card’s chart decides, made after a side’s setup (SSR).',
  requires: ['sk1.scenario'],
  install(r) {
    r.event<ForceChartEvent>({
      type: 'ssr.forceChart',
      apply(d, p) {
        d.ext[EXT] = p;
      },
    });
    r.procedure<SetupPlacedFn>(SETUP_PLACED, (next) => (ctx, action, decision: Decision) => {
      next?.(ctx, action, decision);
      const p = forceChartParams(ctx);
      if (!p || decision.kind !== SETUP_DECISION || decision.owner !== p.afterSetupOf || forceChartResult(ctx)) return;
      rollChart(ctx, p);
    });
    // The VP the side needs: the rolled row's (none can be reached before the roll).
    r.contribute({
      id: 'ssr.force-chart.vp',
      query: 'vc.cvp',
      layer: 10,
      label: 'chart VP (SSR)',
      apply(v, { vc }, env) {
        const p = forceChartParams(env);
        if (!p || vc.side !== p.side || !p.rows.some((x) => x.vp !== undefined)) return v;
        const res = forceChartResult(env);
        return res ? (res.vp ?? v) : Infinity;
      },
    });
  },
};
