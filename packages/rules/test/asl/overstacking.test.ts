import { describe, expect, it } from 'vitest';
import type { Engine, GameState, RuleModule } from '@asl/engine';
import { aslCoreModules, dmChoiceIllegal, moveState, overstackBy, overstackEntryMf, piecesModule, placementIllegal, planRout, stackingEquivalents, turnModule, type HexTerrainSpec } from '../../src';
import { sk1CoreModules } from '../../src/sk1';
import { sk2CoreModules } from '../../src/sk2';
import { sk3CoreModules } from '../../src/sk3';
import { RU_VS_GE, act, makeEngine, type PieceSpec } from '../fixtures';

/*
 * Overstacking (ASLRB A5.1, A5.5, A5.11, A4.72). Board u: uQ4 is a stone building (2 MF), uQ5 open ground beside it;
 * uP4-uP5-uP6 a road. The Russians stand far off in uY10.
 */

const SK: RuleModule[] = [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules];
const ASL: RuleModule[] = [...SK, ...aslCoreModules];
const GE_RU = { firstSide: 'ge', sides: [{ side: 'ge', name: 'German', nationality: 'ge', elr: 3 }, { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 }] };
const road = { terrain: 'open', features: ['road:dirt'] };
const GROUND: Record<string, HexTerrainSpec> = { uQ4: { terrain: 'building-stone' }, uP4: road, uP5: road, uP6: road };
const ROADS: [string, string][] = [['uP4', 'uP5'], ['uP5', 'uP6']];

function game(pieces: PieceSpec[], opts: { asl?: boolean; dice?: number[]; startPhase?: string } = {}) {
  return makeEngine({ board: 'u', terrain: GROUND, roadHexsides: ROADS, scenario: GE_RU, modules: opts.asl === false ? SK : ASL, startPhase: opts.startPhase ?? 'MPh', pieces, dice: opts.dice ?? [] });
}
const far: PieceSpec = { id: 'r', def: 'ru.447', side: 'ru', hex: 'uY10' };
const squads = (hex: string, n: number, prefix = 's'): PieceSpec[] => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, def: 'ge.467', side: 'ge', hex }));
const leaders = (hex: string, n: number): PieceSpec[] => Array.from({ length: n }, (_, i) => ({ id: `l${i + 1}`, def: 'ge.L80', side: 'ge', hex }));
type MapApi = { offboard(e: string): { id: string }[]; offboardNeighbors(h: string): { onboard: string[]; offboard: string[] } };
const mapOf = (engine: Engine, state: GameState) => (engine.env(state) as unknown as { statics: { map: MapApi } }).statics.map;
const entering = (id: string): PieceSpec => ({ id, def: 'ru.447', side: 'ru', tags: { force: 0, entryTurn: 1, entryEdge: 'N' } });
const ENTERING = { ...RU_VS_GE, forces: [{ side: 'ru', units: [{ def: 'ru.447', count: 4 }], setup: { kind: 'enter' as const, turn: 1, edge: 'N' } }] };
const check = (engine: Engine, s: GameState, a: Record<string, unknown>) => {
  const d = engine.currentDecision(s)!;
  return engine.validate(s, { side: d.owner, decisionId: d.id, ...a } as never);
};
const passAll = (engine: Engine, s0: GameState) => {
  let s = s0;
  for (let i = 0; i < 20 && engine.currentDecision(s)?.owner === 'ru'; i++) s = act(engine, s, { type: 'defPass' }).state;
  return s;
};

