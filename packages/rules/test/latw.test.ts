import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { fireMarker, leaderDirectsGunModule, ordnanceDirectorIllegal, shotContext, shownFireMarker, simpleDeclarations, sk2CoreModules } from '../src';
import { sk3CoreModules } from '../src/sk3';
import { GE_VS_BR, RU_VS_GE, act, makeEngine } from './fixtures';

/*
 * Light Anti-Tank Weapons (SK4 4.4, 4.4.1, 4.4.3, 6.1): a Bazooka fires HEAT on the To Hit Table on
 * its counter back, only at Infantry in a building or at a Gun; a hit attacks on the 8 FP column
 * (16 on a Critical Hit, an original 2); an original TH DR ≥ X# removes it; fired from inside a
 * building it takes +2 or the Backblast.
 */

const ev = (events: { type: string; payload: unknown }[], type: string) => events.filter((e) => e.type === type).map((e) => e.payload as Record<string, unknown>);
const illegal = (engine: Engine, state: GameState, shot: Record<string, unknown>, mode = 'prep') =>
  engine.env(state).query('ordnance.illegal', { shot: shot as never, mode: mode as never, side: 'ge' }, null);

/** A German unit with the BAZ in yK5, British squads where given. */
function bazGame(holder: string, squads: Record<string, string>, dice: number[] = [], terrain: Record<string, { terrain: string }> = {}, extra: { id: string; def: string; hex: string }[] = []) {
  return makeEngine({
    scenario: GE_VS_BR,
    extra: sk2CoreModules,
    terrain,
    dice,
    pieces: [
      { id: 'u', def: holder, side: 'ge', hex: 'yK5' },
      { id: 'z', def: 'ge.BAZ43', side: 'ge', heldBy: 'u' },
      ...extra.map((x) => ({ ...x, side: 'ge' })),
      ...Object.entries(squads).map(([id, hex]) => ({ id, def: 'br.457', side: 'br', hex })),
    ],
  });
}

const STONE = { terrain: 'building-stone' };

