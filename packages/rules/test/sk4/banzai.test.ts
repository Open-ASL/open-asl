import { describe, expect, it } from 'vitest';
import type { Action, Engine, GameState, RuleModule } from '@asl/engine';
import { banzaiModule, banzaiState, banzaiSteps, concealmentModule, declareIllegal, hiddenUnitsModule, japaneseModule, moveState, sk2CoreModules, sk3CoreModules, type Statics } from '../../src';
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
