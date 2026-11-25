import { describe, expect, it } from 'vitest';
import type { Action, Engine, GameState, RuleModule } from '@asl/engine';
import { banzaiModule, banzaiState, banzaiSteps, banzaiWindowsPending, chargerIllegal, concealmentModule, declareIllegal, hiddenUnitsModule, japaneseModule, moveState, sk2CoreModules, sk3CoreModules, type Statics } from '../../src';
import { act, makeEngine, type PieceSpec } from '../fixtures';

/**
 * The Banzai Charge (SK4 8.1.8.6–8.1.8.8): who may declare it and at what, the Impulse movement (one hex each,
 * toward the target, never back), the Defensive First Fire windows between Impulses (not after each step), the
 * Impulse's MF charged to every unit, the mandatory Triple Point Blank Fire on entering a defended hex, the +1
 * morale and pin exemption, the end of the charge, and the next Player Turn.
 */
const extra = [...sk2CoreModules, ...sk3CoreModules, hiddenUnitsModule, japaneseModule, banzaiModule];
const JA_VS_AM = {
  firstSide: 'ja',
  sides: [
    { side: 'am', name: 'U.S. Marine Corps', nationality: 'am', elr: 5 },
    { side: 'ja', name: 'Japanese', nationality: 'ja', elr: 3 },
  ],
};
/** Open ground everywhere but a woods hex at K5 (cost 2) for the MF arithmetic. */
const TERRAIN = { yK5: { terrain: 'woods' } };
const game = (pieces: PieceSpec[], opts: { dice?: number[]; terrain?: Record<string, { terrain: string }>; startPhase?: string; firstSide?: string; extra?: RuleModule[]; concealment?: boolean } = {}) =>
  makeEngine({
    scenario: { ...JA_VS_AM, firstSide: opts.firstSide ?? 'ja', ...(opts.concealment ? { ssr: [{ module: 'concealment', params: {}, text: 'Concealment is in effect (SK4 8.3)' }] } : {}) },
    extra: opts.extra ?? extra,
    terrain: opts.terrain ?? TERRAIN,
    startPhase: opts.startPhase ?? 'MPh',
    pieces,
    ...(opts.dice ? { dice: opts.dice } : {}),
  });
type Ev = { type: string; payload: unknown };
let events: Ev[] = [];
const step = (r: { state: GameState; events: Ev[] }) => {
  events = [...events, ...r.events];
  return r.state;
};
const declare = (engine: Engine, s: GameState, leader: string, target: string, units: string[]) => step(act(engine, s, { type: 'banzai.declare', leader, target, units }));
const go = (engine: Engine, s: GameState, unit: string, to: string) => step(act(engine, s, { type: 'banzai.step', unit, to }));
const legalTypes = (engine: Engine, s: GameState) => [...new Set(engine.legalActions(s, engine.currentDecision(s)!.owner).map((a) => a.type))].sort();
const hexOf = (s: GameState, id: string) => (s.pieces[id]!.loc as { hex?: string }).hex;
/** One step through the phases: pass First Fire, end the phase, or do what the phase still demands (a rout). */
const onward = (engine: Engine, s: GameState): GameState => {
  const d = engine.currentDecision(s)!;
  const legal = engine.legalActions(s, d.owner);
  if (d.kind !== 'phase') {
    const pass = legal.find((a) => /pass|arranged|keep|declared/.test(a.type) && !engine.validate(s, a)) ?? legal.find((a) => a.type !== 'concede' && !engine.validate(s, a));
    if (!pass) throw new Error(`stuck in ${d.kind}: ${legal.map((a) => a.type).join(',')}`);
    return step(act(engine, s, pass));
  }
  const pick = legal.find((a) => a.type === 'endPhase' && !engine.validate(s, a)) ?? legal.find((a) => a.type !== 'concede' && a.type !== 'endPhase' && !engine.validate(s, a));
  if (!pick) throw new Error(`stuck in ${s.phase}: ${legal.map((a) => a.type).join(',')}`);
  return step(act(engine, s, pick));
};
const bst = (s: GameState) => s.ext['sk4.banzai'] as ReturnType<typeof banzaiState>;
const mapOf = (engine: Engine) => (engine.statics as Statics).map;

