import { describe, expect, it } from 'vitest';
import type { Action, Ctx, Engine, GameState, RuleModule } from '@asl/engine';
import { acquisitionsAt, gunIdents, inCoveredArc, nearestSpine, sk2CoreModules, statics } from '../src';
import { GE_VS_BR, act, makeEngine } from './fixtures';

/** Test module: move a piece anywhere, as the engine's movement would. */
const teleport: RuleModule = {
  id: 'test.teleport',
  install(r) {
    r.action<Action & { id: string; hex: string }>({
      type: 'test.teleport',
      decisionKinds: ['phase'],
      resolve(ctx: Ctx, a) {
        ctx.emit('piece.moved', { id: a.id, loc: { kind: 'hex', hex: a.hex } });
      },
    });
    r.action<Action & { ids: string[]; hex: string }>({
      type: 'test.teleportAll',
      decisionKinds: ['phase'],
      resolve(ctx: Ctx, a) {
        for (const id of a.ids) ctx.emit('piece.moved', { id, loc: { kind: 'hex', hex: a.hex } });
      },
    });
    r.action<Action & { id: string; tags: Record<string, boolean | null> }>({
      type: 'test.tag',
      decisionKinds: ['phase'],
      resolve(ctx: Ctx, a) {
        ctx.emit('piece.tagged', { id: a.id, tags: a.tags });
      },
    });
    r.action<Action & { id: string }>({
      type: 'test.kill',
      decisionKinds: ['phase'],
      resolve(ctx: Ctx, a) {
        ctx.emit('piece.eliminated', { id: a.id, reason: 'test' });
      },
    });
  },
};
const extra = [...sk2CoreModules, teleport];
/** The spine a Gun in `gunHex` must point at to cover `target`. */
function spineFor(engine: Engine, state: GameState, gunHex: string, target: string): number {
  const map = statics(engine.env(state)).map;
  if (inCoveredArc(map.hex(gunHex)!.cube, 0, map.hex(target)!.cube)) return 0;
  return nearestSpine(map.hex(gunHex)!.cube, 0, map.hex(target)!.cube)!;
}

