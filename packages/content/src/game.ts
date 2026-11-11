import { Engine, buildRuleset, type RuleModule } from '@asl/engine';
import { CAVES_MODULE, type CavesParams, PANZERFAUST_MODULE, PTO_TERRAIN_MODULE, RIVER_MODULE, type RiverParams, SECRET_LENGTH_MODULE, SK4_TERRAIN, aslCoreModules, scenarioRuleset, type CounterDef, type SecretLengthParams, type SpecialAmmoDef, exitVpCondition, panzerfaustModule, pfDeniedBySsr, piecesModule, sk1CoreModules, sk2CoreModules, sk3CoreModules, sk4CoreModules, turnModule, type ScenarioDef, type Statics } from '@asl/rules';
import { SSR_MODULES, type RedrawTerrainParams } from './ssr';
import { ASSETS, COUNTERS, SK1_COUNTER_IDS, sk1Counters, sk2Counters, sk3Counters, sk4Counters } from './counters';

const SK1_IDS = new Set(SK1_COUNTER_IDS);
import { buildMap, type PtoMapOptions } from './maps';
import { SK1_TABLES } from './tables';

export { SSR_MODULES };

/**
 * Whether a scenario needs the Starter Kit #2 rules (Guns, crews, Light Mortars, hills): an SK2 card,
 * or any force with a Gun, crew or Light Mortar, or a board with hills, or with any counter the SK1 set
 * does not have (S31's Italians). SK1 scenarios keep the 'asl-sk1' ruleset (and so their
 * ruleset version hash, which live matches are tied to).
 */
export function needsSk2(scenario: ScenarioDef): boolean {
  if (scenario.product === 'sk2') return true;
  if (scenario.boards.some((b) => ASSETS.boards[b.board]?.hasHills)) return true;
  // A special rule that makes some terrain a hill (LMA7 SSR 1: "the fields are in fact hills").
  if (scenario.ssr.some((s) => s.module === 'redraw-terrain' && (s.params as RedrawTerrainParams | undefined)?.elevation)) return true;
  return scenario.forces.some((f) =>
    f.units.some((u) =>
      [u.def, ...(u.withSw ?? [])].some((id) => {
        const d = COUNTERS[id];
        return d?.kind === 'gun' || d?.kind === 'crew' || (d?.kind === 'sw' && (d.type === 'MTR' || !!d.latw)) || !SK1_IDS.has(id);
      }),
    ),
  );
}

/** Whether a scenario needs the Starter Kit #3 rules (vehicles): an SK3 card, or any force with a vehicle. */
export function needsSk3(scenario: ScenarioDef): boolean {
  if (scenario.product === 'sk3') return true;
  return scenario.forces.some((f) => f.units.some((u) => COUNTERS[u.def]?.kind === 'vehicle'));
}

/** The SSR modules that bring the Pacific chapter in (SK4 8.2 "PTO Terrain is in effect", 8.3 "or by SSR"). */
export const SK4_SSR_MODULES = new Set(['pto-terrain', 'concealment']);

/**
 * Whether a scenario needs the Starter Kit #4 rules (the Pacific chapter): an SK4 card, any Japanese counter in the
 * order of battle, or an SSR that puts PTO Terrain or Concealment in effect.
 */
export function needsSk4(scenario: ScenarioDef): boolean {
  if (scenario.product === 'sk4') return true;
  if (scenario.ssr.some((s) => SK4_SSR_MODULES.has(s.module))) return true;
  return scenario.forces.some((f) => f.units.some((u) => COUNTERS[u.def]?.nationality === 'ja'));
}

/**
 * Whether German Infantry may fire Panzerfausts (SK4 4.4.2): a date from October 1943, German squads on
 * a side, and an enemy vehicle in the order of battle (or the `panzerfaust` SSR). Only then is the
 * module installed, so other scenarios keep their ruleset version hash. The `no-panzerfaust` SSR takes them away from a
 * side ("German units have no PF capability").
 */
