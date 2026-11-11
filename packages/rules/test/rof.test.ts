import { describe, expect, it } from 'vitest';
import type { Action, Ctx, Engine, GameState, RuleModule } from '@asl/engine';
import { FP, fireMarker, moveState, rofChoices, rofDeclineResidual, shownFireMarker, type FireDeclaration, type FireMode, type ResolveFireFn } from '../src';
import { RU_VS_GE, act, makeEngine } from './fixtures';

/** Test-only action: resolve a fire declaration in a given mode. */
const testFire: RuleModule = {
  id: 'test.fire',
  install(r) {
    r.action<Action & { decl: FireDeclaration; mode: FireMode }>({
      type: 'test.fire',
      decisionKinds: ['phase'],
      validate: (env, a) => env.query('fire.illegal', { decl: a.decl, mode: a.mode, side: a.side }, null),
      resolve(ctx: Ctx, a) {
        ctx.proc<ResolveFireFn>(FP.resolve)(ctx, a.decl, a.mode);
      },
    });
  },
};

const terrain = { yP5: { terrain: 'building-stone' } };
// German squad with a MMG (ROF 2) in the DFPh, firing at an American squad 2 hexes away.
const pieces = [
  { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
  { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5' },
  { id: 'gMMG', def: 'ge.MMG', side: 'ge', heldBy: 'g1' },
  { id: 'gL', def: 'ge.L91', side: 'ge', hex: 'yP5' },
];
const rofEvent = (t: { events: { type: string; payload: unknown }[] }) => t.events.find((e) => e.type === 'sk1.fire.rof')?.payload as
  | { colored: number; kept: { sw: string; rof: number }[]; lost: { sw: string; rof: number; why: string }[] }
  | undefined;

describe('ROF across phases', () => {
  it('a MG that kept ROF in the PFPh is marked Prep Fire when the phase ends, and so is the squad that fired it', async () => {
    const { RU_VS_GE } = await import('./fixtures');
    // DR 1+2: colored 2 within the MMG's ROF 2, so the MG stays unmarked and could fire again this phase.
    const { engine, state } = makeEngine({
      scenario: RU_VS_GE,
      startPhase: 'PFPh',
      dice: [1, 2, 4, 4, 4, 4],
      pieces: [
        { id: 'sq', def: 'ge.467', side: 'ge', hex: 'yM6' },
        { id: 'rsq', def: 'ru.447', side: 'ru', hex: 'yM8' },
        { id: 'mmg', def: 'ru.MMG', side: 'ru', heldBy: 'rsq' },
      ],
    });
    const t = act(engine, state, { type: 'fire', decl: { units: [], sw: ['mmg'], target: 'yM6' } });
    expect(t.state.pieces['mmg']!.tags['fire']).toBeUndefined();
    expect(t.state.pieces['mmg']!.tags['rofFired']).toBe('prep');
    expect(t.state.pieces['rsq']!.tags['fire']).toBeUndefined();
    const fire = (s: GameState, decl: FireDeclaration) => engine.validate(s, { type: 'fire', decl, side: 'ru', decisionId: engine.currentDecision(s)!.id } as never);
    expect(fire(t.state, { units: [], sw: ['mmg'], target: 'yM6' })).toBeNull();
    // The PFPh over: both wear Prep Fire (SK1 3.2.2), so neither fires in the AFPh (3.5) nor moves (3.3).
    let s = act(engine, t.state, { type: 'endPhase' }).state;
    expect(s.pieces['mmg']!.tags).toMatchObject({ fire: 'prep' });
    expect(s.pieces['mmg']!.tags['rofFired']).toBeUndefined();
    expect(s.pieces['rsq']!.tags).toMatchObject({ fire: 'prep', firedSwAs: 'prep' });
    expect(engine.validate(s, { type: 'move.start', units: ['rsq'], side: 'ru', decisionId: engine.currentDecision(s)!.id } as never)).toMatch(/fired in the PFPh/);
    s = act(engine, s, { type: 'endPhase' }).state;
    s = act(engine, s, { type: 'endPhase' }).state;
    expect(s.phase).toBe('AFPh');
    expect(fire(s, { units: [], sw: ['mmg'], target: 'yM6' })).toMatch(/already fired/);
    expect(fire(s, { units: ['rsq'], sw: [], target: 'yM6' })).toMatch(/already fired/);
    // The AFPh over, the markers come off for the next turn.
    s = act(engine, s, { type: 'endPhase' }).state;
    expect(s.pieces['mmg']!.tags['fire']).toBeUndefined();
    expect(s.pieces['rsq']!.tags['fire']).toBeUndefined();
  });
});

describe('Rate of Fire (SK1 1.2.4, 3.2, 3.4)', () => {
  it('a MG fired with its squad keeps ROF on a low colored dr, stays unmarked and fires again; the squad is marked', () => {
    // DR 3 (white 1, colored 2): no doubles, colored 2 ≤ ROF 2. Then DR 4+5: colored 5 exceeds it.
    const { engine, state } = makeEngine({ terrain, extra: [testFire], pieces, dice: [1, 2, 4, 5, 6, 6], startPhase: 'DFPh' });
    const t = act(engine, state, { type: 'test.fire', mode: 'final', decl: { units: ['g1'], sw: ['gMMG'], target: 'yN5' } });
    expect(t.state.pieces['g1']!.tags['fire']).toBe('final');
    expect(t.state.pieces['gMMG']!.tags['fire']).toBeUndefined();
    expect(rofEvent(t)).toEqual({ colored: 2, kept: [{ sw: 'gMMG', rof: 2 }], lost: [] });
    // The squad cannot fire again, but its MG can, through the real DFPh fire action.
    expect(() => act(engine, t.state, { type: 'fire', decl: { units: ['g1'], sw: [], target: 'yN5' } })).toThrow(/Final Fire/);
    const t2 = act(engine, t.state, { type: 'fire', decl: { units: [], sw: ['gMMG'], target: 'yN5' } });
    expect(t2.state.pieces['gMMG']!.tags['fire']).toBe('final');
    expect(rofEvent(t2)).toEqual({ colored: 5, kept: [], lost: [{ sw: 'gMMG', rof: 2, why: 'exceeded' }] });
  });

  it('a blocked attack is still rolled (ASLRB A6.11): the MG may keep ROF, or break down', () => {
    const woods = { ...terrain, yO5: { terrain: 'woods' }, yO6: { terrain: 'woods' } };
    const fire = { type: 'test.fire', mode: 'final', decl: { units: ['g1'], sw: ['gMMG'], target: 'yN5' } } as const;
    // Colored 2 ≤ ROF 2: the MG keeps ROF and stays unmarked, the squad has fired.
    const keep = makeEngine({ terrain: woods, extra: [testFire], pieces, dice: [1, 2], startPhase: 'DFPh' });
    const t = act(keep.engine, keep.state, fire);
    expect(t.events.find((e) => e.type === 'sk1.fire.noLos')!.payload).toMatchObject({ dr: [1, 2], cowered: false });
    expect(t.events.some((e) => e.type === 'sk1.fire.attack')).toBe(false);
    expect(rofEvent(t)).toEqual({ colored: 2, kept: [{ sw: 'gMMG', rof: 2 }], lost: [] });
    expect(t.state.pieces['gMMG']!.tags['fire']).toBeUndefined();
    expect(t.state.pieces['g1']!.tags['fire']).toBe('final');
    expect(t.state.pieces['a1']!.tags['broken']).toBeUndefined();
    // Boxcars: the MG malfunctions though nothing was attacked.
    const malf = makeEngine({ terrain: woods, extra: [testFire], pieces, dice: [6, 6], startPhase: 'DFPh' });
    const t2 = act(malf.engine, malf.state, fire);
    expect(t2.state.pieces['gMMG']!.tags['malf']).toBe(true);
    expect(t2.state.pieces['g1']!.tags['fire']).toBe('final');
  });

  it('original doubles cower a non-directed attack: the MG loses ROF and is marked with the squad', () => {
    const { engine, state } = makeEngine({ terrain, extra: [testFire], pieces, dice: [1, 1, 6, 6, 6, 6], startPhase: 'DFPh' });
    const t = act(engine, state, { type: 'test.fire', mode: 'final', decl: { units: ['g1'], sw: ['gMMG'], target: 'yN5' } });
    const attack = t.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { cowered: boolean };
    expect(attack.cowered).toBe(true);
    expect(t.state.pieces['gMMG']!.tags['fire']).toBe('final');
    expect(rofEvent(t)).toEqual({ colored: 1, kept: [], lost: [{ sw: 'gMMG', rof: 2, why: 'cowered' }] });
    expect(() => act(engine, t.state, { type: 'fire', decl: { units: [], sw: ['gMMG'], target: 'yN5' } })).toThrow(/Final Fire/);
  });

  it('a MG fired alone also cowers on doubles (SK1 3.3.1 example)', () => {
    const { engine, state } = makeEngine({ terrain, extra: [testFire], pieces, dice: [1, 1, 6, 6, 6, 6], startPhase: 'DFPh' });
    const t = act(engine, state, { type: 'test.fire', mode: 'final', decl: { units: [], sw: ['gMMG'], target: 'yN5' } });
    expect(t.state.pieces['gMMG']!.tags['fire']).toBe('final');
    expect(rofEvent(t)?.lost[0]?.why).toBe('cowered');
  });

  it('leader-directed fire never cowers, so double ones keep ROF', () => {
    const { engine, state } = makeEngine({ terrain, extra: [testFire], pieces, dice: [1, 1, 6, 6, 6, 6], startPhase: 'DFPh' });
    const t = act(engine, state, { type: 'test.fire', mode: 'final', decl: { units: ['g1'], sw: ['gMMG'], target: 'yN5', directors: ['gL'] } });
    const attack = t.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { cowered: boolean };
    expect(attack.cowered).toBe(false);
    expect(t.state.pieces['gMMG']!.tags['fire']).toBeUndefined();
    expect(rofEvent(t)).toEqual({ colored: 1, kept: [{ sw: 'gMMG', rof: 2 }], lost: [] });
  });
});

// SK1 3.3.1: "a SW that malfunctions or chooses to retain ROF leaves no Residual FP" — so the ROF is a
// choice. A weapon that kept it in Defensive First Fire may give it up for the Residual FP instead.
describe('Keeping ROF or leaving Residual FP (SK1 3.3.1)', () => {
  const terrain = { zJ3: { terrain: 'building-stone' }, zK5: { terrain: 'building-stone' } };
  const setup = (dice: number[]) =>
    makeEngine({
      board: 'z',
      terrain,
      scenario: RU_VS_GE,
      startPhase: 'MPh',
      dice,
      pieces: [
        { id: 'r1', def: 'ru.447', side: 'ru', hex: 'zI4' },
        { id: 'r2', def: 'ru.447', side: 'ru', hex: 'zI4' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'zK5' },
        { id: 'gMMG', def: 'ge.MMG', side: 'ge', heldBy: 'g1' },
      ],
    });
  /** r1 Double Times zI4 → zJ3 → zK3 (open ground, 1 MF): the defender is asked in zK3. */
  const intoK3 = (dice: number[]) => {
    const { engine, state } = setup(dice);
    let s = act(engine, state, { type: 'move.start', units: ['r1'], doubleTime: true }).state;
    s = act(engine, s, { type: 'move.step', to: 'zJ3' }).state;
    s = act(engine, s, { type: 'defPass' }).state;
    s = act(engine, s, { type: 'move.step', to: 'zK3' }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'firstFire', owner: 'ge' });
    return { engine, s };
  };
  const declines = (engine: Engine, s: GameState) => engine.legalActions(s, 'ge').filter((a) => a.type === 'defRofDecline');

  it('a MMG that keeps ROF leaves no Residual FP; its owner may give the ROF up for it while still deciding', () => {
    // r1 into zJ3 (stone building, 2 MF: the MMG may fire twice there). DR 5+2 → 9 on the 4 column (+2 TEM):
    // nothing; colored 2 ≤ ROF 2 keeps it.
    const { engine, state } = setup([5, 2]);
    let s = act(engine, state, { type: 'move.start', units: ['r1'], doubleTime: true }).state;
    s = act(engine, s, { type: 'move.step', to: 'zJ3' }).state;
    const t = act(engine, s, { type: 'defFire', decl: { units: [], sw: ['gMMG'], target: 'zJ3' } });
    expect(rofEvent(t)).toEqual({ colored: 2, kept: [{ sw: 'gMMG', rof: 2 }], lost: [] });
    expect(t.state.hexMarkers['zJ3']?.['residualFp']).toBeUndefined();
    expect(t.state.pieces['gMMG']!.tags).toMatchObject({ rofFired: 'first' });
    expect(t.state.pieces['gMMG']!.tags['fire']).toBeUndefined();
    // The MMG could fire again there, so the defender is still asked; the choice is on the table there.
    expect(engine.currentDecision(t.state)).toMatchObject({ kind: 'firstFire', owner: 'ge' });
    expect(rofChoices({ state: t.state } as never)).toEqual([{ hex: 'zJ3', pending: ['gMMG'], declined: [], table: { gMMG: 2 } }]);
    expect(rofDeclineResidual({ state: t.state } as never, 'gMMG')).toEqual({ hex: 'zJ3', residual: 2 });
    expect(declines(engine, t.state)).toEqual([expect.objectContaining({ type: 'defRofDecline', sw: 'gMMG' })]);

    // Giving the ROF up: half the 4 column (2; the TEM is inside the hex) goes down, the MMG wears First
    // Fire, and the defender decides on (the MMG could still fire again, as Subsequent First Fire).
    const d = act(engine, t.state, { type: 'defRofDecline', sw: 'gMMG' });
    expect(d.events.find((e) => e.type === 'sk1.fire.rofDeclined')?.payload).toEqual({ sw: 'gMMG', hex: 'zJ3', residual: 2 });
    expect(d.state.hexMarkers['zJ3']).toMatchObject({ residualFp: 2 });
    expect(d.state.pieces['gMMG']!.tags['fire']).toBe('first');
    expect(d.state.pieces['gMMG']!.tags['rofFired']).toBeUndefined();
    expect(rofChoices({ state: d.state } as never)).toEqual([]);
    expect(engine.currentDecision(d.state)).toMatchObject({ kind: 'firstFire', owner: 'ge' });
    expect(declines(engine, d.state)).toEqual([]);
    expect(engine.validate(d.state, { type: 'defRofDecline', sw: 'gMMG', side: 'ge', decisionId: engine.currentDecision(d.state)!.id } as never)).toMatch(/no ROF to give up/);
    expect(engine.validate(d.state, { type: 'defFire', decl: { units: [], sw: ['gMMG'], target: 'zJ3' }, side: 'ge', decisionId: engine.currentDecision(d.state)!.id } as never)).toBeNull();
    // The next mover walks into it.
    let s2 = act(engine, d.state, { type: 'defPass' }).state;
    s2 = act(engine, s2, { type: 'move.end' }).state;
    // Stopping with MF left is a last First Fire chance; pass it.
    s2 = act(engine, s2, { type: 'defPass' }).state;
    s2 = act(engine, s2, { type: 'move.start', units: ['r2'], doubleTime: true }).state;
    const r = act(engine, s2, { type: 'move.step', to: 'zJ3' });
    expect(r.events.some((e) => e.type === 'sk1.fire.attack' && (e.payload as { attack: { parts: string[] } }).attack.parts.length === 0)).toBe(true);
  });

  it('passing keeps the ROF: the MMG stays unmarked, nothing is left in the hex', () => {
    const { engine, s } = intoK3([3, 2]);
    const t = act(engine, s, { type: 'defFire', decl: { units: [], sw: ['gMMG'], target: 'zK3' } });
    const p = act(engine, t.state, { type: 'defPass' });
    expect(rofChoices({ state: p.state } as never)).toEqual([]);
    expect(p.state.hexMarkers['zK3']?.['residualFp']).toBeUndefined();
    expect(p.state.pieces['gMMG']!.tags).toMatchObject({ rofFired: 'first' });
    expect(p.state.pieces['gMMG']!.tags['fire']).toBeUndefined();
    expect(engine.currentDecision(p.state)).toMatchObject({ kind: 'phase', owner: 'ru' });
  });

  it('a squad whose MMG alone fired, keeping ROF, wears no First Fire, then or when the MPh ends; nor does the MMG (SK1 3.3.1, 4.0)', () => {
    const { engine, s } = intoK3([3, 2]);
    let st = act(engine, s, { type: 'defFire', decl: { units: [], sw: ['gMMG'], target: 'zK3' } }).state;
    st = act(engine, st, { type: 'defPass' }).state;
    expect(fireMarker(st.pieces['g1']!)).toBeUndefined();
    expect(shownFireMarker(st.pieces['g1']!)).toBeUndefined();
    // r1 spent its last MF entering zK3; the MPh ends with r2 unmoved.
    st = act(engine, st, { type: 'endPhase' }).state;
    expect(st.phase).toBe('DFPh');
    // Only a SW "that has fired and exhausted its ROF" takes First Fire (SK1 3.3.1, SK4 3.3.3): the MMG kept it,
    // so it fires in the DFPh as if it had not fired (tester report 2026-11-07), and the squad's own FP is free too.
    expect(fireMarker(st.pieces['gMMG']!)).toBeUndefined();
    expect(st.pieces['gMMG']!.tags['rofFired']).toBeUndefined();
    expect(fireMarker(st.pieces['g1']!)).toBeUndefined();
    expect(shownFireMarker(st.pieces['g1']!)).toBeUndefined();
  });

  it('firing the MMG again uses the ROF: the earlier choice lapses', () => {
    // r1 into zJ3 (2 MF: the MMG may fire twice there). Shot 1 DR 5+2 keeps ROF; shot 2 DR 4+5 loses it.
    const { engine, state } = setup([5, 2, 4, 5]);
    let s = act(engine, state, { type: 'move.start', units: ['r1'], doubleTime: true }).state;
    s = act(engine, s, { type: 'move.step', to: 'zJ3' }).state;
    s = act(engine, s, { type: 'defFire', decl: { units: [], sw: ['gMMG'], target: 'zJ3' } }).state;
    expect(declines(engine, s)).toHaveLength(1);
    const t = act(engine, s, { type: 'defFire', decl: { units: [], sw: ['gMMG'], target: 'zJ3' } });
    expect(rofEvent(t)!.lost).toEqual([{ sw: 'gMMG', rof: 2, why: 'exceeded' }]);
    expect(rofChoices({ state: t.state } as never)).toEqual([]);
    expect(declines(engine, t.state)).toEqual([]);
    // Lost ROF the ordinary way: marked, and the second shot's Residual FP down (4 column, +2 TEM inside the hex: 2).
    expect(t.state.pieces['gMMG']!.tags['fire']).toBe('first');
    expect(t.state.hexMarkers['zJ3']).toMatchObject({ residualFp: 2 });
  });

  it('with nothing left to fire, the choice is asked on its own: a Fire Group leaves its squad’s share at once, the MMG’s on request', () => {
    // 4-6-7 + MMG (8 FP) at zK3: DR 3+2 keeps the MMG's ROF. The squad alone leaves 2 (4 column); the whole group 4.
    const { engine, s } = intoK3([3, 2]);
    const t = act(engine, s, { type: 'defFire', decl: { units: ['g1'], sw: ['gMMG'], target: 'zK3' } });
    expect(t.state.hexMarkers['zK3']).toMatchObject({ residualFp: 2 });
    expect(t.state.pieces['g1']!.tags['fire']).toBe('first');
    expect(t.state.pieces['gMMG']!.tags['fire']).toBeUndefined();
    // Both have fired at zK3 as often as the 1 MF spent there allows, so no shot is offered: just the choice.
    expect(engine.currentDecision(t.state)).toMatchObject({ kind: 'rofResidual', owner: 'ge', data: { hex: 'zK3', sws: ['gMMG'] } });
    expect(rofChoices({ state: t.state } as never)).toEqual([{ hex: 'zK3', pending: ['gMMG'], declined: [], table: { gMMG: 4 } }]);
    expect(engine.legalActions(t.state, 'ge').map((a) => a.type).sort()).toEqual(['defPass', 'defRofDecline']);
    // Declining raises the counter to the group's 4 and hands the mover its turn back.
    const d = act(engine, t.state, { type: 'defRofDecline', sw: 'gMMG' });
    expect(d.state.hexMarkers['zK3']).toMatchObject({ residualFp: 4 });
    expect(d.state.pieces['gMMG']!.tags['fire']).toBe('first');
    expect(engine.currentDecision(d.state)).toMatchObject({ kind: 'phase', owner: 'ru' });
    // Passing instead keeps it.
    const p = act(engine, t.state, { type: 'defPass' });
    expect(p.state.hexMarkers['zK3']).toMatchObject({ residualFp: 2 });
    expect(p.state.pieces['gMMG']!.tags['fire']).toBeUndefined();
    expect(engine.currentDecision(p.state)).toMatchObject({ kind: 'phase', owner: 'ru' });
  });

  it('a stack broken by the shot is gone, but the choice is still asked', () => {
    // MMG at zK3, DR 1+1 → 2 - 2 (FFNAM, FFMO) = 0 on the 4 column: a KIA? No: directed by no leader, doubles cower.
    // Use DR 2+1 (3 - 2 = 1 on 4: KIA) instead... a KIA leaves nothing to decide for, yet the Residual FP still
    // matters to the next mover, so the decision is asked all the same.
    const { engine, s } = intoK3([2, 1]);
    const t = act(engine, s, { type: 'defFire', decl: { units: [], sw: ['gMMG'], target: 'zK3' } });
    expect(rofEvent(t)!.kept).toEqual([{ sw: 'gMMG', rof: 2 }]);
    expect(moveState({ state: t.state } as never)).toBeUndefined();
    expect(engine.currentDecision(t.state)).toMatchObject({ kind: 'rofResidual', owner: 'ge' });
    const d = act(engine, t.state, { type: 'defRofDecline', sw: 'gMMG' });
    expect(d.state.hexMarkers['zK3']).toMatchObject({ residualFp: 2 });
    expect(engine.currentDecision(d.state)).toMatchObject({ kind: 'phase', owner: 'ru' });
  });

  it('an unanswered choice is passed on timeout (the ROF kept)', () => {
    const { engine, s } = intoK3([3, 2]);
    const t = act(engine, s, { type: 'defFire', decl: { units: ['g1'], sw: ['gMMG'], target: 'zK3' } });
    expect(engine.currentDecision(t.state)?.kind).toBe('rofResidual');
    const r = engine.timeout(t.state)!;
    expect(r.state.pieces['gMMG']!.tags['fire']).toBeUndefined();
    expect(r.state.hexMarkers['zK3']).toMatchObject({ residualFp: 2 });
    expect(engine.currentDecision(r.state)).toMatchObject({ kind: 'phase', owner: 'ru' });
  });
});

describe('leader direction of ROF shots', () => {
  // A leader directs his HMG's next shot after it kept ROF (this was once refused). He may use his
  // leadership again in the phase "to direct ROF" (SK1 1.2.1; ASLRB A10.7 "Multiple ROF").
  it('a leader who directed the squad and its MG directs the MG again on the ROF it kept', () => {
    const { engine, state } = makeEngine({
      scenario: RU_VS_GE,
      startPhase: 'PFPh',
      // DR 6+1 (colored 1: within the MMG's ROF, final 6 with the leader's -1): no effect, so no MC dice needed.
      dice: [6, 1, 6, 1, 6, 6, 6, 6],
      pieces: [
        { id: 'sq', def: 'ge.467', side: 'ge', hex: 'yM6' },
        { id: 'rsq', def: 'ru.447', side: 'ru', hex: 'yM8' },
        { id: 'hmg', def: 'ru.MMG', side: 'ru', heldBy: 'rsq' },
        { id: 'ldr', def: 'ru.L91', side: 'ru', hex: 'yM8' },
      ],
    });
    const t = act(engine, state, { type: 'fire', decl: { units: ['rsq'], sw: ['hmg'], target: 'yM6', directors: ['ldr'] } });
    expect(t.state.pieces['hmg']!.tags['rofFired']).toBe('prep');
    const fire = (s: GameState, decl: FireDeclaration) => engine.validate(s, { type: 'fire', decl, side: 'ru', decisionId: engine.currentDecision(s)!.id } as never);
    expect(fire(t.state, { units: [], sw: ['hmg'], target: 'yM6', directors: ['ldr'] })).toBeNull();
    // Not a second attack of another kind: the squad, having fired, cannot be directed again (nor fire at all).
    expect(fire(t.state, { units: ['rsq'], sw: [], target: 'yM6', directors: ['ldr'] })).not.toBeNull();
  });
});
