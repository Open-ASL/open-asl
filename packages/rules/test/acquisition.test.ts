import { describe, expect, it } from 'vitest';
import type { Action, Ctx, Engine, GameState, RuleModule } from '@asl/engine';
import { acquisitionsAt, gunIdents, inCoveredArc, nearestSpine, sk2CoreModules, statics } from '../src';
import { GE_VS_BR, act, makeEngine } from './fixtures';

/** Test module: move a piece anywhere, as the engine's movement would. */
const teleport: RuleModule = {
  id: 'test.teleport',
  install(r) {
    r.action<Action & { id: string; hex: string }>({
      type: 'test.teleport',
      decisionKinds: ['phase'],
      resolve(ctx: Ctx, a) {
        ctx.emit('piece.moved', { id: a.id, loc: { kind: 'hex', hex: a.hex } });
      },
    });
    r.action<Action & { id: string; tags: Record<string, boolean | null> }>({
      type: 'test.tag',
      decisionKinds: ['phase'],
      resolve(ctx: Ctx, a) {
        ctx.emit('piece.tagged', { id: a.id, tags: a.tags });
      },
    });
    r.action<Action & { id: string }>({
      type: 'test.kill',
      decisionKinds: ['phase'],
      resolve(ctx: Ctx, a) {
        ctx.emit('piece.eliminated', { id: a.id, reason: 'test' });
      },
    });
  },
};
const extra = [...sk2CoreModules, teleport];
/** The spine a Gun in `gunHex` must point at to cover `target`. */
function spineFor(engine: Engine, state: GameState, gunHex: string, target: string): number {
  const map = statics(engine.env(state)).map;
  if (inCoveredArc(map.hex(gunHex)!.cube, 0, map.hex(target)!.cube)) return 0;
  return nearestSpine(map.hex(gunHex)!.cube, 0, map.hex(target)!.cube)!;
}

