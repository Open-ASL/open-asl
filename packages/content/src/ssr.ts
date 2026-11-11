import type { QueryEnv, RuleModule } from '@asl/engine';
import {
  CAVES_MODULE,
  cavesModule,
  CVP_VALUES_MODULE,
  cvpValuesModule,
  DC_BANZAI_MODULE,
  dcBanzaiModule,
  NO_DOUBLE_TIME_MODULE,
  noDoubleTimeModule,
  CONSIDERED_CX_MODULE,
  consideredCxModule,
  LEADER_PTC_MODULE,
  leaderPtcModule,
  DISASSEMBLED_SW_MODULE,
  disassembledSwModule,
  RIVER_MODULE,
  riverModule,
  ONCE_DR_MODULE,
  onceDrModule,
  RAIDER_AMBUSH_MODULE,
  raiderAmbushModule,
  ENTRY_GROUPS_MODULE,
  ENTRY_STRETCH_MODULE,
  entryStretchModule,
  HIP_REQUIRED_MODULE,
  hipRequiredModule,
  ENTRY_AFTER_FIRE_MODULE,
  entryAfterFireModule,
  HIDDEN_UNITS_MODULE,
  FORCE_CHART_MODULE,
  FORTIFIED_MODULE,
  SCATTER_MODULE,
  AMBUSH_DRM_MODULE,
  COMMISSAR_MODULE,
  commissarModule,
  IMMOBILIZATION_DR_MODULE,
  immobilizationDrModule,
  TERRAIN_COST_MODULE,
  terrainCostModule,
  DIG_IN_MODULE,
  digInModule,
  MP_LIMIT_MODULE,
  mpLimitModule,
  EMBANKMENT_RAILROAD_MODULE,
  embankmentRailroadModule,
  SECRET_SW_MODULE,
  secretSwModule,
  SNIPER_ATTACK_MODULE,
  OFFBOARD_ARTILLERY_MODULE,
  offboardArtilleryModule,
  SECRET_LENGTH_MODULE,
  secretLengthModule,
  REINFORCEMENT_TABLE_MODULE,
  reinforcementTableModule,
  STUKA_ATTACK_MODULE,
  ssrAttacksModule,
  ATTACK_DRM_MODULE,
  attackDrmModule,
  CAPTURED_USE_EXEMPT_MODULE,
  NO_AFV_BUILDINGS_MODULE,
  PANZERFAUST_MODULE,
  SELF_RALLY_ONLY_MODULE,
  selfRallyOnlyModule,
  NO_PANZERFAUST_MODULE,
  noPanzerfaustModule,
  TARGET_DRM_MODULE,
  RADIOLESS_MODULE,
  SECRET_ENTRY_TURNS_MODULE,
  ENTRY_ORDER_DR_MODULE,
  entryOrderDrModule,
  ENTRY_LOSSES_MODULE,
  entryLossesModule,
  PREPARED_POSITIONS_MODULE,
  preparedPositionsModule,
  SETUP_DEPLOY_MODULE,
  setupDeployModule,
  START_MALFUNCTIONED_MODULE,
  RANGE_HINDRANCE_MODULE,
  rangeHindranceModule,
  ROADS_OPEN_GROUND_MODULE,
  roadsOpenGroundModule,
  LEADER_RELIEF_MODULE,
  leaderReliefModule,
  VARIABLE_REINFORCEMENTS_MODULE,
  WEATHER_DR_MODULE,
  assaultFireModule,
  crossNationalityLeadershipModule,
  defOf,
  entryGroupsModule,
  forceChartModule,
  fortifiedModule,
  hiddenUnitsModule,
  leaderDirectsGunModule,
  isBroken,
  mmc,
  noCowerModule,
  noHipModule,
  otherSide,
  pieceOf,
  ambushDrmModule,
  capturedUseExemptModule,
  noAfvBuildingsModule,
  panzerfaustModule,
  targetDrmModule,
  radiolessModule,
  rainModule,
  scatterSetupModule,
  secretEntryTurnsModule,
  seasonOverrideModule,
  startMalfunctionedModule,
  statics,
  variableReinforcementsModule,
  weatherDrModule,
  type ReserveRule,
  PTO_TERRAIN_MODULE,
  ptoModule,
  hexOfLoc,
} from '@asl/rules';

/**
 * Scenario special-rule modules by id. A scenario lists the ids it needs (with parameters) in
 * `ScenarioDef.ssr`; the module reads its parameters from the scenario at query time, so the
 * ruleset (and its version hash) stays the same for every scenario using it.
 */

/** A rule shown to the players as written and not enforced by the engine. */
const textModule: RuleModule = {
  id: 'ssr.text',
  summary: 'Scenario special rules the engine does not enforce; the players apply them.',
  install() {},
};

export interface TerrainOverrideParams {
  /** Terrain id → terrain id, applied to every hex of that terrain. */
  terrain?: Record<string, string>;
  /** Hex id → terrain id, for individual hexes. Applied after `terrain`. */
  hexes?: Record<string, string>;
}

