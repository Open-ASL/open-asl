import { describe, expect, it } from 'vitest';
import type { Action, Ctx, RuleModule } from '@asl/engine';
import { FP, type FireDeclaration, type FireMode, type ResolveFireFn } from '../src';
import { residualFpLeft } from '../src/sk1/fire';
import { act, makeEngine } from './fixtures';

/** Test-only action: resolve a fire declaration in a given mode. */
const testFire: RuleModule = {
  id: 'test.fire',
  install(r) {
    r.action<Action & { decl: FireDeclaration; mode: FireMode }>({
      type: 'test.fire',
      decisionKinds: ['phase'],
      validate: (env, a) => env.query('fire.illegal', { decl: a.decl, mode: a.mode, side: a.side }, null),
      resolve(ctx: Ctx, a) {
        ctx.proc<ResolveFireFn>(FP.resolve)(ctx, a.decl, a.mode);
      },
    });
  },
};

// SK1 Prep Fire Phase example (page 5), German ELR 3.
const terrain = {
  yP5: { terrain: 'building-stone' },
  yP1: { terrain: 'building-stone' },
  yO5: { terrain: 'orchard' },
};

describe('fire markers by phase', () => {
  const pieces = [
    { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
    { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5' },
  ];
  it('AFPh firers wear Advancing Fire, not Prep Fire, and cannot fire again (SK1 3.5)', () => {
    const { engine, state } = makeEngine({ terrain, extra: [testFire], pieces, dice: [6, 6, 6, 6] });
    const t = act(engine, state, { type: 'test.fire', mode: 'advancing', decl: { units: ['a1'], sw: [], target: 'yP5' } });
    expect(t.state.pieces['a1']!.tags['fire']).toBe('adv');
    expect(() => act(engine, t.state, { type: 'test.fire', mode: 'advancing', decl: { units: ['a1'], sw: [], target: 'yP5' } })).toThrow(/already fired/);
    // The attack says how its FP came about: 7 FP halved for Advancing Fire, +1 Assault Fire, the
    // fraction then rounded up (SK1 3.5): 3.5 + 1 = 4.5 → 5.
    const attack = t.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { fp: number; fpExplain: { label?: string }[] };
    expect(attack.fp).toBe(5);
    expect(attack.fpExplain.map((n) => n.label)).toEqual(['½ Advancing Fire', '+1 Assault Fire']);
  });

  it('a target possessing a FT deducts one from the attack DR against it, and the result says so (SK1 4.2)', () => {
    const { engine, state } = makeEngine({
      terrain,
      extra: [testFire],
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'a2', def: 'am.666', side: 'am', hex: 'yO6' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5' },
        { id: 'g2', def: 'ge.467', side: 'ge', hex: 'yP5' },
        { id: 'ft', def: 'ge.FT', side: 'ge', heldBy: 'g1' },
      ],
      dice: [4, 2, 5, 4, 4, 3, 3, 3],
    });
    const t = act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: ['a1', 'a2'], sw: [], target: 'yP5' } });
    const results = Object.fromEntries(t.events.filter((e) => e.type === 'sk1.fire.result').map((e) => [(e.payload as { unit: string }).unit, e.payload]));
    expect(results['g2']).toEqual({ unit: 'g2', result: expect.anything(), finalDr: 10 });
    expect(results['g1']).toEqual({ unit: 'g1', result: expect.anything(), finalDr: 9, drm: -1, explain: [{ id: 'sk1.drm.vs-ft', label: '-1 vs FT possessor' }] });
  });
  it('a Prep Fire marker blocks Advancing Fire; both come off at the end of the AFPh', () => {
    const { engine, state } = makeEngine({
      terrain,
      extra: [testFire],
      pieces: [...pieces, { id: 'a2', def: 'am.666', side: 'am', hex: 'yO6', tags: { fire: 'prep' } }],
      dice: [6, 6, 6, 6],
      startPhase: 'AFPh',
    });
    expect(() => act(engine, state, { type: 'test.fire', mode: 'advancing', decl: { units: ['a2'], sw: [], target: 'yP5' } })).toThrow(/already fired/);
    const t = act(engine, state, { type: 'test.fire', mode: 'advancing', decl: { units: ['a1'], sw: [], target: 'yP5' } });
    expect(t.state.pieces['a1']!.tags['fire']).toBe('adv');
    const ended = act(engine, t.state, { type: 'endPhase' });
    expect(ended.state.pieces['a1']!.tags['fire']).toBeUndefined();
    expect(ended.state.pieces['a2']!.tags['fire']).toBeUndefined();
  });
});