describe('Acquired Target counters (SK4 6.10, 6.11)', () => {
  it('sits on the target, follows it while the Gun has a LOS, stays in the last hex seen and passes to the next unit entering it', () => {
    const base = makeEngine({ pieces: [] });
    const ca = spineFor(base.engine, base.state, 'yK5', 'yO5');
    const { engine, state } = makeEngine({
      scenario: GE_VS_BR,
      extra,
      terrain: { yP4: { terrain: 'woods' }, yP5: { terrain: 'woods' } },
      dice: [6, 3],
      startPhase: 'PFPh',
      pieces: [
        { id: 'c1', def: 'ge.228c', side: 'ge', hex: 'yK5' },
        { id: 'g88', def: 'ge.AA88L', side: 'ge', heldBy: 'c1', tags: { ca } },
        { id: 'b1', def: 'br.457', side: 'br', hex: 'yO5' },
        { id: 'b2', def: 'br.457', side: 'br', hex: 'yO8' },
      ],
    });
    let t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'g88', target: 'yO5', targetType: 'ITT' } });
    expect(t.state.pieces['g88']!.tags).toMatchObject({ acq: 'ITT', acqHex: 'yO5', acqUnits: 'b1', acqLevel: 1 });
    expect(t.events.find((e) => e.type === 'sk2.acquired')!.payload).toMatchObject({ weapon: 'g88', hex: 'yO5', type: 'ITT', units: ['b1'], level: 1 });
    // The counter lies on the target hex, not on the Gun.
    expect(acquisitionsAt(engine.env(t.state), 'yO5').map((a) => [a.gun.id, a.level])).toEqual([['g88', 1]]);
    expect(acquisitionsAt(engine.env(t.state), 'yK5')).toEqual([]);
    // The target moves to O4, still in the Gun's LOS: the counter follows.
    t = act(engine, t.state, { type: 'test.teleport', id: 'b1', hex: 'yO4' });
    expect(t.state.pieces['g88']!.tags).toMatchObject({ acqHex: 'yO4', acqUnits: 'b1' });
    // Then behind the woods of P5, out of LOS: the counter stays in O4 and no longer follows b1.
    t = act(engine, t.state, { type: 'test.teleport', id: 'b1', hex: 'yQ5' });
    expect(t.state.pieces['g88']!.tags).toMatchObject({ acqHex: 'yO4', acqUnits: '' });
    t = act(engine, t.state, { type: 'test.teleport', id: 'b1', hex: 'yO6' });
    expect(t.state.pieces['g88']!.tags).toMatchObject({ acqHex: 'yO4', acqUnits: '' });
    // Another enemy unit entering O4 receives the acquisition and is followed in turn.
    t = act(engine, t.state, { type: 'test.teleport', id: 'b2', hex: 'yO4' });
    expect(t.state.pieces['g88']!.tags).toMatchObject({ acqHex: 'yO4', acqUnits: 'b2' });
    t = act(engine, t.state, { type: 'test.teleport', id: 'b2', hex: 'yN4' });
    expect(t.state.pieces['g88']!.tags).toMatchObject({ acqHex: 'yN4', acqUnits: 'b2' });
  });

  it('drops each acquired unit that is eliminated and goes with the last of them', () => {
    const base = makeEngine({ pieces: [] });
    const ca = spineFor(base.engine, base.state, 'yK5', 'yO5');
    const { engine, state } = makeEngine({
      scenario: GE_VS_BR,
      extra,
      dice: [6, 3],
      startPhase: 'PFPh',
      pieces: [
        { id: 'c1', def: 'ge.228c', side: 'ge', hex: 'yK5' },
        { id: 'g88', def: 'ge.AA88L', side: 'ge', heldBy: 'c1', tags: { ca } },
        { id: 'b1', def: 'br.457', side: 'br', hex: 'yO5' },
        { id: 'b2', def: 'br.457', side: 'br', hex: 'yO5' },
      ],
    });
    let t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'g88', target: 'yO5', targetType: 'ITT' } });
    expect(t.state.pieces['g88']!.tags).toMatchObject({ acqHex: 'yO5', acqUnits: 'b1,b2' });
    t = act(engine, t.state, { type: 'test.kill', id: 'b1' });
    expect(t.state.pieces['g88']!.tags).toMatchObject({ acqHex: 'yO5', acqUnits: 'b2' });
    // The counter sits on its target (SK4 6.10): nothing is left to hold it, and no later arrival inherits it.
    t = act(engine, t.state, { type: 'test.kill', id: 'b2' });
    expect(t.state.pieces['g88']!.tags['acq']).toBeUndefined();
    expect(acquisitionsAt(engine.env(t.state), 'yO5')).toEqual([]);
  });

  it('is lost when the manning unit fires its inherent FP, breaks or leaves the Gun', () => {
    const base = makeEngine({ pieces: [] });
    const ca = spineFor(base.engine, base.state, 'yK5', 'yO5');
    const mk = () =>
      makeEngine({
        scenario: GE_VS_BR,
        extra,
        dice: [6, 3, 3, 3, 3, 3],
        startPhase: 'PFPh',
        // A squad mans the Gun (Non-Qualified Use): unlike a crew it may still fire its own FP elsewhere.
        pieces: [
          { id: 'q1', def: 'ge.467', side: 'ge', hex: 'yK5' },
          { id: 'g88', def: 'ge.AA88L', side: 'ge', heldBy: 'q1', tags: { ca } },
          { id: 'b1', def: 'br.457', side: 'br', hex: 'yO5' },
          { id: 'b3', def: 'br.457', side: 'br', hex: 'yL5' },
        ],
      });
    const a = mk();
    let t = act(a.engine, a.state, { type: 'fire.ordnance', shot: { weapon: 'g88', target: 'yO5', targetType: 'ITT' } });
    expect(t.state.pieces['g88']!.tags['acqHex']).toBe('yO5');
    t = act(a.engine, t.state, { type: 'fire', decl: { units: ['q1'], sw: [], target: 'yL5' } });
    expect(t.state.pieces['g88']!.tags['acqHex']).toBeUndefined();
    const b = mk();
    t = act(b.engine, b.state, { type: 'fire.ordnance', shot: { weapon: 'g88', target: 'yO5', targetType: 'ITT' } });
    t = act(b.engine, t.state, { type: 'test.tag', id: 'q1', tags: { broken: true } });
    expect(t.state.pieces['g88']!.tags['acqHex']).toBeUndefined();
    const c = mk();
    t = act(c.engine, c.state, { type: 'fire.ordnance', shot: { weapon: 'g88', target: 'yO5', targetType: 'ITT' } });
    t = act(c.engine, t.state, { type: 'test.teleport', id: 'q1', hex: 'yK4' });
    expect(t.state.pieces['g88']!.tags['acqHex']).toBeUndefined();
  });

  it('tells a side\'s Guns apart by letter, in id order, each side from A', () => {
    const { engine, state } = makeEngine({
      scenario: GE_VS_BR,
      extra,
      pieces: [
        { id: 'c1', def: 'ge.228c', side: 'ge', hex: 'yK5' },
        { id: 'g2', def: 'ge.AA88L', side: 'ge', heldBy: 'c1', tags: { ca: 0 } },
        { id: 'c2', def: 'ge.228c', side: 'ge', hex: 'yK6' },
        { id: 'g1', def: 'ge.AT75L', side: 'ge', heldBy: 'c2', tags: { ca: 0 } },
        { id: 'bc', def: 'br.228c', side: 'br', hex: 'yO5' },
        { id: 'g40', def: 'br.AA40L', side: 'br', heldBy: 'bc', tags: { ca: 3 } },
      ],
    });
    const idents = gunIdents(state, engine.env(state));
    expect([idents.get('g1'), idents.get('g2'), idents.get('g40')]).toEqual(['A', 'B', 'A']);
  });
});
