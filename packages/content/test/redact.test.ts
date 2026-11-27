import { describe, expect, it } from 'vitest';
import { deepEqual, type GameState, type LoggedEvent } from '@asl/engine';
import { beltHexes, breaches, dashOptions, moveState, fortCounters, fortifiedKnownTo, fortifiedState, hiddenFrom, redactState, scatterState, shownCounter, statics, type Breach, type FortRecord, type FortifiedState, type ScatterState } from '@asl/rules';
import { ASL_TESTBED_DEPLOY_SCENARIO, ASL_TESTBED_MINES_SCENARIO, ASL_TESTBED_MOVEMENT_SCENARIO, ASL_TESTBED_PILLBOX_SCENARIO, ASL_TESTBED_SCENARIO, ASL_TESTBED_VEHICLES_SCENARIO, DEMO_PACIFIC_SCENARIO, FixtureBuilder, fixtureActions, PLAYABLE_SCENARIOS, TESTBED_FORTIFIED, mulberry, newGame, newSk1Game, testbedBreachApproach, testbedForts } from '../src';
import { mentionOf } from './randomPlayChecks';

/** Strings the viewer must never receive: ids of pieces hidden from them, and the other side's unrevealed secrets. */
function secretsFrom(engine: ReturnType<typeof newSk1Game>['engine'], state: GameState, viewer: string | null): string[] {
  const env = engine.env(state);
  return [...hiddenFrom(env, state, viewer)];
}

/**
 * The redaction invariants, on random play of every playable scenario, for both seats and a spectator:
 * 1. the redacted event stream folds into the redacted snapshot, step by step, with the same event count;
 * 2. no hidden piece id or unrevealed secret reaches the viewer, in the snapshot or in the stream;
 * 3. the engine can still list legal actions on the redacted state (the client does that).
 */
describe('redacted views on random play', () => {
  const ACTIONS = 140;
  for (const scenario of PLAYABLE_SCENARIOS) {
    it(`${scenario.id}: every viewer's stream folds into their snapshot and leaks nothing`, { timeout: 90_000 }, () => {
      const { engine, state: s0 } = newSk1Game(scenario, `redact-${scenario.id}`, { los: 'grid' });
      const rand = mulberry(scenario.id.length * 7919);
      const viewers: (string | null)[] = [...s0.sides, null];
      const redactors = new Map(viewers.map((v) => [v, (s: GameState) => redactState(engine, s, v)]));
      let state = s0;
      let views = new Map(viewers.map((v) => [v, redactors.get(v)!(s0)]));
      let secretsSeen = 0;
      for (let i = 0; i < ACTIONS && !state.result; i++) {
        const d = engine.currentDecision(state)!;
        const legal = engine.legalActions(state, d.owner);
        const doing = legal.filter((a) => a.type !== 'endPhase' && a.type !== 'defPass');
        const pool = doing.length && rand() < 0.75 ? doing : legal;
        const t = engine.submit(state, pool[Math.floor(rand() * pool.length)]!);
        for (const viewer of viewers) {
          const redact = redactors.get(viewer)!;
          const stream = engine.redactTransition(viewer, redact, state, t.events as LoggedEvent[]);
          expect(stream.length, `${viewer}: event count`).toBe(t.events.length);
          const folded = engine.applyEvents(views.get(viewer)!, stream);
          const snapshot = redact(t.state);
          if (!deepEqual(folded, snapshot)) {
            expect.fail(`${scenario.id} seq ${t.state.seq}, viewer ${viewer}: folded stream differs from the snapshot\n${JSON.stringify(stream.map((e) => e.type))}`);
          }
          // Hidden before and after: a piece revealed (or hidden) by this action may be named by the stream that shows it.
          const after = new Set(secretsFrom(engine, t.state, viewer));
          const secrets = secretsFrom(engine, state, viewer).filter((x) => after.has(x));
          secretsSeen += secrets.length;
          if (secrets.length) {
            const json = JSON.stringify(snapshot) + JSON.stringify(stream);
            for (const s of secrets) {
              const at = mentionOf(json, s);
              if (at !== null) expect.fail(`${scenario.id} seq ${t.state.seq}, viewer ${viewer} sees ${s}: …${at}…`);
            }
          }
          // Fortified buildings: a building id is public (Control names it), so check the slice itself.
          const fort = snapshot.ext['sk1.fortified'] as FortifiedState | undefined;
          const realFort = fortifiedState(engine.env(t.state));
          if (fort && realFort && realFort.side !== viewer) {
            expect(fort.buildings.every((b) => realFort.revealed.includes(b)), `${viewer} sees unrevealed fortified buildings`).toBe(true);
            for (const e of stream) if (e.type === 'sk1.fortified') expect((e.payload as { state: FortifiedState }).state.buildings.every((b) => realFort.revealed.includes(b))).toBe(true);
            if (realFort.buildings.some((b) => !realFort.revealed.includes(b))) secretsSeen++;
            // Designated by Location (B23.911): only the revealed Locations, upper levels included.
            if (realFort.locations) {
              const shown = realFort.revealedLocs ?? [];
              expect(fort.locations ?? [], `${viewer} sees unrevealed fortified Locations`).toEqual(realFort.locations.filter((l) => shown.includes(l)));
              for (const e of stream) if (e.type === 'sk1.fortified') expect(((e.payload as { state: FortifiedState }).state.locations ?? []).every((l) => shown.includes(l))).toBe(true);
              if (realFort.locations.some((l) => !shown.includes(l))) secretsSeen++;
            }
            // Breaches (B23.9221): only those of Locations the viewer knows are fortified.
            const env = engine.env(t.state);
            const seenBreaches = (snapshot.ext['asl.breach'] as Breach[] | undefined) ?? [];
            expect(seenBreaches, `${viewer} sees a Breach of an unrevealed Location`).toEqual(breaches(env).filter((b) => fortifiedKnownTo(env, b.loc, viewer)));
            for (const e of stream) if (e.type === 'asl.breach.he' && (e.payload as { breached: boolean }).breached) expect(fortifiedKnownTo(env, (e.payload as { loc: string }).loc, viewer)).toBe(true);
          }
          // Fortification counters (full ASL A12.33, B28.1): a viewer sees exactly what `shownCounter` allows, nothing of a hidden one's hex, factors or arc.
          const forts = (snapshot.ext['asl.fortifications'] as { counters: FortRecord[] } | undefined)?.counters;
          const realForts = fortCounters(engine.env(t.state));
          if (forts && realForts.length) {
            const allowed = realForts.map((c) => shownCounter(c, viewer)).filter((c): c is FortRecord => !!c);
            expect(forts, `${viewer} sees other fortification counters than allowed`).toEqual(allowed);
            for (const e of stream) if (e.type === 'asl.fort.placed') expect((e.payload as { counters: FortRecord[] }).counters.every((c) => allowed.some((a) => a.id === c.id))).toBe(true);
            if (realForts.some((c) => c.side !== viewer)) {
              // A Known and a Dummy minefield are alike to the enemy, with no strength; the Dummy Secret dr is its owner's.
              // Only the other side's counters: the viewer's own Dummy is his to see (a foxhole he dug makes him an owner too).
              const othersEv = stream.filter((e) => e.type.startsWith('asl.fort')).map((e) => {
                const p = e.payload as { side?: string; counters?: FortRecord[]; counter?: FortRecord };
                return { type: e.type, counters: (p.counters ?? (p.counter ? [p.counter] : [])).filter((c) => c.side !== viewer), ...(p.side && p.side !== viewer ? { side: p.side } : {}) };
              });
              const theirs = JSON.stringify([forts.filter((c) => c.side !== viewer), othersEv]);
              expect(theirs, `${viewer} sees a Dummy flag`).not.toContain('"dummy"');
              for (const c of forts.filter((c) => c.side !== viewer && c.kind === 'mines' && !c.mines?.strengthRevealed)) expect(c.mines, `${viewer} sees a minefield's strength`).not.toHaveProperty('ap');
              expect(stream.some((e) => e.type === 'asl.fort.dummies'), `${viewer} sees the Dummy Secret dr`).toBe(false);
              secretsSeen++;
            }
            if (realForts.length > allowed.length) secretsSeen++;
            // A unit beneath a hidden entrenchment shows no position to the other side, nor does the moving stack's state
            // or a move in or out of it (B27.13 positions; A12.33 free entry while hidden).
            const hiddenEnt = new Set(realForts.filter((c) => (c.kind === 'foxhole' || c.kind === 'trench' || c.kind === 'ditch') && c.side !== viewer && !allowed.some((a) => a.id === c.id)).map((c) => c.hex));
            if (hiddenEnt.size) {
              for (const p of Object.values(snapshot.pieces)) if (p.loc.kind === 'hex' && hiddenEnt.has(p.loc.hex)) expect(p.loc.pos?.ent, `${viewer} sees ${p.id} beneath a hidden entrenchment`).toBeUndefined();
              const ms = snapshot.ext['sk1.move'] as { hex?: string; ent?: true } | undefined;
              if (ms?.hex && hiddenEnt.has(ms.hex)) expect(ms.ent, `${viewer} sees the moving stack beneath a hidden entrenchment`).toBeUndefined();
              for (const e of stream) if (e.type === 'asl.entrench.move') expect(hiddenEnt.has((e.payload as { hex: string }).hex), `${viewer} sees a move beneath a hidden entrenchment`).toBe(false);
              secretsSeen++;
            }
          }
          // Scatter setup: the units are on the table for all to see; the plan (groups, rendezvous) is the secret.
          const plan = snapshot.ext['ssr.scatter'] as ScatterState | undefined;
          const realPlan = scatterState(engine.env(t.state));
          if (plan && realPlan && realPlan.side !== viewer) {
            realPlan.groups.forEach((_g, gi) => {
              if (realPlan.rolled.includes(gi)) return;
              expect(plan.groups[gi], `${viewer} sees scatter group ${gi}`).toEqual([]);
              expect(plan.rendezvous[gi], `${viewer} sees rendezvous ${gi}`).toBe('');
              secretsSeen++;
            });
          }
          const owner = engine.currentDecision(snapshot)?.owner;
          if (owner) expect(() => engine.legalActions(snapshot, owner)).not.toThrow();
          views.set(viewer, snapshot);
        }
        // A side's own view keeps every piece; the other secrets are the module's business.
        for (const side of s0.sides) {
          const own = views.get(side)!;
          for (const p of Object.values(t.state.pieces)) if (p.side === side) expect(own.pieces[p.id], `${side} sees its own ${p.id}`).toBeDefined();
        }
        state = t.state;
      }
      // Sanity: scenarios whose pieces hide from the other side actually exercised the leak scan.
      const env = engine.env(state);
      if (s0.sides.some((side) => hiddenFrom(env, s0, side).size > 0) || scatterState(env)) expect(secretsSeen).toBeGreaterThan(0);
    });
  }
});