export function needsPanzerfaust(scenario: ScenarioDef): boolean {
  const y = /\b(19\d\d)\b/.exec(scenario.date ?? '');
  if (!y || Number(y[1]) < 1943 || (Number(y[1]) === 1943 && scenario.month < 10)) return false;
  const hasVehicle = (side: string) => scenario.forces.some((f) => f.side === side && f.units.some((u) => COUNTERS[u.def]?.kind === 'vehicle'));
  return scenario.sides.some(
    (s) =>
      !pfDeniedBySsr(scenario.ssr, s.side) &&
      scenario.forces.some((f) => f.side === s.side && f.units.some((u) => COUNTERS[u.def]?.kind === 'squad' && COUNTERS[u.def]?.nationality === 'ge')) &&
      (scenario.ssr.some((r) => r.module === PANZERFAUST_MODULE) || scenario.sides.some((o) => o.side !== s.side && hasVehicle(o.side))),
  );
}

/**
 * The ruleset a scenario plays under: SK1, SK1 + SK2 modules when it needs them, or all three with
 * vehicles. A full ASL scenario ('asl-full') installs every SK module and then the ASL modules,
 * which extend, suppress or replace them; the SK rulesets are built exactly as before (their ids and
 * version hashes pin live matches).
 */
export function rulesetFor(scenario: ScenarioDef) {
  const ssr: RuleModule[] = [];
  for (const s of scenario.ssr) {
    const m = SSR_MODULES[s.module];
    if (!m) throw new Error(`Unknown SSR module ${s.module}`);
    // A module is installed once however many rules use it; its parameters are read from the scenario.
    if (!ssr.includes(m)) ssr.push(m);
  }
  const panzerfaust = needsPanzerfaust(scenario) && !ssr.includes(panzerfaustModule) ? [panzerfaustModule] : [];
  if (scenarioRuleset(scenario) === 'full-asl') return buildRuleset('asl-full', [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules, ...panzerfaust, ...aslCoreModules, ...ssr]);
  if (needsSk4(scenario)) {
    // SK4 installs some SSR modules as core rules (hidden units for the Japanese 10%, SK4 8.1.8.5): a card listing the same module adds nothing.
    const core = [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules, ...panzerfaust, ...sk4CoreModules];
    return buildRuleset('asl-sk4', [...core, ...ssr.filter((m) => !core.includes(m))]);
  }
  if (needsSk3(scenario)) return buildRuleset('asl-sk3', [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules, ...panzerfaust, ...ssr]);
  return needsSk2(scenario)
    ? buildRuleset('asl-sk2', [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...ssr])
    : buildRuleset('asl-sk1', [piecesModule, turnModule, ...sk1CoreModules, ...ssr]);
}

/** @deprecated Older name of `rulesetFor`. */
export const sk1Ruleset = rulesetFor;

/**
 * SSR Special Ammo (S36 SSR 3: "The Russian T-34/85s have an APCR Depletion Number of 6"): the `special-ammo` rule's
 * entries replace the counter's own of the same kind, for a Gun or a vehicle's MA.
 */
function withSpecialAmmo(counters: Record<string, CounterDef>, scenario: ScenarioDef): Record<string, CounterDef> {
  for (const s of scenario.ssr.filter((r) => r.module === 'special-ammo')) {
    for (const [id, ammo] of Object.entries((s.params as { defs: Record<string, SpecialAmmoDef[]> }).defs)) {
      const d = counters[id];
      const patch = (list: SpecialAmmoDef[] | undefined) => [...(list ?? []).filter((a) => !ammo.some((x) => x.kind === a.kind)), ...ammo];
      if (d?.kind === 'vehicle' && d.ma) counters[id] = { ...d, ma: { ...d.ma, specialAmmo: patch(d.ma.specialAmmo) } };
      else if (d?.kind === 'gun') counters[id] = { ...d, specialAmmo: patch(d.specialAmmo) };
    }
  }
  return counters;
}

