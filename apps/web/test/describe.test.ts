import { describe, expect, it } from 'vitest';
import type { Action, Ctx, RuleModule } from '@asl/engine';
import { FP, type FireDeclaration, type FireMode, type ResolveFireFn } from '@asl/rules';
import { act, makeEngine } from '../../../packages/rules/test/fixtures';
import { describeEvents, newestFirst, type LogLine } from '../src/game/describe';

/** Resolves a declared fire attack directly (the fire tests' harness action). */
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

const terrain = { yP5: { terrain: 'building-stone' }, yO5: { terrain: 'orchard' } };

describe('game log', () => {
  it('says when a PTC has no effect on a unit already pinned, so the pins of an earlier attack do not read as the PTC’s', () => {
    const { engine, state } = makeEngine({
      terrain,
      extra: [testFire],
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'g1', def: 'ge.447', side: 'ge', hex: 'yP5', tags: { pinned: true } },
        { id: 'g2', def: 'ge.447', side: 'ge', hex: 'yP5' },
      ],
      // Attack DR 1+3 = 4, +3 TEM +1 Hindrance: 8 on the 6 column, a PTC. g2's PTC 1+2 = 3 passes; g1 rolls nothing.
      dice: [1, 3, 1, 2],
    });
    const t = act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: ['a1'], sw: [], target: 'yP5' } });
    const lines = describeEvents(engine.env(t.state), t.events).map((l) => l.text.trim());
    expect(lines.find((l) => l.includes('4-4-7') && l.includes('PTC (final DR 8)') && l.includes('no effect'))).toMatch(/no effect: already pinned or broken/);
    expect(lines.filter((l) => /no effect: already pinned/.test(l))).toHaveLength(1);
    expect(lines).toContainEqual(expect.stringMatching(/^PTC German 4-4-7: DR 3 → 3 vs 7 — passed$/));
  });

  it('names a unit as it was at each event and says when ELR replaced it', () => {
    const { engine, state } = makeEngine({
      terrain,
      extra: [testFire],
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'a2', def: 'am.666', side: 'am', hex: 'yO6' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5' },
      ],
      // Attack DR 4+2; g1 MC 6+5 = 11 vs morale 7: failed by 4, more than ELR 3.
      dice: [4, 2, 6, 5],
    });
    const t = act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: ['a1', 'a2'], sw: [], target: 'yP5' } });
    expect(t.state.pieces['g1']!.defId).toBe('ge.447');
    const all = describeEvents(engine.env(t.state), t.events);
    const lines = all.map((l) => l.text.trim());
    // The attack line explains the FP (Point Blank Fire for the adjacent 6-6-6) and every DRM.
    expect(all.find((l) => /^[A-Z][\w ]* on P5: /.test(l.text))!.detail).toBe('FP: x2 Point Blank Fire · DRM: +3 TEM (Stone Building), +1 LOS Hindrance');
    // Before the replacement the unit is the 4-6-7 it was; the ELR line names both counters.
    expect(lines).toContainEqual(expect.stringMatching(/^German 4.?-6-7: NMC/));
    expect(lines).toContainEqual(expect.stringMatching(/^MC German 4.?-6-7: DR 11 → 11 vs 7 — broken$/));
    expect(lines).toContainEqual(expect.stringMatching(/^↓ ELR: German 4.?-6-7 becomes 4-4-7 \(failed by 4, ELR 3\)$/));
    expect(lines.filter((l) => /becomes/.test(l))).toHaveLength(1);
    expect(lines.join('\n')).not.toMatch(/4-4-7 becomes/);
  });

  it('labels a Casualty Reduction as such', () => {
    const { engine, state } = makeEngine({
      terrain,
      extra: [testFire],
      pieces: [
        { id: 'a4', def: 'am.536', side: 'am', hex: 'yN4' },
        { id: 'g4', def: 'ge.467', side: 'ge', hex: 'yO5' },
      ],
      // Original 12 on a 1MC (final 13 vs 7): ELR replacement, then Casualty Reduction (ASLRB A10.31).
      dice: [2, 2, 6, 6],
    });
    const t = act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: ['a4'], sw: [], target: 'yO5' } });
    const lines = describeEvents(engine.env(t.state), t.events).map((l) => l.text.trim());
    const elr = lines.findIndex((l) => /^↓ ELR: German 4.?-6-7 becomes 4-4-7 \(failed by 6, ELR 3\)$/.test(l));
    const cr = lines.findIndex((l) => /^↓ Casualty Reduction: German 4-4-7 becomes 2-3-7 HS$/.test(l));
    expect(elr).toBeGreaterThan(lines.findIndex((l) => /^MC German .* — reduced$/.test(l)));
    expect(cr).toBeGreaterThan(elr);
  });
});