describe('redacted views of a game being created', () => {
  it('the Dummy Minefield Secret dr (B28.47) reaches its owner only: no dice for the other seat or a spectator', () => {
    const { engine, init, events, state } = newGame(ASL_TESTBED_SCENARIO, 'redact-create');
    const start = engine.initialState(init);
    const isSecret = (e: LoggedEvent) => e.type === 'dice.rolled' && /Secret dr/.test((e.payload as { label: string }).label);
    expect(events.some(isSecret)).toBe(true);
    for (const viewer of ['ru', 'ge', null]) {
      const redact = (s: GameState) => redactState(engine, s, viewer);
      const stream = engine.redactTransition(viewer, redact, start, events as LoggedEvent[]);
      expect(deepEqual(engine.applyEvents(redact(start), stream), redact(state))).toBe(true);
      if (viewer === 'ru') expect(stream.some(isSecret)).toBe(true);
      else {
        expect(JSON.stringify(stream), `${viewer} sees the Secret dr`).not.toMatch(/Secret dr/);
        expect(stream.some((e) => e.type === 'asl.fort.dummies')).toBe(false);
      }
    }
  });
});

describe('a DC Breach attempt against a Location the attacker has not been shown (B23.9221, B23.911; Q&A [K33])', () => {
  // The test bed with the 8-3-8 (DC) in Q3 beside P3, where the 5-2-7 holds. P3 is fortified in one game (the test bed's
  // designation) and not in the other; nothing the German or a spectator receives may tell the two apart until the
  // Breach DR decides, and every viewer's stream must fold into its snapshot.
  const OTHER = ['uP2', 'uP2:1', 'uK4', 'uK5'];
  const VIEWERS = ['ge', 'ru', null] as const;
  function attempt(fortified: string[], dice: [number, number]) {
    const g = newGame(ASL_TESTBED_SCENARIO, 'breach-unknown');
    const f = new FixtureBuilder(g.engine, g.state);
    testbedBreachApproach(f, fortified);
    const engine = g.engine;
    let s = f.state;
    const trans: { from: GameState; to: GameState; events: LoggedEvent[] }[] = [];
    const step = (a: Record<string, unknown>) => {
      const d = engine.currentDecision(s)!;
      const t = engine.submit(s, { ...a, side: d.owner, decisionId: d.id } as never);
      trans.push({ from: s, to: t.state, events: t.events as LoggedEvent[] });
      s = t.state;
    };
    step({ type: 'move.start', units: [f.unit('ge', 'ge.838')] });
    step({ type: 'move.breach', dc: f.sw('ge', 'ge.DC'), target: 'uP3' });
    let forced = false;
    for (let i = 0; i < 40 && s.phase !== 'AFPh'; i++) {
      if (s.phase === 'DFPh' && !forced) {
        engine.forceDice(...dice);
        forced = true;
      }
      const d = engine.currentDecision(s)!;
      const legal = engine.legalActions(s, d.owner);
      const pick = ['defPass', 'move.end', 'endPhase'].map((t) => legal.find((a) => a.type === t)).find(Boolean)!;
      const { side: _s, decisionId: _d, ...rest } = pick;
      step(rest);
    }
    expect(s.phase).toBe('AFPh');
    const stream = (viewer: string | null) => trans.flatMap((t) => engine.redactTransition(viewer, (x) => redactState(engine, x, viewer), t.from, t.events));
    // Each viewer's stream folds into its snapshot, transition by transition.
    for (const viewer of VIEWERS)
      for (const t of trans) {
        const redact = (x: GameState) => redactState(engine, x, viewer);
        expect(deepEqual(engine.applyEvents(redact(t.from), engine.redactTransition(viewer, redact, t.from, t.events)), redact(t.to)), `${viewer} at seq ${t.to.seq}`).toBe(true);
      }
    const attemptEv = trans.flatMap((t) => t.events).find((e) => e.type === 'asl.breach.attempt')?.payload as Record<string, unknown>;
    return { engine, s, stream, attempt: attemptEv };
  }
  const strip = (stream: LoggedEvent[]) => stream.map((e) => ({ ...e, seq: undefined }));

  it('a DR that Breaches nothing: the German and a spectator receive the same in both games, and P3 stays unshown', () => {
    // An Original 10 (the elite 8-3-8's DC detonates): +3 stone +1 Fortified = 14, a PTC on the 30 column; no Breach.
    const forted = attempt(TESTBED_FORTIFIED, [5, 5]);
    const plain = attempt(OTHER, [5, 5]);
    expect(forted.attempt).toMatchObject({ loc: 'uP3', breached: false, malfunctioned: false, drm: 4 });
    expect(plain.attempt).toMatchObject({ loc: 'uP3', breached: false, malfunctioned: false, drm: 4 });
    for (const viewer of ['ge', null]) expect(strip(forted.stream(viewer)), `${viewer}`).toEqual(strip(plain.stream(viewer)));
    for (const viewer of ['ge', null]) {
      expect(fortifiedKnownTo(forted.engine.env(forted.s), 'uP3', viewer)).toBe(false);
      expect(redactState(forted.engine, forted.s, viewer).ext['asl.breach'] ?? []).toEqual([]);
    }
    expect(plain.s.ext['asl.breach.unfortified']).toBeUndefined();
  });

  it('a DR that would Breach: in the fortified game the Breach shows P3 to every viewer; in the other no Breach, and every viewer is told P3 is not fortified', () => {
    // An Original 6: 6 +4 = 10 on the 30 column, a NMC or better.
    const forted = attempt(TESTBED_FORTIFIED, [3, 3]);
    const plain = attempt(OTHER, [3, 3]);
    expect(forted.attempt).toMatchObject({ breached: true });
    expect(plain.attempt).toMatchObject({ breached: false, unfortified: true });
    for (const viewer of VIEWERS) {
      expect(fortifiedKnownTo(forted.engine.env(forted.s), 'uP3', viewer), `${viewer}`).toBe(true);
      expect(redactState(forted.engine, forted.s, viewer).ext['asl.breach'], `${viewer}`).toEqual([{ loc: 'uP3', toward: 'uQ3', by: 'dc' }]);
      expect(redactState(plain.engine, plain.s, viewer).ext['asl.breach.unfortified'], `${viewer}`).toEqual(['uP3']);
      expect(plain.stream(viewer).find((e) => e.type === 'asl.breach.attempt')?.payload).toMatchObject({ unfortified: true });
      // Nothing else of the other game's designation is shown.
      expect((redactState(plain.engine, plain.s, viewer).ext['sk1.fortified'] as FortifiedState).locations ?? [], `${viewer}`).toEqual(viewer === 'ru' ? [...OTHER].sort() : []);
    }
  });
});

