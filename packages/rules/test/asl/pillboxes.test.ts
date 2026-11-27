import { describe, expect, it } from 'vitest';
import type { Action, Engine, GameState, RuleModule } from '@asl/engine';
import {
  acrossSide,
  adjacentToKnownEnemy,
  adjacentFor,
  adjacentLoc,
  aslCoreModules,
  controlState,
  ccHexes,
  ccUnits,
  pendingRouts,
  planRout,
  routRequirement,
  fortCounters,
  hasLos,
  inPillboxCa,
  moveState,
  piecesModule,
  pillboxAt,
  redactState,
  statics,
  terrainOf,
  turnModule,
  type FortPlacement,
  shotContext,
  type HexTerrainSpec,
  type Tables,
} from '../../src';
import { sk1CoreModules } from '../../src/sk1';
import { sk2CoreModules } from '../../src/sk2';
import { sk3CoreModules } from '../../src/sk3';
import { act, fixtureIft, makeEngine, type PieceSpec } from '../fixtures';
import { nearestSpine } from '../../src/sk2/arc';
import { RP, type FieldPromotionFn } from '../../src/sk1/rally';

/*
 * Pillboxes in play (ASLRB B30, with A5.5, A5.6, A7.5, A8.22, A10.5x, A10.6x, A11.15, A12.3x, A26.132, C3.71, C8.31). The ground
 * is a stretch of board u: L5 woods, M4 a paved road hex; everything else Open Ground. The pillbox under test stands in O5
 * (Open Ground) with its arrow at the east hexspine, so its Covered Arc runs east through P4 and P5; or in L5 (woods).
 */

const SK: RuleModule[] = [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules];
const ASL: RuleModule[] = [...SK, ...aslCoreModules];
const GROUND: Record<string, HexTerrainSpec> = {
  uL5: { terrain: 'woods' },
  uM4: { terrain: 'open', features: ['road:paved'] },
};

/** Test actions: counters placed outright, teleports (into a pillbox with `sub: 'pb'`) and tags. */
const testModule: RuleModule = {
  id: 'test.pillbox',
  install(r) {
    r.action<Action & { fortSide: string; counters: FortPlacement[] }>({
      type: 'test.fortPlace',
      decisionKinds: ['phase', 'firstFire'],
      resolve(ctx, a) {
        const n = fortCounters(ctx).length;
        ctx.emit('asl.fort.placed', { side: a.fortSide, counters: a.counters.map((c, i) => ({ ...c, id: `${a.fortSide}.fort${n + i + 1}`, side: a.fortSide })) });
      },
    });
    r.action<Action & { id: string; hex: string; sub?: 'pb'; ent?: 'foxhole' | 'trench' }>({
      type: 'test.teleport',
      decisionKinds: ['phase'],
      resolve(ctx, a) {
        ctx.emit('piece.moved', { id: a.id, loc: { kind: 'hex', hex: a.hex, ...(a.sub ? { sub: a.sub } : {}), ...(a.ent ? { pos: { ent: a.ent } } : {}) } });
      },
    });
    r.action<Action & { id: string }>({
      type: 'test.reveal',
      decisionKinds: ['phase'],
      resolve(ctx, a) {
        const c = fortCounters(ctx).find((x) => x.id === a.id)!;
        ctx.emit('asl.fort.revealed', { counter: { ...c, revealed: true }, reason: 'los' });
      },
    });
    r.action<Action & { id: string; ca: number }>({
      type: 'test.setCa',
      decisionKinds: ['phase'],
      resolve(ctx, a) {
        const c = fortCounters(ctx).find((x) => x.id === a.id)!;
        ctx.emit('asl.fort.placed', { side: c.side, counters: [{ ...c, ca: a.ca }] });
      },
    });
    r.action<Action & { to: string }>({
      type: 'test.rubbleFalls',
      decisionKinds: ['phase'],
      resolve(ctx, a) {
        ctx.emit('asl.rubble.falling', { hex: 'uA1', falls: true, to: a.to });
      },
    });
    r.action<Action & { loc: string }>({
      type: 'test.blaze',
      decisionKinds: ['phase'],
      resolve(ctx, a) {
        ctx.emit('asl.fire.blaze', { loc: a.loc, blaze: { since: '1:ge:PFPh', kindledBy: null }, source: 'ssr' });
      },
    });
    // Leader Creation by `unit` (the stub table makes a 9-1 on any dr).
    r.action<Action & { unit: string }>({
      type: 'test.promote',
      decisionKinds: ['phase'],
      resolve(ctx, a) {
        ctx.proc<FieldPromotionFn>(RP.fieldPromotion)(ctx, a.unit, 7);
      },
    });
    r.action<Action & { id: string; tags: Record<string, unknown> }>({
      type: 'test.tag',
      decisionKinds: ['phase'],
      resolve(ctx, a) {
        ctx.emit('piece.tagged', { id: a.id, tags: a.tags as Record<string, never> });
      },
    });
  },
};

function game(pieces: PieceSpec[], opts: { dice?: number[]; phase?: string; first?: 'ge' | 'ru'; hexMarkers?: Record<string, Record<string, unknown>>; ssr?: { module: string; params: Record<string, unknown> }[]; tables?: Partial<Tables> } = {}) {
  const scenario = {
    ...(opts.ssr ? { ssr: opts.ssr } : {}),
    firstSide: opts.first ?? 'ge',
    sides: [
      { side: 'ge', name: 'German', nationality: 'ge', elr: 3 },
      { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 },
    ],
    forces: [],
  };
  return makeEngine({ board: 'u', terrain: GROUND, roadHexsides: [['uM4', 'uM5']], scenario, modules: ASL, extra: [testModule], pieces, startPhase: opts.phase ?? 'MPh', dice: opts.dice ?? [], ...(opts.hexMarkers ? { hexMarkers: opts.hexMarkers } : {}), ...(opts.tables ? { tables: opts.tables } : {}) });
}
type Eng = Engine;
const pillbox = (hex = 'uO5', opts: { ca?: number; hidden?: boolean; factors?: [1 | 2 | 3, 3 | 4 | 5, 5 | 6 | 7] } = {}): FortPlacement => {
  const [capacity, ca, nca] = opts.factors ?? [1, 3, 5];
  return { kind: 'pillbox', hex, hidden: opts.hidden ?? false, ca: opts.ca ?? 0, pillbox: { capacity, ca, nca } };
};
const place = (engine: Eng, state: GameState, fortSide: string, counters: FortPlacement[]) => act(engine, state, { type: 'test.fortPlace', fortSide, counters }).state;
const tele = (engine: Eng, state: GameState, id: string, hex: string, sub?: 'pb') => act(engine, state, { type: 'test.teleport', id, hex, ...(sub ? { sub } : {}) }).state;
const check = (engine: Eng, state: GameState, a: Record<string, unknown>) => {
  const d = engine.currentDecision(state)!;
  return engine.validate(state, { side: d.owner, decisionId: d.id, ...a } as never);
};
const pass = (engine: Eng, s: GameState, side: string) => {
  let x = s;
  while (engine.currentDecision(x)?.owner === side) x = act(engine, x, { type: 'defPass' }).state;
  return x;
};
/** End phases (passing every interrupt) until `phase` of `turn` with `attacker` moving. */
const until = (engine: Eng, s: GameState, phase: string, attacker: string, turn?: number) => {
  let x = s;
  for (let i = 0; i < 400 && !(x.phase === phase && x.attacker === attacker && (turn === undefined || x.turn === turn)); i++) {
    const d = engine.currentDecision(x);
    if (!d) throw new Error(`no decision in ${x.phase} turn ${x.turn} ${x.attacker}: ${JSON.stringify(x.result)}`);
    const legal = engine.legalActions(x, d.owner);
    const pick = ['defPass', 'move.end', 'rout.done', 'endPhase'].map((t) => legal.find((a) => a.type === t)).find(Boolean) ?? legal.find((a) => a.type === 'cc.declare') ?? legal.find((a) => a.type.startsWith('rout.'));
    if (!pick) throw new Error(`stuck in ${x.phase} on ${d.kind}: ${[...new Set(legal.map((a) => a.type))].join(', ')}`);
    const { side: _s, decisionId: _d, ...rest } = pick;
    x = act(engine, x, rest as never).state;
  }
  return x;
};
const ge = (id: string, hex: string, def = 'ge.467'): PieceSpec => ({ id, def, side: 'ge', hex });
const ru = (id: string, hex: string, def = 'ru.447'): PieceSpec => ({ id, def, side: 'ru', hex });
const far = [ge('gfar', 'uY10'), ru('rfar', 'uA1')];

