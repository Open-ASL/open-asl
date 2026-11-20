import { describe, expect, it } from 'vitest';
import type { Action, Engine, GameState, RuleModule } from '@asl/engine';
import {
  BREACH_SIDE_DECISION,
  FORTIFIED_MODULE,
  aslCoreModules,
  breaches,
  fortifiableLocations,
  fortifiedKnownTo,
  fortifiedModule,
  fortifiedPossibleTo,
  fortifiedState,
  fortifiedView,
  isFortified,
  lofSides,
  moveState,
  piecesModule,
  redactState,
  shownUnfortified,
  statics,
  turnModule,
  type FireAttackCtx,
  type HexTerrainSpec,
} from '../../src';
import { sk1CoreModules } from '../../src/sk1';
import { sk2CoreModules } from '../../src/sk2';
import { sk3CoreModules } from '../../src/sk3';
import { act, makeEngine, type PieceSpec } from '../fixtures';
import { inCoveredArc, nearestSpine } from '../../src';
import { testFire } from './helpers';

/*
 * Fortified Building Locations in full ASL (ASLRB B23.9–B23.93): designation by Location (B23.911, B23.912), the
 * +1 per Location (B23.921), no entry while an enemy squad holds one (B23.922), Breach by DC and by a HE KIA
 * (B23.9221, B23.711, the A23.3 example) and Guns in fortified Locations (B23.93, C2.6). The house is board u's
 * K4–K5 stone Two Story House; its neighbours are K3 (north), L3, L4, K5, J4 and J3 (south-west).
 */

const LEVELS = { upper: 1 as const, stairwell: 'inherent' as const };
const HOUSE: Record<string, HexTerrainSpec> = {
  uK4: { terrain: 'building-stone', buildingId: 'u-B16', building: LEVELS, obstacleHeight: 1.5 },
  uK5: { terrain: 'building-stone', buildingId: 'u-B16', building: LEVELS, obstacleHeight: 1.5 },
};
const SK: RuleModule[] = [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules];
const ASL: RuleModule[] = [...SK, ...aslCoreModules];

/** A test-only Breach record, for the entry tests. */
const testBreach: RuleModule = {
  id: 'test.breach',
  install(r) {
    r.action<Action & { loc: string; toward: string }>({
      type: 'test.breach',
      decisionKinds: ['phase'],
      resolve(ctx, a) {
        ctx.emit('asl.breach', { breach: { loc: a.loc, toward: a.toward, by: 'dc' } });
      },
    });
  },
};

/** Germans attack first; the Russians fortify `count` Locations of the K4–K5 house (exactly that many when `exact`). */
function game(pieces: PieceSpec[], opts: { count?: number; exact?: boolean; open?: boolean; dice?: number[]; startPhase?: string; modules?: RuleModule[] } = {}) {
  const scenario = {
    firstSide: 'ge',
    sides: [
      { side: 'ge', name: 'German', nationality: 'ge', elr: 3 },
      { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 },
    ],
    forces: [{ side: 'ru', units: [], setup: { kind: 'area' as const, description: 'the house', hexes: ['uK4', 'uK5'] } }],
    ssr: [{ module: FORTIFIED_MODULE, params: { side: 'ru', count: opts.count ?? 2, unit: 'location', within: 'setup', ...(opts.exact ? { exact: true } : {}), ...(opts.open ? { open: true } : {}) } }],
  };
  return makeEngine({
    board: 'u',
    terrain: HOUSE,
    scenario,
    modules: opts.modules ?? ASL,
    extra: [fortifiedModule, testFire, testBreach],
    pieces,
    ...(opts.dice ? { dice: opts.dice } : {}),
    ...(opts.startPhase ? { startPhase: opts.startPhase } : {}),
  });
}
const designate = (engine: Engine, state: GameState, locations: string[]) => act(engine, state, { type: 'fortify.designate', locations }).state;
const types = (t: { events: { type: string }[] }) => t.events.map((e) => e.type);
/** Pass and end phases until `phase` of `attacker` in a later turn than `from`. */
function playOn(engine: Engine, s: GameState, from: number, attacker: string, phase: string): GameState {
  for (let i = 0; i < 400 && !(s.turn > from && s.attacker === attacker && s.phase === phase); i++) {
    const d = engine.currentDecision(s)!;
    const a = engine.legalActions(s, d.owner).find((x) => x.type === 'defPass' || x.type === 'move.end' || x.type === 'endPhase') ?? engine.legalActions(s, d.owner)[0]!;
    s = engine.submit(s, a as Action).state;
  }
  return s;
}

describe('designating fortified Locations (B23.911, B23.912)', () => {
  const far: PieceSpec[] = [{ id: 'g', def: 'ge.467', side: 'ge', hex: 'uY1' }, { id: 'r', def: 'ru.447', side: 'ru', hex: 'uA1' }];
  it('offers the ground and the upper level of every building hex in the setup area', () => {
    const { engine, state } = game(far);
    expect(engine.currentDecision(state)).toMatchObject({ kind: 'fortify', owner: 'ru', data: { count: 2, unit: 'location' } });
    expect(fortifiableLocations(engine.env(state), 'ru')).toEqual(['uK4', 'uK4:1', 'uK5', 'uK5:1']);
  });
  it('refuses an upper level whose ground is not fortified, more than the count, and fewer when the count is exact', () => {
    const { engine, state } = game(far, { count: 2, exact: true });
    expect(() => designate(engine, state, ['uK4:1', 'uK5'])).toThrow(/fortify the level below first \(ASLRB B23.912\)/);
    expect(() => designate(engine, state, ['uK4', 'uK5', 'uK4:1'])).toThrow(/At most 2 Locations/);
    expect(() => designate(engine, state, ['uK4'])).toThrow(/Choose 2 Locations/);
    expect(() => designate(engine, state, ['uK4', 'uK4'])).toThrow(/only be fortified once/);
    expect(() => act(engine, state, { type: 'fortify.designate', buildings: ['u-B16'] })).toThrow(/fortifies Locations, not whole buildings/);
    expect(() => designate(engine, state, ['uL4', 'uK4'])).toThrow(/not a building Location in your setup area/);
  });
  it('fortifies the chosen Locations only, secret from the other side', () => {
    const { engine, state } = game(far);
    const s = designate(engine, state, ['uK4:1', 'uK4']);
    const env = engine.env(s);
    expect(fortifiedState(env)).toEqual({ side: 'ru', buildings: ['u-B16'], revealed: [], locations: ['uK4', 'uK4:1'], revealedLocs: [] });
    expect(isFortified(env, 'uK4')).toBe(true);
    expect(isFortified(env, 'uK4:1')).toBe(true);
    expect(isFortified(env, 'uK5')).toBe(false);
    expect(env.query('hex.fortified', { hex: 'uK4' }, false)).toBe(true);
    expect(env.query('hex.fortified', { hex: 'uK5' }, false)).toBe(false);
    expect(fortifiedKnownTo(env, 'uK4', 'ru')).toBe(true);
    expect(fortifiedKnownTo(env, 'uK4', 'ge')).toBe(false);
    expect(fortifiedKnownTo(env, 'uK4', null)).toBe(false);
    // The other side's view holds no Location until one is revealed.
    expect((redactState(engine, s, 'ge').ext['sk1.fortified'] as { locations: string[] }).locations).toEqual([]);
    expect(fortifiedView(env, 'ge')).toEqual([]);
    expect(fortifiedView(env, 'ru')).toEqual([{ loc: 'uK4', breached: [] }, { loc: 'uK4:1', breached: [] }]);
  });
  it("the engine's default designation respects the ground-up rule", () => {
    const { engine, state } = game(far, { count: 3 });
    const [a] = engine.legalActions(state, 'ru').filter((x) => x.type === 'fortify.designate');
    expect(a!['locations']).toEqual(['uK4', 'uK5', 'uK4:1']);
    expect(() => act(engine, state, a!)).not.toThrow();
  });
});

