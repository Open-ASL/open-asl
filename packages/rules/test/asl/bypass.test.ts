import { describe, expect, it } from 'vitest';
import type { GameState, RuleModule } from '@asl/engine';
import { aslCoreModules, controlState, entryHexside, cornerBetween, moveState, piecesModule, sideToward, statics, turnModule, type HexTerrainSpec } from '../../src';
import { sk1CoreModules } from '../../src/sk1';
import { sk2CoreModules } from '../../src/sk2';
import { sk3CoreModules } from '../../src/sk3';
import { RU_VS_GE, act, makeEngine, type PieceSpec } from '../fixtures';
import { bypassCorners, heightAdvantageInBypass, heightAdvantageInBypassFor } from '../../src/asl/bypass';
import { firstFireTargets } from '../../src/sk1/moveState';

/*
 * Bypass (ASLRB A4.3–A4.34). Board u's
 * grid, with the wooden single-hex building R3 of the real board: the German stack comes from Q4 and goes round it.
 * Corner names follow ASLRB A2.2: R3-S3-S4 is where R3, S3 and S4 meet.
 */

const SK: RuleModule[] = [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules];
const ASL: RuleModule[] = [...SK, ...aslCoreModules];
const BUILDING: Record<string, HexTerrainSpec> = { uR3: { terrain: 'building-wood' } };

function game(pieces: PieceSpec[], opts: { terrain?: Record<string, HexTerrainSpec>; dice?: number[]; asl?: boolean; hexMarkers?: Record<string, Record<string, unknown>>; startPhase?: string } = {}) {
  return makeEngine({
    board: 'u',
    terrain: opts.terrain ?? BUILDING,
    scenario: { ...RU_VS_GE, firstSide: 'ge' },
    modules: opts.asl === false ? SK : ASL,
    startPhase: opts.startPhase ?? 'MPh',
    pieces,
    ...(opts.dice ? { dice: opts.dice } : {}),
    ...(opts.hexMarkers ? { hexMarkers: opts.hexMarkers } : {}),
  });
}
const far: PieceSpec = { id: 'far', def: 'ru.447', side: 'ru', hex: 'uY10' };
const squad = (id = 'g', hex = 'uQ4'): PieceSpec => ({ id, def: 'ge.467', side: 'ge', hex });
type Eng = ReturnType<typeof game>['engine'];
const start = (engine: Eng, state: GameState, units = ['g'], extra: Record<string, unknown> = {}) => act(engine, state, { type: 'move.start', units, ...extra }).state;
const check = (engine: Eng, state: GameState, a: Record<string, unknown>) => engine.validate(state, { side: 'ge', decisionId: engine.currentDecision(state)!.id, ...a } as never);
const ms = (engine: Eng, s: GameState) => moveState(engine.env(s))!;
const check2 = (engine: Eng, state: GameState, a: Record<string, unknown>) => engine.validate(state, { side: 'ru', decisionId: engine.currentDecision(state)!.id, ...a } as never);
/** Passes any Defensive First Fire offered, so the mover has the decision again. */
const pass = (engine: Eng, s: GameState) => {
  let x = s;
  while (engine.currentDecision(x)?.owner === 'ru') x = act(engine, x, { type: 'defPass' }).state;
  return x;
};
const step = (engine: Eng, s: GameState, a: Record<string, unknown>) => pass(engine, act(engine, s, { type: 'move.step', ...a }).state);

