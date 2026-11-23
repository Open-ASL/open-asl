import { describe, expect, it } from 'vitest';
import type { Action, GameState } from '@asl/engine';
import { defaultFortPlacement, fortCounters, fortPlaceIllegal, fortificationView, locationsOf, redactState, seenByEnemy, type FortRecord } from '@asl/rules';
import { ASL_TESTBED_SCENARIO, DEV_FIXTURES, FixtureBuilder, fixtureActions, newGame, testbedForts } from '../src';

/*
 * Fortification counters on the T1 test bed (ASLRB A12.33, B26–B30; the `fortifications` special rule): placed in the
 * Russian setup decision before the units, the units set up beneath and inside them, what each viewer's snapshot holds,
 * the reveal by German LOS as the first Player Turn begins, and play across the turns with units in and on them.
 */

function fresh() {
  const g = newGame(ASL_TESTBED_SCENARIO, 'forts-test');
  return { engine: g.engine, state: g.state };
}
/** A fresh test bed with a fixture applied, then the builder to carry on with. */
function fixture(id: string) {
  const { engine, state } = fresh();
  const actions = fixtureActions(engine, state, id);
  let s = state;
  for (const a of actions) s = engine.submit(s, a).state;
  return new FixtureBuilder(engine, s);
}
const locOf = (state: GameState, id: string) => {
  const p = state.pieces[id]!;
  return p.loc;
};

describe('placing the counters in the setup', () => {
  it('the setup decision offers the placement as its own action, with a legal default', () => {
    const f = fixture('fort-setup');
    const d = f.decision;
    expect(d).toMatchObject({ kind: 'setup', owner: 'ru' });
    const legal = f.engine.legalActions(f.state, 'ru');
    expect(legal.map((a) => a.type).sort()).toEqual(['fort.place', 'setup.place']);
    const dflt = legal.find((a) => a.type === 'fort.place')!;
    expect(fortPlaceIllegal(f.engine.env(f.state), 'ru', dflt['counters'] as never)).toBeNull();
    expect(defaultFortPlacement(f.engine.env(f.state), 'ru').length).toBeGreaterThanOrEqual(9);
    // The German side has none to place.
    expect(fortPlaceIllegal(f.engine.env(f.state), 'ge', [])).toMatch(/no fortification counters/);
  });
  it('the test bed counters go down once; a second placement, or the units set up first, is refused', () => {
    const f = fixture('fort-setup');
    f.fortPlace(testbedForts(f));
    const env = f.engine.env(f.state);
    expect(fortCounters(env).map((c) => `${c.kind}@${c.hex}${c.hidden ? '?' : ''}`)).toEqual([
      'foxhole@uO6?', 'trench@uO7', 'trench@uP6', 'wire@uO4?', 'wire@uP9', 'mines@uP10?', 'mines@uN9', 'mines@uN10', 'roadblock@uO9?', 'pillbox@uO3?', 'foxhole@uO10',
    ]);
    expect(f.engine.legalActions(f.state, 'ru').map((a) => a.type)).toEqual(['setup.place']);
    expect(() => f.fortPlace([])).toThrow(/already placed/);
    // The decision is still the Russian setup: the units follow.
    expect(f.decision).toMatchObject({ kind: 'setup', owner: 'ru' });
  });
  it('units set up beneath the foxholes and trench, on the Wire and inside the pillbox, within the capacities', () => {
    const f = fixture('fort-owner');
    const ru = (def: string, n = 1) => f.unit('ru', def, n);
    const dflt = f.engine.legalActions(f.state, 'ru').find((a) => a.type === 'setup.place')! as Action & { placements: Record<string, string> };
    const base = { ...dflt.placements, [ru('ru.458', 1)]: 'uO3:pb', [ru('ru.447', 1)]: 'uO6', [ru('ru.447', 2)]: 'uO6', [ru('ru.426', 1)]: 'uO7', [ru('ru.458', 2)]: 'uP6', [ru('ru.527')]: 'uP9' };
    const check = (placements: Record<string, string>, extra: Record<string, unknown> = {}) => f.engine.validate(f.state, { ...dflt, placements, ...extra });
    expect(check(base, { beneath: [ru('ru.447', 1), ru('ru.447', 2), ru('ru.426', 1), ru('ru.458', 2)] })).toBeNull();
    // Three squads beneath a 2S foxhole: one too many; two squads inside the 1+3+5 pillbox: one too many.
    expect(check({ ...base, [ru('ru.447', 3)]: 'uO6' }, { beneath: [ru('ru.447', 1), ru('ru.447', 2), ru('ru.447', 3)] })).toMatch(/foxhole 2S in uO6 holds 2 squads/);
    // The pillbox's capacity is its Location's stacking limit (B30.111).
    expect(check({ ...base, [ru('ru.447', 3)]: 'uO3:pb' })).toMatch(/Stacking limit exceeded in uO3:pb \(1 squad-equivalents\)/);
    // Beneath nothing: no counter of the side there.
    expect(check(base, { beneath: [ru('ru.L91')] })).toMatch(/No foxhole, trench or Wire of yours in/);
    // The pillbox is a Location of the hex, listed with the ground.
    expect(locationsOf(f.engine.env(f.state), 'uO3')).toEqual(['uO3', 'uO3:pb']);
    f.setup('ru', { [ru('ru.458', 1)]: 'uO3:pb', [ru('ru.447', 1)]: 'uO6', [ru('ru.426', 1)]: 'uO7', [ru('ru.458', 2)]: 'uP6', [ru('ru.527')]: 'uP9' }, {}, { beneath: [ru('ru.447', 1), ru('ru.426', 1), ru('ru.458', 2)] });
    expect(locOf(f.state, ru('ru.458', 1))).toEqual({ kind: 'hex', hex: 'uO3', sub: 'pb' });
    expect(locOf(f.state, ru('ru.447', 1))).toEqual({ kind: 'hex', hex: 'uO6', pos: { ent: 'foxhole' } });
    expect(locOf(f.state, ru('ru.458', 2))).toEqual({ kind: 'hex', hex: 'uP6', pos: { ent: 'trench' } });
    // Not beneath the Wire: on top of it, as a unit entering would be (B26.4).
    expect(locOf(f.state, ru('ru.527'))).toEqual({ kind: 'hex', hex: 'uP9', pos: { wire: 'on' } });
    expect(f.decision).toMatchObject({ kind: 'setup', owner: 'ge' });
  });
});

