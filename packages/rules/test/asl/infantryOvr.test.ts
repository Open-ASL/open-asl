import { describe, expect, it } from 'vitest';
import type { Engine, GameState, RuleModule } from '@asl/engine';
import { aslCoreModules, ccHexes, moveState, ovrIllegal, piecesModule, slipAwayHexes, turnModule, type HexTerrainSpec } from '../../src';
import { sk1CoreModules } from '../../src/sk1';
import { sk2CoreModules } from '../../src/sk2';
import { sk3CoreModules } from '../../src/sk3';
import { act, makeEngine, type PieceSpec } from '../fixtures';

/*
 * Infantry OVR (ASLRB A4.15, A4.151, A4.152) and mandatory TPBF (A8.312). Board u, Open Ground unless stated; the Germans
 * move first. A German 4-6-7 in uQ6 overruns a Russian leader alone in uQ5 (from uQ6, uQ5 is the hex above; its other
 * neighbours are uQ4, uR4, uR5, uP5 and uP4).
 * CC (fixture table): a 4-6-7 against a leader is 4:1, kill 9; the leader against it 1:4, kill 2.
 */

const SK: RuleModule[] = [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules];
const ASL: RuleModule[] = [...SK, ...aslCoreModules];
const GE_RU = { firstSide: 'ge', sides: [{ side: 'ge', name: 'German', nationality: 'ge', elr: 3 }, { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 }] };

function game(pieces: PieceSpec[], opts: { asl?: boolean; dice?: number[]; terrain?: Record<string, HexTerrainSpec>; hexMarkers?: Record<string, Record<string, unknown>> } = {}) {
  return makeEngine({ board: 'u', terrain: opts.terrain ?? {}, scenario: GE_RU, modules: opts.asl === false ? SK : ASL, startPhase: 'MPh', pieces, dice: opts.dice ?? [], ...(opts.hexMarkers ? { hexMarkers: opts.hexMarkers } : {}) });
}
const ge = (id: string, hex: string, def = 'ge.467'): PieceSpec => ({ id, def, side: 'ge', hex });
const ru = (id: string, hex: string, def = 'ru.L81'): PieceSpec => ({ id, def, side: 'ru', hex });
const check = (engine: Engine, s: GameState, a: Record<string, unknown>) => {
  const d = engine.currentDecision(s)!;
  return engine.validate(s, { side: d.owner, decisionId: d.id, ...a } as never);
};
type Ev = { type: string; payload: unknown }[];
const ev = <T>(events: Ev, type: string) => events.find((e) => e.type === type)?.payload as T | undefined;
const start = (engine: Engine, s: GameState, units: string[]) => act(engine, s, { type: 'move.start', units }).state;
/** Plays the CC in progress: each side declares its first attack (or none). */
const playCc = (engine: Engine, s0: GameState) => {
  let s = s0;
  const events: Ev = [];
  for (let i = 0; i < 6 && engine.currentDecision(s)?.kind === 'ccDeclare'; i++) {
    const d = engine.currentDecision(s)!;
    const legal = engine.legalActions(s, d.owner);
    const r = act(engine, s, legal.find((a) => (a['attacks'] as unknown[]).length > 0) ?? legal[0]!);
    events.push(...r.events);
    s = r.state;
  }
  return { s, events };
};

