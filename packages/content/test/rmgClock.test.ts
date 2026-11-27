import { describe, expect, it } from 'vitest';
import { rmgSpine, type VehicleDef } from '@asl/rules';
import { COUNTERS } from '../src';

/*
 * The counter backs' "RMG: 4:00 from MA" (Type 95 HA-GO) and "RMG: 8:00 from MA" (Type 89B CHI-RO), as the import reads
 * them: the turret Rear MG's Covered Arc is centred two hexspines clockwise, or counterclockwise, of the TCA (SK4
 * Japanese Vehicle Notes). Every other turret RMG fires through the rear of the turret (ASLRB D1.82).
 */
describe('turret Rear MG positions from the counter backs', () => {
  const v = (id: string) => COUNTERS[id] as VehicleDef;
  it('HA-GO 4:00, CHI-RO 8:00; the Shinhoto CHI-HA and the KV-2 at the rear', () => {
    expect(v('ja.ty95hago').mg).toMatchObject({ rmg: 2, rmgClock: 4 });
    expect(v('ja.ty89Bchiro').mg).toMatchObject({ rmg: 2, rmgClock: 8 });
    for (const id of ['ja.ty97Bchiha', 'ru.KV2']) expect(v(id).mg.rmgClock).toBeUndefined();
    expect([rmgSpine(v('ja.ty95hago'), 0), rmgSpine(v('ja.ty89Bchiro'), 0), rmgSpine(v('ja.ty97Bchiha'), 0)]).toEqual([2, 4, 3]);
  });
});
