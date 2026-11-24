import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { inCoveredArc, nearestSpine, statics } from '../src';
import { sk2CoreModules } from '../src/sk2';
import { sk3CoreModules } from '../src/sk3';
import { RU_VS_GE, act, makeEngine, type PieceSpec } from './fixtures';

/*
 * An Area Target Type hit "can potentially affect all units in the hex" (SK4 3.2.4), a stopped AFV included: it is
 * resolved against the AFV on the IFT with the same effects DR as the other units hit (SK4 7.11, 7.12; ASLRB C3.331).
 * The Infantry Target Type cannot affect an AFV (SK4 7.12). A WP hit spares a Buttoned Up, Closed-Topped AFV; the crew of
 * a CE one takes the NMC with its CE DRM (ASLRB A24.31; SK4 6.2 is silent).
 */

const ev = (events: { type: string; payload: unknown }[], type: string) => events.filter((e) => e.type === type).map((e) => e.payload as Record<string, unknown>);

/** A German squad with the 50mm Mortar in yK5; a stopped, Buttoned Up T-34 in yM5, a Russian squad with it where given. */
const game = (dice: number[], withSquad: boolean) =>
  makeEngine({
    scenario: { ...RU_VS_GE, firstSide: 'ge' },
    extra: [...sk2CoreModules, ...sk3CoreModules],
    dice,
    pieces: [
      { id: 'u', def: 'ge.467', side: 'ge', hex: 'yK5' },
      { id: 'm', def: 'ge.MTR', side: 'ge', heldBy: 'u' },
      { id: 't', def: 'ru.T34M43', side: 'ru', hex: 'yM5', tags: { vca: 0, ca: 0 } },
      ...(withSquad ? [{ id: 'q', def: 'ru.447', side: 'ru', hex: 'yM5' }] : []),
    ],
  });

describe('Area Target Type hits on a stopped vehicle (SK4 7.11)', () => {
  it('a Mortar hit on a hex holding a stopped AFV and a squad attacks both with one effects DR', () => {
    const { engine, state } = game([2, 4, 6, 6], true);
    const t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'm', target: 'yM5', targetType: 'ATT' } });
    expect(ev(t.events, 'sk2.ordnance.shot')[0]).toMatchObject({ outcome: 'hit' });
    expect(ev(t.events, 'sk3.areaHit').map((e) => e['vehicle'])).toEqual(['t']);
    expect(ev(t.events, 'sk1.fire.result').map((e) => e['unit'])).toContain('q');
  });

  it('a hit on a hex holding only the stopped AFV attacks it', () => {
    const { engine, state } = game([2, 4, 6, 6], false);
    const t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'm', target: 'yM5', targetType: 'ATT' } });
    expect(ev(t.events, 'sk3.areaHit')).toHaveLength(1);
  });
});

/** The spine a Gun in `gunHex` must point at to cover `target`. */
function spineFor(engine: Engine, state: GameState, gunHex: string, target: string): number {
  const map = statics(engine.env(state)).map;
  if (inCoveredArc(map.hex(gunHex)!.cube, 0, map.hex(target)!.cube)) return 0;
  return nearestSpine(map.hex(gunHex)!.cube, 0, map.hex(target)!.cube)!;
}

/** An American 81mm Mortar in yK5 fires WP at yO5, where a German squad and a PzKpfw IVF2 stand. */
function wpGame(dice: number[], tank: Record<string, unknown>) {
  const pieces = (ca: number): PieceSpec[] => [
    { id: 'c1', def: 'am.228c', side: 'am', hex: 'yK5' },
    { id: 'm', def: 'am.MTR81s', side: 'am', heldBy: 'c1', tags: { ca } },
    { id: 'e1', def: 'ge.467', side: 'ge', hex: 'yO5' },
    { id: 'pz', def: 'ge.pzivf2', side: 'ge', hex: 'yO5', tags: { vca: 0, ca: 0, ...tank } },
  ];
  const extra = [...sk2CoreModules, ...sk3CoreModules];
  const probe = makeEngine({ extra, pieces: pieces(0) });
  return makeEngine({ extra, dice, pieces: pieces(spineFor(probe.engine, probe.state, 'yK5', 'yO5')) });
}

describe('WP hits on vehicles (ASLRB A24.31)', () => {
  it('a Buttoned Up, Closed-Topped AFV takes no NMC; the squad with it does, and the tank goes on as it was', () => {
    // 2+3 hits (< WP8); NMC for the squad 3+3.
    const { engine, state } = wpGame([2, 3, 3, 3], {});
    const t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'm', target: 'yO5', targetType: 'ATT', ammo: 'WP' } });
    expect(ev(t.events, 'sk2.ordnance.wp')).toHaveLength(1);
    expect(ev(t.events, 'sk1.check').map((e) => e['unit'])).toEqual(['e1']);
    expect(ev(t.events, 'sk3.vehicle.check')).toHaveLength(0);
    expect(t.state.pieces['pz']!.tags['broken']).toBeUndefined();
  });

  it('the crew of a CE AFV takes the NMC with its CE DRM helping, never an Infantry MC', () => {
    // NMC for the squad 3+3; the crew rolls 6+5 = 11, -2 CE = 9 > crew morale: it fails and the AFV is Stunned.
    const { engine, state } = wpGame([2, 3, 3, 3, 6, 5], { ce: true });
    const t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'm', target: 'yO5', targetType: 'ATT', ammo: 'WP' } });
    expect(ev(t.events, 'sk1.check').map((e) => e['unit'])).toEqual(['e1']);
    expect(ev(t.events, 'sk3.vehicle.check')[0]).toMatchObject({ vehicle: 'pz', kind: 'MC', dr: [6, 5], mod: -2 });
  });
});
