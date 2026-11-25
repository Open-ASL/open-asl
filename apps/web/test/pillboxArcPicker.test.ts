import { describe, expect, it } from 'vitest';
import {
  arcSpine,
  aslCoreModules,
  cornerOffset,
  hexPixel,
  inPillboxCa,
  piecesModule,
  sk2CoreModules,
  sk3CoreModules,
  statics,
  turnModule,
} from '@asl/rules';
import { sk1CoreModules } from '../../../packages/rules/src/sk1';
import { makeEngine } from '../../../packages/rules/test/fixtures';
import { pillboxArtTurn } from '../src/board/BoardView';
import { pillboxArcLabel } from '../src/game/ordnance';

/*
 * Setting a pillbox's Covered Arc on the map (full ASL, ASLRB B30.1). A pillbox's arc is a hex corner (0 east,
 * clockwise); a Gun's is a spine numbered one on from it. The picker's handle for corner `ca` is drawn on spine
 * `arcSpine(ca)` and is named by the two hexes that hexspine points between: the same two adjacent hexes the rules put
 * in the arc, on the side the counter's arrow turns to.
 */
describe('the pillbox Covered Arc picker', () => {
  const { engine, state } = makeEngine({
    board: 'u',
    scenario: {
      firstSide: 'ge',
      sides: [
        { side: 'ge', name: 'German', nationality: 'ge', elr: 3 },
        { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 },
      ],
      forces: [],
    },
    modules: [
      piecesModule,
      turnModule,
      ...sk1CoreModules,
      ...sk2CoreModules,
      ...sk3CoreModules,
      ...aslCoreModules,
    ],
    pieces: [],
  });
  const env = engine.env(state);
  const map = statics(env).map;
  const at = map.hex('uO5')!;
  const deg = (r: number) => (Math.round((r * 180) / Math.PI) + 360) % 360;

  it('names, for each corner, the two adjacent hexes in that Covered Arc', () => {
    for (const ca of [0, 1, 2, 3, 4, 5]) {
      const named = pillboxArcLabel(env, 'uO5', ca)
        .split(' / ')
        .map((n) => `u${n}`);
      const adjacentInArc = [...map.hexes()]
        .filter(
          (h) => map.distance(at.id, h.id) === 1 && inPillboxCa(env, { hex: 'uO5', ca }, h.id),
        )
        .map((h) => h.id);
      expect([...named].sort(), `corner ${ca}`).toEqual([...adjacentInArc].sort());
    }
  });

  it('the east handle faces the pillbox east: the hexes it names lie where the counter arrow points', () => {
    expect(arcSpine(0)).toBe(1);
    for (const ca of [0, 1, 2, 3, 4, 5]) {
      const c = hexPixel(at.cube);
      const [a, b] = pillboxArcLabel(env, 'uO5', ca)
        .split(' / ')
        .map((n) => hexPixel(map.hex(`u${n}`)!.cube));
      const toward = Math.atan2((a!.x + b!.x) / 2 - c.x, -((a!.y + b!.y) / 2 - c.y));
      const corner = cornerOffset(ca);
      expect(deg(toward), `corner ${ca}`).toBe(deg(Math.atan2(corner.x, -corner.y)));
      // The counter art's arrow is printed 150° round from its top edge (`pillboxArtTurn`).
      expect(deg(pillboxArtTurn(ca) + (150 * Math.PI) / 180), `corner ${ca}`).toBe(deg(toward));
    }
    // East of O5 on a flat-topped grid: the handle is named by the two hexes of the next column.
    expect(pillboxArcLabel(env, 'uO5', 0)).toMatch(/^P\d+ \/ P\d+$/);
  });
});
