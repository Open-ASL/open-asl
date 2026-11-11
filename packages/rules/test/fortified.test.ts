import { describe, expect, it } from 'vitest';
import type { Action, Ctx, RuleModule } from '@asl/engine';
import { FORTIFIED_MODULE, FP, fortifiableBuildings, fortifiedModule, fortifiedKnownTo, fortifiedState, withoutSecrets, type FireAttackCtx, type FireDeclaration, type FireMode, type ResolveFireFn } from '../src';
import { act, makeEngine } from './fixtures';

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

// Two stone buildings in the German setup area (P5/P6 and P1), one outside it (K2).
const terrain = {
  yP5: { terrain: 'building-stone', buildingId: 'b-P5' },
  yP6: { terrain: 'building-stone', buildingId: 'b-P5' },
  yP1: { terrain: 'building-stone', buildingId: 'b-P1' },
  yK2: { terrain: 'building-wood', buildingId: 'b-K2' },
};

const scenario = {
  firstSide: 'am',
  forces: [{ side: 'ge', units: [], setup: { kind: 'area' as const, description: 'hexrow P', hexes: ['yP1', 'yP2', 'yP3', 'yP4', 'yP5', 'yP6'] } }],
  ssr: [{ module: FORTIFIED_MODULE, params: { side: 'ge', count: 2, within: 'setup' } }],
};

