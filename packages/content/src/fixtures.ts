import type { Action, Decision, Engine, GameState, HexId, PieceId, SideId } from '@asl/engine';
import { byId, sideToward, statics, type FortPlacement } from '@asl/rules';

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
 * - `f.fortify(['uP2', 'uP2:1'])` answers the `fortified-buildings` designation with Locations (ASLRB B23.911).
 * - `f.fortPlace(counters)` places a side's fortification counters in its setup decision (the `fortifications` rule).
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
const PASSES = ['defPass', 'defRofDecline', 'defMotion.done', 'move.end', 'cc.arranged', 'blaze.stay', 'endPhase'];

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

  /** Answer the fortified-building designation with Locations (B23.911). */
  fortify(locations: string[]): void {
    if (this.decision.kind !== 'fortify') throw new Error(`Fixture: expected the fortify decision, not ${this.decision.kind}`);
    this.act({ type: 'fortify.designate', locations });
  }

  /** Place the fortification counters of the side whose setup decision is pending (ASLRB A12.33, B26–B30; the `fortifications` rule). */
  fortPlace(counters: FortPlacement[]): void {
    if (this.decision.kind !== 'setup') throw new Error(`Fixture: expected a setup decision, not ${this.decision.kind}`);
    this.act({ type: 'fort.place', counters });
  }

  /**
   * Answer `side`'s setup decision: the given units in the given hexes, the rest where the engine's default puts them;
   * `extra` adds to the action (`hidden`: the units set up hidden under a HIP special rule).
   */
  setup(side: SideId, placements: Record<PieceId, HexId>, sw: Record<PieceId, PieceId> = {}, extra: Record<string, unknown> = {}): void {
    const d = this.decision;
    if (d.kind !== 'setup' || d.owner !== side) throw new Error(`Fixture: expected the ${side} setup, not ${d.kind} (${d.owner})`);
    const dflt = this.engine.legalActions(this.state, side).find((a) => a.type === 'setup.place');
    if (!dflt) throw new Error(`Fixture: no default setup for ${side}`);
    const { side: _s, decisionId: _d, ...base } = dflt as Action & { placements: Record<PieceId, HexId>; sw?: Record<PieceId, PieceId> };
    this.act({ ...base, placements: { ...base.placements, ...placements }, sw: { ...(base.sw ?? {}), ...sw }, ...extra });
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
function testbedSetup(f: FixtureBuilder, fortified: string[]) {
  testbedSetupWith(f, fortified, {});
}

/**
 * The test bed setup with some Russian units elsewhere: `moved` maps "def" or "def#n" to a Location; `hidden` names
 * the defs set up hidden under the HIP special rule.
 */
function testbedSetupWith(f: FixtureBuilder, fortified: string[], moved: Record<string, string>, hidden: string[] = []) {
  const ru = (def: string, n = 1) => f.unit('ru', def, n);
  const at = (def: string, n: number, hex: string) => moved[`${def}#${n}`] ?? (n === 1 ? moved[def] : undefined) ?? hex;
  const ge = (def: string, n = 1) => f.unit('ge', def, n);
  f.fortify(fortified);
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
  }, {}, hidden.length ? { hidden: hidden.map((d) => ru(d)) } : {});
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
 * The test bed's fortification counters (SSR 3), one of every kind, open and hidden, on the village's eastern edge:
 * a hidden 2S foxhole in O6 and an open 1S one in O10, the two trenches in O7 and P6 (connecting, ASLRB B27.54), Wire
 * hidden in O4 and open in P9, 8 A-P factors with one A-T factor recorded in P10, a Known 6 in N9 and the Dummy in N10,
 * the roadblock on the O9–P8 road hexside (hidden) and the 1+3+5 pillbox in O3 facing east (hidden).
 */
export function testbedForts(f: FixtureBuilder): FortPlacement[] {
  const map = statics(f.engine.env(f.state)).map;
  return [
    { kind: 'foxhole', hex: 'uO6', hidden: true, capacity: 2 },
    { kind: 'trench', hex: 'uO7', hidden: false },
    { kind: 'trench', hex: 'uP6', hidden: false },
    { kind: 'wire', hex: 'uO4', hidden: true },
    { kind: 'wire', hex: 'uP9', hidden: false },
    { kind: 'mines', hex: 'uP10', hidden: true, mines: { ap: 8, at: 1 } },
    { kind: 'mines', hex: 'uN9', hidden: false, mines: { ap: 6, known: true } },
    { kind: 'mines', hex: 'uN10', hidden: false, mines: { known: true, dummy: true } },
    { kind: 'roadblock', hex: 'uO9', hidden: true, hexside: sideToward(map, 'uO9', 'uP8')! },
    { kind: 'pillbox', hex: 'uO3', hidden: true, ca: 0, pillbox: { capacity: 1, ca: 3, nca: 5 } },
    { kind: 'foxhole', hex: 'uO10', hidden: false, capacity: 1 },
  ];
}

