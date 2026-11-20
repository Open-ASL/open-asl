import { describe, expect, it } from 'vitest';
import type { Action, Engine, GameState, RuleModule } from '@asl/engine';
import { ammoColumn, aslCoreModules, concealmentModule, cornerHexes, fortCounters, hasWa, hexsideBlocks, hexsideCrossing, roadblockThDrm, shotContext, inCoveredArc, nearestSpine, piecesModule, shotOutlook, roadblockBlocksEnemyLos, roadblockExtensionAt, roadblockObstacles, sameCorner, sideToward, statics, turnModule, type FortPlacement, type HexTerrainSpec } from '../../src';
import { sk1CoreModules } from '../../src/sk1';
import { sk2CoreModules } from '../../src/sk2';
import { sk3CoreModules } from '../../src/sk3';
import { act, makeEngine, type PieceSpec } from '../fixtures';

/*
 * Roadblocks in play (ASLRB B29.2–B29.5, B9.2–B9.4, B9.31–B9.33, A12.33): a stone wall across the hexside it points to.
 * The ground is a stretch of board u, Open Ground except where named; the roadblock stands on the uN5–uN6 hexside. uN1 is
 * a level-one hill hex, uM6 woods.
 */

const SK: RuleModule[] = [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules];
const ASL: RuleModule[] = [...SK, ...aslCoreModules];
const GROUND: Record<string, HexTerrainSpec> = {
  uN1: { terrain: 'open', elevation: 1 },
  uN5: { terrain: 'open', features: ['road:dirt'] },
  uN6: { terrain: 'open', features: ['road:dirt'] },
};

