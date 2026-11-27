import { describe, expect, it } from 'vitest';
import type { Engine, GameState, RuleModule } from '@asl/engine';
import { aslCoreModules, minimumMoveIllegal, moveState, piecesModule, turnModule, type HexTerrainSpec } from '../../src';
import { sk1CoreModules } from '../../src/sk1';
import { sk2CoreModules } from '../../src/sk2';
import { sk3CoreModules } from '../../src/sk3';
import { act, makeEngine, type PieceSpec } from '../fixtures';

/*
 * Minimum Move (ASLRB A4.134): one hex as the unit's whole MPh at any cost, the unit pinned and CX once all First Fire at it
 * is over. Board u: uQ4 is woods on a level-1 hill, so entering it from uQ5 (level 0) costs 2 × 2 = 4 MF (the crest line
 * doubles the woods cost), as W4 in the A4.134 EX. A 4-6-7 carrying a MMG (4 PP, IPC 3) has 3 MF.
 */

const SK: RuleModule[] = [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules];
const ASL: RuleModule[] = [...SK, ...aslCoreModules];
const GE_RU = { firstSide: 'ge', sides: [{ side: 'ge', name: 'German', nationality: 'ge', elr: 3 }, { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 }] };
const GROUND: Record<string, HexTerrainSpec> = { uQ4: { terrain: 'woods', elevation: 1 }, uP5: { terrain: 'flooded' } };

function game(pieces: PieceSpec[], opts: { asl?: boolean; dice?: number[]; terrain?: Record<string, HexTerrainSpec> } = {}) {
  return makeEngine({ board: 'u', terrain: opts.terrain ?? GROUND, scenario: GE_RU, modules: opts.asl === false ? SK : ASL, startPhase: 'MPh', pieces, dice: opts.dice ?? [] });
}
const squadWithMmg = (hex = 'uQ5'): PieceSpec[] => [
  { id: 'g', def: 'ge.467', side: 'ge', hex },
  { id: 'mmg', def: 'ge.MMG', side: 'ge', heldBy: 'g' },
];
const russian: PieceSpec[] = [{ id: 'r', def: 'ru.447', side: 'ru', hex: 'uQ1' }];
const check = (engine: Engine, s: GameState, a: Record<string, unknown>) => {
  const d = engine.currentDecision(s)!;
  return engine.validate(s, { side: d.owner, decisionId: d.id, ...a } as never);
};
/** The DEFENDER passes every First Fire chance until the mover has the decision again. */
const passAll = (engine: Engine, s0: GameState) => {
  let s = s0;
  for (let i = 0; i < 20 && engine.currentDecision(s)?.owner === 'ru'; i++) s = act(engine, s, { type: 'defPass' }).state;
  return s;
};
/** Plays on, passing and ending phases, until `until` holds. */
const playTo = (engine: Engine, s0: GameState, until: (s: GameState) => boolean) => {
  let s = s0;
  for (let i = 0; i < 400 && !until(s); i++) {
    const d = engine.currentDecision(s)!;
    const legal = engine.legalActions(s, d.owner);
    const a = legal.find((x) => x.type === 'defPass') ?? legal.find((x) => x.type === 'move.end') ?? legal.find((x) => x.type === 'endPhase') ?? legal[0]!;
    s = act(engine, s, a).state;
  }
  return s;
};

