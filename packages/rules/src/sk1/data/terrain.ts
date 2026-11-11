import type { TerrainDef } from '../../common/statics';

/** SK1 terrain (SK1 1.1.1) plus SK2 brush. Roads are hex features on Open Ground; Woods-Road is woods + feature, Orchard-Road orchard + feature. */
export const SK1_TERRAIN: Record<string, TerrainDef> = {
  open: { id: 'open', name: 'Open Ground', mf: 1, tem: 0, los: 'none', openGround: true },
  woods: { id: 'woods', name: 'Woods', mf: 2, tem: 1, los: 'obstacle', openGround: false, routShelter: true, rallyCover: true, airBursts: true, height: 1 },
  orchard: { id: 'orchard', name: 'Orchard', mf: 1, tem: 0, los: 'hindrance', openGround: false, inherent: true, height: 1 },
  grain: { id: 'grain', name: 'Grain', mf: 1.5, tem: 0, los: 'hindrance', openGround: false },
  /** SK2 (SK4 1.1.1): a thinly wooded area with dense undergrowth; +1 Hindrance per hex, no TEM, not Open Ground. */
  brush: { id: 'brush', name: 'Brush', mf: 2, tem: 0, los: 'hindrance', openGround: false },
  /** Scenario terrain (SSR): cannot be entered, no effect on LOS. */
  flooded: { id: 'flooded', name: 'Flooded', mf: Infinity, tem: 0, los: 'none', openGround: true },
  /** Scenario terrain (S33 SSR 1: "Plowed Fields cost 1½ MF per hex entered and are treated as Open Ground for all other purposes"). */
  plowed: { id: 'plowed', name: 'Plowed Field', mf: 1.5, tem: 0, los: 'none', openGround: true },
  /**
   * Scenario terrain (S35 SSR 1: "Orchards are shellholes, which have no effect on LOS, provide a +1 TEM for infantry units,
   * and cost 2 MF to enter"; ASLRB B2). Not Open Ground (B2.4: entered at 2 MF). Vehicles pay the Open Ground rate.
   */
  shellholes: { id: 'shellholes', name: 'Shellholes', mf: 2, tem: 1, los: 'none', openGround: false },
  'building-stone': {
    id: 'building-stone',
    name: 'Stone Building',
    mf: 2,
    tem: 3,
    los: 'obstacle',
    openGround: false,
    routShelter: true,
    rallyCover: true,
    height: 1,
  },
  /**
   * Scenario terrain (SSR, S18: "All woods and orchards are stone rubble"): ASLRB B24 stone rubble, 3 MF (B24.4), +3 TEM
   * (B24.3), blocking LOS as an Inherent obstacle, along its hexsides too, and Ambush terrain; not a building, so neither
   * a rout destination nor rally cover (B24.1).
   */
  'rubble-stone': {
    id: 'rubble-stone',
    name: 'Stone Rubble',
    mf: 3,
    tem: 3,
    los: 'obstacle',
    openGround: false,
    inherent: true,
    ambush: true,
    blocksRoad: true,
    /** A half-level obstacle (ASLRB B10.1): never blocks a higher Location nor makes a Blind Hex (A6.21). */
    height: 0.5,
  },
  'building-wood': {
    id: 'building-wood',
    name: 'Wooden Building',
    mf: 2,
    tem: 2,
    los: 'obstacle',
    openGround: false,
    routShelter: true,
    rallyCover: true,
    height: 1,
  },
};
