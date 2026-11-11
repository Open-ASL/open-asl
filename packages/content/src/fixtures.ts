import type { Action, Decision, Engine, GameState, HexId, PieceId, SideId } from '@asl/engine';
import { byId } from '@asl/rules';

/*
 * DEV FIXTURES: named positions to start a play test from (development builds only).
 *
 * A fixture is a short script of ordinary, legal player actions: the fortified-building designation, both
 * setups with chosen hexes, then moves, advances and phase ends up to the position wanted. `fixtureActions`
 * runs the script on a fresh game (`newGame`, no action yet) and returns the actions; the web app submits
 * them to a hotseat game, which records them like any other (so the match replays, scores and makes its
 * after action report as usual), and a rules test can submit them to an engine. Nothing reaches into the
 * game state from outside: a position the rules do not allow cannot be built, and the script stops with
 * the rule's own message.
 *
 * Where they show up: in a `pnpm dev` build (never production), the scenario's Deploy panel offers
 * "Dev fixture" next to the hotseat card, and `/app/match/<id>?fixture=<fixture id>` loads one into a
 * hotseat match that has no action yet. Drivers can call `window.aslGame.loadFixture('<id>')` instead.
 *
 * Adding a fixture: append a `DevFixture` to `DEV_FIXTURES` and give `build` the steps.
 * - Name units by counter def and number within the side: `f.unit('ru', 'ru.447', 2)` is the side's second
 *   4-4-7 in order of battle order (a SW by its def: `f.sw('ge', 'ge.DC')`).
 * - `f.fortify(['u-B27'])` answers the `fortified-buildings` designation (building ids: `buildingAt('u', 'uP3')`).
 * - `f.setup(side, { [unit]: hex }, { [sw]: unit })` places the side's at-start units; units left out take
 *   the engine's default placement. SW go with the unit the scenario gives them to unless reassigned.
 * - `f.until(phase, { turn, attacker })` ends every phase (and declines every Defensive Fire, rout or CC
 *   choice) until that phase of that Player Turn has begun.
 * - `f.move(units, [hex, ...])` moves a stack step by step (the other side declines its fire), `f.advance`,
 *   `f.act(action)` for anything else, as the side whose decision it is.
 * - Add a test in `packages/content/test/fixtures.test.ts`: every fixture is built there, so a rules change
 *   that breaks one fails the suite rather than the play test.
 */

export interface DevFixture {
  id: string;
  scenarioId: string;
  title: string;
  description: string;
  build(f: FixtureBuilder): void;
}

/** Answers that decline or end a decision, in the order the fixture runner tries them. */
const PASSES = ['defPass', 'defRofDecline', 'defMotion.done', 'move.end', 'cc.arranged', 'endPhase'];

/** Builds a fixture by submitting actions to an engine, collecting them in order. */
export class FixtureBuilder {
  readonly actions: Action[] = [];
  constructor(
    readonly engine: Engine,
    public state: GameState,
  ) {}

  get decision(): Decision {
    const d = this.engine.currentDecision(this.state);
    if (!d) throw new Error(`Fixture: no decision pending (phase ${this.state.phase})`);
    return d;
  }

  /** Submit an action as the owner of the current decision. */
  act(a: Omit<Action, 'side' | 'decisionId'> & Record<string, unknown>): void {
    const d = this.decision;
    const full = { ...a, side: d.owner, decisionId: d.id } as Action;
    const err = this.engine.validate(this.state, full);
    if (err) throw new Error(`Fixture: ${a.type} refused in ${this.state.phase} T${this.state.turn}: ${err}`);
    this.state = this.engine.submit(this.state, full).state;
    this.actions.push(full);
  }

  /** Decline or end the current decision. */
  pass(): void {
    const d = this.decision;
    const legal = this.engine.legalActions(this.state, d.owner);
    const cc = legal.find((a) => a.type === 'cc.declare' && Array.isArray(a['attacks']) && (a['attacks'] as unknown[]).length === 0);
    const pick = PASSES.map((t) => legal.find((a) => a.type === t)).find(Boolean) ?? cc;
    if (!pick) throw new Error(`Fixture: no way to pass the ${d.kind} decision of ${d.owner} in ${this.state.phase} (legal: ${[...new Set(legal.map((a) => a.type))].join(', ')})`);
    const { side: _s, decisionId: _d, ...rest } = pick;
    this.act(rest as Omit<Action, 'side' | 'decisionId'>);
  }

