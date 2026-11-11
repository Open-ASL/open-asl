import { describe, expect, it } from 'vitest';
import type { Action, Ctx, Engine, GameState, RuleModule } from '@asl/engine';
import { ammoColumn, caChangeDrm, depletionAt, spineChange, inCoveredArc, nearestSpine, shotContext, sk2CoreModules, statics, type GunDef } from '../src';

const shotContextFor = (env: Parameters<typeof shotContext>[0], shot: Record<string, unknown>) => shotContext(env, shot as never, 'prep', 'ge');
import { COUNTERS, GE_VS_BR, act, makeEngine } from './fixtures';

/** Starts a PFPh for a side, to see ⅝" Smoke disperse (SK4 1.2.5). */
const testPhase: RuleModule = {
  id: 'test.phase',
  install(r) {
    r.action<Action & { attacker: string }>({
      type: 'test.pfph',
      decisionKinds: ['phase'],
      validate: () => null,
      resolve(ctx: Ctx, a) {
        ctx.emit('turn.phaseStarted', { phase: 'PFPh', turn: 2, attacker: a.attacker });
      },
    });
  },
};
const extra = [...sk2CoreModules, testPhase];

/** The spine a Gun in `gunHex` must point at to cover `target`. */
function spineFor(engine: Engine, state: GameState, gunHex: string, target: string, current = 0): number {
  const map = statics(engine.env(state)).map;
  if (inCoveredArc(map.hex(gunHex)!.cube, current, map.hex(target)!.cube)) return current;
  return nearestSpine(map.hex(gunHex)!.cube, current, map.hex(target)!.cube)!;
}
const ev = (events: { type: string; payload: unknown }[], type: string) => events.filter((e) => e.type === type).map((e) => e.payload as Record<string, unknown>);
const illegal = (engine: Engine, state: GameState, shot: Record<string, unknown>, mode = 'prep', side = 'ge') =>
  engine.env(state).query('ordnance.illegal', { shot: shot as never, mode: mode as never, side }, null);

/** A German Gun manned by a crew in yK5, aimed at `target`; British squads where given. */
function gunGame(opts: { def: string; target: string; squads: Record<string, string>; dice?: number[]; terrain?: Record<string, { terrain: string }>; date?: string; ca?: number; crewHex?: string }) {
  const crewHex = opts.crewHex ?? 'yK5';
  const pieces = (ca: number) => [
    { id: 'c1', def: 'ge.228c', side: 'ge', hex: crewHex },
    { id: 'g', def: opts.def, side: 'ge', heldBy: 'c1', tags: { ca } },
    ...Object.entries(opts.squads).map(([id, hex]) => ({ id, def: 'br.457', side: 'br', hex })),
  ];
  const scenario = { ...GE_VS_BR, ...(opts.date ? { date: opts.date } : {}) };
  const probe = makeEngine({ scenario, extra, terrain: opts.terrain, pieces: pieces(0) });
  const ca = opts.ca ?? spineFor(probe.engine, probe.state, crewHex, opts.target);
  return makeEngine({ scenario, extra, terrain: opts.terrain, pieces: pieces(ca), ...(opts.dice ? { dice: opts.dice } : {}) });
}

