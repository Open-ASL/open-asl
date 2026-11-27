import { describe, expect, it } from 'vitest';
import type { QueryEnv } from '@asl/engine';
import { smokeDispenser, type VehicleDef } from '@asl/rules';
import { COUNTERS } from '../src';

/*
 * Smoke dispensers the counter backs print with a superscripted date (SK4 7.5, 6.2): the import keeps them, with their
 * dates. The SK4 Japanese Vehicle Notes: the Type 95 HA-GO's "sD becomes available in 1944—as signified by the
 * superscript '4+'".
 */

const at = (year: number, month = 6) => ({ statics: { scenario: { date: `${year}`, month } } }) as unknown as QueryEnv;
const disp = (id: string, year: number) => smokeDispenser(at(year), COUNTERS[id] as VehicleDef);

describe('dated smoke dispensers from the counter backs (SK4 7.5)', () => {
  it('the Panther G and the late Tiger E: sN7 from 1944, sN8 from 1945', () => {
    for (const id of ['ge.pzvg', 'ge.pzviel']) {
      expect(disp(id, 1943)).toBeUndefined();
      expect(disp(id, 1944)).toEqual({ kind: 'sN', n: 7 });
      expect(disp(id, 1945)).toEqual({ kind: 'sN', n: 8 });
    }
  });

  it('the M4A3: sM4 from 1944', () => {
    expect(disp('am.M4A3', 1943)).toBeUndefined();
    expect(disp('am.M4A3', 1944)).toEqual({ kind: 'sM', n: 4 });
  });

  it('the HA-GO: sD5 from 1944; the Shinhoto CHI-HA and the Type 89B CHI-RO: none', () => {
    expect(disp('ja.ty95hago', 1943)).toBeUndefined();
    expect(disp('ja.ty95hago', 1944)).toEqual({ kind: 'sD', n: 5 });
    expect(disp('ja.ty97Bchiha', 1944)).toBeUndefined();
    expect(disp('ja.ty89Bchiro', 1944)).toBeUndefined();
  });

  it('an undated dispenser is there whatever the date: the Tiger B’s sN9', () => {
    expect(disp('ge.pzvib', 1942)).toEqual({ kind: 'sN', n: 9 });
  });
});
