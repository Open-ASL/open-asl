import { describe, expect, it } from 'vitest';
import { deepEqual, type GameState, type LoggedEvent } from '@asl/engine';
import { FORTIFIED_MODULE, UNKNOWN_DEF_ID, VIEW_RNG, fortifiedModule, redactState, sk2CoreModules, type FortifiedState } from '../src';
import { GE_VS_BR, act, makeEngine } from './fixtures';

/**
 * `redactState` is what a viewer gets instead of the full state (online, and the computer opponent): no piece hidden
 * from them, each module's secret as its redactor shows it, no dice generator. `Engine.redactTransition` pairs it
 * with an event stream that folds into it exactly.
 */
describe('redactState', () => {
  it('leaves a HIP Gun and its crew out of the other side\'s and a spectator\'s view, and keeps the owner\'s view whole', () => {
    const { engine, state } = makeEngine({
      scenario: GE_VS_BR,
      extra: [...sk2CoreModules],
      terrain: { yM5: { terrain: 'woods' } },
      startPhase: 'PFPh',
      pieces: [
        { id: 'c1', def: 'br.228c', side: 'br', hex: 'yM5', tags: { hip: true } },
        { id: 'g40', def: 'br.AA40L', side: 'br', heldBy: 'c1', tags: { ca: 0, hip: true, emplaced: true } },
        { id: 'e1', def: 'ge.467', side: 'ge', hex: 'yK5' },
      ],
    });
    for (const viewer of ['ge', null]) {
      const view = redactState(engine, state, viewer);
      expect(Object.keys(view.pieces).sort()).toEqual(['e1']);
      expect(JSON.stringify(view)).not.toMatch(/"c1"|"g40"/);
      expect(view.rng).toEqual(VIEW_RNG);
      expect(view.seq).toBe(state.seq);
      // The view is a state the engine can still answer questions on.
      expect(() => engine.legalActions(view, 'ge')).not.toThrow();
    }
    const own = redactState(engine, state, 'br');
    expect(deepEqual({ ...own, rng: state.rng }, state)).toBe(true);
    // Nothing offers a stand-in yet (Concealment will): a hidden piece simply vanishes.
    expect(Object.values(own.pieces).some((p) => p.defId === UNKNOWN_DEF_ID)).toBe(false);
  });

  it('shows the other side only the fortified buildings already revealed, in the snapshot and in the designation event', () => {
    const terrain = {
      yP5: { terrain: 'building-stone', buildingId: 'b-P5' },
      yP6: { terrain: 'building-stone', buildingId: 'b-P5' },
      yP1: { terrain: 'building-stone', buildingId: 'b-P1' },
    };
    const scenario = {
      firstSide: 'am',
      forces: [{ side: 'ge', units: [], setup: { kind: 'area' as const, description: 'hexrow P', hexes: ['yP1', 'yP2', 'yP3', 'yP4', 'yP5', 'yP6'] } }],
      ssr: [{ module: FORTIFIED_MODULE, params: { side: 'ge', count: 2, within: 'setup' } }],
    };
    const { engine, state: s0 } = makeEngine({
      terrain,
      extra: [fortifiedModule],
      scenario,
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5' },
      ],
    });
    const t = act(engine, s0, { type: 'fortify.designate', buildings: ['b-P5'] });
    const full = t.state.ext['sk1.fortified'] as FortifiedState;
    expect(full.buildings).toEqual(['b-P5']);
    expect((redactState(engine, t.state, 'ge').ext['sk1.fortified'] as FortifiedState).buildings).toEqual(['b-P5']);
    for (const viewer of ['am', null]) {
      const view = redactState(engine, t.state, viewer);
      expect((view.ext['sk1.fortified'] as FortifiedState).buildings).toEqual([]);
      // (The building id itself is public: Control lists it. Only its fortification is the secret.)
      // The event stream: the designation event is rewritten for the American, and folds into the redacted snapshot.
      const redact = (s: GameState) => redactState(engine, s, viewer);
      const events = engine.redactTransition(viewer, redact, s0, t.events as LoggedEvent[]);
      expect(events.map((e) => e.type)).toEqual(t.events.map((e) => e.type));
      const designation = events.find((e) => e.type === 'sk1.fortified')!;
      expect((designation.payload as { state: FortifiedState }).state.buildings).toEqual([]);
      expect(deepEqual(engine.applyEvents(redact(s0), events), redact(t.state))).toBe(true);
    }
    // The owner's stream is the real one, minus nothing.
    const own = engine.redactTransition('ge', (s) => redactState(engine, s, 'ge'), s0, t.events as LoggedEvent[]);
    expect(own.map((e) => e.type)).toEqual(t.events.map((e) => e.type));
    expect((own.find((e) => e.type === 'sk1.fortified')!.payload as { state: FortifiedState }).state.buildings).toEqual(['b-P5']);
  });
});