describe('Ordnance Smoke (SK4 1.2.5, 6.2)', () => {
  it('a PFPh hit on the ATT places a full +3 ⅝" Smoke counter: no IFT attack, no acquisition, ROF spent', () => {
    // 3+2 = 5: below the Depletion Number 7 (the Gun has Smoke), and ≤ the ATT TH# 7.
    const { engine, state } = gunGame({ def: 'ge.AT75Lsa', target: 'yN5', squads: { b1: 'yN5' }, dice: [3, 2] });
    const t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'g', target: 'yN5', targetType: 'ATT', ammo: 'SMOKE' } });
    expect(ev(t.events, 'sk2.ordnance.ammo')[0]).toMatchObject({ ammo: 'SMOKE', depletion: 7, dr: 5, result: 'kept' });
    expect(ev(t.events, 'sk2.ordnance.shot')[0]).toMatchObject({ ammo: 'SMOKE', outcome: 'hit', targetType: 'ATT', drm: -2 });
    // Case 7: Smoke at under 13 hexes, -2.
    expect((ev(t.events, 'sk2.ordnance.shot')[0]!['explain'] as { label: string }[]).map((n) => n.label)).toEqual(['-2 Smoke at under 13 hexes']);
    expect(ev(t.events, 'sk1.fire.attack')).toHaveLength(0);
    expect(t.state.hexMarkers['yN5']).toMatchObject({ smoke58: 'smoke', smoke58Side: 'ge' });
    expect(t.state.hexMarkers['yN5']!['smoke58Disp']).toBeUndefined();
    expect(t.state.pieces['g']!.tags['acq']).toBeUndefined();
    expect(t.state.pieces['g']!.tags['fire']).toBe('prep');
    // Fire traced into the hex takes +3; out of it +4.
    const env = engine.env(t.state);
    expect(env.query('los.trace', { from: 'yK5', to: 'yN5' }, { clear: true, hindrance: 0, parts: [] }).hindrance).toBe(3);
    expect(env.query('los.trace', { from: 'yN5', to: 'yK5' }, { clear: true, hindrance: 0, parts: [] }).hindrance).toBe(4);
    // Entering the hex costs one more MF.
    expect(env.query('move.cost', { unit: 'b1', from: 'yM5', to: 'yN5', viaRoad: false }, 1)).toBe(2);
  });

  it('disperses at the start of the placing side\'s next PFPh, then comes off', () => {
    const { engine, state } = gunGame({ def: 'ge.AT75Lsa', target: 'yN5', squads: { b1: 'yN5' }, dice: [3, 2] });
    let t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'g', target: 'yN5', targetType: 'ATT', ammo: 'SMOKE' } });
    t = act(engine, t.state, { type: 'test.pfph', attacker: 'br' });
    expect(t.state.hexMarkers['yN5']!['smoke58Disp']).toBeUndefined();
    t = act(engine, t.state, { type: 'test.pfph', attacker: 'ge' });
    expect(t.state.hexMarkers['yN5']).toMatchObject({ smoke58: 'smoke', smoke58Disp: true });
    expect(engine.env(t.state).query('los.trace', { from: 'yK5', to: 'yN5' }, { clear: true, hindrance: 0, parts: [] }).hindrance).toBe(2);
    t = act(engine, t.state, { type: 'test.pfph', attacker: 'ge' });
    expect(t.state.hexMarkers['yN5']?.['smoke58'] ?? null).toBeNull();
  });

  it('is fired on the ATT only, in the PFPh/DFPh, and not after the Gun has fired anything else that phase', () => {
    // 6+2 = 8, +1 woods → 9 misses on the ITT (TH 8); colored 2 keeps ROF.
    const { engine, state } = gunGame({ def: 'ge.AT75Lsa', target: 'yN5', squads: { b1: 'yN5' }, dice: [6, 2], terrain: { yN5: { terrain: 'woods' } } });
    expect(illegal(engine, state, { weapon: 'g', target: 'yN5', targetType: 'ITT', ammo: 'SMOKE' })).toMatch(/Area Target Type/);
    expect(illegal(engine, state, { weapon: 'g', target: 'yN5', targetType: 'ATT', ammo: 'SMOKE' }, 'advancing')).toMatch(/start of the PFPh or DFPh/);
    expect(illegal(engine, state, { weapon: 'g', target: 'yN5', targetType: 'ATT', ammo: 'SMOKE' })).toBeNull();
    const t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'g', target: 'yN5', targetType: 'ITT' } });
    expect(ev(t.events, 'sk2.ordnance.shot')[0]).toMatchObject({ ammo: 'HE', outcome: 'miss' });
    expect(t.state.pieces['g']!.tags['fire']).toBeUndefined();
    expect(illegal(engine, t.state, { weapon: 'g', target: 'yN5', targetType: 'ATT', ammo: 'SMOKE' })).toMatch(/before the Gun fires anything else/);
  });
});