describe('Bypass movement (ASLRB A4.3, A4.31)', () => {
  it('is not in the Starter Kit', () => {
    const { engine, state } = game([squad(), far], { asl: false });
    const s = start(engine, state);
    expect(engine.legalActions(s, 'ge').some((a) => a['bypass'])).toBe(false);
    expect(check(engine, s, { type: 'move.step', to: 'uR3', bypass: ['uR4'] })).toMatch(/Starter Kit/);
  });

  it('round a building from the next hex costs one MF for one or two hexsides, and puts the stack at the corner', () => {
    const { engine, state } = game([squad(), far]);
    const s = start(engine, state);
    const offered = engine.legalActions(s, 'ge').filter((a) => a.type === 'move.step' && a['bypass']);
    expect(offered.map((a) => (a['bypass'] as string[]).join('-'))).toEqual(expect.arrayContaining(['uR4', 'uR4-uS4', 'uQ3', 'uQ3-uR2']));
    const b = step(engine, s, { to: 'uR3', bypass: ['uR4', 'uS4'] });
    const m = ms(engine, b);
    const map = statics(engine.env(b)).map;
    expect(m.hex).toBe('uR3');
    expect(m.spent['g']).toBe(1);
    expect(m.bypass).toMatchObject({ hex: 'uR3', base: 1 });
    expect(m.bypass!.at).toBe(cornerBetween(map, 'uR3', 'uS3', 'uS4'));
    expect(b.pieces['g']!.loc).toEqual({ kind: 'hex', hex: 'uR3' });
  });

  it('SMOKE in the hex adds one MF to the Bypass cost, and a Bypass uphill doubles it: 2 MF, 4 MF uphill (A4.3, A24.7, B.2, B10.4)', () => {
    // A leader with the squad: 6 MF, enough to spend 4 and still step out of Bypass downhill.
    const pieces: PieceSpec[] = [squad(), { id: 'l', def: 'ge.L91', side: 'ge', hex: 'uQ4' }, far];
    const flat = game(pieces, { hexMarkers: { uR3: { smoke: true } } });
    const a = step(flat.engine, start(flat.engine, flat.state, ['g', 'l']), { to: 'uR3', bypass: ['uR4'] });
    expect(ms(flat.engine, a).spent['g']).toBe(2);
    const hill = game(pieces, { hexMarkers: { uR3: { smoke: true } }, terrain: { uR3: { terrain: 'building-wood', elevation: 1 } } });
    const b = step(hill.engine, start(hill.engine, hill.state, ['g', 'l']), { to: 'uR3', bypass: ['uR4'] });
    expect(ms(hill.engine, b).spent['g']).toBe(4);
    // Without the SMOKE, uphill is 2.
    const bare = game(pieces, { terrain: { uR3: { terrain: 'building-wood', elevation: 1 } } });
    const c = step(bare.engine, start(bare.engine, bare.state, ['g', 'l']), { to: 'uR3', bypass: ['uR4'] });
    expect(ms(bare.engine, c).spent['g']).toBe(2);
  });

  it('a third hexside doubles the hex Bypass cost once: one MF more, then nothing for a fourth (A4.31 example)', () => {
    const { engine, state } = game([squad(), far]);
    let s = step(engine, start(engine, state), { to: 'uR3', bypass: ['uR4', 'uS4'] });
    s = step(engine, s, { to: 'uR3', bypass: ['uS3'] });
    expect(ms(engine, s).spent['g']).toBe(2);
    s = step(engine, s, { to: 'uR3', bypass: ['uR2'] });
    expect(ms(engine, s).spent['g']).toBe(2);
    expect(ms(engine, s).bypass!.sides).toHaveLength(4);
  });

  it('only the hexsides travelled along must be clear, and not the one crossed into the hex', () => {
    const { engine, state } = game([squad(), far], { terrain: { uR3: { terrain: 'building-wood', bypassBlocked: [] } } });
    const s = start(engine, state);
    const map = statics(engine.env(s)).map;
    const entry = sideToward(map, 'uR3', 'uQ4')!;
    // The obstacle touching the entry hexside does not matter...
    const { engine: e2, state: st2 } = game([squad(), far], { terrain: { uR3: { terrain: 'building-wood', bypassBlocked: [entry] } } });
    expect(check(e2, start(e2, st2), { type: 'move.step', to: 'uR3', bypass: ['uR4'] })).toBeNull();
    // ...going along it is not Bypass, and a touched hexside cannot be gone along.
    expect(check(engine, s, { type: 'move.step', to: 'uR3', bypass: ['uQ4'] })).toMatch(/not along the hexside crossed/);
    const side = sideToward(map, 'uR3', 'uR4')!;
    const { engine: e3, state: st3 } = game([squad(), far], { terrain: { uR3: { terrain: 'building-wood', bypassBlocked: [side] } } });
    expect(check(e3, start(e3, st3), { type: 'move.step', to: 'uR3', bypass: ['uR4'] })).toMatch(/touches its hexside/);
  });

  it('from the corner: the two hexes there or the obstacle; entering it costs its whole COT in the same Location', () => {
    const { engine, state } = game([squad(), far]);
    const s = step(engine, start(engine, state), { to: 'uR3', bypass: ['uR4', 'uS4'] });
    const steps = engine.legalActions(s, 'ge').filter((a) => a.type === 'move.step' && !a['bypass']).map((a) => a['to']).sort();
    expect(steps).toEqual(['uR3', 'uS3', 'uS4']);
    expect(check(engine, s, { type: 'move.step', to: 'uQ4' })).toMatch(/may enter/);
    const inside = step(engine, s, { to: 'uR3' });
    const m = ms(engine, inside);
    expect(m.bypass).toBeUndefined();
    expect(m.spent['g']).toBe(3);
    expect(m.mfHere).toBe(3);
    expect(m.hexesEntered).toBe(1);
  });

  it('may not end its move in Bypass (A4.32): no End move, no units left behind', () => {
    const { engine, state } = game([{ id: 'g', def: 'ge.467', side: 'ge', hex: 'uQ4' }, { id: 'g2', def: 'ge.447', side: 'ge', hex: 'uQ4' }, far]);
    const s = step(engine, start(engine, state, ['g', 'g2']), { to: 'uR3', bypass: ['uR4'] });
    const types = engine.legalActions(s, 'ge').map((a) => a.type);
    expect(types).not.toContain('move.end');
    expect(types).not.toContain('move.stopUnits');
    expect(check(engine, s, { type: 'move.end' })).toMatch(/A4.32/);
  });

  it("refuses a Bypass that could never end outside Bypass: a unit with 2 MF, by a full look-ahead", () => {
    // Every hex round R3 is woods (two MF): with two MF a squad that bypasses R3 for one has one left, which can neither
    // enter R3 (two) nor a woods hex at a corner (two); going further round, or bypassing the woods, only spends it.
    const terrain: Record<string, HexTerrainSpec> = { uR3: { terrain: 'building-wood' } };
    for (const h of ['uQ3', 'uR2', 'uS3', 'uS4', 'uR4']) terrain[h] = { terrain: 'woods' };
    const { engine, state } = game([squad('g', 'uQ6'), far], { terrain });
    let s = start(engine, state);
    s = step(engine, s, { to: 'uQ5' });
    s = step(engine, s, { to: 'uQ4' });
    expect(ms(engine, s).spent['g']).toBe(2);
    expect(check(engine, s, { type: 'move.step', to: 'uR3', bypass: ['uR4'] })).toMatch(/could not end its move outside Bypass/);
    expect(engine.legalActions(s, 'ge').some((a) => a['bypass'] && a['to'] === 'uR3')).toBe(false);
    // With three MF left it may: one for the Bypass, two for the woods at the corner.
    const { engine: e2, state: st2 } = game([squad('g', 'uQ5'), far], { terrain });
    const s2 = step(e2, start(e2, st2), { to: 'uQ4' });
    expect(check(e2, s2, { type: 'move.step', to: 'uR3', bypass: ['uR4'] })).toBeNull();
  });

  it('may not spend its last MF in place in Bypass either: Smoke grenades or a DC that would strand it (A4.32)', () => {
    // Every hex round R3 is woods (two MF). After one MF of Bypass a squad has three: Smoke in its own hex (one MF) leaves
    // two, enough for the woods at the corner; Smoke in the next hex, or a DC Placed there (two MF each), leaves one.
    const terrain: Record<string, HexTerrainSpec> = { uR3: { terrain: 'building-wood' } };
    for (const h of ['uQ3', 'uR2', 'uS3', 'uS4', 'uR4']) terrain[h] = { terrain: 'woods' };
    const dc: PieceSpec = { id: 'dc', def: 'ge.DC', side: 'ge', heldBy: 'g' };
    const { engine, state } = game([squad(), dc, far], { terrain });
    const s = step(engine, start(engine, state), { to: 'uR3', bypass: ['uR4'] });
    expect(ms(engine, s).spent['g']).toBe(1);
    expect(check(engine, s, { type: 'move.smoke', unit: 'g', target: 'uR4' })).toMatch(/A4.32/);
    expect(check(engine, s, { type: 'move.placeDc', dc: 'dc', target: 'uR4' })).toMatch(/A4.32/);
    expect(check(engine, s, { type: 'move.smoke', unit: 'g', target: 'uR3' })).toBeNull();
    // With open ground at the corners (one MF) the same Smoke, or the same DC, leaves enough to step out: Bypass does
    // not prevent either (A4.3).
    const { engine: e2, state: s2 } = game([squad(), dc, far]);
    const b2 = step(e2, start(e2, s2), { to: 'uR3', bypass: ['uR4'] });
    expect(check(e2, b2, { type: 'move.smoke', unit: 'g', target: 'uR4' })).toBeNull();
    expect(check(e2, b2, { type: 'move.placeDc', dc: 'dc', target: 'uR4' })).toBeNull();
    const placed = pass(e2, act(e2, b2, { type: 'move.placeDc', dc: 'dc', target: 'uR4' }).state);
    expect(ms(e2, placed).bypass?.hex).toBe('uR3');
    expect(ms(e2, placed).spent['g']).toBe(2);
  });

  it('Assault Movement: a last MF spent within the Location is allowed and ends Assault Movement (A4.61 EXC); the Starter Kit refuses it', () => {
    const into = (asl: boolean) => {
      const { engine, state } = game([squad(), far], { asl, dice: [1, ...new Array(20).fill(3)] });
      return { engine, s: step(engine, start(engine, state, ['g'], { assault: true }), { to: 'uR3' }) };
    };
    const { engine, s } = into(true);
    expect(ms(engine, s).spent['g']).toBe(2);
    expect(ms(engine, s).assault).toBe(true);
    expect(check(engine, s, { type: 'move.smoke', unit: 'g', target: 'uR4' })).toBeNull();
    const after = pass(engine, act(engine, s, { type: 'move.smoke', unit: 'g', target: 'uR4' }).state);
    expect(ms(engine, after)?.assault ?? false).toBe(false);
    const sk = into(false);
    expect(check(sk.engine, sk.s, { type: 'move.smoke', unit: 'g', target: 'uR4' })).toMatch(/Assault Movement may not use all MF/);
  });

  it('Assault Movement: Bypass and then the obstacle of the same hex is one Location; out to another hex is a second', () => {
    const { engine, state } = game([squad(), far]);
    const s = step(engine, start(engine, state, ['g'], { assault: true }), { to: 'uR3', bypass: ['uR4'] });
    expect(check(engine, s, { type: 'move.step', to: 'uR3' })).toBeNull();
    expect(check(engine, s, { type: 'move.step', to: 'uR4' })).toMatch(/Assault Movement/);
  });

  it('Assault Movement: entering the obstacle from Bypass may use the last MF, which ends Assault Movement (A4.61 EXC)', () => {
    // A 4-6-7 portaging a MMG (4 PP, IPC 3) has 3 MF: one for the Bypass, the building's two for the obstacle.
    const { engine, state } = game([squad(), { id: 'mmg', def: 'ge.MMG', side: 'ge', heldBy: 'g' }, far]);
    let s = start(engine, state, ['g'], { assault: true });
    expect(check(engine, s, { type: 'move.step', to: 'uR3', bypass: ['uR4'] })).toBeNull();
    s = step(engine, s, { to: 'uR3', bypass: ['uR4'] });
    expect(check(engine, s, { type: 'move.step', to: 'uR3' })).toBeNull();
    s = step(engine, s, { to: 'uR3' });
    expect(ms(engine, s)?.spent['g']).toBe(3);
    expect(ms(engine, s)?.assault ?? false).toBe(false);
  });

  it('no stacking cap into or out of Bypass, but the overstacking MF (A5.1, A5.11), and no SW Recovery there (A4.44)', () => {
    const inside = ['a', 'b', 'c'].map((id): PieceSpec => ({ id, def: 'ge.447', side: 'ge', hex: 'uR3' }));
    const { engine, state } = game([squad(), ...inside, far]);
    const s = start(engine, state);
    // Into the obstacle: the building's MF and one more for the fourth squad.
    expect(check(engine, s, { type: 'move.step', to: 'uR3' })).toBeNull();
    // Into Bypass of it: the stack is in that Location, overstacking it by one (one MF for the hexside, one for that).
    const b = step(engine, s, { to: 'uR3', bypass: ['uR4'] });
    expect(ms(engine, b).bypass).toBeDefined();
    expect(ms(engine, b).spent['g']).toBe(2);
    expect(check(engine, b, { type: 'move.recover', unit: 'g', sw: 'x' })).toMatch(/A4.44/);
  });

  it('gains no Control in Bypass (A26.11), and does once in the obstacle', () => {
    const { engine, state } = game([squad(), far]);
    const b = step(engine, start(engine, state), { to: 'uR3', bypass: ['uR4'] });
    expect(controlState(engine.env(b)).hexes['uR3']).not.toBe('ge');
    const inside = step(engine, b, { to: 'uR3' });
    expect(controlState(engine.env(inside)).hexes['uR3']).toBe('ge');
  });

  it('cannot bypass a hex containing rubble at any level, level 1 of a standing house included (A4.3, B24.4)', () => {
    const { engine, state } = game([squad(), far]);
    const s = start(engine, state);
    expect(check(engine, s, { type: 'move.step', to: 'uR3', bypass: ['uR4'] })).toBeNull();
    const rubbled = { ...s, ext: { ...s.ext, 'asl.rubble': { uR3: { from: 1, kind: 'wood' } } } };
    expect(check(engine, rubbled, { type: 'move.step', to: 'uR3', bypass: ['uR4'] })).toMatch(/rubble/);
    expect(engine.legalActions(rubbled, 'ge').some((a) => a['bypass'] && a['to'] === 'uR3')).toBe(false);
  });

  it('cannot bypass a hex containing Wire, nor along a hexside of a hex containing Wire (A4.3, B26.44)', () => {
    const { engine, state } = game([squad(), far]);
    const s = start(engine, state);
    const wire = (hex: string, hidden: boolean) => ({ ...s, ext: { ...s.ext, 'asl.fortifications': { counters: [{ id: 'ru.fort1', side: 'ru', kind: 'wire', hex, hidden }] } } });
    const inHex = wire('uR3', false);
    expect(check(engine, inHex, { type: 'move.step', to: 'uR3', bypass: ['uR4'] })).toMatch(/Wire/);
    expect(engine.legalActions(inHex, 'ge').some((a) => a['bypass'] && a['to'] === 'uR3')).toBe(false);
    const next = wire('uS4', false);
    expect(check(engine, next, { type: 'move.step', to: 'uR3', bypass: ['uR4'] })).toBeNull();
    expect(check(engine, next, { type: 'move.step', to: 'uR3', bypass: ['uR4', 'uS4'] })).toMatch(/uS4 contains Wire/);
    const offered = engine.legalActions(next, 'ge').filter((a) => a['bypass'] && a['to'] === 'uR3').map((a) => (a['bypass'] as string[]).join('-'));
    expect(offered).toContain('uR4');
    expect(offered.some((v) => v.includes('uS4'))).toBe(false);
  });

  it('hidden Wire bars Bypass too: legality cannot see it, the attempt reveals it and is refused with nothing spent (B26.44; Q&A [K33] to A12.33)', () => {
    const { engine, state } = game([squad(), far]);
    const s = start(engine, state);
    const wire = (hex: string) => ({ ...s, ext: { ...s.ext, 'asl.fortifications': { counters: [{ id: 'ru.fort1', side: 'ru', kind: 'wire', hex, hidden: true }] } } });
    for (const [hex, via] of [['uS4', ['uR4', 'uS4']], ['uR3', ['uR4']]] as const) {
      const h = wire(hex);
      // The mover's view holds no counter, so nothing is refused up front ...
      expect(check(engine, h, { type: 'move.step', to: 'uR3', bypass: via })).toBeNull();
      // ... the attempt finds the Wire: revealed, no Bypass, no MF spent, the stack still in its hex and moving.
      const r = act(engine, h, { type: 'move.step', to: 'uR3', bypass: via });
      expect(r.events.find((e) => e.type === 'asl.bypass.wireRefused')?.payload).toMatchObject({ hex: 'uR3', wire: [hex] });
      const c = (r.state.ext['asl.fortifications'] as { counters: { revealed?: boolean }[] }).counters[0]!;
      expect(c.revealed).toBe(true);
      const m = ms(engine, r.state);
      expect(m.bypass).toBeUndefined();
      expect(m.hex).toBe('uQ4');
      expect(m.spent['g'] ?? 0).toBe(0);
      expect(engine.currentDecision(r.state)!.owner).toBe('ge');
      // Now known: refused up front, and the stack may still move on normally.
      expect(check(engine, r.state, { type: 'move.step', to: 'uR3', bypass: via })).toMatch(/Wire/);
      expect(check(engine, r.state, { type: 'move.step', to: 'uP4' })).toBeNull();
    }
  });

  it('only in the MPh: no Bypass is offered to an advance (A4.7), which enters the obstacle itself, nor to a rout (A10.5)', () => {
    const { engine, state } = game([squad(), far], { startPhase: 'APh' });
    const legal = engine.legalActions(state, 'ge');
    expect(legal.some((a) => a.type === 'advance' && a['to'] === 'uR3')).toBe(true);
    expect(legal.some((a) => a['bypass'])).toBe(false);
    const s = act(engine, state, { type: 'advance', units: ['g'], to: 'uR3', bypass: ['uR4'] }).state;
    expect(s.pieces['g']!.loc).toEqual({ kind: 'hex', hex: 'uR3' });
    expect(moveState(engine.env(s))).toBeFalsy();
    // A broken squad routing from Q4 (a Russian squad adjacent in P4) is offered no Bypass either.
    const r = game([{ ...squad(), tags: { broken: true } }, { id: 'adj', def: 'ru.447', side: 'ru', hex: 'uP4' }], { startPhase: 'RtPh' });
    const routs = r.engine.legalActions(r.state, 'ge').filter((a) => a.type.startsWith('rout'));
    expect(routs.length).toBeGreaterThan(0);
    expect(routs.some((a) => a['bypass'])).toBe(false);
  });

  it('cannot bypass an obstacle holding a Known enemy unit (A4.3)', () => {
    const { engine, state } = game([squad(), { id: 'r', def: 'ru.447', side: 'ru', hex: 'uR3' }]);
    expect(check(engine, start(engine, state), { type: 'move.step', to: 'uR3', bypass: ['uR4'] })).toMatch(/Known enemy/);
  });

  it('a Known enemy unit only on a level above does not bar the Bypass (A4.3; Q&A [K33])', () => {
    const terrain: Record<string, HexTerrainSpec> = { uR3: { terrain: 'building-wood', building: { upper: 1, stairwell: 'inherent' }, obstacleHeight: 1.5 } };
    const { engine, state } = game([squad(), { id: 'r', def: 'ru.447', side: 'ru', hex: 'uR3', level: 1 }, far], { terrain });
    expect(check(engine, start(engine, state), { type: 'move.step', to: 'uR3', bypass: ['uR4'] })).toBeNull();
  });
});

