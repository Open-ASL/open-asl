import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { hiddenUnitsModule, hideIllegal, isVisibleTo, sk2CoreModules } from '../src';
import { sk3CoreModules } from '../src/sk3';
import { GE_VS_BR, act, makeEngine, type PieceSpec } from './fixtures';

/*
 * Hidden units by special rule (S23 SSR 1): any unit of the side may set up hidden with its weapons in
 * a non-Open Ground hex; it is placed on the map when it fires or moves, or when an enemy unit enters or
 * tries to enter its hex; enemy Infantry trying to enter in the MPh is turned back.
 */

const SSR = { module: 'hidden-units', params: { side: 'br', notOpenGround: true, rule: 'SSR 1' }, text: 'SSR 1' };
const extra = [...sk2CoreModules, hiddenUnitsModule];
const WOODS = { yM5: { terrain: 'woods' } };
const hiddenSquad: PieceSpec[] = [
  { id: 'b1', def: 'br.458', side: 'br', hex: 'yM5', tags: { hip: true } },
  { id: 'lmg', def: 'br.LMG', side: 'br', heldBy: 'b1', tags: { hip: true } },
];
const game = (pieces: PieceSpec[], startPhase: string, firstSide = 'ge', dice: number[] = []) =>
  makeEngine({ scenario: { ...GE_VS_BR, firstSide, ssr: [SSR] }, extra, terrain: WOODS, startPhase, pieces, dice });
const settle = (engine: Engine, state: GameState) => {
  let s = state;
  while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
  return s;
};

