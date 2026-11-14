import type { Cube, HexId, SideId } from '@asl/engine';

/** Counter definitions (static numbers printed on counters). */

export type UnitQuality = 'E' | '1' | '2' | 'G' | 'C';

interface CounterBase {
  id: string;
  nationality: string;
  /** Image keys (resolved by the client's asset manifest). */
  image?: { front: string; back?: string };
}

export interface MmcDef extends CounterBase {
  /** Crews (SK4 1.2.2): two men kneeling, always Elite, not subject to ELR; Casualty Reduction eliminates them. */
  kind: 'squad' | 'hs' | 'crew';
  quality: UnitQuality;
  fp: number;
  range: number;
  morale: number;
  brokenMorale: number;
  /** Broken-side morale is boxed. */
  selfRally: boolean;
  /** Underlined FP. */
  assaultFire: boolean;
  /** Smoke exponent, if any. */
  smoke?: number;
  /** Underlined morale: not subject to ELR replacement. */
  elrExempt: boolean;
  /** Half-squad this squad is reduced to by Casualty Reduction (squads only). */
  reducesTo?: string;
  /** One-step-lower-quality replacement for ELR failures. */
  elrReplacement?: string;
  /**
   * Japanese squads and crews (SK4 8.1.1, 8.1.6): no broken side, a Full-Strength and a Reduced-Strength side instead.
   * `stepTo` is the Reduced-Strength def a Full-Strength unit flips to on Step Reduction (8.1.2); `fullOf` points the
   * other way and marks a Reduced-Strength def (its CCV in Hand-to-Hand is the Full-Strength one's, 8.1.8.4).
   */
  noBrokenSide?: true;
  stepTo?: string;
  fullOf?: string;
  /** U.S.M.C. Raider MMC (SK4 8.4.2): -1 ambush drm when in Good Order. */
  raider?: true;
  /**
   * Basic Point Value (ASLRB A1.4; the BPV columns of the National Capabilities Chart): what A16 Battlefield
   * Integrity tallies and A18.2 Leader Creation compares. Absent where the chart lists no such unit. Leaders and SW
   * have none (they are allotted, never bought: ASLRB H1.2).
   */
  bpv?: number;
}

export interface SmcDef extends CounterBase {
  kind: 'leader';
  morale: number;
  brokenMorale: number;
  leadership: number;
  selfRally: true;
  /** Lower-quality leader for ELR replacement. */
  elrReplacement?: string;
  /** Japanese leaders (SK4 8.1.7): no broken side; a failed MC wounds instead. */
  noBrokenSide?: true;
}

/** Machine guns, flamethrowers and demolition charges (SK1), light mortars and light anti-tank weapons (SK2 ordnance SW). */
export type SwType = 'LMG' | 'MMG' | 'HMG' | 'FT' | 'DC' | 'MTR' | 'BAZ' | 'PSK' | 'PIAT' | 'ATR' | 'PF' | 'BMG' | 'CMG' | 'AAMG' | 'RMG';

export interface SwDef extends CounterBase {
  kind: 'sw';
  type: SwType;
  /**
   * Ordnance SW (SK4 4.4, 4.5): they secure a hit before resolving on the IFT. A Light Mortar has
   * its caliber ("50*": 50, '*'), the range in brackets on the counter and any Special Ammo.
   */
  ordnance?: { caliber: number; barrel?: 'L' | 'LL' | '*'; minRange?: number; maxRange?: number; specialAmmo?: SpecialAmmoDef[] };
  fp: number;
  range: number;
  pp: number;
  /** A vehicular MG (SK4 7.8): part of its vehicle, never dropped, transferred or recovered; `fixedMount` is a white-dotted BMG (+1 vs moving targets). */
  fixed?: boolean;
  fixedMount?: boolean;
  rof?: number;
  /** Breakdown number (repairable). MGs without one have an inherent B# of 12. */
  b?: number;
  /** Breakdown/removal number (not repairable). */
  x?: number;
  /** Repair dr (≤ repairs); undefined if not repairable. */
  repair?: number;
  /** "6" in the lower right of the malfunctioned side: removed on an original repair dr of 6. */
  removeOnRepair6?: boolean;
  /**
   * Light Anti-Tank Weapon with its own To Hit Table on the counter back (SK4 4.4): the TH# per range
   * from 0, and the HEAT To Kill number. `fp` is the IFT column of a hit on Infantry in a building.
   */
  latw?: { th: number[]; tk?: number };
}

/** Ordnance types; BAZ/PSK/PIAT are Light Anti-Tank Weapons seen as ordnance (`ordnanceOf`). */
export type GunType = 'AA' | 'AT' | 'INF' | 'ART' | 'MTR' | 'BAZ' | 'PSK' | 'PIAT' | 'PF' | 'MG' | 'ATR';

/** Ordnance ammunition types (SK4 6.2). */
export type AmmoKind = 'HE' | 'AP' | 'HEAT' | 'APCR' | 'APDS' | 'SMOKE' | 'WP';

/**
 * One Special Ammo entry on a counter (SK4 6.2): "s7" is Smoke with Depletion Number 7; "A5²/4³/3⁴"
 * is APCR at 5 from 1942, 4 from 1943, 3 from 1944. `steps` lists the numbers in date order; a step
 * with no `from` applies from the start of the war. Before the first dated step the ammo is not
 * available. `theater` limits it to one theater ("P": PTO only).
 */
export interface SpecialAmmoDef {
  kind: AmmoKind;
  steps: { n: number; from?: { year: number; month?: number } }[];
  theater?: 'ETO' | 'PTO';
}

