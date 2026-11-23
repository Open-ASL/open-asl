import { describe, expect, it } from 'vitest';
import { piecesModule, sk1CoreModules, sk2CoreModules, sk3CoreModules, sk4CoreModules, turnModule } from '@asl/rules';
import { makeEngine } from '../../../packages/rules/test/fixtures';

/** The Starter Kit rules with SK4's (concealment, so Area Fire), as a real game has them. */
const modules = [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules, ...sk4CoreModules];
import { killChance, losCheck, ordnanceCheck, shotCheck, shotFirers } from '../src/superSpectator/checks';
import { RU_VS_GE } from '../../../packages/rules/test/fixtures';

const pieces = [
  { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
  { id: 'a2', def: 'am.666', side: 'am', hex: 'yN5' },
  { id: 'mg', def: 'am.MMG', side: 'am', heldBy: 'a2' },
  { id: 'al', def: 'am.L91', side: 'am', hex: 'yN5' },
  { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5' },
];

describe("a commentator's shot check", () => {
  it('works in any phase: a Prep Fire shot tried in the Rally Phase, the real position left as it was', () => {
    const { engine, state } = makeEngine({ pieces, startPhase: 'RPh', terrain: { yP5: { terrain: 'building-stone' } } });
    const env = engine.env(state);
    const v = shotCheck(env, engine, { firers: ['yN5'], exclude: [], target: 'yP5', mode: 'prep', areaFire: false, moving: 'none' }, { secrets: true })!;
    // 7 + 6 + 4 (MMG) = 17 FP, directed by the -1 leader in the stone building's +3.
    expect(v.fp).toBe(17);
    expect(v.drm).toBe(2);
    expect(v.odds.effect).toBeGreaterThan(0);
    expect(v.odds.units['g1']).toBeDefined();
    expect(v.targets.map((t) => t.id)).toEqual(['g1']);
    expect(state.phase).toBe('RPh');
    expect(state.pieces['a1']!.tags['fire']).toBeUndefined();
  });

  it('halves the FP of Subsequent First Fire (SK1 3.3.1) and of Area Fire (SK4 8.3.2)', () => {
    const { engine, state } = makeEngine({ pieces: pieces.filter((p) => p.id !== 'al'), modules });
    const env = engine.env(state);
    const spec = { firers: ['yN5'], exclude: [], target: 'yP5', areaFire: false, moving: 'none' as const };
    const first = shotCheck(env, engine, { ...spec, mode: 'first' }, { secrets: true })!;
    const again = shotCheck(env, engine, { ...spec, mode: 'subsequentFirst' }, { secrets: true })!;
    const area = shotCheck(env, engine, { ...spec, mode: 'first', areaFire: true }, { secrets: true })!;
    expect(first.fp).toBe(17);
    expect(again.fp).toBe(8.5);
    expect(again.fpNotes).toContain('½ Subsequent First Fire');
    expect(area.fp).toBe(8.5);
  });

  it('adds FFNAM against a moving target', () => {
    const { engine, state } = makeEngine({ pieces: pieces.filter((p) => p.id !== 'al') });
    const env = engine.env(state);
    const spec = { firers: ['yN5'], exclude: [], target: 'yP5', mode: 'first' as const, areaFire: false };
    const still = shotCheck(env, engine, { ...spec, moving: 'none' }, { secrets: true })!;
    const moving = shotCheck(env, engine, { ...spec, moving: 'moving' }, { secrets: true })!;
    expect(moving.drm).toBeLessThan(still.drm);
    expect(moving.drmNotes.join(' ')).toMatch(/FFNAM/);
  });

  it('leaves out what is unticked, and fires nothing when nothing is left', () => {
    const { engine, state } = makeEngine({ pieces });
    const env = engine.env(state);
    const v = shotCheck(env, engine, { firers: ['yN5'], exclude: ['a1', 'mg'], target: 'yP5', mode: 'prep', areaFire: false, moving: 'none' }, { secrets: true })!;
    expect(v.fp).toBe(6);
    expect(shotCheck(env, engine, { firers: ['yN5'], exclude: ['a1', 'a2', 'mg'], target: 'yP5', mode: 'prep', areaFire: false, moving: 'none' }, { secrets: true })).toBeNull();
  });

  it('lists every piece in the firing hex, saying why a broken unit, its weapon and a pinned leader take no part', () => {
    const { engine, state } = makeEngine({
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5', tags: { broken: true } },
        { id: 'mg', def: 'am.MMG', side: 'am', heldBy: 'a1' },
        { id: 'a2', def: 'am.666', side: 'am', hex: 'yN5' },
        { id: 'al', def: 'am.L91', side: 'am', hex: 'yN5', tags: { pinned: true } },
      ],
    });
    const f = shotFirers(engine.env(state), state, ['yN5']);
    expect(Object.fromEntries(f.map((x) => [x.id, x.out ?? 'fires']))).toEqual({ a1: 'broken', mg: 'its holder is broken', a2: 'fires', al: 'pinned: may not direct' });
  });

  it('leaves a firer with no LOS out of the attack and says why (SK1 3.2)', () => {
    const { engine, state } = makeEngine({
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'a2', def: 'am.666', side: 'am', hex: 'yP3' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5' },
      ],
      terrain: { yP4: { terrain: 'building-stone' } },
    });
    const env = engine.env(state);
    const v = shotCheck(env, engine, { firers: ['yN5', 'yP3'], exclude: [], target: 'yP5', mode: 'prep', areaFire: false, moving: 'none' }, { secrets: true })!;
    expect(v.leftOut.join(' ')).toMatch(/No LOS from P3/);
    expect(v.fp).toBe(7);
  });
});