describe('Desperation Morale from being attacked (SK1 3.2.1)', () => {
  // The firer in N5; the target stack two hexes off in P5 or, at long range for a HS or Green
  // squad, four hexes off in N1. Results are read from the fixture IFT.
  const fireOn = (firer: string, target: 'yP5' | 'yN1', terrain: Record<string, { terrain: string }>, dice: number[]) => {
    const { engine, state } = makeEngine({
      terrain,
      extra: [testFire],
      pieces: [
        { id: 'a1', def: firer, side: 'am', hex: 'yN5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: target, tags: { broken: true } },
        { id: 'g2', def: 'ge.467', side: 'ge', hex: target },
      ],
      dice,
    });
    return act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: ['a1'], sw: [], target } });
  };

  it('a broken target goes under DM when the attack could inflict a NMC, even if it rolls no effect, and says so', () => {
    // 7 FP vs a stone building: snake eyes cowers to the 4 column, 2+3 = 5 is a NMC. The roll is 11.
    const t = fireOn('am.747', 'yP5', { yP5: { terrain: 'building-stone' } }, [6, 5]);
    expect(t.state.pieces['g1']!.tags['dm']).toBe(true);
    expect(t.state.pieces['g2']!.tags['dm']).toBeUndefined();
    expect(t.events.filter((e) => e.type === 'sk1.fire.result').map((e) => (e.payload as { result: { kind: string } }).result.kind)).toEqual(['none', 'none']);
    expect(t.events.find((e) => e.type === 'sk1.fire.dm')!.payload).toEqual({ units: ['g1'] });
  });

  it('no DM when Cowering puts a NMC out of reach', () => {
    // 1½ FP (a HS at long range) vs a stone building: snake eyes cowers off the 1 column; a 3 on
    // it is 6, a PTC. Without the cower, 2+3 = 5 would have been a NMC.
    const t = fireOn('am.336', 'yN1', { yN1: { terrain: 'building-stone' } }, [6, 5]);
    expect(t.events.find((e) => e.type === 'sk1.fire.attack')!.payload).toMatchObject({ column: 1 });
    expect(t.state.pieces['g1']!.tags['dm']).toBeUndefined();
    expect(t.events.some((e) => e.type === 'sk1.fire.dm')).toBe(false);
  });

  it('an attack whose snake eyes would cower off the IFT still causes DM when a 3 can reach a NMC', () => {
    // 2½ FP (a Green squad at long range) in the open: snake eyes cowers two columns, off the
    // table; a 3 on the 2 column is a NMC.
    const t = fireOn('am.536', 'yN1', {}, [6, 5]);
    expect(t.events.find((e) => e.type === 'sk1.fire.attack')!.payload).toMatchObject({ column: 2 });
    expect(t.state.pieces['g1']!.tags['dm']).toBe(true);
  });
});