/** A Gun (SK4 1.2.6, 6.0): ordnance on a 5/8" counter, possessed like a SW and manned by a crew. */
export interface GunDef extends CounterBase {
  kind: 'gun';
  type: GunType;
  /** Caliber in mm and barrel length as printed ("40L": 40, 'L'). */
  caliber: number;
  barrel?: 'L' | 'LL' | '*';
  rof?: number;
  /** Infantry Firepower Equivalent (SK4 6.8): the number in parentheses after the caliber. */
  ife?: number;
  /** Manhandling number (SK4 6.5). */
  m: number;
  /** Target size (SK4 6.7): the M# on a white circle is a small target, in red a large one. */
  targetSize: 'normal' | 'small' | 'large';
  /** A white circle around the depiction is a 360° mount; all other Guns are Non-Turreted (SK4 3.2.4). A vehicle's MA (`vehicle`) carries its turret type. */
  mount: Mount;
  /** Quick Set Up: may be manhandled (SK4 1.2.6, 6.5); a Limbered Gun cannot move during a scenario. */
  qsu: boolean;
  /** AT and INF Guns have a gunshield (SK4 6.6). */
  gunshield: boolean;
  /** Ammunition it may fire (SK4 6.0, 6.2): HE unless the caliber is underscored, AP unless overscored. */
  ammo: { he: boolean; ap: boolean };
  /**
   * Special Ammo and limited ammunition the back of the counter lists (SK4 6.2): each kind with its
   * Depletion Number. A listed HE or AP is limited even where the caliber's scoring allows it.
   */
  specialAmmo?: SpecialAmmoDef[];
  /** "No IF" on the counter: the Gun may not use Intensive Fire (SK4 3.2.4). */
  noIntensive?: boolean;
  /**
   * A SW seen as ordnance (`ordnanceOf`): a Light Mortar (SK4 4.5), LATW (4.4) or Anti-Tank Rifle
   * (4.4.4), with no Covered Arc, fired by any squad, HS or SMC without Non-Qualified Use, never with
   * Intensive Fire.
   */
  light?: boolean;
  /**
   * A Light Anti-Tank Weapon (SK4 4.4) seen as ordnance: its own To Hit Table (TH# by range from 0),
   * the IFT column of a hit on Infantry in a building (doubled for a Critical Hit) and the X#.
   */
  latw?: { th: number[]; fp: number; x?: number; tk?: number };
  /** The Main Armament of a vehicle seen as a Gun (`ordnanceOf`): the vehicle piece is the weapon (SK4 7.2). */
  vehicle?: boolean;
  /** Mortars: minimum and maximum range in brackets on the counter (SK4 6.9). */
  minRange?: number;
  maxRange?: number;
  /** Breakdown number; Guns without one have an inherent B# of 12 (SK4 6.12). */
  b?: number;
  /** Repair dr (Guns repair on a 1) and whether an original repair dr of 6 removes it. */
  repair?: number;
  removeOnRepair6?: boolean;
}

/** Vehicle turret types (SK4 7.2): Fast, Slow, Restricted Slow, One Man Turret, or Non-Turreted (bow-mounted MA). */
export type TurretType = 'T' | 'ST' | 'RST' | '1MT' | 'NT';
/** How a weapon turns to a target: a Gun's 360° mount or NT (SK4 3.2.4), a vehicle's turret type (7.2). */
export type Mount = '360' | TurretType;

/** Armor Factors of one aspect (hull or turret) by target facing (SK4 7.1); side and rear share a printed value. */
export interface ArmorFacings {
  front: number;
  side: number;
  rear: number;
}

/**
 * A vehicle (SK4 1.2.7, 7.0): a 5/8" counter that spends MP, has a Vehicle Covered Arc and, if armed,
 * a Main Armament that fires as ordnance and machine guns that fire on the IFT. All SK vehicles are
 * AFV (they have Armor Factors).
 */
export interface VehicleDef extends CounterBase {
  kind: 'vehicle';
  /** The VASL piece name ("T-34 M43"). */
  name: string;
  /** Fully Tracked (oval behind the MP) or an Armored Car (circle). */
  tracked: boolean;
  /** Movement Point allowance. */
  mp: number;
  /** A red MP number: Mechanical Reliability, a DR on each start (SK4 3.3.2). */
  redMp?: boolean;
  /** Russian Vehicle Note M (SK3): a Mechanical Reliability DR of 11 stalls the vehicle instead. */
  stallOn11?: boolean;
  /** The unit letter's box (low) or circle (high) in the counter's upper left (SK4 7.6). */
  groundPressure: 'low' | 'normal' | 'high';
  /** Armor Factors (SK4 7.1), the turret's already stepped along the AF ladder for the circle/square marks. */
  af: { hull: ArmorFacings; turret: ArmorFacings };
  turret: TurretType;
  /** Target size by the colour of the AF numbers (SK4 7.3): -2 … +2 To Hit. */
  targetSize: 'veryLarge' | 'large' | 'normal' | 'small' | 'verySmall';
  /** Main Armament (SK4 7.2); absent on an unarmed vehicle. `type: 'MG'` is a MG-only MA on the AP To Kill Table. */
  ma?: {
    type: GunType | 'MG';
    caliber: number;
    barrel?: 'L' | 'LL' | '*';
    rof?: number;
    /** Breakdown number (inherent 12 when absent); `lowAmmo` when it is circled (SK4 7.2.1). */
    b?: number;
    lowAmmo?: boolean;
    ife?: number;
    ammo: { he: boolean; ap: boolean };
    specialAmmo?: SpecialAmmoDef[];
    noIntensive?: boolean;
  };
  /** Machine guns (SK4 7.8): Bow / Coaxial / Anti-Aircraft / Rear FP; a white dot on the BMG is a Fixed Mount. */
  mg: { bmg?: number; bmgFixed?: boolean; cmg?: number; aamg?: number; rmg?: number };
  /** The MA is one of the vehicle's MGs (the Light Tank Mk VIB prints "*CMG" with a ROF box): that MG fires with the MA's ROF. */
  maMg?: { mg: 'bmg' | 'cmg'; rof?: number };
  /** Open-Topped (SK4 7.13): the depiction on a white background. */
  openTopped?: boolean;
  /** Vehicular smoke dispensers with their usage numbers (SK4 7.5). */
  smoke?: { kind: 'sD' | 'sM' | 'sP' | 'sN'; n: number }[];
  /** The protective DRM of a Crew Exposed crew (SK4 7.7); 2 for every SK vehicle. */
  ceDrm: number;
  /** The inherent crew's morale: the nationality's best unbroken elite Infantry MMC (SK4 7.9). */
  crewMorale: number;
  /** Casualty Victory Points for its loss (0 until the ASLRB vehicle CVP table is adopted). */
  cvp: number;
  /** The vehicle's identifying letter or number on the counter. */
  unitId?: string;
  /** Crew Survival number (full ASL; informational). */
  cs?: number;
  /** The Vehicle Note number in the kit's notes booklet. */
  note?: number;
}

/**
 * A stand-in for pieces a viewer may not inspect: a redacted view (`redactState`) replaces an enemy's concealed
 * stack by one piece of this def, so the board shows a "?" counter where the stack is and nothing else about it.
 * `big` marks a 5/8" counter (the stack holds a Gun). No rule treats it as a unit: `mmc`/`smc`/`isPersonnelDef`
 * are false for it.
 */
export interface UnknownDef extends CounterBase {
  kind: 'unknown';
  big?: boolean;
}

export type CounterDef = MmcDef | SmcDef | SwDef | GunDef | VehicleDef | UnknownDef;

/** The def id of the "?" stand-in (registered in every counter set). */
export const UNKNOWN_DEF_ID = '?';
export const UNKNOWN_DEF: UnknownDef = { id: UNKNOWN_DEF_ID, kind: 'unknown', nationality: '?' };

