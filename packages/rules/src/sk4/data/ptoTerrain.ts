import type { TerrainDef } from '../../common/statics';
import { SK1_TERRAIN } from '../../sk1/data/terrain';

/**
 * PTO Terrain (SK4 8.2, 8.2.1; the PTO Terrain Effects Chart). When PTO Terrain is in effect the map's woods are jungle,
 * brush is bamboo, orchards are palm trees, grain is kunai, wooden buildings of two or more separate depictions are huts,
 * and roads do not exist (Woods-Roads are paths). Values from the chart: Light Jungle 2 MF +1 TEM obstacle; Dense Jungle
 * 2 MF +2 TEM (-1 to Mortars) inherent obstacle, two squads; Bamboo all MF +1 TEM (-1 to DC/HE) inherent obstacle;
 * Palm Trees 1 MF +0, inherent +1 Hindrance, an obstacle between levels; Kunai 2 MF +0, +1 Hindrance (brush); Huts 2 MF
 * +1 TEM, +1 Hindrance across their depiction; Collapsed Huts 0 TEM. The red entries are Concealment Terrain (8.3).
 */
export const PTO_TERRAIN: Record<string, TerrainDef> = {
  jungle: { id: 'jungle', name: 'Dense Jungle', mf: 2, tem: 2, los: 'obstacle', openGround: false, inherent: true, routShelter: true, rallyCover: true, height: 1, concealment: true, airBursts: true, mortarTem: -1, stackingSe: 2, noMultiHexFg: true, recoveryDrm: 2, ambushAttackerDrm: 1 },
  'jungle-light': { id: 'jungle-light', name: 'Light Jungle', mf: 2, tem: 1, los: 'obstacle', openGround: false, routShelter: true, rallyCover: true, height: 1, concealment: true, airBursts: true, recoveryDrm: 2, ambushAttackerDrm: 1 },
  bamboo: { id: 'bamboo', name: 'Bamboo', mf: 2, tem: 1, los: 'obstacle', openGround: false, inherent: true, ambush: true, height: 1, concealment: true, heTem: -1, stackingSe: 2, noMultiHexFg: true, recoveryDrm: 2, ambushAttackerDrm: 1, allMf: true },
  palm: { id: 'palm', name: 'Palm Trees', mf: 1, tem: 0, los: 'hindrance', openGround: false, inherent: true, concealment: true, obstacleBetweenLevels: true },
  kunai: { id: 'kunai', name: 'Kunai', mf: 2, tem: 0, los: 'hindrance', openGround: false, ambush: true, concealment: true, noMultiHexFg: true, recoveryDrm: 2, ambushAttackerDrm: 1 },
  hut: { id: 'hut', name: 'Hut', mf: 2, tem: 1, los: 'hindrance', openGround: false, routShelter: true, rallyCover: true, height: 1, concealment: true, artHindrance: true, building: true },
  // Caves (S70 SSR 2; ASLRB G11): a Cave Location in a hill hex, +2 TEM (card; G11.8's +4 is full ASL), 2 MF, Concealment
  // and Rally Bonus Terrain (G11.1), one squad equivalent (G11.4); the Connection Location between the caves (a Cave
  // Complex, G11.2), a building for rout and rally (card), two squad equivalents per cave (G11.4).
  cave: { id: 'cave', name: 'Cave', mf: 2, tem: 2, los: 'none', openGround: false, routShelter: true, rallyCover: true, concealment: true, stackingSe: 1 },
  'cave-complex': { id: 'cave-complex', name: 'Connection Location', mf: 0, tem: 0, los: 'none', openGround: false, routShelter: true, rallyCover: true, concealment: true, stackingSe: 4 },
  'hut-collapsed': { id: 'hut-collapsed', name: 'Collapsed Hut', mf: 2, tem: 0, los: 'hindrance', openGround: false, concealment: true, artHindrance: true, building: true },
};

/** Every terrain the Starter Kits know: SK1–3's plus the PTO's. A superset of `SK1_TERRAIN`, so any scenario may use it. */
export const SK4_TERRAIN: Record<string, TerrainDef> = {
  ...Object.fromEntries(Object.entries(SK1_TERRAIN).map(([k, t]) => [k, k === 'building-stone' || k === 'building-wood' ? { ...t, concealment: true as const } : t])),
  ...PTO_TERRAIN,
};