describe('A4.15 Infantry OVR: the entry', () => {
  it('a 4-6-7 overruns a lone leader in woods: a NTC with +1 for the woods TEM, then the entry at double cost (2 × 2 MF)', () => {
    const { engine, state } = game([ge('g', 'uQ6'), ru('l', 'uQ5')], { dice: [2, 2], terrain: { uQ5: { terrain: 'woods' } } });
    let s = start(engine, state, ['g']);
    expect(engine.legalActions(s, 'ge')).toContainEqual(expect.objectContaining({ type: 'move.step', to: 'uQ5' }));
    const r = act(engine, s, { type: 'move.step', to: 'uQ5' });
    expect(ev(r.events, 'asl.ovr.ntc')).toMatchObject({ smc: 'l', by: 'each', rolls: [{ unit: 'g', drm: 1, morale: 7, passed: true }], notes: ['+1 TEM (Woods)'] });
    s = r.state;
    expect(s.pieces['g']!.loc).toMatchObject({ hex: 'uQ5' });
    expect(moveState(engine.env(s))!.spent['g']).toBe(4);
    // The leader's answer comes first.
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'ovrEvade', owner: 'ru' });
  });

  it('the Starter Kit never lets Infantry into an enemy hex in the MPh (SK1 3.3)', () => {
    const { engine, state } = game([ge('g', 'uQ6'), ru('l', 'uQ5')], { asl: false });
    expect(check(engine, start(engine, state, ['g']), { type: 'move.step', to: 'uQ5' })).toMatch(/enemy-occupied/);
  });

  it('two enemy units there deny the Location; so does a Dash (A4.15; Q&A to A4.15 & A4.63)', () => {
    const { engine, state } = game([ge('g', 'uQ6'), ru('l', 'uQ5'), ru('l2', 'uQ5', 'ru.L91')]);
    const s = start(engine, state, ['g']);
    expect(check(engine, s, { type: 'move.step', to: 'uQ5' })).toMatch(/enemy-occupied/);
    const ms = moveState(engine.env(s))!;
    expect(ovrIllegal(engine.env(s), ms, 'uQ5')).toMatch(/2 enemy units there/);
    expect(ovrIllegal(engine.env(s), { ...ms, dash: { from: 'uQ6', road: 'uQ5', to: 'uQ4' } }, 'uQ4')).toBe('No enemy unit there');
  });

  it('a leader moving with two squads takes one NTC for all; when he fails, none of them moves or acts again that phase (A4.15, A10.1)', () => {
    const pieces = [ge('L', 'uQ6', 'ge.L91'), ge('g1', 'uQ6'), ge('g2', 'uQ6'), ru('l', 'uQ5')];
    const fail = game(pieces, { dice: [6, 6] });
    let s = start(fail.engine, fail.state, ['L', 'g1', 'g2']);
    expect(fail.engine.legalActions(s, 'ge')).toContainEqual(expect.objectContaining({ type: 'move.step', to: 'uQ5', ovr: 'each' }));
    const r = act(fail.engine, s, { type: 'move.step', to: 'uQ5' });
    expect(ev<{ rolls: unknown[] }>(r.events, 'asl.ovr.ntc')).toMatchObject({ by: 'leader', rolls: [{ unit: 'L', drm: 0, morale: 9, passed: false }] });
    s = r.state;
    expect(moveState(fail.engine.env(s))).toBeFalsy();
    for (const u of ['L', 'g1', 'g2']) expect(s.pieces[u]).toMatchObject({ loc: { hex: 'uQ6' }, tags: { ovrFailed: true, moved: true } });
    expect(check(fail.engine, s, { type: 'move.start', units: ['g1'] })).toMatch(/already moved/);
    // Gone when the MPh ends.
    s = act(fail.engine, s, { type: 'endPhase' }).state;
    expect(s.pieces['g1']!.tags['ovrFailed']).toBeUndefined();
    // Passed: one roll, the whole stack enters, the leader with them.
    const pass = game(pieces, { dice: [1, 1] });
    const t = act(pass.engine, start(pass.engine, pass.state, ['L', 'g1', 'g2']), { type: 'move.step', to: 'uQ5' });
    expect(ev<{ rolls: unknown[] }>(t.events, 'asl.ovr.ntc')!.rolls).toHaveLength(1);
    expect(moveState(pass.engine.env(t.state))!.units).toEqual(['L', 'g1', 'g2']);
  });

  it('each squad its own NTC, with the leader\'s DRM: the one that fails stays behind (A4.15, A10.7)', () => {
    // g1 rolls 4+4 - 1 = 7 ≤ 7, g2 rolls 5+4 - 1 = 8 > 7.
    const { engine, state } = game([ge('L', 'uQ6', 'ge.L91'), ge('g1', 'uQ6'), ge('g2', 'uQ6'), ru('l', 'uQ5')], { dice: [4, 4, 5, 4] });
    const r = act(engine, start(engine, state, ['L', 'g1', 'g2']), { type: 'move.step', to: 'uQ5', ovr: 'each' });
    expect(ev(r.events, 'asl.ovr.ntc')).toMatchObject({ by: 'each', rolls: [{ unit: 'g1', drm: -1, passed: true }, { unit: 'g2', drm: -1, passed: false }] });
    expect(r.state.pieces['g2']).toMatchObject({ loc: { hex: 'uQ6' }, tags: { ovrFailed: true } });
    expect(moveState(engine.env(r.state))!.units).toEqual(['L', 'g1']);
  });
});

