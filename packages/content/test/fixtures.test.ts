import { describe, expect, it } from 'vitest';
import { ASL_TESTBED_SCENARIO, BPV, COUNTERS, DEV_FIXTURES, SK1_COUNTER_IDS, SK2_COUNTER_IDS, SK3_COUNTER_IDS, TESTBED_FORTIFIED, TESTBED_HILL_HEXES, TESTBED_VC_BUILDINGS, buildingAt, fixtureActions, fixturesFor, newGame, scenarioById, staticsFor } from '../src';
import { fortifiableBuildings, fortifiedState, ordnanceWeaponIllegal } from '@asl/rules';

/** A fresh test bed game with a fixture's actions applied, as the dev UI does. */
function load(id: string) {
  const g = newGame(ASL_TESTBED_SCENARIO, 'fixture-test');
  const actions = fixtureActions(g.engine, g.state, id);
  let state = g.state;
  for (const a of actions) state = g.engine.submit(state, a).state;
  return { engine: g.engine, state, actions, env: g.engine.env(state) };
}
const hexOf = (state: ReturnType<typeof load>['state'], id: string) => {
  const p = state.pieces[id]!;
  return p.loc.kind === 'hex' ? p.loc.hex : p.loc.kind;
};

describe('T1 Full ASL Test Bed', () => {
  const sc = ASL_TESTBED_SCENARIO;

  it('fields two leaders, mixed-quality squads and the MG, FT and DC on each side', () => {
    const units = (side: string) => sc.forces.filter((f) => f.side === side).flatMap((f) => f.units.flatMap((u) => Array.from({ length: u.count }, () => [u.def, ...(u.withSw ?? [])]).flat()));
    const kinds = (side: string) => units(side).map((d) => COUNTERS[d]!);
    for (const side of ['ru', 'ge']) {
      expect(kinds(side).filter((d) => d.kind === 'leader')).toHaveLength(2);
      expect(kinds(side).filter((d) => d.kind === 'squad').length).toBeGreaterThanOrEqual(7);
    }
    expect(units('ge')).toEqual(expect.arrayContaining(['ge.L92', 'ge.L80', 'ge.LMG', 'ge.MMG', 'ge.HMG', 'ge.FT', 'ge.DC', 'ge.447']));
    expect(units('ru')).toEqual(expect.arrayContaining(['ru.L91', 'ru.L70', 'ru.LMG', 'ru.MMG', 'ru.HMG', 'ru.426']));
    expect(sc.sides.map((s) => [s.side, s.elr, s.san])).toEqual([['ru', 1, 7], ['ge', 1, 7]]);
    expect(sc.sides.find((s) => s.setupFirst)?.side).toBe('ru');
    expect(sc.firstSide).toBe('ge');
  });

  it('puts the stone village, the hill and the woods into the setup areas, and the VC on the village and the hill', () => {
    const area = (side: string) => sc.forces.find((f) => f.side === side)!.setup as { hexes: string[] };
    expect(area('ru').hexes).toEqual(expect.arrayContaining(['uI4', 'uK4', 'uP3', 'uH5', 'uE5']));
    expect(area('ge').hexes).toEqual(expect.arrayContaining(['uT3', 'uW5', 'uCC8']));
    expect(area('ge').hexes).not.toContain('uP3');
    expect(TESTBED_VC_BUILDINGS).toHaveLength(7);
    expect(TESTBED_VC_BUILDINGS).toContain(buildingAt('u', 'uI3'));
    expect(TESTBED_HILL_HEXES).toEqual(expect.arrayContaining(['uE5', 'uH5', 'uC9']));
  });

  it('lets the Russians secretly fortify one building of their setup area', () => {
    const g = newGame(sc, 'fortify');
    const env = g.engine.env(g.state);
    expect(g.engine.currentDecision(g.state)).toMatchObject({ kind: 'fortify', owner: 'ru', data: { count: 1 } });
    const choices = fortifiableBuildings(env, 'ru');
    expect(choices).toEqual(expect.arrayContaining([buildingAt('u', 'uK4'), TESTBED_FORTIFIED]));
    expect(choices).not.toContain(buildingAt('u', 'uV8'));
  });

  it('plays under the Full ASL ruleset with the full counter set', () => {
    expect(staticsFor(sc).counters['ge.838']).toBeDefined();
    expect(staticsFor(sc).counters['ru.HMG']).toBeDefined();
  });
});

