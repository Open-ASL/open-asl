import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { sk2CoreModules } from '../src';
import { GE_VS_BR, act, makeEngine } from './fixtures';

const extra = sk2CoreModules;
const settle = (engine: Engine, state: GameState) => {
  let s = state;
  while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
  return s;
};
const terrain = { yL5: { terrain: 'woods' }, yN5: { terrain: 'building-stone' } };
const pieces = [
  { id: 'c1', def: 'ge.228c', side: 'ge', hex: 'yK5' },
  { id: 'g75', def: 'ge.AT75L', side: 'ge', heldBy: 'c1', tags: { ca: 1, emplaced: true } },
  { id: 'sq', def: 'ge.467', side: 'ge', hex: 'yK5' },
  { id: 'b1', def: 'br.457', side: 'br', hex: 'yN5' },
];

describe('Manhandling a Gun (SK4 6.5, the Emplacement and Manhandling example)', () => {
  it('a unit possessing a Gun must manhandle it; pushing costs double, rolls against the M# and ends Emplacement', () => {
    const { engine, state } = makeEngine({ scenario: GE_VS_BR, extra, terrain, startPhase: 'MPh', dice: [2, 2, 4, 4], pieces });
    expect(() => act(engine, state, { type: 'move.start', units: ['c1'] })).toThrow(/manhandle it/);
    // The crew is offered as a mover all the same: it starts by manhandling its Gun, alone or with the squad.
    const starts = engine.legalActions(state, 'ge').filter((a) => a.type === 'move.start') as unknown as { units: string[]; manhandle?: string }[];
    expect(starts).toContainEqual(expect.objectContaining({ units: ['c1'], manhandle: 'g75' }));
    expect(starts).toContainEqual(expect.objectContaining({ units: ['sq'] }));
    expect(starts.find((a) => a.units.length === 2)).toMatchObject({ units: ['c1', 'sq'], manhandle: 'g75' });
    expect(() => act(engine, state, { type: 'move.start', units: ['c1', 'sq'], manhandle: 'g75', assault: true })).toThrow(/Assault Movement/);
    let s = act(engine, state, { type: 'move.start', units: ['c1', 'sq'], manhandle: 'g75' }).state;
    expect(s.pieces['c1']!.tags).toMatchObject({ manhandled: true, hazardous: true });
    expect(s.pieces['g75']!.tags['manhandled']).toBe(true);
    expect(() => act(engine, s, { type: 'move.step', to: 'yL5' })).toThrow(/push it/);
    // Into woods: 2 MF doubled to 4; DRM +1 TEM, +4 MF, -2 for the extra squad pushing = +3. DR 4 → 7 < 10: moved, may go on.
    let t = act(engine, s, { type: 'move.manhandle', to: 'yL5' });
    s = settle(engine, t.state);
    const ev = t.events.find((e) => e.type === 'sk2.gun.manhandle')!.payload as { outcome: string; drm: number; explain: { label: string }[] };
    expect(ev).toMatchObject({ outcome: 'moved', drm: 3, m: 10 });
    expect(ev.explain.map((n) => n.label)).toEqual(['+1 TEM of Woods', '+4 MF to enter', '-2 extra units pushing']);
    expect(s.pieces['c1']!.loc).toEqual({ kind: 'hex', hex: 'yL5' });
    expect(s.pieces['sq']!.loc).toEqual({ kind: 'hex', hex: 'yL5' });
    expect(s.pieces['g75']!.loc).toEqual({ kind: 'held', by: 'c1' });
    expect(s.pieces['g75']!.tags['emplaced']).toBeUndefined();
    // On into Open Ground: 2 MF, DRM +2 -2 = 0; DR 8 → 8 < 10 moved... the crew has 4 MF: 4 spent, none left.
    expect(() => act(engine, s, { type: 'move.manhandle', to: 'yM5' })).toThrow(/lacks the MF/);
  });

  it('a DR equal to the M# moves the Gun and stops it; a higher one moves nothing', () => {
    const open = { yL5: { terrain: 'open' } };
    const stopped = makeEngine({ scenario: GE_VS_BR, extra, terrain: open, startPhase: 'MPh', dice: [5, 5], pieces });
    let s = act(stopped.engine, stopped.state, { type: 'move.start', units: ['c1', 'sq'], manhandle: 'g75' }).state;
    // Open Ground: 1 MF doubled to 2; DRM +2 -2 = 0; DR 10 = M: moved and stopped.
    let t = act(stopped.engine, s, { type: 'move.manhandle', to: 'yL5' });
    expect(t.events.find((e) => e.type === 'sk2.gun.manhandle')!.payload).toMatchObject({ outcome: 'stopped', drm: 0 });
    s = settle(stopped.engine, t.state);
    expect(s.pieces['c1']!.loc).toEqual({ kind: 'hex', hex: 'yL5' });
    expect(s.pieces['c1']!.tags['moved']).toBe(true);
    expect(stopped.engine.currentDecision(s)?.kind).toBe('phase');

    const failed = makeEngine({ scenario: GE_VS_BR, extra, terrain: open, startPhase: 'MPh', dice: [6, 5], pieces });
    s = act(failed.engine, failed.state, { type: 'move.start', units: ['c1', 'sq'], manhandle: 'g75' }).state;
    t = act(failed.engine, s, { type: 'move.manhandle', to: 'yL5' });
    expect(t.events.find((e) => e.type === 'sk2.gun.manhandle')!.payload).toMatchObject({ outcome: 'failed' });
    s = settle(failed.engine, t.state);
    expect(s.pieces['c1']!.loc).toEqual({ kind: 'hex', hex: 'yK5' });
    expect(s.pieces['c1']!.tags['moved']).toBe(true);
  });

  it('a push that stops or fails spends its MF where the stack stands: the defender may First Fire on them before the move ends (SK1 3.3.1)', () => {
    const open = { yL5: { terrain: 'open' } };
    for (const [dice, outcome, hex] of [[[6, 5], 'failed', 'yK5'], [[5, 5], 'stopped', 'yL5']] as const) {
      const { engine, state } = makeEngine({ scenario: GE_VS_BR, extra, terrain: open, startPhase: 'MPh', dice: [...dice, 3, 4], pieces });
      let s = act(engine, state, { type: 'move.start', units: ['c1', 'sq'], manhandle: 'g75' }).state;
      const t = act(engine, s, { type: 'move.manhandle', to: 'yL5' });
      expect(t.events.find((e) => e.type === 'sk2.gun.manhandle')!.payload).toMatchObject({ outcome });
      s = t.state;
      // The defender is asked, and the question is the one awaited: not left behind the mover's next phase decision.
      expect(engine.currentDecision(s)).toMatchObject({ kind: 'firstFire', owner: 'br', data: { hex } });
      expect(s.decisions.filter((d) => d.kind === 'phase')).toEqual([]);
      const fired = act(engine, s, { type: 'defFire', decl: { units: ['b1'], sw: [], target: hex } });
      expect(fired.events.some((e) => e.type === 'sk1.fire.attack')).toBe(true);
      // Once the defender has had its say, the stack's move is over and the mover is asked again.
      s = settle(engine, fired.state);
      expect(s.pieces['sq']!.tags['moved']).toBe(true);
      expect(engine.currentDecision(s)).toMatchObject({ kind: 'phase', owner: 'ge' });
    }
  });

  it('is Hazardous Movement: -2 to fire against the manhandlers, no FFMO/FFNAM; they may not advance afterwards', () => {
    const open = { yL5: { terrain: 'open' } };
    // Push DR 2+2 = 4 (moved); the British 4-5-7 fires: DR 3+3 (cowering would need doubles... it is a squad: directed? no) — use 3+4.
    const { engine, state } = makeEngine({ scenario: GE_VS_BR, extra, terrain: open, startPhase: 'MPh', dice: [2, 2, 3, 4, 2, 2, 2, 3], pieces });
    let s = act(engine, state, { type: 'move.start', units: ['c1', 'sq'], manhandle: 'g75' }).state;
    s = act(engine, s, { type: 'move.manhandle', to: 'yL5' }).state;
    expect(engine.currentDecision(s)?.kind).toBe('firstFire');
    const t = act(engine, s, { type: 'defFire', decl: { units: ['b1'], sw: [], target: 'yL5' } });
    const attack = t.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { explain: { label?: string }[] };
    expect(attack.explain.map((n) => n.label)).not.toContain('-1 FFMO');
    expect(attack.explain.map((n) => n.label)).not.toContain('-1 FFNAM');
    const results = t.events.filter((e) => e.type === 'sk1.fire.result').map((e) => e.payload as { unit: string; drm?: number; explain?: { label: string }[] });
    expect(results.find((r) => r.unit === 'c1')).toMatchObject({ drm: -2, explain: [{ label: '-2 Hazardous Movement (manhandling a Gun)' }] });
    // Later in the turn: no advance for the manhandlers.
    s = settle(engine, t.state);
    s = act(engine, s, { type: 'move.end' }).state;
    if (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
    for (let i = 0; i < 6 && s.phase !== 'APh'; i++) s = settle(engine, act(engine, s, { type: 'endPhase' }).state);
    expect(s.phase).toBe('APh');
    expect(() => act(engine, s, { type: 'advance', units: ['sq'], to: 'yM5' })).toThrow(/cannot advance/);
  });

  it('a Gun picked up during a move goes no further with it: a Gun moves only by manhandling (SK4 4.0, 6.5)', () => {
    // An enemy Gun unpossessed in K5: the squad walks in, recovers it (dr 1) and may not walk on with it. Dropping it
    // (no MF) frees the squad to go on; the Gun stays in K5.
    for (const def of ['br.AT57L', 'br.AA40L']) {
      const { engine, state } = makeEngine({
        scenario: GE_VS_BR,
        extra,
        startPhase: 'MPh',
        dice: [1],
        pieces: [
          { id: 'sq', def: 'ge.467', side: 'ge', hex: 'yK4' },
          { id: 'gun', def, side: 'br', hex: 'yK5' },
          { id: 'b1', def: 'br.457', side: 'br', hex: 'yA1' },
        ],
      });
      let s = act(engine, state, { type: 'move.start', units: ['sq'] }).state;
      s = settle(engine, act(engine, s, { type: 'move.step', to: 'yK5' }).state);
      s = settle(engine, act(engine, s, { type: 'move.recover', unit: 'sq', sw: 'gun' }).state);
      expect(s.pieces['gun']!.loc).toEqual({ kind: 'held', by: 'sq' });
      expect(() => act(engine, s, { type: 'move.step', to: 'yL5' })).toThrow(/moves only by manhandling/);
      expect(engine.legalActions(s, 'ge').some((a) => a.type === 'move.step')).toBe(false);
      s = act(engine, s, { type: 'move.drop', sw: 'gun' }).state;
      s = settle(engine, act(engine, s, { type: 'move.step', to: 'yL5' }).state);
      expect(s.pieces['sq']!.loc).toEqual({ kind: 'hex', hex: 'yL5' });
      expect(s.pieces['gun']!.loc).toEqual({ kind: 'hex', hex: 'yK5' });
    }
  });

  it('a unit that keeps a Gun it picked up may still end its move there holding it (SK4 4.0)', () => {
    const { engine, state } = makeEngine({
      scenario: GE_VS_BR,
      extra,
      startPhase: 'MPh',
      dice: [1],
      pieces: [
        { id: 'sq', def: 'ge.467', side: 'ge', hex: 'yK4' },
        { id: 'gun', def: 'br.AT57L', side: 'br', hex: 'yK5' },
        { id: 'b1', def: 'br.457', side: 'br', hex: 'yA1' },
      ],
    });
    let s = act(engine, state, { type: 'move.start', units: ['sq'] }).state;
    s = settle(engine, act(engine, s, { type: 'move.step', to: 'yK5' }).state);
    s = settle(engine, act(engine, s, { type: 'move.recover', unit: 'sq', sw: 'gun' }).state);
    s = settle(engine, act(engine, s, { type: 'move.end' }).state);
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'phase', owner: 'ge' });
    expect(s.pieces['gun']!.loc).toEqual({ kind: 'held', by: 'sq' });
    expect(s.pieces['sq']!.loc).toEqual({ kind: 'hex', hex: 'yK5' });
  });
});