describe('Light Anti-Tank Weapons (SK4 4.4)', () => {
  it('LATW To Hit Example: range 2 at a squad in a stone building, TH 8 with +3 TEM; a hit attacks on the 8 column', () => {
    const { engine, state } = bazGame('ge.467', { b1: 'yM5' }, [2, 2, 4, 4, 6, 6], { yM5: STONE });
    const t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'z', target: 'yM5', targetType: 'ITT' } });
    expect(ev(t.events, 'sk2.ordnance.shot')[0]).toMatchObject({ range: 2, th: 8, drm: 3, outcome: 'hit', ammo: 'HEAT' });
    expect(ev(t.events, 'sk1.fire.attack')[0]).toMatchObject({ fp: 8 });
    // No ROF, no Acquisition; the squad has used a SW and keeps its own FP.
    expect(ev(t.events, 'sk2.ordnance.rof')).toHaveLength(0);
    expect(t.state.pieces['z']!.tags['acq']).toBeUndefined();
    expect(t.state.pieces['u']!.tags['firedSw']).toBe(true);
    expect(t.state.pieces['u']!.tags['ownFpForfeit']).toBeUndefined();
  });

  it('LATW To Hit Example: having used its SW, the squad then fires its inherent FP, at another target or the same one; no Intensive Fire for the BAZ', () => {
    // A miss from a stone building at +2 (no Backblast), as in play; the squad's own FP is still free (SK4 4.0: "any one
    // Weapon at no cost to its own FP"), and Mandatory Fire Group does not bind Ordnance (SK4 4.4 example).
    const inside = { yK5: STONE, yM5: STONE };
    const { engine, state } = bazGame('ge.467', { b1: 'yM5', b2: 'yN5' }, [5, 3, ...Array(40).fill(6)], inside);
    let s = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'z', target: 'yM5', targetType: 'ITT', backblast: false } }).state;
    const env = engine.env(s);
    expect(fireMarker(s.pieces['u']!)).toBeUndefined();
    // A SW never uses Intensive Fire (SK4 glossary: "a Gun or vehicle"; the 50mm MTR example: "Since the 50mm MTR is a SW, it cannot Intensive Fire").
    expect(illegal(engine, s, { weapon: 'z', target: 'yM5', targetType: 'ITT', backblast: false, intensive: true })).toMatch(/SW cannot use Intensive Fire/);
    expect(engine.legalActions(s, 'ge').filter((a) => a.type === 'fire.ordnance')).toHaveLength(0);
    // The squad's own FP is offered at both enemy hexes, and either shot is accepted.
    const offered = engine.legalActions(s, 'ge').filter((a) => a.type === 'fire').map((a) => (a as unknown as { decl: unknown }).decl);
    expect(offered).toEqual(expect.arrayContaining([{ units: ['u'], sw: [], target: 'yM5' }, { units: ['u'], sw: [], target: 'yN5' }]));
    expect(simpleDeclarations(env, 'ge', ['yM5', 'yN5'], 'prep')).toContainEqual({ units: ['u'], sw: [], target: 'yN5' });
    expect(act(engine, s, { type: 'fire', decl: { units: ['u'], sw: [], target: 'yM5' } }).state.pieces['u']!.tags['fire']).toBe('prep');
    s = act(engine, s, { type: 'fire', decl: { units: ['u'], sw: [], target: 'yN5' } }).state;
    expect(fireMarker(s.pieces['u']!)).toBe('prep');
    expect(engine.legalActions(s, 'ge').some((a) => a.type === 'fire' && JSON.stringify(a).includes('"u"'))).toBe(false);
    // Into the next German Player Turn: every marker is off, and the squad fires the BAZ and its own FP again.
    for (let i = 0; i < 40 && !(s.turn === 2 && s.attacker === 'ge' && s.phase === 'PFPh'); i++) s = act(engine, s, { type: 'endPhase' }).state;
    expect([s.turn, s.attacker, s.phase]).toEqual([2, 'ge', 'PFPh']);
    for (const id of ['u', 'z']) expect([fireMarker(s.pieces[id]!), s.pieces[id]!.tags['firedSw'], s.pieces[id]!.tags['firedSwAs']]).toEqual([undefined, undefined, undefined]);
    expect(illegal(engine, s, { weapon: 'z', target: 'yM5', targetType: 'ITT', backblast: false })).toBeNull();
    expect(engine.legalActions(s, 'ge').some((a) => a.type === 'fire' && JSON.stringify(a).includes('"u"'))).toBe(true);
  });

  it('a Critical Hit is an original 2 that hits: the 16 column with the TEM reversed', () => {
    const { engine, state } = bazGame('ge.467', { b1: 'yM5' }, [1, 1, 4, 4, 6, 6], { yM5: STONE });
    const t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'z', target: 'yM5', targetType: 'ITT' } });
    expect(ev(t.events, 'sk2.ordnance.shot')[0]).toMatchObject({ outcome: 'ch' });
    expect(ev(t.events, 'sk1.fire.attack')[0]).toMatchObject({ fp: 16, drm: -3 });
  });

  it('an original TH DR ≥ X10 removes it for good', () => {
    const { engine, state } = bazGame('ge.467', { b1: 'yM5' }, [5, 5, 6, 6], { yM5: STONE });
    const t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'z', target: 'yM5', targetType: 'ITT' } });
    expect(t.state.pieces['z']!.loc.kind).toBe('eliminated');
    expect(t.state.pieces['z']!.tags['malf']).toBeUndefined();
  });

  it('its possessor wears the Prep Fire marker once the BAZ is gone (SK1 3.2.2), so the MPh shows why he cannot move', () => {
    const { engine, state } = bazGame('ge.467', { b1: 'yM5' }, [5, 5, 6, 6], { yM5: STONE });
    let s = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'z', target: 'yM5', targetType: 'ITT' } }).state;
    expect(s.pieces['z']!.loc.kind).toBe('eliminated');
    // His own FP is still free to fire, so he carries no marker of his own: the shown one comes from the SW shot.
    expect(fireMarker(s.pieces['u']!)).toBeUndefined();
    expect(shownFireMarker(s.pieces['u']!)).toBe('prep');
    s = act(engine, s, { type: 'endPhase' }).state;
    expect(s.phase).toBe('MPh');
    expect(shownFireMarker(s.pieces['u']!)).toBe('prep');
    expect(() => act(engine, s, { type: 'move.start', units: ['u'] })).toThrow(/fired in the PFPh/);
    // Prep Fire comes off at the end of the AFPh (SK1 3.5).
    s = act(engine, s, { type: 'endPhase' }).state;
    expect(s.phase).toBe('DFPh');
    s = act(engine, s, { type: 'endPhase' }).state;
    expect(s.phase).toBe('AFPh');
    expect(shownFireMarker(s.pieces['u']!)).toBe('prep');
    s = act(engine, s, { type: 'endPhase' }).state;
    expect(s.phase).toBe('APh'); // nobody is broken, so the RtPh is skipped
    expect(shownFireMarker(s.pieces['u']!)).toBeUndefined();
    expect(s.pieces['u']!.tags['firedSwAs']).toBeUndefined();
  });

  it('fires only at Infantry in a building (or a Gun), on the Infantry Target Type, within its range; never by a single SMC', () => {
    const { engine, state } = bazGame('ge.467', { b1: 'yM5', b2: 'yN5', b3: 'yP5' }, [], { yM5: STONE, yP5: STONE });
    expect(illegal(engine, state, { weapon: 'z', target: 'yM5', targetType: 'ITT' })).toBeNull();
    expect(illegal(engine, state, { weapon: 'z', target: 'yN5', targetType: 'ITT' })).toMatch(/Infantry in a building or at a Gun/);
    expect(illegal(engine, state, { weapon: 'z', target: 'yM5', targetType: 'ATT' })).toMatch(/Infantry Target Type/);
    expect(illegal(engine, state, { weapon: 'z', target: 'yP5', targetType: 'ITT' })).toMatch(/maximum range|Out of range/);
    const lone = bazGame('ge.L81', { b1: 'yM5' }, [], { yM5: STONE });
    expect(illegal(lone.engine, lone.state, { weapon: 'z', target: 'yM5', targetType: 'ITT' })).toMatch(/single SMC/);
    const two = bazGame('ge.L81', { b1: 'yM5' }, [], { yM5: STONE }, [{ id: 'l2', def: 'ge.L91', hex: 'yK5' }]);
    expect(illegal(two.engine, two.state, { weapon: 'z', target: 'yM5', targetType: 'ITT' })).toBeNull();
  });

  it('its possessor still fires its own FP on the IFT: the offered attacks leave the BAZ out rather than offering none', () => {
    // A stack holding a BAZ was never interrupted for Defensive First Fire: the one attack offered took the BAZ along.
    const { engine, state } = bazGame('ge.467', { b1: 'yP5' });
    const env = engine.env(state);
    for (const mode of ['prep', 'first'] as const) {
      expect(simpleDeclarations(env, 'ge', ['yP5'], mode)).toContainEqual({ units: ['u'], sw: [], target: 'yP5' });
    }
  });

  it('may Advancing Fire after its possessor moved, at +2 (chart case 12)', () => {
    const { engine, state } = makeEngine({
      scenario: GE_VS_BR,
      extra: sk2CoreModules,
      terrain: { yM5: STONE, yK5: { terrain: 'woods' } },
      pieces: [
        { id: 'u', def: 'ge.467', side: 'ge', hex: 'yK5', tags: { moved: true } },
        { id: 'z', def: 'ge.BAZ43', side: 'ge', heldBy: 'u' },
        { id: 'b1', def: 'br.457', side: 'br', hex: 'yM5' },
      ],
    });
    const shot = { weapon: 'z', target: 'yM5', targetType: 'ITT' } as never;
    expect(illegal(engine, state, shot, 'advancing')).toBeNull();
    const drm = engine.env(state).explain('ordnance.thDrm', shotContext(engine.env(state), shot, 'advancing', 'ge'), 0);
    // +3 TEM, +2 AFPh (not the Gun's +3 in woods).
    expect(drm.value).toBe(5);
  });

  it('Backblast: from a building the firer takes +2, or everyone in its hex takes 1 FP on the colored dr with no TEM', () => {
    const inside = { yK5: STONE, yM5: STONE };
    let g = bazGame('ge.467', { b1: 'yM5' }, [3, 3, 6, 6], inside);
    let t = act(g.engine, g.state, { type: 'fire.ordnance', shot: { weapon: 'z', target: 'yM5', targetType: 'ITT' } });
    expect(ev(t.events, 'sk2.ordnance.shot')[0]).toMatchObject({ drm: 5 });
    expect(ev(t.events, 'sk1.fire.attack').some((a) => a['fp'] === 1)).toBe(false);

    // Backblast: no +2; DR 6+1 = 7, +3 TEM, misses TH 8; the colored 1 is a 1 FP attack on the firer's hex.
    g = bazGame('ge.467', { b1: 'yM5' }, [6, 1, 6, 6, 6, 6], inside);
    t = act(g.engine, g.state, { type: 'fire.ordnance', shot: { weapon: 'z', target: 'yM5', targetType: 'ITT', backblast: true } });
    expect(ev(t.events, 'sk2.ordnance.shot')[0]).toMatchObject({ drm: 3, outcome: 'miss' });
    expect(ev(t.events, 'sk1.fire.attack').find((a) => a['fp'] === 1)).toMatchObject({ dr: [1, 0], drm: 0 });

    // Outside a building there is no Backblast to choose.
    const out = bazGame('ge.467', { b1: 'yM5' }, [], { yM5: STONE });
    expect(illegal(out.engine, out.state, { weapon: 'z', target: 'yM5', targetType: 'ITT', backblast: true })).toMatch(/Backblast only/);
  });
});

