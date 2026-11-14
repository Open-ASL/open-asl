import { useEffect, useRef, type ReactNode } from 'react';
import type { SideId } from '@asl/engine';
import type { ScenarioDef, Weather } from '@asl/rules';
import { NATION } from '../game/describe';
import type { FxLevel } from '../fx/settings';
import { DiceIcon } from '../ui/DiceIcon';
import { GearIcon } from '../ui/GearIcon';
import { fmtSe, goalText, type SideTally } from '../panels/CasualtyLedger';
import { WeatherChip } from './WeatherChip';

interface Props {
  /** The game's length in force (a rule may change it in play: S36's secret length, once revealed). */
  length?: { turns: number; halfFinalTurn: boolean };
  scenario: ScenarioDef;
  phases: readonly string[];
  phase: string;
  turn: number;
  attacker: SideId;
  /** Side that owns the pending decision. */
  acting?: SideId;
  sideName(s: SideId): string;
  /** Who plays each side (the computer's seat by its name), shown under the side's name; a side missing here shows none. */
  players?: Record<SideId, string>;
  /**
   * Each side's victory point tally, when its conditions turn on one: exit VP for a side that
   * wins by exiting, else casualty VP where a CVP condition exists; null shows nothing.
   */
  tally: Record<SideId, SideTally | null>;
  /** Open the ledger behind a side's tally. */
  onTally(side: SideId): void;
  /** Panzerfaust shots each side has left of its scenario total (SK4 4.4.2), public to both players; null where it has none. */
  pf?: Record<SideId, { left: number; cap: number } | null>;
  /** Off-board artillery fire missions a side has left (SSR), and whether one is on its way; public to both players. */
  oba?: Record<SideId, { left: number; total: number; label: string; pending: unknown } | null>;
  /** The weather in play and where the wind blows to on screen (degrees clockwise from up). */
  weather: Weather;
  windAngle: number;
  fx: FxLevel;
  onFx(l: FxLevel): void;
  /** Turn the map a quarter turn: +1 clockwise, -1 counterclockwise. */
  onRotate(dir: 1 | -1): void;
  onSettings(): void;
  /** Open the keyboard and mouse controls card. */
  onShortcuts(): void;
  /** Open the quick-reference charts. */
  onCharts(): void;
  /** Open the mission briefing. */
  onBriefing(): void;
  /** The dice log (the last rolls) is open; the button toggles it. */
  diceLog: boolean;
  onToggleDiceLog(): void;
  /** Counters are hidden so the terrain can be seen. */
  unitsHidden: boolean;
  onToggleUnits(): void;
  /** Markers are left off the counters so the counters can be read. */
  markersHidden: boolean;
  onToggleMarkers(): void;
  /** The step can be finished by the acting player (end the phase, confirm the setup): a button, besides the wheel. */
  endPhase?: { label: string; icon?: string; blocked: string | null; hint?: string; onClick(): void; attention?: boolean } | null;
  /** Buttons a deployment adds to the tool row, before Settings. */
  tools?: ReactNode;
}

const PHASE_SHORT: Record<string, string> = { RPh: 'RPh', PFPh: 'PFPh', MPh: 'MPh', DFPh: 'DFPh', AFPh: 'AFPh', RtPh: 'RtPh', APh: 'APh', CCPh: 'CCPh' };

/** Top bar over the board: scenario, turn track, who is attacking, and the phase strip. */
/** The tally chip is lit when the side has what its condition asks for (a goal met, or the AFV lead). */
function tallyReached(t: SideTally): boolean {
  if (t.kind === 'mmc') return t.wins && t.points < t.other;
  if (t.kind === 'afv') return t.points > t.lost;
  if (t.kind === 'areas') return t.groups.every((g) => g.clear >= g.need) && (!t.lost || t.lost.mine < t.lost.theirs);
  if (t.kind === 'fp' || t.kind === 'area' || t.kind === 'points') return t.points >= t.goal;
  return t.goal !== undefined && t.points >= t.goal && (t.kind !== 'vp' || !t.armor || t.armor.points >= t.armor.goal);
}

