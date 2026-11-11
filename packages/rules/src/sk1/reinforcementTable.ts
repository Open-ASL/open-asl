import type { Ctx, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { statics } from '../common/pieces';

/*
 * Reinforcements whose composition a die decides (S36 SSR 2: "At the start of the German Turn 2 Rally Phase, the German
 * player makes a dr on his Reinforcement Table to determine the composition of his reinforcements."): each row of the
 * card's table gives the counters received. As with variable reinforcements, the counters do not exist until the dr:
 * they are created offboard with the force then, due to enter with it.
 */

export const REINFORCEMENT_TABLE_MODULE = 'reinforcement-table';
const EXT = 'ssr.reinforcementTable';

export interface ReinforcementTableRow {
  /** Inclusive dr range. */
  dr: [number, number];
  units: { def: string; count: number }[];
}

export interface ReinforcementTableParams {
  side: SideId;
  /** The side's Player Turn the dr is made at the start of. */
  turn: number;
  /** Id of the force the counters join (its entry turn and edge). */
  force: string;
  rows: ReinforcementTableRow[];
  /** The card's names for the rule and the table. */
  rule?: string;
  table?: string;
}

export interface ReinforcementTableEvent {
  side: SideId;
  turn: number;
  force: string;
  dr: number;
  units: { def: string; count: number }[];
  rule: string;
  pieces: PieceId[];
}

export function reinforcementTableParams(env: QueryEnv): ReinforcementTableParams | null {
  const s = statics(env).scenario.ssr.find((r) => r.module === REINFORCEMENT_TABLE_MODULE);
  return s ? (s.params as unknown as ReinforcementTableParams) : null;
}

/** Whether the table has been rolled. */
export const reinforcementTableRolled = (env: QueryEnv) => env.state.ext[EXT] === true;

export const reinforcementTableModule: RuleModule = {
  id: 'ssr.reinforcement-table',
  ref: 'S36 SSR 2',
  summary: 'Reinforcements whose composition a dr on the card’s table decides (SSR): the counters are created offboard on the roll.',
  requires: ['sk1.scenario'],
  install(r) {
    r.event<ReinforcementTableEvent>({
      type: 'ssr.reinforcementTable',
      apply(d) {
        d.ext[EXT] = true;
      },
    });
    r.contribute({
      id: 'ssr.reinforcement-table.pending',
      query: 'side.reinforcementsPending',
      apply(v, { side }, env) {
        const p = reinforcementTableParams(env);
        return v || (!!p && p.side === side && !reinforcementTableRolled(env) && p.rows.some((row) => row.units.some((u) => u.count > 0)));
      },
    });
    // "At the start of the Rally Phase": as the side's Player Turn begins, before its offboard setup asks for the reinforcements due.
    r.on<{ turn: number; attacker: SideId }>({
      id: 'ssr.reinforcement-table.roll',
      event: 'turn.playerTurn',
      handler(ctx: Ctx, ev) {
        const p = reinforcementTableParams(ctx);
        if (!p || p.side !== ev.payload.attacker || p.turn !== ev.payload.turn || reinforcementTableRolled(ctx)) return;
        const sc = statics(ctx).scenario;
        const fi = sc.forces.findIndex((f) => f.id === p.force);
        const force = sc.forces[fi];
        if (!force || force.setup.kind !== 'enter') throw new Error(`reinforcement-table: ${p.force} is not an entering force`);
        const rule = p.rule ?? 'SSR';
        const dr = ctx.roll(`${rule}: ${p.table ?? 'Reinforcement Table'}`, 1).dice[0]!;
        const row = p.rows.find((x) => dr >= x.dr[0] && dr <= x.dr[1]);
        const units = row?.units ?? [];
        const pieces = units.flatMap((u) => Array.from({ length: u.count }, (_, i) => ({ id: `${p.side}.${fi}.t${p.turn}.${u.def}.${i + 1}`, def: u.def })));
        ctx.emit('ssr.reinforcementTable', { side: p.side, turn: p.turn, force: p.force, dr, units, rule, pieces: pieces.map((x) => x.id) });
        for (const x of pieces) {
          const tags: Record<string, string | number> = { force: fi, entryTurn: force.setup.turn, entryEdge: force.setup.edge };
          if (force.setup.hexes) tags['entryHexes'] = force.setup.hexes.join(',');
          if (force.setup.mpSpent) tags['entryMfSpent'] = force.setup.mpSpent;
          ctx.emit('piece.created', { piece: { id: x.id, defId: x.def, side: p.side, loc: { kind: 'offboard', edge: force.setup.edge }, tags } });
        }
      },
    });
  },
};