describe('A4.134 Minimum Move', () => {
  it('the Starter Kit has none: a unit lacking the MF may not enter (SK1 3.3)', () => {
    const { engine, state } = game([...squadWithMmg(), ...russian], { asl: false });
    const s = act(engine, state, { type: 'move.start', units: ['g'] }).state;
    expect(check(engine, s, { type: 'move.step', to: 'uQ4' })).toMatch(/lacks the MF \(3\) to enter \(4\)/);
  });

  it('a 4-6-7 with a MMG (3 MF) enters uphill woods (4 MF) by Minimum Move: it has spent the 4 MF, stays, and is pinned and CX after all First Fire (A4.134 EX)', () => {
    const { engine, state } = game([...squadWithMmg(), ...russian]);
    let s = act(engine, state, { type: 'move.start', units: ['g'] }).state;
    expect(engine.legalActions(s, 'ge')).toContainEqual(expect.objectContaining({ type: 'move.step', to: 'uQ4' }));
    const r = act(engine, s, { type: 'move.step', to: 'uQ4' });
    s = r.state;
    expect(r.events.find((e) => e.type === 'asl.move.minimum')?.payload).toEqual({ units: ['g'], to: 'uQ4', cost: 4 });
    const ms = moveState(engine.env(s))!;
    expect(ms.spent['g']).toBe(4);
    expect(ms.units).toEqual([]);
    expect(ms.stopped).toEqual(['g']);
    // Not pinned while the DEFENDER still has his First Fire at the entry.
    expect(engine.currentDecision(s)!.kind).toBe('firstFire');
    expect(s.pieces['g']!.tags['pinned']).toBeUndefined();
    s = passAll(engine, s);
    expect(moveState(engine.env(s))).toBeFalsy();
    expect(s.pieces['g']!.loc).toMatchObject({ kind: 'hex', hex: 'uQ4' });
    expect(s.pieces['g']!.tags).toMatchObject({ pinned: true, cx: true, moved: true });
  });

  it('the First Fire at it takes FFNAM (all its MF used, so no Assault Movement) and the woods TEM', () => {
    const { engine, state } = game([...squadWithMmg(), ...russian], { dice: [6, 6] });
    let s = act(engine, state, { type: 'move.start', units: ['g'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uQ4' }).state;
    const r = act(engine, s, { type: 'defFire', decl: { units: ['r'], sw: [], target: 'uQ4' } });
    const attack = r.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { explain: { label?: string }[] };
    const labels = attack.explain.map((n) => n.label ?? '');
    expect(labels).toContain('-1 FFNAM');
    expect(labels.some((l) => /FFMO/.test(l))).toBe(false);
  });

  it('only as the first expenditure of the MPh: after one MF spent, the uphill woods is refused (A4.134; Q&A: no other MF first)', () => {
    const { engine, state } = game([...squadWithMmg('uQ6'), ...russian]);
    let s = act(engine, state, { type: 'move.start', units: ['g'] }).state;
    s = passAll(engine, act(engine, s, { type: 'move.step', to: 'uQ5' }).state);
    expect(check(engine, s, { type: 'move.step', to: 'uQ4' })).toMatch(/lacks the MF \(2\) to enter \(4\)/);
  });

  it('never into terrain whose cost is NA, nor while pushing a Gun (A4.134, C10.3)', () => {
    const { engine, state } = game([...squadWithMmg(), ...russian]);
    const s = act(engine, state, { type: 'move.start', units: ['g'] }).state;
    expect(check(engine, s, { type: 'move.step', to: 'uP5' })).toMatch(/lacks the MF/);
    const ms = moveState(engine.env(s))!;
    expect(minimumMoveIllegal(engine.env(s), ms, 'uP5', 'g', Infinity)).toMatch(/NA/);
    expect(minimumMoveIllegal(engine.env(s), { ...ms, manhandle: { gun: 'x', mustStop: false } }, 'uQ4', 'g', 4)).toMatch(/pushing a Gun/);
  });

  it('a unit that can pay enters normally and goes on: a 9-1 and a squad carrying two MMG (2 MF) step into the woods together; the squad makes a Minimum Move and stays, the leader moves on (A4.134, A4.2)', () => {
    const { engine, state } = game([
      { id: 'l', def: 'ge.L91', side: 'ge', hex: 'uQ5' },
      { id: 'g', def: 'ge.467', side: 'ge', hex: 'uQ5' },
      { id: 'm1', def: 'ge.MMG', side: 'ge', heldBy: 'g' },
      { id: 'm2', def: 'ge.MMG', side: 'ge', heldBy: 'g' },
      ...russian,
    ]);
    let s = act(engine, state, { type: 'move.start', units: ['g', 'l'] }).state;
    expect(moveState(engine.env(s))!.allowance).toEqual({ g: 2, l: 6 });
    s = passAll(engine, act(engine, s, { type: 'move.step', to: 'uQ4' }).state);
    expect(moveState(engine.env(s))!.units).toEqual(['l']);
    s = passAll(engine, act(engine, s, { type: 'move.step', to: 'uR4' }).state);
    s = passAll(engine, act(engine, s, { type: 'move.end' }).state);
    expect(s.pieces['g']!.tags).toMatchObject({ pinned: true, cx: true });
    expect(s.pieces['l']!.tags['pinned']).toBeUndefined();
    expect(s.pieces['l']!.loc).toMatchObject({ hex: 'uR4' });
  });

  it('across turns: the pinned and CX squad is fired on, and in its next MPh moves normally, its CX gone at the start but barring Double Time that MPh (A4.134, A4.51)', () => {
    const { engine, state } = game([...squadWithMmg(), ...russian]);
    let s = act(engine, state, { type: 'move.start', units: ['g'] }).state;
    s = passAll(engine, act(engine, s, { type: 'move.step', to: 'uQ4' }).state);
    // The Russian Player Turn: the pin is gone when it begins.
    s = playTo(engine, s, (x) => x.attacker === 'ru' && x.phase === 'PFPh');
    expect(s.pieces['g']!.tags['pinned']).toBeUndefined();
    expect(s.pieces['g']!.tags['cx']).toBe(true);
    // The German MPh of Turn 2: CX comes off, no Double Time, an ordinary move.
    s = playTo(engine, s, (x) => x.attacker === 'ge' && x.phase === 'MPh');
    expect(s.pieces['g']!.tags['cx']).toBeUndefined();
    expect(check(engine, s, { type: 'move.start', units: ['g'], doubleTime: true })).toMatch(/was CX when this MPh began/);
    s = act(engine, s, { type: 'move.start', units: ['g'] }).state;
    s = passAll(engine, act(engine, s, { type: 'move.step', to: 'uR4' }).state);
    expect(s.pieces['g']!.loc).toMatchObject({ hex: 'uR4' });
    s = passAll(engine, act(engine, s, { type: 'move.end' }).state);
    expect(s.pieces['g']!.tags['pinned']).toBeUndefined();
  });
});