export interface HexTemParams {
  hexes: string[];
  /** The terrain whose TEM those hexes use ('jungle': "uses Dense jungle TEM (8.2.1)"). */
  terrain: string;
}

/**
 * Hexes that use another terrain's TEM and nothing else of it (S65 SSR 2: "Each Victory Hex uses Dense jungle TEM
 * (8.2.1)"): a Light jungle Victory Hex takes +2, and stays Light jungle for stacking, Fire Groups and mortars.
 */
const hexTemModule: RuleModule = {
  id: 'ssr.hex-tem',
  summary: 'Listed hexes use another terrain’s TEM (SSR).',
  requires: ['sk1.terrain'],
  install(r) {
    r.contribute({
      id: 'ssr.hex-tem',
      query: 'hex.tem',
      layer: 10,
      apply(v, { hex }, env) {
        const id = statics(env).map.hex(hexOfLoc(hex))?.id;
        for (const s of statics(env).scenario.ssr) {
          if (s.module !== 'hex-tem') continue;
          const q = s.params as unknown as HexTemParams;
          if (id && q.hexes.includes(id)) return statics(env).terrain[q.terrain]?.tem ?? v;
        }
        return v;
      },
    });
  },
};

/** SSR terrain changes: all grain becomes flooded, a woods mass counts as Open Ground, and the like. */
const terrainOverrideModule: RuleModule = {
  id: 'ssr.terrain-override',
  summary: 'Scenario terrain changes (SSR): hexes or whole terrain types play as another terrain.',
  requires: ['sk1.terrain'],
  install(r) {
    r.contribute({
      id: 'ssr.terrain-override.apply',
      query: 'hex.terrain',
      layer: 10,
      label: 'SSR terrain',
      apply(v, { hex }, env) {
        let out = v;
        for (const s of statics(env).scenario.ssr) {
          if (s.module !== 'terrain-override') continue;
          const p = s.params as TerrainOverrideParams | undefined;
          const printed = statics(env).map.hex(hex)?.terrain ?? out;
          if (p?.terrain?.[printed]) out = p.terrain[printed]!;
          if (p?.hexes?.[hex]) out = p.hexes[hex]!;
        }
        return out;
      },
    });
    // Grain the SSR makes another terrain is that terrain whatever the month (S33's Plowed Fields in May): the
    // out-of-season rule that would make it Open Ground does not apply.
    r.suppress({
      id: 'ssr.terrain-override.grain-season',
      query: 'hex.terrain',
      target: 'sk1.terrain.grain-season',
      label: 'grain is the SSR terrain (SSR)',
      when: (_c, env) => statics(env).scenario.ssr.some((s) => s.module === 'terrain-override' && !!(s.params as TerrainOverrideParams | undefined)?.terrain?.['grain']),
    });
    // A hindrance the LOS found by its depiction (grain drawn into an open hex) plays as the SSR's terrain too.
    r.contribute({
      id: 'ssr.terrain-override.los',
      query: 'los.trace',
      layer: 10,
      label: 'SSR terrain',
      apply(v, _ctx, env) {
        if (!v.clear || v.parts.length === 0) return v;
        const terr = statics(env).terrain;
        const parts = v.parts.filter((part) => {
          let id = part.terrain;
          if (!id) return true;
          for (const s of statics(env).scenario.ssr) {
            if (s.module !== 'terrain-override') continue;
            const q = s.params as TerrainOverrideParams | undefined;
            if (q?.terrain?.[id]) id = q.terrain[id]!;
            if (q?.hexes?.[part.hex]) id = q.hexes[part.hex]!;
          }
          return terr[id]?.los === 'hindrance';
        });
        return parts.length === v.parts.length ? v : { ...v, parts, hindrance: parts.reduce((a, p) => a + p.drm, 0) };
      },
    });
  },
};

export interface SmokeExponentParams {
  /** Counter def(s) whose Smoke Exponent changes, e.g. 'ge.548'. A unit replaced by ELR loss is no longer that counter. */
  def: string | string[];
  /** Added to the printed exponent (negative to lower it). */
  add: number;
}

/** SSR Smoke Exponent changes: "German 5-4-8 squads have their Smoke Exponent increased by 2" (S2). */
const smokeExponentModule: RuleModule = {
  id: 'ssr.smoke-exponent',
  summary: 'Scenario Smoke Exponent changes (SSR) for a counter type.',
  requires: ['sk1.movement'],
  install(r) {
    r.contribute({
      id: 'ssr.smoke-exponent.apply',
      query: 'unit.smoke',
      layer: 10,
      label: 'SSR Smoke Exponent',
      apply(v, { unit }, env) {
        const p = env.state.pieces[unit];
        if (!p) return v;
        let out = v;
        for (const s of statics(env).scenario.ssr) {
          if (s.module !== 'smoke-exponent') continue;
          const q = s.params as SmokeExponentParams | undefined;
          if (q && [q.def].flat().includes(p.defId)) out += q.add;
        }
        return out;
      },
    });
  },
};