describe('the +1 TEM is per Location (B23.921)', () => {
  it('level 1 fortified, the ground below it too, the next hex not', () => {
    const { engine, state } = game([
      { id: 'g', def: 'ge.467', side: 'ge', hex: 'uK2' },
      { id: 'r1', def: 'ru.447', side: 'ru', hex: 'uK4', level: 1 },
      { id: 'r2', def: 'ru.447', side: 'ru', hex: 'uK5' },
    ]);
    const env = engine.env(designate(engine, state, ['uK4', 'uK4:1']));
    const drm = (target: string, targets: string[]) => {
      const attack: FireAttackCtx = { mode: 'prep', side: 'ge', target, parts: [], targets, hindrance: 0 };
      return env.explain('fire.drm', { attack }, 0);
    };
    expect(drm('uK4:1', ['r1']).value).toBe(4);
    expect(drm('uK4:1', ['r1']).trace.find((t) => t.id === 'ssr.fortified.drm')?.secret).toBe(true);
    expect(drm('uK5', ['r2']).value).toBe(3);
  });
});

describe('B23.922: no entry while an enemy squad holds the Location', () => {
  // A German squad in J4, south-west of K4; a Russian squad holds K4's fortified ground.
  const russian = (extra: Partial<PieceSpec> = {}): PieceSpec => ({ id: 'r', def: 'ru.447', side: 'ru', hex: 'uK4', ...extra });
  const german: PieceSpec = { id: 'g', def: 'ge.467', side: 'ge', hex: 'uJ4' };
  const advance = { type: 'advance', units: ['g'], to: 'uK4' };

  it('an advance into an unrevealed fortified Location is offered, and the attempt is refused: the unit stays, loses its APh and reveals the Location', () => {
    const { engine, state } = game([german, russian(), { id: 'g2', def: 'ge.467', side: 'ge', hex: 'uJ3' }], { startPhase: 'APh' });
    const s0 = designate(engine, state, ['uK4']);
    // Legal as far as the Germans can know: the refusal must never leak the secret through legality.
    expect(engine.legalActions(s0, 'ge').some((a) => a.type === 'advance' && a['to'] === 'uK4')).toBe(true);
    expect(engine.legalActions(redactState(engine, s0, 'ge'), 'ge').some((a) => a.type === 'advance' && a['to'] === 'uK4')).toBe(true);
    const t = act(engine, s0, advance);
    expect(t.state.pieces['g']!.loc).toEqual({ kind: 'hex', hex: 'uJ4' });
    expect(t.state.pieces['g']!.tags['advanced']).toBe(true);
    expect(types(t)).toEqual(expect.arrayContaining(['sk1.fortified.revealed', 'asl.fortified.refused']));
    expect(t.events.find((e) => e.type === 'asl.fortified.refused')!.payload).toMatchObject({ units: ['g'], loc: 'uK4', phase: 'APh', side: 'ge', reason: 'held' });
    expect(t.events.find((e) => e.type === 'sk1.fortified.revealed')!.payload).toMatchObject({ loc: 'uK4', reason: 'attempt' });
    expect(fortifiedKnownTo(engine.env(t.state), 'uK4', 'ge')).toBe(true);
    expect((redactState(engine, t.state, 'ge').ext['sk1.fortified'] as { locations: string[] }).locations).toEqual(['uK4']);
    // No second try this APh, nor any other advance.
    expect(engine.legalActions(t.state, 'ge').some((a) => a.type === 'advance' && (a['units'] as string[]).includes('g'))).toBe(false);
    // Once known, the advance is refused up front with the reason (another unit, g2, has not used its APh).
    expect(engine.validate(t.state, { side: 'ge', decisionId: engine.currentDecision(t.state)!.id, type: 'advance', units: ['g2'], to: 'uK4' } as Action)).toMatch(/B23.922/);
    expect(engine.legalActions(t.state, 'ge').some((a) => a.type === 'advance' && (a['units'] as string[]).includes('g2') && a['to'] === 'uK4')).toBe(false);
    // Next Player Turn the unit moves and advances as usual.
    const s2 = playOn(engine, t.state, t.state.turn, 'ge', 'MPh');
    expect(s2.pieces['g']!.tags['advanced']).toBeUndefined();
    expect(engine.legalActions(s2, 'ge').some((a) => a.type === 'move.start' && (a['units'] as string[]).includes('g'))).toBe(true);
    expect(isFortified(engine.env(s2), 'uK4')).toBe(true);
  });

  it('a pinned squad, or a half-squad with a leader, does not bar the entry: the advance goes in and Close Combat follows', () => {
    const pinned = game([german, russian({ tags: { pinned: true } })], { startPhase: 'APh' });
    let s = act(pinned.engine, designate(pinned.engine, pinned.state, ['uK4']), advance).state;
    expect(s.pieces['g']!.loc).toEqual({ kind: 'hex', hex: 'uK4' });
    expect(s.hexMarkers['uK4']?.['cc']).toBe(true);
    const small = game([german, { id: 'h', def: 'ru.247', side: 'ru', hex: 'uK4' }, { id: 'l', def: 'ru.L91', side: 'ru', hex: 'uK4' }], { startPhase: 'APh' });
    s = act(small.engine, designate(small.engine, small.state, ['uK4']), advance).state;
    expect(s.pieces['g']!.loc).toEqual({ kind: 'hex', hex: 'uK4' });
    // Two half-squads are a squad's equivalent.
    const two = game([german, { id: 'h', def: 'ru.247', side: 'ru', hex: 'uK4' }, { id: 'h2', def: 'ru.247', side: 'ru', hex: 'uK4' }], { startPhase: 'APh' });
    s = act(two.engine, designate(two.engine, two.state, ['uK4']), advance).state;
    expect(s.pieces['g']!.loc).toEqual({ kind: 'hex', hex: 'uJ4' });
  });

  it('a squad still marked with Wall Advantage does not bar the entry (B23.922; official Q&A [An95w; An96])', () => {
    const wa = game([german, russian({ tags: { wa: 'uK4' } })], { startPhase: 'APh' });
    const s = act(wa.engine, designate(wa.engine, wa.state, ['uK4']), advance).state;
    expect(s.pieces['g']!.loc).toEqual({ kind: 'hex', hex: 'uK4' });
  });

  it('through a Breach of that hexside the advance goes in; through another hexside it is still refused', () => {
    const { engine, state } = game([german, russian(), { id: 'g2', def: 'ge.467', side: 'ge', hex: 'uK3' }], { startPhase: 'APh', open: true });
    let s = designate(engine, state, ['uK4']);
    s = act(engine, s, { type: 'test.breach', loc: 'uK4', toward: 'uJ4' }).state;
    expect(breaches(engine.env(s))).toEqual([{ loc: 'uK4', toward: 'uJ4', by: 'dc' }]);
    expect(engine.validate(s, { side: 'ge', decisionId: engine.currentDecision(s)!.id, type: 'advance', units: ['g2'], to: 'uK4' } as Action)).toMatch(/B23.922/);
    s = act(engine, s, advance).state;
    expect(s.pieces['g']!.loc).toEqual({ kind: 'hex', hex: 'uK4' });
    expect(fortifiedView(engine.env(s), 'ge')).toEqual([{ loc: 'uK4', breached: ['uJ4'] }]);
  });

  it('a level 1 held by a squad can only be reached by the stairs, which are no hexside: the advance up is refused', () => {
    const { engine, state } = game([{ id: 'g', def: 'ge.467', side: 'ge', hex: 'uK4' }, russian({ level: 1 })], { startPhase: 'APh', open: true });
    const s = designate(engine, state, ['uK4', 'uK4:1']);
    expect(engine.validate(s, { side: 'ge', decisionId: engine.currentDecision(s)!.id, type: 'advance', units: ['g'], to: 'uK4:1' } as Action)).toMatch(/B23.922/);
  });

  it('in the MPh a stack that tries to enter a fortified Location held by a hidden squad is turned back: the fortification and the squad come to light, the MF are spent where it stands, and its move is over', () => {
    // r is hidden (an SSR letting units set up hidden); g at J4 steps into K4: refused, fired on by the revealed r (4 FP, no effect), move over.
    const { engine, state } = game([german, russian({ tags: { hip: true } }), { id: 'g2', def: 'ge.467', side: 'ge', hex: 'uY1' }], { startPhase: 'MPh', dice: [6, 6] });
    let s = designate(engine, state, ['uK4']);
    s = act(engine, s, { type: 'move.start', units: ['g'] }).state;
    expect(engine.legalActions(s, 'ge').some((a) => a.type === 'move.step' && a['to'] === 'uK4')).toBe(true);
    const t = act(engine, s, { type: 'move.step', to: 'uK4' });
    expect(t.state.pieces['g']!.loc).toEqual({ kind: 'hex', hex: 'uJ4' });
    expect(t.state.pieces['r']!.tags['hip']).toBeUndefined();
    expect(types(t)).toEqual(expect.arrayContaining(['sk1.fortified.revealed', 'asl.fortified.refused']));
    expect(t.events.find((e) => e.type === 'asl.fortified.refused')!.payload).toMatchObject({ units: ['g'], loc: 'uK4', phase: 'MPh' });
    const ms = moveState(engine.env(t.state))!;
    expect(ms.halted).toBe(true);
    expect(ms.spent['g']).toBe(2);
    // The revealed squad may fire at the stack in J4 as Defensive First Fire.
    expect(engine.currentDecision(t.state)).toMatchObject({ kind: 'firstFire', owner: 'ru' });
    s = act(engine, t.state, { type: 'defFire', decl: { units: ['r'], sw: [], target: 'uJ4' } }).state;
    while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
    // Its MPh is over: no further step, and the next unit may move.
    expect(engine.legalActions(s, 'ge').some((a) => a.type === 'move.step' && (moveState(engine.env(s))?.units ?? []).includes('g'))).toBe(false);
    expect(engine.legalActions(s, 'ge').some((a) => a.type === 'move.start' && (a['units'] as string[]).includes('g2'))).toBe(true);
    // Next Player Turn g moves normally.
    const s2 = playOn(engine, s, s.turn, 'ge', 'MPh');
    expect(engine.legalActions(s2, 'ge').some((a) => a.type === 'move.start' && (a['units'] as string[]).includes('g'))).toBe(true);
  });
  it('a refused entry, moving or advancing, reveals what hides in that Location only: a hidden unit on level 1 stays hidden (A12.15)', () => {
    const upstairs: PieceSpec = { id: 'r2', def: 'ru.447', side: 'ru', hex: 'uK4', level: 1, tags: { hip: true } };
    const { engine, state } = game([german, russian({ tags: { hip: true } }), upstairs, { id: 'g2', def: 'ge.467', side: 'ge', hex: 'uY1' }], { startPhase: 'MPh', dice: [6, 6] });
    let s = designate(engine, state, ['uK4']);
    s = act(engine, s, { type: 'move.start', units: ['g'] }).state;
    const t = act(engine, s, { type: 'move.step', to: 'uK4' });
    expect(t.state.pieces['r']!.tags['hip']).toBeUndefined();
    expect(t.state.pieces['r2']!.tags['hip']).toBe(true);
    const a = game([german, russian({ tags: { hip: true } }), upstairs], { startPhase: 'APh' });
    const u = act(a.engine, designate(a.engine, a.state, ['uK4']), advance);
    expect(u.state.pieces['r']!.tags['hip']).toBeUndefined();
    expect(u.state.pieces['r2']!.tags['hip']).toBe(true);
  });
});