describe('PIAT (SK4 4.4.5)', () => {
  /** A British unit with the PIAT in yK5, German squads where given. */
  const piatGame = (holder: string, targets: Record<string, string>, dice: number[] = [], terrain: Record<string, Record<string, unknown>> = {}) =>
    makeEngine({
      scenario: { ...GE_VS_BR, firstSide: 'br' },
      extra: sk2CoreModules,
      terrain: terrain as never,
      dice,
      pieces: [
        { id: 'u', def: holder, side: 'br', hex: 'yK5' },
        { id: 'p', def: 'br.PIAT', side: 'br', heldBy: 'u' },
        ...Object.entries(targets).map(([id, hex]) => ({ id, def: 'ge.467', side: 'ge', hex })),
      ],
    });
  const brIllegal = (engine: Engine, state: GameState, shot: Record<string, unknown>) =>
    engine.env(state).query('ordnance.illegal', { shot: shot as never, mode: 'prep', side: 'br' }, null);

  it('a lone leader fires it at full effect; it hits on its own To Hit Table and attacks on the 8 column', () => {
    const { engine, state } = piatGame('br.L80', { g1: 'yM5' }, [2, 2, 4, 4, 6, 6], { yM5: STONE });
    expect(brIllegal(engine, state, { weapon: 'p', target: 'yM5', targetType: 'ITT' })).toBeNull();
    const t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'p', target: 'yM5', targetType: 'ITT' } });
    expect(ev(t.events, 'sk2.ordnance.shot')[0]).toMatchObject({ range: 2, th: 7, outcome: 'hit', ammo: 'HEAT' });
    expect(ev(t.events, 'sk1.fire.attack')[0]).toMatchObject({ fp: 8 });
  });

  it('its B10 malfunctions it rather than removing it, and it is repaired like a SW', () => {
    const { engine, state } = piatGame('br.458', { g1: 'yM5' }, [5, 5, 6, 6], { yM5: STONE });
    const t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'p', target: 'yM5', targetType: 'ITT' } });
    expect(t.state.pieces['p']!.loc.kind).toBe('held');
    expect(t.state.pieces['p']!.tags['malf']).toBe(true);
  });

  it('has no Backblast from a building, and may not fire at an adjacent unit one level lower', () => {
    const { engine, state } = piatGame('br.458', { g1: 'yM5', g2: 'yL5' }, [], { yK5: { terrain: 'building-stone', elevation: 1 }, yM5: STONE });
    expect(brIllegal(engine, state, { weapon: 'p', target: 'yM5', targetType: 'ITT', backblast: true })).toMatch(/Backblast only arises/);
    const opts = engine.legalActions(state, 'br').filter((a) => a.type === 'fire.ordnance' && (a as unknown as { shot: { weapon: string } }).shot.weapon === 'p');
    expect(opts.some((a) => (a as unknown as { shot: { backblast?: boolean } }).shot.backblast !== undefined)).toBe(false);
    expect(brIllegal(engine, state, { weapon: 'p', target: 'yL5', targetType: 'ITT' })).toMatch(/one level lower/);
  });
});