// The Japanese leader and two squads in a chain (K5-L5), a Marine squad four hexes east at P5.
const CHARGE: PieceSpec[] = [
  { id: 'l', def: 'ja.L91', side: 'ja', hex: 'yK5' },
  { id: 'a', def: 'ja.447', side: 'ja', hex: 'yK5' },
  { id: 'b', def: 'ja.447', side: 'ja', hex: 'yL5' },
  { id: 'm', def: 'am.768', side: 'am', hex: 'yP5' },
];

describe('Banzai Charge: declaration (SK4 8.1.8.6)', () => {
  it('needs a Japanese leader, Good Order unmoved units in one chain, and a target within eight hexes in LOS', () => {
    const { engine, state } = game([...CHARGE, { id: 'c', def: 'ja.447', side: 'ja', hex: 'yN7' }, { id: 'p', def: 'ja.447', side: 'ja', hex: 'yK6', tags: { pinned: true } }, { id: 'far', def: 'am.768', side: 'am', hex: 'yZ5' }]);
    const env = engine.env(state);
    expect(declareIllegal(env, 'ja', 'l', 'yP5', ['l', 'a', 'b'])).toBeNull();
    expect(declareIllegal(env, 'ja', 'a', 'yP5', ['a', 'b'])).toMatch(/leader/);
    expect(declareIllegal(env, 'ja', 'l', 'yP5', ['a', 'b'])).toMatch(/leader is part/);
    expect(declareIllegal(env, 'ja', 'l', 'yP5', ['l', 'a', 'c'])).toMatch(/adjacent/);
    expect(declareIllegal(env, 'ja', 'l', 'yP5', ['l', 'a', 'p'])).toMatch(/Good Order/);
    expect(declareIllegal(env, 'ja', 'l', 'yZ5', ['l', 'a', 'b'])).toMatch(/within 8 hexes/);
    expect(declareIllegal(env, 'ja', 'l', 'yO5', ['l', 'a', 'b'])).toMatch(/target is an enemy/);
    expect(engine.legalActions(state, 'ja').some((x) => x.type === 'banzai.declare' && x['target'] === 'yP5')).toBe(true);
  });

  it('gives the units 8 MF (a wounded leader 3), +1 morale, the banzai tag, and drops their concealment', () => {
    const { engine, state: s0 } = game(CHARGE.map((p) => (p.id === 'l' ? { ...p, tags: { wounds: 1 } } : p)).map((p) => (p.side === 'ja' ? { ...p, tags: { ...(p.tags ?? {}), concealed: true } } : p)), { extra: [...extra, concealmentModule], concealment: true });
    events = [];
    const s = declare(engine, s0, 'l', 'yP5', ['l', 'a', 'b']);
    const st = bst(s)!;
    expect(st.allowance).toEqual({ l: 3, a: 8, b: 8 });
    expect(st.impulse).toBe(1);
    for (const id of ['l', 'a', 'b']) {
      expect(s.pieces[id]!.tags['banzai']).toBe('charging');
      expect(s.pieces[id]!.tags['concealed']).toBeUndefined();
    }
    expect(engine.env(s).query('unit.morale', { unit: 'a' }, 7)).toBe(9); // 7 +1 leader +1 Banzai
    expect(events.some((e) => e.type === 'sk4.banzai.declared')).toBe(true);
    // While the charge is on, nothing else moves and the phase cannot end.
    expect(legalTypes(engine, s)).not.toContain('move.start');
    expect(legalTypes(engine, s)).not.toContain('endPhase');
  });
});

