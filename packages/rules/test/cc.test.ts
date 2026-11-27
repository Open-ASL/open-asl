import { describe, expect, it } from 'vitest';
import type { GameState } from '@asl/engine';
import { ccAttackPreview, ccDefensiveGroup } from '../src/sk1/closeCombat';
import { act, makeEngine, type PieceSpec } from './fixtures';

describe('Close Combat markers', () => {
  it('advancing into an enemy hex puts a CC counter on it; after the CCPh it becomes Melee if both sides remain', () => {
    // CC rolls high on both sides: nobody dies, so the hex stays contested.
    const { engine, state } = makeEngine({
      startPhase: 'APh',
      dice: [6, 6, 6, 6, 6, 6, 6, 6],
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yO5' },
      ],
    });
    let s: GameState = act(engine, state, { type: 'advance', units: ['a1'], to: 'yO5' }).state;
    expect(s.hexMarkers['yO5']?.['cc']).toBe(true);
    expect(s.hexMarkers['yO5']?.['melee']).toBeUndefined();
    s = act(engine, s, { type: 'endPhase' }).state;
    expect(s.phase).toBe('CCPh');
    expect(s.hexMarkers['yO5']?.['cc']).toBe(true);
    // Drive the CC with whatever the engine offers until the phase is over.
    for (let guard = 0; guard < 20 && s.phase === 'CCPh'; guard++) {
      const d = engine.currentDecision(s)!;
      const legal = engine.legalActions(s, d.owner);
      expect(legal.length).toBeGreaterThan(0);
      s = engine.submit(s, legal[0]!).state;
    }
    expect(s.pieces['a1']!.loc).toEqual({ kind: 'hex', hex: 'yO5' });
    expect(s.pieces['g1']!.loc).toEqual({ kind: 'hex', hex: 'yO5' });
    expect(s.hexMarkers['yO5']?.['cc']).toBeUndefined();
    expect(s.hexMarkers['yO5']?.['melee']).toBe(true);
  });
});

describe('Ambush drm (SK1 3.8, ASLRB A11.4)', () => {
  type Roll = { side: string; dr: number; drm: number; final: number; notes: string[] };
  /** Americans with a 10-2 advance into woods held by a German 9-1 and squad; the Ambush drs as the rules logged them. */
  const ambush = (leaderTags: Record<string, unknown>, squadTags: Record<string, unknown> = {}) => {
    const { engine, state } = makeEngine({
      startPhase: 'APh',
      terrain: { yO5: { terrain: 'woods' } },
      dice: [4, 4, 6, 6, 6, 6, 6, 6],
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'aL', def: 'am.L102', side: 'am', hex: 'yN5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yO5', tags: squadTags as never },
        { id: 'gL', def: 'ge.L91', side: 'ge', hex: 'yO5', tags: leaderTags as never },
      ],
    });
    let s: GameState = act(engine, state, { type: 'advance', units: ['a1', 'aL'], to: 'yO5' }).state;
    const t = act(engine, s, { type: 'endPhase' });
    s = t.state;
    const rolls = t.events.flatMap((e) => (e.type === 'sk1.cc.state' ? ((e.payload as { ambush?: { rolls: Roll[] } }).ambush?.rolls ?? []) : []));
    return { rolls: Object.fromEntries(rolls.map((r) => [r.side, r])) as Record<string, Roll>, engine, s };
  };

  it("a Good Order leader's leadership is a negative drm, named as such", () => {
    const { rolls } = ambush({});
    expect(rolls['am']).toMatchObject({ dr: 4, drm: -2, final: 2, notes: ['-2 leadership'] });
    expect(rolls['ge']).toMatchObject({ dr: 4, drm: -1, final: 3, notes: ['-1 leadership'] });
  });

  it('a pinned 9-1 adds +1 for the pin and no leadership; the log names the pin, not his leadership', () => {
    const { rolls } = ambush({ pinned: true });
    expect(rolls['ge']).toMatchObject({ dr: 4, drm: 1, final: 5, notes: ['+1 Pinned'] });
  });

  it('every part is named, even ones that cancel out: a CX squad with its 9-1 is +1 CX, -1 leadership', () => {
    const { rolls } = ambush({}, { cx: true });
    expect(rolls['ge']).toMatchObject({ drm: 0, final: 4, notes: ['+1 CX', '-1 leadership'] });
  });

  it('a wounded 9-1 has no leadership left to give (SK1 3.2.1): the CX squad is +1 with nothing against it', () => {
    const { rolls } = ambush({ wounds: 1 }, { cx: true });
    expect(rolls['ge']).toMatchObject({ drm: 1, notes: ['+1 CX'] });
  });

  it('the CC goes on after the rolls and the next Player Turn begins with no CC state left', () => {
    const { engine, s: s0 } = ambush({});
    let s = s0;
    for (let guard = 0; guard < 40 && s.phase === 'CCPh'; guard++) s = engine.submit(s, engine.legalActions(s, engine.currentDecision(s)!.owner)[0]!).state;
    expect(s.phase).not.toBe('CCPh');
    expect(s.ext['sk1.cc']).toBeUndefined();
  });
});

