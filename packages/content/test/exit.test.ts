import { describe, expect, it } from 'vitest';
import { Engine, buildRuleset, type Action, type GameState, type RuleModule } from '@asl/engine';
import { evaluateVictory, piecesModule, sk1CoreModules, turnModule } from '@asl/rules';
import { SK_S8, staticsFor } from '../src';

const act = (engine: Engine, state: GameState, action: Record<string, unknown>) => {
  const d = engine.currentDecision(state)!;
  return engine.submit(state, { side: d.owner, decisionId: d.id, ...action } as Action).state;
};

/**
 * Leaving the map with the ordinary move step (S8: a stack that sat on Q10 at the end lost the game, the per-unit Exit
 * on the wheel being easy to miss). The offboard hex beyond an exit hex is a legal step for
 * the whole moving stack, and entering it exits every unit, which here wins the game at once.
 */
describe('S8: a whole stack steps off Q10', () => {
  const s8Game = (pieces: { id: string; def: string; hex: string }[], phase = 'MPh') => {
    const statics = staticsFor({ ...SK_S8, forces: [] });
    const h: RuleModule = {
      id: 'test.s8exit',
      install(r) {
        r.setup({
          id: 'test.s8exit.place',
          run(ctx) {
            for (const p of pieces) ctx.emit('piece.created', { piece: { id: p.id, defId: p.def, side: 'am', loc: { kind: 'hex', hex: p.hex }, tags: {} } });
            ctx.emit('turn.phaseStarted', { phase, turn: 6, attacker: ctx.state.attacker });
            if (ctx.state.decisions.length === 0) ctx.pushDecision({ kind: 'phase', owner: ctx.state.attacker, deadlineClass: 'turn', data: { phase } });
          },
        });
      },
    };
    const engine = new Engine(buildRuleset('test', [piecesModule, turnModule, ...sk1CoreModules, h]), statics);
    return { engine, state: engine.createGame({ scenarioId: SK_S8.id, sides: ['ge', 'am'], attacker: 'am', seed: 'exit8' }).state };
  };
  const stack = [
    { id: 'l', def: 'am.L92', hex: 'yQ10' },
    { id: 'a', def: 'am.747', hex: 'yQ10' },
    { id: 'b', def: 'am.747', hex: 'yQ10' },
  ];
  it('offers the offboard hexes beyond Q10 as steps, and only there', () => {
    const { engine, state } = s8Game([...stack, { id: 'c', def: 'am.747', hex: 'yP10' }]);
    const s = act(engine, state, { type: 'move.start', units: ['l', 'a', 'b'] });
    const off = engine.legalActions(s, 'am').filter((x) => x.type === 'move.step' && !(engine.statics as { map: { hex(h: string): unknown } }).map.hex(x['to'] as string));
    expect(off.length).toBeGreaterThan(0);
    // P10 is not an exit hex: no step off the map from there.
    const t = act(engine, state, { type: 'move.start', units: ['c'] });
    expect(engine.legalActions(t, 'am').filter((x) => x.type === 'move.step' && !(engine.statics as { map: { hex(h: string): unknown } }).map.hex(x['to'] as string))).toEqual([]);
  });
  it('the step exits the whole stack; the Americans win at game end (the card does not say "immediately")', () => {
    const { engine, state } = s8Game(stack);
    const s = act(engine, state, { type: 'move.start', units: ['l', 'a', 'b'] });
    const off = engine.legalActions(s, 'am').find((x) => x.type === 'move.step' && !(engine.statics as { map: { hex(h: string): unknown } }).map.hex(x['to'] as string))!;
    const out = act(engine, s, { type: 'move.step', to: off['to'] });
    for (const id of ['l', 'a', 'b']) expect(out.pieces[id]!.loc).toEqual({ kind: 'offboard', edge: 'exited' });
    // Judged at game end, not as the phase ends: the Germans may yet exit HS and raise the count.
    const end = act(engine, out, { type: 'endPhase' });
    expect(end.result).toBeNull();
    expect(evaluateVictory(engine.env(end))).toBe('am');
  });
});

/**
 * Advancing off the map (S8: units in Q10 could not advance off it in the APh). ASLRB A2.6: units leave the mapboard
 * "using normal MPh/APh capabilities"; SK4 3.3 only asks that they be Good Order and exit as part of the VC.
 */
describe('S8: advancing off Q10 in the APh', () => {
  const stack = [
    { id: 'l', def: 'am.L92', hex: 'yQ10' },
    { id: 'a', def: 'am.747', hex: 'yQ10' },
    { id: 'b', def: 'am.747', hex: 'yQ10' },
  ];
  const statics = staticsFor({ ...SK_S8, forces: [] });
  const game = (pieces: { id: string; def: string; hex: string; tags?: Record<string, unknown> }[]) => {
    const h: RuleModule = {
      id: 'test.s8advance',
      install(r) {
        r.setup({
          id: 'test.s8advance.place',
          run(ctx) {
            for (const p of pieces) ctx.emit('piece.created', { piece: { id: p.id, defId: p.def, side: 'am', loc: { kind: 'hex', hex: p.hex }, tags: p.tags ?? {} } });
            ctx.emit('turn.phaseStarted', { phase: 'APh', turn: 6, attacker: ctx.state.attacker });
            if (ctx.state.decisions.length === 0) ctx.pushDecision({ kind: 'phase', owner: ctx.state.attacker, deadlineClass: 'turn', data: { phase: 'APh' } });
          },
        });
      },
    };
    const engine = new Engine(buildRuleset('test', [piecesModule, turnModule, ...sk1CoreModules, h]), statics);
    return { engine, state: engine.createGame({ scenarioId: SK_S8.id, sides: ['ge', 'am'], attacker: 'am', seed: 'adv8' }).state };
  };
  const offboard = (to: unknown) => !statics.map.hex(to as string) && !!statics.map.offboardHex(to as string);
  const advancesOff = (engine: Engine, s: GameState, unit: string) => engine.legalActions(s, 'am').filter((x) => x.type === 'advance' && offboard(x['to']) && (x['units'] as string[]).includes(unit));

  it('offers the advance off the map from Q10, and only from an exit hex', () => {
    const { engine, state } = game([...stack, { id: 'c', def: 'am.747', hex: 'yP10' }]);
    expect(advancesOff(engine, state, 'a').length).toBeGreaterThan(0);
    expect(advancesOff(engine, state, 'c')).toEqual([]);
    const beyond = advancesOff(engine, state, 'a')[0]!['to'] as string;
    const d = engine.currentDecision(state)!;
    expect(engine.validate(state, { type: 'advance', units: ['c'], to: beyond, side: 'am', decisionId: d.id } as Action)).toMatch(/Advance is one hex|exit from/);
  });

  it('a broken unit may not advance off; a Good Order stack that does is exited and wins at game end', () => {
    const { engine, state } = game([...stack, { id: 'x', def: 'am.747', hex: 'yQ10', tags: { broken: true } }]);
    expect(advancesOff(engine, state, 'x')).toEqual([]);
    const all = advancesOff(engine, state, 'a').find((x) => (x['units'] as string[]).length === 3)!;
    expect([...(all['units'] as string[])].sort()).toEqual(['a', 'b', 'l']);
    const out = act(engine, state, { type: 'advance', units: all['units'], to: all['to'] });
    for (const id of ['l', 'a', 'b']) expect(out.pieces[id]!.loc).toEqual({ kind: 'offboard', edge: 'exited' });
    const end = act(engine, out, { type: 'endPhase' });
    expect(end.result).toBeNull();
    expect(evaluateVictory(engine.env(end))).toBe('am');
  });
});