/** Terrain. Numbers are data; how they're used is decided by rule modules. */

export type LosEffect = 'none' | 'hindrance' | 'obstacle';

export interface TerrainDef {
  id: string;
  name: string;
  /** Infantry MF to enter. */
  mf: number;
  tem: number;
  los: LosEffect;
  /** Counts as Open Ground for FFMO/Interdiction. */
  openGround: boolean;
  /** Inherent terrain: the whole hex including hexsides has the effect. */
  inherent?: boolean;
  /** Valid rout destination ("building or woods"). */
  routShelter?: boolean;
  /** Building or woods for rally -1 DRM. */
  rallyCover?: boolean;
  /** Ambush may occur in it although it is no rally cover (ASLRB B24: rubble "is considered a building for Ambush"). */
  ambush?: boolean;
  /** A road through the hex is no road: entering costs the terrain's MF whatever the hexside (ASLRB B24.4 rubble). */
  blocksRoad?: boolean;
  /**
   * Height of the obstacle in levels (ASLRB A6.2: woods and a Single Story House 1, B13.2, B23.21; rubble ½, B10.1; an
   * orchard 1, but only in season and only to a LOS to/from a higher elevation, B14.2). Read only by the full ASL LOS
   * between heights (`GameMap.losAt`); a hex's `MapHex.obstacleHeight` overrides it.
   */
  height?: number;
  // ---- SK4 8.2 PTO Terrain (the PTO Terrain Effects Chart); 8.3 Concealment Terrain.
  /** Concealment Terrain (SK4 8.3, the chart's red entries): a unit may set up or gain "?" in it. */
  concealment?: true;
  /** Mortar fire into it takes Air Bursts (SK4 1.1.1: woods; 8.2.1 jungle): -1 instead of the TEM, Residual FP a column up. */
  airBursts?: true;
  /** TEM a Mortar's fire gets instead of `tem` (Dense jungle -1 vs Infantry or CE vehicles, 8.2.1). */
  mortarTem?: number;
  /** TEM a DC or Ordnance HE attack gets instead of `tem` vs an unarmored target (bamboo -1, 8.2.1); its Residual FP is a column up. */
  heTem?: number;
  /** Infantry stacking limit in squad equivalents where it is below the usual 3 (Dense jungle and bamboo 2, unless a road or building is in the hex). */
  stackingSe?: number;
  /** No multi-hex Fire Group with a unit in another hex of this group (Dense jungle, kunai, bamboo: 8.2). */
  noMultiHexFg?: true;
  /** Recovery drm in the hex (jungle, kunai, bamboo +2, 8.2). */
  recoveryDrm?: number;
  /** Ambush drm the ATTACKER (the side that advanced in) adds in the hex (jungle, kunai, bamboo +1, 8.2). */
  ambushAttackerDrm?: number;
  /** An obstacle to a LOS between two hexes at different levels (palm trees), a Hindrance to one on a level. */
  obstacleBetweenLevels?: true;
  /** Hinders only where the LOS crosses the hex's building depiction (huts): the rest of the hex is open. */
  artHindrance?: true;
  /** Counts as a building for Victory Conditions, Mortar fire, AFV entry (huts). */
  building?: true;
  /** Bamboo (8.2.1): entering costs all of an Infantry unit's MF and ends with CX and Pin. */
  allMf?: true;
}

/** One hex of an assembled scenario map. */
export interface MapHex {
  id: HexId;
  board: string;
  /** Column letter(s) and row as printed, e.g. "K", 2. */
  colLabel: string;
  row: number;
  cube: Cube;
  terrain: string;
  /** Extra features, e.g. "road:dirt", "road:paved", "woods-road". */
  features: string[];
  /** Building id for multi-hex buildings (Control, rout "same building"). */
  buildingId?: string;
  /**
   * A building's levels (ASLRB B23.21–23): `upper` is how many levels it has above ground, `stairwell`
   * whether the hex has a printed one or the inherent stairwell of a Two Story House. Absent for a
   * ground-level-only building. Full ASL only: the Starter Kit keeps one Location per hex (`'hex.locations'`).
   */
  building?: { upper: 0 | 1 | 2; stairwell?: 'printed' | 'inherent' };
  /**
   * The hex's obstacle height in levels where it differs from its terrain's (`TerrainDef.height`): a Two Story
   * House is a 1½-level obstacle, a Multi-Story Building 2½ (ASLRB B23.22–23). Filled by the importer.
   */
  obstacleHeight?: number;
  /**
   * Wooden building hexes: how many separate building depictions the hex holds and whether any of them continues
   * into another hex (from the importer). SK4 8.2: under PTO Terrain a wooden building hex with at least two separate
   * buildings and no partial depiction is a hut.
   */
  buildings?: number;
  partialBuilding?: true;
  /** Hexsides (0–5) its obstacle depiction touches (test maps; boards measure it from their art: `GameMap.bypassSides`). */
  bypassBlocked?: number[];
  /** Half hexes along the board edge. */
  halfHex?: boolean;
  /** Full-level elevation of the hex (SK4 1.1.1 Hills); ground level when absent. */
  elevation?: number;
  /** Virtual hex just off the map edge, where entering units set up (never part of `hexes()`). */
  offboard?: boolean;
  /** Board-local column index; only needed where there is no printed column (offboard hexes). */
  col?: number;
}

/** One end of a LOS with heights (ASLRB A6.2): a hex, the absolute height of the viewer in levels, and optionally a vertex. */
export interface LosEnd {
  hex: HexId;
  height: number;
  /**
   * A corner of the hex (0–5, see `hexCorners.ts`) the thread is traced to or from instead of the centre dot: a unit in
   * Bypass (ASLRB A4.34, A6.12). The hex's own terrain then blocks a thread crossing its interior (A6.2).
   */
  vertex?: number;
  /**
   * A hexside (0–5) whose road crossing the thread is traced to instead of the centre dot: a unit that entered a
   * non-Open Ground hex at the road rate (ASLRB A4.132 target point b). Where the LOS data knows the road depiction the
   * point is where it meets the hexside, else the middle of the hexside.
   */
  side?: number;
}

/** What a LOS between heights needs to know beyond the map: the season makes an orchard an obstacle (ASLRB B14.2). */
export interface LosAtOptions {
  /** Orchards are in season (April–October, or as an SSR says): a one-level obstacle to a LOS to/from a higher elevation. */
  orchardInSeason?: boolean;
}