describe('SK1 Prep Fire example', () => {
  it('multi-hex FG: PBF doubling, worst hindrance, NMC breaks one squad and pins the other', () => {
    const { engine, state } = makeEngine({
      terrain,
      extra: [testFire],
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'a2', def: 'am.666', side: 'am', hex: 'yO6' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5' },
        { id: 'g2', def: 'ge.467', side: 'ge', hex: 'yP5' },
      ],
      // Attack DR 4+2 = 6; g1 MC 5+4 = 9; g2 MC 4+3 = 7.
      dice: [4, 2, 5, 4, 4, 3],
    });
    const t = act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: ['a1', 'a2'], sw: [], target: 'yP5' } });
    const attack = t.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { fp: number; column: number; drm: number };
    expect(attack.fp).toBe(19);
    expect(attack.column).toBe(16);
    expect(attack.drm).toBe(4);
    const g1 = t.state.pieces['g1']!;
    const g2 = t.state.pieces['g2']!;
    expect(g1.tags).toMatchObject({ broken: true, dm: true });
    expect(g1.defId).toBe('ge.467'); // failed by 2, within ELR 3
    expect(g2.tags).toMatchObject({ pinned: true });
    expect(t.state.pieces['a1']!.tags['fire']).toBe('prep');
    expect(t.state.pieces['a2']!.tags['fire']).toBe('prep');
  });

  it('leader-directed long range fire: halved FP, leadership DRM, doubles do not cower', () => {
    const { engine, state } = makeEngine({
      terrain,
      extra: [testFire],
      pieces: [
        { id: 'a3', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'aL', def: 'am.L91', side: 'am', hex: 'yN5' },
        { id: 'g3', def: 'ge.467', side: 'ge', hex: 'yP1' },
      ],
      // Attack DR 1+1 (snake eyes); g3 MC 2+3 = 5 (+1 = 6).
      dice: [1, 1, 2, 3],
    });
    const t = act(engine, state, {
      type: 'test.fire',
      mode: 'prep',
      decl: { units: ['a3'], sw: [], target: 'yP1', directors: ['aL'] },
    });
    const attack = t.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { fp: number; column: number; drm: number; cowered: boolean };
    expect(attack.fp).toBe(3.5);
    expect(attack.column).toBe(2);
    expect(attack.drm).toBe(2);
    expect(attack.cowered).toBe(false);
    expect(t.state.pieces['g3']!.tags).toEqual({});
    expect(t.state.pieces['aL']!.tags['fire']).toBe('prep');
  });

  it('old single-director declarations still work', () => {
    const { engine, state } = makeEngine({
      terrain,
      extra: [testFire],
      pieces: [
        { id: 'a3', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'aL', def: 'am.L91', side: 'am', hex: 'yN5' },
        { id: 'g3', def: 'ge.467', side: 'ge', hex: 'yP1' },
      ],
      dice: [1, 1, 2, 3],
    });
    const t = act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: ['a3'], sw: [], target: 'yP1', director: 'aL' } });
    const attack = t.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { drm: number; cowered: boolean; attack: { directors?: string[] } };
    expect(attack.drm).toBe(2);
    expect(attack.cowered).toBe(false);
    expect(attack.attack.directors).toEqual(['aL']);
  });

  // SK1 3.2: a leadership DRM applies to a multi-hex FG only with a directing leader in every hex,
  // and the DRM used is that of the lowest quality leader.
  describe('multi-hex Fire Group direction', () => {
    const pieces = [
      { id: 'a3', def: 'am.747', side: 'am', hex: 'yN5' },
      { id: 'aL', def: 'am.L91', side: 'am', hex: 'yN5' },
      { id: 'a4', def: 'am.747', side: 'am', hex: 'yN4' },
      { id: 'aL2', def: 'am.L80', side: 'am', hex: 'yN4' },
      { id: 'g3', def: 'ge.467', side: 'ge', hex: 'yP1' },
    ];

    it('needs a directing leader in every firing hex', () => {
      const { engine, state } = makeEngine({ terrain, extra: [testFire], pieces, dice: [1, 1] });
      expect(() => act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: ['a3', 'a4'], sw: [], target: 'yP1', directors: ['aL'] } })).toThrow(
        /every hex.*yN4/,
      );
    });

    it('allows one directing leader per hex, and no more', () => {
      const { engine, state } = makeEngine({ terrain, extra: [testFire], pieces, dice: [1, 1, 6, 6] });
      expect(() => act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: ['a3'], sw: [], target: 'yP1', directors: ['aL', 'aL2'] } })).toThrow(
        /firing hex/,
      );
      expect(() => act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: ['a3', 'a4'], sw: [], target: 'yP1', directors: ['aL', 'aL2'] } })).not.toThrow();
    });

    it('uses the lowest quality leader DRM, no cowering, and marks both leaders as fired', () => {
      const { engine, state } = makeEngine({ terrain, extra: [testFire], pieces, dice: [1, 1, 6, 6] });
      const t = act(engine, state, {
        type: 'test.fire',
        mode: 'prep',
        decl: { units: ['a3', 'a4'], sw: [], target: 'yP1', directors: ['aL', 'aL2'] },
      });
      const attack = t.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { fp: number; drm: number; cowered: boolean; attack: { directors?: string[] } };
      // a3 at long range (half FP) + a4 at normal range; +3 stone building, the 8-0's +0 leadership rather than the 9-1's -1.
      expect(attack.fp).toBe(10.5);
      expect(attack.drm).toBe(3);
      expect(attack.cowered).toBe(false);
      expect(attack.attack.directors).toEqual(['aL', 'aL2']);
      expect(t.state.pieces['aL']!.tags['fire']).toBe('prep');
      expect(t.state.pieces['aL2']!.tags['fire']).toBe('prep');
      // Both leaders have directed this Player Turn.
      expect(() => act(engine, t.state, { type: 'test.fire', mode: 'prep', decl: { units: ['a3'], sw: [], target: 'yP1', directors: ['aL'] } })).toThrow(/already/);
    });
  });

  it('inexperienced cowering shifts two columns; original 12 on MC reduces and ELR-replaces', () => {
    const { engine, state } = makeEngine({
      terrain,
      extra: [testFire],
      pieces: [
        { id: 'a4', def: 'am.536', side: 'am', hex: 'yN4' },
        { id: 'g4', def: 'ge.467', side: 'ge', hex: 'yO5' },
      ],
      // Attack DR 2+2 (doubles, cowers 2 columns); g4 MC 6+6.
      dice: [2, 2, 6, 6],
    });
    const t = act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: ['a4'], sw: [], target: 'yO5' } });
    const attack = t.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { fp: number; column: number; cowered: boolean };
    expect(attack.fp).toBe(10);
    expect(attack.cowered).toBe(true);
    expect(attack.column).toBe(4);
    const g4 = t.state.pieces['g4']!;
    expect(g4.defId).toBe('ge.237'); // 4-6-7 -> 4-4-7 (ELR) -> 2-3-7 (CR): ELR first (ASLRB A10.31)
    expect(g4.tags).toMatchObject({ broken: true, dm: true });
    expect(t.state.pieces['a4']!.tags['fire']).toBe('prep');
    // Each replacement says why, and the ELR event records what the unit was and became (1MC: 12+1 vs 7).
    const replaced = t.events.filter((e) => e.type === 'piece.replaced').map((e) => e.payload);
    expect(replaced).toEqual([
      { id: 'g4', defId: 'ge.447', from: 'ge.467', reason: 'elr' },
      { id: 'g4', defId: 'ge.237', from: 'ge.447', reason: 'cr' },
    ]);
    expect(t.events.find((e) => e.type === 'sk1.elr')!.payload).toEqual({ unit: 'g4', from: 'ge.467', to: 'ge.447', failedBy: 6, elr: 3 });
    // The check's own result is recorded before its ELR consequence.
    const order = t.events.filter((e) => ['sk1.check', 'sk1.elr'].includes(e.type)).map((e) => e.type);
    expect(order).toEqual(['sk1.check', 'sk1.elr']);
  });

  it('applies a nationality\'s own ELR where the side lists one (S9: the 505th PIR 5, the 50th Division 3)', () => {
    const { engine, state } = makeEngine({
      terrain,
      extra: [testFire],
      scenario: {
        sides: [
          { side: 'am', name: 'American', nationality: 'am', elr: 3 },
          { side: 'ge', name: 'German', nationality: 'ge', elr: 3, elrs: { ge: 6 } },
        ],
      },
      pieces: [
        { id: 'a4', def: 'am.536', side: 'am', hex: 'yN4' },
        { id: 'g4', def: 'ge.467', side: 'ge', hex: 'yO5' },
      ],
      // As above: the MC fails by 6, which no longer exceeds the German units' ELR.
      dice: [2, 2, 6, 6],
    });
    const t = act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: ['a4'], sw: [], target: 'yO5' } });
    expect(t.state.pieces['g4']!.defId).toBe('ge.247');
    expect(t.events.some((e) => e.type === 'sk1.elr')).toBe(false);
  });

  it('lets fire be declared along a near-blocked LOS: the firer has fired, no attack', () => {
    const nearBlocked: RuleModule = {
      id: 'test.nearLos',
      install(r) {
        r.contribute({
          id: 'test.nearLos',
          query: 'los.trace',
          layer: 950,
          apply: (v, { from, to }) => (from === 'yN5' && to === 'yP5' ? { ...v, clear: false, near: true, blockedBy: 'a sliver of wall' } : v),
        });
      },
    };
    const { engine, state } = makeEngine({
      terrain,
      extra: [testFire, nearBlocked],
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'a2', def: 'am.666', side: 'am', hex: 'yO6' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5' },
      ],
      dice: [4, 2, 5, 4],
    });
    // Only the firer without LOS: wasted and marked Prep Fire; the DR is still made (ASLRB A6.11).
    const t = act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: ['a1'], sw: [], target: 'yP5' } });
    expect(t.events.find((e) => e.type === 'sk1.fire.noLos')!.payload).toMatchObject({ dr: [4, 2] });
    expect(t.events.some((e) => e.type === 'sk1.fire.attack')).toBe(false);
    expect(t.state.pieces['a1']!.tags['fire']).toBe('prep');
    expect(t.state.pieces['g1']!.tags['broken']).toBeUndefined();
    // A fire group where one firer lacks LOS: it is marked, the other attacks alone.
    const t2 = act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: ['a1', 'a2'], sw: [], target: 'yP5' } });
    expect(t2.events.some((e) => e.type === 'sk1.fire.noLos')).toBe(true);
    const attack = t2.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { fp: number; attack: { parts: string[] } };
    expect(attack.attack.parts).toEqual(['a2']);
    expect(t2.state.pieces['a1']!.tags['fire']).toBe('prep');
    expect(t2.state.pieces['a2']!.tags['fire']).toBe('prep');
  });

  it('accepts a shot without LOS (declared first, then wasted) and rejects units that already fired', () => {
    const { engine, state } = makeEngine({
      terrain: { ...terrain, yO6: { terrain: 'woods' }, yO5: { terrain: 'woods' } },
      extra: [testFire],
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'a2', def: 'am.747', side: 'am', hex: 'yN4', tags: { fire: 'prep' } },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5' },
      ],
    });
    const t = act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: ['a1'], sw: [], target: 'yP5' } });
    expect(t.events.some((e) => e.type === 'sk1.fire.noLos')).toBe(true);
    expect(t.events.some((e) => e.type === 'sk1.fire.attack')).toBe(false);
    expect(t.state.pieces['a1']!.tags['fire']).toBe('prep');
    expect(() => act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: ['a2'], sw: [], target: 'yP5' } })).toThrow(/already fired/);
  });
});