describe('Banzai Charge: who may charge, and a SW over the IPC (SK4 8.1.8.6, SK1 4.0)', () => {
  // The leader holds a captured MTR (3 PP) over his IPC of 1; the squad next to him is free.
  const LOADED: PieceSpec[] = [...CHARGE, { id: 'mtr', def: 'am.MTR', side: 'am', heldBy: 'l' }];

  it('the leader himself need not see the target, nor be within eight hexes: one unit of the chain is enough', () => {
    // A wall of blind hexes is not needed: the leader is nine hexes off, his squads within reach.
    const { engine, state } = game([
      { id: 'l', def: 'ja.L91', side: 'ja', hex: 'yG5' },
      { id: 'a', def: 'ja.447', side: 'ja', hex: 'yH5' },
      { id: 'm', def: 'am.768', side: 'am', hex: 'yP5' },
    ]);
    const env = engine.env(state);
    expect(mapOf(engine).distance('yG5', 'yP5')).toBeGreaterThan(8);
    expect(declareIllegal(env, 'ja', 'l', 'yP5', ['l', 'a'])).toBeNull();
  });

  it('a unit carrying more than its IPC may not charge, and is told to drop the SW first', () => {
    const { engine, state } = game(LOADED);
    const env = engine.env(state);
    expect(chargerIllegal(env, 'ja', 'l')).toMatch(/more than its IPC.*drop/i);
    expect(chargerIllegal(env, 'ja', 'a')).toBeNull();
    expect(declareIllegal(env, 'ja', 'l', 'yP5', ['l', 'a', 'b'])).toMatch(/drop/i);
  });

  it('per unit: not Japanese, broken, pinned, moved, or sharing a hex with the enemy', () => {
    const { engine, state } = game([
      ...CHARGE,
      { id: 'br', def: 'ja.447', side: 'ja', hex: 'yK6', tags: { broken: true } },
      { id: 'pn', def: 'ja.447', side: 'ja', hex: 'yK6', tags: { pinned: true } },
      { id: 'mv', def: 'ja.447', side: 'ja', hex: 'yL6', tags: { moved: true } },
      { id: 'in', def: 'ja.447', side: 'ja', hex: 'yP5' },
    ]);
    const env = engine.env(state);
    expect(chargerIllegal(env, 'ja', 'm')).toMatch(/own units/);
    expect(chargerIllegal(env, 'ja', 'br')).toMatch(/Good Order/);
    expect(chargerIllegal(env, 'ja', 'pn')).toMatch(/Good Order/);
    expect(chargerIllegal(env, 'ja', 'mv')).toMatch(/started its MPh/);
    expect(chargerIllegal(env, 'ja', 'in')).toMatch(/enemy/);
  });

  it('dropping the SW before moving frees him: the charge is declared, run, and over by the next Player Turn', () => {
    const { engine, state: s0 } = game(LOADED);
    events = [];
    // SK1 4.0: dropped at the start of the phase before any MF, the SW was never possessed; the leader has not moved.
    let s = step(act(engine, s0, { type: 'move.drop', sw: 'mtr' }));
    expect(s.pieces['mtr']!.loc).toMatchObject({ kind: 'hex', hex: 'yK5' });
    expect(s.pieces['l']!.tags['moved']).toBeUndefined();
    expect(chargerIllegal(engine.env(s), 'ja', 'l')).toBeNull();
    s = declare(engine, s, 'l', 'yP5', ['l', 'a', 'b']);
    expect(bst(s)!.units).toEqual(['a', 'b', 'l']);
    for (let i = 0; i < 200 && !(s.turn === 2 && s.attacker === 'ja'); i++) {
      const st = bst(s);
      const d = engine.currentDecision(s)!;
      const mover = st && d.kind === 'phase' && d.owner === 'ja' ? st.units.find((u) => !st.moved.includes(u) && banzaiSteps(engine.env(s), u).length > 0) : undefined;
      s = mover ? go(engine, s, mover, banzaiSteps(engine.env(s), mover)[0]!) : onward(engine, s);
    }
    expect([s.turn, s.attacker, s.phase, engine.currentDecision(s)?.kind]).toEqual([2, 'ja', 'RPh', 'phase']);
    expect(bst(s)).toBeFalsy();
    for (const id of ['l', 'a', 'b']) if (s.pieces[id]!.loc.kind === 'hex') expect(s.pieces[id]!.tags['banzai']).toBeUndefined();
    // In the next MPh the survivors in Good Order move, or charge again, as any unit does.
    for (let i = 0; i < 20 && s.phase !== 'MPh'; i++) s = onward(engine, s);
    expect(s.phase).toBe('MPh');
    const fit = ['l', 'a', 'b'].filter((id) => s.pieces[id]!.loc.kind === 'hex' && s.pieces[id]!.tags['broken'] !== true && s.pieces[id]!.tags['pinned'] !== true);
    expect(fit.length).toBeGreaterThan(0);
    for (const id of fit) {
      expect(engine.validate(s, { type: 'move.start', units: [id], doubleTime: false, assault: false, side: 'ja', decisionId: engine.currentDecision(s)!.id } as Action), id).toBeNull();
      if (!Object.values(s.pieces).some((p) => p.side === 'am' && p.loc.kind === 'hex' && p.loc.hex === hexOf(s, id))) expect(chargerIllegal(engine.env(s), 'ja', id), id).toBeNull();
    }
  });
});