describe('Close Combat strengths', () => {
  it('the attack event records each unit\u2019s CC FP behind the odds: a pinned unit\u2019s halved (SK4 Pin)', () => {
    const { engine, state } = makeEngine({
      startPhase: 'APh',
      dice: [6, 6, 6, 6, 6, 6, 6, 6],
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yO5', tags: { pinned: true } },
        { id: 'g2', def: 'ge.467', side: 'ge', hex: 'yO5' },
      ],
    });
    let s: GameState = act(engine, state, { type: 'advance', units: ['a1'], to: 'yO5' }).state;
    s = act(engine, s, { type: 'endPhase' }).state;
    for (let guard = 0; guard < 10 && engine.currentDecision(s)?.kind !== 'ccDeclare'; guard++) s = engine.submit(s, engine.legalActions(s, engine.currentDecision(s)!.owner)[0]!).state;
    s = act(engine, s, { type: 'cc.declare', attacks: [{ attackers: ['a1'], targets: ['g1', 'g2'] }] }).state;
    const t = act(engine, s, { type: 'cc.declare', attacks: [{ attackers: ['g1', 'g2'], targets: ['a1'] }] });
    const ge = t.events.find((e) => e.type === 'sk1.cc.attack' && (e.payload as { side: string }).side === 'ge')!.payload;
    // 2 (pinned, halved) + 4 = 6 against the 7-4-7's 7: 1:2.
    expect(ge).toMatchObject({ odds: '1:2', fp: { attack: [['g1', 2], ['g2', 4]], defense: [['a1', 7]] } });
  });

  it('says why a pinned attacker’s strength is halved (SK1 3.2.3), in its attack only: defending it keeps its full FP (ASLRB A7.8)', () => {
    const { engine, state } = makeEngine({
      startPhase: 'APh',
      dice: [6, 6, 6, 6, 6, 6, 6, 6],
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yO5', tags: { pinned: true } },
      ],
    });
    let s: GameState = act(engine, state, { type: 'advance', units: ['a1'], to: 'yO5' }).state;
    s = act(engine, s, { type: 'endPhase' }).state;
    for (let guard = 0; guard < 10 && engine.currentDecision(s)?.kind !== 'ccDeclare'; guard++) s = engine.submit(s, engine.legalActions(s, engine.currentDecision(s)!.owner)[0]!).state;
    // The preview the CC panel draws: the pinned 4-6-7 attacks at 2 against 7 (1:4) and says why; defending, it is 4.
    const env = engine.env(s);
    const pinnedAttack = ccAttackPreview(env, 'yO5', 'ge', { attackers: ['g1'], targets: ['a1'] });
    expect(pinnedAttack).toMatchObject({ attackFp: 2, defenseFp: 7, odds: '1:4', fpNotes: [{ unit: 'g1', note: 'pinned: FP halved' }] });
    expect(ccAttackPreview(env, 'yO5', 'am', { attackers: ['a1'], targets: ['g1'] })).toMatchObject({ attackFp: 7, defenseFp: 4, odds: '3:2', fpNotes: [] });
    // The attack events record the note as it stood, for the log (the Pin comes off at the end of the Player Turn).
    s = act(engine, s, { type: 'cc.declare', attacks: [{ attackers: ['a1'], targets: ['g1'] }] }).state;
    const t = act(engine, s, { type: 'cc.declare', attacks: [{ attackers: ['g1'], targets: ['a1'] }] });
    const bySide = (side: string) => t.events.find((e) => e.type === 'sk1.cc.attack' && (e.payload as { side: string }).side === side)!.payload as { fp: { notes?: Record<string, string> } };
    expect(bySide('ge').fp).toMatchObject({ attack: [['g1', 2]], notes: { g1: 'pinned: FP halved' } });
    expect(bySide('am').fp).toMatchObject({ defense: [['g1', 4]] });
    expect(bySide('am').fp.notes).toBeUndefined();
  });
});