describe('minefields: what each seat and a spectator receive (B28.1, B28.41, B28.46, B28.47)', () => {
  const VIEWERS = ['ge', 'ru', null] as const;
  /** Load a fixture, then play `steps` (with dice forced before the first), recording every transition. */
  function play(scenario: typeof ASL_TESTBED_SCENARIO, fixture: string, steps: (s: GameState) => Record<string, unknown>[], dice: number[]) {
    const g = newGame(scenario, 'mines-redact');
    const f = new FixtureBuilder(g.engine, g.state);
    let s = g.state;
    for (const a of fixtureActions(g.engine, g.state, fixture)) s = g.engine.submit(s, a).state;
    void f;
    const engine = g.engine;
    const trans: { from: GameState; to: GameState; events: LoggedEvent[] }[] = [];
    engine.forceDice(...dice);
    for (const a of steps(s)) {
      const d = engine.currentDecision(s)!;
      const t = engine.submit(s, { ...a, side: d.owner, decisionId: d.id } as never);
      trans.push({ from: s, to: t.state, events: t.events as LoggedEvent[] });
      s = t.state;
    }
    for (const viewer of VIEWERS)
      for (const t of trans) {
        const redact = (x: GameState) => redactState(engine, x, viewer);
        expect(deepEqual(engine.applyEvents(redact(t.from), engine.redactTransition(viewer, redact, t.from, t.events)), redact(t.to)), `${viewer} at seq ${t.to.seq}`).toBe(true);
      }
    const stream = (viewer: string | null) => trans.flatMap((t) => engine.redactTransition(viewer, (x) => redactState(engine, x, viewer), t.from, t.events));
    return { engine, s, stream };
  }
  const p10 = (engine: ReturnType<typeof newGame>['engine'], s: GameState, viewer: string | null) => ((redactState(engine, s, viewer).ext['asl.fortifications'] as { counters: FortRecord[] }).counters.find((c) => c.hex === 'uP10') ?? null);
  const walkIn = (s: GameState) => {
    const squad = Object.values(s.pieces).find((p) => p.loc.kind === 'hex' && p.loc.hex === 'uQ10')!.id;
    return [{ type: 'move.start', units: [squad] }, { type: 'move.step', to: 'uP10' }];
  };

  it('an attack with no effect: every viewer sees the minefield in P10, only the owner its strength', () => {
    const { engine, s, stream } = play(ASL_TESTBED_SCENARIO, 'mines-walk', walkIn, [6, 6]);
    expect(p10(engine, s, 'ru')?.mines).toMatchObject({ ap: 8, at: 1 });
    for (const viewer of ['ge', null]) {
      expect(p10(engine, s, viewer), `${viewer}`).toMatchObject({ hex: 'uP10', revealed: true });
      expect(p10(engine, s, viewer)!.mines, `${viewer}`).toEqual({});
      const att = stream(viewer).find((e) => e.type === 'asl.mines.attack')?.payload as Record<string, unknown>;
      expect(att, `${viewer}`).toMatchObject({ hex: 'uP10', result: { kind: 'none' } });
      expect(att['factors'], `${viewer}`).toBeUndefined();
      expect(JSON.stringify(stream(viewer).filter((e) => e.type.startsWith('asl.'))), `${viewer}`).not.toMatch(/"ap":8|"at":1/);
    }
  });

  it('an attack with an effect shows its A-P strength to every viewer (to verify it); the A-T factor stays the owner\'s', () => {
    // DR 2+3 on the 8 column: a K/2 or so; the result has to be verified.
    const { engine, s, stream } = play(ASL_TESTBED_SCENARIO, 'mines-walk', walkIn, [2, 3, 3, 3, 3, 3, 3, 3]);
    for (const viewer of VIEWERS) {
      expect(p10(engine, s, viewer)!.mines, `${viewer}`).toMatchObject({ ap: 8, strengthRevealed: true });
      expect(stream(viewer).find((e) => e.type === 'asl.mines.attack')?.payload, `${viewer}`).toMatchObject({ factors: 8 });
    }
  });

  it('before any attack the Germans and a spectator see nothing of the hidden minefield, the Known one and the Dummy alike as blank counters', () => {
    const g = newGame(ASL_TESTBED_SCENARIO, 'mines-redact');
    let s = g.state;
    for (const a of fixtureActions(g.engine, g.state, 'mines-walk')) s = g.engine.submit(s, a).state;
    for (const viewer of ['ge', null]) {
      const cs = (redactState(g.engine, s, viewer).ext['asl.fortifications'] as { counters: FortRecord[] }).counters;
      expect(cs.some((c) => c.hex === 'uP10'), `${viewer}`).toBe(false);
      expect(cs.filter((c) => c.hex === 'uN9' || c.hex === 'uN10').map((c) => c.mines), `${viewer}`).toEqual([{ known: true }, { known: true }]);
    }
  });

  it('a Known belt: the other seat and a spectator see its arrows and a blank Known counter in each hex, never what is recorded there', () => {
    const g = newGame(ASL_TESTBED_MINES_SCENARIO, 'mines-redact');
    const f = new FixtureBuilder(g.engine, g.state);
    f.fortify(TESTBED_FORTIFIED);
    const belt = { id: 'b1', from: 'uN9', to: 'uN10', grain: 'hex' as const };
    const path = beltHexes(g.engine.env(f.state), belt)!;
    expect(path).toEqual(['uN9', 'uN10']);
    f.act({ type: 'fort.place', counters: [{ kind: 'mines', hex: 'uN9', hidden: false, mines: { known: true, ap: 12 }, belt: 'b1' }, { kind: 'mines', hex: 'uN10', hidden: false, mines: { known: true, dummy: true }, belt: 'b1' }], belts: [belt] });
    for (const viewer of ['ge', null]) {
      const st = redactState(g.engine, f.state, viewer).ext['asl.fortifications'] as { counters: FortRecord[]; belts?: unknown[] };
      expect(st.belts, `${viewer}`).toEqual([{ ...belt, side: 'ru' }]);
      expect(st.counters.map((c) => c.mines), `${viewer}`).toEqual([{ known: true }, { known: true }]);
    }
    const own = redactState(g.engine, f.state, 'ru').ext['asl.fortifications'] as { counters: FortRecord[] };
    expect(own.counters.map((c) => c.mines)).toEqual([{ known: true, ap: 12 }, { known: true, dummy: true }]);
  });

});