describe('the pillbox Location (B30.1, B30.111, B30.2, B30.45, A5.5, A5.6)', () => {
  it('its Covered Arc runs out through its two CA hexsides; its own hex is not in it (B30.1, C3.2)', () => {
    const { engine, state } = game(far);
    const s = place(engine, state, 'ru', [pillbox()]);
    const env = engine.env(s);
    const map = statics(env).map;
    const pb = pillboxAt(env, 'uO5')!;
    // Hexspine 0 is the east corner: hexsides 5 (north-east) and 0 (south-east) are the CA hexsides.
    expect(inPillboxCa(env, pb, acrossSide(map, 'uO5', 5)!)).toBe(true);
    expect(inPillboxCa(env, pb, acrossSide(map, 'uO5', 0)!)).toBe(true);
    for (const k of [1, 2, 3, 4]) expect(inPillboxCa(env, pb, acrossSide(map, 'uO5', k)!), `hexside ${k}`).toBe(false);
    expect(inPillboxCa(env, pb, 'uO5')).toBe(false);
    // Two hexes straight east, between the two hexrows: in the CA; two hexes straight north: not.
    expect(inPillboxCa(env, pb, 'uQ5')).toBe(true);
    expect(inPillboxCa(env, pb, 'uO3')).toBe(false);
  });

  it('is a Location of its own: the pillbox terrain inside (not Open Ground, a building for rout and rally, Concealment Terrain), the hex keeps its own', () => {
    const { engine, state } = game(far);
    const s = place(engine, state, 'ru', [pillbox(), pillbox('uL5')]);
    const env = engine.env(s);
    expect(terrainOf(env, 'uO5:pb')).toMatchObject({ id: 'pillbox', openGround: false, routShelter: true, rallyCover: true, concealment: true });
    expect(terrainOf(env, 'uO5').id).toBe('open');
    expect(env.query('hex.openGround', { hex: 'uO5:pb' }, true)).toBe(false);
    expect(env.query('hex.openGround', { hex: 'uO5' }, false)).toBe(true);
    // In woods: no woods TEM inside (B30.3: not cumulative with any other TEM; the counter's own comes from the attack).
    expect(env.query('hex.tem', { hex: 'uL5:pb' }, 0)).toBe(0);
    expect(env.query('hex.tem', { hex: 'uL5' }, 0)).toBe(1);
  });

  it('holds its capacity in squad-equivalents and four SMC, per side and apart from the hex; never overstacked (B30.111, A5.5, A5.6)', () => {
    const { engine, state } = game([ru('a', 'uO5'), ru('b', 'uO5'), ru('c', 'uO5'), { id: 'l1', def: 'ru.L91', side: 'ru', hex: 'uO5' }, ...far], { first: 'ru' });
    let s = place(engine, state, 'ru', [pillbox()]);
    // Two squads into a 1-squad pillbox: refused; one squad (with a leader): taken, while two more stand outside.
    s = act(engine, s, { type: 'move.start', units: ['a', 'b'] }).state;
    expect(check(engine, s, { type: 'move.step', to: 'uO5:pb' })).toMatch(/pillbox holds 1 squad/);
    s = act(engine, s, { type: 'move.cancel' }).state;
    s = act(engine, s, { type: 'move.start', units: ['a', 'l1'] }).state;
    expect(check(engine, s, { type: 'move.step', to: 'uO5:pb' })).toBeNull();
    s = act(engine, s, { type: 'move.step', to: 'uO5:pb' }).state;
    expect(s.pieces['a']!.loc).toEqual({ kind: 'hex', hex: 'uO5', sub: 'pb' });
    // The hex outside still takes its own three squads (B30.111: "separate from ... hex stacking limits").
    const env = engine.env(s);
    expect(env.query('stack.limit', { hex: 'uO5', side: 'ru' }, { se: 3, smc: 4 }).se).toBe(3);
    expect(env.query('stack.limit', { hex: 'uO5:pb', side: 'ru' }, { se: 3, smc: 4 })).toMatchObject({ se: 1, smc: 4 });
  });

  it('Leader Creation in a full 1-squad pillbox makes no leader (A5.6; Q&A to A5.5: "The SMC is not created"); with room he is created inside', () => {
    const tables = { leaderCreation: () => 'ru.L91' };
    const inside = [ru('a', 'uO5'), ...['l1', 'l2', 'l3', 'l4'].map((id): PieceSpec => ({ id, def: 'ru.L81', side: 'ru', hex: 'uO5' })), ...far];
    const { engine, state } = game(inside, { first: 'ru', phase: 'RPh', tables, dice: [1] });
    let s = place(engine, state, 'ru', [pillbox()]);
    for (const id of ['a', 'l1', 'l2', 'l3', 'l4']) s = tele(engine, s, id, 'uO5', 'pb');
    const full = act(engine, s, { type: 'test.promote', unit: 'a' });
    expect(full.events.find((e) => e.type === 'sk1.leaderCreation')?.payload).toMatchObject({ unit: 'a', leader: null, defId: 'ru.L91', why: expect.stringMatching(/overstack the pillbox/) });
    expect(Object.keys(full.state.pieces).length).toBe(Object.keys(s.pieces).length);
    const room = game([ru('a', 'uO5'), ...far], { first: 'ru', phase: 'RPh', tables, dice: [1] });
    let t = place(room.engine, room.state, 'ru', [pillbox()]);
    t = tele(room.engine, t, 'a', 'uO5', 'pb');
    const made = act(room.engine, t, { type: 'test.promote', unit: 'a' });
    const id = (made.events.find((e) => e.type === 'sk1.leaderCreation')!.payload as { leader: string }).leader;
    expect(made.state.pieces[id]!.loc).toEqual({ kind: 'hex', hex: 'uO5', sub: 'pb' });
  });

  it('Leader Creation beneath a full foxhole puts the leader outside it, in the Location (B27.12)', () => {
    const tables = { leaderCreation: () => 'ru.L91' };
    const { engine, state } = game([ru('a', 'uN5'), ...far], { first: 'ru', phase: 'RPh', tables, dice: [1, 1] });
    let s = act(engine, state, { type: 'test.fortPlace', fortSide: 'ru', counters: [{ kind: 'foxhole', hex: 'uN5', hidden: false, capacity: 1 }] }).state;
    s = act(engine, s, { type: 'test.teleport', id: 'a', hex: 'uN5', ent: 'foxhole' }).state;
    const made = act(engine, s, { type: 'test.promote', unit: 'a' });
    const id = (made.events.find((e) => e.type === 'sk1.leaderCreation')!.payload as { leader: string }).leader;
    // A 1S foxhole holds the squad and four SMC (B27.12): room for him beneath it.
    expect(made.state.pieces[id]!.loc).toEqual({ kind: 'hex', hex: 'uN5', pos: { ent: 'foxhole' } });
    const four = ['l1', 'l2', 'l3', 'l4'];
    const f = game([ru('a', 'uN5'), ...four.map((x): PieceSpec => ({ id: x, def: 'ru.L81', side: 'ru', hex: 'uN5' })), ...far], { first: 'ru', phase: 'RPh', tables, dice: [1] });
    let u = act(f.engine, f.state, { type: 'test.fortPlace', fortSide: 'ru', counters: [{ kind: 'foxhole', hex: 'uN5', hidden: false, capacity: 1 }] }).state;
    for (const x of ['a', ...four]) u = act(f.engine, u, { type: 'test.teleport', id: x, hex: 'uN5', ent: 'foxhole' }).state;
    const out = act(f.engine, u, { type: 'test.promote', unit: 'a' });
    const lid = (out.events.find((e) => e.type === 'sk1.leaderCreation')!.payload as { leader: string }).leader;
    expect(out.state.pieces[lid]!.loc).toEqual({ kind: 'hex', hex: 'uN5' });
  });

  it('no vehicle, and no Gun pushed in or out (B30.111, B30.45), each with its own reason', () => {
    const { engine, state } = game([ge('v', 'uO5', 'ge.pzivf2'), ge('crew', 'uO6', 'ge.228c'), { id: 'gun', def: 'ge.AT75L', side: 'ge', heldBy: 'crew' }, ...far]);
    let s = place(engine, state, 'ge', [pillbox(), pillbox('uO6')]);
    const v = act(engine, s, { type: 'vmove.start', vehicle: 'v' }).state;
    expect(check(engine, v, { type: 'move.step', to: 'uO5:pb' })).toMatch(/No vehicle may occupy a pillbox \(ASLRB B30.111\)/);
    // A crew pushing its Gun on the ground of a pillbox hex may not take it inside; one inside may not push it out.
    const start = (x: GameState) => check(engine, x, { type: 'move.start', units: ['crew'], manhandle: 'gun' });
    expect(start(s)).toBeNull();
    s = tele(engine, s, 'crew', 'uO6', 'pb');
    expect(start(s)).toMatch(/No Gun may enter or leave a pillbox during play \(ASLRB B30.45\)/);
    void moveState;
  });

  it('ADJACENT through its Covered Arc for PBF, FPF, DM, rout and DC Placement only; to its own hex always (B30.2, B30.6)', () => {
    const { engine, state } = game(far);
    const s = place(engine, state, 'ru', [pillbox()]);
    const env = engine.env(s);
    const map = statics(env).map;
    const ne = acrossSide(map, 'uO5', 5)!;
    const nw = acrossSide(map, 'uO5', 3)!;
    for (const purpose of ['pbf', 'fpf', 'dm', 'rout'] as const) {
      expect(adjacentFor(env, 'uO5:pb', ne, purpose), purpose).toBe(true);
      expect(adjacentFor(env, ne, 'uO5:pb', purpose), purpose).toBe(true);
      expect(adjacentFor(env, 'uO5:pb', nw, purpose), purpose).toBe(false);
      expect(adjacentFor(env, 'uO5:pb', 'uO5', purpose), purpose).toBe(true);
    }
    // DC Placement only vs the pillbox, from outside (B30.31: never from inside to outside).
    expect(adjacentFor(env, ne, 'uO5:pb', 'dc')).toBe(true);
    expect(adjacentFor(env, 'uO5:pb', ne, 'dc')).toBe(false);
    // Not ADJACENT for anything else (A.8: a unit could not move between them in the APh).
    expect(adjacentLoc(env, 'uO5:pb', ne)).toBe(false);
    expect(adjacentLoc(env, 'uO5:pb', 'uO5')).toBe(true);
  });
});