describe('Depletion Numbers (SK4 6.2)', () => {
  it('a DR equal to the Depletion Number uses the ammo for this shot, then the Gun is out of it', () => {
    const { engine, state } = gunGame({ def: 'ge.AT75Lsa', target: 'yN5', squads: { b1: 'yN5' }, dice: [4, 3] });
    const t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'g', target: 'yN5', targetType: 'ATT', ammo: 'SMOKE' } });
    expect(ev(t.events, 'sk2.ordnance.ammo')[0]).toMatchObject({ result: 'last', dr: 7 });
    expect(ev(t.events, 'sk2.ordnance.shot')[0]).toMatchObject({ outcome: 'hit' });
    expect(t.state.hexMarkers['yN5']!['smoke58']).toBe('smoke');
    expect(t.state.pieces['g']!.tags['ammoOut']).toBe('SMOKE');
    expect(illegal(engine, t.state, { weapon: 'g', target: 'yN5', targetType: 'ATT', ammo: 'SMOKE' })).toBe('Out of Smoke');
  });

  it('a DR above it: the Gun never had it and has not fired (no marker, may fire again)', () => {
    const { engine, state } = gunGame({ def: 'ge.AT75Lsa', target: 'yN5', squads: { b1: 'yN5' }, dice: [5, 4] });
    const t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'g', target: 'yN5', targetType: 'ATT', ammo: 'SMOKE' } });
    expect(ev(t.events, 'sk2.ordnance.ammo')[0]).toMatchObject({ result: 'never', dr: 9 });
    expect(ev(t.events, 'sk2.ordnance.shot')[0]).toMatchObject({ outcome: 'noAmmo' });
    expect(ev(t.events, 'sk2.ordnance.rof')).toHaveLength(0);
    expect(t.state.pieces['g']!.tags['fire']).toBeUndefined();
    expect(t.state.pieces['g']!.tags['ammoOut']).toBe('SMOKE');
    expect(illegal(engine, t.state, { weapon: 'g', target: 'yN5', targetType: 'ITT' })).toBeNull();
  });

  it('a shot with no LOS still makes its To Hit DR (ASLRB A6.11): depletion and breakdown apply, nothing is hit', () => {
    const blocked = { yM5: { terrain: 'woods' } };
    const shot = { weapon: 'g', target: 'yN5', targetType: 'ATT', ammo: 'SMOKE' } as const;
    // DR 7 = the Depletion Number: the last of the Smoke, wasted on the woods.
    let { engine, state } = gunGame({ def: 'ge.AT75Lsa', target: 'yN5', squads: { b1: 'yN5' }, dice: [4, 3], terrain: blocked });
    let t = act(engine, state, { type: 'fire.ordnance', shot });
    expect(ev(t.events, 'sk2.ordnance.noLos')[0]).toMatchObject({ dr: [4, 3], ammo: 'SMOKE' });
    expect(ev(t.events, 'sk2.ordnance.ammo')[0]).toMatchObject({ result: 'last', dr: 7 });
    expect(ev(t.events, 'sk2.ordnance.shot')).toHaveLength(0);
    expect(t.state.hexMarkers['yN5']?.['smoke58']).toBeUndefined();
    expect(t.state.pieces['g']!.tags).toMatchObject({ ammoOut: 'SMOKE', fire: 'prep' });
    // Above it: the Gun never had Smoke and has not fired, LOS or not.
    ({ engine, state } = gunGame({ def: 'ge.AT75Lsa', target: 'yN5', squads: { b1: 'yN5' }, dice: [5, 4], terrain: blocked }));
    t = act(engine, state, { type: 'fire.ordnance', shot });
    expect(ev(t.events, 'sk2.ordnance.noLos')[0]).toMatchObject({ noAmmo: true });
    expect(t.state.pieces['g']!.tags['fire']).toBeUndefined();
    // Boxcars: it malfunctions.
    ({ engine, state } = gunGame({ def: 'ge.AT75Lsa', target: 'yN5', squads: { b1: 'yN5' }, dice: [6, 6], terrain: blocked }));
    t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'g', target: 'yN5', targetType: 'ITT', ammo: 'HE' } });
    expect(t.state.pieces['g']!.tags['malf']).toBe(true);
    expect(t.state.pieces['b1']!.tags['broken']).toBeUndefined();
  });

  it('a malfunction fires the shot and uses the ammo up', () => {
    const { engine, state } = gunGame({ def: 'ge.AT75Lsa', target: 'yN5', squads: { b1: 'yN5' }, dice: [6, 6] });
    const t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'g', target: 'yN5', targetType: 'ATT', ammo: 'SMOKE' } });
    expect(ev(t.events, 'sk2.ordnance.ammo')[0]).toMatchObject({ result: 'malf' });
    expect(t.state.pieces['g']!.tags).toMatchObject({ malf: true, ammoOut: 'SMOKE' });
  });

  it('date-dependent numbers: APCR A5²/4³/3⁴ is not there in 1941 and is 4 in 1943', () => {
    const def = COUNTERS['ge.AT75Lsa'] as GunDef;
    const apcr = def.specialAmmo!.find((s) => s.kind === 'APCR')!;
    const at = (date: string) => depletionAt(makeEngine({ scenario: { ...GE_VS_BR, date }, pieces: [] }).engine.env(makeEngine({ scenario: { ...GE_VS_BR, date }, pieces: [] }).state), apcr);
    expect(at('5 May 1941')).toBeNull();
    expect(at('5 May 1942')).toBe(5);
    expect(at('5 May 1943')).toBe(4);
    expect(at('6 June 1944')).toBe(3);

    const early = gunGame({ def: 'ge.AT75Lsa', target: 'yN5', squads: { b1: 'yN5' }, date: '1 July 1941' });
    expect(illegal(early.engine, early.state, { weapon: 'g', target: 'yN5', targetType: 'ITT', ammo: 'APCR' })).toBe('No APCR at this date');

    // 2+1 = 3 < 4: APCR it is; +1 woods → 4, a hit (not a CH) on the 1 FP column.
    const { engine, state } = gunGame({ def: 'ge.AT75Lsa', target: 'yN5', squads: { b1: 'yN5' }, date: '1 July 1943', dice: [2, 1, 6, 6], terrain: { yN5: { terrain: 'woods' } } });
    expect(illegal(engine, state, { weapon: 'g', target: 'yN5', targetType: 'ATT', ammo: 'APCR' })).toMatch(/cannot be fired on the Area Target Type/);
    const t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'g', target: 'yN5', targetType: 'ITT', ammo: 'APCR' } });
    expect(ev(t.events, 'sk2.ordnance.ammo')[0]).toMatchObject({ depletion: 4, result: 'kept' });
    expect(ev(t.events, 'sk2.ordnance.hit')[0]).toMatchObject({ ammo: 'APCR', column: 1 });
  });
});