describe('fortified buildings in the log', () => {
  it('reports the designation without naming the buildings, and each reveal with its cause', async () => {
    const { FORTIFIED_MODULE, fortifiedModule } = await import('@asl/rules');
    const { engine, state } = makeEngine({
      terrain: { yP5: { terrain: 'building-stone', buildingId: 'b-P5' } },
      extra: [fortifiedModule, testFire],
      scenario: { forces: [{ side: 'ge', units: [], setup: { kind: 'area', description: 'P', hexes: ['yP5'] } }], ssr: [{ module: FORTIFIED_MODULE, params: { side: 'ge', count: 1 } }] },
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5' },
      ],
      // DR 3: final 6 is a 1MC on the 6 column, 7 a NMC, so the +1 matters and is told of.
      dice: [1, 2, 3, 3],
    });
    const t1 = act(engine, state, { type: 'fortify.designate', buildings: ['b-P5'] });
    const lines1 = describeEvents(engine.env(t1.state), t1.events).map((l) => l.text);
    expect(lines1).toContain('German secretly designated 1 fortified building (SSR)');
    expect(lines1.join('\n')).not.toMatch(/b-P5|P5/);
    const t2 = act(engine, t1.state, { type: 'test.fire', mode: 'prep', decl: { units: ['a1'], sw: [], target: 'yP5' } });
    const log2 = describeEvents(engine.env(t2.state), t2.events);
    const lines2 = log2.map((l) => l.text);
    expect(lines2).toContain('  ▣ Building P5 is fortified (+1 TEM): revealed by fire on P5');
    expect(log2.find((l) => /^[A-Z][\w ]* on P5: /.test(l.text))!.detail).toContain('+1 Fortified Building');
  });

  it('says nothing of a fortified building the +1 made no difference to', async () => {
    const { FORTIFIED_MODULE, fortifiedModule } = await import('@asl/rules');
    const { engine, state } = makeEngine({
      terrain: { yP5: { terrain: 'building-stone', buildingId: 'b-P5' } },
      extra: [fortifiedModule, testFire],
      scenario: { forces: [{ side: 'ge', units: [], setup: { kind: 'area', description: 'P', hexes: ['yP5'] } }], ssr: [{ module: FORTIFIED_MODULE, params: { side: 'ge', count: 1 } }] },
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5' },
      ],
      // DR 6: final 9 and 10 are both blank on the 6 column.
      dice: [3, 3],
    });
    const t1 = act(engine, state, { type: 'fortify.designate', buildings: ['b-P5'] });
    const t2 = act(engine, t1.state, { type: 'test.fire', mode: 'prep', decl: { units: ['a1'], sw: [], target: 'yP5' } });
    const log2 = describeEvents(engine.env(t2.state), t2.events);
    expect(log2.map((l) => l.text).join('\n')).not.toMatch(/fortified/i);
    const fire = log2.find((l) => /^[A-Z][\w ]* on P5: /.test(l.text))!;
    expect(fire.text).toContain('DR 3+3=6 +3');
    expect(fire.detail ?? '').not.toContain('Fortified');
  });
});

describe('SK3 log lines', () => {
  it("reports a vehicular MG malfunction as the vehicle's MG (its piece is never drawn)", async () => {
    const { sk2CoreModules, sk3CoreModules } = await import('@asl/rules');
    const { RU_VS_GE } = await import('../../../packages/rules/test/fixtures');
    const { engine, state } = makeEngine({
      scenario: RU_VS_GE,
      extra: [...sk2CoreModules, ...sk3CoreModules],
      startPhase: 'PFPh',
      dice: [6, 6],
      pieces: [
        { id: 't34', def: 'ru.T34M43', side: 'ru', hex: 'yM8', tags: { vca: 0, ca: 0 } },
        { id: 'sq', def: 'ge.467', side: 'ge', hex: 'yM6' },
      ],
    });
    const t = act(engine, state, { type: 'fire', decl: { units: [], sw: ['t34.cmg'], target: 'yM6' } });
    expect(t.state.pieces['t34.cmg']!.tags['malf']).toBe(true);
    const lines = describeEvents(engine.env(t.state), t.events).map((l) => l.text.trim());
    const malf = lines.find((l) => /malfunctions/.test(l));
    expect(malf).toMatch(/CMG malfunctions/);
    expect(malf).toMatch(/T-34|T34/);
  });
});

