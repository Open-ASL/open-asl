import { describe, expect, it } from 'vitest';
import type { Action, GameState } from '@asl/engine';
import { deployIllegal, deployQuota, playerTurnLeftovers, statics, type ScenarioDef } from '@asl/rules';
import { ASL_TESTBED_DEPLOY_SCENARIO, ASL_TESTBED_SCENARIO, FixtureBuilder, fixtureActions, newGame } from '../src';

/*
 * Deployment and Recombination on the test beds (ASLRB A1.31, A1.32, A2.9, A2.52, A25.2): the 10% at setup per group, a
 * Deployment in the German RPh and what the two HS do afterwards across the Player Turns, the Russian HS recombining in
 * the German RPh, and an offboard group deploying before it enters.
 */

/** A fixture's position (`drop`: without its last actions). */
function fixture(scenario: ScenarioDef, id: string, seed = 'deploy-test', drop = 0) {
  const g = newGame(scenario, seed);
  let s = g.state;
  const actions = fixtureActions(g.engine, s, id);
  for (const a of actions.slice(0, actions.length - drop)) s = g.engine.submit(s, a).state;
  return new FixtureBuilder(g.engine, s);
}
const check = (f: FixtureBuilder, a: Record<string, unknown>) => f.engine.validate(f.state, { ...a, side: f.decision.owner, decisionId: f.decision.id } as Action);
const offered = (f: FixtureBuilder, type: string) => f.engine.legalActions(f.state, f.decision.owner).filter((a) => a.type === type);
const rph = (s: GameState) => Object.values(s.pieces).filter((p) => p.tags['rphAction'] !== undefined).map((p) => p.id);
/** Try seeds until the NTC of `deploy` passes (its DR is the game's): the fixture's first seed that does. */
function deployed(scenario: ScenarioDef, id: string, act: (f: FixtureBuilder) => Record<string, unknown>, drop = 0) {
  for (let i = 0; i < 40; i++) {
    const f = fixture(scenario, id, `deploy-${i}`, drop);
    const action = act(f);
    const r = f.engine.submit(f.state, { ...action, side: f.decision.owner, decisionId: f.decision.id } as Action);
    const ev = r.events.find((e) => e.type === 'asl.deploy')?.payload as { passed: boolean; halves?: string[] } | undefined;
    if (ev?.passed) {
      f.state = r.state;
      return { f, halves: ev.halves! };
    }
  }
  throw new Error('no seed passed the NTC');
}

