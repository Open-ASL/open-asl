import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { GE_VS_BR, RU_VS_GE, act, makeEngine } from './fixtures';

/*
 * Flamethrowers (SK1 4.2, SK4 4.2): a FT may not combine with any other attack nor form a Fire Group, takes no
 * leadership DRM, and a pinned unit cannot fire it; a full squad possessing one may make a separate attack with its
 * own FP. A stack holding a FT fires it alone and fires the rest as another attack.
 */

/** A German stack in yK5: squad `s1` with the FT, squad `s2` with a LMG and a 9-1 leader; British squads adjacent in yK6. */
function ftGame(dice: number[], tags: Record<string, boolean> = {}) {
  return makeEngine({
    scenario: GE_VS_BR,
    dice,
    pieces: [
      { id: 's1', def: 'ge.467', side: 'ge', hex: 'yK5', tags },
      { id: 'ft', def: 'ge.FT', side: 'ge', heldBy: 's1' },
      { id: 's2', def: 'ge.467', side: 'ge', hex: 'yK5' },
      { id: 'lmg', def: 'ge.LMG', side: 'ge', heldBy: 's2' },
      { id: 'L', def: 'ge.L91', side: 'ge', hex: 'yK5' },
      { id: 'b1', def: 'br.457', side: 'br', hex: 'yK6' },
      { id: 'b2', def: 'br.457', side: 'br', hex: 'yK6' },
    ],
  });
}
const illegal = (engine: Engine, state: GameState, decl: Record<string, unknown>) =>
  engine.env(state).query('fire.illegal', { decl: { target: 'yK6', ...decl } as never, mode: 'prep', side: 'ge' }, null);

describe('a Flamethrower fires alone (SK1 4.2)', () => {
  it('fires by itself from a stack whose other units and SW are free to fire, but never with them or directed', () => {
    const { engine, state } = ftGame([]);
    expect(illegal(engine, state, { units: [], sw: ['ft'] })).toBeNull();
    expect(illegal(engine, state, { units: ['s2'], sw: ['ft'] })).toMatch(/FT may not combine/);
    expect(illegal(engine, state, { units: [], sw: ['ft', 'lmg'] })).toMatch(/FT may not combine/);
  });

  it('a pinned holder cannot fire it', () => {
    const { engine, state } = ftGame([], { pinned: true });
    expect(illegal(engine, state, { units: [], sw: ['ft'] })).toMatch(/pinned unit cannot fire a FT/);
  });

  it('after the FT has fired, the rest of the stack, its holder included, fires as a separate attack', () => {
    // FT attack DR 3+4 (below its X#, 9 for a non-elite user, so it stays); then the stack's attack DR 6+6.
    const { engine, state } = ftGame([3, 4, 6, 6]);
    let s = act(engine, state, { type: 'fire', decl: { units: [], sw: ['ft'], target: 'yK6' } }).state;
    expect(s.pieces['ft']!.loc).toEqual({ kind: 'held', by: 's1' });
    expect(illegal(engine, s, { units: [], sw: ['ft'] })).not.toBeNull();
    expect(illegal(engine, s, { units: ['s1', 's2'], sw: ['lmg'], directors: ['L'] })).toBeNull();
    s = act(engine, s, { type: 'fire', decl: { units: ['s1', 's2'], sw: ['lmg'], target: 'yK6', directors: ['L'] } }).state;
    expect(s.pieces['s1']!.tags['fire']).toBe('prep');
  });

  it('what it fired is forgotten by the next German Player Turn, and it may fire again', () => {
    const { engine, state } = ftGame([3, 4, ...Array(60).fill(6)]);
    let s = act(engine, state, { type: 'fire', decl: { units: [], sw: ['ft'], target: 'yK6' } }).state;
    for (let i = 0; i < 80 && !(s.turn === 2 && s.attacker === 'ge' && s.phase === 'PFPh'); i++) {
      const d = engine.currentDecision(s)!;
      const options = engine.legalActions(s, d.owner);
      const a = options.find((x) => x.type === 'endPhase') ?? options.find((x) => x.type === 'defPass') ?? options.find((x) => x.type === 'move.end') ?? options[0]!;
      s = engine.submit(s, a).state;
    }
    expect([s.turn, s.attacker, s.phase]).toEqual([2, 'ge', 'PFPh']);
    expect(s.pieces['ft']!.tags['fire']).toBeUndefined();
    expect(s.pieces['s1']!.tags['firedSw']).toBeUndefined();
    expect(illegal(engine, s, { units: [], sw: ['ft'] })).toBeNull();
  });
});