describe('pillboxes: what each seat and a spectator receive (B30.7, A12.33)', () => {
  const VIEWERS = ['ge', 'ru', null] as const;
  type Trans = { from: GameState; to: GameState; events: LoggedEvent[] };
  /** A fixture built with the builder, then `more` played on it; every transition from the first action recorded. */
  function record(fixture: string | null, more: (f: FixtureBuilder) => void, dice: number[] = [], scenario = ASL_TESTBED_SCENARIO) {
    const g = newGame(scenario, 'pillbox-redact');
    const f = new FixtureBuilder(g.engine, g.state);
    if (fixture) for (const a of fixtureActions(g.engine, g.state, fixture)) f.act(a as never);
    if (dice.length) g.engine.forceDice(...dice);
    const start = f.actions.length;
    more(f);
    const trans: Trans[] = [];
    let s = g.state;
    for (const [i, a] of f.actions.entries()) {
      const t = g.engine.submit(s, a);
      if (i >= start) trans.push({ from: s, to: t.state, events: t.events as LoggedEvent[] });
      s = t.state;
    }
    return { engine: g.engine, f, trans };
  }
  /** Every viewer's stream folds into its snapshot, transition by transition; returns each viewer's whole stream. */
  function streams(engine: ReturnType<typeof newGame>['engine'], trans: Trans[]) {
    const out = new Map<string | null, LoggedEvent[]>();
    for (const viewer of VIEWERS) {
      const redact = (x: GameState) => redactState(engine, x, viewer);
      const all: LoggedEvent[] = [];
      for (const t of trans) {
        const stream = engine.redactTransition(viewer, redact, t.from, t.events);
        expect(deepEqual(engine.applyEvents(redact(t.from), stream), redact(t.to)), `${viewer} at seq ${t.to.seq}`).toBe(true);
        all.push(...stream);
      }
      out.set(viewer, all);
    }
    return out;
  }

  it('the contents of a hidden pillbox set up hidden: the owner sees the squad inside, the other seat and a spectator never receive it, not even once the pillbox is revealed, into the next Player Turns', () => {
    const { engine, f, trans } = record('fort-placed', (b) => {
      const ge = (def: string, n = 1) => b.unit('ge', def, n);
      b.setup('ge', { [ge('ge.L92')]: 'uT3', [ge('ge.838')]: 'uT3', [ge('ge.548')]: 'uT3', [ge('ge.467', 1)]: 'uU4', [ge('ge.467', 2)]: 'uT4', [ge('ge.467', 3)]: 'uS5', [ge('ge.L80')]: 'uS5', [ge('ge.447', 1)]: 'uS5', [ge('ge.447', 2)]: 'uV4' });
      // German Turn 1: a 4-6-7 walks up beside the pillbox, the first German with a LOS to O3.
      b.until('MPh', { turn: 1, attacker: 'ge' });
      b.move([ge('ge.467', 2)], ['uS4', 'uR4', 'uQ4', 'uP4']);
      b.until('RPh', { turn: 2, attacker: 'ge' });
    });
    const squad = f.unit('ru', 'ru.458', 1);
    const all = streams(engine, trans);
    // The setup snapshot and every turn after it: the owner sees the squad in the pillbox, hidden; no one else sees it.
    for (const t of [trans[0]!.from, ...trans.map((x) => x.to)]) {
      expect(redactState(engine, t, 'ru').pieces[squad]?.loc).toEqual({ kind: 'hex', hex: 'uO3', sub: 'pb' });
      for (const viewer of ['ge', null]) expect(redactState(engine, t, viewer).pieces[squad], `${viewer} at seq ${t.seq}`).toBeUndefined();
    }
    expect(f.state.pieces[squad]!.tags['hip']).toBe(true);
    for (const viewer of ['ge', null]) expect(JSON.stringify(all.get(viewer)), `${viewer}`).not.toContain(JSON.stringify(squad));
    // The pillbox itself, in Open Ground, was revealed by that German's LOS (A12.33); its contents were not (B30.7: they
    // set up hidden in their own right).
    expect(fortCounters(engine.env(f.state)).find((c) => c.kind === 'pillbox')!.revealed).toBe(true);
  });

  it('fire at a possible pillbox in O3 reads alike to the German and a spectator whether the hidden pillbox is there or in L4 (Q&A to A7 and B30; B30.7)', () => {
    // The German HMG in U4 fires at "a possible pillbox" in O3 in its PFPh; in one game the Russian pillbox (with the 4-5-8
    // hidden inside) is in O3, in the other in L4. O3 is out of every German LOS, so nothing is revealed either way.
    const play = (pbHex: string) => {
      const g = newGame(ASL_TESTBED_SCENARIO, 'possible-pillbox');
      const b = new FixtureBuilder(g.engine, g.state);
      const ru = (def: string, n = 1) => b.unit('ru', def, n);
      const ge = (def: string, n = 1) => b.unit('ge', def, n);
      b.fortify(TESTBED_FORTIFIED);
      b.fortPlace(testbedForts(b).map((c) => (c.kind === 'pillbox' ? { ...c, hex: pbHex } : c)));
      b.setup('ru', { [ru('ru.L91')]: 'uK4', [ru('ru.458', 1)]: `${pbHex}:pb`, [ru('ru.447', 1)]: 'uK5', [ru('ru.458', 2)]: 'uI4', [ru('ru.447', 2)]: 'uM5', [ru('ru.447', 3)]: 'uN7', [ru('ru.527')]: 'uP3', [ru('ru.426', 1)]: 'uP5', [ru('ru.L70')]: 'uH5', [ru('ru.426', 2)]: 'uH5' });
      b.setup('ge', { [ge('ge.L92')]: 'uT3', [ge('ge.838')]: 'uT3', [ge('ge.548')]: 'uT3', [ge('ge.467', 1)]: 'uU4', [ge('ge.467', 2)]: 'uT4', [ge('ge.467', 3)]: 'uS5', [ge('ge.L80')]: 'uS5', [ge('ge.447', 1)]: 'uS5', [ge('ge.447', 2)]: 'uV4' });
      b.until('PFPh', { turn: 1, attacker: 'ge' });
      const hmg = Object.values(b.state.pieces).find((p) => p.defId === 'ge.HMG')!.id;
      const before = b.state;
      g.engine.forceDice(4, 5);
      const d = g.engine.currentDecision(before)!;
      expect(g.engine.validate(before, { type: 'fire', decl: { units: [], sw: [hmg], target: 'uO3:pb' }, side: d.owner, decisionId: d.id } as never), pbHex).toBeNull();
      const t = g.engine.submit(before, { type: 'fire', decl: { units: [], sw: [hmg], target: 'uO3:pb' }, side: d.owner, decisionId: d.id } as never);
      const view = (viewer: string | null) => {
        const redact = (x: GameState) => redactState(g.engine, x, viewer);
        const stream = g.engine.redactTransition(viewer, redact, before, t.events as LoggedEvent[]);
        expect(deepEqual(g.engine.applyEvents(redact(before), stream), redact(t.state)), `${pbHex} ${viewer}`).toBe(true);
        return JSON.stringify(stream.map((e) => ({ ...e, seq: undefined }))).replace(/"d\d+"/g, '"d"');
      };
      expect(fortCounters(g.engine.env(t.state)).find((c) => c.kind === 'pillbox')!.revealed).toBeUndefined();
      return { ge: view('ge'), spectator: view(null), ru: view('ru') };
    };
    const there = play('uO3');
    const elsewhere = play('uL4');
    expect(there.ge).toEqual(elsewhere.ge);
    expect(there.spectator).toEqual(elsewhere.spectator);
    // The owner's stream is its own business: it may differ (it knows where its pillbox is).
    expect(there.ru.length).toBeGreaterThan(0);
  });

  /** A Russian squad, seen walking up, goes into the revealed P6 pillbox (T4). */
  const walkIn = (b: FixtureBuilder) => {
    const sq = b.unit('ru', 'ru.447', 3);
    b.act({ type: 'move.start', units: [sq] });
    for (const to of ['uO7', 'uP6', 'uP6:pb']) {
      b.act({ type: 'move.step', to });
      b.settle('ru');
    }
    b.act({ type: 'move.end' });
    b.settle('ru');
    return sq;
  };
  const occupied = (engine: ReturnType<typeof newGame>['engine'], s: GameState, viewer: string | null) =>
    (redactState(engine, s, viewer).ext['asl.fortifications'] as { counters: (FortRecord & { occupied?: true })[] }).counters.find((c) => c.kind === 'pillbox')?.occupied;

  it('a squad seen walking into a revealed pillbox vanishes from the other seat and a spectator, who see the pillbox occupied (B30.7); the owner sees it inside', () => {
    let sq = '';
    const { engine, f, trans } = record('pb-enter', (b) => {
      sq = walkIn(b);
    }, [], ASL_TESTBED_PILLBOX_SCENARIO);
    streams(engine, trans);
    expect(f.state.pieces[sq]!.loc).toEqual({ kind: 'hex', hex: 'uP6', sub: 'pb' });
    for (const viewer of ['ge', null]) {
      expect(redactState(engine, f.state, viewer).pieces[sq], `${viewer}`).toBeUndefined();
      expect(occupied(engine, f.state, viewer), `${viewer}`).toBe(true);
    }
    expect(redactState(engine, f.state, 'ru').pieces[sq]!.loc).toEqual({ kind: 'hex', hex: 'uP6', sub: 'pb' });
    expect(occupied(engine, f.state, 'ru')).toBeUndefined();
  });

  it('an attack made from within makes the contents Known: the other seat and a spectator then see the squad inside (B30.7)', () => {
    let sq = '';
    const { engine, f, trans } = record('pb-enter', (b) => {
      sq = walkIn(b);
      // The next Russian PFPh: the squad inside fires at the German 4-6-7 in R5, in the Covered Arc.
      b.until('PFPh', { turn: 2, attacker: 'ru' });
      const target = Object.values(b.state.pieces).find((p) => p.side === 'ge' && p.loc.kind === 'hex' && p.loc.hex === 'uR5');
      if (target && b.state.pieces[sq]!.tags['broken'] !== true) b.act({ type: 'fire', decl: { units: [sq], sw: [], target: 'uR5' } });
    }, [], ASL_TESTBED_PILLBOX_SCENARIO);
    streams(engine, trans);
    const known = fortCounters(engine.env(f.state)).find((c) => c.kind === 'pillbox')!.known;
    if (known) for (const viewer of ['ge', null]) {
      expect(redactState(engine, f.state, viewer).pieces[sq], `${viewer}`).toBeDefined();
      expect(occupied(engine, f.state, viewer), `${viewer}`).toBeUndefined();
    }
    expect(known).toBe(true);
  });
});