describe('A2.9: Deployment at setup', () => {
  it('T1: the Germans may deploy one of their seven squads before setup, not two; the Russians none (A25.2)', () => {
    const f = fixture(ASL_TESTBED_SCENARIO, 'deploy-setup');
    expect(f.decision).toMatchObject({ kind: 'setup', owner: 'ge' });
    const env = f.engine.env(f.state);
    const squad = f.unit('ge', 'ge.467', 1);
    expect(deployQuota(env, 'ge', squad)).toMatchObject({ max: 1, used: 0, rule: 'A2.9' });
    expect(offered(f, 'setup.deploy')).toHaveLength(7);
    expect(deployIllegal(env, 'ru', f.unit('ru', 'ru.447', 1))).toBe('Russian squads may not Deploy (A25.2)');
    f.act({ type: 'setup.deploy', unit: squad });
    expect(f.state.pieces[squad]!.defId).toBe('ge.247h');
    expect(f.state.pieces[squad]!.tags['deployedAt']).toBe('setup');
    expect(check(f, { type: 'setup.deploy', unit: f.unit('ge', 'ge.447', 1) })).toBe('10% of 7 squads, rounded up: 1 (A2.9)');
    expect(offered(f, 'setup.deploy')).toEqual([]);
  });

  it('a squad deployed at setup may then set up hidden as two HS where the side may hide units (A2.9: before setup limitations and HIP)', () => {
    const scenario: ScenarioDef = {
      ...ASL_TESTBED_SCENARIO,
      ssr: ASL_TESTBED_SCENARIO.ssr.map((r) => (r.module === 'hidden-units' ? { ...r, params: { side: 'ge', quota: 1, notOpenGround: true, rule: 'SSR 2' } } : r)),
    } as ScenarioDef;
    const f = fixture(scenario, 'deploy-setup');
    const squad = f.unit('ge', 'ge.467', 1);
    f.act({ type: 'setup.deploy', unit: squad });
    const second = `${squad}.d`;
    const map = statics(f.engine.env(f.state)).map;
    const area = ASL_TESTBED_SCENARIO.forces.find((x) => x.side === 'ge')!.setup as { hexes: string[] };
    const woods = area.hexes.find((h) => map.hex(h)?.terrain === 'woods')!;
    f.setup('ge', { [squad]: woods, [second]: woods }, {}, { hidden: [squad, second] });
    expect(f.state.pieces[squad]!.tags['hip']).toBe(true);
    expect(f.state.pieces[second]!.tags['hip']).toBe(true);
  });

  it('a card’s own Deployment allowance adds to the 10%: two of seven, then refused', () => {
    const scenario = { ...ASL_TESTBED_SCENARIO, ssr: [...ASL_TESTBED_SCENARIO.ssr, { module: 'setup-deploy', params: { side: 'ge', squads: 1, rule: 'SSR 9' }, text: 'The Germans may Deploy one squad at setup in addition to the normal A2.9 allowance.' }] } as ScenarioDef;
    const f = fixture(scenario, 'deploy-setup');
    expect(deployQuota(f.engine.env(f.state), 'ge', f.unit('ge', 'ge.467', 1))).toMatchObject({ max: 2, used: 0, rule: 'A2.9 and SSR 9' });
    f.act({ type: 'setup.deploy', unit: f.unit('ge', 'ge.467', 1) });
    f.act({ type: 'setup.deploy', unit: f.unit('ge', 'ge.467', 2) });
    expect(check(f, { type: 'setup.deploy', unit: f.unit('ge', 'ge.447', 1) })).toBe('10% of 7 squads, rounded up: 1, plus SSR 9 (A2.9)');
  });

  it('T6: the entering group of three squads may deploy one at its offboard setup, its count not reduced by a Deployment in an earlier RPh', () => {
    const f = fixture(ASL_TESTBED_DEPLOY_SCENARIO, 'deploy-offboard');
    expect(f.decision).toMatchObject({ kind: 'offboardSetup', owner: 'ge' });
    const env = f.engine.env(f.state);
    const r1 = f.unit('ge', 'ge.467', 4);
    expect(f.state.pieces[r1]!.tags['entryTurn']).toBe(2);
    expect(deployQuota(env, 'ge', r1)).toMatchObject({ max: 1, used: 0, entry: true });
    f.act({ type: 'setup.deploy', unit: r1 });
    expect(f.state.pieces[r1]!.tags['deployedAt']).toBe('entry:2');
    expect(check(f, { type: 'setup.deploy', unit: f.unit('ge', 'ge.467', 5) })).toBe('10% of 3 squads, rounded up: 1 (A2.9)');
    // The on-board group's own 10% is untouched by it.
    expect(deployQuota(f.engine.env(f.state), 'ge', f.unit('ge', 'ge.548'))).toMatchObject({ max: 1, used: 0 });
  });

  it('a Deployment in the German Turn 1 RPh does not count against the Turn 2 entering group’s allowance', () => {
    // The recombine-ru position less its last action: the German's own part of his Turn 1 RPh.
    const { f } = deployed(ASL_TESTBED_DEPLOY_SCENARIO, 'recombine-ru', (b) => ({ type: 'rally.deploy', unit: b.unit('ge', 'ge.838'), leader: b.unit('ge', 'ge.L92') }), 1);
    expect(Object.values(f.state.pieces).filter((p) => p.tags['deployedAt'] !== undefined)).toEqual([]);
    f.until('RPh', { turn: 2, attacker: 'ge' });
    expect(f.decision.kind).toBe('offboardSetup');
    expect(deployQuota(f.engine.env(f.state), 'ge', f.unit('ge', 'ge.467', 4))).toMatchObject({ max: 1, used: 0, entry: true });
  }, 60_000);
});