describe('a FT possessor\'s -1 splits the results of one attack (SK1 4.2, 3.2.1)', () => {
  // American 7-4-7 in yN4 fires 7 FP at range 2 (6 column) into yN6: a German 9-1 with a 4-6-7 holding a FT.
  // DR 5+3 = 8: a PTC for the leader; 7 for the FT squad (-1 vs its possessor), a worse result.
  const game = () =>
    makeEngine({
      startPhase: 'PFPh',
      dice: [5, 3, 2, 2, 2, 2],
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN4' },
        { id: 'gL', def: 'ge.L91', side: 'ge', hex: 'yN6' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yN6' },
        { id: 'ft', def: 'ge.FT', side: 'ge', heldBy: 'g1' },
      ],
    });

  it("the leader checks first, whatever his result, and if he passes lends his DRM to the squad's check", () => {
    const { engine, state } = game();
    const t = act(engine, state, { type: 'fire', decl: { units: ['a1'], sw: [], target: 'yN6' } });
    const results = t.events.filter((e) => e.type === 'sk1.fire.result').map((e) => e.payload as { unit: string; result: { kind: string }; finalDr: number });
    expect(results.find((r) => r.unit === 'gL')).toMatchObject({ result: { kind: 'PTC' }, finalDr: 8 });
    expect(results.find((r) => r.unit === 'g1')!.finalDr).toBe(7);
    expect(results.find((r) => r.unit === 'g1')!.result.kind).not.toBe('PTC');
    const checks = t.events.filter((e) => e.type === 'sk1.check').map((e) => e.payload as { unit: string; drm: number });
    expect(checks.map((c) => c.unit)).toEqual(['gL', 'g1']);
    // The 9-1 passed his PTC (DR 4): his -1 modifies the squad's check.
    expect(checks.find((c) => c.unit === 'g1')!.drm).toBe(-1);
    expect(t.state.pieces['gL']!.tags['pinned']).toBeUndefined();
  });
});

