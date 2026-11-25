import { describe, expect, it } from 'vitest';
import type { GameState } from '@asl/engine';
import { act, type PieceSpec } from '../fixtures';
import { bed, ev, vttShot, type Eng } from './hullDownBed';

/*
 * Hull Down beneath a trench (ASLRB B27.52, D4.2, D4.22, D4.223, C3.9, C3.331, B9.33; Q&A [K33] to B27.52): only a turret
 * hit counts against Direct Fire ordnance, a CH is a turret hit, no Case Q TEM or Height Advantage with it, the trench's +2
 * against Indirect Fire, and no BMG fire at a target the vehicle is HD to. The ground is a stretch of board u: L4 woods,
 * P3 a level 1 hill hex with a two-level stone house (its level 1 at height 2), everything else Open Ground.
 */

const fire = (engine: Eng, s: GameState, shot: Record<string, unknown>) => act(engine, s, { type: 'fire.ordnance', shot });

describe('D4.2, C3.9: only a turret hit counts against a vehicle beneath a trench', () => {
  it('a hull hit (colored dr ≥ white dr) has no effect; the same hit on a tank on top of the trench is resolved', () => {
    const hd = bed({ dice: [2, 3, 6, 6] });
    const r = fire(hd.engine, hd.state, vttShot(hd.engine, hd.state));
    expect(ev(r, 'sk2.ordnance.shot')[0]).toMatchObject({ outcome: 'hit' });
    expect(ev(r, 'asl.hd.hullHit')[0]).toMatchObject({ target: 't34', kind: 'trench' });
    expect(ev(r, 'sk3.toKill')).toHaveLength(0);
    const top = bed({ onTop: true, dice: [2, 3, 6, 6] });
    const r2 = fire(top.engine, top.state, vttShot(top.engine, top.state));
    expect(ev(r2, 'sk3.toKill')[0]).toMatchObject({ target: 't34', location: 'hull' });
  });

  it('a turret hit is resolved as usual and can destroy it', () => {
    const { engine, state } = bed({ dice: [3, 2, 1, 1] });
    const r = fire(engine, state, vttShot(engine, state));
    expect(ev(r, 'asl.hd.hullHit')).toHaveLength(0);
    expect(ev(r, 'sk3.toKill')[0]).toMatchObject({ target: 't34', location: 'turret', result: 'kill' });
  });

  it('a Critical Hit is always a turret hit (C3.9 EXC), on an Original 2', () => {
    const { engine, state } = bed({ dice: [1, 1, 6, 6] });
    const r = fire(engine, state, vttShot(engine, state));
    expect(ev(r, 'sk2.ordnance.shot')[0]).toMatchObject({ outcome: 'ch' });
    expect(ev(r, 'sk3.toKill')[0]).toMatchObject({ ch: true, location: 'turret' });
  });

  it('no Case Q TEM with HD (D4.2): the woods +1 To Hit is not added against the tank beneath the trench there', () => {
    const shotDrm = (onTop: boolean) => {
      const x = bed({ hex: 'uL4', onTop, dice: [6, 6] });
      let r = fire(x.engine, x.state, vttShot(x.engine, x.state, 'pz', 'uL4'));
      // Beneath the trench in the woods its owner is asked first (B9.36): Hull Down.
      if (x.engine.currentDecision(r.state)?.kind === 'hdChoice') r = act(x.engine, r.state, { type: 'hd.choose', choice: 'hd' });
      const shot = ev(r, 'sk2.ordnance.shot')[0]!;
      return { drm: shot['drm'] as number, notes: (shot['explain'] as { id: string }[]).map((n) => n.id) };
    };
    const beneath = shotDrm(false);
    const top = shotDrm(true);
    expect(top.notes).toContain('sk2.th.tem');
    expect(beneath.notes).not.toContain('sk2.th.tem');
    expect(top.drm - beneath.drm).toBe(1);
  });

  it('a Direct Fire Area Target Type hit spares it a hull hit (D4.2, C3.331), with no trench +2 on the Effects DR; Indirect Fire is never HD', () => {
    const at: PieceSpec[] = [{ id: 'crew', def: 'ge.228c', side: 'ge', hex: 'uN9' }, { id: 'gun', def: 'ge.AT75L', side: 'ge', heldBy: 'crew', tags: { ca: 0 } }];
    const { engine, state } = bed({ pieces: at });
    const env = engine.env(state);
    const attack = (dice: [number, number], indirect = false) => ({ mode: 'prep', side: 'ge', target: 'uN5', parts: [{ piece: 'gun', firer: 'crew', kind: 'ordnance', hex: 'uN9', range: 99, dist: 4 }], targets: ['t34'], hindrance: 0, ordnance: { targetType: 'ATT', ch: false, column: 6, thDice: dice, ...(indirect ? { indirect } : {}) } });
    const aim = (dice: [number, number], indirect = false) => env.query('vehicle.areaHit', { attack: attack(dice, indirect) as never, vehicle: 't34' }, { location: dice[1] < dice[0] ? 'turret' : 'hull' });
    expect(aim([2, 3])).toMatchObject({ location: 'hull', spared: expect.stringMatching(/Hull Down beneath the trench/) });
    expect(aim([3, 2])).toEqual({ location: 'turret' });
    expect(aim([2, 3], true)).toEqual({ location: 'hull' });
    // The trench +2 is not added to the Effects DR of a Direct Fire hit (it grants HD instead), but is against Indirect Fire.
    const unitDrm = (indirect: boolean) => env.explain('fire.unitDrm', { attack: attack([3, 2], indirect) as never, unit: 't34' }, 0);
    expect(unitDrm(false).trace.some((t) => t.id === 'asl.ent.tem')).toBe(false);
    expect(unitDrm(true).trace.some((t) => t.id === 'asl.ent.tem' && !t.suppressedBy)).toBe(true);
    expect(unitDrm(true).value - unitDrm(false).value).toBe(2);
  });
});

