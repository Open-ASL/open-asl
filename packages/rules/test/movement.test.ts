import { describe, expect, it } from 'vitest';
import { RU_VS_GE, act, makeEngine } from './fixtures';
import { moveState, roadBonusEarned } from '../src';

// SK1 MPh/DFPh example, figure 2 (board z).
const terrain = {
  zJ3: { terrain: 'building-stone' },
  zK5: { terrain: 'building-stone' },
};

describe('Movement Phase', () => {
  const setup = (dice: number[] = []) =>
    makeEngine({
      board: 'z',
      terrain,
      scenario: RU_VS_GE,
      startPhase: 'MPh',
      dice,
      pieces: [
        { id: 'r1', def: 'ru.447', side: 'ru', hex: 'zI4' },
        { id: 'rMMG', def: 'ru.MMG', side: 'ru', heldBy: 'r1' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'zK5' },
        { id: 'gMMG', def: 'ge.MMG', side: 'ge', heldBy: 'g1' },
      ],
    });

  it('portage: a 5PP MMG leaves a 4-4-7 two MF, three when Double Timing', () => {
    const { engine, state } = setup();
    const plain = act(engine, state, { type: 'move.start', units: ['r1'] }).state;
    expect(moveState({ state: plain } as never)!.allowance['r1']).toBe(2);
    const dt = act(engine, state, { type: 'move.start', units: ['r1'], doubleTime: true }).state;
    expect(moveState({ state: dt } as never)!.allowance['r1']).toBe(3);
    expect(dt.pieces['r1']!.tags['cx']).toBe(true);
  });

  it('a CX counter comes off at the start of the next MPh, which still forbids Double Time (SK1 3.3)', () => {
    // The Russian squad went CX last turn: its Prep Fire Phase now, the MPh next.
    const { engine, state } = makeEngine({
      board: 'z',
      terrain,
      scenario: RU_VS_GE,
      startPhase: 'PFPh',
      pieces: [
        { id: 'r1', def: 'ru.447', side: 'ru', hex: 'zI4', tags: { cx: true } },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'zK5' },
      ],
    });
    const mph = act(engine, state, { type: 'endPhase' }).state;
    expect(mph.phase).toBe('MPh');
    expect(mph.pieces['r1']!.tags['cx']).toBeUndefined();
    const d = engine.currentDecision(mph)!;
    expect(engine.validate(mph, { type: 'move.start', units: ['r1'], doubleTime: true, side: 'ru', decisionId: d.id } as never)).toMatch(/cannot Double Time/);
    expect(engine.validate(mph, { type: 'move.start', units: ['r1'], side: 'ru', decisionId: d.id } as never)).toBeNull();
    // Once this MPh is over the unit is free to Double Time again.
    const after = act(engine, mph, { type: 'endPhase' }).state;
    expect(after.pieces['r1']!.tags['cxPrev']).toBeUndefined();
  });

  it('First Fire on a moving stack: FFNAM/FFMO, Residual FP and First Fire markers', () => {
    // German 4-6-7 fires at J3: DR 4+3 (+2 DRM) → no effect. MMG fires at K3: DR 5+4 (-2 DRM).
    const { engine, state } = setup([4, 3, 5, 4]);
    let s = act(engine, state, { type: 'move.start', units: ['r1'], doubleTime: true }).state;
    s = act(engine, s, { type: 'move.step', to: 'zJ3' }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'firstFire', owner: 'ge' });

    let t = act(engine, s, { type: 'defFire', decl: { units: ['g1'], sw: [], target: 'zJ3' } });
    const a1 = t.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { fp: number; column: number; drm: number };
    expect(a1).toMatchObject({ fp: 4, column: 4, drm: 2 });
    expect(t.state.hexMarkers['zJ3']).toMatchObject({ residualFp: 2 });
    expect(t.state.pieces['g1']!.tags['fire']).toBe('first');
    // The MMG could still fire here, so the defender is asked again; pass.
    s = act(engine, t.state, { type: 'defPass' }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'phase', owner: 'ru' });

    s = act(engine, s, { type: 'move.step', to: 'zK3' }).state;
    t = act(engine, s, { type: 'defFire', decl: { units: [], sw: ['gMMG'], target: 'zK3' } });
    const a2 = t.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { fp: number; column: number; drm: number };
    expect(a2).toMatchObject({ fp: 5, column: 4, drm: -2 });
    expect(t.state.pieces['gMMG']!.tags['fire']).toBe('first');
    expect(t.state.hexMarkers['zK3']).toMatchObject({ residualFp: 2 });
  });

  it('a Residual FP attack names its DRM: FFNAM and FFMO apply (SK1 3.3.1)', () => {
    // r1 walks I4-J3-K3 and the MMG fires at K3 (DR 5+4), leaving 2 Residual FP; r2 follows into K3 (DR 6+6).
    const { engine, state } = makeEngine({
      board: 'z',
      terrain,
      scenario: RU_VS_GE,
      startPhase: 'MPh',
      dice: [5, 4, 6, 6],
      pieces: [
        { id: 'r1', def: 'ru.447', side: 'ru', hex: 'zI4' },
        { id: 'r2', def: 'ru.447', side: 'ru', hex: 'zI4' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'zK5' },
        { id: 'gMMG', def: 'ge.MMG', side: 'ge', heldBy: 'g1' },
      ],
    });
    const go = (st: typeof state, a: Record<string, unknown>) => ({ s: act(engine, st, a as never).state });
    let s = go(state, { type: 'move.start', units: ['r1'] }).s;
    s = go(s, { type: 'move.step', to: 'zJ3' }).s;
    if (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
    s = go(s, { type: 'move.step', to: 'zK3' }).s;
    s = act(engine, s, { type: 'defFire', decl: { units: [], sw: ['gMMG'], target: 'zK3' } }).state;
    if (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
    expect(s.hexMarkers['zK3']).toMatchObject({ residualFp: 2 });
    s = go(s, { type: 'move.end' }).s;
    s = go(s, { type: 'move.start', units: ['r2'] }).s;
    s = go(s, { type: 'move.step', to: 'zJ3' }).s;
    if (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
    const r = act(engine, s, { type: 'move.step', to: 'zK3' });
    const residual = r.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { fp: number; drm: number; explain: { label?: string }[] };
    expect(residual).toMatchObject({ fp: 2, drm: -2 });
    expect(residual.explain.map((n) => n.label)).toEqual(['Residual FP 2 (Open Ground)', '-1 FFNAM', '-1 FFMO']);
  });

  it('the Mandatory Fire Group binds per moving stack and MF expenditure, not per hex (SK1 1.2.4, ASLRB A7.55)', () => {
    // Tester report: a squad fired its LMG alone at one stack entering a hex; when a second stack entered the
    // same hex later, the squad's own FP was refused ("already attacked ... this phase"). The rule asks for one
    // FG only against the same unit on the same expenditure.
    const { engine, state } = makeEngine({
      board: 'z',
      terrain,
      scenario: RU_VS_GE,
      startPhase: 'MPh',
      dice: [5, 6, 5, 6, 5, 6],
      pieces: [
        { id: 'r1', def: 'ru.447', side: 'ru', hex: 'zI4' },
        { id: 'r2', def: 'ru.447', side: 'ru', hex: 'zI4' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'zK5' },
        { id: 'gLMG', def: 'ge.LMG', side: 'ge', heldBy: 'g1' },
        // A squad in another hex keeps the defender's question open after the LMG shot.
        { id: 'g2', def: 'ge.467', side: 'ge', hex: 'zK4' },
      ],
    });
    const passes = (st: typeof state) => {
      while (engine.currentDecision(st)?.kind === 'firstFire') st = act(engine, st, { type: 'defPass' }).state;
      return st;
    };
    const decision = (st: typeof state) => engine.currentDecision(st)!;
    let s = act(engine, state, { type: 'move.start', units: ['r1'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'zJ3' }).state;
    expect(decision(s)).toMatchObject({ kind: 'firstFire', owner: 'ge' });
    s = act(engine, s, { type: 'defFire', decl: { units: [], sw: ['gLMG'], target: 'zJ3' } }).state;
    // The squad's own FP against the same stack on the same expenditure would have had to join the LMG;
    // the squad in the other hex is not bound.
    expect(decision(s)).toMatchObject({ kind: 'firstFire', owner: 'ge' });
    expect(engine.validate(s, { type: 'defFire', decl: { units: ['g1'], sw: [], target: 'zJ3' }, side: 'ge', decisionId: decision(s).id } as never)).toMatch(/this MF expenditure .*one Fire Group/);
    expect(engine.validate(s, { type: 'defFire', decl: { units: ['g2'], sw: [], target: 'zJ3' }, side: 'ge', decisionId: decision(s).id } as never)).toBeNull();
    s = passes(s);
    s = act(engine, s, { type: 'move.end' }).state;
    s = passes(s);

    // A second stack entering the hex is a new target: the squad's FP fires at it on its own.
    s = act(engine, s, { type: 'move.start', units: ['r2'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'zJ3' }).state;
    expect(decision(s)).toMatchObject({ kind: 'firstFire', owner: 'ge' });
    expect(engine.validate(s, { type: 'defFire', decl: { units: ['g1'], sw: [], target: 'zJ3' }, side: 'ge', decisionId: decision(s).id } as never)).toBeNull();
    const t = act(engine, s, { type: 'defFire', decl: { units: ['g1'], sw: [], target: 'zJ3' } });
    expect(t.events.find((e) => e.type === 'sk1.fire.attack')!.payload).toMatchObject({ fp: 4 });
    expect(t.state.pieces['g1']!.tags['fire']).toBe('first');
  });

  it('a Fire Group may mix a unit marked First Fire (Subsequent First Fire) with one firing for the first time', () => {
    // Tester report: "must be marked First Fire for Subsequent First Fire" refused such a group. SK1 3.3.1
    // defines SFF per unit and the FG rules (3.2) ask only for adjacency and LOS: each firer is judged by
    // its own marker. The 4-6-7 already marked fires at half FP (2), its fellow at full (4): 6 FP column.
    const { engine, state } = makeEngine({
      board: 'z',
      terrain,
      scenario: RU_VS_GE,
      startPhase: 'MPh',
      dice: [4, 3, 3, 4],
      pieces: [
        { id: 'r1', def: 'ru.447', side: 'ru', hex: 'zI4' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'zK5', tags: { fire: 'first' } },
        { id: 'g2', def: 'ge.467', side: 'ge', hex: 'zK5' },
        { id: 'gMMG', def: 'ge.MMG', side: 'ge', heldBy: 'g1' },
      ],
    });
    let s = act(engine, state, { type: 'move.start', units: ['r1'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'zJ3' }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'firstFire', owner: 'ge' });
    const t = act(engine, s, { type: 'defFire', decl: { units: ['g1', 'g2'], sw: [], target: 'zJ3' } });
    const a = t.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { fp: number; column: number };
    expect(a).toMatchObject({ fp: 6, column: 6 });
    // The unit firing again flips to Final Fire with its unfired MMG; the other is marked First Fire.
    expect(t.state.pieces['g1']!.tags['fire']).toBe('final');
    expect(t.state.pieces['gMMG']!.tags['fire']).toBe('final');
    expect(t.state.pieces['g2']!.tags['fire']).toBe('first');
  });

  it('a Fire Group may mix a unit using FPF with one firing for the first time: only the FPF user takes the NMC', () => {
    const { engine, state } = makeEngine({
      board: 'z',
      terrain,
      scenario: RU_VS_GE,
      startPhase: 'MPh',
      dice: [5, 6, 3, 4, 3, 4, 3, 4],
      pieces: [
        { id: 'r1', def: 'ru.447', side: 'ru', hex: 'zK3' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'zK5', tags: { fire: 'final' } },
        { id: 'g2', def: 'ge.467', side: 'ge', hex: 'zK5' },
      ],
    });
    let s = act(engine, state, { type: 'move.start', units: ['r1'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'zK4' }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'firstFire', owner: 'ge' });
    const t = act(engine, s, { type: 'defFire', decl: { units: ['g1', 'g2'], sw: [], target: 'zK4' } });
    // Point Blank Fire doubles both; the FPF user is halved first: 4 + 8 = 12 FP.
    const a = t.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { fp: number; column: number };
    expect(a).toMatchObject({ fp: 12, column: 12 });
    const fpfChecks = t.events.filter((e) => e.type === 'sk1.check' && (e.payload as { reason?: string }).reason === 'FPF').map((e) => (e.payload as { unit: string }).unit);
    expect(fpfChecks).toEqual(['g1']);
    expect(t.state.pieces['g1']!.tags['fire']).toBe('final');
    expect(t.state.pieces['g2']!.tags['fire']).toBe('first');
  });

  it('FPF NMC: the Original DR plus the director\'s leadership, but never on the leader himself (ASLRB A8.31 EX)', () => {
    // Original DR 8: the 8-1 is pinned (8 vs 8), the 4-6-7 he directed is pinned too (8 -1 = 7 vs 7).
    const { engine, state } = makeEngine({
      board: 'z',
      terrain,
      scenario: RU_VS_GE,
      startPhase: 'MPh',
      dice: [5, 3],
      pieces: [
        { id: 'r1', def: 'ru.447', side: 'ru', hex: 'zK3' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'zK5', tags: { fire: 'final' } },
        { id: 'gL', def: 'ge.L81', side: 'ge', hex: 'zK5', tags: { fire: 'final' } },
      ],
    });
    let s = act(engine, state, { type: 'move.start', units: ['r1'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'zK4' }).state;
    const t = act(engine, s, { type: 'defFire', decl: { units: ['g1'], sw: [], target: 'zK4', directors: ['gL'] } });
    const checks = t.events.filter((e) => e.type === 'sk1.check' && (e.payload as { reason?: string }).reason === 'FPF').map((e) => e.payload);
    expect(checks).toEqual([
      expect.objectContaining({ unit: 'g1', dr: 8, drm: -1, final: 7, target: 7, outcome: 'pinned' }),
      expect.objectContaining({ unit: 'gL', dr: 8, drm: 0, final: 8, target: 8, outcome: 'pinned' }),
    ]);
  });

  it('a squad out of range of a moving stack still offers its LMG for Defensive First Fire', () => {
    // A 5-2-7 reaches four hexes at long range; its LMG six. The Germans step to five hexes away.
    const { engine, state } = makeEngine({
      board: 'z',
      scenario: { ...RU_VS_GE, firstSide: 'ge' },
      startPhase: 'MPh',
      pieces: [
        { id: 'r1', def: 'ru.527', side: 'ru', hex: 'zK5' },
        { id: 'rLMG', def: 'ru.LMG', side: 'ru', heldBy: 'r1' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'zE5' },
      ],
    });
    let s = act(engine, state, { type: 'move.start', units: ['g1'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'zF5' }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'firstFire', owner: 'ru' });
    const t = act(engine, s, { type: 'defFire', decl: { units: [], sw: ['rLMG'], target: 'zF5' } });
    expect(t.events.some((e) => e.type === 'sk1.fire.attack')).toBe(true);
  });

  it('a defender whose units are all marked First Fire is still asked, for Subsequent First Fire', () => {
    const { engine, state } = makeEngine({
      board: 'z',
      terrain,
      scenario: RU_VS_GE,
      startPhase: 'MPh',
      dice: [4, 3, 3, 4],
      pieces: [
        { id: 'r1', def: 'ru.447', side: 'ru', hex: 'zI4' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'zK5', tags: { fire: 'first' } },
      ],
    });
    let s = act(engine, state, { type: 'move.start', units: ['r1'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'zJ3' }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'firstFire', owner: 'ge' });
    expect(engine.legalActions(s, 'ge').some((a) => a.type === 'defFire')).toBe(true);
    const t = act(engine, s, { type: 'defFire', decl: { units: ['g1'], sw: [], target: 'zJ3' } });
    expect((t.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { fp: number }).fp).toBe(2);
    expect(t.state.pieces['g1']!.tags['fire']).toBe('final');
  });

  it('a broken unit not under DM is placed under DM when an enemy moves adjacent to it (SK1 3.2.1)', () => {
    const { engine, state } = makeEngine({
      board: 'z',
      terrain,
      scenario: RU_VS_GE,
      startPhase: 'MPh',
      pieces: [
        { id: 'r1', def: 'ru.447', side: 'ru', hex: 'zK2' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'zK5', tags: { broken: true } },
      ],
    });
    let s = act(engine, state, { type: 'move.start', units: ['r1'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'zK3' }).state;
    // Two hexes away: not adjacent, no DM yet.
    expect(s.pieces['g1']!.tags['dm']).toBeUndefined();
    const t = act(engine, s, { type: 'move.step', to: 'zK4' });
    expect(t.state.pieces['g1']!.tags['dm']).toBe(true);
  });

  it('road bonus: earned only by road steps, and never spent on Smoke', () => {
    const road = { terrain: 'open', features: ['road:dirt'] };
    const { engine, state } = makeEngine({
      board: 'z',
      terrain: { zQ1: road, zQ2: road, zQ3: road, zQ4: road, zQ5: road, zQ6: road },
      roadHexsides: [['zQ1', 'zQ2'], ['zQ2', 'zQ3'], ['zQ3', 'zQ4'], ['zQ4', 'zQ5'], ['zQ5', 'zQ6']],
      scenario: { ...RU_VS_GE, firstSide: 'ge' },
      startPhase: 'MPh',
      pieces: [
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'zQ1' },
        { id: 'r1', def: 'ru.447', side: 'ru', hex: 'zA1' },
      ],
    });
    const step = (st: typeof state, to: string) => {
      const next = act(engine, st, { type: 'move.step', to }).state;
      return engine.currentDecision(next)?.kind === 'firstFire' ? act(engine, next, { type: 'defPass' }).state : next;
    };
    let s = act(engine, state, { type: 'move.start', units: ['g1'] }).state;
    expect(moveState({ state: s } as never)!.allowance['g1']).toBe(4);
    for (const to of ['zQ2', 'zQ3', 'zQ4', 'zQ5']) s = step(s, to);
    // All 4 MF spent along the road: the bonus pays for one more road step, but not for Smoke.
    expect(engine.validate(s, { type: 'move.smoke', unit: 'g1', target: 'zQ5', side: 'ge', decisionId: engine.currentDecision(s)!.id } as never)).toMatch(/MF/);
    expect(engine.validate(s, { type: 'move.step', to: 'zR5', side: 'ge', decisionId: engine.currentDecision(s)!.id } as never)).toMatch(/MF/);
    s = step(s, 'zQ6');
    expect(s.pieces['g1']!.loc).toEqual({ kind: 'hex', hex: 'zQ6' });

    // Leaving the road forfeits the bonus: three road hexes then open ground leaves no fifth MF.
    let t = act(engine, state, { type: 'move.start', units: ['g1'] }).state;
    for (const to of ['zQ2', 'zQ3', 'zQ4', 'zR4']) t = step(t, to);
    expect(() => act(engine, t, { type: 'move.step', to: 'zR5' })).toThrow(/MF/);
  });

  it('road bonus: forfeited by entering Smoke (SK1 1.1.1), even along the road', () => {
    const road = { terrain: 'open', features: ['road:dirt'] };
    const { engine, state } = makeEngine({
      board: 'z',
      terrain: { zQ1: road, zQ2: road, zQ3: road, zQ4: road, zQ5: road, zQ6: road },
      roadHexsides: [['zQ1', 'zQ2'], ['zQ2', 'zQ3'], ['zQ3', 'zQ4'], ['zQ4', 'zQ5'], ['zQ5', 'zQ6']],
      scenario: { ...RU_VS_GE, firstSide: 'ge' },
      startPhase: 'MPh',
      pieces: [
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'zQ1' },
        { id: 'r1', def: 'ru.447', side: 'ru', hex: 'zA1' },
      ],
      hexMarkers: { zQ3: { smoke: true } },
    });
    const step = (st: typeof state, to: string) => {
      const next = act(engine, st, { type: 'move.step', to }).state;
      return engine.currentDecision(next)?.kind === 'firstFire' ? act(engine, next, { type: 'defPass' }).state : next;
    };
    // Q2 (1 MF), Q3 through Smoke (road 1 + Smoke 1 = 2 MF), Q4 (1 MF): 4 MF spent, every hexside a road.
    let s = act(engine, state, { type: 'move.start', units: ['g1'] }).state;
    for (const to of ['zQ2', 'zQ3', 'zQ4']) s = step(s, to);
    expect(moveState({ state: s } as never)!.spent['g1']).toBe(4);
    expect(roadBonusEarned(moveState({ state: s } as never)!)).toBe(false);
    // No fifth MF: the Smoke hex cost the road bonus.
    expect(() => act(engine, s, { type: 'move.step', to: 'zQ5' })).toThrow(/MF/);

    // Nor does the bonus pay for the step into Smoke itself: Q2..Q5 on 4 MF, then Smoke in Q6 needs 2.
    const { engine: e2, state: s2 } = makeEngine({
      board: 'z',
      terrain: { zQ1: road, zQ2: road, zQ3: road, zQ4: road, zQ5: road, zQ6: road },
      roadHexsides: [['zQ1', 'zQ2'], ['zQ2', 'zQ3'], ['zQ3', 'zQ4'], ['zQ4', 'zQ5'], ['zQ5', 'zQ6']],
      scenario: { ...RU_VS_GE, firstSide: 'ge' },
      startPhase: 'MPh',
      pieces: [
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'zQ1' },
        { id: 'r1', def: 'ru.447', side: 'ru', hex: 'zA1' },
      ],
      hexMarkers: { zQ6: { smoke: true } },
    });
    let t = act(e2, s2, { type: 'move.start', units: ['g1'] }).state;
    for (const to of ['zQ2', 'zQ3', 'zQ4', 'zQ5']) {
      t = act(e2, t, { type: 'move.step', to }).state;
      if (e2.currentDecision(t)?.kind === 'firstFire') t = act(e2, t, { type: 'defPass' }).state;
    }
    expect(roadBonusEarned(moveState({ state: t } as never)!)).toBe(true);
    expect(() => act(e2, t, { type: 'move.step', to: 'zQ6' })).toThrow(/MF/);
  });

  it('a SMC wounded on the way drops to 3 MF at once and cannot Double Time (SK1 3.3)', () => {
    // Tester report: a leader wounded by Defensive First Fire after 3+ MF kept his 8 MF allowance and walked on.
    const setup = (doubleTime: boolean) =>
      makeEngine({
        board: 'z',
        scenario: { ...RU_VS_GE, firstSide: 'ge' },
        startPhase: 'MPh',
        // 4 FP column, -2 DRM (FFNAM, FFMO): DR 1+3 = 2 → K/1; wound severity 2 → wounded (no MC for the SMC).
        dice: [1, 3, 2],
        pieces: [
          { id: 'gL', def: 'ge.L81', side: 'ge', hex: 'zQ1' },
          { id: 'r1', def: 'ru.447', side: 'ru', hex: 'zQ8' },
        ],
      });
    const walk = (engine: ReturnType<typeof setup>['engine'], st: ReturnType<typeof setup>['state'], hexes: string[]) => {
      for (const to of hexes) {
        st = act(engine, st, { type: 'move.step', to }).state;
        if (engine.currentDecision(st)?.kind === 'firstFire') st = act(engine, st, { type: 'defPass' }).state;
      }
      return st;
    };
    // Three MF spent, then the wound: finished where he stands.
    {
      const { engine, state } = setup(false);
      let s = act(engine, state, { type: 'move.start', units: ['gL'] }).state;
      s = walk(engine, s, ['zQ2', 'zQ3']);
      s = act(engine, s, { type: 'move.step', to: 'zQ4' }).state;
      expect(engine.currentDecision(s)).toMatchObject({ kind: 'firstFire', owner: 'ru' });
      s = act(engine, s, { type: 'defFire', decl: { units: ['r1'], sw: [], target: 'zQ4' } }).state;
      expect(s.pieces['gL']!.tags['wounds']).toBe(1);
      expect(s.pieces['gL']!.tags['moved']).toBe(true);
      expect(moveState({ state: s } as never)).toBeUndefined();
      expect(engine.legalActions(s, 'ge').some((a) => a.type === 'move.step')).toBe(false);
    }
    // Double Time (8 MF), wounded after 2: one MF of a wounded SMC's three is left, no more.
    {
      const { engine, state } = setup(true);
      let s = act(engine, state, { type: 'move.start', units: ['gL'], doubleTime: true }).state;
      expect(moveState({ state: s } as never)!.allowance['gL']).toBe(8);
      s = walk(engine, s, ['zQ2']);
      s = act(engine, s, { type: 'move.step', to: 'zQ3' }).state;
      s = act(engine, s, { type: 'defFire', decl: { units: ['r1'], sw: [], target: 'zQ3' } }).state;
      expect(s.pieces['gL']!.tags['wounds']).toBe(1);
      const ms = moveState({ state: s } as never)!;
      expect(ms.allowance['gL']).toBe(3);
      expect(ms.spent['gL']).toBe(2);
      s = walk(engine, s, ['zQ4']);
      expect(s.pieces['gL']!.loc).toEqual({ kind: 'hex', hex: 'zQ4' });
      expect(moveState({ state: s } as never)).toBeUndefined();
    }
  });

  it('a stack breaks up: the unit out of MF stops, the rest move on (SK1 3.3)', () => {
    const { engine, state } = makeEngine({
      board: 'z',
      terrain,
      scenario: RU_VS_GE,
      startPhase: 'MPh',
      pieces: [
        { id: 'r1', def: 'ru.447', side: 'ru', hex: 'zI4' },
        { id: 'rMMG', def: 'ru.MMG', side: 'ru', heldBy: 'r1' },
        { id: 'r2', def: 'ru.447', side: 'ru', hex: 'zI4' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'zK5' },
      ],
    });
    let s = act(engine, state, { type: 'move.start', units: ['r1', 'r2'] }).state;
    expect(engine.legalActions(s, 'ru').some((a) => a.type === 'move.stopUnits')).toBe(true);
    s = act(engine, s, { type: 'move.step', to: 'zJ3' }).state; // r1 (2 MF with the MMG) is spent, r2 has 2 left
    if (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
    expect(() => act(engine, s, { type: 'move.step', to: 'zK3' })).toThrow(/r1 lacks the MF/);
    s = act(engine, s, { type: 'move.stopUnits', units: ['r1'] }).state;
    expect(s.pieces['r1']!.tags['moved']).toBe(true);
    expect(s.pieces['rMMG']!.tags['moved']).toBe(true);
    expect(moveState({ state: s } as never)!.units).toEqual(['r2']);
    s = act(engine, s, { type: 'move.step', to: 'zK3' }).state;
    if (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
    expect(s.pieces['r2']!.loc).toMatchObject({ kind: 'hex', hex: 'zK3' });
    expect(s.pieces['r1']!.loc).toMatchObject({ kind: 'hex', hex: 'zJ3' });
    // Stopping the last mover ends the stack's move (after the defender's last chance to fire there).
    s = act(engine, s, { type: 'move.stopUnits', units: ['r2'] }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'firstFire', owner: 'ge', data: { hex: 'zK3', ending: true } });
    s = act(engine, s, { type: 'defPass' }).state;
    expect(moveState({ state: s } as never)).toBeFalsy();
  });

  it('ending a move with MF left gives the defender a last First Fire chance where the stack stands (SK1 3.3.1)', () => {
    // Double Time: 3 MF with the MMG, so the squad still has one left after the 2-MF building.
    const { engine, state } = setup([4, 3]);
    let s = act(engine, state, { type: 'move.start', units: ['r1'], doubleTime: true }).state;
    // Nothing spent yet: ending here draws no fire.
    expect(engine.currentDecision(act(engine, s, { type: 'move.end' }).state)).toMatchObject({ kind: 'phase', owner: 'ru' });
    s = act(engine, s, { type: 'move.step', to: 'zJ3' }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'firstFire', owner: 'ge' });
    s = act(engine, s, { type: 'defPass' }).state;
    s = act(engine, s, { type: 'move.end' }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'firstFire', owner: 'ge', data: { hex: 'zJ3', units: ['r1'], ending: true } });
    const t = act(engine, s, { type: 'defFire', decl: { units: ['g1'], sw: [], target: 'zJ3' } });
    expect(t.events.some((e) => e.type === 'sk1.fire.attack')).toBe(true);
    // The MMG could still fire; once the defender is done the stack is finished.
    s = act(engine, t.state, { type: 'defPass' }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'phase', owner: 'ru' });
    expect(moveState({ state: s } as never)).toBeFalsy();
    expect(s.pieces['r1']!.tags['moved']).toBe(true);
  });

  it('a stack that spent its last MF is not asked about again when the move ends', () => {
    // 2 MF with the MMG, all spent entering the building: the defender was offered after that step and
    // could see nothing was left, so the end of the move draws no second question.
    const { engine, state } = setup();
    let s = act(engine, state, { type: 'move.start', units: ['r1'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'zJ3' }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'firstFire', owner: 'ge' });
    s = act(engine, s, { type: 'defPass' }).state;
    s = act(engine, s, { type: 'move.end' }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'phase', owner: 'ru' });
    expect(moveState({ state: s } as never)).toBeFalsy();
    expect(s.pieces['r1']!.tags['moved']).toBe(true);
  });

  it('a defender who has fired all it can at the stack there is not asked again when the move ends', () => {
    const { engine, state } = makeEngine({
      board: 'z',
      terrain,
      scenario: RU_VS_GE,
      startPhase: 'MPh',
      dice: [4, 3, 5, 4],
      pieces: [
        { id: 'r1', def: 'ru.447', side: 'ru', hex: 'zI4' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'zK5' },
      ],
    });
    let s = act(engine, state, { type: 'move.start', units: ['r1'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'zJ3' }).state;
    // The building cost 2 MF: First Fire, then Subsequent First Fire, and the squad has fired all it may there.
    s = act(engine, s, { type: 'defFire', decl: { units: ['g1'], sw: [], target: 'zJ3' } }).state;
    s = act(engine, s, { type: 'defFire', decl: { units: ['g1'], sw: [], target: 'zJ3' } }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'phase', owner: 'ru' });
    s = act(engine, s, { type: 'move.end' }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'phase', owner: 'ru' });
    expect(moveState({ state: s } as never)).toBeFalsy();
  });

  it('a leader pinned by Defensive First Fire takes the leader bonus with him (SK1 3.3, ASLRB A4.12)', () => {
    // NMC on the 4 column (DR 1+2 +2): the 8-1 rolls 3+5 = 8, exactly his morale, and is pinned; the 4-4-7 passes on 1+2.
    const { engine, state } = makeEngine({
      board: 'z',
      terrain,
      scenario: RU_VS_GE,
      startPhase: 'MPh',
      dice: [1, 2, 3, 5, 1, 2],
      pieces: [
        { id: 'r2', def: 'ru.447', side: 'ru', hex: 'zI4' },
        { id: 'rL', def: 'ru.L81', side: 'ru', hex: 'zI4' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'zK5' },
      ],
    });
    let s = act(engine, state, { type: 'move.start', units: ['r2', 'rL'] }).state;
    expect(moveState({ state: s } as never)!.allowance['r2']).toBe(6);
    s = act(engine, s, { type: 'move.step', to: 'zJ3' }).state; // 2 MF
    s = act(engine, s, { type: 'defFire', decl: { units: ['g1'], sw: [], target: 'zJ3' } }).state;
    expect(s.pieces['rL']!.tags['pinned']).toBe(true);
    // The squad goes on alone with its own 4 MF, 2 of them spent.
    const ms = moveState({ state: s } as never)!;
    expect(ms.units).toEqual(['r2']);
    expect(ms.allowance['r2']).toBe(4);
    expect(ms.spent['r2']).toBe(2);
  });

  it('Smoke grenades: once per unit per MPh, so each squad of a moving stack may try (SK1 3.3)', () => {
    const { engine, state } = makeEngine({
      board: 'z',
      scenario: { ...RU_VS_GE, firstSide: 'ge' },
      startPhase: 'MPh',
      dice: [2, 3],
      pieces: [
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'zQ1' },
        { id: 'g2', def: 'ge.467', side: 'ge', hex: 'zQ1' },
        { id: 'r1', def: 'ru.447', side: 'ru', hex: 'zA1' },
      ],
    });
    const go = (st: typeof state, a: Record<string, unknown>) => {
      const next = act(engine, st, a as never).state;
      return engine.currentDecision(next)?.kind === 'firstFire' ? act(engine, next, { type: 'defPass' }).state : next;
    };
    let s = go(state, { type: 'move.start', units: ['g1', 'g2'] });
    s = go(s, { type: 'move.smoke', unit: 'g1', target: 'zQ1' });
    const again = (unit: string) => engine.validate(s, { type: 'move.smoke', unit, target: 'zQ1', side: 'ge', decisionId: engine.currentDecision(s)!.id } as never);
    expect(again('g1')).toMatch(/already attempted Smoke/);
    expect(again('g2')).toBeNull();
    s = go(s, { type: 'move.smoke', unit: 'g2', target: 'zQ1' });
    expect(moveState({ state: s } as never)!.smokeTriedBy).toEqual(['g1', 'g2']);
    expect(again('g2')).toMatch(/already attempted Smoke/);
  });

  it('rejects movement beyond MF and into enemy hexes', () => {
    const { engine, state } = setup();
    const s = act(engine, state, { type: 'move.start', units: ['r1'] }).state;
    expect(() => act(engine, s, { type: 'move.step', to: 'zK5' })).toThrow();
    const s2 = act(engine, s, { type: 'move.step', to: 'zJ3' }).state; // 2 MF: all of it
    const s3 = engine.currentDecision(s2)?.kind === 'firstFire' ? act(engine, s2, { type: 'defPass' }).state : s2;
    expect(() => act(engine, s3, { type: 'move.step', to: 'zK3' })).toThrow(/MF/);
  });
});

