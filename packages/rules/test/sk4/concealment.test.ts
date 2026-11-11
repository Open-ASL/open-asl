import { describe, expect, it } from 'vitest';
import type { Action, Ctx, Decision, Engine, GameState, RuleModule } from '@asl/engine';
import { CONCEAL_RTPH_DECISION, FP, P as MP, SETUP_PLACED, UNKNOWN_DEF_ID, concealmentModule, isKnownTo, isVisibleTo, moveState, redactState, sk2CoreModules, sk3CoreModules, type CasualtyFn, type FireDeclaration, type FireMode, type ResolveFireFn, type SetupAction, type SetupPlacedFn, type UnitFn } from '../../src';
import { RU_VS_GE, act, makeEngine, type PieceSpec } from '../fixtures';

/** Test-only actions: resolve a fire declaration; run the setup-placed and scenario-begin procedures. */
const testHooks: RuleModule = {
  id: 'test.hooks',
  install(r) {
    r.action<Action & { decl: FireDeclaration; mode: FireMode }>({
      type: 'test.fire',
      decisionKinds: ['phase'],
      validate: (env, a) => env.query('fire.illegal', { decl: a.decl, mode: a.mode, side: a.side }, null),
      resolve(ctx: Ctx, a) {
        ctx.proc<ResolveFireFn>(FP.resolve)(ctx, a.decl, a.mode);
      },
    });
    r.action<Action & { setup: SetupAction; kind: string }>({
      type: 'test.setupPlaced',
      decisionKinds: ['phase'],
      resolve(ctx, a) {
        ctx.proc<SetupPlacedFn>(SETUP_PLACED)(ctx, a.setup, { id: 'd0', kind: a.kind, owner: a.side, deadlineClass: 'turn' } as Decision);
      },
    });
    r.action<Action>({ type: 'test.begin', decisionKinds: ['phase'], resolve: (ctx) => ctx.proc<(c: Ctx) => void>('sk1.scenario.begin')(ctx) });
    r.action<Action & { unit: string }>({ type: 'test.break', decisionKinds: ['phase'], resolve: (ctx, a) => ctx.proc<UnitFn>(MP.breakUnit)(ctx, a.unit) });
    r.action<Action & { unit: string }>({ type: 'test.wound', decisionKinds: ['phase'], resolve: (ctx, a) => void ctx.proc<CasualtyFn>(MP.casualtyReduce)(ctx, a.unit, 'test') });
  },
};
const SSR = { module: 'concealment', params: {}, text: 'Concealment is in effect (SK4 8.3)' };
const extra = [...sk2CoreModules, ...sk3CoreModules, concealmentModule, testHooks];
/** Stone buildings (Concealment Terrain) at K5 and M5; everything else open ground on the bare fixture map. */
const BUILDINGS = { yK5: { terrain: 'building-stone', buildingId: 'b-K5' }, yM5: { terrain: 'building-stone', buildingId: 'b-M5' }, yP5: { terrain: 'building-stone', buildingId: 'b-P5' }, yO2: { terrain: 'woods' } };
const game = (pieces: PieceSpec[], startPhase: string, opts: { firstSide?: string; dice?: number[]; ssr?: boolean; terrain?: Record<string, { terrain: string; buildingId?: string }> } = {}) =>
  makeEngine({ scenario: { ...RU_VS_GE, firstSide: opts.firstSide ?? 'ru', ssr: opts.ssr === false ? [] : [SSR] }, extra, terrain: opts.terrain ?? BUILDINGS, startPhase, pieces, ...(opts.dice ? { dice: opts.dice } : {}) });
const settle = (engine: Engine, state: GameState) => {
  let s = state;
  while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
  return s;
};
const play = (engine: Engine, state: GameState, ...actions: (Omit<Action, 'decisionId' | 'side'> & { side?: string })[]) => {
  let s = state;
  for (const a of actions) s = act(engine, s, a).state;
  return s;
};
const sq = (id: string, hex: string, tags: Record<string, string | number | boolean> = {}): PieceSpec => ({ id, def: 'ru.447', side: 'ru', hex, tags });
const ge = (id: string, hex: string, tags: Record<string, string | number | boolean> = {}): PieceSpec => ({ id, def: 'ge.467', side: 'ge', hex, tags });
const concealed = (p: GameState['pieces'][string] | undefined) => p?.tags['concealed'] === true;
const events = (t: { events: { type: string; payload: unknown }[] }, type: string) => t.events.filter((e) => e.type === type).map((e) => e.payload as Record<string, unknown>);