describe('Leaving the map by Bypass (ASLRB A2.6)', () => {
  // The A2.6 EX on board u: a squad in X1 bypasses the woods half-hex X0 along X0-W1 to the X0-W1-W0 vertex (W0 is off the
  // map) and exits there through the mirror image of W1, with one MF in excess of the Bypass.
  const edgeGame = (pieces: PieceSpec[]) =>
    makeEngine({ board: 'u', terrain: { uX0: { terrain: 'woods', bypassBlocked: [] } }, scenario: { ...RU_VS_GE, firstSide: 'ge', exits: [{ side: 'ge', edge: 'N' }] }, modules: ASL, startPhase: 'MPh', pieces });
  it('from a corner on the map edge the stack may step off the map, if it still has the MF to exit', () => {
    const { engine, state } = edgeGame([squad('g', 'uX1'), far]);
    let s = step(engine, start(engine, state), { to: 'uX0', bypass: ['uW1'] });
    const m = ms(engine, s);
    expect(m.bypass?.hex).toBe('uX0');
    const off = engine.legalActions(s, 'ge').filter((a) => a.type === 'move.step' && !a['bypass'] && !statics(engine.env(s)).map.hex(a['to'] as string));
    expect(off.length).toBe(1);
    const t = act(engine, s, off[0] as never);
    expect(t.state.pieces['g']!.loc.kind).toBe('offboard');
  });

  it('a Bypass to that corner is refused without the MF to exit as well (A2.6: one MF in excess of the Bypass)', () => {
    // A 4-6-7 with a MMG (4 PP, IPC 3) has 3 MF: after X1 to the corner of X0 (the Bypass, 1 MF) it can still exit (1 MF).
    const { engine, state } = edgeGame([squad('g', 'uX1'), { id: 'mmg', def: 'ge.MMG', side: 'ge', heldBy: 'g' }, far]);
    const s = start(engine, state);
    expect(check(engine, s, { type: 'move.step', to: 'uX0', bypass: ['uW1'] })).toBeNull();
    // With only the Bypass MF left (2 spent elsewhere first) it could neither exit nor enter the woods: refused.
    const spent = { ...s, ext: { ...s.ext, 'sk1.move': { ...ms(engine, s), spent: { g: 2 } } } };
    expect(check(engine, spent, { type: 'move.step', to: 'uX0', bypass: ['uW1'] })).toMatch(/could not end its move outside Bypass/);
  });
});