describe('what each side sees', () => {
  it("the German's snapshot holds the open counters and two blank Known minefields, no hidden hex, strength or arc, and no pillbox Location", () => {
    const f = fixture('fort-placed');
    const env = f.engine.env(f.state);
    expect(fortificationView(env, 'ru')).toHaveLength(11);
    const theirs = fortificationView(env, 'ge');
    expect(theirs.map((c) => `${c.kind}@${c.hex}`)).toEqual(['trench@uO7', 'trench@uP6', 'wire@uP9', 'mines@uN9', 'mines@uN10', 'foxhole@uO10']);
    expect(theirs.filter((c) => c.kind === 'mines').map((c) => c.mines)).toEqual([{ known: true }, { known: true }]);
    const seen = redactState(f.engine, f.state, 'ge');
    const json = JSON.stringify(seen.ext['asl.fortifications']);
    for (const secret of ['uO6', 'uO4', 'uP10', 'uO9', 'uO3', '"ap":8', '"at":1', '"dummy"', '"ca":0']) expect(json, secret).not.toContain(secret);
    expect(locationsOf(f.engine.env(seen), 'uO3')).toEqual(['uO3']);
    // Nor do the units give their counters away: the 4-4-7 beneath the hidden O6 foxhole shows no position; the squad in the
    // hidden pillbox set up hidden with it (B30.7: "If a pillbox sets up hidden, so do its contents"), so it is not in the
    // German's snapshot at all; the Conscripts beneath the open O7 foxhole keep theirs.
    expect(seen.pieces[f.unit('ru', 'ru.447', 1)]!.loc).toEqual({ kind: 'hex', hex: 'uO6' });
    expect(seen.pieces[f.unit('ru', 'ru.458', 1)]).toBeUndefined();
    expect(f.state.pieces[f.unit('ru', 'ru.458', 1)]!.tags['hip']).toBe(true);
    expect(redactState(f.engine, f.state, null).pieces[f.unit('ru', 'ru.458', 1)]).toBeUndefined();
    expect(redactState(f.engine, f.state, 'ru').pieces[f.unit('ru', 'ru.458', 1)]!.loc).toEqual({ kind: 'hex', hex: 'uO3', sub: 'pb' });
    expect(seen.pieces[f.unit('ru', 'ru.426', 1)]!.loc).toEqual({ kind: 'hex', hex: 'uO7', pos: { ent: 'trench' } });
    expect(redactState(f.engine, f.state, 'ru').pieces[f.unit('ru', 'ru.447', 1)]!.loc).toEqual({ kind: 'hex', hex: 'uO6', pos: { ent: 'foxhole' } });
    // A hotseat screen between the players shows what the German sees.
    expect(fortificationView(env, null).map((c) => c.hex)).toEqual(['uO7', 'uP6', 'uP9', 'uN9', 'uN10', 'uO10']);
  });
  it('as the first Player Turn begins, hidden counters in Open Ground a Good Order German sees are revealed; the recorded minefield never (A12.33, B28.1)', () => {
    const f = fixture('fort-placed');
    const ge = (def: string, n = 1) => f.unit('ge', def, n);
    f.setup('ge', { [ge('ge.L92')]: 'uT3', [ge('ge.838')]: 'uT3', [ge('ge.548')]: 'uT3', [ge('ge.467', 1)]: 'uU4', [ge('ge.467', 2)]: 'uT4', [ge('ge.467', 3)]: 'uS5', [ge('ge.L80')]: 'uS5', [ge('ge.447', 1)]: 'uS5', [ge('ge.447', 2)]: 'uV4' });
    expect(f.state.phase).toBe('RPh');
    const env = f.engine.env(f.state);
    const revealed = fortCounters(env).filter((c) => c.revealed).map((c) => c.hex);
    // Every hidden counter a German can see is out, none other; the minefield at P10 stays recorded whatever sees it.
    for (const c of fortCounters(env).filter((x) => x.hidden && x.kind !== 'mines')) expect(!!c.revealed, c.hex).toBe(seenByEnemy(env, c));
    expect(fortCounters(env).find((c) => c.hex === 'uP10')!.revealed).toBeUndefined();
    expect(revealed.length).toBeGreaterThan(0);
    const log = f.state;
    void log;
  });
});

