import { describe, expect, it } from 'vitest';
import type { GameState, Piece } from '@asl/engine';
import { DEMO_VEHICLES_SCENARIO, newGame } from '@asl/content';
import { buildAttack, withoutSecrets } from '@asl/rules';
import { targetOwnDrms } from '../src/game/targetDrm';

/*
 * Any unit possessing a FT deducts one from the IFT resolution DR of any attack against it (SK1 4.2, ASLRB A22.4). The
 * engine applies it to that unit's own result, so the attack's DRM never shows it: the shot preview names it per unit.
 */
const unit = (id: string, defId: string, hex: string, side: string, tags: Piece['tags'] = {}): Piece => ({ id, defId, side, loc: { kind: 'hex', hex }, tags });
const held = (id: string, defId: string, by: string, side: string): Piece => ({ id, defId, side, loc: { kind: 'held', by }, tags: {} });

function preview(targets: Piece[]) {
  const { engine, state } = newGame(DEMO_VEHICLES_SCENARIO, 'target-drm', { los: 'grid' });
  const pieces = [unit('ge1', 'ge.467', 'yR5', 'ge'), ...targets];
  const env = engine.env({ ...state, pieces: Object.fromEntries(pieces.map((p) => [p.id, p])) } as GameState);
  const attack = { ...buildAttack(env, { units: ['ge1'], sw: [], target: 'yR4' }, 'prep', 'ge'), hindrance: 0, losBlind: true };
  const shared = withoutSecrets(env.explain('fire.drm', { attack }, 0)).value;
  return { shared, lines: targetOwnDrms(env, attack, shared) };
}

describe('the shot preview names a target\'s own DRM (SK1 4.2, ASLRB A22.4)', () => {
  it('names the squad holding the FT, with the DRM against it, and not the squad beside it', () => {
    const { shared, lines } = preview([unit('am1', 'am.666', 'yR4', 'am'), held('ft', 'am.FT', 'am1', 'am'), unit('am2', 'am.666', 'yR4', 'am')]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('-1 vs FT possessor');
    expect(lines[0]).toContain(`DRM ${shared - 1 >= 0 ? '+' : ''}${shared - 1} vs it`);
  });

  it('says nothing when no target has a DRM of its own', () => {
    expect(preview([unit('am1', 'am.666', 'yR4', 'am')]).lines).toEqual([]);
  });

  it('never names a concealed target', () => {
    expect(preview([unit('am1', 'am.666', 'yR4', 'am', { concealed: true }), held('ft', 'am.FT', 'am1', 'am')]).lines).toEqual([]);
  });
});
