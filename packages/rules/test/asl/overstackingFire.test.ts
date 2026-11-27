import { describe, expect, it } from 'vitest';
import type { Engine, GameState, RuleModule } from '@asl/engine';
import { aslCoreModules, moveState, piecesModule, shotContext, turnModule, type FireAttackCtx, type HexTerrainSpec } from '../../src';
import { sk1CoreModules } from '../../src/sk1';
import { sk2CoreModules } from '../../src/sk2';
import { sk3CoreModules } from '../../src/sk3';
import { act, makeEngine, type PieceSpec } from '../fixtures';

/*
 * The overstacking attack and defense penalties (ASLRB A5.12, A5.13, A5.131, A8.26). Board u: uQ4 is a stone building, the
 * rest open ground; the Russians in uQ2, two hexes north.
 */

const SK: RuleModule[] = [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules];
const ASL: RuleModule[] = [...SK, ...aslCoreModules];
const GE_RU = { firstSide: 'ge', sides: [{ side: 'ge', name: 'German', nationality: 'ge', elr: 3 }, { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 }] };
const GROUND: Record<string, HexTerrainSpec> = { uQ4: { terrain: 'building-stone' } };

function game(pieces: PieceSpec[], opts: { asl?: boolean; dice?: number[]; startPhase?: string } = {}) {
  return makeEngine({ board: 'u', terrain: GROUND, scenario: GE_RU, modules: opts.asl === false ? SK : ASL, startPhase: opts.startPhase ?? 'PFPh', pieces, dice: opts.dice ?? [] });
}
const squads = (hex: string, n: number, prefix = 's', side = 'ge'): PieceSpec[] => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, def: side === 'ge' ? 'ge.467' : 'ru.447', side, hex }));
const labels = (events: { type: string; payload: unknown }[]) => ((events.find((e) => e.type === 'sk1.fire.attack')?.payload as { explain?: { label?: string }[] } | undefined)?.explain ?? []).map((n) => n.label ?? '');
const unitLabels = (events: { type: string; payload: unknown }[], unit: string) =>
  ((events.find((e) => e.type === 'sk1.fire.result' && (e.payload as { unit: string }).unit === unit)?.payload as { explain?: { label?: string }[] } | undefined)?.explain ?? []).map((n) => n.label ?? '');
const attackAt = (target: string, side: string, parts: { firer: string; hex: string }[], extra: Partial<FireAttackCtx> = {}): FireAttackCtx => ({
  mode: 'prep',
  side,
  target,
  parts: parts.map((p) => ({ piece: p.firer, firer: p.firer, kind: 'inherent', hex: p.hex, range: 4, dist: 2 })),
  targets: [],
  hindrance: 0,
  ...extra,
});
/** Plays on, passing and ending phases, until `until` holds. */
const playTo = (engine: Engine, s0: GameState, until: (s: GameState) => boolean) => {
  let s = s0;
  for (let i = 0; i < 400 && !until(s); i++) {
    const d = engine.currentDecision(s)!;
    const legal = engine.legalActions(s, d.owner);
    const a = legal.find((x) => x.type === 'defPass') ?? legal.find((x) => x.type === 'move.end') ?? legal.find((x) => x.type === 'endPhase') ?? legal[0]!;
    s = act(engine, s, a).state;
  }
  return s;
};

