import { describe, expect, it } from 'vitest';
import { ASL_TESTBED_SCENARIO, BPV, COUNTERS, DEV_FIXTURES, SK1_COUNTER_IDS, SK2_COUNTER_IDS, SK3_COUNTER_IDS, TESTBED_FORTIFIED, TESTBED_HILL_HEXES, TESTBED_VC_BUILDINGS, buildingAt, fixtureActions, fixturesFor, newGame, scenarioById, staticsFor } from '../src';
import type { Action } from '@asl/engine';
import { hasWa, hullDownToFirer, breachIllegal, ccHexes, controlState, fortificationView, mineTbThrough, redactState, routRequirement, shotContext, trailBreaksAt, fortifiableBuildings, fortifiableLocations, fortifiedKnownTo, fortifiedState, fortifyIllegal, moveState, ordnanceWeaponIllegal } from '@asl/rules';

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

  it('lets the Russians secretly fortify exactly four building Locations of their setup area, the ground before an upper level', () => {
    const g = newGame(sc, 'fortify');
    const env = g.engine.env(g.state);
    expect(g.engine.currentDecision(g.state)).toMatchObject({ kind: 'fortify', owner: 'ru', data: { count: 4, unit: 'location', exact: true } });
    const choices = fortifiableLocations(env, 'ru');
    expect(choices).toEqual(expect.arrayContaining(['uK4', 'uK4:1', ...TESTBED_FORTIFIED]));
    expect(choices.some((l) => l.startsWith('uV8'))).toBe(false);
    expect(fortifyIllegal(env, 'ru', { locations: TESTBED_FORTIFIED })).toBeNull();
    expect(fortifyIllegal(env, 'ru', { locations: ['uP2', 'uP3', 'uK4'] })).toMatch(/Choose 4/);
    expect(fortifyIllegal(env, 'ru', { locations: ['uP2:1', 'uP3', 'uP3:1', 'uK4'] })).toMatch(/B23.912/);
    expect(fortifiableBuildings(env, 'ru')).toContain(buildingAt('u', 'uK4'));
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
    expect(fixturesFor('asl-testbed').map((f) => f.id)).toEqual(['kindling', 'start', 'melee', 'building-assault', 'two-story-house', 'los-heights', 'orchard-road', 'bypass', 'fortified-breach', 'breach-unknown', 'fortified-hidden', 'fort-setup', 'fort-owner', 'fort-placed', 'entrench', 'foxhole-fight', 'trench-move', 'foxhole-hidden', 'snap-shot', 'mines-walk', 'mines-leave', 'mines-own', 'mines-advance', 'mines-clear', 'mines-hip', 'pb-hidden', 'deploy-setup', 'deploy-rph', 'deploy-ru']);
    expect(fixturesFor('asl-testbed-deploy').map((f) => f.id)).toEqual(['recombine-ru', 'recombine-foxhole', 'deploy-offboard']);
    expect(fixturesFor('asl-testbed-fire').map((f) => f.id)).toEqual(['blaze-spread', 'flame-clearance', 'pb-blaze']);
    expect(fixturesFor('asl-testbed-mines').map((f) => f.id)).toEqual(['mines-tb', 'mines-armor', 'mines-belt', 'booby-traps', 'mines-rout']);
    expect(fixturesFor('asl-testbed-pillbox').map((f) => f.id)).toEqual(['pb-enter', 'pb-assault', 'pb-armor', 'pb-rout', 'pb-cc', 'pb-control', 'pb-bunker', 'pb-gun']);
    expect(DEV_FIXTURES.every((f) => f.title && f.description)).toBe(true);
  });

  it('start: both sides set up, P2-P3 fortified, German Turn 1 RPh', () => {
    const { engine, state, env } = load('start');
    expect([state.phase, state.turn, state.attacker]).toEqual(['RPh', 1, 'ge']);
    expect(engine.currentDecision(state)?.owner).toBe('ge');
    expect(fortifiedState(env)?.locations).toEqual(TESTBED_FORTIFIED);
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
    expect(fortifiedState(env)?.locations).toEqual(TESTBED_FORTIFIED);
  });

  it('fortified-breach: P3 is revealed fortified, the Breach is offered to the DC in Q3, and the Russian 5-2-7 is still inside', () => {
    const { engine, state, env } = load('fortified-breach');
    expect([state.phase, state.turn, state.attacker]).toEqual(['MPh', 2, 'ge']);
    expect(fortifiedKnownTo(env, 'uP3', 'ge')).toBe(true);
    expect(fortifiedKnownTo(env, 'uP2', 'ge')).toBe(false);
    const ae = Object.values(state.pieces).find((p) => p.defId === 'ge.838')!;
    const dc = Object.values(state.pieces).find((p) => p.defId === 'ge.DC')!;
    expect(hexOf(state, ae.id)).toBe('uQ3');
    expect(Object.values(state.pieces).find((p) => p.defId === 'ge.548')!.tags['advanced']).toBeUndefined();
    const s = engine.submit(state, { side: 'ge', decisionId: engine.currentDecision(state)!.id, type: 'move.start', units: [ae.id] } as Action).state;
    // P3, shown fortified, and P2 beside it, which may be (B23.9221: an attempt needs no knowledge of it).
    expect(engine.legalActions(s, 'ge').filter((a) => a.type === 'move.breach').map((a) => [a['dc'], a['target']]).sort()).toEqual([[dc.id, 'uP2'], [dc.id, 'uP3']]);
  });

  it('breach-unknown: P3 is fortified but not shown, and the Breach is offered to the DC in Q3 all the same (B23.9221)', () => {
    const { engine, state, env } = load('breach-unknown');
    expect([state.phase, state.turn, state.attacker]).toEqual(['MPh', 2, 'ge']);
    expect(fortifiedKnownTo(env, 'uP3', 'ge')).toBe(false);
    const ae = Object.values(state.pieces).find((p) => p.defId === 'ge.838')!;
    const dc = Object.values(state.pieces).find((p) => p.defId === 'ge.DC')!;
    expect(hexOf(state, ae.id)).toBe('uQ3');
    expect(hexOf(state, Object.values(state.pieces).find((p) => p.defId === 'ru.527')!.id)).toBe('uP3');
    const s = engine.submit(state, { side: 'ge', decisionId: engine.currentDecision(state)!.id, type: 'move.start', units: [ae.id] } as Action).state;
    expect(engine.legalActions(s, 'ge').filter((a) => a.type === 'move.breach')).toContainEqual(expect.objectContaining({ dc: dc.id, target: 'uP3' }));
    // R3, a house the Russians could not fortify (outside their setup area): refused, with the reason the wheel shows.
    const ms = moveState(engine.env(s))!;
    expect(breachIllegal(engine.env(s), ms, dc.id, 'uR3')).toMatch(/not fortified, as far as your side can tell.*B23.9221/);
  });

  it('fortified-hidden: the 5-2-7 is hidden in P3 and the German stack in Q4 may try to enter', () => {
    const { engine, state } = load('fortified-hidden');
    expect([state.phase, state.turn, state.attacker]).toEqual(['MPh', 2, 'ge']);
    const r = Object.values(state.pieces).find((p) => p.defId === 'ru.527')!;
    expect(hexOf(state, r.id)).toBe('uP3');
    expect(r.tags['hip']).toBe(true);
    const l = Object.values(state.pieces).find((p) => p.defId === 'ge.L80')!;
    expect(hexOf(state, l.id)).toBe('uQ4');
    const s = engine.submit(state, { side: 'ge', decisionId: engine.currentDecision(state)!.id, type: 'move.start', units: [l.id] } as Action).state;
    expect(engine.legalActions(s, 'ge').some((a) => a.type === 'move.step' && a['to'] === 'uP3')).toBe(true);
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

  it('snap-shot: entering R3 from R4, the Russians are asked; N3 sees the whole R3-R4 hexside but not R3 (ASLRB A8.15)', () => {
    const { engine, state } = load('snap-shot');
    expect([state.phase, state.turn, state.attacker]).toEqual(['MPh', 2, 'ge']);
    const stack = Object.values(state.pieces).filter((p) => p.side === 'ge' && p.loc.kind === 'hex' && p.loc.hex === 'uR4');
    const n3 = Object.values(state.pieces).find((p) => p.side === 'ru' && p.loc.kind === 'hex' && p.loc.hex === 'uN3')!;
    const sub = (s: typeof state, a: Record<string, unknown>) => engine.submit(s, { side: engine.currentDecision(s)!.owner, decisionId: engine.currentDecision(s)!.id, ...a } as never).state;
    let s = sub(state, { type: 'move.start', units: stack.map((p) => p.id) });
    s = sub(s, { type: 'move.step', to: 'uR3' });
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'firstFire', owner: 'ru' });
    const env = engine.env(s);
    expect(env.query('fire.snapSide', { target: 'uR3' }, null)).toEqual(['uR3', 'uR4']);
    const los = (decl: { target: string; snap?: [string, string] }) => env.query('fire.los', { from: 'uN3', decl }, env.query('los.trace', { from: 'uN3', to: 'uR3' }, { clear: true, hindrance: 0, parts: [] }));
    expect(los({ target: 'uR3' }).clear).toBe(false);
    expect(los({ target: 'uR3', snap: ['uR3', 'uR4'] }).clear).toBe(true);
    expect(engine.validate(s, { side: 'ru', decisionId: engine.currentDecision(s)!.id, type: 'defFire', decl: { units: [n3.id], sw: [], target: 'uR3', snap: ['uR3', 'uR4'] } } as never)).toBeNull();
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
  }, 120_000);
  it('mg-vs-afv: the German MMG may fire at the Sherman as ordnance, on the Vehicle Target Type only (SK4 4.1)', () => {
    const { engine, state } = loadOn('mg-vs-afv');
    expect([state.phase, state.attacker]).toEqual(['PFPh', 'ge']);
    const tank = Object.values(state.pieces).find((p) => p.defId === 'am.M4A3')!;
    expect(tank.loc).toEqual({ kind: 'hex', hex: 'vE6' });
    const mmg = Object.values(state.pieces).find((p) => p.defId === 'ge.MMG')!;
    const env = engine.env(state);
    expect(env.query('ordnance.illegal', { shot: { weapon: mmg.id, target: 'vE6', targetType: 'VTT' }, mode: 'prep', side: 'ge' }, null)).toBeNull();
    expect(env.query('ordnance.illegal', { shot: { weapon: mmg.id, target: 'vE6', targetType: 'ITT' }, mode: 'prep', side: 'ge' }, null)).toMatch(/only at an AFV/);
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

describe('minefield fixtures (B28, B24.74)', () => {
  const NINE = ['ge.L92', 'ge.838', 'ge.548'];
  const loadOn = (id: string) => {
    const fx = DEV_FIXTURES.find((f) => f.id === id)!;
    const g = newGame(scenarioById(fx.scenarioId)!, 'fixture-test');
    let state = g.state;
    for (const a of fixtureActions(g.engine, g.state, id)) state = g.engine.submit(state, a).state;
    return { engine: g.engine, state, env: g.engine.env(state) };
  };
  const at = (state: ReturnType<typeof loadOn>['state'], hex: string) => Object.values(state.pieces).filter((p) => p.loc.kind === 'hex' && p.loc.hex === hex).map((p) => p.defId).sort();

  it('mines-walk: German Turn 2 MPh, the 4-6-7 beside P10 and the 9-2 stack in P8; P10 still unseen by the Germans', () => {
    const { state, env } = loadOn('mines-walk');
    expect([state.phase, state.turn, state.attacker]).toEqual(['MPh', 2, 'ge']);
    expect(at(state, 'uQ10')).toContain('ge.467');
    expect(at(state, 'uP8')).toEqual(expect.arrayContaining(['ge.L92', 'ge.838', 'ge.548']));
    expect(fortificationView(env, 'ge').some((c) => c.hex === 'uP10')).toBe(false);
  });

  it('mines-leave: Russian Turn 1 MPh with a 4-4-7 set up in its own Known minefield N9; moving out draws the exit attack', () => {
    const { engine, state } = loadOn('mines-leave');
    expect([state.phase, state.turn, state.attacker]).toEqual(['MPh', 1, 'ru']);
    const squad = Object.values(state.pieces).find((p) => p.loc.kind === 'hex' && p.loc.hex === 'uN9')!.id;
    let s = engine.submit(state, { type: 'move.start', units: [squad], side: 'ru', decisionId: engine.currentDecision(state)!.id } as never).state;
    const r = engine.submit(s, { type: 'move.step', to: 'uM10', side: 'ru', decisionId: engine.currentDecision(s)!.id } as never);
    expect(r.events.find((e) => e.type === 'asl.mines.attack')?.payload).toMatchObject({ hex: 'uN9', way: 'exit' });
    s = r.state;
  });

  it('mines-own: Russian Turn 1 MPh with a 4-4-7 in O10 beside its own hidden minefield', () => {
    const { state } = loadOn('mines-own');
    expect([state.phase, state.turn, state.attacker]).toEqual(['MPh', 1, 'ru']);
    expect(at(state, 'uO10')).toContain('ru.447');
  });

  it('mines-advance and mines-tb: the 9-2 stack in O9 beside N9; on the minefield test bed N9 has its Trail Break', () => {
    const adv = loadOn('mines-advance');
    expect([adv.state.phase, adv.state.turn]).toEqual(['APh', 2]);
    expect(at(adv.state, 'uO9')).toEqual(expect.arrayContaining(['ge.L92']));
    const tb = loadOn('mines-tb');
    expect(tb.state.phase).toBe('MPh');
    expect(trailBreaksAt(tb.env, 'uN9')).toEqual([[2, 5]]);
    expect(mineTbThrough(tb.env, 'uN9', 'uO9')).toEqual([2, 5]);
  });

  it('mines-clear: the 4-4-7 in N9 may declare Clearance without MF; the one in M10 may enter to clear', () => {
    const { engine, state } = loadOn('mines-clear');
    expect([state.phase, state.turn, state.attacker]).toEqual(['MPh', 1, 'ru']);
    expect(engine.legalActions(state, 'ru').filter((a) => a.type === 'clearance.declare' && a['kind'] === 'mines')).toHaveLength(1);
    const squad = Object.values(state.pieces).find((p) => p.loc.kind === 'hex' && p.loc.hex === 'uM10')!.id;
    const s = engine.submit(state, { type: 'move.start', units: [squad], side: 'ru', decisionId: engine.currentDecision(state)!.id } as never).state;
    expect(engine.legalActions(s, 'ru').some((a) => a.type === 'move.step' && a['to'] === 'uN9' && a['mines'] === 'clear')).toBe(true);
  });

  it('mines-armor: the PzKpfw IVF2 and PSW 234/1 at the east edge, open A-T mines on the paved road at P8 for both to see', () => {
    const { state, env } = loadOn('mines-armor');
    expect([state.phase, state.turn, state.attacker]).toEqual(['MPh', 1, 'ge']);
    expect(at(state, 'uS10')).toContain('ge.pzivf2');
    expect(fortificationView(env, 'ge').find((c) => c.hex === 'uP8')?.mines?.at).toBe(2);
  });

  it('mines-rout: German Turn 1 RtPh, the two Russian 4-4-7s broken in P10 and O10; some rout end lies only through the Known minefield', () => {
    const { engine, state, env } = loadOn('mines-rout');
    expect([state.phase, state.turn, state.attacker]).toEqual(['RtPh', 1, 'ge']);
    const broken = Object.values(state.pieces).filter((p) => p.side === 'ru' && p.tags['broken'] === true && p.loc.kind === 'hex').map((p) => (p.loc as { hex: string }).hex).sort();
    expect(broken).toEqual(['uO10', 'uP10']);
    expect(engine.currentDecision(state)?.owner).toBe('ru');
    const squad = Object.values(state.pieces).find((p) => p.loc.kind === 'hex' && p.loc.hex === 'uP10')!.id;
    // From P10 the move out is an exit attack in its own minefield.
    const out = engine.legalActions(state, 'ru').find((a) => a.type === 'rout.step' && a['unit'] === squad)!;
    const r = engine.submit(state, out);
    expect(r.events.find((e) => e.type === 'asl.mines.attack')?.payload).toMatchObject({ hex: 'uP10', way: 'exit', by: 'rout' });
    void env;
  });

  it('mines-hip: German Turn 2 MPh, the 9-2 stack in O9, the recorded minefield in O10 and the 5-2-7 hidden in N10', () => {
    const { engine, state, env } = loadOn('mines-hip');
    expect([state.phase, state.turn, state.attacker]).toEqual(['MPh', 2, 'ge']);
    expect(at(state, 'uO9')).toEqual(expect.arrayContaining(['ge.L92', 'ge.838', 'ge.548']));
    const hid = Object.values(state.pieces).find((p) => p.defId === 'ru.527')!;
    expect([hid.loc.kind === 'hex' && hid.loc.hex, hid.tags['hip']]).toEqual(['uN10', true]);
    expect(fortificationView(env, 'ge').some((c) => c.hex === 'uO10')).toBe(false);
    // Played on with fixed dice: into O10 (entry attack), then N10: exit attack, the bounce, the re-entry attack.
    const units = NINE.map((d) => Object.values(state.pieces).find((p) => p.defId === d)!.id);
    engine.forceDice(6, 6, 6, 6, 6, 6, 6, 6, 6, 6);
    let s = engine.submit(state, { type: 'move.start', units, side: 'ge', decisionId: engine.currentDecision(state)!.id } as never).state;
    const step = (to: string) => {
      const r = engine.submit(s, { type: 'move.step', to, side: 'ge', decisionId: engine.currentDecision(s)!.id } as never);
      s = r.state;
      while (engine.currentDecision(s)?.kind === 'firstFire') s = engine.submit(s, { type: 'defPass', side: 'ru', decisionId: engine.currentDecision(s)!.id } as never).state;
      return r.events.filter((e) => e.type === 'asl.mines.attack').map((e) => [(e.payload as { hex: string }).hex, (e.payload as { way: string }).way]);
    };
    expect(step('uO10')).toEqual([['uO10', 'enter']]);
    expect(step('uN10')).toEqual([['uO10', 'exit'], ['uO10', 'enter']]);
  });

  it('mines-belt and booby-traps load', () => {
    expect(loadOn('mines-belt').state.phase).toBe('setup');
    const bt = loadOn('booby-traps');
    expect([bt.state.phase, bt.state.attacker]).toEqual(['MPh', 'ge']);
  });
});

describe('pillbox fixtures (ASLRB B30)', () => {
  const loadOn = (id: string) => {
    const fx = DEV_FIXTURES.find((f) => f.id === id)!;
    const g = newGame(scenarioById(fx.scenarioId)!, 'fixture-test');
    let state = g.state;
    for (const a of fixtureActions(g.engine, g.state, id)) state = g.engine.submit(state, a).state;
    return { engine: g.engine, state, env: g.engine.env(state) };
  };
  const unitAt = (state: { pieces: Record<string, { defId: string; side: string; loc: { kind: string; hex?: string; sub?: string } }> }, def: string, n = 1) =>
    Object.entries(state.pieces).filter(([, p]) => p.defId === def).sort(([a], [b]) => (a < b ? -1 : 1))[n - 1]![0];
  const act = (engine: ReturnType<typeof loadOn>['engine'], s: ReturnType<typeof loadOn>['state'], a: Record<string, unknown>) => {
    const d = engine.currentDecision(s)!;
    return engine.submit(s, { ...a, side: d.owner, decisionId: d.id } as never).state;
  };
  const settle = (engine: ReturnType<typeof loadOn>['engine'], s: ReturnType<typeof loadOn>['state'], side: string) => {
    let x = s;
    for (let i = 0; i < 20 && engine.currentDecision(x)?.owner !== side; i++) x = act(engine, x, { type: 'defPass' });
    return x;
  };

  it('pb-enter: the Russian 4-4-7 walks O7, P6 and into the empty pillbox, one MF each, the German in R5 offered First Fire', () => {
    const { engine, state } = loadOn('pb-enter');
    expect([state.phase, state.turn, state.attacker]).toEqual(['MPh', 1, 'ru']);
    const sq = unitAt(state, 'ru.447', 3);
    let s = act(engine, state, { type: 'move.start', units: [sq] });
    s = settle(engine, act(engine, s, { type: 'move.step', to: 'uO7' }), 'ru');
    s = settle(engine, act(engine, s, { type: 'move.step', to: 'uP6' }), 'ru');
    s = act(engine, s, { type: 'move.step', to: 'uP6:pb' });
    expect(s.pieces[sq]!.loc).toEqual({ kind: 'hex', hex: 'uP6', sub: 'pb' });
    expect(moveState(engine.env(s))!.spent[sq]).toBe(3);
  });

  it('pb-hidden: neither the pillbox nor the 4-5-8 inside is on the German board; the walk to P4 reveals the pillbox, not its contents', () => {
    const { engine, state } = loadOn('pb-hidden');
    expect([state.phase, state.turn, state.attacker]).toEqual(['MPh', 1, 'ge']);
    const sq = unitAt(state, 'ru.458', 1);
    expect(redactState(engine, state, 'ge').pieces[sq]).toBeUndefined();
    expect(fortificationView(engine.env(state), 'ge').some((c) => c.kind === 'pillbox')).toBe(false);
    let s = act(engine, state, { type: 'move.start', units: [unitAt(state, 'ge.467', 2)] });
    for (const h of ['uS4', 'uR4', 'uQ4', 'uP4']) s = settle(engine, act(engine, s, { type: 'move.step', to: h }), 'ge');
    expect(fortificationView(engine.env(s), 'ge').some((c) => c.kind === 'pillbox' && c.hex === 'uO3')).toBe(true);
    expect(redactState(engine, s, 'ge').pieces[sq]).toBeUndefined();
  });

  it('pb-assault: German Turn 2 MPh, the 9-2 stack in R6 in the Covered Arc; the German sees the pillbox occupied, not the 4-5-8', () => {
    const { engine, state } = loadOn('pb-assault');
    expect([state.phase, state.turn, state.attacker]).toEqual(['MPh', 2, 'ge']);
    expect(state.pieces[unitAt(state, 'ge.838')]!.loc).toMatchObject({ hex: 'uR6' });
    const sq = unitAt(state, 'ru.458', 2);
    expect(state.pieces[sq]!.loc).toEqual({ kind: 'hex', hex: 'uP6', sub: 'pb' });
    const theirs = redactState(engine, state, 'ge');
    expect(theirs.pieces[sq]).toBeUndefined();
    expect((theirs.ext['asl.fortifications'] as { counters: { kind: string; occupied?: true }[] }).counters.find((c) => c.kind === 'pillbox')).toMatchObject({ occupied: true });
  });

  it('pb-armor: the PzKpfw IVF2 in T5 fires through the Covered Arc (+3), the PSW 234/1 in S9 through the NCA (+5)', () => {
    const { engine, state, env } = loadOn('pb-armor');
    expect([state.phase, state.turn, state.attacker]).toEqual(['PFPh', 1, 'ge']);
    const tk = unitAt(state, 'ge.pzivf2');
    const ac = unitAt(state, 'ge.psw2341');
    const labels = (weapon: string) => env.explain('ordnance.thDrm', shotContext(env, { weapon, target: 'uP6:pb', targetType: 'ITT' }, 'prep', 'ge'), 0).trace.filter((e) => !e.suppressedBy && e.before !== e.after).map((e) => e.label ?? e.id);
    expect(labels(tk).some((l) => /\+3 pillbox CA/.test(l))).toBe(true);
    expect(labels(ac).some((l) => /\+5 pillbox NCA/.test(l))).toBe(true);
    void engine;
  });

  it('pb-rout: the broken 4-5-8 inside the O6 pillbox, the German beside it in the arc, is not forced to rout', () => {
    const { state, env } = loadOn('pb-rout');
    expect([state.phase, state.turn, state.attacker]).toEqual(['RtPh', 1, 'ge']);
    const sq = unitAt(state, 'ru.458', 2);
    expect(state.pieces[sq]!.tags['broken']).toBe(true);
    expect(routRequirement(env, state.pieces[sq]! as never)).toBeNull();
  });

  it('pb-cc: the German may advance into P6 beside the pillbox; in the CCPh the CC is across the pillbox', () => {
    const { engine, state } = loadOn('pb-cc');
    expect([state.phase, state.turn, state.attacker]).toEqual(['APh', 1, 'ge']);
    const g = unitAt(state, 'ge.467', 3);
    const s = act(engine, state, { type: 'advance', units: [g], to: 'uP6' });
    const cc = act(engine, s, { type: 'endPhase' });
    expect(cc.phase).toBe('CCPh');
    expect(ccHexes(engine.env(cc))).toEqual(['uP6']);
  });

  it('pb-control: the German on the ground of P6 does not Control the hex while the pillbox is Russian; entering it takes both', () => {
    const { engine, state, env } = loadOn('pb-control');
    expect([state.phase, state.turn, state.attacker]).toEqual(['MPh', 2, 'ge']);
    expect(controlState(env).hexes['uP6']).not.toBe('ge');
    expect(controlState(env).locations?.['uP6:pb']).toBe('ru');
    const g = unitAt(state, 'ge.467', 3);
    let s = act(engine, state, { type: 'move.start', units: [g] });
    s = settle(engine, act(engine, s, { type: 'move.step', to: 'uP6:pb' }), 'ge');
    expect(controlState(engine.env(s)).hexes['uP6']).toBe('ge');
  });

  it('pb-bunker: the Conscripts beneath the O7 trench go straight into the bunker for one MF', () => {
    const { engine, state } = loadOn('pb-bunker');
    expect([state.phase, state.turn, state.attacker]).toEqual(['MPh', 1, 'ru']);
    const c = unitAt(state, 'ru.426', 1);
    let s = act(engine, state, { type: 'move.start', units: [c] });
    s = act(engine, s, { type: 'move.step', to: 'uP6:pb' });
    expect(s.pieces[c]!.loc).toEqual({ kind: 'hex', hex: 'uP6', sub: 'pb' });
    expect(moveState(engine.env(s))!.spent[c]).toBe(1);
  });

  it("pb-gun: the 45L AT Gun and crew inside the P6 pillbox, hidden with it, the Gun in the pillbox's Covered Arc", () => {
    const { engine, state } = loadOn('pb-gun');
    const gun = unitAt(state, 'ru.AT45L');
    const crew = unitAt(state, 'ru.228c');
    expect(state.pieces[crew]!.loc).toEqual({ kind: 'hex', hex: 'uP6', sub: 'pb' });
    expect(state.pieces[gun]!.tags['ca']).toBe(1);
    expect(state.pieces[crew]!.tags['hip']).toBe(true);
    expect(redactState(engine, state, 'ge').pieces[crew]).toBeUndefined();
  });

  it('pb-blaze: the pillbox in M2 beside the M3 Blaze, the 4-4-7 inside', () => {
    const { state } = loadOn('pb-blaze');
    expect([state.phase, state.turn, state.attacker]).toEqual(['PFPh', 1, 'ge']);
    expect(state.pieces[unitAt(state, 'ru.447', 2)]!.loc).toEqual({ kind: 'hex', hex: 'uM2', sub: 'pb' });
  });
});

describe('vehicle and fortification fixtures (ASLRB B27.43, B27.52, B9.36, C10.3, B26.43)', () => {
  const loadOn = (id: string) => {
    const fx = DEV_FIXTURES.find((f) => f.id === id)!;
    const g = newGame(scenarioById(fx.scenarioId)!, 'fixture-test');
    let state = g.state;
    for (const a of fixtureActions(g.engine, g.state, id)) state = g.engine.submit(state, a).state;
    return { engine: g.engine, state, env: g.engine.env(state) };
  };
  const unitAt = (state: { pieces: Record<string, { defId: string }> }, def: string, n = 1) =>
    Object.entries(state.pieces).filter(([, p]) => p.defId === def).sort(([a], [b]) => (a < b ? -1 : 1))[n - 1]![0];
  const legalOf = (engine: ReturnType<typeof loadOn>['engine'], s: ReturnType<typeof loadOn>['state'], type: string) => engine.legalActions(s, engine.currentDecision(s)!.owner).filter((a) => a.type === type);

  it('lists the T5 fixtures', () => {
    expect(fixturesFor('asl-testbed-vehicles').map((f) => f.id)).toEqual(['trench-tank', 'trench-tank-woods', 'trench-tank-hidden', 'foxhole-car', 'roadblock-armor', 'gun-push', 'wire-armor', 'mortar-armor']);
  });

  it('trench-tank: the T-34 and a 4-5-8 beneath the P6 trench, HD to the PzKpfw IVF2 in T6; it may not start, turn or fire its BMG at it', () => {
    const { engine, state, env } = loadOn('trench-tank');
    expect([state.phase, state.turn, state.attacker]).toEqual(['PFPh', 1, 'ge']);
    const t34 = unitAt(state, 'ru.T34M41');
    const pz = unitAt(state, 'ge.pzivf2');
    expect(state.pieces[t34]!.loc).toEqual({ kind: 'hex', hex: 'uP6', pos: { ent: 'trench' } });
    expect(state.pieces[unitAt(state, 'ru.458', 2)]!.loc).toEqual({ kind: 'hex', hex: 'uP6', pos: { ent: 'trench' } });
    expect(hullDownToFirer(env, t34, pz)).toMatchObject({ kind: 'trench' });
    expect(env.query('vehicle.cannotTurn', { vehicle: t34 }, null)).toMatch(/B27.52/);
    expect(env.query('fire.illegal', { decl: { units: [], sw: [`${t34}.bmg`].filter((id) => state.pieces[id]), target: 'uT6' }, mode: 'prep', side: 'ru' }, null) ?? 'none').toBeTruthy();
    expect(legalOf(engine, state, 'fire.ordnance').some((a) => (a['shot'] as { weapon: string; target: string; targetType: string }).weapon === pz && (a['shot'] as { targetType: string }).targetType === 'VTT')).toBe(true);
  });

  it('trench-tank-woods: the IVF2\'s shot at the T-34 beneath the N10 trench waits for the Russian choice of HD or the woods TEM', () => {
    const { engine, state } = loadOn('trench-tank-woods');
    const pz = unitAt(state, 'ge.pzivf2');
    const shot = legalOf(engine, state, 'fire.ordnance').find((a) => (a['shot'] as { weapon: string; target: string; targetType: string }).weapon === pz && (a['shot'] as { target: string }).target === 'uN10' && (a['shot'] as { targetType: string }).targetType === 'VTT')!;
    const d = engine.currentDecision(state)!;
    const r = engine.submit(state, { ...shot, side: d.owner, decisionId: d.id } as never);
    expect(engine.currentDecision(r.state)).toMatchObject({ kind: 'hdChoice', owner: 'ru', data: { kind: 'trench', tem: 1 } });
  });

  it('trench-tank-hidden: the German seat sees the T-34 in L10 and no trench; a German within 16 hexes with a LOS reveals it', () => {
    const { engine, state, env } = loadOn('trench-tank-hidden');
    expect([state.phase, state.turn, state.attacker]).toEqual(['MPh', 1, 'ge']);
    const t34 = unitAt(state, 'ru.T34M41');
    expect(fortificationView(env, 'ge').some((c) => c.hex === 'uL10')).toBe(false);
    expect(redactState(engine, state, 'ge').pieces[t34]!.loc).toEqual({ kind: 'hex', hex: 'uL10' });
    expect(redactState(engine, state, 'ru').pieces[t34]!.loc).toEqual({ kind: 'hex', hex: 'uL10', pos: { ent: 'trench' } });
  });

  it('foxhole-car: the PSW 234/1 in P10 beside the O10 foxhole pays 2 MP more to enter it', () => {
    const { state, env } = loadOn('foxhole-car');
    expect([state.phase, state.turn, state.attacker]).toEqual(['MPh', 2, 'ge']);
    const ac = unitAt(state, 'ge.psw2341');
    expect(state.pieces[ac]!.loc).toEqual({ kind: 'hex', hex: 'uP10' });
    expect(env.query('vehicle.extraMp', { vehicle: ac, hex: 'uO10' }, 0)).toBe(2);
    expect(env.query('vehicle.extraMp', { vehicle: unitAt(state, 'ge.pzivf2'), hex: 'uO10' }, 0)).toBe(0);
  });

  it('roadblock-armor: the T-34 in O9 holds WA behind the roadblock and is HD to the PzKpfw IVF2 in R7 across it', () => {
    const { state, env } = loadOn('roadblock-armor');
    expect([state.phase, state.turn, state.attacker]).toEqual(['PFPh', 2, 'ge']);
    const t34 = unitAt(state, 'ru.T34M41');
    const pz = unitAt(state, 'ge.pzivf2');
    expect(state.pieces[t34]!.loc).toEqual({ kind: 'hex', hex: 'uO9' });
    expect(state.pieces[pz]!.loc).toEqual({ kind: 'hex', hex: 'uR7' });
    expect(hasWa(env, state.pieces[t34]!)).toBe(true);
    expect(hullDownToFirer(env, t34, pz)).toMatchObject({ kind: 'wall' });
  });

  it('gun-push: the crew, the Gun and a 4-4-7 in P8; the push into O9 takes the roadblock hexside +2', () => {
    const { state, env } = loadOn('gun-push');
    expect([state.phase, state.turn, state.attacker]).toEqual(['MPh', 1, 'ru']);
    const crew = unitAt(state, 'ru.228c');
    const gun = unitAt(state, 'ru.AT45L');
    const helper = unitAt(state, 'ru.447', 3);
    expect(state.pieces[crew]!.loc).toEqual({ kind: 'hex', hex: 'uP8' });
    const drm = (to: string) => env.explain('manhandle.drm', { gun, units: [crew, helper], from: 'uP8', to, cost: 2 }, 0);
    expect(drm('uO9').trace.some((t) => t.id === 'asl.manhandle.hexside')).toBe(true);
    expect(drm('uP9').trace.some((t) => t.id === 'asl.manhandle.hexside')).toBe(false);
  });

  it('wire-armor: the IVF2 in Q9 beside the P9 Wire pays 2 MP more and checks for Bog at +2 entering it', () => {
    const { state, env } = loadOn('wire-armor');
    expect([state.phase, state.turn, state.attacker]).toEqual(['MPh', 2, 'ge']);
    const pz = unitAt(state, 'ge.pzivf2');
    expect(state.pieces[pz]!.loc).toEqual({ kind: 'hex', hex: 'uQ9' });
    expect(env.query('vehicle.extraMp', { vehicle: pz, hex: 'uP9' }, 0)).toBe(2);
    expect(env.query('vehicle.bogIn', { vehicle: pz, hex: 'uP9', turn: false }, false)).toBe(true);
  });

  it('mortar-armor: the Mortar\'s Area Target Type shot at O6 targets the 4-4-7 and the stopped CE T-34; the IVF2\'s Infantry Target Type shot targets the squad and the CE crew', () => {
    const { engine, state } = loadOn('mortar-armor');
    expect([state.phase, state.turn, state.attacker]).toEqual(['PFPh', 2, 'ge']);
    const t34 = unitAt(state, 'ru.T34M41');
    const sq = unitAt(state, 'ru.447', 3);
    const mtr = unitAt(state, 'ge.MTR');
    const pz = unitAt(state, 'ge.pzivf2');
    expect(state.pieces[t34]!.loc).toEqual({ kind: 'hex', hex: 'uO6' });
    expect(state.pieces[sq]!.loc).toEqual({ kind: 'hex', hex: 'uO6' });
    expect(state.pieces[t34]!.tags['ce']).toBe(true);
    expect(state.pieces[unitAt(state, 'ge.468')]!.loc).toEqual({ kind: 'hex', hex: 'uS7' });
    type Shot = { weapon: string; target: string; targetType: string; ammo?: string };
    const shots = legalOf(engine, state, 'fire.ordnance').map((a) => a['shot'] as Shot).filter((x) => x.target === 'uO6');
    const att = shots.find((x) => x.weapon === mtr && x.targetType === 'ATT')!;
    const itt = shots.find((x) => x.weapon === pz && x.targetType === 'ITT' && x.ammo === undefined)!;
    expect(att && itt).toBeTruthy();
    const fire = (shot: Shot) => {
      const d = engine.currentDecision(state)!;
      const r = engine.submit(state, { type: 'fire.ordnance', shot, side: d.owner, decisionId: d.id } as never);
      return r.events.find((e) => e.type === 'sk2.ordnance.shot')!.payload as { targets: string[] };
    };
    expect(fire(att).targets.sort()).toEqual([sq, t34].sort());
    expect(fire(itt).targets.sort()).toEqual([sq, t34].sort());
  });
});