describe('Vehicles beneath a hidden trench, and the Hull Down question (ASLRB B27.52, A12.33, B9.36; T5)', () => {
  const VIEWERS = ['ge', 'ru', null] as const;
  type Trans = { from: GameState; to: GameState; events: LoggedEvent[] };
  function record(fixture: string, more: (f: FixtureBuilder) => void) {
    const g = newGame(ASL_TESTBED_VEHICLES_SCENARIO, 'vehicle-redact');
    const f = new FixtureBuilder(g.engine, g.state);
    for (const a of fixtureActions(g.engine, g.state, fixture)) f.act(a as never);
    const start = f.actions.length;
    more(f);
    const trans: Trans[] = [];
    let s = g.state;
    for (const [i, a] of f.actions.entries()) {
      const t = g.engine.submit(s, a);
      if (i >= start) trans.push({ from: s, to: t.state, events: t.events as LoggedEvent[] });
      s = t.state;
    }
    return { engine: g.engine, f, trans };
  }
  /** Every viewer's stream folds into its snapshot, transition by transition. */
  function streams(engine: ReturnType<typeof newGame>['engine'], trans: Trans[]) {
    for (const viewer of VIEWERS) {
      const redact = (x: GameState) => redactState(engine, x, viewer);
      for (const t of trans) {
        const stream = engine.redactTransition(viewer, redact, t.from, t.events);
        expect(deepEqual(engine.applyEvents(redact(t.from), stream), redact(t.to)), `${viewer} at seq ${t.to.seq}`).toBe(true);
      }
    }
  }
  const pos = (engine: ReturnType<typeof newGame>['engine'], s: GameState, viewer: string | null, id: string) => (redactState(engine, s, viewer).pieces[id]?.loc as { pos?: { ent?: string } } | undefined)?.pos?.ent;

  it('the other seat and a spectator see the tank and no trench, no position, until a German within 16 hexes with a LOS reveals the trench; the owner sees it beneath throughout', () => {
    let t34 = '';
    let before: GameState | null = null;
    const { engine, f, trans } = record('trench-tank-hidden', (b) => {
      t34 = b.unit('ru', 'ru.T34M41');
      before = b.state;
      // A German 4-6-7 walks out of the U4 woods to U7, nine hexes from the L10 woods with a LOS to them (past the roadblock).
      b.move([b.unit('ge', 'ge.467', 3), b.unit('ge', 'ge.L80')], ['uU5', 'uU6', 'uU7']);
    });
    streams(engine, trans);
    for (const viewer of ['ge', null]) {
      expect(pos(engine, before!, viewer, t34), `${viewer}`).toBeUndefined();
      expect((redactState(engine, before!, viewer).ext['asl.fortifications'] as { counters: FortRecord[] }).counters.some((c) => c.hex === 'uL10'), `${viewer}`).toBe(false);
    }
    expect(pos(engine, before!, 'ru', t34)).toBe('trench');
    const c = fortCounters(engine.env(f.state)).find((x) => x.hex === 'uL10')!;
    expect(c.revealed).toBe(true);
    for (const viewer of VIEWERS) expect(pos(engine, f.state, viewer, t34), `${viewer}`).toBe('trench');
  });

  it('the Hull Down question is the target\'s owner\'s: every seat\'s stream folds, and no choice is recorded before the answer', () => {
    let pending: GameState | null = null;
    const { engine, f, trans } = record('trench-tank-woods', (b) => {
      const pz = b.unit('ge', 'ge.pzivf2');
      const shot = b.engine.legalActions(b.state, 'ge').find((a) => a.type === 'fire.ordnance' && (a['shot'] as { weapon: string }).weapon === pz && (a['shot'] as { target: string }).target === 'uN10' && (a['shot'] as { targetType: string }).targetType === 'VTT')!;
      const { side: _s, decisionId: _d, ...a } = shot;
      b.act(a as never);
      pending = b.state;
      b.act({ type: 'hd.choose', choice: 'tem' });
    });
    streams(engine, trans);
    expect(engine.currentDecision(pending!)).toMatchObject({ kind: 'hdChoice', owner: 'ru' });
    for (const viewer of VIEWERS) expect(redactState(engine, pending!, viewer).ext['asl.hd.choice'], `${viewer}`).toBeUndefined();
    expect(f.state.ext['asl.hd.choice']).toBeUndefined();
    expect(f.state.ext['asl.hd.pending']).toBeUndefined();
  });
});

