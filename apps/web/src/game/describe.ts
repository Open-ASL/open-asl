import type { GameState, LoggedEvent, QueryEnv, SideId } from '@asl/engine';
import { SKY_NAME, chartLabel, entrenchmentAt, minefieldAt, rubbleAt, fortifiedKnownTo, defOf, hexOfLoc, levelOfLoc, entryAfterFireParams, entryGroupsParams, secretLengthParams, fortifiedParams, fortKindName, hexOf, shownCounter, type FortRecord, scatterParams, isVisibleTo, isWeaponDef, statics, weatherLabel, type CounterDef, type IftResult, type VariableReinforcementsEvent, type EntryOrderDrEvent, type EntryLossesEvent, entryOrderDrParams, entryOrderLabel, type ForceChartEvent, type ScatterState, type ScatterLanding, type EntryGroupsState, type Weather, NATION, PHASE_NAME, defLabel, hexLabel, humanize, nameIds, nationName, pieceLabel, sideNameOf, entryStretchParams, type LeaderReliefEvent, type OnceDrEvent, type OnceDrNmcEvent, type OnceDrRallyEvent, type LeaderPtcEvent, type RoutStep, sideNationalities } from '@asl/rules';

// The naming helpers live in @asl/rules (labels.ts) so the server can name units too; re-exported for the many callers here.
export { NATION, PHASE_NAME, defLabel, hexLabel, humanize, nameIds, nationName, pieceLabel, sideNameOf };

/**
 * The side a phase belongs to, to name it by: the DEFENDER's in the Defensive Fire Phase (SK1 3.4: "the DEFENDER may
 * fire"; a card's "Russian Defensive Fire Phase" is the Russians' own), the ATTACKER's otherwise.
 */
export function phaseSide(phase: string, attacker: SideId, sides: readonly SideId[]): SideId {
  return phase === 'DFPh' ? (sides.find((s) => s !== attacker) ?? attacker) : attacker;
}

/** Ammunition names for the log (SK4 6.2). */
const AMMO_LABEL: Record<string, string> = { HE: 'HE', AP: 'AP', HEAT: 'HEAT', APCR: 'APCR', APDS: 'APDS', SMOKE: 'Smoke', WP: 'WP' };

const CLEAR_NAME: Record<string, string> = { wire: 'Wire', rubble: 'rubble', roadblock: 'roadblock', mines: 'minefield' };
const CLEAR_RULE: Record<string, string> = { wire: 'B24.73', rubble: 'B24.71', roadblock: 'B24.76', mines: 'B24.74' };
const resultText = (r: IftResult) =>
  r.kind === 'none' ? 'no effect' : r.kind === 'KIA' ? `${r.n}KIA` : r.kind === 'K' ? `K/${r.n}` : r.kind === 'MC' ? `${r.n}MC` : r.kind;

/** Why a SW did not keep its Rate of Fire (SK1 1.2.4, 3.2). */
const ROF_LOSS: Record<string, string> = {
  cowered: 'the attack cowered (original doubles, no leader directing), so every firer is marked',
  pinned: 'a pinned unit\'s SW cannot retain ROF',
  fpf: 'Final Protective Fire never retains ROF',
  afph: 'no Rate of Fire in the Advancing Fire Phase',
};

export interface LogLine {
  seq: number;
  kind: 'phase' | 'fire' | 'check' | 'move' | 'info' | 'cc' | 'end';
  text: string;
  detail?: string;
  /** A shot's LOS, firing hexes to target, so the player can have it drawn on the map again. */
  /** `at`: the corner each firing hex traced to, firing at a stack in Bypass (full ASL, ASLRB A4.34). */
  /** `snap`: the hexside a Snap Shot was aimed at (full ASL, ASLRB A8.15). */
  /** `blocked`: the shot found no LOS (A6.11: declared, then checked). A shot without it had its LOS. */
  los?: { from: string[]; to: string; at?: Record<string, [string, string]>; snap?: [string, string]; blocked?: true };
  /** Set by `phaseSections` on the line that opens an entry (a shot, a check, a move), not its results. */
  opens?: boolean;
  /** On a `phase` line: the Player Turn and phase it opens, for the log's section headings. */
  phase?: { turn: number; side: string; name: string };
  /**
   * The counter nationality whose emblem marks the line: the unit it is about (the firer of a shot, the unit of a
   * result or check), else its side's. A concealed or hidden enemy is its side's, so a mixed force is not told apart.
   */
  nation?: string;
  /** The expanded entry's heading, on the line that opens it (who fired at what). Without it, the line's text. */
  title?: string;
  /** The line spelled out for the expanded entry, every modifier on its own. Without it, the text and detail. */
  rows?: LogRow[];
}

/** One labelled row of an expanded log entry: "DRM +1" with its modifiers ("+2 TEM (trench)", "-1 vs FT possessor"). */
export interface LogRow {
  k: string;
  v: string;
  mods?: string[];
  /** What it came to ("NMC", "broken", "HIT"). */
  out?: string;
}

/** One phase of the log: its heading (none for what came before the first phase) and its lines. */
export interface LogSection {
  head?: LogLine;
  lines: LogLine[];
}

/**
 * The log one section per phase, oldest first like the dice log, so each phase can be shown under its own heading.
 * An entry is a line and the indented lines after it (a shot, then its results and the checks it caused, which
 * `describeEvents` indents); its first line is marked `opens`.
 */
export function phaseSections(lines: LogLine[]): LogSection[] {
  const sections: { head?: LogLine; entries: LogLine[][] }[] = [{ entries: [] }];
  for (const l of lines) {
    const sec = sections[sections.length - 1]!;
    if (l.kind === 'phase') sections.push({ head: l, entries: [] });
    else if (l.text.startsWith(' ') && sec.entries.length) sec.entries[sec.entries.length - 1]!.push(l);
    else sec.entries.push([{ ...l, opens: true }]);
  }
  return sections
    .filter((sec) => sec.head || sec.entries.length)
    .map((sec) => ({ ...(sec.head ? { head: sec.head } : {}), lines: sec.entries.flat() }));
}

/**
 * A provisional reinforcement's entry dr ("enter on a dr < the current Turn number", or a chart of circled numbers):
 * the force, what it needed and whether it enters this Player Turn. The rules record only the roll, labelled
 * "<force>: entry dr (needs < 3)" or "(needs ≤ 2)".
 */
export function entryRoll(label: string, dr: number): { force: string; need: string; enters: boolean } | null {
  const m = /^(.*): entry dr \(needs (<|≤) (\d+)\)$/.exec(label);
  if (!m) return null;
  const n = Number(m[3]);
  return { force: m[1]!, need: `${m[2]} ${n}`, enters: m[2] === '<' ? dr < n : dr <= n };
}

/** What the log calls each kind of fire attack. */
const FIRE_MODE_NAME: Record<string, string> = {
  prep: 'Prep Fire',
  first: 'Defensive First Fire',
  subsequentFirst: 'Subsequent First Fire',
  fpf: 'FPF',
  final: 'Final Fire',
  advancing: 'Advancing Fire',
  bounding: 'Bounding Fire',
};

/** The labels of a list of explain notes (`{ id, label? }`) as the events carry them. */
/**
 * A DR written out colored die first, as ASL reads it: "5+3=8" for white 3, colored 5. The log
 * draws every "c+w=t" as the two dice, so each two-dice roll is written this way.
 */
const drText = (dr: readonly number[]) => `${dr[1]}+${dr[0]}=${dr[0]! + dr[1]!}`;
/** The hexsides of the hex grid by `sideToward`'s numbering (0 south-east, clockwise), as the wind and falling rubble name them. */
const HEXSIDE_NAME = ['south-east', 'south', 'south-west', 'north-west', 'north', 'north-east'];
/** A Location for the log: its hex, and the level when above ground. */
const locText = (loc: string) => `${hexLabel(hexOfLoc(loc))}${levelOfLoc(loc) ? ` level ${levelOfLoc(loc)}` : ''}`;
const noteLabels = (xs: unknown) => ((xs as { label?: string }[] | undefined) ?? []).map((x) => x.label).filter((l): l is string => !!l);

/**
 * Turn engine events into human-readable log lines. `viewer` (a side, or null for a spectator)
 * never reads of a piece still hidden from them (SK2 HIP): such lines are left out.
 */
