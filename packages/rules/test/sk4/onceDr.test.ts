import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { ONCE_DR_DECISION, ONCE_DR_MODULE, RAIDER_AMBUSH_MODULE, concealmentModule, onceDrModule, onceDrRecord, raiderAmbushModule, setupDeployModule, sk2CoreModules, sk3CoreModules, usmcModule } from '../../src';
import { act, makeEngine, type PieceSpec } from '../fixtures';

/**
 * S64: SSR 2 (a Japanese dr at the start of the Japanese MPh after Game Turn 1: each non-HIP Good Order
 * American MMC not stacked with a Good Order leader takes a NMC, only failure costing its "?"), SSR 3 (an American dr at
 * the start of the Japanese RPh after Game Turn 2: the 10-1's stack takes no action but rout and CC that Game Turn and
 * its broken units rally automatically in each RPh of it) and SSR 5 / the Japanese balance (Raider ambush).
 */
const SSR2 = {
  module: ONCE_DR_MODULE,
  params: { side: 'ja', phase: 'MPh', phaseOf: 'ja', fromTurn: 2, effect: { kind: 'nmcConcealment', side: 'am' }, rule: 'SSR 2' },
  text: 'SSR 2',
};
const SSR3 = {
  module: ONCE_DR_MODULE,
  params: { side: 'am', phase: 'RPh', phaseOf: 'ja', fromTurn: 3, effect: { kind: 'leaderHalt', side: 'ja', leader: 'ja.L101' }, rule: 'SSR 3' },
  text: 'SSR 3',
};
const SC = {
  firstSide: 'ja',
  sides: [
    { side: 'am', name: 'American', nationality: 'am', elr: 5 },
    { side: 'ja', name: 'Japanese', nationality: 'ja', elr: 4 },
  ],
};
const extra = [...sk2CoreModules, ...sk3CoreModules, concealmentModule, setupDeployModule, usmcModule, onceDrModule, raiderAmbushModule];
/** Jungle at K5 and M5 (Concealment Terrain); the bare fixture map is open elsewhere. */
const TERRAIN = { yK5: { terrain: 'woods' }, yM5: { terrain: 'woods' }, yK2: { terrain: 'woods' } };
const game = (pieces: PieceSpec[], ssr: unknown[], dice?: number[]) =>
  makeEngine({ scenario: { ...SC, ssr } as never, extra, terrain: TERRAIN, startPhase: 'RPh', pieces, ...(dice ? { dice } : {}) });

/** End phases (passing any fire or once-dr question) until `phase` of `attacker` in Game Turn `turn` asks its first question. */
function advance(engine: Engine, state: GameState, turn: number, attacker: string, phase: string, skipOnceDr = true): GameState {
  let s = state;
  for (let guard = 0; guard < 400; guard++) {
    const d = engine.currentDecision(s);
    if (!d) throw new Error(`no decision at turn ${s.turn} ${s.attacker} ${s.phase}: ${JSON.stringify(s.result)}`);
    if (s.turn === turn && s.attacker === attacker && s.phase === phase) return s;
    if (d.kind === ONCE_DR_DECISION && !skipOnceDr) return s;
    const legal = engine.legalActions(s, d.owner);
    const pick = legal.find((a) => a.type === 'onceDr.skip') ?? legal.find((a) => a.type === 'defPass') ?? legal.find((a) => a.type === 'endPhase') ?? legal.find((a) => a.type === 'rout.stay') ?? legal[0]!;
    s = engine.submit(s, pick).state;
  }
  throw new Error(`never reached ${phase} of ${attacker} in turn ${turn}`);
}

