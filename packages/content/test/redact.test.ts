import { describe, expect, it } from 'vitest';
import { deepEqual, type GameState, type LoggedEvent } from '@asl/engine';
import { fortifiedState, hiddenFrom, redactState, scatterState, type FortifiedState, type ScatterState } from '@asl/rules';
import { PLAYABLE_SCENARIOS, mulberry, newSk1Game } from '../src';

/** Strings the viewer must never receive: ids of pieces hidden from them, and the other side's unrevealed secrets. */
function secretsFrom(engine: ReturnType<typeof newSk1Game>['engine'], state: GameState, viewer: string | null): string[] {
  const env = engine.env(state);
  const out: string[] = [];
  for (const id of hiddenFrom(env, state, viewer)) out.push(JSON.stringify(id));
  return out;
}

/**
 * The redaction invariants, on random play of every playable scenario, for both seats and a spectator:
 * 1. the redacted event stream folds into the redacted snapshot, step by step, with the same event count;
 * 2. no hidden piece id or unrevealed secret reaches the viewer, in the snapshot or in the stream;
 * 3. the engine can still list legal actions on the redacted state (the client does that).
 */
describe('redacted views on random play', () => {
  const ACTIONS = 140;
  for (const scenario of PLAYABLE_SCENARIOS) {
    it(`${scenario.id}: every viewer's stream folds into their snapshot and leaks nothing`, { timeout: 90_000 }, () => {
      const { engine, state: s0 } = newSk1Game(scenario, `redact-${scenario.id}`, { los: 'grid' });
      const rand = mulberry(scenario.id.length * 7919);
      const viewers: (string | null)[] = [...s0.sides, null];
      const redactors = new Map(viewers.map((v) => [v, (s: GameState) => redactState(engine, s, v)]));
      let state = s0;
      let views = new Map(viewers.map((v) => [v, redactors.get(v)!(s0)]));
      let secretsSeen = 0;
      for (let i = 0; i < ACTIONS && !state.result; i++) {
        const d = engine.currentDecision(state)!;
        const legal = engine.legalActions(state, d.owner);
        const doing = legal.filter((a) => a.type !== 'endPhase' && a.type !== 'defPass');
        const pool = doing.length && rand() < 0.75 ? doing : legal;
        const t = engine.submit(state, pool[Math.floor(rand() * pool.length)]!);
        for (const viewer of viewers) {
          const redact = redactors.get(viewer)!;
          const stream = engine.redactTransition(viewer, redact, state, t.events as LoggedEvent[]);
          expect(stream.length, `${viewer}: event count`).toBe(t.events.length);
          const folded = engine.applyEvents(views.get(viewer)!, stream);
          const snapshot = redact(t.state);
          if (!deepEqual(folded, snapshot)) {
            expect.fail(`${scenario.id} seq ${t.state.seq}, viewer ${viewer}: folded stream differs from the snapshot\n${JSON.stringify(stream.map((e) => e.type))}`);
          }
          // Hidden before and after: a piece revealed (or hidden) by this action may be named by the stream that shows it.
          const after = new Set(secretsFrom(engine, t.state, viewer));
          const secrets = secretsFrom(engine, state, viewer).filter((x) => after.has(x));
          secretsSeen += secrets.length;
          if (secrets.length) {
            const json = JSON.stringify(snapshot) + JSON.stringify(stream);
            for (const s of secrets) expect(json, `${scenario.id} seq ${t.state.seq}, viewer ${viewer} sees ${s}`).not.toContain(s);
          }
          // Fortified buildings: a building id is public (Control names it), so check the slice itself.
          const fort = snapshot.ext['sk1.fortified'] as FortifiedState | undefined;
          const realFort = fortifiedState(engine.env(t.state));
          if (fort && realFort && realFort.side !== viewer) {
            expect(fort.buildings.every((b) => realFort.revealed.includes(b)), `${viewer} sees unrevealed fortified buildings`).toBe(true);
            for (const e of stream) if (e.type === 'sk1.fortified') expect((e.payload as { state: FortifiedState }).state.buildings.every((b) => realFort.revealed.includes(b))).toBe(true);
            if (realFort.buildings.some((b) => !realFort.revealed.includes(b))) secretsSeen++;
          }
          // Scatter setup: the units are on the table for all to see; the plan (groups, rendezvous) is the secret.
          const plan = snapshot.ext['ssr.scatter'] as ScatterState | undefined;
          const realPlan = scatterState(engine.env(t.state));
          if (plan && realPlan && realPlan.side !== viewer) {
            realPlan.groups.forEach((_g, gi) => {
              if (realPlan.rolled.includes(gi)) return;
              expect(plan.groups[gi], `${viewer} sees scatter group ${gi}`).toEqual([]);
              expect(plan.rendezvous[gi], `${viewer} sees rendezvous ${gi}`).toBe('');
              secretsSeen++;
            });
          }
          const owner = engine.currentDecision(snapshot)?.owner;
          if (owner) expect(() => engine.legalActions(snapshot, owner)).not.toThrow();
          views.set(viewer, snapshot);
        }
        // A side's own view keeps every piece; the other secrets are the module's business.
        for (const side of s0.sides) {
          const own = views.get(side)!;
          for (const p of Object.values(t.state.pieces)) if (p.side === side) expect(own.pieces[p.id], `${side} sees its own ${p.id}`).toBeDefined();
        }
        state = t.state;
      }
      // Sanity: scenarios whose pieces hide from the other side actually exercised the leak scan.
      const env = engine.env(state);
      if (s0.sides.some((side) => hiddenFrom(env, s0, side).size > 0) || scatterState(env)) expect(secretsSeen).toBeGreaterThan(0);
    });
  }
});
