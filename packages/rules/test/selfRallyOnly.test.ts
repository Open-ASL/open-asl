import { describe, expect, it } from 'vitest';
import { selfRallyOnlyModule } from '../src';
import { act, makeEngine } from './fixtures';

const GE_IT_VS_BR = {
  firstSide: 'ge',
  sides: [
    { side: 'ge', name: 'German', nationality: 'ge', elr: 3 },
    { side: 'br', name: 'Free French', nationality: 'br', elr: 4 },
  ],
  ssr: [{ module: 'self-rally-only', params: { side: 'ge', defs: ['ge.447'], rule: 'SSR 4' }, text: 'SSR 4' }],
};

const setup = (dice: number[] = []) =>
  makeEngine({
    scenario: GE_IT_VS_BR,
    extra: [selfRallyOnlyModule],
    startPhase: 'RPh',
    pieces: [
      { id: 'gL', def: 'ge.L91', side: 'ge', hex: 'yN5' },
      { id: 'i1', def: 'ge.447', side: 'ge', hex: 'yN5', tags: { broken: true } },
      { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yN5', tags: { broken: true } },
      { id: 'b1', def: 'br.457', side: 'br', hex: 'yP9' },
    ],
    dice,
  });

describe('Self-rally only by SSR (LMA8 SSR 4)', () => {
  it('no leader rallies the units concerned; they may self-rally though a Good Order leader is with them', () => {
    const { engine, state } = setup();
    const legal = engine.legalActions(state, 'ge');
    // The leader rallies the 4-6-7, not the 4-4-7 the rule names (the card's Italian militia).
    expect(legal.some((a) => a.type === 'rally.rally' && a['unit'] === 'g1')).toBe(true);
    expect(legal.some((a) => a.type === 'rally.rally' && a['unit'] === 'i1')).toBe(false);
    expect(engine.env(state).query('rally.byLeaderIllegal', { leader: 'gL', unit: 'i1' }, null)).toBe('Rallies only by self-rally (SSR 4)');
    // The militia self-rally (the ATTACKER's one MMC self-rally); the German squad still waits for its leader.
    expect(legal.some((a) => a.type === 'rally.selfRally' && a['unit'] === 'i1')).toBe(true);
    expect(legal.some((a) => a.type === 'rally.selfRally' && a['unit'] === 'g1')).toBe(false);
  });

  it('a successful self-rally returns the militia to Good Order, with the +1 self-rally DRM and no leadership', () => {
    const { engine, state } = setup([2, 2]);
    const t = act(engine, state, { type: 'rally.selfRally', unit: 'i1' });
    const ev = t.events.find((e) => e.type === 'sk1.check')!.payload as Record<string, unknown>;
    expect(ev['leader']).toBeNull();
    expect((ev['explain'] as { label?: string }[]).map((n) => n.label)).toContain('+1 self-rally');
    expect(ev['outcome']).toBe('rallied');
    expect(t.state.pieces['i1']!.tags['broken']).toBeUndefined();
  });

  it('without the SSR the leader rallies the militia as usual', () => {
    const { engine, state } = makeEngine({
      scenario: { ...GE_IT_VS_BR, ssr: [] },
      startPhase: 'RPh',
      pieces: [
        { id: 'gL', def: 'ge.L91', side: 'ge', hex: 'yN5' },
        { id: 'i1', def: 'ge.447', side: 'ge', hex: 'yN5', tags: { broken: true } },
        { id: 'b1', def: 'br.457', side: 'br', hex: 'yP9' },
      ],
    });
    const legal = engine.legalActions(state, 'ge');
    expect(legal.some((a) => a.type === 'rally.rally' && a['unit'] === 'i1')).toBe(true);
    expect(legal.some((a) => a.type === 'rally.selfRally' && a['unit'] === 'i1')).toBe(false);
  });
});