export function describeEvents(env: QueryEnv, events: LoggedEvent[], viewer: SideId | null = null): LogLine[] {
  const out: LogLine[] = [];
  const hiddenFrom = (id: string) => {
    const pc = env.state.pieces[id];
    return !!pc && !isVisibleTo(env, pc, viewer);
  };
  // Units are named as they stood at each event. The state in hand is the one after the whole
  // batch, so the counter replacements in it (ELR, Casualty Reduction) are replayed backwards:
  // a line before a replacement names the old counter, a line after it the new one.
  const defAfter: Map<string, string>[] = new Array<Map<string, string>>(events.length);
  let cur = new Map<string, string>();
  for (let i = events.length - 1; i >= 0; i--) {
    defAfter[i] = cur;
    const e = events[i]!;
    if (e.type === 'piece.replaced') {
      const p = e.payload as { id: string; from?: string };
      if (p.from) cur = new Map(cur).set(p.id, p.from);
    }
  }
  /** A side's emblem nationality: its first (a side mixing counter sets fields several). */
  const sideNation = (side: string | undefined): string | undefined => {
    if (!side) return undefined;
    try {
      return sideNationalities(env, side)[0];
    } catch {
      return NATION[side] ? side : undefined;
    }
  };
  /** A piece's emblem nationality: its counter's, unless it is captured, or a concealed or hidden enemy (then its side's). */
  const pieceNation = (id: string): string | undefined => {
    const pc = env.state.pieces[id];
    if (!pc) return undefined;
    const nat = defOf(env, pc).nationality;
    const masked = hiddenFrom(id) || (pc.tags['concealed'] === true && pc.side !== viewer);
    let own: string[] = [];
    try {
      own = sideNationalities(env, pc.side);
    } catch {
      /* a side the scenario does not set up: its counters' own nationality */
    }
    return !masked && (own.includes(nat) || !own.length) ? nat : sideNation(pc.side);
  };
  /** The piece an event is about, by the payload keys the events name it with; else its side. */
  const ACTOR_KEYS = ['weapon', 'gun', 'unit', 'vehicle', 'afv', 'sw', 'squad', 'placer', 'holder', 'leader', 'observer', 'director', 'id'];
  const eventNation = (e: LoggedEvent): string | undefined => {
    const p = e.payload as Record<string, unknown>;
    const parts = (p['attack'] as { parts?: string[] } | undefined)?.parts;
    if (parts?.length) return pieceNation(parts[0]!);
    for (const k of ACTOR_KEYS) if (typeof p[k] === 'string' && env.state.pieces[p[k] as string]) return pieceNation(p[k] as string);
    for (const k of ['units', 'attackers']) {
      const xs = p[k];
      if (Array.isArray(xs) && typeof xs[0] === 'string' && env.state.pieces[xs[0]]) return pieceNation(xs[0]);
    }
    return typeof p['side'] === 'string' ? sideNation(p['side']) : undefined;
  };
  const counters = (env.statics as { counters: Record<string, CounterDef> }).counters;
  const asDef = (id: string, defId: string | undefined) => {
    const pc = env.state.pieces[id];
    return pieceLabel(env, pc && defId ? { ...pc, defId } : pc);
  };
  let at = 0;
  const name = (id: string) => asDef(id, defAfter[at]?.get(id));
  // Where a piece stands now (a held Gun or SW: where its holder stands), for recordings made before
  // the fire events named the hex fired from.
  const hexOfNow = (id: string): string | undefined => {
    const pc = env.state.pieces[id];
    return pc ? (hexOf(env.state, pc) ?? undefined) : undefined;
  };
  /** The IFT column an attack of `fp` uses before any shift (the highest column not above it). */
  const fpColumn = (fp: number): number => (env.statics as { tables: { iftColumns: number[] } }).tables.iftColumns.filter((c) => c <= fp).pop() ?? 0;
  // The LOS of a shot from one hex, for the map, when it was fired from somewhere else than the target.
  const losOf = (from: string | undefined, to: string): Pick<LogLine, 'los'> => (from && from !== to ? { los: { from: [from], to } } : {});
  // A DR an event records only as its total (a MC, a CC attack, the weather): the dice come from the
  // roll that made it, the nearest earlier two-dice roll with that total, preferring one whose label
  // names `mention` (the unit that checked). An Original DR reused (FPF, depletion) finds the roll it
  // came from the same way. No such roll in sight: the total alone.
  const dr2 = (total: unknown, mention?: string): string => {
    let any: number[] | undefined;
    for (let j = at - 1; j >= Math.max(0, at - 80); j--) {
      const f = events[j]!;
      if (f.type !== 'dice.rolled') continue;
      const q = f.payload as { label: string; dice: number[]; secret?: string };
      if (q.secret !== undefined && q.secret !== viewer) continue;
      if (q.dice.length !== 2 || q.dice[0]! + q.dice[1]! !== total) continue;
      if (!mention || q.label.includes(mention)) return drText(q.dice);
      any ??= q.dice;
    }
    return any ? drText(any) : String(total);
  };
  /** The rout step a unit's move at event `i` was, from the rout state event that closes it (a few events on at most). */
  const routStepAfter = (i: number, id: string): RoutStep | null => {
    for (let j = i + 1; j < Math.min(events.length, i + 40); j++) {
      const f = events[j]!;
      if (f.type === 'sk1.rout.state') {
        const step = (f.payload as { step?: RoutStep }).step;
        return step?.unit === id ? step : null;
      }
      if (f.type === 'piece.moved' && (f.payload as { id: string }).id === id) return null;
    }
    return null;
  };
  for (const [i, e] of events.entries()) {
    at = i;
    const p = e.payload as Record<string, unknown>;
    switch (e.type) {
      case 'turn.phaseStarted': {
        const side = phaseSide(p['phase'] as string, p['attacker'] as string, env.state.sides);
        out.push({
          seq: e.seq,
          kind: 'phase',
          text: `Turn ${p['turn']} — ${sideNameOf(env, side)} ${PHASE_NAME[p['phase'] as string] ?? p['phase']}`,
          phase: { turn: p['turn'] as number, side, name: PHASE_NAME[p['phase'] as string] ?? String(p['phase']) },
        });
        break;
      }
      case 'sk1.fire.attack': {
        const dr = p['dr'] as [number, number];
        // How the FP came about (½ Advancing Fire, +1 Assault Fire ...) and every DRM on the attack.
        const fp = noteLabels(p['fpExplain']).join(', ');
        const drm = noteLabels(p['explain']).join(', ');
        // Concealed targets are attacked as Area Fire at a lower FP (SK4 8.3.2): their own figure, without naming them.
        const area = p['area'] as { targets: string[]; fp: number; column: number | null; fpExplain?: unknown } | undefined;
        const areaText = area ? `; vs the concealed unit${area.targets.length === 1 ? '' : 's'}, Area Fire: ${area.fp} FP → ${area.column ?? 'no'} column` : '';
        const areaFp = area ? noteLabels(area.fpExplain).join(', ') : '';
        const detail = [fp ? `FP: ${fp}` : '', areaFp ? `Area Fire FP: ${areaFp}` : '', drm ? `DRM: ${drm}` : ''].filter(Boolean).join(' · ');
        const a = p['attack'] as { target: string; parts: string[]; mode?: string; at?: Record<string, [string, string]>; snap?: [string, string] };
        // The hexes fired from: on the event since 2026-10-26, else where the firers (or whoever holds
        // them, for a Gun or SW) stand now.
        const from = (p['from'] as string[] | undefined) ?? [...new Set(a.parts.map(hexOfNow).filter((h): h is string => !!h))];
        const directors = ((a as { directors?: string[] }).directors ?? []).filter((d) => !hiddenFrom(d));
        const drmNotesOf = noteLabels(p['explain']);
        out.push({
          seq: e.seq,
          kind: 'fire',
          title: `${a.parts.length ? a.parts.map(name).join(', ') : 'Residual FP'} → ${hexLabel(a.target)} · ${a.parts.length ? (FIRE_MODE_NAME[a.mode ?? ''] ?? 'Fire') : 'Residual FP'}${a.snap ? ' (Snap Shot)' : ''}`,
          rows: [
            ...(directors.length ? [{ k: 'Directed', v: directors.map(name).join(', ') }] : []),
            { k: 'Strength', v: `${p['fp']} FP → ${p['cowered'] ? `${fpColumn(p['fp'] as number)} column, cowers to the ${p['column'] ?? '—'} column` : `${p['column'] ?? '—'} column`}`, mods: noteLabels(p['fpExplain']) },
            ...(area ? [{ k: 'Area Fire', v: `vs the concealed unit${area.targets.length === 1 ? '' : 's'}: ${area.fp} FP → ${area.column ?? 'no'} column`, mods: noteLabels(area.fpExplain) }] : []),
            { k: 'Roll', v: `DR ${drText(dr)}` },
            // The DRM every target shares; a target's own (its TEM, a FT it holds) is on its result.
            { k: 'DRM, all', v: `${(p['drm'] as number) >= 0 ? '+' : ''}${p['drm']}`, mods: drmNotesOf.length ? drmNotesOf : ['none'] },
          ],
          // A cowering attack (original doubles, no leader directing; SK1 3.2) is resolved columns lower: both shown.
          text: `${a.parts.length ? (FIRE_MODE_NAME[a.mode ?? ''] ?? 'Fire') : 'Residual FP'}${a.snap ? ` (Snap Shot at ${a.snap.map(hexLabel).join('-')})` : ''} on ${hexLabel(a.target)}: ${p['fp']} FP → ${p['cowered'] ? `${fpColumn(p['fp'] as number)} column, cowers to the ${p['column'] ?? '—'} column` : `${p['column'] ?? '—'} column`}${areaText}, DR ${drText(dr)}, DRM ${(p['drm'] as number) >= 0 ? '+' : ''}${p['drm']}`,
          ...(detail ? { detail } : {}),
          ...(from.length && from.some((h) => h !== a.target) ? { los: { from: from.filter((h) => h !== a.target), to: a.target, ...(a.at ? { at: a.at } : {}), ...(a.snap ? { snap: a.snap } : {}) } } : {}),
        });
        break;
      }
      case 'sk1.fire.noLos': {
        const a = p['attack'] as { target: string; parts: string[]; mode?: string; at?: Record<string, [string, string]>; snap?: [string, string] };
        const from = (p['from'] as string[]).map(hexLabel).join(', ');
        out.push({
          seq: e.seq,
          kind: 'fire',
          text: `${FIRE_MODE_NAME[a.mode ?? ''] ?? 'Fire'}${a.snap ? ` (Snap Shot at ${a.snap.map(hexLabel).join('-')})` : ''} on ${hexLabel(a.target)} from ${from}: no LOS (${(p['blockedBy'] as string[]).join('; ')}) — ${a.parts.map(name).join(', ')} fired for nothing${p['dr'] ? ` (DR ${drText(p['dr'] as number[])} for breakdown and ROF${p['cowered'] ? ', cowers' : ''})` : ''}`,
          los: { from: p['from'] as string[], to: a.target, ...(a.at ? { at: a.at } : {}), ...(a.snap ? { snap: a.snap } : {}), blocked: true },
        });
        break;
      }
      case 'sk1.fire.result': {
        // A concealed unit the viewer cannot see is its "?" (what the attack did, not what it hit, SK4 8.3); a hidden one is not mentioned.
        if (hiddenFrom(p['unit'] as string)) {
          if (env.state.pieces[p['unit'] as string]?.tags['concealed'] === true) out.push({ seq: e.seq, kind: 'fire', text: `  ? (concealed): ${resultText(p['result'] as IftResult)} (final DR ${p['finalDr']})` });
          break;
        }
        // A unit's own modifier to the attack's DR (-1 vs a FT possessor) is why its final DR differs.
        const own = noteLabels(p['explain']).join(', ');
        if (p['critical']) {
          out.push({ seq: e.seq, kind: 'fire', text: `  ${name(p['unit'] as string)}: eliminated with its Gun (Critical Hit)` });
          break;
        }
        // A PTC rolls nothing for a unit already pinned or broken (SK1 3.2.2: it affects unbroken, unpinned units), so no
        // check line follows; say so, or the pins of an earlier attack read as this PTC's. A CE crew's check is the
        // vehicle's own (SK4 7.7).
        const checks = (x: (typeof events)[number]) =>
          (x.type === 'sk1.check' && (x.payload as { unit: string }).unit === p['unit']) || (x.type === 'sk3.vehicle.check' && (x.payload as { vehicle: string }).vehicle === p['unit']);
        const noCheck =
          (p['result'] as IftResult).kind === 'PTC' && !events.slice(at + 1).some((x, k, rest) => checks(x) && !rest.slice(0, k).some((y) => y.type === 'sk1.fire.attack'));
        out.push({
          seq: e.seq,
          kind: 'fire',
          text: `  ${name(p['unit'] as string)}: ${resultText(p['result'] as IftResult)} (final DR ${p['finalDr']}${own ? `: ${own}` : ''})${noCheck ? ' — no effect: already pinned or broken (a PTC affects only unbroken, unpinned units)' : ''}`,
          rows: [{ k: 'Result', v: `${name(p['unit'] as string)}: final DR ${p['finalDr']}`, mods: noteLabels(p['explain']), out: noCheck ? 'no effect (already pinned or broken)' : resultText(p['result'] as IftResult) }],
        });
        break;
      }
      case 'sk1.fire.dm': {
        const units = (p['units'] as string[]).filter((u) => !hiddenFrom(u));
        if (units.length) out.push({ seq: e.seq, kind: 'fire', text: `  ${units.map(name).join(', ')}: placed under DM (the attack could inflict a NMC)` });
        break;
      }
      case 'sk1.fire.rof': {
        const colored = p['colored'] as number;
        for (const k of p['kept'] as { sw: string; rof: number }[]) {
          out.push({ seq: e.seq, kind: 'fire', text: `  ${name(k.sw)} keeps ROF (colored dr ${colored} ≤ ${k.rof}): it may fire again this phase` });
        }
        for (const l of p['lost'] as { sw: string; rof: number; why: string }[]) {
          out.push({ seq: e.seq, kind: 'fire', text: `  ${name(l.sw)} loses ROF: ${l.why === 'exceeded' ? `colored dr ${colored} > ${l.rof}` : (ROF_LOSS[l.why] ?? l.why)}` });
        }
        break;
      }
      case 'hex.marker': {
        // A Residual FP counter (SK4 3.3.5, ASLRB A8.26): its size and, where the rules recorded it, how it was found.
        if (p['key'] !== 'residualFp' || !p['value']) break;
        const r = p['residual'] as { column: number; outside: number; bonus: number } | undefined;
        let why = '';
        if (r) {
          const cols = (env.statics as { tables: { iftColumns: number[] } }).tables.iftColumns;
          const half = cols.filter((c) => c <= Math.min(12, Math.floor(r.column / 2))).pop() ?? 0;
          const parts = [`half the ${r.column} column: ${half}`];
          if (r.outside) parts.push(`−${r.outside} column${r.outside === 1 ? '' : 's'} for +${r.outside} DRM from outside the hex`);
          if (r.bonus) parts.push(`+${r.bonus} column${r.bonus === 1 ? '' : 's'} (Air Burst)`);
          why = ` (${parts.join(', ')})`;
        }
        out.push({ seq: e.seq, kind: 'fire', text: `  Residual FP ${p['value']} left in ${hexLabel(p['hex'] as string)}${why}` });
        break;
      }
      case 'sk1.fire.rofDeclined':
        out.push({ seq: e.seq, kind: 'fire', text: `  ${name(p['sw'] as string)} gives up its ROF: ${p['residual']} Residual FP left in ${hexLabel(p['hex'] as string)}` });
        break;
      case 'sk1.check':
        if (hiddenFrom(p['unit'] as string)) break;
        out.push({
          seq: e.seq,
          kind: 'check',
          // An FPF NMC rolls nothing: it is the attack's Original DR, on the units that fired (SK1 3.3.1).
          text: `  ${p['reason'] === 'FPF' ? 'FPF NMC on firer' : p['kind']} ${name(p['unit'] as string)}: ${p['reason'] === 'FPF' ? 'Original DR' : 'DR'} ${dr2(p['dr'], p['unit'] as string)} → ${p['final']} vs ${p['target']} — ${p['outcome'] === 'stepReduced' ? 'Step Reduced' : p['outcome']}`,
          detail: [p['reason'] as string, ...((p['explain'] as { label?: string }[] | undefined) ?? []).map((n) => n.label).filter(Boolean)].join(', '),
          rows: [
            {
              k: p['reason'] === 'FPF' ? 'FPF NMC' : String(p['kind']),
              v: `${name(p['unit'] as string)}${p['reason'] && p['reason'] !== 'FPF' ? ` (${p['reason']})` : ''}: ${p['reason'] === 'FPF' ? 'Original DR' : 'DR'} ${dr2(p['dr'], p['unit'] as string)} → ${p['final']} vs ${p['target']}`,
              mods: noteLabels(p['explain']),
              out: p['outcome'] === 'stepReduced' ? 'Step Reduced' : String(p['outcome']),
            },
          ],
        });
        break;
      case 'piece.moved': {
        // Support weapons changing hands or being dropped (units moving is covered by the move log).
        const pc = env.state.pieces[p['id'] as string];
        const loc = p['loc'] as { kind: string; by?: string; hex?: string };
        // A hex of a rout: its state event, after any Interdiction it drew, tells whether it was a Low Crawl and why
        // it was or was not open to Interdiction (SK1 3.6).
        const step = pc && !isWeaponDef(defOf(env, pc)) ? routStepAfter(i, pc.id) : null;
        if (step && !hiddenFrom(step.unit)) {
          const where = hexLabel(step.to);
          const why =
            step.interdiction === 'checked'
              ? `Interdiction${step.by!.some(hiddenFrom) ? '' : ` by ${step.by!.map(name).join(', ')}`}`
              : step.interdiction === 'lowCrawl'
                ? 'no Interdiction (Low Crawl)'
                : step.interdiction === 'notOpen'
                  ? 'no Interdiction (not Open Ground)'
                  : step.interdiction === 'entrenched'
                    ? 'no Interdiction (beneath the entrenchment, ASLRB B27.41)'
                    : 'no Interdiction (no enemy able to interdict)';
          // Interdiction is decided along an unhindered LOS, already traced: clicking the line draws it as a shot's does.
          const interdictors = step.interdiction === 'checked' && step.byFrom?.length && !step.by!.some(hiddenFrom) ? [...new Set(step.byFrom)].filter((h) => h !== step.to) : [];
          out.push({ seq: e.seq, kind: 'info', text: `${step.lowCrawl ? 'Low Crawl' : 'Rout'}: ${name(step.unit)} to ${where} · ${why}`, ...(interdictors.length ? { los: { from: interdictors, to: step.to } } : {}) });
          break;
        }
        if (pc && isWeaponDef(defOf(env, pc))) {
          const gun = defOf(env, pc).kind === 'gun';
          if (loc.kind === 'held' && loc.by) out.push({ seq: e.seq, kind: 'info', text: `  ⇄ ${name(pc.id)} now ${gun ? 'manned' : 'carried'} by ${name(loc.by)}` });
          else if (loc.kind === 'hex' && loc.hex) out.push({ seq: e.seq, kind: 'info', text: `  ⤓ ${name(pc.id)} left in ${loc.hex.replace(/^[a-z]/, '')}` });
        }
        break;
      }
      case 'piece.eliminated': {
        const pc = env.state.pieces[p['id'] as string];
        out.push({ seq: e.seq, kind: 'info', text: `  ✖ ${pc ? pieceLabel(env, pc) : p['id']} eliminated (${p['reason']})` });
        break;
      }
      case 'piece.tagged': {
        // A weapon breaking down (SK1 1.2.4, SK4 7.8): the counter flips, or for a vehicular MG the
        // vehicle wears the marker, so the log says so. Guns have their own line (sk2.gun.malf).
        const tags = p['tags'] as Record<string, unknown>;
        // An Acquired Target counter coming off (SK4 6.10, 6.11; ASLRB C6.5) is said, with the cause when it was the
        // possessor firing its own FP, so the counter does not seem to vanish. A new acquisition in the same action
        // (a shot at another target) has its own line.
        if ('acq' in tags && tags['acq'] === null && !hiddenFrom(p['id'] as string)) {
          const id = p['id'] as string;
          const reacquired = events.slice(at + 1).some((x) => x.type === 'piece.tagged' && (x.payload as { id: string }).id === id && typeof (x.payload as { tags: Record<string, unknown> }).tags['acq'] === 'string');
          if (reacquired) break;
          const pc = env.state.pieces[id];
          const holder = pc?.loc.kind === 'held' ? pc.loc.by : undefined;
          const ownFp = !!holder && events.slice(0, at).some((x) => x.type === 'sk1.fire.attack' && ((x.payload as { attack: { parts: string[] } }).attack.parts.includes(holder) && !(x.payload as { attack: { parts: string[] } }).attack.parts.includes(id)));
          out.push({ seq: e.seq, kind: 'info', text: `  ◎ ${name(id)} loses its Acquired Target counter${ownFp ? ' (its possessor fired its own FP, SK4 6.10)' : ''}` });
          break;
        }
        if (tags['malf'] !== true) break;
        const pc = env.state.pieces[p['id'] as string];
        const d = pc && defOf(env, pc);
        if (!pc || !d || d.kind !== 'sw') break;
        const holder = pc.loc.kind === 'held' ? env.state.pieces[pc.loc.by] : undefined;
        const who = d.fixed && holder ? `${pieceLabel(env, holder)}'s ${d.type}` : name(pc.id);
        out.push({ seq: e.seq, kind: 'info', text: `  ✖ ${who} malfunctions` });
        break;
      }
      case 'sk3.vehicle.repair': {
        const v = env.state.pieces[p['vehicle'] as string];
        const w = p['weapon'] as string;
        const wp = w !== 'ma' ? env.state.pieces[w] : undefined;
        const wd = wp ? defOf(env, wp) : undefined;
        const what = w === 'ma' ? 'MA' : wd && wd.kind === 'sw' ? wd.type : 'MG';
        const RESULT: Record<string, string> = { repaired: 'is repaired', disabled: `is disabled for good${w === 'ma' ? ' (Recalled)' : ''}`, none: 'stays malfunctioned' };
        out.push({ seq: e.seq, kind: 'info', text: `  ${p['result'] === 'repaired' ? '✔' : '✖'} ${v ? pieceLabel(env, v) : p['vehicle']}'s ${what} ${RESULT[p['result'] as string] ?? p['result']} (repair dr ${p['dr']})` });
        break;
      }
      case 'piece.replaced': {
        // An ELR replacement (and a Japanese Step Reduction) has its own line below, with the reason; losses before entry (SSR) are summed up above.
        if (p['reason'] === 'elr' || p['reason'] === 'ssr' || p['reason'] === 'deploy' || p['reason'] === 'step') break;
        const to = counters[p['defId'] as string];
        out.push({
          seq: e.seq,
          kind: 'info',
          text: `  ${p['reason'] === 'recombine' ? '↑' : '↓'} ${p['reason'] === 'cr' ? 'Casualty Reduction: ' : p['reason'] === 'commissar' ? 'Failed to rally under the Commissar: ' : p['reason'] === 'rally' ? 'Failed to rally under a Japanese leader (SK4 8.1.7): ' : ''}${asDef(p['id'] as string, p['from'] as string | undefined)} becomes ${to ? defLabel(to) : p['defId']}`,
        });
        break;
      }
      case 'ssr.setup-deploy': {
        // A squad split into two half-squads at setup (SSR).
        const from = counters[p['from'] as string];
        const to = counters[p['to'] as string];
        out.push({ seq: e.seq, kind: 'info', text: `  ⇉ ${p['rule'] ? `${p['rule']}: ` : ''}${from ? defLabel(from) : p['from']} deployed as two ${to ? defLabel(to) : p['to']}` });
        break;
      }
      case 'sk1.elr': {
        const to = counters[p['to'] as string];
        out.push({
          seq: e.seq,
          kind: 'info',
          text: `  ↓ ELR: ${asDef(p['unit'] as string, p['from'] as string)} becomes ${to ? defLabel(to) : p['to']} (failed by ${p['failedBy']}, ELR ${p['elr']})`,
        });
        break;
      }
      case 'sk1.leaderCreation': {
        const leader = p['leader'] as string | null;
        const made = leader && env.state.pieces[leader] ? pieceLabel(env, env.state.pieces[leader]) : null;
        out.push({ seq: e.seq, kind: 'info', text: `  ★ Leader Creation for ${name(p['unit'] as string)}: dr ${p['dr']} — ${made ? `${made} created` : 'no leader'}` });
        break;
      }
      case 'sk1.fortified': {
        // The buildings themselves stay out of the log: the designation is secret (SSR), unless the card makes it open.
        const st = p['state'] as { side: string; buildings: string[]; locations?: string[] };
        const locLabel = (loc: string) => `${hexLabel(hexOfLoc(loc))}${levelOfLoc(loc) ? ` level ${levelOfLoc(loc)}` : ''}`;
        if (st.locations) {
          if (st.locations.length && fortifiedParams(env)?.open) out.push({ seq: e.seq, kind: 'info', text: `${sideNameOf(env, st.side)} fortified ${st.locations.map(locLabel).join(', ')} (SSR)` });
          else if (st.locations.length) out.push({ seq: e.seq, kind: 'info', text: `${sideNameOf(env, st.side)} secretly designated ${st.locations.length} Fortified Building Location${st.locations.length === 1 ? '' : 's'} (SSR)` });
          break;
        }
        if (st.buildings.length && fortifiedParams(env)?.open) {
          const named = st.buildings.map((b) => [...statics(env).map.hexes()].filter((h) => h.buildingId === b).map((h) => hexLabel(h.id)).join('/')).join(', ');
          out.push({ seq: e.seq, kind: 'info', text: `${sideNameOf(env, st.side)} fortified building ${named} (SSR)` });
        } else if (st.buildings.length) out.push({ seq: e.seq, kind: 'info', text: `${sideNameOf(env, st.side)} secretly designated ${st.buildings.length} fortified building${st.buildings.length === 1 ? '' : 's'} (SSR)` });
        break;
      }
      case 'asl.bypass.wireRefused': {
        const units = (p['units'] as string[]).map(name).join(', ');
        const wire = (p['wire'] as string[]).map(hexLabel).join(', ');
        out.push({ seq: e.seq, kind: 'move', text: `  ▣ Wire in ${wire}: ${units} cannot bypass ${hexLabel(p['hex'] as string)} (ASLRB B26.44); nothing is spent and the move goes on` });
        break;
      }
      case 'asl.wire.vehicleRefused': {
        out.push({ seq: e.seq, kind: 'move', text: `  ▣ ${name(p['vehicle'] as string)} finds Wire in ${hexLabel(p['hex'] as string)}: nothing is spent, and entering it costs its Wire MP and a Bog Check (ASLRB B26.43)` });
        break;
      }
      case 'asl.ent.vehicleRefused': {
        const what = p['kind'] === 'ditch' ? 'an A-T Ditch: no vehicle may enter it (ASLRB B27.56)' : p['kind'] === 'foxhole' ? 'a foxhole: entering its hex costs an Armored Car 2 MP more (ASLRB B27.43)' : 'a trench: no wheeled vehicle or halftrack may enter its hex (ASLRB B27.55)';
        out.push({ seq: e.seq, kind: 'move', text: `  ▣ ${name(p['vehicle'] as string)} finds ${what} in ${hexLabel(p['hex'] as string)}; nothing is spent` });
        break;
      }
      case 'asl.fortified.refused': {
        const units = (p['units'] as string[]).map(name).join(', ');
        const loc = p['loc'] as string;
        const where = `${hexLabel(hexOfLoc(loc))}${levelOfLoc(loc) ? ` level ${levelOfLoc(loc)}` : ''}`;
        out.push({
          seq: e.seq,
          kind: 'move',
          text:
            p['reason'] === 'gun'
              ? `  ▣ ${units} cannot push the Gun into ${where}: a Fortified Building Location (ASLRB B23.93); the MF are spent where they stand and the move is over`
              : `  ▣ ${where} is a Fortified Building Location held by an unpinned Good Order squad: ${units} ${p['phase'] === 'APh' ? 'stays put and loses its advance' : 'stops short, the MF spent where it stands, and its move is over'} (ASLRB B23.922)`,
        });
        break;
      }
      case 'asl.breach.declared':
        out.push({ seq: e.seq, kind: 'move', text: `  ✸ ${name(p['placer'] as string)} places a DC against the ${hexLabel(hexOfLoc(p['loc'] as string))}/${hexLabel(p['toward'] as string)} hexside to Breach it (1 MF, ASLRB B23.9221)` });
        break;
      case 'asl.breach.attempt': {
        const loc = p['loc'] as string;
        const side = `${hexLabel(hexOfLoc(loc))}/${hexLabel(p['toward'] as string)}`;
        const text = p['malfunctioned']
          ? `  ✸ Breach attempt on the ${side} hexside: the DC fails to detonate (DR ${dr2(p['dr'], 'Breach')})`
          : `  ✸ Breach attempt on the ${side} hexside: DR ${dr2(p['dr'], 'Breach')}${(p['drm'] as number) ? ` ${(p['drm'] as number) > 0 ? '+' : ''}${p['drm']}` : ''} — ${p['result'] === 'none' ? 'no effect' : p['result']}: ${p['breached'] ? 'the hexside is Breached' : p['unfortified'] ? `no Breach: ${hexLabel(hexOfLoc(loc))} is not a Fortified Building Location, and the DC attacks only as Area Fire (ASLRB B23.9221)` : 'the wall holds'}`;
        out.push({ seq: e.seq, kind: 'fire', text });
        break;
      }
      case 'asl.breach.he':
      case 'asl.breach': {
        const b = (e.type === 'asl.breach.he' ? { loc: p['loc'], toward: p['toward'], by: 'he' } : p['breach']) as { loc: string; toward: string; by: string };
        // A HE KIA's Breach is told only where it Breached, and only to a viewer who knows the Location is fortified (B23.911).
        if (e.type === 'asl.breach.he' && (!p['breached'] || !fortifiedKnownTo(env, b.loc, viewer))) break;
        out.push({ seq: e.seq, kind: 'info', text: `  ⟋ Breach: the ${hexLabel(hexOfLoc(b.loc))}/${hexLabel(b.toward)} hexside${levelOfLoc(b.loc) ? ` at level ${levelOfLoc(b.loc)}` : ''} is open${b.by === 'he' ? ' (a HE KIA)' : ''}: Infantry may enter through it (ASLRB B23.9221)` });
        break;
      }
      // Full ASL Fire, rubble and wind (ASLRB B25, B24, B25.5, B25.63–B25.66).
      case 'asl.ec.set': {
        const ec = p['ec'] as { ec: string; drm: number; dr?: number; monthDrm?: number };
        const name = { snow: 'Snow', mud: 'Mud', wet: 'Wet', moist: 'Moist', moderate: 'Moderate', dry: 'Dry', veryDry: 'Very Dry' }[ec.ec] ?? ec.ec;
        out.push({ seq: e.seq, kind: 'info', text: `Environmental Conditions: ${name} (${ec.drm >= 0 ? '+' : ''}${ec.drm} DRM)${ec.dr !== undefined ? ` — dr ${ec.dr}${ec.monthDrm ? ` ${ec.monthDrm > 0 ? '+' : ''}${ec.monthDrm} for the month` : ''} (ASLRB B25.5)` : ' (scenario)'}` });
        break;
      }
      case 'asl.wind.set': {
        const w = p['wind'] as { force: string; dir?: number; gusts?: boolean };
        const force = { none: 'No Wind', breeze: 'Mild Breeze', heavy: 'Heavy Winds' }[w.force] ?? w.force;
        const dir = w.dir !== undefined ? ` toward the ${HEXSIDE_NAME[w.dir]} hexside` : '';
        const reason = p['reason'] as string;
        if (reason === 'gusts' || reason === 'gustsOver') break;
        out.push({ seq: e.seq, kind: 'info', text: `Wind: ${force}${dir}${reason === 'dr' ? ` (Wind Force dr ${p['dr']}${p['dirDr'] !== undefined ? `, direction dr ${p['dirDr']}` : ''}; ASLRB B25.63)` : reason === 'card' ? ' (scenario)' : reason === 'change' ? ` (Wind Change dr ${p['dr']}${p['dirDr'] !== undefined ? `, direction dr ${p['dirDr']}` : ''}; ASLRB B25.65)` : ''}` });
        break;
      }
      case 'asl.wind.changeDr': {
        const dr = p['dr'] as number[];
        const gusts = p['gusts'] as boolean;
        out.push({ seq: e.seq, kind: 'info', text: `Wind Change DR ${drText(dr)}: ${gusts ? `GUSTS this Player Turn${p['dir'] !== undefined ? ` toward the ${HEXSIDE_NAME[p['dir'] as number]} hexside` : ''} — every Blaze spreads downwind, one of them two hexes, Smoke disperses, a burning building may collapse (ASLRB B25.651, B25.66)` : p['change'] !== null ? 'the wind changes (ASLRB B25.65)' : 'no change'}` });
        break;
      }
      case 'asl.wind.smokeCleared':
        out.push({ seq: e.seq, kind: 'info', text: '  Heavy Winds: every Smoke counter is removed (ASLRB A24.6, B25.63)' });
        break;
      case 'asl.wind.smokeGusted':
        out.push({ seq: e.seq, kind: 'info', text: `  Gusts (${p['when']}): Dispersed Smoke removed, the rest flipped to Dispersed (ASLRB A24.62)` });
        break;
      case 'asl.entrench.attempt': {
        const ex = (p['explain'] as string[]).join(', ');
        const drm = p['drm'] as number;
        out.push({ seq: e.seq, kind: 'check', text: `  ⛏ ${name(p['unit'] as string)}${p['director'] ? ` (directed by ${name(p['director'] as string)})` : ''} tries to entrench in ${hexLabel(hexOfLoc(p['loc'] as string))}: DR ${drText(p['dr'] as number[])}${drm ? ` ${drm > 0 ? '+' : ''}${drm}` : ''}${ex ? ` (${ex})` : ''} ≤ 5? ${p['success'] ? `yes: a foxhole ${p['capacity']}S, beneath it` : `no${p['labor'] !== undefined ? `; Labor ${p['labor']} next time` : ''}`}; TI for the Player Turn (ASLRB B27.11, A4.8)` });
        break;
      }
      case 'asl.entrench.thMissed': {
        const units = (p['units'] as string[]).map(name).join(', ');
        out.push({ seq: e.seq, kind: 'info', text: `  ${units} beneath the entrenchment not hit: To Hit DR ${p['final']} +${p['extra']} entrenchment TEM > ${p['th']} (ASLRB C3.32, B27.3)` });
        break;
      }
      case 'asl.entrench.move': {
        // A move in or out of a hidden entrenchment is free and unseen (A12.33): told only to a viewer shown the counter.
        const ent = entrenchmentAt(env, p['hex'] as string);
        if (ent && !shownCounter(ent, viewer)) break;
        const units = (p['units'] as string[]).map(name).join(', ');
        const mf = p['mf'] as number;
        out.push({ seq: e.seq, kind: 'move', text: `  ${units} ${p['beneath'] ? 'go beneath' : 'climb out of'} the entrenchment in ${hexLabel(p['hex'] as string)}${p['phase'] === 'MPh' ? ` (${mf ? `${mf} MF` : 'no MF: hidden'})` : p['phase'] === 'RtPh' ? ` (+${mf} MF, no Interdiction there)` : ''} (ASLRB ${p['phase'] === 'RtPh' ? 'B27.41' : p['phase'] === 'APh' ? 'B27.44' : 'B27.4'})` });
        break;
      }
      case 'asl.wire.exit': {
        const rs = p['units'] as { unit: string; dr: number; mf: number; outcome: string }[];
        const where = hexLabel(p['hex'] as string);
        if (p['free']) {
          out.push({ seq: e.seq, kind: 'move', text: `  ${rs.map((r) => name(r.unit)).join(', ')} get beneath their hidden Wire in ${where} (no MF, no dr: ASLRB A12.33)` });
          break;
        }
        for (const r of rs)
          out.push({ seq: e.seq, kind: 'check', text: `  ⌇ ${name(r.unit)} Wire Exit dr in ${where}: ${r.dr}${r.outcome === 'beneath' ? `, beneath the Wire (${r.mf} ${p['phase'] === 'RtPh' ? 'rout ' : ''}MF)` : `, more than its ${r.mf} MF left: hung up on top for this ${p['phase']}`} (ASLRB ${p['phase'] === 'RtPh' ? 'B26.41' : 'B26.4'})` });
        break;
      }
      case 'asl.mines.attack': {
        const units = (p['units'] as string[]).map(name).join(', ');
        const way = p['way'] === 'exit' ? 'leaving' : p['by'] === 'rout' ? 'routing in' : p['by'] === 'advance' ? 'advancing in' : 'on entry';
        const factors = p['factors'] as number | undefined;
        out.push({ seq: e.seq, kind: 'fire', text: `  ✹ Minefield in ${hexLabel(p['hex'] as string)}${factors ? ` (${factors} A-P factors)` : ''} attacks ${units} ${way}: DR ${drText(p['dr'] as number[])}, ${resultText(p['result'] as IftResult)} — no DRM (ASLRB B28.41, B28.3)` });
        break;
      }
      case 'asl.mines.vehicle': {
        const v = name(p['vehicle'] as string);
        const where = hexLabel(p['hex'] as string);
        const k = p['kind'] as string;
        const eff = p['effect'] as string;
        const text =
          k === 'ap'
            ? `  ✹ Minefield in ${where}${p['factors'] ? ` (${p['factors']} A-P factors)` : ''} attacks ${v}: DR ${drText(p['dr'] as number[])}, ${eff === 'immobilized' ? 'a KIA: Immobilized' : 'no KIA: no effect on an AFV'} (ASLRB B28.42)`
            : k === 'atDr'
              ? `  ✹ A-T mine dr for ${v} in ${where}: ${(p['dr'] as number[])[0]}${eff === 'attack' ? ` ≤ ${p['factors']} A-T factors: an attack` : ': no attack'} (ASLRB B28.51)`
              : `  ✹ A-T mine attack on ${v}: DR ${drText(p['dr'] as number[])}${p['drm'] ? ` +${p['drm']} Aerial AF` : ''} on the 36+ column: ${eff === 'immobilized' ? 'Immobilized' : eff === 'burningWreck' ? 'a Burning Wreck' : 'eliminated'} (ASLRB B28.52)`;
        out.push({ seq: e.seq, kind: 'fire', text });
        break;
      }
      case 'asl.mines.clearEntry':
        out.push({ seq: e.seq, kind: 'move', text: `  🧹 ${(p['units'] as string[]).map(name).join(', ')} enter the minefield in ${hexLabel(p['hex'] as string)} with all their MF to clear it: no attack, a partial Trail Break, TI (ASLRB B24.74)` });
        break;
      case 'asl.mines.routEnded':
        out.push({ seq: e.seq, kind: 'move', text: `  ${name(p['unit'] as string)}, Reduced by the minefield, ends its rout there (ASLRB B28.413)` });
        break;
      case 'asl.mines.removal': {
        const rs = p['removals'] as { hex: string; units: string[] }[];
        for (const x of rs) out.push({ seq: e.seq, kind: 'move', text: `  ${x.units.map(name).join(', ')} spend 1 MF to remove the A-T mines in ${hexLabel(x.hex)}: gone at the end of the MPh unless pinned or broken (ASLRB B28.53)` });
        break;
      }
      case 'asl.boobyTrap': {
        const victims = (p['victims'] as string[]).map(name).join(', ');
        out.push({ seq: e.seq, kind: 'fire', text: `  ☠ Booby Trap (Level ${p['level']}): ${name(p['unit'] as string)}'s Original ${p['tc']} DR ${p['dr']} — Casualty Reduction to ${victims || 'nobody (no Personnel there)'} (ASLRB B28.9)` });
        break;
      }
      case 'asl.boobyTrap.ptc':
        out.push({ seq: e.seq, kind: 'check', text: `  ${name(p['unit'] as string)} takes the PTC for Booby Traps only: DR ${p['dr']} (ASLRB B28.9)` });
        break;
      case 'asl.pb.eliminated': {
        out.push({ seq: e.seq, kind: 'info', text: `  ✸ Pillbox in ${hexLabel(p['hex'] as string)} eliminated, with all its contents: ${String(p['reason'] ?? '')}` });
        break;
      }
      case 'asl.fort.removed': {
        const reason = String(p['reason'] ?? '');
        out.push({ seq: e.seq, kind: 'info', text: `  ▣ ${p['kind'] === 'mines' ? (/Dummy/.test(reason) ? 'Dummy minefield' : 'minefield') : String(p['kind'])} in ${hexLabel(p['hex'] as string)} removed: ${reason}` });
        break;
      }
      case 'asl.clearance.declared': {
        const t = p['task'] as { kind: string; loc: string; units: string[]; director?: string };
        out.push({ seq: e.seq, kind: 'info', text: `  🧹 ${t.units.map(name).join(', ')}${t.director ? ` (directed by ${name(t.director)})` : ''} ${p['joined'] ? 'join the work on' : 'start clearing'} the ${CLEAR_NAME[t.kind] ?? t.kind} in ${hexLabel(hexOfLoc(t.loc))}: TI, DR at the end of the CCPh${t.kind === 'roadblock' || t.kind === 'rubble' ? ', Hazardous Movement' : ''} (ASLRB ${CLEAR_RULE[t.kind] ?? ''})` });
        break;
      }
      case 'asl.clearance.dr': {
        const t = p['task'] as { kind: string; loc: string };
        const what = `the ${CLEAR_NAME[t.kind] ?? t.kind} in ${hexLabel(hexOfLoc(t.loc))}`;
        if (p['abandoned']) {
          out.push({ seq: e.seq, kind: 'info', text: `  🧹 no Clearance DR for ${what}: no MMC still at it (ASLRB B24.7)` });
          break;
        }
        const drm = p['drm'] as number;
        const ex = ((p['explain'] as string[] | undefined) ?? []).join(', ');
        out.push({ seq: e.seq, kind: 'check', text: `  🧹 Clearance DR for ${what}: ${drText(p['dr'] as number[])}${drm ? ` ${drm > 0 ? '+' : ''}${drm}` : ''}${ex ? ` (${ex})` : ''} ≤ 2? ${p['success'] ? (t.kind === 'rubble' || t.kind === 'mines' ? 'yes: a Trail Break' : 'yes: removed') : `no${p['labor'] !== undefined ? `; Labor ${p['labor']}` : ''}`}${p['casualty'] ? '; an Original 12: Casualty Reduction to the clearers' : ''} (ASLRB ${CLEAR_RULE[t.kind] ?? ''}, B24.8)` });
        break;
      }
      case 'asl.tb': {
        const tbs = p['tbs'] as [number, number][];
        const mined = !!minefieldAt(env, p['hex'] as string) || !rubbleAt(env, p['hex'] as string);
        out.push({
          seq: e.seq,
          kind: 'info',
          text: p['cleared']
            ? `  🧹 every hexside of ${hexLabel(p['hex'] as string)} is crossed by a Trail Break: the rubble and the TB are removed (ASLRB B24.71)`
            : mined
              ? tbs.length
                ? `  🧹 a Trail Break through the minefield in ${hexLabel(p['hex'] as string)}: entry across its hexsides at twice the MF/MP free of attack, out across them free (ASLRB B28.61)`
                : `  the Trail Breaks in ${hexLabel(p['hex'] as string)} are gone (ASLRB B24.74, B13.4211)`
              : tbs.length
                ? `  🧹 a Trail Break through the rubble in ${hexLabel(p['hex'] as string)}: entry across its hexsides at the pre-rubble cost (ASLRB B24.71)`
                : `  the Trail Breaks in ${hexLabel(p['hex'] as string)} are gone under falling rubble (ASLRB B24.121)`,
        });
        break;
      }
      case 'asl.roadblock.he': {
        const where = `${hexLabel(p['a'] as string)}–${hexLabel(p['b'] as string)}`;
        const th = p['indirect'] ? 'the hit' : `To Hit vs the roadblock: Final ${p['final']} vs ${p['th']}`;
        out.push({ seq: e.seq, kind: 'check', text: `  ▥ roadblock ${where}: ${th}${p['hit'] ? `, IFT DR ${p['dr']}${p['indirect'] ? ' +2' : ''}: ${p['kia'] ? 'KIA, removed' : 'no KIA'}` : ', missed'} (ASLRB B29.5)` });
        break;
      }
      case 'asl.wire.drop':
        out.push({ seq: e.seq, kind: 'info', text: `  ${name(p['unit'] as string)} leaves ${(p['sw'] as string[]).map(name).join(', ')} on top of the Wire to get beneath it (ASLRB B26.4)` });
        break;
      case 'asl.fort.grown':
        out.push({ seq: e.seq, kind: 'info', text: `  ▣ the foxhole grows to ${p['capacity']}S (ASLRB B27.12)` });
        break;
      case 'asl.fire.ntc':
        out.push({ seq: e.seq, kind: 'check', text: `  ${name(p['unit'] as string)} Kindling NTC: DR ${drText(p['dr'] as number[])} vs ${p['target']}: ${p['passed'] ? 'passed' : 'failed, no attempt'} (ASLRB B25.11)` });
        break;
      case 'asl.fire.kindle': {
        const ex = (p['explain'] as string[]).join(', ');
        out.push({ seq: e.seq, kind: 'fire', text: `  🔥 ${name(p['unit'] as string)}${p['director'] ? ` (directed by ${name(p['director'] as string)})` : ''} tries to Kindle ${hexLabel(hexOfLoc(p['loc'] as string))}: DR ${drText(p['dr'] as number[])}${(p['drm'] as number) ? ` ${(p['drm'] as number) > 0 ? '+' : ''}${p['drm']}` : ''}${ex ? ` (${ex})` : ''} vs Kindle # ${p['needed']}: ${p['flame'] ? 'a Flame' : 'no fire'}` });
        break;
      }
      case 'asl.fire.attackFlame': {
        const ex = (p['explain'] as string[]).join(', ');
        out.push({ seq: e.seq, kind: 'fire', text: `  🔥 ${String(p['source']).toUpperCase()} fire in ${hexLabel(hexOfLoc(p['loc'] as string))}: Flame DR ${drText(p['dr'] as number[])}${(p['drm'] as number) ? ` ${(p['drm'] as number) > 0 ? '+' : ''}${p['drm']}` : ''}${ex ? ` (${ex})` : ''} vs Kindle # ${p['needed']}: ${p['flame'] ? 'a Flame' : 'no fire'} (ASLRB B25.12, B25.13)` });
        break;
      }
      case 'asl.fire.flame': {
        const src = p['source'] as string;
        const from = p['from'] as string | undefined;
        if (src === 'spread' || src === 'gust' || src === 'heavy' || src === 'kindle' || src === 'ft' || src === 'he' || src === 'dc') break;
        out.push({ seq: e.seq, kind: 'info', text: `  🔥 A Flame in ${locText(p['loc'] as string)}${from ? ` from ${locText(from)}` : ''}${src === 'ssr' ? ' (scenario)' : ''}` });
        break;
      }
      case 'asl.fire.blaze':
        out.push({ seq: e.seq, kind: 'info', text: `  🔥 BLAZE in ${locText(p['loc'] as string)}${p['source'] === 'rubble' ? ': burning rubble' : p['source'] === 'ssr' ? ' (scenario)' : ''} — no entry; its units must leave by the end of the next RtPh; +3 smoke (ASLRB B25.2, B25.4)` });
        break;
      case 'asl.fire.drift':
        out.push({ seq: e.seq, kind: 'info', text: `  💨 Smoke drifts downwind from the Blaze in ${locText(p['source'] as string)}: Dispersed Smoke (+2) in ${(p['hexes'] as string[]).map((h) => hexLabel(h)).join(', ')} (ASLRB A24.61)` });
        break;
      case 'asl.fire.flameGone': {
        const why = p['reason'] as string;
        out.push({ seq: e.seq, kind: 'info', text: `  The Flame in ${locText(p['loc'] as string)} ${why === 'extinguished' ? 'is put out' : why === 'rubble' ? 'is smothered by the rubble' : 'goes out'}` });
        break;
      }
      case 'asl.fire.blazeCheck': {
        const o = p['outcome'] as string;
        const ex = (p['explain'] as string[]).join(', ');
        out.push({ seq: e.seq, kind: 'fire', text: `  🔥 Blaze DR for the Flame in ${locText(p['loc'] as string)}: ${drText(p['dr'] as number[])}${(p['drm'] as number) ? ` ${(p['drm'] as number) > 0 ? '+' : ''}${p['drm']}` : ''}${ex ? ` (${ex})` : ''} vs Spread # ${p['needed']}: ${o === 'blaze' ? 'a Blaze' : o === 'out' ? 'the Flame goes out' : 'still a Flame'} (ASLRB B25.151)` });
        break;
      }
      case 'asl.fire.spread': {
        const from = locText(p['from'] as string);
        const to = locText(p['to'] as string);
        if (p['auto']) {
          out.push({ seq: e.seq, kind: 'fire', text: `  🔥 ${p['auto'] === 'gust' ? `Gusts: the Blaze in ${from} spreads${p['far'] ? ' two hexes' : ''} downwind` : `Heavy Winds: the Blaze in ${from} spreads downwind`} to ${to}: a Flame (ASLRB ${p['auto'] === 'gust' ? 'B25.651' : 'B25.63'})` });
          break;
        }
        const ex = ((p['explain'] as string[] | undefined) ?? []).join(', ');
        out.push({ seq: e.seq, kind: 'fire', text: `  🔥 Spreading Fire from ${from} to ${to}: DR ${drText(p['dr'] as number[])}${(p['drm'] as number) ? ` ${(p['drm'] as number) > 0 ? '+' : ''}${p['drm']}` : ''}${ex ? ` (${ex})` : ''} vs Spread # ${p['needed']}: ${p['flame'] ? 'a Flame' : 'no spread'} (ASLRB B25.6)` });
        break;
      }
      case 'asl.fire.gustSelect':
        out.push({ seq: e.seq, kind: 'info', text: `  Gusts: Random Selection among ${(p['candidates'] as string[]).map((l) => hexLabel(hexOfLoc(l))).join(', ')}: ${(p['chosen'] as string[]).map((l) => hexLabel(hexOfLoc(l))).join(', ')} spread${(p['chosen'] as string[]).length === 1 ? 's' : ''} two hexes (ASLRB B25.651)` });
        break;
      case 'asl.fire.eliminated':
        out.push({ seq: e.seq, kind: 'info', text: `  ☠ ${(p['units'] as string[]).map(name).join(', ')} eliminated in the Blaze in ${locText(p['loc'] as string)} (ASLRB B25.4)` });
        break;
      case 'asl.fire.escape': {
        const c = p['choice'] as string;
        out.push({ seq: e.seq, kind: 'move', text: `  ${name(p['unit'] as string)} ${c === 'break' ? 'breaks voluntarily to rout out of the Blaze' : c === 'move' ? `moves out of the Blaze to ${hexLabel(hexOfLoc(p['to'] as string))}${p['interdicted'] ? ', subject to Interdiction' : ''}` : 'stays in the Blaze'} (ASLRB B25.4)` });
        break;
      }
      case 'asl.fire.extinguish': {
        const o = p['outcome'] as string;
        const ex = (p['explain'] as string[]).join(', ');
        const who = [...(p['units'] as string[]), ...(p['director'] ? [p['director'] as string] : [])].map(name).join(', ');
        out.push({ seq: e.seq, kind: 'check', text: `  🧯 ${who} fight the Flame in ${locText(p['loc'] as string)} (TI): Clearance DR ${drText(p['dr'] as number[])}${(p['drm'] as number) ? ` ${(p['drm'] as number) > 0 ? '+' : ''}${p['drm']}` : ''}${ex ? ` (${ex})` : ''}: ${o === 'extinguished' ? 'the Flame is out' : o === 'hampered' ? 'Hampered: no Blaze this Player Turn' : `no effect${p['labor'] !== undefined ? `; Labor ${p['labor']} next time` : ''}`} (ASLRB B24.72)` });
        break;
      }
      case 'asl.rubble.check':
        out.push({ seq: e.seq, kind: 'fire', text: `  ▦ Rubble dr for ${locText(p['loc'] as string)}: ${p['dr']}${(p['drm'] as number) ? ` +${p['drm']} stone` : ''} vs the ${p['kia']}KIA: ${p['rubbled'] ? 'the building collapses' : 'it stands'} (ASLRB B24.11)` });
        break;
      case 'asl.rubble.whole':
        out.push({ seq: e.seq, kind: 'fire', text: `  ▦ Whole-hex collapse dr for ${hexLabel(p['hex'] as string)}: ${p['dr']}${(p['drm'] as number) ? ` +${p['drm']}` : ''}: ${p['rubbled'] ? 'the whole hex comes down' : 'the lower levels stand'} (ASLRB B24.11)` });
        break;
      case 'asl.rubble': {
        const by = p['by'] as string;
        out.push({ seq: e.seq, kind: 'info', text: `  ▦ ${hexLabel(p['hex'] as string)}${(p['from'] as number) ? ` from level ${p['from']} up` : ''} is ${p['kind']} rubble${p['burning'] ? ', burning' : ''}${by === 'collapse' ? ' (the burning building collapsed, ASLRB B25.66)' : by === 'falling' ? ' (falling rubble, ASLRB B24.121)' : by === 'ssr' ? ' (scenario)' : ' (ASLRB B24.11)'}` });
        break;
      }
      case 'asl.rubble.falling': {
        const dr = p['dr'] as number[];
        out.push({ seq: e.seq, kind: 'fire', text: `  ▦ Falling rubble DR from ${hexLabel(p['hex'] as string)}: colored ${dr[1]}${(p['drm'] as number) ? ` +${p['drm']}` : ''}, white ${dr[0]}: ${p['falls'] ? `it falls across the ${HEXSIDE_NAME[p['hexside'] as number]} hexside${p['to'] ? ` into ${hexLabel(p['to'] as string)}` : ' off the map'}` : 'it stays'} (ASLRB B24.12)` });
        break;
      }
      case 'asl.rubble.eliminated':
        out.push({ seq: e.seq, kind: 'info', text: `  ☠ ${[...(p['units'] as string[]), ...(p['weapons'] as string[])].map(name).join(', ')} ${p['falling'] ? 'crushed by the falling rubble' : 'buried in the rubble'} of ${hexLabel(p['hex'] as string)} (ASLRB B24.11, B24.121)` });
        break;
      case 'asl.rubble.collapse':
        out.push({ seq: e.seq, kind: 'info', text: `  ▦ Collapse: ${(p['chosen'] as string[]).map(locText).join(', ')} (Random Selection among ${(p['candidates'] as string[]).map(locText).join(', ')}) (ASLRB B25.66)` });
        break;
      case 'ssr.variableReinforcements': {
        // The reinforcement dr: what it was for, what it rolled and what it brought.
        const v = p as unknown as VariableReinforcementsEvent;
        const d = counters[v.def];
        const what = d ? defLabel(d) : v.def;
        out.push({
          seq: e.seq,
          kind: 'info',
          text: `${v.rule}: ${sideNameOf(env, v.side)} reinforcement dr ${v.dr} → ${v.count}× ${what} enter this turn`,
          detail: `Chart for Turn ${v.turn}: ${chartLabel(v.table)}`,
        });
        break;
      }
      case 'ssr.entryOrderDr': {
        // The order-of-entry dr (SSR): the turn it gives each group.
        const v = p as unknown as EntryOrderDrEvent;
        const forces = statics(env).scenario.forces;
        const turns = Object.entries(v.turns)
          .map(([f, t]) => `${forces.find((x) => x.id === f)?.group ?? f} enters on Turn ${t}`)
          .join('; ');
        const params = entryOrderDrParams(env);
        out.push({ seq: e.seq, kind: 'info', text: `${v.rule}: ${sideNameOf(env, v.side)} order of entry dr ${v.dr} → ${turns}`, ...(params ? { detail: entryOrderLabel(env, params) } : {}) });
        break;
      }
      case 'ssr.entryLosses': {
        // Losses before entry (SSR): the dr and the counters it replaced.
        const v = p as unknown as EntryLossesEvent;
        const group = statics(env).scenario.forces.find((x) => x.id === v.force)?.group ?? v.force;
        const from = counters[v.from] ? defLabel(counters[v.from]!) : v.from;
        const to = counters[v.to] ? defLabel(counters[v.to]!) : v.to;
        out.push({ seq: e.seq, kind: 'info', text: `${v.rule}: ${group} losses dr ${v.dr} → ${v.count}× ${from} become${v.count === 1 ? 's' : ''} ${to}` });
        break;
      }
      case 'ssr.forceChart': {
        // The order-of-battle roll: what it was, what it brought, and the VP it sets.
        const v = p as unknown as ForceChartEvent;
        const got = Object.entries(v.counts)
          .map(([def, n]) => `${n}× ${counters[def] ? defLabel(counters[def]!) : def}`)
          .join(', ');
        out.push({
          seq: e.seq,
          kind: 'info',
          text: `${v.rule}: ${sideNameOf(env, v.side)} ${v.chart} dr ${v.dr} → ${got}${v.vp !== null ? `; ${v.vp} VP to win` : ''}`,
        });
        break;
      }
      case 'ssr.scatter': {
        // The plan (SSR 1): the first group's rendezvous hex is open, the later groups' secret until they land.
        const st = p['state'] as ScatterState;
        const sp = scatterParams(env);
        if (st.rolled.length || !sp) break;
        const open = sp.groups.map((g, gi) => (g.later ? `${g.label} secretly` : `${g.label} at ${hexLabel(st.rendezvous[gi]!)}`)).join('; ');
        const stacks = st.groups.map((g, gi) => `${sp.groups[gi]!.label} ${g.length} stack${g.length === 1 ? '' : 's'}`).join(', ');
        out.push({ seq: e.seq, kind: 'info', text: `${sp.rule ?? 'SSR'}: ${sideNameOf(env, st.side)} rendezvous hexes picked: ${open} (${stacks})` });
        break;
      }
      case 'ssr.scatter.landed': {
        const l = p as unknown as ScatterLanding;
        const DIR = ['north', 'northeast', 'southeast', 'south', 'southwest', 'northwest'];
        const who = l.stack.map((id) => name(id)).join(', ');
        out.push({
          seq: e.seq,
          kind: 'info',
          text: `${l.rule}: ${l.label} stack (${who}) — colored ${l.dice[1]} (${DIR[l.direction - 1]}), white ${l.dice[0]} → ${hexLabel(l.to)}${l.offMap ? ' (off the map: on the nearest edge hex, pinned and CX)' : ''}`,
        });
        break;
      }
      case 'ssr.length.recorded': {
        // Secret (S36 SSR 1): the choosing side reads its own choice; everyone else only that it was made.
        const lp = secretLengthParams(env);
        const opt = lp?.options[p['option'] as number];
        out.push({ seq: e.seq, kind: 'info', text: viewer === p['side'] && opt ? `${lp?.rule ?? 'SSR'}: ${sideNameOf(env, p['side'] as string)} game length (secret): ${opt.label} turns` : `${lp?.rule ?? 'SSR'}: ${sideNameOf(env, p['side'] as string)} secretly recorded the game length` });
        break;
      }
      case 'ssr.entryStretch': {
        const sp = entryStretchParams(env);
        const opt = sp?.options[p['option'] as number];
        // A force the card gives no name (S68's "Enter on Turn 3 ...") is the side's reinforcements.
        const forces = statics(env).scenario.forces.filter((f) => !!f.id && !!sp?.forces.includes(f.id)).map((f) => f.group ?? 'the reinforcements');
        const span = (opt?.hexes.length ?? 0) > 1 ? ` (${hexLabel(opt!.hexes[0]!)}–${hexLabel(opt!.hexes[opt!.hexes.length - 1]!)})` : '';
        out.push({ seq: e.seq, kind: 'info', text: `${sideNameOf(env, p['side'] as string)} entry ${span ? 'stretch' : 'hex'}: ${forces.join(', ')} enter ${p['label']}${span}` });
        break;
      }
      case 'ssr.length.revealed': {
        const lp = secretLengthParams(env);
        const opt = lp?.options[p['option'] as number];
        const removed = (p['removed'] as string[]).map((id) => name(id));
        out.push({
          seq: e.seq,
          kind: 'info',
          text: `${lp?.rule ?? 'SSR'}: the game is ${opt?.label ?? '?'} turns long — boards in play: ${opt?.boards ?? '?'}${removed.length ? ` · removed from the ${sideNameOf(env, p['side'] as string)} OB: ${removed.join(', ')}` : ''}`,
        });
        break;
      }
      case 'ssr.reinforcementTable': {
        const units = (p['units'] as { def: string; count: number }[]).map((u) => `${u.count > 1 ? `${u.count} × ` : ''}${statics(env).counters[u.def] ? defLabel(statics(env).counters[u.def]!) : u.def}`);
        out.push({ seq: e.seq, kind: 'info', text: `${p['rule']}: ${sideNameOf(env, p['side'] as string)} Reinforcement Table dr ${p['dr']} → ${units.join(', ') || 'nothing'}` });
        break;
      }
      case 'ssr.entryGroups': {
        // Secret (SSR 2): the choosing side reads its own picks online; everyone else only that they were made.
        const st = p['state'] as EntryGroupsState;
        const ep = entryGroupsParams(env);
        if (viewer === st.side) {
          const forces = statics(env).scenario.forces;
          const picks = st.picks.map((x) => `${forces.find((f) => f.id === x.force)?.group?.replace(/^.*: /, '') ?? x.force} on Turn ${x.turn} at ${hexLabel(x.hex)}`).join('; ');
          out.push({ seq: e.seq, kind: 'info', text: `${ep?.rule ?? 'SSR'}: ${sideNameOf(env, st.side)} entry groups (secret): ${picks}` });
        } else out.push({ seq: e.seq, kind: 'info', text: `${ep?.rule ?? 'SSR'}: ${sideNameOf(env, st.side)} secretly picked their entry groups, turns and hexes` });
        break;
      }
      case 'ssr.leaderPtc': {
        const v = p as unknown as LeaderPtcEvent;
        out.push({ seq: e.seq, kind: 'check', text: `${v.rule}: 1PTC ${name(v.unit)}: DR ${drText(v.dr)} ${v.drm >= 0 ? '+' : ''}${v.drm} → ${v.final} vs ${v.morale} — ${v.pinned ? 'pinned for this Player Turn' : 'passed'}` });
        break;
      }
      case 'ssr.sw.assembled':
        out.push({ seq: e.seq, kind: 'info', text: `${p['rule']}: ${name(p['by'] as string)} assembles the ${name(p['sw'] as string)}` });
        break;
      case 'ssr.onceDr': {
        // A card's once-per-game dr (S64 SSR 2, 3).
        const v = p as unknown as OnceDrEvent;
        // The halted leader by name and hex, unless he is hidden from the reader (then only the card's own words).
        const who = v.leader && !hiddenFrom(v.leader) ? `${name(v.leader)}${v.hex ? ` in ${hexLabel(v.hex)}` : ''}` : 'the leader';
        const what =
          v.effect === 'nmcConcealment'
            ? 'each Good Order MMC not stacked with a Good Order leader takes a NMC'
            : `${who} and every unit stacked with him are halted for Game Turn ${v.turn}: no action but routing or Close Combat`;
        out.push({ seq: e.seq, kind: 'info', text: `${v.rule}: dr ${v.dr} (needs < ${v.turn}) — ${v.success ? what : 'no effect; the dr is spent'}` });
        break;
      }
      case 'ssr.onceDr.nmc': {
        const v = p as unknown as OnceDrNmcEvent;
        if (hiddenFrom(v.unit)) break;
        out.push({
          seq: e.seq,
          kind: 'check',
          text: `  NMC ${name(v.unit)}: DR ${dr2(v.dr, v.unit)} → ${v.final} vs ${v.morale} — ${v.failed ? (v.concealmentLost ? 'failed: loses its concealment' : 'failed (no effect)') : 'passed'}`,
          detail: v.rule,
        });
        break;
      }
      case 'ssr.onceDr.rallied': {
        const v = p as unknown as OnceDrRallyEvent;
        out.push({ seq: e.seq, kind: 'info', text: `  ${v.rule}: ${v.units.map(name).join(', ')} rall${v.units.length === 1 ? 'ies' : 'y'} automatically beside ${name(v.leader)}` });
        break;
      }
      case 'ssr.leaderRelief': {
        // A named leader relieved of command (LMA5 SSR 4): pinned for good, and who replaces him when.
        const v = p as unknown as LeaderReliefEvent;
        out.push({
          seq: e.seq,
          kind: 'info',
          text: `${v.rule}: ${v.name} (${name(v.unit)}) ${v.why === 'check' ? 'failed his Morale Check' : 'failed a MC'} and is relieved: Pinned for the rest of the game; ${v.replacement.name} enters on Turn ${v.replacement.turn}`,
        });
        break;
      }
      case 'ssr.entryAfterFire': {
        // The first fire attack of the named side sets the reinforcements' turn (SSR).
        const r = p as { force: string; side: string; turn: number; firedOn: number; firer: string };
        const ap = entryAfterFireParams(env);
        const force = statics(env).scenario.forces.find((f) => f.id === r.force);
        const edge = force?.setup.kind === 'enter' ? (({ N: 'north', E: 'east', S: 'south', W: 'west' }) as Record<string, string>)[force.setup.edge] ?? force.setup.edge : null;
        const firer = ap ? sideNameOf(env, ap.firedBy) : 'their';
        out.push({
          seq: e.seq,
          kind: 'info',
          text: `${ap?.rule ?? 'SSR'}: first ${firer} fire attack (Turn ${r.firedOn}): the ${sideNameOf(env, r.side)} ${force?.group ?? 'reinforcements'} enter on Turn ${r.turn}${edge ? ` along the ${edge} edge` : ''}`,
        });
        break;
      }
      case 'sk1.appeared': {
        // A reinforcement set up on the map hexes its card names, as its side's RPh begins (ASLRB A2.51).
        const r = p as { side: string; units: string[]; hexes: string[] };
        const who = r.units.map((u) => (env.state.pieces[u] ? pieceLabel(env, env.state.pieces[u]!) : u)).join(', ');
        out.push({ seq: e.seq, kind: 'info', text: `${sideNameOf(env, r.side)} reinforcement appears: ${who} in ${r.hexes.map((h) => h.replace(/^[a-z]+(?=[A-Z])/, '')).join(', ')}` });
        break;
      }
      case 'sk1.appearDelayed': {
        // None of its hexes could take it (enemy-held, or full): it comes a Game Turn later (ASLRB A2.5).
        const r = p as { side: string; units: string[]; turn: number };
        out.push({ seq: e.seq, kind: 'info', text: `${sideNameOf(env, r.side)} reinforcement${r.units.length === 1 ? '' : 's'} cannot appear: no hex for ${r.units.length === 1 ? 'it' : 'them'} to set up in; due on Turn ${r.turn}` });
        break;
      }
      case 'sk1.reserve': {
        const r = p as { side: string; pieces: string[]; turn: number; edges: string[]; label: string | null };
        const edges = r.edges.map((e) => ({ N: 'north', E: 'east', S: 'south', W: 'west' })[e] ?? e).join(' or ');
        out.push({ seq: e.seq, kind: 'info', text: `${sideNameOf(env, r.side)} kept ${r.pieces.length} unit${r.pieces.length === 1 ? '' : 's'} back${r.label ? ` (${r.label})` : ''}: they enter on Turn ${r.turn} along the ${edges} edge` });
        break;
      }
      case 'weather.dr': {
        const sky = SKY_NAME[p['sky'] as keyof typeof SKY_NAME] ?? String(p['sky']);
        const change = p['change'] as 'begins' | 'ends' | null;
        out.push({ seq: e.seq, kind: 'info', text: `Weather DR ${dr2(p['dr'], 'Weather DR')}: ${change === 'begins' ? `${sky} begins` : change === 'ends' ? `${sky} ends` : 'no change'}` });
        break;
      }
      case 'weather.changed': {
        if (p['reason'] === 'start') break;
        out.push({ seq: e.seq, kind: 'info', text: `  ☁ Weather now: ${weatherLabel(p['weather'] as Weather)}` });
        break;
      }
      case 'asl.fort.placed': {
        // The owner's log names each counter; the other side's shows what it may see (its redacted event) and the count.
        const side = p['side'] as string;
        const counters = p['counters'] as { hex: string; hidden: boolean; kind: string; capacity?: number; pillbox?: unknown; mines?: { known?: true; dummy?: true } }[];
        // One open foxhole on its own is one dug in play (ASLRB B27.11), not a setup placement.
        if (counters.length === 1 && counters[0]!.kind === 'foxhole' && !counters[0]!.hidden) {
          out.push({ seq: e.seq, kind: 'info', text: `  ▣ ${sideNameOf(env, side)} dig a foxhole 1S in ${hexLabel(counters[0]!.hex)} (ASLRB B27.11)` });
          break;
        }
        // Anyone else reads only what the board shows them (a hotseat log sees the unredacted event): no hidden counter's
        // hex, no Known minefield's strength, no Dummy (B28.45, B28.47: both are a blank Minefield counter to the enemy).
        const shown = counters.map((c) => shownCounter(c as FortRecord, viewer)).filter((c): c is FortRecord => !!c);
        const named = shown.map((c) => `${fortKindName(c)} ${hexLabel(c.hex)}${c.hidden ? (c.kind === 'mines' ? ' (recorded)' : ' (hidden)') : ''}`);
        const secret = counters.length - shown.length;
        out.push({ seq: e.seq, kind: 'info', text: viewer === side ? `${sideNameOf(env, side)} placed: ${named.join(', ')} (SSR)` : `${sideNameOf(env, side)} placed ${counters.length} fortification counter${counters.length === 1 ? '' : 's'} (SSR)${named.length ? `: ${named.join(', ')}` : ''}${secret ? `${named.length ? ';' : ':'} ${secret} hidden or recorded` : ''}` });
        break;
      }
      case 'asl.fort.revealed': {
        const c = shownCounter(p['counter'] as FortRecord, viewer) ?? (p['counter'] as FortRecord);
        // Full ASL: an attack (or SMOKE) from within a pillbox makes its contents Known (ASLRB B30.7).
        if (c.kind === 'pillbox' && c.known && (p['reason'] === 'attack' || p['reason'] === 'smoke')) {
          out.push({ seq: e.seq, kind: 'info', text: `  ▣ Pillbox in ${hexLabel(c.hex)}: ${p['reason'] === 'smoke' ? 'SMOKE placed' : 'an attack made'} from within makes its contents Known to the enemy within 16 hexes with a LOS to it (ASLRB B30.7)` });
          break;
        }
        const how = { los: 'a Good Order enemy unit in LOS', tem: 'its TEM being claimed', concealment: 'a unit in it losing concealment', entry: 'a unit entering it', attempt: 'an enemy move it bars', attack: 'its attack', search: 'a Search', grown: 'a new foxhole dug there replacing its counter (ASLRB B27.12)', rout: 'a routing unit going beneath it, out of reach of Interdiction (ASLRB B27.41)', strength: (p['counter'] as FortRecord).hidden ? 'a minefield attack whose result had to be verified: its strength is shown (ASLRB B28.41)' : 'its strength being shown (ASLRB B28.41, B28.53)', mineAttack: 'its attack on a unit entering or leaving: a Known Minefield counter, strength down (ASLRB B28.1, B28.48)', dummyFound: 'a unit entering it: an unmined hex of the belt, marked with a Dummy (ASLRB B28.47)' }[p['reason'] as string] ?? String(p['reason']);
        out.push({ seq: e.seq, kind: 'info', text: `  ▣ ${fortKindName(c)} in ${hexLabel(c.hex)} revealed by ${how} (ASLRB A12.33)` });
        break;
      }
      case 'asl.fort.dummies': {
        // A Secret dr (B28.47): its owner alone reads it.
        if (viewer !== p['side']) break;
        const extra = p['extra'] as number;
        out.push({ seq: e.seq, kind: 'info', text: `${sideNameOf(env, p['side'] as string)}: Dummy Minefield Secret dr ${p['dr']} — ${extra ? `${extra} more Dummy counter${extra === 1 ? '' : 's'}` : 'none extra'} (ASLRB B28.47)` });
        break;
      }
      case 'sk1.fortified.revealed': {
        const loc = p['loc'] as string | undefined;
        const what = loc ? `${hexLabel(hexOfLoc(loc))}${levelOfLoc(loc) ? ` level ${levelOfLoc(loc)}` : ''} is a Fortified Building Location` : `Building ${hexLabel(p['hex'] as string)} is fortified`;
        const how = p['reason'] === 'fire' ? 'fire on' : p['reason'] === 'attempt' ? 'a unit trying to enter' : 'a unit entering';
        out.push({ seq: e.seq, kind: 'info', text: `  ▣ ${what} (+1 TEM): revealed by ${how} ${hexLabel(p['hex'] as string)}` });
        break;
      }
      case 'sk1.cc.state': {
        // The Ambush drs of a new CC with their drm (SK1 3.8: a final dr 3 or more lower than the other side's ambushes).
        const amb = p['ambush'] as { rolls: { side: string; dr: number; drm: number; final: number; notes: string[] }[]; ambusher: string | null } | undefined;
        const st = p['state'] as { hex?: string; declared?: Record<string, unknown[]> } | null;
        if (amb && st?.hex) {
          // Every part of the drm, even ones that cancel out (-1 Japanese, +1 ATTACKER in jungle).
          const roll = (r: (typeof amb.rolls)[number]) =>
            `${sideNameOf(env, r.side)} ${r.dr}${r.drm || r.notes.length ? ` (${r.notes.length ? r.notes.join(', ') : `${r.drm > 0 ? '+' : ''}${r.drm}`}) = ${r.final}` : ''}`;
          const outcome = amb.ambusher ? `${sideNameOf(env, amb.ambusher)} ambush` : 'no ambush';
          out.push({ seq: e.seq, kind: 'cc', text: `Ambush dr in ${hexLabel(st.hex)}: ${amb.rolls.map(roll).join(', ')} → ${outcome}` });
        }
        // A side declaring no attack in a CC hex leaves no roll behind: say so, or the other side's attack seems to come
        // out of turn (CC with a vehicle is one side at a time, SK4 3.8).
        if (!st?.hex || !st.declared) break;
        let prior: Record<string, unknown[]> = {};
        for (let j = i - 1; j >= 0; j--) {
          const f = events[j]!;
          if (f.type !== 'sk1.cc.state') continue;
          const ps = (f.payload as { state: { hex?: string; declared?: Record<string, unknown[]> } | null }).state;
          prior = ps?.hex === st.hex ? (ps.declared ?? {}) : {};
          break;
        }
        for (const [side, attacks] of Object.entries(st.declared)) {
          if (attacks.length === 0 && prior[side] === undefined) out.push({ seq: e.seq, kind: 'cc', text: `CC in ${st.hex} (${sideNameOf(env, side)}): no attack declared` });
        }
        break;
      }
      case 'sk1.cc.attack': {
        // The strengths behind the odds, unit by unit (a pinned unit's FP halved), where the rules recorded them.
        const fp = p['fp'] as { attack: [string, number][]; defense: [string, number][]; notes?: Record<string, string> } | undefined;
        const side = (xs: [string, number][], attacking: boolean) => {
          const total = xs.reduce((n, [, v]) => n + v, 0);
          // A strength that is not the printed FP says why (a pinned attacker's halved FP, SK1 3.2.3): as the attack
          // recorded it, the state then (a recording without notes is asked about the unit as it stands now).
          const why = (id: string) => (hiddenFrom(id) ? null : fp?.notes ? (fp.notes[id] ?? null) : env.state.pieces[id] ? env.query('cc.fpNote', { unit: id, attacking }, null) : null);
          const each = xs.map(([id, v]) => `${hiddenFrom(id) ? '?' : name(id)} ${v}${why(id) ? ` [${why(id)}]` : ''}`).join(' + ');
          return xs.length > 1 ? `${each} = ${total}` : each;
        };
        const strength = fp ? `${side(fp.attack, true)} vs ${side(fp.defense, false)} → ` : '';
        // A DRM for some targets only (ASLRB A4.8 EX: the -1 for TI defenders applies to the TI units alone).
        const per = Object.entries((p['targetDrm'] as Record<string, number> | undefined) ?? {});
        const perText = per.length ? ` (${per.map(([id, v]) => `${v > 0 ? '+' : ''}${v} vs ${hiddenFrom(id) ? '?' : name(id)}`).join(', ')})` : '';
        out.push({ seq: e.seq, kind: 'cc', text: `CC in ${p['hex']} (${sideNameOf(env, p['side'] as string)}): ${strength}${p['odds']}, DR ${dr2(p['dr'], `CC ${p['side']} in`)}${(p['drm'] as number) ? ` ${(p['drm'] as number) > 0 ? '+' : ''}${p['drm']}` : ''}${perText} vs kill ${p['kill']} — ${p['result']}` });
        break;
      }
      case 'dice.rolled': {
        const label = p['label'] as string;
        // Random Selection (ASLRB A.9): one dr per unit, highest selected, ties rolled again among the tied. The rules
        // record each dr alone, so the selection's rolls are read together here: one line, round by round, at its first.
        const sel = /^(.+): random selection \((.+)\)$/.exec(label);
        if (sel) {
          const prev = events[i - 1];
          const prevSel = prev?.type === 'dice.rolled' ? /^(.+): random selection \(/.exec((prev.payload as { label: string }).label) : null;
          if (prevSel?.[1] === sel[1]) break;
          const rolls: { id: string; v: number }[] = [];
          for (let j = i; j < events.length; j++) {
            const f = events[j]!;
            const m = f.type === 'dice.rolled' ? /^(.+): random selection \((.+)\)$/.exec((f.payload as { label: string }).label) : null;
            if (!m || m[1] !== sel[1]) break;
            rolls.push({ id: m[2]!, v: (f.payload as { dice: number[] }).dice[0]! });
          }
          if (rolls.some((r) => hiddenFrom(r.id))) break;
          // The first round is every candidate once (it ends where a unit rolls again). A round whose highest dr is
          // shared is followed by a re-roll of the tied units (or, under full ASL A.9, all of them are selected); a
          // clean pick by a round of the units left, if more are to be picked. The rolls may stop partway through a
          // round while the dice are still being revealed.
          let n = rolls.findIndex((r, j) => rolls.slice(0, j).some((x) => x.id === r.id));
          if (n < 0) n = rolls.length;
          const rounds: { round: { id: string; v: number }[]; reRoll: boolean }[] = [{ round: rolls.slice(0, n), reRoll: false }];
          let left = rounds[0]!.round.map((x) => x.id);
          const picked: string[] = [];
          for (;;) {
            const last = rounds[rounds.length - 1]!.round;
            const max = Math.max(...last.map((x) => x.v));
            const top = last.filter((x) => x.v === max).map((x) => x.id);
            const tie = top.length > 1;
            if (!tie) {
              picked.push(top[0]!);
              left = left.filter((id) => id !== top[0]);
            }
            if (n >= rolls.length) {
              if (tie) picked.push(...top);
              break;
            }
            const size = tie ? top.length : left.length;
            rounds.push({ round: rolls.slice(n, n + size), reRoll: tie });
            n += size;
            if (n > rolls.length) break;
          }
          const text = rounds.map(({ round, reRoll }, k) => `${reRoll ? 'tie, re-roll: ' : k > 0 ? 'next: ' : ''}${round.map((x) => `${name(x.id)} ${x.v}`).join(', ')}`).join(' · ');
          out.push({ seq: e.seq, kind: 'info', text: `  ${sel[1]}, Random Selection (highest dr): ${text}${picked.length ? ` → ${picked.map(name).join(', ')}` : ''}` });
          break;
        }
        // Interdiction (SK1 3.6): the rules record only the dice, so the outcome is read from what
        // followed (Casualty Reduction, elimination) or else from the roll against broken morale.
        const intd = /^Interdiction NMC for (.+)$/.exec(label);
        if (intd) {
          const id = intd[1]!;
          const dice = p['dice'] as number[];
          const total = dice.reduce((a, b) => a + b, 0);
          let outcome: string | null = null;
          for (let j = i + 1; j < events.length && !outcome; j++) {
            const f = events[j]!;
            const q = f.payload as Record<string, unknown>;
            if (f.type === 'dice.rolled' || (f.type === 'piece.moved' && q['id'] === id)) break;
            if (f.type === 'piece.eliminated' && q['id'] === id) outcome = 'eliminated';
            else if (f.type === 'sk1.casualtyReduced' && q['unit'] === id) outcome = 'Casualty Reduction';
          }
          const defId = defAfter[i]?.get(id) ?? env.state.pieces[id]?.defId;
          const d = defId ? (counters[defId] as { brokenMorale?: number } | undefined) : undefined;
          const morale = d?.brokenMorale;
          if (!outcome) outcome = total === 12 ? 'eliminated' : morale !== undefined && total === morale ? 'pinned: the rout ends here' : 'passed';
          let where: string | undefined;
          for (let j = i - 1; j >= 0 && !where; j--) {
            const f = events[j]!;
            if (f.type === 'piece.moved' && (f.payload as { id: string }).id === id) where = ((f.payload as { loc: { hex?: string } }).loc.hex ?? undefined);
          }
          out.push({
            seq: e.seq,
            kind: 'info',
            text: `  Interdiction: ${name(id)}${where ? ` entering ${hexLabel(where)}` : ''} — NMC, DR ${drText(dice)}${morale !== undefined ? ` vs broken morale ${morale}` : ''} → ${outcome}`,
          });
          break;
        }
        const entry = entryRoll(label, (p['dice'] as number[])[0]!);
        if (entry) {
          out.push({ seq: e.seq, kind: 'info', text: `${entry.force}: entry dr ${(p['dice'] as number[])[0]} (needs ${entry.need}) → ${entry.enters ? 'enters this turn' : 'does not enter this turn'}` });
          break;
        }
        // Leader Creation has its own line with the outcome.
        if (/Smoke|Recover|Repair|Ambush|wound/i.test(label)) {
          const dice = p['dice'] as number[];
          out.push({ seq: e.seq, kind: 'info', text: `  ${label}: ${dice.length === 2 ? `DR ${drText(dice)}` : `dr ${dice.join(', ')}`}` });
        }
        break;
      }
      case 'game.ended': {
        const r = p['result'] as { winner: string | null; reason: string };
        out.push({ seq: e.seq, kind: 'end', text: `Game over — ${r.winner ? `${sideNameOf(env, r.winner)} win` : 'draw'} (${r.reason})` });
        break;
      }
      // ---------------------------------------------------------------- SK2: Guns and ordnance
      case 'sk2.ordnance.shot': {
        const dr = p['dr'] as [number, number];
        const drm = p['drm'] as number;
        const outcome = p['outcome'] as string;
        const ammo = p['ammo'] as string | undefined;
        const notes = noteLabels(p['explain']).join(', ');
        out.push({
          seq: e.seq,
          kind: 'fire',
          text: `${p['intensive'] ? 'Intensive Fire: ' : ''}${name(p['weapon'] as string)} at ${hexLabel(p['target'] as string)} (${p['targetType']}${ammo && ammo !== 'HE' ? `, ${AMMO_LABEL[ammo] ?? ammo}` : ''}, range ${p['range']}): TH ${p['th']}${p['red'] ? ' (red)' : ''}, DR ${drText(dr)} ${drm >= 0 ? '+' : ''}${drm} → ${dr[0] + dr[1] + drm}: ${outcome === 'noAmmo' ? `no ${AMMO_LABEL[ammo ?? ''] ?? ammo}` : outcome === 'ch' ? 'CRITICAL HIT' : outcome === 'hit' ? 'HIT' : 'miss'}`,
          ...(notes ? { detail: `TH DRM: ${notes}` } : {}),
          title: `${name(p['weapon'] as string)} → ${hexLabel(p['target'] as string)} · ${p['intensive'] ? 'Intensive Fire' : 'To Hit'}`,
          rows: [
            { k: 'Target', v: `${p['targetType']}${ammo && ammo !== 'HE' ? `, ${AMMO_LABEL[ammo] ?? ammo}` : ''}, range ${p['range']}` },
            { k: 'To Hit', v: `TH ${p['th']}${p['red'] ? ' (red)' : ''}` },
            { k: 'Roll', v: `DR ${drText(dr)}` },
            { k: 'DRM', v: `${drm >= 0 ? '+' : ''}${drm}`, mods: notes ? noteLabels(p['explain']) : ['none'] },
            { k: 'Result', v: `final DR ${dr[0] + dr[1] + drm} vs TH ${p['th']}`, out: outcome === 'noAmmo' ? `no ${AMMO_LABEL[ammo ?? ''] ?? ammo}` : outcome === 'ch' ? 'CRITICAL HIT' : outcome === 'hit' ? 'HIT' : 'miss' },
          ],
          ...losOf((p['from'] as string | undefined) ?? hexOfNow(p['weapon'] as string), p['target'] as string),
        });
        break;
      }
      case 'sk2.ordnance.ammo': {
        // Depletion (SK4 6.2): the original TH DR against the Depletion Number.
        const what = AMMO_LABEL[p['ammo'] as string] ?? String(p['ammo']);
        const n = p['depletion'] as number;
        const RESULT: Record<string, string> = {
          kept: `the Gun has ${what} and may try for it again`,
          last: `the Gun has ${what} for this shot only and is now out of it`,
          never: `the Gun never had ${what} and has not fired`,
          malf: `the Gun malfunctions and is out of ${what}`,
        };
        out.push({ seq: e.seq, kind: 'fire', text: `  ${what} depletion ${n}, original DR ${dr2(p['dr'], 'To Hit')}: ${RESULT[p['result'] as string] ?? p['result']}` });
        break;
      }
      case 'sk2.smoke.placed':
        out.push({ seq: e.seq, kind: 'fire', text: `  ☁ ${p['dispersed'] ? 'Dispersed ' : ''}${p['kind'] === 'wp' ? 'WP' : 'Smoke'} placed in ${hexLabel(p['hex'] as string)} (+${p['kind'] === 'wp' ? (p['dispersed'] ? 1 : 2) : p['dispersed'] ? 2 : 3} Hindrance)` });
        break;
      case 'sk2.ordnance.wp': {
        const mod = p['mod'] as number;
        out.push({ seq: e.seq, kind: 'fire', text: `  WP hit: ${(p['units'] as string[]).map(name).join(', ')} take a NMC${mod ? ` (${mod > 0 ? '+' : ''}${mod}${p['airBurst'] ? ', Air Burst' : p['ch'] ? ', Critical Hit: TEM added' : ': TEM subtracted'})` : ''}` });
        break;
      }
      case 'sk2.ordnance.noLos':
        out.push({
          seq: e.seq,
          kind: 'fire',
          text: `${name(p['weapon'] as string)} at ${hexLabel(p['target'] as string)}${p['ammo'] ? ` (${p['ammo']})` : ''}: no LOS (${p['blockedBy']}) — ${p['noAmmo'] ? 'and no ammo: it has not fired' : `the Gun has fired for nothing${p['dr'] ? ` (TH DR ${drText(p['dr'] as number[])} for breakdown, depletion and ROF)` : ''}`}`,
          ...(() => {
            const l = losOf((p['from'] as string | undefined) ?? hexOfNow(p['weapon'] as string), p['target'] as string);
            return l.los ? { los: { ...l.los, blocked: true as const } } : {};
          })(),
        });
        break;
      case 'sk2.ordnance.rof': {
        const kept = p['kept'] as boolean;
        const why = p['why'] as string | null;
        const ROF_WHY: Record<string, string> = { intensive: 'Intensive Fire never retains ROF', malfunction: 'the Gun malfunctioned', pinned: 'a pinned crew\'s Gun cannot retain ROF', afph: 'no Rate of Fire in the Advancing Fire Phase', area: 'fire on the Area Target Type uses up all of a Gun\'s ROF (it may still Intensive Fire)' };
        // A Defensive First Fire hit leaves Residual FP, but not from a Weapon that uses Intensive Fire or
        // malfunctions (SK4 3.3.5): said here, since no counter appears.
        let shot: Record<string, unknown> | undefined;
        for (let j = i - 1; j >= 0 && !shot; j--) if (events[j]!.type === 'sk2.ordnance.shot' && (events[j]!.payload as { weapon: string }).weapon === p['weapon']) shot = events[j]!.payload as Record<string, unknown>;
        const noResidual = (why === 'intensive' || why === 'malfunction') && shot && ['first', 'subsequentFirst', 'fpf'].includes(shot['mode'] as string) && (shot['outcome'] === 'hit' || shot['outcome'] === 'ch');
        out.push({ seq: e.seq, kind: 'fire', text: `  ${name(p['weapon'] as string)} ${kept ? `keeps ROF (colored dr ${p['colored']} ≤ ${p['rof']}): it may fire again this phase` : `loses ROF${why === 'exceeded' ? `: colored dr ${p['colored']} > ${p['rof']}` : why ? `: ${ROF_WHY[why] ?? why}` : ''}`}${noResidual ? `; no Residual FP (${why === 'intensive' ? 'Intensive Fire' : 'a malfunctioned Weapon'} leaves none)` : ''}` });
        break;
      }
      case 'sk2.acquired': {
        const units = (p['units'] as string[] | undefined) ?? [];
        const what = p['type'] === 'ATT' || units.length === 0 ? `hex ${hexLabel(p['hex'] as string)}` : `${units.map(name).join(', ')} in ${hexLabel(p['hex'] as string)}`;
        out.push({ seq: e.seq, kind: 'fire', text: `  ◎ ${name(p['weapon'] as string)} acquires ${what}: -${p['level']} Acquired Target counter placed${p['level'] === 2 ? ' (flipped)' : ''}` });
        break;
      }
      case 'sk2.acq.kept': {
        // The acquired stack scattered; the firer chose where the counter stays (SK4 6.10).
        const units = (p['units'] as string[] | undefined) ?? [];
        out.push({ seq: e.seq, kind: 'info', text: `◎ ${name(p['weapon'] as string)} keeps its Acquired Target counter on ${units.length ? `${units.map(name).join(', ')} in ` : ''}${hexLabel(p['hex'] as string)} (the acquired units split up)` });
        break;
      }
      case 'sk2.gun.malf':
        out.push({ seq: e.seq, kind: 'info', text: `  ✖ ${name(p['gun'] as string)} ${p['removed'] ? 'is permanently removed' : 'malfunctions'} (original DR ${dr2(p['dr'], 'To Hit')})` });
        break;
      case 'sk3.toKill': {
        const dr = p['dr'] as [number, number] | null;
        const r = p['result'] as string;
        const text = p['tk'] === null
          ? `${name(p['weapon'] as string)} hits ${name(p['target'] as string)} (${p['location']} ${p['facing']}): ${p['ammo']} has no To Kill number`
          : p['ammo'] === 'FT'
            ? `Flamethrower To Kill ${name(p['target'] as string)}: TK ${p['finalTk']} (${noteLabels(p['explain']).join(', ')}), DR ${drText(dr!)} → ${r === 'kill' ? 'burns' : r === 'shock' ? 'Shock' : r === 'dud' ? 'dud' : 'no effect'}`
          : `To Kill ${name(p['target'] as string)}: ${p['location']} ${p['facing']} AF ${p['af']}, ${p['ammo']}${p['ch'] ? ' CH ×2' : ''} TK ${p['modifiedTk']} − ${p['af']} = ${p['finalTk']}, DR ${drText(dr!)} → ${
              r === 'kill' ? 'destroyed' : r === 'immobilized' ? 'Immobilized' : r === 'shock' ? 'Shock' : r === 'stun' ? 'stun' : r === 'possibleShock' ? `Possible Shock (${p['shocked'] ? 'Shocked' : 'crew holds'})` : r === 'dud' ? 'dud' : 'no effect'
            }`;
        out.push({ seq: e.seq, kind: 'fire', text });
        break;
      }
      case 'sk3.vehicle.wrecked':
        out.push({ seq: e.seq, kind: 'fire', text: `${name(p['vehicle'] as string)} is knocked out (${p['by']})` });
        break;
      case 'sk3.paatc': {
        const dr = p['dr'] as [number, number];
        const reason = p['reason'] as string;
        out.push({ seq: e.seq, kind: 'check', text: `${name(p['unit'] as string)} PAATC vs ${name(p['vehicle'] as string)} (${reason === 'advance' ? 'to advance in' : reason === 'dc' ? 'to place the DC' : 'CC Reaction Fire'}; morale ${p['morale']}): DR ${drText(dr)}${(p['drm'] as number) ? ` ${(p['drm'] as number) > 0 ? '+' : ''}${p['drm']}` : ''} → ${p['passed'] ? 'passes' : 'fails: pinned'}`, detail: noteLabels(p['explain']).join(', ') });
        break;
      }
      case 'sk3.cc.vsVehicle': {
        const dr = p['dr'] as [number, number];
        const r = p['result'] as string;
        const who = (p['attackers'] as string[]).map(name).join(' + ');
        out.push({
          seq: e.seq,
          kind: 'fire',
          text: `${p['reaction'] ? 'CC Reaction Fire: ' : 'CC: '}${who} vs ${name(p['vehicle'] as string)}: CCV ${p['ccv']}, DR ${drText(dr)}${(p['drm'] as number) ? ` ${(p['drm'] as number) > 0 ? '+' : ''}${p['drm']}` : ''}${p['third'] !== undefined ? `, third die ${p['third']}` : ''} → ${r === 'eliminated' ? 'DESTROYED' : r === 'immobilized' ? 'Immobilized' : r === 'casualtyReduction' ? 'original 12: Casualty Reduction for the attacker' : 'no effect'}`,
          detail: [...noteLabels(p['explain']), ...noteLabels(p['drmExplain'])].join(', '),
        });
        break;
      }
      case 'sk3.dcPlacement': {
        const dr = p['dr'] as [number, number];
        const r = p['result'] as string;
        out.push({ seq: e.seq, kind: 'fire', text: `DC placement vs ${name(p['vehicle'] as string)}: DR ${drText(dr)}${(p['drm'] as number) ? ` ${(p['drm'] as number) > 0 ? '+' : ''}${p['drm']}` : ''} = ${p['final']} → ${r === 'armor' ? 'against the armor (TK 16)' : r === 'crew' ? 'a full-strength attack on the CE crew only' : 'an area attack: the AFV is spared'}`, detail: noteLabels(p['explain']).join(', ') });
        break;
      }
      case 'sk3.vehicle.status': {
        const st = p['status'] as string;
        out.push({ seq: e.seq, kind: 'fire', text: `${name(p['vehicle'] as string)} ${st === 'immobilized' ? 'is Immobilized' : st === 'shock' ? 'is Shocked' : st === 'stun' ? 'is stunned' : st === 'STUN' ? 'is STUNNED and Recalled' : st === 'bu' ? 'Buttons Up' : st} (${p['by']})` });
        break;
      }
      case 'sk3.vehicle.check': {
        const dr = p['dr'] as [number, number];
        out.push({ seq: e.seq, kind: 'check', text: `${name(p['vehicle'] as string)} crew ${p['kind']} (morale ${p['morale']}${p['mod'] ? `, +${p['mod']}` : ''}): DR ${drText(dr)} → ${p['passed'] ? 'passes' : 'fails'}` });
        break;
      }
      case 'sk3.collateral': {
        const dr = p['dr'] as [number, number];
        const res = p['result'] as IftResult;
        out.push({ seq: e.seq, kind: 'fire', text: `Collateral Attack on the crew of ${name(p['target'] as string)}: ${p['column']} column, DR ${drText(dr)} +${p['drm']} CE → ${res.kind === 'none' ? 'no effect' : res.kind === 'MC' ? `${res.n}MC` : res.kind === 'K' ? `K/${res.n}` : res.kind === 'KIA' ? `${res.n ?? ''}KIA` : res.kind}` });
        break;
      }
      case 'sk3.areaHit': {
        const eff = p['effect'] as string;
        if (p['spared']) {
          out.push({ seq: e.seq, kind: 'fire', text: `${name(p['vehicle'] as string)} takes an Area Target Type ${p['location']} hit: ${p['spared'] as string}` });
          break;
        }
        out.push({ seq: e.seq, kind: 'fire', text: `${name(p['vehicle'] as string)} takes an Area Target Type ${p['location']} hit: ${eff === 'kill' ? 'destroyed' : eff === 'shock' ? 'Shock' : eff === 'immobilized' ? 'Immobilized' : 'no effect on the AFV'}` });
        break;
      }
      case 'asl.hd.hullHit':
        out.push({ seq: e.seq, kind: 'fire', text: `  hull hit on ${name(p['target'] as string)}: no effect, it is Hull Down ${p['kind'] === 'trench' ? 'beneath the trench (ASLRB B27.52, D4.2)' : 'behind the roadblock (ASLRB B9.36, D4.2)'}` });
        break;
      case 'asl.hd.chosen':
        if (p['choice']) out.push({ seq: e.seq, kind: 'info', text: `${name(p['vehicle'] as string)}: ${p['choice'] === 'tem' ? 'the in-hex TEM is taken instead of Hull Down for this shot (ASLRB B9.36, D4.2)' : 'Hull Down for this shot (ASLRB B9.36, D4.2)'}` });
        break;
      case 'asl.manhandle.ti':
        out.push({ seq: e.seq, kind: 'move', text: `  ${(p['units'] as string[]).map(name).join(', ')} TI for the rest of the Player Turn: the pushing has ended (ASLRB C10.3, A4.8)` });
        break;
      case 'sk3.vehicle.recuperation': {
        const r = p['result'] as string;
        out.push({ seq: e.seq, kind: 'check', text: `${name(p['vehicle'] as string)} ${p['from'] === 'uk' ? 'Unconfirmed Kill' : 'Shock'} recuperation dr ${p['dr']}: ${r === 'recovered' ? 'recovers' : r === 'uk' ? 'flips to Unconfirmed Kill' : 'is a wreck'}` });
        break;
      }
      case 'sk3.vehicle.smoke': {
        const dr = p['dr'] as [number, number];
        out.push({ seq: e.seq, kind: 'move', text: `${name(p['vehicle'] as string)} ${p['kind']}${p['n']} smoke: DR ${drText(dr)}${(p['drm'] as number) ? ` +${p['drm']}` : ''} → ${p['placed'] ? `Dispersed Smoke in ${hexLabel(p['hex'] as string)}` : 'no smoke'}` });
        break;
      }
      case 'sk3.vehicle.motionAttempt':
        out.push({ seq: e.seq, kind: 'move', text: `${name(p['vehicle'] as string)} Motion attempt: dr ${p['dr']} vs ${p['mp']} MP in its LOS → ${p['success'] ? 'in Motion' : 'fails'}` });
        break;
      case 'sk3.vehicle.move': {
        const v = name(p['vehicle'] as string);
        const kind = p['kind'] as string;
        const text =
          kind === 'start' ? (p['mp'] === 0 ? `${v} moves on in Motion (no start MP)` : `${v} starts (${p['mp']} MP)`) :
          kind === 'restart' ? `${v} starts again (1 MP)` :
          kind === 'stop' ? `${v} stops${(p['mp'] as number) > 0 ? ' (1 MP)' : ''}` :
          kind === 'delay' ? `${v} delays ${p['mp']} MP` :
          kind === 'turn' ? `${v} turns its hull ${p['spines']} hexspine${(p['spines'] as number) === 1 ? '' : 's'} (${p['mp']} MP)` :
          kind === 'turret' ? `${v} points its turret` :
          kind === 'motion' ? `${v} ends its move in Motion` : `${v} ends its move`;
        out.push({ seq: e.seq, kind: 'move', text });
        break;
      }
      case 'sk3.vehicle.motionTurn': {
        const v = name(p['vehicle'] as string);
        const n = p['spines'] as number;
        out.push({ seq: e.seq, kind: 'move', text: p['kind'] === 'hull' ? `${v} turns its hull ${n} hexspine${n === 1 ? '' : 's'} in Motion (free)` : `${v} points its turret (in Motion)` });
        break;
      }
      case 'sk3.vehicle.reliability': {
        const dr = p['dr'] as [number, number];
        const r = p['result'] as string;
        out.push({ seq: e.seq, kind: 'move', text: `${name(p['vehicle'] as string)} Mechanical Reliability DR ${drText(dr)}: ${r === 'ok' ? 'runs' : r === 'stall' ? `stalls, ${p['wasted']} MP wasted (Russian Vehicle Note M)` : 'breaks down: Immobilized'}` });
        break;
      }
      case 'sk3.pf.check': {
        const r = p['result'] as string;
        const notes = (p['notes'] as string[]).join(', ');
        out.push({
          seq: e.seq,
          kind: 'fire',
          text: `${name(p['unit'] as string)} Panzerfaust check: dr ${p['dr']}${p['drm'] ? ` ${(p['drm'] as number) > 0 ? '+' : ''}${p['drm']} = ${p['final']}` : ''} (final 1-3 finds a PF) → ${r === 'pf' ? 'has a PF and fires it' : r === 'none' ? 'no PF' : r === 'pinned' ? 'no PF, pinned (original 6)' : 'no PF, broken (original 6 while pinned)'}`,
          ...(notes ? { detail: notes } : {}),
        });
        break;
      }
      case 'ssr.radioless': {
        const dr = p['dr'] as [number, number];
        out.push({ seq: e.seq, kind: 'move', text: `${name(p['vehicle'] as string)} radioless${p['rule'] ? ` (${p['rule']})` : ''}: DR ${drText(dr)} vs ≤ ${p['need']} → ${p['ok'] ? 'may leave its hex this MPh' : 'may not leave its hex this MPh'}` });
        break;
      }
      case 'ssr.immobilization.dr': {
        const dr = p['dr'] as [number, number];
        out.push({ seq: e.seq, kind: 'move', text: `${name(p['vehicle'] as string)} enters ${hexLabel(p['hex'] as string)}${p['rule'] ? ` (${p['rule']})` : ''}: DR ${drText(dr)} vs ≥ ${p['atLeast']} → ${p['immobilized'] ? 'Immobilized' : 'carries on'}` });
        break;
      }
      case 'ssr.sniper.attack': {
        out.push({ seq: e.seq, kind: 'fire', text: `Sniper attack${p['rule'] ? ` (${p['rule']})` : ''} on ${hexLabel(p['hex'] as string)}: dr ${p['dr']}${p['target'] ? ` → ${name(p['target'] as string)}: ${p['effect']}` : ' → no effect'}` });
        break;
      }
      case 'ssr.oba.contact': {
        out.push({
          seq: e.seq,
          kind: 'fire',
          text: `${p['label']} (${p['rule']}): ${name(p['observer'] as string)} calls a fire mission on ${hexLabel(p['hex'] as string)}: dr ${p['dr']} vs ≤ ${p['need']} → ${p['contact'] ? `contact, it lands at the start of the AFPh (${p['left']} left)` : 'no contact'}`,
        });
        break;
      }
      case 'ssr.oba.noLos':
        out.push({ seq: e.seq, kind: 'fire', text: `${p['label']} (${p['rule']}): ${name(p['observer'] as string)} calls a fire mission on ${hexLabel(p['hex'] as string)} but has no LOS to it: no contact, this phase's attempt is spent` });
        break;
      case 'ssr.oba.landed': {
        const dirs = ['north', 'north-east', 'south-east', 'south', 'south-west', 'north-west'];
        const dist = p['distance'] as number;
        const where = dist === 0 ? `on target in ${hexLabel(p['target'] as string)}` : `${dist} hex${dist === 1 ? '' : 'es'} ${dirs[(p['direction'] as number) - 1] ?? ''} of ${hexLabel(p['target'] as string)}, ${p['landing'] ? `in ${hexLabel(p['landing'] as string)}` : 'off the map'}`;
        out.push({
          seq: e.seq,
          kind: 'fire',
          text: `${p['label']} (${p['rule']}) lands: dr ${p['dr']} ${(p['drm'] as number) >= 0 ? '+' : ''}${p['drm']}${p['direction'] ? `, direction dr ${p['direction']}` : ''} → ${where}; every unit in it and the six hexes around is attacked`,
        });
        break;
      }
      case 'ssr.stuka.attack': {
        const dr = p['dr'] as [number, number];
        const afv = (p['afv'] as { vehicle: string; final: number; result: string; tk?: number; tkDr?: [number, number] }[]).map((v) => `${name(v.vehicle)} (Final ${v.final}${v.tkDr ? `, To Kill ${drText(v.tkDr)} vs ${v.tk}` : ''}): ${v.result}`);
        out.push({ seq: e.seq, kind: 'fire', text: `Stuka attack${p['rule'] ? ` (${p['rule']})` : ''} on ${hexLabel(p['hex'] as string)}: To Hit DR ${drText(dr)}${p['infantry'] ? ' → hits the Infantry' : ''}${afv.length ? ` · ${afv.join(' · ')}` : ''}` });
        break;
      }
      case 'ssr.secret-sw.revealed': {
        const why = { fired: 'fires it', broken: 'is broken', enemy: 'is found by an enemy unit', unpossessed: 'no longer holds it' }[p['reason'] as string] ?? '';
        out.push({ seq: e.seq, kind: 'move', text: `${p['holder'] ? name(p['holder'] as string) : 'A unit'} revealed to possess ${name(p['weapon'] as string)}${why ? ` (${why})` : ''}` });
        break;
      }
      case 'ssr.dig-in.hullHit':
        out.push({ seq: e.seq, kind: 'fire', text: `  hull hit on the dug-in ${name(p['target'] as string)}${p['rule'] ? ` (${p['rule']})` : ''}: a miss` });
        break;
      case 'sk3.vehicle.bog': {
        const dr = p['dr'] as [number, number];
        out.push({ seq: e.seq, kind: 'move', text: `${name(p['vehicle'] as string)} Bog Check in ${hexLabel(p['hex'] as string)}: DR ${drText(dr)} ${(p['drm'] as number) >= 0 ? '+' : ''}${p['drm']} → ${p['bogged'] ? 'bogged' : 'passes'}`, detail: noteLabels(p['explain']).join(', ') });
        break;
      }
      case 'sk3.vehicle.unbog': {
        const r = p['result'] as string;
        out.push({ seq: e.seq, kind: 'move', text: `${name(p['vehicle'] as string)} Bog removal: colored ${p['colored']} × white ${p['white']} → ${r === 'freed' ? `freed (${p['mp']} MP to start)` : r === 'mired' ? 'Mired' : 'Immobilized'}` });
        break;
      }
      case 'sk3.vehicle.ce':
        out.push({ seq: e.seq, kind: 'move', text: `${name(p['vehicle'] as string)} ${p['ce'] ? 'goes Crew Exposed' : 'Buttons Up'}` });
        break;
      case 'sk2.gun.ca': {
        const reason = p['reason'] as string;
        if (reason === 'setup') break;
        out.push({ seq: e.seq, kind: 'info', text: `  ↻ ${name(p['gun'] as string)} turns ${p['spines']} hexspine${p['spines'] === 1 ? '' : 's'}${reason === 'fire' ? ' to fire' : reason === 'noAmmo' ? ' back: no ammo, so it never turned' : reason === 'manhandle' ? ' as it is pushed' : ' (end of the fire phase: it cannot move this Player Turn)'}` });
        break;
      }
      case 'sk3.vehicle.faced': {
        const parts = [p['vca'] !== undefined ? 'its hull' : '', p['tca'] !== undefined ? 'its turret' : ''].filter(Boolean).join(' and ');
        out.push({ seq: e.seq, kind: 'info', text: `  ↻ ${name(p['vehicle'] as string)} turns ${parts} without MP (end of the fire phase: it fires no more this phase${p['noMove'] ? ' and does not move this Player Turn' : ''})` });
        break;
      }
      case 'sk2.gun.captured':
        out.push({ seq: e.seq, kind: 'info', text: `  ⚑ ${name(p['gun'] as string)} captured by ${name(p['by'] as string)}` });
        break;
      case 'sk2.gun.destroyed':
        out.push({ seq: e.seq, kind: 'info', text: `  ✖ ${name(p['gun'] as string)} destroyed (${p['reason']})` });
        break;
      case 'sk2.gun.manhandle': {
        const ok = p['outcome'] as string;
        out.push({
          seq: e.seq,
          kind: 'move',
          text: `${name(p['gun'] as string)} manhandled toward ${hexLabel(p['to'] as string)}: DR ${dr2(p['dr'], `Manhandle ${p['gun']}`)} ${(p['drm'] as number) >= 0 ? '+' : ''}${p['drm']} vs M${p['m']} — ${ok === 'moved' ? 'moved on' : ok === 'stopped' ? 'moved and stopped' : 'did not move'}`,
          detail: noteLabels(p['explain']).join(', '),
        });
        break;
      }
      case 'sk1.exited':
        out.push({ seq: e.seq, kind: 'move', text: `  ⇥ ${name(p['unit'] as string)} exits the map${(p['vp'] as number) > 0 ? ` (${p['vp']} VP)` : ''}` });
        break;
      case 'sk4.usmc.deploy': {
        const halves = p['halves'] as string[] | undefined;
        out.push({ seq: e.seq, kind: 'check', text: `  NTC ${asDef(p['unit'] as string, p['from'] as string | undefined)} to deploy: DR ${drText(p['dr'] as number[])}${p['drm'] ? ` ${(p['drm'] as number) > 0 ? '+' : ''}${p['drm']}` : ''} vs ${p['morale']} — ${p['passed'] ? `passed: two ${halves ? name(halves[0]!) : 'half-squads'}` : 'failed (SK4 8.4)'}` });
        break;
      }
      case 'asl.deploy': {
        // Full ASL A1.31: the leader-directed NTC.
        const from = counters[p['from'] as string];
        const to = counters[p['to'] as string];
        const drm = p['drm'] as number;
        out.push({
          seq: e.seq,
          kind: 'check',
          text: `  ⇉ ${asDef(p['unit'] as string, p['from'] as string)}${p['offboard'] ? ' (offboard)' : ''} deploys under ${name(p['leader'] as string)}: NTC ${drText(p['dr'] as number[])} ${drm >= 0 ? '+' : ''}${drm} vs ${p['morale']} — ${p['passed'] ? `passed: two ${to ? defLabel(to) : 'half-squads'}` : `failed: ${from ? defLabel(from) : 'the squad'} and ${name(p['leader'] as string)} take no other action this RPh`} (ASLRB A1.31)`,
        });
        break;
      }
      case 'asl.recombined': {
        const to = counters[p['to'] as string];
        const from = counters[p['from'] as string];
        out.push({ seq: e.seq, kind: 'info', text: `  ⇇ two ${from ? defLabel(from) : 'half-squads'} recombine into ${to ? defLabel(to) : name(p['squad'] as string)} under ${name(p['leader'] as string)}: no casualty (ASLRB A1.32)` });
        break;
      }
      case 'sk4.usmc.recombined':
        out.push({ seq: e.seq, kind: 'info', text: `  ⇇ ${name(p['squad'] as string)}: two half-squads recombine under ${name(p['leader'] as string)} (SK4 8.4.1)` });
        break;
      case 'sk4.banzai.declared':
        if (p['vehicle']) {
          out.push({ seq: e.seq, kind: 'move', text: `  ! Banzai! ${name(p['leader'] as string)} charges alone at ${name(p['vehicle'] as string)} in ${hexLabel(p['target'] as string)} with its DC (SSR 2: in its hex after Defensive First Fire, a CC attack at CCV 5, -3)` });
          break;
        }
        out.push({ seq: e.seq, kind: 'move', text: `  ! Banzai! ${name(p['leader'] as string)} leads ${(p['units'] as string[]).filter((u) => u !== p['leader']).map(name).join(', ')} at ${hexLabel(p['target'] as string)} (SK4 8.1.8.6: 8 MF, +1 morale, one hex per Impulse)` });
        break;
      case 'sk4.banzai.step':
        out.push({ seq: e.seq, kind: 'move', text: `  ➜ ${name(p['unit'] as string)} charges ${hexLabel(p['from'] as string)} → ${hexLabel(p['to'] as string)} (${p['cost']} MF, Impulse ${p['impulse']})` });
        break;
      case 'sk4.banzai.impulse':
        if ((p['mf'] as number) > 0) out.push({ seq: e.seq, kind: 'info', text: `  Impulse ${p['impulse']} over: every Banzai unit is charged ${p['mf']} MF; the defender may fire at each Banzai hex` });
        break;
      case 'sk4.banzai.out':
        out.push({ seq: e.seq, kind: 'info', text: `  ${name(p['unit'] as string)} leaves the Banzai Charge: ${p['why']}` });
        break;
      case 'sk4.banzai.tpbf':
        out.push({ seq: e.seq, kind: 'fire', text: `  ✹ ${(p['firers'] as string[]).map(name).join(', ')} must fire Triple Point Blank at ${name(p['unit'] as string)} entering ${hexLabel(p['hex'] as string)} (SK4 8.1.8.7)` });
        break;
      case 'sk4.banzai.ended':
        out.push({ seq: e.seq, kind: 'info', text: `  The Banzai Charge is over` });
        break;
      case 'sk4.ja.stepReduced': {
        const to = counters[p['to'] as string];
        out.push({ seq: e.seq, kind: 'info', text: `  ↓ Step Reduction (SK4 8.1.2): ${asDef(p['unit'] as string, p['from'] as string)} becomes ${to ? defLabel(to) : p['to']}${p['broken'] ? ', broken' : ''}` });
        break;
      }
      case 'sk4.ja.leaderPtc':
        out.push({ seq: e.seq, kind: 'check', text: `  PTC ${name(p['unit'] as string)}: a Japanese leader takes no PTC (SK4 8.1.7)` });
        break;
      case 'sk4.ja.leaderWounded':
        out.push({ seq: e.seq, kind: 'info', text: `  ${p['outcome'] === 'eliminated' ? '✖' : '✚'} ${name(p['unit'] as string)} ${p['outcome'] === 'eliminated' ? 'dies of his wound' : 'is wounded'} instead of breaking (SK4 8.1.7)` });
        break;
      case 'sk4.ja.handToHand':
        out.push({ seq: e.seq, kind: 'info', text: `  ⚔ Hand-to-Hand Close Combat in ${hexLabel(p['hex'] as string)} (SK4 8.1.8.4): kill numbers two higher, -1 for each Japanese attack` });
        break;
      case 'sk4.concealment.gained': {
        const why: Record<string, string> = { setup: 'an OB concealment counter', 'setup-unseen': 'no enemy unit can see it', reinforcement: 'entering reinforcements set up concealed', endOfTurn: 'out of every unbroken enemy\'s LOS in Concealment Terrain at the end of the Player Turn', hip: 'a hidden unit placed on the board concealed' };
        // The enemy reads only of the "?" counter going down: the units under it are its secret (SK4 8.3.2).
        const seen = (p['units'] as string[]).filter((u) => !hiddenFrom(u));
        const where = p['hex'] ? ` in ${hexLabel(p['hex'] as string)}` : '';
        out.push({ seq: e.seq, kind: 'info', text: seen.length ? `  ? ${seen.map(name).join(', ')} concealed${where}: ${why[p['reason'] as string] ?? p['reason']}` : `  ? A ${sideNameOf(env, p['side'] as string)} concealment counter${where}` });
        break;
      }
      case 'sk4.concealment.lost': {
        const why: Record<string, string> = { fire: 'fired in the LOS of a Good Order enemy', hit: 'an attack had a result on it', smoke: 'attempted Smoke', dc: 'attempted a DC placement', moved: 'moved without Assault Movement in enemy LOS', open: 'in Open Ground in enemy LOS', entered: 'an enemy unit tried to enter its hex', entering: 'tried to enter a hex with an enemy "?"', ca: 'changed its Gun\'s Covered Arc', transfer: 'took a weapon', deploy: 'deployed', recombine: 'recombined', leadership: 'used its leadership modifier', broken: 'broke', wounded: 'was wounded', voluntary: 'dropped it', cc: 'engaged in Close Combat', melee: 'ended the CCPh with an unbroken enemy in its hex' };
        out.push({ seq: e.seq, kind: 'info', text: `  ? Concealment lost: ${(p['units'] as string[]).map(name).join(', ')}${p['hex'] ? ` in ${hexLabel(p['hex'] as string)}` : ''} (${why[p['reason'] as string] ?? p['reason']})` });
        break;
      }
      case 'sk4.concealment.bounce':
        out.push({ seq: e.seq, kind: 'move', text: `  ${(p['units'] as string[]).map(name).join(', ')} stopped short of ${hexLabel(p['hex'] as string)}: it held only a concealed stack (SK4 8.3.2), the MF are spent where they stand` });
        break;
      case 'sk4.hut.collapsed': {
        const why: Record<string, string> = { kia: 'a KIA result inside it', 'afv-entered': `${name(p['afv'] as string)} drove in`, 'afv-left': `${name(p['afv'] as string)} drove out`, 'afv-turned': `${name(p['afv'] as string)} turned inside it` };
        const ptc = p['ptc'] as { unit: string; dr: [number, number]; pinned: boolean }[];
        out.push({ seq: e.seq, kind: 'info', text: `  ▣ The hut in ${hexLabel(p['hex'] as string)} collapses (${why[p['why'] as string] ?? p['why']}): no TEM from now on`, detail: ptc.map((x) => `${name(x.unit)} PTC vs 8: DR ${drText(x.dr)} → ${x.pinned ? 'pinned' : 'passes'}`).join('; ') });
        break;
      }
      case 'sk4.bamboo.entered':
        out.push({ seq: e.seq, kind: 'move', text: `  ${(p['units'] as string[]).map(name).join(', ')} into the bamboo of ${hexLabel(p['hex'] as string)}: all MF spent (+1 for Defensive First Fire); CX and pinned once the fire is over` });
        break;
      case 'sk2.hip.revealed':
      case 'sk2.hip.unitRevealed': {
        const why: Record<string, string> = { fire: 'it fired', ca: 'it changed its Covered Arc', moved: 'it moved', seen: 'a Good Order enemy within 16 hexes has a LOS to it in Open Ground', entered: 'an enemy unit tried to enter its hex', hit: 'an attack affected it', advanced: 'an enemy unit advanced into its hex', manhandle: 'it was manhandled' };
        const who = (e.type === 'sk2.hip.revealed' ? p['gun'] : p['unit']) as string;
        out.push({ seq: e.seq, kind: 'info', text: `  ▣ Hidden ${name(who)} revealed in ${hexLabel(p['hex'] as string)}: ${why[p['reason'] as string] ?? p['reason']}` });
        break;
      }
    }
  }
  // Each line's emblem: the unit it is about, else its side; a result, ROF or Residual FP line without one is its shot's.
  const bySeq = new Map(events.map((e) => [e.seq, e]));
  let entryNation: string | undefined;
  const named = out.map((l) => {
    const e = bySeq.get(l.seq);
    const nation = l.kind === 'phase' ? sideNation(l.phase?.side) : e ? eventNation(e) : undefined;
    if (!l.text.startsWith(' ')) entryNation = nation;
    const n = nation ?? (l.text.startsWith(' ') ? entryNation : undefined);
    return { ...l, ...(n ? { nation: n } : {}) };
  });
  // No line ever shows a raw piece id: anything that slipped through is named here.
  const ids = (t: string) => nameIds(env, t);
  return named.map((l) => ({
    ...l,
    text: ids(l.text),
    ...(l.detail ? { detail: ids(l.detail) } : {}),
    ...(l.title ? { title: ids(l.title) } : {}),
    ...(l.rows ? { rows: l.rows.map((r) => ({ ...r, v: ids(r.v), ...(r.mods ? { mods: r.mods.map(ids) } : {}) })) } : {}),
  }));
}