describe('a pinned leader in CC (SK1 3.2.1, 3.8; ASLRB A11.14, A7.8)', () => {
  // A SMC's CC strength of one is its inherent FP, so a pin halves his attack as it does a squad's; never his defense.
  const ccDeclare = (pieces: PieceSpec[]) => {
    const { engine, state } = makeEngine({ startPhase: 'APh', dice: Array(40).fill(6), pieces });
    let s: GameState = act(engine, state, { type: 'advance', units: ['a1'], to: 'yO5' }).state;
    s = act(engine, s, { type: 'endPhase' }).state;
    for (let guard = 0; guard < 10 && engine.currentDecision(s)?.kind !== 'ccDeclare'; guard++) s = engine.submit(s, engine.legalActions(s, engine.currentDecision(s)!.owner)[0]!).state;
    expect(engine.currentDecision(s)?.kind).toBe('ccDeclare');
    return { engine, s };
  };
  const hs = { id: 'a1', def: 'am.347', side: 'am', hex: 'yN5' };

  it('attacks alone at half a FP: 0.5 against a 3 FP HS is 1:6, and says why; he defends at 1', () => {
    const { engine, s } = ccDeclare([hs, { id: 'l', def: 'ge.L91', side: 'ge', hex: 'yO5', tags: { pinned: true } }]);
    const env = engine.env(s);
    expect(ccAttackPreview(env, 'yO5', 'ge', { attackers: ['l'], targets: ['a1'] })).toMatchObject({ attackFp: 0.5, defenseFp: 3, odds: '1:6', fpNotes: [{ unit: 'l', note: 'pinned: FP halved' }] });
    expect(ccAttackPreview(env, 'yO5', 'am', { attackers: ['a1'], targets: ['l'] })).toMatchObject({ attackFp: 3, defenseFp: 1 });
  });

  it('adds his half to an unpinned squad\'s attack', () => {
    const { engine, s } = ccDeclare([hs, { id: 'l', def: 'ge.L91', side: 'ge', hex: 'yO5', tags: { pinned: true } }, { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yO5' }]);
    expect(ccAttackPreview(engine.env(s), 'yO5', 'ge', { attackers: ['g1', 'l'], targets: ['a1'] })).toMatchObject({ attackFp: 4.5 });
  });

  it('unpinned, he attacks with his full 1', () => {
    const { engine, s } = ccDeclare([hs, { id: 'l', def: 'ge.L91', side: 'ge', hex: 'yO5' }]);
    expect(ccAttackPreview(engine.env(s), 'yO5', 'ge', { attackers: ['l'], targets: ['a1'] })).toMatchObject({ attackFp: 1, fpNotes: [] });
  });
});

describe('Leaders stacked on top of MMC (SK1 3.8)', () => {
  // German 4-6-7s g1 and g2 with a 9-1 in O5; the Americans attack them there.
  const pieces = (leaderTags: Record<string, string> = {}): PieceSpec[] => [
    { id: 'a1', def: 'am.747', side: 'am', hex: 'yO5' },
    { id: 'a2', def: 'am.747', side: 'am', hex: 'yO5' },
    { id: 'aL', def: 'am.L91', side: 'am', hex: 'yO5', tags: { stackedOn: 'a2' } },
    { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yO5' },
    { id: 'g2', def: 'ge.467', side: 'ge', hex: 'yO5' },
    { id: 'gL', def: 'ge.L91', side: 'ge', hex: 'yO5', tags: leaderTags },
  ];
  /** Into the CCPh: the one CC hex is chosen automatically. */
  const toCc = (ps = pieces()) => {
    const { engine, state } = makeEngine({ startPhase: 'APh', dice: Array(20).fill(6), pieces: ps });
    return { engine, s: act(engine, state, { type: 'endPhase' }).state };
  };

  it('before the CC, each side with a leader and two MMC may restack him, the ATTACKER first', () => {
    const { engine, s } = toCc();
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'ccArrange', owner: 'am' });
    // Only leaders in the CC hex, only onto own MMC there.
    expect(engine.validate(s, { type: 'stack.leaderOn', leader: 'aL', on: 'g1', side: 'am', decisionId: engine.currentDecision(s)!.id })).toMatch(/your MMC/);
    let t = act(engine, s, { type: 'stack.leaderOn', leader: 'aL', on: 'a1' }).state;
    expect(t.pieces['aL']!.tags['stackedOn']).toBe('a1');
    t = act(engine, t, { type: 'cc.arranged' }).state;
    expect(engine.currentDecision(t)).toMatchObject({ kind: 'ccArrange', owner: 'ge' });
    t = act(engine, t, { type: 'cc.arranged' }).state;
    expect(engine.currentDecision(t)).toMatchObject({ kind: 'ccDeclare', owner: 'am' });
  });

  it('no arrange step when there is nothing to choose', () => {
    const { engine, s } = toCc(pieces().filter((p) => p.id !== 'a2' && p.id !== 'aL' && p.id !== 'g2'));
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'ccDeclare', owner: 'am' });
  });

  it('a leader defends with the MMC he is stacked on, so it is attacked with him', () => {
    const { engine, s: s0 } = toCc(pieces({ stackedOn: 'g2' }));
    let s = act(engine, s0, { type: 'cc.arranged' }).state;
    s = act(engine, s, { type: 'cc.arranged' }).state;
    const declare = (attacks: { attackers: string[]; targets: string[] }[]) =>
      engine.validate(s, { type: 'cc.declare', attacks, side: 'am', decisionId: engine.currentDecision(s)!.id });
    expect(declare([{ attackers: ['a1'], targets: ['g1', 'gL'] }])).toMatch(/defends together with g2/);
    expect(declare([{ attackers: ['a1'], targets: ['g1'] }])).toBeNull();
    expect(declare([{ attackers: ['a1'], targets: ['g2', 'gL'] }])).toBeNull();
  });

  it('unset, a leader sits on the first unbroken MMC', () => {
    const ps = pieces().map((p) => (p.id === 'g1' ? { ...p, tags: { broken: true } } : p));
    const { engine, s: s0 } = toCc(ps);
    let s = act(engine, s0, { type: 'cc.arranged' }).state;
    s = act(engine, s, { type: 'cc.arranged' }).state;
    expect(engine.validate(s, { type: 'cc.declare', attacks: [{ attackers: ['a1'], targets: ['g2', 'gL'] }], side: 'am', decisionId: engine.currentDecision(s)!.id })).toBeNull();
  });

  it('a leader attacking with MMC must attack with the one he is stacked on; attacking alone, he defends alone', () => {
    const { engine, s: s0 } = toCc();
    let s = act(engine, s0, { type: 'cc.arranged' }).state;
    s = act(engine, s, { type: 'cc.arranged' }).state;
    const v = (attacks: { attackers: string[]; targets: string[] }[]) => engine.validate(s, { type: 'cc.declare', attacks, side: 'am', decisionId: engine.currentDecision(s)!.id });
    expect(v([{ attackers: ['a1', 'aL'], targets: ['g2'] }])).toMatch(/stacked on a2/);
    expect(v([{ attackers: ['a2', 'aL'], targets: ['g2'] }])).toBeNull();
    // The 9-1 attacks alone: the Germans may then attack him on his own, apart from a2.
    s = act(engine, s, { type: 'cc.declare', attacks: [{ attackers: ['aL'], targets: ['g2'] }] }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'ccDeclare', owner: 'ge' });
    expect(engine.validate(s, { type: 'cc.declare', attacks: [{ attackers: ['g1'], targets: ['aL'] }], side: 'ge', decisionId: engine.currentDecision(s)!.id })).toBeNull();
  });

  it('a leader moving with a stack goes on top of an MMC moving with him; one left behind comes off', () => {
    const { engine, state } = makeEngine({
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'a2', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'aL', def: 'am.L91', side: 'am', hex: 'yN5', tags: { stackedOn: 'a2' } },
      ],
      startPhase: 'MPh',
    });
    const s = act(engine, state, { type: 'move.start', units: ['a1', 'aL'] }).state;
    expect(s.pieces['aL']!.tags['stackedOn']).toBe('a1');
    const s2 = act(engine, state, { type: 'move.start', units: ['a2'] }).state;
    expect(s2.pieces['aL']!.tags['stackedOn']).toBeUndefined();
  });

  it('a leader may be restacked in his own phases, not while a stack is moving', () => {
    const { engine, state } = makeEngine({
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'a2', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'aL', def: 'am.L91', side: 'am', hex: 'yN5' },
      ],
      startPhase: 'MPh',
    });
    expect(act(engine, state, { type: 'stack.leaderOn', leader: 'aL', on: 'a2' }).state.pieces['aL']!.tags['stackedOn']).toBe('a2');
    const moving = act(engine, state, { type: 'move.start', units: ['a1'] }).state;
    expect(() => act(engine, moving, { type: 'stack.leaderOn', leader: 'aL', on: 'a2' })).toThrow(/Finish moving/);
  });
});