describe('A12.151: a unit that must end its MPh in Bypass of a fortified Location it cannot enter', () => {
  const pass = (engine: Engine, s: GameState) => {
    let x = s;
    while (engine.currentDecision(x)?.owner === 'ru') x = act(engine, x, { type: 'defPass' }).state;
    return x;
  };
  it('is forced back to the last Location it occupied, and the fortification and the hidden squad come to light; next turn it moves normally', () => {
    // g bypasses K4 from J4 and is stranded there by a Smoke grenade dr of 6 (its MPh ends, A24.1); K4's ground is
    // fortified and held by a hidden squad, so after its MPh it cannot be in the obstacle (B23.922).
    const { engine, state } = game([{ id: 'g', def: 'ge.467', side: 'ge', hex: 'uJ4' }, { id: 'r', def: 'ru.447', side: 'ru', hex: 'uK4', tags: { hip: true } }, { id: 'g2', def: 'ge.467', side: 'ge', hex: 'uY1' }], { startPhase: 'MPh', dice: [6, ...new Array(40).fill(4)] });
    let s = designate(engine, state, ['uK4']);
    s = act(engine, s, { type: 'move.start', units: ['g'] }).state;
    const round = engine.legalActions(s, 'ge').find((a) => a.type === 'move.step' && a['to'] === 'uK4' && a['bypass']);
    expect(round).toBeDefined();
    const by = act(engine, s, round as never);
    // Going round the obstacle is not entering it: nothing is revealed yet (A4.3, B23.911).
    expect(types(by)).not.toContain('sk1.fortified.revealed');
    s = pass(engine, by.state);
    expect(moveState(engine.env(s))!.bypass?.hex).toBe('uK4');
    const t = act(engine, s, { type: 'move.smoke', unit: 'g', target: 'uK4' });
    expect(types(t)).toEqual(expect.arrayContaining(['sk1.fortified.revealed', 'asl.fortified.refused']));
    s = pass(engine, t.state);
    expect(s.pieces['g']!.loc).toEqual({ kind: 'hex', hex: 'uJ4' });
    expect(s.pieces['r']!.tags['hip']).toBeUndefined();
    expect(moveState(engine.env(s))).toBeFalsy();
    expect(s.hexMarkers['uK4']?.['cc']).toBeUndefined();
    const s2 = playOn(engine, s, s.turn, 'ge', 'MPh');
    expect(engine.legalActions(s2, 'ge').some((a) => a.type === 'move.start' && (a['units'] as string[]).includes('g'))).toBe(true);
  });

  it('concealment is lost in that Location only: a hidden unit on level 1 stays hidden', () => {
    const { engine, state } = game([{ id: 'g', def: 'ge.467', side: 'ge', hex: 'uJ4' }, { id: 'r', def: 'ru.447', side: 'ru', hex: 'uK4', level: 1, tags: { hip: true } }, { id: 'g2', def: 'ge.467', side: 'ge', hex: 'uY1' }], { startPhase: 'MPh', dice: [6, ...new Array(40).fill(4)] });
    let s = designate(engine, state, ['uK5']);
    s = act(engine, s, { type: 'move.start', units: ['g'] }).state;
    const round = engine.legalActions(s, 'ge').find((a) => a.type === 'move.step' && a['to'] === 'uK4' && a['bypass']);
    s = pass(engine, act(engine, s, round as never).state);
    const t = act(engine, s, { type: 'move.smoke', unit: 'g', target: 'uK4' });
    expect(types(t)).not.toContain('sk2.hip.unitRevealed');
    expect(pass(engine, t.state).pieces['r']!.tags['hip']).toBe(true);
  });

  it('not fortified: the stranded unit stays, in the obstacle with the squad found there', () => {
    const { engine, state } = game([{ id: 'g', def: 'ge.467', side: 'ge', hex: 'uJ4' }, { id: 'r', def: 'ru.447', side: 'ru', hex: 'uK4', tags: { hip: true } }, { id: 'g2', def: 'ge.467', side: 'ge', hex: 'uY1' }], { startPhase: 'MPh', dice: [6, ...new Array(40).fill(4)] });
    let s = designate(engine, state, ['uK5']);
    s = act(engine, s, { type: 'move.start', units: ['g'] }).state;
    const round = engine.legalActions(s, 'ge').find((a) => a.type === 'move.step' && a['to'] === 'uK4' && a['bypass']);
    s = pass(engine, act(engine, s, round as never).state);
    s = pass(engine, act(engine, s, { type: 'move.smoke', unit: 'g', target: 'uK4' }).state);
    expect(s.pieces['g']!.loc).toEqual({ kind: 'hex', hex: 'uK4' });
    expect(s.pieces['r']!.tags['hip']).toBeUndefined();
  });
});