describe('Deploy and Recombine by hidden units (ASLRB A1.31, A1.32, A12.3; T1, T6)', () => {
  const VIEWERS = ['ge', 'ru', null] as const;
  /** The test bed with the hidden-units rule given to `side` for `quota` squads. */
  const withHidden = (base: typeof ASL_TESTBED_SCENARIO, side: string, quota: number) => ({ ...base, ssr: base.ssr.map((r) => (r.module === 'hidden-units' ? { ...r, params: { side, quota, notOpenGround: true, rule: 'SSR 2' } } : r)) });
  /** A woods hex of `side`'s setup area. */
  const woodsOf = (f: FixtureBuilder, base: typeof ASL_TESTBED_SCENARIO, side: string, not: string[] = []) => {
    const map = statics(f.engine.env(f.state)).map;
    const area = base.forces.find((x) => x.side === side)!.setup as { hexes: string[] };
    return area.hexes.find((h) => map.hex(h)?.terrain === 'woods' && !not.includes(h))!;
  };
  function play(scenario: typeof ASL_TESTBED_SCENARIO, build: (f: FixtureBuilder) => void, act: (f: FixtureBuilder) => void) {
    const g = newGame(scenario, 'deploy-redact');
    const f = new FixtureBuilder(g.engine, g.state);
    build(f);
    const before = f.state;
    act(f);
    const t = g.engine.submit(before, f.actions[f.actions.length - 1]!);
    for (const viewer of VIEWERS) {
      const redact = (x: GameState) => redactState(g.engine, x, viewer);
      const stream = g.engine.redactTransition(viewer, redact, before, t.events as LoggedEvent[]);
      expect(deepEqual(g.engine.applyEvents(redact(before), stream), redact(t.state)), `${viewer}`).toBe(true);
    }
    return { engine: g.engine, before, after: t.state, events: t.events };
  }

  it('a hidden German squad and its hidden leader Deploy: the other seat and a spectator receive neither until the action places them on the board', () => {
    const scenario = withHidden(ASL_TESTBED_SCENARIO, 'ge', 1);
    let squad = '';
    let leader = '';
    const { engine, before, after } = play(
      scenario,
      (f) => {
        f.fortify(TESTBED_FORTIFIED);
        f.setup('ru', {});
        squad = f.unit('ge', 'ge.467', 1);
        leader = f.unit('ge', 'ge.L80');
        const hex = woodsOf(f, scenario, 'ge');
        f.setup('ge', { [squad]: hex, [leader]: hex }, {}, { hidden: [squad, leader] });
        f.until('RPh', { turn: 1, attacker: 'ge' });
      },
      (f) => f.act({ type: 'rally.deploy', unit: squad, leader }),
    );
    for (const viewer of ['ru', null]) {
      const seen = JSON.stringify(redactState(engine, before, viewer));
      expect(seen, `${viewer}`).not.toContain(JSON.stringify(squad));
      expect(seen, `${viewer}`).not.toContain(JSON.stringify(leader));
      expect(redactState(engine, after, viewer).pieces[squad], `${viewer}`).toBeDefined();
      expect(redactState(engine, after, viewer).pieces[leader], `${viewer}`).toBeDefined();
    }
    expect(redactState(engine, before, 'ge').pieces[squad]).toBeDefined();
  });

  it('two hidden Russian HS Recombine under a hidden 7-0 in the German RPh: placed on the board by it, never shown before', () => {
    const scenario = withHidden(ASL_TESTBED_DEPLOY_SCENARIO, 'ru', 2);
    let hs: string[] = [];
    let leader = '';
    const { engine, before, after } = play(
      scenario,
      (f) => {
        f.fortify(TESTBED_FORTIFIED);
        hs = [f.unit('ru', 'ru.226h', 1), f.unit('ru', 'ru.226h', 2)];
        leader = f.unit('ru', 'ru.L70');
        const hex = woodsOf(f, scenario, 'ru');
        f.setup('ru', { [hs[0]!]: hex, [hs[1]!]: hex, [leader]: hex }, {}, { hidden: [...hs, leader] });
        f.setup('ge', {});
        f.until('RPh', { turn: 1, attacker: 'ge' });
        f.pass();
      },
      (f) => f.act({ type: 'rally.recombine', units: hs, leader }),
    );
    for (const viewer of ['ge', null]) {
      const seen = JSON.stringify(redactState(engine, before, viewer));
      for (const id of [...hs, leader]) expect(seen, `${viewer} ${id}`).not.toContain(JSON.stringify(id));
      expect(redactState(engine, after, viewer).pieces[hs[0]!]?.defId, `${viewer}`).toBe('ru.426');
    }
  });
});