describe('Hidden units (S23 SSR 1)', () => {
  it('may set up hidden only outside Open Ground; a Gun never on a paved road', () => {
    const { engine, state } = makeEngine({
      scenario: { ...GE_VS_BR, ssr: [SSR] },
      extra,
      terrain: { ...WOODS, yK5: { terrain: 'open', features: ['road:paved'] } as never, yK6: { terrain: 'woods', features: ['road:paved'] } as never },
      pieces: [
        { id: 'b1', def: 'br.458', side: 'br', hex: 'yA1' },
        { id: 'c', def: 'br.228c', side: 'br', hex: 'yA2' },
        { id: 'g', def: 'br.AT57L', side: 'br', heldBy: 'c' },
      ],
    });
    const env = engine.env(state);
    expect(hideIllegal(env, 'b1', 'yM5')).toBeNull();
    expect(hideIllegal(env, 'b1', 'yL5')).toMatch(/Open Ground/);
    expect(hideIllegal(env, 'c', 'yK6')).toMatch(/paved road/);
    expect(hideIllegal(env, 'g', 'yM5')).toMatch(/personnel/);
  });

  it('a hidden unit and its weapons are hidden from the other side only', () => {
    const { engine, state } = game([...hiddenSquad, { id: 'e1', def: 'ge.467', side: 'ge', hex: 'yK5' }], 'MPh');
    const env = engine.env(state);
    for (const id of ['b1', 'lmg']) {
      expect(isVisibleTo(env, state.pieces[id]!, 'br')).toBe(true);
      expect(isVisibleTo(env, state.pieces[id]!, 'ge')).toBe(false);
    }
  });

  it('German Infantry trying to enter its hex in the MPh is turned back, and the unit is placed on the map', () => {
    const { engine, state } = game([...hiddenSquad, { id: 'e1', def: 'ge.467', side: 'ge', hex: 'yL5' }], 'MPh');
    let s = act(engine, state, { type: 'move.start', units: ['e1'] }).state;
    const t = act(engine, s, { type: 'move.step', to: 'yM5' });
    expect(t.events.find((e) => e.type === 'sk2.hip.unitRevealed')!.payload).toMatchObject({ unit: 'b1', hex: 'yM5', reason: 'entered' });
    expect(t.events.find((e) => e.type === 'sk2.hip.bounce')!.payload).toMatchObject({ hex: 'yM5', gun: null });
    expect(t.state.pieces['e1']!.loc).toEqual({ kind: 'hex', hex: 'yL5' });
    expect(t.state.pieces['b1']!.tags['hip']).toBeUndefined();
    expect(t.state.pieces['lmg']!.tags['hip']).toBeUndefined();
    s = settle(engine, t.state);
    expect(engine.legalActions(s, 'ge').some((a) => a.type === 'move.step')).toBe(false);
  });

  it('is placed on the map when it fires', () => {
    const { engine, state } = game([...hiddenSquad, { id: 'e1', def: 'ge.467', side: 'ge', hex: 'yO5' }], 'PFPh', 'br', [6, 6]);
    const t = act(engine, state, { type: 'fire', decl: { units: ['b1'], sw: ['lmg'], target: 'yO5' } });
    expect(t.events.find((e) => e.type === 'sk2.hip.unitRevealed')!.payload).toMatchObject({ unit: 'b1', reason: 'fire' });
    expect(t.state.pieces['b1']!.tags['hip']).toBeUndefined();
    expect(t.state.pieces['lmg']!.tags['hip']).toBeUndefined();
  });

  it('is placed on the map when it moves', () => {
    const { engine, state } = game([...hiddenSquad, { id: 'e1', def: 'ge.467', side: 'ge', hex: 'yA1' }], 'MPh', 'br');
    const s = act(engine, state, { type: 'move.start', units: ['b1'] }).state;
    const t = act(engine, s, { type: 'move.step', to: 'yM6' });
    expect(t.events.find((e) => e.type === 'sk2.hip.unitRevealed')!.payload).toMatchObject({ unit: 'b1', reason: 'moved' });
    expect(t.state.pieces['b1']!.tags['hip']).toBeUndefined();
  });

  it('a router may not enter its hex; an advance into it finds it', () => {
    const rout = game([...hiddenSquad, { id: 'e1', def: 'ge.467', side: 'ge', hex: 'yL5', tags: { broken: true } }, { id: 'b2', def: 'br.457', side: 'br', hex: 'yK5' }], 'RtPh');
    const routs = rout.engine.legalActions(rout.state, 'ge').filter((a) => a.type === 'rout.step' && a['to'] === 'yM5' && !a['lowCrawl']);
    expect(routs.length).toBeGreaterThan(0);
    const t = act(rout.engine, rout.state, routs[0]!);
    expect(t.events.find((e) => e.type === 'sk2.hip.unitRevealed')!.payload).toMatchObject({ reason: 'entered' });
    expect(t.state.pieces['e1']!.loc).toEqual({ kind: 'eliminated' });
    const adv = game([...hiddenSquad, { id: 'e1', def: 'ge.467', side: 'ge', hex: 'yL5' }], 'APh');
    const a = act(adv.engine, adv.state, { type: 'advance', units: ['e1'], to: 'yM5' });
    expect(a.events.find((e) => e.type === 'sk2.hip.unitRevealed')!.payload).toMatchObject({ unit: 'b1', reason: 'advanced' });
    expect(a.state.hexMarkers['yM5']).toMatchObject({ cc: true, hipAmbush: 'br' });
  });

  it('a vehicle entering its hex finds it and carries on (only Infantry is turned back)', () => {
    const { engine, state } = makeEngine({
      scenario: { ...GE_VS_BR, ssr: [SSR] },
      extra: [...sk2CoreModules, ...sk3CoreModules, hiddenUnitsModule],
      terrain: { yM5: { terrain: 'orchard' } },
      startPhase: 'MPh',
      pieces: [...hiddenSquad, { id: 'pz', def: 'ge.pzivf2', side: 'ge', hex: 'yM6', tags: { vca: 0, ca: 0 } }],
    });
    let s = settle(engine, act(engine, state, { type: 'vmove.start', vehicle: 'pz' }).state);
    const t = act(engine, s, { type: 'move.step', to: 'yM5' });
    expect(t.events.find((e) => e.type === 'sk2.hip.unitRevealed')!.payload).toMatchObject({ unit: 'b1', reason: 'entered' });
    expect(t.events.some((e) => e.type === 'sk2.hip.bounce')).toBe(false);
    s = settle(engine, t.state);
    expect(s.pieces['pz']!.loc).toEqual({ kind: 'hex', hex: 'yM5' });
    expect(s.pieces['b1']!.tags['hip']).toBeUndefined();
  });
});