describe('B23.9221: Breach by a DC', () => {
  // g (4-6-7 with a DC) and l (a leader without one) in J4; r holds K4, fortified and known (the card names it).
  const pieces = (extra: PieceSpec[] = []): PieceSpec[] => [
    { id: 'g', def: 'ge.467', side: 'ge', hex: 'uJ4' },
    { id: 'dc', def: 'ge.DC', side: 'ge', heldBy: 'g' },
    { id: 'l', def: 'ge.L80', side: 'ge', hex: 'uJ4' },
    { id: 'r', def: 'ru.447', side: 'ru', hex: 'uK4' },
    ...extra,
  ];
  const breachOf = (t: { events: { type: string; payload: unknown }[] }) => t.events.find((e) => e.type === 'asl.breach.attempt')?.payload as { breached: boolean; malfunctioned: boolean; drm: number; result: string | null } | undefined;

  it('is offered to the DC holder against an ADJACENT Location that may be fortified, known or not; not up the stairs; not against one that cannot be (B23.9221; Q&A [K33])', () => {
    const { engine, state } = game(pieces(), { startPhase: 'MPh', open: true });
    let s = designate(engine, state, ['uK4', 'uK4:1']);
    s = act(engine, s, { type: 'move.start', units: ['g', 'l'] }).state;
    // One entry per ADJACENT Location that may be fortified (J4 touches K4 and K5; both Locations of the count are
    // shown, in K4, so K5 cannot be), for the DC only.
    const offered = engine.legalActions(s, 'ge').filter((a) => a.type === 'move.breach');
    expect(offered.map((a) => `${a['dc']}>${a['target']}`)).toEqual(['dc>uK4']);
    const check = (target: string) => engine.validate(s, { side: 'ge', decisionId: engine.currentDecision(s)!.id, type: 'move.breach', dc: 'dc', target } as Action);
    expect(check('uK4:1')).toMatch(/ADJACENT/);
    expect(check('uK5')).toMatch(/not fortified, as far as your side can tell.*B23.9221/);
    // A secret designation: every ADJACENT Location that might be fortified is offered alike, fortified or not.
    const secret = game(pieces(), { startPhase: 'MPh' });
    let u = designate(secret.engine, secret.state, ['uK4']);
    u = act(secret.engine, u, { type: 'move.start', units: ['g'] }).state;
    expect(secret.engine.legalActions(u, 'ge').filter((a) => a.type === 'move.breach').map((a) => a['target'])).toEqual(['uK4', 'uK5']);
    for (const target of ['uK4', 'uK5']) expect(secret.engine.validate(u, { side: 'ge', decisionId: secret.engine.currentDecision(u)!.id, type: 'move.breach', dc: 'dc', target } as Action)).toBeNull();
    // The same on the German's own (redacted) view, which is what the client validates on.
    const view = redactState(secret.engine, u, 'ge');
    expect(secret.engine.legalActions(view, 'ge').filter((a) => a.type === 'move.breach').map((a) => a['target'])).toEqual(['uK4', 'uK5']);
    // A pinned placer may not.
    const pinned = game(pieces().map((p) => (p.id === 'g' ? { ...p, tags: { pinned: true } } : p)), { startPhase: 'MPh', open: true });
    let v = designate(pinned.engine, pinned.state, ['uK4']);
    v = act(pinned.engine, v, { type: 'move.start', units: ['l'] }).state;
    expect(pinned.engine.legalActions(v, 'ge').some((a) => a.type === 'move.breach')).toBe(false);
  });

  it('costs one MF, is placed once the stack has survived the fire there, and resolves in the AFPh: a NMC or better Breaches the hexside, the units take Area Fire with the same DR', () => {
    // Breach DR 9 (4+5): +3 TEM +1 fortified = 13, a NMC on the DC's 30 column (the hexside goes); the squad inside takes 15 FP
    // at 13: nothing. The DC's X# is 10 for a non-elite squad.
    const { engine, state } = game(pieces(), { startPhase: 'MPh', open: true, dice: [4, 5] });
    let s = designate(engine, state, ['uK4']);
    s = act(engine, s, { type: 'move.start', units: ['g', 'l'] }).state;
    const t = act(engine, s, { type: 'move.breach', dc: 'dc', target: 'uK4' });
    expect(t.events.find((e) => e.type === 'asl.breach.declared')!.payload).toMatchObject({ dc: 'dc', placer: 'g', loc: 'uK4', toward: 'uJ4' });
    let ms = moveState(engine.env(t.state))!;
    expect(ms.spent['g']).toBe(1);
    expect(ms.dcPending).toMatchObject({ dc: 'dc', placer: 'g', target: 'uK4', breach: 'uJ4' });
    s = t.state;
    while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
    s = act(engine, s, { type: 'move.end' }).state;
    while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
    expect(s.pieces['dc']!.loc).toEqual({ kind: 'hex', hex: 'uK4' });
    expect(s.pieces['dc']!.tags).toMatchObject({ dcPlaced: true, dcPlacer: 'g', dcBreach: 'uJ4' });
    ms = moveState(engine.env(s))!;
    expect(ms?.dcPending).toBeUndefined();
    // On to the AFPh: the Breach attempt.
    let r: ReturnType<typeof act> | null = null;
    for (let i = 0; i < 20 && s.phase !== 'AFPh'; i++) {
      const d = engine.currentDecision(s)!;
      const a = engine.legalActions(s, d.owner).find((x) => x.type === 'defPass' || x.type === 'move.end' || x.type === 'endPhase')!;
      r = act(engine, s, a);
      s = r.state;
    }
    expect(s.phase).toBe('AFPh');
    expect(breachOf(r!)).toMatchObject({ breached: true, malfunctioned: false, drm: 4, result: 'NMC' });
    const attacks = r!.events.filter((e) => e.type === 'sk1.fire.attack').map((e) => e.payload as { fp: number; drm: number; explain: { label?: string }[] });
    expect(attacks.map((a) => a.fp)).toEqual([30, 15]);
    expect(attacks[0]!.explain.map((n) => n.label)).toEqual(expect.arrayContaining(['+3 TEM', '+1 Fortified Building']));
    expect(breaches(engine.env(s))).toEqual([{ loc: 'uK4', toward: 'uJ4', by: 'dc' }]);
    expect(s.pieces['dc']!.loc.kind).toBe('eliminated');
    expect(s.pieces['r']!.tags['broken']).toBeUndefined();
    // The APh: g advances in through the Breach despite the Good Order squad.
    s = act(engine, s, { type: 'endPhase' }).state;
    for (let i = 0; i < 6 && s.phase !== 'APh'; i++) s = act(engine, s, engine.legalActions(s, engine.currentDecision(s)!.owner).find((x) => x.type === 'endPhase' || x.type === 'defPass')!).state;
    expect(s.phase).toBe('APh');
    s = act(engine, s, { type: 'advance', units: ['g'], to: 'uK4' }).state;
    expect(s.pieces['g']!.loc).toEqual({ kind: 'hex', hex: 'uK4' });
    // Next Player Turn: the Breach stays, the DC and its tags are gone, the house is still fortified, everyone acts normally.
    const s2 = playOn(engine, s, s.turn, 'ge', 'MPh');
    expect(breaches(engine.env(s2))).toEqual([{ loc: 'uK4', toward: 'uJ4', by: 'dc' }]);
    expect(Object.values(s2.pieces).some((p) => p.tags['dcBreach'] !== undefined || p.tags['dcPlaced'] !== undefined)).toBe(false);
    expect(isFortified(engine.env(s2), 'uK4')).toBe(true);
    expect(engine.legalActions(s2, 'ge').some((a) => a.type === 'move.start' && (a['units'] as string[]).includes('l'))).toBe(true);
  });

  it('an Original DR of the X# or more removes the DC without a Breach or an attack', () => {
    const { engine, state } = game(pieces(), { startPhase: 'MPh', open: true, dice: [5, 5] });
    let s = designate(engine, state, ['uK4']);
    s = act(engine, s, { type: 'move.start', units: ['g'] }).state;
    s = act(engine, s, { type: 'move.breach', dc: 'dc', target: 'uK4' }).state;
    while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
    s = act(engine, s, { type: 'move.end' }).state;
    let r: ReturnType<typeof act> | null = null;
    for (let i = 0; i < 20 && s.phase !== 'AFPh'; i++) {
      const d = engine.currentDecision(s)!;
      r = act(engine, s, engine.legalActions(s, d.owner).find((x) => x.type === 'defPass' || x.type === 'move.end' || x.type === 'endPhase')!);
      s = r.state;
    }
    expect(breachOf(r!)).toMatchObject({ breached: false, malfunctioned: true });
    expect(breaches(engine.env(s))).toEqual([]);
    expect(s.pieces['dc']!.loc.kind).toBe('eliminated');
    expect(r!.events.filter((e) => e.type === 'sk1.fire.attack')).toHaveLength(1);
  });

  it('an Original KIA of the Breach DC on its Area Fire column checks for rubble and then for a Flame in the Location (A23.41, B24.11, B25.13)', () => {
    // Breach DR 2 (1+1): a KIA on the DC's Area Fire column (15 FP); the rubble dr 6 (+1 stone) does not rubble, so the
    // units take the attack and the Flame DR follows.
    const { engine, state } = game(pieces(), { startPhase: 'MPh', open: true, dice: [1, 1, 6, 6, 6, ...Array(20).fill(3)] });
    let s = designate(engine, state, ['uK4']);
    s = act(engine, s, { type: 'move.start', units: ['g'] }).state;
    s = act(engine, s, { type: 'move.breach', dc: 'dc', target: 'uK4' }).state;
    while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
    s = act(engine, s, { type: 'move.end' }).state;
    const all: { type: string; payload: unknown }[] = [];
    for (let i = 0; i < 20 && s.phase !== 'AFPh'; i++) {
      const d = engine.currentDecision(s)!;
      const r = act(engine, s, engine.legalActions(s, d.owner).find((x) => x.type === 'defPass' || x.type === 'move.end' || x.type === 'endPhase')!);
      all.push(...r.events);
      s = r.state;
    }
    expect(all.find((e) => e.type === 'asl.breach.attempt')?.payload).toMatchObject({ breached: true });
    expect(all.find((e) => e.type === 'asl.rubble.check')?.payload).toMatchObject({ loc: 'uK4', dr: 6, rubbled: false });
    expect(all.find((e) => e.type === 'asl.fire.attackFlame')?.payload).toMatchObject({ loc: 'uK4', source: 'dc' });
  });

  it('a plain DC may still be Placed on the fortified Location at the building entry cost, held or not', () => {
    const { engine, state } = game(pieces(), { startPhase: 'MPh', open: true });
    let s = designate(engine, state, ['uK4']);
    s = act(engine, s, { type: 'move.start', units: ['g'] }).state;
    s = act(engine, s, { type: 'move.placeDc', dc: 'dc', target: 'uK4' }).state;
    expect(moveState(engine.env(s))!.spent['g']).toBe(2);
    expect(moveState(engine.env(s))!.dcPending?.breach).toBeUndefined();
  });
});