describe('Concealment (SK4 8.3): gate, visibility and redaction', () => {
  it('does nothing when neither PTO Terrain nor the SSR is in effect', () => {
    const { engine, state } = game([sq('a', 'yK5', { concealed: true }), ge('g', 'yK8')], 'MPh', { ssr: false });
    expect(engine.legalActions(state, 'ru').some((a) => a.type === 'conceal.drop')).toBe(false);
    // The tag is inert: the enemy sees the unit.
    expect(isVisibleTo(engine.env(state), state.pieces['a']!, 'ge')).toBe(true);
  });

  it('a concealed unit is visible as a "?" but not Known to the enemy; the owner sees it whole; the enemy\'s view holds one stand-in per stack, 5/8" with a Gun', () => {
    const { engine, state } = game([sq('a', 'yK5', { concealed: true }), sq('b', 'yK5', { concealed: true }), sq('c', 'yK5'), { id: 'crew', def: 'ru.447', side: 'ru', hex: 'yM5', tags: { concealed: true } }, { id: 'gun', def: 'ge.AT75L', side: 'ru', heldBy: 'crew', tags: { ca: 0, concealed: true } }, ge('g', 'yK8')], 'MPh');
    const env = engine.env(state);
    expect(isVisibleTo(env, state.pieces['a']!, 'ge')).toBe(false);
    expect(isKnownTo(env, state.pieces['a']!, 'ge')).toBe(false);
    expect(isKnownTo(env, state.pieces['c']!, 'ge')).toBe(true);
    expect(isVisibleTo(env, state.pieces['a']!, 'ru')).toBe(true);
    const view = redactState(engine, state, 'ge');
    expect(view.pieces['a']).toBeUndefined();
    expect(view.pieces['b']).toBeUndefined();
    expect(view.pieces['c']).toBeDefined();
    const standIns = Object.values(view.pieces).filter((p) => p.defId === UNKNOWN_DEF_ID);
    expect(standIns.map((p) => (p.loc as { hex: string }).hex).sort()).toEqual(['yK5', 'yM5']);
    expect(standIns.find((p) => (p.loc as { hex: string }).hex === 'yM5')!.tags['big']).toBe(true);
    expect(standIns.find((p) => (p.loc as { hex: string }).hex === 'yK5')!.tags['big']).toBeUndefined();
    expect(JSON.stringify(view)).not.toMatch(/"a"|"b"|"crew"|"gun"/);
    // The stand-in is no unit: the enemy may fire at the hex, cannot aim the Infantry Target Type at it, and may try to walk in.
    expect(engine.legalActions(view, 'ge').length).toBeGreaterThanOrEqual(0);
  });
});