/** Board position strings are "x,y" in board units. */
export function staticsFor(scenario: ScenarioDef, opts: { los?: 'pixel' | 'grid' } = {}): Statics {
  const placements = scenario.boards.map((b) => {
    const [x, y] = b.position.split(',').map(Number) as [number, number];
    return { board: b.board, x, y, ...(b.columns ? { columns: b.columns } : {}), ...(b.rows ? { rows: b.rows } : {}), ...(b.rotation ? { rotation: b.rotation } : {}) };
  });
  return {
    map: buildMap(placements, {
      ...opts,
      ...(scenario.compass ? { compass: scenario.compass } : {}),
      // SSR "Treat all off-board terrain as if it exists": the cut-away hexrows keep their printed terrain.
      ...(scenario.ssr.some((s) => s.module === 'offboard-terrain') ? { offboardTerrain: true } : {}),
      // SSR terrain that is another terrain in every respect ("hexes that depict only Brush are Orchard").
      // SSR roads that are an Embankment Railroad instead.
      ...(scenario.ssr.some((s) => s.module === 'embankment-railroad')
        ? { railroad: scenario.ssr.filter((s) => s.module === 'embankment-railroad').map((s) => s.params as unknown as { hexes: string[]; roads?: string[] }) }
        : {}),
      // A playing area a secret game length may shrink: its entry edges inside the map (S36 SSR 1).
      ...(scenario.ssr.some((s) => s.module === SECRET_LENGTH_MODULE)
        ? {
            stagingEdges: (scenario.ssr.find((s) => s.module === SECRET_LENGTH_MODULE)!.params as unknown as SecretLengthParams).options.flatMap((o) =>
              o.entry ? [{ name: o.entry.edge, hexes: o.entry.hexes, side: o.entry.beyond }] : [],
            ),
          }
        : {}),
      ...(scenario.ssr.some((s) => s.module === 'redraw-terrain')
        ? { redraw: scenario.ssr.filter((s) => s.module === 'redraw-terrain').map((s) => s.params as unknown as RedrawTerrainParams) }
        : {}),
      // Caves (S70 SSR 2): the Connection Location is a hidden hex of the map.
      ...(scenario.ssr.some((s) => s.module === CAVES_MODULE && s.params)
        ? {
            hiddenHexes: scenario.ssr.filter((s) => s.module === CAVES_MODULE && s.params).map((s) => ({ id: (s.params as unknown as CavesParams).connection, terrain: 'cave-complex' })),
            noBuilding: scenario.ssr.filter((s) => s.module === CAVES_MODULE && s.params).flatMap((s) => (s.params as unknown as CavesParams).caves),
          }
        : {}),
      // A river crossing at another level (S66 SSR 1).
      ...(scenario.ssr.some((s) => s.module === RIVER_MODULE && (s.params as unknown as RiverParams | undefined)?.level !== undefined)
        ? { levels: Object.fromEntries(scenario.ssr.filter((s) => s.module === RIVER_MODULE).map((s) => s.params as unknown as RiverParams).filter((q) => q.level !== undefined).map((q) => [q.crossing.hex, q.level!])) }
        : {}),
      // PTO Terrain is in effect (SK4 8.2): the map is transformed before any redraw.
      ...(scenario.ssr.some((s) => s.module === PTO_TERRAIN_MODULE) ? { pto: { ...(scenario.ssr.find((s) => s.module === PTO_TERRAIN_MODULE)!.params as PtoMapOptions | undefined) } } : {}),
    }),
    counters: withSpecialAmmo(needsSk4(scenario) ? sk4Counters() : scenarioRuleset(scenario) === 'full-asl' || needsSk3(scenario) ? sk3Counters() : needsSk2(scenario) ? sk2Counters() : sk1Counters(), scenario),
    terrain: SK4_TERRAIN,
    tables: SK1_TABLES,
    scenario,
  };
}

/** @deprecated Older name of `staticsFor`. */
export const sk1Statics = staticsFor;

/** An engine for a scenario without a game: a client that only reads server-built views needs no seed. */
export function engineFor(scenario: ScenarioDef, opts: { los?: 'pixel' | 'grid' } = {}) {
  return new Engine(rulesetFor(scenario), staticsFor(scenario, opts));
}

/** Create an engine and a fresh game for a scenario. */
export function newGame(scenario: ScenarioDef, seed: string, opts: { los?: 'pixel' | 'grid' } = {}) {
  const engine = engineFor(scenario, opts);
  const init = { scenarioId: scenario.id, sides: scenario.sides.map((s) => s.side), attacker: scenario.firstSide, seed };
  const t = engine.createGame(init);
  return { engine, init, ...t };
}

/** @deprecated Older name of `newGame`. */
export const newSk1Game = newGame;