describe('Close Combat previews for the interface (SK1 3.8)', () => {
  const pieces: PieceSpec[] = [
    { id: 'a1', def: 'am.747', side: 'am', hex: 'yO5' },
    { id: 'a2', def: 'am.747', side: 'am', hex: 'yO5' },
    { id: 'aL', def: 'am.L91', side: 'am', hex: 'yO5', tags: { stackedOn: 'a1' } },
    { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yO5' },
    { id: 'g2', def: 'ge.467', side: 'ge', hex: 'yO5' },
    { id: 'gL', def: 'ge.L91', side: 'ge', hex: 'yO5', tags: { stackedOn: 'g2' } },
  ];
  const toDeclare = () => {
    const { engine, state } = makeEngine({ startPhase: 'APh', dice: Array(20).fill(6), pieces });
    let s: GameState = act(engine, state, { type: 'endPhase' }).state;
    s = act(engine, s, { type: 'cc.arranged' }).state;
    s = act(engine, s, { type: 'cc.arranged' }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'ccDeclare', owner: 'am' });
    return { engine, s };
  };

  it('a preview gives the strengths, the odds column, the DRM with its notes and the legality', () => {
    const { engine, s } = toDeclare();
    const env = engine.env(s);
    // 7 + 1 vs 4 → 2:1, the leader directing at -1.
    const p = ccAttackPreview(env, 'yO5', 'am', { attackers: ['a1', 'aL'], targets: ['g1'] });
    expect(p).toMatchObject({ attackFp: 8, defenseFp: 4, odds: '2:1', kill: 7, drm: -1, illegal: null });
    expect(p.drmNotes.map((n) => n.label)).toEqual(['leadership']);
    // The leader alone directs nothing; 1 vs 4 is 1:4.
    expect(ccAttackPreview(env, 'yO5', 'am', { attackers: ['aL'], targets: ['g1'] })).toMatchObject({ attackFp: 1, defenseFp: 4, odds: '1:4', drm: 0, illegal: null });
    // Targeting a leader without the MMC he sits on is illegal, and an empty group has no odds.
    expect(ccAttackPreview(env, 'yO5', 'am', { attackers: ['a1'], targets: ['gL'] }).illegal).toMatch(/defends together with g2/);
    expect(ccAttackPreview(env, 'yO5', 'am', { attackers: [], targets: [] })).toMatchObject({ odds: null, kill: 0, drm: 0 });
    expect(ccAttackPreview(env, 'yO5', 'am', { attackers: [], targets: [] }).illegal).toMatch(/needs attackers and targets/);
  });

  it('a defensive group is the MMC with the leaders stacked on him', () => {
    const { engine, s } = toDeclare();
    const env = engine.env(s);
    expect(ccDefensiveGroup(env, 'gL')).toEqual(['g2', 'gL']);
    expect(ccDefensiveGroup(env, 'g2')).toEqual(['g2', 'gL']);
    expect(ccDefensiveGroup(env, 'g1')).toEqual(['g1']);
  });

  it('a side may split its units into several attacks, each resolved on its own roll', () => {
    const { engine, s: s0 } = toDeclare();
    const attacks = [
      { attackers: ['a1', 'aL'], targets: ['g1'] },
      { attackers: ['a2'], targets: ['g2', 'gL'] },
    ];
    const t = act(engine, s0, { type: 'cc.declare', attacks });
    expect(engine.currentDecision(t.state)).toMatchObject({ kind: 'ccDeclare', owner: 'ge' });
    const u = act(engine, t.state, { type: 'cc.declare', attacks: [{ attackers: ['g1'], targets: ['a1', 'aL'] }] });
    const cc = u.events.filter((e) => e.type === 'sk1.cc.attack').map((e) => e.payload as { side: string; odds: string });
    expect(cc).toEqual([
      expect.objectContaining({ side: 'am', odds: '2:1' }),
      expect.objectContaining({ side: 'am', odds: '1:1' }),
      expect.objectContaining({ side: 'ge', odds: '1:2' }),
    ]);
  });
});