describe('Bypass along a hexside on the map edge (ASLRB A4.3, A2.2)', () => {
  // Board u: O1 is a whole hex whose north hexside is the map edge (there is no O0); P0 and the woods N0 either side of
  // it are half hexes. A squad in P0 goes along that hexside to the O1-N0 vertex and on into N0.
  const edgeGame = (pieces: PieceSpec[], dice?: number[]) =>
    game(pieces, { terrain: { uO1: { terrain: 'building-wood', bypassBlocked: [] }, uN0: { terrain: 'woods', bypassBlocked: [] } }, ...(dice ? { dice } : {}) });

  it('a hexside of a whole hex along the map edge is offered and gone along like any other, named by the offboard hex beyond it', () => {
    const { engine, state } = edgeGame([squad('g', 'uP0'), far]);
    const map = statics(engine.env(state)).map;
    expect(map.hex('uO0')).toBeUndefined();
    expect(map.offboardHex('uO0')).toBeDefined();
    let s = start(engine, state);
    const offered = engine.legalActions(s, 'ge').filter((a) => a.type === 'move.step' && a['to'] === 'uO1' && a['bypass']);
    expect(offered.map((a) => (a['bypass'] as string[]).join(','))).toContain('uO0');
    s = step(engine, s, { to: 'uO1', bypass: ['uO0'] });
    const m = ms(engine, s);
    expect(m.bypass).toMatchObject({ hex: 'uO1', sides: [sideToward(map, 'uO1', 'uO0')] });
    // One hexside: one MF (A4.31). From the O1-N0 vertex on the edge the stack may enter N0 or the building.
    expect(m.spent['g']).toBe(1);
    expect(check(engine, s, { type: 'move.step', to: 'uN0' })).toBeNull();
    expect(check(engine, s, { type: 'move.step', to: 'uP0' })).toMatch(/may enter/);
    s = step(engine, s, { to: 'uN0' });
    expect(ms(engine, s).bypass).toBeUndefined();
    s = act(engine, s, { type: 'move.end' }).state;
    expect(s.pieces['g']!.loc).toMatchObject({ kind: 'hex', hex: 'uN0' });
  });

  it('the part of a half hex beyond the map edge is not on the map: no Bypass round it, offered or named', () => {
    const { engine, state } = edgeGame([squad('g', 'uM1'), far]);
    const env = engine.env(state);
    const map = statics(env).map;
    const s = start(engine, state);
    const beyond = map.offboard('N,E,S,W').map((o) => o.id).filter((o) => sideToward(map, 'uN0', o) !== null);
    expect(beyond.length).toBeGreaterThan(0);
    const offered = engine.legalActions(s, 'ge').filter((a) => a.type === 'move.step' && a['to'] === 'uN0' && a['bypass']);
    expect(offered.length).toBeGreaterThan(0);
    for (const a of offered) for (const nb of a['bypass'] as string[]) expect(map.hex(nb), nb).toBeDefined();
    for (const o of beyond) expect(check(engine, s, { type: 'move.step', to: 'uN0', bypass: [o] })).toMatch(/half hex/);
  });

  it('a stack that went along the edge hexside is fired on at a corner of it, named with the offboard hex (A4.34)', () => {
    const { engine, state } = edgeGame([squad('g', 'uP0'), { id: 'r', def: 'ru.447', side: 'ru', hex: 'uP1' }], [5, 4]);
    const s = act(engine, start(engine, state), { type: 'move.step', to: 'uO1', bypass: ['uO0'] }).state;
    const map = statics(engine.env(s)).map;
    expect(engine.currentDecision(s)!.owner).toBe('ru');
    const corners = bypassCorners(engine.env(s), 'uO1');
    expect(corners).toContainEqual(['uN0', 'uO0']);
    expect(corners).toContainEqual(['uO0', 'uP0']);
    expect(cornerBetween(map, 'uO1', 'uN0', 'uO0')).toBe(ms(engine, s).bypass!.at);
    const at = { uP1: ['uO0', 'uP0'] };
    const r = act(engine, s, { type: 'defFire', decl: { units: ['r'], sw: [], target: 'uO1', at } });
    const ev = r.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { attack: { at?: unknown } };
    expect(ev.attack.at).toEqual(at);
  });
});