/*
 * The movement options and hidden units (ASLRB A4.63, A4.15, A12.15): what the mover is offered never depends on a unit
 * he cannot see, and the moves fold into every viewer's snapshot without naming one.
 */
describe('Dash and Infantry OVR beside hidden units: two seats and a spectator', () => {
  const VIEWERS = ['ge', 'ru', null] as const;
  /** The fixture, then `steps` (as the decision owner each time): every transition folds for every viewer. */
  function play(fixture: string, steps: ((f: FixtureBuilder) => void)[], build?: (f: FixtureBuilder) => void) {
    const g = newGame(ASL_TESTBED_MOVEMENT_SCENARIO, 'movement-redact');
    const f = new FixtureBuilder(g.engine, g.state);
    if (build) build(f);
    else for (const a of fixtureActions(g.engine, g.state, fixture)) f.state = g.engine.submit(f.state, a).state;
    const states = [f.state];
    for (const step of steps) {
      const before = f.state;
      const n = f.actions.length;
      step(f);
      let s = before;
      for (const a of f.actions.slice(n)) {
        const t = g.engine.submit(s, a);
        for (const viewer of VIEWERS) {
          const redact = (x: GameState) => redactState(g.engine, x, viewer);
          const stream = g.engine.redactTransition(viewer, redact, s, t.events as LoggedEvent[]);
          expect(deepEqual(g.engine.applyEvents(redact(s), stream), redact(t.state)), `${viewer} ${a.type}`).toBe(true);
          if (viewer !== 'ru') for (const id of [...hiddenFrom(g.engine.env(s), s, viewer)].filter((x) => [...hiddenFrom(g.engine.env(t.state), t.state, viewer)].includes(x))) expect(JSON.stringify(stream), `${viewer} ${a.type}`).not.toContain(JSON.stringify(id));
        }
        s = t.state;
      }
      states.push(f.state);
    }
    return { engine: g.engine, f, states };
  }

  it('a Dash past a hidden squad: the offered end hexes are the same on the German view, and the declaration names nothing hidden', () => {
    const { engine, f, states } = play('dash-hidden', [
      (b) => b.act({ type: 'move.start', units: [b.unit('ge', 'ge.447', 1), b.unit('ge', 'ge.L80')].sort() }),
      (b) => b.act({ type: 'move.dash', road: 'uN8', to: 'uM9' }),
    ]);
    const moving = states[1]!;
    const hidden = f.unit('ru', 'ru.426', 1);
    expect(moving.pieces[hidden]!.tags['hip']).toBe(true);
    const seen = redactState(engine, moving, 'ge');
    expect(JSON.stringify(seen)).not.toContain(JSON.stringify(hidden));
    expect(dashOptions(engine.env(seen))).toEqual(dashOptions(engine.env(moving)));
    for (const viewer of ['ge', null] as const) expect(JSON.stringify(redactState(engine, states[2]!, viewer)), `${viewer}`).not.toContain(JSON.stringify(hidden));
  });

  it('a hidden squad behind the lone 7-0: the OVR step is offered as on a Location of one SMC, and the German view shows the same (A4.15, A12.15)', () => {
    let hidden = '';
    const units: string[] = [];
    const { engine, states } = play(
      '',
      [(b) => b.act({ type: 'move.start', units })],
      (b) => {
        b.fortify(TESTBED_FORTIFIED);
        const ru = (def: string, n = 1) => b.unit('ru', def, n);
        hidden = ru('ru.426', 1);
        b.setup('ru', { [ru('ru.L70')]: 'uN10', [hidden]: 'uN10' }, {}, { hidden: [hidden] });
        const ge = (def: string, n = 1) => b.unit('ge', def, n);
        units.push(...[ge('ge.L92'), ge('ge.838'), ge('ge.548')].sort());
        b.setup('ge', Object.fromEntries(units.map((u) => [u, 'uS8'])));
        b.until('MPh', { turn: 1, attacker: 'ge' });
        b.move(units, ['uR7', 'uQ8', 'uP8', 'uO9', 'uO10']);
        b.until('MPh', { turn: 2, attacker: 'ge' });
      },
    );
    const s = states[1]!;
    const seen = redactState(engine, s, 'ge');
    expect(JSON.stringify(seen)).not.toContain(JSON.stringify(hidden));
    const steps = (x: GameState) => engine.legalActions(x, 'ge').filter((a) => a.type === 'move.step' && a['to'] === 'uN10').map((a) => a['ovr'] ?? 'leader');
    expect(steps(s)).toEqual(['leader', 'each']);
    expect(steps(seen)).toEqual(steps(s));
  });
});

/*
 * Overstacking and hidden units (ASLRB A12.14, A12.3, A5.11): a hidden unit is revealed by becoming overstacked in the LOS
 * of a Good Order enemy ground unit, and by nothing else; the move that overstacks it out of such LOS folds into every
 * viewer's snapshot without naming it.
 */
