import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { moveState, statics } from '@asl/rules';
import { sk2CoreModules } from '../../../packages/rules/src/sk2';
import { sk3CoreModules } from '../../../packages/rules/src/sk3';
import { RU_VS_GE, act, makeEngine } from '../../../packages/rules/test/fixtures';
import { moverHex, turnSpineToward } from '../src/game/vehicleTurn';

/*
 * A vehicle waiting offboard may move during the MPh "per normal Open Ground movement costs" before it enters (SK4 3.3;
 * ASLRB A2.51), and a VCA change is movement: 1 MP per hexspine in Open Ground (SK4 3.3.2, ASLRB D2.11). The hull and
 * turret shortcuts (Q/E, A/D, a click on a neighbouring hex outside the VCA) are worked from the hex the mover stands
 * in, which for an entering vehicle is its offboard hex. Board y: the S edge is hexrow 10.
 */
describe('turning a moving vehicle, on the map or waiting offboard', () => {
  const setUp = () => {
    const { engine, state } = makeEngine({ pieces: [{ id: 'p4', def: 'ge.pzivf2', side: 'ge', hex: 'yM9', tags: { vca: 0, ca: 0 } }, { id: 'ru1', def: 'ru.447', side: 'ru', hex: 'yA1' }], scenario: { ...RU_VS_GE, firstSide: 'ge' } as never, extra: [...sk2CoreModules, ...sk3CoreModules], startPhase: 'MPh' }) as {
      engine: Engine;
      state: GameState;
    };
    const map = statics(engine.env(state)).map;
    // The offboard hex south of M10, where an entering vehicle waits in Motion (SK4 3.3.2: "All vehicles that start offboard start in Motion").
    const off = map.offboard('S').find((o) => map.offboardNeighbors(o.id).onboard.includes('yM10'))!;
    const p4 = state.pieces['p4']!;
    const waiting: GameState = { ...state, pieces: { ...state.pieces, p4: { ...p4, loc: { kind: 'offboard', edge: 'S', hex: off.id }, tags: { ...p4.tags, vca: 3, ca: 3, motion: true, entryTurn: 1, entryEdge: 'S' } } } };
    return { engine, map, off: off.id, waiting };
  };

  it('works from the offboard hex of a vehicle about to enter: the engine lets it turn there, and so do the shortcuts', () => {
    const { engine, map, off, waiting } = setUp();
    const moving = act(engine, waiting, { type: 'vmove.start', vehicle: 'p4' }).state;
    const ms = moveState(engine.env(moving))!;
    expect(ms.hex ?? null).toBeNull();
    expect(moverHex(ms)).toBe(off);
    // VCA 3 points away from the map; M10, beside the offboard hex, is outside it: a click there turns the hull toward it.
    expect(map.offboardNeighbors(off).onboard).toContain('yM10');
    const spine = turnSpineToward(map, off, 'yM10', 3);
    expect(spine).not.toBeNull();
    expect(spine).not.toBe(3);
    const turned = act(engine, moving, { type: 'vmove.turn', vca: spine! }).state;
    expect(turned.pieces['p4']!.tags['vca']).toBe(spine);
    expect(turned.pieces['p4']!.loc).toMatchObject({ kind: 'offboard', hex: off });
    // Then the entry step into M10 is in its VCA.
    const entered = act(engine, turned, { type: 'move.step', to: 'yM10' }).state;
    expect(entered.pieces['p4']!.loc).toMatchObject({ kind: 'hex', hex: 'yM10' });
  });

  it('on the map, as before: a neighbouring hex only, the current spine when it is already faced', () => {
    const { map } = setUp();
    expect(turnSpineToward(map, 'yM9', 'yM10', 0)).not.toBeNull();
    expect(turnSpineToward(map, 'yM9', 'yM7', 0)).toBeNull();
    expect(turnSpineToward(map, 'yM9', 'yM9', 0)).toBeNull();
    expect(moverHex({ hex: 'yM9', off: null })).toBe('yM9');
    expect(moverHex(null)).toBeNull();
  });
});