export interface CcvParams {
  /** Counter defs whose Close Combat Value changes. A unit replaced by ELR loss is no longer that counter. */
  defs: string[];
  /** Added to the unit's CCV. */
  add: number;
}

/**
 * SSR CCV changes (SK4 3.8): "German 8-3-8s/3-3-8s and 5-4-8s/2-3-8s have their CCV increased by 1"
 * (S24 SSR 2). Applies wherever the unit's CCV is used: attacking a vehicle and defending against one.
 */
const ccvModule: RuleModule = {
  id: 'ssr.ccv',
  summary: 'Scenario Close Combat Value changes (SSR) for counter types.',
  requires: ['sk3.cc'],
  install(r) {
    r.contribute({
      id: 'ssr.ccv.apply',
      query: 'cc.ccv',
      layer: 10,
      label: 'SSR CCV',
      apply(v, { unit }, env) {
        const p = env.state.pieces[unit];
        if (!p) return v;
        let out = v;
        for (const s of statics(env).scenario.ssr) {
          if (s.module !== 'ccv') continue;
          const q = s.params as unknown as CcvParams | undefined;
          if (q?.defs.includes(p.defId)) out += q.add;
        }
        return out;
      },
    });
  },
};

export interface TacticalReserveParams extends Omit<ReserveRule, 'label'> {
  side: string;
  /** Id of the entering force whose units may be kept back. */
  force: string;
  /** The card's name for the rule, e.g. 'SSR 2'. */
  rule?: string;
}

/**
 * SSR tactical reserve (S6 SSR 2): at the force's offboard setup the player may leave up to so
 * many MMC, SMC and SW unplaced; they enter on a later turn from the edges named. The scenario
 * module does the keeping back (`setup.reserve`); this rule only says what is allowed.
 */
const tacticalReserveModule: RuleModule = {
  id: 'ssr.tactical-reserve',
  summary: 'Units that may be kept back at their offboard setup to enter later from other edges (SSR).',
  requires: ['sk1.scenario'],
  install(r) {
    r.contribute({
      id: 'ssr.tactical-reserve.rule',
      query: 'setup.reserve',
      layer: 0,
      label: 'SSR tactical reserve',
      apply(v, { side, force }, env) {
        const sc = statics(env).scenario;
        for (const s of sc.ssr) {
          if (s.module !== 'tactical-reserve') continue;
          const p = s.params as unknown as TacticalReserveParams;
          if (p.side === side && sc.forces[force]?.id === p.force) return { turn: p.turn, edges: p.edges, mmc: p.mmc, smc: p.smc, sw: p.sw, label: `${p.rule ?? 'SSR'} tactical reserve` };
        }
        return v;
      },
    });
  },
};

export interface AssaultNoFfmoParams {
  /** The side whose Infantry may Assault Move in Open Ground without FFMO. */
  side: string;
}

/** SSR "may Assault Move in Open Ground hexes without the FFMO penalty applying" (S6 SSR 1). */
const assaultNoFfmoModule: RuleModule = {
  id: 'ssr.assault-no-ffmo',
  summary: 'One side’s Infantry Assault Moving in Open Ground is not subject to FFMO (SSR).',
  requires: ['sk1.fire'],
  install(r) {
    r.suppress({
      id: 'ssr.assault-no-ffmo.apply',
      query: 'fire.drm',
      target: 'sk1.drm.ffmo',
      label: 'no FFMO vs Assault Movement (SSR)',
      when({ attack }, env) {
        if (!attack.moving?.assault) return false;
        const target = otherSide(env.state, attack.side);
        return statics(env).scenario.ssr.some((s) => s.module === 'assault-no-ffmo' && (s.params as unknown as AssaultNoFfmoParams).side === target);
      },
    });
  },
};

export interface BrokenMoraleParams {
  side: string;
  /** Added to the broken side morale of the side's MMC (negative to lower it). */
  add: number;
  /** Only these counters (S35: "Russian 6-2-8/3-2-8 MMC ... have their broken side morale increased by one"). */
  defs?: string[];
}

/** SSR "Increase the broken side morale of all German MMC by one" (S6 SSR 3). */
const brokenMoraleModule: RuleModule = {
  id: 'ssr.broken-morale',
  summary: 'A side’s MMC have a different broken side morale (SSR).',
  requires: ['sk1.status'],
  install(r) {
    r.contribute({
      id: 'ssr.broken-morale.apply',
      query: 'unit.morale',
      layer: 10,
      label: 'SSR broken morale',
      when({ unit }, env) {
        const p = pieceOf(env, unit);
        return (
          isBroken(p) &&
          !!mmc(env, p) &&
          statics(env).scenario.ssr.some((s) => {
            const q = s.params as unknown as BrokenMoraleParams;
            return s.module === 'broken-morale' && q.side === p.side && (!q.defs || q.defs.includes(p.defId));
          })
        );
      },
      apply(v, { unit }, env) {
        const p = pieceOf(env, unit);
        let out = v;
        for (const s of statics(env).scenario.ssr) {
          if (s.module !== 'broken-morale') continue;
          const q = s.params as unknown as BrokenMoraleParams;
          if (q.side === p.side && (!q.defs || q.defs.includes(p.defId))) out += q.add;
        }
        return out;
      },
    });
  },
};

