import { describe, expect, it } from 'vitest';
import type { Action, Ctx, Engine, GameState, RuleModule } from '@asl/engine';
import { FP, caChangeIllegal, constraintViolation, inCoveredArc, mustRout, nearestSpine, sk2CoreModules, statics, type FireDeclaration, type FireMode, type ResolveFireFn, type ScenarioDef } from '../src';
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

const S13_LIKE: Partial<ScenarioDef> = {
  ...GE_VS_BR,
  forces: [
    {
      side: 'br',
      units: [],
      setup: {
        kind: 'area',
        description: 'anywhere, guns ≥ 3 from buildings, ≤ 5 from another gun, not adjacent',
        hexes: [],
        constraints: [
          { kind: 'awayFromBuildings', defs: ['br.AA40L'], atLeast: 3 },
          { kind: 'spacing', defs: ['br.AA40L'], atLeast: 2, withinOfAnother: 5 },
        ],
      },
    },
    { side: 'br', units: [], setup: { kind: 'area', description: 'with no British', hexes: [], constraints: [{ kind: 'notWithNationalities', nationalities: ['br'] }] } },
  ],
};

describe('Setup constraints (S13: Gun placement, Greeks apart from the British)', () => {
  const terrain = { yP5: { terrain: 'building-stone', buildingId: 'y-B1' } };
  const guns = (hexes: [string, string, string]) => [
    { id: 'c1', def: 'br.228c', side: 'br', hex: hexes[0], tags: { force: 0 } },
    { id: 'g1', def: 'br.AA40L', side: 'br', heldBy: 'c1' },
    { id: 'c2', def: 'br.228c', side: 'br', hex: hexes[1], tags: { force: 0 } },
    { id: 'g2', def: 'br.AA40L', side: 'br', heldBy: 'c2' },
    { id: 'c3', def: 'br.228c', side: 'br', hex: hexes[2], tags: { force: 0 } },
    { id: 'g3', def: 'br.AA40L', side: 'br', heldBy: 'c3' },
    { id: 'e', def: 'ge.467', side: 'ge', hex: 'yA1' },
  ];
  const check = (hexes: [string, string, string], more: { id: string; def: string; side: string; hex: string; tags?: Record<string, number> }[] = []) => {
    const { engine, state } = makeEngine({ scenario: S13_LIKE, extra, terrain, pieces: [...guns(hexes), ...more] });
    return constraintViolation(engine.env(state), 'br', {});
  };
  it('accepts guns 3+ hexes from buildings, not adjacent, within 5 of another', () => {
    expect(check(['yE3', 'yH4', 'yK3'])).toBeNull();
  });
  it('rejects a gun within 2 hexes of a building', () => {
    expect(check(['yN5', 'yH4', 'yK3'])).toMatch(/at least 3 hexes from every building \(yP5\)/);
  });
  it('rejects adjacent guns', () => {
    expect(check(['yE3', 'yE4', 'yK3'])).toMatch(/not be adjacent/);
  });
  it('rejects a gun more than 5 hexes from every other gun once all are placed', () => {
    expect(check(['yE3', 'yH4', 'yX3'])).toMatch(/within 5 hexes of at least one other/);
  });
  it('keeps the Greeks out of British hexes', () => {
    const greek = { id: 'k1', def: 'al.LMG', side: 'br', hex: 'yE3', tags: { force: 1 } };
    // A weapon is not personnel: no complaint about the LMG.
    expect(check(['yE3', 'yH4', 'yK3'], [greek])).toBeNull();
    const squad = { id: 'k2', def: 'br.457', side: 'br', hex: 'yH4', tags: { force: 1 } };
    expect(check(['yE3', 'yH4', 'yK3'], [squad])).toMatch(/may not set up in a hex with .*crew \(yH4\)/);
  });
});