/**
 * The test bed setup with the counters of `testbedForts` down and the Russians in them: a 4-5-8 inside the pillbox,
 * a 4-4-7 beneath the O6 foxhole, the Conscripts beneath the O7 trench, the other 4-5-8 beneath the P6 trench, the
 * 5-2-7 on top of the Wire in P9; the Germans as usual, or (`germans`) where given.
 */
function fortsSetup(f: FixtureBuilder, opts: { germans?: boolean | Record<string, string> } = {}) {
  const ru = (def: string, n = 1) => f.unit('ru', def, n);
  f.fortify(TESTBED_FORTIFIED);
  f.fortPlace(testbedForts(f));
  f.setup('ru', {
    [ru('ru.L91')]: 'uK4',
    [ru('ru.458', 1)]: 'uO3:pb',
    [ru('ru.447', 1)]: 'uO6',
    [ru('ru.458', 2)]: 'uP6',
    [ru('ru.447', 2)]: 'uM5',
    [ru('ru.447', 3)]: 'uN7',
    [ru('ru.527')]: 'uP9',
    [ru('ru.426', 1)]: 'uO7',
    [ru('ru.L70')]: 'uH5',
    [ru('ru.426', 2)]: 'uH5',
  }, {}, { beneath: [ru('ru.447', 1), ru('ru.458', 2), ru('ru.426', 1)] });
  if (opts.germans === false) return;
  const ge = (def: string, n = 1) => f.unit('ge', def, n);
  if (typeof opts.germans === 'object') {
    f.setup('ge', Object.fromEntries(Object.entries(opts.germans).map(([k, hex]) => [f.unit('ge', k.split('#')[0]!, Number(k.split('#')[1] ?? 1)), hex])));
    return;
  }
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
  testbedSetupWith(f, ['uK4', 'uK4:1', 'uK5', 'uK5:1'], { 'ru.L91': 'uK5:1', 'ru.458#1': 'uK5:1', 'ru.447#2': 'uM5:1', 'ru.527': 'uK4' });
}

/**
 * Board-u terrain: a Russian 4-4-7 on the paved road at L6 looking up the tree-lined road M6-N5-O5-P4, and
 * another on level 1 of M7 looking west down the K8-J8 Orchard-Road (ASLRB B14.6: in season, the road is open to it).
 */
function orchardRoadSetup(f: FixtureBuilder) {
  testbedSetupWith(f, TESTBED_FORTIFIED, { 'ru.447#3': 'uL6', 'ru.447#2': 'uM7:1' });
}

/** The Locations the test bed fixtures fortify: both levels of P2 and P3, the stone house nearest the German setup area. */
export const TESTBED_FORTIFIED = ['uP2', 'uP2:1', 'uP3', 'uP3:1'];

/**
 * A German Turn 1 that reveals the fortified P3: the 9-2's stack walks T3-S3-R3-Q3 in the MPh and the 5-4-8 tries to
 * advance into P3 (held by the Good Order 5-2-7) in the APh, which is refused (ASLRB B23.922) and shows P3 fortified.
 */
/**
 * The test bed with `fortified` designated and the 9-2, the assault engineers (FT, DC) and the 5-4-8 moved up to Q3 beside
 * P3 in German Turn 1 without trying to enter it: German Turn 2 MPh, nothing of P3 shown. A Breach attempt there is made
 * without knowing whether P3 is fortified (B23.9221).
 */
export function testbedBreachApproach(f: FixtureBuilder, fortified: string[]) {
  testbedSetup(f, fortified);
  f.until('MPh', { turn: 1, attacker: 'ge' });
  f.move([f.unit('ge', 'ge.L92'), f.unit('ge', 'ge.838'), f.unit('ge', 'ge.548')], ['uS3', 'uR3', 'uQ3']);
  f.until('MPh', { turn: 2, attacker: 'ge' });
}

function revealP3(f: FixtureBuilder) {
  f.until('MPh', { turn: 1, attacker: 'ge' });
  f.move([f.unit('ge', 'ge.L92'), f.unit('ge', 'ge.838'), f.unit('ge', 'ge.548')], ['uS3', 'uR3', 'uQ3']);
  f.until('APh', { turn: 1, attacker: 'ge' });
  f.advance([f.unit('ge', 'ge.548')], 'uP3');
}

/**
 * The fire test bed (T2): the test bed setup with the Russian 9-1 and a 4-5-8 (MMG) in L3, the Flame's house, and the 5-2-7
 * in N3 beside the M3 Blaze; K4 is rubble, so the 4-4-7 that would stand there goes to K5.
 */
function fireSetup(f: FixtureBuilder) {
  testbedSetupWith(f, TESTBED_FORTIFIED, { 'ru.L91': 'uL3', 'ru.458#1': 'uL3', 'ru.447#1': 'uK5', 'ru.527': 'uN3' });
}


/**
 * The minefield test beds (T1, T3): the counters of `testbedForts` (and `extra`) down, the Russians away from the eastern
 * minefields (the 4-4-7 #3 where `ru447` says), and the Germans where `germans` says ("def#n": hex), the rest as usual.
 */