/** The offboard setup with every entering unit in the first hex the default setup uses. */
function placeTogether(f: FixtureBuilder): Record<string, string> {
  const dflt = f.engine.legalActions(f.state, 'ge').find((a) => a.type === 'setup.offboard') as Action & { placements: Record<string, string> };
  const hex = Object.values(dflt.placements).sort()[0]!;
  return Object.fromEntries(Object.keys(dflt.placements).map((id) => [id, hex]));
}

describe('A1.31: Deployment in the RPh, across the Player Turns', () => {
  it('the 8-3-8 deploys under the 9-2 with the FT and DC split; the HS move and are fired on that turn, every record is off by the next RPh, and they may Recombine there', () => {
    const { f, halves } = deployed(ASL_TESTBED_SCENARIO, 'deploy-rph', (b) => {
      const ae = b.unit('ge', 'ge.838');
      expect(offered(b, 'rally.deploy').find((a) => a['unit'] === ae)).toMatchObject({ leader: b.unit('ge', 'ge.L92'), second: [b.sw('ge', 'ge.DC')] });
      return { type: 'rally.deploy', unit: ae, leader: b.unit('ge', 'ge.L92'), second: [b.sw('ge', 'ge.DC')] };
    });
    const [a, b] = halves as [string, string];
    const l92 = f.unit('ge', 'ge.L92');
    expect(f.state.pieces[a]!.defId).toBe('ge.338h');
    expect(f.state.pieces[f.sw('ge', 'ge.FT')]!.loc).toEqual({ kind: 'held', by: a });
    expect(f.state.pieces[f.sw('ge', 'ge.DC')]!.loc).toEqual({ kind: 'held', by: b });
    // Neither the 9-2 nor the HS may do anything else this RPh.
    expect(offered(f, 'rally.deploy').some((x) => x['leader'] === l92)).toBe(false);
    f.until('PFPh', { turn: 1, attacker: 'ge' });
    expect(rph(f.state)).toEqual([]);
    // The MPh: the HS and the 9-2 move up to Q3, beside the 5-2-7 in P3.
    f.until('MPh', { turn: 1, attacker: 'ge' });
    f.move([l92, a, b], ['uS3', 'uR3', 'uQ3']);
    expect([a, b, l92].map((id) => (f.state.pieces[id]!.loc as { hex?: string }).hex)).toEqual(['uQ3', 'uQ3', 'uQ3']);
    // The Russian Turn 1: the 5-2-7 Prep Fires at them like any other units.
    f.until('PFPh', { turn: 1, attacker: 'ru' });
    expect(rph(f.state)).toEqual([]);
    const r527 = f.unit('ru', 'ru.527');
    if (f.state.pieces[r527]!.tags['broken'] !== true) {
      expect(check(f, { type: 'fire', decl: { units: [r527], sw: [], target: 'uQ3' } })).toBeNull();
      f.act({ type: 'fire', decl: { units: [r527], sw: [], target: 'uQ3' } });
    }
    // German Turn 2 RPh: nothing of the last RPh is left; two Good Order HS with the 9-2 may Recombine.
    f.until('RPh', { turn: 2, attacker: 'ge' });
    if (f.decision.kind !== 'phase') f.pass();
    expect(playerTurnLeftovers(f.state)).toEqual([]);
    const good = (id: string) => f.state.pieces[id]!.loc.kind === 'hex' && f.state.pieces[id]!.tags['broken'] !== true && f.state.pieces[id]!.defId === 'ge.338h';
    if (good(a) && good(b) && f.state.pieces[l92]!.tags['broken'] !== true) {
      expect(offered(f, 'rally.recombine')).toContainEqual(expect.objectContaining({ units: [a, b].sort(), leader: l92 }));
      f.act({ type: 'rally.recombine', units: [a, b], leader: l92 });
      expect(f.state.pieces[[a, b].sort()[0]!]!.defId).toBe('ge.838');
      // Recombined, it may Deploy again in a later RPh, as a new pair of HS.
      f.until('RPh', { turn: 3, attacker: 'ge' });
      expect(rph(f.state)).toEqual([]);
    }
  }, 60_000);

  it('the Russian 4-5-8 is refused with A25.2 in the Russian RPh', () => {
    const f = fixture(ASL_TESTBED_SCENARIO, 'deploy-ru');
    expect(f.state).toMatchObject({ phase: 'RPh', attacker: 'ru' });
    expect(check(f, { type: 'rally.deploy', unit: f.unit('ru', 'ru.458', 1), leader: f.unit('ru', 'ru.L91') })).toBe('Russian squads may not Deploy (A25.2)');
    expect(offered(f, 'rally.deploy')).toEqual([]);
  });
});