describe('A5.5 stacking equivalents and A5.1 overstacking', () => {
  it('five SMC equal a HS; four or fewer count nothing (A5.5)', () => {
    const { engine, state } = game([...squads('uQ4', 3), ...leaders('uQ4', 4), ...leaders('uQ5', 9).map((p) => ({ ...p, id: `m${p.id}` })), far]);
    const env = engine.env(state);
    const at = (hex: string) => Object.values(state.pieces).filter((p) => p.loc.kind === 'hex' && p.loc.hex === hex);
    expect(stackingEquivalents(env, at('uQ4'))).toBe(3);
    expect(overstackBy(env, 'uQ4', 'ge')).toEqual({ personnel: 0, vehicles: 0 });
    // Nine SMC alone: one HS for the first five, nothing for the four left over.
    expect(stackingEquivalents(env, at('uQ5'))).toBe(0.5);
  });

  it('three squads and five SMC are overstacked by ½, FRU one; two squads and five SMC are not', () => {
    const three = game([...squads('uQ4', 3), ...leaders('uQ4', 5), far]);
    expect(overstackBy(three.engine.env(three.state), 'uQ4', 'ge').personnel).toBe(1);
    const two = game([...squads('uQ4', 2), ...leaders('uQ4', 5), far]);
    expect(overstackBy(two.engine.env(two.state), 'uQ4', 'ge').personnel).toBe(0);
  });

  it('setup never overstacks, offboard included (A2.9, A5.1); moving offboard may, paying the MF (A2.51 "move normally")', () => {
    const { engine, state } = makeEngine({ pieces: ['a', 'b', 'c', 'd'].map(entering), scenario: ENTERING, modules: ASL, startPhase: 'RPh' });
    const map = mapOf(engine, state);
    const off = map.offboard('N')[5]!.id;
    const todo = ['a', 'b', 'c', 'd'].map((id) => state.pieces[id]!);
    expect(placementIllegal(engine.env(state), 'ru', todo, Object.fromEntries(todo.map((p) => [p.id, off])))).toMatch(/Stacking limit exceeded/);
    const moving = makeEngine({ pieces: ['a', 'b', 'c', 'd'].map(entering), scenario: ENTERING, modules: ASL, startPhase: 'MPh' });
    const sideways = map.offboardNeighbors(off).offboard[0]!;
    const pieces = Object.fromEntries(Object.entries(moving.state.pieces).map(([id, p]) => [id, { ...p, loc: { kind: 'offboard' as const, edge: 'N', hex: id === 'd' ? sideways : off } }]));
    let s: GameState = { ...moving.state, pieces };
    s = act(moving.engine, s, { type: 'move.start', units: ['a', 'b', 'c'] }).state;
    s = act(moving.engine, s, { type: 'move.step', to: sideways }).state;
    expect(moveState(moving.engine.env(s))!.off).toBe(sideways);
    expect(moveState(moving.engine.env(s))!.spent['a']).toBe(2);
  });
});