describe('into and out of the pillbox (B30.4, B30.33, B30.42, B30.44, B30.6, B26.4, A12.33, A12.15, A4.61)', () => {
  it('one MF into the hex, a Defensive First Fire chance there, one MF into the pillbox and another chance at the new Location; next turn out and on (B30.4 EX, B30.33)', () => {
    // The German 4-6-7 in Q5 watches through the CA; the Russian 4-4-7 walks N5 -> O5 -> into the pillbox.
    const { engine, state } = game([ru('r', 'uN5'), ge('g', 'uQ5'), ...far], { first: 'ru' });
    let s = place(engine, state, 'ru', [pillbox()]);
    s = act(engine, s, { type: 'move.start', units: ['r'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uO5' }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'firstFire', owner: 'ge', data: { hex: 'uO5' } });
    s = pass(engine, s, 'ge');
    expect(engine.legalActions(s, 'ru').some((a) => a.type === 'move.step' && a['to'] === 'uO5:pb')).toBe(true);
    s = act(engine, s, { type: 'move.step', to: 'uO5:pb' }).state;
    // In the new Location before any attack that MF prompts is resolved (B30.33).
    expect(s.pieces['r']!.loc).toEqual({ kind: 'hex', hex: 'uO5', sub: 'pb' });
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'firstFire', owner: 'ge', data: { hex: 'uO5:pb' } });
    expect(moveState(engine.env(s))!.spent['r']).toBe(2);
    s = pass(engine, s, 'ge');
    s = act(engine, s, { type: 'move.end' }).state;
    s = pass(engine, s, 'ge');
    // The next Russian MPh: out (one MF, back on the ground of the hex) and on to O6; nothing of the pillbox stays with it.
    s = until(engine, s, 'MPh', 'ru', 2);
    s = act(engine, s, { type: 'move.start', units: ['r'] }).state;
    expect(check(engine, s, { type: 'move.step', to: 'uO6' })).toMatch(/not ADJACENT|adjacent/);
    s = act(engine, s, { type: 'move.step', to: 'uO5' }).state;
    s = pass(engine, s, 'ge');
    expect(moveState(engine.env(s))!.spent['r']).toBe(1);
    s = act(engine, s, { type: 'move.step', to: 'uO6' }).state;
    s = pass(engine, s, 'ge');
    expect(s.pieces['r']!.loc).toEqual({ kind: 'hex', hex: 'uO6' });
    expect(moveState(engine.env(s))!.spent['r']).toBe(2);
  });

  it('Assault Movement: the hex and then the pillbox are two Locations; from the hex alone into the pillbox, one (A4.61)', () => {
    const { engine, state } = game([ru('r', 'uN5'), ru('q', 'uO5'), ...far], { first: 'ru' });
    let s = place(engine, state, 'ru', [pillbox()]);
    s = act(engine, s, { type: 'move.start', units: ['r'], assault: true }).state;
    s = act(engine, s, { type: 'move.step', to: 'uO5' }).state;
    s = pass(engine, s, 'ge');
    // Its one Location entered, the Assault Moving stack has nothing more it may do: the pillbox would be a second (A4.61).
    expect(moveState(engine.env(s))).toBeUndefined();
    s = act(engine, s, { type: 'move.start', units: ['q'], assault: true }).state;
    expect(check(engine, s, { type: 'move.step', to: 'uO5:pb' })).toBeNull();
  });

  it('never in while an enemy ground unit is outside it in the hex, never into enemy Infantry, never from on top of the Wire; never out past an enemy in the hex (B30.42, B30.44, B26.4, B30.6)', () => {
    const { engine, state } = game([ru('r', 'uO5'), ge('v', 'uO5', 'ge.pzivf2'), ru('w', 'uO6'), ge('inside', 'uY9'), ru('k', 'uL6'), ...far], { first: 'ru' });
    let s = place(engine, state, 'ru', [pillbox(), pillbox('uO6')]);
    s = place(engine, s, 'ge', [pillbox('uL5'), { kind: 'wire', hex: 'uO6', hidden: false }]);
    s = tele(engine, s, 'inside', 'uL5', 'pb');
    s = act(engine, s, { type: 'test.teleport', id: 'w', hex: 'uO6' } as never).state;
    s = act(engine, s, { type: 'move.start', units: ['r'] }).state;
    expect(check(engine, s, { type: 'move.step', to: 'uO5:pb' })).toMatch(/enemy unit is in the hex outside the pillbox.*B30.42/);
    s = act(engine, s, { type: 'move.cancel' }).state;
    // The Russian squad on top of the Wire in O6 (it arrived there): the pillbox is out of reach until it is beneath it.
    s = act(engine, s, { type: 'test.teleport', id: 'w', hex: 'uO6' } as never).state;
    s = act(engine, s, { type: 'move.start', units: ['k'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uL5' }).state;
    s = pass(engine, s, 'ge');
    expect(check(engine, s, { type: 'move.step', to: 'uL5:pb' })).toMatch(/Enemy Infantry hold the pillbox.*B30.44/);
    s = act(engine, s, { type: 'move.end' }).state;
    s = pass(engine, s, 'ge');
    // Out: the Russian in the O5 pillbox with the German AFV on the ground outside may not move out.
    s = tele(engine, s, 'r', 'uO5', 'pb');
    s = act(engine, s, { type: 'move.start', units: ['r'] }).state;
    expect(check(engine, s, { type: 'move.step', to: 'uO5' })).toMatch(/may only advance out.*B30.6/);
  });

  it('on top of the Wire a unit may not enter the pillbox of its hex; beneath it, it may (B26.4)', () => {
    const { engine, state } = game([ru('w', 'uN6'), ...far], { first: 'ru' });
    let s = place(engine, state, 'ru', [pillbox('uO6')]);
    s = place(engine, s, 'ge', [{ kind: 'wire', hex: 'uO6', hidden: false }]);
    s = act(engine, s, { type: 'move.start', units: ['w'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uO6' }).state;
    s = pass(engine, s, 'ge');
    expect(s.pieces['w']!.loc).toMatchObject({ hex: 'uO6', pos: { wire: 'on' } });
    expect(check(engine, s, { type: 'move.step', to: 'uO6:pb' })).toMatch(/on top of the Wire/i);
    expect(check(engine, s, { type: 'move.wire' })).toBeNull();
  });

  it('into its own hidden pillbox for no MF, with no First Fire chance and nothing for the other side to see; once revealed, one MF (A12.33)', () => {
    // In the L5 woods (Concealment Terrain), no German within 16 hexes: the pillbox stays hidden (A12.33).
    const { engine, state } = game([ru('r', 'uL5'), ru('r2', 'uA2'), ge('g', 'uGG10'), ru('rfar', 'uA1')], { first: 'ru' });
    let s = place(engine, state, 'ru', [pillbox('uL5', { hidden: true }, )]);
    s = act(engine, s, { type: 'move.start', units: ['r'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uL5:pb' }).state;
    expect(moveState(engine.env(s))!.spent['r'] ?? 0).toBe(0);
    expect(engine.currentDecision(s)!.owner).toBe('ru');
    const theirs = redactState(engine, s, 'ge');
    expect(theirs.pieces['r']!.loc).toEqual({ kind: 'hex', hex: 'uL5' });
    expect(moveState(engine.env(theirs))!.sub).toBeUndefined();
    expect(redactState(engine, s, null).pieces['r']!.loc).toEqual({ kind: 'hex', hex: 'uL5' });
    expect(redactState(engine, s, 'ru').pieces['r']!.loc).toEqual({ kind: 'hex', hex: 'uL5', sub: 'pb' });
    s = act(engine, s, { type: 'move.end' }).state;
    // Revealed, the pillbox costs one MF out like any other.
    const pb = fortCounters(engine.env(s)).find((c) => c.kind === 'pillbox')!;
    s = act(engine, s, { type: 'test.reveal', id: pb.id } as never).state;
    s = tele(engine, s, 'r2', 'uL5', 'pb');
    s = act(engine, s, { type: 'move.start', units: ['r2'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uL5' }).state;
    expect(moveState(engine.env(s))!.spent['r2']).toBe(1);
  });

  it('a hidden unit inside the pillbox does not turn back a unit entering the hex outside it; one entering the pillbox would find it (A12.15, B30.43)', () => {
    const { engine, state } = game([ru('h', 'uY9'), ge('g', 'uP5'), ...far]);
    let s = place(engine, state, 'ru', [pillbox()]);
    s = tele(engine, s, 'h', 'uO5', 'pb');
    s = act(engine, s, { type: 'test.tag', id: 'h', tags: { hip: true } }).state;
    s = act(engine, s, { type: 'move.start', units: ['g'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uO5' }).state;
    s = pass(engine, s, 'ru');
    expect(s.pieces['g']!.loc).toEqual({ kind: 'hex', hex: 'uO5' });
    expect(s.pieces['h']!.tags['hip']).toBe(true);
  });

  it('out of the pillbox into SMOKE on the ground of its hex costs the SMOKE MF too (B30.4 EX, A24.7)', () => {
    const { engine, state } = game([ru('r', 'uO5'), ...far], { first: 'ru', hexMarkers: { uO5: { smoke: true } } });
    let s = place(engine, state, 'ru', [pillbox()]);
    s = tele(engine, s, 'r', 'uO5', 'pb');
    s = act(engine, s, { type: 'move.start', units: ['r'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uO5' }).state;
    expect(moveState(engine.env(s))!.spent['r']).toBe(2);
  });
});

describe('advancing into and out of the pillbox (B30.42, B30.44, B30.6, A4.7)', () => {
  it('into the pillbox of its own hex as its one Location, never straight from the next hex; next turn out again into the hex', () => {
    const { engine, state } = game([ru('r', 'uO5'), ru('n', 'uN5'), ...far], { first: 'ru', phase: 'APh' });
    let s = place(engine, state, 'ru', [pillbox()]);
    expect(check(engine, s, { type: 'advance', units: ['n'], to: 'uO5:pb' })).toMatch(/Advance is one hex/);
    expect(engine.legalActions(s, 'ru').some((a) => a.type === 'advance' && a['to'] === 'uO5:pb' && (a['units'] as string[]).includes('r'))).toBe(true);
    s = act(engine, s, { type: 'advance', units: ['r'], to: 'uO5:pb' }).state;
    expect(s.pieces['r']!.loc).toEqual({ kind: 'hex', hex: 'uO5', sub: 'pb' });
    // Next Russian APh: the only Location it may advance to is the hex it stands in (B30.6 "must halt in the pillbox hex").
    s = until(engine, s, 'APh', 'ru', 2);
    expect(s.pieces['r']!.tags['advanced']).toBeUndefined();
    const outs = engine.legalActions(s, 'ru').filter((a) => a.type === 'advance' && (a['units'] as string[]).includes('r')).map((a) => a['to']);
    expect([...new Set(outs)]).toEqual(['uO5']);
    s = act(engine, s, { type: 'advance', units: ['r'], to: 'uO5' }).state;
    expect(s.pieces['r']!.loc).toEqual({ kind: 'hex', hex: 'uO5' });
  });

  it('never into enemy Infantry or past an enemy ground unit outside; out of it even beside the enemy (B30.42, B30.44, B30.6)', () => {
    const { engine, state } = game([ru('r', 'uO5'), ge('v', 'uO5', 'ge.pzivf2'), ru('q', 'uL5'), ge('g', 'uY9'), ru('i', 'uY8'), ...far], { first: 'ru', phase: 'APh' });
    let s = place(engine, state, 'ru', [pillbox(), pillbox('uP6')]);
    s = place(engine, s, 'ge', [pillbox('uL5')]);
    s = tele(engine, s, 'g', 'uL5', 'pb');
    expect(check(engine, s, { type: 'advance', units: ['r'], to: 'uO5:pb' })).toMatch(/B30.42/);
    expect(check(engine, s, { type: 'advance', units: ['q'], to: 'uL5:pb' })).toMatch(/B30.44/);
    // A Russian inside the O5 pillbox with the German AFV outside may still advance out into the hex.
    s = tele(engine, s, 'i', 'uO5', 'pb');
    expect(check(engine, s, { type: 'advance', units: ['i'], to: 'uO5' })).toBeNull();
  });
});

describe('fire from inside the pillbox (B30.2, A7.5, B30.44, C13.8)', () => {
  it('LOS out only within its Covered Arc; a LOS to it from outside the arc is not limited (B30.2)', () => {
    const { engine, state } = game([ru('r', 'uY9'), ge('east', 'uQ5'), ge('north', 'uO3'), ...far], { phase: 'PFPh', first: 'ru' });
    let s = place(engine, state, 'ru', [pillbox()]);
    s = tele(engine, s, 'r', 'uO5', 'pb');
    const env = engine.env(s);
    expect(hasLos(env, 'uO5:pb', 'uQ5')).toBe(true);
    expect(hasLos(env, 'uO5:pb', 'uO3')).toBe(false);
    expect(hasLos(env, 'uO3', 'uO5:pb')).toBe(true);
    expect(check(engine, s, { type: 'fire', decl: { units: ['r'], sw: [], target: 'uQ5' } })).toBeNull();
    expect(check(engine, s, { type: 'fire', decl: { units: ['r'], sw: [], target: 'uO3' } })).toMatch(/Outside the pillbox's Covered Arc.*B30.2/);
    // The offered shots name only targets in the arc.
    const targets = engine.legalActions(s, 'ru').filter((a) => a.type === 'fire').map((a) => (a['decl'] as { target: string }).target);
    expect(targets).toContain('uQ5');
    expect(targets).not.toContain('uO3');
  });

  it('never one Fire Group with units outside, nor directed by a leader outside; next Player Turn the squad inside fires again (A7.5, A2.8)', () => {
    const { engine, state } = game([ru('r', 'uO5'), ru('o', 'uO5'), { id: 'L', def: 'ru.L91', side: 'ru', hex: 'uO5' }, ge('east', 'uQ5'), ...far], { phase: 'PFPh', first: 'ru' });
    let s = place(engine, state, 'ru', [pillbox()]);
    s = tele(engine, s, 'r', 'uO5', 'pb');
    expect(check(engine, s, { type: 'fire', decl: { units: ['r', 'o'], sw: [], target: 'uQ5' } })).toMatch(/Fire Group with units outside.*A7.5/);
    expect(check(engine, s, { type: 'fire', decl: { units: ['r'], sw: [], target: 'uQ5', directors: ['L'] } })).toBeTruthy();
    s = act(engine, s, { type: 'fire', decl: { units: ['r'], sw: [], target: 'uQ5' } }).state;
    expect(s.pieces['r']!.tags['fire']).toBe('prep');
    s = until(engine, s, 'PFPh', 'ru', 2);
    expect(s.pieces['r']!.tags['fire']).toBeUndefined();
    expect(check(engine, s, { type: 'fire', decl: { units: ['r'], sw: [], target: 'uQ5' } })).toBeNull();
  });

  it('into its own hex only by PBF at a unit crossing a CA hexside: one entering from P5 may be fired on, one from N5 may not (B30.2, B30.44)', () => {
    const { engine, state } = game([ru('r', 'uY9'), ge('a', 'uP5'), ge('b', 'uN5'), ...far]);
    let s = place(engine, state, 'ru', [pillbox()]);
    s = tele(engine, s, 'r', 'uO5', 'pb');
    s = act(engine, s, { type: 'move.start', units: ['a'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uO5' }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'firstFire', owner: 'ru' });
    expect(check(engine, s, { type: 'defFire', decl: { units: ['r'], sw: [], target: 'uO5' } })).toBeNull();
    s = pass(engine, s, 'ru');
    s = act(engine, s, { type: 'move.end' }).state;
    s = pass(engine, s, 'ru');
    s = act(engine, s, { type: 'move.start', units: ['b'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uO5' }).state;
    // No First Fire is offered from the pillbox at it: the only Russian who could fire may not.
    expect(engine.currentDecision(s)?.kind).not.toBe('firstFire');
    expect(engine.env(s).query('fire.illegal', { decl: { units: ['r'], sw: [], target: 'uO5' }, mode: 'first', side: 'ru', moving: ['b'] }, null)).toMatch(/limited to PBF at units crossing its CA hexsides.*B30.2/);
    // A unit already standing on the ground of the hex is not crossing anything: no fire at it in a fire phase.
    s = until(engine, s, 'PFPh', 'ru', 1);
    expect(check(engine, s, { type: 'fire', decl: { units: ['r'], sw: [], target: 'uO5' } })).toMatch(/B30.2/);
  });

  it('no mortar fire from inside; a BAZ fires only with the Desperation Backblast (B30.2, C13.8, C13.81)', () => {
    const { engine, state } = game([ge('m', 'uO5'), { id: 'mtr', def: 'ge.MTR', side: 'ge', heldBy: 'm' }, ge('b', 'uO6'), { id: 'baz', def: 'ge.BAZ43', side: 'ge', heldBy: 'b' }, ru('t', 'uQ5'), ru('t2', 'uQ6'), ...far], { phase: 'PFPh' });
    let s = place(engine, state, 'ge', [pillbox(), pillbox('uO6')]);
    s = tele(engine, s, 'm', 'uO5', 'pb');
    s = tele(engine, s, 'b', 'uO6', 'pb');
    const env = engine.env(s);
    expect(env.query('ordnance.illegal', { shot: { weapon: 'mtr', target: 'uQ5', targetType: 'ATT' }, mode: 'prep', side: 'ge' }, null)).toMatch(/Mortar fire is NA from inside a pillbox/);
    expect(env.query('ordnance.illegal', { shot: { weapon: 'baz', target: 'uQ6', targetType: 'ITT', backblast: false }, mode: 'prep', side: 'ge' }, null)).toMatch(/Desperation.*C13.8/);
    const bb = env.query('ordnance.illegal', { shot: { weapon: 'baz', target: 'uQ6', targetType: 'ITT', backblast: true }, mode: 'prep', side: 'ge' }, null);
    expect(bb ?? '').not.toMatch(/Desperation|Backblast only/);
  });

  it('SMOKE grenades from inside go only into its own hex outside, for two MF (A24.1, B30.34)', () => {
    const { engine, state } = game([ge('g', 'uO5'), ...far]);
    let s = place(engine, state, 'ge', [pillbox()]);
    s = tele(engine, s, 'g', 'uO5', 'pb');
    s = act(engine, s, { type: 'move.start', units: ['g'] }).state;
    expect(check(engine, s, { type: 'move.smoke', throws: [{ unit: 'g', target: 'uP5' }] })).toMatch(/only into its own hex/);
    expect(check(engine, s, { type: 'move.smoke', throws: [{ unit: 'g', target: 'uO5' }] })).toBeNull();
    engine.forceDice(1);
    s = act(engine, s, { type: 'move.smoke', throws: [{ unit: 'g', target: 'uO5' }] }).state;
    s = pass(engine, s, 'ru');
    expect(moveState(engine.env(s))!.spent['g']).toBe(2);
    expect(s.hexMarkers['uO5']?.['smoke']).toBe(1);
  });
});

const attackLabels = (events: { type: string; payload: unknown }[]) => ((events.find((e) => e.type === 'sk1.fire.attack')?.payload as { explain?: { label?: string }[] } | undefined)?.explain ?? []).map((n) => n.label ?? '');

describe('fire at the pillbox: the CA and NCA Defense Modifications (B30.112, B30.113, B30.3, B30.7, A22.2, A8.22)', () => {
  /** The L5 woods pillbox facing east, a Russian 4-4-7 inside; Germans in the hex south-east of it (in the CA) and north-west (not). */
  function setup(extra: PieceSpec[] = [], opts: { phase?: string; dice?: number[] } = {}) {
    const g0 = game([], { phase: opts.phase ?? 'PFPh' });
    const map = statics(g0.engine.env(g0.state)).map;
    const caHex = acrossSide(map, 'uL5', 0)!;
    const ncaHex = acrossSide(map, 'uL5', 3)!;
    const { engine, state } = game([ru('r', 'uY9'), ge('ca', caHex), ge('nca', ncaHex), ...extra, ...far], { phase: opts.phase ?? 'PFPh', dice: opts.dice ?? [] });
    let s = place(engine, state, 'ru', [pillbox('uL5')]);
    s = tele(engine, s, 'r', 'uL5', 'pb');
    return { engine, s, caHex, ncaHex };
  }

  it('Small Arms from the CA take the CA DM, not the woods TEM besides; from the NCA they are NA (B30.112, B30.113, B30.3)', () => {
    const { engine, s } = setup([], { dice: [4, 4] });
    expect(check(engine, s, { type: 'fire', decl: { units: ['nca'], sw: [], target: 'uL5:pb' } })).toMatch(/NA through the NCA of a pillbox.*B30.113/);
    const t = act(engine, s, { type: 'fire', decl: { units: ['ca'], sw: [], target: 'uL5:pb' } });
    const labels = attackLabels(t.events);
    expect(labels.some((l) => /\+3 pillbox CA Defense Modification/.test(l))).toBe(true);
    expect(labels.some((l) => /Woods/.test(l))).toBe(false);
    // No Residual FP is left in a pillbox, nor in its hex by an attack on it (A8.22): Prep Fire leaves none anyway; DFF below.
  });

  it('a FT through the NCA takes the NCA DM; through the CA no TEM at all (A22.2, B30.113)', () => {
    const { engine, s, caHex, ncaHex } = setup([], { dice: [4, 4, 4, 4] });
    let x = s;
    x = act(engine, x, { type: 'test.teleport', id: 'ca', hex: caHex } as never).state;
    const ftCa = { id: 'ft1', def: 'ge.FT', side: 'ge' };
    void ftCa;
    void ncaHex;
    const g = game([ru('r', 'uY9'), ge('a', caHex), { id: 'fa', def: 'ge.FT', side: 'ge', heldBy: 'a' }, ge('b', acrossSide(statics(engine.env(s)).map, 'uL5', 3)!), { id: 'fb', def: 'ge.FT', side: 'ge', heldBy: 'b' }, ...far], { phase: 'PFPh', dice: [4, 4, 4, 4] });
    let y = place(g.engine, g.state, 'ru', [pillbox('uL5')]);
    y = tele(g.engine, y, 'r', 'uL5', 'pb');
    const nca = act(g.engine, y, { type: 'fire', decl: { units: [], sw: ['fb'], target: 'uL5:pb' } });
    expect(attackLabels(nca.events).some((l) => /\+5 pillbox NCA Defense Modification/.test(l))).toBe(true);
    const ca = act(g.engine, nca.state, { type: 'fire', decl: { units: [], sw: ['fa'], target: 'uL5:pb' } });
    expect(attackLabels(ca.events).some((l) => /pillbox|TEM/.test(l))).toBe(false);
  });

  it('a hidden unit inside is attacked at full FP: no Area Fire for HIP in a pillbox (B30.7)', () => {
    // 4-6-7 with MMG from the CA (8 FP, the 8 column) and an Original 2: with the +3 a Final 5, a K/1 at full FP (a NMC if halved).
    const { engine, s, caHex } = setup([{ id: 'mmg', def: 'ge.MMG', side: 'ge', heldBy: 'ca' }], { dice: [1, 1, 6, 6, 6, 6] });
    let x = act(engine, s, { type: 'test.tag', id: 'r', tags: { hip: true } }).state;
    const pb = fortCounters(engine.env(x)).find((c) => c.kind === 'pillbox')!;
    void pb;
    void caHex;
    const t = act(engine, x, { type: 'fire', decl: { units: ['ca'], sw: ['mmg'], target: 'uL5:pb' } });
    x = t.state;
    const res = t.events.find((e) => e.type === 'sk1.fire.result' && (e.payload as { unit: string }).unit === 'r')?.payload as { result: { kind: string } };
    expect(res.result.kind).toBe('K');
  });

  it('Defensive First Fire at a stack entering the pillbox leaves no Residual FP in it or in the hex (A8.22)', () => {
    const { engine, state } = game([ru('m', 'uO5'), ge('g', 'uQ5'), ...far], { first: 'ru', dice: [5, 6] });
    let s = place(engine, state, 'ru', [pillbox()]);
    s = act(engine, s, { type: 'move.start', units: ['m'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uO5:pb' }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'firstFire', data: { hex: 'uO5:pb' } });
    s = act(engine, s, { type: 'defFire', decl: { units: ['g'], sw: [], target: 'uO5:pb' } }).state;
    expect(s.hexMarkers['uO5:pb']?.['residualFp']).toBeUndefined();
    expect(s.hexMarkers['uO5']?.['residualFp']).toBeUndefined();
  });
});

describe('fire at a pillbox the firer has not been shown (Q&A to A7 and B30; B30.7, A12.33)', () => {
  // The Russian side has one 1+3+5 pillbox it may set up in L5 (woods, Concealment Terrain); the German MMG in CC5 is 17 hexes
  // away (beyond 16: its LOS reveals nothing, A12.33) and fires at "a possible pillbox" in L5.
  const SSR = [{ module: 'fortifications', params: { side: 'ru', pillboxes: [{ capacity: 1, ca: 3, nca: 5 }], within: ['uL5', 'uL6'] } }];
  function bothGames(dice: number[]) {
    const out = [true, false].map((withPillbox) => {
      const { engine, state } = game([ru('r', 'uY9'), ge('g', 'uCC5'), { id: 'mmg', def: 'ge.MMG', side: 'ge', heldBy: 'g' }, ru('rfar', 'uA1')], { phase: 'PFPh', ssr: SSR, dice });
      let s = withPillbox ? place(engine, state, 'ru', [pillbox('uL5', { hidden: true, ca: 4 })]) : state;
      if (withPillbox) {
        s = tele(engine, s, 'r', 'uL5', 'pb');
        s = act(engine, s, { type: 'test.tag', id: 'r', tags: { hip: true } }).state;
      }
      return { engine, s, withPillbox };
    });
    return out;
  }

  it('may be declared whether a pillbox is there or not; an attack with no effect reads alike to the German, and nothing is revealed', () => {
    const games = bothGames([5, 6]);
    for (const g of games) expect(check(g.engine, g.s, { type: 'fire', decl: { units: [], sw: ['mmg'], target: 'uL5:pb' } }), `${g.withPillbox}`).toBeNull();
    const streams = games.map((g) => {
      const d = g.engine.currentDecision(g.s)!;
      const t = g.engine.submit(g.s, { type: 'fire', decl: { units: [], sw: ['mmg'], target: 'uL5:pb' }, side: d.owner, decisionId: d.id } as never);
      expect(fortCounters(g.engine.env(t.state)).every((c) => !c.revealed)).toBe(true);
      // The decision ids count the events before the attack, which the two games' set-ups differ in: masked.
      return JSON.stringify(g.engine.redactTransition('ge', (x) => redactState(g.engine, x, 'ge'), g.s, t.events as never).map((e) => ({ ...e, seq: undefined }))).replace(/"d\d+"/g, '"d"');
    });
    expect(streams[0]).toEqual(streams[1]);
    // A hex a Good Order German can see within 16 hexes would have shown a pillbox: no attack at one there.
    const near = game([ge('g', 'uP5'), ru('rfar', 'uA1')], { phase: 'PFPh', ssr: SSR });
    expect(check(near.engine, near.state, { type: 'fire', decl: { units: ['g'], sw: [], target: 'uL5:pb' } })).toMatch(/Unknown target/);
  });

  it('through its CA, a result of PTC or better reveals the pillbox and attacks its contents (the Q&A to A7 and B30)', () => {
    // CA facing west-south-west (hexspine 4 is the north-west corner? the arc here faces the German in CC5 only if it does).
    const [withPb] = bothGames([1, 2, 6, 6, 6, 6]);
    const env = withPb!.engine.env(withPb!.s);
    const pb = fortCounters(env).find((c) => c.kind === 'pillbox')!;
    const caHexspine = [0, 1, 2, 3, 4, 5].find((k) => inPillboxCa(env, { ...pb, ca: k }, 'uCC5'))!;
    let s = act(withPb!.engine, withPb!.s, { type: 'test.fortPlace', fortSide: 'ge', counters: [] } as never).state;
    s = act(withPb!.engine, s, { type: 'test.setCa', id: pb.id, ca: caHexspine } as never).state;
    const t = act(withPb!.engine, s, { type: 'fire', decl: { units: [], sw: ['mmg'], target: 'uL5:pb' } });
    expect(caHexspine).toBeDefined();
    expect(t.events.some((e) => e.type === 'asl.fort.revealed')).toBe(true);
    expect(t.events.some((e) => e.type === 'sk1.fire.result' && (e.payload as { unit: string }).unit === 'r')).toBe(true);
  });

  it('through its CA, a result its DM turned to no effect claims the TEM and reveals the pillbox (A12.33); through the NCA nothing (B30.113)', () => {
    for (const through of ['ca', 'nca'] as const) {
      // An Original 5: no effect with the +3, a PTC without it.
      const [withPb] = bothGames([2, 3]);
      const env = withPb!.engine.env(withPb!.s);
      const pb = fortCounters(env).find((c) => c.kind === 'pillbox')!;
      const k = [0, 1, 2, 3, 4, 5].find((x) => inPillboxCa(env, { ...pb, ca: x }, 'uCC5') === (through === 'ca'))!;
      const s = act(withPb!.engine, withPb!.s, { type: 'test.setCa', id: pb.id, ca: k } as never).state;
      const t = act(withPb!.engine, s, { type: 'fire', decl: { units: [], sw: ['mmg'], target: 'uL5:pb' } });
      const rev = t.events.find((e) => e.type === 'asl.fort.revealed')?.payload as { reason: string } | undefined;
      if (through === 'ca') expect(rev?.reason).toBe('tem');
      else expect(rev).toBeUndefined();
      expect(t.state.pieces['r']!.tags['hip']).toBe(true);
    }
  });
});

describe('ordnance at the pillbox (B30.112, B30.113, B30.32, B30.34, B30.35, B30.92, C3.71, C6.7, C8.31)', () => {
  /** A German crew with `gunDef` in `hex`, its Gun turned at L5; the Russian 4-4-7 inside the L5 woods pillbox facing east. */
  function gunGame(hex: string, gunDef = 'ge.AT75L', opts: { dice?: number[]; tables?: Partial<Tables>; extra?: PieceSpec[] } = {}) {
    const g0 = game([]);
    const map = statics(g0.engine.env(g0.state)).map;
    const spine = nearestSpine(map.hex(hex)!.cube, 0, map.hex('uL5')!.cube)!;
    const { engine, state } = game([ru('r', 'uY9'), ge('c', hex, 'ge.228c'), { id: 'gun', def: gunDef, side: 'ge', heldBy: 'c', tags: { ca: spine } }, ...(opts.extra ?? []), ...far], { phase: 'PFPh', dice: opts.dice ?? [], ...(opts.tables ? { tables: opts.tables } : {}) });
    let s = place(engine, state, 'ru', [pillbox('uL5')]);
    s = tele(engine, s, 'r', 'uL5', 'pb');
    return { engine, s, map };
  }
  const thLabels = (env: ReturnType<Eng['env']>, shot: Record<string, unknown>) => {
    const t = env.explain('ordnance.thDrm', shotContext(env, shot as never, 'prep', 'ge'), 0);
    return t.trace.filter((e) => !e.suppressedBy && e.before !== e.after).map((e) => e.label ?? e.id);
  };

  it('on the Infantry Target Type the To Hit DR takes the CA DM from the CA, the NCA DM from elsewhere, never the woods TEM (B30.112, B30.113, B30.3)', () => {
    const g0 = game([]);
    const map = statics(g0.engine.env(g0.state)).map;
    const ca = acrossSide(map, acrossSide(map, 'uL5', 0)!, 0)!;
    const nca = acrossSide(map, acrossSide(map, 'uL5', 2)!, 2)!;
    for (const [hex, want] of [[ca, /\+3 pillbox CA/], [nca, /\+5 pillbox NCA/]] as const) {
      const { engine, s } = gunGame(hex, 'ge.INF150s');
      const labels = thLabels(engine.env(s), { weapon: 'gun', target: 'uL5:pb', targetType: 'ITT' });
      expect(labels.some((l) => want.test(l)), labels.join(' | ')).toBe(true);
      expect(labels.some((l) => /Woods|Target Size|target size/.test(l)), labels.join(' | ')).toBe(false);
    }
  });

  it('AP whose Basic TK# is more than twice the DM ignores it; the hit is resolved by HE-Equivalency (B30.35, C8.31)', () => {
    const g0 = game([]);
    const map = statics(g0.engine.env(g0.state)).map;
    const ca = acrossSide(map, acrossSide(map, 'uL5', 0)!, 0)!;
    const { engine, s } = gunGame(ca, 'ge.AT75L');
    const env = engine.env(s);
    expect(thLabels(env, { weapon: 'gun', target: 'uL5:pb', targetType: 'ITT', ammo: 'AP' }).some((l) => /pillbox/.test(l))).toBe(false);
    expect(thLabels(env, { weapon: 'gun', target: 'uL5:pb', targetType: 'ITT', ammo: 'HE' }).some((l) => /pillbox/.test(l))).toBe(true);
  });

  it('no Vehicle Target Type; HEAT may fire at Infantry in a pillbox (B30.32, C8.31)', () => {
    const g0 = game([]);
    const map = statics(g0.engine.env(g0.state)).map;
    const ca = acrossSide(map, acrossSide(map, 'uL5', 0)!, 0)!;
    const { engine, s } = gunGame(ca, 'ge.INF150s');
    const env = engine.env(s);
    expect(env.query('ordnance.illegal', { shot: { weapon: 'gun', target: 'uL5:pb', targetType: 'VTT' }, mode: 'prep', side: 'ge' }, null)).toBeTruthy();
    expect(env.query('ordnance.illegal', { shot: { weapon: 'gun', target: 'uL5:pb', targetType: 'ITT', ammo: 'HEAT' }, mode: 'prep', side: 'ge' }, null) ?? '').not.toMatch(/HEAT may only be fired/);
  });

  it('EX 2: a 150mm Gun in the CA of a brown pillbox hits on the ITT; an Original IFT DR of 3 (a 3KIA on the 30 column) eliminates it and its contents (B30.92)', () => {
    const g0 = game([]);
    const map = statics(g0.engine.env(g0.state)).map;
    const ca = acrossSide(map, acrossSide(map, 'uL5', 0)!, 0)!;
    // The real chart's 150mm ITT column is 30, and an Original 3 there a 3KIA (the fixture IFT stops at 2KIA).
    const tables: Partial<Tables> = {
      gunColumn: (def, tt) => (def.caliber >= 150 ? (tt === 'ITT' ? 30 : tt === 'ATT' ? 16 : 36) : 6),
      ift: (col, dr) => (col === 30 && dr <= 3 ? { kind: 'KIA', n: 3 } : fixtureIft(col, dr)),
    };
    // To Hit: an Original 5 (+3 CA) = 8 against 9 at two hexes, no CH; then the IFT Original 3.
    const { engine, s } = gunGame(ca, 'ge.INF150s', { dice: [2, 3, 1, 2, 6, 6, 6, 6], tables });
    const t = act(engine, s, { type: 'fire.ordnance', shot: { weapon: 'gun', target: 'uL5:pb', targetType: 'ITT' } });
    expect(t.events.find((e) => e.type === 'asl.pb.eliminated')?.payload).toMatchObject({ hex: 'uL5' });
    expect(pillboxAt(engine.env(t.state), 'uL5')).toBeNull();
    expect(t.state.pieces['r']!.loc.kind).toBe('eliminated');
    expect(controlState(engine.env(t.state)).locations?.['uL5:pb']).toBeUndefined();
    // A 2KIA would not have done it: the CA DM of 3 applied to the To Hit DR (B30.92).
    const two = gunGame(ca, 'ge.INF150s', { dice: [2, 3, 1, 2, 6, 6, 6, 6], tables: { ...tables, ift: (col, dr) => (col === 30 && dr <= 3 ? { kind: 'KIA', n: 2 } : fixtureIft(col, dr)) } });
    const t2 = act(two.engine, two.s, { type: 'fire.ordnance', shot: { weapon: 'gun', target: 'uL5:pb', targetType: 'ITT' } });
    expect(pillboxAt(two.engine.env(t2.state), 'uL5')).not.toBeNull();
    // Into the next Player Turn the eliminated pillbox leaves no Location behind.
    const next = until(engine, t.state, 'PFPh', 'ge', 2);
    expect(engine.env(next).query('hex.locations', { hex: 'uL5' }, ['uL5'])).toEqual(['uL5']);
  });

  it('an Area Target Type hit on the hex reaches the pillbox with its DM; a Critical Hit through the CA reverses the CA DM, through the NCA zero (B30.34, B30.113, C3.71)', () => {
    const g0 = game([]);
    const map = statics(g0.engine.env(g0.state)).map;
    const ca = acrossSide(map, acrossSide(map, 'uL5', 0)!, 0)!;
    // ATT To Hit 7 at two hexes: Original 3 hits (CH needs 2); IFT 6,6 (no effect).
    const { engine, s } = gunGame(ca, 'ge.INF150s', { dice: [1, 2, 6, 6] });
    const t = act(engine, s, { type: 'fire.ordnance', shot: { weapon: 'gun', target: 'uL5', targetType: 'ATT' } });
    const atPb = t.events.filter((e) => e.type === 'sk1.fire.attack').map((e) => e.payload as { attack: { target: string }; explain: { label: string }[] }).find((p) => p.attack.target === 'uL5:pb');
    expect(atPb, 'the pillbox is attacked by the ATT hit on its hex').toBeDefined();
    expect(atPb!.explain.some((n) => /\+3 pillbox CA Defense Modification/.test(n.label))).toBe(true);
    // A CH on the ITT through the CA (adjacent: an Original 2 +3 = 5 within the CH number 5): -3 on the IFT DR.
    const ch = gunGame(acrossSide(map, 'uL5', 0)!, 'ge.INF150s', { dice: [1, 1, 6, 6] });
    const t2 = act(ch.engine, ch.s, { type: 'fire.ordnance', shot: { weapon: 'gun', target: 'uL5:pb', targetType: 'ITT' } });
    const chAttack = t2.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { explain: { label: string }[] };
    expect(chAttack.explain.map((n) => n.label).join(' | ')).toMatch(/-3 Critical Hit: pillbox CA Defense Modification reversed/);
    // An Area Target Type CH (Original 2) through the NCA: its TEM counts as zero, nothing reversed (B30.113).
    const nca = gunGame(acrossSide(map, acrossSide(map, 'uL5', 2)!, 2)!, 'ge.INF150s', { dice: [1, 1, 6, 6, 6, 6] });
    const t3 = act(nca.engine, nca.s, { type: 'fire.ordnance', shot: { weapon: 'gun', target: 'uL5:pb', targetType: 'ATT' } });
    const ncaAttack = t3.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { explain: { label: string }[] };
    expect(ncaAttack.explain.map((n) => n.label).join(' | ')).not.toMatch(/pillbox|TEM/);
  });
});

describe('DC Placement against the pillbox (B30.31, B30.92, A23.3)', () => {
  function dcGame(from: (map: ReturnType<typeof statics>['map']) => string, pbHidden = false) {
    const g0 = game([]);
    const map = statics(g0.engine.env(g0.state)).map;
    const hex = from(map);
    const { engine, state } = game([ru('r', 'uY9'), ge('g', hex), { id: 'dc', def: 'ge.DC', side: 'ge', heldBy: 'g' }, ...far]);
    let s = place(engine, state, 'ru', [pillbox('uL5', { hidden: pbHidden })]);
    s = tele(engine, s, 'r', 'uL5', 'pb');
    s = act(engine, s, { type: 'move.start', units: ['g'] }).state;
    return { engine, s, map, hex };
  }
  const dcAttack = (events: { type: string; payload: unknown }[]) => events.find((e) => e.type === 'sk1.fire.attack' && (e.payload as { attack: { parts: string[] } }).attack.parts.includes('dc'))?.payload as { explain: { label: string }[] } | undefined;

  it('from an adjacent hex in the CA for the MF of entering the pillbox hex, the CA DM on its attack in the AFPh; EX 1: an Original 1KIA is a 3KIA vs the pillbox and eliminates it', () => {
    const { engine, s } = dcGame((m) => acrossSide(m, 'uL5', 0)!);
    // The woods pillbox hex costs 2 MF to enter: so does the Placement (Q&A [K33] to A23.3 and B30.4), not the pillbox's 1.
    let x = act(engine, s, { type: 'move.placeDc', dc: 'dc', target: 'uL5:pb' }).state;
    expect(moveState(engine.env(x))!.spent['g']).toBe(2);
    x = pass(engine, x, 'ru');
    x = act(engine, x, { type: 'move.end' }).state;
    x = pass(engine, x, 'ru');
    expect(x.pieces['dc']!.tags['pbDcFrom']).toBeDefined();
    // AFPh: an Original 8 on the 30 column (fixture IFT: 1KIA), +3 CA DM: a 3KIA for elimination, ≥ 3 (B30.92).
    engine.forceDice(4, 4, 6, 6, 6, 6);
    const t = until(engine, x, 'MPh', 'ru', 1);
    expect(pillboxAt(engine.env(t), 'uL5')).toBeNull();
    expect(t.pieces['r']!.loc.kind).toBe('eliminated');
    // The next Player Turn: the placer moves freely and the DC's tag went with it.
    const next = t;
    expect(Object.values(next.pieces).some((p) => p.tags['pbDcFrom'] !== undefined && p.loc.kind !== 'eliminated')).toBe(false);
  });

  it('from an adjacent hex in the NCA: the NCA DM, and the same Original 1KIA (a 3KIA) does not eliminate it (B30.31, B30.92)', () => {
    const { engine, s } = dcGame((m) => acrossSide(m, 'uL5', 3)!);
    let x = act(engine, s, { type: 'move.placeDc', dc: 'dc', target: 'uL5:pb' }).state;
    x = pass(engine, x, 'ru');
    x = act(engine, x, { type: 'move.end' }).state;
    x = pass(engine, x, 'ru');
    engine.forceDice(4, 4, 6, 6, 6, 6);
    let events: { type: string; payload: unknown }[] = [];
    for (let i = 0; i < 40 && !(x.phase === 'MPh' && x.attacker === 'ru'); i++) {
      const d = engine.currentDecision(x)!;
      const pick = engine.legalActions(x, d.owner).find((a) => ['defPass', 'move.end', 'endPhase'].includes(a.type))!;
      const { side: _s, decisionId: _d, ...rest } = pick;
      const t = act(engine, x, rest as never);
      events = [...events, ...t.events];
      x = t.state;
    }
    expect(dcAttack(events)!.explain.map((n) => n.label).join(' | ')).toMatch(/\+5 pillbox NCA Defense Modification/);
    expect(pillboxAt(engine.env(x), 'uL5')).not.toBeNull();
  });

  it('from the pillbox hex itself: one MF and the CA DM; never from inside to outside; never against a pillbox the placer has not been shown (B30.31)', () => {
    const own = dcGame(() => 'uL5');
    expect(check(own.engine, own.s, { type: 'move.placeDc', dc: 'dc', target: 'uL5:pb' })).toBeNull();
    const x = act(own.engine, own.s, { type: 'move.placeDc', dc: 'dc', target: 'uL5:pb' }).state;
    expect(moveState(own.engine.env(x))!.spent['g']).toBe(1);
    // A Russian with a DC inside his pillbox may not Place it on the ground of the hex.
    const { engine, state } = game([ru('r', 'uY9'), { id: 'rdc', def: 'ge.DC', side: 'ru', heldBy: 'r' }, ...far], { first: 'ru' });
    let s = place(engine, state, 'ru', [pillbox('uL5')]);
    s = tele(engine, s, 'r', 'uL5', 'pb');
    s = act(engine, s, { type: 'move.start', units: ['r'] }).state;
    expect(check(engine, s, { type: 'move.placeDc', dc: 'rdc', target: 'uL5' })).toMatch(/cannot be Placed from inside a pillbox to outside it/);
    // (A pillbox the placer has not been shown cannot be beside it: a Good Order unit adjacent reveals it, A12.33.)
    const hidden = dcGame((m) => acrossSide(m, 'uL5', 0)!, true);
    expect(fortCounters(hidden.engine.env(hidden.s)).find((c) => c.kind === 'pillbox')!.revealed).toBe(true);
  });
});

describe('inspection and Known: the contents of a pillbox (B30.7, A12.11)', () => {
  const fortOf = (engine: Eng, s: GameState, viewer: string | null) => ((redactState(engine, s, viewer).ext['asl.fortifications'] as { counters: { kind: string; occupied?: true; known?: true }[] }).counters.find((c) => c.kind === 'pillbox'));
  it('a unit that walks into a revealed pillbox vanishes from the other seat and a spectator, which see the pillbox occupied; an attack from within makes the units inside Known, later entrants too', () => {
    const { engine, state } = game([ru('r', 'uN5'), ru('r2', 'uN5'), ge('g', 'uQ5'), ...far], { first: 'ru' });
    let s = place(engine, state, 'ru', [pillbox('uO5', { factors: [2, 4, 6] })]);
    s = act(engine, s, { type: 'move.start', units: ['r'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uO5' }).state;
    s = pass(engine, s, 'ge');
    s = act(engine, s, { type: 'move.step', to: 'uO5:pb' }).state;
    for (const viewer of ['ge', null]) {
      expect(redactState(engine, s, viewer).pieces['r'], `${viewer}`).toBeUndefined();
      expect(fortOf(engine, s, viewer), `${viewer}`).toMatchObject({ occupied: true });
    }
    expect(redactState(engine, s, 'ru').pieces['r']!.loc).toEqual({ kind: 'hex', hex: 'uO5', sub: 'pb' });
    expect(fortOf(engine, s, 'ru')!.occupied).toBeUndefined();
    // Not a Known enemy: the German beside it in the CA is not ADJACENT to a Known enemy for DM (A12.11, B30.7).
    expect(fortCounters(engine.env(s)).find((c) => c.kind === 'pillbox')!.known, 'known').toBeUndefined();
    expect(engine.env(s).query('piece.visibleTo', { piece: 'r', viewer: 'ge' }, true), 'visible').toBe(false);
    expect(adjacentToKnownEnemy(engine.env(s), 'ge', 'uP5')).toBe(false);
    s = pass(engine, s, 'ge');
    s = act(engine, s, { type: 'move.end' }).state;
    s = pass(engine, s, 'ge');
    // Russian PFPh (next Player Turn): the squad inside fires; from then on the Germans within 16 hexes with a LOS know them.
    s = until(engine, s, 'PFPh', 'ru', 2);
    s = act(engine, s, { type: 'fire', decl: { units: ['r'], sw: [], target: 'uQ5' } }).state;
    expect(fortCounters(engine.env(s)).find((c) => c.kind === 'pillbox')!.known).toBe(true);
    for (const viewer of ['ge', null]) {
      expect(redactState(engine, s, viewer).pieces['r'], `${viewer}`).toBeDefined();
      expect(fortOf(engine, s, viewer)!.occupied, `${viewer}`).toBeUndefined();
    }
    expect(adjacentToKnownEnemy(engine.env(s), 'ge', 'uP5')).toBe(true);
    // Not through the NCA: no DM from a pillbox next door whose arc points away (B30.2).
    expect(adjacentToKnownEnemy(engine.env(s), 'ge', 'uO4')).toBe(false);
    // A squad entering after the attack is Known as well ("even if they entered subsequently").
    s = until(engine, s, 'MPh', 'ru', 3);
    s = act(engine, s, { type: 'move.start', units: ['r2'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uO5' }).state;
    s = pass(engine, s, 'ge');
    s = act(engine, s, { type: 'move.step', to: 'uO5:pb' }).state;
    expect(redactState(engine, s, 'ge').pieces['r2']).toBeDefined();
  });
});

describe('rout and rally (B30.5, B30.41, B30.42, B30.6, A10.5, A10.531, A10.61, A10.62)', () => {
  it('a broken unit routs straight into the pillbox of the next hex as one expenditure, free of Interdiction there; next RPh it rallies at -1 and keeps no DM', () => {
    // The Russian 4-4-7 in N5 broke in the Open beside the empty O5 pillbox, the German 4-6-7 in J5 watching (4 hexes).
    const { engine, state } = game([ru('r', 'uN5', 'ru.447'), ru('ld', 'uA2'), ge('g', 'uJ5'), ge('gfar', 'uA10')], { first: 'ge', phase: 'AFPh' });
    let s = place(engine, state, 'ru', [pillbox()]);
    s = act(engine, s, { type: 'test.tag', id: 'r', tags: { broken: true, dm: true } }).state;
    s = until(engine, s, 'RtPh', 'ge', 1);
    const d = engine.currentDecision(s)!;
    // The nearest building is the pillbox (one MF to O5; its own MF does not count, A10.531), not the L5 woods (three).
    expect([...planRout(engine.env(s), 'r').destinations]).toEqual(['uO5:pb']);
    const all = engine.legalActions(s, d.owner);
    const steps = all.filter((a) => a.type === 'rout.step' && a['unit'] === 'r').map((a) => a['to']);
    expect(steps, `${d.kind} ${d.owner} ${[...new Set(all.map((a) => a.type))].join(',')}`).toContain('uO5:pb');
    const t = act(engine, s, { type: 'rout.step', unit: 'r', to: 'uO5:pb' });
    expect(t.state.pieces['r']!.loc).toEqual({ kind: 'hex', hex: 'uO5', sub: 'pb' });
    expect(t.events.some((e) => e.type === 'sk1.rout.interdiction' || (e.type === 'dice.rolled' && /Interdiction/.test(JSON.stringify(e.payload))))).toBe(false);
    s = t.state;
    // The Russian RPh: -1 for the pillbox, and the DM may not be kept there.
    s = until(engine, s, 'RPh', 'ru', 1);
    const env = engine.env(s);
    const drm = env.explain('rally.drm', { unit: 'r', leader: null, self: true }, 0);
    expect(drm.trace.some((e) => e.label === '-1 pillbox')).toBe(true);
    expect(env.query('rally.dmKeepIllegal', { unit: 'r' }, null)).toMatch(/In a pillbox.*A10.62/);
  });

  it('a broken unit inside is never forced to rout, even beside a Known enemy in the CA, and stays without failing to rout; out of it not with an enemy in the hex (B30.5, B30.6)', () => {
    const { engine, state } = game([ru('r', 'uY9'), ge('g', 'uP5'), ...far], { first: 'ge', phase: 'AFPh' });
    let s = place(engine, state, 'ru', [pillbox()]);
    s = tele(engine, s, 'r', 'uO5', 'pb');
    s = act(engine, s, { type: 'test.tag', id: 'r', tags: { broken: true, dm: true } }).state;
    s = until(engine, s, 'RtPh', 'ge', 1);
    expect(routRequirement(engine.env(s), s.pieces['r']!)).toBeNull();
    expect(pendingRouts(engine.env(s)).find((x) => x.unit === 'r')?.must ?? false).toBe(false);
    s = until(engine, s, 'MPh', 'ru', 1);
    expect(s.pieces['r']!.loc).toEqual({ kind: 'hex', hex: 'uO5', sub: 'pb' });
    // A German on the ground of the hex: the unit inside may not rout out (B30.6).
    expect(engine.env(s).query('rout.stepIllegal', { unit: 'r', from: 'uO5:pb', to: 'uO5' }, null)).toBeNull();
    s = tele(engine, s, 'g', 'uO5');
    expect(engine.env(s).query('rout.stepIllegal', { unit: 'r', from: 'uO5:pb', to: 'uO5' }, null)).toMatch(/B30.6/);
  });

  it('no rout into the pillbox past an enemy outside it in the hex (B30.42); its entry MF do not count toward the nearest building (A10.531)', () => {
    const { engine, state } = game([ru('r', 'uN5'), ge('v', 'uO5', 'ge.pzivf2'), ...far], { first: 'ge', phase: 'RtPh' });
    const s = place(engine, state, 'ru', [pillbox()]);
    const env = engine.env(s);
    expect(env.query('rout.stepIllegal', { unit: 'r', from: 'uN5', to: 'uO5:pb' }, null)).toMatch(/B30.42/);
    expect(env.query('rout.nearestCost', { unit: 'r', node: 'uO5:pb', cost: 3 }, 3)).toBe(2);
    expect(env.query('rout.nearestCost', { unit: 'r', node: 'uO5', cost: 1 }, 1)).toBe(1);
  });
});

describe('Close Combat across the pillbox (B30.6, A11.1, A11.15, A11.19)', () => {
  /** German Turn 1 APh: the 4-6-7 advances into O5 beside the Russian 4-4-7 inside its pillbox; on to the CCPh. */
  function ccGame(extra: PieceSpec[] = [], opts: { hip?: boolean } = {}) {
    const { engine, state } = game([ru('r', 'uY9'), ge('g', 'uP5'), ...extra, ...far], { first: 'ge', phase: 'APh', dice: [] });
    let s = place(engine, state, 'ru', [pillbox()]);
    s = tele(engine, s, 'r', 'uO5', 'pb');
    if (opts.hip) s = act(engine, s, { type: 'test.tag', id: 'r', tags: { hip: true } }).state;
    s = act(engine, s, { type: 'advance', units: ['g'], to: 'uO5' }).state;
    return { engine, s };
  }

  it('CC is resolved between the pillbox and the units outside it, with no Melee; next turn the German leaves freely, the Russian only by advancing (B30.6)', () => {
    const { engine, s: s0 } = ccGame();
    let s = act(engine, s0, { type: 'endPhase' }).state;
    expect(s.phase).toBe('CCPh');
    const env = engine.env(s);
    expect(ccHexes(env)).toEqual(['uO5']);
    expect(ccUnits(env, 'uO5', 'ru').map((p) => p.id)).toEqual(['r']);
    // Both sides declare (no ambush in Open Ground); dice: 6,6 and 6,6 so both miss.
    engine.forceDice(6, 6, 6, 6);
    const attacks: { side: string; attackers: string[]; targets: string[] }[] = [];
    for (let i = 0; i < 20 && s.phase === 'CCPh'; i++) {
      const d = engine.currentDecision(s)!;
      const legal = engine.legalActions(s, d.owner);
      const declare = legal.find((a) => a.type === 'cc.declare' && (a['attacks'] as unknown[]).length > 0);
      const pick = declare ?? legal.find((a) => a.type === 'cc.declare' || a.type === 'cc.arranged' || a.type === 'endPhase')!;
      const t = act(engine, s, (({ side: _s, decisionId: _d, ...rest }) => rest)(pick) as never);
      for (const e of t.events) if (e.type === 'sk1.cc.attack') attacks.push({ side: (e.payload as { side: string }).side, ...(e.payload as { attack: { attackers: string[]; targets: string[] } }).attack });
      s = t.state;
    }
    expect(attacks).toEqual(expect.arrayContaining([expect.objectContaining({ side: 'ge', attackers: ['g'], targets: ['r'] }), expect.objectContaining({ side: 'ru', attackers: ['r'], targets: ['g'] })]));
    s = until(engine, s, 'MPh', 'ru', 1);
    expect(s.hexMarkers['uO5']?.['melee']).toBeUndefined();
    expect(s.pieces['r']!.loc).toEqual({ kind: 'hex', hex: 'uO5', sub: 'pb' });
    // The Russian may not move out past the German in the hex (B30.6).
    s = act(engine, s, { type: 'move.start', units: ['r'] }).state;
    expect(check(engine, s, { type: 'move.step', to: 'uO5' })).toMatch(/B30.6/);
    s = act(engine, s, { type: 'move.cancel' }).state;
    // German Turn 2 MPh: the German, never held in Melee, walks away.
    s = until(engine, s, 'MPh', 'ge', 2);
    s = act(engine, s, { type: 'move.start', units: ['g'] }).state;
    expect(check(engine, s, { type: 'move.step', to: 'uP5' })).toBeNull();
  });

  it('a friendly ground unit outside screens the pillbox: no CC by or against the units inside (B30.6)', () => {
    const { engine, s: s0 } = ccGame([ru('h', 'uO5', 'ru.247')]);
    void s0;
    const env = engine.env(s0);
    // The German advanced into the HS: their CC is on the ground; the squad inside takes no part.
    expect(ccUnits(env, 'uO5', 'ru').map((p) => p.id)).toEqual(['h']);
  });

  it('no CC between a vehicle and the units in the pillbox (B30.6)', () => {
    const { engine, state } = game([ru('r', 'uY9'), ge('v', 'uO5', 'ge.pzivf2'), ...far], { first: 'ge', phase: 'APh' });
    let s = place(engine, state, 'ru', [pillbox()]);
    s = tele(engine, s, 'r', 'uO5', 'pb');
    expect(ccHexes(engine.env(s))).toEqual([]);
    expect(engine.env(s).query('cc.attackIllegal', { hex: 'uO5', side: 'ge', attack: { attackers: ['v'], targets: ['r'] } }, null)).toMatch(/B30.6/);
  });

  it('a hidden unit in the pillbox is placed on the board when CC can occur, and the contents are then Known (Q&A to A11.19 and B30.6; B30.7)', () => {
    const { engine, s: s0 } = ccGame([], { hip: true });
    expect(s0.pieces['r']!.tags['hip']).toBe(true);
    const s = act(engine, s0, { type: 'endPhase' }).state;
    expect(s.pieces['r']!.tags['hip']).toBeUndefined();
    expect(redactState(engine, s, 'ge').pieces['r']).toBeDefined();
  });
});

describe('Control (B30.91, A26.11, A26.13, A26.132)', () => {
  it('a German squad outside an empty Russian pillbox gains no hex Control until it enters the pillbox; then both', () => {
    const { engine, state } = game([ge('g', 'uP5'), ...far]);
    let s = place(engine, state, 'ru', [pillbox()]);
    s = act(engine, s, { type: 'move.start', units: ['g'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uO5' }).state;
    s = pass(engine, s, 'ru');
    let ctl = controlState(engine.env(s));
    expect(ctl.locations?.['uO5:pb']).toBe('ru');
    expect(ctl.hexes['uO5']).not.toBe('ge');
    s = act(engine, s, { type: 'move.step', to: 'uO5:pb' }).state;
    s = pass(engine, s, 'ru');
    ctl = controlState(engine.env(s));
    expect(ctl.locations?.['uO5:pb']).toBe('ge');
    expect(ctl.hexes['uO5']).toBe('ge');
  });

  it('a Good Order MMC alone in the pillbox holds both it and the hex (A26.13 read with B30.1)', () => {
    const { engine, state } = game([ru('r', 'uY9'), ...far], { first: 'ru' });
    let s = place(engine, state, 'ge', [pillbox()]);
    s = tele(engine, s, 'r', 'uO5', 'pb');
    const ctl = controlState(engine.env(s));
    expect(ctl.locations?.['uO5:pb']).toBe('ru');
    expect(ctl.hexes['uO5']).toBe('ru');
  });

  it("a hidden pillbox's Control is not shown to the other side; an eliminated pillbox's Location is gone from Control", () => {
    const { engine, state } = game([ru('rfar', 'uA1'), ge('g', 'uGG10')], { first: 'ru' });
    let s = place(engine, state, 'ru', [pillbox('uL5', { hidden: true })]);
    s = tele(engine, s, 'rfar', 'uA1');
    expect(controlState(engine.env(s)).locations?.['uL5:pb']).toBe('ru');
    expect((redactState(engine, s, 'ge').ext['sk1.control'] as { locations?: Record<string, string> }).locations?.['uL5:pb']).toBeUndefined();
    expect((redactState(engine, s, null).ext['sk1.control'] as { locations?: Record<string, string> }).locations?.['uL5:pb']).toBeUndefined();
  });
});

describe('bunkers: a pillbox with a trench in its hex or the next (B30.8, B27.54)', () => {
  /** The O5 pillbox with a trench in O5 and another in O6 (south of it); a Russian squad beneath each trench. */
  function bunkerGame(phase = 'MPh') {
    const { engine, state } = game([ru('a', 'uO5'), ru('b', 'uO6'), ge('g', 'uY9'), ru('rfar', 'uA1')], { first: 'ru', phase });
    let s = place(engine, state, 'ru', [pillbox('uO5', { factors: [2, 4, 6] }), { kind: 'trench', hex: 'uO5', hidden: false }, { kind: 'trench', hex: 'uO6', hidden: false }]);
    s = act(engine, s, { type: 'test.teleport', id: 'a', hex: 'uO5', ent: 'trench' } as never).state;
    s = act(engine, s, { type: 'test.teleport', id: 'b', hex: 'uO6', ent: 'trench' } as never).state;
    return { engine, s };
  }

  it('from beneath the trench of its own hex into the bunker for one MF, no trench MF; and back the same way (B30.8, Q&A to B30.8)', () => {
    const { engine, s: s0 } = bunkerGame();
    let s = act(engine, s0, { type: 'move.start', units: ['a'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uO5:pb' }).state;
    s = pass(engine, s, 'ge');
    expect(s.pieces['a']!.loc).toEqual({ kind: 'hex', hex: 'uO5', sub: 'pb' });
    expect(moveState(engine.env(s))!.spent['a']).toBe(1);
    s = act(engine, s, { type: 'move.step', to: 'uO5', beneath: true }).state;
    s = pass(engine, s, 'ge');
    expect(s.pieces['a']!.loc).toEqual({ kind: 'hex', hex: 'uO5', pos: { ent: 'trench' } });
    expect(moveState(engine.env(s))!.spent['a']).toBe(2);
  });

  it('between the bunker and the trench of the next hex for one MF as trench movement (no FFNAM or FFMO); not from on top of that trench (B30.8, B27.54)', () => {
    const { engine, s: s0 } = bunkerGame();
    let s = act(engine, s0, { type: 'move.start', units: ['b'] }).state;
    expect(engine.legalActions(s, 'ru').some((a) => a.type === 'move.step' && a['to'] === 'uO5:pb')).toBe(true);
    s = act(engine, s, { type: 'move.step', to: 'uO5:pb' }).state;
    expect(s.pieces['b']!.loc).toEqual({ kind: 'hex', hex: 'uO5', sub: 'pb' });
    expect(moveState(engine.env(s))).toMatchObject({ trenchMove: true });
    expect(moveState(engine.env(s))!.spent['b']).toBe(1);
    s = pass(engine, s, 'ge');
    // Out again into the O6 trench, offered beneath it; a plain step into O6 is refused.
    expect(check(engine, s, { type: 'move.step', to: 'uO6' })).toMatch(/only beneath a connecting trench.*B30.8/);
    expect(engine.legalActions(s, 'ru').some((a) => a.type === 'move.step' && a['to'] === 'uO6' && a['beneath'] === true)).toBe(true);
    s = act(engine, s, { type: 'move.step', to: 'uO6', beneath: true }).state;
    expect(s.pieces['b']!.loc).toEqual({ kind: 'hex', hex: 'uO6', pos: { ent: 'trench' } });
    expect(moveState(engine.env(s))!.spent['b']).toBe(2);
  });

  it('a unit on top of the next trench, or with an enemy outside the bunker, may not go in (B30.8, B30.42)', () => {
    const { engine, s: s0 } = bunkerGame();
    let s = act(engine, s0, { type: 'test.teleport', id: 'b', hex: 'uO6' } as never).state;
    s = act(engine, s, { type: 'move.start', units: ['b'] }).state;
    expect(check(engine, s, { type: 'move.step', to: 'uO5:pb' })).toMatch(/Only from beneath a connecting trench.*B30.8/);
    s = act(engine, s, { type: 'move.cancel' }).state;
    s = act(engine, s, { type: 'test.teleport', id: 'b', hex: 'uO6', ent: 'trench' } as never).state;
    s = tele(engine, s, 'g', 'uO5');
    s = act(engine, s, { type: 'test.teleport', id: 'a', hex: 'uA2' } as never).state;
    s = act(engine, s, { type: 'move.start', units: ['b'] }).state;
    expect(check(engine, s, { type: 'move.step', to: 'uO5:pb' })).toMatch(/B30.42/);
  });

  it('a broken unit in the bunker may rout beneath the next trench at the trench cost; a unit beneath that trench may advance into the bunker (B30.8)', () => {
    const { engine, s: s0 } = bunkerGame('AFPh');
    let s = tele(engine, s0, 'a', 'uO5', 'pb');
    s = act(engine, s, { type: 'test.tag', id: 'a', tags: { broken: true, dm: true } }).state;
    s = act(engine, s, { type: 'test.teleport', id: 'b', hex: 'uA3' } as never).state;
    s = until(engine, s, 'RtPh', 'ru', 1);
    const env = engine.env(s);
    expect(env.query('rout.beneath', { unit: 'a', from: 'uO5:pb', to: 'uO6' }, null)).toEqual({ cost: 1 });
    // The advance between them: from beneath the O6 trench into the bunker (ADJACENT through the trench, A.8).
    const t = game([ru('c', 'uO6'), ru('rfar', 'uA1')], { first: 'ru', phase: 'APh' });
    let x = place(t.engine, t.state, 'ru', [pillbox('uO5'), { kind: 'trench', hex: 'uO6', hidden: false }]);
    x = act(t.engine, x, { type: 'test.teleport', id: 'c', hex: 'uO6', ent: 'trench' } as never).state;
    expect(check(t.engine, x, { type: 'advance', units: ['c'], to: 'uO5:pb' })).toBeNull();
  });
});

describe('Blaze and falling rubble (B25.4, B24.121, B30.92)', () => {
  it('falling rubble eliminates the pillbox and everything inside it', () => {
    const { engine, state } = game([ru('r', 'uY9'), { id: 'lmg', def: 'ru.LMG', side: 'ru', heldBy: 'r' }, ...far], { phase: 'PFPh' });
    let s = place(engine, state, 'ru', [pillbox('uL5')]);
    s = tele(engine, s, 'r', 'uL5', 'pb');
    const t = act(engine, s, { type: 'test.rubbleFalls', to: 'uL5' } as never);
    expect(pillboxAt(engine.env(t.state), 'uL5')).toBeNull();
    expect(t.state.pieces['r']!.loc.kind).toBe('eliminated');
    expect(t.state.pieces['lmg']!.loc.kind).toBe('eliminated');
  });

  it('a Blaze on the ground of the hex burns the pillbox with it: its occupants, who cannot leave into it, are caught at the end of the RtPh (B25.4)', () => {
    const { engine, state } = game([ru('r', 'uY9'), ru('n', 'uL4'), ...far], { first: 'ru', phase: 'AFPh' });
    let s = place(engine, state, 'ru', [pillbox('uL5')]);
    s = tele(engine, s, 'r', 'uL5', 'pb');
    s = act(engine, s, { type: 'test.blaze', loc: 'uL5' } as never).state;
    s = until(engine, s, 'RtPh', 'ru', 1);
    let guard = 0;
    while (s.phase === 'RtPh' && guard++ < 20) {
      const d = engine.currentDecision(s)!;
      const legal = engine.legalActions(s, d.owner);
      const pick = legal.find((a) => a.type === 'blaze.stay') ?? legal.find((a) => a.type === 'rout.done' || a.type === 'endPhase')!;
      s = act(engine, s, (({ side: _s, decisionId: _d, ...rest }) => rest)(pick) as never).state;
    }
    expect(s.pieces['r']!.loc.kind).toBe('eliminated');
  });
});

describe('a Gun in a pillbox (B30.1, B30.45, B30.32, C6.7)', () => {
  function gunInside() {
    const g0 = game([]);
    const map = statics(g0.engine.env(g0.state)).map;
    const ca = acrossSide(map, acrossSide(map, 'uO5', 0)!, 0)!;
    const spine = nearestSpine(map.hex(ca)!.cube, 0, map.hex('uO5')!.cube)!;
    const { engine, state } = game([ru('crew', 'uY9', 'br.228c'), { id: 'atg', def: 'br.AT57L', side: 'ru', heldBy: 'crew' }, ge('c', ca, 'ge.228c'), { id: 'gun', def: 'ge.AT75L', side: 'ge', heldBy: 'c', tags: { ca: spine } }, ...far], { phase: 'PFPh', first: 'ru' });
    let s = place(engine, state, 'ru', [pillbox()]);
    s = tele(engine, s, 'crew', 'uO5', 'pb');
    s = act(engine, s, { type: 'test.tag', id: 'atg', tags: { ca: 1 } }).state;
    return { engine, s, ca };
  }
  it('it may set up in a pillbox (no upper-level refusal) and keeps the pillbox\'s Covered Arc: no turning, between shots or to fire', () => {
    const { engine, s } = gunInside();
    const env = engine.env(s);
    expect(env.query('gun.setupIllegal', { gun: 'atg', loc: 'uO5:pb' }, 'upper level')).toBeNull();
    expect(env.query('gun.canChangeCa', { gun: 'atg' }, null)).toMatch(/keeps the pillbox's Covered Arc.*B30.1/);
    // A German in P5, beside it in its arc: a shot turning the Gun to the next hexspine first is refused.
    const x = tele(engine, s, 'c', 'uP5');
    expect(engine.env(x).query('ordnance.illegal', { shot: { weapon: 'atg', target: 'uP5', targetType: 'ITT', ca: 2 }, mode: 'prep', side: 'ru' }, null)).toMatch(/keeps the pillbox's Covered Arc/);
  });
  it('hidden in a pillbox in Open Ground it is not revealed by a German in LOS: the pillbox Location is Concealment Terrain (B30.7, A12.34)', () => {
    const { engine, s } = gunInside();
    let x = act(engine, s, { type: 'test.tag', id: 'atg', tags: { hip: true } }).state;
    x = act(engine, x, { type: 'test.tag', id: 'crew', tags: { hip: true } }).state;
    x = tele(engine, x, 'c', 'uQ5');
    expect(x.pieces['atg']!.tags['hip']).toBe(true);
  });
  it('a shot at it takes no Target Size DRM (Case P; B30.32): the small 57mm Gun gets no +1', () => {
    const { engine, s } = gunInside();
    const t = engine.env(s).explain('ordnance.thDrm', shotContext(engine.env(s), { weapon: 'gun', target: 'uO5:pb', targetType: 'ITT' }, 'prep', 'ge'), 0);
    const labels = t.trace.filter((e) => !e.suppressedBy && e.before !== e.after).map((e) => e.label ?? e.id);
    expect(labels.some((l) => /target size/i.test(l)), labels.join(' | ')).toBe(false);
    expect(t.trace.some((e) => e.id === 'sk2.th.targetSize' && e.suppressedBy)).toBe(true);
  });
});

describe('fire at a unit that walked into a pillbox the firer has not been shown (A12.33, B30.7)', () => {
  it('the German sees the squad on the ground of L5; his attack there claims the pillbox TEM, reveals it and falls on the pillbox; a First Fire decision names only the hex', () => {
    const { engine, state } = game([ru('r', 'uL5', 'am.747'), ge('g', 'uCC5'), { id: 'mmg', def: 'ge.MMG', side: 'ge', heldBy: 'g' }, ru('rfar', 'uA1')], { first: 'ru', dice: [] });
    let s = place(engine, state, 'ru', [pillbox('uL5', { hidden: true })]);
    s = act(engine, s, { type: 'move.start', units: ['r'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uL5:pb' }).state;
    // Smoke grenades from inside are an expenditure the German may fire at: the decision he sees names the hex only.
    engine.forceDice(6);
    s = act(engine, s, { type: 'move.smoke', throws: [{ unit: 'r', target: 'uL5' }] }).state;
    const d = engine.currentDecision(s)!;
    if (d.kind === 'firstFire') {
      expect(d.data?.['hex']).toBe('uL5:pb');
      const theirs = redactState(engine, s, 'ge').decisions.find((x) => x.kind === 'firstFire')!;
      expect(theirs.data?.['hex']).toBe('uL5');
      // Declared at the ground of L5, where he sees the squad: accepted, and made at the pillbox, which it reveals.
      expect(check(engine, s, { type: 'defFire', decl: { units: [], sw: ['mmg'], target: 'uL5' } })).toBeNull();
      engine.forceDice(6, 5);
      const t = act(engine, s, { type: 'defFire', decl: { units: [], sw: ['mmg'], target: 'uL5' } });
      expect(t.events.find((e) => e.type === 'asl.fort.revealed')?.payload).toMatchObject({ reason: 'tem' });
      expect((t.events.find((e) => e.type === 'sk1.fire.attack')?.payload as { attack: { target: string } }).attack.target).toBe('uL5:pb');
    } else {
      throw new Error(`expected a First Fire decision, got ${d.kind}`);
    }
  });
});
