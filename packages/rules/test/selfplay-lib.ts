import { Engine, buildRuleset, hashValue, type Action, type GameState } from '@asl/engine';
import { SK1_TERRAIN, piecesModule, turnModule, sk1CoreModules, type ScenarioDef, type Statics } from '../src';
import { COUNTERS, TABLES, testMap } from './fixtures';

/** A small fixed-setup scenario exercising every phase. */
export const SCENARIO: ScenarioDef = {
  id: 'selfplay',
  title: 'Self-play test',
  boards: [{ board: 'y', position: '0,0' }],
  turns: 4,
  halfFinalTurn: false,
  month: 7,
  firstSide: 'am',
  sides: [
    { side: 'am', name: 'American', nationality: 'am', elr: 3 },
    { side: 'ge', name: 'German', nationality: 'ge', elr: 2 },
  ],
  forces: [
    { side: 'am', units: [{ def: 'am.747', count: 2 }], setup: { kind: 'hexes', hexes: ['yK8', 'yL8'] } },
    { side: 'am', units: [{ def: 'am.666', count: 2, withSw: ['ge.LMG'] }], setup: { kind: 'hexes', hexes: ['yJ8', 'yM8'] } },
    { side: 'am', units: [{ def: 'am.L91', count: 1 }], setup: { kind: 'hexes', hexes: ['yK8'] } },
    { side: 'am', units: [{ def: 'am.536', count: 1 }], setup: { kind: 'enter', turn: 2, edge: 'S' } },
    { side: 'ge', units: [{ def: 'ge.467', count: 2 }], setup: { kind: 'hexes', hexes: ['yK4', 'yL4'] } },
    { side: 'ge', units: [{ def: 'ge.447', count: 1, withSw: ['ge.MMG'] }], setup: { kind: 'hexes', hexes: ['yM4'] } },
    { side: 'ge', units: [{ def: 'ge.L81', count: 1 }], setup: { kind: 'hexes', hexes: ['yK4'] } },
  ],
  victory: [{ kind: 'controlBuildings', side: 'am', buildings: ['b1'], atLeast: 1 }],
  ssr: [],
};

const TERRAIN = {
  yK4: { terrain: 'building-stone', buildingId: 'b1' },
  yL4: { terrain: 'building-stone', buildingId: 'b1' },
  yM4: { terrain: 'woods' },
  yK6: { terrain: 'orchard' },
  yL6: { terrain: 'grain' },
  yJ6: { terrain: 'woods' },
  yK8: { terrain: 'building-wood' },
  yM6: { terrain: 'woods' },
};

export function makeGame(seed: string) {
  const statics: Statics = { map: testMap(TERRAIN), counters: COUNTERS, terrain: SK1_TERRAIN, tables: TABLES, scenario: SCENARIO };
  const engine = new Engine(buildRuleset('sk1-test', [piecesModule, turnModule, ...sk1CoreModules]), statics);
  return { engine, ...engine.createGame({ scenarioId: SCENARIO.id, sides: ['am', 'ge'], attacker: 'am', seed }) };
}

/** Small deterministic PRNG for the random players. */
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function playRandom(seed: number, maxSteps = 4000) {
  const { engine, state: s0, events: e0 } = makeGame(`seed-${seed}`);
  const rand = mulberry(seed);
  let state: GameState = s0;
  const log = [...e0];
  const actions: Action[] = [];
  let steps = 0;
  while (!state.result && steps++ < maxSteps) {
    const d = engine.currentDecision(state);
    if (!d) throw new Error(`No decision at seq ${state.seq} (phase ${state.phase})`);
    const legal = engine.legalActions(state, d.owner);
    if (legal.length === 0) throw new Error(`No legal actions for ${d.kind} (${d.owner}) in ${state.phase}`);
    // Bias toward doing things rather than ending the phase.
    const doing = legal.filter((a) => a.type !== 'endPhase' && a.type !== 'defPass');
    const pool = doing.length && rand() < 0.75 ? doing : legal;
    const a = pool[Math.floor(rand() * pool.length)]!;
    try {
      const t = engine.submit(state, a);
      state = t.state;
      log.push(...t.events);
      actions.push(a);
    } catch (err) {
      throw new Error(`Legal action rejected at step ${steps} (${state.phase} T${state.turn}): ${JSON.stringify(a)}: ${(err as Error).message}`);
    }
  }
  return { engine, state, log, actions, steps };
}