/**
 * SSR entry on a dr against the Turn Record Chart's circled numbers (S10 SSR 2). The rolling is the
 * scenario module's provisional reinforcements (`provisional: { drAtMost }` on the entering force);
 * this entry only marks the card's rule as one the engine applies.
 */
const entryDrModule: RuleModule = {
  id: 'ssr.entry-dr',
  summary: 'Reinforcements that enter on a Rally Phase dr against the Turn Record Chart (SSR); rolled by the scenario module.',
  requires: ['sk1.scenario'],
  install() {},
};

/**
 * SSR "Treat all off-board terrain as if it exists" (S11 SSR 1): the cut-away hexrows of a partly
 * playable board keep their printed terrain for units moving offboard and exiting, rather than
 * counting as Open Ground (SK4 3.x). The map does the work (`staticsFor` builds it with
 * `offboardTerrain`); this entry marks the card's rule as one the engine applies.
 */
const offboardTerrainModule: RuleModule = {
  id: 'ssr.offboard-terrain',
  summary: 'Off-board hexes keep their printed terrain for movement and exit (SSR); applied by the map.',
  requires: ['sk1.movement'],
  install() {},
};

export interface UnitTraitsParams {
  /** Counter def → what the rule changes about it. A unit replaced by ELR loss is no longer that counter. */
  defs?: Record<string, { noInexperienced?: boolean; noSmoke?: boolean; elrExempt?: boolean }>;
  /** Side → what the rule changes about all its MMC (S31 SSR 2: "All Italian MMC are subject to Inexperienced penalties"). */
  sides?: Record<string, { inexperienced?: boolean }>;
}

/** What the scenario's unit-traits rules say about a unit's counter. */
const traitsOf = (env: QueryEnv, unit: string): NonNullable<UnitTraitsParams['defs']>[string] => {
  const def = pieceOf(env, unit).defId;
  const out: NonNullable<UnitTraitsParams['defs']>[string] = {};
  for (const s of statics(env).scenario.ssr) if (s.module === 'unit-traits') Object.assign(out, (s.params as unknown as UnitTraitsParams).defs?.[def]);
  return out;
};

/**
 * SSR changes to what a counter can do (S20 SSR 4: "The 5-3-6/2-2-6 Free French do not incur
 * Inexperienced penalties and do not receive Smoke exponent capabilities. American 6-6-7s/3-4-7s
 * are considered to have underlined Morale and thus not subject to ELR").
 */
const unitTraitsModule: RuleModule = {
  id: 'ssr.unit-traits',
  summary: 'Counters with SSR-changed traits: no Inexperienced penalties, no Smoke exponent, underlined morale.',
  requires: ['sk1.status', 'sk1.morale', 'sk1.movement'],
  install(r) {
    r.contribute({
      id: 'ssr.unit-traits.inexperienced',
      query: 'unit.inexperienced',
      layer: 10,
      label: 'no Inexperienced penalties (SSR)',
      when: ({ unit }, env) => !!traitsOf(env, unit).noInexperienced,
      apply: () => false,
    });
    r.contribute({
      id: 'ssr.unit-traits.side-inexperienced',
      query: 'unit.inexperienced',
      layer: 10,
      label: 'Inexperienced (SSR)',
      when: ({ unit }, env) => {
        const p = pieceOf(env, unit);
        return !!mmc(env, p) && statics(env).scenario.ssr.some((s) => s.module === 'unit-traits' && !!(s.params as unknown as UnitTraitsParams).sides?.[p.side]?.inexperienced);
      },
      apply: () => true,
    });
    r.contribute({
      id: 'ssr.unit-traits.smoke',
      query: 'unit.smoke',
      layer: 20,
      label: 'no Smoke exponent (SSR)',
      when: ({ unit }, env) => !!traitsOf(env, unit).noSmoke,
      apply: () => 0,
    });
    r.contribute({
      id: 'ssr.unit-traits.elr',
      query: 'unit.elrExempt',
      layer: 10,
      label: 'underlined morale (SSR)',
      when: ({ unit }, env) => !!traitsOf(env, unit).elrExempt,
      apply: () => true,
    });
  },
};

/**
 * SSR Special Ammo changes (S36 SSR 3: "The Russian T-34/85s have an APCR Depletion Number of 6"): the counters are changed
 * as the scenario's statics are built (`staticsFor`); this entry marks the card's rule as applied.
 */