describe('A4.151 the SMC\'s answer', () => {
  it('the leader slips away to a hex the ATTACKER picks: not Open Ground while another is left; the hex the mover came from is allowed', () => {
    const { engine, state } = game([ge('g', 'uQ6'), ru('l', 'uQ5')], { dice: [1, 1], terrain: { uP4: { terrain: 'woods' }, uQ6: { terrain: 'woods' } } });
    let s = act(engine, start(engine, state, ['g']), { type: 'move.step', to: 'uQ5' }).state;
    expect(slipAwayHexes(engine.env(s), 'l')).toEqual(['uP4', 'uQ6']);
    s = act(engine, s, { type: 'ovr.slip' }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'ovrPlace', owner: 'ge', data: { hexes: ['uP4', 'uQ6'] } });
    expect(check(engine, s, { type: 'ovr.place', hex: 'uR4' })).toMatch(/may not be put in uR4/);
    const r = act(engine, s, { type: 'ovr.place', hex: 'uQ6' });
    expect(ev(r.events, 'asl.ovr.slipped')).toEqual({ smc: 'l', from: 'uQ5', to: 'uQ6' });
    s = r.state;
    expect(s.pieces['l']!.loc).toMatchObject({ hex: 'uQ6' });
    // The squad goes on with its 2 MF left.
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'phase', owner: 'ge' });
    expect(moveState(engine.env(s))).toMatchObject({ hex: 'uQ5', spent: { g: 2 } });
    expect(moveState(engine.env(s))!.ovr).toBeUndefined();
  });

  it('a SMC marked First Fire may not slip away: incapable of movement (Q&A to A4.151); CC follows', () => {
    const { engine, state } = game([ge('g', 'uQ6'), { ...ru('l', 'uQ5'), tags: { fire: 'first' } }], { dice: [1, 1] });
    const s = act(engine, start(engine, state, ['g']), { type: 'move.step', to: 'uQ5' }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'ccDeclare', owner: 'ge' });
  });
});

describe('A8.312 mandatory TPBF', () => {
  const armed = (dice: number[], hexMarkers?: Record<string, Record<string, unknown>>) =>
    game([ge('g', 'uQ6'), ru('l', 'uQ5', 'ru.L91'), { id: 'lmg', def: 'ru.LMG', side: 'ru', heldBy: 'l' }, ru('r', 'uQ4', 'ru.447')], { dice, ...(hexMarkers ? { hexMarkers } : {}) });

  it('a 9-1 with a LMG who stays must attack at once with it, before the 4-4-7 next door may fire; no Pass (A8.312; Q&A [An93b; An96])', () => {
    const { engine, state } = armed([1, 1, 6, 6]);
    let s = act(engine, start(engine, state, ['g']), { type: 'move.step', to: 'uQ5' }).state;
    s = act(engine, s, { type: 'ovr.stay' }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'mandatoryTpbf', owner: 'ru', data: { decl: { units: [], sw: ['lmg'], target: 'uQ5' } } });
    expect(check(engine, s, { type: 'defFire', decl: { units: ['r'], sw: [], target: 'uQ5' } })).toBeTruthy();
    expect(check(engine, s, { type: 'defPass' })).toBeTruthy();
    expect(check(engine, s, { type: 'tpbf.fire', decl: { units: [], sw: [], target: 'uQ5' } })).toMatch(/must attack with a SW/);
    const r = act(engine, s, { type: 'tpbf.fire', decl: { units: [], sw: ['lmg'], target: 'uQ5' } });
    expect(ev(r.events, 'asl.tpbf.mandatory')).toEqual({ hex: 'uQ5', units: [], sw: ['lmg'] });
    expect(r.events.some((e) => e.type === 'sk1.fire.attack')).toBe(true);
    // Then the ordinary First Fire: the 4-4-7 may fire now.
    expect(engine.currentDecision(r.state)).toMatchObject({ kind: 'firstFire', owner: 'ru' });
    expect(check(engine, r.state, { type: 'defFire', decl: { units: ['r'], sw: [], target: 'uQ5' } })).toBeNull();
  });

  it('Residual FP that eliminates the mover leaves nothing to attack (A8.312; Q&A [K33])', () => {
    // Residual FP 36 in uQ5: DR 2 on the 36 column, a KIA.
    const { engine, state } = armed([1, 1, 1, 1], { uQ5: { residualFp: 36 } });
    const s = act(engine, start(engine, state, ['g']), { type: 'move.step', to: 'uQ5' }).state;
    expect(s.pieces['g']!.loc.kind).toBe('eliminated');
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'phase', owner: 'ge' });
  });
});