describe('SK2 log lines', () => {
  it('describes a Gun shot, its ROF, acquisition and a Direct Hit in words, naming the Gun', async () => {
    const { sk2CoreModules, GE_VS_BR: _ } = { ...(await import('@asl/rules')), GE_VS_BR: null };
    const { GE_VS_BR } = await import('../../../packages/rules/test/fixtures');
    const { engine, state } = makeEngine({
      scenario: GE_VS_BR,
      extra: sk2CoreModules,
      terrain: { yM5: { terrain: 'woods' } },
      // 3+1 = 4, +1 woods → 5 ≤ 8: a hit; the IFT DR 2+2 on the 12 column is a KIA.
      dice: [3, 1, 2, 2],
      pieces: [
        { id: 'c1', def: 'ge.228c', side: 'ge', hex: 'yK5' },
        { id: 'g75', def: 'ge.AT75L', side: 'ge', heldBy: 'c1', tags: { ca: 1 } },
        { id: 'bc', def: 'br.228c', side: 'br', hex: 'yM5' },
        { id: 'g40', def: 'br.AA40L', side: 'br', heldBy: 'bc', tags: { ca: 0 } },
      ],
    });
    const map = (engine.statics as { map: { hex(id: string): { cube: { q: number; r: number; s: number } } | undefined } }).map;
    const { inCoveredArc, nearestSpine } = await import('@asl/rules');
    const ca = inCoveredArc(map.hex('yK5')!.cube, 1, map.hex('yM5')!.cube) ? undefined : nearestSpine(map.hex('yK5')!.cube, 1, map.hex('yM5')!.cube)!;
    const t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'g75', target: 'yM5', targetType: 'ITT', ...(ca !== undefined ? { ca } : {}) } });
    const lines = describeEvents(engine.env(t.state), t.events).map((l) => l.text.trim());
    expect(lines.some((l) => /^German 75L AT Gun at M5 \(ITT, range 2\): TH 9, DR 1\+3=4 \+\d → \d: HIT$/.test(l))).toBe(true);
    expect(lines.some((l) => /German 75L AT Gun (keeps|loses) ROF/.test(l))).toBe(true);
    // The shot eliminated its only target, so no Acquired Target counter is left (SK4 6.10).
    expect(lines.some((l) => /acquires/.test(l))).toBe(false);
    expect(lines.some((l) => /British 40L AA Gun destroyed \(Direct Hit \(KIA\)\)/.test(l))).toBe(true);
    expect(lines.join('\n')).not.toMatch(/\b(ge|br)\.\d/);
  });

  it('gives the To Hit line and the hit itself the Gun\'s LOS, from its hex, for the map', async () => {
    const { sk2CoreModules } = await import('@asl/rules');
    const { GE_VS_BR } = await import('../../../packages/rules/test/fixtures');
    const { engine, state } = makeEngine({
      scenario: GE_VS_BR,
      extra: sk2CoreModules,
      terrain: { yM5: { terrain: 'woods' } },
      dice: [3, 1, 2, 2],
      pieces: [
        { id: 'c1', def: 'ge.228c', side: 'ge', hex: 'yK5' },
        { id: 'g75', def: 'ge.AT75L', side: 'ge', heldBy: 'c1', tags: { ca: 1 } },
        { id: 'bc', def: 'br.228c', side: 'br', hex: 'yM5' },
        { id: 'g40', def: 'br.AA40L', side: 'br', heldBy: 'bc', tags: { ca: 0 } },
      ],
    });
    const map = (engine.statics as { map: { hex(id: string): { cube: { q: number; r: number; s: number } } | undefined } }).map;
    const { inCoveredArc, nearestSpine } = await import('@asl/rules');
    const ca = inCoveredArc(map.hex('yK5')!.cube, 1, map.hex('yM5')!.cube) ? undefined : nearestSpine(map.hex('yK5')!.cube, 1, map.hex('yM5')!.cube)!;
    const t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'g75', target: 'yM5', targetType: 'ITT', ...(ca !== undefined ? { ca } : {}) } });
    const shot = t.events.find((e) => e.type === 'sk2.ordnance.shot')!;
    expect((shot.payload as { from: string }).from).toBe('yK5');
    const lines = describeEvents(engine.env(t.state), t.events);
    const th = lines.find((l) => /^German 75L AT Gun at M5/.test(l.text))!;
    expect(th.los).toEqual({ from: ['yK5'], to: 'yM5' });
    const hit = lines.find((l) => /^[A-Z][\w ]* on M5: /.test(l.text))!;
    expect(hit.los).toEqual({ from: ['yK5'], to: 'yM5' });
    // A recording from before the events named the hex: the held Gun is placed where its crew stands.
    const old = t.events.map((e) => (e.type === 'sk2.ordnance.shot' || e.type === 'sk1.fire.attack' ? { ...e, payload: { ...(e.payload as object), from: undefined } } : e));
    const oldLines = describeEvents(engine.env(t.state), old);
    expect(oldLines.find((l) => /^German 75L AT Gun at M5/.test(l.text))!.los).toEqual({ from: ['yK5'], to: 'yM5' });
    expect(oldLines.find((l) => /^[A-Z][\w ]* on M5: /.test(l.text))!.los).toEqual({ from: ['yK5'], to: 'yM5' });
  });
});