describe('The trench +2 against Indirect Fire (B27.3; Q&A [K33] to B27.52, C1.55 & D9.54); HD never vs Indirect Fire (D4.2)', () => {
  it('the CE crew of the tank beneath it takes the +2 against small arms, not the CE DRM as well (D5.3)', () => {
    const g: PieceSpec = { id: 'g', def: 'ge.467', side: 'ge', hex: 'uN8' };
    const x = bed({ pieces: [g] });
    let s = act(x.engine, x.state, { type: 'test.teleport', id: 't34', hex: 'uN5', ent: 'trench' }).state;
    s = { ...s, pieces: { ...s.pieces, t34: { ...s.pieces['t34']!, tags: { ...s.pieces['t34']!.tags, ce: true } } } };
    const attack = { mode: 'prep', side: 'ge', target: 'uN5', parts: [{ piece: 'g', firer: 'g', kind: 'unit', hex: 'uN8', range: 3, dist: 3 }], targets: ['t34'], hindrance: 0 };
    const res = x.engine.env(s).explain('fire.unitDrm', { attack: attack as never, unit: 't34' }, 0);
    expect(res.value).toBe(2);
    expect(res.trace.find((t) => t.id === 'asl.ent.tem' && !t.suppressedBy)).toBeDefined();
  });
});

describe('B9.33: the firer\'s elevation advantage and the trench HD', () => {
  it('a firer two levels up at range 1 cuts the +2 to +1: HD stays, the colored dr one less for the Location of Hit', () => {
    // The PzKpfw IVF2's crew stand in for a firer at height 2 in P3's level 1 (range 1 to O3 at ground level).
    const { engine, state } = bed({ hex: 'uO3', dice: [3, 3, 6, 6] });
    const env = engine.env(state);
    const hd = env.query('vehicle.hitLocation', { vehicle: 't34', dice: [3, 3], ch: false, from: 'uP3:1' }, 'hull');
    // Colored 3 - 1 = 2 < white 3: a turret hit, where without the reduction it would be a hull hit.
    expect(hd).toBe('turret');
    expect(env.query('vehicle.hitLocation', { vehicle: 't34', dice: [3, 3], ch: false, from: 'uN9' }, 'hull')).toBe('hull');
  });
});

