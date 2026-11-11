import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  Engine,
  Layer,
  RuleError,
  buildRuleset,
  hashValue,
  type Action,
  type RuleModule,
} from '../src';

declare module '../src' {
  interface QueryCatalog {
    'toy.drm': { ctx: { target: string; moving: boolean }; value: number };
  }
}

/**
 * A tiny game: the active side may "shoot" (roll 2d6 + DRM) or "pass".
 * Turn passes to the other side; the game ends after 6 decisions.
 */
const toyCore: RuleModule = {
  id: 'toy.core',
  install(r) {
    r.event<{ by: string; total: number }>({
      type: 'toy.shot',
      apply(d, p) {
        const log = (d.ext['toy'] as { shots: number[] } | undefined) ?? { shots: [] };
        log.shots.push(p.total);
        d.ext['toy'] = log;
      },
    });
    r.event<{ attacker: string; turn: number }>({
      type: 'toy.turn',
      apply(d, p) {
        d.attacker = p.attacker;
        d.turn = p.turn;
        d.phase = 'main';
      },
    });
    const nextTurn = (ctx: Parameters<NonNullable<Parameters<typeof r.action>[0]['resolve']>>[0]) => {
      ctx.popDecision();
      if (ctx.state.turn >= 6) {
        ctx.endGame({ winner: null, reason: 'turn limit' });
        return;
      }
      const other = ctx.state.sides.find((s) => s !== ctx.state.attacker)!;
      ctx.emit('toy.turn', { attacker: other, turn: ctx.state.turn + 1 });
      ctx.pushDecision({ kind: 'main', owner: other, deadlineClass: 'turn' });
    };
    r.action<Action & { target: string; moving?: boolean }>({
      type: 'shoot',
      decisionKinds: ['main'],
      legal: () => [{ type: 'shoot', target: 'h1' }],
      validate: (_env, a) => (a.target ? null : 'target required'),
      resolve(ctx, a) {
        const drm = ctx.query('toy.drm', { target: a.target, moving: !!a.moving }, 0);
        const dr = ctx.roll('toy shot');
        ctx.emit('toy.shot', { by: a.side, total: dr.total + drm });
        nextTurn(ctx);
      },
    });
    r.action({
      type: 'pass',
      decisionKinds: ['main'],
      legal: () => [{ type: 'pass' }],
      resolve: (ctx) => nextTurn(ctx),
    });
    r.setup({
      id: 'toy.start',
      run(ctx) {
        ctx.emit('toy.turn', { attacker: ctx.state.attacker, turn: 1 });
        ctx.pushDecision({ kind: 'main', owner: ctx.state.attacker, deadlineClass: 'turn' });
      },
    });
  },
};

const toyTerrain: RuleModule = {
  id: 'toy.terrain',
  requires: ['toy.core'],
  install(r) {
    r.contribute({
      id: 'toy.tem.building',
      query: 'toy.drm',
      label: '+3 stone building',
      apply: (v) => v + 3,
    });
    r.contribute({
      id: 'toy.ffmo',
      query: 'toy.drm',
      label: '-1 FFMO',
      when: (c) => c.moving,
      apply: (v) => v - 1,
    });
    r.contribute({
      id: 'toy.halve',
      query: 'toy.drm',
      layer: Layer.Multiply,
      apply: (v) => v * 2,
      label: 'x2',
    });
  },
};

const engineFor = (mods: RuleModule[], forcedDice?: number[]) =>
  new Engine(buildRuleset('toy', mods), {}, forcedDice ? { forcedDice } : {});

const start = (e: Engine, seed = 'seed-1') =>
  e.createGame({ scenarioId: 'toy', sides: ['ger', 'rus'], attacker: 'ger', seed }).state;

describe('ruleset building', () => {
  it('rejects duplicate ids unless disabled first', () => {
    const dup: RuleModule = {
      id: 'dup',
      install: (r) => r.contribute({ id: 'toy.ffmo', query: 'toy.drm', apply: (v) => v }),
    };
    expect(() => buildRuleset('x', [toyCore, toyTerrain, dup])).toThrow(/already registered/);
    const override: RuleModule = {
      id: 'override',
      install(r) {
        r.disable('toy.ffmo');
        r.contribute({ id: 'toy.ffmo', query: 'toy.drm', apply: (v) => v - 5 });
      },
    };
    expect(() => buildRuleset('x', [toyCore, toyTerrain, override])).not.toThrow();
  });

  it('enforces module ordering via requires', () => {
    expect(() => buildRuleset('x', [toyTerrain, toyCore])).toThrow(/requires "toy.core"/);
  });

  it('pins a version hash that changes with the module list', () => {
    const a = buildRuleset('x', [toyCore]);
    const b = buildRuleset('x', [toyCore, toyTerrain]);
    expect(a.versionHash).not.toEqual(b.versionHash);
    expect(buildRuleset('x', [toyCore]).versionHash).toEqual(a.versionHash);
  });
});

describe('procedures', () => {
  it('lets later modules wrap an earlier procedure', () => {
    const base: RuleModule = {
      id: 'p.base',
      install: (r) => r.procedure<(n: number) => number>('calc', () => (n) => n + 1),
    };
    const wrap: RuleModule = {
      id: 'p.wrap',
      install: (r) => r.procedure<(n: number) => number>('calc', (next) => (n) => next!(n) * 10),
    };
    const rs = buildRuleset('p', [base, wrap]);
    expect((rs.procedures.get('calc') as (n: number) => number)(1)).toBe(20);
  });
});