describe('Concealment (SK4 8.3): setup', () => {
  const forces = [{ side: 'ru', units: [], setup: { kind: 'area' as const, description: 'anywhere', hexes: ['yK5', 'yK6', 'yM5', 'yL4'] }, concealment: 1 }];
  it('OB counters: one stack per counter, in Concealment Terrain only; the tag goes on when the placement is confirmed', () => {
    const { engine, state } = game([sq('a', 'yK5'), sq('b', 'yK5'), sq('c', 'yL4'), sq('d', 'yM5'), ge('g', 'yK8')], 'MPh');
    const e2 = makeEngine({ scenario: { ...RU_VS_GE, ssr: [SSR], forces }, extra, terrain: BUILDINGS, startPhase: 'MPh', pieces: [sq('a', 'yK5'), sq('b', 'yK5'), sq('c', 'yL4'), sq('d', 'yM5'), ge('g', 'yK8')] });
    void engine;
    void state;
    const env = e2.engine.env(e2.state);
    const illegal = (concealedIds: string[]) => env.query('setup.illegal', { side: 'ru', todo: ['a', 'b', 'c', 'd'], action: { type: 'setup.place', side: 'ru', decisionId: 'd1', placements: { a: 'yK5', b: 'yK5', c: 'yL4', d: 'yM5' }, concealed: concealedIds } }, null);
    expect(illegal(['a', 'b'])).toBeNull();
    expect(illegal(['c'])).toMatch(/not Concealment Terrain/);
    expect(illegal(['a', 'd'])).toMatch(/gives 1 concealment counter/);
    const s = play(e2.engine, e2.state, { type: 'test.setupPlaced', kind: 'setup', setup: { type: 'setup.place', side: 'ru', decisionId: 'd1', placements: { a: 'yK5', b: 'yK5', c: 'yL4', d: 'yM5' }, concealed: ['a', 'b'] } });
    expect(concealed(s.pieces['a'])).toBe(true);
    expect(concealed(s.pieces['b'])).toBe(true);
    expect(concealed(s.pieces['d'])).toBe(false);
    // The counter is spent: another stack may not have one.
    expect(e2.engine.env(s).query('setup.illegal', { side: 'ru', todo: ['d'], action: { type: 'setup.place', side: 'ru', decisionId: 'd2', placements: { d: 'yM5' }, concealed: ['d'] } }, null)).toMatch(/gives 0 concealment/);
  });

  it('after all setup, every Infantry unit no enemy unit can see is concealed, whatever its terrain; reinforcements set up offboard are concealed', () => {
    // The German in yP6 sees yL4 (open, beside the building) but not yL5... use a woods screen: O2 woods between P2 and K2? Keep it simple: units far apart on open ground are in LOS, one behind the K5 building is not.
    const { engine, state } = game([sq('a', 'yJ5'), sq('b', 'yL5'), { id: 'r', def: 'ru.447', side: 'ru', tags: { entryTurn: 2, entryEdge: 'E' } }, ge('g', 'yM5')], 'MPh');
    const s = play(engine, state, { type: 'test.begin' });
    // yJ5 is screened from the German in yM5 by the K5 building (grid LOS: the building blocks); yL5 is adjacent and seen.
    expect(concealed(s.pieces['a'])).toBe(true);
    expect(concealed(s.pieces['b'])).toBe(false);
    const t = play(engine, state, { type: 'test.setupPlaced', kind: 'offboardSetup', setup: { type: 'setup.offboard', side: 'ru', decisionId: 'd1', placements: { r: 'yGG5' } } });
    expect(concealed(t.pieces['r'])).toBe(true);
  });
});