const testModule: RuleModule = {
  id: 'test.roadblock',
  install(r) {
    r.action<Action & { fortSide: string; counters: FortPlacement[] }>({
      type: 'test.fortPlace',
      decisionKinds: ['phase', 'firstFire'],
      resolve(ctx, a) {
        const n = fortCounters(ctx).length;
        ctx.emit('asl.fort.placed', { side: a.fortSide, counters: a.counters.map((c, i) => ({ ...c, id: `${a.fortSide}.fort${n + i + 1}`, side: a.fortSide })) });
      },
    });
    r.action<Action & { id: string; hex: string; ent?: string }>({
      type: 'test.teleport',
      decisionKinds: ['phase'],
      resolve(ctx, a) {
        ctx.emit('piece.moved', { id: a.id, loc: { kind: 'hex', hex: a.hex, ...(a.ent ? { pos: { ent: a.ent } } : {}) } });
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

function game(pieces: PieceSpec[], opts: { dice?: number[]; phase?: string; first?: 'ge' | 'ru'; terrain?: Record<string, HexTerrainSpec> } = {}) {
  const scenario = {
    firstSide: opts.first ?? 'ge',
    sides: [
      { side: 'ge', name: 'German', nationality: 'ge', elr: 3 },
      { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 },
    ],
    forces: [],
  };
  return makeEngine({ board: 'u', terrain: { ...GROUND, ...opts.terrain }, roadHexsides: [['uN5', 'uN6']], scenario, modules: ASL, extra: [testModule], pieces, startPhase: opts.phase ?? 'MPh', dice: opts.dice ?? [] });
}
type Eng = Engine;
const roadblock = (engine: Eng, s: GameState, hidden = false): FortPlacement => ({ kind: 'roadblock', hex: 'uN5', hidden, hexside: sideToward(statics(engine.env(s)).map, 'uN5', 'uN6')! });
const place = (engine: Eng, state: GameState, side: string, counters: FortPlacement[]) => act(engine, state, { type: 'test.fortPlace', fortSide: side, counters }).state;
const check = (engine: Eng, state: GameState, a: Record<string, unknown>) => {
  const d = engine.currentDecision(state)!;
  return engine.validate(state, { side: d.owner, decisionId: d.id, ...a } as never);
};
const ge = (id: string, hex: string, def = 'ge.467'): PieceSpec => ({ id, def, side: 'ge', hex });
const ru = (id: string, hex: string, def = 'ru.447'): PieceSpec => ({ id, def, side: 'ru', hex });
const far = [ge('gfar', 'uGG1'), ru('rfar', 'uA10')];
/** The Covered Arc a Gun in `from` turns to for a shot at `to` (none when already covered). */
const caFor = (engine: Eng, s: GameState, from: string, to: string): number | undefined => {
  const map = statics(engine.env(s)).map;
  const a = map.hex(from)!.cube;
  const b = map.hex(to)!.cube;
  return inCoveredArc(a, 0, b) ? undefined : (nearestSpine(a, 0, b) ?? undefined);
};
const unitLabels = (events: { type: string; payload: unknown }[], unit: string) =>
  ((events.find((e) => e.type === 'sk1.fire.result' && (e.payload as { unit: string }).unit === unit)?.payload as { explain?: { label?: string }[] } | undefined)?.explain ?? []).map((n) => n.label ?? '');
const attackLabels = (events: { type: string; payload: unknown }[]) => ((events.find((e) => e.type === 'sk1.fire.attack')?.payload as { explain?: { label?: string }[] } | undefined)?.explain ?? []).map((n) => n.label ?? '');

describe('LOS (B29.2, B9.2, A6.21, B9.6)', () => {
  it('a same-level LOS across the roadblock hexside is blocked at the bar, from either side; from above it is clear', () => {
    const { engine, state } = game([...far]);
    const s = place(engine, state, 'ru', [roadblock(engine, state)]);
    const env = engine.env(s);
    const t = env.query('los.trace', { from: 'uN3', to: 'uN8' }, { clear: true, hindrance: 0, parts: [] });
    expect(t).toMatchObject({ clear: false, blockedBy: expect.stringMatching(/roadblock on uN5–uN6.*B29.2/) });
    expect(env.query('los.trace', { from: 'uN8', to: 'uN3' }, { clear: true, hindrance: 0, parts: [] }).clear).toBe(false);
    // From the level-one hill: a Half-Level obstacle never blocks a LOS to or from a higher level (A6.21).
    expect(env.query('los.trace', { from: 'uN1', to: 'uN8' }, { clear: true, hindrance: 0, parts: [] }).clear).toBe(true);
    // Without the roadblock the LOS is clear.
    expect(engine.env(state).query('los.trace', { from: 'uN3', to: 'uN8' }, { clear: true, hindrance: 0, parts: [] }).clear).toBe(true);
  });

  it('a wall hexside never blocks a LOS to any portion of its own hex (B9.2); ADJACENT across it still holds (A.8)', () => {
    const { engine, state } = game([...far]);
    const s = place(engine, state, 'ru', [roadblock(engine, state)]);
    const env = engine.env(s);
    expect(env.query('los.trace', { from: 'uN5', to: 'uN8' }, { clear: true, hindrance: 0, parts: [] }).clear).toBe(true);
    expect(env.query('los.trace', { from: 'uN3', to: 'uN6' }, { clear: true, hindrance: 0, parts: [] }).clear).toBe(true);
    expect(env.query('los.trace', { from: 'uN5', to: 'uN6' }, { clear: true, hindrance: 0, parts: [] }).clear).toBe(true);
  });

  it('a hidden roadblock that blocks a Good Order enemy unit\'s LOS loses HIP (A12.33)', () => {
    // (No other German on the map: only the one in uN3 looks across.)
    const { engine, state } = game([ge('g', 'uN3'), ru('rfar', 'uA10')]);
    const s = place(engine, state, 'ru', [roadblock(engine, state, true)]);
    expect(roadblockBlocksEnemyLos(engine.env(s), fortCounters(engine.env(s))[0]!)).toBe(true);
    // A broken German does not reveal it.
    const b = act(engine, state, { type: 'test.tag', id: 'g', tags: { broken: true } }).state;
    const sb = place(engine, b, 'ru', [roadblock(engine, b, true)]);
    expect(roadblockBlocksEnemyLos(engine.env(sb), fortCounters(engine.env(sb))[0]!)).toBe(false);
  });

  it('the extension runs to the centre dot of each woods or building hex at a vertex of the hexside, none into a rubbled one (B29.2, B24.2)', () => {
    const { engine, state } = game([...far]);
    const map = statics(engine.env(state)).map;
    const k = sideToward(map, 'uN5', 'uN6')!;
    const third = [...cornerHexes(map, 'uN5', k), ...cornerHexes(map, 'uN5', k + 1)].filter((h) => h !== 'uN6');
    const woods = game([...far], { terrain: Object.fromEntries(third.map((h) => [h, { terrain: 'woods' }])) });
    const s = place(woods.engine, woods.state, 'ru', [roadblock(woods.engine, woods.state)]);
    expect(roadblockExtensionAt(woods.engine.env(s), { hex: 'uN5', hexside: k }).map((e) => e.hex).sort()).toEqual([...third].sort());
    expect(roadblockObstacles(woods.engine.env(s))[0]).toMatchObject({ a: 'uN5', b: 'uN6', level: 0, hillside: false, tem: 2 });
  });

  it('the extension blocks a same-level LOS traced from either of the roadblock\'s own two hexes: B9.2 exempts only a hexside of the end\'s own hex, and the extension is none (B29.2)', () => {
    const { engine, state } = game([...far]);
    const map = statics(engine.env(state)).map;
    const k = sideToward(map, 'uN5', 'uN6')!;
    const third = [...cornerHexes(map, 'uN5', k), ...cornerHexes(map, 'uN5', k + 1)].filter((h) => h !== 'uN6');
    const woods = game([...far], { terrain: Object.fromEntries(third.map((h) => [h, { terrain: 'woods' }])) });
    const s = place(woods.engine, woods.state, 'ru', [roadblock(woods.engine, woods.state)]);
    const o = roadblockObstacles(woods.engine.env(s))[0]!;
    expect(o.extension.length).toBeGreaterThan(0);
    for (const own of ['uN5', 'uN6']) {
      const from = { hex: own, height: 0 };
      // Every same-level thread from the hex's centre that crosses an extension segment short of the woods hex's own centre.
      const across = [...map.hexes()]
        .filter((h) => h.id !== own && map.distance(own, h.id) <= 6 && !third.includes(h.id))
        .map((h) => ({ to: { hex: h.id, height: 0 }, c: hexsideCrossing(map, from, { hex: h.id, height: 0 }, o) }))
        .filter((x) => (x.c.extension ?? []).length > 0);
      expect(across.length, `threads from ${own} across the extension`).toBeGreaterThan(0);
      for (const x of across) expect(hexsideBlocks(map, from, x.to, o, x.c), `${own} to ${x.to.hex}`).toBe(true);
      // The woods hex's own centre is the one end the extension never blocks.
      for (const h of third) expect(hexsideBlocks(map, from, { hex: h, height: 0 }, o, hexsideCrossing(map, from, { hex: h, height: 0 }, o))).toBe(false);
    }
  });
});

describe('TEM and Wall Advantage (B29.3, B9.3, B9.31, B9.32, B9.321, B9.323)', () => {
  it('a unit in Open Ground behind the roadblock has mandatory WA and +2 against fire across it, with no FFMO; none against fire from beside it', () => {
    const { engine, state } = game([ru('r', 'uN6'), ge('g', 'uN3'), ge('h', 'uP6'), ...far], { phase: 'PFPh' });
    let s = place(engine, state, 'ru', [roadblock(engine, state)]);
    s = act(engine, s, { type: 'test.tag', id: 'r', tags: {} }).state;
    expect(hasWa(engine.env(s), s.pieces['r']!)).toBe(true);
    const across = act(engine, s, { type: 'fire', decl: { units: ['g'], sw: [], target: 'uN6' } });
    expect(unitLabels(across.events, 'r').join()).toMatch(/\+2 wall TEM with Wall Advantage \(roadblock uN5–uN6/);
    const beside = act(engine, s, { type: 'fire', decl: { units: ['h'], sw: [], target: 'uN6' } });
    expect(unitLabels(beside.events, 'r').join()).not.toMatch(/wall TEM/);
    // A Fire Group with one firer across it: the wall TEM applies (B9.31 EX, A.5).
    const fg = act(engine, s, { type: 'fire', decl: { units: ['g'], sw: [], target: 'uN6' } });
    expect(attackLabels(fg.events)).not.toContain('-1 FFMO');
  });

  it('the enemy across the shared hexside is denied WA while the unit holds it, and fires on it without the wall TEM if it holds WA itself (B9.321)', () => {
    const { engine, state } = game([ru('r', 'uN6'), ge('g', 'uN5'), ...far], { phase: 'PFPh', first: 'ru' });
    let s = place(engine, state, 'ru', [roadblock(engine, state)]);
    s = act(engine, s, { type: 'test.tag', id: 'r', tags: {} }).state;
    const env = engine.env(s);
    // The ATTACKER (Russian) claims first; the German across is denied.
    expect(hasWa(env, s.pieces['r']!)).toBe(true);
    expect(hasWa(env, s.pieces['g']!)).toBe(false);
    // The Russian with WA fires at the German: the German has no WA, the firer does: no wall TEM.
    const f = act(engine, s, { type: 'fire', decl: { units: ['r'], sw: [], target: 'uN5' } });
    expect(unitLabels(f.events, 'g').join()).not.toMatch(/wall TEM/);
  });

  it('WA is lost on entering another Location, and on breaking (B9.41, B9.32)', () => {
    const { engine, state } = game([ru('r', 'uN6'), ...far], { first: 'ru' });
    let s = place(engine, state, 'ru', [roadblock(engine, state)]);
    s = act(engine, s, { type: 'test.tag', id: 'r', tags: {} }).state;
    expect(hasWa(engine.env(s), s.pieces['r']!)).toBe(true);
    const broken = act(engine, s, { type: 'test.tag', id: 'r', tags: { broken: true } }).state;
    expect(broken.pieces['r']!.tags['wa']).toBeUndefined();
    let m = act(engine, s, { type: 'move.start', units: ['r'] }).state;
    m = act(engine, m, { type: 'move.step', to: 'uO6' }).state;
    expect(m.pieces['r']!.tags['wa']).toBeUndefined();
  });

  it('mandatory WA cannot be forfeited; a pinned unit cannot voluntarily claim (B9.322, B9.323)', () => {
    const { engine, state } = game([ru('r', 'uN6'), ...far], { first: 'ru' });
    let s = place(engine, state, 'ru', [roadblock(engine, state)]);
    s = act(engine, s, { type: 'test.tag', id: 'r', tags: {} }).state;
    expect(check(engine, s, { type: 'wa.forfeit', unit: 'r' })).toMatch(/B9.323/);
  });

  it('a unit that Prep Fired may not claim WA in its MPh; in its APh it may (B9.322; Q&A [K33])', () => {
    const run = (phase: string, tags: Record<string, unknown>) => {
      const { engine, state } = game([ru('r', 'uN6'), ...far], { first: 'ru', phase, terrain: { uN6: { terrain: 'woods' } } });
      let s = place(engine, state, 'ru', [roadblock(engine, state)]);
      s = act(engine, s, { type: 'test.tag', id: 'r', tags }).state;
      return check(engine, s, { type: 'wa.claim', unit: 'r' });
    };
    expect(run('MPh', {})).toBeNull();
    expect(run('MPh', { fire: 'prep' })).toMatch(/Prep Fired cannot claim WA in its MPh/);
    expect(run('APh', { fire: 'prep' })).toBeNull();
  });

  it('the wall TEM claimable against a firer lowers the Residual FP left by its TEM (A8.26, B9.31)', () => {
    const { engine, state } = game([ru('r', 'uN6'), ge('g', 'uN3'), ...far], { phase: 'PFPh' });
    let s = place(engine, state, 'ru', [roadblock(engine, state)]);
    s = act(engine, s, { type: 'test.tag', id: 'r', tags: {} }).state;
    const env = engine.env(s);
    const attack = { mode: 'first' as const, side: 'ge', target: 'uN6', parts: [{ piece: 'g', firer: 'g', kind: 'inherent' as const, hex: 'uN3', range: 3 }], targets: ['r'], hindrance: 0 };
    expect(env.query('fire.residualBonus', { target: 'uN6', attack: attack as never }, 0)).toBe(-2);
  });
});

describe('Wall Advantage at the end of the RPh (B9.322, ASOP 1.32B)', () => {
  it('a voluntary claim waits for the end of the RPh, the ATTACKER\'s step first, then the DEFENDER\'s, then the phase ends', () => {
    const woods = { uN6: { terrain: 'woods', features: ['road:dirt'] }, uN4: { terrain: 'woods' } } as Record<string, HexTerrainSpec>;
    const { engine, state } = game([ge('g', 'uN6'), ru('r', 'uN4'), ...far], { phase: 'RPh', first: 'ge', terrain: woods });
    const k = sideToward(statics(engine.env(state)).map, 'uN5', 'uN4')!;
    let s = place(engine, state, 'ru', [roadblock(engine, state), { kind: 'roadblock', hex: 'uN5', hidden: false, hexside: k }]);
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'phase', owner: 'ge' });
    expect(check(engine, s, { type: 'wa.claim', unit: 'g' })).toMatch(/at its end, the ATTACKER first/);
    s = act(engine, s, { type: 'endPhase' }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'phase', owner: 'ru' });
    s = act(engine, s, { type: 'endPhase' }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'waRph', owner: 'ge' });
    expect(engine.legalActions(s, 'ge').map((a) => a.type).sort()).toEqual(['wa.claim', 'wa.done']);
    s = act(engine, s, { type: 'wa.claim', unit: 'g' }).state;
    expect(hasWa(engine.env(s), s.pieces['g']!)).toBe(true);
    // It could still forfeit: the step stays open until the German is done; r in uN4 shares no hexside with g, so the
    // Russian step follows.
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'waRph', owner: 'ge' });
    s = act(engine, s, { type: 'wa.done' }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'waRph', owner: 'ru' });
    s = act(engine, s, { type: 'wa.done' }).state;
    expect(s.phase).not.toBe('RPh');
    expect(s.ext['asl.wa.rph']).toBeUndefined();
  });
});