describe('BPV (A./G. National Capabilities Chart)', () => {
  it('matches the chart and the H1.26 examples', () => {
    expect(COUNTERS['ge.838']).toMatchObject({ bpv: 16 });
    expect(COUNTERS['ge.468']).toMatchObject({ bpv: 13 });
    expect(COUNTERS['ge.436']).toMatchObject({ bpv: 5 });
    expect(COUNTERS['ru.458']).toMatchObject({ bpv: 11 });
    expect(COUNTERS['ru.426']).toMatchObject({ bpv: 4 });
    expect(COUNTERS['am.666']).toMatchObject({ bpv: 11 });
    expect(COUNTERS['br.648']).toMatchObject({ bpv: 14 });
    expect(COUNTERS['it.447']).toMatchObject({ bpv: 8 });
    expect(COUNTERS['al.437']).toMatchObject({ bpv: 6 });
    // Leaders and SW have none (H1.2: allotted, not bought).
    expect(COUNTERS['ge.L92']).not.toHaveProperty('bpv');
    expect(COUNTERS['ge.LMG']).not.toHaveProperty('bpv');
  });

  it('covers every squad, HS and crew of the Starter Kit counter sets but the German 1-2-8 crew', () => {
    const ids = [...SK1_COUNTER_IDS, ...SK2_COUNTER_IDS, ...SK3_COUNTER_IDS].filter((id) => ['squad', 'hs', 'crew'].includes(COUNTERS[id]!.kind));
    // A Japanese Reduced-Strength side (`fullOf`) has no row of its own on the chart.
    expect(ids.filter((id) => BPV[id] === undefined && !(COUNTERS[id] as { fullOf?: string }).fullOf)).toEqual([]);
    expect(COUNTERS['ge.128c']).toMatchObject({ bpv: 8 });
    expect(COUNTERS['am.228c']).toMatchObject({ bpv: 8 });
    // A HS is worth less than its squad.
    for (const id of ids) {
      const d = COUNTERS[id]!;
      if (d.kind === 'squad' && d.reducesTo && BPV[d.reducesTo] !== undefined) expect(BPV[d.reducesTo]!, id).toBeLessThan(BPV[id]!);
    }
  });
});