describe('B23.9221 with B23.911: a DC Breach attempt against a Location not known to be fortified (Q&A [K33] to A23.3, B23.711, B23.9221)', () => {
  // g (4-6-7, DC) in J4 tries to Breach K4, where r holds; the designation is secret: K4 in one game, K5 in the other.
  // The German must not be able to tell the two games apart until the Breach DR decides.
  const run = (fortify: string[], dice: number[], cx = false) => {
    const pieces: PieceSpec[] = [
      { id: 'g', def: 'ge.467', side: 'ge', hex: 'uJ4' },
      { id: 'dc', def: 'ge.DC', side: 'ge', heldBy: 'g' },
      { id: 'r', def: 'ru.447', side: 'ru', hex: 'uK4' },
    ];
    const { engine, state } = game(pieces, { startPhase: 'MPh', dice });
    let s = designate(engine, state, fortify);
    const before = s;
    // Double Time makes the placer CX (+1 to the DC's attack, A23.3).
    s = act(engine, s, { type: 'move.start', units: ['g'], ...(cx ? { doubleTime: true } : {}) }).state;
    const decl = act(engine, s, { type: 'move.breach', dc: 'dc', target: 'uK4' });
    s = decl.state;
    while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
    if (engine.legalActions(s, 'ge').some((a) => a.type === 'move.end')) s = act(engine, s, { type: 'move.end' }).state;
    while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
    // On to the AFPh, keeping the German's stream of everything since the designation.
    const ge: unknown[] = [];
    const steps: { from: GameState; t: ReturnType<typeof act> }[] = [];
    for (let i = 0; i < 20 && s.phase !== 'AFPh'; i++) {
      const d = engine.currentDecision(s)!;
      const t = act(engine, s, engine.legalActions(s, d.owner).find((x) => x.type === 'defPass' || x.type === 'move.end' || x.type === 'endPhase')!);
      steps.push({ from: s, t });
      s = t.state;
    }
    for (const { from, t } of steps) ge.push(...engine.redactTransition('ge', (x) => redactState(engine, x, 'ge'), from, t.events as never));
    const events = steps.flatMap(({ t }) => t.events);
    return { engine, before, s, decl, events, ge, attempt: events.find((e) => e.type === 'asl.breach.attempt')?.payload as Record<string, unknown> | undefined };
  };
  const strip = (stream: unknown[]) => stream.map((e) => ({ ...(e as Record<string, unknown>), seq: undefined }));

  it('is declared like any Breach attempt and shows nothing: the declaration reveals no fortification', () => {
    const forted = run(['uK4'], [6, 6]);
    expect(forted.decl.events.find((e) => e.type === 'asl.breach.declared')?.payload).toMatchObject({ loc: 'uK4', toward: 'uJ4' });
    expect(forted.decl.events.some((e) => e.type === 'sk1.fortified.revealed')).toBe(false);
    expect(fortifiedKnownTo(forted.engine.env(forted.decl.state), 'uK4', 'ge')).toBe(false);
  });

  it('a DR short of a Breach shows nothing: the German is shown the same in both games, the hexside at the Fortified TEM', () => {
    // CX: Breach DR 9 +3 TEM +1 Fortified +1 CX = 14, a PTC on the DC's 30 column (no Breach); the Area Fire (15 FP) at 13
    // or 14 does nothing. Then an Original 10, the X# of a non-elite squad's DC: a malfunction.
    for (const [dice, cx] of [[[4, 5], true], [[5, 5], false]] as const) {
      const forted = run(['uK4'], [...dice], cx);
      const plain = run(['uK5'], [...dice], cx);
      expect(forted.attempt).toMatchObject({ breached: false });
      expect(plain.attempt).toMatchObject({ breached: false });
      expect(plain.attempt!['unfortified']).toBeUndefined();
      expect(strip(forted.ge)).toEqual(strip(plain.ge));
      if (!cx) expect(forted.attempt).toMatchObject({ malfunctioned: true });
      else {
        expect(forted.attempt).toMatchObject({ drm: 5, result: 'PTC' });
        const hexside = forted.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { explain: { id: string; label?: string }[] };
        expect(hexside.explain.map((n) => n.id)).toContain('asl.breach.fortifiedTem');
        expect(hexside.explain.map((n) => n.id)).not.toContain('ssr.fortified.dc');
      }
      expect(fortifiedKnownTo(forted.engine.env(forted.s), 'uK4', 'ge')).toBe(false);
      expect(breaches(forted.engine.env(forted.s))).toEqual([]);
      expect(shownUnfortified(plain.engine.env(plain.s))).toEqual([]);
    }
  });

  it('a DR that Breaches a Fortified Location places the Breach and shows the Location; the same DR against an unfortified one resolves as Area Fire only and shows it is not fortified', () => {
    // Breach DR 9 (4+5): +3 TEM +1 Fortified = 13, a NMC on the 30 column.
    const forted = run(['uK4'], [4, 5]);
    expect(forted.attempt).toMatchObject({ breached: true, result: 'NMC', drm: 4 });
    expect(forted.attempt!['unfortified']).toBeUndefined();
    const env = forted.engine.env(forted.s);
    expect(fortifiedKnownTo(env, 'uK4', 'ge')).toBe(true);
    expect(breaches(env)).toEqual([{ loc: 'uK4', toward: 'uJ4', by: 'dc' }]);
    expect(redactState(forted.engine, forted.s, 'ge').ext['asl.breach']).toEqual([{ loc: 'uK4', toward: 'uJ4', by: 'dc' }]);
    const plain = run(['uK5'], [4, 5]);
    expect(plain.attempt).toMatchObject({ breached: false, result: 'NMC', unfortified: true });
    const penv = plain.engine.env(plain.s);
    expect(breaches(penv)).toEqual([]);
    expect(shownUnfortified(penv)).toEqual(['uK4']);
    expect(redactState(plain.engine, plain.s, 'ge').ext['asl.breach.unfortified']).toEqual(['uK4']);
    // The units take Area Fire with the Location's own TEM (+3), nothing of a fortification.
    const area = plain.events.filter((e) => e.type === 'sk1.fire.attack')[1]!.payload as { fp: number; drm: number };
    expect(area).toMatchObject({ fp: 15, drm: 3 });
    // K4 is no longer offered; K5 still is (it may be fortified, as far as the German knows).
    expect(fortifiedPossibleTo(penv, 'uK4', 'ge')).toBe(false);
    expect(fortifiedPossibleTo(penv, 'uK5', 'ge')).toBe(true);
    expect(fortifiedKnownTo(penv, 'uK5', 'ge')).toBe(false);
  });

  it('across turns: the DC and its tags are gone at the next Player Turn, the Breach (or the unfortified record) stays, and the placer moves on normally', () => {
    for (const fortify of [['uK4'], ['uK5']]) {
      const r = run(fortify, [4, 5, ...Array(80).fill(4)]);
      const s2 = playOn(r.engine, r.s, r.s.turn, 'ge', 'MPh');
      const env = r.engine.env(s2);
      expect(Object.values(s2.pieces).some((p) => p.tags['dcBreach'] !== undefined || p.tags['dcPlaced'] !== undefined)).toBe(false);
      expect(s2.pieces['dc']!.loc.kind).toBe('eliminated');
      if (fortify[0] === 'uK4') expect(breaches(env)).toEqual([{ loc: 'uK4', toward: 'uJ4', by: 'dc' }]);
      else expect(shownUnfortified(env)).toEqual(['uK4']);
      expect(r.engine.legalActions(s2, 'ge').some((a) => a.type === 'move.start' && (a['units'] as string[]).includes('g'))).toBe(true);
    }
  });
});