describe('A5.12 attack and A5.131 defense penalties on the IFT', () => {
  it('four squads and a crew (4½, FRU 2) fire with +2, and are fired on at -2 each; the Starter Kit has neither', () => {
    const pieces: PieceSpec[] = [...squads('uQ4', 4), { id: 'c', def: 'ge.228c', side: 'ge', hex: 'uQ4' }, { id: 'r', def: 'ru.447', side: 'ru', hex: 'uQ2' }];
    const { engine, state } = game(pieces, { dice: [4, 5, 3, 4] });
    const prep = act(engine, state, { type: 'fire', decl: { units: ['s1'], sw: [], target: 'uQ2' } });
    expect(labels(prep.events)).toContain('+2 overstacked firer (A5.12)');
    const env = engine.env(state);
    expect(env.query('fire.unitDrm', { attack: attackAt('uQ4', 'ru', [{ firer: 'r', hex: 'uQ2' }]), unit: 's2' }, 0)).toBe(-2);
    // The Russian is not overstacked: nothing against him.
    expect(env.query('fire.unitDrm', { attack: attackAt('uQ2', 'ge', [{ firer: 's1', hex: 'uQ4' }]), unit: 'r' }, 0)).toBe(0);
    // An ordnance hit's IFT DR takes neither: ordnance has them on its To Hit DR (the IFT chart's footnote a).
    expect(env.query('fire.unitDrm', { attack: attackAt('uQ4', 'ru', [{ firer: 'r', hex: 'uQ2' }], { ordnance: { targetType: 'ITT', ch: false, column: 8 } }), unit: 's2' }, 0)).toBe(0);
    const sk = game(pieces.filter((p) => p.id !== 's4'), { asl: false, dice: [4, 5] });
    expect(labels(act(sk.engine, sk.state, { type: 'fire', decl: { units: ['s1'], sw: [], target: 'uQ2' } }).events).join()).not.toMatch(/overstacked/);
  });

  it('a Fire Group from two overstacked Locations takes the worse one once (A7.3, A7.52)', () => {
    const pieces: PieceSpec[] = [...squads('uQ4', 4), { id: 'c', def: 'ge.228c', side: 'ge', hex: 'uQ4' }, ...squads('uQ5', 4, 't'), { id: 'r', def: 'ru.447', side: 'ru', hex: 'uQ2' }];
    const { engine, state } = game(pieces, { dice: [4, 5, 3, 4] });
    const fg = act(engine, state, { type: 'fire', decl: { units: ['s1', 't1'], sw: [], target: 'uQ2' } });
    expect(labels(fg.events).filter((l) => /overstacked/.test(l))).toEqual(['+2 overstacked firer (A5.12)']);
  });

  it('a firer outside the target hex leaves the Residual FP a column lower per +1 (A8.26)', () => {
    const { engine, state } = game([...squads('uQ4', 4), { id: 'r', def: 'ru.447', side: 'ru', hex: 'uQ2' }]);
    const env = engine.env(state);
    expect(env.query('fire.residualOutside', { attack: attackAt('uQ2', 'ge', [{ firer: 's1', hex: 'uQ4' }]) }, [])).toContain('asl.overstack.firer');
    expect(env.query('fire.residualOutside', { attack: attackAt('uQ4', 'ge', [{ firer: 's1', hex: 'uQ4' }]) }, [])).not.toContain('asl.overstack.firer');
  });

  it('a Melee Location: only the overstacked side\'s units suffer the -1 (A.5)', () => {
    const { engine, state } = game([...squads('uQ4', 4), { id: 'r', def: 'ru.447', side: 'ru', hex: 'uQ4' }, { id: 'x', def: 'ru.447', side: 'ru', hex: 'uQ1' }], { startPhase: 'PFPh' });
    const env = engine.env(state);
    const attack = attackAt('uQ4', 'ru', [{ firer: 'x', hex: 'uQ1' }]);
    expect(env.query('fire.unitDrm', { attack, unit: 's1' }, 0)).toBe(-1);
    expect(env.query('fire.unitDrm', { attack, unit: 'r' }, 0)).toBe(0);
  });

  it('in the MPh only the moving stack suffers the -1, counted with the units already there; the DEFENDER\'s +1 applies (A5.13)', () => {
    const pieces: PieceSpec[] = [...squads('uQ4', 3), { id: 'm', def: 'ge.467', side: 'ge', hex: 'uQ5' }, ...squads('uQ2', 4, 'r', 'ru')];
    const { engine, state } = game(pieces, { startPhase: 'MPh', dice: [4, 5, 3, 4, 3, 4] });
    let s = act(engine, state, { type: 'move.start', units: ['m'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uQ4' }).state;
    const env = engine.env(s);
    expect(moveState(env)!.units).toEqual(['m']);
    const attack = attackAt('uQ4', 'ru', [{ firer: 'r1', hex: 'uQ2' }], { mode: 'first' });
    expect(env.query('fire.unitDrm', { attack, unit: 'm' }, 0)).toBe(-1);
    expect(env.query('fire.unitDrm', { attack, unit: 's1' }, 0)).toBe(0);
    const dff = act(engine, s, { type: 'defFire', decl: { units: ['r1'], sw: [], target: 'uQ4' } });
    expect(labels(dff.events)).toContain('+1 overstacked firer (A5.12)');
    expect(unitLabels(dff.events, 'm')).toContain('-1 vs overstacked (A5.131)');
  });

  it('an attack on vehicles alone (the IFT\'s Vehicle line) takes neither penalty (A5.132)', () => {
    const { engine, state } = game([...squads('uQ4', 4), { id: 't', def: 'ru.T34M43', side: 'ru', hex: 'uQ2' }]);
    const env = engine.env(state);
    const attack = { ...attackAt('uQ2', 'ge', [{ firer: 's1', hex: 'uQ4' }]), targets: ['t'] };
    expect(env.explain('fire.drm', { attack }, 0).trace.map((t) => t.id)).not.toContain('asl.overstack.firer');
  });
});

describe('A5.12, A5.131 on the To Hit DR and in Close Combat', () => {
  const gun: PieceSpec[] = [{ id: 'gc', def: 'ge.228c', side: 'ge', hex: 'uQ4' }, { id: 'g', def: 'ge.AT75L', side: 'ge', heldBy: 'gc' }, ...squads('uQ4', 3)];
  it('ordnance fired from an overstacked Location +1 To Hit; at overstacked Personnel -1 (ITT and ATT), never against a vehicle (A5.132)', () => {
    const { engine, state } = game([...gun, ...squads('uQ2', 4, 'r', 'ru'), { id: 't', def: 'ru.T34M43', side: 'ru', hex: 'uQ2' }]);
    const env = engine.env(state);
    const ids = (targetType: 'ITT' | 'ATT' | 'VTT') => env.explain('ordnance.thDrm', shotContext(env, { weapon: 'g', target: 'uQ2', targetType, ...(targetType === 'VTT' ? { targetUnit: 't' } : {}) }, 'prep', 'ge'), 0).trace.filter((t) => !t.suppressedBy).map((t) => `${t.id}:${String(t.label)}`);
    // The crew manning the Gun counts as a squad (A5.5): four squads, one too many.
    expect(ids('ITT')).toContain('asl.overstack.firer.th:+1 overstacked firer (A5.12)');
    expect(ids('ITT')).toContain('asl.overstack.target.th:-1 vs overstacked (A5.131)');
    expect(ids('ATT')).toContain('asl.overstack.target.th:-1 vs overstacked (A5.131)');
    expect(ids('VTT')).toContain('asl.overstack.firer.th:+1 overstacked firer (A5.12)');
    expect(ids('VTT').join()).not.toMatch(/asl.overstack.target/);
  });

  it('Close Combat: +1 to the overstacked attackers, -1 against overstacked units', () => {
    const { engine, state } = game([...squads('uQ4', 4), ...squads('uQ4', 1, 'r', 'ru')], { startPhase: 'CCPh' });
    const env = engine.env(state);
    expect(env.query('cc.drm', { hex: 'uQ4', attackers: ['s1'], targets: ['r1'], side: 'ge' }, 0)).toBe(1);
    expect(env.query('cc.drm', { hex: 'uQ4', attackers: ['r1'], targets: ['s1'], side: 'ru' }, 0)).toBe(0);
    expect(env.query('cc.targetDrm', { hex: 'uQ4', attackers: ['r1'], targets: ['s1'], side: 'ru', target: 's1' }, 0)).toBe(-1);
  });
});

describe('Across turns: the overstacked stack fires, is fired on, and moves out next turn with nothing left over', () => {
  it('+1 in the PFPh, -1 in the DFPh, then the next German Player Turn moves out at the normal cost and fires with no penalty', () => {
    const pieces: PieceSpec[] = [...squads('uQ4', 4), { id: 'r', def: 'ru.447', side: 'ru', hex: 'uQ2' }];
    const { engine, state } = game(pieces);
    let r = act(engine, state, { type: 'fire', decl: { units: ['s1'], sw: [], target: 'uQ2' } });
    expect(labels(r.events)).toContain('+1 overstacked firer (A5.12)');
    let s = playTo(engine, r.state, (x) => x.phase === 'DFPh');
    expect(s.pieces['r']?.loc.kind).toBe('hex');
    {
      r = act(engine, s, { type: 'fire', decl: { units: ['r'], sw: [], target: 'uQ4' } });
      const hit = ['s1', 's2', 's3', 's4'].find((u) => r.events.some((e) => e.type === 'sk1.fire.result' && (e.payload as { unit: string }).unit === u));
      expect(hit).toBeDefined();
      expect(unitLabels(r.events, hit!)).toContain('-1 vs overstacked (A5.131)');
      s = r.state;
    }
    // The next German Player Turn: no marker or tag from overstacking; a squad leaves at Open Ground's cost.
    s = playTo(engine, s, (x) => x.turn === 2 && x.attacker === 'ge' && x.phase === 'MPh');
    const mover = ['s4', 's3', 's2', 's1'].find((u) => s.pieces[u]?.loc.kind === 'hex' && !s.pieces[u]!.tags['broken'] && !s.pieces[u]!.tags['pinned'])!;
    s = act(engine, s, { type: 'move.start', units: [mover] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uQ5' }).state;
    expect(moveState(engine.env(s))!.spent[mover]).toBe(1);
    expect(Object.keys(s.hexMarkers['uQ4'] ?? {}).join()).not.toMatch(/overstack/i);
  });
});