describe('Simultaneous resolution (SK1 3.8)', () => {
  it("a squad reduced by the other side's attack still strikes back at its full strength", () => {
    const GE_VS_RU = {
      firstSide: 'ge',
      sides: [
        { side: 'ge', name: 'German', nationality: 'ge', elr: 3 },
        { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 },
      ],
    };
    // Two German 4-6-7s attack a Russian 4-2-6 at 2:1 (kill 7); the Russian attacks one of them at 1:1 (kill 5).
    // The German DR of 7 reduces the Russian; the Russian DR of 5 is rolled by the squad as it stood, so it still
    // Casualty Reduces its target rather than being read as a 2-2-6 attacking at 1:2 (kill 4).
    const { engine, state } = makeEngine({
      scenario: GE_VS_RU,
      startPhase: 'APh',
      dice: [3, 4, 2, 3, 6, 6, 6, 6],
      pieces: [
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yO5' },
        { id: 'g2', def: 'ge.467', side: 'ge', hex: 'yO5' },
        { id: 'r1', def: 'ru.426', side: 'ru', hex: 'yO5' },
      ],
    });
    let s: GameState = act(engine, state, { type: 'endPhase' }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'ccDeclare', owner: 'ge' });
    s = act(engine, s, { type: 'cc.declare', attacks: [{ attackers: ['g1', 'g2'], targets: ['r1'] }] }).state;
    const t = act(engine, s, { type: 'cc.declare', attacks: [{ attackers: ['r1'], targets: ['g1'] }] });
    const cc = t.events.filter((e) => e.type === 'sk1.cc.attack').map((e) => e.payload);
    expect(cc).toEqual([
      expect.objectContaining({ side: 'ge', odds: '2:1', kill: 7, dr: 7, result: 'casualty reduction' }),
      expect.objectContaining({ side: 'ru', odds: '1:1', kill: 5, dr: 5, result: 'casualty reduction' }),
    ]);
    expect(t.state.pieces['r1']!.defId).toBe('ru.226');
    expect(t.state.pieces['g1']!.defId).toBe('ge.247');
    expect(t.state.pieces['g2']!.defId).toBe('ge.467');
  });
});

