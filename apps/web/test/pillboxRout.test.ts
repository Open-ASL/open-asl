import { describe, expect, it } from 'vitest';
import type { GameState } from '@asl/engine';
import { aslCoreModules, piecesModule, sk2CoreModules, sk3CoreModules, turnModule, type Statics } from '@asl/rules';
import { sk1CoreModules } from '../../../packages/rules/src/sk1';
import { makeEngine } from '../../../packages/rules/test/fixtures';
import { pillboxRoutMarks } from '../src/game/pillboxRout';

/*
 * The Rout Phase marks on a pillbox counter (full ASL, ASLRB B30.5: a pillbox is a building for rout): a ROUT END with
 * the MF of going in, or barred with the rule that bars it (B30.42, B30.44), so the readout and the wheel can say why.
 */
describe('a pillbox as a rout destination', () => {
  type Spec = { id: string; def: string; side: string; hex: string; tags?: Record<string, boolean> };
  function game(extra: Spec[] = [], pbs: { side: string; hex: string; hidden?: boolean }[] = [{ side: 'ru', hex: 'uO5' }], inside = false) {
    const scenario = {
      firstSide: 'ge',
      sides: [
        { side: 'ge', name: 'German', nationality: 'ge', elr: 3 },
        { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 },
      ],
      forces: [],
    };
    const { engine, state } = makeEngine({
      board: 'u',
      scenario,
      modules: [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules, ...aslCoreModules],
      startPhase: 'RtPh',
      pieces: [{ id: 'r', def: 'ru.447', side: 'ru', hex: 'uN5', tags: { broken: true } }, { id: 'gfar', def: 'ge.467', side: 'ge', hex: 'uY10' }, ...extra],
    });
    const counters = pbs.map((p, k) => ({ id: `${p.side}.fort${k + 1}`, side: p.side, kind: 'pillbox', hex: p.hex, hidden: !!p.hidden, ca: 0, pillbox: { capacity: 1, ca: 3, nca: 5 } }));
    const r = state.pieces['r']!;
    const s: GameState = {
      ...state,
      pieces: { ...state.pieces, r: inside ? { ...r, loc: { kind: 'hex', hex: 'uO5', sub: 'pb' } } : r },
      ext: { ...state.ext, 'asl.fortifications': { counters } },
    };
    const env = engine.env(s);
    const map = (engine.statics as Statics).map;
    const check = (a: { unit: string; to: string }) => env.query<string | null>('rout.stepIllegal', { unit: a.unit, from: s.pieces[a.unit]!.loc.kind === 'hex' ? (inside ? 'uO5:pb' : 'uN5') : '', to: a.to }, null);
    return { env, marks: (ends: Set<string> | null) => pillboxRoutMarks(env, 'ru', 'r', ends, (h) => map.neighbors(h), check) };
  }

  it('the pillbox next door that is a ROUT END is tagged with its MF; one that is not an end shows the MF alone', () => {
    const { marks } = game();
    expect(marks(new Set(['uO5:pb'])).get('uO5')).toEqual({ chip: 'ROUT END +1 MF', text: expect.stringMatching(/ROUT END: \+1 MF, entered with the hex as one expenditure.*B30\.5/), barred: false });
    expect(marks(new Set(['uL5'])).get('uO5')).toMatchObject({ chip: '+1 MF', barred: false });
  });

  it('a pillbox with an enemy outside it in the hex is tagged barred, with the rule for the readout and the wheel (B30.42)', () => {
    const { marks } = game([{ id: 'v', def: 'ge.pzivf2', side: 'ge', hex: 'uO5' }]);
    const m = marks(new Set(['uO5:pb'])).get('uO5')!;
    expect(m.chip).toBe('ROUT BARRED');
    expect(m.barred).toBe(true);
    expect(m.text).toMatch(/^Pillbox barred: .*B30\.42/);
  });

  it('a farther pillbox is tagged only when it is a ROUT END; the one the router is in, and an enemy pillbox still hidden, never', () => {
    const far = game([], [{ side: 'ru', hex: 'uO8' }]);
    expect(far.marks(new Set(['uO8:pb'])).get('uO8')).toMatchObject({ chip: 'ROUT END +1 MF', barred: false });
    expect(far.marks(new Set(['uL5'])).has('uO8')).toBe(false);
    expect(game([], [{ side: 'ru', hex: 'uO5' }], true).marks(new Set(['uO5:pb'])).size).toBe(0);
    expect(game([], [{ side: 'ge', hex: 'uO5', hidden: true }]).marks(new Set(['uO5:pb'])).size).toBe(0);
  });
});