/** Apply the chosen sides' balance options, returning a new scenario. */
export function applyBalance(scenario: ScenarioDef, sides: string[]): ScenarioDef {
  const sc = JSON.parse(JSON.stringify(scenario)) as ScenarioDef;
  for (const b of scenario.balance ?? []) {
    if (!sides.includes(b.side)) continue;
    if (b.unavailable) throw new Error(`Balance: the ${b.side} provision is not available (${b.unavailable})`);
    for (const c of b.changes) {
      switch (c.op) {
        case 'removeVictoryHex':
          for (const vc of sc.victory) if ('hexes' in vc && vc.hexes) vc.hexes = vc.hexes.filter((h) => h !== c.hex);
          break;
        case 'setVictoryHexes': {
          const vc = sc.victory[c.index];
          if (!vc || !('hexes' in vc)) throw new Error(`Balance: victory condition ${c.index} has no hexes`);
          vc.hexes = [...c.hexes];
          if (c.hexesLabel !== undefined && 'hexesLabel' in vc) vc.hexesLabel = c.hexesLabel;
          break;
        }
        case 'setVictoryVp': {
          const vc = sc.victory[c.index];
          if (vc?.kind !== 'goodOrderVp' && vc?.kind !== 'vpTally') throw new Error(`Balance: victory condition ${c.index} has no VP requirement`);
          vc.vp = c.vp;
          break;
        }
        case 'setVictoryAtLeast': {
          const vc = sc.victory[c.index];
          if (!vc || !('atLeast' in vc)) throw new Error(`Balance: victory condition ${c.index} has no count`);
          vc.atLeast = c.atLeast;
          break;
        }
        case 'addUnits': {
          const force = sc.forces.find((f) => f.id === c.force);
          if (!force) throw new Error(`Balance: unknown force ${c.force}`);
          const u = force.units.find((x) => x.def === c.def && !x.withSw?.length);
          if (u) u.count += c.count;
          else force.units.push({ def: c.def, count: c.count });
          break;
        }
        case 'removeUnits': {
          const force = sc.forces.find((f) => f.id === c.force);
          if (!force) throw new Error(`Balance: unknown force ${c.force}`);
          let left = c.count;
          // Units carrying nothing go first, so the force keeps its weapons.
          for (const u of [...force.units].sort((a, b) => (a.withSw?.length ?? 0) - (b.withSw?.length ?? 0))) {
            if (u.def !== c.def || left === 0) continue;
            const n = Math.min(u.count, left);
            u.count -= n;
            left -= n;
            if (u.count === 0) force.units.splice(force.units.indexOf(u), 1);
          }
          if (left > 0) throw new Error(`Balance: ${c.force} has no ${c.count} × ${c.def} to remove`);
          break;
        }
        case 'swapUnits': {
          const force = sc.forces.find((f) => f.id === c.force);
          if (!force) throw new Error(`Balance: unknown force ${c.force}`);
          const carried = force.units.find((x) => x.withSw?.includes(c.from) && x.count >= c.count);
          if (carried) {
            // Swap the SW those units carry.
            carried.count -= c.count;
            if (carried.count === 0) force.units.splice(force.units.indexOf(carried), 1);
            force.units.push({ def: carried.def, count: c.count, withSw: carried.withSw!.map((sw) => (sw === c.from ? c.to : sw)) });
            break;
          }
          const u = force.units.find((x) => x.def === c.from && x.count >= c.count && !x.withSw?.length);
          if (!u) {
            // No one entry holds them all: take them from several, those carrying SW last, and they keep their SW.
            const from = force.units.filter((x) => x.def === c.from).sort((a, b) => (a.withSw?.length ?? 0) - (b.withSw?.length ?? 0));
            if (from.reduce((n, x) => n + x.count, 0) < c.count) throw new Error(`Balance: ${c.force} has no ${c.count} × ${c.from} to swap`);
            let left = c.count;
            for (const x of from) {
              const n = Math.min(left, x.count);
              if (n === 0) break;
              x.count -= n;
              left -= n;
              force.units.push({ def: c.to, count: n, ...(x.withSw?.length ? { withSw: [...x.withSw] } : {}) });
            }
            force.units = force.units.filter((x) => x.count > 0);
            break;
          }
          u.count -= c.count;
          if (u.count === 0) force.units.splice(force.units.indexOf(u), 1);
          const t = force.units.find((x) => x.def === c.to && !x.withSw?.length);
          if (t) t.count += c.count;
          else force.units.push({ def: c.to, count: c.count });
          break;
        }
        case 'addSw': {
          const force = sc.forces.find((f) => f.id === c.force);
          if (!force) throw new Error(`Balance: unknown force ${c.force}`);
          const u = force.units.find((x) => x.def === c.to && !x.withSw?.length && x.count >= c.count);
          if (!u) throw new Error(`Balance: ${c.force} has no ${c.count} × ${c.to} free to carry ${c.sw}`);
          u.count -= c.count;
          if (u.count === 0) force.units.splice(force.units.indexOf(u), 1);
          force.units.push({ def: c.to, count: c.count, withSw: [c.sw] });
          break;
        }
        case 'addConcealment': {
          const force = sc.forces.find((f) => f.id === c.force);
          if (!force) throw new Error(`Balance: unknown force ${c.force}`);
          force.concealment = (force.concealment ?? 0) + c.count;
          break;
        }
        case 'setExitVp': {
          const vc = exitVpCondition(sc, c.side);
          if (!vc) throw new Error(`Balance: the ${c.side} side has no exit VP condition`);
          vc.vp = c.vp;
          break;
        }
        case 'removeSw': {
          const force = sc.forces.find((f) => f.id === c.force);
          if (!force) throw new Error(`Balance: unknown force ${c.force}`);
          let left = c.count;
          for (const u of [...force.units]) {
            while (left > 0 && u.withSw?.includes(c.sw)) {
              // One carrier gives up one weapon: it becomes a unit of the same def carrying the rest.
              const rest = [...u.withSw];
              rest.splice(rest.indexOf(c.sw), 1);
              u.count -= 1;
              if (u.count === 0) force.units.splice(force.units.indexOf(u), 1);
              const same = force.units.find((x) => x.def === u.def && (x.withSw ?? []).join() === rest.join());
              if (same) same.count += 1;
              else force.units.push({ def: u.def, count: 1, ...(rest.length ? { withSw: rest } : {}) });
              left -= 1;
              if (u.count === 0) break;
            }
          }
          if (left > 0) throw new Error(`Balance: ${c.force} has no ${c.count} × ${c.sw} to remove`);
          break;
        }
        case 'removeSsr':
          if (!sc.ssr[c.index]) throw new Error(`Balance: the scenario has no SSR ${c.index + 1}`);
          sc.ssr.splice(c.index, 1);
          break;
        case 'setTurns':
          sc.turns = c.turns;
          sc.halfFinalTurn = c.halfFinalTurn;
          break;
        case 'setEntryTurn': {
          const force = sc.forces.find((f) => f.id === c.force);
          if (force?.setup.kind !== 'enter') throw new Error(`Balance: ${c.force} is not an entering force`);
          force.setup.turn = c.turn;
          if (c.noRoll) delete force.setup.provisional;
          break;
        }
        case 'setEntryDr': {
          const force = sc.forces.find((f) => f.id === c.force);
          const prov = force?.setup.kind === 'enter' ? force.setup.provisional : undefined;
          if (!prov || typeof prov === 'string' || !('drAtMost' in prov)) throw new Error(`Balance: ${c.force} has no entry dr chart`);
          prov.drAtMost[c.turn] = c.dr;
          break;
        }
        case 'setMpSpent': {
          const force = sc.forces.find((f) => f.id === c.force);
          if (force?.setup.kind !== 'enter') throw new Error(`Balance: ${c.force} is not an entering force`);
          if (c.mp === 0) delete force.setup.mpSpent;
          else force.setup.mpSpent = c.mp;
          break;
        }
        case 'patchSsr': {
          const r = sc.ssr[c.index];
          if (!r) throw new Error(`Balance: the scenario has no special rule ${c.index + 1}`);
          r.params = { ...r.params, ...c.params };
          break;
        }
        case 'patchVictory': {
          const vc = sc.victory[c.index];
          if (!vc) throw new Error(`Balance: the scenario has no victory condition ${c.index + 1}`);
          Object.assign(vc, c.params);
          break;
        }
        case 'setColumns': {
          const b = sc.boards.find((x) => x.board === c.board);
          if (!b) throw new Error(`Balance: the scenario has no board ${c.board}`);
          b.columns = c.columns;
          break;
        }
      }
    }
  }
  sc.appliedBalance = (scenario.balance ?? []).filter((b) => sides.includes(b.side));
  sc.balance = [];
  return sc;
}
