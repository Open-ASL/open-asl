import { describe, expect, it } from 'vitest';
import { ALL_SCENARIOS, infantryOnly } from '@asl/content';

describe('the computer opponent', () => {
  it('knows a Guns or armor scenario when it sees one', () => {
    const byId = (id: string) => ALL_SCENARIOS.find((s) => s.id === id)!;
    expect(infantryOnly(byId('demo-armor'))).toBe(false);
    expect(infantryOnly(byId('demo-gun-line'))).toBe(false);
    expect(infantryOnly(byId('sk-s28'))).toBe(false);
    expect(infantryOnly(byId('sk-s7'))).toBe(true);
  });
});

describe('Full ASL', () => {
  it('stays closed to players: the lobby lists it disabled without the gate, and every Full ASL scenario plays only under its own gated ruleset', async () => {
    const { rulesetsFor } = await import('@asl/platform');
    const { fullAslOpen, rulesetOf } = await import('../src/lib/scenarios');
    expect(rulesetsFor(false).find((r) => r.id === 'full-asl')?.enabled).toBe(false);
    const player = { uid: 'u', token: {} } as never;
    const admin = { uid: 'a', token: { admin: true } } as never;
    const emulator = process.env['FUNCTIONS_EMULATOR'];
    delete process.env['FUNCTIONS_EMULATOR'];
    try {
      expect(fullAslOpen(player)).toBe(false);
      expect(fullAslOpen(admin)).toBe(true);
    } finally {
      if (emulator !== undefined) process.env['FUNCTIONS_EMULATOR'] = emulator;
    }
    for (const s of ALL_SCENARIOS.filter((x) => x.ruleset === 'full-asl')) expect(rulesetOf(s), s.id).toBe('full-asl');
  });
});