export interface LosResult {
  clear: boolean;
  /** Intervening hexes (not firer/target) whose terrain the thread crossed, in order. */
  crossed: { hex: HexId; terrain: string; inherentHexside?: boolean }[];
  /**
   * Blocked, but only just: a thread a few pixels to either side would be clear. A player may
   * reasonably believe such a LOS exists, so fire may be declared along it (and wasted).
   */
  near?: boolean;
  /** Blocked by higher ground: a hill in the way, or a second Crest Line between elevations (SK4 3.2.1). */
  crest?: boolean;
  /** Where the thread met the obstacle, in map pixels (pixel LOS only), for showing the player. */
  blockedAt?: { x: number; y: number };
  /**
   * What blocked a LOS between heights (`losAt`): the obstacle's hex and terrain ('hill' for higher ground), and
   * `blind` when the LOS passed over it but the lower end is in one of its Blind Hexes (ASLRB A6.4, B10.23).
   */
  obstacle?: { hex: HexId; terrain: string; blind?: boolean };
  /**
   * The firer's and target's own hexes whose woods depiction the thread crosses (pixel LOS only). A unit
   * that entered a Woods-Road hex along the road keeps the woods TEM against a LOS that crosses a green
   * woods symbol there (SK1 1.1.1 Woods-Road, ASLRB B13.31).
   */
  woods?: HexId[];
  /**
   * The firer's and target's own Orchard-Road hexes in which the thread leaves the road depiction. A unit that entered
   * such a hex along the road is subject to FFMO only against a LOS that stays on the road there (SK4 1.1.1
   * Orchard-Road, ASLRB B14.6). Grid LOS judges it by the road hexside the line leaves the hex through.
   */
  orchard?: HexId[];
}

/**
 * Assembled map for a scenario. Implementations come from the content package
 * (VASL-derived terrain + LOS); rules only rely on this interface.
 */
export interface GameMap {
  hex(id: HexId): MapHex | undefined;
  hexes(): Iterable<MapHex>;
  /** A hex with terrain but on no board, out of `hexes()` (S70's Connection Location; `HexGridMapOptions.hiddenHexes`). */
  isHidden?(id: HexId): boolean;
  neighbors(id: HexId): HexId[];
  distance(a: HexId, b: HexId): number;
  /** Center-dot to center-dot LOS against permanent terrain only (counters such as Smoke are rules-level). */
  los(from: HexId, to: HexId): LosResult;
  /**
   * Intervening hexes (not `from`/`to`) along the straight line between two centre dots, one entry per
   * step: two hexes where the line runs exactly along their common hexside. For counters (Smoke).
   */
  lineSteps?(from: HexId, to: HexId): HexId[][];
  /** Pixel-accurate LOS (elevation under the thread is known) or the hex-level approximation. */
  losMode?: 'pixel' | 'grid';
  /** Hexes along a map edge, e.g. for entry/exit. */
  edge(edge: string): HexId[];
  /** True if the two hexes share a hexside crossed by a road. */
  roadHexside?(a: HexId, b: HexId): boolean;
  /** True if the two hexes share a hexside crossed by a path (SK4 8.2: a PTO Terrain Woods-Road). */
  pathHexside?(a: HexId, b: HexId): boolean;
  /** Virtual offboard hexes along an edge (scenario directions), where entering units set up. */
  offboard(edge: string): MapHex[];
  offboardHex(id: HexId): MapHex | undefined;
  /** Neighbours of an offboard hex: map hexes it can enter, and offboard hexes along the same edge. */
  offboardNeighbors(id: HexId): { onboard: HexId[]; offboard: HexId[] };
  /** Hexside terrain between two adjacent hexes (walls, hedges, rowhouse walls, cliffs); a placeholder until boards have any. */
  hexside?(a: HexId, b: HexId): { kind: 'wall' | 'hedge' | 'rowhouse' | 'cliff' }[] | undefined;
  /** The hexsides of a woods/building hex open to Bypass (ASLRB A4.3): bit k for hexside k (`hexCorners.ts`); 0 otherwise. */
  bypassSides?(hex: HexId): number;
  /**
   * LOS between two ends at given heights (full ASL: ASLRB A6.2, A6.4–A6.43, B10.2–B10.23, B14.2). Obstacles have
   * heights, a higher end may see over them (subject to Blind Hexes) and Hindrances count only between same-level
   * ends. `crossed` lists only the Hindrances that apply. The Starter Kit never calls it: it keeps `los()`.
   */
  losAt?(from: LosEnd, to: LosEnd, opts?: LosAtOptions): LosResult;
}

/** Fire tables. Columns are FP values; rows are final DR results. */
export interface IftResult {
  kind: 'KIA' | 'K' | 'MC' | 'NMC' | 'PTC' | 'none';
  /** KIA count, K/# MC modifier, #MC modifier. */
  n?: number;
}

export interface Tables {
  /** IFT columns in ascending FP order, e.g. [1, 2, 4, 6, 8, 12, 16, 20, 24, 30, 36]. */
  iftColumns: number[];
  /** iftResult(column, finalDR) */
  ift(column: number, finalDr: number): IftResult;
  /** CC kill number for an odds column label such as "1:2", "3:2", "2:1". */
  ccKill(odds: string): number;
  /** Hand-to-Hand Close Combat Chart kill number for the same columns (SK4 8.1.8.4: each two higher). */
  ccKillHth(odds: string): number;
  /** Ordered list of odds columns (worst to best); "<a:b" / ">a:b" mark the open-ended ends. */
  ccOddsColumns: string[];
  /**
   * Leader Creation Table: original dr (the table applies its own drms) -> leader def id (or null).
   * `ccColumnsBelowEven`: for a promotion from a CC attack, how many odds columns below 1:1 it was
   * made at (-1 drm each; SK4 CC example).
   */
  leaderCreation(nationality: string, unitMorale: number, dr: number, broken?: boolean, ccColumnsBelowEven?: number): string | null;
  /**
   * To Hit Chart (SK4 3.2.4): the Gun's row (by counter def) at a range and Target Type, or null when
   * the Gun has no entry (beyond its range, or a Target Type it cannot use, e.g. AP-only on the ATT).
   */
  toHit(def: GunDef, targetType: 'ITT' | 'ATT' | 'VTT', range: number): ToHitEntry | null;
  /** IFT column the Gun's HE/AP attacks are resolved on (the chart's "FP Column"); null when it cannot fire that way. */
  gunColumn(def: GunDef, targetType: 'ITT' | 'ATT' | 'CH'): number | null;
  /** To Kill number (SK4 7.9) of a hit by this weapon with this ammunition at this range, before Armor Factors; null when the tables have none. */
  toKill(def: GunDef, ammo: 'AP' | 'APCR' | 'APDS' | 'HEAT' | 'HE', range: number): number | null;
}

