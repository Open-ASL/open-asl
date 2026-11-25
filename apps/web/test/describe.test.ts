import { describe, expect, it } from 'vitest';
import type { Action, Ctx, RuleModule } from '@asl/engine';
import { FP, japaneseModule, type FireDeclaration, type FireMode, type ResolveFireFn } from '@asl/rules';
import { RU_VS_GE, act, makeEngine } from '../../../packages/rules/test/fixtures';
import { ASL_TESTBED_SCENARIO, DEMO_VEHICLES_SCENARIO, fixtureActions, newGame, PLAYABLE_SCENARIOS } from '@asl/content';
import type { GameState } from '@asl/engine';
import { describeEvents, entryRoll, phaseSections, type LogLine } from '../src/game/describe';

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
  it('a phase header names the side the phase belongs to: the DEFENDER in the Defensive Fire Phase (SK1 3.4)', () => {
    const { engine, state } = makeEngine({ scenario: RU_VS_GE, pieces: [] });
    const env = engine.env(state);
    const head =(phase: string) => describeEvents(env, [{ seq: 1, type: 'turn.phaseStarted', payload: { phase, turn: 4, attacker: 'ru' } }] as never)[0]!;
    expect(head('DFPh').phase).toMatchObject({ turn: 4, side: 'ge', name: 'Defensive Fire Phase' });
    expect(head('DFPh').text).toBe('Turn 4 — German Defensive Fire Phase');
    for (const phase of ['RPh', 'PFPh', 'MPh', 'AFPh', 'RtPh', 'APh', 'CCPh']) expect(head(phase).phase!.side, phase).toBe('ru');
  });

  it('a Banzai Impulse gets a line where it begins as well as where it ends, so the steps read as Impulses (SK4 8.1.8.6)', () => {
    const { engine, state } = makeEngine({ scenario: RU_VS_GE, pieces: [] });
    const env = engine.env(state);
    const lines = describeEvents(env, [
      { seq: 1, type: 'sk4.banzai.impulse', payload: { impulse: 2, mf: 0, units: ['a', 'b'] } },
      { seq: 2, type: 'sk4.banzai.impulse', payload: { impulse: 2, mf: 2, units: ['a', 'b'] } },
    ] as never).map((l) => l.text);
    expect(lines[0]).toMatch(/Banzai Impulse 2: .* each move one hex, then the defender may fire/);
    expect(lines[1]).toMatch(/Impulse 2 over: every Banzai unit is charged 2 MF/);
  });

  it('a side that declares no CC attack in a hex gets a log line, once; a declared attack none (SK4 3.8: one side at a time vs a vehicle)', () => {
    const { engine, state } = makeEngine({ scenario: RU_VS_GE, pieces: [] });
    const env = engine.env(state);
    const cc = (seq: number, declared: Record<string, unknown[]>, hex = 'yK5') => ({ seq, type: 'sk1.cc.state', payload: { state: { hex, declared, pending: [] } } });
    const at = { attackers: ['a'], targets: ['b'] };
    const lines = describeEvents(env, [cc(1, {}), cc(2, { ge: [] }), cc(3, { ge: [], ru: [at] }), cc(4, {}, 'yL5'), cc(5, { ru: [at] }, 'yL5')] as never).map((l) => l.text);
    expect(lines).toEqual(['CC in yK5 (German): no attack declared']);
  });

  it('a rout step that drew Interdiction carries the LOS it was interdicted along, to be drawn like a shot\u2019s', () => {
    // Open Ground from N5 to the woods at L5; a German squad at P5 sees M5 (SK1 3.6).
    const { engine, state } = makeEngine({
      startPhase: 'RtPh',
      terrain: { yL5: { terrain: 'woods' } },
      dice: [3, 3, 3, 3],
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5', tags: { broken: true, dm: true } },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5' },
      ],
    });
    const t = act(engine, state, { type: 'rout.step', unit: 'a1', to: 'yM5' });
    const line = describeEvents(engine.env(t.state), t.events).find((l) => l.text.startsWith('Rout:'))!;
    expect(line.text).toMatch(/Interdiction by/);
    expect(line.los).toEqual({ from: ['yP5'], to: 'yM5' });
  });

  it('tells a Stun from a STUN by its case: a CE crew that fails its MC is Stunned, an original 12 STUNs it (SK4 7.7, 7.10; ASLRB D5.34)', () => {
    const { engine, state } = newGame(DEMO_VEHICLES_SCENARIO, 'stun', { los: 'grid' });
    const v = Object.values(state.pieces).find((p) => p.defId === 'am.M4A3')!;
    const line = (status: string, by: string) => describeEvents(engine.env(state), [{ seq: 1, type: 'sk3.vehicle.status', payload: { vehicle: v.id, status, by } }] as never)[0]!.text;
    expect(line('stun', 'fire on the CE crew: the CE crew failed its MC')).toMatch(/ is Stunned \(fire on the CE crew: the CE crew failed its MC\)$/);
    expect(line('STUN', 'fire on the CE crew: the CE crew rolled 12 on its MC')).toMatch(/ is STUNNED and Recalled \(/);
  });

  it('a To Kill line writes the stun the crew ends up with (SK4 7.10)', () => {
    const { engine, state } = newGame(DEMO_VEHICLES_SCENARIO, 'stun', { los: 'grid' });
    const v = Object.values(state.pieces).find((p) => p.defId === 'am.M4A3')!;
    const tk = (stunned?: string) =>
      describeEvents(engine.env(state), [{ seq: 1, type: 'sk3.toKill', payload: { weapon: v.id, target: v.id, ammo: 'AP', ch: false, location: 'hull', facing: 'rear', af: 3, tk: 6, modifiedTk: 7, finalTk: 4, dr: [2, 2], result: 'stun', ...(stunned ? { stunned } : {}) } }] as never)[0]!.text;
    expect(tk('stun')).toMatch(/→ Stun$/);
    expect(tk('STUN')).toMatch(/→ STUN$/);
    // A game recorded before the event carried the outcome reads as it did.
    expect(tk()).toMatch(/→ Stun$/);
  });

  it('a cowering attack shows the column it came to and the one it cowered to (SK1 3.2)', () => {
    const { engine, state } = makeEngine({ terrain, pieces: [{ id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' }, { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yO5' }] });
    const ev = { seq: 1, type: 'sk1.fire.attack', payload: { attack: { mode: 'first', target: 'yO5', parts: ['a1'] }, from: ['yN5'], fp: 10, column: 6, dr: [6, 6], drm: 1, cowered: true, explain: [] } };
    const lines = describeEvents(engine.env(state), [ev] as never).map((l) => l.text.trim());
    expect(lines[0]).toMatch(/: 10 FP → 8 column, cowers to the 6 column, DR /);
  });

  it('writes the strengths behind Close Combat odds, unit by unit (a pinned unit at half FP)', () => {
    const { engine, state } = makeEngine({
      terrain,
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yO5' },
        { id: 'a2', def: 'am.747', side: 'am', hex: 'yO5', tags: { pinned: true } },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yO5' },
      ],
    });
    // 4 + 2 (the pinned one, halved) = 6 against 4: 3:2.
    const ev = { seq: 1, type: 'sk1.cc.attack', payload: { hex: 'yO5', side: 'am', attack: { attackers: ['a1', 'a2'], targets: ['g1'] }, odds: '3:2', drm: 0, dr: 4, kill: 6, result: 'eliminated', fp: { attack: [['a1', 4], ['a2', 2]], defense: [['g1', 4]] } } };
    const lines = describeEvents(engine.env(state), [ev] as never).map((l) => l.text.trim());
    expect(lines[0]).toMatch(/^CC in yO5 \(American\): American 7²-4-7 4 \+ American 7²-4-7 2 \[pinned: FP halved\] = 6 vs German 4¹-6-7 4 → 3:2, DR /);
    // The note the attack recorded stands after the Pin has come off (end of the Player Turn): a2 is no longer pinned.
    const later = { ...ev, payload: { ...ev.payload, fp: { ...ev.payload.fp, notes: { a2: 'pinned: FP halved' } } } };
    const unpinned = { ...state, pieces: { ...state.pieces, a2: { ...state.pieces['a2']!, tags: {} } } };
    expect(describeEvents(engine.env(unpinned), [later] as never)[0]!.text).toMatch(/7²-4-7 2 \[pinned: FP halved\] = 6 vs German 4¹-6-7 4 →/);
    // A pinned defender keeps its full FP (ASLRB A7.8): no note on it.
    const vsPinned = { seq: 2, type: 'sk1.cc.attack', payload: { hex: 'yO5', side: 'ge', attack: { attackers: ['g1'], targets: ['a2'] }, odds: '1:1', drm: 0, dr: 9, kill: 5, result: 'no effect', fp: { attack: [['g1', 4]], defense: [['a2', 7]] } } };
    expect(describeEvents(engine.env(state), [vsPinned] as never)[0]!.text).toMatch(/German 4¹-6-7 4 vs American 7²-4-7 7 → 1:1/);
  });

  it('gives the Area Fire figure against concealed units beside the attack\u2019s own, without naming them (SK4 8.3.2)', () => {
    const { engine, state } = makeEngine({ terrain, pieces: [{ id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' }, { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yO5' }] });
    const ev = { seq: 1, type: 'sk1.fire.attack', payload: { attack: { mode: 'advancing', target: 'yO5', parts: ['a1'] }, from: ['yN5'], fp: 4.5, column: 4, area: { targets: ['g1'], fp: 3, column: 2, fpExplain: [{ id: 'x', label: '½ Area Fire (concealed target)' }] }, dr: [4, 4], drm: 0, cowered: false, explain: [] } };
    const line = describeEvents(engine.env(state), [ev] as never)[0]!;
    expect(line.text).toMatch(/: 4\.5 FP → 4 column; vs the concealed unit, Area Fire: 3 FP → 2 column, DR /);
    expect(line.detail).toMatch(/Area Fire FP: ½ Area Fire \(concealed target\)/);
  });

  it('writes the Ambush drs of a new CC with every part of their drm, even parts that cancel out (SK1 3.8; SK4 8.3.2)', () => {
    const { engine, state } = makeEngine({
      scenario: { firstSide: 'ja', sides: [{ side: 'am', name: 'American', nationality: 'am', elr: 5 }, { side: 'ja', name: 'Japanese', nationality: 'ja', elr: 3 }] },
      extra: [japaneseModule],
      pieces: [],
    });
    const ambush = {
      rolls: [
        { side: 'ja', dr: 1, drm: 0, final: 1, notes: ['-1 Elite/1st Line Japanese', '+1 ATTACKER in jungle/kunai/bamboo'] },
        { side: 'am', dr: 3, drm: -2, final: 1, notes: ['-2 concealed'] },
      ],
      ambusher: null,
    };
    const ev = { seq: 1, type: 'sk1.cc.state', payload: { state: { pending: [], declared: {}, hex: 'yO5', ambusher: null, step: 'simultaneous-attacker' }, ambush } };
    const lines = describeEvents(engine.env(state), [ev] as never).map((l) => l.text.trim());
    expect(lines).toEqual(['Ambush dr in O5: Japanese 1 (-1 Elite/1st Line Japanese, +1 ATTACKER in jungle/kunai/bamboo) = 1, American 3 (-2 concealed) = 1 → no ambush']);
    // A cc.state with no Ambush drs (every later step of the hex) writes nothing.
    expect(describeEvents(engine.env(state), [{ ...ev, payload: { state: ev.payload.state } }] as never)).toEqual([]);
  });

  it('says why a CC strength is not the printed FP, where a rule changes it (`cc.fpNote`)', () => {
    // A rule that changes a unit's CC strength names itself in the log; none in the Starter Kit does, so a test one.
    const doubled: RuleModule = { id: 'test.cc-note', install: (r) => r.contribute({ id: 'test.cc-note', query: 'cc.fpNote', apply: (v, { unit }) => v ?? (unit === 'r' ? 'doubled (test rule)' : null) }) };
    const { engine, state } = makeEngine({
      scenario: { firstSide: 'ja', sides: [{ side: 'am', name: 'American', nationality: 'am', elr: 5 }, { side: 'ja', name: 'Japanese', nationality: 'ja', elr: 3 }] },
      extra: [japaneseModule, doubled],
      pieces: [
        { id: 'r', def: 'ja.347r', side: 'ja', hex: 'yO5' },
        { id: 'm', def: 'am.768', side: 'am', hex: 'yO5' },
      ],
    });
    const ev = { seq: 1, type: 'sk1.cc.attack', payload: { hex: 'yO5', side: 'ja', attack: { attackers: ['r'], targets: ['m'] }, odds: '1:1', drm: -1, dr: 7, kill: 6, result: 'no effect', fp: { attack: [['r', 6]], defense: [['m', 7]] } } };
    const line = describeEvents(engine.env(state), [ev] as never)[0]!.text;
    expect(line).toMatch(/3.?-4-7 6 \[doubled \(test rule\)\] vs .*7 → 1:1/);
  });

  it('says how much Residual FP an attack left and why (ASLRB A8.26: one column less per point of DRM from outside the hex)', () => {
    const { engine, state } = makeEngine({
      terrain,
      extra: [testFire],
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'g1', def: 'ge.447', side: 'ge', hex: 'yP5' },
      ],
      // 7 FP on the 6 column through the O5 orchard (+1 Hindrance, outside the target hex) into the P5 building (+3 TEM).
      dice: [6, 5],
    });
    const t = act(engine, state, { type: 'test.fire', mode: 'first', decl: { units: ['a1'], sw: [], target: 'yP5' } });
    const lines = describeEvents(engine.env(t.state), t.events).map((l) => l.text.trim());
    expect(lines).toContainEqual('Residual FP 1 left in P5 (half the 6 column: 2, −1 column for +1 DRM from outside the hex)');
  });

  it('writes a Random Selection as one line, round by round: ties rolled again, and who was selected (ASLRB A.9)', () => {
    const { engine, state } = makeEngine({
      terrain,
      pieces: [
        { id: 'h1', def: 'ge.447', side: 'ge', hex: 'yP5' },
        { id: 'h2', def: 'ge.467', side: 'ge', hex: 'yP5' },
        { id: 'l1', def: 'ge.L91', side: 'ge', hex: 'yP5' },
      ],
    });
    const roll = (seq: number, id: string, v: number) => ({ seq, type: 'dice.rolled', payload: { label: `KIA result: random selection (${id})`, dice: [v] } });
    // 1KIA on three units: 6, 4, 6 ties h1 and the leader; they roll 2, 2 (a tie again), then 1, 3: the leader.
    const events = [roll(1, 'h1', 6), roll(2, 'h2', 4), roll(3, 'l1', 6), roll(4, 'h1', 2), roll(5, 'l1', 2), roll(6, 'h1', 1), roll(7, 'l1', 3)];
    const lines = describeEvents(engine.env(state), events as never).map((l) => l.text.trim());
    expect(lines).toEqual([
      'KIA result, Random Selection (highest dr): German 4-4-7 6, German 4¹-6-7 4, German 9-1 leader 6 · tie, re-roll: German 4-4-7 2, German 9-1 leader 2 · tie, re-roll: German 4-4-7 1, German 9-1 leader 3 → German 9-1 leader',
    ]);
    // 2KIA: a clean first pick, then the next one among the rest.
    const two = describeEvents(engine.env(state), [roll(1, 'h1', 5), roll(2, 'h2', 2), roll(3, 'l1', 1), roll(4, 'h2', 4), roll(5, 'l1', 6)] as never).map((l) => l.text.trim());
    expect(two).toEqual(['KIA result, Random Selection (highest dr): German 4-4-7 5, German 4¹-6-7 2, German 9-1 leader 1 · next: German 4¹-6-7 4, German 9-1 leader 6 → German 4-4-7, German 9-1 leader']);
  });

  it('reads a 2KIA whose picks both tie: each round is the tied units or the units left, not split where a unit repeats', () => {
    const { engine, state } = makeEngine({
      terrain,
      pieces: [
        { id: 'h1', def: 'ge.447', side: 'ge', hex: 'yP5' },
        { id: 'h2', def: 'ge.467', side: 'ge', hex: 'yP5' },
        { id: 'l1', def: 'ge.L91', side: 'ge', hex: 'yP5' },
      ],
    });
    const roll = (seq: number, id: string, v: number) => ({ seq, type: 'dice.rolled', payload: { label: `KIA result: random selection (${id})`, dice: [v] } });
    // 4, 3, 4 ties h1 and the leader; 6, 1 picks h1. Then h2 and the leader: 4, 4 a tie; 4, 3 picks h2.
    const seq: [string, number][] = [['h1', 4], ['h2', 3], ['l1', 4], ['h1', 6], ['l1', 1], ['h2', 4], ['l1', 4], ['h2', 4], ['l1', 3]];
    const events = seq.map(([id, v], i) => roll(i + 1, id, v));
    const lines = describeEvents(engine.env(state), events as never).map((l) => l.text.trim());
    expect(lines).toEqual([
      'KIA result, Random Selection (highest dr): German 4-4-7 4, German 4¹-6-7 3, German 9-1 leader 4 · tie, re-roll: German 4-4-7 6, German 9-1 leader 1 · next: German 4¹-6-7 4, German 9-1 leader 4 · tie, re-roll: German 4¹-6-7 4, German 9-1 leader 3 → German 4-4-7, German 4¹-6-7',
    ]);
    // The log is written again as each dr is revealed: every prefix of the rolls reads without error.
    for (let k = 1; k <= events.length; k++) expect(() => describeEvents(engine.env(state), events.slice(0, k) as never)).not.toThrow();
  });

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
    // The check event keeps only the total; the dice come from its roll, colored die (2) first.
    expect(lines).toContainEqual(expect.stringMatching(/^PTC German 4-4-7: DR 2\+1=3 → 3 vs 7 — passed$/));
  });

  it('does not call a Crew Exposed crew’s PTC "no effect" when the crew then takes it (SK4 7.7)', () => {
    const { engine, state } = makeEngine({ terrain, pieces: [{ id: 'v', def: 'ge.pzivf2', side: 'ge', hex: 'yP5', tags: { ce: true } }] });
    const events = [
      { seq: 1, type: 'sk1.fire.result', payload: { unit: 'v', result: { kind: 'PTC' }, finalDr: 8, drm: 2, explain: [{ id: 'sk3.ce', label: '+2 Crew Exposed' }] } },
      { seq: 2, type: 'sk3.vehicle.check', payload: { vehicle: 'v', kind: 'PTC', dr: [1, 1], morale: 8, passed: true, reason: 'fire on the CE crew' } },
    ];
    const lines = describeEvents(engine.env(state), events as never).map((l) => l.text.trim());
    expect(lines.some((l) => l.includes('PTC (final DR 8'))).toBe(true);
    expect(lines.filter((l) => /no effect: already pinned/.test(l))).toEqual([]);
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
    expect(lines).toContainEqual(expect.stringMatching(/^MC German 4.?-6-7: DR 5\+6=11 → 11 vs 7 — broken$/));
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
    expect(fire.text).toContain('DR 3+3=6, DRM +3');
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

  it('says a Defensive First Fire hit by Intensive Fire leaves no Residual FP, where no counter appears (SK4 3.3.5)', async () => {
    const { sk2CoreModules } = await import('@asl/rules');
    const { GE_VS_BR } = await import('../../../packages/rules/test/fixtures');
    const { engine, state } = makeEngine({
      scenario: GE_VS_BR,
      extra: sk2CoreModules,
      pieces: [
        { id: 'c1', def: 'ge.228c', side: 'ge', hex: 'yK5' },
        { id: 'g75', def: 'ge.AT75L', side: 'ge', heldBy: 'c1', tags: { ca: 1 } },
      ],
    });
    const shot = (mode: string, outcome: string, intensive: boolean) => ({ seq: 1, type: 'sk2.ordnance.shot', payload: { weapon: 'g75', from: 'yK5', target: 'yM5', targetType: 'ITT', ammo: 'HE', range: 2, th: 8, dr: [2, 1], drm: 0, mode, outcome, intensive } });
    const rof = (why: string) => ({ seq: 2, type: 'sk2.ordnance.rof', payload: { weapon: 'g75', colored: 1, rof: 1, kept: false, why } });
    const rofLine = (events: unknown[]) => describeEvents(engine.env(state), events as never).map((l) => l.text.trim()).find((l) => /loses ROF/.test(l));
    expect(rofLine([shot('subsequentFirst', 'hit', true), rof('intensive')])).toBe('German 75L AT Gun loses ROF: Intensive Fire never retains ROF; no Residual FP (Intensive Fire leaves none)');
    // Prep Fire never leaves Residual FP, and a miss has nothing to leave: no word of it.
    expect(rofLine([shot('prep', 'hit', true), rof('intensive')])).toBe('German 75L AT Gun loses ROF: Intensive Fire never retains ROF');
    expect(rofLine([shot('first', 'miss', true), rof('intensive')])).toBe('German 75L AT Gun loses ROF: Intensive Fire never retains ROF');
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

describe('phaseSections', () => {
  it('puts phases and entries oldest first, each entry opening on its first line, its results after it', () => {
    const l = (seq: number, kind: LogLine['kind'], text: string): LogLine => ({ seq, kind, text });
    const out = phaseSections([
      l(1, 'phase', 'Turn 5 — German Movement Phase'),
      l(2, 'fire', 'Defensive First Fire on R7: ...'),
      l(3, 'fire', '  German 5-4-8: no effect'),
      l(4, 'fire', 'FPF on R7: ...'),
      l(5, 'check', '  FPF NMC on firer American 3-3-7: ...'),
      l(6, 'phase', 'Turn 5 — German Defensive Fire Phase'),
    ]);
    expect(out.map((s) => s.head?.seq)).toEqual([1, 6]);
    expect(out[0]!.lines.map((x) => x.seq)).toEqual([2, 3, 4, 5]);
    expect(out[0]!.lines.filter((x) => x.opens).map((x) => x.seq)).toEqual([2, 4]);
  });

  it('gives each phase its own section, oldest first, and keeps a phase where nothing happened', () => {
    const l = (seq: number, kind: LogLine['kind'], text: string): LogLine => ({ seq, kind, text });
    const out = phaseSections([
      l(1, 'info', 'German secretly designated 2 fortified buildings (SSR)'),
      l(2, 'phase', 'Turn 1 — German Rally Phase'),
      l(3, 'phase', 'Turn 1 — German Prep Fire Phase'),
      l(4, 'fire', 'Prep Fire on R7: ...'),
      l(5, 'fire', '  American 6-6-6: no effect'),
    ]);
    expect(out.map((s) => s.head?.seq ?? null)).toEqual([null, 2, 3]);
    expect(out.map((s) => s.lines.map((x) => x.seq))).toEqual([[1], [], [4, 5]]);
  });
});

describe('provisional reinforcements', () => {
  it('reads an entry dr against what it needed, for both forms of the rule', () => {
    expect(entryRoll('Ad hoc shock group: entry dr (needs < 3)', 2)).toEqual({ force: 'Ad hoc shock group', need: '< 3', enters: true });
    expect(entryRoll('Ad hoc shock group: entry dr (needs < 3)', 3)).toMatchObject({ enters: false });
    expect(entryRoll('Battle group: entry dr (needs ≤ 2)', 2)).toMatchObject({ need: '≤ 2', enters: true });
    expect(entryRoll('Smoke placement dr', 2)).toBeNull();
  });

  it('logs each entry dr of a force that enters "on a dr < twice the Turn number", and whether it enters', () => {
    const sc = PLAYABLE_SCENARIOS.find((s) => s.id === 'lma-7')!;
    const outcomes = new Set<boolean>();
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const { engine, state } = newGame(sc, seed, { los: 'grid' });
      let s: GameState = state;
      for (let i = 0; i < 40; i++) {
        const d = engine.currentDecision(s)!;
        const acts = engine.legalActions(s, d.owner);
        const t = engine.submit(s, acts.find((x) => x.type === 'endPhase') ?? acts.find((x) => /setup|pass|done/i.test(x.type)) ?? acts[0]!);
        const roll = t.events.find((e) => e.type === 'dice.rolled' && / entry dr /.test((e.payload as { label: string }).label));
        s = t.state;
        if (!roll) continue;
        const line = describeEvents(engine.env(s), t.events).find((l) => l.text.includes('entry dr'))!;
        const due = Object.values(s.pieces).some((p) => p.tags['entryRoll'] === 'drBelowTurnTimes' && p.tags['entryTurn'] === s.turn);
        expect(line.text).toBe(`Reinforcements: entry dr ${(roll.payload as { dice: number[] }).dice[0]} (needs < ${2 * s.turn}) → ${due ? 'enters this turn' : 'does not enter this turn'}`);
        outcomes.add(due);
        break;
      }
    }
    // The seeds cover a roll that brings the force on and one that does not.
    expect([...outcomes].sort()).toEqual([false, true]);
  });
});

describe('rout steps in the log', () => {
  const setup = (g1 = 'yP5') =>
    makeEngine({
      startPhase: 'RtPh',
      terrain: { yL5: { terrain: 'woods' } },
      // The Interdiction NMC in M5: DR 3, passed.
      dice: [2, 1],
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5', tags: { broken: true, dm: true } },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: g1 },
      ],
    });
  const step = (engine: ReturnType<typeof setup>['engine'], s: GameState, to: string, lowCrawl = false) =>
    act(engine, s, engine.legalActions(s, 'am').find((a) => a.type === 'rout.step' && a['to'] === to && !!a['lowCrawl'] === lowCrawl)!);
  const lines = (engine: ReturnType<typeof setup>['engine'], t: { state: GameState; events: Parameters<typeof describeEvents>[1] }) => describeEvents(engine.env(t.state), t.events).filter((l) => l.kind !== 'phase').map((l) => l.text);

  it('says of each hex whether it was a Low Crawl, and whether it drew Interdiction or why not (SK1 3.6)', () => {
    const { engine, state } = setup();
    const t1 = step(engine, state, 'yM5');
    expect(lines(engine, t1)).toEqual(['Rout: American 7²-4-7 to M5 · Interdiction by German 4¹-6-7', expect.stringMatching(/^ {2}Interdiction: American 7²-4-7 entering M5 — NMC, DR 1\+2=3 vs broken morale 7 → passed$/)]);
    expect(lines(engine, step(engine, t1.state, 'yL5'))).toEqual(['Rout: American 7²-4-7 to L5 · no Interdiction (not Open Ground)']);
    expect(lines(engine, step(engine, state, 'yM5', true))).toEqual(['Low Crawl: American 7²-4-7 to M5 · no Interdiction (Low Crawl)']);
    const far = setup('yA1');
    expect(lines(far.engine, step(far.engine, far.state, 'yO5'))).toEqual(['Rout: American 7²-4-7 to O5 · no Interdiction (no enemy able to interdict)']);
  });
});

describe('fortification counters in the log (full ASL A12.33, B28.45, B28.47)', () => {
  /** The test bed with its counters down and the Russians set up: the placement and the Secret dr events among the log. */
  function placed() {
    const g = newGame(ASL_TESTBED_SCENARIO, 'describe-forts');
    let state = g.state;
    // The Secret dr is rolled as the game is created, before any action.
    const events: unknown[] = [...g.events];
    for (const a of fixtureActions(g.engine, g.state, 'fort-placed')) {
      const t = g.engine.submit(state, a);
      state = t.state;
      events.push(...t.events);
    }
    return { env: g.engine.env(state), events: events as never };
  }
  it("the other side reads of the open counters only, the Known and Dummy minefields alike and without strength, and never of the Secret dr", () => {
    const { env, events } = placed();
    const german = describeEvents(env, events, 'ge').map((l) => l.text).filter((t) => /fortification|Minefield|minefield|Dummy/i.test(t));
    expect(german).toHaveLength(1);
    const line = german[0]!;
    expect(line).toMatch(/placed 11 fortification counters/);
    for (const open of ['trench O7', 'trench P6', 'Wire P9', 'minefield N9', 'minefield N10', 'foxhole 1S O10']) expect(line).toContain(open);
    expect(line).toMatch(/5 hidden or recorded/);
    for (const secret of ['O6', 'O4', 'P10', 'O9', 'O3', 'Dummy', 'Known', 'A-P', 'A-T', 'Secret dr', 'hidden)']) expect(line, secret).not.toContain(secret);
  });
  it('a HE KIA Breach of an unrevealed fortified Location is told to its owner only, and only where it Breached (B23.911, B23.9221)', () => {
    const { env } = placed();
    const breach = { type: 'asl.breach.he', payload: { loc: 'uP3', toward: 'uQ3', breached: true }, seq: 9002 };
    const none = { type: 'asl.breach.he', payload: { loc: 'uP3', toward: 'uQ3', breached: false }, seq: 9003 };
    const text = (viewer: string) => describeEvents(env, [breach, none] as never, viewer).map((l) => l.text).join('\n');
    expect(text('ge')).toBe('');
    expect(text('ru')).toMatch(/Breach: the P3\/Q3 hexside is open \(a HE KIA\)/);
    expect(text('ru').match(/Breach/g)).toHaveLength(1);
  });
  it('a DC Breach attempt reads alike short of a Breach; a Breach DR against a Location that is not fortified says so (B23.9221)', () => {
    const { env } = placed();
    const base = { dc: 'x', loc: 'uP3', toward: 'uQ3', dr: [5, 5], drm: 4, result: 'PTC', breached: false, malfunctioned: false };
    const line = (payload: Record<string, unknown>) => describeEvents(env, [{ type: 'asl.breach.attempt', payload, seq: 9004 }] as never, 'ge').map((l) => l.text).join('\n');
    expect(line(base)).toMatch(/Breach attempt on the P3\/Q3 hexside: DR .* \+4 — PTC: the wall holds/);
    expect(line({ ...base, dr: [3, 3], result: 'NMC', unfortified: true })).toMatch(/no Breach: P3 is not a Fortified Building Location, and the DC attacks only as Area Fire \(ASLRB B23.9221\)/);
  });
  it('a move beneath a hidden foxhole is told to its owner only (A12.33)', () => {
    const { env } = placed();
    const ru = Object.values(env.state.pieces).find((p) => p.side === 'ru' && p.loc.kind === 'hex' && p.loc.hex === 'uO6')!;
    const move = { type: 'asl.entrench.move', payload: { units: [ru.id], hex: 'uO6', beneath: true, mf: 0, phase: 'MPh' }, seq: 9001 };
    expect(describeEvents(env, [move] as never, 'ge')).toEqual([]);
    expect(describeEvents(env, [move] as never, 'ru').map((l) => l.text).join('\n')).toMatch(/go beneath the entrenchment in O6/);
  });
  it('a secret roll is never taken for another side’s DR in the log', () => {
    const { env } = placed();
    const roll = { type: 'dice.rolled', payload: { label: 'ru: test', dice: [3, 4], secret: 'ru' }, seq: 9001 };
    const unit = Object.values(env.state.pieces).find((p) => p.side === 'ru' && p.loc.kind === 'hex')!.id;
    const nmc = { type: 'ssr.onceDr.nmc', payload: { unit, dr: 7, final: 7, morale: 7, failed: false, rule: 'SSR' }, seq: 9002 };
    const line = (viewer: string) => describeEvents(env, [roll, nmc] as never, viewer).find((l) => l.text.includes('NMC'))!.text;
    expect(line('ru')).toContain('DR 4+3=7');
    expect(line('ge')).toContain('DR 7 ');
  });
  it('the 0-MF moves out of and back beneath a hidden foxhole are in the owner\'s log only (A12.33)', () => {
    const g = newGame(ASL_TESTBED_SCENARIO, 'describe-foxhole');
    let state = g.state;
    const events: unknown[] = [...g.events];
    const submit = (a: Record<string, unknown>) => {
      const d = g.engine.currentDecision(state)!;
      const t = g.engine.submit(state, { ...a, side: d.owner, decisionId: d.id } as never);
      state = t.state;
      events.push(...t.events);
    };
    for (const a of fixtureActions(g.engine, g.state, 'foxhole-hidden')) submit(a);
    submit({ type: 'endPhase' });
    const sq = Object.values(state.pieces).find((p) => p.loc.kind === 'hex' && p.loc.hex === 'uC2')!.id;
    submit({ type: 'move.start', units: [sq] });
    submit({ type: 'move.entrenchment', beneath: false });
    submit({ type: 'move.entrenchment', beneath: true });
    const env = g.engine.env(state);
    const lines = (viewer: string) => describeEvents(env, events as never, viewer).map((l) => l.text).filter((t) => /entrenchment|foxhole/i.test(t));
    expect(lines('ge')).toEqual([]);
    expect(lines('ru').filter((t) => /climb out of|go beneath/.test(t))).toHaveLength(2);
  });
  it('the owner reads every counter, its strength and the Secret dr', () => {
    const { env, events } = placed();
    const russian = describeEvents(env, events, 'ru').map((l) => l.text);
    const line = russian.find((t) => /Russian placed:/.test(t))!;
    for (const s of ['foxhole 2S O6 (hidden)', 'minefield (A-P 8 + A-T 1) P10 (recorded)', 'Known minefield (A-P 6) N9', 'Dummy minefield N10', 'roadblock O9 (hidden)', 'pillbox 1+3+5 O3 (hidden)', 'Wire O4 (hidden)']) expect(line, s).toContain(s);
    expect(russian.some((t) => /Dummy Minefield Secret dr/.test(t))).toBe(true);
  });
  it('an Acquired Target counter coming off is logged, with the cause when its possessor fired its own FP (SK4 6.10, ASLRB C6.5)', () => {
    const { engine, state } = makeEngine({
      scenario: RU_VS_GE,
      pieces: [
        { id: 'sq', def: 'ge.467', side: 'ge', hex: 'yK5' },
        { id: 'mtr', def: 'ge.MTR', side: 'ge', heldBy: 'sq' },
      ],
    });
    const env = engine.env(state);
    const fire = { seq: 1, type: 'sk1.fire.attack', payload: { attack: { mode: 'prep', target: 'yK8', parts: ['sq'] }, from: ['yK5'], fp: 4, column: 4, dr: [5, 4], drm: 0, explain: [] } };
    const lost = (seq: number) => ({ seq, type: 'piece.tagged', payload: { id: 'mtr', tags: { acq: null, acqHex: null, acqUnits: null, acqLevel: null } } });
    const text = (events: unknown[]) => describeEvents(env, events as never).map((l) => l.text);
    const lines = text([fire, lost(2)]).filter((t) => /Acquired Target/.test(t));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/◎ .+ loses its Acquired Target counter \(its possessor fired its own FP, SK4 6\.10\)$/);
    expect(text([lost(2)])[0]).toMatch(/loses its Acquired Target counter$/);
    // A shot at a new target clears the old counter and places a new one: only the new one is logged.
    const reacquired = { seq: 3, type: 'piece.tagged', payload: { id: 'mtr', tags: { acq: 'ATT', acqHex: 'yK8', acqUnits: '', acqLevel: 1 } } };
    expect(text([lost(2), reacquired]).some((t) => /loses its Acquired Target/.test(t))).toBe(false);
  });
});