function tallyTitle(t: SideTally, side: string): string {
  if (t.kind === 'areas')
    return `${t.groups.map((g) => `${g.clear} of ${g.areas.length} ${g.label} clear (${g.need} needed)`).join('; ')}${t.lost ? `; squad equivalents lost: ${side} ${fmtSe(t.lost.mine)}, enemy ${fmtSe(t.lost.theirs)} (must be fewer)` : ''} · click for the details`;
  if (t.kind === 'vp') return `Victory points the ${side} side has exited${t.armor ? ` (${t.armor.points} of them by AFV; at least ${t.armor.goal} must be)` : ''} · click for the units behind the total`;
  if (t.kind === 'mmc') return `MMC the ${side} side has lost${t.wins ? ` (it must have lost fewer than the other side's ${t.other})` : ''} · click for the ledger`;
  if (t.kind === 'cvp') return `Casualty victory points amassed by the ${side} side · click for the chits behind the total`;
  if (t.kind === 'points') return `Victory points of the ${side} side (wins at game end with ${t.goal}) · click for the sources`;
  if (t.kind === 'area') return `VP of the ${side} side's Good Order infantry ${t.label} (wins at game end with ${t.goal}) · click for the units`;
  if (t.kind === 'fp') return `FP the ${side} side's Good Order units seeing the ${t.label} could fire at them (wins at game end with ${t.goal}) · click for the units`;
  const got = `${t.eliminated} enemy AFV eliminated${t.countsExits ? ` + ${t.exited} own AFV exited` : ''}`;
  return `${got}, against ${t.lost} AFV lost · the ${side} side wins with more · click for the ledger`;
}

function TallyChip({ t, side, onClick }: { t: SideTally; side: string; onClick(): void }) {
  return (
    <button className={`cvp ${tallyReached(t) ? 'reached' : ''}`} onClick={onClick} title={tallyTitle(t, side)}>
      {t.kind === 'areas' ? (
        <>
          {t.groups.map((g, i) => (
            <span key={g.label}>
              {i > 0 ? ' · ' : 'Clear '}
              <b>{g.clear}</b>
              <span className="goal">/{g.need}</span>
            </span>
          ))}
          {t.lost && (
            <>
              {' '}Lost <b>{fmtSe(t.lost.mine)}</b>
              <span className="goal"> vs {fmtSe(t.lost.theirs)}</span>
            </>
          )}
        </>
      ) : t.kind === 'mmc' ? (
        <>
          MMC lost <b>{t.points}</b>
        </>
      ) : t.kind === 'fp' ? (
        <>
          FP <b>{t.points}</b>
          <span className="goal">/{t.goal}</span>
        </>
      ) : t.kind === 'area' || t.kind === 'points' ? (
        <>
          VP <b>{t.points}</b>
          <span className="goal">/{t.goal}</span>
        </>
      ) : t.kind === 'afv' ? (
        <>
          AFV <b>{t.points}</b>
          <span className="goal"> vs {t.lost}</span>
        </>
      ) : (
        <>
          {t.kind === 'vp' ? 'VP' : 'CVP'} <b>{t.points}</b>
          {t.goal !== undefined && <span className="goal">/{goalText(t.goal)}</span>}
          {t.kind === 'vp' && t.armor && (
            <>
              {' '}AFV <b>{t.armor.points}</b>
              <span className="goal">/{t.armor.goal}</span>
            </>
          )}
        </>
      )}
    </button>
  );
}

/**
 * Each side's ELR and SAN, the two numbers a player checks at a glance all game: a small two-row
 * table beside the side chips, one row per side in its colour, so the chips keep room for the
 * tallies. A side whose card prints an ELR per nationality (S9: Americans 5, British 3) shows the
 * others after its own. The Starter Kit has no snipers, so the SAN reads N/A unless the scenario prints one.
 */
/** The SAN cell's tooltip: a scenario that prints a SAN (the Full ASL test bed) shows it, though no sniper rolls yet. */
const sanTitle = (san: number | undefined) =>
  san === undefined
    ? 'Sniper Activation Number: the Starter Kit has no snipers, so there is none to roll against'
    : `Sniper Activation Number ${san} (ASLRB A14.1): the full ASL sniper rules are not in play yet`;

function Ratings({ sc, sideName }: { sc: ScenarioDef; sideName(s: SideId): string }) {
  const name = (n: string) => sc.nationalityNames?.[n] ?? NATION[n] ?? n;
  return (
    <div className="ratings" title="Experience Level Rating and Sniper Activation Number of each side">
      {sc.sides.map((s) => {
        const extras = Object.entries(s.elrs ?? {}).filter(([n]) => n !== s.nationality);
        const elrTitle = `${sideName(s.side)} ELR ${s.elr}${extras.map(([n, e]) => `, ${name(n)} ${e}`).join('')}: fail a Morale Check by more than this and the unit is replaced by a lesser one`;
        return (
          <div key={s.side} className={`rating side-${s.side}`}>
            <span className="sw" />
            <span className="k" title={elrTitle}>
              ELR
            </span>
            <span className="v" title={elrTitle}>
              {s.elr}
              {extras.map(([n, e]) => (
                <span key={n} className="extra">
                  {n} {e}
                </span>
              ))}
            </span>
            <span className="k" title={sanTitle(s.san)}>
              SAN
            </span>
            <span className={`v ${s.san === undefined ? 'na' : ''}`} title={sanTitle(s.san)}>
              {s.san ?? 'N/A'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** "North is up" and the like, for the compass rose's tooltip. */
export function northWords(north: number): string {
  const n = ((north % 360) + 360) % 360;
  return n === 0 ? 'North is up' : n === 90 ? 'North is to the right' : n === 180 ? 'North is down' : n === 270 ? 'North is to the left' : `North is ${n}° clockwise from up`;
}

export function Hud({ scenario, length, phases, phase, turn, attacker, acting, sideName, players, tally, onTally, pf, oba, weather, windAngle, fx, onFx, onRotate, onSettings, onShortcuts, onCharts, onBriefing, diceLog, onToggleDiceLog, unitsHidden, onToggleUnits, markersHidden, onToggleMarkers, endPhase, tools }: Props) {
  const [code, ...rest] = scenario.title.split(' ');
  const defender = scenario.sides.find((s) => s.side !== attacker)?.side ?? attacker;
  const idx = phases.indexOf(phase);
  const setup = phase === 'setup';
  // The bar wraps onto more rows in a narrow window: what sits under it (the "your call" strip) reads its height.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    const pane = el?.parentElement;
    if (!el || !pane || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => pane.style.setProperty('--hud-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="hud" ref={ref}>
      <div className="hud-bar">
        <button className="title-block" onClick={onBriefing} title="Mission briefing (B)">
          <span className="scenario-code">{code}</span>
          <span className="scenario-name">{rest.join(' ')}</span>
          <span className="briefing-tag">Briefing ▸</span>
        </button>
        <div className="turn-track">
          <span className="lbl">TURN</span>
          <div className="pips">
            {Array.from({ length: (length ?? scenario).turns }, (_, i) => i + 1).map((t) => (
              <span key={t} className={`pip ${!setup && t === turn ? 'now' : !setup && t < turn ? 'done' : ''} ${(length ?? scenario).halfFinalTurn && t === (length ?? scenario).turns ? 'half' : ''}`}>
                {t}
              </span>
            ))}
          </div>
        </div>
        <div className="sides">
          {scenario.sides.map((s) => (
            <span key={s.side} className={`side-chip side-${s.side} ${acting === s.side ? 'acting' : ''}`}>
              <span className="sw" />
              <span className="who">
                <span className="side-line">
                  {sideName(s.side)}
                  <span className="role">{setup ? '' : s.side === attacker ? 'attacking' : 'defending'}</span>
                </span>
                {players?.[s.side] && (
                  <span className="player" title={`${players[s.side]} plays the ${sideName(s.side)} side`}>
                    {players[s.side]}
                  </span>
                )}
              </span>
              {tally[s.side] && <TallyChip t={tally[s.side]!} side={sideName(s.side)} onClick={() => onTally(s.side)} />}
              {oba?.[s.side] && (
                <span
                  className={`cvp pf ${oba[s.side]!.left === 0 && !oba[s.side]!.pending ? 'spent' : ''}`}
                  title={`${oba[s.side]!.label} fire missions the ${sideName(s.side)} side has left: ${oba[s.side]!.left} of ${oba[s.side]!.total}${oba[s.side]!.pending ? '; one is on its way and lands at the start of the AFPh' : ''} (a mission is used when contact is made)`}
                >
                  {oba[s.side]!.pending ? '✸ ' : ''}OBA <b>{oba[s.side]!.left}</b>
                  <span className="goal">/{oba[s.side]!.total}</span>
                </span>
              )}
              {pf?.[s.side] && (
                <span
                  className={`cvp pf ${pf[s.side]!.left === 0 ? 'spent' : ''}`}
                  title={`Panzerfaust shots the ${sideName(s.side)} side has left: ${pf[s.side]!.left} of ${pf[s.side]!.cap} this scenario (SK4 4.4.2; a shot is used when a PF check finds one)`}
                >
                  PF <b>{pf[s.side]!.left}</b>
                  <span className="goal">/{pf[s.side]!.cap}</span>
                </span>
              )}
            </span>
          ))}
        </div>
        <Ratings sc={scenario} sideName={sideName} />
        <WeatherChip weather={weather} windAngle={windAngle} />
        <div className={`phase-strip side-${attacker}`} style={{ ['--def-side' as string]: `var(--${defender})` }}>
          {setup ? (
            <span className="ph now">SETUP</span>
          ) : (
            phases.map((p, i) => (
              <span key={p} className={`ph ${i === idx ? 'now' : i < idx ? 'done' : ''} ${p === 'DFPh' ? 'defender' : ''}`} title={p}>
                {PHASE_SHORT[p] ?? p}
              </span>
            ))
          )}
        </div>
      </div>
      {endPhase && (
        <button className={`end-btn primary${endPhase.attention ? ' attention' : ''}`} onClick={endPhase.onClick} disabled={!!endPhase.blocked} title={endPhase.blocked ?? endPhase.hint ?? `${endPhase.label} (also on the right-click wheel)`}>
          {endPhase.label}
        </button>
      )}
      <div className="hud-tools">
        <div className="map-ctl">
          <span className="lbl muted small">MAP</span>
          <span className="seg">
            <button onClick={() => onRotate(-1)} title="Rotate map counterclockwise ([)" aria-label="Rotate map counterclockwise">
              ↺
            </button>
            <button onClick={() => onRotate(1)} title="Rotate map clockwise (])" aria-label="Rotate map clockwise">
              ↻
            </button>
          </span>
          <button className={`units-btn ${unitsHidden ? 'on' : ''}`} onClick={onToggleUnits} title={unitsHidden ? 'Show the counters again (or release T)' : 'Hide the counters to see the terrain (or hold T)'} aria-pressed={unitsHidden}>
            {unitsHidden ? 'terrain' : 'units'}
          </button>
          <button className={`units-btn ${markersHidden ? 'on' : ''}`} onClick={onToggleMarkers} title={markersHidden ? 'Put the markers back on the counters (or release M)' : 'Take the markers off the counters to read them (or hold M)'} aria-pressed={markersHidden}>
            {markersHidden ? 'bare' : 'markers'}
          </button>
        </div>
        <div className="fx-ctl">
          <span className="lbl muted small">FX</span>
          <span className="seg">
            {(['full', 'fast', 'off'] as FxLevel[]).map((l) => (
              <button key={l} className={fx === l ? 'on' : ''} onClick={() => onFx(l)}>
                {l}
              </button>
            ))}
          </span>
        </div>
        <button className={`log-btn ${diceLog ? 'on' : ''}`} onClick={onToggleDiceLog} title={diceLog ? 'Close the dice log (L)' : 'Dice log: the last rolls (L)'} aria-label="Dice log" aria-pressed={diceLog}>
          <DiceIcon />
          <span>Dice</span>
        </button>
        <button className="keys-btn charts-btn" onClick={onCharts} title="Charts: IFT, To Hit, terrain and more (C)" aria-label="Charts">
          Charts
        </button>
        <button className="keys-btn" onClick={onShortcuts} title="Controls: keyboard and mouse (?)" aria-label="Controls">
          ?
        </button>
        {tools}
        <button className="gear-btn" onClick={onSettings} title="Settings (sound, motion)" aria-label="Settings">
          <GearIcon />
        </button>
      </div>
    </div>
  );
}