describe('AP and HEAT against Infantry (SK4 6.2)', () => {
  it('AP is announced on the ITT and attacks on the 2 FP column (1 under 37mm); doubled on a CH', () => {
    const env = makeEngine({ pieces: [] }).engine.env(makeEngine({ pieces: [] }).state);
    const def = COUNTERS['ge.AT75Lsa'] as GunDef;
    expect(ammoColumn(env, def, 'AP', 'ITT', false)).toBe(2);
    expect(ammoColumn(env, def, 'AP', 'ITT', true)).toBe(4);
    expect(ammoColumn(env, { ...def, caliber: 28 }, 'AP', 'ITT', false)).toBe(1);
    expect(ammoColumn(env, def, 'APCR', 'ITT', false)).toBe(1);
    // HEAT: one column lower than HE (fixture 75mm → 12, so 8).
    expect(ammoColumn(env, def, 'HEAT', 'ITT', false)).toBe(8);

    const { engine, state } = gunGame({ def: 'ge.AT75Lsa', target: 'yN5', squads: { b1: 'yN5' }, dice: [4, 3, 6, 6] });
    const t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'g', target: 'yN5', targetType: 'ITT', ammo: 'AP' } });
    expect(ev(t.events, 'sk2.ordnance.ammo')).toHaveLength(0);
    expect(ev(t.events, 'sk2.ordnance.hit')[0]).toMatchObject({ ammo: 'AP', column: 2 });
  });

  it('HEAT only at Infantry in a building or at a Gun, on the column one lower than HE', () => {
    const open = gunGame({ def: 'ge.INF150s', target: 'yN5', squads: { b1: 'yN5' } });
    expect(illegal(open.engine, open.state, { weapon: 'g', target: 'yN5', targetType: 'ITT', ammo: 'HEAT' })).toMatch(/building or at a Gun/);
    // TH 8 at range 3, +3 stone: 2+1 = 3 (< H7) → 6 hits; 150mm is the fixture's 16 column, HEAT 12.
    const { engine, state } = gunGame({ def: 'ge.INF150s', target: 'yN5', squads: { b1: 'yN5' }, terrain: { yN5: { terrain: 'building-stone' } }, dice: [2, 1, 6, 6] });
    const t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'g', target: 'yN5', targetType: 'ITT', ammo: 'HEAT' } });
    expect(ev(t.events, 'sk2.ordnance.hit')[0]).toMatchObject({ ammo: 'HEAT', column: 12 });
  });
});