describe('Dev fixtures', () => {
  it('lists the test bed fixtures', () => {
    expect(fixturesFor('asl-testbed').map((f) => f.id)).toEqual(['start', 'melee', 'building-assault', 'two-story-house', 'los-heights', 'orchard-road', 'bypass']);
    expect(DEV_FIXTURES.every((f) => f.title && f.description)).toBe(true);
  });

  it('start: both sides set up, P2-P3 fortified, German Turn 1 RPh', () => {
    const { engine, state, env } = load('start');
    expect([state.phase, state.turn, state.attacker]).toEqual(['RPh', 1, 'ge']);
    expect(engine.currentDecision(state)?.owner).toBe('ge');
    expect(fortifiedState(env)?.buildings).toEqual([TESTBED_FORTIFIED]);
    const at = (hex: string) => Object.values(state.pieces).filter((p) => p.loc.kind === 'hex' && p.loc.hex === hex).map((p) => p.defId).sort();
    expect(at('uK4')).toEqual(['ru.458', 'ru.L91']);
    expect(at('uT3')).toEqual(['ge.548', 'ge.838', 'ge.L92']);
    // Every unit is on the map.
    expect(Object.values(state.pieces).filter((p) => p.loc.kind === 'offboard')).toEqual([]);
  });

  it('melee: the German stack has advanced into the Russian 4-2-6 and CC is to be declared', () => {
    const { engine, state } = load('melee');
    expect([state.phase, state.turn, state.attacker]).toEqual(['CCPh', 1, 'ge']);
    const inP5 = Object.values(state.pieces).filter((p) => p.loc.kind === 'hex' && p.loc.hex === 'uP5');
    expect(inP5.map((p) => p.side).sort()).toEqual(['ge', 'ge', 'ge', 'ru']);
    expect(engine.currentDecision(state)?.kind).toMatch(/^cc/);
  });

  it('building-assault: the assault engineers are adjacent to the fortified building in the German Turn 2 MPh', () => {
    const { engine, state, env } = load('building-assault');
    expect([state.phase, state.turn, state.attacker]).toEqual(['MPh', 2, 'ge']);
    expect(engine.currentDecision(state)?.owner).toBe('ge');
    const ae = Object.values(state.pieces).find((p) => p.defId === 'ge.838')!;
    expect(hexOf(state, ae.id)).toBe('uQ3');
    expect(staticsFor(ASL_TESTBED_SCENARIO).map.distance('uQ3', 'uP3')).toBe(1);
    expect(fortifiedState(env)?.buildings).toEqual([TESTBED_FORTIFIED]);
  });

  it('two-story-house: Russians on both levels of P3, the Germans beside it in Q3, German Turn 2 PFPh', () => {
    const { engine, state } = load('two-story-house');
    expect([state.phase, state.turn, state.attacker]).toEqual(['PFPh', 2, 'ge']);
    expect(engine.currentDecision(state)?.owner).toBe('ge');
    const at = (loc: Record<string, unknown>) =>
      Object.values(state.pieces).filter((p) => JSON.stringify(p.loc) === JSON.stringify(loc)).map((p) => p.defId).sort();
    expect(at({ kind: 'hex', hex: 'uP3', level: 1 })).toEqual(['ru.458', 'ru.L91']);
    expect(at({ kind: 'hex', hex: 'uP3' })).toEqual(['ru.527']);
    expect(at({ kind: 'hex', hex: 'uQ3' })).toEqual(['ge.548', 'ge.838', 'ge.L92']);
  });

  it('los-heights: Germans on level 1 of P2; level 1 of K5 and M5 see them over N3/N4, the ground floors do not', () => {
    const { state, env } = load('los-heights');
    expect(state.phase).toBe('PFPh');
    expect(state.attacker).toBe('ru');
    const ge = Object.values(state.pieces).filter((p) => p.side === 'ge' && p.loc.kind === 'hex' && p.loc.hex === 'uP2');
    expect(ge.length).toBe(3);
    expect(ge.every((p) => p.loc.kind === 'hex' && p.loc.level === 1)).toBe(true);
    const los = (from: string, to: string) => env.query('los.trace', { from, to }, { clear: true, hindrance: 0, parts: [] });
    expect(los('uK5:1', 'uP2:1').clear).toBe(true);
    expect(los('uM5:1', 'uP2:1').clear).toBe(true);
    expect(los('uK5', 'uP2:1').clear).toBe(false);
    expect(los('uM5', 'uP2:1').clear).toBe(false);
    expect(los('uI4', 'uP2:1').blockedBy).toBe('Two Story House in uM3');
    expect(los('uH5', 'uP2:1').blockedBy).toBe('Two Story House in uI5');
  });

  it('orchard-road: the German stack in Q4 may take the P4 road or its orchard; L6 sees down the road, M7 level 1 down K8-J8', () => {
    const { engine, state, env } = load('orchard-road');
    expect([state.phase, state.turn, state.attacker]).toEqual(['MPh', 2, 'ge']);
    const stack = Object.values(state.pieces).filter((p) => p.side === 'ge' && p.loc.kind === 'hex' && p.loc.hex === 'uQ4' && p.defId !== 'ge.LMG');
    expect(stack.map((p) => p.defId).sort()).toEqual(['ge.447', 'ge.467', 'ge.L80']);
    const los = (from: string, to: string) => env.query('los.trace', { from, to }, { clear: true, hindrance: 0, parts: [] });
    expect(los('uL6', 'uP4')).toMatchObject({ clear: true, hindrance: 0 });
    expect(los('uL6', 'uP4').orchard).toBeUndefined();
    expect(los('uM7:1', 'uJ8').clear).toBe(true);
    // Into P4 along the road, or into its orchard.
    const d = engine.currentDecision(state)!;
    const s = engine.submit(state, { type: 'move.start', units: stack.map((p) => p.id), side: 'ge', decisionId: d.id } as never).state;
    const into = engine.legalActions(s, 'ge').filter((a) => a.type === 'move.step' && a['to'] === 'uP4');
    expect(into.map((a) => !!a['woods']).sort()).toEqual([false, true]);
  });

  it('bypass: the German stack in Q4 may go round R3 (A4.3), out at a corner or into the building', () => {
    const { engine, state } = load('bypass');
    expect([state.phase, state.turn, state.attacker]).toEqual(['MPh', 2, 'ge']);
    const stack = Object.values(state.pieces).filter((p) => p.side === 'ge' && p.loc.kind === 'hex' && p.loc.hex === 'uQ4' && p.defId !== 'ge.LMG');
    const d = engine.currentDecision(state)!;
    const s = engine.submit(state, { type: 'move.start', units: stack.map((p) => p.id), side: 'ge', decisionId: d.id } as never).state;
    const round = engine.legalActions(s, 'ge').filter((a) => a.type === 'move.step' && a['to'] === 'uR3' && a['bypass']);
    expect(round.map((a) => (a['bypass'] as string[]).join('-'))).toEqual(expect.arrayContaining(['uR4-uS4', 'uQ3-uR2']));
  });

  it('replays: the actions are an ordinary recording', () => {
    const { actions, state } = load('melee');
    const again = load('melee');
    expect(again.actions).toEqual(actions);
    expect(again.state).toEqual(state);
  });
});