/*
 * Hidden vehicles (ASLRB A12.3, LMA4 SSR 2 "ALL German units are to set up HIP"): a vehicle hides with its MGs and is
 * revealed when it starts, moves or turns, or an enemy enters its hex; in Open Ground a Good Order enemy that sees it
 * within 16 hexes finds it (as SK4 6.4 for a Gun).
 */
describe('Hidden vehicles (LMA4 SSR 2)', () => {
  const VSSR = { module: 'hidden-units', params: { side: 'ge', rule: 'SSR 2' }, text: 'SSR 2' };
  const hiddenPz: PieceSpec[] = [
    { id: 'pz', def: 'ge.pzivf2', side: 'ge', hex: 'yM5', tags: { vca: 0, ca: 0, hip: true } },
    { id: 'pz.cmg', def: 'ge.pzivf2.cmg', side: 'ge', heldBy: 'pz', tags: { hip: true } },
  ];
  const vgame = (pieces: PieceSpec[], startPhase: string, firstSide: string, terrain: Record<string, never> = WOODS as never) =>
    makeEngine({ scenario: { ...GE_VS_BR, firstSide, ssr: [VSSR] }, extra: [...sk2CoreModules, ...sk3CoreModules, hiddenUnitsModule], terrain, startPhase, pieces });

  it('may set up hidden, with its MGs hidden from the other side', () => {
    const { engine, state } = vgame([...hiddenPz, { id: 'b1', def: 'br.458', side: 'br', hex: 'yA1' }], 'MPh', 'br');
    const env = engine.env(state);
    expect(hideIllegal(env, 'pz', 'yM5')).toBeNull();
    for (const id of ['pz', 'pz.cmg']) expect(isVisibleTo(env, state.pieces[id]!, 'br')).toBe(false);
  });

  it('is revealed, with its MGs, when it starts its move', () => {
    const { engine, state } = vgame([...hiddenPz, { id: 'b1', def: 'br.458', side: 'br', hex: 'yA1' }], 'MPh', 'ge');
    const t = act(engine, state, { type: 'vmove.start', vehicle: 'pz' });
    expect(t.events.find((e) => e.type === 'sk2.hip.unitRevealed')!.payload).toMatchObject({ unit: 'pz', reason: 'moved' });
    expect(t.state.pieces['pz']!.tags['hip']).toBeUndefined();
    expect(t.state.pieces['pz.cmg']!.tags['hip']).toBeUndefined();
  });

  it('turns back enemy Infantry trying to enter its hex, and is revealed', () => {
    const { engine, state } = vgame([...hiddenPz, { id: 'b1', def: 'br.458', side: 'br', hex: 'yL5' }], 'MPh', 'br');
    const s = act(engine, state, { type: 'move.start', units: ['b1'] }).state;
    const t = act(engine, s, { type: 'move.step', to: 'yM5' });
    expect(t.events.find((e) => e.type === 'sk2.hip.unitRevealed')!.payload).toMatchObject({ unit: 'pz', reason: 'entered' });
    expect(t.state.pieces['b1']!.loc).toEqual({ kind: 'hex', hex: 'yL5' });
  });

  it('in Open Ground, is found by a Good Order enemy that sees it within 16 hexes', () => {
    const open = vgame([...hiddenPz, { id: 'b1', def: 'br.458', side: 'br', hex: 'yM8' }], 'MPh', 'br', {} as never);
    expect(open.state.pieces['pz']!.tags['hip']).toBeUndefined();
    expect(open.state.pieces['pz.cmg']!.tags['hip']).toBeUndefined();
    const woods = vgame([...hiddenPz, { id: 'b1', def: 'br.458', side: 'br', hex: 'yM8' }], 'MPh', 'br');
    expect(act(woods.engine, woods.state, { type: 'endPhase' }).state.pieces['pz']!.tags['hip']).toBe(true);
  });
});
