import { describe, expect, it } from 'vitest';
import type { Action, Engine, GameState } from '@asl/engine';
import { sk2CoreModules } from '../src/sk2';
import { sk3CoreModules } from '../src/sk3';
import { caChangeDrm, hullTurnFor, inCoveredArc, nearestSpine, spineChange, statics } from '../src';
import { T3, tcaOf } from '../src/sk3/status';
import { T2 } from '../src/sk2/status';
import { RU_VS_GE, act, makeEngine, type PieceSpec } from './fixtures';

/*
 * Turning the hull to fire a bow-mounted weapon (SK4 3.2.4: a "Gun/MA/BMG/CMG may only fire within its CA but may ...
 * change its CA prior to firing"; 3.3.2: "A TCA/VCA may also be changed without MP expenditure as a result of firing
 * outside the CA during any fire phase (other than its own MPh)"; 7.8: "These same principles apply to bow-mounted
 * weapons if changing the VCA to fire. If the VCA changes, the TCA changes the same number of hexspines relative to the
 * VCA", with case 8 "BMG = NT"). And the end-of-phase change of SK4 3.3.2 ("A TCA/VCA may also be changed ... at the end
 * of any fire phase in which it is still eligible to fire a turret/bow mounted weapon"), hull and turret in one change.
 */

const extra = [...sk2CoreModules, ...sk3CoreModules];
const GE_FIRST = { ...RU_VS_GE, firstSide: 'ge' };
const pziv = (hex: string, tags: Record<string, string | number | boolean> = {}): PieceSpec => ({ id: 'pziv', def: 'ge.pzivf2', side: 'ge', hex, tags: { vca: 0, ca: 0, ...tags } });
const stug = (hex: string, tags: Record<string, string | number | boolean> = {}): PieceSpec => ({ id: 'stug', def: 'ge.stug3g', side: 'ge', hex, tags: { vca: 0, ca: 0, ...tags } });
const squad = (hex: string): PieceSpec => ({ id: 'sq', def: 'ru.447', side: 'ru', hex });
const geGame = (pieces: PieceSpec[], dice: number[], startPhase = 'MPh', terrain?: Record<string, { terrain: string }>) => makeEngine({ pieces, scenario: GE_FIRST, extra, startPhase, dice, ...(terrain ? { terrain: terrain as never } : {}) });
const passDff = (engine: Engine, s: GameState) => {
  while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
  return s;
};
const play = (engine: Engine, state: GameState, ...actions: (Omit<Action, 'decisionId' | 'side'> & { side?: string })[]) => {
  let s = state;
  for (const a of actions) s = passDff(engine, act(engine, s, a).state);
  return s;
};
const toPhase = (engine: Engine, s: GameState, phase: string) => {
  for (let i = 0; i < 20 && s.phase !== phase; i++) s = passDff(engine, act(engine, s, { type: 'endPhase' }).state);
  return s;
};
const refusal = (engine: Engine, s: GameState, a: object) => engine.validate(s, { ...a, side: engine.currentDecision(s)!.owner, decisionId: engine.currentDecision(s)!.id } as never);
const ev = (r: { events: { type: string; payload: unknown }[] }, type: string) => r.events.filter((e) => e.type === type).map((e) => e.payload as Record<string, unknown>);
const labels = (p: Record<string, unknown>) => ((p['explain'] as { label: string }[] | undefined) ?? []).map((n) => n.label);
/** The hexspine the hull must face from `from` for `target` to lie in its arc. */
const spineFor = (engine: Engine, s: GameState, from: string, target: string, current = 0) => {
  const map = statics(engine.env(s)).map;
  return nearestSpine(map.hex(from)!.cube, current, map.hex(target)!.cube)!;
};
/** The panzer moves one hex in its MPh without firing and comes to its AFPh. */
const movedToAfph = (pieces: PieceSpec[], dice: number[]) => {
  const { engine, state } = geGame(pieces, dice);
  let s = play(engine, state, { type: 'vmove.start', vehicle: 'pziv' }, { type: 'move.step', to: 'yM8' }, { type: 'vmove.stop' }, { type: 'vmove.end' });
  s = toPhase(engine, s, 'AFPh');
  return { engine, s };
};