describe('Critical Hits (SK4 6.1)', () => {
  it('apply to one randomly determined target; the others take a normal hit with the same IFT DR', () => {
    // TH 2 (CH ≤ 3); random selection b1 5, b2 2 → b1; one IFT DR 4+4.
    const { engine, state } = gunGame({ def: 'ge.AT75Lsa', target: 'yN5', squads: { b1: 'yN5', b2: 'yN5' }, dice: [1, 1, 5, 2, 4, 4] });
    const t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'g', target: 'yN5', targetType: 'ITT' } });
    const hits = ev(t.events, 'sk2.ordnance.hit');
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ ch: true, units: ['b1'], column: 24, dr: [4, 4] });
    expect(hits[1]).toMatchObject({ ch: false, units: ['b2'], column: 12, dr: [4, 4] });
  });
});

describe('Mortars (SK4 1.1.1, 6.9) and WP', () => {
  /** An American 81mm Mortar in yK5 and German squads (the default scenario: Americans first). */
  function mortarGame(target: string, dice: number[], terrain: Record<string, { terrain: string }> = {}, mortarHex = 'yK5') {
    const pieces = (ca: number) => [
      { id: 'c1', def: 'am.228c', side: 'am', hex: mortarHex },
      { id: 'm', def: 'am.MTR81s', side: 'am', heldBy: 'c1', tags: { ca } },
      { id: 'e1', def: 'ge.467', side: 'ge', hex: target },
    ];
    const probe = makeEngine({ extra, terrain, pieces: pieces(0) });
    const ca = spineFor(probe.engine, probe.state, mortarHex, target);
    return makeEngine({ extra, terrain, dice, pieces: pieces(ca) });
  }

  it('Air Burst: HE into woods takes -1 instead of the +1 woods TEM', () => {
    const { engine, state } = mortarGame('yO5', [2, 3, 6, 6], { yO5: { terrain: 'woods' } });
    const t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'm', target: 'yO5', targetType: 'ATT' } });
    const attack = ev(t.events, 'sk1.fire.attack')[0]!;
    expect(attack['drm']).toBe(-1);
    expect((attack['explain'] as { label?: string }[]).map((n) => n.label)).toContain('-1 Air Burst (woods)');
  });

  it('must use the ATT and may not fire from a building', () => {
    const { engine, state } = mortarGame('yO5', []);
    expect(illegal(engine, state, { weapon: 'm', target: 'yO5', targetType: 'ITT' }, 'prep', 'am')).toMatch(/Area Target Type/);
    const b = mortarGame('yO5', [], { yK5: { terrain: 'building-stone' } });
    expect(illegal(b.engine, b.state, { weapon: 'm', target: 'yO5', targetType: 'ATT' }, 'prep', 'am')).toMatch(/from a building/);
  });

  it('WP: a full +2 counter in the PFPh and a NMC for the units hit, Air Burst +1 in woods', () => {
    // 2+3 = 5 (< WP8) hits on the ATT 7; ROF 3 kept. NMC 3+3 +1 = 7 ≤ morale 7.
    const { engine, state } = mortarGame('yO5', [2, 3, 3, 3], { yO5: { terrain: 'woods' } });
    const t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'm', target: 'yO5', targetType: 'ATT', ammo: 'WP' } });
    expect(ev(t.events, 'sk2.ordnance.wp')[0]).toMatchObject({ units: ['e1'], mod: 1, airBurst: true });
    expect(t.state.hexMarkers['yO5']).toMatchObject({ smoke58: 'wp' });
    expect(engine.env(t.state).query('los.trace', { from: 'yK5', to: 'yO5' }, { clear: true, hindrance: 0, parts: [] }).hindrance).toBe(2);
    expect(t.state.pieces['m']!.tags['acq']).toBeUndefined();
  });
});

