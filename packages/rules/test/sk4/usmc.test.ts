import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { setupDeployModule, sk2CoreModules, sk3CoreModules, usmcModule } from '../../src';
import { act, makeEngine, type PieceSpec } from '../fixtures';

/**
 * The U.S. Marine Corps (SK4 8.4): a 7-6-8 deploys at setup or by NTC in the American RPh as its sole action; two
 * 3-4-8 with a Good Order leader recombine in the RPh (if the OB has 7-6-8s) at no CVP; Raiders ambush at -1.
 */
const extra = [...sk2CoreModules, ...sk3CoreModules, setupDeployModule, usmcModule];
const SC = {
  firstSide: 'am',
  sides: [
    { side: 'am', name: 'U.S. Marine Corps', nationality: 'am', elr: 5 },
    { side: 'ja', name: 'Japanese', nationality: 'ja', elr: 3 },
  ],
  forces: [{ side: 'am', units: [{ def: 'am.768', count: 2 }, { def: 'am.L91', count: 1 }], setup: { kind: 'area', description: 'west', hexes: ['yK5', 'yL5'] } }],
};
const game = (pieces: PieceSpec[], opts: { dice?: number[]; startPhase?: string; forces?: boolean } = {}) =>
  makeEngine({ scenario: { ...SC, ...(opts.forces === false ? { forces: [] } : {}) } as never, extra, terrain: {}, startPhase: opts.startPhase ?? 'RPh', pieces, ...(opts.dice ? { dice: opts.dice } : {}) });
let events: { type: string; payload: unknown }[] = [];
const step = (r: { state: GameState; events: { type: string; payload: unknown }[] }) => {
  events = [...events, ...r.events];
  return r.state;
};
const types = (engine: Engine, s: GameState) => engine.legalActions(s, engine.currentDecision(s)!.owner);