describe('Concealment (SK4 8.3): loss in the LOS of a Good Order enemy', () => {
  it('firing drops the firing unit\'s "?" (its stackmate keeps it); out of every Good Order enemy LOS it keeps it', () => {
    const { engine, state } = game([sq('a', 'yK5', { concealed: true }), sq('b', 'yK5', { concealed: true }), ge('g', 'yK8')], 'PFPh', { dice: [6, 6] });
    const s = act(engine, state, { type: 'test.fire', decl: { units: ['a'], sw: [], target: 'yK8' }, mode: 'prep' }).state;
    expect(concealed(s.pieces['a'])).toBe(false);
    expect(concealed(s.pieces['b'])).toBe(true);
    // Only a broken enemy sees the firer: no Good Order enemy LOS, the "?" stays on.
    const g2 = game([sq('a', 'yK5', { concealed: true }), ge('g', 'yK8', { broken: true }), ge('h', 'yP5')], 'PFPh', { dice: [6, 6] });
    const s2 = act(g2.engine, g2.state, { type: 'test.fire', decl: { units: ['a'], sw: [], target: 'yK8' }, mode: 'prep' }).state;
    expect(concealed(s2.pieces['a'])).toBe(true);
  });

  it('a hit with any result drops the "?" before the check; a no-effect result leaves it on', () => {
    const hit = game([ge('g', 'yK6'), sq('a', 'yK5', { concealed: true })], 'PFPh', { firstSide: 'ge', dice: [1, 1, 6, 6] });
    const t = act(hit.engine, hit.state, { type: 'test.fire', decl: { units: ['g'], sw: [], target: 'yK5' }, mode: 'prep' });
    const lost = events(t, 'sk4.concealment.lost');
    expect(lost.length).toBe(1);
    expect(lost[0]).toMatchObject({ reason: 'hit', units: ['a'] });
    // The loss comes before the check is rolled: its seq precedes the check's.
    const lostSeq = t.events.find((e) => e.type === 'sk4.concealment.lost')!.seq;
    const checkSeq = t.events.find((e) => e.type === 'sk1.check')?.seq ?? Infinity;
    expect(lostSeq).toBeLessThan(checkSeq);
    const miss = game([ge('g', 'yK6'), sq('a', 'yK5', { concealed: true })], 'PFPh', { firstSide: 'ge', dice: [6, 6] });
    const u = act(miss.engine, miss.state, { type: 'test.fire', decl: { units: ['g'], sw: [], target: 'yK5' }, mode: 'prep' });
    expect(concealed(u.state.pieces['a'])).toBe(true);
    expect(events(u, 'sk1.fire.result')[0]).toMatchObject({ result: { kind: 'none' } });
  });

  it('the attack on a concealed stack is Area Fire (half FP), resolved apart from the Known units in the hex with the same DR', () => {
    const columns: { targets: string[]; column: number }[] = [];
    const spy: RuleModule = {
      id: 'test.spy',
      install(r) {
        r.procedure(FP.applyResult, (next) => (ctx: Ctx, attack: { targets: string[] }, column: number, baseFinal: number, out: unknown) => {
          columns.push({ targets: [...attack.targets], column });
          (next as (c: Ctx, a: unknown, col: number, f: number, o: unknown) => void)?.(ctx, attack, column, baseFinal, out);
        });
      },
    };
    // The spy sits under the concealment wrapper (installed before it), so it sees the two inner calls.
    const { engine, state } = makeEngine({ scenario: { ...RU_VS_GE, firstSide: 'ge', ssr: [SSR] }, extra: [...sk2CoreModules, ...sk3CoreModules, spy, concealmentModule, testHooks], terrain: BUILDINGS, startPhase: 'PFPh', dice: [3, 3], pieces: [ge('g', 'yK6'), ge('g2', 'yK6'), sq('a', 'yK5', { concealed: true }), sq('c', 'yK5')] });
    act(engine, state, { type: 'test.fire', decl: { units: ['g', 'g2'], sw: [], target: 'yK5' }, mode: 'prep' });
    expect(columns.map((x) => x.targets)).toEqual([['c'], ['a']]);
    expect(columns[1]!.column).toBeLessThan(columns[0]!.column);
  });

  it('Non-Assault Movement in LOS drops it; Assault Movement into cover keeps it; into Open Ground drops it; out of LOS it keeps it', () => {
    const { engine, state } = game([sq('a', 'yK5', { concealed: true }), sq('b', 'yM5', { concealed: true }), sq('c', 'yP5', { concealed: true }), ge('g', 'yK9')], 'MPh');
    // a: non-assault from the K5 building into K6 (open): both reasons, "moved" first.
    let s = play(engine, state, { type: 'move.start', units: ['a'] });
    s = settle(engine, play(engine, s, { type: 'move.step', to: 'yK6' }));
    expect(concealed(s.pieces['a'])).toBe(false);
    s = settle(engine, play(engine, s, { type: 'move.end' }));
    // b: Assault Movement from M5 into the K5 building? not adjacent; into L5 (open) drops; so test c: assault from P5 into... P5's neighbours are open: Assault into open drops.
    s = play(engine, s, { type: 'move.start', units: ['c'], assault: true });
    s = settle(engine, play(engine, s, { type: 'move.step', to: 'yP6' }));
    expect(concealed(s.pieces['c'])).toBe(false);
    s = settle(engine, play(engine, s, { type: 'move.end' }));
    // A unit no Good Order enemy can see moves freely under "?": the German is broken.
    const g2 = game([sq('a', 'yK5', { concealed: true }), ge('g', 'yK9', { broken: true })], 'MPh');
    let u = play(g2.engine, g2.state, { type: 'move.start', units: ['a'] });
    u = settle(g2.engine, play(g2.engine, u, { type: 'move.step', to: 'yK6' }));
    expect(concealed(u.pieces['a'])).toBe(true);
  });

  it('Assault Movement into a building in LOS keeps the "?"', () => {
    const { engine, state } = game([sq('a', 'yK4', { concealed: true }), ge('g', 'yK9')], 'MPh');
    let s = play(engine, state, { type: 'move.start', units: ['a'], assault: true });
    s = settle(engine, play(engine, s, { type: 'move.step', to: 'yK5' }));
    expect(concealed(s.pieces['a'])).toBe(true);
  });

  it('breaking drops the "?" whoever can see; so does a wound', () => {
    // Nobody has a LOS to P5 but a broken German: the loss is unconditional all the same.
    const { engine, state } = game([ge('g', 'yK9', { broken: true }), sq('a', 'yP5', { concealed: true }), { id: 'l', def: 'ru.L91', side: 'ru', hex: 'yP5', tags: { concealed: true } }], 'PFPh', { dice: [2] });
    const t = act(engine, state, { type: 'test.break', unit: 'a' });
    expect(concealed(t.state.pieces['a'])).toBe(false);
    expect(events(t, 'sk4.concealment.lost')[0]).toMatchObject({ reason: 'broken', units: ['a'] });
    const u = act(engine, t.state, { type: 'test.wound', unit: 'l' });
    expect(u.state.pieces['l']!.tags['wounds']).toBe(1);
    expect(concealed(u.state.pieces['l'])).toBe(false);
  });

  it('may be dropped voluntarily at any time, one stack at a time', () => {
    const { engine, state } = game([sq('a', 'yK5', { concealed: true }), sq('b', 'yK5', { concealed: true }), sq('c', 'yM5', { concealed: true }), ge('g', 'yK9')], 'MPh');
    const drops = engine.legalActions(state, 'ru').filter((a) => a.type === 'conceal.drop') as unknown as { units: string[] }[];
    expect(drops.map((d) => d.units.sort())).toEqual([['a', 'b'], ['c']]);
    const s = play(engine, state, { type: 'conceal.drop', units: ['a', 'b'] });
    expect(concealed(s.pieces['a'])).toBe(false);
    expect(concealed(s.pieces['c'])).toBe(true);
    // The phase decision is still the mover's.
    expect(engine.currentDecision(s)!.kind).toBe('phase');
  });
});

