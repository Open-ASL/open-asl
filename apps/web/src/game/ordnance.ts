import type { HexId, PieceId, QueryEnv, SideId } from '@asl/engine';
import {
  AMMO_NAME,
  ammoColumn,
  ammoKinds,
  ammoStatus,
  ammoUseIllegal,
  arcNeighbours,
  defaultAmmo,
  ordnanceOf,
  coveredArc,
  gun,
  hexOf,
  inCoveredArc,
  nearestSpine,
  shotOutlook,
  statics,
  vehicle,
  type AmmoKind,
  type FireMode,
  type HexGridMap,
  type OrdnanceShot,
  type ShotOutlook,
  type TargetType,
} from '@asl/rules';

/** The hex a Gun stands in (its manning unit's when held). */
export function gunHexOf(env: QueryEnv, gunId: PieceId): HexId | null {
  const g = env.state.pieces[gunId];
  if (!g) return null;
  if (g.loc.kind === 'hex') return g.loc.hex;
  if (g.loc.kind === 'held') {
    const h = env.state.pieces[g.loc.by];
    return h?.loc.kind === 'hex' ? h.loc.hex : null;
  }
  return null;
}

/** The hexspine a Gun in `gunHex` would point at to cover `target`, changing least from `current`; null when none does (the Gun's own hex). */
export function spineToward(env: QueryEnv, gunHex: HexId, target: HexId, current = 0): number | null {
  const map = statics(env).map;
  const a = map.hex(gunHex);
  const b = map.hex(target);
  if (!a || !b || gunHex === target) return null;
  return nearestSpine(a.cube, current, b.cube);
}

/** The Covered Arc change a shot at `target` needs: the new spine, or null when the target is already covered. */
export function caChangeFor(env: QueryEnv, gunId: PieceId, target: HexId): number | null {
  const map = statics(env).map;
  const at = gunHexOf(env, gunId);
  const g = env.state.pieces[gunId];
  if (!at || !g || !map.hex(at) || !map.hex(target)) return null;
  // A Light Mortar has no Covered Arc to turn (SK4 4.5).
  if (ordnanceOf(env, g)?.light) return null;
  if (inCoveredArc(map.hex(at)!.cube, coveredArc(g), map.hex(target)!.cube)) return null;
  return nearestSpine(map.hex(at)!.cube, coveredArc(g), map.hex(target)!.cube);
}

/** "N5 / O5": the two hexes a Gun's hexspine points between, for naming a Covered Arc. */
export function spineLabel(env: QueryEnv, gunHex: HexId, spine: number): string {
  const map = statics(env).map as HexGridMap;
  const h = map.hex(gunHex) ?? map.offboardHex(gunHex);
  if (!h) return `spine ${spine}`;
  const [a, b] = arcNeighbours(h.cube, spine);
  const name = (c: { q: number; r: number; s: number }) => map.atCube(c)?.id.replace(/^[a-z]/, '') ?? 'off';
  const label = `${name(a)} / ${name(b)}`;
  // From an offboard hex only the map side has names: say which way it points instead.
  return label === 'off / off' ? `${['N', 'NE', 'SE', 'S', 'SW', 'NW'][spine]! }-ish (away from the map)` : label;
}

export interface ShotOption {
  type: TargetType;
  /** The ammunition announced; undefined fires the default (HE, or AP for a Gun without unlimited HE). */
  ammo?: AmmoKind;
  /** A LATW fired from inside a building: take the Backblast (true) or the +2 To Hit DRM (false), SK4 4.4.3. */
  backblast?: boolean;
  label: string;
  hint: string;
  available: boolean;
}

const TYPE_NAME: Record<TargetType, string> = { ITT: 'Infantry', ATT: 'Area', IFE: 'IFE', VTT: 'Vehicle' };

/**
 * The ways a Gun can fire (SK4 3.2.4, 6.2, 6.8): each Target Type with each ammunition its counter
 * allows, then IFE. Options the Gun cannot use now stay listed, disabled, with the reason as hint:
 * AP-only Guns on the ATT, Special Ammo out of date or depleted, Smoke outside the PFPh/DFPh.
 */
