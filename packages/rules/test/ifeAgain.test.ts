import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { inCoveredArc, nearestSpine, sk2CoreModules, statics } from '../src';
import { GE_VS_BR, act, makeEngine } from './fixtures';

/*
 * IFE fires again like a MG (SK4 6.8): "Like a MG, an IFE Gun/MA may use Subsequent First Fire and Final Protective Fire
 * in the MPh, and if marked with a First Fire counter in DFPh may fire at an adjacent unit, all at half fire and with its
 * B# lowered by 2". It is not Intensive Fire: "When using IFE, a weapon ... is subject to Sustained Fire—not Intensive
 * Fire—penalties as per A9.3" (ASLRB C2.29).
 *
 * A British crew in yR5 mans a 40L AA Gun (IFE 8, ROF 3, B# 12). A German squad moves yN5 → yO5 (woods) → yP5 → yQ5.
 */

const shotsOf = (engine: Engine, s: GameState) =>
  (engine.legalActions(s, 'br').filter((a) => a.type === 'defFire.ordnance') as unknown as { shot: { targetType: string; target: string; intensive?: boolean } }[]).map((a) => a.shot);
const pass = (engine: Engine, s: GameState) => {
  while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
  return s;
};
const toPhase = (engine: Engine, s: GameState, phase: string, attacker: string) => {
  for (let i = 0; i < 60 && !(s.phase === phase && s.attacker === attacker); i++) {
    const d = engine.currentDecision(s)!;
    s = act(engine, s, { type: d.kind === 'firstFire' ? 'defPass' : 'endPhase', side: d.owner }).state;
  }
  return s;
};
const attackOf = (events: { type: string; payload: unknown }[]) => events.find((e) => e.type === 'sk1.fire.attack')!.payload as { fp: number };

/** The squad steps into the woods in yO5, where the Gun First Fires its IFE (4+6: no effect, the colored 4 loses ROF 2). */
function firstFired(dice: number[]) {
  const pieces = (ca: number) => [
    { id: 'c1', def: 'br.228c', side: 'br', hex: 'yR5' },
    { id: 'g40', def: 'br.AA40L', side: 'br', heldBy: 'c1', tags: { ca } },
    { id: 'e1', def: 'ge.467', side: 'ge', hex: 'yN5' },
  ];
  const probe = makeEngine({ scenario: GE_VS_BR, extra: sk2CoreModules, startPhase: 'MPh', pieces: pieces(0) });
  const map = statics(probe.engine.env(probe.state)).map;
  const [r5, o5] = [map.hex('yR5')!.cube, map.hex('yO5')!.cube];
  const ca = inCoveredArc(r5, 0, o5) ? 0 : nearestSpine(r5, 0, o5)!;
  const terrain = { yO5: { terrain: 'woods' } };
  const { engine, state } = makeEngine({ scenario: GE_VS_BR, extra: sk2CoreModules, startPhase: 'MPh', terrain, dice: [4, 6, ...dice], pieces: pieces(ca) });
  let s = act(engine, state, { type: 'move.start', units: ['e1'] }).state;
  s = act(engine, s, { type: 'move.step', to: 'yO5' }).state;
  s = act(engine, s, { type: 'defFire.ordnance', shot: { weapon: 'g40', target: 'yO5', targetType: 'IFE' } }).state;
  expect(s.pieces['g40']!.tags['fire']).toBe('first');
  return { engine, s: pass(engine, s) };
}

describe('IFE after First Fire (SK4 6.8; ASLRB C2.29)', () => {
  it('is offered as Subsequent First Fire at half FP, then as FPF, never as Intensive Fire', () => {
    // SFF at yP5: 5+4 -2 on the 4 column, no effect, no malfunction (9 < B# 10).
    const r = firstFired([5, 4]);
    const engine = r.engine;
    let s = act(engine, r.s, { type: 'move.step', to: 'yP5' }).state;
    expect(engine.currentDecision(s)?.kind).toBe('firstFire');
    expect(shotsOf(engine, s)).toContainEqual(expect.objectContaining({ targetType: 'IFE' }));
    expect(shotsOf(engine, s).some((x) => x.targetType === 'IFE' && x.intensive)).toBe(false);
    const t = act(engine, s, { type: 'defFire.ordnance', shot: { weapon: 'g40', target: 'yP5', targetType: 'IFE' } });
    expect(attackOf(t.events).fp).toBe(4);
    expect(t.state.pieces['g40']!.tags['fire']).toBe('final');
    expect(t.state.pieces['g40']!.tags['intensive']).toBeUndefined();
    expect(t.state.pieces['g40']!.tags['malf']).toBeUndefined();
    // Marked Final Fire, it may still fire FPF at the adjacent hex.
    s = act(engine, pass(engine, t.state), { type: 'move.step', to: 'yQ5' }).state;
    expect(engine.currentDecision(s)?.kind).toBe('firstFire');
    expect(engine.validate(s, { type: 'defFire.ordnance', side: 'br', decisionId: engine.currentDecision(s)!.id, shot: { weapon: 'g40', target: 'yQ5', targetType: 'IFE' } } as never)).toBeNull();
    expect(shotsOf(engine, s)).toContainEqual(expect.objectContaining({ targetType: 'IFE', target: 'yQ5' }));
  });

  it('malfunctions in Subsequent First Fire on an original DR of 10: its B# lowered by 2', () => {
    const r = firstFired([4, 6]);
    const s = act(r.engine, r.s, { type: 'move.step', to: 'yP5' }).state;
    const t = act(r.engine, s, { type: 'defFire.ordnance', shot: { weapon: 'g40', target: 'yP5', targetType: 'IFE' } });
    expect(t.state.pieces['g40']!.tags['malf']).toBe(true);
  });

  it('fires at an adjacent unit in the DFPh at half FP (doubled for PBF), and fires normally in its own Player Turn', () => {
    const r = firstFired([5, 4, 6, 6, 6, 6, 6, 6]);
    const engine = r.engine;
    let s = pass(engine, act(engine, r.s, { type: 'move.step', to: 'yP5' }).state);
    s = pass(engine, act(engine, s, { type: 'move.step', to: 'yQ5' }).state);
    s = pass(engine, act(engine, s, { type: 'move.end' }).state);
    s = toPhase(engine, s, 'DFPh', 'ge');
    const shot = { weapon: 'g40', target: 'yQ5', targetType: 'IFE' as const };
    expect(engine.legalActions(s, 'br').some((a) => a.type === 'fire.ordnance' && (a as unknown as { shot: { targetType: string } }).shot.targetType === 'IFE')).toBe(true);
    const t = act(engine, s, { type: 'fire.ordnance', shot });
    // The 8 FP IFE halved for the First Fire marker, doubled for PBF.
    expect(attackOf(t.events).fp).toBe(8);
    expect(t.state.pieces['g40']!.tags['fire']).toBe('final');
    // The British Player Turn: the markers are gone and the Gun Prep Fires its IFE at full strength.
    s = toPhase(engine, t.state, 'PFPh', 'br');
    expect(s.pieces['g40']!.tags['fire']).toBeUndefined();
    expect(s.pieces['g40']!.tags['intensive']).toBeUndefined();
    expect(engine.validate(s, { type: 'fire.ordnance', side: 'br', decisionId: engine.currentDecision(s)!.id, shot } as never)).toBeNull();
  });
});