/** One cell of the To Hit Chart: black and (when listed) red TH#, with the Critical Hit numbers. */
export interface ToHitEntry {
  black: number;
  ch: number;
  red?: number;
  chRed?: number;
}

export interface SideSetup {
  side: SideId;
  nationality: string;
  /** Every nationality the side fields when it mixes counter sets (e.g. British and Allied Minor); `nationality` is the first. */
  nationalities?: string[];
  elr: number;
  /** A nationality's own ELR where the card prints one per group (S9: Americans 5, British 3); others use `elr`. */
  elrs?: Record<string, number>;
}

export interface Statics {
  map: GameMap;
  counters: Record<string, CounterDef>;
  terrain: Record<string, TerrainDef>;
  tables: Tables;
  scenario: ScenarioDef;
}

/** What falls or hangs in the air (ASL E3): clear skies, overcast, rain, falling snow, fog or mist. */
export type Sky = 'clear' | 'overcast' | 'rain' | 'fallingSnow' | 'fog' | 'mist';
/** The ground's condition (ASL E3): as printed, mud, or snow on the ground. */
export type Ground = 'normal' | 'mud' | 'snow';
/** Scenario (card compass) direction the wind blows from. */
export type WindFrom = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
/** How hard the wind blows (ASL E3.5): none, a mild breeze, heavy winds, or gusts. */
export type WindForce = 'calm' | 'breeze' | 'heavy' | 'gusts';

/** The weather in play: sky, ground and wind. Kept in the game state, shown on the HUD, changed by rules. */
export interface Weather {
  sky: Sky;
  ground: Ground;
  wind: { from: WindFrom; force: WindForce };
}

/**
 * The rulebook a scenario plays under: the Starter Kit rules, or full ASL (the SK modules plus the
 * ASL modules that extend, suppress or replace them). The lobby offers each in its own room;
 * @asl/platform's `RulesetId` names the same two.
 */
export type ScenarioRuleset = 'starter-kit' | 'full-asl';

/** The rulebook a scenario plays under, its default filled in. */
export const scenarioRuleset = (s: Pick<ScenarioDef, 'ruleset'>): ScenarioRuleset => s.ruleset ?? 'starter-kit';

/** Scenario data (the card's content encoded as data; never the card image). */
export interface ScenarioDef {
  id: string;
  title: string;
  /** The rulebook it plays under; left out, the Starter Kit rules. */
  ruleset?: ScenarioRuleset;
  /** The product the scenario card comes from (a ProductDef id in @asl/content), e.g. 'sk1'. */
  product?: string;
  /** The card's scenario number as printed, e.g. 'S1' or 'A23'. */
  number?: string;
  /**
   * 'coming-soon' catalogues a scenario whose content the engine cannot play yet (another
   * Starter Kit's counters, boards or rules); `needs` says what, for the lobby. Such a scenario
   * carries its card's facts (title, dateline, designer, sides) but no forces or victory data.
   */
  status?: 'playable' | 'coming-soon';
  /** Kept from players until ready: out of the lobby and atlas, refused by the production server (the emulator plays it). */
  devOnly?: true;
  needs?: string[];
  /** `columns` limits the playable hexrows of a board, e.g. ['A', 'V']. */
  /** `rows`: the playable hex numbers when the card cuts a board across ("hexes A-Q numbered ≤ 6"). */
  boards: { board: string; position: string; rotation?: 0 | 180; columns?: [string, string]; rows?: [number, number] }[];
  /**
   * Which board-relative side (row 1 = N, column A = W) each scenario direction names, when the
   * card's north arrow is not the boards' own north. Edges in forces / VC use scenario directions.
   */
  compass?: Record<'N' | 'E' | 'S' | 'W', 'N' | 'E' | 'S' | 'W'>;
  turns: number;
  /** True when the final turn is half (only the first mover plays). */
  halfFinalTurn: boolean;
  /** Month number (for grain season etc.). */
  month: number;
  /**
   * Weather at the start, where the card sets it; what is left out takes the default (clear,
   * dry ground, a mild breeze from the west). Special rules change it during play.
   */
  weather?: Partial<Weather>;
  firstSide: SideId;
  /**
   * `san`: the side's Sniper Activation Number (ASLRB A14.1), as the card prints it. Data only until the full ASL
   * sniper rules arrive; the SK sniper is the `sniper-attack` SSR.
   */
  sides: (SideSetup & { name: string; setupFirst?: boolean; san?: number })[];
  /** How the card names a nationality's units when it differs from the counter set's name, e.g. { al: 'Greek' }. */
  nationalityNames?: Record<string, string>;
  forces: ScenarioForce[];
  victory: VictoryCondition[];
  /**
   * Scenario special rules: module ids (+params) added to the ruleset. The module 'text' is a
   * rule the engine does not enforce, shown to the players as written.
   */
  /**
   * The card's special rules in order, each applied by its module. `part`: a further effect of the rule listed
   * before it (S17 SSR 2: Assault Fire, then no Cower), with no text of its own and no number on the card.
   */
  ssr: { module: string; params?: Record<string, unknown>; text?: string; part?: boolean }[];
  /**
   * Where a side may leave the map (besides the edge of its exitVp condition): along an edge, or
   * through listed hexes, from a turn on. Exiting is only possible where a rule here allows it.
   */
  exits?: ExitRule[];
  /** Hexes a side Controls at the start ("All hill hexes are controlled by the Germans at the beginning of the game"). */
  initialControl?: { side: SideId; hexes: HexId[] }[];
  /** Balance options (one per side); applied before the game starts with `applyBalance`. */
  balance?: ScenarioBalance[];
  /** Balance options in effect in this game (filled in by `applyBalance`). */
  appliedBalance?: ScenarioBalance[];
  /** Scenario designer, as credited on the card. */
  designer?: string;
  /** The card's credit line verbatim when it is not "Scenario Design", e.g. "Scenario Concept: …". */
  credit?: string;
  /** The card's victory conditions, word for word. `victory` is the engine's reading of them. */
  victoryText?: string;
  /** Where and when the action takes place, as the card's dateline gives them, e.g. "Vierville, France" and "7 June 1944". */
  place?: string;
  date?: string;
  /** The card's historical introduction and aftermath. Paragraphs are separated by blank lines. */
  history?: string;
  aftermath?: string;
  /**
   * The card's photograph, as a path under the asset base (served from `assets-local/` in
   * development; the photographs are not in the repo, see README). Hidden when the file is missing.
   */
  photo?: { src: string; caption?: string; credit?: string };
  /** Other notes from the card that are not rules: board configuration remarks and the like. */
  notes?: string[];
}