describe('Leaders and ordnance To Hit (ASL A7.531)', () => {
  const gunGame = (leader: string, ssr = false) =>
    makeEngine({
      scenario: {
        ...GE_VS_BR,
        firstSide: 'br',
        ...(ssr ? { ssr: [{ module: 'leader-directs-gun', params: { side: 'br', leaders: ['br.L91'], guns: ['br.AT57L'] }, text: 'SSR 2' }] } : {}),
      },
      extra: [...sk2CoreModules, ...(ssr ? [leaderDirectsGunModule] : [])],
      pieces: [
        { id: 'c', def: 'br.228c', side: 'br', hex: 'yK5' },
        { id: 'g', def: 'br.AT57L', side: 'br', heldBy: 'c', tags: { ca: 0 } },
        { id: 'l', def: leader, side: 'br', hex: 'yK5' },
        { id: 'u', def: 'br.458', side: 'br', hex: 'yK5' },
        { id: 'p', def: 'br.PIAT', side: 'br', heldBy: 'u' },
      ],
    });
  it('a leader modifies an ordnance SW’s To Hit DR but never a Gun’s', () => {
    const { engine, state } = gunGame('br.L91');
    const env = engine.env(state);
    expect(ordnanceDirectorIllegal(env, 'p', 'l', 'br', 'ITT')).toBeNull();
    expect(ordnanceDirectorIllegal(env, 'g', 'l', 'br', 'ITT')).toMatch(/A7\.531/);
  });
  it('S23 SSR 2: the named leader may, stacked with the manning crew, as if it were a SW; another leader still may not', () => {
    const ok = gunGame('br.L91', true);
    expect(ordnanceDirectorIllegal(ok.engine.env(ok.state), 'g', 'l', 'br', 'ITT')).toBeNull();
    const other = gunGame('br.L81', true);
    expect(ordnanceDirectorIllegal(other.engine.env(other.state), 'g', 'l', 'br', 'ITT')).toMatch(/A7\.531/);
  });
});