describe('Movement (B29.4, B9.4) and removal by DC (B29.5)', () => {
  it('Infantry crossing it pay one MF more; a routing unit too', () => {
    const { engine, state } = game([ge('g', 'uN5'), ...far]);
    let s = place(engine, state, 'ru', [roadblock(engine, state)]);
    s = act(engine, s, { type: 'move.start', units: ['g'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uN6' }).state;
    expect((s.ext['sk1.move'] as { spent: Record<string, number> }).spent['g']).toBe(2);
    expect(engine.env(s).query('move.cost', { unit: 'g', from: 'uN6', to: 'uN5', viaRoad: false }, 1)).toBe(2);
  });

  it('a roadblock is a wall for shaped-charge weapons: a Panzerfaust may aim at Infantry behind it, known roadblocks only (C8.31, B29.3; Q&A [VFTT #13])', () => {
    const { engine, state } = game([ge('g', 'uN8'), ru('r', 'uN5'), ...far]);
    const cover = (s: GameState) => engine.env(s).query('pf.infantryCover', { firer: 'g', target: 'uN5', units: ['r'] }, false);
    expect(cover(state)).toBe(false);
    expect(cover(place(engine, state, 'ru', [roadblock(engine, state)]))).toBe(true);
    // A roadblock the firing side cannot see gives it no such target.
    expect(cover(place(engine, state, 'ru', [roadblock(engine, state, true)]))).toBe(false);
  });

  it('no vehicle crosses a roadblock hexside, a hidden one included (B29.4, A12.33)', () => {
    // Facing uN6 (the VCA whose step there is legal with no roadblock).
    const facing = (vca: number) => {
      const g = game([{ id: 'pz', def: 'ge.pzivf2', side: 'ge', hex: 'uN5', tags: { vca } }, ...far]);
      return check(g.engine, act(g.engine, g.state, { type: 'vmove.start', vehicle: 'pz' }).state, { type: 'move.step', to: 'uN6' }) === null;
    };
    const vca = [0, 1, 2, 3, 4, 5].find(facing)!;
    const { engine, state } = game([{ id: 'pz', def: 'ge.pzivf2', side: 'ge', hex: 'uN5', tags: { vca } }, ...far]);
    const k = place(engine, state, 'ge', [roadblock(engine, state)]);
    const t = act(engine, k, { type: 'vmove.start', vehicle: 'pz' }).state;
    const legalTo = engine.legalActions(t, engine.currentDecision(t)!.owner).filter((a) => a.type === 'move.step').map((a) => a['to']);
    expect(legalTo).not.toContain('uN6');
    // A hidden enemy roadblock: the vehicle that tries to cross it is stopped where it is, and the roadblock revealed.
    const h = place(engine, state, 'ru', [roadblock(engine, state, true)]);
    let ht = act(engine, h, { type: 'vmove.start', vehicle: 'pz' }).state;
    if (!fortCounters(engine.env(ht))[0]!.revealed) {
      expect(check(engine, ht, { type: 'move.step', to: 'uN6' })).toBeNull();
      ht = act(engine, ht, { type: 'move.step', to: 'uN6' }).state;
      expect(ht.pieces['pz']!.loc).toMatchObject({ kind: 'hex', hex: 'uN5' });
    }
    expect(fortCounters(engine.env(ht))[0]!.revealed).toBe(true);
    expect(check(engine, ht, { type: 'move.step', to: 'uN6' })).toMatch(/No vehicle may cross a roadblock hexside|No stack is moving/);
  });

  it('a DC Placed through the hexside removes the roadblock on a Final KIA (B29.5)', () => {
    const { engine, state } = game([ge('g', 'uN5'), { id: 'dc', def: 'ge.DC', side: 'ge', heldBy: 'g' }, ru('r', 'uN6'), ...far], { dice: [1, 1, 1, 1] });
    let s = place(engine, state, 'ru', [roadblock(engine, state)]);
    s = act(engine, s, { type: 'move.start', units: ['g'] }).state;
    s = act(engine, s, { type: 'move.placeDc', dc: 'dc', target: 'uN6' }).state;
    expect(s.ext['asl.roadblock.dcFrom']).toEqual({ uN6: 'uN5' });
    for (let i = 0; i < 30 && s.phase !== 'CCPh'; i++) {
      const d = engine.currentDecision(s)!;
      const a = engine.legalActions(s, d.owner).find((x) => x.type === 'defPass' || x.type === 'move.end' || x.type === 'endPhase')!;
      s = act(engine, s, a).state;
    }
    expect(fortCounters(engine.env(s)).some((c) => c.kind === 'roadblock')).toBe(false);
  });

  it('a Bypass through a vertex of the hexside costs one MF more (B29.4 EX)', () => {
    const { engine, state } = game([...far]);
    const s = place(engine, state, 'ru', [roadblock(engine, state)]);
    const map = statics(engine.env(s)).map;
    const k = sideToward(map, 'uN5', 'uN6')!;
    const x = cornerHexes(map, 'uN5', k).find((h) => h !== 'uN6')!;
    const corner = sameCorner(map, 'uN5', k, x)!;
    expect(engine.env(s).query('bypass.cornerCost', { hex: x, corner }, 0)).toBe(1);
    expect(engine.env(s).query('bypass.cornerCost', { hex: x, corner: (corner + 3) % 6 }, 0)).toBe(0);
  });
});

describe('Across Player Turns (B9.32, B9.41)', () => {
  it('WA stays with a unit that stands behind the roadblock into the next Player Turn, and goes once it moves away', () => {
    const { engine, state } = game([ru('r', 'uN6'), ge('g', 'uN2'), ...far], { first: 'ge' });
    let s = place(engine, state, 'ru', [roadblock(engine, state)]);
    s = act(engine, s, { type: 'test.tag', id: 'r', tags: {} }).state;
    expect(hasWa(engine.env(s), s.pieces['r']!)).toBe(true);
    for (let i = 0; i < 400 && !(s.phase === 'MPh' && s.attacker === 'ru' && engine.currentDecision(s)?.kind === 'phase'); i++) {
      const d = engine.currentDecision(s)!;
      const legal = engine.legalActions(s, d.owner);
      const a = legal.find((x) => x.type === 'defPass') ?? legal.find((x) => x.type === 'move.end') ?? legal.find((x) => x.type === 'endPhase') ?? legal[0]!;
      s = act(engine, s, a).state;
    }
    expect(s.attacker).toBe('ru');
    expect(hasWa(engine.env(s), s.pieces['r']!)).toBe(true);
    expect(fortCounters(engine.env(s)).some((c) => c.kind === 'roadblock')).toBe(true);
    s = act(engine, s, { type: 'move.start', units: ['r'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uO6' }).state;
    expect(s.pieces['r']!.tags['wa']).toBeUndefined();
  });
});

describe('HE against the roadblock (B29.5) and the wall TEM on ordnance (B29.3, B9.34, C3.33)', () => {
  const gunAt = (hex: string): PieceSpec[] => [{ id: 'c', def: 'ge.228c', side: 'ge', hex }, { id: 'g88', def: 'ge.AA88L', side: 'ge', heldBy: 'c' }];
  const shotOf = (events: { type: string; payload: unknown }[]) => events.find((e) => e.type === 'sk2.ordnance.shot')?.payload as { th: number; drm: number; dr: [number, number]; outcome: string; explain: { id: string; label?: string }[] };
  const heOf = (events: { type: string; payload: unknown }[]) => events.find((e) => e.type === 'asl.roadblock.he')?.payload as { hit: boolean; kia: boolean; final?: number; th?: number; dr?: number; iftFinal?: number } | undefined;
  const hasRoadblock = (engine: Eng, s: GameState) => fortCounters(engine.env(s)).some((c) => c.kind === 'roadblock');

  it('a unit behind the roadblock adds its +2 to a Gun\'s To Hit DR on the Infantry Target Type, not to the IFT DR; from beside it, no wall TEM', () => {
    const { engine, state } = game([...gunAt('uN8'), ru('r', 'uN5'), ...far], { phase: 'PFPh', dice: [6, 6, 6, 6, 6, 6] });
    const s = place(engine, state, 'ru', [roadblock(engine, state)]);
    const t = act(engine, s, { type: 'fire.ordnance', shot: { weapon: 'g88', target: 'uN5', targetType: 'ITT' } });
    expect(shotOf(t.events).explain.map((n) => n.label ?? '')).toContain('+2 wall TEM (roadblock, in place of the hex TEM)');
    // On the Area Target Type the TEM is an IFT DRM: the wall's there too.
    const att = game([...gunAt('uN8'), ru('r', 'uN5'), ...far], { phase: 'PFPh', dice: [1, 1, 6, 5] });
    const sa = place(att.engine, att.state, 'ru', [roadblock(att.engine, att.state)]);
    const ta = act(att.engine, sa, { type: 'fire.ordnance', shot: { weapon: 'g88', target: 'uN5', targetType: 'ATT' } });
    expect(unitLabels(ta.events, 'r').join()).toMatch(/\+2 wall TEM/);
    const side = game([...gunAt('uK5'), ru('r', 'uN5'), ...far], { phase: 'PFPh', dice: [6, 6, 6, 6] });
    const s2 = place(side.engine, side.state, 'ru', [roadblock(side.engine, side.state)]);
    const t2 = act(side.engine, s2, { type: 'fire.ordnance', shot: { weapon: 'g88', target: 'uN5', targetType: 'ITT', ...(caFor(side.engine, s2, 'uK5', 'uN5') !== undefined ? { ca: caFor(side.engine, s2, 'uK5', 'uN5') } : {}) } });
    expect(shotOf(t2.events).explain.some((n) => /wall TEM/.test(n.label ?? ''))).toBe(false);
  });

  it('the B29.5 example: a squad moving behind the roadblock is hit on its own number (+2 TEM -1 FFNAM), the roadblock only on its +2, with one IFT DR', () => {
    const run = (dice: number[]) => {
      const { engine, state } = game([...gunAt('uN8'), ru('r', 'uM5'), ...far], { first: 'ru', dice });
      let s = place(engine, state, 'ru', [roadblock(engine, state)]);
      s = act(engine, s, { type: 'move.start', units: ['r'] }).state;
      s = act(engine, s, { type: 'move.step', to: 'uN5' }).state;
      return { engine, t: act(engine, s, { type: 'defFire.ordnance', shot: { weapon: 'g88', target: 'uN5', targetType: 'ITT' } }) };
    };
    const probe = run([6, 6, 6, 6]).t;
    const sh = shotOf(probe.events);
    const labels = sh.explain.map((n) => n.label ?? '');
    expect(labels).toContain('-1 FFNAM');
    expect(labels).not.toContain('-1 FFMO');
    // The squad: TH − DRM (with +2 wall −1 FFNAM); the roadblock: one more DRM (+2 instead of +1).
    const squadOn = sh.th - sh.drm;
    const rbOn = squadOn - 1;
    expect(heOf(probe.events)).toMatchObject({ hit: false, th: sh.th, final: 12 + sh.drm + 1 });
    // An Original TH DR one above the roadblock's number: the squad is hit, the roadblock is not.
    const a = Math.min(6, squadOn - 1);
    const edge = run([a, squadOn - a, 1, 1]).t;
    expect(shotOf(edge.events).outcome).toMatch(/hit|ch/);
    expect(heOf(edge.events)).toMatchObject({ hit: false });
    expect(hasRoadblock(run([a, squadOn - a, 1, 1]).engine, edge.state)).toBe(true);
    // On the roadblock's number with a KIA on the IFT DR: both hit, the same IFT DR, the roadblock removed.
    const b = Math.min(6, rbOn - 1);
    const kill = run([b, rbOn - b, 1, 1]);
    expect(heOf(kill.t.events)).toMatchObject({ hit: true, kia: true, dr: 2 });
    expect(hasRoadblock(kill.engine, kill.t.state)).toBe(false);
    expect(kill.t.events.filter((e) => e.type === 'sk2.ordnance.hit').length).toBe(1);
  });

  it('a roadblock hex with no units is a legal target across the hexside, from either side of it; otherwise the reason is given', () => {
    const { engine, state } = game([...gunAt('uN8'), ...far], { phase: 'PFPh', dice: [1, 1, 1, 1] });
    const s = place(engine, state, 'ru', [roadblock(engine, state)]);
    const t = act(engine, s, { type: 'fire.ordnance', shot: { weapon: 'g88', target: 'uN5', targetType: 'ITT' } });
    expect(heOf(t.events)).toMatchObject({ hit: true, kia: true });
    expect(hasRoadblock(engine, t.state)).toBe(false);
    // From the counter's own side (the line crosses the hexside after the centre dot).
    const back = game([...gunAt('uN2'), ...far], { phase: 'PFPh', dice: [1, 1, 1, 1] });
    const sb = place(back.engine, back.state, 'ru', [roadblock(back.engine, back.state)]);
    expect(check(back.engine, sb, { type: 'fire.ordnance', shot: { weapon: 'g88', target: 'uN5', targetType: 'ITT', ...(caFor(back.engine, sb, 'uN2', 'uN5') !== undefined ? { ca: caFor(back.engine, sb, 'uN2', 'uN5') } : {}) } })).toBeNull();
    // From beside it the line never crosses the hexside; the other hex of the hexside is not the counter's.
    const side = game([...gunAt('uK5'), ...far], { phase: 'PFPh' });
    const ss = place(side.engine, side.state, 'ru', [roadblock(side.engine, side.state)]);
    expect(check(side.engine, ss, { type: 'fire.ordnance', shot: { weapon: 'g88', target: 'uN5', targetType: 'ITT', ...(caFor(side.engine, ss, 'uK5', 'uN5') !== undefined ? { ca: caFor(side.engine, ss, 'uK5', 'uN5') } : {}) } })).toMatch(/must cross its hexside uN5–uN6.*B29.5/);
    expect(check(engine, s, { type: 'fire.ordnance', shot: { weapon: 'g88', target: 'uN6', targetType: 'ITT' } })).toMatch(/counter's hex, uN5 \(ASLRB B29.5\)/);
    // AP never removes it; a hidden roadblock of the enemy is no target.
    expect(check(engine, s, { type: 'fire.ordnance', shot: { weapon: 'g88', target: 'uN5', targetType: 'ITT', ammo: 'AP' } })).toMatch(/only an HE attack/);
    const hid = place(engine, state, 'ru', [roadblock(engine, state, true)]);
    expect(check(engine, hid, { type: 'fire.ordnance', shot: { weapon: 'g88', target: 'uN5', targetType: 'ITT' } })).toBe('No target there');
    // The shot composer names the roadblock and its number.
    expect(shotOutlook(engine.env(s), { weapon: 'g88', target: 'uN5', targetType: 'ITT' }, 'prep', 'ge').also?.[0]).toMatch(/Also attacks the roadblock uN5–uN6: hit on an original TH DR ≤ \d+/);
  });

  it('the roadblock\'s To Hit DRM leaves out the units\' own: TEM, FFMO/FFNAM, concealment, target size and Hazardous Movement change their number, never the roadblock\'s (B29.5 "may have different DRM")', () => {
    // Concealment needs its rules in play (A12; the Starter Kit gate is the SSR).
    const at = (pieces: PieceSpec[]) => {
      const { engine, state } = makeEngine({
        board: 'u',
        terrain: GROUND,
        roadHexsides: [['uN5', 'uN6']],
        scenario: { firstSide: 'ge', sides: [{ side: 'ge', name: 'German', nationality: 'ge', elr: 3 }, { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 }], forces: [], ssr: [{ module: 'concealment', params: {}, text: 'Concealment' }] },
        modules: [...ASL, concealmentModule],
        extra: [testModule],
        pieces: [...gunAt('uN8'), ...pieces, ...far],
        startPhase: 'PFPh',
      });
      return { engine, s: place(engine, state, 'ru', [roadblock(engine, state)]) };
    };
    const shot = { weapon: 'g88', target: 'uN5', targetType: 'ITT' as const };
    const drms = (pieces: PieceSpec[], opts: { moving?: string[]; hazardous?: boolean } = {}) => {
      const { engine, s } = at(pieces);
      const env = engine.env(s);
      const sc = shotContext(env, shot, opts.moving ? 'first' : 'prep', 'ge', opts.moving ? { moving: opts.moving, movingInfo: { hazardous: !!opts.hazardous } as never } : {});
      const res = env.explain('ordnance.thDrm', sc, 0);
      return { all: res.value, ids: res.trace.filter((t) => !t.suppressedBy).map((t) => t.id), roadblock: roadblockThDrm(env, sc) };
    };
    // The stationary 88 at range 3 has no DRM of its own: the roadblock's number takes only its +2 TEM, whatever is in the hex.
    const empty = drms([]);
    expect(empty.roadblock).toBe(2);
    const cases: [string, ReturnType<typeof drms>][] = [
      ['asl.roadblock.th', drms([ru('r', 'uN5')])],
      ['sk4.th.concealed-target', drms([{ ...ru('r', 'uN5'), tags: { concealed: true } }])],
      ['sk2.th.targetSize', drms([{ id: 'rc', def: 'br.228c', side: 'ru', hex: 'uN5' }, { id: 'rg', def: 'br.AT57L', side: 'ru', heldBy: 'rc' }])],
      ['sk2.th.hazardous', drms([ru('r', 'uN5')], { moving: ['r'], hazardous: true })],
    ];
    for (const [id, c] of cases) {
      expect(c.ids, id).toContain(id);
      expect(c.roadblock, id).toBe(empty.roadblock);
    }
  });

  it('the roadblock takes its own IFT DR when the units there were missed, and a Critical Hit\'s doubling never reaches it (B29.5, C3.7)', () => {
    // A small Gun with its crew in uN5: the Gun is hit on its own number (+2 wall, +1 small target), the roadblock on its +2.
    const crewGun: PieceSpec[] = [{ id: 'rc', def: 'br.228c', side: 'ru', hex: 'uN5' }, { id: 'rg', def: 'br.AT57L', side: 'ru', heldBy: 'rc' }];
    const run = (dice: number[]) => {
      const { engine, state } = game([...gunAt('uN8'), ...crewGun, ...far], { phase: 'PFPh', dice });
      const s = place(engine, state, 'ru', [roadblock(engine, state)]);
      return { engine, s, t: act(engine, s, { type: 'fire.ordnance', shot: { weapon: 'g88', target: 'uN5', targetType: 'ITT' } }) };
    };
    const probe = run([6, 6, 6, 6]);
    const sh = shotOf(probe.t.events);
    const rbOn = sh.th - 2;
    // An Original TH DR on the roadblock's number misses the units (whose DRM is greater); the roadblock rolls its own IFT DR.
    const a = Math.min(6, rbOn - 1);
    const miss = run([a, rbOn - a, 1, 1]);
    expect(shotOf(miss.t.events).outcome).toBe('miss');
    expect(miss.t.events.some((e) => e.type === 'sk1.fire.attack')).toBe(false);
    expect(heOf(miss.t.events)).toMatchObject({ hit: true, dr: 2, kia: true });
    expect(miss.t.events.some((e) => e.type === 'dice.rolled' && /IFT vs roadblock/.test((e.payload as { label: string }).label))).toBe(true);
    expect(hasRoadblock(miss.engine, miss.t.state)).toBe(false);
    // A Critical Hit on a squad moving in behind it (+2 wall -1 FFNAM, Original TH DR 2); the roadblock is attacked on the plain HE column.
    const ch = (() => {
      const { engine, state } = game([...gunAt('uN8'), ru('r', 'uM5'), ...far], { first: 'ru', dice: [1, 1, 4, 4, 4, 4, 4, 4] });
      let s = place(engine, state, 'ru', [roadblock(engine, state)]);
      s = act(engine, s, { type: 'move.start', units: ['r'] }).state;
      s = act(engine, s, { type: 'move.step', to: 'uN5' }).state;
      return { engine, s, t: act(engine, s, { type: 'defFire.ordnance', shot: { weapon: 'g88', target: 'uN5', targetType: 'ITT' } }) };
    })();
    expect(shotOf(ch.t.events).outcome).toBe('ch');
    const env = ch.engine.env(ch.s);
    const def = statics(env).counters['ge.AA88L'] as never;
    const he = heOf(ch.t.events) as { column?: number } | undefined;
    expect(he).toMatchObject({ hit: true });
    expect(he!.column).toBe(ammoColumn(env, def, 'HE', 'ITT', false));
    expect(he!.column).not.toBe(ammoColumn(env, def, 'HE', 'ITT', true));
  });

  it('a SCW fires HEAT, never HE: it does not attack or remove the roadblock, aimed at its hex or at a Gun there, and the shot composer names no roadblock (B29.5 "any HE attack", C8.31)', () => {
    const baz = (pieces: PieceSpec[], dice: number[] = []) => {
      const { engine, state } = game([ge('u', 'uN8'), { id: 'z', def: 'ge.BAZ43', side: 'ge', heldBy: 'u' }, ...pieces, ...far], { phase: 'PFPh', dice });
      return { engine, s: place(engine, state, 'ru', [roadblock(engine, state)]) };
    };
    // An empty roadblock hex is no target for it: only an HE attack may aim at the roadblock alone; nor may it load HE.
    const empty = baz([]);
    expect(check(empty.engine, empty.s, { type: 'fire.ordnance', shot: { weapon: 'z', target: 'uN5', targetType: 'ITT' } })).toMatch(/only an HE attack can remove the roadblock|HEAT may only be fired/);
    expect(check(empty.engine, empty.s, { type: 'fire.ordnance', shot: { weapon: 'z', target: 'uN5', targetType: 'ITT', ammo: 'HE' } })).not.toBeNull();
    expect(empty.engine.legalActions(empty.s, 'ge').some((a) => a.type === 'fire.ordnance' && (a['shot'] as { weapon: string }).weapon === 'z')).toBe(false);
    // A Gun in the roadblock hex is a HEAT target: a hit with a KIA on the IFT harms the Gun, never the roadblock.
    const gunThere = baz([{ id: 'rc', def: 'br.228c', side: 'ru', hex: 'uN5' }, { id: 'rg', def: 'br.AT57L', side: 'ru', heldBy: 'rc' }], [1, 1, 1, 1, 1, 1]);
    const shot = { weapon: 'z', target: 'uN5', targetType: 'ITT' };
    expect(check(gunThere.engine, gunThere.s, { type: 'fire.ordnance', shot })).toBeNull();
    expect(shotOutlook(gunThere.engine.env(gunThere.s), shot as never, 'prep', 'ge').also ?? []).toEqual([]);
    const t = act(gunThere.engine, gunThere.s, { type: 'fire.ordnance', shot });
    expect(shotOf(t.events)).toMatchObject({ outcome: expect.stringMatching(/hit|ch/) });
    expect(t.events.some((e) => e.type === 'sk1.fire.attack')).toBe(true);
    expect(heOf(t.events)).toBeUndefined();
    expect(hasRoadblock(gunThere.engine, t.state)).toBe(true);
  });

  it('Indirect Fire: the roadblock takes the IFT DR +2, the units in its hexes +1 (B29.5, B9.34)', () => {
    const mtr = (dice: number[]) => {
      const { engine, state } = game([ge('m', 'uN10'), { id: 'mtr', def: 'ge.MTR', side: 'ge', heldBy: 'm' }, ru('r', 'uN6'), ...far], { phase: 'PFPh', dice });
      const s = place(engine, state, 'ru', [roadblock(engine, state)]);
      return { engine, t: act(engine, s, { type: 'fire.ordnance', shot: { weapon: 'mtr', target: 'uN6', targetType: 'ATT' } }) };
    };
    const hit = mtr([1, 2, 1, 2]);
    expect(shotOf(hit.t.events).outcome).toMatch(/hit|ch/);
    expect(unitLabels(hit.t.events, 'r')).toContain('+1 roadblock TEM vs Indirect Fire (+1, in place of the in-hex TEM)');
    const he = heOf(hit.t.events)!;
    expect(he).toMatchObject({ hit: true, dr: 3, iftFinal: 5 });
    expect(hasRoadblock(hit.engine, hit.t.state)).toBe(!he.kia);
  });

  it('across turns: the roadblock removed by HE in the German PFPh is gone for the rest of the game; the Russians cross the hexside at no extra MF and take no wall TEM', () => {
    const { engine, state } = game([...gunAt('uN8'), ru('r', 'uN4'), ...far], { phase: 'PFPh', dice: [1, 1, 1, 1] });
    let s = place(engine, state, 'ru', [roadblock(engine, state)]);
    s = act(engine, s, { type: 'fire.ordnance', shot: { weapon: 'g88', target: 'uN5', targetType: 'ITT' } }).state;
    expect(hasRoadblock(engine, s)).toBe(false);
    for (let i = 0; i < 400 && !(s.phase === 'MPh' && s.attacker === 'ru' && engine.currentDecision(s)?.kind === 'phase'); i++) {
      const d = engine.currentDecision(s)!;
      const legal = engine.legalActions(s, d.owner);
      const a = legal.find((x) => x.type === 'defPass') ?? legal.find((x) => x.type === 'move.end') ?? legal.find((x) => x.type === 'endPhase') ?? legal[0]!;
      s = act(engine, s, a).state;
    }
    expect(s.attacker).toBe('ru');
    const pass = (x: GameState) => {
      while (engine.currentDecision(x)?.kind === 'firstFire') x = act(engine, x, { type: 'defPass' }).state;
      return x;
    };
    s = act(engine, s, { type: 'move.start', units: ['r'] }).state;
    s = pass(act(engine, s, { type: 'move.step', to: 'uN5' }).state);
    const step = act(engine, s, { type: 'move.step', to: 'uN6' });
    const spent = (step.state.ext['sk1.move'] as { spent?: Record<string, number> } | undefined)?.spent?.['r'];
    expect(spent).toBe(2);
    expect(engine.env(step.state).query('los.hexsides', {}, [])).toEqual([]);
  });
});

describe('Entrenched units behind the wall (B9.21)', () => {
  // The Russian r is beneath a foxhole in uN5, behind the uN5–uN6 roadblock; q stands beside it, not beneath.
  const setup = (pieces: PieceSpec[], phase = 'PFPh', first: 'ge' | 'ru' = 'ge') => {
    const { engine, state } = game([...pieces, ...far], { phase, first, dice: [6, 6, 6, 6, 6, 6] });
    let s = place(engine, state, 'ru', [roadblock(engine, state), { kind: 'foxhole', hex: 'uN5', hidden: false, capacity: 1 }]);
    s = act(engine, s, { type: 'test.teleport', id: 'r', hex: 'uN5', ent: 'foxhole' }).state;
    return { engine, s };
  };
  const targetsOf = (events: { type: string; payload: unknown }[]) => events.filter((e) => e.type === 'sk1.fire.result').map((e) => (e.payload as { unit: string }).unit).sort();

  it('a non-adjacent same-level firer across the wall cannot see the unit beneath; the unit beside it is attacked alone', () => {
    const { engine, s } = setup([ru('r', 'uN5'), ge('g', 'uN8')]);
    expect(check(engine, s, { type: 'fire', decl: { units: ['g'], sw: [], target: 'uN5' } })).toMatch(/No LOS to the units beneath the entrenchment.*B9.21/);
    const both = setup([ru('r', 'uN5'), ru('q', 'uN5'), ge('g', 'uN8')]);
    const t = act(both.engine, both.s, { type: 'fire', decl: { units: ['g'], sw: [], target: 'uN5' } });
    expect(targetsOf(t.events)).toEqual(['q']);
  });

  it('an adjacent firer, one not across the wall, and one with half a level of elevation advantage see it', () => {
    for (const [hex, why] of [['uN6', 'adjacent'], ['uK5', 'not across'], ['uN1', 'level one hill']] as const) {
      const { engine, s } = setup([ru('r', 'uN5'), ge('g', hex)]);
      const t = act(engine, s, { type: 'fire', decl: { units: ['g'], sw: [], target: 'uN5' } });
      expect([why, targetsOf(t.events)]).toEqual([why, ['r']]);
    }
  });

  it('LOS is reciprocal: the unit beneath cannot fire across the wall at a non-adjacent Location; it may at an adjacent one', () => {
    const { engine, s } = setup([ru('r', 'uN5'), ge('g', 'uN8'), ge('h', 'uN6')], 'PFPh', 'ru');
    expect(check(engine, s, { type: 'fire', decl: { units: ['r'], sw: [], target: 'uN8' } })).toMatch(/beneath an entrenchment: it cannot see across the wall uN5–uN6.*B9.21/);
    expect(check(engine, s, { type: 'fire', decl: { units: ['r'], sw: [], target: 'uN6' } })).toBeNull();
  });

  it('once the unit climbs out of the foxhole it is seen and fired on normally', () => {
    const { engine, s: s0 } = setup([ru('r', 'uN5'), ge('g', 'uN8')], 'MPh', 'ru');
    let s = act(engine, s0, { type: 'move.start', units: ['r'] }).state;
    s = act(engine, s, { type: 'move.entrenchment', beneath: false }).state;
    expect(engine.currentDecision(s)?.kind).toBe('firstFire');
    expect(check(engine, s, { type: 'defFire', decl: { units: ['g'], sw: [], target: 'uN5' } })).toBeNull();
  });
});