export interface ScenarioBalance {
  side: SideId;
  /** The card's balance provision, word for word. */
  text: string;
  /** Set when the engine cannot offer this provision yet (and why); it is shown but cannot be chosen. */
  unavailable?: string;
  changes: (
    | { op: 'removeVictoryHex'; hex: HexId }
    /** Replace the hexes (and their label) of the victory condition at `index` ("Change the Victory Conditions to read ≤ 3 hexes from S6"). */
    | { op: 'setVictoryHexes'; index: number; hexes: HexId[]; hexesLabel?: string }
    /** "Change the number of buildings in the Victory Conditions to 8 instead of 9" (S26): the `atLeast` of victory condition `index`. */
    | { op: 'setVictoryAtLeast'; index: number; atLeast: number }
    | { op: 'addUnits'; force: string; def: string; count: number }
    /** Take `count` counters of a def out of a force (ones carrying no SW first). */
    | { op: 'removeUnits'; force: string; def: string; count: number }
    /** Replace `count` counters of one def in a force with another def (units, or the SW they carry). */
    | { op: 'swapUnits'; force: string; from: string; to: string; count: number }
    /** "Add four “?” counters to the Japanese OB" (S70): more concealment counters for a force (`ForceDef.concealment`). */
    | { op: 'addConcealment'; force: string; count: number }
    /** Give `count` more SW of def `sw` to units of def `to` in a force. */
    | { op: 'addSw'; force: string; sw: string; to: string; count: number }
    /** Change the game length. */
    | { op: 'setTurns'; turns: number; halfFinalTurn: boolean }
    /** Change the victory points a side must exit. */
    | { op: 'setExitVp'; side: SideId; vp: number }
    /** "Increase British VP requirements to 11" (S17): the `vp` of victory condition `index`. */
    | { op: 'setVictoryVp'; index: number; vp: number }
    /** Take `count` SW of def `sw` away from the units of a force that carry them. */
    | { op: 'removeSw'; force: string; sw: string; count: number }
    /** Delete the scenario's special rule at `index` (0-based, as numbered on the card minus one). */
    | { op: 'removeSsr'; index: number }
    /** Move an entering force's entry turn ("The Turn 4 reinforcements enter on Turn 3"). */
    /** `noRoll`: the force no longer rolls to enter (LMA7 balance: "the reinforcements arrive from the first turn"). */
    | { op: 'setEntryTurn'; force: string; turn: number; noRoll?: boolean }
    /** Change the entry dr a provisional force needs on one turn ("Change the entry DR to 3 on Turn 2"). */
    | { op: 'setEntryDr'; force: string; turn: number; dr: number }
    /** Change the playable hexrows of a board ("Reduce the playing area to A-Y"). */
    | { op: 'setColumns'; board: string; columns: [string, string] }
    /** "The Russians may use their full MP on Turn 1": the force enters with `mp` MP already expended (0 = none). */
    | { op: 'setMpSpent'; force: string; mp: number | 'half' }
    /** Merge parameters into the special rule at `index` ("Reduce all VP values on Chart 1 by 2" → `{ vpAdd: -2 }`). */
    | { op: 'patchSsr'; index: number; params: Record<string, unknown> }
    /** Merge fields into the victory condition at `index` (S31: "Delete 'and same hex fire counts triple'" → `{ tpbf: false }`). */
    | { op: 'patchVictory'; index: number; params: Record<string, unknown> }
  )[];
}

export interface ScenarioForce {
  /** Optional id, referenced by balance options. */
  id?: string;
  /**
   * The card's heading for this group of units (e.g. "Elements of 1058th Grenadier Regiment").
   * When a scenario provides these, the setup tray lays its counters out group by group, each
   * under its own heading and setup instruction, like the card; otherwise it shows one flat list.
   */
  group?: string;
  side: SideId;
  /**
   * "Set up last": the force is placed in a second setup decision of its side, after every side's
   * first (S16: the Free French 2nd Company sets up after the Germans, who set up after the 3rd).
   */
  setupStage?: 'last';
  /** Counter def id → count. */
  units: { def: string; count: number; withSw?: string[] }[];
  /** Concealment counters the card gives this force (SK4 8.3: "a concealment counter provided in its OB"): one per stack set up in Concealment Terrain. */
  concealment?: number;
  /** Setup constraint, e.g. on board in listed hexes / rows, or entering on a turn. */
  /** `description` is the card's setup instruction, word for word, where the data form paraphrases it. */
  /**
   * `provisional` marks provisional (SSR) reinforcements (SK1 3.1 a): from `turn` on, the
   * ATTACKER rolls a dr at the start of each of their Rally Phases and the force is due to enter
   * that Player Turn only on a success. 'drBelowTurn': the card's "enter on a dr < the current
   * Turn number". `{ drAtMost }`: the card's circled numbers on the Turn Record Chart, the force
   * entering on a dr ≤ that turn's number (no roll on a turn without one). 'ssr': due only when a special rule
   * releases it (LMA5 SSR 4: a replacement leader who enters the turn after the leader he replaces fails a MC).
   * `{ drBelowTurnTimes }`: "if it is less than twice the number of the current turn" (LMA7 SSR 4), a dr < that
   * multiple of the Game Turn.
   * `mfSpent`: the force enters "having already expended" that many MF (counted against each unit's MF
   * on the move that enters).
   */
  setup:
    | {
        kind: 'hexes';
        hexes: HexId[];
        description?: string;
        constraints?: SetupConstraint[];
        /** Vehicles of a fixed setup: their Vehicle Covered Arc (hexspine 0-5, default 0) and whether they start Crew Exposed (SK3). */
        vca?: number;
        ce?: boolean;
      }
    | { kind: 'area'; description: string; hexes: HexId[]; maxMmcPerHex?: number; constraints?: SetupConstraint[] }
    | {
        kind: 'enter';
        turn: number;
        edge: string;
        hexes?: HexId[];
        description?: string;
        provisional?: 'drBelowTurn' | { drAtMost: Record<number, number> } | 'ssr' | { drBelowTurnTimes: number };
        mfSpent?: number;
        /** Vehicles enter "having already expended" that many MP, or half their MP allowance ('half'). */
        mpSpent?: number | 'half';
      }
    /**
     * Placed by a dice roll from a chosen hex (S22 SSR 1: stacks scattered around a "rendezvous" hex); the
     * `scatter-setup` SSR module does the placing. Until then the counters wait offboard (`edge: 'scatter'`).
     */
    | { kind: 'scatter'; description: string };
}

/**
 * Extra placement rules a card puts on a force's setup, checked against the whole side's setup
 * (`defs` name the counters they apply to; weapons count where the unit possessing them is placed).
 */