describe('A hidden squad overstacked by its own side: two seats and a spectator', () => {
  const VIEWERS = ['ge', 'ru', null] as const;
  function play(fixture: string) {
    const g = newGame(ASL_TESTBED_SCENARIO, 'stacking-redact');
    const f = new FixtureBuilder(g.engine, g.state);
    for (const a of fixtureActions(g.engine, g.state, fixture)) f.state = g.engine.submit(f.state, a).state;
    const hidden = f.unit('ru', 'ru.447', 1);
    const mover = f.unit('ru', 'ru.447', 3);
    const to = fixture === 'overstack-hidden' ? 'uP5' : 'uK4';
    const n = f.actions.length;
    const before = f.state;
    f.act({ type: 'move.start', units: [mover] });
    f.act({ type: 'move.step', to });
    let s = before;
    const streams: Record<string, string> = {};
    for (const a of f.actions.slice(n)) {
      const t = g.engine.submit(s, a);
      for (const viewer of VIEWERS) {
        const redact = (x: GameState) => redactState(g.engine, x, viewer);
        const stream = g.engine.redactTransition(viewer, redact, s, t.events as LoggedEvent[]);
        expect(deepEqual(g.engine.applyEvents(redact(s), stream), redact(t.state)), `${viewer} ${a.type}`).toBe(true);
        streams[String(viewer)] = (streams[String(viewer)] ?? '') + JSON.stringify(stream);
      }
      s = t.state;
    }
    return { engine: g.engine, state: f.state, hidden, streams };
  }

  it('out of German view it stays hidden: neither the German seat nor a spectator receives it', () => {
    const { engine, state, hidden, streams } = play('overstack-hidden-unseen');
    expect(state.pieces[hidden]!.tags['hip']).toBe(true);
    for (const viewer of ['ge', null] as const) {
      expect(streams[String(viewer)], `${viewer}`).not.toContain(JSON.stringify(hidden));
      expect(JSON.stringify(redactState(engine, state, viewer)), `${viewer}`).not.toContain(JSON.stringify(hidden));
    }
    expect(JSON.stringify(redactState(engine, state, 'ru'))).toContain(JSON.stringify(hidden));
  });

  it('in German view it is revealed to every viewer by the step that overstacks it', () => {
    const { engine, state, hidden, streams } = play('overstack-hidden');
    expect(state.pieces[hidden]!.tags['hip']).toBeUndefined();
    for (const viewer of VIEWERS) {
      expect(streams[String(viewer)], `${viewer}`).toContain(JSON.stringify(hidden));
      expect(JSON.stringify(redactState(engine, state, viewer)), `${viewer}`).toContain(JSON.stringify(hidden));
    }
  });
});

/**
 * Defensive First Fire at a stack moving under a "?" (SK4 8.3), on random play of the Pacific demo weighted toward moving
 * and First Fire: at every First Fire decision the defender's own view offers exactly the shots the full state offers and
 * judges each shot, and each unit of it alone (a late joiner), as the full state does (the Mandatory Fire Group rule per MF
 * expenditure, ASLRB A7.55, SK1 1.2.4); and no view names a hidden piece anywhere, inside strings built from ids too.
 */
describe('Defensive First Fire at concealed movers, as the defender sees it', () => {
  it('demo-pacific: the defender’s view agrees with the full state on every First Fire shot and leaks no hidden id', { timeout: 180_000 }, () => {
    let compared = 0;
    let concealedTargets = 0;
    for (let game = 0; game < 10; game++) {
    const { engine, state: s0 } = newSk1Game(DEMO_PACIFIC_SCENARIO, `redact-first-fire-${game}`, { los: 'grid' });
    const rand = mulberry(8302 + game);
    let state = s0;
    for (let i = 0; i < 900 && !state.result; i++) {
      const d = engine.currentDecision(state)!;
      if (d.kind === 'firstFire') {
        const view = redactState(engine, state, d.owner);
        const ms = moveState(engine.env(state));
        const underCover = !!ms?.units.some((id) => !view.pieces[id]);
        if (underCover) concealedTargets++;
        const shots = (x: GameState) => engine.legalActions(x, d.owner).filter((a) => a.type === 'defFire').map((a) => JSON.stringify(a['decl'])).sort();
        const full = shots(state);
        expect(shots(view), `seq ${state.seq}`).toEqual(full);
        // Every shot offered, and every one of the defender's units on the map firing alone at the stack (one that sat out
        // an earlier shot from its Location on this expenditure is a late joiner, refused alike in both).
        const alone = ms?.hex ? Object.values(state.pieces).filter((p) => p.side === d.owner && p.loc.kind === 'hex').map((p) => ({ units: [p.id], sw: [] as string[], target: ms.hex! })) : [];
        for (const decl of [...full.map((j) => JSON.parse(j) as { units: string[]; sw: string[]; target: string }), ...alone]) {
          for (const tryDecl of [decl, ...decl.units.map((u) => ({ ...decl, units: [u], sw: [] }))]) {
            const a = { type: 'defFire', decl: tryDecl, side: d.owner, decisionId: d.id } as never;
            const why = engine.validate(state, a);
            expect(engine.validate(view, a), `seq ${state.seq} ${JSON.stringify(tryDecl)}`).toBe(why);
            if (underCover) compared++;
          }
        }
      }
      const legal = engine.legalActions(state, d.owner);
      // Keep the "?" on: little fire but at a stack moving under one, concealed units Assault Moving one hex at a time.
      const ms = moveState(engine.env(state));
      const coveredMove = !!ms?.units.some((u) => state.pieces[u]?.tags['concealed']);
      const concealedUnits = (a: { [k: string]: unknown }) => ((a['units'] as string[] | undefined) ?? []).some((u) => state.pieces[u]?.tags['concealed']);
      const w = legal.map((a) =>
        a.type === 'defFire' ? (coveredMove ? (((a['decl'] as { units: string[]; sw: string[] }).units.length + (a['decl'] as { units: string[]; sw: string[] }).sw.length === 1 ? 30 : 4)) : 0.02)
        : /fire|Fire|ordnance/.test(a.type) ? 0.02
        : a.type === 'move.start' ? (concealedUnits(a) ? 60 : 0.5)
        : a.type === 'move.step' ? 4
        : a.type === 'endPhase' || a.type === 'defPass' || a.type === 'move.end' ? 1
        : 0.5,
      );
      let r = rand() * w.reduce((x, y) => x + y, 0);
      let pick = legal[legal.length - 1]!;
      for (let k = 0; k < legal.length; k++) if ((r -= w[k]!) <= 0) { pick = legal[k]!; break; }
      // The Starter Kit lists no Assault Movement start (the player declares it as he starts): declare it for a "?" stack.
      if (pick.type === 'move.start' && concealedUnits(pick) && !pick['doubleTime'] && !engine.validate(state, { ...pick, assault: true } as never)) pick = { ...pick, assault: true };
      const t = engine.submit(state, pick);
      for (const viewer of [...s0.sides, null]) {
        const after = hiddenFrom(engine.env(t.state), t.state, viewer);
        const hidden = [...hiddenFrom(engine.env(state), state, viewer)].filter((id) => after.has(id));
        if (!hidden.length) continue;
        const json = JSON.stringify(redactState(engine, t.state, viewer)) + JSON.stringify(engine.redactTransition(viewer, (x) => redactState(engine, x, viewer), state, t.events as LoggedEvent[]));
        for (const id of hidden) {
          const at = mentionOf(json, id);
          if (at !== null) expect.fail(`seq ${t.state.seq}, viewer ${viewer} sees ${id}: …${at}…`);
        }
      }
      state = t.state;
    }
    }
    expect(concealedTargets).toBeGreaterThan(0);
    expect(compared).toBeGreaterThan(0);
  });
});