describe('A5.11 movement into an overstacked Location', () => {
  it('a fourth squad enters a building holding three, paying one MF more; the Starter Kit refuses it (SK4 3.3)', () => {
    const { engine, state } = game([...squads('uQ4', 3), { id: 'm', def: 'ge.467', side: 'ge', hex: 'uQ5' }, far]);
    let s = act(engine, state, { type: 'move.start', units: ['m'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uQ4' }).state;
    expect(s.pieces['m']!.loc).toMatchObject({ hex: 'uQ4' });
    expect(moveState(engine.env(s))!.spent['m']).toBe(3);
    const sk = game([...squads('uQ4', 3), { id: 'm', def: 'ge.467', side: 'ge', hex: 'uQ5' }, far], { asl: false });
    const s2 = act(sk.engine, sk.state, { type: 'move.start', units: ['m'] }).state;
    expect(check(sk.engine, s2, { type: 'move.step', to: 'uQ4' })).toMatch(/Stacking limit: 3 squad-equivalents/);
  });

  it('the A5.11 EX: two squads and a crew; a squad moving in pays three MF, a HS in their place only two', () => {
    const base: PieceSpec[] = [...squads('uQ4', 2), { id: 'c', def: 'ge.228c', side: 'ge', hex: 'uQ4' }, far];
    const { engine, state } = game([...base, { id: 'm', def: 'ge.467', side: 'ge', hex: 'uQ5' }]);
    expect(overstackEntryMf(engine.env(state), 'uQ4', ['m'], 'ge')).toBe(1);
    let s = act(engine, state, { type: 'move.start', units: ['m'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uQ4' }).state;
    expect(moveState(engine.env(s))!.spent['m']).toBe(3);
    const hs = game([...base, { id: 'h', def: 'ge.247', side: 'ge', hex: 'uQ5' }]);
    let t = act(hs.engine, hs.state, { type: 'move.start', units: ['h'] }).state;
    t = act(hs.engine, t, { type: 'move.step', to: 'uQ4' }).state;
    expect(moveState(hs.engine.env(t))!.spent['h']).toBe(2);
  });

  it('a squad that cannot pay makes a Minimum Move into it (A5.11, A4.134)', () => {
    // Four squads there already: a fifth overstacks it by two (2 + 2 = 4 MF); the squad carrying a MMG has three.
    const { engine, state } = game([...squads('uQ4', 4), { id: 'm', def: 'ge.467', side: 'ge', hex: 'uQ5' }, { id: 'mmg', def: 'ge.MMG', side: 'ge', heldBy: 'm' }, far]);
    const s = act(engine, state, { type: 'move.start', units: ['m'] }).state;
    const r = act(engine, s, { type: 'move.step', to: 'uQ4' });
    expect(r.events.find((e) => e.type === 'asl.move.minimum')?.payload).toEqual({ units: ['m'], to: 'uQ4', cost: 4 });
    const end = passAll(engine, r.state);
    expect(end.pieces['m']!.tags).toMatchObject({ pinned: true, cx: true });
  });

  it('Personnel entering a Location overstacked by vehicles pay nothing more (A5.11)', () => {
    const { engine, state } = game([{ id: 'v1', def: 'ge.pzivf2', side: 'ge', hex: 'uQ6' }, { id: 'v2', def: 'ge.psw2341', side: 'ge', hex: 'uQ6' }, { id: 'm', def: 'ge.467', side: 'ge', hex: 'uQ5' }, far]);
    let s = act(engine, state, { type: 'move.start', units: ['m'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uQ6' }).state;
    expect(moveState(engine.env(s))!.spent['m']).toBe(1);
  });

  it('the road rate and the road bonus are kept (A4.132: only terrain costs are not cumulative)', () => {
    const { engine, state } = game([...squads('uP5', 3), { id: 'm', def: 'ge.467', side: 'ge', hex: 'uP4' }, far]);
    let s = act(engine, state, { type: 'move.start', units: ['m'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uP5' }).state;
    const ms = moveState(engine.env(s))!;
    expect(ms.spent['m']).toBe(2);
    expect(ms.roadOnly).toBe(true);
    // Four MF and the road bonus: two more road hexes are still open (2 + 1 + 1 = 4, the fifth MF the bonus).
    s = act(engine, s, { type: 'move.step', to: 'uP6' }).state;
    expect(moveState(engine.env(s))!.spent['m']).toBe(3);
  });

  it('a hidden friendly unit there counts (A5.11 counts the mover\'s own units)', () => {
    const pieces: PieceSpec[] = [...squads('uQ4', 2), { id: 'h', def: 'ge.467', side: 'ge', hex: 'uQ4', tags: { hip: true } }, { id: 'm', def: 'ge.467', side: 'ge', hex: 'uQ5' }, far];
    const { engine, state } = game(pieces);
    let s = act(engine, state, { type: 'move.start', units: ['m'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uQ4' }).state;
    expect(moveState(engine.env(s))!.spent['m']).toBe(3);
  });

  it('an enemy\'s Known units count against their own limit; unknown ones do not (A5.1 "each side")', () => {
    const russians: PieceSpec[] = Array.from({ length: 4 }, (_, i) => ({ id: `r${i + 1}`, def: 'ru.447', side: 'ru', hex: 'uQ4' }));
    const { engine, state } = game([...russians, { id: 'm', def: 'ge.467', side: 'ge', hex: 'uQ5' }, far]);
    expect(overstackEntryMf(engine.env(state), 'uQ4', ['m'], 'ge')).toBe(1);
    const hidden = game([...russians.map((p) => ({ ...p, tags: { hip: true } })), { id: 'm', def: 'ge.467', side: 'ge', hex: 'uQ5' }, far]);
    expect(overstackEntryMf(hidden.engine.env(hidden.state), 'uQ4', ['m'], 'ge')).toBe(0);
  });
});

describe('A5.11 with A4.72: the advance', () => {
  it('the A5.11 EX: a squad advancing into the Location (now three squads and a crew) pays four MF and becomes CX', () => {
    const { engine, state } = game([...squads('uQ4', 3), { id: 'c', def: 'ge.228c', side: 'ge', hex: 'uQ4' }, { id: 'a', def: 'ge.467', side: 'ge', hex: 'uQ5' }, far], { startPhase: 'APh' });
    const s = act(engine, state, { type: 'advance', units: ['a'], to: 'uQ4' }).state;
    expect(s.pieces['a']!.loc).toMatchObject({ hex: 'uQ4' });
    expect(s.pieces['a']!.tags['cx']).toBe(true);
  });

  it('a HS advancing into two squads and a crew pays two MF and stays fresh', () => {
    const { engine, state } = game([...squads('uQ4', 2), { id: 'c', def: 'ge.228c', side: 'ge', hex: 'uQ4' }, { id: 'a', def: 'ge.247', side: 'ge', hex: 'uQ5' }, far], { startPhase: 'APh' });
    const s = act(engine, state, { type: 'advance', units: ['a'], to: 'uQ4' }).state;
    expect(s.pieces['a']!.tags['cx']).toBeUndefined();
  });

  it('A4.72: a 9-1 (six MF) advancing into four-MF woods becomes CX; a CX unit is refused; the Starter Kit makes him CX only at all his MF', () => {
    const terrain = { uQ4: { terrain: 'woods', elevation: 1 } };
    const pieces: PieceSpec[] = [{ id: 'l', def: 'ge.L91', side: 'ge', hex: 'uQ5' }, far];
    const asl = makeEngine({ board: 'u', terrain, scenario: GE_RU, modules: ASL, startPhase: 'APh', pieces });
    const s = act(asl.engine, asl.state, { type: 'advance', units: ['l'], to: 'uQ4' }).state;
    expect(s.pieces['l']!.tags['cx']).toBe(true);
    const cx = makeEngine({ board: 'u', terrain, scenario: GE_RU, modules: ASL, startPhase: 'APh', pieces: [{ ...pieces[0]!, tags: { cx: true } }, far] });
    expect(check(cx.engine, cx.state, { type: 'advance', units: ['l'], to: 'uQ4' })).toMatch(/four MF or more \(ASLRB A4.72\)/);
    const sk = makeEngine({ board: 'u', terrain, scenario: GE_RU, modules: SK, startPhase: 'APh', pieces });
    const t = act(sk.engine, sk.state, { type: 'advance', units: ['l'], to: 'uQ4' }).state;
    expect(t.pieces['l']!.tags['cx']).toBeUndefined();
  });
});

describe('A10.51 rout and A10.62 DM with overstacking', () => {
  // The broken 4-4-7 in uQ5 sees the German in uT5 (three hexes). uP4 is a building (2 MF), uO5 woods by way of uP5
  // (1 + 2 MF); both are farther from the German than uQ5.
  const terrain: Record<string, HexTerrainSpec> = { uP4: { terrain: 'building-stone' }, uO5: { terrain: 'woods' } };
  const RU_FIRST = { ...GE_RU, firstSide: 'ru' };
  const routGame = (inBuilding: number, opts: { asl?: boolean } = {}) =>
    makeEngine({
      board: 'u',
      terrain,
      scenario: RU_FIRST,
      modules: opts.asl === false ? SK : ASL,
      startPhase: 'RtPh',
      pieces: [{ id: 'b', def: 'ru.447', side: 'ru', hex: 'uQ5', tags: { broken: true, dm: true } }, ...squads('uP4', inBuilding, 'p').map((p) => ({ ...p, def: 'ru.447', side: 'ru' })), { id: 'g', def: 'ge.467', side: 'ge', hex: 'uT5' }],
    });

  it('the nearest shelter is reckoned with the overstacking MF (Q&A to A5.11 and A10.51): four squads in the building make the woods nearer', () => {
    const { engine, state } = routGame(4);
    const plan = planRout(engine.env(state), 'b');
    expect(plan.cost.get('uP4')).toBe(4);
    expect([...plan.destinations]).toEqual(['uO5']);
  });

  it('a building of three squads is routed to "even if overstacked" and the rout may end there (A10.51); the Starter Kit ignores it (SK1 3.6)', () => {
    const { engine, state } = routGame(3);
    const plan = planRout(engine.env(state), 'b');
    expect(plan.cost.get('uP4')).toBe(3);
    expect([...plan.destinations].sort()).toEqual(['uO5', 'uP4']);
    const s = act(engine, state, { type: 'rout.step', unit: 'b', to: 'uP4' }).state;
    expect(s.pieces['b']!.loc).toMatchObject({ hex: 'uP4' });
    expect(engine.legalActions(s, 'ru')).toContainEqual(expect.objectContaining({ type: 'rout.stop', unit: 'b' }));
    const sk = routGame(3, { asl: false });
    expect(check(sk.engine, sk.state, { type: 'rout.step', unit: 'b', to: 'uP4' })).toMatch(/Stacking limit/);
  });

  it('A10.62: a broken unit under DM in an overstacked woods may keep its DM; one not overstacked may not', () => {
    const pieces = (n: number): PieceSpec[] => [{ id: 'b', def: 'ru.447', side: 'ru', hex: 'uO5', tags: { broken: true, dm: true } }, ...Array.from({ length: n }, (_, i): PieceSpec => ({ id: `o${i}`, def: 'ru.447', side: 'ru', hex: 'uO5' })), { id: 'g', def: 'ge.467', side: 'ge', hex: 'uY10' }];
    const over = makeEngine({ board: 'u', terrain, scenario: RU_FIRST, modules: ASL, startPhase: 'RPh', pieces: pieces(3) });
    expect(dmChoiceIllegal(over.engine.env(over.state), 'ru', 'b')).toBeNull();
    const not = makeEngine({ board: 'u', terrain, scenario: RU_FIRST, modules: ASL, startPhase: 'RPh', pieces: pieces(2) });
    expect(dmChoiceIllegal(not.engine.env(not.state), 'ru', 'b')).toMatch(/In woods or a building/);
  });
});

describe('A12.14 with A12.3: a hidden unit that becomes overstacked', () => {
  // Russian Turn: the hidden 4-4-7 in the uQ4 building with two more; a third moves in from uQ5. The German in uQ1 sees
  // uQ4 over open ground, unless uQ3 is woods.
  const RU_FIRST = { ...GE_RU, firstSide: 'ru' };
  const hiddenGame = (seen: boolean) =>
    makeEngine({
      board: 'u',
      terrain: { ...GROUND, ...(seen ? {} : { uQ3: { terrain: 'woods' } }) },
      scenario: RU_FIRST,
      modules: ASL,
      startPhase: 'MPh',
      pieces: [
        { id: 'h', def: 'ru.447', side: 'ru', hex: 'uQ4', tags: { hip: true } },
        { id: 'a', def: 'ru.447', side: 'ru', hex: 'uQ4' },
        { id: 'b', def: 'ru.447', side: 'ru', hex: 'uQ4' },
        { id: 'm', def: 'ru.447', side: 'ru', hex: 'uQ5' },
        { id: 'g', def: 'ge.467', side: 'ge', hex: 'uQ1' },
      ],
    });
  const moveIn = (engine: Engine, s0: GameState) => {
    const s = act(engine, s0, { type: 'move.start', units: ['m'] }).state;
    return act(engine, s, { type: 'move.step', to: 'uQ4' });
  };

  it('in the LOS of a Good Order enemy ground unit it is revealed at once', () => {
    const { engine, state } = hiddenGame(true);
    const r = moveIn(engine, state);
    expect(r.events.find((e) => e.type === 'sk2.hip.unitRevealed')?.payload).toMatchObject({ unit: 'h', reason: 'overstacked' });
    expect(r.state.pieces['h']!.tags['hip']).toBeUndefined();
    // The step cost the mover the overstacking MF, the hidden squad counted (A5.11).
    expect(moveState(engine.env(r.state))!.spent['m']).toBe(3);
  });

  it('out of such LOS it stays hidden', () => {
    const { engine, state } = hiddenGame(false);
    const r = moveIn(engine, state);
    expect(r.events.some((e) => e.type === 'sk2.hip.unitRevealed')).toBe(false);
    expect(r.state.pieces['h']!.tags['hip']).toBe(true);
  });
});