describe('Covered Arc changes (SK4 3.2.4)', () => {
  const pieces = [
    { id: 'c1', def: 'br.228c', side: 'br', hex: 'yN5' },
    { id: 'g1', def: 'br.AA40L', side: 'br', heldBy: 'c1', tags: { ca: 2 } },
    { id: 'e', def: 'ge.467', side: 'ge', hex: 'yA1' },
  ];
  it('is offered for each Gun that may still turn, to every other hexspine', () => {
    const { engine, state } = makeEngine({ scenario: { ...GE_VS_BR, firstSide: 'br' }, extra, pieces });
    const offered = engine.legalActions(state, 'br').filter((a) => a.type === 'gun.changeCa') as unknown as { gun: string; ca: number }[];
    expect(offered.map((a) => `${a.gun}:${a.ca}`)).toEqual(['g1:0', 'g1:1', 'g1:3', 'g1:4', 'g1:5']);
    // Turned once this Player Turn: nothing more to offer.
    const turned = act(engine, state, { type: 'gun.changeCa', gun: 'g1', ca: 4 }).state;
    expect(engine.legalActions(turned, 'br').some((a) => a.type === 'gun.changeCa')).toBe(false);
  });
  it('turns the Gun at the end of its fire phase, once, and locks the Gun and crew in place', () => {
    const { engine, state } = makeEngine({ scenario: { ...GE_VS_BR, firstSide: 'br' }, extra, pieces });
    const t = act(engine, state, { type: 'gun.changeCa', gun: 'g1', ca: 4 });
    expect(t.state.pieces['g1']!.tags['ca']).toBe(4);
    expect(t.state.pieces['g1']!.tags['caLocked']).toBe(true);
    expect(t.state.pieces['c1']!.tags['caLocked']).toBe(true);
    expect(t.events.find((e) => e.type === 'sk2.gun.ca')!.payload).toMatchObject({ gun: 'g1', from: 2, to: 4, spines: 2, reason: 'phase' });
    expect(() => act(engine, t.state, { type: 'gun.changeCa', gun: 'g1', ca: 1 })).toThrow(/already been changed/);
    // Ends with the Player Turn.
    let s = t.state;
    for (let i = 0; i < 8 && s.phase !== 'CCPh'; i++) s = settle(engine, act(engine, s, { type: 'endPhase' }).state);
    s = act(engine, s, { type: 'endPhase' }).state;
    expect(s.pieces['g1']!.tags['caLocked']).toBeUndefined();
  });
  it('ends the fire of the Gun and its crew for the phase, and they fire again next Player Turn', () => {
    // S14: an 88 turned with "Change CA" mid-PFPh, then fired at the new facing with no case 8 DRM.
    const at = [
      { id: 'c1', def: 'ge.228c', side: 'ge', hex: 'yK5' },
      { id: 'g88', def: 'ge.AA88L', side: 'ge', heldBy: 'c1', tags: { ca: 0 } },
      { id: 'b2', def: 'br.457', side: 'br', hex: 'yM3' },
    ];
    const probe = makeEngine({ scenario: GE_VS_BR, extra, pieces: at });
    const map = statics(probe.engine.env(probe.state)).map;
    const from = [0, 1, 2, 3, 4, 5].find((c) => !inCoveredArc(map.hex('yK5')!.cube, c, map.hex('yM3')!.cube))!;
    const { engine, state } = makeEngine({ scenario: GE_VS_BR, extra, pieces: at.map((p) => (p.id === 'g88' ? { ...p, tags: { ca: from } } : p)), dice: [6, 6, 6, 6, 6, 6, 6, 6] });
    expect(state.phase).toBe('PFPh');
    const shot = { weapon: 'g88', target: 'yM3', targetType: 'ITT' as const };
    expect(() => act(engine, state, { type: 'fire.ordnance', shot })).toThrow(/outside the Covered Arc/);
    const ca = nearestSpine(map.hex('yK5')!.cube, from, map.hex('yM3')!.cube)!;
    let s = act(engine, state, { type: 'gun.changeCa', gun: 'g88', ca }).state;
    expect(s.pieces['g88']!.tags['ca']).toBe(ca);
    // Neither the Gun (To Hit or IFE) nor its crew may fire again this phase.
    expect(() => act(engine, s, { type: 'fire.ordnance', shot })).toThrow(/ends its fire this phase/);
    expect(() => act(engine, s, { type: 'test.fire', decl: { units: ['c1'], sw: [], target: 'yM3' }, mode: 'prep' })).toThrow(/ends its fire this phase/);
    expect(() => act(engine, s, { type: 'test.fire', decl: { units: [], sw: ['g88'], target: 'yM3' }, mode: 'prep' })).toThrow(/ends its fire this phase/);
    // The next fire phase is a new one: the turned Gun may fire there without case 8 (AFPh: it has not moved).
    while (s.phase !== 'AFPh') s = settle(engine, act(engine, s, { type: 'endPhase' }).state);
    expect(engine.query(s, 'fire.illegal', { decl: { units: ['c1'], sw: [], target: 'yM3' }, mode: 'advancing', side: 'ge' }, null).value).toBeNull();
    // Into the next German Player Turn: every mark is gone, the Gun fires and the crew may move.
    while (!(s.turn === 2 && s.attacker === 'ge' && s.phase === 'PFPh')) s = settle(engine, act(engine, s, { type: 'endPhase' }).state);
    for (const id of ['g88', 'c1']) {
      expect(s.pieces[id]!.tags['caTurned']).toBeUndefined();
      expect(s.pieces[id]!.tags['caLocked']).toBeUndefined();
    }
    const t = act(engine, s, { type: 'fire.ordnance', shot });
    expect(t.events.find((e) => e.type === 'sk2.ordnance.shot')!.payload).toMatchObject({ caChange: 0 });
  });
  it('is not possible in the enemy fire phase, when pinned, or after firing', () => {
    const { engine, state } = makeEngine({ scenario: GE_VS_BR, extra, pieces });
    expect(caChangeIllegal(engine.env(state), 'g1', 'br')).toMatch(/own fire phase/);
    const pinned = makeEngine({ scenario: { ...GE_VS_BR, firstSide: 'br' }, extra, pieces: [{ ...pieces[0]!, tags: { pinned: true } }, pieces[1]!, pieces[2]!] });
    expect(() => act(pinned.engine, pinned.state, { type: 'gun.changeCa', gun: 'g1', ca: 4 })).toThrow(/pinned or broken/);
    const fired = makeEngine({ scenario: { ...GE_VS_BR, firstSide: 'br' }, extra, pieces: [pieces[0]!, { ...pieces[1]!, tags: { ca: 2, fire: 'prep' } }, pieces[2]!] });
    expect(() => act(fired.engine, fired.state, { type: 'gun.changeCa', gun: 'g1', ca: 4 })).toThrow(/has fired/);
  });
});

