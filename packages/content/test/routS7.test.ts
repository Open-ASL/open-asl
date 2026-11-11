import { describe, expect, it } from 'vitest';
import { Engine, buildRuleset, type Action, type GameState, type RuleModule } from '@asl/engine';
import { piecesModule, sk1CoreModules, turnModule } from '@asl/rules';
import { staticsFor } from '../src';
import { SK_S7 } from '../src/scenarios/skFree';

/**
 * A Low Crawl refused with no reason given (S7, Turn 3 RtPh): the broken American
 * 6-6-6 in O5 could Low Crawl only to O4. Through P4 the broken German HS in R1 comes into its LOS and the building in
 * P3, the rout's nearest shelter, is closer to it: SK1 3.6 bars that step "even if it is broken". The engine was right;
 * the refusal now says so.
 */
const PIECES = [
  { id: 'a1', def: 'am.666', side: 'am', hex: 'zO5', tags: { broken: true, dm: true } },
  { id: 'g1', def: 'ge.548', side: 'ge', hex: 'zI4' },
  { id: 'g2', def: 'ge.L91', side: 'ge', hex: 'zI4' },
  { id: 'g3', def: 'ge.548', side: 'ge', hex: 'zM6' },
  { id: 'g4', def: 'ge.548', side: 'ge', hex: 'zP6', tags: { broken: true } },
  { id: 'g5', def: 'ge.468', side: 'ge', hex: 'zL5', tags: { broken: true } },
  { id: 'g6', def: 'ge.L80', side: 'ge', hex: 'zL5' },
  { id: 'g7', def: 'ge.468', side: 'ge', hex: 'zO6', tags: { broken: true } },
  { id: 'g8', def: 'ge.247h', side: 'ge', hex: 'zR1', tags: { broken: true } },
];
const harness: RuleModule = {
  id: 'test.s7rout',
  install(r) {
    r.setup({
      id: 'test.s7rout.place',
      run(ctx) {
        for (const p of PIECES) ctx.emit('piece.created', { piece: { id: p.id, defId: p.def, side: p.side, loc: { kind: 'hex', hex: p.hex }, tags: p.tags ?? {} } });
        ctx.emit('turn.phaseStarted', { phase: 'RtPh', turn: 3, attacker: ctx.state.attacker });
        if (ctx.state.decisions.length === 0) ctx.pushDecision({ kind: 'phase', owner: ctx.state.attacker, deadlineClass: 'turn', data: { phase: 'RtPh' } });
      },
    });
  },
};
const game = () => {
  const statics = staticsFor({ ...SK_S7, forces: [] });
  const engine = new Engine(buildRuleset('test', [piecesModule, turnModule, ...sk1CoreModules, harness]), statics);
  return { engine, state: engine.createGame({ scenarioId: SK_S7.id, sides: ['am', 'ge'], attacker: 'am', seed: 'rout' }).state };
};
const refusal = (engine: Engine, s: GameState, to: string, lowCrawl: boolean) => {
  const d = engine.currentDecision(s)!;
  return engine.validate(s, { type: 'rout.step', unit: 'a1', to, lowCrawl, side: d.owner, decisionId: d.id } as Action);
};

describe('S7 rout from O5', () => {
  it('Low Crawl to O4 is allowed; to P4 it is refused, and the refusal names the German in R1 and the way through O4', () => {
    const { engine, state } = game();
    expect(refusal(engine, state, 'zO4', true)).toBeNull();
    const why = refusal(engine, state, 'zP4', true);
    expect(why).toMatch(/^Low Crawl must head toward the nearest building or woods: from P4 the German 2-4-7 HS in R1 would be in its LOS, and P3 is closer to it \(SK1 3\.6/);
    expect(why).toMatch(/the way there is through O4$/);
    // The same reason for a normal rout step there.
    expect(refusal(engine, state, 'zP4', false)).toMatch(/from P4 the German 2-4-7 HS in R1/);
  });

  it('names a refused step toward a seen enemy by its hex, not its id', () => {
    const { engine, state } = game();
    expect(refusal(engine, state, 'zN5', true)).toMatch(/^Cannot rout toward the enemy in I4 \(SK1 3\.6/);
  });
});