describe('A4.152 CC in the MPh', () => {
  it('the leader is eliminated in CC at once: the 4-6-7 moves on with its 2 MF left (A4.152)', () => {
    // NTC 1+1; CC: the squad rolls 1+2 (< 9: eliminated), the leader 6+6.
    const { engine, state } = game([ge('g', 'uQ6'), ru('l', 'uQ5')], { dice: [1, 1, 1, 2, 6, 6] });
    let s = act(engine, start(engine, state, ['g']), { type: 'move.step', to: 'uQ5' }).state;
    s = act(engine, s, { type: 'ovr.stay' }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'ccDeclare', owner: 'ge' });
    const { s: after, events } = playCc(engine, s);
    expect(after.pieces['l']!.loc.kind).toBe('eliminated');
    expect(ev(events, 'asl.ovr.cc')).toMatchObject({ outcome: 'eliminated', goOn: ['g'] });
    expect(engine.currentDecision(after)).toMatchObject({ kind: 'phase', owner: 'ge' });
    const next = act(engine, after, { type: 'move.step', to: 'uQ4' }).state;
    expect(next.pieces['g']!.loc).toMatchObject({ hex: 'uQ4' });
  });

  it('the leader survives: Melee, the squad\'s MPh over; CC again in the CCPh, and by the next Player Turn the markers are gone (A4.152, A11.12)', () => {
    // MPh CC: 6+6 each. CCPh CC: the squad 1+2 (eliminates), the leader 6+6.
    const { engine, state } = game([ge('g', 'uQ6'), ru('l', 'uQ5'), ru('far', 'uA1', 'ru.447')], { dice: [1, 1, 6, 6, 6, 6, 1, 2, 6, 6] });
    let s = act(engine, start(engine, state, ['g']), { type: 'move.step', to: 'uQ5' }).state;
    s = act(engine, s, { type: 'ovr.stay' }).state;
    const { s: after, events } = playCc(engine, s);
    expect(ev(events, 'asl.ovr.cc')).toMatchObject({ outcome: 'melee', goOn: [] });
    expect(after.hexMarkers['uQ5']?.['melee']).toBe(true);
    expect(moveState(engine.env(after))).toBeFalsy();
    expect(after.pieces['g']!.tags['moved']).toBe(true);
    s = after;
    for (let i = 0; i < 60 && s.phase !== 'CCPh'; i++) s = act(engine, s, { type: 'endPhase' }).state;
    expect(ccHexes(engine.env(s))).toContain('uQ5');
    s = playCc(engine, s).s;
    expect(s.pieces['l']!.loc.kind).toBe('eliminated');
    for (let i = 0; i < 20 && s.attacker === 'ge'; i++) s = act(engine, s, { type: 'endPhase' }).state;
    expect(s.attacker).toBe('ru');
    expect(s.hexMarkers['uQ5']?.['melee']).toBeUndefined();
    expect(s.hexMarkers['uQ5']?.['cc']).toBeUndefined();
    expect(Object.values(s.pieces).some((p) => p.tags['ovrFailed'] !== undefined)).toBe(false);
  });

  it('a second squad overruns the leader held in Melee: he does not attack back, and only the newcomer moves on (A4.152)', () => {
    // g1: NTC 1+1, CC 6+6 / 6+6 (Melee). g2: NTC 1+1, CC 1+2 (eliminates); the leader makes no attack.
    const { engine, state } = game([ge('g1', 'uQ6'), ge('g2', 'uR5'), ru('l', 'uQ5')], { dice: [1, 1, 6, 6, 6, 6, 1, 1, 1, 2] });
    let s = act(engine, start(engine, state, ['g1']), { type: 'move.step', to: 'uQ5' }).state;
    s = playCc(engine, act(engine, s, { type: 'ovr.stay' }).state).s;
    expect(s.hexMarkers['uQ5']?.['melee']).toBe(true);
    s = act(engine, start(engine, s, ['g2']), { type: 'move.step', to: 'uQ5' }).state;
    // No slip-away from Melee, no TPBF into Melee: straight to CC, the squad declaring.
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'ccDeclare', owner: 'ge' });
    const attackers = engine.legalActions(s, 'ge').flatMap((a) => (a['attacks'] as { attackers: string[] }[]).flatMap((x) => x.attackers));
    expect([...new Set(attackers)]).toEqual(['g2']);
    const { s: after, events } = playCc(engine, s);
    expect(events.filter((e) => e.type === 'sk1.cc.attack')).toHaveLength(1);
    expect(after.pieces['l']!.loc.kind).toBe('eliminated');
    expect(moveState(engine.env(after))).toMatchObject({ units: ['g2'] });
    expect(after.hexMarkers['uQ5']?.['melee']).toBeUndefined();
  });
});