describe('dev fixtures on other scenarios', () => {
  /** A fresh game of the fixture's own scenario with its actions applied. */
  const loadOn = (id: string) => {
    const fx = DEV_FIXTURES.find((f) => f.id === id)!;
    const g = newGame(scenarioById(fx.scenarioId)!, 'fixture-test');
    let state = g.state;
    for (const a of fixtureActions(g.engine, g.state, id)) state = g.engine.submit(state, a).state;
    return { engine: g.engine, state };
  };
  it('builds every fixture of a scenario other than the test bed', () => {
    for (const fx of DEV_FIXTURES.filter((f) => f.scenarioId !== ASL_TESTBED_SCENARIO.id)) expect(() => loadOn(fx.id), fx.id).not.toThrow();
  });
  it('s19-hs-mg-group: the two half-squads fire their LMGs as one Fire Group, not with their own FP too (SK1 4.0)', () => {
    const { engine, state } = loadOn('s19-hs-mg-group');
    expect(state.phase).toBe('DFPh');
    const hs = Object.values(state.pieces).filter((p) => p.defId === 'ge.238h' && p.loc.kind === 'hex').map((p) => p.id).sort();
    const lmgs = Object.values(state.pieces).filter((p) => p.defId === 'ge.LMG' && p.loc.kind === 'held' && hs.includes(p.loc.by)).map((p) => p.id).sort();
    expect(hs).toHaveLength(2);
    expect(lmgs).toHaveLength(2);
    const illegal = (units: string[]) => engine.env(state).query('fire.illegal', { decl: { units, sw: lmgs, target: 'yZ7' }, mode: 'final', side: 'ge' }, null);
    expect(illegal([])).toBeNull();
    expect(illegal(hs)).toMatch(/half-squad firing a weapon forfeits its own FP/);
  });
  it('demo-mortar-moved: the Mortar that moved cannot fire in the AFPh, whatever the target', () => {
    const { engine, state } = loadOn('demo-mortar-moved');
    expect(state.phase).toBe('AFPh');
    const mtr = Object.values(state.pieces).find((p) => p.defId === 'ge.MTR')!;
    expect(ordnanceWeaponIllegal(engine.env(state), mtr.id, 'advancing', 'ge')).toMatch(/Mortar that moved cannot fire in the AFPh/);
    // The PaK 40 crew that did not move may.
    const pak = Object.values(state.pieces).find((p) => p.defId === 'ge.AT75L')!;
    expect(ordnanceWeaponIllegal(engine.env(state), pak.id, 'advancing', 'ge')).toBeNull();
  });
});
