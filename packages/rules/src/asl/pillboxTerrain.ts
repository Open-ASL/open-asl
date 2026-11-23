import type { TerrainDef } from '../common/statics';

/**
 * The Location inside a pillbox counter as terrain (full ASL, ASLRB B30; no Starter Kit map has one): the `'hex.terrain'`
 * of a `<hex>:pb` Location (`asl/pillboxes.ts`). One MF to enter from its hex (B30.4); its TEM is the counter's CA or NCA
 * Defense Modification by the attack (B30.112, B30.113), not a terrain number, so `tem` is 0 and the pillbox rules add
 * it; never Open Ground; a building for rout and rally (B30.5, A10.61: the Terrain Chart's underlined -1 Rally DRM);
 * Concealment Terrain (B30.7, the chart's red name).
 */
export const PILLBOX_TERRAIN: TerrainDef = { id: 'pillbox', name: 'Pillbox', mf: 1, tem: 0, los: 'none', openGround: false, routShelter: true, rallyCover: true, concealment: true };