describe('D4.223: no BMG fire at a target the vehicle is HD to', () => {
  it('the T-34 beneath the trench may not fire its BMG at the German squad; on top of it, it may', () => {
    const illegal = (hex: string, onTop: boolean) => {
      const x = bed({ pieces: [{ id: 'g', def: 'ge.467', side: 'ge', hex }], first: 'ru', onTop });
      return x.engine.env(x.state).query('fire.illegal', { decl: { units: [], sw: ['t34.bmg'], target: hex }, mode: 'prep', side: 'ru' }, null);
    };
    // A hex in the T-34's VCA, where the BMG may fire from on top of the trench.
    const hex = ['uN4', 'uN3', 'uO4', 'uM4', 'uN6', 'uN7', 'uO5', 'uM5', 'uO6', 'uM6'].find((h) => illegal(h, true) === null)!;
    expect(hex).toBeDefined();
    expect(illegal(hex, false)).toMatch(/Hull Down beneath the trench: the bow MG cannot fire at u[A-Z]+\d+ \(ASLRB D4.223\)/);
  });
});

describe('HD across Player Turns (B27.52)', () => {
  const advanceTo = (engine: Eng, s0: GameState, phase: string, attacker: string, turn: number) => {
    let s = s0;
    for (let i = 0; i < 800 && !(s.turn === turn && s.phase === phase && s.attacker === attacker && engine.currentDecision(s)?.kind === 'phase'); i++) {
      const d = engine.currentDecision(s)!;
      const legal = engine.legalActions(s, d.owner);
      const a = legal.find((x) => x.type === 'defPass') ?? legal.find((x) => x.type === 'move.end' || x.type === 'vmove.end') ?? legal.find((x) => x.type === 'endPhase') ?? legal.find((x) => x.type === 'wa.done') ?? legal[0]!;
      s = act(engine, s, a).state;
    }
    expect(s).toMatchObject({ turn, phase, attacker });
    return s;
  };

  it('the T-34 survives a hull hit in the German PFPh, still cannot start in its MPh, fires its MA in its AFPh, and is HD to the next German shot', () => {
    // Every DR 2-3: a hull hit on the T-34 whenever it is hit.
    const { engine, state } = bed({ dice: Array.from({ length: 80 }, (_, i) => (i % 2 ? 3 : 2)) });
    let r = fire(engine, state, vttShot(engine, state));
    expect(ev(r, 'asl.hd.hullHit')).toHaveLength(1);
    let s = advanceTo(engine, r.state, 'MPh', 'ru', 1);
    expect(engine.validate(s, { type: 'vmove.start', vehicle: 't34', side: 'ru', decisionId: engine.currentDecision(s)!.id } as never)).toMatch(/Beneath the trench: no Start MP/);
    s = advanceTo(engine, s, 'AFPh', 'ru', 1);
    // Its MA fires normally (the turret turns to the target if it must).
    r = fire(engine, s, vttShot(engine, s, 't34', 'uY10', 'ITT'));
    expect(ev(r, 'sk2.ordnance.shot')[0]).toMatchObject({ weapon: 't34', target: 'uY10' });
    s = advanceTo(engine, r.state, 'PFPh', 'ge', 2);
    // Nothing of the last Player Turn is left on it, and it is still HD.
    expect(s.pieces['t34']!.tags['fire']).toBeUndefined();
    expect(s.pieces['t34']!.loc).toMatchObject({ hex: 'uN5', pos: { ent: 'trench' } });
    r = fire(engine, s, vttShot(engine, s));
    expect(ev(r, 'asl.hd.hullHit')[0]).toMatchObject({ target: 't34' });
  });
});