describe('S64 SSR 2: the Japanese NMC dr', () => {
  const pieces: PieceSpec[] = [
    // Concealed in jungle, alone: takes the NMC, loses its "?" on a failure.
    { id: 'a', def: 'am.558r', side: 'am', hex: 'yK5', tags: { concealed: true } },
    // Concealed beside a Good Order leader: no NMC.
    { id: 'b', def: 'am.558p', side: 'am', hex: 'yM5', tags: { concealed: true } },
    { id: 'l', def: 'am.L91', side: 'am', hex: 'yM5', tags: { concealed: true } },
    // Broken: not Good Order, no NMC.
    { id: 'c', def: 'am.558p', side: 'am', hex: 'yK2', tags: { broken: true } },
    { id: 'j', def: 'ja.447', side: 'ja', hex: 'yA1' },
  ];

  it('is first asked at the start of the Japanese MPh of Game Turn 2, and declining keeps it', () => {
    const { engine, state } = game(pieces, [SSR2]);
    // Game Turn 1: not asked.
    let s = advance(engine, state, 1, 'ja', 'MPh');
    expect(engine.currentDecision(s)!.kind).toBe('phase');
    s = advance(engine, s, 2, 'ja', 'MPh', false);
    const d = engine.currentDecision(s)!;
    expect([s.turn, s.attacker, s.phase, d.kind, d.owner]).toEqual([2, 'ja', 'MPh', ONCE_DR_DECISION, 'ja']);
    s = act(engine, s, { type: 'onceDr.skip', index: 0 }).state;
    expect(engine.currentDecision(s)!.kind).toBe('phase');
    expect(onceDrRecord(engine.env(s), 0)).toBeUndefined();
    // Asked again next turn.
    s = advance(engine, s, 3, 'ja', 'MPh', false);
    expect(engine.currentDecision(s)!.kind).toBe(ONCE_DR_DECISION);
  });

  it('a dr < the turn: the NMC; only a failure costs the "?", nothing else; once made it is never asked again', () => {
    // dr 1 < 2; then the NMC of a (morale 8): DR 12 > 8, failed. No Casualty Reduction for the 12.
    const { engine, state } = game(pieces, [SSR2], [1, 6, 6]);
    let s = advance(engine, state, 2, 'ja', 'MPh', false);
    const r = act(engine, s, { type: 'onceDr.roll', index: 0 });
    s = r.state;
    expect(onceDrRecord(engine.env(s), 0)).toEqual({ turn: 2, dr: 1, success: true });
    const nmcs = r.events.filter((e) => e.type === 'ssr.onceDr.nmc').map((e) => e.payload as { unit: string; failed: boolean; concealmentLost: boolean });
    expect(nmcs).toEqual([expect.objectContaining({ unit: 'a', failed: true, concealmentLost: true })]);
    expect(s.pieces['a']!.tags['concealed']).toBeUndefined();
    expect(s.pieces['a']!.defId).toBe('am.558r');
    expect(s.pieces['a']!.tags['broken']).toBeUndefined();
    expect(s.pieces['b']!.tags['concealed']).toBe(true);
    // The MPh goes on; next turn there is no question.
    expect(engine.currentDecision(s)!.kind).toBe('phase');
    s = advance(engine, s, 3, 'ja', 'APh', false);
    expect(engine.currentDecision(s)!.kind).toBe('phase');
  });

  it('a dr ≥ the turn spends it with no effect', () => {
    const { engine, state } = game(pieces, [SSR2], [2]);
    let s = advance(engine, state, 2, 'ja', 'MPh', false);
    const r = act(engine, s, { type: 'onceDr.roll', index: 0 });
    s = r.state;
    expect(onceDrRecord(engine.env(s), 0)).toEqual({ turn: 2, dr: 2, success: false });
    expect(r.events.some((e) => e.type === 'ssr.onceDr.nmc')).toBe(false);
    expect(s.pieces['a']!.tags['concealed']).toBe(true);
    expect(() => act(engine, s, { type: 'onceDr.roll', index: 0 })).toThrow();
  });
});