describe('To Hit cases 8 and 11', () => {
  it('case 8 doubles for a Gun in a building; case 11 adds +1 to APCR/APDS at 13+ hexes', () => {
    const b = gunGame({ def: 'ge.AT75Lsa', target: 'yN5', squads: { b1: 'yN5' }, ca: 3, terrain: { yK5: { terrain: 'building-stone' } } });
    const ca = spineFor(b.engine, b.state, 'yK5', 'yN5', 3);
    const env = b.engine.env(b.state);
    const drm = (shot: Record<string, unknown>) => env.explain('ordnance.thDrm', shotContextFor(env, shot), 0);
    const caNote = drm({ weapon: 'g', target: 'yN5', targetType: 'ITT', ca }).trace.find((t) => t.id === 'sk2.th.caChange')!;
    expect((caNote.after as number) - (caNote.before as number)).toBe(2 * caChangeDrm('NT', spineChange(3, ca)));
    expect(caNote.label).toMatch(/×2 in a building/);

    const far = gunGame({ def: 'ge.AT75Lsa', target: 'yX5', squads: { b1: 'yX5' }, date: '1 July 1943' });
    const fenv = far.engine.env(far.state);
    expect(fenv.explain('ordnance.thDrm', shotContextFor(fenv, { weapon: 'g', target: 'yX5', targetType: 'ITT', ammo: 'APCR' }), 0).value).toBe(1);
  });
});

describe('Intensive Fire limits (SK4 3.2.4)', () => {
  it('a Gun with no ROF that turns to fire cannot fire again that Player Turn', () => {
    const { engine, state } = gunGame({ def: 'ge.INF150s', target: 'yN5', squads: { b1: 'yN5' }, ca: 3, dice: [6, 5] });
    const map = statics(engine.env(state)).map;
    expect(inCoveredArc(map.hex('yK5')!.cube, 3, map.hex('yN5')!.cube)).toBe(false);
    const ca = spineFor(engine, state, 'yK5', 'yN5', 3);
    const t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'g', target: 'yN5', targetType: 'ITT', ca } });
    expect(t.state.pieces['g']!.tags['intensive']).toBe(true);
  });

  it('"No IF" Guns never use Intensive Fire', () => {
    const { engine, state } = gunGame({ def: 'ge.AR170L', target: 'yN5', squads: { b1: 'yN5' }, dice: [6, 5] });
    const t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'g', target: 'yN5', targetType: 'ITT' } });
    expect(t.state.pieces['g']!.tags['fire']).toBe('prep');
    expect(illegal(engine, t.state, { weapon: 'g', target: 'yN5', targetType: 'ITT', intensive: true })).toMatch(/No IF/);
  });
});