describe('Emplacement (SK4 6.3)', () => {
  it('gives the crew of an emplaced Gun +2 in Open Ground and +1 in woods, never on top of a better TEM', () => {
    const shoot = (terrain: Record<string, { terrain: string }>) => {
      const { engine, state } = makeEngine({
        scenario: GE_VS_BR,
        extra,
        terrain,
        dice: [3, 4, 6, 6],
        pieces: [
          { id: 'e', def: 'ge.467', side: 'ge', hex: 'yN5' },
          { id: 'c1', def: 'br.228c', side: 'br', hex: 'yO5' },
          { id: 'g1', def: 'br.AA40L', side: 'br', heldBy: 'c1', tags: { ca: 0, emplaced: true } },
        ],
      });
      const t = act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: ['e'], sw: [], target: 'yO5' } });
      return t.events.find((e) => e.type === 'sk1.fire.result')!.payload as { drm?: number; explain?: { label?: string }[] };
    };
    expect(shoot({})).toMatchObject({ drm: 2, explain: [{ label: '+2 Emplacement TEM' }] });
    expect(shoot({ yO5: { terrain: 'woods' } })).toMatchObject({ drm: 1, explain: [{ label: '+1 Emplacement TEM' }] });
    expect(shoot({ yO5: { terrain: 'building-stone' } }).drm).toBeUndefined();
  });
  it('a broken crew with an emplaced Gun need not rout for Open Ground, only for an adjacent enemy', () => {
    const mk = (emplaced: boolean, enemyHex: string) =>
      makeEngine({
        scenario: GE_VS_BR,
        extra,
        startPhase: 'RtPh',
        pieces: [
          { id: 'e', def: 'ge.467', side: 'ge', hex: enemyHex },
          { id: 'c1', def: 'br.228c', side: 'br', hex: 'yO5', tags: { broken: true } },
          { id: 'g1', def: 'br.AA40L', side: 'br', heldBy: 'c1', tags: { ca: 0, ...(emplaced ? { emplaced: true } : {}) } },
        ],
      });
    const far = mk(true, 'yK5');
    expect(mustRout(far.engine.env(far.state), far.state.pieces['c1']!)).toBe(false);
    const unemplaced = mk(false, 'yK5');
    expect(mustRout(unemplaced.engine.env(unemplaced.state), unemplaced.state.pieces['c1']!)).toBe(true);
    const adjacent = mk(true, 'yN5');
    expect(mustRout(adjacent.engine.env(adjacent.state), adjacent.state.pieces['c1']!)).toBe(true);
  });
  it('a crew that fired its Gun this Player Turn still interdicts, so a broken unit in its Open Ground must rout (SK1 3.6)', () => {
    // demo-gun-line: a broken crew in Open Ground R4 two hexes from the German 75L AT crew once stayed put.
    const { engine, state } = makeEngine({
      scenario: GE_VS_BR,
      extra,
      startPhase: 'RtPh',
      pieces: [
        { id: 'gc', def: 'ge.228c', side: 'ge', hex: 'yK5', tags: { ownFpForfeit: true } },
        { id: 'gg', def: 'ge.AT75L', side: 'ge', heldBy: 'gc', tags: { ca: 3, fire: 'final' } },
        { id: 'b1', def: 'br.458', side: 'br', hex: 'yM5', tags: { broken: true } },
      ],
    });
    expect(mustRout(engine.env(state), state.pieces['b1']!)).toBe(true);
  });
});

