import { describe, expect, it } from 'vitest';
import type { Action, Ctx, Engine, GameState, RuleModule } from '@asl/engine';
import {
  FP,
  acquisitionsAt,
  inCoveredArc,
  nearestSpine,
  sk2CoreModules,
  statics,
  type FireDeclaration,
  type FireMode,
  type ResolveFireFn,
} from '../src';
import { GE_VS_BR, act, makeEngine } from './fixtures';

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
const extra = [...sk2CoreModules, testFire];
const settle = (engine: Engine, state: GameState) => {
  let s = state;
  while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
  return s;
};
/** The spine a Gun in `gunHex` must point at to cover `target` (the current one if it already does). */
function spineFor(engine: Engine, state: GameState, gunHex: string, target: string, current = 0): number {
  const map = statics(engine.env(state)).map;
  if (inCoveredArc(map.hex(gunHex)!.cube, current, map.hex(target)!.cube)) return current;
  return nearestSpine(map.hex(gunHex)!.cube, current, map.hex(target)!.cube)!;
}
const shots = (events: { type: string; payload: unknown }[]) => events.filter((e) => e.type === 'sk2.ordnance.shot').map((e) => e.payload as Record<string, unknown>);

describe('To Hit Example #1 (SK4 3.2.4): an 88mm AA Gun on the Infantry Target Type', () => {
  // Gun in K5 facing O5 four hexes east; grain in M5 on the thread (+1), the target in woods (+1).
  const terrain = { yM5: { terrain: 'grain' }, yO5: { terrain: 'woods' }, yM3: { terrain: 'grain' } };
  const pieces = (ca: number) => [
    { id: 'c1', def: 'ge.228c', side: 'ge', hex: 'yK5' },
    { id: 'g88', def: 'ge.AA88L', side: 'ge', heldBy: 'c1', tags: { ca } },
    { id: 'b1', def: 'br.457', side: 'br', hex: 'yO5' },
    { id: 'b2', def: 'br.457', side: 'br', hex: 'yM3' },
  ];
  it('misses, acquires, keeps ROF, hits on the 16 column, turns with +1, then fires Intensive', () => {
    const probe = makeEngine({ scenario: GE_VS_BR, extra, terrain, pieces: pieces(0) });
    const ca = spineFor(probe.engine, probe.state, 'yK5', 'yO5');
    const { engine, state } = makeEngine({
      scenario: GE_VS_BR,
      extra,
      terrain,
      // Shot 1: 6+1 = 7, +2 → 9 > 8 misses. Shot 2: 2+1 = 3, +1 → 4 hits; the IFT DR 4+3. Shot 3 (turned
      // one hexspine, +1): 3+5 = 8, +1 → 9 > 8 misses, ROF lost. Intensive: 6+2 = 8, +2 -1 → 9 misses.
      // (The fixture IFT makes the hit a K/1: the reduced squad's MC takes 3+5 first.)
      dice: [6, 1, 2, 1, 4, 3, 3, 5, 3, 5, 6, 2],
      pieces: pieces(ca),
    });
    let t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'g88', target: 'yO5', targetType: 'ITT' } });
    let [shot] = shots(t.events);
    expect(shot).toMatchObject({ th: 8, red: false, ch: 3, dr: [6, 1], drm: 2, outcome: 'miss', range: 4 });
    expect((shot!['explain'] as { label: string }[]).map((n) => n.label)).toEqual(['+1 TEM (Woods)', '+1 LOS Hindrance']);
    expect(t.state.pieces['g88']!.tags).toMatchObject({ acq: 'ITT', acqHex: 'yO5', acqUnits: 'b1', acqLevel: 1 });
    expect(t.state.pieces['g88']!.tags['fire']).toBeUndefined();
    expect(t.events.find((e) => e.type === 'sk2.ordnance.rof')!.payload).toMatchObject({ colored: 1, rof: 2, kept: true });

    t = act(engine, t.state, { type: 'fire.ordnance', shot: { weapon: 'g88', target: 'yO5', targetType: 'ITT' } });
    [shot] = shots(t.events);
    expect(shot).toMatchObject({ dr: [2, 1], drm: 1, outcome: 'hit' });
    expect((shot!['explain'] as { label: string }[]).map((n) => n.label)).toContain('-1 Acquired Target');
    expect(t.events.find((e) => e.type === 'sk2.ordnance.hit')!.payload).toMatchObject({ column: 16, ch: false, dr: [4, 3], drm: 0 });
    expect(t.events.some((e) => e.type === 'sk1.fire.result' && (e.payload as { unit: string }).unit === 'b1')).toBe(true);
    expect(t.state.pieces['g88']!.tags).toMatchObject({ acq: 'ITT', acqHex: 'yO5', acqUnits: 'b1', acqLevel: 2 });

    // A new target outside the arc: turn one hexspine (360° mount: +1), grain hindrance +1, no acquisition.
    const ca2 = spineFor(engine, t.state, 'yK5', 'yM3', ca);
    expect(ca2).not.toBe(ca);
    t = act(engine, t.state, { type: 'fire.ordnance', shot: { weapon: 'g88', target: 'yM3', targetType: 'ITT', ca: ca2 } });
    [shot] = shots(t.events);
    expect(shot).toMatchObject({ range: 3, th: 8, outcome: 'miss', caChange: 1 });
    expect((shot!['explain'] as { label: string }[]).map((n) => n.label)).toEqual(['+1 Covered Arc change (1 hexspine, 360° mount)']);
    expect(t.state.pieces['g88']!.tags).toMatchObject({ ca: ca2, acq: 'ITT', acqHex: 'yM3', acqUnits: 'b2', acqLevel: 1, fire: 'prep' });
    expect(t.events.find((e) => e.type === 'sk2.ordnance.rof')!.payload).toMatchObject({ colored: 5, kept: false, why: 'exceeded' });

    // Having lost ROF, Intensive Fire once (+2 and the acquisition), then nothing more this Player Turn.
    expect(() => act(engine, t.state, { type: 'fire.ordnance', shot: { weapon: 'g88', target: 'yM3', targetType: 'ITT' } })).toThrow(/already fired/);
    t = act(engine, t.state, { type: 'fire.ordnance', shot: { weapon: 'g88', target: 'yM3', targetType: 'ITT', intensive: true } });
    [shot] = shots(t.events);
    expect(shot).toMatchObject({ dr: [6, 2], drm: 1, outcome: 'miss', intensive: true });
    expect((shot!['explain'] as { label: string }[]).map((n) => n.label)).toEqual(['+2 Intensive Fire', '-1 Acquired Target']);
    expect(t.state.pieces['g88']!.tags).toMatchObject({ intensive: true, acqLevel: 2 });
    expect(() => act(engine, t.state, { type: 'fire.ordnance', shot: { weapon: 'g88', target: 'yM3', targetType: 'ITT', intensive: true } })).toThrow(/Intensive Fire this Player Turn/);
  });
});