import { entryLossesModule, entryOrderDrModule } from '@asl/rules';

/** Test-only action: start the Rally Phase, as the turn module does. */
const testRph: RuleModule = {
  id: 'test.rph',
  install(r) {
    r.action<Action>({
      type: 'test.rph',
      decisionKinds: ['phase'],
      resolve(ctx: Ctx) {
        ctx.emit('turn.phaseStarted', { phase: 'RPh', turn: ctx.state.turn, attacker: ctx.state.attacker });
      },
    });
  },
};

describe('game log: order of entry and losses on entry (SSR)', () => {
  it('says which turn each group enters on and which counters the losses dr replaced', () => {
    const enter = (turn: number) => ({ kind: 'enter' as const, turn, edge: 'S' });
    const { engine, state } = makeEngine({
      extra: [entryOrderDrModule, entryLossesModule, testRph],
      scenario: {
        firstSide: 'br',
        sides: [
          { side: 'br', name: 'Free French', nationality: 'br', elr: 5 },
          { side: 'ge', name: 'German', nationality: 'ge', elr: 3 },
        ],
        forces: [
          { id: 'a', group: 'Group A', side: 'br', units: [{ def: 'br.458', count: 2 }], setup: enter(1) },
          { id: 'b', group: 'Group B', side: 'br', units: [{ def: 'br.458', count: 2 }], setup: enter(2) },
        ],
        ssr: [
          { module: 'entry-order-dr', params: { side: 'br', rule: 'SSR 1', outcomes: [{ dr: [1, 4], turns: { a: 1, b: 2 } }, { dr: [5, 6], turns: { a: 2, b: 1 } }] } },
          { module: 'entry-losses', params: { side: 'br', forces: ['a', 'b'], from: 'br.458', to: 'br.457', rule: 'SSR 2' } },
        ],
      },
      pieces: [
        { id: 'a1', def: 'br.458', side: 'br', tags: { force: 0, entryTurn: 1, entryEdge: 'S' } },
        { id: 'b1', def: 'br.458', side: 'br', tags: { force: 1, entryTurn: 2, entryEdge: 'S' } },
        { id: 'b2', def: 'br.458', side: 'br', tags: { force: 1, entryTurn: 2, entryEdge: 'S' } },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yH5' },
      ],
      dice: [6, 2],
    });
    const t = act(engine, state, { type: 'test.rph' });
    const lines = describeEvents(engine.env(t.state), t.events).map((l) => l.text.trim());
    expect(lines).toContain('SSR 1: Free French order of entry dr 6 → Group A enters on Turn 2; Group B enters on Turn 1');
    expect(lines).toContain('SSR 2: Group B losses dr 2 → 1× 4²-5-8 becomes 4²-5-7');
    expect(lines.some((l) => l.includes('↓'))).toBe(false);
  });
});

describe('newestFirst', () => {
  it('puts phases and entries newest first, each entry still reading top to bottom under its own heading', () => {
    const l = (seq: number, kind: LogLine['kind'], text: string): LogLine => ({ seq, kind, text });
    const out = newestFirst([
      l(1, 'phase', 'Turn 5 — German Movement Phase'),
      l(2, 'fire', 'Defensive First Fire on R7: ...'),
      l(3, 'fire', '  German 5-4-8: no effect'),
      l(4, 'fire', 'FPF on R7: ...'),
      l(5, 'check', '  FPF NMC on firer American 3-3-7: ...'),
      l(6, 'phase', 'Turn 5 — German Defensive Fire Phase'),
    ]);
    expect(out.map((x) => x.seq)).toEqual([6, 1, 4, 5, 2, 3]);
    expect(out.filter((x) => x.opens).map((x) => x.seq)).toEqual([4, 2]);
  });
});