  /** Pass every decision of `side` on top of the stack (the other side's interrupts during a move, say). */
  settle(side: SideId): void {
    for (let guard = 0; guard < 200 && !this.state.result; guard++) {
      const d = this.engine.currentDecision(this.state);
      if (!d || d.owner === side) return;
      this.pass();
    }
  }

  /** Pass everything until `phase` (of that turn and attacker, when given) has begun. */
  until(phase: string, opts: { turn?: number; attacker?: SideId } = {}): void {
    for (let guard = 0; guard < 2000; guard++) {
      if (this.state.result) throw new Error(`Fixture: the game ended before ${phase}`);
      const s = this.state;
      if (s.phase === phase && (opts.turn === undefined || s.turn === opts.turn) && (opts.attacker === undefined || s.attacker === opts.attacker)) return;
      this.pass();
    }
    throw new Error(`Fixture: never reached ${phase}`);
  }

  /** The id of the `n`th (1-based) piece of `def` on `side`, in order of battle order. */
  unit(side: SideId, def: string, n = 1): PieceId {
    const ps = Object.values(this.state.pieces)
      .filter((p) => p.side === side && p.defId === def)
      .sort(byId);
    const p = ps[n - 1];
    if (!p) throw new Error(`Fixture: ${side} has no ${def} #${n}`);
    return p.id;
  }

  /** The id of the `n`th SW of `def` on `side`. */
  sw(side: SideId, def: string, n = 1): PieceId {
    return this.unit(side, def, n);
  }

  /** Answer the fortified-building designation. */
  fortify(buildings: string[]): void {
    if (this.decision.kind !== 'fortify') throw new Error(`Fixture: expected the fortify decision, not ${this.decision.kind}`);
    this.act({ type: 'fortify.designate', buildings });
  }

  /** Answer `side`'s setup decision: the given units in the given hexes, the rest where the engine's default puts them. */
  setup(side: SideId, placements: Record<PieceId, HexId>, sw: Record<PieceId, PieceId> = {}): void {
    const d = this.decision;
    if (d.kind !== 'setup' || d.owner !== side) throw new Error(`Fixture: expected the ${side} setup, not ${d.kind} (${d.owner})`);
    const dflt = this.engine.legalActions(this.state, side).find((a) => a.type === 'setup.place');
    if (!dflt) throw new Error(`Fixture: no default setup for ${side}`);
    const { side: _s, decisionId: _d, ...base } = dflt as Action & { placements: Record<PieceId, HexId>; sw?: Record<PieceId, PieceId> };
    this.act({ ...base, placements: { ...base.placements, ...placements }, sw: { ...(base.sw ?? {}), ...sw } });
  }

  /** Move `units` as one stack through `path` (adjacent hexes), the other side declining all fire, then end the move. */
  move(units: PieceId[], path: HexId[]): void {
    const side = this.state.pieces[units[0]!]!.side;
    this.act({ type: 'move.start', units });
    for (const to of path) {
      this.act({ type: 'move.step', to });
      this.settle(side);
    }
    if (this.engine.legalActions(this.state, side).some((a) => a.type === 'move.end')) this.act({ type: 'move.end' });
    this.settle(side);
  }

  /** Advance `units` into `to` in the APh. */
  advance(units: PieceId[], to: HexId): void {
    this.act({ type: 'advance', units, to });
  }
}

/**
 * Test bed (T1) setups. Russians: the 9-1 with the MMG and HMG squads in the K4-K5 stone building, the
 * 4-5-8s and the LMG in the village, the 7-0 and a Conscript squad on the hill. Germans: in the woods east
 * of hexrow S, the 9-2 with the assault engineers (FT, DC) opposite the P2-P3 stone building.
 */
function testbedSetup(f: FixtureBuilder, fortified: string) {
  testbedSetupWith(f, fortified, {});
}