function game(dice?: number[]) {
  return makeEngine({
    terrain,
    extra: [fortifiedModule, testFire],
    scenario,
    pieces: [
      { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
      { id: 'a2', def: 'am.666', side: 'am', hex: 'yO1' },
      { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5' },
      { id: 'g2', def: 'ge.467', side: 'ge', hex: 'yP1' },
    ],
    ...(dice ? { dice } : {}),
  });
}

describe('fortified buildings (SSR)', () => {
  it('asks the fortifying side first, for buildings in its setup area only', () => {
    const { engine, state } = game();
    const d = engine.currentDecision(state)!;
    expect(d.kind).toBe('fortify');
    expect(d.owner).toBe('ge');
    expect(fortifiableBuildings(engine.env(state), 'ge')).toEqual(['b-P1', 'b-P5']);
    expect(() => act(engine, state, { type: 'fortify.designate', buildings: ['b-K2'] })).toThrow(/not a building in your setup area/);
    expect(() => act(engine, state, { type: 'fortify.designate', buildings: ['b-P1', 'b-P5', 'b-P5'] })).toThrow(/once|At most/);
    const t = act(engine, state, { type: 'fortify.designate', buildings: ['b-P5'] });
    expect(fortifiedState(engine.env(t.state))).toEqual({ side: 'ge', buildings: ['b-P5'], revealed: [] });
    expect(engine.currentDecision(t.state)!.kind).toBe('phase');
    // Only the German side knows; the American side and a shared screen do not.
    expect(fortifiedKnownTo(engine.env(t.state), 'yP6', 'ge')).toBe(true);
    expect(fortifiedKnownTo(engine.env(t.state), 'yP6', 'am')).toBe(false);
    expect(fortifiedKnownTo(engine.env(t.state), 'yP6', null)).toBe(false);
    expect(fortifiedKnownTo(engine.env(t.state), 'yP1', 'ge')).toBe(false);
  });

  it('may fortify nothing', () => {
    const { engine, state } = game();
    const t = act(engine, state, { type: 'fortify.designate', buildings: [] });
    expect(fortifiedState(engine.env(t.state))!.buildings).toEqual([]);
  });

  // a1 (7 FP) fires at g1 in the stone building P5 from two hexes away: the 6 column, +3 TEM, and
  // secretly +1 more. On that column a final DR of 6 is a 1MC and 7 a NMC; 9 and 10 are both blank.
  const attackOf = (t: { events: { type: string; payload: unknown }[] }) =>
    t.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { drm: number; explain: { id: string; label?: string }[] };
  const fire = (decl: FireDeclaration) => ({ type: 'test.fire', mode: 'prep', decl });

  it('applies the +1 and reveals the building when the +1 changes a result', () => {
    const { engine, state: s0 } = game([1, 2, 3, 3]);
    const s1 = act(engine, s0, { type: 'fortify.designate', buildings: ['b-P5'] }).state;
    const t = act(engine, s1, fire({ units: ['a1'], sw: [], target: 'yP5' }));
    expect(attackOf(t)).toMatchObject({ drm: 4 });
    expect(attackOf(t).explain.map((n) => n.label)).toContain('+1 Fortified Building');
    const result = t.events.find((e) => e.type === 'sk1.fire.result')!.payload as { finalDr: number; result: { kind: string } };
    expect(result).toMatchObject({ finalDr: 7, result: { kind: 'NMC' } });
    expect(t.events.find((e) => e.type === 'sk1.fortified.revealed')!.payload).toMatchObject({ building: 'b-P5', hex: 'yP5', reason: 'fire' });
    expect(fortifiedKnownTo(engine.env(t.state), 'yP6', 'am')).toBe(true);
  });

  it('keeps the +1 out of the attack entirely when the result is the same without it', () => {
    const { engine, state: s0 } = game([3, 3, 3, 3]);
    const s1 = act(engine, s0, { type: 'fortify.designate', buildings: ['b-P5'] }).state;
    const t = act(engine, s1, fire({ units: ['a1'], sw: [], target: 'yP5' }));
    // Reported as an ordinary +3 stone building attack: final DR 9, no result, no reveal.
    expect(attackOf(t)).toMatchObject({ drm: 3 });
    expect(attackOf(t).explain.map((n) => n.label)).not.toContain('+1 Fortified Building');
    expect(t.events.find((e) => e.type === 'sk1.fire.result')!.payload).toMatchObject({ finalDr: 9, result: { kind: 'none' } });
    expect(t.events.some((e) => e.type === 'sk1.fortified.revealed')).toBe(false);
    expect(fortifiedKnownTo(engine.env(t.state), 'yP6', 'am')).toBe(false);
    // An unfortified building: the same attack, the same report.
    const u = act(engine, s1, fire({ units: ['a2'], sw: [], target: 'yP1' }));
    expect(attackOf(u).drm).toBe(3);
  });

  it('shows the +1 as a matter of course once the building is revealed', () => {
    const { engine, state: s0 } = game([1, 2, 3, 3, 3, 3]);
    const s1 = act(engine, s0, { type: 'fortify.designate', buildings: ['b-P5'] }).state;
    const s2 = act(engine, s1, fire({ units: ['a1'], sw: [], target: 'yP5' })).state;
    expect(fortifiedState(engine.env(s2))!.revealed).toEqual(['b-P5']);
    // a2 (6 FP, 6 column) rolls 6: final 10 with the +1, 9 without, both blank, but it is known now.
    const t = act(engine, s2, fire({ units: ['a2'], sw: [], target: 'yP5' }));
    expect(attackOf(t)).toMatchObject({ drm: 4 });
    expect(attackOf(t).explain.map((n) => n.label)).toContain('+1 Fortified Building');
  });

  it('is left out of what the firer is shown beforehand until revealed', () => {
    const { engine, state: s0 } = game();
    const s1 = act(engine, s0, { type: 'fortify.designate', buildings: ['b-P5'] }).state;
    const env = engine.env(s1);
    const attack: FireAttackCtx = { mode: 'prep', side: 'am', target: 'yP5', parts: [], targets: ['g1'], hindrance: 0 };
    const full = env.explain('fire.drm', { attack }, 0);
    expect(full.value).toBe(4);
    expect(full.trace.find((t) => t.id === 'ssr.fortified.drm')?.secret).toBe(true);
    const shown = withoutSecrets(full);
    expect(shown.value).toBe(3);
    expect(shown.trace.map((t) => t.id)).not.toContain('ssr.fortified.drm');
  });

  it('is revealed when an enemy unit enters any hex of it', () => {
    const { engine, state: s0 } = game();
    const s1 = act(engine, s0, { type: 'fortify.designate', buildings: ['b-P5'] }).state;
    const mover: RuleModule = {
      id: 'test.move',
      install(r) {
        r.action<Action & { id: string; hex: string }>({
          type: 'test.move',
          decisionKinds: ['phase'],
          resolve(ctx, a) {
            ctx.emit('piece.moved', { id: a.id, loc: { kind: 'hex', hex: a.hex } });
          },
        });
      },
    };
    const { engine: e2, state: r0 } = makeEngine({ terrain, extra: [fortifiedModule, mover], scenario, pieces: [{ id: 'a1', def: 'am.747', side: 'am', hex: 'yO6' }, { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5' }] });
    void s1;
    const r1 = act(e2, r0, { type: 'fortify.designate', buildings: ['b-P5'] }).state;
    const t = act(e2, r1, { type: 'test.move', id: 'a1', hex: 'yP6' });
    expect((t.events.find((e) => e.type === 'sk1.fortified.revealed')!.payload as { reason: string }).reason).toBe('entered');
    expect(fortifiedState(e2.env(t.state))!.revealed).toEqual(['b-P5']);
  });
});