describe('S64 SSR 3: the American dr that halts the 10-1', () => {
  const pieces: PieceSpec[] = [
    { id: 'L', def: 'ja.L101', side: 'ja', hex: 'yK5' },
    { id: 'j1', def: 'ja.447', side: 'ja', hex: 'yK5' },
    { id: 'j2', def: 'ja.237h', side: 'ja', hex: 'yK5', tags: { broken: true, dm: true } },
    { id: 'j3', def: 'ja.447', side: 'ja', hex: 'yC5' },
    { id: 'a', def: 'am.558r', side: 'am', hex: 'yK8' },
  ];

  it('success: the broken units with him rally at once; his stack may neither fire, move nor advance that Game Turn; the next turn they act again', () => {
    const { engine, state } = game(pieces, [SSR3], [1]);
    // Not asked before Game Turn 3.
    let s = advance(engine, state, 2, 'ja', 'RPh');
    expect(engine.currentDecision(s)!.kind).toBe('phase');
    s = advance(engine, s, 3, 'ja', 'RPh', false);
    expect([engine.currentDecision(s)!.kind, engine.currentDecision(s)!.owner]).toEqual([ONCE_DR_DECISION, 'am']);
    const r = act(engine, s, { type: 'onceDr.roll', index: 0 });
    s = r.state;
    expect(onceDrRecord(engine.env(s), 0)).toEqual({ turn: 3, dr: 1, success: true });
    const env = engine.env(s);
    // No action for the 10-1's stack (him included), any other unit is free.
    for (const u of ['L', 'j1']) expect(env.query('unit.actionIllegal', { unit: u }, null)).toMatch(/SSR 3: units stacked with the 10-1 leader/);
    expect(env.query('unit.actionIllegal', { unit: 'j3' }, null)).toBeNull();
    // Japanese PFPh: no fire from K5; MPh: no move; j3 may.
    s = advance(engine, s, 3, 'ja', 'PFPh');
    expect(() => act(engine, s, { type: 'fire', decl: { units: ['j1'], sw: [], target: 'yK8' } })).toThrow(/SSR 3/);
    s = advance(engine, s, 3, 'ja', 'MPh');
    expect(() => act(engine, s, { type: 'move.start', units: ['j1'] })).toThrow(/SSR 3/);
    expect(engine.legalActions(s, 'ja').some((a) => a.type === 'move.start' && (a['units'] as string[]).includes('j1'))).toBe(false);
    expect(engine.legalActions(s, 'ja').some((a) => a.type === 'move.start' && (a['units'] as string[]).includes('j3'))).toBe(true);
    // The American DFPh of Game Turn 3 (the Japanese defend there): still halted, no Defensive Fire.
    s = advance(engine, s, 3, 'am', 'DFPh');
    expect(engine.env(s).query('unit.actionIllegal', { unit: 'j1' }, null)).toMatch(/SSR 3/);
    // Game Turn 4: free again.
    s = advance(engine, s, 4, 'ja', 'PFPh');
    expect(engine.env(s).query('unit.actionIllegal', { unit: 'j1' }, null)).toBeNull();
  });

  it('rallies the broken units stacked with him in each RPh of the Game Turn, without a roll', () => {
    const { engine, state } = game(pieces, [SSR3], [1]);
    let s = advance(engine, state, 3, 'ja', 'RPh', false);
    // Whatever happened on the way, j2 is broken now (a test break), with a DM.
    s = { ...s, pieces: { ...s.pieces, j2: { ...s.pieces['j2']!, tags: { ...s.pieces['j2']!.tags, broken: true, dm: true } } } };
    const r = act(engine, s, { type: 'onceDr.roll', index: 0 });
    s = r.state;
    expect(r.events.find((e) => e.type === 'ssr.onceDr.rallied')?.payload).toMatchObject({ units: ['j2'], leader: 'L', rule: 'SSR 3' });
    expect(s.pieces['j2']!.tags['broken']).toBeUndefined();
    expect(s.pieces['j2']!.tags['dm']).toBeUndefined();
    // Broken again before the American RPh of the same Game Turn: rallied as it starts.
    s = advance(engine, s, 3, 'ja', 'APh');
    s = { ...s, pieces: { ...s.pieces, j2: { ...s.pieces['j2']!, tags: { ...s.pieces['j2']!.tags, broken: true } } } };
    s = advance(engine, s, 3, 'am', 'RPh');
    expect(s.pieces['j2']!.tags['broken']).toBeUndefined();
  });

  it('is asked even once the 10-1 is gone (asking only while he lives would tell), and then does nothing', () => {
    const { engine, state } = game(pieces.filter((p) => p.id !== 'L'), [SSR3], [1]);
    let s = advance(engine, state, 3, 'ja', 'RPh', false);
    expect(engine.currentDecision(s)!.kind).toBe(ONCE_DR_DECISION);
    const r = act(engine, s, { type: 'onceDr.roll', index: 0 });
    s = r.state;
    expect(onceDrRecord(engine.env(s), 0)).toEqual({ turn: 3, dr: 1, success: true });
    expect(r.events.some((e) => e.type === 'ssr.onceDr.rallied')).toBe(false);
    expect(s.pieces['j2']!.tags['broken']).toBe(true);
    expect(engine.env(s).query('unit.actionIllegal', { unit: 'j1' }, null)).toBeNull();
  });
});

describe('S64 SSR 5 and the Japanese balance: Raider ambush', () => {
  const pieces: PieceSpec[] = [
    { id: 'p', def: 'am.558p', side: 'am', hex: 'yK5' },
    // An 8-0: no leadership DRM of his own on the ambush dr.
    { id: 'l', def: 'am.L80', side: 'am', hex: 'yK5' },
    { id: 'r', def: 'am.558r', side: 'am', hex: 'yM5' },
    { id: 'j', def: 'ja.447', side: 'ja', hex: 'yK5' },
  ];
  const drm = (ssr: unknown[], units: string[]) => {
    const { engine, state } = game(pieces, ssr);
    return engine.env(state).query('cc.ambushDrm', { hex: 'yK5', side: 'am', units }, 0);
  };

  it('a Good Order American leader counts as a Raider MMC (SSR 5); a Paramarine alone does not', () => {
    expect(drm([], ['p', 'l'])).toBe(0);
    expect(drm([{ module: RAIDER_AMBUSH_MODULE, params: { side: 'am', leaders: true }, text: 'SSR 5' }], ['p', 'l'])).toBe(-1);
    expect(drm([{ module: RAIDER_AMBUSH_MODULE, params: { side: 'am', leaders: true }, text: 'SSR 5' }], ['p'])).toBe(0);
  });

  it('"Raider -1 ambush drm (8.4.2) is NA": neither the Raiders nor the leaders', () => {
    const na = [{ module: RAIDER_AMBUSH_MODULE, params: { side: 'am', leaders: true, none: true }, text: 'SSR 5' }];
    expect(drm(na, ['r'])).toBe(0);
    expect(drm(na, ['p', 'l'])).toBe(0);
    expect(drm([], ['r'])).toBe(-1);
  });
});