/** The test bed setup with some Russian units elsewhere: `moved` maps "def" or "def#n" to a Location. */
function testbedSetupWith(f: FixtureBuilder, fortified: string, moved: Record<string, string>) {
  const ru = (def: string, n = 1) => f.unit('ru', def, n);
  const at = (def: string, n: number, hex: string) => moved[`${def}#${n}`] ?? (n === 1 ? moved[def] : undefined) ?? hex;
  const ge = (def: string, n = 1) => f.unit('ge', def, n);
  f.fortify([fortified]);
  f.setup('ru', {
    [ru('ru.L91')]: at('ru.L91', 1, 'uK4'),
    [ru('ru.458', 1)]: at('ru.458', 1, 'uK4'),
    [ru('ru.447', 1)]: at('ru.447', 1, 'uK5'),
    [ru('ru.458', 2)]: at('ru.458', 2, 'uI4'),
    [ru('ru.447', 2)]: at('ru.447', 2, 'uM5'),
    [ru('ru.447', 3)]: at('ru.447', 3, 'uN7'),
    [ru('ru.527')]: at('ru.527', 1, 'uP3'),
    [ru('ru.426', 1)]: at('ru.426', 1, 'uP5'),
    [ru('ru.L70')]: at('ru.L70', 1, 'uH5'),
    [ru('ru.426', 2)]: at('ru.426', 2, 'uH5'),
  });
  f.setup('ge', {
    [ge('ge.L92')]: 'uT3',
    [ge('ge.838')]: 'uT3',
    [ge('ge.548')]: 'uT3',
    [ge('ge.467', 1)]: 'uU4',
    [ge('ge.467', 2)]: 'uT4',
    [ge('ge.467', 3)]: 'uS5',
    [ge('ge.L80')]: 'uS5',
    [ge('ge.447', 1)]: 'uS5',
    [ge('ge.447', 2)]: 'uV4',
  });
}

/**
 * Full ASL levels: the test bed setup with the Russians in the P2-P3 stone house on both levels of P3 (a Two
 * Story House, ASLRB B23.22): the 9-1 and a 4-5-8 with the MMG upstairs, the 5-2-7 on the ground below.
 */
function levelsSetup(f: FixtureBuilder) {
  testbedSetupWith(f, TESTBED_FORTIFIED, { 'ru.L91': 'uP3:1', 'ru.458#1': 'uP3:1' });
}

/**
 * Full ASL LOS with heights: the Russians upstairs in two Two Story Houses (the 9-1 with a 4-5-8 and the MMG on
 * level 1 of K5, a 4-4-7 on level 1 of M5) and the P2-P3 house left empty for the Germans to take; the 5-2-7 goes to
 * the ground of K4. K4-K5 is the fortified building here, so P2-P3 can be entered freely.
 */
function losHeightsSetup(f: FixtureBuilder) {
  testbedSetupWith(f, 'u-B16', { 'ru.L91': 'uK5:1', 'ru.458#1': 'uK5:1', 'ru.447#2': 'uM5:1', 'ru.527': 'uK4' });
}

/**
 * Board-u terrain: a Russian 4-4-7 on the paved road at L6 looking up the tree-lined road M6-N5-O5-P4, and
 * another on level 1 of M7 looking west down the K8-J8 Orchard-Road (ASLRB B14.6: in season, the road is open to it).
 */
function orchardRoadSetup(f: FixtureBuilder) {
  testbedSetupWith(f, TESTBED_FORTIFIED, { 'ru.447#3': 'uL6', 'ru.447#2': 'uM7:1' });
}

/** The building the test bed fixtures fortify: P2-P3, the stone building nearest the German setup area. */
export const TESTBED_FORTIFIED = 'u-B27';