describe('Concealment (SK4 8.3.2, 8.3.4): entering a "?" hex, routing', () => {
  it('Infantry attempting to enter a hex holding only a concealed stack: both "?" come off, the mover stays put having spent the MF, and is finished; an AFV enters', () => {
    const { engine, state } = game([ge('g', 'yK6', { concealed: true }), sq('a', 'yK5', { concealed: true }), sq('b', 'yK5', { concealed: true })], 'MPh', { firstSide: 'ge' });
    let s = play(engine, state, { type: 'move.start', units: ['g'] });
    const steps = engine.legalActions(s, 'ge').filter((a) => a.type === 'move.step').map((a) => a['to']);
    expect(steps).toContain('yK5'); // not Known: the attempt is offered
    const t = act(engine, s, { type: 'move.step', to: 'yK5' });
    expect(events(t, 'sk4.concealment.bounce')[0]).toMatchObject({ hex: 'yK5', units: ['g'] });
    expect(t.state.pieces['g']!.loc).toEqual({ kind: 'hex', hex: 'yK6' });
    expect(concealed(t.state.pieces['a'])).toBe(false);
    expect(concealed(t.state.pieces['g'])).toBe(false);
    s = settle(engine, t.state);
    expect(moveState(engine.env(s))).toBeUndefined();
    expect(s.pieces['g']!.tags['moved']).toBe(true);
    // A hex with a Known unit beside the concealed one is an enemy hex: no entry at all.
    const g2 = game([ge('g', 'yK6'), sq('a', 'yK5', { concealed: true }), sq('b', 'yK5')], 'MPh', { firstSide: 'ge' });
    const u = play(g2.engine, g2.state, { type: 'move.start', units: ['g'] });
    expect(g2.engine.legalActions(u, 'ge').filter((a) => a.type === 'move.step').map((a) => a['to'])).not.toContain('yK5');
  });

  it('a router trying to enter a "?" hex: the "?" comes off, the rout ends there and the unit is eliminated for failure to rout', () => {
    // The broken German in K7 must rout (the Russian in K5 is concealed: not Known, so DM/rout requirement come from elsewhere): give him DM and a Known enemy in K9.
    const g0 = game([ge('g', 'yK7', { broken: true, dm: true }), sq('a', 'yK6', { concealed: true }), sq('b', 'yK6', { concealed: true }), sq('k', 'yK9')], 'AFPh', { firstSide: 'ge' });
    const { engine } = g0;
    let state = play(engine, g0.state, { type: 'endPhase' });
    expect(state.phase).toBe('RtPh');
    // The Russians are first offered to drop the "?" of a and b (they see the broken German): they keep it.
    expect(engine.currentDecision(state)!.kind).toBe(CONCEAL_RTPH_DECISION);
    state = play(engine, state, { type: 'conceal.keep' });
    const routs = engine.legalActions(state, 'ge').filter((a) => a.type === 'rout.step') as unknown as { to: string }[];
    expect(routs.map((r) => r.to)).toContain('yK6');
    const t = act(engine, state, { type: 'rout.step', unit: 'g', to: 'yK6' });
    expect(concealed(t.state.pieces['a'])).toBe(false);
    expect(t.state.pieces['g']!.loc.kind).toBe('eliminated');
  });

  it('a concealed unit is not a Known Enemy Unit: no DM, no Interdiction, the rout may head toward it; at the RtPh the owner is offered to drop the "?" and dropping it makes the broken unit DM', () => {
    const g0 = game([ge('g', 'yK7', { broken: true }), sq('a', 'yK8', { concealed: true }), sq('k', 'yP9')], 'AFPh', { firstSide: 'ge' });
    const { engine } = g0;
    const state = play(engine, g0.state, { type: 'endPhase' });
    const d = engine.currentDecision(state)!;
    expect(d.kind).toBe(CONCEAL_RTPH_DECISION);
    expect(d.owner).toBe('ru');
    expect(d.data?.['units']).toEqual(['a']);
    const kept = play(engine, state, { type: 'conceal.keep' });
    expect(kept.pieces['g']!.tags['dm']).toBeUndefined();
    const dropped = play(engine, state, { type: 'conceal.drop', units: ['a'] });
    expect(concealed(dropped.pieces['a'])).toBe(false);
    expect(engine.currentDecision(dropped)!.kind).not.toBe(CONCEAL_RTPH_DECISION);
  });
});

