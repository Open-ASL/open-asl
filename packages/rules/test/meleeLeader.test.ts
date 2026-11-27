import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { buildAttack, shotOdds, type CounterDef, type FireDeclaration } from '../src';
import { declarationOptions } from '../src/sk1/closeCombat';
import { COUNTERS, act, makeEngine, type PieceSpec } from './fixtures';

/** Submits `endPhase` where it is offered, else the first legal action, until `done` holds. */
function playUntil(engine: Engine, s0: GameState, done: (s: GameState) => boolean, guard = 80): GameState {
  let s = s0;
  for (let i = 0; i < guard && !done(s); i++) {
    const d = engine.currentDecision(s)!;
    const legal = engine.legalActions(s, d.owner);
    s = engine.submit(s, legal.find((a) => a.type === 'endPhase') ?? legal[0]!).state;
  }
  return s;
}

describe('a lone leader in Melee may attack in CC (SK1 3.8)', () => {
  // SK1 3.8: "A SMC may attack alone, but if it does, it must also defend alone." A German 8-1 stacked on a broken
  // 4-4-7 holds the Melee in O5 against a broken American half-squad; the squad cannot attack, the 8-1 can.
  const pieces: PieceSpec[] = [
    { id: 'gL', def: 'ge.L81', side: 'ge', hex: 'yO5', tags: { stackedOn: 'g1' } },
    { id: 'g1', def: 'ge.447', side: 'ge', hex: 'yO5', tags: { broken: true } },
    { id: 'a1', def: 'am.347', side: 'am', hex: 'yO5', tags: { broken: true } },
  ];
  const toDeclare = (dice: number[]) => {
    const { engine, state } = makeEngine({ startPhase: 'APh', hexMarkers: { yO5: { melee: true } }, dice, pieces });
    const s = act(engine, state, { type: 'endPhase' }).state;
    expect(s.phase).toBe('CCPh');
    return { engine, s };
  };

  it('the leader is offered an attack of his own, and his side is asked to declare', () => {
    const { engine, s } = toDeclare([6, 6]);
    expect(declarationOptions(engine.env(s), 'yO5', 'ge')).toEqual([{ attackers: ['gL'], targets: ['a1'] }]);
    // The Americans have nothing that can attack; the Germans are asked, not passed over.
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'ccDeclare', owner: 'ge' });
    expect(engine.legalActions(s, 'ge')).toContainEqual(expect.objectContaining({ type: 'cc.declare', attacks: [{ attackers: ['gL'], targets: ['a1'] }] }));
  });

  it('his kill ends the Melee, and in the next Player Turn the 8-1 moves like any Good Order unit', () => {
    // 1 FP against the HS's 3 is 1:3 (Kill 3): DR 2 eliminates it.
    const { engine, s: s0 } = toDeclare([1, 1]);
    const t = act(engine, s0, { type: 'cc.declare', attacks: [{ attackers: ['gL'], targets: ['a1'] }] });
    expect(t.state.pieces['a1']!.loc.kind).toBe('eliminated');
    let s = t.state;
    expect(s.hexMarkers['yO5']?.['melee']).toBeUndefined();
    s = playUntil(engine, s, (x) => x.attacker === 'ge' && x.phase === 'MPh');
    expect(s).toMatchObject({ attacker: 'ge', phase: 'MPh' });
    expect(s.ext['sk1.cc']).toBeUndefined();
    s = act(engine, s, { type: 'move.start', units: ['gL'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'yO6' }).state;
    expect(s.pieces['gL']!.loc).toEqual({ kind: 'hex', hex: 'yO6' });
  });
});