describe('U.S. Marine Corps (SK4 8.4)', () => {
  it('a 7-6-8 may deploy at setup without any SSR', () => {
    const { engine, state } = game([{ id: 's', def: 'am.768', side: 'am' }, { id: 'g', def: 'am.666', side: 'am' }], { startPhase: 'setup' });
    const env = engine.env(state);
    expect(env.query('deploy.allowed', { side: 'am', unit: 's' }, false)).toBe(true);
    expect(env.query('deploy.allowed', { side: 'am', unit: 'g' }, false)).toBe(false);
  });

  it('deploys by NTC in the American RPh as its sole action: a pass splits it, a fail costs the action', () => {
    const { engine, state: s0 } = game([{ id: 's', def: 'am.768', side: 'am', hex: 'yK5' }, { id: 't', def: 'am.768', side: 'am', hex: 'yL5' }, { id: 'l', def: 'am.L91', side: 'am', hex: 'yK5' }], { dice: [4, 4, 6, 5] });
    expect(types(engine, s0).filter((a) => a.type === 'rally.deploy').map((a) => a['unit'])).toEqual(['s', 't']);
    // 8 -1 (leader) = 7 ≤ 8: passed.
    events = [];
    let s = step(act(engine, s0, { type: 'rally.deploy', unit: 's' }));
    expect(s.pieces['s']!.defId).toBe('am.348h');
    expect(s.pieces['s.d']!.defId).toBe('am.348h');
    expect(s.pieces['s.d']!.loc).toEqual({ kind: 'hex', hex: 'yK5' });
    expect(events.some((e) => e.type === 'sk4.usmc.deploy' && (e.payload as { passed: boolean }).passed)).toBe(true);
    // Its sole action: the halves may do nothing else this RPh, and may not deploy again.
    expect(types(engine, s).some((a) => a.type === 'rally.deploy' && a['unit'] === 's')).toBe(false);
    // 11 > 8 without a leader: failed, action spent.
    s = step(act(engine, s, { type: 'rally.deploy', unit: 't' }));
    expect(s.pieces['t']!.defId).toBe('am.768');
    expect(s.pieces['t']!.tags['rphAction']).toBe(true);
    expect(types(engine, s).some((a) => a.type === 'rally.deploy')).toBe(false);
    expect(engine.currentDecision(s)!.kind).toBe('phase');
  });

  it('is not offered in the Japanese Player Turn or to a unit that acted already', () => {
    const { engine, state } = game([{ id: 's', def: 'am.768', side: 'am', hex: 'yK5', tags: { rphAction: true } }, { id: 't', def: 'am.768', side: 'am', hex: 'yL5' }], { dice: [1, 1] });
    expect(types(engine, state).filter((a) => a.type === 'rally.deploy').map((a) => a['unit'])).toEqual(['t']);
    const ja = makeEngine({ scenario: { ...SC, firstSide: 'ja' } as never, extra, terrain: {}, startPhase: 'RPh', pieces: [{ id: 't', def: 'am.768', side: 'am', hex: 'yL5' }] });
    expect(types(ja.engine, ja.state).some((a) => a.type === 'rally.deploy')).toBe(false);
  });

  it('two 3-4-8 with a Good Order leader recombine into a 7-6-8 at no CVP; a 2-3-8 or a missing leader will not do', () => {
    const { engine, state: s0 } = game([
      { id: 'a', def: 'am.348h', side: 'am', hex: 'yK5' },
      { id: 'b', def: 'am.348h', side: 'am', hex: 'yK5' },
      { id: 'w', def: 'am.MMG', side: 'am', heldBy: 'b' },
      { id: 'l', def: 'am.L91', side: 'am', hex: 'yK5' },
      { id: 'c', def: 'am.348h', side: 'am', hex: 'yL5' },
      { id: 'd', def: 'am.347', side: 'am', hex: 'yL5' },
      { id: 'k', def: 'am.L91', side: 'am', hex: 'yL5' },
    ]);
    const offers = types(engine, s0).filter((a) => a.type === 'rally.recombine');
    expect(offers.map((a) => (a['units'] as string[]).join('+'))).toEqual(['a+b']);
    events = [];
    const s = step(act(engine, s0, offers[0]!));
    expect(s.pieces['a']!.defId).toBe('am.768');
    expect(s.pieces['b']!.loc.kind).toBe('eliminated');
    expect(s.pieces['w']!.loc).toEqual({ kind: 'held', by: 'a' });
    expect(events.some((e) => e.type === 'sk1.casualty')).toBe(false);
    expect(events.some((e) => e.type === 'sk4.usmc.recombined')).toBe(true);
    expect(s.pieces['a']!.tags['rphAction']).toBe(true);
    // No 7-6-8 in the OB: no recombining.
    const none = game([{ id: 'a', def: 'am.348h', side: 'am', hex: 'yK5' }, { id: 'b', def: 'am.348h', side: 'am', hex: 'yK5' }, { id: 'l', def: 'am.L91', side: 'am', hex: 'yK5' }], { forces: false });
    expect(types(none.engine, none.state).some((a) => a.type === 'rally.recombine')).toBe(false);
  });

  it('the recombined squad is a 7-6-8 in every respect: 7 FP, range 6, a squad for stacking', () => {
    const { engine, state: s0 } = game([{ id: 'a', def: 'am.348h', side: 'am', hex: 'yK5' }, { id: 'b', def: 'am.348h', side: 'am', hex: 'yK5' }, { id: 'l', def: 'am.L91', side: 'am', hex: 'yK5' }]);
    const s = step(act(engine, s0, { type: 'rally.recombine', units: ['a', 'b'], leader: 'l' }));
    const env = engine.env(s);
    expect(env.query('fire.partFp', { attack: { mode: 'prep', side: 'am', target: 'yM5', parts: [], targets: [] } as never, part: { kind: 'inherent', piece: 'a', firer: 'a', dist: 2, range: 6 } as never }, 7)).toBe(7);
    expect(env.query('unit.mf', { unit: 'a', stack: ['a'], doubleTime: false }, 0)).toBe(4);
    expect(s.pieces['a']!.tags['deployedFrom']).toBeUndefined();
  });

  it('Raiders ambush at -1', () => {
    const { engine, state } = makeEngine({ scenario: SC as never, extra, terrain: {}, startPhase: 'CCPh', pieces: [{ id: 'r', def: 'am.558r', side: 'am', hex: 'yK5' }, { id: 'j', def: 'ja.447', side: 'ja', hex: 'yK5' }] });
    const env = engine.env(state);
    expect(env.query('cc.ambushDrm', { hex: 'yK5', side: 'am', units: ['r'] }, 0)).toBe(-1);
  });
});