describe('B23.9221: Breach by a HE KIA', () => {
  // A German 88 fires HE at the Russian squad in K4 (fortified, known): range 1 from K3 (one hexside, the north one),
  // range 2 from L2 (along a hexspine: the firer chooses the L3 or the K3 side).
  const gunGame = (from: string, dice: number[]) => {
    const probe = game([{ id: 'c', def: 'ge.228c', side: 'ge', hex: from }, { id: 'r', def: 'ru.447', side: 'ru', hex: 'uK4' }]);
    const map = statics(probe.engine.env(probe.state)).map;
    const ca = inCoveredArc(map.hex(from)!.cube, 0, map.hex('uK4')!.cube) ? 0 : nearestSpine(map.hex(from)!.cube, 0, map.hex('uK4')!.cube)!;
    const { engine, state } = game(
      [
        { id: 'c', def: 'ge.228c', side: 'ge', hex: from },
        { id: 'g88', def: 'ge.AA88L', side: 'ge', heldBy: 'c', tags: { ca } },
        { id: 'r', def: 'ru.447', side: 'ru', hex: 'uK4' },
        { id: 'r2', def: 'ru.447', side: 'ru', hex: 'uK4' },
        { id: 'far', def: 'ru.447', side: 'ru', hex: 'uA1' },
      ],
      { open: true, dice },
    );
    return { engine, state: designate(engine, state, ['uK4']) };
  };
  const fire = { type: 'fire.ordnance', shot: { weapon: 'g88', target: 'uK4', targetType: 'ITT' } };

  it('the line of fire crosses one hexside: it is Breached at once', () => {
    expect(lofSides('uK4', 'uK3', statics(gunGame('uK3', []).engine.env(gunGame('uK3', []).state)).map)).toEqual([4]);
    // To Hit 10 at range 1, +3 +1: DR 4 hits (no CH); the 16 column IFT DR 3 is a KIA.
    const { engine, state } = gunGame('uK3', [2, 2, 1, 2]);
    const t = act(engine, state, fire);
    expect(t.events.find((e) => e.type === 'sk1.fire.result')?.payload).toMatchObject({ result: { kind: 'KIA' } });
    expect(breaches(engine.env(t.state))).toEqual([{ loc: 'uK4', toward: 'uK3', by: 'he' }]);
  });
  it('along a hexspine the firer chooses which of the two hexsides is Breached', () => {
    const { engine, state } = gunGame('uL2', [2, 2, 1, 2]);
    expect(lofSides('uK4', 'uL2', statics(engine.env(state)).map)).toEqual([4, 5]);
    const t = act(engine, state, fire);
    expect(t.events.find((e) => e.type === 'sk1.fire.result')?.payload).toMatchObject({ result: { kind: 'KIA' } });
    expect(engine.currentDecision(t.state)).toMatchObject({ kind: BREACH_SIDE_DECISION, owner: 'ge', data: { loc: 'uK4', options: ['uK3', 'uL3'] } });
    expect(engine.legalActions(t.state, 'ge').map((a) => a['toward'])).toEqual(['uK3', 'uL3']);
    const s = act(engine, t.state, { type: 'breach.choose', toward: 'uL3' }).state;
    expect(breaches(engine.env(s))).toEqual([{ loc: 'uK4', toward: 'uL3', by: 'he' }]);
    expect(engine.currentDecision(s)!.kind).toBe('phase');
  });
  it('a K/ or lesser result Breaches nothing', () => {
    // IFT DR 7 on the 16 column: a K/1 on the fixture table.
    const { engine, state } = gunGame('uK3', [2, 2, 3, 4]);
    const t = act(engine, state, fire);
    expect(t.events.find((e) => e.type === 'sk1.fire.result')?.payload).toMatchObject({ result: { kind: 'K' } });
    expect(breaches(engine.env(t.state))).toEqual([]);
  });
});