describe('a bow MG turning the hull to fire (SK4 3.2.4, 3.3.2, 7.8)', () => {
  it('after moving, the BMG turns the hull in the AFPh at the NT case 8; the turret rides round the same hexspines', () => {
    // Hull faces spine 0 in M8, the turret one spine off it; the squad in H9 lies outside the hull's arc.
    const { engine, s } = movedToAfph([pziv('yM9', { ca: 1 }), squad('yH9')], Array(12).fill(3));
    const vca = spineFor(engine, s, 'yM8', 'yH9');
    const spines = spineChange(0, vca);
    expect(spines).toBeGreaterThan(0);
    // What the fire composer declares (`hullTurnFor`): the hull turn for the BMG alone, none with the CMG too (that
    // attack turns the turret), none once the target is in the arc.
    expect(hullTurnFor(engine.env(s), { sw: ['pziv.bmg'], target: 'yH9' })).toBe(vca);
    expect(hullTurnFor(engine.env(s), { sw: ['pziv.bmg', 'pziv.cmg'], target: 'yH9' })).toBeUndefined();
    expect(hullTurnFor(engine.env(s), { sw: ['pziv.cmg'], target: 'yH9' })).toBeUndefined();
    // Without the turn the BMG is refused; with it, accepted.
    expect(refusal(engine, s, { type: 'fire', decl: { units: [], sw: ['pziv.bmg'], target: 'yH9' } })).toMatch(/Vehicle Covered Arc: turn first/);
    expect(refusal(engine, s, { type: 'fire', decl: { units: [], sw: ['pziv.bmg'], target: 'yH9', vca } })).toBeNull();
    const r = act(engine, s, { type: 'fire', decl: { units: [], sw: ['pziv.bmg'], target: 'yH9', vca } });
    const p = r.state.pieces['pziv']!;
    expect(p.tags[T3.vca]).toBe(vca);
    // "If the VCA changes, the TCA changes the same number of hexspines relative to the VCA": one spine off the hull still.
    expect(tcaOf(engine.env(r.state), p)).toBe((1 + vca) % 6);
    expect(labels(ev(r, 'sk1.fire.attack')[0]!)).toContain(`+${caChangeDrm('NT', spines)} Covered Arc change`);
  });

  it('an NT vehicle: the MA turning the hull first leaves the BMG the same NT penalty; a tank\'s turret weapons owe none', () => {
    const { engine, state } = geGame([stug('yM8'), squad('yH9')], Array(12).fill(3), 'PFPh');
    const ca = spineFor(engine, state, 'yM8', 'yH9');
    const drm = caChangeDrm('NT', spineChange(0, ca));
    const ma = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'stug', target: 'yH9', targetType: 'ITT', ca } });
    expect(ma.state.pieces['stug']!.tags[T3.vca]).toBe(ca);
    const mg = act(engine, ma.state, { type: 'fire', decl: { units: [], sw: ['stug.bmg'], target: 'yH9' } });
    expect(labels(ev(mg, 'sk1.fire.attack')[0]!)).toContain(`+${drm} Covered Arc change (the hull turned earlier this phase)`);
    // A tank's BMG turning the hull leaves its CMG nothing to owe: the turret did not turn of its own. The CMG fires at
    // another squad in the TCA the hull carried round.
    const map = statics(engine.env(state)).map;
    const other = ['yH8', 'yI9', 'yI8', 'yG9', 'yH10', 'yI10'].find((h) => inCoveredArc(map.hex('yM8')!.cube, ca, map.hex(h)!.cube))!;
    expect(other).toBeDefined();
    const t = geGame([pziv('yM8'), squad('yH9'), { id: 'sq2', def: 'ru.447', side: 'ru', hex: other }], Array(12).fill(3), 'PFPh');
    const bmg = act(t.engine, t.state, { type: 'fire', decl: { units: [], sw: ['pziv.bmg'], target: 'yH9', vca: ca } });
    const cmg = act(t.engine, bmg.state, { type: 'fire', decl: { units: [], sw: ['pziv.cmg'], target: other } });
    expect(labels(ev(cmg, 'sk1.fire.attack')[0]!).some((l) => /Covered Arc change/.test(l))).toBe(false);
  });

  it('the BMG turning the hull first leaves the NT MA the same penalty on its To Hit DR', () => {
    const { engine, state } = geGame([stug('yM8'), squad('yH9')], Array(12).fill(3), 'PFPh');
    const ca = spineFor(engine, state, 'yM8', 'yH9');
    const mg = act(engine, state, { type: 'fire', decl: { units: [], sw: ['stug.bmg'], target: 'yH9', vca: ca } });
    expect(mg.state.pieces['stug']!.tags[T2.ca]).toBe(ca);
    const ma = act(engine, mg.state, { type: 'fire.ordnance', shot: { weapon: 'stug', target: 'yH9', targetType: 'ITT' } });
    expect(labels(ev(ma, 'sk2.ordnance.shot')[0]!)).toContain(`+${caChangeDrm('NT', spineChange(0, ca))} Covered Arc change (the hull turned earlier this phase)`);
  });

  it('refused in its own MPh, for a turret weapon alone, with a turret turn too, and for a hull that may not turn', () => {
    // Bounding First Fire: the hull turns only for MP (SK4 3.3.2 "other than its own MPh").
    const { engine, state } = geGame([pziv('yM8'), squad('yH9')], [3, 3, 3, 3]);
    const vca = spineFor(engine, state, 'yM8', 'yH9');
    const s = play(engine, state, { type: 'vmove.start', vehicle: 'pziv' }, { type: 'vmove.stop' });
    expect(refusal(engine, s, { type: 'vmove.bffMg', decl: { units: [], sw: ['pziv.bmg'], target: 'yH9', vca } })).toMatch(/turns its hull only by spending MP/);
    const p = geGame([pziv('yM8'), squad('yH9')], [], 'PFPh');
    expect(refusal(p.engine, p.state, { type: 'fire', decl: { units: [], sw: ['pziv.cmg'], target: 'yH9', vca } })).toMatch(/Only the bow-mounted weapons/);
    expect(refusal(p.engine, p.state, { type: 'fire', decl: { units: [], sw: ['pziv.bmg'], target: 'yH9', vca, tca: vca } })).toMatch(/hull or the turret, not both/);
    // Immobilized or Bogged: the hull may not turn (SK4 glossary, 7.6), for the BMG nor for an NT MA.
    for (const tag of [{ [T3.immob]: true }, { [T3.bog]: 'bogged' }] as Record<string, string | boolean>[]) {
      const t = geGame([pziv('yM8', tag), squad('yH9')], [], 'PFPh');
      expect(refusal(t.engine, t.state, { type: 'fire', decl: { units: [], sw: ['pziv.bmg'], target: 'yH9', vca } })).toMatch(/Immobilized or Bogged/);
      const n = geGame([stug('yM8', tag), squad('yH9')], [], 'PFPh');
      expect(refusal(n.engine, n.state, { type: 'fire.ordnance', shot: { weapon: 'stug', target: 'yH9', targetType: 'ITT', ca: vca } })).toMatch(/Immobilized or Bogged/);
    }
  });

  it('in woods each hexspine takes a Bog Check (SK4 7.6): bogging stops the hull, and the attack is not made', () => {
    const { engine, state } = geGame([pziv('yM8'), squad('yH9')], [6, 6, 3, 3], 'PFPh', { yM8: { terrain: 'woods' } });
    const vca = spineFor(engine, state, 'yM8', 'yH9');
    const r = act(engine, state, { type: 'fire', decl: { units: [], sw: ['pziv.bmg'], target: 'yH9', vca } });
    const p = r.state.pieces['pziv']!;
    expect(p.tags[T3.bog]).toBe('bogged');
    expect(p.tags[T3.vca]).toBe(0);
    expect(ev(r, 'sk1.fire.attack')).toHaveLength(0);
    expect(r.state.pieces['pziv.bmg']!.tags['fire']).toBeUndefined();
  });

  it('the hull-turn record comes off with the Player Turn: next turn the BMG fires in its arc with no penalty and the tank moves', () => {
    const { engine, state } = geGame([pziv('yM8'), squad('yH9')], Array(80).fill(3), 'PFPh');
    const vca = spineFor(engine, state, 'yM8', 'yH9');
    let s = act(engine, state, { type: 'fire', decl: { units: [], sw: ['pziv.bmg'], target: 'yH9', vca } }).state;
    expect(s.pieces['pziv']!.tags['vcaTurnPhase']).toBeDefined();
    for (let i = 0; i < 60 && !(s.attacker === 'ge' && s.turn === 2 && s.phase === 'PFPh'); i++) s = passDff(engine, act(engine, s, { type: engine.currentDecision(s)!.kind === 'firstFire' ? 'defPass' : 'endPhase' }).state);
    expect(s.phase).toBe('PFPh');
    for (const tag of ['vcaTurnPhase', 'vcaTurnSpines', 'vcaTurnPaid']) expect(s.pieces['pziv']!.tags[tag]).toBeUndefined();
    const again = act(engine, s, { type: 'fire', decl: { units: [], sw: ['pziv.bmg'], target: 'yH9' } });
    expect(labels(ev(again, 'sk1.fire.attack')[0]!).some((l) => /Covered Arc change/.test(l))).toBe(false);
    // The MGs Prep Fired, so the tank waits for the next Player Turn to move.
    s = again.state;
    for (let i = 0; i < 60 && !(s.attacker === 'ge' && s.turn === 3 && s.phase === 'MPh'); i++) s = passDff(engine, act(engine, s, { type: engine.currentDecision(s)!.kind === 'firstFire' ? 'defPass' : 'endPhase' }).state);
    expect(s.phase).toBe('MPh');
    s = play(engine, s, { type: 'vmove.start', vehicle: 'pziv' });
    expect(engine.legalActions(s, 'ge').some((a) => a.type === 'move.step')).toBe(true);
  });
});