describe('Field Promotion in simultaneous CC (SK1 5.3, ASLRB A18.12)', () => {
  it('an MMC eliminated by the other side still rolls Leader Creation on its original 2, and the leader joins both attacks', () => {
    const GE_VS_RU = {
      firstSide: 'ge',
      sides: [
        { side: 'ge', name: 'German', nationality: 'ge', elr: 3 },
        { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 },
      ],
    };
    // Two German 4-6-7s attack the Russian 4-2-6 at 2:1 with a DR of 3; the Russian attacks g1 at 1:1 and rolls 1,1.
    // Its Leader Creation dr of 3 makes an 8-1, who was "there all along": the German attack is re-figured at 8 vs 5
    // (3:2, kill 6) and still eliminates both, the Russian attack at 5 vs 4 (still 1:1), DR 2 -1, eliminates g1.
    const { engine, state } = makeEngine({
      scenario: GE_VS_RU,
      startPhase: 'APh',
      dice: [1, 2, 1, 1, 3, 6, 6, 6, 6],
      tables: { leaderCreation: (nat, _morale, dr) => (dr <= 3 ? `${nat}.L81` : null) },
      pieces: [
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yO5' },
        { id: 'g2', def: 'ge.467', side: 'ge', hex: 'yO5' },
        { id: 'r1', def: 'ru.426', side: 'ru', hex: 'yO5' },
      ],
    });
    let s: GameState = act(engine, state, { type: 'endPhase' }).state;
    s = act(engine, s, { type: 'cc.declare', attacks: [{ attackers: ['g1', 'g2'], targets: ['r1'] }] }).state;
    const t = act(engine, s, { type: 'cc.declare', attacks: [{ attackers: ['r1'], targets: ['g1'] }] });
    const created = t.events.find((e) => e.type === 'sk1.leaderCreation')!.payload as { unit: string; leader: string | null; defId: string | null };
    expect(created).toMatchObject({ unit: 'r1', defId: 'ru.L81' });
    const leader = created.leader!;
    expect(t.events.find((e) => e.type === 'piece.tagged' && (e.payload as { id: string }).id === leader)!.payload).toMatchObject({ tags: { stackedOn: 'r1' } });
    const cc = t.events.filter((e) => e.type === 'sk1.cc.attack').map((e) => e.payload);
    expect(cc).toEqual([
      expect.objectContaining({ side: 'ge', attack: { attackers: ['g1', 'g2'], targets: ['r1', leader] }, odds: '3:2', kill: 6, dr: 3, result: 'eliminated' }),
      expect.objectContaining({ side: 'ru', attack: { attackers: ['r1', leader], targets: ['g1'] }, odds: '1:1', kill: 5, dr: 2, drm: -1, result: 'eliminated' }),
    ]);
    expect(t.state.pieces['r1']!.loc.kind).toBe('eliminated');
    expect(t.state.pieces[leader]!.loc.kind).toBe('eliminated');
    expect(t.state.pieces['g1']!.loc.kind).toBe('eliminated');
    // The leader who lived and died in the one CC still counts as a casualty for the Germans' CVP.
    const cvp = t.events.filter((e) => e.type === 'sk1.casualty').map((e) => e.payload as { unit: string; vp: number });
    expect(cvp).toEqual(expect.arrayContaining([expect.objectContaining({ unit: leader, vp: 2 }), expect.objectContaining({ unit: 'r1', vp: 2 })]));
  });
});