describe('A1.32: Recombination on the Deploy test bed', () => {
  it('the Russian 2-2-6 recombine under the 7-0 in the German RPh; the 4-2-6 moves in its own turn, and its records are off', () => {
    const f = fixture(ASL_TESTBED_DEPLOY_SCENARIO, 'recombine-ru');
    expect(f.decision.owner).toBe('ru');
    const [h1, h2] = [f.unit('ru', 'ru.226h', 1), f.unit('ru', 'ru.226h', 2)];
    const l70 = f.unit('ru', 'ru.L70');
    expect(offered(f, 'rally.recombine')).toEqual([expect.objectContaining({ units: [h1, h2], leader: l70 })]);
    f.act({ type: 'rally.recombine', units: [h1, h2], leader: l70 });
    expect(f.state.pieces[h1]!.defId).toBe('ru.426');
    expect(f.state.pieces[h2]!.loc.kind).toBe('eliminated');
    f.until('MPh', { turn: 1, attacker: 'ru' });
    expect(rph(f.state)).toEqual([]);
    if (f.state.pieces[h1]!.tags['broken'] !== true) expect(check(f, { type: 'move.start', units: [h1] })).toBeNull();
  });

  it('across the foxhole rim: refused with the A2.8 reason, and not offered', () => {
    const f = fixture(ASL_TESTBED_DEPLOY_SCENARIO, 'recombine-foxhole');
    const [h1, h2] = [f.unit('ru', 'ru.226h', 1), f.unit('ru', 'ru.226h', 2)];
    expect((f.state.pieces[h1]!.loc as { pos?: { ent?: string } }).pos?.ent).toBe('foxhole');
    expect(check(f, { type: 'rally.recombine', units: [h1, h2], leader: f.unit('ru', 'ru.L70') })).toBe('One is beneath the entrenchment, the other is not (A1.32, A2.8)');
    expect(offered(f, 'rally.recombine')).toEqual([]);
  });
});

describe('A2.52: an offboard group Deploys before it enters', () => {
  it('the 8-1 directs a NTC Deploy offboard in the German RPh; both HS enter in the MPh', () => {
    const { f, halves } = deployed(ASL_TESTBED_DEPLOY_SCENARIO, 'deploy-offboard', (b) => {
      b.act({ type: 'setup.offboard', placements: placeTogether(b) });
      const squad = b.unit('ge', 'ge.467', 4);
      expect(offered(b, 'rally.deploy').some((a) => a['unit'] === squad && a['leader'] === b.unit('ge', 'ge.L81'))).toBe(true);
      return { type: 'rally.deploy', unit: squad, leader: b.unit('ge', 'ge.L81') };
    });
    for (const id of halves) expect(f.state.pieces[id]!.loc.kind).toBe('offboard');
    f.until('MPh', { turn: 2, attacker: 'ge' });
    const starts = f.engine.legalActions(f.state, 'ge').filter((a) => a.type === 'move.start').flatMap((a) => a['units'] as string[]);
    for (const id of halves) expect(starts).toContain(id);
  }, 60_000);
});