const specialAmmoModule: RuleModule = {
  id: 'ssr.special-ammo',
  summary: 'Counters with SSR-changed Special Ammo; the scenario’s counter data does the work.',
  install() {},
};

/**
 * SSR exits the scenario data allows (`ScenarioDef.exits`: "The Germans may exit Good Order units
 * off the south edge of board u starting Turn 5"); this entry marks the card's rule as applied.
 */
const exitRuleModule: RuleModule = {
  id: 'ssr.exit-rule',
  summary: 'Exits a card’s special rule allows; the scenario’s exit rules do the work.',
  requires: ['sk1.scenario'],
  install() {},
};

/**
 * A victory condition stated in a special rule ("The Japanese win at game end if there are ≤ 1 Good Order American MMC
 * in any Level 1 hex, provided the M1A2 AA Gun is captured or eliminated", S64 SSR 4): the scenario's `victory` does the
 * work; this entry marks the card's rule as applied.
 */
const victoryRuleModule: RuleModule = {
  id: 'ssr.victory-rule',
  summary: 'A victory condition a card’s special rule states; the scenario’s victory conditions do the work.',
  requires: ['sk1.scenario'],
  install() {},
};

/**
 * An SSR that only says where or how a side sets up ("he must set up a minimum of 4 MMC, 1 leader and 1 SW within two
 * hexes of each deployment hex", LMA9 SSR 1): the forces' setup areas and constraints do the work; this entry marks the
 * card's rule as applied.
 */
const setupRuleModule: RuleModule = {
  id: 'ssr.setup-rule',
  summary: 'A setup restriction a card’s special rule makes; the forces’ setup areas and constraints do the work.',
  requires: ['sk1.scenario'],
  install() {},
};

export interface SelfRallyParams {
  /** Counter nationalities whose units may always self-rally, e.g. ['ru']. */
  nationalities: string[];
}

/**
 * SSR "All Russian units may attempt self rally each Rally Phase" (S20 SSR 3): their MMC rally
 * themselves as if their broken side morale were boxed, in either side's RPh and without the
 * ATTACKER's one-MMC limit. The +1 self-rally DRM still applies (SK4 3.1: "any unit attempting
 * to self-rally also suffers a +1 DRM").
 */
const selfRallyModule: RuleModule = {
  id: 'ssr.self-rally',
  summary: 'Units of listed nationalities may always attempt to self-rally (SSR).',
  requires: ['sk1.rally'],
  install(r) {
    r.contribute({
      id: 'ssr.self-rally.apply',
      query: 'unit.selfRally',
      layer: 10,
      label: 'self-rally (SSR)',
      when({ unit }, env) {
        const nat = defOf(env, pieceOf(env, unit)).nationality;
        return statics(env).scenario.ssr.some((s) => s.module === 'self-rally' && (s.params as unknown as SelfRallyParams).nationalities.includes(nat));
      },
      apply: () => true,
    });
  },
};

export interface NoCrossNationalityLeadershipParams {
  /** The mixed side whose leaders lead only their own nationality. */
  side: string;
}

/**
 * SSR "Neither the Russian, nor the American/FFI, SMC may provide leadership DRM to MMC/SMC of the
 * other nationality" (S20 SSR 6): a leader's DRM is 0 for a unit of another counter nationality,
 * wherever the rules hand it to a particular unit (fire direction, MC, rally, CC, rout, PAATC).
 * The FFI fight with American counters, so "nationality" is the counter's.
 */
const noCrossNationalityLeadershipModule: RuleModule = {
  id: 'ssr.no-cross-nationality-leadership',
  summary: 'A mixed side’s leaders give no leadership DRM to units of another nationality (SSR).',
  requires: ['sk1.status'],
  install(r) {
    r.contribute({
      id: 'ssr.no-cross-nationality-leadership.apply',
      query: 'unit.leadership',
      layer: 900,
      label: 'no leadership across nationalities (SSR)',
      when({ unit, for: to }, env) {
        if (!to || to === unit) return false;
        const l = pieceOf(env, unit);
        const u = env.state.pieces[to];
        if (!u || u.side !== l.side) return false;
        if (!statics(env).scenario.ssr.some((s) => s.module === 'no-cross-nationality-leadership' && (s.params as unknown as NoCrossNationalityLeadershipParams).side === l.side)) return false;
        return defOf(env, l).nationality !== defOf(env, u).nationality;
      },
      apply: () => 0,
    });
  },
};

