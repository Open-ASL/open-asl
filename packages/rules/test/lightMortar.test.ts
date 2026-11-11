import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { sk2CoreModules, type FireDeclaration } from '../src';
import { GE_VS_BR, act, makeEngine } from './fixtures';

/*
 * Light Mortars (SK4 4.5, 6.9): a ½" SW Mortar fires through the To Hit process on the Area Target
 * Type, with no Covered Arc, by any squad, HS or SMC; a lone SMC loses its ROF; no Intensive Fire.
 */

const ev = (events: { type: string; payload: unknown }[], type: string) => events.filter((e) => e.type === type).map((e) => e.payload as Record<string, unknown>);
const illegal = (engine: Engine, state: GameState, shot: Record<string, unknown>, mode = 'prep') =>
  engine.env(state).query('ordnance.illegal', { shot: shot as never, mode: mode as never, side: 'ge' }, null);

/** A German unit with the 50mm Mortar in yK5, British squads where given. */
function mortarGame(holder: string, squads: Record<string, string>, dice: number[] = [], terrain: Record<string, { terrain: string }> = {}, extra: { id: string; def: string; hex: string }[] = []) {
  return makeEngine({
    scenario: GE_VS_BR,
    extra: sk2CoreModules,
    terrain,
    dice,
    pieces: [
      { id: 'u', def: holder, side: 'ge', hex: 'yK5' },
      { id: 'm', def: 'ge.MTR', side: 'ge', heldBy: 'u' },
      ...extra.map((x) => ({ ...x, side: 'ge' })),
      ...Object.entries(squads).map(([id, hex]) => ({ id, def: 'br.457', side: 'br', hex })),
    ],
  });
}

describe('Light Mortars (SK4 4.5)', () => {
  it('To Hit Example #2: the 50mm Mortar fires on the ATT at range 2, Air Burst in woods; the squad keeps its own FP', () => {
    // TH 7 at range 2 (the counter's [2-13] allows it), no DRM; DR 2+4 = 6 hits, colored 4 > ROF 3.
    const { engine, state } = mortarGame('ge.467', { b1: 'yM5' }, [2, 4, 6, 6], { yM5: { terrain: 'woods' } });
    const t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'm', target: 'yM5', targetType: 'ATT' } });
    expect(ev(t.events, 'sk2.ordnance.shot')[0]).toMatchObject({ range: 2, th: 7, drm: 0, outcome: 'hit' });
    expect(ev(t.events, 'sk2.ordnance.rof')[0]).toMatchObject({ rof: 3, kept: false, why: 'exceeded' });
    const attack = ev(t.events, 'sk1.fire.attack')[0]!;
    expect(attack['drm']).toBe(-1);
    // Area Acquisition on the hex; the Mortar is marked, the squad has used a SW but keeps its own FP.
    expect(t.state.pieces['m']!.tags).toMatchObject({ acq: 'ATT', acqHex: 'yM5', fire: 'prep' });
    expect(t.state.pieces['u']!.tags['firedSw']).toBe(true);
    expect(t.state.pieces['u']!.tags['ownFpForfeit']).toBeUndefined();
    expect(t.state.pieces['u']!.tags['fire']).toBeUndefined();
  });

  it('a HS firing it forfeits its own FP; a lone SMC fires it without ROF, two SMC keep it', () => {
    let g = mortarGame('ge.247', { b1: 'yN5' }, [3, 3, 6, 6]);
    let t = act(g.engine, g.state, { type: 'fire.ordnance', shot: { weapon: 'm', target: 'yN5', targetType: 'ATT' } });
    expect(t.state.pieces['u']!.tags['ownFpForfeit']).toBe(true);

    g = mortarGame('ge.L81', { b1: 'yN5' }, [3, 1, 6, 6]);
    t = act(g.engine, g.state, { type: 'fire.ordnance', shot: { weapon: 'm', target: 'yN5', targetType: 'ATT' } });
    expect(ev(t.events, 'sk2.ordnance.rof')[0]).toMatchObject({ rof: 0, kept: false });

    g = mortarGame('ge.L81', { b1: 'yN5' }, [3, 1, 6, 6], {}, [{ id: 'l2', def: 'ge.L91', hex: 'yK5' }]);
    t = act(g.engine, g.state, { type: 'fire.ordnance', shot: { weapon: 'm', target: 'yN5', targetType: 'ATT' } });
    expect(ev(t.events, 'sk2.ordnance.rof')[0]).toMatchObject({ rof: 3, kept: true });
  });

  it('has no Covered Arc, uses the ATT within its counter range, never Intensive Fire, never a fire group', () => {
    const { engine, state } = mortarGame('ge.467', { b1: 'yL5', b2: 'yN5', b3: 'yK1' });
    // Any direction: no Covered Arc to turn.
    expect(illegal(engine, state, { weapon: 'm', target: 'yK1', targetType: 'ATT' })).toBeNull();
    expect(illegal(engine, state, { weapon: 'm', target: 'yN5', targetType: 'ATT', ca: 2 })).toMatch(/no Covered Arc/);
    expect(illegal(engine, state, { weapon: 'm', target: 'yN5', targetType: 'ITT' })).toMatch(/Area Target Type/);
    expect(illegal(engine, state, { weapon: 'm', target: 'yL5', targetType: 'ATT' })).toMatch(/minimum range/);
    expect(illegal(engine, state, { weapon: 'm', target: 'yN5', targetType: 'ATT', intensive: true })).toMatch(/SW cannot use Intensive Fire/);
    const decl: FireDeclaration = { units: ['u'], sw: ['m'], target: 'yN5' };
    expect(engine.env(state).query('fire.illegal', { decl, mode: 'prep', side: 'ge' }, null)).toMatch(/To Hit Table/);
    // The legal shots offered include it (the AI and the interrupt checks see Light Mortars too).
    expect(engine.legalActions(state, 'ge').some((a) => a.type === 'fire.ordnance' && (a as unknown as { shot: { weapon: string } }).shot.weapon === 'm')).toBe(true);
  });

  it('may not fire from a building, nor in the AFPh after its possessor moved', () => {
    const b = mortarGame('ge.467', { b1: 'yN5' }, [], { yK5: { terrain: 'building-stone' } });
    expect(illegal(b.engine, b.state, { weapon: 'm', target: 'yN5', targetType: 'ATT' })).toMatch(/from a building/);
    const m = makeEngine({
      scenario: GE_VS_BR,
      extra: sk2CoreModules,
      pieces: [
        { id: 'u', def: 'ge.467', side: 'ge', hex: 'yK5', tags: { moved: true } },
        { id: 'm', def: 'ge.MTR', side: 'ge', heldBy: 'u' },
        { id: 'b1', def: 'br.457', side: 'br', hex: 'yN5' },
      ],
    });
    expect(illegal(m.engine, m.state, { weapon: 'm', target: 'yN5', targetType: 'ATT' }, 'advancing')).toMatch(/moved cannot fire in the AFPh/);
  });
});