describe('Follow-up Defensive First Fire (SK1 3.3.1, ASLRB A8.14)', () => {
  // Two Russian 4-4-7s move yN5 → yN6 (Open Ground); German 4-6-7s wait in yN8 and yN9.
  const setup = (dice: number[]) =>
    makeEngine({
      scenario: RU_VS_GE,
      startPhase: 'MPh',
      dice,
      pieces: [
        { id: 'r1', def: 'ru.447', side: 'ru', hex: 'yN5' },
        { id: 'r2', def: 'ru.447', side: 'ru', hex: 'yN5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yN8' },
        { id: 'g2', def: 'ge.467', side: 'ge', hex: 'yN9' },
      ],
    });
  const results = (t: { events: { type: string; payload: unknown }[] }) =>
    Object.fromEntries(t.events.filter((e) => e.type === 'sk1.fire.result').map((e) => [(e.payload as { unit: string }).unit, (e.payload as { finalDr: number }).finalDr]));

  it('a stack broken whole by Defensive First Fire may be fired on again there, FFNAM/FFMO still applying, before its move ends', () => {
    // S35: a T-34's MA broke a whole stack and its CMG was offered no shot after.
    // g1: DR 4+3 -2 = 5, a NMC; r1 5+4 and r2 6+3 fail by 2 (within ELR 3): both broken.
    const { engine, state } = setup([4, 3, 5, 4, 6, 3, 5, 1, 6, 6, 6, 6]);
    let s = act(engine, state, { type: 'move.start', units: ['r1', 'r2'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'yN6' }).state;
    s = act(engine, s, { type: 'defFire', decl: { units: ['g1'], sw: [], target: 'yN6' } }).state;
    expect([s.pieces['r1']!.tags['broken'], s.pieces['r2']!.tags['broken']]).toEqual([true, true]);
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'firstFire', owner: 'ge', data: { hex: 'yN6', units: ['r1', 'r2'] } });
    // Passing ends the move there.
    const passed = act(engine, s, { type: 'defPass' }).state;
    expect(moveState(engine.env(passed))).toBeUndefined();
    expect(engine.currentDecision(passed)).toMatchObject({ kind: 'phase', owner: 'ru' });
    // g2: DR 5+1 with FFNAM and FFMO still -2 against the broken movers.
    const second = act(engine, s, { type: 'defFire', decl: { units: ['g2'], sw: [], target: 'yN6' } });
    expect((second.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { drm: number }).drm).toBe(-2);
    expect(results(second)).toEqual({ r1: 4, r2: 4 });
    // With no German shot left, the move is over and the mover may move another unit.
    expect(moveState(engine.env(second.state))).toBeUndefined();
    expect(engine.currentDecision(second.state)).toMatchObject({ kind: 'phase', owner: 'ru' });
  });

  it('a unit broken there is left behind when the rest of its stack moves on, and no longer a target', () => {
    // g1: DR 4+3 -2 = 5, a NMC; r1 5+4 fails (broken), r2 1+2 passes and walks on to yN7.
    const { engine, state } = setup([4, 3, 5, 4, 1, 2, 5, 1, 6, 6, 6, 6]);
    let s = act(engine, state, { type: 'move.start', units: ['r1', 'r2'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'yN6' }).state;
    s = act(engine, s, { type: 'defFire', decl: { units: ['g1'], sw: [], target: 'yN6' } }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'firstFire', data: { units: ['r2', 'r1'] } });
    s = act(engine, s, { type: 'defPass' }).state;
    s = act(engine, s, { type: 'move.step', to: 'yN7' }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'firstFire', data: { hex: 'yN7', units: ['r2'] } });
    expect(Object.keys(results(act(engine, s, { type: 'defFire', decl: { units: ['g2'], sw: [], target: 'yN7' } })))).toEqual(['r2']);
  });
});