describe('A leader directing an ordnance shot', () => {
  it('takes his leadership off the To Hit DR and is marked as having fired', () => {
    const { engine, state } = makeEngine({
      scenario: { ...GE_VS_BR, firstSide: 'br' },
      extra: sk2CoreModules,
      terrain: { yM5: STONE },
      dice: [2, 2, 4, 4, 6, 6],
      pieces: [
        { id: 'u', def: 'br.458', side: 'br', hex: 'yK5' },
        { id: 'p', def: 'br.PIAT', side: 'br', heldBy: 'u' },
        { id: 'l', def: 'br.L91', side: 'br', hex: 'yK5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yM5' },
      ],
    });
    const t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'p', target: 'yM5', targetType: 'ITT', director: 'l' } });
    // +3 stone building TEM, -1 leadership.
    expect(ev(t.events, 'sk2.ordnance.shot')[0]).toMatchObject({ drm: 2 });
    expect(t.state.pieces['l']!.tags['fire']).toBe('prep');
  });
});

describe('LATW against a vehicle (SK4 4.4)', () => {
  it('a Bazooka aims at a tank on the Vehicle Target Type: a hit rolls HEAT To Kill against its armor', () => {
    const { engine, state } = makeEngine({
      scenario: { ...RU_VS_GE, firstSide: 'ge' },
      extra: [...sk2CoreModules, ...sk3CoreModules],
      startPhase: 'PFPh',
      dice: [2, 2, 3, 3],
      pieces: [
        { id: 'u', def: 'ge.467', side: 'ge', hex: 'yK5' },
        { id: 'z', def: 'ge.BAZ43', side: 'ge', heldBy: 'u' },
        { id: 't34', def: 'ru.T34M43', side: 'ru', hex: 'yK6', tags: { vca: 0, ca: 0 } },
      ],
    });
    expect(illegal(engine, state, { weapon: 'z', target: 'yK6', targetType: 'VTT' })).toBeNull();
    // Not in a building and no Gun there: the Infantry Target Type is still barred.
    expect(illegal(engine, state, { weapon: 'z', target: 'yK6', targetType: 'ITT' })).toMatch(/HEAT may only be fired/);
    const r = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'z', target: 'yK6', targetType: 'VTT' } });
    expect(ev(r.events, 'sk2.ordnance.shot')[0]).toMatchObject({ outcome: 'hit', ammo: 'HEAT', range: 1 });
    expect(ev(r.events, 'sk3.toKill')[0]).toMatchObject({ tk: 13 });
  });
});