describe('Banzai Charge: a leader wounded on the way (ASLRB A17.2)', () => {
  it('has a wounded leader\u2019s 3 MF from the next Impulse: out of the charge once he has spent them; his units go on', () => {
    const { engine, state: s0 } = game(CHARGE.map((p) => (p.id === 'm' ? { ...p, hex: 'yT5' } : p)));
    let s = declare(engine, s0, 'l', 'yT5', ['l', 'a', 'b']);
    /** Every unit still charging steps one hex; then each Defensive First Fire window is passed. */
    const impulse = (wound = false) => {
      for (const u of [...bst(s)!.units]) s = go(engine, s, u, banzaiSteps(engine.env(s), u)[0]!);
      // A wound from that Defensive First Fire (how it came about does not matter here).
      if (wound) s = { ...s, pieces: { ...s.pieces, l: { ...s.pieces['l']!, tags: { ...s.pieces['l']!.tags, wounds: 1 } } } };
      while (engine.currentDecision(s)!.kind === 'firstFire') s = step(act(engine, s, { type: 'defPass' }));
    };
    events = [];
    impulse(true);
    // Impulse 2: 1 MF spent, a wounded leader's 3 MF from now on.
    expect(bst(s)!.allowance).toEqual({ l: 3, a: 8, b: 8 });
    expect(bst(s)!.units).toContain('l');
    impulse();
    expect(bst(s)!.units).toContain('l');
    impulse();
    // 3 MF spent: he is out, the squads charge on.
    expect(bst(s)!.spent['l']).toBe(3);
    expect(bst(s)!.units).toEqual(['a', 'b']);
    expect(events.some((e) => e.type === 'sk4.banzai.out' && (e.payload as { unit: string; why: string }).unit === 'l' && /wounded/.test((e.payload as { why: string }).why))).toBe(true);
    expect(s.pieces['l']!.tags['moved']).toBe(true);
  });
});