describe('Defensive First Fire at a stack in Bypass (ASLRB A4.34, B23.31, A8.2)', () => {
  const labels = (events: { type: string; payload: unknown }[]) =>
    ((events.find((e) => e.type === 'sk1.fire.attack')?.payload as { explain: { label?: string }[] } | undefined)?.explain ?? []).map((n) => n.label ?? '');
  const bypassed = (pieces: PieceSpec[], dice: number[]) => {
    const { engine, state } = game([squad(), ...pieces], { dice });
    const s = act(engine, start(engine, state), { type: 'move.step', to: 'uR3', bypass: ['uR4', 'uS4'] }).state;
    return { engine, s, map: statics(engine.env(s)).map };
  };

  it('fired at a corner: no building TEM, FFNAM and FFMO; the point is recorded with the shot', () => {
    const { engine, s, map } = bypassed([{ id: 'r', def: 'ru.447', side: 'ru', hex: 'uR5' }], [5, 4]);
    expect(engine.currentDecision(s)!.owner).toBe('ru');
    const at = { uR5: ['uR4', 'uS4'] };
    expect(cornerBetween(map, 'uR3', 'uR4', 'uS4')).not.toBeNull();
    const r = act(engine, s, { type: 'defFire', decl: { units: ['r'], sw: [], target: 'uR3', at } });
    const ev = r.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { attack: { at?: unknown } };
    expect(ev.attack.at).toEqual(at);
    const l = labels(r.events);
    expect(l).toContain('-1 FFNAM');
    expect(l).toContain('-1 FFMO: in Bypass, in the open');
    expect(l.some((x) => /TEM \(/.test(x))).toBe(false);
  });

  it('Height Advantage in Bypass on a hill, but not against a unit that crossed the Crest Line through the hexside the LOS crosses (B10.31)', () => {
    // R3 is a building on a level 1 hill; the stack comes up from Q4 (level 0) and bypasses it.
    const terrain: Record<string, HexTerrainSpec> = { uR3: { terrain: 'building-wood', elevation: 1 } };
    const { engine, state } = game([squad(), far, { id: 'r1', def: 'ru.447', side: 'ru', hex: 'uY10' }], { terrain });
    const s = step(engine, start(engine, state), { to: 'uR3', bypass: ['uR4', 'uS4'] });
    const env = engine.env(s);
    const ring = ['uO3', 'uO4', 'uO5', 'uP3', 'uP4', 'uP5', 'uP6', 'uQ6', 'uR6', 'uS6', 'uT4', 'uT5', 'uR1', 'uS1'];
    const across = ring.find((h) => entryHexside(env, 'uR3', h) === 'uQ4')!;
    const other = ring.find((h) => entryHexside(env, 'uR3', h) !== 'uQ4')!;
    expect(across && other).toBeTruthy();
    const at = (hex: string) => ({ ...s, pieces: { ...s.pieces, r1: { ...s.pieces['r1']!, loc: { kind: 'hex' as const, hex } } } });
    const attack = { target: 'uR3', parts: [{ firer: 'r1', piece: 'r1' }], moving: { from: 'uQ4' } } as never;
    expect(heightAdvantageInBypass(engine.env(at(other)), attack)).toBe(true);
    expect(heightAdvantageInBypass(engine.env(at(across)), attack)).toBe(false);
  });

  it('no Height Advantage in Bypass for a unit taking a CE DRM (B10.31 "or CE DRM"): the predicate per target unit', () => {
    // Only Infantry Bypass here (vehicle Bypass is Chapter D), so the CE crew is checked against the same attack directly.
    const terrain: Record<string, HexTerrainSpec> = { uR3: { terrain: 'building-wood', elevation: 1 } };
    const tank: PieceSpec = { id: 't', def: 'ru.T34M43', side: 'ru', hex: 'uY9', tags: { ce: true } };
    const { engine, state } = game([squad(), far, tank, { id: 'r1', def: 'ru.447', side: 'ru', hex: 'uR5' }], { terrain });
    const s = step(engine, start(engine, state), { to: 'uR3', bypass: ['uR4', 'uS4'] });
    const env = engine.env(s);
    const attack = { target: 'uR3', targets: ['g'], parts: [{ firer: 'r1', piece: 'r1' }], moving: { from: 'uQ4' } } as never;
    expect(heightAdvantageInBypass(env, attack)).toBe(true);
    expect(heightAdvantageInBypassFor(env, attack, 'g')).toBe(true);
    expect(heightAdvantageInBypassFor(env, attack, 't')).toBe(false);
    const buttoned = { ...s, pieces: { ...s.pieces, t: { ...s.pieces['t']!, tags: {} } } };
    expect(heightAdvantageInBypassFor(engine.env(buttoned), attack, 't')).toBe(true);
  });

  it('Indirect Fire keeps the woods Air Burst against a stack in Bypass of the woods: -1, no FFMO (B13.3, A4.34)', () => {
    // A German 50mm mortar in R6 (range 3) fires at a Russian squad going round the woods in R3 on the Area Target Type.
    const terrain: Record<string, HexTerrainSpec> = { uR3: { terrain: 'woods', bypassBlocked: [] } };
    const pieces: PieceSpec[] = [{ id: 'r', def: 'ru.447', side: 'ru', hex: 'uQ4' }, { id: 'm', def: 'ge.467', side: 'ge', hex: 'uR6' }, { id: 'mtr', def: 'ge.MTR', side: 'ge', heldBy: 'm' }];
    const { engine, state } = makeEngine({ board: 'u', terrain, scenario: { ...RU_VS_GE, firstSide: 'ru' }, modules: ASL, startPhase: 'MPh', pieces, dice: [2, 2, 6, 6, 6, 6, 6, 6] });
    const s = act(engine, act(engine, state, { type: 'move.start', units: ['r'] }).state, { type: 'move.step', to: 'uR3', bypass: ['uR4', 'uS4'] }).state;
    const shot = engine.legalActions(s, 'ge').find((a) => a.type === 'defFire.ordnance' && (a['shot'] as { weapon: string; targetType: string }).weapon === 'mtr' && (a['shot'] as { targetType: string }).targetType === 'ATT');
    expect(shot).toBeDefined();
    const r = act(engine, s, shot as never);
    const l = labels(r.events);
    expect(l).toContain('-1 Air Burst (woods)');
    expect(l).not.toContain('-1 FFMO: in Bypass, in the open');
    // Small Arms at the same stack: no woods TEM, FFMO (Direct Fire).
    const g2 = game([squad(), { id: 'r', def: 'ru.447', side: 'ru', hex: 'uR5' }], { terrain, dice: [5, 4] });
    const s2 = act(g2.engine, start(g2.engine, g2.state), { type: 'move.step', to: 'uR3', bypass: ['uR4', 'uS4'] }).state;
    const l2 = labels(act(g2.engine, s2, { type: 'defFire', decl: { units: ['r'], sw: [], target: 'uR3', at: { uR5: ['uR4', 'uS4'] } } }).events);
    expect(l2).toContain('-1 FFMO: in Bypass, in the open');
    expect(l2.some((x) => /Air Burst|TEM \(/.test(x))).toBe(false);
  });

  it('only corners of hexsides the targets went along may be chosen', () => {
    const { engine, s } = bypassed([{ id: 'r', def: 'ru.447', side: 'ru', hex: 'uR5' }], [5, 4]);
    const bad = engine.validate(s, { side: 'ru', decisionId: engine.currentDecision(s)!.id, type: 'defFire', decl: { units: ['r'], sw: [], target: 'uR3', at: { uR5: ['uQ3', 'uR2'] } } } as never);
    expect(bad).toMatch(/A4.34/);
  });

  it('at the hex centre the LOS must cross a bypassed hexside; one that does not has still fired (A4.34, A6.11)', () => {
    // From P2 the line to R3's centre comes in through its R3-Q3 side, not one the stack went along.
    const { engine, s } = bypassed([{ id: 'r', def: 'ru.447', side: 'ru', hex: 'uP2' }], [5, 4]);
    const r = act(engine, s, { type: 'defFire', decl: { units: ['r'], sw: [], target: 'uR3' } });
    expect(r.events.some((e) => e.type === 'sk1.fire.noLos')).toBe(true);
    expect(r.events.some((e) => e.type === 'sk1.fire.attack')).toBe(false);
    // From R5 the line comes in through R3-R4: the centre is open.
    const { engine: e2, s: s2 } = bypassed([{ id: 'r', def: 'ru.447', side: 'ru', hex: 'uR5' }], [5, 4]);
    const r2 = act(e2, s2, { type: 'defFire', decl: { units: ['r'], sw: [], target: 'uR3' } });
    expect(r2.events.some((e) => e.type === 'sk1.fire.attack')).toBe(true);
  });

  it('each firing hex of a Fire Group chooses its own point; one whose point is out of LOS drops out', () => {
    // P4 picks the far corner R3-S3-S4: its line crosses the building in R3. P5 picks R3-R4-Q4, in the open.
    const { engine, s } = bypassed(
      [
        { id: 'r1', def: 'ru.447', side: 'ru', hex: 'uP4' },
        { id: 'r2', def: 'ru.447', side: 'ru', hex: 'uP5' },
      ],
      [5, 4],
    );
    const at = { uP4: ['uS3', 'uS4'], uP5: ['uQ4', 'uR4'] };
    const r = act(engine, s, { type: 'defFire', decl: { units: ['r1', 'r2'], sw: [], target: 'uR3', at } });
    const noLos = r.events.find((e) => e.type === 'sk1.fire.noLos')!.payload as { from: string[]; attack: { parts: string[] } };
    expect(noLos.from).toEqual(['uP4']);
    expect(noLos.attack.parts).toEqual(['r1']);
    const attack = r.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { attack: { parts: string[]; at: unknown } };
    expect(attack.attack.parts).toEqual(['r2']);
    expect(attack.attack.at).toEqual(at);
  });

  it('Residual FP left by fire at the Bypass attacks it again with the building TEM (A8.2, note 12)', () => {
    // 2 FP at range 2 leaves 1 Residual FP; the stack goes on round R3 (a third hexside, one MF) and meets it.
    const { engine, s } = bypassed([{ id: 'r', def: 'ru.447', side: 'ru', hex: 'uR5' }], [6, 6, 6, 6, 6, 6]);
    let x = act(engine, s, { type: 'defFire', decl: { units: ['r'], sw: [], target: 'uR3', at: { uR5: ['uR4', 'uS4'] } } }).state;
    x = pass(engine, x);
    expect(x.hexMarkers['uR3']?.['residualFp']).toBeGreaterThan(0);
    const r = act(engine, x, { type: 'move.step', to: 'uR3', bypass: ['uS3'] });
    expect(labels(r.events).some((l) => /\+2 TEM/.test(l))).toBe(true);
  });
});

describe('The second target point of A4.132: where the hexside crossed meets the road', () => {
  // Board y: a German squad comes up the road M3-M4; M4 is a Woods-Road hex; a Russian squad in M7 fires at it there.
  const terrain: Record<string, HexTerrainSpec> = { yM4: { terrain: 'woods', features: ['road:dirt', 'woods-road'] } };
  const roads: [string, string][] = [
    ['yM3', 'yM4'],
    ['yM4', 'yM5'],
  ];
  const labelsOf = (events: { type: string; payload: unknown }[]) =>
    ((events.find((e) => e.type === 'sk1.fire.attack')?.payload as { explain: { label?: string }[] } | undefined)?.explain ?? []).map((n) => n.label ?? '');
  const shoot = (asl: boolean) => {
    const { engine, state } = makeEngine({
      board: 'y',
      terrain,
      roadHexsides: roads,
      scenario: { ...RU_VS_GE, firstSide: 'ge' },
      modules: asl ? ASL : SK,
      startPhase: 'MPh',
      dice: [4, 3],
      pieces: [squad('g', 'yM3'), { id: 'r', def: 'ru.447', side: 'ru', hex: 'yM7' }],
    });
    // The thread to the centre crosses the woods symbol in M4; the one to the road point at M4-M3 does not (the pixel
    // LOS reports `woods`; the test grid does not, so it is given here).
    const map = statics(engine.env(state)).map as unknown as Record<string, (...a: unknown[]) => { woods?: string[] }>;
    for (const name of ['los', 'losAt']) {
      const orig = map[name]!.bind(map);
      map[name] = (a: unknown, b: unknown) => {
        const r = orig(a, b);
        const point = typeof a === 'object' && ((a as { side?: number }).side !== undefined || (b as { side?: number }).side !== undefined);
        return point ? r : { ...r, woods: ['yM4'] };
      };
    }
    let s = start(engine, state);
    s = act(engine, s, { type: 'move.step', to: 'yM4' }).state;
    return labelsOf(act(engine, s, { type: 'defFire', decl: { units: ['r'], sw: [], target: 'yM4' } }).events);
  };

  it('full ASL: the road point is clear of the woods, so the unit on the road is subject to FFMO; the Starter Kit: centre only', () => {
    expect(shoot(true)).toContain('-1 FFMO');
    expect(shoot(false)).not.toContain('-1 FFMO');
  });
});

describe('Broken or pinned in Bypass; hidden Guns; Guns (Q7, Q10, Q15)', () => {
  it('a unit broken in Bypass stays a target there after its stack moves on, until the end of its MPh, and the hidden squad in the obstacle is revealed only then (A4.32, A4.33)', () => {
    // r (R5) fires at the R3-R4-S4 corner: 4 FP, -1 FFNAM -1 FFMO, DR 7 - 2 = 5: a NMC; g fails (11) and breaks, g2 passes (2).
    // g2 goes on to S4; r2 (R5, not yet fired) then fires at the broken g left in Bypass of R3.
    const { engine, state } = game(
      [squad('g'), squad('g2'), { id: 'r', def: 'ru.447', side: 'ru', hex: 'uR5' }, { id: 'r2', def: 'ru.447', side: 'ru', hex: 'uR5' }, { id: 'h', def: 'ru.447', side: 'ru', hex: 'uR3', tags: { hip: true } }],
      { dice: [3, 4, 6, 5, 1, 1, 6, 6, 6, 6] },
    );
    let s = act(engine, start(engine, state, ['g', 'g2']), { type: 'move.step', to: 'uR3', bypass: ['uR4', 'uS4'] }).state;
    s = act(engine, s, { type: 'defFire', decl: { units: ['r'], sw: [], target: 'uR3', at: { uR5: ['uR4', 'uS4'] } } }).state;
    expect(s.pieces['g']!.tags['broken']).toBe(true);
    expect(s.pieces['g2']!.tags['broken']).toBeUndefined();
    s = pass(engine, s);
    const exit = engine.legalActions(s, 'ge').find((a) => a.type === 'move.step' && !a['bypass'] && a['to'] !== 'uR3');
    expect(exit).toBeDefined();
    s = act(engine, s, exit as never).state;
    expect(ms(engine, s).leftBypass?.map((r) => r.hex)).toEqual(['uR3']);
    // The DEFENDER is offered fire at g there, traced to a corner it went along, with FFNAM and FFMO.
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'firstFire', owner: 'ru' });
    const atLeft = { type: 'defFire', decl: { units: ['r2'], sw: [], target: 'uR3', at: { uR5: ['uR4', 'uS4'] } } };
    expect(engine.legalActions(s, 'ru').some((a) => a.type === 'defFire' && (a['decl'] as { target: string }).target === 'uR3')).toBe(true);
    expect(check2(engine, s, atLeft)).toBeNull();
    // r has already fired at R3 as often as MF were spent there.
    expect(check2(engine, s, { type: 'defFire', decl: { units: ['r'], sw: [], target: 'uR3', at: { uR5: ['uR4', 'uS4'] } } })).toMatch(/cannot fire again/);
    const r = act(engine, s, atLeft);
    const attack = r.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { explain: { label?: string }[] };
    expect(attack.explain.map((n) => n.label)).toEqual(expect.arrayContaining(['-1 FFNAM', '-1 FFMO: in Bypass, in the open']));
    s = r.state;
    expect(s.pieces['h']!.tags['hip']).toBe(true);
    // The stack's MPh ends: the hidden squad in R3 is found, the record goes with the move.
    s = pass(engine, s);
    s = pass(engine, act(engine, s, { type: 'move.end' }).state);
    expect(moveState(engine.env(s))).toBeFalsy();
    expect(s.pieces['h']!.tags['hip']).toBeUndefined();
    expect(s.pieces['g']!.loc).toEqual({ kind: 'hex', hex: 'uR3' });
  });

  it('a unit left broken in Bypass may be shot at by a Gun or a Panzerfaust too; a stack coming back into the hex is attacked with it (A4.32, A4.33)', () => {
    // Russians r1 and r2 bypass R3 round the R3-R4-S4 corner; the German squad g in R5 breaks r1 (NMC 7-2: r1 rolls 11, r2 2).
    // r2 goes on; a German AT Gun in R5 and a Panzerfaust in R4 may then fire at r1 left in Bypass of R3.
    const ru = (id: string): PieceSpec => ({ id, def: 'ru.447', side: 'ru', hex: 'uQ4' });
    const pieces: PieceSpec[] = [
      ru('r1'),
      ru('r2'),
      { id: 'g', def: 'ge.467', side: 'ge', hex: 'uR5' },
      { id: 'c', def: 'ge.228c', side: 'ge', hex: 'uR5' },
      { id: 'at', def: 'ge.AT75L', side: 'ge', heldBy: 'c' },
      { id: 'p', def: 'ge.467', side: 'ge', hex: 'uR4' },
      { id: 'pf', def: 'ge.PF', side: 'ge', heldBy: 'p' },
      { id: 'gfar', def: 'ge.467', side: 'ge', hex: 'uY10' },
    ];
    const { engine, state } = makeEngine({ board: 'u', terrain: BUILDING, scenario: { ...RU_VS_GE, firstSide: 'ru' }, modules: ASL, startPhase: 'MPh', pieces, dice: [3, 4, 6, 5, 1, 1, 2, 2, 6, 6, 6, 6] });
    const passGe = (x: GameState) => {
      let y = x;
      while (engine.currentDecision(y)?.owner === 'ge') y = act(engine, y, { type: 'defPass' }).state;
      return y;
    };
    let s = act(engine, act(engine, state, { type: 'move.start', units: ['r1', 'r2'] }).state, { type: 'move.step', to: 'uR3', bypass: ['uR4', 'uS4'] }).state;
    s = act(engine, s, { type: 'defFire', decl: { units: ['g'], sw: [], target: 'uR3', at: { uR5: ['uR4', 'uS4'] } } }).state;
    expect(s.pieces['r1']!.tags['broken']).toBe(true);
    s = passGe(s);
    s = act(engine, s, { type: 'move.step', to: 'uS4' }).state;
    expect(ms(engine, s).leftBypass?.map((r) => r.hex)).toEqual(['uR3']);
    const offered = engine.legalActions(s, 'ge');
    const shotAt = (weapon: string) => offered.find((a) => a.type === 'defFire.ordnance' && (a['shot'] as { target: string; weapon: string }).target === 'uR3' && (a['shot'] as { weapon: string }).weapon === weapon);
    const gunShot = shotAt('at');
    const pfShot = shotAt('pf');
    expect(gunShot).toBeDefined();
        expect(pfShot).toBeDefined();
    const fired = act(engine, s, gunShot as never);
    expect((fired.events.find((e) => e.type === 'sk2.ordnance.shot')!.payload as { targets: string[] }).targets).toEqual(['r1']);
    // Back into R3 (its building, 2 MF): r2 is attacked there together with r1, still in the open part of the hex.
    let back = passGe(s);
    back = act(engine, back, { type: 'move.step', to: 'uR3' }).state;
    expect(firstFireTargets(engine.env(back), ms(engine, back)).sort()).toEqual(['r1', 'r2']);
  });

  it('units pinned in Bypass stay there for the rest of the MPh: fired on again without TEM, no FFMO while pinned (A4.33)', () => {
    // 4 FP from R5 at the two squads in Bypass, DRM -2: an 8 is a PTC; both fail their NTC (12s) and are pinned.
    const { engine, state } = game([squad('g'), { id: 'g2', def: 'ge.447', side: 'ge', hex: 'uQ4' }, { id: 'r', def: 'ru.447', side: 'ru', hex: 'uR5' }, { id: 'r2', def: 'ru.447', side: 'ru', hex: 'uR4' }], {
      dice: [4, 4, 6, 6, 6, 6, 5, 5],
    });
    let s = act(engine, start(engine, state, ['g', 'g2']), { type: 'move.step', to: 'uR3', bypass: ['uR4', 'uS4'] }).state;
    s = act(engine, s, { type: 'defFire', decl: { units: ['r'], sw: [], target: 'uR3', at: { uR5: ['uR4', 'uS4'] } } }).state;
    const m = ms(engine, s);
    expect(Object.keys(m.stoppedBypass ?? {}).sort()).toEqual(['g', 'g2']);
    expect(engine.currentDecision(s)!.owner).toBe('ru');
    const r = act(engine, s, { type: 'defFire', decl: { units: ['r2'], sw: [], target: 'uR3', at: { uR4: ['uR4', 'uS4'] } } });
    const l = ((r.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { explain: { label?: string }[] }).explain ?? []).map((n) => n.label ?? '');
    expect(l.some((x) => /TEM \(/.test(x))).toBe(false);
    expect(l).not.toContain('-1 FFMO: in Bypass, in the open');
  });

  it('a hidden Gun in the obstacle stays hidden while a stack bypasses it (A12.151; Q10), but is found on entering', () => {
    const { engine, state } = makeEngine({
      board: 'u',
      terrain: BUILDING,
      scenario: { firstSide: 'ge', sides: [{ side: 'ge', name: 'German', nationality: 'ge', elr: 3 }, { side: 'br', name: 'British', nationality: 'br', elr: 3 }] },
      modules: ASL,
      startPhase: 'MPh',
      pieces: [squad(), { id: 'c1', def: 'br.228c', side: 'br', hex: 'uR3', tags: { hip: true } }, { id: 'g40', def: 'br.AA40L', side: 'br', heldBy: 'c1', tags: { ca: 0, hip: true, emplaced: true } }],
    });
    const b = step(engine, start(engine, state), { to: 'uR3', bypass: ['uR4'] });
    expect(b.pieces['g40']!.tags['hip']).toBe(true);
    expect(ms(engine, b).bypass).toBeDefined();
    const inside = act(engine, b, { type: 'move.step', to: 'uR3' }).state;
    expect(inside.pieces['g40']!.tags['hip']).toBeUndefined();
  });

  it('no Gun may be pushed into Bypass', () => {
    const { engine, state } = makeEngine({
      board: 'u',
      terrain: BUILDING,
      scenario: { firstSide: 'ge', sides: [{ side: 'ge', name: 'German', nationality: 'ge', elr: 3 }, { side: 'br', name: 'British', nationality: 'br', elr: 3 }] },
      modules: ASL,
      startPhase: 'MPh',
      pieces: [{ id: 'c1', def: 'ge.228c', side: 'ge', hex: 'uQ4' }, { id: 'g75', def: 'ge.AT75L', side: 'ge', heldBy: 'c1', tags: { ca: 1 } }],
    });
    const s = act(engine, state, { type: 'move.start', units: ['c1'], manhandle: 'g75' }).state;
    expect(check(engine, s, { type: 'move.step', to: 'uR3', bypass: ['uR4'] })).toMatch(/Gun may not be pushed/);
    expect(engine.legalActions(s, 'ge').some((a) => a['bypass'])).toBe(false);
  });
});