describe('B9.36, D4.2: Hull Down or the in-hex TEM, the owner\'s choice after the declaration', () => {
  /** The T-34 beneath the trench in the L4 woods (+1 TEM): the German shot waits for the Russian answer. */
  const asked = (dice: number[], hidden = false) => {
    const x = bed({ hex: 'uL4', dice, hidden });
    const r = act(x.engine, x.state, { type: 'fire.ordnance', shot: vttShot(x.engine, x.state, 'pz', 'uL4') });
    return { ...x, r };
  };

  it('the shot waits: no To Hit DR until the Russian owner answers, with the To Hit numbers of both', () => {
    const { engine, r } = asked([2, 3, 6, 6]);
    expect(r.events.some((e) => e.type === 'dice.rolled')).toBe(false);
    const d = engine.currentDecision(r.state)!;
    expect(d).toMatchObject({ kind: 'hdChoice', owner: 'ru', data: { vehicle: 't34', kind: 'trench', tem: 1 } });
    expect((d.data!['needHd'] as number) - (d.data!['needTem'] as number)).toBe(1);
    expect(engine.legalActions(r.state, 'ru').map((a) => a['choice'])).toEqual(['hd', 'tem']);
  });

  it('Hull Down: a hull hit misses; the in-hex TEM: the woods +1 To Hit, and the same hull hit is resolved', () => {
    const hd = asked([2, 3, 6, 6]);
    const r1 = act(hd.engine, hd.r.state, { type: 'hd.choose', choice: 'hd' });
    expect(ev(r1, 'asl.hd.hullHit')).toHaveLength(1);
    expect(ev(r1, 'sk3.toKill')).toHaveLength(0);
    const tem = asked([2, 3, 6, 6]);
    const r2 = act(tem.engine, tem.r.state, { type: 'hd.choose', choice: 'tem' });
    expect(ev(r2, 'asl.hd.hullHit')).toHaveLength(0);
    expect(ev(r2, 'sk3.toKill')[0]).toMatchObject({ target: 't34', location: 'hull' });
    expect((ev(r2, 'sk2.ordnance.shot')[0]!['drm'] as number) - (ev(r1, 'sk2.ordnance.shot')[0]!['drm'] as number)).toBe(1);
    // The choice was for that shot alone: nothing of it is left once the shot is resolved, and the German phase goes on.
    for (const s of [r1.state, r2.state]) {
      expect(s.ext['asl.hd.choice']).toBeUndefined();
      expect(s.ext['asl.hd.pending']).toBeUndefined();
      expect(hd.engine.currentDecision(s)).toMatchObject({ kind: 'phase', owner: 'ge' });
    }
  });

  it('Hull Down when time runs out; no question in Open Ground (no in-hex TEM), nor while the trench is hidden from the firer', () => {
    const x = asked([2, 3, 6, 6]);
    const timedOut = x.engine.timeout(x.r.state)!;
    expect(ev(timedOut, 'asl.hd.chosen')[0]).toMatchObject({ vehicle: 't34', choice: 'hd' });
    expect(ev(timedOut, 'asl.hd.hullHit')).toHaveLength(1);
    const open = bed({ dice: [2, 3, 6, 6] });
    const r = act(open.engine, open.state, { type: 'fire.ordnance', shot: vttShot(open.engine, open.state) });
    expect(ev(r, 'asl.hd.hullHit')).toHaveLength(1);
    const hidden = asked([2, 3, 6, 6], true);
    expect(hidden.engine.currentDecision(hidden.r.state)?.kind).not.toBe('hdChoice');
    expect(ev(hidden.r, 'asl.hd.hullHit')).toHaveLength(1);
  });
});

describe('A12.33: what reveals a hidden trench with a tank beneath it', () => {
  // Revealed by its TEM (or HD) being claimed; a LOS in Open Ground reveals it on its own account too (A12.33), so the reason is read.
  const revealed = (r: { events: { type: string; payload: unknown }[] }) => r.events.some((e) => e.type === 'asl.fort.revealed' && (e.payload as { reason: string }).reason === 'tem');
  it('a Direct Fire ordnance shot at the tank does (it claims HD); small arms at it Buttoned Up do not (immune, nothing claimed); at a CE crew they do (the +2)', () => {
    const shot = bed({ hidden: true, dice: [6, 6] });
    expect(revealed(act(shot.engine, shot.state, { type: 'fire.ordnance', shot: vttShot(shot.engine, shot.state) }))).toBe(true);
    const sq: PieceSpec = { id: 'g', def: 'ge.467', side: 'ge', hex: 'uN7' };
    const bu = bed({ hidden: true, pieces: [sq], dice: [6, 6] });
    expect(revealed(act(bu.engine, bu.state, { type: 'fire', decl: { units: ['g'], sw: [], target: 'uN5' } }))).toBe(false);
    const ce = bed({ hidden: true, pieces: [sq], dice: [6, 6] });
    const s = { ...ce.state, pieces: { ...ce.state.pieces, t34: { ...ce.state.pieces['t34']!, tags: { ...ce.state.pieces['t34']!.tags, ce: true } } } };
    expect(revealed(act(ce.engine, s, { type: 'fire', decl: { units: ['g'], sw: [], target: 'uN5' } }))).toBe(true);
  });
});