export function shotOptions(env: QueryEnv, gunId: PieceId, mode: FireMode): ShotOption[] {
  const g = env.state.pieces[gunId];
  const d = g ? ordnanceOf(env, g) : null;
  if (!g || !d) return [];
  const t = statics(env).tables;
  const dflt = defaultAmmo(env, g, d);
  const out: ShotOption[] = [];
  // A vehicle's Main Armament may be barred outright (CE with an RST/1MT turret, Shock, Stun, disabled ...): every option says why.
  const at = hexOf(env.state, g);
  const maWhy: string | null = d.vehicle && at ? env.query('ordnance.maIllegal', { shot: { weapon: gunId, target: at, targetType: 'ITT' }, mode, side: g.side }, null) : null;
  // The Vehicle Target Type needs an enemy vehicle the side can see.
  const noVehicle = Object.values(env.state.pieces).some(
    (p) => p.side !== g.side && p.loc.kind === 'hex' && vehicle(env, p) && p.tags['wreck'] !== true && env.query('piece.visibleTo', { piece: p.id, viewer: g.side }, true),
  )
    ? null
    : 'No enemy vehicle in sight to aim at';
  if (d.latw) {
    // A Bazooka: HEAT on its own To Hit Table, only at Infantry in a building or a Gun (SK4 4.4).
    const at = hexOf(env.state, g);
    const inBuilding = !!(at && statics(env).map.hex(at)?.buildingId);
    const why = ammoUseIllegal(env, g, d, 'HEAT', 'ITT', mode);
    const effect = `a hit on Infantry in a building attacks on the ${d.latw.fp} column (${d.latw.fp * 2} on a Critical Hit, an original 2); X${d.latw.x ?? 12}: removed on an original TH DR ≥ ${d.latw.x ?? 12}`;
    if (!inBuilding) out.push({ type: 'ITT', label: `HEAT · ${d.type} To Hit Table`, hint: why ?? effect, available: !why });
    else {
      out.push({ type: 'ITT', backblast: false, label: `HEAT · +2 To Hit (no Backblast)`, hint: why ?? `Firing from a building: +2 To Hit DRM; ${effect}`, available: !why });
      out.push({ type: 'ITT', backblast: true, label: `HEAT · take the Backblast`, hint: why ?? `Firing from a building: everyone in this hex takes a 1 FP attack on the colored dr, no TEM; ${effect}`, available: !why });
    }
    // At a vehicle: the same To Hit Table, then HEAT To Kill against the Armor Factor struck (SK4 4.4).
    const vWhy = ammoUseIllegal(env, g, d, 'HEAT', 'VTT', mode) ?? noVehicle;
    const vEffect = `aim at one enemy vehicle: a hit rolls To Kill (HEAT TK ${t.toKill(d, 'HEAT', 1) ?? '—'}) less the Armor Factor struck; Critical Hit on an original 2`;
    if (!inBuilding || d.type === 'PIAT') out.push({ type: 'VTT', label: `Vehicle · HEAT`, hint: vWhy ?? vEffect, available: !vWhy });
    else {
      out.push({ type: 'VTT', backblast: false, label: `Vehicle · HEAT · +2 To Hit (no Backblast)`, hint: vWhy ?? `Firing from a building: +2 To Hit DRM; ${vEffect}`, available: !vWhy });
      out.push({ type: 'VTT', backblast: true, label: `Vehicle · HEAT · take the Backblast`, hint: vWhy ?? `Firing from a building: everyone in this hex takes a 1 FP attack on the colored dr, no TEM; ${vEffect}`, available: !vWhy });
    }
    return out;
  }
  for (const type of ['ITT', 'ATT'] as const) {
    // An ATR fires as ordnance at vehicles only; at Infantry it is a 1 FP SW on the IFT (SK4 4.4.4).
    if (d.type === 'ATR') continue;
    // The chart has no row for this Target Type (a Mortar on the ITT, an AP-only Gun on the ATT).
    if (t.gunColumn(d, type) === null && !(type === 'ATT' && d.ammo.ap && !d.ammo.he)) continue;
    if (d.type === 'MTR' && type === 'ITT') continue;
    for (const ammo of ammoKinds(d)) {
      const smoke = ammo === 'SMOKE' || ammo === 'WP';
      if (type === 'ITT' && smoke) continue;
      if (type === 'ATT' && !smoke && ammo !== 'HE' && !(ammo === 'AP' && dflt === 'AP')) continue;
      const why = maWhy ?? ammoUseIllegal(env, g, d, ammo, type, mode);
      const st = ammoStatus(env, g, d, ammo);
      const dep = st.depletion !== undefined ? ` (depl. ${st.depletion})` : '';
      const col = smoke ? null : ammoColumn(env, d, ammo, type, false);
      const effect = smoke
        ? `places ${ammo === 'WP' ? 'WP (+2, Dispersed +1); units hit take a NMC' : 'Smoke (+3 in the PFPh, Dispersed +2 in the DFPh)'}`
        : `a hit attacks on the ${col ?? '—'} column${type === 'ATT' && d.type !== 'MTR' ? '; no ROF' : ''}`;
      const depNote = st.depletion !== undefined ? `; Depletion Number ${st.depletion}: the Gun has it on an original TH DR below ${st.depletion}, this shot only on ${st.depletion}, never above (and then has not fired)` : '';
      out.push({
        type,
        ...(ammo !== dflt ? { ammo } : {}),
        label: `${TYPE_NAME[type]} · ${AMMO_NAME[ammo]}${dep}`,
        hint: why ?? `${type === 'ITT' ? 'Infantry Target Type: TEM on the To Hit DR' : smoke ? 'Area Target Type: red To Hit numbers' : 'Area Target Type: red To Hit numbers, TEM on the IFT'}; ${effect}${depNote}`,
        available: !why,
      });
    }
  }
  // The Vehicle Target Type (SK4 3.2.4): AP first, then the other rounds the weapon has; never a Mortar.
  if (d.type !== 'MTR' && t.toHit(d, 'VTT', 1)) {
    const vttDflt: AmmoKind = d.ammo.ap ? 'AP' : dflt;
    for (const ammo of [...new Set<AmmoKind>([vttDflt, ...ammoKinds(d)])]) {
      if (ammo === 'SMOKE' || ammo === 'WP') continue;
      const why = maWhy ?? ammoUseIllegal(env, g, d, ammo, 'VTT', mode) ?? noVehicle;
      const st = ammoStatus(env, g, d, ammo);
      const dep = st.depletion !== undefined ? ` (depl. ${st.depletion})` : '';
      const tk = (r: number) => t.toKill(d, ammo as 'AP' | 'APCR' | 'APDS' | 'HEAT' | 'HE', r);
      out.push({
        type: 'VTT',
        ...(ammo !== vttDflt ? { ammo } : {}),
        label: `Vehicle · ${AMMO_NAME[ammo]}${dep}`,
        hint: why ?? `Aim at one enemy vehicle: a hit rolls To Kill (${AMMO_NAME[ammo]} TK ${tk(1) ?? '—'} at 1 hex, ${tk(6) ?? '—'} at 6, ${tk(12) ?? '—'} at 12) less the Armor Factor struck; Critical Hit on an original 2`,
        available: !why,
      });
    }
  }
  if (d.ife) out.push({ type: 'IFE', label: `IFE (${d.ife} FP)`, hint: maWhy ?? 'On the IFT like a machine gun: no To Hit roll, ROF one lower', available: !maWhy });
  return out;
}

/** The shot composer's reading of a shot: the rules' own `shotOutlook`. */
export type ThPreview = ShotOutlook;

/** What a shot would need: the To Hit number, the DRM the engine would apply (hindrance apart) and the DR to beat. */
export const thPreview = (env: QueryEnv, shot: OrdnanceShot, mode: FireMode, side: SideId, moving?: PieceId[]): ThPreview => shotOutlook(env, shot, mode, side, moving);
