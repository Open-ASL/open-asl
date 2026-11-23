import { describe, expect, it } from 'vitest';
import type { Action, Ctx, GameState, RuleModule } from '@asl/engine';
import { FP, buildAttack, shotOdds, type FireDeclaration, type FireMode, type ResolveFireFn, type UnitOdds } from '../src';
import { makeEngine, scenario, type PieceSpec } from './fixtures';

/** Test-only action: resolve a fire declaration in a given mode. */
const testFire: RuleModule = {
  id: 'test.fire',
  install(r) {
    r.action<Action & { decl: FireDeclaration; mode: FireMode }>({
      type: 'test.fire',
      decisionKinds: ['phase'],
      validate: () => null,
      resolve(ctx: Ctx, a) {
        ctx.proc<ResolveFireFn>(FP.resolve)(ctx, a.decl, a.mode);
      },
    });
  },
};

const terrain = {
  yP5: { terrain: 'building-stone' },
  yO5: { terrain: 'orchard' },
};

/**
 * The odds `shotOdds` works out, against the engine playing the same attack `runs` times on different dice: each unit
 * ends eliminated, reduced (a squad to a half-squad, a leader wounded), broken or pinned, worst first.
 */
function compare(pieces: PieceSpec[], decl: FireDeclaration, mode: FireMode, runs: number) {
  const { engine, state } = makeEngine({ terrain, extra: [testFire], pieces });
  const env = engine.env(state);
  const odds = shotOdds(env, buildAttack(env, decl, mode, 'am'));
  const sc = scenario();
  const seen: Record<string, UnitOdds> = Object.fromEntries(Object.keys(odds.units).map((id) => [id, { elim: 0, reduced: 0, broken: 0, pinned: 0 }]));
  let effect = 0;
  for (let i = 0; i < runs; i++) {
    const start: GameState = engine.createGame({ scenarioId: 'test', sides: sc.sides.map((x) => x.side), attacker: sc.firstSide, seed: `odds-${i}` }).state;
    const d = engine.currentDecision(start)!;
    const t = engine.submit(start, { type: 'test.fire', side: d.owner, decisionId: d.id, decl, mode } as Action);
    const result = t.events.find((e) => e.type === 'sk1.fire.result');
    if (result && (result.payload as { result: { kind: string } }).result.kind !== 'none') effect++;
    for (const id of Object.keys(seen)) {
      const before = start.pieces[id]!;
      const after = t.state.pieces[id];
      const s = seen[id]!;
      const reduced = t.events.some((e) => e.type === 'sk1.casualtyReduced' && (e.payload as { unit: string }).unit === id) || ((after?.tags['wounds'] as number | undefined) ?? 0) > ((before.tags['wounds'] as number | undefined) ?? 0);
      if (!after || after.loc.kind === 'eliminated') s.elim++;
      else if (reduced) s.reduced++;
      else if (after.tags['broken'] && !before.tags['broken']) s.broken++;
      else if (after.tags['pinned'] && !before.tags['pinned']) s.pinned++;
    }
  }
  return { odds, seen: Object.fromEntries(Object.entries(seen).map(([id, s]) => [id, { elim: s.elim / runs, reduced: s.reduced / runs, broken: s.broken / runs, pinned: s.pinned / runs }])), effect: effect / runs };
}

/**
 * Within `tol` of the engine's frequencies (4000 runs: about 3.5 standard deviations at worst). Leaving out the Leader
 * Loss checks a broken leader causes was a 0.012 shortfall in the first case's pins, found at 20000 runs.
 */
function close(odds: Record<string, UnitOdds>, seen: Record<string, UnitOdds>, tol = 0.025) {
  for (const [id, o] of Object.entries(odds))
    for (const k of ['elim', 'reduced', 'broken', 'pinned'] as const) expect(Math.abs(o[k] - seen[id]![k]), `${id} ${k}: odds ${o[k].toFixed(3)} vs engine ${seen[id]![k].toFixed(3)}`).toBeLessThan(tol);
}

describe('the odds of a fire attack, against the engine rolling it', () => {
  it('two squads and a -1 leader in a stone building under Prep Fire: the leader checks first and lends his DRM', () => {
    const { odds, seen, effect } = compare(
      [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'a2', def: 'am.666', side: 'am', hex: 'yN5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5' },
        { id: 'g2', def: 'ge.447', side: 'ge', hex: 'yP5' },
        { id: 'gl', def: 'ge.L91', side: 'ge', hex: 'yP5' },
      ],
      { units: ['a1', 'a2'], sw: [], target: 'yP5' },
      'prep',
      4000,
    );
    expect(odds.fp).toBe(13);
    expect(Math.abs(odds.effect - effect)).toBeLessThan(0.03);
    close(odds.units, seen);
  });

  it('point-blank fire into the open on a broken squad, a broken half-squad and a fresh one: KIA, K and the broken units reduced', () => {
    const { odds, seen } = compare(
      [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'a2', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'mg', def: 'am.MMG', side: 'am', heldBy: 'a2' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yN6', tags: { broken: true } },
        { id: 'g2', def: 'ge.247', side: 'ge', hex: 'yN6', tags: { broken: true } },
        { id: 'g3', def: 'ge.467', side: 'ge', hex: 'yN6' },
      ],
      { units: ['a1'], sw: ['mg'], target: 'yN6' },
      'prep',
      4000,
    );
    expect(odds.results[0]!.label).toMatch(/KIA/);
    close(odds.units, seen);
  });

  it('a lone leader in the orchard under long-range fire: wounded or killed by a K, pinned by a PTC', () => {
    const { odds, seen } = compare(
      [
        { id: 'a1', def: 'am.666', side: 'am', hex: 'yK5' },
        { id: 'gl', def: 'ge.L81', side: 'ge', hex: 'yO5' },
      ],
      { units: ['a1'], sw: [], target: 'yO5' },
      'prep',
      4000,
    );
    close(odds.units, seen);
  });

  it('two leaders: each checks in turn, the second lending when the first fails, and either one lost costs the squads a Leader Loss check', () => {
    const { odds, seen } = compare(
      [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'a2', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yO5' },
        { id: 'g2', def: 'ge.447', side: 'ge', hex: 'yO5' },
        { id: 'l9', def: 'ge.L91', side: 'ge', hex: 'yO5' },
        { id: 'l8', def: 'ge.L81', side: 'ge', hex: 'yO5' },
      ],
      { units: ['a1', 'a2'], sw: [], target: 'yO5' },
      'prep',
      4000,
    );
    close(odds.units, seen);
  });

  it('a leader broken before the attack lends nothing and causes no fresh Leader Loss check', () => {
    const { odds, seen } = compare(
      [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yO5' },
        { id: 'l9', def: 'ge.L91', side: 'ge', hex: 'yO5', tags: { broken: true } },
      ],
      { units: ['a1'], sw: [], target: 'yO5' },
      'prep',
      4000,
    );
    close(odds.units, seen);
  });

  it('an empty hex: no units to harm, but the chance of a result is still given', () => {
    const { engine, state } = makeEngine({ terrain, pieces: [{ id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' }] });
    const env = engine.env(state);
    const odds = shotOdds(env, buildAttack(env, { units: ['a1'], sw: [], target: 'yP5' }, 'prep', 'am'));
    expect(odds.units).toEqual({});
    expect(odds.effect).toBeGreaterThan(0);
    expect(odds.effect).toBeCloseTo(odds.results.reduce((s, r) => s + r.p, 0), 10);
  });
});