describe('a Flamethrower is no Subsequent First Fire weapon (ASLRB A8.3, A8.31, A8.4)', () => {
  // SK4 3.3.3 is silent; full ASL: "Only Small Arms [EXC: MOL], MG, and IFE can be used as Subsequent First Fire",
  // and FPF is a Subsequent First Fire option. A FT marked First Fire may still fire in the DFPh at an adjacent hex.
  /** A Russian squad in zI4 moving toward the German squad in zK5, whose FT carries `ftFire`. */
  const game = (ftFire?: 'first' | 'final', phase: 'MPh' | 'DFPh' = 'MPh') =>
    makeEngine({
      board: 'z',
      scenario: RU_VS_GE,
      startPhase: phase,
      dice: [4, 3, 4, 3, 4, 3],
      pieces: [
        { id: 'r1', def: 'ru.447', side: 'ru', hex: phase === 'MPh' ? 'zI4' : 'zK4' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'zK5' },
        { id: 'ft', def: 'ge.FT', side: 'ge', heldBy: 'g1', tags: ftFire ? { fire: ftFire } : {} },
      ],
    });
  const ftShots = (engine: Engine, s: GameState) => engine.legalActions(s, 'ge').filter((a) => a.type === 'defFire' && (a['decl'] as { sw: string[] }).sw.includes('ft'));

  it('a FT that First Fired may not fire again in the MPh, as SFF or FPF, nor is it offered', () => {
    for (const marker of ['first', 'final'] as const) {
      const { engine, state } = game(marker);
      let s = act(engine, state, { type: 'move.start', units: ['r1'] }).state;
      s = act(engine, s, { type: 'move.step', to: 'zJ4' }).state;
      expect(engine.currentDecision(s)).toMatchObject({ kind: 'firstFire', owner: 'ge' });
      expect(ftShots(engine, s), marker).toEqual([]);
      expect(() => act(engine, s, { type: 'defFire', decl: { units: [], sw: ['ft'], target: 'zJ4' } }), marker).toThrow(/Subsequent First Fire/);
    }
  });

  it('an unmarked FT First Fires at a moving unit and is marked First Fire', () => {
    const { engine, state } = game();
    let s = act(engine, state, { type: 'move.start', units: ['r1'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'zJ4' }).state;
    s = act(engine, s, { type: 'defFire', decl: { units: [], sw: ['ft'], target: 'zJ4' } }).state;
    expect(s.pieces['ft']!.tags['fire']).toBe('first');
  });

  it('a FT marked First Fire may Final Fire in the DFPh at an adjacent hex', () => {
    const { engine, state } = game('first', 'DFPh');
    const why = engine.env(state).query('fire.illegal', { decl: { units: [], sw: ['ft'], target: 'zK4' } as never, mode: 'final', side: 'ge' }, null);
    expect(why).toBeNull();
  });
});

describe('a leader holding a FT is asked to First Fire it (SK1 4.2, 3.3.1)', () => {
  // A German 9-1 in zK5 holds the stack's only weapon, a FT; a Russian squad moves from zI4 to zJ4, adjacent, while
  // another waits in zL5.
  const game = (dice: number[] = [4, 3, ...Array(60).fill(6)]) =>
    makeEngine({
      board: 'z',
      scenario: RU_VS_GE,
      startPhase: 'MPh',
      dice,
      pieces: [
        { id: 'r1', def: 'ru.447', side: 'ru', hex: 'zI4' },
        { id: 'r2', def: 'ru.447', side: 'ru', hex: 'zL5' },
        { id: 'L', def: 'ge.L91', side: 'ge', hex: 'zK5' },
        { id: 'ft', def: 'ge.FT', side: 'ge', heldBy: 'L' },
      ],
    });
  const step = (engine: Engine, state: GameState) => act(engine, act(engine, state, { type: 'move.start', units: ['r1'] }).state, { type: 'move.step', to: 'zJ4' }).state;

  it('the move into range stops for him, and the FT attack is among the shots offered', () => {
    const { engine, state } = game();
    const s = step(engine, state);
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'firstFire', owner: 'ge' });
    expect(engine.legalActions(s, 'ge')).toContainEqual(expect.objectContaining({ type: 'defFire', decl: { units: [], sw: ['ft'], target: 'zJ4' } }));
  });

  it('he fires it, the FT is marked First Fire, and in his own Player Turn the mark is gone and the FT is offered in the PFPh', () => {
    const { engine, state } = game();
    let s = act(engine, step(engine, state), { type: 'defFire', decl: { units: [], sw: ['ft'], target: 'zJ4' } }).state;
    expect(s.pieces['ft']!.tags['fire']).toBe('first');
    for (let i = 0; i < 80 && !(s.attacker === 'ge' && s.phase === 'PFPh'); i++) {
      const d = engine.currentDecision(s)!;
      const options = engine.legalActions(s, d.owner);
      const a = options.find((x) => x.type === 'endPhase') ?? options.find((x) => x.type === 'defPass') ?? options.find((x) => x.type === 'move.end') ?? options[0]!;
      s = engine.submit(s, a).state;
    }
    expect([s.attacker, s.phase]).toEqual(['ge', 'PFPh']);
    expect(s.pieces['ft']!.tags['fire']).toBeUndefined();
    expect(engine.legalActions(s, 'ge')).toContainEqual(expect.objectContaining({ type: 'fire', decl: { units: [], sw: ['ft'], target: 'zL5' } }));
  });
});
