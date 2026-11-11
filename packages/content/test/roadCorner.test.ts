import { describe, expect, it } from 'vitest';
import { Engine, buildRuleset, type Action, type GameState, type RuleModule } from '@asl/engine';
import { moveState, piecesModule, sk1CoreModules, turnModule } from '@asl/rules';
import { scenarioById, staticsFor } from '../src';

/*
 * The geomorphic boards' edge roads leave B5 through a corner and run on along the A5/A6 hexside to the edge;
 * the import kept only that hexside, so B5 was a dead end and a stack on the road lost the road bonus there
 * (S17: a British 4-5-7 in board x B5 at "MF 0/4 +1 road" could only go back; S9, a
 * half-squad and leader entering on the road lost the road bonus between A5 and B5).
 */
const S17 = scenarioById('sk-s17')!;
/** Board w whole, turned so that its hexrow A edge is the card's east edge, where the French enter. */
const LMA8 = scenarioById('lma-8')!;

type Placed = { id: string; defId: string; loc: Record<string, unknown> };
const moveAlong = (start: string, path: string[]) =>
  moveFrom(S17, 'br', [{ id: 'b1', defId: 'br.457', loc: { kind: 'hex', hex: start } }], path);

const moveFrom = (scenario: typeof S17, side: string, pieces: Placed[], path: string[]) => {
  const harness: RuleModule = {
    id: 'test.roadCorner',
    install(r) {
      r.setup({
        id: 'test.roadCorner.place',
        run(ctx) {
          for (const p of pieces) ctx.emit('piece.created', { piece: { ...p, side, tags: {} } });
          ctx.emit('turn.phaseStarted', { phase: 'MPh', turn: 1, attacker: ctx.state.attacker });
          if (ctx.state.decisions.length === 0) ctx.pushDecision({ kind: 'phase', owner: ctx.state.attacker, deadlineClass: 'turn', data: { phase: 'MPh' } });
        },
      });
    },
  };
  const engine = new Engine(buildRuleset('test', [piecesModule, turnModule, ...sk1CoreModules, harness]), staticsFor({ ...scenario, forces: [] }));
  const sides = scenario.sides.map((x) => x.side);
  let s: GameState = engine.createGame({ scenarioId: scenario.id, sides, attacker: side, seed: 'road' }).state;
  const act = (a: Record<string, unknown>) => {
    const d = engine.currentDecision(s)!;
    s = engine.submit(s, { side: d.owner, decisionId: d.id, ...a } as Action).state;
  };
  act({ type: 'move.start', units: pieces.map((p) => p.id) });
  for (const h of path) act({ type: 'move.step', to: h });
  return { engine, state: s };
};

describe('roads past a board-edge corner', () => {
  it('S17: a stack in x B5 with only the road bonus left follows the road on toward board w', () => {
    const { engine, state } = moveAlong('xE8', ['xD7', 'xD6', 'xC6', 'xB5']);
    const ms = moveState(engine.env(state))!;
    expect(ms.spent['b1']).toBe(ms.allowance['b1']);
    expect(ms.roadOnly).toBe(true);
    const steps = engine.legalActions(state, 'br').filter((a) => a.type === 'move.step').map((a) => a['to']).sort();
    expect(steps).toEqual(['xA5', 'xA6', 'xC6']);
  });

  it('LMA8: a stack entering on the road at board w A5 keeps the road bonus on into B5', () => {
    const off = { kind: 'offboard', edge: 'E', hex: 'w#-15' };
    const { engine, state } = moveFrom(LMA8, 'br', [{ id: 'h1', defId: 'am.337h', loc: off }, { id: 'l1', defId: 'am.L92', loc: off }], ['wA5', 'wB5']);
    const ms = moveState(engine.env(state))!;
    expect(ms.roadOnly).toBe(true);
    expect(ms.spent['h1']).toBe(2);
  });

  it('the road runs on across the board join, and a playing area cut short invents no road', () => {
    const map = staticsFor(S17, { los: 'grid' }).map;
    expect(['xA5', 'xA6'].every((a) => map.roadHexside!('xB5', a) && map.roadHexside!('wB5', a))).toBe(true);
    // S18 leaves out hexrow K: board z L3's road runs off the playing area there, not into L4 or M4.
    const s18 = staticsFor(scenarioById('sk-s18')!, { los: 'grid' }).map;
    expect(s18.neighbors('zL3').filter((n) => s18.roadHexside!('zL3', n))).toEqual(['zM3']);
  });
});