describe("a commentator's LOS check", () => {
  it('says what blocks the thread and where to show it', () => {
    const { engine, state } = makeEngine({ pieces: [], terrain: { yP4: { terrain: 'building-stone' } } });
    const env = engine.env(state);
    const blocked = losCheck(env, 'yP3', 'yP5');
    expect(blocked.line.clear).toBe(false);
    expect(blocked.trace.blockedBy).toBeTruthy();
    expect(blocked.line.blockedAt).toBeDefined();
    const clear = losCheck(env, 'yN5', 'yP5');
    expect(clear.line).toEqual({ from: 'yN5', to: 'yP5', clear: true });
  });
});

describe("a commentator's ordnance check", () => {
  const spec = { firers: ['yM5'], exclude: [], mode: 'prep' as const, areaFire: false, moving: 'none' as const, weapon: 'ot' };

  it('gives a tank\'s To Hit against infantry: an Infantry Target, with the chance to hit and of a Critical Hit', () => {
    const { engine, state } = makeEngine({ pieces: [{ id: 'ot', def: 'ge.otv', side: 'ge', hex: 'yM5', tags: { vca: 3, ca: 3 } }, { id: 'r1', def: 'ru.447', side: 'ru', hex: 'yM7' }], scenario: { ...RU_VS_GE, firstSide: 'ge' }, modules });
    const env = engine.env(state);
    expect(shotFirers(env, state, ['yM5']).map((f) => [f.id, f.role])).toContainEqual(['ot', 'ordnance']);
    const v = ordnanceCheck(env, engine, { ...spec, target: 'yM7' })!;
    expect(v.targetType).toBe('ITT');
    expect(v.th).toBeGreaterThan(0);
    expect(v.hit).toBeGreaterThan(0);
    expect(v.ch).toBeLessThanOrEqual(v.hit);
  });

  it('aims at a vehicle as a Vehicle Target and gives its To Kill number and Armor Factors', () => {
    const { engine, state } = makeEngine({ pieces: [{ id: 'ot', def: 'ge.otv', side: 'ge', hex: 'yM5', tags: { vca: 3, ca: 3 } }, { id: 'e1', def: 'ge.otv', side: 'ru', hex: 'yM7', tags: { vca: 0, ca: 0 } }], scenario: { ...RU_VS_GE, firstSide: 'ge' }, modules });
    const v = ordnanceCheck(engine.env(state), engine, { ...spec, target: 'yM7' })!;
    expect(v.targetType).toBe('VTT');
    expect(v.tk?.tk).toBeGreaterThan(0);
    expect(v.tk?.hull['front']).toBe(6);
  });

  it('kills under the Final TK#, the rear one higher, never on an original 12 (SK4 7.9)', () => {
    // TK 13 against AF 6: Final TK 7, so a DR of 6 or less kills (15/36); at the rear, 8: 7 or less (21/36).
    expect(killChance(13, 6, 'front')).toBeCloseTo(15 / 36);
    expect(killChance(13, 6, 'rear')).toBeCloseTo(21 / 36);
    expect(killChance(40, 0, 'front')).toBeCloseTo(35 / 36);
    expect(killChance(13, 6, 'front', true)).toBeCloseTo(35 / 36);
  });
});