export const DEV_FIXTURES: DevFixture[] = [
  {
    id: 'start',
    scenarioId: 'asl-testbed',
    title: 'Start',
    description: 'Both sides set up (P2-P3 fortified); German Turn 1 Rally Phase.',
    build(f) {
      testbedSetup(f, TESTBED_FORTIFIED);
      f.until('RPh', { turn: 1, attacker: 'ge' });
    },
  },
  {
    id: 'melee',
    scenarioId: 'asl-testbed',
    title: 'Close Combat',
    description: 'German Turn 1: the 8-0 and two squads moved to Q5 and advanced into the Russian 4-2-6 in P5; the CCPh is about to be declared.',
    build(f) {
      testbedSetup(f, TESTBED_FORTIFIED);
      f.until('MPh', { turn: 1, attacker: 'ge' });
      const stack = [f.unit('ge', 'ge.L80'), f.unit('ge', 'ge.467', 3), f.unit('ge', 'ge.447', 1)];
      f.move(stack, ['uR5', 'uQ5']);
      f.until('APh', { turn: 1, attacker: 'ge' });
      f.advance(stack, 'uP5');
      f.until('CCPh', { turn: 1, attacker: 'ge' });
    },
  },
  {
    id: 'building-assault',
    scenarioId: 'asl-testbed',
    title: 'Building assault',
    description: 'German Turn 2 Movement Phase: the 9-2 with the assault engineers (FT, DC) and the 5-4-8 in Q3, adjacent to the fortified P2-P3 stone building held by a 5-2-7.',
    build(f) {
      testbedSetup(f, TESTBED_FORTIFIED);
      f.until('MPh', { turn: 1, attacker: 'ge' });
      f.move([f.unit('ge', 'ge.L92'), f.unit('ge', 'ge.838'), f.unit('ge', 'ge.548')], ['uS3', 'uR3', 'uQ3']);
      f.until('MPh', { turn: 2, attacker: 'ge' });
    },
  },
  {
    id: 'demo-mortar-moved',
    scenarioId: 'demo-gun-line',
    title: 'Mortar after moving',
    description: 'German Turn 1 Advancing Fire Phase: the 2-4-7 with the 50mm Mortar moved Q5-R5 in the MPh, so the Mortar may not fire now (its Fire entry is greyed with the reason).',
    build(f) {
      for (let i = 0; i < 4 && (f.decision.kind === 'setup' || f.decision.kind === 'offboardSetup'); i++) {
        const dflt = f.engine.legalActions(f.state, f.decision.owner).find((x) => x.type === 'setup.place' || x.type === 'setup.offboard');
        if (!dflt) throw new Error('Fixture: no default setup');
        const { side: _s, decisionId: _d, ...rest } = dflt;
        f.act(rest as Omit<Action, 'side' | 'decisionId'> & Record<string, unknown>);
      }
      f.until('MPh', { turn: 1, attacker: 'ge' });
      f.move([f.unit('ge', 'ge.247h')], ['yR5']);
      f.until('AFPh', { turn: 1, attacker: 'ge' });
    },
  },
  {
    id: 's8-exit-q10',
    scenarioId: 'sk-s8',
    title: 'Exit off Q10',
    description: 'German Turn 1 Movement Phase: the 9-1 with two 4-4-7s on Q10, the exit hex. Move the stack one hex south, off the map, to exit it whole.',
    build(f) {
      f.setup('ge', { [f.unit('ge', 'ge.L91')]: 'yQ10', [f.unit('ge', 'ge.447', 1)]: 'yQ10', [f.unit('ge', 'ge.447', 2)]: 'yQ10' });
      for (let i = 0; i < 4 && (f.decision.kind === 'setup' || f.decision.kind === 'offboardSetup'); i++) {
        const dflt = f.engine.legalActions(f.state, f.decision.owner).find((x) => x.type === 'setup.place' || x.type === 'setup.offboard');
        if (!dflt) throw new Error('Fixture: no default American setup');
        const { side: _s, decisionId: _d, ...rest } = dflt;
        f.act(rest as Omit<Action, 'side' | 'decisionId'> & Record<string, unknown>);
      }
      // One American squad enters (reinforcements that never enter are lost, and a side with none left has lost).
      f.until('MPh', { turn: 1, attacker: 'am' });
      const am = f.unit('am', 'am.747', 1);
      const entry = f.engine.legalActions(f.state, 'am').some((x) => x.type === 'move.start') ? null : 'none';
      if (entry) throw new Error('Fixture: no American move');
      f.act({ type: 'move.start', units: [am] });
      const step = f.engine.legalActions(f.state, 'am').find((x) => x.type === 'move.step');
      if (!step) throw new Error('Fixture: no American entry hex');
      f.act({ type: 'move.step', to: step['to'] as string });
      f.until('MPh', { turn: 1, attacker: 'ge' });
    },
  },
  {
    id: 's8-advance-q10',
    scenarioId: 'sk-s8',
    title: 'Advance off Q10',
    description: 'German Turn 1 Advance Phase: the 9-1 with two 4-4-7s on Q10, the exit hex. Advance the stack off the map (the green hex beyond the edge) to exit it (ASLRB A2.6).',
    build(f) {
      const exit = DEV_FIXTURES.find((x) => x.id === 's8-exit-q10')!;
      exit.build(f);
      f.until('APh', { turn: 1, attacker: 'ge' });
    },
  },
  {
    id: 's19-hs-mg-group',
    scenarioId: 'sk-s19',
    title: 'Half-squads with MGs',
    description: 'American Turn 1 Defensive Fire Phase: two German 2-3-8 half-squads with LMGs in adjacent X6 and X7, the American 7-4-7 and 8-0 in Z7 two hexes away: their LMGs form one Fire Group (SK1 4.0).',
    build(f) {
      const a = f.unit('ge', 'ge.238h', 1);
      const b = f.unit('ge', 'ge.238h', 2);
      f.setup('ge', { [a]: 'yX6', [b]: 'yX7' }, { [f.sw('ge', 'ge.LMG', 1)]: a, [f.sw('ge', 'ge.LMG', 2)]: b });
      // The Americans' setups (the entering forces' offboard setup, then Z7), as the engine places them by default.
      for (let i = 0; i < 4 && (f.decision.kind === 'setup' || f.decision.kind === 'offboardSetup'); i++) {
        const dflt = f.engine.legalActions(f.state, f.decision.owner).find((x) => x.type === 'setup.place' || x.type === 'setup.offboard');
        if (!dflt) throw new Error('Fixture: no default American setup');
        const { side: _s, decisionId: _d, ...rest } = dflt;
        f.act(rest as Omit<Action, 'side' | 'decisionId'> & Record<string, unknown>);
      }
      f.until('DFPh', { turn: 1, attacker: 'am' });
    },
  },
  {
    id: 'pacific-banzai',
    scenarioId: 'demo-pacific',
    title: 'Banzai Charge',
    description: 'Japanese Turn 1 Movement Phase on board o: the 9-1 with two 4-4-7s in the jungle at T10, six hexes along the south edge from two Marine squads in N10, in LOS: a Banzai Charge is on (SK4 8.1.8.6).',
    build(f) {
      f.setup('ja', { [f.unit('ja', 'ja.L91')]: 'oT10', [f.unit('ja', 'ja.447', 1)]: 'oT10', [f.unit('ja', 'ja.447', 4)]: 'oT10' });
      f.setup('am', { [f.unit('am', 'am.768', 4)]: 'oN10', [f.unit('am', 'am.768', 5)]: 'oN10' });
      f.until('MPh', { turn: 1, attacker: 'ja' });
    },
  },
  {
    id: 'pacific-marines',
    scenarioId: 'demo-pacific',
    title: 'Marine Rally Phase',
    description: 'American Turn 1 Rally Phase on board o with both sides in their default setup: the 7-6-8 squads may deploy by NTC and two 3-4-8 half-squads with a leader recombine (SK4 8.4).',
    build(f) {
      f.setup('ja', {});
      f.setup('am', { [f.unit('am', 'am.768', 1)]: 'oL5', [f.unit('am', 'am.768', 2)]: 'oL5', [f.unit('am', 'am.L92')]: 'oL5' });
      f.until('RPh', { turn: 1, attacker: 'am' });
    },
  },
  {
    id: 'two-story-house',
    scenarioId: 'asl-testbed',
    title: 'Two Story House (levels)',
    description:
      'German Turn 2 Prep Fire Phase. Russians on both levels of P3 in the P2-P3 stone house (a Two Story House): the 9-1 with a 4-5-8 and its MMG upstairs, the 5-2-7 on the ground. The 9-2, the assault engineers and the 5-4-8 are in Q3 beside it. Fire at P3 to pick a level; in the MPh enter P2 and take the stairs from the wheel.',
    build(f) {
      levelsSetup(f);
      f.until('MPh', { turn: 1, attacker: 'ge' });
      f.move([f.unit('ge', 'ge.L92'), f.unit('ge', 'ge.838'), f.unit('ge', 'ge.548')], ['uS3', 'uR3', 'uQ3']);
      f.until('PFPh', { turn: 2, attacker: 'ge' });
    },
  },
  {
    id: 'los-heights',
    scenarioId: 'asl-testbed',
    title: 'LOS with heights',
    description:
      'Russian Turn 2 Prep Fire Phase. The Germans hold level 1 of P2 (the 9-2, the assault engineers and the 5-4-8). Russians upstairs: the 9-1, a 4-5-8 and the MMG on level 1 of K5, a 4-4-7 on level 1 of M5; level 1 sees over the Single Story Houses N3 and N4 to level 1 of P2, the ground floors below do not. The 4-5-8 in I4 is behind the L3-M3 Two Story House (1½ levels), the 7-0 and the 4-2-6 on the hill in H5 behind I3-I5. Fire, then click the shot in the log to see its LOS.',
    build(f) {
      losHeightsSetup(f);
      f.until('MPh', { turn: 1, attacker: 'ge' });
      const stack = [f.unit('ge', 'ge.L92'), f.unit('ge', 'ge.838'), f.unit('ge', 'ge.548')];
      f.move(stack, ['uS3', 'uR3', 'uQ3']);
      f.until('MPh', { turn: 2, attacker: 'ge' });
      f.move(stack, ['uP2', 'uP2:1']);
      f.until('PFPh', { turn: 2, attacker: 'ru' });
    },
  },
  {
    id: 'orchard-road',
    scenarioId: 'asl-testbed',
    title: 'Orchard-Road',
    description:
      'German Turn 2 Movement Phase. The 8-0 with a 4-6-7 and a 4-4-7 stand in the Q4 orchard, at the corner of the tree-lined road Q4-P4-O5-N5-M6; a Russian 4-4-7 watches the road from L6, another the K8-J8 road from level 1 of M7. Move the stack into P4 along the road: the wheel asks road (FFMO from L6, whose LOS runs down the road with no orchard Hindrance) or orchard (no FFMO, no road bonus).',
    build(f) {
      orchardRoadSetup(f);
      f.until('MPh', { turn: 1, attacker: 'ge' });
      f.move([f.unit('ge', 'ge.L80'), f.unit('ge', 'ge.467', 3), f.unit('ge', 'ge.447', 1)], ['uR4', 'uQ4']);
      f.until('MPh', { turn: 2, attacker: 'ge' });
    },
  },
  {
    id: 'bypass',
    scenarioId: 'asl-testbed',
    title: 'Bypass',
    description:
      'German Turn 2 Movement Phase. The 8-0 with a 4-6-7 and a 4-4-7 stand in Q4, next to the wooden single-hex building R3; the Russian 4-2-6 in P5 and 5-2-7 in P3 watch. Start the stack moving: the corners of R3 show as targets beside the green hexes. Bypass round R3 (one MF for one or two hexsides, two from the third), then leave at the corner or enter the building. As the Russian, fire at the stack in Bypass and pick the point your LOS is traced to.',
    build(f) {
      orchardRoadSetup(f);
      f.until('MPh', { turn: 1, attacker: 'ge' });
      f.move([f.unit('ge', 'ge.L80'), f.unit('ge', 'ge.467', 3), f.unit('ge', 'ge.447', 1)], ['uR4', 'uQ4']);
      f.until('MPh', { turn: 2, attacker: 'ge' });
    },
  },
];

/** The dev fixtures of a scenario. */
export const fixturesFor = (scenarioId: string): DevFixture[] => DEV_FIXTURES.filter((x) => x.scenarioId === scenarioId);

/** The actions that build `fixtureId` from `state`, a game with no action yet. */
export function fixtureActions(engine: Engine, state: GameState, fixtureId: string): Action[] {
  const fx = DEV_FIXTURES.find((x) => x.id === fixtureId);
  if (!fx) throw new Error(`No dev fixture "${fixtureId}"`);
  if (state.scenarioId !== fx.scenarioId) throw new Error(`Dev fixture "${fixtureId}" is for ${fx.scenarioId}, not ${state.scenarioId}`);
  const b = new FixtureBuilder(engine, state);
  fx.build(b);
  return b.actions;
}