export interface RedrawTerrainParams {
  /** Printed terrain id → the terrain the hex is, e.g. { brush: 'orchard' }; `{ 'building-wood': 'building-stone' }` for "all buildings are stone". */
  terrain?: Record<string, string>;
  /** Only hexes depicting that terrain alone (no road or other feature) change. */
  bareOnly?: boolean;
  /**
   * The new terrain is not Inherent Terrain: only the printed art hinders, where the thread crosses it, as the new
   * terrain (S17 SSR 1: "Treat all Woods hexes as non-inherent Orchards (i.e., only the actual woods art acts as a +1
   * hindrance)").
   */
  nonInherent?: boolean;
  /**
   * The redrawn hexes are a hill of this level, and so is the printed art of the terrain wherever it is drawn (LMA7 SSR
   * 1: "Les champs sont en fait des collines", the fields are in fact hills: grain plays as Open Ground at Level 1, for
   * LOS, movement and Height Advantage like the board's printed hills).
   */
  elevation?: number;
  /**
   * "Hills do not exist" (LMA4 SSR 1): every hex is at ground level and the LOS ignores the hills' art, so the board
   * plays flat in every respect (movement, LOS, Height Advantage, Crest Lines).
   */
  noHills?: boolean;
}

/**
 * SSR "All hexes that depict only Brush terrain are considered Orchard hexes" (S20 SSR 5): the
 * hexes are the new terrain in every respect, Inherent Terrain and LOS included, so the change is
 * made to the map itself (`staticsFor` builds it with `redraw`); this entry marks the rule as applied.
 */
const redrawTerrainModule: RuleModule = {
  id: 'ssr.redraw-terrain',
  summary: 'Hexes of one printed terrain are another terrain in every respect, LOS included, or hills do not exist (SSR); applied by the map.',
  requires: ['sk1.terrain'],
  install() {},
};

