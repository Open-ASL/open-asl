import { describe, expect, it } from 'vitest';
import { mulberry, newGame, playRandom, scenarioById, SK_S18 } from '@asl/content';
import type { ScenarioDef } from '@asl/rules';
import type { Action, GameState } from '@asl/engine';
import { casualtyVp } from '@asl/rules';
import { buildAar, type AarMeta } from '../src';

/** LMA6: the Germans set up, the Free French enter, and win if no Good Order Germans are left in an area. */
const LMA6 = scenarioById('lma-6')!;

const meta = (over: Partial<AarMeta> = {}): AarMeta => ({
  matchId: 'm1',
  mode: 'online',
  competition: 'ranked',
  players: { br: { uid: 'u1', nickname: 'Hank', elo: 1500, eloDelta: 12 }, ge: { uid: 'u2', nickname: 'Kurt', elo: 1500, eloDelta: -12 } },
  result: { winner: null, reason: 'scenario end' },
  playedAt: '2026-11-04T10:00:00Z',
  createdAt: '2026-11-04T10:00:00Z',
  durationMin: 90,
  ...over,
});

function play(seed: string, scenario: ScenarioDef = LMA6) {
  return playRandom(scenario, seed, { rand: mulberry([...seed].reduce((h, c) => Math.imul(h, 31) + c.charCodeAt(0), 0)), maxSteps: 20000 });
}

/** Replay with the engine to count two-dice rolls and the final casualty VP, independently of the builder. */
function ground(scenario: ScenarioDef, seed: string, actions: Action[]) {
  const { engine, state: s0, events: e0 } = newGame(scenario, seed, { los: 'grid' });
  let drs = e0.filter((e) => e.type === 'dice.rolled' && (e.payload as { dice: number[] }).dice.length === 2).length;
  let state: GameState = s0;
  for (const a of actions) {
    const t = engine.submit(state, a);
    drs += t.events.filter((e) => e.type === 'dice.rolled' && (e.payload as { dice: number[] }).dice.length === 2).length;
    state = t.state;
  }
  return { drs, state, env: engine.env(state) };
}

/**
 * What Firestore would refuse to store: undefined inside arrays, NaN, and arrays directly inside
 * arrays (rejected as "invalid nested entity", though not for every value, so a passing emulator
 * run proves nothing).
 */