export type SetupConstraint =
  /** "each AA gun ≥ 3 hexes from all buildings" */
  | { kind: 'awayFromBuildings'; defs: string[]; atLeast: number }
  /** "≤ 5 hexes from at least one other gun but not adjacent to any other gun": `atLeast` apart, `withinOfAnother` near one. */
  | { kind: 'spacing'; defs: string[]; atLeast?: number; withinOfAnother?: number }
  /** "set up in hexes with no British or Australian units": no unit of these counter nationalities in the hex. */
  | { kind: 'notWithNationalities'; nationalities: string[] }
  /** "set up first in building P9 or O6" where that building is fortified (SSR): every unit of the force in a fortified building. */
  | { kind: 'inFortifiedBuilding' }
  /** "[EXC: not in the Free French controlled building]": no hex the enemy Controls when the force sets up. */
  | { kind: 'notEnemyControlled' }
  /** "A total of 2 MMC may set up in any building hexes": at most `atMost` of the force's MMC in `hexes` (`label` names them). */
  | { kind: 'maxMmcIn'; hexes: HexId[]; atMost: number; label: string }
  /** "Leaders and SW must set up with any MMC": every SMC of the force (and so the SW it holds) in a hex with a friendly MMC. */
  | { kind: 'withMmc' }
  /** "It may setup only in road, open ground or shellhole hexes" (S35): these counters only on these terrains (as played), or a road hex when `road`. */
  | { kind: 'onTerrain'; defs: string[]; terrains: string[]; road?: boolean }
  /**
   * "He must set up a minimum of 4 MMC, 1 leader and 1 SW within two hexes of each deployment hex (K8, Q3, W7)" (LMA9
   * SSR 1): for every anchor hex, at least that many of the force's MMC, leaders (SMC) and SW (where their possessor
   * stands) within `range` hexes of it. Judged once everything is placed; `setupAnchorProgress` reports the counts.
   */
  | { kind: 'minWithin'; anchors: HexId[]; range: number; mmc?: number; smc?: number; sw?: number }
  /**
   * "The infantry must set up adjacent to the tanks" (LMA4 SSR 3): every unit of the force (SW where their possessor
   * is) within `atMost` hexes of a vehicle of its side, and at least `atLeast` from it (1 = adjacent, not in its hex).
   */
  | { kind: 'nearVehicle'; atMost: number; atLeast?: number }
  /** These counters (a Gun where its possessor is) not on a paved road: a Gun set up hidden by SSR (SK4 6.4, LMA4 SSR 2). */
  | { kind: 'notOnPavedRoad'; defs: string[] };

export interface ExitRule {
  side: SideId;
  edge?: string;
  hexes?: HexId[];
  /** First turn the side may exit (default 1). */
  fromTurn?: number;
  /** Only Infantry may exit here (S28: "Infantry may also exit from hexes adjacent to uI10 and/or uQ10"). */
  infantryOnly?: boolean;
}

/**
 * A victory condition names the side that wins by achieving it. `all` and `any` compose
 * conditions (the children's `side` is the side each is about; the composite's names the winner).
 * Every condition is judged at game end unless the card says otherwise: `immediate` only where it
 * says "win immediately", whatever the kind (an exit or CVP goal is no exception).
 */
