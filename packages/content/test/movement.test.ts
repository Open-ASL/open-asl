import { describe, expect, it } from 'vitest';
import type { Action } from '@asl/engine';
import { dashOptions, moveState, type ScenarioDef } from '@asl/rules';
import { ASL_TESTBED_MOVEMENT_SCENARIO, ASL_TESTBED_SCENARIO, FixtureBuilder, fixtureActions, newGame } from '../src';

/*
 * The movement options on the test beds (ASLRB A4.134 Minimum Move, A4.5 Double Time during the move, A4.63 Dash, A4.15
 * Infantry OVR, A8.312 mandatory TPBF, A4.41 a weapon Recovered where it lay): each dev fixture's position offers what
 * its description promises, and the decision it leads to.
 */

function fixture(scenario: ScenarioDef, id: string, seed = 'movement-test') {
  const g = newGame(scenario, seed);
  let s = g.state;
  for (const a of fixtureActions(g.engine, s, id)) s = g.engine.submit(s, a).state;
  return new FixtureBuilder(g.engine, s);
}
const check = (f: FixtureBuilder, a: Record<string, unknown>) => f.engine.validate(f.state, { ...a, side: f.decision.owner, decisionId: f.decision.id } as Action);
const offered = (f: FixtureBuilder, type: string) => f.engine.legalActions(f.state, f.decision.owner).filter((a) => a.type === type);
/** The fixture on the first seed for which `act` (its first action) gives `want` (a NTC passed, a Recovery made). */
function seeded(scenario: ScenarioDef, id: string, act: (f: FixtureBuilder) => void, want: (f: FixtureBuilder) => boolean) {
  for (let i = 0; i < 60; i++) {
    const f = fixture(scenario, id, `movement-${i}`);
    act(f);
    if (want(f)) return f;
  }
  throw new Error(`no seed gave ${id} what the test wants`);
}