function minesSetup(f: FixtureBuilder, germans: Record<string, string>, opts: { ru447?: string; ru447b?: string; ru527?: string; hidden?: string[]; extra?: FortPlacement[]; forts?: (base: FortPlacement[]) => FortPlacement[] } = {}) {
  const ru = (def: string, n = 1) => f.unit('ru', def, n);
  f.fortify(TESTBED_FORTIFIED);
  const base = [...testbedForts(f), ...(opts.extra ?? [])];
  f.fortPlace(opts.forts ? opts.forts(base) : base);
  f.setup('ru', {
    [ru('ru.L91')]: 'uK4',
    [ru('ru.458', 1)]: 'uK4',
    [ru('ru.447', 1)]: 'uK5',
    [ru('ru.458', 2)]: 'uI4',
    [ru('ru.447', 2)]: opts.ru447b ?? 'uM5',
    [ru('ru.447', 3)]: opts.ru447 ?? 'uL7',
    [ru('ru.527')]: opts.ru527 ?? 'uP3',
    [ru('ru.426', 1)]: 'uH5',
    [ru('ru.L70')]: 'uH5',
    [ru('ru.426', 2)]: 'uH6',
  }, {}, opts.hidden?.length ? { hidden: opts.hidden.map((d) => ru(d)) } : {});
  f.setup('ge', Object.fromEntries(Object.entries(germans).map(([k, hex]) => [f.unit('ge', k.split('#')[0]!, Number(k.split('#')[1] ?? 1)), hex])));
}
const NINE_TWO = ['ge.L92', 'ge.838', 'ge.548'];