describe('To Hit Example #2 (SK4 3.2.4): a 75mm AT Gun, Non-Turreted', () => {
  const terrain = { yM5: { terrain: 'building-stone' }, yL3: { terrain: 'woods' } };
  it('puts the stone TEM on the To Hit DR, not the IFT; a NT turn costs +3 and one ROF', () => {
    const probe = makeEngine({ scenario: GE_VS_BR, extra, terrain, pieces: [{ id: 'x', def: 'ge.467', side: 'ge', hex: 'yK5' }] });
    const ca = spineFor(probe.engine, probe.state, 'yK5', 'yM5');
    const { engine, state } = makeEngine({
      scenario: GE_VS_BR,
      extra,
      terrain,
      // 6+1 = 7, +3 → 10 misses; 5+2 = 7, +2 → 9 hits (IFT 4+3 with no DRM, a 2MC the squad passes on 2+3);
      // turned: 2+2 = 4, +4 → 8 hits, ROF 1 < colored 2.
      dice: [6, 1, 5, 2, 4, 3, 2, 3, 2, 2, 3, 3],
      pieces: [
        { id: 'c1', def: 'ge.228c', side: 'ge', hex: 'yK5' },
        { id: 'g75', def: 'ge.AT75L', side: 'ge', heldBy: 'c1', tags: { ca } },
        { id: 'b1', def: 'br.457', side: 'br', hex: 'yM5' },
        { id: 'b2', def: 'br.457', side: 'br', hex: 'yL3' },
      ],
    });
    let t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'g75', target: 'yM5', targetType: 'ITT' } });
    expect(shots(t.events)[0]).toMatchObject({ range: 2, th: 9, drm: 3, outcome: 'miss' });
    t = act(engine, t.state, { type: 'fire.ordnance', shot: { weapon: 'g75', target: 'yM5', targetType: 'ITT' } });
    expect(shots(t.events)[0]).toMatchObject({ drm: 2, outcome: 'hit' });
    const hit = t.events.find((e) => e.type === 'sk2.ordnance.hit')!.payload as { column: number; drm: number };
    expect(hit).toMatchObject({ column: 12, drm: 0 });
    // The Area Target Type would have hit on a red 7 with the TEM on the IFT instead.
    const ca2 = spineFor(engine, t.state, 'yK5', 'yL3', ca);
    expect(ca2).not.toBe(ca);
    t = act(engine, t.state, { type: 'fire.ordnance', shot: { weapon: 'g75', target: 'yL3', targetType: 'ITT', ca: ca2 } });
    const [shot] = shots(t.events);
    expect(shot).toMatchObject({ range: 2, th: 9, drm: 4, outcome: 'hit', caChange: 1 });
    expect((shot!['explain'] as { label: string }[]).map((n) => n.label)).toEqual(['+3 Covered Arc change (1 hexspine, NT)', '+1 TEM (Woods)']);
    expect(t.events.find((e) => e.type === 'sk2.ordnance.rof')!.payload).toMatchObject({ rof: 1, colored: 2, kept: false });
  });
  it('the Area Target Type uses the red TH#, halves the column and puts the TEM on the IFT DR; no ROF for a non-mortar', () => {
    const probe = makeEngine({ scenario: GE_VS_BR, extra, terrain, pieces: [{ id: 'x', def: 'ge.467', side: 'ge', hex: 'yK5' }] });
    const ca = spineFor(probe.engine, probe.state, 'yK5', 'yM5');
    const { engine, state } = makeEngine({
      scenario: GE_VS_BR,
      extra,
      terrain,
      dice: [3, 1, 4, 3],
      pieces: [
        { id: 'c1', def: 'ge.228c', side: 'ge', hex: 'yK5' },
        { id: 'g75', def: 'ge.AT75L', side: 'ge', heldBy: 'c1', tags: { ca } },
        { id: 'b1', def: 'br.457', side: 'br', hex: 'yM5' },
      ],
    });
    const t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'g75', target: 'yM5', targetType: 'ATT' } });
    expect(shots(t.events)[0]).toMatchObject({ th: 7, red: true, drm: 0, outcome: 'hit' });
    expect(t.events.find((e) => e.type === 'sk2.ordnance.hit')!.payload).toMatchObject({ column: 6, drm: 3 });
    expect(t.events.find((e) => e.type === 'sk2.ordnance.rof')!.payload).toMatchObject({ rof: 0, kept: false });
    expect(t.state.pieces['g75']!.tags).toMatchObject({ fire: 'prep', acq: 'ATT', acqHex: 'yM5', acqUnits: '', acqLevel: 1 });
  });
});