describe('across the turns', () => {
  /** Pass and end phases until `phase` of `attacker` on `turn`. */
  const until = (f: FixtureBuilder, phase: string, turn: number, attacker: string) => f.until(phase as never, { turn, attacker: attacker as never });
  it('units beneath a foxhole and inside the hidden pillbox fire, are fired on (the foxhole), move out and lose their position; the counters stay', () => {
    const f = fixture('fort-placed');
    const ge = (def: string, n = 1) => f.unit('ge', def, n);
    const ru = (def: string, n = 1) => f.unit('ru', def, n);
    f.setup('ge', { [ge('ge.L92')]: 'uS4', [ge('ge.838')]: 'uS4', [ge('ge.548')]: 'uS4', [ge('ge.467', 1)]: 'uS7', [ge('ge.467', 2)]: 'uS6', [ge('ge.467', 3)]: 'uS5', [ge('ge.L80')]: 'uS5', [ge('ge.447', 1)]: 'uS5', [ge('ge.447', 2)]: 'uV4' });
    const before = fortCounters(f.engine.env(f.state)).length;
    // German Turn 1 PFPh: the stack in S6 fires at the 4-4-7 beneath the O6 foxhole, the one in S4 at the 4-5-8 in the pillbox.
    until(f, 'PFPh', 1, 'ge');
    const shots = f.engine.legalActions(f.state, 'ge').filter((a) => a.type === 'fire');
    const target = (a: Action) => (a['decl'] as { target: string }).target;
    const targets = [...new Set(shots.map(target))];
    const atFox = shots.find((a) => target(a) === 'uO6');
    const atPb = shots.find((a) => target(a) === 'uO3:pb');
    expect(atFox, `a shot at the foxhole hex is offered (${targets.join(' ')})`).toBeDefined();
    // The pillbox's contents set up hidden with it (B30.7): no Known target there to offer.
    expect(atPb, `no shot at the pillbox Location is offered (${targets.join(' ')})`).toBeUndefined();
    const { side: _s, decisionId: _d, ...shot } = atFox!;
    f.act(shot);
    f.settle('ge');
    // Russian Turn 1: the pillbox squad fires back in the PFPh, the foxhole squad moves out in the MPh.
    until(f, 'PFPh', 1, 'ru');
    const back = f.engine.legalActions(f.state, 'ru').filter((a) => a.type === 'fire' && ((a['decl'] as { units: string[] }).units ?? []).includes(ru('ru.458', 1)));
    expect(back.length, 'the squad in the pillbox is offered fire').toBeGreaterThan(0);
    until(f, 'MPh', 1, 'ru');
    const mover = f.state.pieces[ru('ru.447', 1)]!;
    if (mover.tags['broken'] !== true && mover.tags['pinned'] !== true) {
      // Out of the foxhole first (a separate MF the German may fire at, ASLRB B27.4), then into the next hex.
      f.act({ type: 'move.start', units: [ru('ru.447', 1)] });
      expect(f.engine.validate(f.state, { type: 'move.step', to: 'uP6', side: 'ru', decisionId: f.decision.id } as Action)).toMatch(/Leave the foxhole 2S first/);
      f.act({ type: 'move.entrenchment', beneath: false });
      f.settle('ru');
      // Into the next hex on top of its trench (the plain step), not beneath it.
      f.act({ type: 'move.step', to: 'uP6' });
      f.settle('ru');
      if (f.engine.legalActions(f.state, 'ru').some((a) => a.type === 'move.end')) f.act({ type: 'move.end' });
      f.settle('ru');
      expect(locOf(f.state, ru('ru.447', 1))).toEqual({ kind: 'hex', hex: 'uP6' });
    }
    // Into the next Game Turn: the counters are all still there, the unit that stayed beneath the trench still has its position.
    until(f, 'RPh', 2, 'ge');
    expect(fortCounters(f.engine.env(f.state))).toHaveLength(before);
    expect(locOf(f.state, ru('ru.458', 2))).toEqual({ kind: 'hex', hex: 'uP6', pos: { ent: 'trench' } });
    expect(locOf(f.state, ru('ru.458', 1))).toEqual({ kind: 'hex', hex: 'uO3', sub: 'pb' });
    // It never fired or moved: still hidden with the pillbox it set up in (B30.7, A12.3).
    expect(f.state.pieces[ru('ru.458', 1)]!.tags['hip']).toBe(true);
  });
  it('every dev fixture of the counters builds', () => {
    for (const id of ['fort-setup', 'fort-owner', 'fort-placed']) {
      expect(DEV_FIXTURES.some((x) => x.id === id), id).toBe(true);
      const f = fixture(id);
      expect(f.decision.kind).toBe('setup');
    }
  });
});