describe('T7 movement fixtures', () => {
  it('min-move: the 4-6-7 with 6 PP (one MF) enters the S3 woods by Minimum Move, pinned and CX when its move is over (A4.134)', () => {
    const f = fixture(ASL_TESTBED_MOVEMENT_SCENARIO, 'min-move');
    const sq = f.unit('ge', 'ge.467', 4);
    f.act({ type: 'move.start', units: [sq] });
    expect(moveState(f.engine.env(f.state))!.allowance[sq]).toBe(1);
    expect(offered(f, 'move.step').map((a) => a['to'])).toContain('uS3');
    f.act({ type: 'move.step', to: 'uS3' });
    f.settle('ge');
    expect(f.state.pieces[sq]).toMatchObject({ loc: { hex: 'uS3' }, tags: { pinned: true, cx: true } });
  });

  it('double-time-late: the moving 4-4-7 may Double Time now (+1 MF, CX); an Assault Moving stack may not (A4.5, A4.61)', () => {
    const f = fixture(ASL_TESTBED_MOVEMENT_SCENARIO, 'double-time-late');
    const sq = f.unit('ge', 'ge.447', 2);
    expect(offered(f, 'move.doubleTime')).toContainEqual(expect.objectContaining({ units: [sq] }));
    f.act({ type: 'move.doubleTime', units: [sq] });
    expect(moveState(f.engine.env(f.state))!.allowance[sq]).toBe(5);
    f.act({ type: 'move.end' });
    f.settle('ge');
    f.act({ type: 'move.start', units: [f.unit('ge', 'ge.447', 1)], assault: true });
    expect(check(f, { type: 'move.doubleTime', units: [f.unit('ge', 'ge.447', 1)] })).toBe('Assault Movement cannot be voluntarily voided (ASLRB A4.61)');
  });

  it('dash: the 8-0 and 4-4-7 in O8 may Dash across N8 to M9 or N9; the N10 4-4-7\'s First Fire at them in N8 is halved (A4.63)', () => {
    const f = fixture(ASL_TESTBED_MOVEMENT_SCENARIO, 'dash');
    const units = [f.unit('ge', 'ge.447', 1), f.unit('ge', 'ge.L80')].sort();
    f.act({ type: 'move.start', units });
    expect(dashOptions(f.engine.env(f.state)).filter((o) => o.road === 'uN8')).toEqual([
      { road: 'uN8', to: 'uM9', cost: 3, openGround: false },
      { road: 'uN8', to: 'uN9', cost: 2, openGround: true },
    ]);
    f.act({ type: 'move.dash', road: 'uN8', to: 'uM9' });
    expect(f.decision).toMatchObject({ kind: 'firstFire', owner: 'ru' });
    const r = f.engine.submit(f.state, { type: 'defFire', decl: { units: [f.unit('ru', 'ru.447', 3)], sw: [], target: 'uN8' }, side: 'ru', decisionId: f.decision.id } as Action);
    const attack = r.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { fpExplain?: { label?: string }[] };
    expect((attack.fpExplain ?? []).map((n) => n.label)).toContain('×½ Dash (Area Fire, ASLRB A4.63)');
  });

  it('dash-hidden: the hidden 4-2-6 in M9 keeps the Dashing stack in N8, its MPh over there (A4.63, A12.15)', () => {
    const f = fixture(ASL_TESTBED_MOVEMENT_SCENARIO, 'dash-hidden');
    const units = [f.unit('ge', 'ge.447', 1), f.unit('ge', 'ge.L80')].sort();
    f.act({ type: 'move.start', units });
    f.act({ type: 'move.dash', road: 'uN8', to: 'uM9' });
    f.settle('ge');
    f.act({ type: 'move.step', to: 'uM9' });
    expect(f.state.pieces[units[0]!]!.loc).toMatchObject({ hex: 'uN8' });
    expect(f.state.pieces[f.unit('ru', 'ru.426', 1)]!.tags['hip']).toBeUndefined();
  });

  it('ovr-leader: the 9-2 stack may overrun the 7-0 in N10 by the leader\'s NTC or each squad\'s; passing, the Russian answers first (A4.15, A4.151)', () => {
    const stack = (f: FixtureBuilder) => [f.unit('ge', 'ge.L92'), f.unit('ge', 'ge.838'), f.unit('ge', 'ge.548')].sort();
    const f = seeded(
      ASL_TESTBED_MOVEMENT_SCENARIO,
      'ovr-leader',
      (b) => {
        b.act({ type: 'move.start', units: stack(b) });
        expect(offered(b, 'move.step').filter((a) => a['to'] === 'uN10').map((a) => a['ovr'] ?? 'leader')).toEqual(['leader', 'each']);
        b.act({ type: 'move.step', to: 'uN10' });
      },
      (b) => b.state.pieces[b.unit('ge', 'ge.L92')]!.loc.kind === 'hex' && (b.state.pieces[b.unit('ge', 'ge.L92')]!.loc as { hex: string }).hex === 'uN10',
    );
    expect(f.decision).toMatchObject({ kind: 'ovrEvade', owner: 'ru' });
    f.act({ type: 'ovr.slip' });
    expect(f.decision).toMatchObject({ kind: 'ovrPlace', owner: 'ge' });
  });

  it('ovr-armed: the 9-1 with the LMG stays and must attack at once with it (A8.312)', () => {
    const stack = (f: FixtureBuilder) => [f.unit('ge', 'ge.L80'), f.unit('ge', 'ge.467', 3), f.unit('ge', 'ge.447', 1)].sort();
    const f = seeded(
      ASL_TESTBED_MOVEMENT_SCENARIO,
      'ovr-armed',
      (b) => {
        b.act({ type: 'move.start', units: stack(b) });
        b.act({ type: 'move.step', to: 'uN10' });
      },
      (b) => b.decision.kind === 'ovrEvade',
    );
    f.act({ type: 'ovr.stay' });
    expect(f.decision).toMatchObject({ kind: 'mandatoryTpbf', owner: 'ru', data: { decl: { units: [], sw: [f.sw('ru', 'ru.LMG')], target: 'uN10' } } });
  });

  it('ovr-melee: the 7-0 held in Melee with the 8-3-8 cannot slip away; in the CC only the 9-2 and the 5-4-8 attack (A4.152)', () => {
    const f = fixture(ASL_TESTBED_MOVEMENT_SCENARIO, 'ovr-melee');
    expect(f.state.hexMarkers['uN10']?.['melee']).toBe(true);
    const f2 = seeded(
      ASL_TESTBED_MOVEMENT_SCENARIO,
      'ovr-melee',
      (b) => {
        b.act({ type: 'move.start', units: [b.unit('ge', 'ge.L92'), b.unit('ge', 'ge.548')].sort() });
        b.act({ type: 'move.step', to: 'uN10' });
        // Russians elsewhere may fire into the Melee; they decline.
        for (let i = 0; i < 10 && b.decision.kind === 'firstFire'; i++) b.pass();
      },
      (b) => b.decision.kind === 'ccDeclare',
    );
    const attackers = offered(f2, 'cc.declare').flatMap((a) => (a['attacks'] as { attackers: string[] }[]).flatMap((x) => x.attackers));
    expect([...new Set(attackers)].sort()).toEqual([f2.unit('ge', 'ge.L92'), f2.unit('ge', 'ge.548')].sort());
  });
});

describe('T1 fixture afph-recover (A4.41)', () => {
  it('the 4-4-7 moves into T4, Recovers the MMG lying there and may fire it in the AFPh', () => {
    const f = seeded(
      ASL_TESTBED_SCENARIO,
      'afph-recover',
      (b) => {
        const sq = b.unit('ge', 'ge.447', 1);
        b.act({ type: 'move.start', units: [sq] });
        b.act({ type: 'move.step', to: 'uT4' });
        b.settle('ge');
        b.act({ type: 'move.recover', unit: sq, sw: b.sw('ge', 'ge.MMG') });
        b.settle('ge');
      },
      (b) => b.state.pieces[b.sw('ge', 'ge.MMG')]!.loc.kind === 'held' && (b.state.pieces[b.sw('ge', 'ge.MMG')]!.loc as { by: string }).by === b.unit('ge', 'ge.447', 1),
    );
    f.act({ type: 'move.end' });
    f.settle('ge');
    f.until('AFPh', { turn: 1, attacker: 'ge' });
    const mmg = f.sw('ge', 'ge.MMG');
    expect(f.state.pieces[mmg]!.tags['mfHeld']).toBeUndefined();
    const targets = offered(f, 'fire').filter((a) => (a['decl'] as { sw: string[] }).sw.includes(mmg));
    expect(targets.length).toBeGreaterThan(0);
  });
});