describe('The British 40L AA Gun', () => {
  const pieces = (ca: number, holder = 'br.228c') => [
    { id: 'c1', def: holder, side: 'br', hex: 'yK5' },
    { id: 'g40', def: 'br.AA40L', side: 'br', heldBy: 'c1', tags: { ca } },
    { id: 'e1', def: 'ge.467', side: 'ge', hex: 'yN5' },
  ];
  const BR_FIRST = { ...GE_VS_BR, firstSide: 'br' };
  it('fires AP on the 2 column and may not use the Area Target Type', () => {
    const probe = makeEngine({ scenario: BR_FIRST, extra, pieces: pieces(0) });
    const ca = spineFor(probe.engine, probe.state, 'yK5', 'yN5');
    const { engine, state } = makeEngine({ scenario: BR_FIRST, extra, dice: [3, 2, 3, 3], pieces: pieces(ca) });
    expect(() => act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'g40', target: 'yN5', targetType: 'ATT' } })).toThrow(/Area Target Type/);
    const t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'g40', target: 'yN5', targetType: 'ITT' } });
    expect(shots(t.events)[0]).toMatchObject({ range: 3, th: 8, outcome: 'hit' });
    expect(t.events.find((e) => e.type === 'sk2.ordnance.hit')!.payload).toMatchObject({ column: 2 });
  });
  it('fires its IFE of 8 FP on the IFT like a MG: no cowering, ROF one lower, then no second shot', () => {
    const probe = makeEngine({ scenario: BR_FIRST, extra, pieces: pieces(0) });
    const ca = spineFor(probe.engine, probe.state, 'yK5', 'yN5');
    const { engine, state } = makeEngine({ scenario: BR_FIRST, extra, dice: [3, 3], pieces: pieces(ca) });
    const t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'g40', target: 'yN5', targetType: 'IFE' } });
    const attack = t.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { fp: number; column: number; cowered: boolean; attack: { parts: string[] } };
    expect(attack).toMatchObject({ fp: 8, column: 8, cowered: false, attack: { parts: ['g40'] } });
    expect(t.events.find((e) => e.type === 'sk1.fire.rof')!.payload).toMatchObject({ colored: 3, lost: [{ sw: 'g40', rof: 2, why: 'exceeded' }] });
    expect(t.state.pieces['g40']!.tags['fire']).toBe('prep');
    expect(t.state.pieces['c1']!.tags).toMatchObject({ firedSw: true, ownFpForfeit: true });
    expect(() => act(engine, t.state, { type: 'fire.ordnance', shot: { weapon: 'g40', target: 'yN5', targetType: 'IFE' } })).toThrow(/already fired/);
  });
  it('cannot fire outside its Covered Arc without turning, and a squad firing it is Non-Qualified', () => {
    const { engine, state } = makeEngine({ scenario: BR_FIRST, extra, dice: [2, 1], pieces: pieces(0, 'br.457') });
    const map = statics(engine.env(state)).map;
    if (!inCoveredArc(map.hex('yK5')!.cube, 0, map.hex('yN5')!.cube)) {
      expect(() => act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'g40', target: 'yN5', targetType: 'ITT' } })).toThrow(/outside the Covered Arc/);
    }
    const ca = spineFor(engine, state, 'yK5', 'yN5');
    const t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'g40', target: 'yN5', targetType: 'ITT', ca } });
    const [shot] = shots(t.events);
    // Red TH# at range 3 is still 8 on the fixture chart minus one: Non-Qualified Use is +2 and red.
    expect(shot).toMatchObject({ red: true, th: 7 });
    expect((shot!['explain'] as { label: string }[]).map((n) => n.label)).toContain('+2 Non-Qualified Use');
  });
});