export type VictoryCondition =
  /**
   * `perEnemyExit` raises `atLeast` by that much for every enemy MMC that has exited the map.
   * `immediate`: the card says "win immediately", so the game ends the moment the condition holds.
   */
  /** `moreThanEnemy`: "Controlling more buildings on board o than the Japanese" (S68): more of them than the enemy Controls. */
  | { kind: 'controlBuildings'; side: SideId; buildings: string[]; atLeast: number; perEnemyExit?: number; immediate?: boolean; moreThanEnemy?: boolean; buildingsLabel?: string }
  /**
   * Control of hexes (a hex of a Controlled building counts). `hexesLabel` names the set the way
   * the card does ("building hexes on board z") for the briefing and the map. `atEndOfTurn`: the
   * card's "win automatically at the end of Game Turn 4 if ...": judged then only, not at game end.
   */
  | { kind: 'controlHexes'; side: SideId; hexes: HexId[]; atLeast: number; immediate?: boolean; hexesLabel?: string; atEndOfTurn?: number }
  /** `side` wins by exiting `vp` victory points off `edge`, through `hexes` of it when the card limits the stretch. */
  /** `leaderVp`: the card values every exited leader at this ("each half-squad and leader is worth 1VP"), whatever its leadership. */
  /**
   * `afvVp`: what an exited AFV is worth (S23: "Each AFV with a functioning MA exited is worth 7 VPs (6 VPs if
   * exited without a functioning MA)"): `ma` with a Main Armament neither malfunctioned nor disabled, else `noMa`.
   */
  /**
   * `vehicleVp`: what an exited vehicle of each counter type is worth (S28: "Each PzVG is worth 8VP, and each JgPz 38(t) is
   * worth 7VP"); `{ ma, noMa }` where it is worth less without a working MA (S36: "each is worth 1 VP less if its MA is
   * malfunctioned").
   */
  /** `afvVpAtLeast`: so many of the VP must come from exited AFV (S30: "at least 6 VP of which must be from exited armor"). */
  | { kind: 'exitVp'; side: SideId; edge: string; hexes?: HexId[]; vp: number; immediate?: boolean; leaderVp?: number; afvVp?: { ma: number; noMa: number }; vehicleVp?: Record<string, number | { ma: number; noMa: number }>; afvVpAtLeast?: number }
  /**
   * `side` wins by exiting infantry: `hsEquivalents` half-squad equivalents (a squad counts 2) and
   * `smc` leaders, through the scenario's exit rules. `perEnemyHsExit` raises the half-squad
   * requirement by that much for every enemy half-squad equivalent that has exited.
   */
  | { kind: 'exitForce'; side: SideId; hsEquivalents: number; smc: number; perEnemyHsExit?: number; immediate?: boolean }
  /** `side` wins at game end if no Good Order enemy unit (MMC only when `mmcOnly`) is in any of the hexes (whole buildings when `buildings`). */
  /**
   * `unbroken`: the card says "no unbroken enemy" (a unit in Melee still counts) rather than Good Order.
   * `hexesLabel` names a large area the way the card does ("hexes ≤ 7 hexes from S6").
   */
  /** `atMost`: "≤ 1 Good Order American MMC in any Level 1 hex" (S64 SSR 4) allows that many; none by default. */
  /** `allUnits`: any enemy unit counts, Good Order or not ("no Japanese units on/adjacent to ...", S67). */
  | { kind: 'noGoodOrderEnemyIn'; side: SideId; hexes: HexId[]; buildings?: boolean; mmcOnly?: boolean; unbroken?: boolean; hexesLabel?: string; atMost?: number; allUnits?: boolean }
  /**
   * `side` wins at game end if at least `atLeast` of the `areas` hold no Good Order enemy unit (LMA7: "no Good Order German
   * unit on 3 of the 4 hills of each board": one condition per board). `areasLabel` names the areas the card's way
   * ("hills of board v"); each area's `label` names it on the map and in the HUD.
   */
  | { kind: 'clearAreas'; side: SideId; areas: { label: string; hexes: HexId[] }[]; atLeast: number; areasLabel?: string; mmcOnly?: boolean; unbroken?: boolean }
  /** `side` has lost fewer squad equivalents than the enemy (LMA7: "while losing fewer squads (or equivalent) than the German"). */
  | { kind: 'fewerLosses'; side: SideId; measure: 'squadEquivalents' }
  /**
   * `side` wins on amassing `cvp` casualty VP of enemy losses (a special rule may set the number in play: `vc.cvp`),
   * at game end, or the moment it is reached when the card says "win immediately" (`immediate`).
   */
  | { kind: 'eliminateCvp'; side: SideId; cvp: number; immediate?: boolean }
  /** Holds while `side` has lost fewer than `cvp` casualty victory points. */
  | { kind: 'cvpBelow'; side: SideId; cvp: number }
  /**
   * `atEndOfPhase`: judged only as that phase of `side`'s own Player Turn ends, and never at game end (LMA5: "at the
   * end of any of his MPh"); the side wins then and there.
   */
  | { kind: 'all'; side: SideId; of: VictoryCondition[]; immediate?: boolean; atEndOfPhase?: string }
  | { kind: 'any'; side: SideId; of: VictoryCondition[]; immediate?: boolean; atEndOfPhase?: string }
  /**
   * `side` has a unit (MMC or SMC, in any state) of every group in the same building (LMA5: "a unit of each company in
   * the same building"). Each group lists the scenario forces whose units count, and names them the card's way.
   */
  | { kind: 'forcesInBuilding'; side: SideId; groups: { forces: string[]; label: string }[] }
  /** `side` has lost fewer MMC (squads, half-squads and crews eliminated) than the other side (LMA5). */
  | { kind: 'fewerMmcLost'; side: SideId }
  /** `side` wins when every Gun of `of` (its `defs`, or all its Guns) is eliminated or captured (possessed by `side`). */
  /** `eliminatedOnly`: the card says "eliminating" (S32), so a captured Gun does not count. */
  | { kind: 'gunsEliminatedOrCaptured'; side: SideId; of: SideId; defs?: string[]; immediate?: boolean; eliminatedOnly?: boolean }
  /** `side` wins when it alone occupies every hex holding a non-captured Gun of `of`: its personnel there, none of `of`. */
  | { kind: 'occupyGunHexes'; side: SideId; of: SideId; defs?: string[]; immediate?: boolean }
  /**
   * `side` wins at game end if it has eliminated more enemy AFV than it has lost (SK3 S21). With
   * `exitedCountAsEliminated`, each of its own AFV exited off that edge counts as an eliminated enemy AFV.
   */
  | { kind: 'afvLead'; side: SideId; exitedCountAsEliminated?: { edge: string; hexes?: HexId[] } }
  /** At least `atLeast` of `side`'s AFV are on the map and still mobile, "neither eliminated nor immobile" (SK3 S25). */
  /**
   * `side` has at least `atLeast` unbroken squad equivalents of MMC in the area, each mobile AFV with a functioning MA
   * counting `afvSe` more (S69: "≥ 6 unbroken squad equivalents within 2 hexes of I7. Each mobile tank with functioning
   * MA counts as 2 squad equivalents").
   */
  | { kind: 'squadEquivalentsIn'; side: SideId; hexes: HexId[]; atLeast: number; afvSe?: number; hexesLabel?: string }
  | { kind: 'mobileAfv'; side: SideId; atLeast: number }
  /**
   * `side` wins at game end with at least `vp` victory points summed from `sources` (S32: "+2 VP per building hex
   * Controlled within 6 hexes of vN9", "+3 VP for each Russian ART Gun eliminated"); `label` names each the card's way.
   * `casualtyVp`: the Casualty VP `side` has lost (S71: "VP are earned for eliminating American units as follows").
   * `immediate` (S71: "win immediately upon amassing ≥ 25 VP"): judged throughout, counting only the sources not
   * marked `atGameEnd` ("1 VP for each building hex ... they Control at game end") until the game ends.
   */
  | {
      kind: 'vpTally';
      side: SideId;
      vp: number;
      immediate?: boolean;
      sources: (
        | { kind: 'controlledHexes'; hexes: HexId[]; vp: number; label: string; atGameEnd?: boolean }
        | { kind: 'eliminated'; defs: string[]; vp: number; label: string }
        | { kind: 'casualtyVp'; side: SideId; label: string }
      )[];
    }
  /**
   * `side` wins at game end if its Good Order units with a LOS to any of `hexes` can together apply at
   * least `fp` FP in hypothetical attacks against them (S22: the road vGG5-...-tA6, ≥ 15 FP). Each unit
   * counts its best attack on one of those hexes: its own FP and its non-captured SW as it may use them,
   * halved at long range, with no ROF, B# or PBF/TPBF. `noSmoke`: LOS disregards Smoke hindrances.
   * `mortarFp`: a Light Mortar in range counts this much; `latw`: a LATW within `maxRange` counts `fp`.
   */
  | {
      kind: 'losFirepower';
      side: SideId;
      hexes: HexId[];
      fp: number;
      hexesLabel?: string;
      noSmoke?: boolean;
      mortarFp?: number;
      latw?: { fp: number; maxRange: number };
      /**
       * S31: "No form of Area Fire (including Long Range Fire) counts but adjacent fire counts double (point blank
       * fire) and same hex fire counts triple (triple point blank fire)". `noAreaFire`: no long range and no pinned
       * (halved) unit; `pbf`: Infantry, MG and ATR FP doubled at an adjacent hex; `tpbf`: tripled in the same hex.
       */
      noAreaFire?: boolean;
      pbf?: boolean;
      tpbf?: boolean;
    }
  /**
   * `side` wins at game end with at least `vp` victory points of Good Order Infantry in `hexes` (S17: "≥ 9 VP of
   * Good Order infantry on/east-of hexrow xK"): a squad or crew 2, a half-squad 1, a leader 1 plus 1 for each minus
   * of its leadership modifier. `hexesLabel` names the area the way the card does.
   */
  /** `leaders`: at least that many of the counted units are leaders (S66: "including ≥ 1 leader"). */
  | { kind: 'goodOrderVp'; side: SideId; hexes: HexId[]; vp: number; hexesLabel?: string; leaders?: number }
  | { kind: 'custom'; side: SideId; module: string; params?: Record<string, unknown> };
