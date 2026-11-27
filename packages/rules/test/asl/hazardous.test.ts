import { describe, expect, it } from 'vitest';
import type { RuleModule } from '@asl/engine';
import { aslCoreModules, piecesModule, shotContext, turnModule } from '../../src';
import { sk1CoreModules } from '../../src/sk1';
import { sk2CoreModules } from '../../src/sk2';
import { sk3CoreModules } from '../../src/sk3';
import { GE_VS_BR, act, makeEngine, type PieceSpec } from '../fixtures';

/*
 * Hazardous Movement in full ASL (ASLRB A4.62): "-2 IFT DRM to any attacks against units so engaged ... until they are
 * pinned"; "Neither FFMO nor FFNAM apply to shots affected by Hazardous Movement; however, Hazardous Movement is cumulative
 * with all other terrain DRM" — on the IFT and on an ordnance To Hit DR (Q&A [K33-d] to A4.62).
 */

const ASL: RuleModule[] = [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules, ...aslCoreModules];
const pieces: PieceSpec[] = [
  { id: 'c1', def: 'ge.228c', side: 'ge', hex: 'yK5' },
  { id: 'g75', def: 'ge.AT75L', side: 'ge', heldBy: 'c1', tags: { ca: 1, emplaced: true } },
  { id: 'b1', def: 'br.457', side: 'br', hex: 'yN5' },
  { id: 'bc', def: 'br.228c', side: 'br', hex: 'yN6' },
  { id: 'b57', def: 'br.AT57L', side: 'br', heldBy: 'bc', tags: { ca: 4 } },
];

describe('A4.62 Hazardous Movement', () => {
  it('a crew pushing its Gun into woods: -2 for the Hazardous Movement on top of the woods TEM, no FFNAM or FFMO', () => {
    // Push DR 2+2 (moved); the British 4-5-7 rolls 3+4.
    const { engine, state } = makeEngine({ scenario: GE_VS_BR, modules: ASL, terrain: { yL5: { terrain: 'woods' } }, startPhase: 'MPh', dice: [2, 2, 3, 4, 6, 6, 6, 6], pieces });
    let s = act(engine, state, { type: 'move.start', units: ['c1'], manhandle: 'g75' }).state;
    s = act(engine, s, { type: 'move.manhandle', to: 'yL5' }).state;
    const t = act(engine, s, { type: 'defFire', decl: { units: ['b1'], sw: [], target: 'yL5' } });
    const attack = t.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { explain: { label?: string }[] };
    const labels = attack.explain.map((n) => n.label ?? '');
    expect(labels.some((l) => /TEM|Woods/i.test(l))).toBe(true);
    expect(labels).not.toContain('-1 FFNAM');
    expect(labels).not.toContain('-1 FFMO');
    const result = t.events.find((e) => e.type === 'sk1.fire.result' && (e.payload as { unit: string }).unit === 'c1')?.payload as { explain?: { label: string }[] };
    expect(result.explain?.map((n) => n.label)).toContain('-2 Hazardous Movement (manhandling a Gun)');
  });

  it('ordnance at a pushing crew in the open: case 21 (-2) and no FFNAM or FFMO on the To Hit DR (Q&A [K33-d] to A4.62)', () => {
    const { engine, state } = makeEngine({ scenario: GE_VS_BR, modules: ASL, startPhase: 'MPh', pieces });
    const env = engine.env(state);
    const sc = shotContext(env, { weapon: 'b57', target: 'yK5', targetType: 'ITT' }, 'first', 'br', { moving: ['c1'], movingInfo: { assault: false, viaRoadIntoWoodsRoad: false, hazardous: true } });
    const labels = env.explain('ordnance.thDrm', sc, 0).trace.filter((t) => !t.suppressedBy && t.label).map((t) => String(t.label));
    expect(labels).toContain('-2 target using Hazardous Movement');
    expect(labels).not.toContain('-1 FFNAM');
    expect(labels).not.toContain('-1 FFMO');
  });
});