describe('Defensive First Fire with a Gun', () => {
  it('the mover is interrupted; FFNAM applies to the To Hit DR; AP leaves no Residual FP; the Gun is marked First Fire', () => {
    const probe = makeEngine({ scenario: GE_VS_BR, extra, startPhase: 'MPh', pieces: [{ id: 'x', def: 'ge.467', side: 'ge', hex: 'yK5' }] });
    const ca = spineFor(probe.engine, probe.state, 'yR5', 'yO5');
    const { engine, state } = makeEngine({
      scenario: GE_VS_BR,
      extra,
      startPhase: 'MPh',
      // 4+4 = 8, -2 → 6 hits (no CH); colored 4 > ROF 3 loses it; the IFT DR 4+4.
      dice: [4, 4, 4, 4],
      pieces: [
        { id: 'c1', def: 'br.228c', side: 'br', hex: 'yR5' },
        { id: 'g40', def: 'br.AA40L', side: 'br', heldBy: 'c1', tags: { ca } },
        { id: 'e1', def: 'ge.467', side: 'ge', hex: 'yN5' },
      ],
    });
    let s = act(engine, state, { type: 'move.start', units: ['e1'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'yO5' }).state;
    expect(engine.currentDecision(s)?.kind).toBe('firstFire');
    const legal = engine.legalActions(s, 'br').filter((a) => a.type === 'defFire.ordnance');
    expect(legal.length).toBeGreaterThan(0);
    const t = act(engine, s, { type: 'defFire.ordnance', shot: { weapon: 'g40', target: 'yO5', targetType: 'ITT' } });
    const [shot] = shots(t.events);
    expect(shot).toMatchObject({ mode: 'first', range: 3, th: 8, outcome: 'hit', targets: ['e1'] });
    expect((shot!['explain'] as { label: string }[]).map((n) => n.label)).toEqual(['-1 FFNAM', '-1 FFMO']);
    expect(t.state.hexMarkers['yO5']?.['residualFp']).toBeUndefined();
    expect(t.state.pieces['g40']!.tags['fire']).toBe('first');
    expect(engine.currentDecision(t.state)?.kind).toBe('phase');
  });
});

describe('Guns as targets (SK4 6.7) and the Gunshield (6.6)', () => {
  it('an ordnance Direct Hit (KIA) destroys the Gun and its crew; an Emplaced Gun adds +2 to the To Hit DR', () => {
    const probe = makeEngine({ scenario: GE_VS_BR, extra, pieces: [{ id: 'x', def: 'ge.467', side: 'ge', hex: 'yK5' }] });
    const ca = spineFor(probe.engine, probe.state, 'yK5', 'yM5');
    const { engine, state } = makeEngine({
      scenario: GE_VS_BR,
      extra,
      // 3+1 = 4, +2 Emplacement → 6 hits; IFT 2+2 = 4 on the 12 column: KIA.
      dice: [3, 1, 2, 2],
      pieces: [
        { id: 'c1', def: 'ge.228c', side: 'ge', hex: 'yK5' },
        { id: 'g75', def: 'ge.AT75L', side: 'ge', heldBy: 'c1', tags: { ca } },
        { id: 'bc', def: 'br.228c', side: 'br', hex: 'yM5' },
        { id: 'g40', def: 'br.AA40L', side: 'br', heldBy: 'bc', tags: { ca: 0, emplaced: true } },
      ],
    });
    const t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'g75', target: 'yM5', targetType: 'ITT' } });
    const [shot] = shots(t.events);
    expect(shot).toMatchObject({ drm: 2, outcome: 'hit' });
    expect((shot!['explain'] as { label: string }[]).map((n) => n.label)).toEqual(['+2 Emplacement TEM']);
    expect(t.events.find((e) => e.type === 'sk2.gun.destroyed')!.payload).toMatchObject({ gun: 'g40', reason: 'Direct Hit (KIA)' });
    expect(t.state.pieces['g40']!.loc).toEqual({ kind: 'eliminated' });
    expect(t.state.pieces['bc']!.loc).toEqual({ kind: 'eliminated' });
  });
  it('a Critical Hit with AP destroys the Gun and its crew whatever the IFT DR, and leaves no Acquired Target counter', () => {
    const probe = makeEngine({ scenario: GE_VS_BR, extra, pieces: [{ id: 'x', def: 'ge.467', side: 'ge', hex: 'yK5' }] });
    const ca = spineFor(probe.engine, probe.state, 'yK5', 'yM5');
    const { engine, state } = makeEngine({
      scenario: GE_VS_BR,
      extra,
      // Original TH DR 2: a Critical Hit. IFT 6+6 on the doubled AP column would do nothing at all.
      dice: [1, 1, 6, 6],
      pieces: [
        { id: 'c1', def: 'ge.228c', side: 'ge', hex: 'yK5' },
        { id: 'g75', def: 'ge.AT75L', side: 'ge', heldBy: 'c1', tags: { ca } },
        { id: 'bc', def: 'br.228c', side: 'br', hex: 'yM5' },
        { id: 'g40', def: 'br.AA40L', side: 'br', heldBy: 'bc', tags: { ca: 0 } },
      ],
    });
    const t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'g75', target: 'yM5', targetType: 'ITT', ammo: 'AP' } });
    expect(t.events.find((e) => e.type === 'sk2.ordnance.hit')!.payload).toMatchObject({ ammo: 'AP', ch: true });
    expect(t.events.find((e) => e.type === 'sk2.gun.destroyed')!.payload).toMatchObject({ gun: 'g40', reason: 'Critical Hit' });
    expect(t.events.find((e) => e.type === 'sk1.fire.result')!.payload).toMatchObject({ unit: 'bc', result: { kind: 'KIA' }, critical: true });
    expect(t.state.pieces['g40']!.loc).toEqual({ kind: 'eliminated' });
    expect(t.state.pieces['bc']!.loc).toEqual({ kind: 'eliminated' });
    // The ½" counter sits on its target (SK4 6.10): with the target gone there is none.
    expect(t.events.some((e) => e.type === 'sk2.acquired')).toBe(false);
    expect(t.state.pieces['g75']!.tags['acq']).toBeUndefined();
    expect(acquisitionsAt(engine.env(t.state), 'yM5')).toEqual([]);
  });
  it('a K result malfunctions the Gun and reduces the crew; a near miss gives an AT crew its Gunshield', () => {
    const probe = makeEngine({ scenario: { ...GE_VS_BR, firstSide: 'br' }, extra, pieces: [{ id: 'x', def: 'ge.467', side: 'ge', hex: 'yK5' }] });
    const map = statics(probe.engine.env(probe.state)).map;
    // The British squad fires from within the German Gun's arc.
    const ca = nearestSpine(map.hex('yM5')!.cube, 0, map.hex('yK5')!.cube)!;
    const { engine, state } = makeEngine({
      scenario: { ...GE_VS_BR, firstSide: 'br' },
      extra: [...sk2CoreModules, testFire],
      dice: [3, 4],
      pieces: [
        { id: 'b1', def: 'br.457', side: 'br', hex: 'yK5' },
        { id: 'c1', def: 'ge.228c', side: 'ge', hex: 'yM5' },
        { id: 'g75', def: 'ge.AT75L', side: 'ge', heldBy: 'c1', tags: { ca } },
      ],
    });
    const t = act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: ['b1'], sw: [], target: 'yM5' } });
    const res = t.events.find((e) => e.type === 'sk1.fire.result')!.payload as { drm?: number; explain?: { label: string }[] };
    expect(res).toMatchObject({ drm: 2, explain: [{ label: '+2 Gunshield' }] });
  });
});