describe('Acquired Target counters (SK4 6.10, 6.11)', () => {
  it('sits on the target, follows it while the Gun has a LOS, stays in the last hex seen and passes to the next unit entering it', () => {
    const base = makeEngine({ pieces: [] });
    const ca = spineFor(base.engine, base.state, 'yK5', 'yO5');
    const { engine, state } = makeEngine({
      scenario: GE_VS_BR,
      extra,
      terrain: { yP4: { terrain: 'woods' }, yP5: { terrain: 'woods' } },
      dice: [6, 3],
      startPhase: 'PFPh',
      pieces: [
        { id: 'c1', def: 'ge.228c', side: 'ge', hex: 'yK5' },
        { id: 'g88', def: 'ge.AA88L', side: 'ge', heldBy: 'c1', tags: { ca } },
        { id: 'b1', def: 'br.457', side: 'br', hex: 'yO5' },
        { id: 'b2', def: 'br.457', side: 'br', hex: 'yO8' },
      ],
    });
    let t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'g88', target: 'yO5', targetType: 'ITT' } });
    expect(t.state.pieces['g88']!.tags).toMatchObject({ acq: 'ITT', acqHex: 'yO5', acqUnits: 'b1', acqLevel: 1 });
    expect(t.events.find((e) => e.type === 'sk2.acquired')!.payload).toMatchObject({ weapon: 'g88', hex: 'yO5', type: 'ITT', units: ['b1'], level: 1 });
    // The counter lies on the target hex, not on the Gun.
    expect(acquisitionsAt(engine.env(t.state), 'yO5').map((a) => [a.gun.id, a.level])).toEqual([['g88', 1]]);
    expect(acquisitionsAt(engine.env(t.state), 'yK5')).toEqual([]);
    // The target moves to O4, still in the Gun's LOS: the counter follows.
    t = act(engine, t.state, { type: 'test.teleport', id: 'b1', hex: 'yO4' });
    expect(t.state.pieces['g88']!.tags).toMatchObject({ acqHex: 'yO4', acqUnits: 'b1' });
    // Then behind the woods of P5, out of LOS: the counter stays in O4 and no longer follows b1.
    t = act(engine, t.state, { type: 'test.teleport', id: 'b1', hex: 'yQ5' });
    expect(t.state.pieces['g88']!.tags).toMatchObject({ acqHex: 'yO4', acqUnits: '' });
    t = act(engine, t.state, { type: 'test.teleport', id: 'b1', hex: 'yO6' });
    expect(t.state.pieces['g88']!.tags).toMatchObject({ acqHex: 'yO4', acqUnits: '' });
    // Another enemy unit entering O4 receives the acquisition and is followed in turn.
    t = act(engine, t.state, { type: 'test.teleport', id: 'b2', hex: 'yO4' });
    expect(t.state.pieces['g88']!.tags).toMatchObject({ acqHex: 'yO4', acqUnits: 'b2' });
    t = act(engine, t.state, { type: 'test.teleport', id: 'b2', hex: 'yN4' });
    expect(t.state.pieces['g88']!.tags).toMatchObject({ acqHex: 'yN4', acqUnits: 'b2' });
  });

  // SK4 6.11; ASLRB C6.521: a 5/8" counter belongs to its hex and cannot track a moving unit, which must be
  // re-acquired in its new hex. ASLRB C6.52: in the same hex it becomes a 1/2" counter at the level it had.
  describe('Area Acquisition belongs to the hex (SK4 6.11; ASLRB C6.52, C6.521)', () => {
    const mk = () => {
      const base = makeEngine({ pieces: [] });
      const ca = spineFor(base.engine, base.state, 'yK5', 'yO5');
      return makeEngine({
        scenario: GE_VS_BR,
        extra,
        dice: [6, 3],
        startPhase: 'PFPh',
        pieces: [
          { id: 'c1', def: 'ge.228c', side: 'ge', hex: 'yK5' },
          { id: 'g88', def: 'ge.AA88L', side: 'ge', heldBy: 'c1', tags: { ca, acq: 'ATT', acqHex: 'yO5', acqUnits: '', acqLevel: 2 } },
          { id: 'b1', def: 'br.457', side: 'br', hex: 'yO5' },
        ],
      });
    };
    const acquiredDrm = (t: { events: { type: string; payload: unknown }[] }) =>
      (t.events.find((e) => e.type === 'sk2.ordnance.shot')!.payload as { explain: { id: string }[] }).explain.some((x) => x.id === 'sk2.th.acquired');

    it('stays in its hex when the unit there moves on in LOS; a shot at the unit\'s new hex has no Acquisition DRM and gains a -1', () => {
      const { engine, state } = mk();
      let t = act(engine, state, { type: 'test.teleport', id: 'b1', hex: 'yO4' });
      expect(t.state.pieces['g88']!.tags).toMatchObject({ acq: 'ATT', acqHex: 'yO5', acqLevel: 2 });
      t = act(engine, t.state, { type: 'fire.ordnance', shot: { weapon: 'g88', target: 'yO4', targetType: 'ITT' } });
      expect(acquiredDrm(t)).toBe(false);
      expect(t.state.pieces['g88']!.tags).toMatchObject({ acq: 'ITT', acqHex: 'yO4', acqUnits: 'b1', acqLevel: 1 });
    });

    it('becomes a 1/2" counter on the unit when the Gun fires the Infantry Target Type into the same hex', () => {
      const { engine, state } = mk();
      const t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'g88', target: 'yO5', targetType: 'ITT' } });
      expect(acquiredDrm(t)).toBe(true);
      expect(t.state.pieces['g88']!.tags).toMatchObject({ acq: 'ITT', acqHex: 'yO5', acqUnits: 'b1', acqLevel: 2 });
    });
  });

  it('drops each acquired unit that is eliminated and goes with the last of them', () => {
    const base = makeEngine({ pieces: [] });
    const ca = spineFor(base.engine, base.state, 'yK5', 'yO5');
    const { engine, state } = makeEngine({
      scenario: GE_VS_BR,
      extra,
      dice: [6, 3],
      startPhase: 'PFPh',
      pieces: [
        { id: 'c1', def: 'ge.228c', side: 'ge', hex: 'yK5' },
        { id: 'g88', def: 'ge.AA88L', side: 'ge', heldBy: 'c1', tags: { ca } },
        { id: 'b1', def: 'br.457', side: 'br', hex: 'yO5' },
        { id: 'b2', def: 'br.457', side: 'br', hex: 'yO5' },
      ],
    });
    let t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'g88', target: 'yO5', targetType: 'ITT' } });
    expect(t.state.pieces['g88']!.tags).toMatchObject({ acqHex: 'yO5', acqUnits: 'b1,b2' });
    t = act(engine, t.state, { type: 'test.kill', id: 'b1' });
    expect(t.state.pieces['g88']!.tags).toMatchObject({ acqHex: 'yO5', acqUnits: 'b2' });
    // The counter sits on its target (SK4 6.10): nothing is left to hold it, and no later arrival inherits it.
    t = act(engine, t.state, { type: 'test.kill', id: 'b2' });
    expect(t.state.pieces['g88']!.tags['acq']).toBeUndefined();
    expect(acquisitionsAt(engine.env(t.state), 'yO5')).toEqual([]);
  });

  it('is lost when the manning unit fires its inherent FP, breaks or leaves the Gun', () => {
    const base = makeEngine({ pieces: [] });
    const ca = spineFor(base.engine, base.state, 'yK5', 'yO5');
    const mk = () =>
      makeEngine({
        scenario: GE_VS_BR,
        extra,
        dice: [6, 3, 3, 3, 3, 3],
        startPhase: 'PFPh',
        // A squad mans the Gun (Non-Qualified Use): unlike a crew it may still fire its own FP elsewhere.
        pieces: [
          { id: 'q1', def: 'ge.467', side: 'ge', hex: 'yK5' },
          { id: 'g88', def: 'ge.AA88L', side: 'ge', heldBy: 'q1', tags: { ca } },
          { id: 'b1', def: 'br.457', side: 'br', hex: 'yO5' },
          { id: 'b3', def: 'br.457', side: 'br', hex: 'yL5' },
        ],
      });
    const a = mk();
    let t = act(a.engine, a.state, { type: 'fire.ordnance', shot: { weapon: 'g88', target: 'yO5', targetType: 'ITT' } });
    expect(t.state.pieces['g88']!.tags['acqHex']).toBe('yO5');
    t = act(a.engine, t.state, { type: 'fire', decl: { units: ['q1'], sw: [], target: 'yL5' } });
    expect(t.state.pieces['g88']!.tags['acqHex']).toBeUndefined();
    const b = mk();
    t = act(b.engine, b.state, { type: 'fire.ordnance', shot: { weapon: 'g88', target: 'yO5', targetType: 'ITT' } });
    t = act(b.engine, t.state, { type: 'test.tag', id: 'q1', tags: { broken: true } });
    expect(t.state.pieces['g88']!.tags['acqHex']).toBeUndefined();
    const c = mk();
    t = act(c.engine, c.state, { type: 'fire.ordnance', shot: { weapon: 'g88', target: 'yO5', targetType: 'ITT' } });
    t = act(c.engine, t.state, { type: 'test.teleport', id: 'q1', hex: 'yK4' });
    expect(t.state.pieces['g88']!.tags['acqHex']).toBeUndefined();
  });

  it('tells a side\'s Guns apart by letter, in id order, each side from A', () => {
    const { engine, state } = makeEngine({
      scenario: GE_VS_BR,
      extra,
      pieces: [
        { id: 'c1', def: 'ge.228c', side: 'ge', hex: 'yK5' },
        { id: 'g2', def: 'ge.AA88L', side: 'ge', heldBy: 'c1', tags: { ca: 0 } },
        { id: 'c2', def: 'ge.228c', side: 'ge', hex: 'yK6' },
        { id: 'g1', def: 'ge.AT75L', side: 'ge', heldBy: 'c2', tags: { ca: 0 } },
        { id: 'bc', def: 'br.228c', side: 'br', hex: 'yO5' },
        { id: 'g40', def: 'br.AA40L', side: 'br', heldBy: 'bc', tags: { ca: 3 } },
      ],
    });
    const idents = gunIdents(state, engine.env(state));
    expect([idents.get('g1'), idents.get('g2'), idents.get('g40')]).toEqual(['A', 'B', 'A']);
  });

  describe('a scattered acquired stack: the firer chooses which target keeps the counter (SK4 6.10; ASLRB C6.5)', () => {
    // A British Gun in R5 has acquired the German stack in O5 (two squads); P5, next to it, is in the Gun's LOS too.
    const mk = (startPhase: string, dice: number[] = []) => {
      const probe = makeEngine({ scenario: GE_VS_BR, extra, pieces: [{ id: 'x', def: 'ge.467', side: 'ge', hex: 'yK5' }] });
      const ca = spineFor(probe.engine, probe.state, 'yR5', 'yO5');
      return makeEngine({
        scenario: GE_VS_BR,
        extra,
        startPhase,
        dice,
        pieces: [
          { id: 'c1', def: 'br.228c', side: 'br', hex: 'yR5' },
          { id: 'g40', def: 'br.AA40L', side: 'br', heldBy: 'c1', tags: { ca, acq: 'ITT', acqHex: 'yO5', acqUnits: 'e1,e2', acqLevel: 1 } },
          { id: 'e1', def: 'ge.467', side: 'ge', hex: 'yO5' },
          { id: 'e2', def: 'ge.467', side: 'ge', hex: 'yO5' },
        ],
      });
    };

    it('asks the Gun\'s owner when one unit leaves, offering both hexes; the counter stays where he says', () => {
      for (const keep of ['yO5', 'yP5']) {
        const { engine, state } = mk('MPh');
        let s = act(engine, state, { type: 'move.start', units: ['e1'] }).state;
        s = act(engine, s, { type: 'move.step', to: 'yP5' }).state;
        expect(engine.currentDecision(s)).toMatchObject({ kind: 'acqChoice', owner: 'br', data: { gun: 'g40' } });
        expect(engine.legalActions(s, 'br').map((a) => a['hex']).sort()).toEqual(['yO5', 'yP5']);
        const t = act(engine, s, { type: 'acq.choose', gun: 'g40', hex: keep });
        expect(t.state.pieces['g40']!.tags).toMatchObject({ acqHex: keep, acqUnits: keep === 'yO5' ? 'e2' : 'e1' });
        expect(t.events.find((e) => e.type === 'sk2.acq.kept')!.payload).toMatchObject({ weapon: 'g40', hex: keep });
        expect(engine.currentDecision(t.state)?.kind).toBe('firstFire');
      }
    });

    it('asks nothing when the stack moves on together', () => {
      const { engine, state } = mk('PFPh');
      const t = act(engine, state, { type: 'test.teleportAll', ids: ['e1', 'e2'], hex: 'yP5' });
      expect(engine.currentDecision(t.state)?.kind).toBe('phase');
      expect(t.state.pieces['g40']!.tags).toMatchObject({ acqHex: 'yP5', acqUnits: 'e1,e2' });
      // The same with a real move of the whole stack: Defensive First Fire is the next question, not a choice.
      const m = mk('MPh');
      let s = act(m.engine, m.state, { type: 'move.start', units: ['e1', 'e2'] }).state;
      s = act(m.engine, s, { type: 'move.step', to: 'yP5' }).state;
      expect(m.engine.currentDecision(s)?.kind).toBe('firstFire');
      expect(s.decisions.some((d) => d.kind === 'acqChoice')).toBe(false);
      expect(s.pieces['g40']!.tags).toMatchObject({ acqHex: 'yP5', acqUnits: 'e1,e2' });
    });

    // ASLRB C6.51: the counter is on the units it acquired; one that only passes through the acquired hex is not
    // acquired, so it neither takes the counter with it nor offers the firer a choice. While it is in that hex the
    // DRM applies to it too (C6.51: "to all Known units ... in that target Location").
    it('a unit that was not acquired passes through the acquired hex: the counter stays on the acquired unit, nothing is asked', () => {
      const probe = makeEngine({ scenario: GE_VS_BR, extra, pieces: [{ id: 'x', def: 'ge.467', side: 'ge', hex: 'yK5' }] });
      const ca = spineFor(probe.engine, probe.state, 'yR5', 'yO5');
      const { engine, state } = makeEngine({
        scenario: GE_VS_BR,
        extra,
        startPhase: 'MPh',
        dice: [5, 4],
        pieces: [
          { id: 'c1', def: 'br.228c', side: 'br', hex: 'yR5' },
          { id: 'g40', def: 'br.AA40L', side: 'br', heldBy: 'c1', tags: { ca, acq: 'ITT', acqHex: 'yO5', acqUnits: 'e1', acqLevel: 1 } },
          { id: 'e1', def: 'ge.467', side: 'ge', hex: 'yO5' },
          { id: 'e2', def: 'ge.467', side: 'ge', hex: 'yO6' },
        ],
      });
      let s = act(engine, state, { type: 'move.start', units: ['e2'] }).state;
      s = act(engine, s, { type: 'move.step', to: 'yO5' }).state;
      expect(s.pieces['g40']!.tags).toMatchObject({ acqHex: 'yO5', acqUnits: 'e1' });
      // In O5 with the acquired squad, a shot at it there takes the DRM (5+4 misses).
      expect(engine.currentDecision(s)?.kind).toBe('firstFire');
      const shot = act(engine, s, { type: 'defFire.ordnance', shot: { weapon: 'g40', target: 'yO5', targetType: 'ITT' } });
      expect((shot.events.find((e) => e.type === 'sk2.ordnance.shot')!.payload as { explain: { label: string }[] }).explain.map((n) => n.label)).toContain('-1 Acquired Target');
      // Without that shot, it moves on to P5, still in the Gun's LOS: the counter stays in O5 on e1, and no choice is offered.
      s = act(engine, s, { type: 'defPass', side: 'br' }).state;
      s = act(engine, s, { type: 'move.step', to: 'yP5' }).state;
      expect(s.pieces['g40']!.tags).toMatchObject({ acqHex: 'yO5', acqUnits: 'e1' });
      expect(s.decisions.some((d) => d.kind === 'acqChoice')).toBe(false);
      expect(engine.currentDecision(s)?.kind).toBe('firstFire');
    });

    it('in the MPh the firer chooses as soon as the step is made, before Defensive First Fire, which then fires with or without the DRM', () => {
      for (const keep of ['yP5', 'yO5']) {
        // 5+4 misses either way.
        const { engine, state } = mk('MPh', [5, 4]);
        let s = act(engine, state, { type: 'move.start', units: ['e1'] }).state;
        s = act(engine, s, { type: 'move.step', to: 'yP5' }).state;
        expect(engine.currentDecision(s)).toMatchObject({ kind: 'acqChoice', owner: 'br' });
        s = act(engine, s, { type: 'acq.choose', gun: 'g40', hex: keep }).state;
        expect(engine.currentDecision(s)?.kind).toBe('firstFire');
        const t = act(engine, s, { type: 'defFire.ordnance', shot: { weapon: 'g40', target: 'yP5', targetType: 'ITT' } });
        const shot = t.events.find((e) => e.type === 'sk2.ordnance.shot')!.payload as { explain: { label: string }[] };
        // Kept on the mover: the Acquired DRM, flipped to -2. Kept in O5: P5 is a different target, which it now acquires at -1.
        expect(shot.explain.map((n) => n.label).includes('-1 Acquired Target')).toBe(keep === 'yP5');
        expect(t.state.pieces['g40']!.tags).toMatchObject({ acqHex: 'yP5', acqUnits: 'e1', acqLevel: keep === 'yP5' ? 2 : 1 });
        expect(t.state.decisions.some((d) => d.kind === 'acqChoice')).toBe(false);
      }
    });

    it('the choice is gone by the next Player Turn, and the stack moves and fires normally (SK4 6.10)', () => {
      const { engine, state } = mk('MPh');
      let s = act(engine, state, { type: 'move.start', units: ['e1'] }).state;
      s = act(engine, s, { type: 'move.step', to: 'yP5' }).state;
      s = act(engine, s, { type: 'acq.choose', gun: 'g40', hex: 'yO5' }).state;
      for (let i = 0; i < 80 && !(s.turn === 1 && s.attacker === 'br' && s.phase === 'MPh') && !(s.turn > 1); i++) {
        const d = engine.currentDecision(s)!;
        const l = engine.legalActions(s, d.owner);
        const pick = l.find((a) => a.type === 'defPass') ?? l.find((a) => a.type === 'move.end') ?? l.find((a) => a.type === 'endPhase') ?? l[0]!;
        s = engine.submit(s, pick).state;
      }
      expect(s.attacker).toBe('br');
      expect(s.decisions.some((d) => d.kind === 'acqChoice')).toBe(false);
    });
  });
});