describe('B23.9221 with B23.911: a HE KIA Breach of a Location the firer has not been shown', () => {
  // The same 88 and Russians as above, the designation secret: K4 fortified in one game, K5 instead in the other. The
  // German must not be able to tell the two apart from anything he is shown or asked.
  const hiddenGame = (from: string, dice: number[], fortify: string[]) => {
    const probe = game([{ id: 'c', def: 'ge.228c', side: 'ge', hex: from }, { id: 'r', def: 'ru.447', side: 'ru', hex: 'uK4' }]);
    const map = statics(probe.engine.env(probe.state)).map;
    const ca = inCoveredArc(map.hex(from)!.cube, 0, map.hex('uK4')!.cube) ? 0 : nearestSpine(map.hex(from)!.cube, 0, map.hex('uK4')!.cube)!;
    const { engine, state } = game(
      [
        { id: 'c', def: 'ge.228c', side: 'ge', hex: from },
        { id: 'g88', def: 'ge.AA88L', side: 'ge', heldBy: 'c', tags: { ca } },
        { id: 'gs', def: 'ge.467', side: 'ge', hex: 'uJ4' },
        { id: 'r', def: 'ru.447', side: 'ru', hex: 'uK4' },
        { id: 'r2', def: 'ru.447', side: 'ru', hex: 'uK4' },
        { id: 'far', def: 'ru.447', side: 'ru', hex: 'uA1' },
      ],
      { dice },
    );
    return { engine, state: designate(engine, state, fortify) };
  };
  const fire = { type: 'fire.ordnance', shot: { weapon: 'g88', target: 'uK4', targetType: 'ITT' } };
  const streamFor = (engine: Engine, viewer: string, before: GameState, t: { events: unknown[] }) => engine.redactTransition(viewer, (s) => redactState(engine, s, viewer), before, t.events as never);

  it('one hexside: Breached in secret; the German sees and is told exactly what he would of an unfortified Location', () => {
    const forted = hiddenGame('uK3', [2, 2, 1, 2], ['uK4']);
    const plain = hiddenGame('uK3', [2, 2, 1, 2], ['uK5']);
    const t = act(forted.engine, forted.state, fire);
    const tp = act(plain.engine, plain.state, fire);
    expect(t.events.find((e) => e.type === 'sk1.fire.result')?.payload).toMatchObject({ result: { kind: 'KIA' } });
    expect(fortifiedKnownTo(forted.engine.env(t.state), 'uK4', 'ge')).toBe(false);
    expect(breaches(forted.engine.env(t.state))).toEqual([{ loc: 'uK4', toward: 'uK3', by: 'he' }]);
    expect(breaches(plain.engine.env(tp.state))).toEqual([]);
    // The German's stream and snapshot are the same in both games; the Russian's shows the Breach.
    const ge = streamFor(forted.engine, 'ge', forted.state, t);
    expect(ge).toEqual(streamFor(plain.engine, 'ge', plain.state, tp));
    expect(ge.find((e) => e.type === 'asl.breach.he')?.payload).toEqual({ loc: 'uK4', toward: 'uK3', breached: false });
    expect(redactState(forted.engine, t.state, 'ge').ext['asl.breach']).toEqual([]);
    expect(redactState(forted.engine, t.state, null).ext['asl.breach']).toEqual([]);
    expect(streamFor(forted.engine, 'ru', forted.state, t).find((e) => e.type === 'asl.breach.he')?.payload).toEqual({ loc: 'uK4', toward: 'uK3', breached: true });
    expect(fortifiedView(forted.engine.env(t.state), 'ge')).toEqual([]);
  });

  it('along a hexspine the German is asked in both games alike, and the Breach shows once the Location is revealed', () => {
    const forted = hiddenGame('uL2', [2, 2, 1, 2], ['uK4']);
    const plain = hiddenGame('uL2', [2, 2, 1, 2], ['uK5']);
    const t = act(forted.engine, forted.state, fire);
    const tp = act(plain.engine, plain.state, fire);
    for (const [g, x] of [[forted, t], [plain, tp]] as const) {
      expect(g.engine.currentDecision(x.state)).toMatchObject({ kind: BREACH_SIDE_DECISION, owner: 'ge', data: { loc: 'uK4', options: ['uK3', 'uL3'], known: false } });
    }
    expect(streamFor(forted.engine, 'ge', forted.state, t)).toEqual(streamFor(plain.engine, 'ge', plain.state, tp));
    const c = act(forted.engine, t.state, { type: 'breach.choose', toward: 'uL3' });
    const cp = act(plain.engine, tp.state, { type: 'breach.choose', toward: 'uL3' });
    expect(breaches(forted.engine.env(c.state))).toEqual([{ loc: 'uK4', toward: 'uL3', by: 'he' }]);
    expect(breaches(plain.engine.env(cp.state))).toEqual([]);
    expect(streamFor(forted.engine, 'ge', t.state, c)).toEqual(streamFor(plain.engine, 'ge', tp.state, cp));
    expect(redactState(forted.engine, c.state, 'ge').ext['asl.breach']).toEqual([]);
    // The German's squad enters the now empty K4: the entry reveals it (B23.911), and with it the Breach.
    let s = c.state;
    for (let i = 0; i < 20 && s.phase !== 'MPh'; i++) s = act(forted.engine, s, forted.engine.legalActions(s, forted.engine.currentDecision(s)!.owner).find((a) => a.type === 'defPass' || a.type === 'endPhase')!).state;
    s = act(forted.engine, s, { type: 'move.start', units: ['gs'] }).state;
    const before = s;
    const entered = act(forted.engine, s, { type: 'move.step', to: 'uK4' });
    expect(fortifiedKnownTo(forted.engine.env(entered.state), 'uK4', 'ge')).toBe(true);
    expect(redactState(forted.engine, entered.state, 'ge').ext['asl.breach']).toEqual([{ loc: 'uK4', toward: 'uL3', by: 'he' }]);
    // The stream that reveals it folds into that snapshot.
    const folded = forted.engine.applyEvents(redactState(forted.engine, before, 'ge'), streamFor(forted.engine, 'ge', before, entered));
    expect(folded.ext['asl.breach']).toEqual([{ loc: 'uK4', toward: 'uL3', by: 'he' }]);
  });

  it('the firer may suspect only the unrevealed fortifiable Locations while some designation is still unshown', () => {
    const pieces: PieceSpec[] = [{ id: 'g', def: 'ge.467', side: 'ge', hex: 'uY1' }, { id: 'r', def: 'ru.447', side: 'ru', hex: 'uA1' }];
    const hidden = game(pieces);
    const env = hidden.engine.env(designate(hidden.engine, hidden.state, ['uK5']));
    expect(fortifiedPossibleTo(env, 'uK4', 'ge')).toBe(true);
    expect(fortifiedPossibleTo(env, 'uK4', 'ru')).toBe(false);
    expect(fortifiedPossibleTo(env, 'uL3', 'ge')).toBe(false);
    // One Location, designated openly: K5 is known, and K4 can no longer be fortified, so its KIA asks nothing.
    const open = game(pieces, { count: 1, open: true });
    const env2 = open.engine.env(designate(open.engine, open.state, ['uK5']));
    expect(fortifiedPossibleTo(env2, 'uK5', 'ge')).toBe(true);
    expect(fortifiedPossibleTo(env2, 'uK4', 'ge')).toBe(false);
  });
});