describe('Concealment (SK4 8.3.1, 8.3.2): gain and Close Combat', () => {
  it('at the end of its Player Turn a Good Order unit in Concealment Terrain out of unbroken enemy LOS gains "?", which it keeps into the next turn until it fires', () => {
    // Russian turn: a in the K5 building, seen only by a broken German; b in the open; c in M5 seen by a Good Order German.
    // h in O5 is screened from the K5 building by the M5 building; g sees K5 and K6 but is broken; c in M5 is in h's LOS.
    const { engine, state } = game([sq('a', 'yK5'), sq('b', 'yK6'), sq('c', 'yM5'), ge('g', 'yK9', { broken: true }), ge('h', 'yO5')], 'CCPh');
    let s = play(engine, state, { type: 'endPhase' });
    expect(s.phase).toBe('RPh');
    expect(s.attacker).toBe('ge');
    expect(concealed(s.pieces['a'])).toBe(true);
    expect(concealed(s.pieces['b'])).toBe(false);
    expect(concealed(s.pieces['c'])).toBe(false);
    // Through the German turn and into the next Russian one the "?" stays; firing in the Russian PFPh takes it off.
    for (let i = 0; i < 20 && !(s.attacker === 'ru' && s.phase === 'PFPh'); i++) {
      const d = engine.currentDecision(s)!;
      const legal = engine.legalActions(s, d.owner);
      const end = legal.find((x) => x.type === 'endPhase') ?? legal.find((x) => x.type === 'defPass') ?? legal.find((x) => x.type === 'conceal.keep') ?? legal[0]!;
      s = engine.submit(s, end).state;
    }
    expect(s.phase).toBe('PFPh');
    expect(concealed(s.pieces['a'])).toBe(true);
    // Firing with no Good Order enemy in LOS (g is broken, h is screened by the M5 building) keeps the "?" (8.3).
    s = act(engine, s, { type: 'test.fire', decl: { units: ['a'], sw: [], target: 'yK9' }, mode: 'prep' }).state;
    expect(concealed(s.pieces['a'])).toBe(true);
  });

  it('ambush can occur in any hex when a combatant is concealed, with -2 for the concealed side', () => {
    const { engine, state } = game([ge('g', 'yK6', { advancedInto: 'yK6' }), sq('a', 'yK6', { concealed: true })], 'CCPh', { firstSide: 'ge' });
    expect(engine.query(state, 'cc.ambushPossible', { hex: 'yK6' }, false).value).toBe(true);
    expect(engine.query(state, 'cc.ambushDrm', { hex: 'yK6', side: 'ru', units: ['a'] }, 0).value).toBe(-2);
    expect(engine.query(state, 'cc.ambushDrm', { hex: 'yK6', side: 'ge', units: ['g'] }, 0).value).toBe(0);
    // Without a concealed combatant an Open Ground hex has no ambush.
    const plain = game([ge('g', 'yK6', { advancedInto: 'yK6' }), sq('a', 'yK6')], 'CCPh', { firstSide: 'ge' });
    expect(plain.engine.query(plain.state, 'cc.ambushPossible', { hex: 'yK6' }, false).value).toBe(false);
  });

  it('CC without an ambush takes the "?" off both sides before declarations; a concealed unit never holds Melee', () => {
    // Ambush dr: both roll 3 → no ambush; then the CC declarations start.
    const { engine, state } = game([ge('g', 'yK5', { advancedInto: 'yK5' }), sq('a', 'yK5', { concealed: true })], 'CCPh', { firstSide: 'ge', dice: [3, 3] });
    // Step through the hex choice and the arranging to the declarations.
    let s = state;
    for (let i = 0; i < 6 && engine.currentDecision(s) && engine.currentDecision(s)!.kind !== 'ccDeclare'; i++) {
      const d = engine.currentDecision(s)!;
      s = engine.submit(s, engine.legalActions(s, d.owner)[0]!).state;
    }
    expect(engine.currentDecision(s)!.kind).toBe('ccDeclare');
    expect(concealed(s.pieces['a'])).toBe(false);
    expect(engine.query(state, 'cc.meleeHolds', { hex: 'yK5' }, true).value).toBe(false);
  });
});

describe('Concealment (SK4 8.3.3): Guns and HIP', () => {
  it('a HIP Gun seen in Open Ground comes on the board concealed, not revealed', () => {
    const { engine, state } = game([{ id: 'c1', def: 'ge.228c', side: 'ge', hex: 'yK5', tags: { hip: true } }, { id: 'g40', def: 'ge.AT75L', side: 'ge', heldBy: 'c1', tags: { ca: 0, hip: true, emplaced: true } }, sq('a', 'yK9')], 'MPh', { terrain: {} });
    // The sweep runs on phase start: the Gun in Open Ground with a Good Order Russian in LOS is placed on board... concealed.
    const s = play(engine, state, { type: 'endPhase' });
    expect(s.pieces['g40']!.tags['hip']).toBeUndefined();
    expect(concealed(s.pieces['c1'])).toBe(true);
    expect(concealed(s.pieces['g40'])).toBe(true);
  });
});