describe('K/# results (SK1 3.2.1, ASLRB A7.302)', () => {
  // A 7-4-7 fires point blank at a 4-6-7 and an 8-1 in the open: 14 FP, DR 2+4 is a K/1.
  const fire = { type: 'test.fire', mode: 'prep', decl: { units: ['a1'], sw: [], target: 'yN6' } } as const;
  const pieces = [
    { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
    { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yN6' },
    { id: 'gL', def: 'ge.L81', side: 'ge', hex: 'yN6' },
  ];
  const checks = (t: { events: { type: string; payload: unknown }[] }) => t.events.filter((e) => e.type === 'sk1.check').map((e) => (e.payload as { unit: string }).unit);

  it('an SMC wounded by the K takes no MC; the others do', () => {
    // Random selection: squad 1, leader 6 (the leader is the casualty); wound severity 2; the squad's 1MC 1+1.
    const { engine, state } = makeEngine({ terrain, extra: [testFire], pieces, dice: [2, 4, 1, 6, 2, 1, 1] });
    const t = act(engine, state, fire);
    expect(t.state.pieces['gL']!.tags['wounds']).toBe(1);
    expect(checks(t)).toEqual(['g1']);
  });

  it('a squad Reduced by the K takes the MC as a HS, with the leader', () => {
    // Random selection: squad 6, leader 1; then the MC, leader first: 1+1 each.
    const { engine, state } = makeEngine({ terrain, extra: [testFire], pieces, dice: [2, 4, 6, 1, 1, 1, 1, 1] });
    const t = act(engine, state, fire);
    expect(checks(t).sort()).toHaveLength(2);
    expect(checks(t)).toContain('gL');
  });
});


describe('Residual FP left (SK1 3.3.1, ASLRB A8.26)', () => {
  const { engine, state } = makeEngine({ pieces: [] });
  const left = (column: number, points: number) => residualFpLeft(engine.env(state), column, points);
  it('halves the column, then drops a column per point of outside DRM', () => {
    expect(left(4, 0)).toBe(2);
    expect(left(4, 1)).toBe(1);
    // Tester report: 5 FP on the 4 column through a +2 LOS Hindrance leaves nothing.
    expect(left(4, 2)).toBe(0);
    // A8.26: "a 6 Residual FP counter is flipped over to the 4 FP side for a +1 DRM or changed to a 2 ... for a +2 DRM".
    expect(left(12, 1)).toBe(4);
    expect(left(12, 2)).toBe(2);
    // Halved first: the 20 column leaves 8 (10 rounded down to a column), 6 after a +1.
    expect(left(20, 1)).toBe(6);
  });
});

describe('Same-hex Fire Group and a FT (SK1 3.2)', () => {
  // A captured FT fired from L5 at K5, then the other units in L5 were refused ("only one
  // FG"). Units in a hex attacking the same target must form one FG "unless using FT": the FT's attack, made alone,
  // leaves the hex's FG against that target to the rest.
  it('after a FT attack the other units of its hex may still attack the same target, once', async () => {
    const { RU_VS_GE } = await import('./fixtures');
    const { engine, state } = makeEngine({
      scenario: RU_VS_GE,
      startPhase: 'PFPh',
      dice: [2, 3, 6, 5, 6, 5, 6, 5, 6, 5],
      pieces: [
        { id: 'g', def: 'ge.467', side: 'ge', hex: 'yM6' },
        { id: 'r1', def: 'ru.447', side: 'ru', hex: 'yM7' },
        { id: 'r2', def: 'ru.447', side: 'ru', hex: 'yM7' },
        { id: 'ft', def: 'ge.FT', side: 'ru', heldBy: 'r1' },
      ],
    });
    const fire = (s: typeof state, decl: FireDeclaration) => engine.validate(s, { type: 'fire', decl, side: 'ru', decisionId: engine.currentDecision(s)!.id } as never);
    const s = act(engine, state, { type: 'fire', decl: { units: [], sw: ['ft'], target: 'yM6' } }).state;
    expect(fire(s, { units: ['r1', 'r2'], sw: [], target: 'yM6' })).toBeNull();
    const after = act(engine, s, { type: 'fire', decl: { units: ['r2'], sw: [], target: 'yM6' } }).state;
    expect(fire(after, { units: ['r1'], sw: [], target: 'yM6' })).toMatch(/must form one Fire Group/);
  });
});