describe('A4.15 and A5.11: an OVR into an overstacked Location', () => {
  it('four squads and a leader overrun a lone leader in woods: the overstacking MF is doubled with the rest (2 + 1, × 2)', () => {
    const stack = [ge('g1', 'uQ6'), ge('g2', 'uQ6'), ge('g3', 'uQ6'), ge('g4', 'uQ6'), ge('gl', 'uQ6', 'ge.L80')];
    const { engine, state } = game([...stack, ru('l', 'uQ5')], { dice: [2, 2], terrain: { uQ5: { terrain: 'woods' } } });
    const s = act(engine, start(engine, state, ['g1', 'g2', 'g3', 'g4', 'gl']), { type: 'move.step', to: 'uQ5' }).state;
    expect(s.pieces['g1']!.loc).toMatchObject({ hex: 'uQ5' });
    expect(moveState(engine.env(s))!.spent['g1']).toBe(6);
  });

  it('the overrun SMC may slip away into a hex its side already holds four SMC in (A5.1: no cap in play)', () => {
    const four = ['r1', 'r2', 'r3', 'r4'].map((id) => ru(id, 'uP4'));
    const { engine, state } = game([ge('g', 'uQ6'), ru('l', 'uQ5'), ...four], { dice: [1, 1], terrain: { uP4: { terrain: 'woods' }, uQ6: { terrain: 'woods' } } });
    const s = act(engine, start(engine, state, ['g']), { type: 'move.step', to: 'uQ5' }).state;
    expect(slipAwayHexes(engine.env(s), 'l')).toContain('uP4');
    const sk = game([ge('g', 'uQ6'), ru('l', 'uQ5'), ...four], { asl: false, dice: [1, 1], terrain: { uP4: { terrain: 'woods' }, uQ6: { terrain: 'woods' } } });
    // Under the Starter Kit's cap (four SMC) the same hex is refused.
    expect(slipAwayHexes(sk.engine.env(sk.state), 'l')).not.toContain('uP4');
  });
});