describe('Fire at a hex where a Melee has ended (SK1 3.2, 3.8)', () => {
  // SK1 3.8: "Remove the Melee counter as soon as no unbroken unit remains"; the broken units of both sides are still
  // in the hex. SK1 3.2: "Fire attacks ordinarily affect all units in the target hex", so a later attack there hits
  // the firer's own broken units too, not only the enemy's.
  const game = (melee: boolean) =>
    makeEngine({
      startPhase: 'PFPh',
      dice: [3, 3, 6, 6, 6, 6, 6, 6],
      ...(melee ? { hexMarkers: { yP5: { melee: true } } } : {}),
      pieces: [
        { id: 'f1', def: 'am.747', side: 'am', hex: 'yO5' },
        { id: 'gB', def: 'ge.447', side: 'ge', hex: 'yP5', tags: { broken: true } },
        { id: 'gL', def: 'ge.L80', side: 'ge', hex: 'yP5', tags: { broken: true } },
        { id: 'aB', def: 'am.747', side: 'am', hex: 'yP5', tags: { broken: true } },
      ],
    });
  const attacked = (melee: boolean) => {
    const { engine, state } = game(melee);
    const t = act(engine, state, { type: 'fire', decl: { units: ['f1'], sw: [], target: 'yP5' } });
    return t.events.filter((e) => e.type === 'sk1.fire.result').map((e) => (e.payload as { unit: string }).unit).sort();
  };

  it('a Melee counter with no unbroken unit left in the hex comes off', () => {
    const { engine, state } = game(true);
    const s = act(engine, state, { type: 'fire', decl: { units: ['f1'], sw: [], target: 'yP5' } }).state;
    expect(s.hexMarkers['yP5']?.['melee']).toBeUndefined();
  });

  it('a fire attack there still hits every unit in the hex, the firer’s own broken units included', () => {
    expect(attacked(false)).toEqual(['aB', 'gB', 'gL']);
    expect(attacked(true)).toEqual(['aB', 'gB', 'gL']);
  });
});