describe('B23.93 and C2.6: Guns in Fortified Building Locations', () => {
  it('any Gun may set up in a fortified ground Location; at a fortified upper level of a stone house only an ART/AT/INF Gun of at most 76mm', () => {
    const { engine, state } = game([
      { id: 'c1', def: 'ge.228c', side: 'ge', hex: 'uK4' },
      { id: 'g88', def: 'ge.AA88L', side: 'ge', heldBy: 'c1', tags: { ca: 0 } },
      { id: 'c2', def: 'ge.228c', side: 'ge', hex: 'uK4', level: 1 },
      { id: 'g75', def: 'ge.AT75L', side: 'ge', heldBy: 'c2', tags: { ca: 0 } },
      { id: 'r', def: 'ru.447', side: 'ru', hex: 'uA1' },
    ]);
    const env = engine.env(designate(engine, state, ['uK4', 'uK4:1']));
    const base = 'the Starter Kit says no';
    expect(env.query('gun.setupIllegal', { gun: 'g88', loc: 'uK4' }, base)).toBeNull();
    expect(env.query('gun.setupIllegal', { gun: 'g75', loc: 'uK4:1' }, base)).toBeNull();
    expect(env.query('gun.setupIllegal', { gun: 'g88', loc: 'uK4:1' }, base)).toMatch(/at most 76mm/);
    expect(env.query('gun.setupIllegal', { gun: 'g75', loc: 'uK5:1' }, base)).toBe(base);
    expect(env.query('gun.setupIllegal', { gun: 'g88', loc: 'uK5' }, base)).toBe(base);
  });
  it('a Gun at a fortified upper level never moves; no Gun may be pushed into a known fortified Location', () => {
    const { engine, state } = game(
      [
        { id: 'c2', def: 'ge.228c', side: 'ge', hex: 'uK4', level: 1 },
        { id: 'g75', def: 'ge.AT75L', side: 'ge', heldBy: 'c2', tags: { ca: 0 } },
        { id: 'c3', def: 'ge.228c', side: 'ge', hex: 'uJ4' },
        { id: 'g57', def: 'br.AT57L', side: 'ge', heldBy: 'c3', tags: { ca: 0 } },
        { id: 'r', def: 'ru.447', side: 'ru', hex: 'uY1' },
      ],
      { startPhase: 'MPh', open: true },
    );
    let s = designate(engine, state, ['uK4', 'uK4:1']);
    const d = engine.currentDecision(s)!;
    expect(engine.validate(s, { side: 'ge', decisionId: d.id, type: 'move.start', units: ['c2'], manhandle: 'g75' } as Action)).toMatch(/B23.93/);
    s = act(engine, s, { type: 'move.start', units: ['c3'], manhandle: 'g57' }).state;
    expect(engine.validate(s, { side: 'ge', decisionId: engine.currentDecision(s)!.id, type: 'move.manhandle', to: 'uK4' } as Action)).toMatch(/B23.93/);
  });
  it('C2.6: a Gun fires at a target two levels below only at a range of at least two', () => {
    // The house on a level 1 hill: level 1 of K4 stands at height 2; J4 (adjacent) and I4 (range 2) are at the foot.
    const hill: Record<string, HexTerrainSpec> = { ...HOUSE, uK4: { ...HOUSE['uK4']!, elevation: 1 }, uK5: { ...HOUSE['uK5']!, elevation: 1 } };
    const scenario = { firstSide: 'ge', sides: [{ side: 'ge', name: 'German', nationality: 'ge', elr: 3 }, { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 }] };
    const probe = makeEngine({ board: 'u', terrain: hill, scenario, modules: ASL, pieces: [] });
    const map = statics(probe.engine.env(probe.state)).map;
    const ca = inCoveredArc(map.hex('uK4')!.cube, 0, map.hex('uJ4')!.cube) ? 0 : nearestSpine(map.hex('uK4')!.cube, 0, map.hex('uJ4')!.cube)!;
    const { engine, state } = makeEngine({
      board: 'u',
      terrain: hill,
      scenario,
      modules: ASL,
      pieces: [
        { id: 'c2', def: 'ge.228c', side: 'ge', hex: 'uK4', level: 1 },
        { id: 'g75', def: 'ge.AT75L', side: 'ge', heldBy: 'c2', tags: { ca } },
        { id: 'r', def: 'ru.447', side: 'ru', hex: 'uJ4' },
        { id: 'r2', def: 'ru.447', side: 'ru', hex: 'uI4' },
      ],
    });
    const env = engine.env(state);
    const illegal = (target: string) => env.query('ordnance.illegal', { shot: { weapon: 'g75', target, targetType: 'ITT' }, mode: 'prep', side: 'ge' }, null);
    expect(illegal('uJ4')).toMatch(/2 levels below it only at a range of at least 2 \(ASLRB C2.6\)/);
    expect(illegal('uI4') ?? '').not.toMatch(/C2.6/);
  });
});

describe('the Starter Kit is untouched', () => {
  it('a building-wide designation still fortifies every Location of the building and reveals on entry of any hex', () => {
    const { engine, state } = makeEngine({
      board: 'u',
      terrain: HOUSE,
      scenario: {
        firstSide: 'ge',
        sides: [{ side: 'ge', name: 'German', nationality: 'ge', elr: 3 }, { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 }],
        forces: [{ side: 'ru', units: [], setup: { kind: 'area' as const, description: 'the house', hexes: ['uK4', 'uK5'] } }],
        ssr: [{ module: FORTIFIED_MODULE, params: { side: 'ru', count: 1, within: 'setup' } }],
      },
      modules: SK,
      extra: [fortifiedModule],
      pieces: [{ id: 'g', def: 'ge.467', side: 'ge', hex: 'uJ4' }, { id: 'r', def: 'ru.447', side: 'ru', hex: 'uK5' }],
      startPhase: 'APh',
    });
    const s = act(engine, state, { type: 'fortify.designate', buildings: ['u-B16'] }).state;
    const env = engine.env(s);
    expect(fortifiedState(env)).toEqual({ side: 'ru', buildings: ['u-B16'], revealed: [] });
    expect(isFortified(env, 'uK4')).toBe(true);
    expect(isFortified(env, 'uK5')).toBe(true);
    expect(() => act(engine, s, { type: 'fortify.designate', locations: ['uK4'] })).toThrow();
    const t = act(engine, s, { type: 'advance', units: ['g'], to: 'uK4' });
    expect(t.state.pieces['g']!.loc).toEqual({ kind: 'hex', hex: 'uK4' });
    expect(fortifiedState(engine.env(t.state))!.revealed).toEqual(['u-B16']);
  });
});
