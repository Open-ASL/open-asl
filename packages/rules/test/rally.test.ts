import { describe, expect, it } from 'vitest';
import { stackOrder } from '../src';
import { act, makeEngine } from './fixtures';

describe('Rally Phase (SK1 3.1)', () => {
  it('a leader rally records the DRM, its sources and the leader on the check event', () => {
    const { engine, state } = makeEngine({
      terrain: { yN5: { terrain: 'building-stone' } },
      startPhase: 'RPh',
      pieces: [
        { id: 'aL', def: 'am.L91', side: 'am', hex: 'yN5' },
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5', tags: { broken: true, dm: true } },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
      ],
      dice: [2, 2],
    });
    expect(engine.legalActions(state, 'am').some((a) => a.type === 'rally.rally' && a['unit'] === 'a1')).toBe(true);
    const t = act(engine, state, { type: 'rally.rally', leader: 'aL', unit: 'a1' });
    const ev = t.events.find((e) => e.type === 'sk1.check')!.payload as Record<string, unknown>;
    expect(ev['kind']).toBe('rally');
    expect(ev['leader']).toBe('aL');
    // +4 DM, -1 building, -1 leadership.
    expect(ev['drm']).toBe(2);
    expect(ev['dr']).toBe(4);
    expect(ev['final']).toBe(6);
    const labels = (ev['explain'] as { label?: string }[]).map((n) => n.label);
    expect(labels).toEqual(expect.arrayContaining(['+4 Desperation Morale', '-1 woods/building', 'leadership']));
    expect(ev['outcome']).toBe('rallied');
    expect(t.state.pieces['a1']!.tags['broken']).toBeUndefined();
  });

  it('a failed self-rally is reported as failed', () => {
    const { engine, state } = makeEngine({
      startPhase: 'RPh',
      pieces: [
        { id: 'aL', def: 'am.L91', side: 'am', hex: 'yN5', tags: { broken: true } },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
      ],
      dice: [6, 5],
    });
    const t = act(engine, state, { type: 'rally.selfRally', unit: 'aL' });
    const ev = t.events.find((e) => e.type === 'sk1.check')!.payload as Record<string, unknown>;
    expect(ev['outcome']).toBe('failed');
    expect(ev['leader']).toBeNull();
    expect((ev['explain'] as { label?: string }[]).map((n) => n.label)).toContain('+1 self-rally');
    expect(t.state.pieces['aL']!.tags['broken']).toBe(true);
  });

  it('an original 2 on a first self-rally rolls Leader Creation and reports the leader it made (SK1 5.3)', () => {
    const { engine, state } = makeEngine({
      startPhase: 'RPh',
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5', tags: { broken: true, dm: true } },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
      ],
      // Rally DR 1+1 = 2, then a Leader Creation dr of 3: an 8-0 by the stub table below.
      dice: [1, 1, 3],
      tables: { leaderCreation: (nat, _morale, dr) => (dr <= 3 ? `${nat}.L80` : null) },
    });
    const t = act(engine, state, { type: 'rally.selfRally', unit: 'a1' });
    const ev = t.events.find((e) => e.type === 'sk1.leaderCreation')!.payload as Record<string, unknown>;
    expect(ev['unit']).toBe('a1');
    expect(ev['dr']).toBe(3);
    expect(ev['defId']).toBe('am.L80');
    const leader = t.state.pieces[ev['leader'] as string]!;
    expect(leader.defId).toBe('am.L80');
    expect(leader.loc).toEqual({ kind: 'hex', hex: 'yN5' });
    // A dr that makes no leader still reports the outcome.
    const none = makeEngine({
      startPhase: 'RPh',
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5', tags: { broken: true, dm: true } },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
      ],
      dice: [1, 1, 6],
      tables: { leaderCreation: (nat, _morale, dr) => (dr <= 3 ? `${nat}.L80` : null) },
    });
    const t2 = act(none.engine, none.state, { type: 'rally.selfRally', unit: 'a1' });
    const ev2 = t2.events.find((e) => e.type === 'sk1.leaderCreation')!.payload as Record<string, unknown>;
    expect(ev2['leader']).toBeNull();
    expect(Object.values(t2.state.pieces).filter((p) => p.side === 'am')).toHaveLength(1);
  });

  // The unit rallies on its DR, then the dr makes the leader: shown in that order, the rallied unit has shed its DM before
  // the leader appears, and the leader stands on the unit that made him (SK1 3.8), on top of the stack.
  it('a field promotion: the unit is rallied first, the new leader goes on top of it, and the table sees it broken', () => {
    const seen: boolean[] = [];
    const { engine, state } = makeEngine({
      startPhase: 'RPh',
      pieces: [
        // An unbroken squad sorts first: without his own stacking the leader would go on it.
        { id: 'a0', def: 'am.666', side: 'am', hex: 'yN5' },
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5', tags: { broken: true, dm: true } },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
      ],
      dice: [1, 1, 3],
      tables: {
        leaderCreation: (nat, _morale, dr, broken) => {
          seen.push(!!broken);
          return dr <= 3 ? `${nat}.L80` : null;
        },
      },
    });
    const t = act(engine, state, { type: 'rally.selfRally', unit: 'a1' });
    // SK1 5.3 Leader Creation Table: +1 Broken, as the unit was when it rolled the 2.
    expect(seen).toEqual([true]);
    const rallied = t.events.findIndex((e) => e.type === 'piece.tagged' && (e.payload as { id: string }).id === 'a1' && (e.payload as { tags: Record<string, unknown> }).tags['broken'] === null);
    const created = t.events.findIndex((e) => e.type === 'piece.created');
    expect(rallied).toBeGreaterThanOrEqual(0);
    expect(rallied).toBeLessThan(created);
    const leader = (t.events[created]!.payload as { piece: { id: string } }).piece.id;
    expect(t.state.pieces['a1']!.tags).not.toHaveProperty('dm');
    expect(t.state.pieces[leader]!.tags['stackedOn']).toBe('a1');
    const env = engine.env(t.state);
    const order = stackOrder(env, Object.values(t.state.pieces).filter((p) => p.side === 'am'));
    expect(order.map((p) => p.id)).toEqual(['a0', 'a1', leader]);
    // Into the next phase: the leader is a unit like any other, still on his squad.
    let next = t.state;
    for (let i = 0; i < 3 && next.phase === 'RPh'; i++) next = act(engine, next, { type: 'endPhase' }).state;
    expect(next.phase).toBe('PFPh');
    expect(next.pieces[leader]!.tags['stackedOn']).toBe('a1');
  });

  it('no self-rally in a Location with a Good Order friendly leader (ASL A10.63)', () => {
    const { engine, state } = makeEngine({
      startPhase: 'RPh',
      pieces: [
        { id: 'aL', def: 'am.L91', side: 'am', hex: 'yN5' },
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5', tags: { broken: true } },
        { id: 'a2', def: 'am.747', side: 'am', hex: 'yN6', tags: { broken: true } },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
      ],
    });
    const self = engine.legalActions(state, 'am').filter((a) => a.type === 'rally.selfRally').map((a) => a['unit']);
    expect(self).toEqual(['a2']);
    expect(engine.validate(state, { type: 'rally.selfRally', unit: 'a1', side: 'am', decisionId: engine.currentDecision(state)!.id })).toMatch(/leader/);
  });

  it('a leader rallies every broken unit in his Location in one action, each with its own DR', () => {
    const { engine, state } = makeEngine({
      startPhase: 'RPh',
      pieces: [
        { id: 'aL', def: 'am.L91', side: 'am', hex: 'yN5' },
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5', tags: { broken: true } },
        { id: 'a2', def: 'am.747', side: 'am', hex: 'yN5', tags: { broken: true } },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
      ],
      dice: [2, 2, 6, 5],
    });
    expect(engine.legalActions(state, 'am').some((a) => a.type === 'rally.rallyAll' && a['leader'] === 'aL')).toBe(true);
    const t = act(engine, state, { type: 'rally.rallyAll', leader: 'aL' });
    const checks = t.events.filter((e) => e.type === 'sk1.check').map((e) => e.payload as Record<string, unknown>);
    expect(checks.map((c) => [c['unit'], c['outcome']])).toEqual([
      ['a1', 'rallied'],
      ['a2', 'failed'],
    ]);
    expect(t.state.pieces['a1']!.tags['broken']).toBeUndefined();
    expect(t.state.pieces['a2']!.tags['broken']).toBe(true);
    expect(engine.legalActions(t.state, 'am').some((a) => a.type.startsWith('rally.rally'))).toBe(false);
  });

  it('a leader killed by an original 12 on his rally causes the LLMC at once, not at the next fire attack (ASLRB A10.2)', () => {
    const { engine, state } = makeEngine({
      startPhase: 'RPh',
      pieces: [
        { id: 'aL', def: 'am.L91', side: 'am', hex: 'yN5', tags: { broken: true } },
        { id: 'a1', def: 'am.336', side: 'am', hex: 'yN5', tags: { broken: true } },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
      ],
      // Self-rally 12, wound severity 6 (killed), then the HS's LLMC: 5 + 1 (the 9-1's -1 reversed) passes its 6.
      dice: [6, 6, 6, 3, 2],
    });
    const t = act(engine, state, { type: 'rally.selfRally', unit: 'aL' });
    expect(t.state.pieces['aL']!.loc.kind).toBe('eliminated');
    const llmc = t.events.filter((e) => e.type === 'sk1.check').map((e) => e.payload as Record<string, unknown>).find((c) => c['unit'] === 'a1');
    expect(llmc?.['reason']).toBe('LLMC');
    expect(llmc?.['final']).toBe(6);
    expect(t.state.ext['sk1.leaderLoss']).toBeUndefined();
  });

  it('only Infantry recovers: a loose weapon can never recover itself', () => {
    const { engine, state } = makeEngine({
      startPhase: 'RPh',
      pieces: [
        { id: 'a1', def: 'am.666', side: 'am', hex: 'yN5', tags: { broken: true } },
        { id: 'aMMG', def: 'am.MMG', side: 'am', hex: 'yN5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
      ],
      dice: [1],
    });
    expect(() => act(engine, state, { type: 'rally.recover', unit: 'aMMG', sw: 'aMMG' })).toThrow(/Only Infantry/);
    expect(() => act(engine, state, { type: 'rally.recover', unit: 'a1', sw: 'aMMG' })).toThrow(/Good Order/);
  });

  it('a unit makes one repair attempt, and a SW that failed its dr cannot be passed on to try again (SK1 3.1; ASLRB A9.72)', () => {
    const { engine, state } = makeEngine({
      startPhase: 'RPh',
      pieces: [
        { id: 'a1', def: 'am.666', side: 'am', hex: 'yN5' },
        { id: 'a2', def: 'am.666', side: 'am', hex: 'yN5' },
        { id: 'aMMG', def: 'am.MMG', side: 'am', heldBy: 'a1', tags: { malf: true } },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
      ],
      // A Repair dr of 4: no change (R2).
      dice: [4],
    });
    const t = act(engine, state, { type: 'rally.repair', unit: 'a1', sw: 'aMMG' });
    expect(t.state.pieces['aMMG']!.tags['malf']).toBe(true);
    expect(engine.legalActions(t.state, 'am').some((a) => a.type === 'rally.repair')).toBe(false);
    expect(() => act(engine, t.state, { type: 'rally.repair', unit: 'a1', sw: 'aMMG' })).toThrow(/already acted/);
    const passed = act(engine, t.state, { type: 'rally.transfer', sw: 'aMMG', to: 'a2' });
    expect(() => act(engine, passed.state, { type: 'rally.repair', unit: 'a2', sw: 'aMMG' })).toThrow(/already attempted/);
  });
});