describe('Gun victory conditions (S13)', () => {
  const victory: ScenarioDef['victory'] = [
    {
      kind: 'any',
      side: 'ge',
      immediate: true,
      of: [
        { kind: 'gunsEliminatedOrCaptured', side: 'ge', of: 'br', defs: ['br.AA40L'] },
        { kind: 'occupyGunHexes', side: 'ge', of: 'br', defs: ['br.AA40L'] },
      ],
    },
  ];
  const pieces = [
    { id: 'e', def: 'ge.467', side: 'ge', hex: 'yN5' },
    { id: 'c1', def: 'br.228c', side: 'br', hex: 'yO5' },
    { id: 'g1', def: 'br.AA40L', side: 'br', heldBy: 'c1', tags: { ca: 0 } },
    { id: 'b1', def: 'br.457', side: 'br', hex: 'yA1' },
  ];
  it('the Germans win at once when they alone occupy the hex of the last non-captured Gun', () => {
    // 8 column, DR 3 → 1KIA kills the crew; the Gun survives its dr; the Germans then walk in.
    const { engine, state } = makeEngine({ scenario: { ...GE_VS_BR, victory }, extra, dice: [1, 2, 6], pieces: [...pieces, { id: 'e2', def: 'ge.467', side: 'ge', hex: 'yN5' }] });
    let s = act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: ['e'], sw: [], target: 'yO5' } }).state;
    expect(s.pieces['c1']!.loc).toEqual({ kind: 'eliminated' });
    expect(s.pieces['g1']!.loc).toEqual({ kind: 'hex', hex: 'yO5' });
    expect(s.result).toBeNull();
    s = act(engine, s, { type: 'endPhase' }).state;
    expect(s.phase).toBe('MPh');
    s = act(engine, s, { type: 'move.start', units: ['e2'] }).state;
    s = settle(engine, act(engine, s, { type: 'move.step', to: 'yO5' }).state);
    expect(s.result).toMatchObject({ winner: 'ge', reason: 'sudden death' });
  });
  it('the Germans win at once when they capture the last Gun', () => {
    const { engine, state } = makeEngine({ scenario: { ...GE_VS_BR, victory }, extra, startPhase: 'MPh', dice: [1], pieces: [
      { id: 'e', def: 'ge.467', side: 'ge', hex: 'yO5' },
      { id: 'g1', def: 'br.AA40L', side: 'br', hex: 'yO5', tags: { ca: 0 } },
      { id: 'b1', def: 'br.457', side: 'br', hex: 'yA1' },
    ] });
    // The Gun lies unpossessed with a German on it: that is "solely occupying" its hex only once the game checks.
    expect(state.result).toBeNull();
    let s = act(engine, state, { type: 'move.start', units: ['e'] }).state;
    s = settle(engine, act(engine, s, { type: 'move.recover', unit: 'e', sw: 'g1' }).state);
    expect(s.pieces['g1']!.side).toBe('ge');
    expect(s.result).toMatchObject({ winner: 'ge' });
  });
});
