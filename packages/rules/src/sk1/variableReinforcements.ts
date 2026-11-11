import type { Ctx, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { statics } from '../common/pieces';

/*
 * Reinforcements whose number a die decides (SK S5 SSR 1: "Prior to the U.S. Rally Phase in
 * each of the first two turns the U.S. player rolls a die and consults the following chart to
 * see how many 3-4-6 HS they receive that turn"). A general rule: the scenario's parameters
 * name the side, the counter, and for each turn the force the counters join and the chart. The
 * counters do not exist until the dr: they are created offboard then, due to enter with the
 * rest of the force that Player Turn, so the order of battle and the reinforcement list only
 * ever show what the card promises.
 */

export const VARIABLE_REINFORCEMENTS_MODULE = 'variable-reinforcements';
const EXT = 'ssr.variableReinforcements';

export interface VariableRoll {
  /** The Player Turn the dr is made for (the side's own turn). */
  turn: number;
  /** Id of the force the counters enter with (its edge, hexes and tray group). */
  force: string;
  /** The card's chart: inclusive dr ranges and the number received. */
  table: { dr: [number, number]; count: number }[];
}

export interface VariableReinforcementsParams {
  side: SideId;
  /** Counter def received, e.g. 'am.346h'. */
  def: string;
  /** The card's name for the rule, for the dice label and the log, e.g. 'SSR 1'. */
  rule?: string;
  rolls: VariableRoll[];
}

export interface VariableReinforcementsEvent {
  side: SideId;
  def: string;
  turn: number;
  force: string;
  dr: number;
  count: number;
  table: VariableRoll['table'];
  rule: string;
  pieces: PieceId[];
}

export function variableReinforcementsParams(env: QueryEnv): VariableReinforcementsParams | null {
  const s = statics(env).scenario.ssr.find((r) => r.module === VARIABLE_REINFORCEMENTS_MODULE);
  return s ? (s.params as unknown as VariableReinforcementsParams) : null;
}

/** Turns already rolled for. */
const rolledTurns = (env: QueryEnv): number[] => (env.state.ext[EXT] as { rolled: number[] } | undefined)?.rolled ?? [];

/** The chart in words: "dr 1–3: 4 · dr 4–6: 3". */
export const chartLabel = (table: VariableRoll['table']): string =>
  table.map((row) => `dr ${row.dr[0] === row.dr[1] ? row.dr[0] : `${row.dr[0]}–${row.dr[1]}`}: ${row.count}`).join(' · ');

/** The dr still to come: each roll not yet made, with the least and most it can bring. */
export function pendingVariableReinforcements(env: QueryEnv): (VariableRoll & { side: SideId; def: string; rule: string; edge?: string; min: number; max: number })[] {
  const p = variableReinforcementsParams(env);
  if (!p) return [];
  const rolled = rolledTurns(env);
  const sc = statics(env).scenario;
  return p.rolls
    .filter((r) => !rolled.includes(r.turn))
    .map((r) => {
      const force = sc.forces.find((f) => f.id === r.force);
      const counts = r.table.map((row) => row.count);
      return { ...r, side: p.side, def: p.def, rule: p.rule ?? 'SSR', edge: force?.setup.kind === 'enter' ? force.setup.edge : undefined, min: Math.min(...counts), max: Math.max(...counts) };
    });
}

export const variableReinforcementsModule: RuleModule = {
  id: 'ssr.variable-reinforcements',
  ref: 'SK S5 SSR 1',
  summary: 'Reinforcements whose number a dr decides (SSR): the counters are created offboard on the roll.',
  requires: ['sk1.scenario'],
  install(r) {
    r.event<VariableReinforcementsEvent>({
      type: 'ssr.variableReinforcements',
      apply(d, p) {
        const st = (d.ext[EXT] as { rolled: number[] } | undefined) ?? { rolled: [] };
        d.ext[EXT] = { rolled: [...st.rolled, p.turn] };
      },
    });
    r.contribute({
      id: 'ssr.variable-reinforcements.pending',
      query: 'side.reinforcementsPending',
      apply: (v, { side }, env) => v || pendingVariableReinforcements(env).some((x) => x.side === side && x.max > 0),
    });
    // "Prior to the Rally Phase": at the start of the side's Player Turn, before the RPh begins
    // and its offboard setup asks for the reinforcements due.
    r.on<{ turn: number; attacker: SideId }>({
      id: 'ssr.variable-reinforcements.roll',
      event: 'turn.playerTurn',
      handler(ctx: Ctx, ev) {
        const p = variableReinforcementsParams(ctx);
        if (!p || p.side !== ev.payload.attacker) return;
        const roll = p.rolls.find((x) => x.turn === ev.payload.turn);
        if (!roll || rolledTurns(ctx).includes(roll.turn)) return;
        const sc = statics(ctx).scenario;
        const fi = sc.forces.findIndex((f) => f.id === roll.force);
        const force = sc.forces[fi];
        if (!force || force.setup.kind !== 'enter') throw new Error(`variable-reinforcements: ${roll.force} is not an entering force`);
        const rule = p.rule ?? 'SSR';
        const dr = ctx.roll(`${rule}: reinforcements received this turn (${chartLabel(roll.table)})`, 1).dice[0]!;
        const row = roll.table.find((x) => dr >= x.dr[0] && dr <= x.dr[1]);
        const count = row?.count ?? 0;
        const ids = Array.from({ length: count }, (_, i) => `${p.side}.${fi}.v${roll.turn}.${p.def}.${i + 1}`);
        ctx.emit('ssr.variableReinforcements', { side: p.side, def: p.def, turn: roll.turn, force: roll.force, dr, count, table: roll.table, rule, pieces: ids });
        for (const id of ids) {
          const tags: Record<string, string | number> = { force: fi, entryTurn: roll.turn, entryEdge: force.setup.edge };
          if (force.setup.hexes) tags['entryHexes'] = force.setup.hexes.join(',');
          ctx.emit('piece.created', { piece: { id, defId: p.def, side: p.side, loc: { kind: 'offboard', edge: force.setup.edge }, tags } });
        }
      },
    });
  },
};