describe('the end-of-phase change of hull and turret together (SK4 3.3.2 "A TCA/VCA may also be changed")', () => {
  it('turns the hull and points the turret in one change; the turret otherwise rides round with the hull (SK4 7.8)', () => {
    const { engine, s } = movedToAfph([pziv('yM9'), squad('yH9')], Array(20).fill(6));
    // Hull only: the turret rides round with it.
    expect(refusal(engine, s, { type: 'vehicle.face', vehicle: 'pziv', vca: 2 })).toBeNull();
    // Both together: the turret's spine is absolute; one equal to where the hull would carry it is no change of its own.
    expect(refusal(engine, s, { type: 'vehicle.face', vehicle: 'pziv', vca: 2, tca: 0 })).toBeNull();
    expect(refusal(engine, s, { type: 'vehicle.face', vehicle: 'pziv', vca: 2, tca: 2 })).toMatch(/rides there with the hull/);
    const r = act(engine, s, { type: 'vehicle.face', vehicle: 'pziv', vca: 2, tca: 0 });
    const p = r.state.pieces['pziv']!;
    expect(p.tags[T3.vca]).toBe(2);
    expect(p.tags[T2.ca]).toBe(0);
    // That was the vehicle's turn for the phase: no fire after it, and no second turn.
    expect(refusal(engine, r.state, { type: 'fire.ordnance', shot: { weapon: 'pziv', target: 'yH9', targetType: 'ITT' } })).toMatch(/turned its Covered Arc/);
    expect(refusal(engine, r.state, { type: 'vehicle.face', vehicle: 'pziv', tca: 3 })).toMatch(/already turned/);
  });
});