export const DEV_FIXTURES: DevFixture[] = [
  {
    id: 'kindling',
    scenarioId: 'asl-testbed',
    title: 'Fire: Kindling',
    description:
      'German Turn 1 Prep Fire Phase. The 9-2 with the assault engineers (FT, DC) and the 5-4-8 stand in the T3 woods (Kindle # 9): right-click T3 and choose Kindle… to predesignate the squads\' attempts, the 9-2 directing (his modifier reversed), after his NTC (ASLRB B25.11). Every unit that takes part is marked Prep Fire.',
    build(f) {
      testbedSetup(f, TESTBED_FORTIFIED);
      f.until('PFPh', { turn: 1, attacker: 'ge' });
    },
  },
  {
    id: 'blaze-spread',
    scenarioId: 'asl-testbed-fire',
    title: 'Fire: a Blaze spreads',
    description:
      'German Turn 1 Prep Fire Phase on the fire test bed: M3 and the T2 woods are ablaze, L3 holds a Flame (the 9-1 and a 4-5-8 are in it), K4 is rubble; the EC are Very Dry and a Mild Breeze blows north-east. At the end of this AFPh the Blazes roll to spread (B25.6) and the Flame to become a Blaze (B25.151); the 5-2-7 in N3 stands downwind of M3.',
    build(f) {
      fireSetup(f);
      f.until('PFPh', { turn: 1, attacker: 'ge' });
    },
  },
  {
    id: 'flame-clearance',
    scenarioId: 'asl-testbed-fire',
    title: 'Fire: fighting a Flame',
    description:
      'Russian Turn 1 Movement Phase on the fire test bed: the 9-1 and the 4-5-8 (MMG) stand in L3 with a Flame. Right-click L3 and choose Fight the fire… before any stack moves: one Clearance DR for the units joining, ≤ 2 puts it out, 3–6 Hampers it; they are TI for the Player Turn (ASLRB B24.72).',
    build(f) {
      fireSetup(f);
      f.until('MPh', { turn: 1, attacker: 'ru' });
    },
  },
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
    id: 'lma5-speirs-appears',
    scenarioId: 'lma-5',
    title: 'Lt Speirs appears on the X0-CC3 row',
    description:
      'SSR 4: every phase passed until Lt Dike fails his Rally Phase MC; the next American Rally Phase begins with the American setting up Lt Speirs on a hex of the X0-CC3 row (ASLRB A2.51).',
    build(f) {
      for (let i = 0; i < 4 && f.decision.kind === 'setup'; i++) {
        const dflt = f.engine.legalActions(f.state, f.decision.owner).find((x) => x.type === 'setup.place');
        if (!dflt) throw new Error('Fixture: no default setup');
        const { side: _s, decisionId: _d, ...rest } = dflt;
        f.act(rest as Omit<Action, 'side' | 'decisionId'> & Record<string, unknown>);
      }
      const speirs = f.unit('am', 'am.L102');
      for (let guard = 0; guard < 3000 && !f.state.result; guard++) {
        if (f.decision.kind === 'offboardSetup') {
          // Due (relieved the turn before): his placement is on top of the Rally Phase. Item Company sets up as the default puts it.
          if (f.state.pieces[speirs]!.tags['entryTurn'] === f.state.turn) return;
          const dflt = f.engine.legalActions(f.state, f.decision.owner).find((x) => x.type === 'setup.offboard');
          if (!dflt) throw new Error('Fixture: no default offboard setup');
          const { side: _s, decisionId: _d, ...rest } = dflt;
          f.act(rest as Omit<Action, 'side' | 'decisionId'> & Record<string, unknown>);
          continue;
        }
        f.pass();
      }
      throw new Error('Fixture: Lt Dike never failed his Morale Check');
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
  {
    id: 'demo-armor-infantry-with-afv',
    scenarioId: 'demo-armor',
    title: 'Infantry stacked with a tank',
    description:
      'American Turn 2 Prep Fire Phase. The 6-6-7 and the 8-1 stand in L6 with the M4A2(L). Right-click L6: Fire (the stack) is the Infantry, the tank fires from its own entries (MA, MGs, IFE + MGs); tick units in the stack card to put a Fire Group together across them.',
    build(f) {
      f.until('MPh', { turn: 1, attacker: 'am' });
      f.move([f.unit('am', 'am.667'), f.unit('am', 'am.L81')], ['yL6']);
      f.until('PFPh', { turn: 2, attacker: 'am' });
    },
  },
  {
    id: 's35-dc-dug-in',
    scenarioId: 'sk-s35',
    title: 'DC on the dug-in T-34',
    description:
      'German Turn 3 Movement Phase. The 8-3-8 with the DC and the 8-0 stand in the J3 stone building; the dug-in T-34 M41 is in J4 next door. Start the stack moving, pick Place DC… on the wheel and click J4: the DC is predesignated against the T-34 (a PAATC first, SK4 4.3).',
    build(f) {
      f.setup('ru', { [f.unit('ru', 'ru.T34M41')]: 'zJ4' });
      const sq = f.unit('ge', 'ge.838', 2);
      const ld = f.unit('ge', 'ge.L80');
      const dflt = f.engine.legalActions(f.state, 'ge').find((x) => x.type === 'setup.offboard');
      if (!dflt) throw new Error('Fixture: no default German offboard setup');
      const { side: _s, decisionId: _d, ...rest } = dflt as Action & { placements: Record<PieceId, HexId> };
      f.act({ ...rest, placements: { ...rest.placements, [sq]: 'zK0', [ld]: 'zK0' } });
      f.until('MPh', { turn: 1, attacker: 'ge' });
      f.move([sq, ld], ['zK1', 'zK2', 'zJ2']);
      f.until('MPh', { turn: 2, attacker: 'ge' });
      f.move([sq, ld], ['zJ3']);
      // The Turn 3 German reinforcements are set up offboard where the engine's default puts them.
      for (let guard = 0; guard < 2000 && !(f.state.phase === 'MPh' && f.state.turn === 3 && f.state.attacker === 'ge'); guard++) {
        const entry = f.decision.kind === 'offboardSetup' ? f.engine.legalActions(f.state, f.decision.owner).find((x) => x.type === 'setup.offboard') : undefined;
        if (!entry) {
          f.pass();
          continue;
        }
        const { side: _s2, decisionId: _d2, ...placed } = entry;
        f.act(placed as Omit<Action, 'side' | 'decisionId'>);
      }
    },
  },
  {
    id: 'fortified-breach',
    scenarioId: 'asl-testbed',
    title: 'Fortified building: Breach',
    description:
      'German Turn 2 Movement Phase. The 9-2 with the assault engineers (FT, DC) and the 5-4-8 stand in Q3 beside P3, a Fortified Building Location they know of (the 5-4-8 tried to advance in last turn and was refused: a Good Order 5-2-7 holds it, ASLRB B23.922). Move the stack, choose Place DC… and click P3: "Breach P3/Q3" places the DC against the hexside for one MF; in the AFPh a NMC or better Breaches it, and in the APh the stack may advance in through the gap.',
    build(f) {
      testbedSetup(f, TESTBED_FORTIFIED);
      revealP3(f);
      f.until('MPh', { turn: 2, attacker: 'ge' });
    },
  },
  {
    id: 'breach-unknown',
    scenarioId: 'asl-testbed',
    title: 'Breach: a Location not known to be fortified',
    description:
      'German Turn 2 Movement Phase. The 9-2 with the assault engineers (FT, DC) and the 5-4-8 stand in Q3 beside P3, where the Russian 5-2-7 is; the Germans have not been shown whether P3 is fortified (it is). Move the stack, choose Place DC… and click P3: the wheel offers "Breach P3/Q3" all the same (ASLRB B23.9221; official Q&A). In the AFPh the hexside takes the fortified TEM: a NMC or better Breaches it and shows P3 fortified; a lesser result shows nothing. Click R3 behind them instead, a wooden house outside the Russian setup area that cannot be fortified: the Breach entry is greyed, with the reason.',
    build(f) {
      testbedBreachApproach(f, TESTBED_FORTIFIED);
    },
  },
  {
    id: 'fortified-hidden',
    scenarioId: 'asl-testbed',
    title: 'Fortified building: a hidden squad inside',
    description:
      'German Turn 2 Movement Phase. The 8-0 with a 4-6-7 and a 4-4-7 stand in Q4 beside P3, which looks empty: the Russian 5-2-7 set up there hidden (SSR 2), and P3 is fortified. Move the stack into P3: the attempt is refused (ASLRB B23.922), the fortification and the squad come to light, the MF are spent in Q4 and the move is over.',
    build(f) {
      testbedSetupWith(f, TESTBED_FORTIFIED, {}, ['ru.527']);
      f.until('MPh', { turn: 1, attacker: 'ge' });
      f.move([f.unit('ge', 'ge.L80'), f.unit('ge', 'ge.467', 3), f.unit('ge', 'ge.447', 1)], ['uR4', 'uQ4']);
      f.until('MPh', { turn: 2, attacker: 'ge' });
    },
  },
  {
    id: 'fort-setup',
    scenarioId: 'asl-testbed',
    title: 'Fortifications: the setup tray',
    description:
      'Russian setup, nothing placed yet. The tray holds the units and, under them, the fortification counters SSR 3 gives: 3 squads of foxholes, a trench, two Wire, 12 recorded A-P factors (A-T by exchange), a Known 6 with a Dummy, a roadblock and a 1+3+5 pillbox. Place them openly or hidden (the hex wheel), a roadblock by its road hexside and the pillbox by its Covered Arc; put units beneath or inside them from the wheel.',
    build(f) {
      f.fortify(TESTBED_FORTIFIED);
    },
  },
  {
    id: 'fort-owner',
    scenarioId: 'asl-testbed',
    title: 'Fortifications: the counters down, the units to place',
    description:
      "Russian setup with every counter placed (one of each kind, open and hidden: a hidden 2S foxhole in O6, an open 1S in O10, the connecting trenches in O7 and P6, Wire hidden in O4 and open in P9, recorded mines in P10, a Known 6 in N9 and the Dummy in N10, the roadblock on O9–P8, the pillbox in O3 facing east). The units are still in the tray: drop a squad on O6, O7, P6, O10, P9 or O3 and the wheel offers the foxhole, trench, Wire and pillbox.",
    build(f) {
      f.fortify(TESTBED_FORTIFIED);
      f.fortPlace(testbedForts(f));
    },
  },
  {
    id: 'fort-placed',
    scenarioId: 'asl-testbed',
    title: "Fortifications: the German's view",
    description:
      'German setup. The Russians have set up with their counters (fort-owner) and their units in them: a 4-5-8 in the pillbox, a 4-4-7 beneath the O6 foxhole, the Conscripts beneath the O7 trench, a 4-5-8 beneath the P6 trench, the 5-2-7 on the Wire in P9. The German sees the open counters (O7, P6, O10, P9), two blank Known Minefield counters (N9, N10) and nothing of the hidden ones until a Good Order German has a LOS to them (A12.33) when the first Player Turn begins.',
    build(f) {
      fortsSetup(f, { germans: false });
    },
  },
  {
    id: 'entrench',
    scenarioId: 'asl-testbed',
    title: 'Entrenching: the Russian PFPh',
    description:
      'Russian Turn 1 Prep Fire Phase with diggers ready (ASLRB B27.11): the 4-4-7 and the 7-0 in the open at M10 (right-click: Entrench…, the leader directs at -1 and the Russians take -1 more), the Conscripts standing on top of the open 1S foxhole in O10 (an attempt there grows it to 2S). Every participant is TI for the Player Turn; a failure earns Labor -1 for the next try there.',
    build(f) {
      const ru = (def: string, n = 1) => f.unit('ru', def, n);
      f.fortify(TESTBED_FORTIFIED);
      f.fortPlace(testbedForts(f));
      f.setup('ru', {
        [ru('ru.L91')]: 'uK4',
        [ru('ru.458', 1)]: 'uO3:pb',
        [ru('ru.447', 1)]: 'uO6',
        [ru('ru.458', 2)]: 'uP6',
        [ru('ru.447', 2)]: 'uM5',
        [ru('ru.447', 3)]: 'uM10',
        [ru('ru.L70')]: 'uM10',
        [ru('ru.527')]: 'uP9',
        [ru('ru.426', 1)]: 'uO7',
        [ru('ru.426', 2)]: 'uO10',
      }, {}, { beneath: [ru('ru.447', 1), ru('ru.458', 2), ru('ru.426', 1)] });
      f.setup('ge', {});
      f.until('PFPh', { turn: 1, attacker: 'ru' });
    },
  },
  {
    id: 'foxhole-fight',
    scenarioId: 'asl-testbed',
    title: 'Foxholes: the German Movement Phase',
    description:
      'German Turn 1 Movement Phase with the Germans close in: the 9-2 with the 8-3-8 and the 5-4-8 in S6, the 4-6-7s in S5, S7 and T5. The Russians sit beneath their counters (a 4-4-7 under the O6 foxhole, the Conscripts and a 4-5-8 under the O7 and P6 trenches), the open 1S foxhole in O10 is empty. Move at them: their Defensive First Fire comes from beneath (+2 TEM against your return fire, no FFMO for them); an Assault Moving stack clicking O10 may go straight beneath its foxhole; the stack card shows who is beneath.',
    build(f) {
      fortsSetup(f, { germans: { 'ge.L92': 'uS6', 'ge.838': 'uS6', 'ge.548': 'uS6', 'ge.467#1': 'uS5', 'ge.467#2': 'uS7', 'ge.467#3': 'uT5', 'ge.L80': 'uS4', 'ge.447#1': 'uS4', 'ge.447#2': 'uS4' } });
      f.until('MPh', { turn: 1, attacker: 'ge' });
    },
  },
  {
    id: 'trench-move',
    scenarioId: 'asl-testbed',
    title: 'Trenches: moving along the line',
    description:
      'Russian Turn 1 Movement Phase. The 4-5-8 beneath the P6 trench and the Conscripts beneath the O7 trench are in connecting trenches (ASLRB B27.54): a step from one to the other costs one MF, stays beneath, and draws no FFNAM, FFMO or Snap Shot. A stack beneath sees "Out of the trench (1 MF)" on its wheel; the 4-4-7 beneath the O6 foxhole likewise.',
    build(f) {
      fortsSetup(f);
      f.until('MPh', { turn: 1, attacker: 'ru' });
    },
  },
  {
    id: 'foxhole-hidden',
    scenarioId: 'asl-testbed',
    title: 'Foxholes: a hidden one out of sight',
    description:
      'Russian Turn 1 Prep Fire Phase. A 4-4-7 sits beneath a hidden 1S foxhole in the C2 woods, more than 16 hexes from every German, so no LOS reveals it (ASLRB A12.33). In the MPh it may climb out and go back beneath for no MF, unseen: the German screen shows the squad in C2, no foxhole and no move in or out of one.',
    build(f) {
      const ru = (def: string, n = 1) => f.unit('ru', def, n);
      f.fortify(TESTBED_FORTIFIED);
      f.fortPlace([{ kind: 'foxhole', hex: 'uC2', hidden: true, capacity: 1 }]);
      f.setup('ru', { [ru('ru.447', 3)]: 'uC2' }, {}, { beneath: [ru('ru.447', 3)] });
      f.setup('ge', {});
      f.until('PFPh', { turn: 1, attacker: 'ru' });
    },
  },
  {
    id: 'snap-shot',
    scenarioId: 'asl-testbed',
    title: 'Snap Shot',
    description:
      'German Turn 2 Movement Phase. The 8-0 with a 4-6-7 and a 4-4-7 stand in R4, next to the wooden building R3. A Russian 4-4-7 in the N3 house sees the whole R3-R4 hexside but not R3 itself; the 5-2-7 in P3 and the 4-2-6 in P5 watch too. Move the stack into R3; as the Russian, declare fire on it and choose "Snap Shot at R3-R4": half FP, no building TEM, no FFNAM or FFMO, traced to both corners of the hexside (ASLRB A8.15).',
    build(f) {
      testbedSetupWith(f, TESTBED_FORTIFIED, { 'ru.447#3': 'uN3' });
      f.until('MPh', { turn: 1, attacker: 'ge' });
      f.move([f.unit('ge', 'ge.L80'), f.unit('ge', 'ge.467', 3), f.unit('ge', 'ge.447', 1)], ['uR4']);
      f.until('MPh', { turn: 2, attacker: 'ge' });
    },
  },
  {
    id: 'mg-vs-afv',
    scenarioId: 'sk-s30',
    title: 'Machine guns at a tank',
    description:
      'German Turn 1 Prep Fire Phase. The 4-6-7 with the MMG stands in E4, the 4-4-7 with the LMG in D4; an M4A3 Sherman entered at E6 and stopped there. Right-click E4: "Fire MMG at a vehicle" aims the MMG at the Sherman as ordnance (SK4 4.1): the All MG To Hit row, then the AP To Kill Table, within its normal range and never with halved FP.',
    build(f) {
      f.setup('ge', { [f.unit('ge', 'ge.467')]: 'vE4', [f.unit('ge', 'ge.447')]: 'vD4' });
      for (let guard = 0; guard < 200 && !(f.state.phase === 'MPh' && f.state.attacker === 'am'); guard++) {
        const entry = f.decision.kind === 'offboardSetup' ? f.engine.legalActions(f.state, f.decision.owner).find((x) => x.type === 'setup.offboard') : undefined;
        if (!entry) {
          f.pass();
          continue;
        }
        const { side: _s, decisionId: _d, ...placed } = entry;
        f.act(placed as Omit<Action, 'side' | 'decisionId'>);
      }
      f.act({ type: 'vmove.start', vehicle: f.unit('am', 'am.M4A3') });
      f.settle('am');
      // The default offboard setup waits below E6.
      f.act({ type: 'move.step', to: 'vE6' });
      f.settle('am');
      f.act({ type: 'vmove.stop' });
      f.settle('am');
      if (f.engine.legalActions(f.state, 'am').some((a) => a.type === 'vmove.end')) f.act({ type: 'vmove.end' });
      f.settle('am');
      f.until('PFPh', { turn: 1, attacker: 'ge' });
    },
  },
  {
    id: 'mines-walk',
    scenarioId: 'asl-testbed',
    title: 'Minefields: walking in',
    description:
      'German Turn 2 Movement Phase. A 4-6-7 stands in Q10 beside P10, where the Russians recorded 8 A-P factors and an A-T factor (nothing on the board); the 9-2 with the 8-3-8 and the 5-4-8 stands in P8, two hexes from the Known 6 in N9 and the Dummy in N10. Move the 4-6-7 into P10: the minefield attacks it (one DR, no DRM), the counter appears for both sides, its strength only if the result has to be verified (ASLRB B28.41, B28.1). Move on into O10 (an exit attack in P10) and N10: the Dummy is found and removed. Walk the 9-2 stack O9 → N9: right-click N9 to choose the plain entry or Enter and clear.',
    build(f) {
      minesSetup(f, { 'ge.467#1': 'uS10', 'ge.L92': 'uS8', 'ge.838': 'uS8', 'ge.548': 'uS8' });
      f.until('MPh', { turn: 1, attacker: 'ge' });
      f.move([f.unit('ge', 'ge.467', 1)], ['uR10', 'uQ10']);
      f.move(NINE_TWO.map((d) => f.unit('ge', d)), ['uR8', 'uQ8', 'uP8']);
      f.until('MPh', { turn: 2, attacker: 'ge' });
    },
  },
  {
    id: 'mines-leave',
    scenarioId: 'asl-testbed',
    title: 'Minefields: leaving one',
    description:
      'Russian Turn 1 Movement Phase. A Russian 4-4-7 set up in its own Known minefield in N9 (setting up there draws no attack). Move it out: the minefield attacks it as it leaves, in N9 (ASLRB B28.41, B28.412); broken or pinned by that attack it stays in N9, its MF spent there. Out into O9 or M10: no other attack.',
    build(f) {
      minesSetup(f, {}, { ru447: 'uN9' });
      f.until('MPh', { turn: 1, attacker: 'ru' });
    },
  },
  {
    id: 'mines-own',
    scenarioId: 'asl-testbed',
    title: 'Minefields: the owner\'s own',
    description:
      'Russian Turn 1 Movement Phase. A Russian 4-4-7 stands in O10 beside P10, where the Russians recorded their own hidden minefield. Move it into P10: its own mines attack it, and the minefield is put on the board for the Germans to see (ASLRB B28.41; a unit never passes its own hidden minefield unharmed).',
    build(f) {
      minesSetup(f, {}, { ru447: 'uO10' });
      f.until('MPh', { turn: 1, attacker: 'ru' });
    },
  },
  {
    id: 'mines-advance',
    scenarioId: 'asl-testbed',
    title: 'Minefields: advancing',
    description:
      'German Turn 2 Advance Phase. The 9-2 stack stands in O9 beside the Known minefield in N9. Advance into N9: the minefield attacks the advancing units on entry (ASLRB B28.411); advance out of it next turn and it attacks them on the way out first.',
    build(f) {
      minesSetup(f, { 'ge.L92': 'uS8', 'ge.838': 'uS8', 'ge.548': 'uS8' });
      f.until('MPh', { turn: 1, attacker: 'ge' });
      f.move(NINE_TWO.map((d) => f.unit('ge', d)), ['uR8', 'uQ8', 'uP8', 'uO9']);
      f.until('APh', { turn: 2, attacker: 'ge' });
    },
  },
  {
    id: 'mines-clear',
    scenarioId: 'asl-testbed',
    title: 'Minefields: Clearance',
    description:
      'Russian Turn 1 Movement Phase. A 4-4-7 stands in the Known minefield in N9, another 4-4-7 beside it in M10. Before any stack moves, right-click N9: Clear the minefield (Trail Break)… — no MF and no First Fire, the squad is TI and you name the TB\'s two hexsides (ASLRB B24.74). Then move the M10 squad: click N9 and choose Enter and clear, picking the TB\'s other hexside: all its MF, no attack, a partial Trail Break, TI. The Clearance DR comes at the end of the CCPh: ≤ 2 places the TB, an Original 12 Reduces the clearers; until then the entering squad leaves free of attack only back into M10.',
    build(f) {
      minesSetup(f, {}, { ru447: 'uN9', ru447b: 'uM10' });
      f.until('MPh', { turn: 1, attacker: 'ru' });
    },
  },
  {
    id: 'mines-tb',
    scenarioId: 'asl-testbed-mines',
    title: 'Minefields: a Trail Break',
    description:
      'German Turn 2 Movement Phase on the minefield test bed. The Known minefield in N9 has a Trail Break from its O9 hexside to its M10 hexside (drawn on the hex); the 9-2 stack stands in O9. Click N9: Enter along the TB costs twice the MF and draws no attack, with the -1 TB Defensive First Fire DRM (ASLRB B28.61, B13.4212); leaving into M10 along the same TB draws none either. Entering by another hexside, or leaving by one, is attacked.',
    build(f) {
      minesSetup(f, { 'ge.L92': 'uS8', 'ge.838': 'uS8', 'ge.548': 'uS8' });
      f.until('MPh', { turn: 1, attacker: 'ge' });
      f.move(NINE_TWO.map((d) => f.unit('ge', d)), ['uR8', 'uQ8', 'uP8', 'uO9']);
      f.until('MPh', { turn: 2, attacker: 'ge' });
    },
  },
  {
    id: 'mines-armor',
    scenarioId: 'asl-testbed-mines',
    title: 'Minefields: AFV and A-T mines',
    description:
      'German Turn 1 Movement Phase on the minefield test bed. The PzKpfw IVF2 is in S10 and the PSW 234/1 armoured car in S9; P10 holds recorded A-P and A-T mines, and the Russians put 2 open A-T mines on the paved road at P8 (in full view). Drive into P10: the A-P attack first (only a KIA immobilizes an AFV), then the A-T dr and attack on the 36+ column with the Aerial AF (ASLRB B28.42, B28.51, B28.52); a fully tracked AFV that gets through leaves a partial Trail Break, a full one when it drives out by another hexside. In the Russian Movement Phase the 4-4-7 in O9 can step to P8 and spend one more MF to remove the A-T mines at the end of the MPh (B28.53).',
    build(f) {
      minesSetup(f, { 'ge.pzivf2': 'uS10', 'ge.psw2341': 'uS9' }, { ru447: 'uO9', extra: [{ kind: 'mines', hex: 'uP8', hidden: false, mines: { at: 2 } }] });
      f.until('MPh', { turn: 1, attacker: 'ge' });
    },
  },
  {
    id: 'mines-belt',
    scenarioId: 'asl-testbed-mines',
    title: 'Minefields: a Known belt',
    description:
      'Russian setup on the minefield test bed, nothing placed yet: 24 Known minefield factors. In the fortification tray press Known belt, click the first hex and then the other end along a Hex Grain (for an Alternate Hex Grain choose the left or right zigzag): every hex between them becomes a Known minefield, listed in the tray with none / 6 / 8 / 12 to record. The Germans see the two arrowed end counters and a blank Known counter in each hex; an unmined hex found by a unit is marked as a Dummy (ASLRB B28.46, B28.47).',
    build(f) {
      f.fortify(TESTBED_FORTIFIED);
    },
  },
  {
    id: 'booby-traps',
    scenarioId: 'asl-testbed-mines',
    title: 'Booby Traps',
    description:
      'German Turn 1 Movement Phase on the minefield test bed: the Russians have Booby Trap capability Level A on board u (SSR 4). Move toward the Russians: every German Task Check on board u (a PTC from Defensive First Fire, a Leader Loss TC) with an Original DR of 11 or 12 sets off a Booby Trap: Casualty Reduction to a unit of its Location by Random Selection, perhaps another than the one that rolled; broken and pinned units roll the PTC for this alone (ASLRB B28.9).',
    build(f) {
      minesSetup(f, { 'ge.L92': 'uS8', 'ge.838': 'uS8', 'ge.548': 'uS8' });
      f.until('MPh', { turn: 1, attacker: 'ge' });
    },
  },
  {
    id: 'mines-rout',
    scenarioId: 'asl-testbed-mines',
    title: 'Minefields: rout',
    description:
      'German Turn 1 Rout Phase on the minefield test bed: the Russian 4-4-7s set up in P10 (in their own recorded minefield) and O10 began play broken. Select one: the rout ends are drawn, those reached only through the Known minefield in N9 tagged "via minefield (optional)" — a router need not go through a known minefield (ASLRB B28.413, A10.51). The P10 squad takes the exit attack as it leaves; a squad Reduced to a HS by a minefield attack may end its rout there (End rout here).',
    build(f) {
      minesSetup(f, {}, { ru447: 'uP10', ru447b: 'uO10' });
      f.until('RtPh', { turn: 1, attacker: 'ge' });
    },
  },
  {
    id: 'mines-hip',
    scenarioId: 'asl-testbed',
    title: 'Minefields: turned back by a hidden unit',
    description:
      'German Turn 2 Movement Phase. The recorded minefield is in O10 here (not P10), and the Russian 5-2-7 set up hidden in the N10 woods behind it. The 9-2 stack stands in O9: step into O10 (the entry attack), then into N10: the exit attack in O10 comes first, the hidden squad turns the stack back into O10, and the minefield attacks it again as it re-enters (ASLRB B28.412, A12.15).',
    build(f) {
      minesSetup(f, { 'ge.L92': 'uS8', 'ge.838': 'uS8', 'ge.548': 'uS8' }, {
        ru527: 'uN10',
        hidden: ['ru.527'],
        forts: (base) => base.filter((c) => !(c.kind === 'mines' && (c.hex === 'uP10' || c.hex === 'uN10')) && c.hex !== 'uO10').concat([{ kind: 'mines', hex: 'uO10', hidden: true, mines: { ap: 8, at: 1 } }]),
      });
      f.until('MPh', { turn: 1, attacker: 'ge' });
      f.move(NINE_TWO.map((d) => f.unit('ge', d)), ['uR8', 'uQ8', 'uP8', 'uO9']);
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