export const SSR_MODULES: Record<string, RuleModule> = {
  text: textModule,
  /** SK4 8.2: PTO Terrain is in effect (woods are jungle, brush bamboo, orchards palm trees, grain kunai, hut clusters huts, no roads); params `{ light?: boolean }`. */
  [PTO_TERRAIN_MODULE]: ptoModule,
  'terrain-override': terrainOverrideModule,
  /** Listed hexes use another terrain's TEM only (S65 SSR 2); params `HexTemParams`. */
  'hex-tem': hexTemModule,
  'smoke-exponent': smokeExponentModule,
  /** SK3: Close Combat Value changes for counter types; params `CcvParams`. */
  ccv: ccvModule,
  /** Secretly pre-designated fortified buildings (+1 TEM), see `fortifiedModule`; params `FortifiedParams`. */
  [FORTIFIED_MODULE]: fortifiedModule,
  /** A sky condition that begins and ends on the attacker's RPh DR, see `weatherDrModule`; params `WeatherDrParams`. */
  [WEATHER_DR_MODULE]: weatherDrModule,
  /** Reinforcements whose number a dr decides, see `variableReinforcementsModule`; params `VariableReinforcementsParams`. */
  [VARIABLE_REINFORCEMENTS_MODULE]: variableReinforcementsModule,
  /** Units kept back at their offboard setup to enter later from other edges; params `TacticalReserveParams`. */
  'tactical-reserve': tacticalReserveModule,
  /** One side's Infantry Assault Moving in Open Ground is not subject to FFMO; params `AssaultNoFfmoParams`. */
  'assault-no-ffmo': assaultNoFfmoModule,
  /** SK2: listed units of a side do not cower; params `NoCowerParams`. */
  'no-cower': noCowerModule,
  /** SK2: a mixed side's leaders pay a DRM to rally or direct another nationality; params `CrossNationalityLeadershipParams`. */
  'cross-nationality-leadership': crossNationalityLeadershipModule,
  /** SK2: Guns may not use HIP; params `NoHipParams`. */
  'no-hip': noHipModule,
  /** SK2: grain or orchards in/out of season regardless of the month; params `SeasonOverrideParams`. */
  'season-override': seasonOverrideModule,
  /** A side's MMC broken side morale changed; params `BrokenMoraleParams`. */
  'broken-morale': brokenMoraleModule,
  /** Support Weapons that begin malfunctioned, perhaps with no repair before a given Player Turn; params `StartMalfunctionedParams`. */
  [START_MALFUNCTIONED_MODULE]: startMalfunctionedModule,
  /** Reinforcements entering on a dr ≤ the Turn Record Chart's circled number; the force's `provisional: { drAtMost }` does the work. */
  'entry-dr': entryDrModule,
  /** Off-board hexes keep their printed terrain; the map is built with `offboardTerrain`. */
  'offboard-terrain': offboardTerrainModule,
  /** SK2: rain: no Smoke, extra MF per elevation change off paved roads; params `RainParams`. */
  rain: rainModule,
  /** SK2: listed squads of a side have Assault Fire; params `AssaultFireParams`. */
  'assault-fire': assaultFireModule,
  /** An order of battle and VP goal a die roll on the card's chart decides, after a side's setup; params `ForceChartParams`. */
  [FORCE_CHART_MODULE]: forceChartModule,
  /** Counters with SSR-changed traits (no Inexperienced penalties, no Smoke, underlined morale); params `UnitTraitsParams`. */
  'unit-traits': unitTraitsModule,
  /** Exits a special rule allows; `ScenarioDef.exits` does the work. */
  'exit-rule': exitRuleModule,
  /** A setup restriction; the forces' setup areas and `constraints` do the work. */
  'setup-rule': setupRuleModule,
  /** Units of listed nationalities may always self-rally; params `SelfRallyParams`. */
  'self-rally': selfRallyModule,
  /** Units of listed nationalities or counters return to Good Order only by self-rally (no leader rally); params `SelfRallyOnlyParams`. */
  [SELF_RALLY_ONLY_MODULE]: selfRallyOnlyModule,
  /** A mixed side's leaders give no leadership DRM across nationalities; params `NoCrossNationalityLeadershipParams`. */
  'no-cross-nationality-leadership': noCrossNationalityLeadershipModule,
  /** Hexes of one printed terrain are another in every respect; the map is built with `redraw`; params `RedrawTerrainParams`. */
  'redraw-terrain': redrawTerrainModule,
  /** Setup by scatter: stacks placed by a direction and distance roll from each group's rendezvous hex; params `ScatterParams`. */
  [SCATTER_MODULE]: scatterSetupModule,
  /** Reinforcement groups picked secretly, each with its entry turn and recorded edge hex; params `EntryGroupsParams`. */
  [ENTRY_GROUPS_MODULE]: entryGroupsModule,
  /** A side's units may set up hidden with their weapons, revealed when they fire, move or are found; params `HiddenUnitsParams`. */
  [HIDDEN_UNITS_MODULE]: hiddenUnitsModule,
  /** A named leader may modify a named Gun's To Hit DR as if it were a SW; params `LeaderDirectsGunParams`. */
  'leader-directs-gun': leaderDirectsGunModule,
  /** SK3: radioless AFV need a DR each MPh to leave their hex; params `RadiolessParams`. */
  [RADIOLESS_MODULE]: radiolessModule,
  /**
   * SK3: Panzerfausts "by SSR" in a scenario without an enemy AFV (otherwise installed by date and OB); optional
   * params `PanzerfaustParams` (`shots`: the side's PF shots, replacing the count from the OB).
   */
  [PANZERFAUST_MODULE]: panzerfaustModule,
  /** A side has no Panzerfausts whatever the date and OB (the PF module is then left out); params `NoPanzerfaustParams`. */
  [NO_PANZERFAUST_MODULE]: noPanzerfaustModule,
  /** Ambush drm for the MMC and SMC of listed forces, or a side's MMC of listed qualities; params `AmbushDrmParams`. */
  [AMBUSH_DRM_MODULE]: ambushDrmModule,
  /** A leader that is a Commissar (morale, leadership, no ELR, stacked units' morale, forced rally); params `CommissarParams`. */
  [COMMISSAR_MODULE]: commissarModule,
  /** SK3: an AFV entering listed terrain off a road makes a DR, Immobilized on a high result; params `ImmobilizationDrParams`. */
  [IMMOBILIZATION_DR_MODULE]: immobilizationDrModule,
  /** Listed terrain costs other MF (Infantry) / MP (vehicles) to enter; params `TerrainCostParams`. */
  [TERRAIN_COST_MODULE]: terrainCostModule,
  /** SK3: a side may dig in its AFV at setup (never moves, +1 To Hit against it, a hull hit misses); params `DigInParams`. */
  [DIG_IN_MODULE]: digInModule,
  /** SK3: a side's vehicles use only part of their printed MP each MPh; half MP into woods is "all" for Bog; params `MpLimitParams`. */
  [MP_LIMIT_MODULE]: mpLimitModule,
  /** An Embankment Railroad: half-level LOS obstacle, 2 MF (1 along it), no TEM, no road; params `EmbankmentRailroadParams`. */
  [EMBANKMENT_RAILROAD_MODULE]: embankmentRailroadModule,
  /** A side's SW of listed types possessed in secret until fired, broken or an enemy enters; params `SecretSwParams`. */
  [SECRET_SW_MODULE]: secretSwModule,
  /** A game length recorded secretly before setup, setting turns, boards in play and OB; params `SecretLengthParams`. */
  [SECRET_LENGTH_MODULE]: secretLengthModule,
  /** Reinforcements whose composition a dr on the card's table decides; params `ReinforcementTableParams`. */
  [REINFORCEMENT_TABLE_MODULE]: reinforcementTableModule,
  /** Counters' Special Ammo changed by SSR (applied to the counter data); params `{ defs: { [def]: SpecialAmmoDef[] } }`. */
  'special-ammo': specialAmmoModule,
  /** SK3: a Sniper attack once per the side's DFPh; params `SniperAttackParams`. */
  [SNIPER_ATTACK_MODULE]: ssrAttacksModule,
  /** SK3: a Stuka attack once per the side's DFPh; params `StukaAttackParams`. */
  [STUKA_ATTACK_MODULE]: ssrAttacksModule,
  /** A DRM on every IFT and To Hit attack; params `AttackDrmParams`. */
  [ATTACK_DRM_MODULE]: attackDrmModule,
  /** A DRM on fire attacks against listed forces on listed turns; params `TargetDrmParams`. */
  [TARGET_DRM_MODULE]: targetDrmModule,
  /** Listed captured weapons fired without Captured Use penalties; params `CapturedUseExemptParams`. */
  [CAPTURED_USE_EXEMPT_MODULE]: capturedUseExemptModule,
  /** SK3: AFV may not enter a building hex; params `{ rule? }`. */
  [NO_AFV_BUILDINGS_MODULE]: noAfvBuildingsModule,
  /** Reinforcement groups given their entry turns secretly before setup; params `SecretEntryTurnsParams`. */
  [SECRET_ENTRY_TURNS_MODULE]: secretEntryTurnsModule,
  /** Reinforcement groups whose entry turns a RPh dr decides; params `EntryOrderDrParams`. */
  [ENTRY_ORDER_DR_MODULE]: entryOrderDrModule,
  /** A dr as a group enters replaces some of its counters with lesser ones; params `EntryLossesParams`. */
  [ENTRY_LOSSES_MODULE]: entryLossesModule,
  /** An entering force comes on through one of the card's stretches of its edge, picked by its side; params `EntryStretchParams`. */
  [ENTRY_STRETCH_MODULE]: entryStretchModule,
  /** Listed Guns must set up using HIP ("the AT Gun is set up HIP"); params `HipRequiredParams`. */
  [HIP_REQUIRED_MODULE]: hipRequiredModule,
  /** Off-board artillery fire missions: a leader calls one in the PFPh, it lands with drift in the AFPh; params `OffboardArtilleryParams`. */
  [OFFBOARD_ARTILLERY_MODULE]: offboardArtilleryModule,
  /** A Hindrance DRM by range alone (snow) on every IFT attack and To Hit DR; params `RangeHindranceParams`. */
  [RANGE_HINDRANCE_MODULE]: rangeHindranceModule,
  /** Roads treated as Open Ground: no road movement rate or road bonus; params `{ rule? }`. */
  [ROADS_OPEN_GROUND_MODULE]: roadsOpenGroundModule,
  /** A named leader's MC each Rally Phase; failure pins him for good and brings a replacement leader; params `LeaderReliefParams`. */
  [LEADER_RELIEF_MODULE]: leaderReliefModule,
  /** A side's units set up on the map are dug in: +TEM until they leave their setup hex; params `PreparedPositionsParams`. */
  [PREPARED_POSITIONS_MODULE]: preparedPositionsModule,
  /** A side may split some squads into two half-squads each while setting up; params `SetupDeployParams`. */
  [SETUP_DEPLOY_MODULE]: setupDeployModule,
  /** Reinforcements entering on the turn after a side's first fire attack; params `EntryAfterFireParams`. */
  [ENTRY_AFTER_FIRE_MODULE]: entryAfterFireModule,
  /** A once-per-game dr at the start of a phase, its effect on a dr < the Game Turn (S64 SSR 2, 3); params `OnceDrParams`. */
  [ONCE_DR_MODULE]: onceDrModule,
  /** SK4: Raider ambush changed (leaders count as Raiders, or no Raider -1); params `RaiderAmbushParams`. */
  [RAIDER_AMBUSH_MODULE]: raiderAmbushModule,
  /** A SW that enters play disassembled and is assembled by a MMC in the PFPh/DFPh (S66 SSR 2); params `DisassembledSwParams`. */
  [DISASSEMBLED_SW_MODULE]: disassembledSwModule,
  /** A river crossed only at one footbridge hex, with its stacking, level and limited LOS (S66 SSR 1); params `RiverParams`. */
  [RIVER_MODULE]: riverModule,
  /** A side's units may not use Double Time (S68 SSR 2); params `NoDoubleTimeParams`. */
  [NO_DOUBLE_TIME_MODULE]: noDoubleTimeModule,
  /** A side's units count as CX in CC (or always), ambush included (S68 SSR 2); params `ConsideredCxParams`. */
  [CONSIDERED_CX_MODULE]: consideredCxModule,
  /** A named leader's PTC as his side's RPh starts, pinned for the Player Turn on failure (S68 SSR 3); params `LeaderPtcParams`. */
  [LEADER_PTC_MODULE]: leaderPtcModule,
  /** Cave Locations in hill hexes and the hidden Connection Location between them (S70 SSR 2; ASLRB G11); params `CavesParams`. */
  [CAVES_MODULE]: cavesModule,
  /** Casualty VP the card sets for particular counters (S70 SSR 3: an M4A3 worth 6 VP); params `CvpValuesParams`. */
  [CVP_VALUES_MODULE]: cvpValuesModule,
  /** A Japanese Infantry unit with a DC may make a lone Banzai Charge at an AFV and attack it in CC (S71 SSR 2); params `DcBanzaiParams`. */
  [DC_BANZAI_MODULE]: dcBanzaiModule,
  /** A victory condition stated in a special rule; `ScenarioDef.victory` does the work. */
  'victory-rule': victoryRuleModule,
};