describe('Banzai Charge: Impulses (SK4 8.1.8.6)', () => {
  it('moves each unit one hex toward the target, never back, with the Impulse charged at its maximum MF', () => {
    const { engine, state: s0 } = game(CHARGE);
    let s = declare(engine, s0, 'l', 'yP5', ['l', 'a', 'b']);
    // From K5 (woods) toward P5: only the neighbours closer to P5.
    const m = mapOf(engine);
    expect(banzaiSteps(engine.env(s), 'a').sort()).toEqual(m.neighbors('yK5').filter((h) => m.distance(h, 'yP5') < m.distance('yK5', 'yP5')).sort());
    s = go(engine, s, 'a', 'yL5');
    // The step is 1 MF (open ground); a's DFF waits: no firstFire decision yet.
    expect(engine.currentDecision(s)!.kind).toBe('phase');
    expect(bst(s)!.moved).toEqual(['a']);
    s = go(engine, s, 'l', banzaiSteps(engine.env(s), 'l')[0]!);
    s = go(engine, s, 'b', banzaiSteps(engine.env(s), 'b')[0]!);
    // All moved: the Impulse ends, the DEFENDER may fire at a Banzai hex (no shot available here: the Marines are 4 hexes off with no LOS issue, but range 6 → a shot exists).
    const d = engine.currentDecision(s)!;
    expect(d.kind).toBe('firstFire');
    expect(d.owner).toBe('am');
    // Pass every window: Impulse 2 opens with every unit charged 1 MF.
    while (engine.currentDecision(s)!.kind === 'firstFire') s = step(act(engine, s, { type: 'defPass' }));
    const st = bst(s)!;
    expect(st.impulse).toBe(2);
    expect(st.spent).toEqual({ l: 1, a: 1, b: 1 });
    // a may not go back to K5 (it left it) nor sideways away from the target.
    expect(banzaiSteps(engine.env(s), 'a')).not.toContain('yK5');
    expect(banzaiSteps(engine.env(s), 'a').every((h) => mapOf(engine).distance(h, 'yP5') < 4)).toBe(true);
  });

  it('at the Impulse’s end the DEFENDER fires at any Banzai hex, in the order he likes; a hex he leaves keeps what fired at it', () => {
    // A squad steps to L4, the leader and the other squad to L5; the Marines' MMG at N5 sees both. "Defensive First Fire
    // may occur against any of the Banzai units" (8.1.8.6): from L4's window (the first) the MMG may fire at L5.
    const { engine, state: s0 } = game([
      { id: 'l', def: 'ja.L91', side: 'ja', hex: 'yK5' },
      { id: 'a', def: 'ja.447', side: 'ja', hex: 'yK5' },
      { id: 'b', def: 'ja.447', side: 'ja', hex: 'yK4' },
      { id: 'm', def: 'am.768', side: 'am', hex: 'yN5' },
      { id: 'mg', def: 'am.MMG', side: 'am', heldBy: 'm' },
      // A second squad that has not fired, so L5's window comes up again.
      { id: 'm2', def: 'am.768', side: 'am', hex: 'yN6' },
    ], { terrain: {}, dice: new Array(40).fill([5, 4]).flat() });
    let s = declare(engine, s0, 'l', 'yN5', ['l', 'a', 'b']);
    s = go(engine, s, 'b', 'yL4');
    s = go(engine, s, 'a', 'yL5');
    s = go(engine, s, 'l', 'yL5');
    const at = () => moveState(engine.env(s))!.hex;
    const mmgAt = (target: string) => ({ type: 'defFire', decl: { units: [], sw: ['mg'], target } });
    expect(engine.currentDecision(s)!.kind).toBe('firstFire');
    expect(at()).toBe('yL4');
    expect(banzaiWindowsPending(engine.env(s))).toEqual(['yL5']);
    // The window's own target only, as for any moving stack; the other Banzai hex is reached by going to its window.
    expect(engine.validate(s, { ...mmgAt('yL5'), side: 'am', decisionId: engine.currentDecision(s)!.id } as Action)).toMatch(/moving stack/);
    expect(engine.validate(s, { type: 'banzai.window', hex: 'yP5', side: 'am', decisionId: engine.currentDecision(s)!.id } as Action)).toMatch(/No Banzai unit/);
    s = step(act(engine, s, { type: 'banzai.window', hex: 'yL5' }));
    expect(engine.currentDecision(s)!.kind).toBe('firstFire');
    expect(at()).toBe('yL5');
    expect(banzaiWindowsPending(engine.env(s))).toEqual(['yL4']);
    s = step(act(engine, s, mmgAt('yL5')));
    expect(events.filter((e) => e.type === 'sk1.fire.attack').length).toBe(1);
    // Back to L4 before passing: L5 comes up again next, and the MMG that fired there may not fire there again.
    if (engine.currentDecision(s)!.kind === 'firstFire' && at() === 'yL5') s = step(act(engine, s, { type: 'banzai.window', hex: 'yL4' }));
    expect(at()).toBe('yL4');
    s = step(act(engine, s, { type: 'defPass' }));
    expect(engine.currentDecision(s)!.kind).toBe('firstFire');
    expect(at()).toBe('yL5');
    expect(moveState(engine.env(s))!.firedHere['mg']).toBe(1);
    expect(engine.validate(s, { ...mmgAt('yL5'), side: 'am', decisionId: engine.currentDecision(s)!.id } as Action)).not.toBeNull();
    s = step(act(engine, s, { type: 'defPass' }));
    // Every window is done: the next Impulse, with no window record left over.
    expect(engine.currentDecision(s)!.kind).toBe('phase');
    expect(bst(s)!.impulse).toBe(2);
    expect(bst(s)!.dff).toBeUndefined();
    expect(bst(s)!.dffFired).toBeUndefined();
    // On to the next Player Turn: the charge is over, its state gone, the Marines' MMG fires normally again.
    for (let i = 0; i < 80 && !(s.turn === 2 && s.attacker === 'ja'); i++) s = onward(engine, s);
    expect(bst(s)).toBeFalsy();
    expect(s.pieces['mg']!.tags['fire']).toBeUndefined();
    events = [];
  });

  it('charges every unit the most any one spent in the Impulse, and must enter the target when adjacent to it', () => {
    // The target at M5; the leader and a squad next to it at L5, a second squad two hexes off at K5. Every hex b
    // could step into is woods (2 MF), a's step into M5 is open ground (1 MF).
    const { engine, state: s0 } = game([
      { id: 'l', def: 'ja.L91', side: 'ja', hex: 'yL5' },
      { id: 'a', def: 'ja.447', side: 'ja', hex: 'yL5' },
      { id: 'b', def: 'ja.447', side: 'ja', hex: 'yK5' },
      { id: 'm', def: 'am.768', side: 'am', hex: 'yM5' },
    ], { terrain: { yL4: { terrain: 'woods' }, yL5: { terrain: 'woods' }, yL6: { terrain: 'woods' } }, dice: new Array(60).fill(3) });
    let s = declare(engine, s0, 'l', 'yM5', ['l', 'a', 'b']);
    // Adjacent to the target with no Banzai unit in it: the only legal step is the target.
    expect(banzaiSteps(engine.env(s), 'a')).toEqual(['yM5']);
    const bStep = banzaiSteps(engine.env(s), 'b')[0]!;
    expect(bStep).toMatch(/^yL[456]$/);
    s = go(engine, s, 'b', bStep);
    s = go(engine, s, 'a', 'yM5');
    // a entered the Marines' hex: they fired TPBF at once (×3), before any Impulse-end window.
    const tpbf = events.filter((e) => e.type === 'sk4.banzai.tpbf');
    expect(tpbf.length).toBe(1);
    const shot = events.filter((e) => e.type === 'sk1.fire.attack').at(-1) as { payload: { fp: number; explain: { label: string }[] } };
    expect(shot.payload.fp).toBe(21);
    // The leader, next to the target with a Banzai unit now in it, may still step or end; step him in too.
    s = go(engine, s, 'l', 'yM5');
    while (engine.currentDecision(s)!.kind === 'firstFire') s = step(act(engine, s, { type: 'defPass' }));
    // Impulse MF: the most any unit spent was b's 2 (woods): everyone is charged 2.
    const after = bst(s);
    // a (if the TPBF left it alive) and l are in a hex with an enemy at the Impulse's start: out of the charge; b goes
    // on alone, charged the Impulse's 2 MF (its own woods step) though a and l spent 1.
    expect(after?.units).toEqual(['b']);
    expect(after?.spent['b']).toBe(2);
    expect(after?.spent['l']).toBe(2);
    expect(s.pieces['a']!.loc.kind === 'eliminated' || s.pieces['a']!.tags['banzai'] === 'done').toBe(true);
    expect(s.pieces['l']!.tags['banzai']).toBe('done');
    expect(events.filter((e) => e.type === 'sk4.banzai.out').map((e) => (e.payload as { why: string }).why)).toEqual(expect.arrayContaining(['in a hex with an enemy unit']));
  });

  it('need not enter the target once a Banzai unit occupies it, even one that entered it in an earlier Impulse', () => {
    // "A Banzai unit must enter the target hex unless another Banzai unit already occupies the hex" (8.1.8.6). The
    // squad that entered M5 in Impulse 1 is out of the charge from Impulse 2 (in a hex with an enemy unit) but is still
    // a Banzai unit occupying the target, so b, next to it in Impulse 2, may step beside it or end its charge (full ASL
    // A25.233: one unit's entry frees the others). Dice of 6: no shot has any effect.
    const { engine, state: s0 } = game([
      { id: 'l', def: 'ja.L91', side: 'ja', hex: 'yK5' },
      { id: 'a', def: 'ja.447', side: 'ja', hex: 'yL5' },
      { id: 'b', def: 'ja.447', side: 'ja', hex: 'yK5' },
      { id: 'm', def: 'am.768', side: 'am', hex: 'yM5' },
    ], { terrain: {}, dice: new Array(200).fill(6) });
    let s = declare(engine, s0, 'l', 'yM5', ['l', 'a', 'b']);
    s = go(engine, s, 'a', 'yM5');
    const m = mapOf(engine);
    // b and the leader step next to the target (K5 is two hexes from M5).
    const besides = banzaiSteps(engine.env(s), 'b').filter((h) => m.distance(h, 'yM5') === 1);
    expect(besides.length).toBeGreaterThan(0);
    s = go(engine, s, 'b', besides[0]!);
    s = go(engine, s, 'l', banzaiSteps(engine.env(s), 'l').filter((h) => m.distance(h, 'yM5') === 1)[0]!);
    while (engine.currentDecision(s)!.kind === 'firstFire') s = step(act(engine, s, { type: 'defPass' }));
    expect(bst(s)!.impulse).toBe(2);
    expect(bst(s)!.units).toEqual(['b', 'l']);
    expect(s.pieces['a']!.tags['banzai']).toBe('done');
    // What b is offered: the target, or a hex next to it it has not left; and ending its charge where it stands.
    const env = engine.env(s);
    const steps = banzaiSteps(env, 'b');
    expect(steps).toContain('yM5');
    expect(steps.some((h) => h !== 'yM5' && m.distance(h, 'yM5') === 1)).toBe(true);
    const offered = engine.legalActions(s, 'ja');
    expect(offered.some((x) => x.type === 'banzai.end' && x['unit'] === 'b')).toBe(true);
    expect(offered.some((x) => x.type === 'banzai.step' && x['unit'] === 'b' && x['to'] !== 'yM5')).toBe(true);
    // Both end their charge next to the target: the charge is over and the MPh may end.
    s = step(act(engine, s, { type: 'banzai.end', unit: 'b' }));
    s = step(act(engine, s, { type: 'banzai.end', unit: 'l' }));
    expect(bst(s)).toBeUndefined();
    expect(legalTypes(engine, s)).toContain('endPhase');
    // Into the next Japanese Player Turn: the tags are gone, b and the leader move normally.
    for (let i = 0; i < 200 && !(s.turn === 2 && s.attacker === 'ja' && s.phase === 'MPh'); i++) s = onward(engine, s);
    expect(s.phase).toBe('MPh');
    for (const id of ['l', 'b']) expect(s.pieces[id]!.tags['banzai']).toBeUndefined();
    expect(engine.legalActions(s, 'ja').some((x) => x.type === 'move.start' && (x['units'] as string[]).includes('b'))).toBe(true);
  });

  it('ignores Pin results while charging, and ends when no unit can go on; the units are done moving', () => {
    // Dice of 4: the TPBF (21 FP, col 16, DR 8 -2 FFNAM) is a 2MC the Banzai squads step under; nobody dies.
    const { engine, state: s0 } = game(CHARGE, { dice: new Array(80).fill(4) });
    let s = declare(engine, s0, 'l', 'yP5', ['l', 'a', 'b']);
    let guard = 0;
    while (bst(s) && guard++ < 60) {
      const d = engine.currentDecision(s)!;
      if (d.kind === 'firstFire') {
        s = step(act(engine, s, { type: 'defPass' }));
        continue;
      }
      const steps = engine.legalActions(s, 'ja').filter((a) => a.type === 'banzai.step');
      expect(steps.length).toBeGreaterThan(0);
      s = step(act(engine, s, steps[0]!));
    }
    expect(bst(s)).toBeUndefined();
    expect(events.some((e) => e.type === 'sk4.banzai.ended')).toBe(true);
    const alive = ['l', 'a', 'b'].filter((id) => s.pieces[id]!.loc.kind === 'hex');
    expect(alive.length).toBeGreaterThan(0);
    for (const id of alive) {
      const p = s.pieces[id]!;
      expect(p.tags['banzai']).toBe('done');
      expect(p.tags['moved']).toBe(true);
    }
    // Whoever is left reached the Marines' hex or stands next to it.
    for (const id of alive) expect(mapOf(engine).distance(hexOf(s, id)!, 'yP5')).toBeLessThanOrEqual(1);
    // The MPh may end now; in the AFPh a Banzai unit sharing the Marines' hex may fire into it.
    expect(legalTypes(engine, s)).toContain('endPhase');
    s = step(act(engine, s, { type: 'endPhase' }));
    while (s.phase !== 'AFPh') s = onward(engine, s);
    const inHex = alive.filter((id) => s.pieces[id]!.loc.kind === 'hex' && hexOf(s, id) === 'yP5' && !s.pieces[id]!.tags['broken']);
    if (inHex.length) {
      const err = engine.env(s).query('fire.illegal', { decl: { units: inHex.filter((id) => id !== 'l'), sw: [], target: 'yP5' }, mode: 'advancing', side: 'ja' }, null);
      expect(err).toBeNull();
      // and may not advance out of it in the APh
      expect(engine.env(s).query('advance.illegal', { units: [inHex[0]!], to: 'yO5', side: 'ja' }, null)).toMatch(/Banzai/);
    }
    // Next Player Turn: the tag and the +1 are gone, the units move normally.
    let guard2 = 0;
    while (!(s.attacker === 'ja' && s.phase === 'MPh') && guard2++ < 200) s = onward(engine, s);
    expect(s.phase).toBe('MPh');
    for (const id of alive) expect(s.pieces[id]!.tags['banzai']).toBeUndefined();
    for (const id of alive.filter((x) => x !== 'l')) expect(engine.env(s).query('unit.morale', { unit: id }, 7)).toBeLessThanOrEqual(8);
    // A survivor outside the Marines' hex (not in Melee) may start a move of its own again.
    const free = alive.filter((id) => s.pieces[id]!.loc.kind === 'hex' && hexOf(s, id) !== 'yP5' && !s.pieces[id]!.tags['broken']);
    if (free.length) expect(engine.legalActions(s, 'ja').some((a) => a.type === 'move.start' && (a['units'] as string[]).includes(free[0]!))).toBe(true);
  });

  it('pin exemption: a PTC against a charging squad pins nothing', () => {
    // A pin through the morale procedure is ignored while charging.
    const probe: RuleModule = { id: 'test.pin', install(r) { r.action<Action & { unit: string }>({ type: 'test.pin', decisionKinds: ['phase'], resolve: (ctx, a) => ctx.proc<(c: typeof ctx, u: string) => void>('sk1.morale.pin')(ctx, a.unit) }); } };
    const g2 = game(CHARGE, { extra: [...extra, probe] });
    let t = declare(g2.engine, g2.state, 'l', 'yP5', ['l', 'a', 'b']);
    t = step(act(g2.engine, t, { type: 'test.pin', unit: 'a' }));
    expect(t.pieces['a']!.tags['pinned']).toBeUndefined();
    expect(moveState(g2.engine.env(t))).toBeUndefined();
  });
});