function firestoreProblems(doc: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown, path: string, inArray: boolean) => {
    if (Array.isArray(v)) {
      if (inArray) out.push(`${path}: array inside an array`);
      v.forEach((x, i) => { if (x === undefined) out.push(`${path}[${i}]: undefined`); walk(x, `${path}[${i}]`, true); });
    } else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`, false);
    else if (typeof v === 'number' && Number.isNaN(v)) out.push(`${path}: NaN`);
  };
  walk(doc, 'doc', false);
  return out;
}

describe('buildAar', () => {
  it('folds a whole LMA6 game into a consistent report', { timeout: 180_000 }, () => {
    for (const seed of ['aar-1', 'aar-2']) {
      const g = play(seed);
      expect(g.state.result).toBeTruthy();
      const doc = buildAar(LMA6, seed, g.actions, meta({ result: { winner: g.state.result!.winner, reason: g.state.result!.reason } }), { los: 'grid' });
      const truth = ground(LMA6, seed, g.actions);

      const json = JSON.stringify(doc);
      expect(json).not.toMatch(/null,null,null,null,null,null,null,null,null,null,null,null/);
      expect(firestoreProblems(doc)).toEqual([]);

      expect(doc.scenario.number).toBe('LMA6');
      expect(doc.scenario.title).not.toMatch(/^LMA6 /);
      expect(doc.result.how.length).toBeGreaterThan(0);
      expect(doc.result.winner).toBe(g.state.result!.winner);
      expect(doc.sides.map((s) => s.side)).toEqual(['ge', 'br']);
      expect(doc.sides.find((s) => s.side === 'br')?.player.nickname).toBe('Hank');

      // One label per player turn plus the setup, in both series.
      expect(doc.strength.labels.length).toBeLessThanOrEqual(2 * LMA6.turns + 1);
      expect(doc.luck.labels).toEqual(doc.strength.labels);
      // The Germans set up in LMA6 (the French enter later): the Setup point counts them, and the first player turn follows it.
      expect(doc.strength.labels[1]).toBe('1 Fr');
      expect(doc.strength.sides['ge']![0]).toBeGreaterThan(0);
      expect(doc.strength.sides['br']![0]).toBe(0);
      for (const s of ['ge', 'br']) {
        expect(doc.strength.sides[s]!.length).toBe(doc.strength.labels.length);
        expect(doc.luck.sides[s]!.length).toBe(doc.luck.labels.length);
        const d = doc.dice[s]!;
        expect(d.hist.length).toBe(11);
        expect(d.hist.reduce((a, b) => a + b, 0)).toBe(d.drs);
        expect(d.twos).toBe(d.hist[0]);
        expect(d.twelves).toBe(d.hist[10]);
        if (d.drs) expect(d.avg).toBeGreaterThan(2);
        // Casualties agree with the rules' own ledger.
        expect(doc.casualties.filter((c) => c.side === s).reduce((a, c) => a + c.cvp, 0)).toBe(casualtyVp(truth.env, s));
      }
      // Every two-dice roll went to one side or the other.
      expect(doc.dice['ge']!.drs + doc.dice['br']!.drs).toBe(truth.drs);
      for (const c of doc.casualties) {
        expect(c.label).not.toMatch(/^(br|ge)\./);
        expect(c.cause).not.toMatch(/\b(br|ge)\.\d/);
        expect(c.cause.length).toBeGreaterThan(0);
      }
      expect(doc.highlights.length).toBeLessThanOrEqual(8);
      for (const h of doc.highlights) expect(h.text).not.toMatch(/\b(br|ge)\.\d/);
      // LMA6 turns on Good Order units in an area: neither a Control grid nor a VP race.
      expect(doc.control).toBeNull();
      expect(doc.race).toBeNull();
      expect(doc.victory.length).toBe(1);
      expect(doc.victory[0]!.text).toMatch(/No Good Order Germans/);
    }
  });

  it('samples building Control at the end of every Game Turn of a Control scenario', { timeout: 120_000 }, () => {
    const g = play('aar-s18', SK_S18);
    const doc = buildAar(SK_S18, 'aar-s18', g.actions, meta({ players: { ge: { uid: 'u1', nickname: 'Kurt' }, ru: { uid: 'u2', nickname: 'Ivan' } }, result: { winner: g.state.result!.winner, reason: g.state.result!.reason } }), { los: 'grid' });
    expect(doc.scenario.victoryText).toBe('The Germans win at game end if they control buildings P2 and P3.');
    expect(doc.control).not.toBeNull();
    expect(doc.race).toBeNull();
    expect(doc.control!.kind).toBe('buildings');
    expect(doc.control!.labels).toEqual(['P2', 'P3']);
    expect(doc.control!.byTurn.length).toBe(Math.max(1, doc.result.endedTurn));
    for (const row of doc.control!.byTurn) expect(row.holders.length).toBe(2);
    // The Russians set up in both; they hold them until a German MMC takes them.
    expect(doc.control!.byTurn[0]!.holders).toEqual(['ru', 'ru'].map((s, i) => doc.control!.byTurn[0]!.holders[i] === null ? null : s));
    expect(firestoreProblems(doc)).toEqual([]);
    expect(doc.victory[0]!.items.map((i) => i.label)).toEqual(['P2', 'P3']);
    for (const it of doc.victory[0]!.items) if (it.holder) expect(it.since).toMatch(/^T\d+$/);
    expect(doc.result.how).toMatch(/Held|never took|held on/);
  });

  it('words a server-side ending from the match document', { timeout: 120_000 }, () => {
    const g = play('aar-3');
    // Stop part way: no engine result, the server says the Germans conceded.
    const partial = g.actions.slice(0, Math.floor(g.actions.length / 2));
    const doc = buildAar(LMA6, 'aar-3', partial, meta({ result: { winner: 'br', reason: 'concession' } }), { los: 'grid' });
    expect(doc.result.winner).toBe('br');
    expect(doc.result.reason).toBe('concession');
    expect(doc.result.how).toMatch(/^Kurt conceded in Turn \d+ .+ Phase$/);
    const t = buildAar(LMA6, 'aar-3', partial, meta({ result: { winner: 'ge', reason: 'timeout' } }), { los: 'grid' });
    expect(t.result.how).toMatch(/^Hank ran out the clock in Turn \d+$/);
  });
});