describe('a leader lends his DRM only to his own side, and only in Good Order (SK1 3.2.1, glossary)', () => {
  // SK1 3.2.1: "An unpinned, Good Order leader will apply his leadership DRM to other units ... in the target location
  // if he passes his MC unharmed, but not to himself." Glossary: "Good Order: An Infantry unit that is neither broken
  // nor marked with a Melee counter."
  // The American 7-4-7 in O5 fires 14 FP (Point Blank) at P5: the 12 column, DR 7 is a 2MC. The 9-1 checks first (DR 4), then the rest (DR 6).
  const checks = (pieces: PieceSpec[], melee: boolean) => {
    const { engine, state } = makeEngine({
      startPhase: 'PFPh',
      dice: [3, 4, 2, 2, 3, 3, 3, 3, 3, 3],
      ...(melee ? { hexMarkers: { yP5: { melee: true } } } : {}),
      pieces: [{ id: 'f1', def: 'am.747', side: 'am', hex: 'yO5' }, ...pieces],
    });
    const t = act(engine, state, { type: 'fire', decl: { units: ['f1'], sw: [], target: 'yP5' } });
    const out: Record<string, { drm: number; leader: boolean }> = {};
    for (const e of t.events) {
      if (e.type !== 'sk1.check') continue;
      const p = e.payload as { unit: string; drm: number; explain: { id: string }[] };
      out[p.unit] = { drm: p.drm, leader: p.explain.some((n) => n.id === 'mc.leader') };
    }
    return { out, state: t.state, engine };
  };

  it('in Melee he is not in Good Order: his DRM helps no one, friend or foe', () => {
    const { out } = checks(
      [
        { id: 'gL', def: 'ge.L91', side: 'ge', hex: 'yP5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5' },
        { id: 'aM', def: 'am.747', side: 'am', hex: 'yP5' },
      ],
      true,
    );
    expect(Object.keys(out).sort()).toEqual(['aM', 'g1', 'gL']);
    expect(out['g1']!.leader).toBe(false);
    expect(out['aM']!.leader).toBe(false);
  });

  it('out of Melee he lends to his own units only, never to an enemy unit in the hex', () => {
    // A Melee ended with the units of both sides broken (SK1 3.8): the German 9-1 is Good Order again.
    const { out } = checks(
      [
        { id: 'gL', def: 'ge.L91', side: 'ge', hex: 'yP5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5', tags: { broken: true } },
        { id: 'aB', def: 'am.747', side: 'am', hex: 'yP5', tags: { broken: true } },
      ],
      false,
    );
    expect(out['g1']).toMatchObject({ leader: true });
    expect(out['aB']).toMatchObject({ leader: false });
  });

  it('the units of both sides fire again normally in the next Player Turn, the Melee and its lending gone', () => {
    const { engine, state } = checks(
      [
        { id: 'gL', def: 'ge.L91', side: 'ge', hex: 'yP5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5', tags: { broken: true } },
        { id: 'aB', def: 'am.747', side: 'am', hex: 'yP5', tags: { broken: true } },
      ],
      false,
    );
    const s = playUntil(engine, state, (x) => x.attacker === 'ge' && x.phase === 'PFPh');
    expect(s).toMatchObject({ attacker: 'ge', phase: 'PFPh' });
    expect(engine.validate(s, { type: 'fire', decl: { units: ['gL'], sw: [], target: 'yO5' }, side: 'ge', decisionId: engine.currentDecision(s)!.id } as never)).not.toMatch(/Melee/);
  });
});

describe('the odds preview lends a leader’s DRM as the engine does (SK1 3.2.1, glossary Good Order)', () => {
  // A pinned leader lends nothing (SK1 3.2.1) but is otherwise the same leader, Leader Loss included; a 9-0 is a 9-1
  // without the DRM. Whatever one lends that the other does not shows in the odds of the units he lends to.
  const counters: Record<string, CounterDef> = { 'ge.L90': { ...COUNTERS['ge.L91']!, id: 'ge.L90', leadership: 0 } as CounterDef };
  const odds = (leader: PieceSpec, melee: boolean, broken = false) => {
    const { engine, state } = makeEngine({
      counters,
      ...(melee ? { hexMarkers: { yP5: { melee: true } } } : {}),
      pieces: [
        { id: 'f1', def: 'am.747', side: 'am', hex: 'yO5' },
        leader,
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5', tags: broken ? { broken: true } : {} },
        { id: 'aM', def: 'am.747', side: 'am', hex: 'yP5', tags: broken ? { broken: true } : {} },
      ],
    });
    const env = engine.env(state);
    const decl: FireDeclaration = { units: ['f1'], sw: [], target: 'yP5' };
    return shotOdds(env, buildAttack(env, decl, 'prep', 'am')).units;
  };
  const l91: PieceSpec = { id: 'gL', def: 'ge.L91', side: 'ge', hex: 'yP5' };
  const pinned: PieceSpec = { ...l91, tags: { pinned: true } };
  const l90: PieceSpec = { ...l91, def: 'ge.L90' };

  it('in Melee the leader is not in Good Order and lends nothing, to his own side or the enemy', () => {
    expect(odds(l91, true)['g1']).toEqual(odds(pinned, true)['g1']);
    expect(odds(l91, true)['aM']).toEqual(odds(l90, true)['aM']);
  });

  it('out of Melee he lends to his own side only', () => {
    const g1 = (l: PieceSpec) => odds(l, false, true)['g1']!;
    expect(g1(l91).elim + g1(l91).reduced).toBeLessThan(g1(pinned).elim + g1(pinned).reduced);
    expect(odds(l91, false, true)['aM']).toEqual(odds(l90, false, true)['aM']);
  });
});