describe('query pipeline', () => {
  it('applies contributions by layer and explains each step', () => {
    const e = engineFor([toyCore, toyTerrain]);
    const s = start(e);
    const res = e.query(s, 'toy.drm', { target: 'h', moving: true }, 0);
    expect(res.value).toBe(4); // (0 + 3 - 1) * 2
    expect(res.trace.map((t) => t.label)).toEqual(['+3 stone building', '-1 FFMO', 'x2']);
  });

  it('lets later modules suppress a contribution conditionally', () => {
    const hindrance: RuleModule = {
      id: 'toy.hindrance',
      install: (r) =>
        r.suppress({ id: 'toy.hindrance-negates-ffmo', target: 'toy.ffmo', when: (c: { target: string }) => c.target === 'grain' }),
    };
    const e = engineFor([toyCore, toyTerrain, hindrance]);
    const s = start(e);
    expect(e.query(s, 'toy.drm', { target: 'grain', moving: true }, 0).value).toBe(6);
    const traced = e.query(s, 'toy.drm', { target: 'grain', moving: true }, 0).trace;
    expect(traced.find((t) => t.id === 'toy.ffmo')?.suppressedBy).toBe('toy.hindrance-negates-ffmo');
    expect(e.query(s, 'toy.drm', { target: 'open', moving: true }, 0).value).toBe(4);
  });

  it('lets a scenario SSR module remove a rule outright', () => {
    const ssr: RuleModule = { id: 'ssr.no-ffmo', install: (r) => r.disable('toy.ffmo') };
    const e = engineFor([toyCore, toyTerrain, ssr]);
    expect(e.query(start(e), 'toy.drm', { target: 'h', moving: true }, 0).value).toBe(6);
  });
});

describe('decisions and actions', () => {
  it('only accepts actions from the decision owner', () => {
    const e = engineFor([toyCore]);
    const s = start(e);
    const d = e.currentDecision(s)!;
    expect(() => e.submit(s, { type: 'pass', side: 'rus', decisionId: d.id })).toThrow(RuleError);
    expect(() => e.submit(s, { type: 'pass', side: 'ger', decisionId: 'stale' })).toThrow(/stale/);
    const next = e.submit(s, { type: 'pass', side: 'ger', decisionId: d.id }).state;
    expect(e.currentDecision(next)?.owner).toBe('rus');
  });

  it('lists legal actions only for the side being asked', () => {
    const e = engineFor([toyCore]);
    const s = start(e);
    expect(e.legalActions(s, 'rus')).toEqual([]);
    expect(e.legalActions(s, 'ger').map((a) => a.type).sort()).toEqual(['pass', 'shoot']);
  });

  it('runs triggers and replacement effects', () => {
    const extras: RuleModule = {
      id: 'toy.extras',
      install(r) {
        r.event<{ n: number }>({
          type: 'toy.bonus',
          apply(d, p) {
            d.ext['bonus'] = ((d.ext['bonus'] as number) ?? 0) + p.n;
          },
        });
        r.on<{ total: number }>({
          id: 'toy.bonus-on-high',
          event: 'toy.shot',
          handler(ctx, ev) {
            if (ev.payload.total >= 10) ctx.emit('toy.bonus', { n: 1 });
          },
        });
        // Replacement: shots are capped at 12.
        r.replace<{ by: string; total: number }>({
          id: 'toy.cap',
          event: 'toy.shot',
          when: (_env, ev) => ev.payload.total > 12,
          replace: (_env, ev) => [{ ...ev, payload: { ...ev.payload, total: 12 } }],
        });
      },
    };
    const e = engineFor([toyCore, toyTerrain, extras], [6, 6]);
    const s = start(e);
    const t = e.submit(s, { type: 'shoot', side: 'ger', decisionId: e.currentDecision(s)!.id, target: 'x' });
    expect((t.state.ext['toy'] as { shots: number[] }).shots).toEqual([12]); // 12 + 6 capped
    expect(t.state.ext['bonus']).toBe(1);
    expect(t.events.map((ev) => ev.type)).toContain('dice.rolled');
  });

  it('auto-resolves decisions via standing orders / timeouts', () => {
    const autoPass: RuleModule = {
      id: 'toy.autopass',
      install: (r) =>
        r.autoResolver({
          id: 'toy.rus-autopass',
          decisionKind: 'main',
          resolve: (_env, d) => (d.owner === 'rus' ? { type: 'pass' } : null),
        }),
    };
    const e = engineFor([toyCore, autoPass]);
    const s = start(e);
    const t = e.submit(s, { type: 'pass', side: 'ger', decisionId: e.currentDecision(s)!.id });
    expect(e.currentDecision(t.state)?.owner).toBe('ger');
    expect(t.state.turn).toBe(3);
  });
});

describe('determinism and replay', () => {
  const playOut = (seed: string) => {
    const e = engineFor([toyCore, toyTerrain]);
    let { state, events } = e.createGame({ scenarioId: 'toy', sides: ['ger', 'rus'], attacker: 'ger', seed });
    const all = [...events];
    while (!state.result) {
      const d = e.currentDecision(state)!;
      const t = e.submit(state, { type: 'shoot', side: d.owner, decisionId: d.id, target: 'h', moving: true });
      state = t.state;
      all.push(...t.events);
    }
    return { e, state, all };
  };

  it('produces identical states for identical seeds', () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        expect(hashValue(playOut(seed).state)).toEqual(hashValue(playOut(seed).state));
      }),
      { numRuns: 25 },
    );
  });

  it('re-folding the event log reproduces the final state', () => {
    const { e, state, all } = playOut('replay');
    const init = { scenarioId: 'toy', sides: ['ger', 'rus'], attacker: 'ger', seed: 'replay' };
    const refolded = e.applyEvents(e.initialState(init), all);
    expect(refolded).toEqual(state);
    expect(all.length).toBe(state.seq);
  });
});
