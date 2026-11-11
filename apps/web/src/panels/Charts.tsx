import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ATT_BANDS, COUNTERS, ITT_BANDS, IFT_COLUMNS, SK1_TABLES, TO_HIT, TO_KILL_AP, VTT_BANDS } from '@asl/content';
import { SK4_TERRAIN, type IftResult, type SpecialAmmoDef, type ToHitEntry, type VehicleDef } from '@asl/rules';
import { counterImage } from '../game/assets';
import { NATION } from '../game/describe';
import * as D from './chartData';

/*
 * The chart binder: the game's own quick-reference charts, one tab per section.
 * Every table the engine rolls against (IFT, Close Combat, Leader Creation, To Hit, terrain) is drawn
 * from the engine's data, so the reference can never disagree with a roll; the DRM lists are ours
 * (chartData.ts), worded for the screen with the rule numbers beside them.
 */

interface Props {
  onClose(): void;
  /** Nationalities in play, to open the To Hit chart on one of them. */
  nationalities?: string[];
}

type SectionId = 'fire' | 'cc' | 'morale' | 'move' | 'terrain' | 'guns' | 'vehicles' | 'afv' | 'sequence';
const SECTIONS: { id: SectionId; name: string; blurb: string }[] = [
  { id: 'fire', name: 'Infantry Fire', blurb: 'IFT, DRM, FP' },
  { id: 'cc', name: 'Close Combat', blurb: 'Kill #, CC DRM, Ambush' },
  { id: 'morale', name: 'Morale & Rally', blurb: 'MC, Rally, Wounds, Leaders' },
  { id: 'move', name: 'Movement & Rout', blurb: 'MF, PP, Rout' },
  { id: 'terrain', name: 'Terrain', blurb: 'TEM, MF, LOS' },
  { id: 'guns', name: 'Guns', blurb: 'To Hit, TH DRM, Manhandling' },
  { id: 'vehicles', name: 'Vehicles', blurb: 'To Kill, AFV Destruction, Bog, MP' },
  { id: 'afv', name: 'AFV Counter', blurb: 'Reading a vehicle counter' },
  { id: 'sequence', name: 'Sequence of Play', blurb: 'Phase by phase' },
];

let lastSection: SectionId = 'fire';

/** The quick-reference charts. Opened with C or the top-bar button; 1–7 or ←/→ step through the sections. */
export function ChartsDialog({ onClose, nationalities }: Props) {
  const [section, setSection] = useState<SectionId>(lastSection);
  useEffect(() => {
    lastSection = section;
  }, [section]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const i = SECTIONS.findIndex((s) => s.id === section);
      let next: number | null = null;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = i + 1;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = i - 1;
      else if (/^[1-9]$/.test(e.key)) next = Number(e.key) - 1;
      if (next === null || next < 0 || next >= SECTIONS.length) return;
      e.preventDefault();
      e.stopPropagation();
      setSection(SECTIONS[next]!.id);
    };
    // Capture, so the arrows don't also reach the board behind the dialog.
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [section, onClose]);

  const body: Record<SectionId, () => ReactNode> = {
    fire: () => <FireSection />,
    cc: () => <CloseCombatSection />,
    morale: () => <MoraleSection />,
    move: () => <MovementSection />,
    terrain: () => <TerrainSection />,
    guns: () => <GunsSection nationalities={nationalities} />,
    vehicles: () => <VehiclesSection nationalities={nationalities} />,
    afv: () => <AfvSection nationalities={nationalities} />,
    sequence: () => <SequenceSection />,
  };
  const current = SECTIONS.find((s) => s.id === section)!;
  return (
    <div className="set-backdrop" onClick={onClose}>
      <div className="set-panel charts" role="dialog" aria-label="Charts" onClick={(e) => e.stopPropagation()}>
        <nav className="ch-rail" role="tablist" aria-label="Chart sections" aria-orientation="vertical">
          <div className="ch-brand">
            <span className="kicker">Quick reference</span>
            <span className="ch-brand-title">Charts</span>
          </div>
          {SECTIONS.map((s, i) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={s.id === section}
              className={`ch-tab ${s.id === section ? 'on' : ''}`}
              onClick={() => setSection(s.id)}
              title={`${s.name} (${i + 1})`}
            >
              <span className="ch-tab-n">{i + 1}</span>
              <span className="ch-tab-txt">
                <span className="ch-tab-name">{s.name}</span>
                <span className="ch-tab-blurb">{s.blurb}</span>
              </span>
            </button>
          ))}
          <p className="ch-rail-hint hint">
            <kbd>1</kbd>–<kbd>{SECTIONS.length}</kbd> <kbd>←</kbd> <kbd>→</kbd> turn the page
            <br />
            <kbd>C</kbd> <kbd>Esc</kbd> close
          </p>
        </nav>
        <div className="ch-page" role="tabpanel" aria-label={current.name}>
          <div className="ch-page-head">
            <h2 className="modal-title">{current.name}</h2>
            <button className="ghost" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
          <div className="ch-page-body" key={section}>
            {body[section]()}
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------ building blocks

function Card({ title, refs, children, wide }: { title: string; refs?: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`ch-card ${wide ? 'wide' : ''}`}>
      <header>
        <h3>{title}</h3>
        {refs && <span className="ch-ref">{refs}</span>}
      </header>
      {children}
    </section>
  );
}

/** A DRM list: value on the left, what it is for, the rule number on the right. */
function DrmTable({ rows }: { rows: D.Drm[] }) {
  return (
    <table className="ch-drm">
      <tbody>
        {rows.map((r, i) =>
          'group' in r ? (
            <tr key={i} className="grp">
              <th colSpan={3}>{r.group}</th>
            </tr>
          ) : (
            <tr key={i}>
              <td className={`v ${drmTone(r.v)}`}>{r.v}</td>
              <td className="l">
                {r.label}
                {r.note && <span className="note">{r.note}</span>}
              </td>
              <td className="r">{r.ref}</td>
            </tr>
          ),
        )}
      </tbody>
    </table>
  );
}

/** Good for the roller (negative DRM) reads green, bad reads red; others stay neutral. */
function drmTone(v = ''): string {
  if (/^[-−]\d/.test(v)) return 'neg';
  if (/^\+\d/.test(v)) return 'pos';
  return '';
}

function Bullets({ items }: { items: D.Bullet[] }) {
  return (
    <ul className="ch-bullets">
      {items.map((b, i) => (
        <li key={i}>
          {b.lead && <b>{b.lead} </b>}
          {b.text}
          {b.ref && <span className="ch-ref inline">{b.ref}</span>}
        </li>
      ))}
    </ul>
  );
}

function Lists({ lists }: { lists: D.DrmList[] }) {
  return (
    <>
      {lists.map((l) => (
        <Card key={l.title} title={l.title} refs={l.ref}>
          <DrmTable rows={l.rows} />
          {l.foot && <p className="ch-foot">{l.foot}</p>}
        </Card>
      ))}
    </>
  );
}

// ------------------------------------------------------------------------------------ Infantry Fire

const IFT_ROWS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const iftLabel = (r: IftResult) =>
  r.kind === 'none' ? '' : r.kind === 'KIA' ? `${r.n}KIA` : r.kind === 'K' ? `K/${r.n}` : r.kind === 'MC' ? `${r.n}MC` : r.kind;

function FireSection() {
  // Crosshair: the hovered cell lights its row and column, as a finger would on the paper chart.
  const [hover, setHover] = useState<[number, number] | null>(null);
  return (
    <div className="ch-grid">
      <Card title="Infantry Fire Table" refs="SK1 3.4" wide>
        <div className="ch-scroll">
          <table className="ch-ift" onMouseLeave={() => setHover(null)}>
            <thead>
              <tr>
                <th className="corner">
                  <span>FP →</span>
                  <span>DR ↓</span>
                </th>
                {IFT_COLUMNS.map((c, ci) => (
                  <th key={c} className={hover?.[1] === ci ? 'hl' : ''}>
                    {c === 36 ? '36+' : c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {IFT_ROWS.map((dr, ri) => (
                <tr key={dr} className={hover?.[0] === ri ? 'hl' : ''}>
                  <th className={hover?.[0] === ri ? 'hl' : ''}>{dr === 0 ? '≤0' : dr === 15 ? '≥15' : dr}</th>
                  {IFT_COLUMNS.map((c, ci) => {
                    const r = SK1_TABLES.ift(c, dr);
                    const on = hover?.[0] === ri || hover?.[1] === ci;
                    return (
                      <td
                        key={c}
                        className={`res-${r.kind} ${on ? 'hl' : ''} ${hover?.[0] === ri && hover?.[1] === ci ? 'hit' : ''}`}
                        onMouseEnter={() => setHover([ri, ci])}
                      >
                        {iftLabel(r) || '–'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="ch-key">
          {D.IFT_RESULTS.map((r) => (
            <div key={r.code}>
              <dt className={`res-${r.kind}`}>{r.code}</dt>
              <dd>{r.text}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Lists lists={D.FIRE_LISTS} />
      <Card title="Dice to watch" refs="SK1">
        <Bullets items={D.SPECIAL_DR} />
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------------------------ Close Combat

function CloseCombatSection() {
  const cols = SK1_TABLES.ccOddsColumns;
  return (
    <div className="ch-grid">
      <Card title="Close Combat Table" refs="SK1 3.8" wide>
        <div className="ch-scroll">
          <table className="ch-cct">
            <tbody>
              <tr>
                <th>Odds</th>
                {cols.map((c) => (
                  <td key={c}>{c.replace(':', '-')}</td>
                ))}
              </tr>
              <tr className="kill">
                <th>Kill #</th>
                {cols.map((c) => (
                  <td key={c}>{SK1_TABLES.ccKill(c)}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <Bullets items={D.CC_RESOLUTION} />
      </Card>
      <Lists lists={D.CC_LISTS} />
    </div>
  );
}

// ------------------------------------------------------------------------------------ Morale & Rally

/** The Leader Creation bands, read off the engine's own table by rolling it at every final dr. */
function leaderBands(): { dr: string; result: string }[] {
  const out: { lo: number; hi: number; result: string }[] = [];
  for (let dr = -2; dr <= 9; dr++) {
    // Allied Minor at Morale 7 carries no drm, so the dr here is the final dr.
    const id = SK1_TABLES.leaderCreation('al', 7, dr);
    const m = id && /L(\d)(\d)$/.exec(id);
    // The 6+1 leader's modifier is a penalty, so the chart prints it with a plus.
    const result = m ? `${m[1]}${m[1] === '6' ? '+' : '-'}${m[2]}` : 'None';
    const last = out[out.length - 1];
    if (last && last.result === result) last.hi = dr;
    else out.push({ lo: dr, hi: dr, result });
  }
  return out.map(({ lo, hi, result }, i) => ({
    dr: i === 0 ? `≤${hi}` : i === out.length - 1 ? `≥${lo}` : lo === hi ? `${lo}` : `${lo}–${hi}`,
    result,
  }));
}

function MoraleSection() {
  const bands = useMemo(leaderBands, []);
  return (
    <div className="ch-grid">
      <Lists lists={D.MORALE_LISTS} />
      <Card title="Leader Creation" refs="SK1 5.3">
        <table className="ch-mini">
          <thead>
            <tr>
              <th>Final dr</th>
              <th>Leader</th>
            </tr>
          </thead>
          <tbody>
            {bands.map((b) => (
              <tr key={b.dr}>
                <td className="v">{b.dr}</td>
                <td>{b.result}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <DrmTable rows={D.LEADER_CREATION_DRM} />
      </Card>
      <Card title="Wounds" refs={D.WOUNDS.ref}>
        <DrmTable rows={D.WOUNDS.rows} />
        {D.WOUNDS.foot && <p className="ch-foot">{D.WOUNDS.foot}</p>}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------------------------ Movement & Rout

function MovementSection() {
  return (
    <div className="ch-grid">
      <Card title="MF by Portage" refs={D.MF_PP.ref}>
        <table className="ch-mini ch-mfpp">
          <thead>
            <tr>
              <th>PP carried</th>
              {D.MF_PP.columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {D.MF_PP.rows.map((r) => (
              <tr key={r.pp}>
                <td className="v">{r.pp}</td>
                {r.mf.map((m, i) => (
                  <td key={i}>{m}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {D.MF_PP.foot && <p className="ch-foot">{D.MF_PP.foot}</p>}
      </Card>
      <Card title="Moving" refs="SK1 3.3">
        <Bullets items={D.MOVEMENT} />
      </Card>
      <Card title="Routing" refs="SK1 3.6">
        <Bullets items={D.ROUT} />
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------------------------ Terrain

const LOS_WORD = { none: '—', hindrance: '+1 Hindrance', obstacle: 'Obstacle' } as const;
const mfText = (mf: number) => (mf === Infinity ? 'NA' : mf === 1.5 ? '1½' : String(mf));

function TerrainSection() {
  // Every Starter Kit terrain, the PTO's included (SK4 8.2: jungle, bamboo, palm trees, kunai, huts).
  const rows = Object.values(SK4_TERRAIN).filter((t) => t.id !== 'flooded');
  return (
    <div className="ch-grid">
      <Card title="Terrain Effects" refs="SK1 1.1.1 · SK4 1.1.1" wide>
        <div className="ch-scroll">
          <table className="ch-tec">
            <thead>
              <tr>
                <th>Terrain</th>
                <th>MF</th>
                <th>TEM</th>
                <th>LOS</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <th>{t.name}</th>
                  <td className="v">{mfText(t.mf)}</td>
                  <td className="v">{t.tem > 0 ? `+${t.tem}` : '0'}</td>
                  <td>{LOS_WORD[t.los]}</td>
                  <td className="notes">{D.TERRAIN_NOTES[t.id] ?? ''}</td>
                </tr>
              ))}
              {D.TERRAIN_EXTRA.map((t) => (
                <tr key={t.name}>
                  <th>{t.name}</th>
                  <td className="v">{t.mf}</td>
                  <td className="v">{t.tem}</td>
                  <td>{t.los}</td>
                  <td className="notes">{t.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Lists lists={D.TERRAIN_LISTS} />
    </div>
  );
}

// ------------------------------------------------------------------------------------ Guns

const GUN_NATIONS = [...new Set(Object.keys(TO_HIT).map((k) => k.split(':')[0]!))];
const bandLabel = ([a, b]: [number, number]) => (a === b ? `${a}` : `${a}–${b}`);

/** Nationalities whose 7-24 ITT cells the chart prints in red only (their Guns always use the red TH#). */
const RED_ONLY = new Set(['ru', 'it', 'al', 'ax']);

function ThCell({ e, allRed }: { e: ToHitEntry | null | undefined; allRed?: boolean }) {
  if (!e) return <>–</>;
  const red = e.red !== undefined && e.red !== e.black;
  if (allRed && !red)
    return (
      <span className="red">
        {e.black}
        <span className="ch">({e.ch})</span>
      </span>
    );
  return (
    <>
      {e.black}
      {red && <span className="red">/{e.red}</span>}
      <span className="ch">
        ({e.ch}
        {red && e.chRed !== undefined && <span className="red">/{e.chRed}</span>})
      </span>
    </>
  );
}

function GunsSection({ nationalities }: { nationalities?: string[] }) {
  const [nation, setNation] = useState(() => nationalities?.find((n) => GUN_NATIONS.includes(n)) ?? GUN_NATIONS[0]!);
  const rows = Object.entries(TO_HIT).filter(([k]) => k.startsWith(`${nation}:`));
  const fp = (n: number | undefined) => (n === undefined ? '–' : n);
  return (
    <div className="ch-grid">
      <Card title="To Hit Chart" refs="SK4 3.2.4" wide>
        <div className="ch-seg" role="tablist" aria-label="Nationality">
          {GUN_NATIONS.map((n) => (
            <button key={n} role="tab" aria-selected={n === nation} className={`side-${n} ${n === nation ? 'on' : ''}`} onClick={() => setNation(n)}>
              {NATION[n] ?? n}
            </button>
          ))}
        </div>
        <div className="ch-scroll">
          <table className="ch-th">
            <thead>
              <tr className="band">
                <th rowSpan={2}>Gun</th>
                <th rowSpan={2}>
                  FP column
                  <span className="sub">ITT / ATT / CH</span>
                </th>
                <th colSpan={ITT_BANDS.length}>Infantry Target · TH# (CH#)</th>
                <th colSpan={ATT_BANDS.length}>Area Target · TH#</th>
              </tr>
              <tr>
                {ITT_BANDS.map((b) => (
                  <th key={`i${b[0]}`} className="rng">
                    {bandLabel(b)}
                  </th>
                ))}
                {ATT_BANDS.map((b) => (
                  <th key={`a${b[0]}`} className="rng att">
                    {bandLabel(b)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([key, r]) => (
                <tr key={key}>
                  <th className="gun">{key.split(':')[1]}</th>
                  <td className="fp">
                    {fp(r.fp.itt)} / {fp(r.fp.att)} / {fp(r.fp.ch)}
                  </td>
                  {ITT_BANDS.map((_b, i) => (
                    <td key={i} className="th">
                      {r.itt ? <ThCell e={r.itt[i]} allRed={RED_ONLY.has(nation) && ITT_BANDS[i]![0] >= 7} /> : '–'}
                    </td>
                  ))}
                  {ATT_BANDS.map(([a, b], i) => {
                    const na = r.attNa?.filter(([x, y]) => x <= b && y >= a);
                    return (
                      <td key={i} className="th att">
                        {r.att ? (
                          <>
                            <span className="red">{r.att[i] ?? 'NA'}</span>
                            {na && na.length > 0 && <span className="na">NA {na.map(bandLabel).join(', ')}</span>}
                          </>
                        ) : (
                          '–'
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Bullets items={D.TH_KEY} />
      </Card>
      <Lists lists={D.GUN_LISTS} />
      <Card title="Firing a Gun" refs="SK4 3.2">
        <Bullets items={D.GUN_PROCESS} />
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------------------------ Vehicles

const TK_BANDS: [number, number][] = [[0, 1], [2, 2], [3, 6], [7, 12], [13, 18], [19, 24]];
/** The AP To Kill row label: "76L", "76L (Russian)", "ATR (German)". */
function tkLabel(key: string): string {
  if (key.startsWith('ATR:')) return `ATR (${NATION[key.slice(4)] ?? (key.slice(4) === 'pl' ? 'Polish' : key.slice(4))})`;
  if (key.startsWith('ru:')) return `${key.slice(3)} (${NATION.ru})`;
  return key;
}

function VehiclesSection({ nationalities }: { nationalities?: string[] }) {
  const vttNations = GUN_NATIONS.filter((n) => Object.entries(TO_HIT).some(([k, r]) => k.startsWith(`${n}:`) && r.vtt));
  const [nation, setNation] = useState(() => nationalities?.find((n) => vttNations.includes(n)) ?? vttNations[0]!);
  const rows = Object.entries(TO_HIT).filter(([k, r]) => k.startsWith(`${nation}:`) && r.vtt);
  return (
    <div className="ch-grid">
      <Card title="Vehicle Target Type · To Hit" refs="SK4 3.2.4" wide>
        <div className="ch-seg" role="tablist" aria-label="Nationality">
          {vttNations.map((n) => (
            <button key={n} role="tab" aria-selected={n === nation} className={`side-${n} ${n === nation ? 'on' : ''}`} onClick={() => setNation(n)}>
              {NATION[n] ?? n}
            </button>
          ))}
        </div>
        <div className="ch-scroll">
          <table className="ch-th ch-vtt">
            <thead>
              <tr className="band">
                <th rowSpan={2}>Gun</th>
                <th colSpan={VTT_BANDS.length}>Vehicle Target · TH# (Critical Hit on an original 2)</th>
              </tr>
              <tr>
                {VTT_BANDS.map((b) => (
                  <th key={b[0]} className="rng">
                    {bandLabel(b)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([key, r]) => (
                <tr key={key}>
                  <th className="gun">{key.split(':')[1]}</th>
                  {VTT_BANDS.map((_b, i) => {
                    const e = r.vtt![i];
                    return (
                      <td key={i} className="th">
                        {e ? (
                          <>
                            {e.black}
                            {e.red !== undefined && e.red !== e.black && <span className="red">/{e.red}</span>}
                          </>
                        ) : (
                          '–'
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="AP To Kill" refs="SK4 7.3" wide>
        <div className="ch-scroll">
          <table className="ch-th ch-tk">
            <thead>
              <tr className="band">
                <th rowSpan={2}>Gun</th>
                <th colSpan={TK_BANDS.length}>TK# (APCR / APDS)</th>
              </tr>
              <tr>
                {TK_BANDS.map((b) => (
                  <th key={b[0]} className="rng">
                    {bandLabel(b)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(TO_KILL_AP).map(([key, cells]) => (
                <tr key={key}>
                  <th className="gun">{tkLabel(key)}</th>
                  {cells.map((c, i) => (
                    <td key={i} className="th">
                      {c.ap === null ? '–' : c.ap}
                      {c.special !== null && <span className="ch">({c.special})</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Bullets items={D.TK_KEY} />
      </Card>
      <Lists lists={D.VEHICLE_LISTS} />
    </div>
  );
}

// ------------------------------------------------------------------------------------ AFV counter

/** A mark as the counter prints it: boxed, circled, red, on a white disc, or an MP background. */
function AfvMark({ m }: { m: D.Mark }) {
  return (
    <span className="afv-mark">
      {m.pre}
      <span className={m.s ? `m-${m.s}` : undefined}>{m.t}</span>
      {m.sup && <sup>{m.sup}</sup>}
    </span>
  );
}

/** The counter's areas, drawn where a 5/8" vehicle counter prints them; each is numbered as its key below. */
function AfvDiagram({ focus, setFocus }: { focus: number | null; setFocus(n: number | null): void }) {
  // [area, outline box x, y, w, h, badge x, y]
  const zones: [number, number, number, number, number, number, number][] = [
    [1, 30, 30, 32, 32, 14, 46],
    [2, 132, 28, 84, 36, 226, 46],
    [3, 186, 70, 30, 60, 226, 100],
    [4, 26, 128, 48, 22, 14, 139],
    [5, 30, 152, 26, 26, 14, 165],
    [6, 26, 180, 112, 40, 14, 206],
    [7, 148, 186, 70, 30, 226, 201],
    [8, 30, 34, 168, 168, 114, 18],
  ];
  const zone = (n: number) => ({
    className: `afv-zone ${focus === n ? 'on' : ''}`,
    onMouseEnter: () => setFocus(n),
    onMouseLeave: () => setFocus(null),
  });
  return (
    <svg className="afv-diagram" viewBox="0 0 240 240" role="img" aria-label="A vehicle counter, its areas numbered as the keys below">
      <rect className="afv-ctr" x="20" y="20" width="200" height="200" rx="9" />
      <g {...zone(8)}>
        <circle className="afv-turret-ring" cx="114" cy="118" r="84" />
        <g className="afv-tank" transform="translate(-8 -2) rotate(-35 122 120)">
          <rect x="94" y="78" width="56" height="88" rx="4" />
          <rect x="88" y="82" width="8" height="80" rx="2" />
          <rect x="148" y="82" width="8" height="80" rx="2" />
          <circle cx="122" cy="128" r="17" />
          <line x1="122" y1="111" x2="122" y2="54" />
        </g>
      </g>
      <g {...zone(1)}>
        <rect className="afv-ink-box" x="34" y="34" width="24" height="24" />
        <text className="afv-ink" x="46" y="53" textAnchor="middle" fontSize="18">A</text>
      </g>
      <g {...zone(2)}>
        <rect className="afv-white" x="136" y="32" width="76" height="28" rx="14" />
        <text className="afv-ink" x="190" y="54" textAnchor="middle" fontSize="24">13</text>
      </g>
      <g {...zone(3)}>
        <text className="afv-red" x="201" y="92" textAnchor="middle" fontSize="18">8</text>
        <rect className="afv-ink-box" x="191" y="102" width="20" height="22" />
        <text className="afv-ink" x="201" y="119" textAnchor="middle" fontSize="17">4</text>
      </g>
      <g {...zone(4)}>
        <text className="afv-ink" x="30" y="146" fontSize="16">B11</text>
      </g>
      <g {...zone(5)}>
        <rect className="afv-ink-box" x="33" y="155" width="20" height="20" />
        <text className="afv-ink" x="43" y="171" textAnchor="middle" fontSize="16">1</text>
      </g>
      <g {...zone(6)}>
        <text className="afv-ink" x="30" y="214" fontSize="38">75</text>
        <text className="afv-ink" x="80" y="212" fontSize="17">(20)</text>
      </g>
      <g {...zone(7)}>
        <text className="afv-ink" x="212" y="208" textAnchor="end" fontSize="18">2/-/4</text>
      </g>
      {zones.map(([n, x, y, w, h, bx, by]) => (
        <g key={n} className={`afv-callout ${focus === n ? 'on' : ''}`} onMouseEnter={() => setFocus(n)} onMouseLeave={() => setFocus(null)}>
          <rect className="afv-outline" x={x} y={y} width={w} height={h} rx="3" />
          <circle cx={bx} cy={by} r="9" />
          <text x={bx} y={by + 4} textAnchor="middle">{n}</text>
        </g>
      ))}
    </svg>
  );
}

const pt = (c: [number, number], deg: number, r: number) => [c[0] + r * Math.cos((deg * Math.PI) / 180), c[1] + r * Math.sin((deg * Math.PI) / 180)] as const;

/** Where each MG points: the bow MGs along the hull, the coaxial MGs and MA along the turret, the AAMG all round. */
function MgArcs() {
  const c: [number, number] = [128, 92];
  const hull = -18;
  const tur = 24;
  const ray = (deg: number, r0: number, r1: number, cls: string, label: string, lr: number, shift = 0) => {
    const off = (p: readonly [number, number] | readonly number[]) => pt([p[0]!, p[1]!], deg + 90, shift);
    const [x0, y0] = off(pt(c, deg, r0));
    const [x1, y1] = off(pt(c, deg, r1));
    const [lx, ly] = off(pt(c, deg, lr));
    return (
      <g className={cls}>
        <line x1={x0} y1={y0} x2={x1} y2={y1} markerEnd={`url(#afv-head-${cls})`} />
        <text x={lx} y={ly + 4} textAnchor="middle">{label}</text>
      </g>
    );
  };
  return (
    <svg className="afv-arcs" viewBox="0 0 260 180" role="img" aria-label="Vehicle MG directions">
      <defs>
        {['mg', 'ma'].map((k) => (
          <marker key={k} id={`afv-head-${k}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0 0 10 5 0 10z" />
          </marker>
        ))}
      </defs>
      <g className="afv-tank-top" transform={`rotate(${hull} ${c[0]} ${c[1]})`}>
        <rect x={c[0] - 56} y={c[1] - 30} width="112" height="60" rx="5" />
        <rect x={c[0] - 58} y={c[1] - 36} width="116" height="9" rx="2" />
        <rect x={c[0] - 58} y={c[1] + 27} width="116" height="9" rx="2" />
      </g>
      <g className="afv-tank-top" transform={`rotate(${tur} ${c[0]} ${c[1]})`}>
        <circle cx={c[0]} cy={c[1]} r="19" />
        <line x1={c[0] + 19} y1={c[1]} x2={c[0] + 76} y2={c[1]} />
      </g>
      <path className="afv-aa" d={`M ${c[0] - 27} ${c[1] - 6} A 28 28 0 1 1 ${c[0] - 20} ${c[1] + 20}`} markerEnd="url(#afv-head-mg)" />
      <text className="afv-aa-label" x={c[0] - 30} y={c[1] - 34} textAnchor="middle">AAMG</text>
      {ray(hull, 62, 104, 'mg', 'BMG', 116, -14)}
      {ray(hull + 180, 62, 100, 'mg', 'RBMG', 116, 14)}
      {ray(tur, 78, 104, 'ma', 'MA', 116)}
      {ray(tur, 24, 66, 'mg', 'CMG', 82, 11)}
      {ray(tur + 180, 24, 62, 'mg', 'RCMG', 84, -16)}
    </svg>
  );
}

/** The line around the vehicle depiction that gives the turret type. */
function TurretGlyph({ kind }: { kind: 'NT' | 'T' | 'ST' | 'RST' | '1MT' }) {
  return (
    <svg className="afv-tglyph" viewBox="0 0 40 40" aria-hidden>
      <rect className="afv-ctr" x="1" y="1" width="38" height="38" rx="4" />
      {kind === 'T' && <circle className="thin" cx="20" cy="20" r="16" />}
      {kind === 'ST' && <rect className="thin" x="7" y="7" width="26" height="26" />}
      {kind === 'RST' && <rect className="thick" x="8" y="8" width="24" height="24" />}
      {kind === '1MT' && <path className="thick" d="M8 14V8h6M26 8h6v6M32 26v6h-6M14 32H8v-6" />}
      <text x="20" y={kind === 'NT' ? 24 : 24.5} textAnchor="middle">{kind === 'NT' ? '—' : kind}</text>
    </svg>
  );
}

const TURRET_NAME = Object.fromEntries(D.TURRET_TYPES.map((t) => [t.kind, t.name]));
const SIZE_NAME: Record<VehicleDef['targetSize'], string> = {
  veryLarge: 'Very Large target (−2 To Hit)',
  large: 'Large target (−1 To Hit)',
  normal: 'Average target',
  small: 'Small target (+1 To Hit)',
  verySmall: 'Very Small target (+2 To Hit)',
};
const AMMO_NAME: Record<SpecialAmmoDef['kind'], string> = { HE: 'HE', AP: 'AP', HEAT: 'HEAT', APCR: 'APCR', APDS: 'APDS', SMOKE: 'Smoke', WP: 'WP' };
const ammoSteps = (a: SpecialAmmoDef) =>
  a.steps.map((s) => (s.from ? `${s.n} from ${s.from.month ? `${s.from.month}/` : ''}${String(s.from.year).slice(2)}` : String(s.n))).join(', ') +
  (a.theater ? ` (${a.theater} only)` : '');
const mgFp = (n?: number) => (n === undefined ? '–' : String(n));

/** One vehicle read area by area, from the engine's own counter data. */
function decode(v: VehicleDef): [number, string, string][] {
  const ma = v.ma;
  const rows: [number, string, string][] = [];
  rows.push([1, 'Ground pressure', `${v.groundPressure[0]!.toUpperCase()}${v.groundPressure.slice(1)}${v.unitId ? ` · identifier ${v.unitId}` : ''}`]);
  rows.push([2, 'Movement', `${v.mp} MP, ${v.tracked ? 'Fully Tracked' : 'Armored Car'}${v.redMp ? ' · red MP: Mechanical Reliability DR on each start' : ''}${v.stallOn11 ? ' (stalls on 11)' : ''}`]);
  const { hull, turret } = v.af;
  const tdiff = v.turret !== 'NT' && (turret.front !== hull.front || turret.side !== hull.side);
  rows.push([
    3,
    'Armor',
    `Hull ${hull.front} front, ${hull.side} side/rear` +
      (tdiff ? ` · turret ${turret.front}/${turret.side} (${turret.front > hull.front || turret.side > hull.side ? 'superior' : 'inferior'})` : '') +
      ` · ${SIZE_NAME[v.targetSize]}${v.openTopped ? ' · Open-Topped' : ''}`,
  ]);
  if (ma) {
    rows.push([4, 'MA breakdown', `B${ma.b ?? 12}${ma.b === undefined ? ' (none printed)' : ''}${ma.lowAmmo ? ' · circled: Low Ammo' : ''}`]);
    rows.push([5, 'MA ROF', ma.rof ? String(ma.rof) : v.maMg?.rof ? String(v.maMg.rof) : 'None']);
    const ammo = ma.ammo.he && ma.ammo.ap ? 'HE and AP' : ma.ammo.he ? 'HE only' : ma.ammo.ap ? 'AP only' : 'no HE or AP';
    const special = ma.specialAmmo?.map((a) => `${AMMO_NAME[a.kind]} ${ammoSteps(a)}`).join(' · ');
    const vel = ma.barrel === 'L' ? ', high velocity' : ma.barrel === 'LL' ? ', very high velocity' : ma.barrel === '*' ? ', low velocity' : '';
    rows.push([
      6,
      'Main Armament',
      v.maMg
        ? `Its ${v.maMg.mg.toUpperCase()} is the MA`
        : `${ma.caliber}${ma.barrel ?? ''} ${ma.type}${vel} · ${ammo}${ma.ife ? ` · IFE ${ma.ife}` : ''}${ma.noIntensive ? ' · no Intensive Fire' : ''}${special ? ` · ${special}` : ''}`,
    ]);
  } else rows.push([6, 'Main Armament', 'None']);
  const mg = v.mg;
  rows.push([
    7,
    'Machine guns',
    `${mgFp(mg.bmg)}/${mgFp(mg.cmg)}${mg.aamg !== undefined ? `/${mg.aamg}` : ''}${mg.bmgFixed ? ' · Fixed-mount BMG' : ''}${mg.rmg !== undefined ? ` · rear MG ${mg.rmg}` : ''}`,
  ]);
  rows.push([8, 'Turret', TURRET_NAME[v.turret] ?? v.turret]);
  return rows;
}

function AfvSection({ nationalities }: { nationalities?: string[] }) {
  const [focus, setFocus] = useState<number | null>(null);
  const vehicles = useMemo(() => Object.values(COUNTERS).filter((d): d is VehicleDef => d.kind === 'vehicle'), []);
  const nations = useMemo(() => [...new Set(vehicles.map((v) => v.nationality))], [vehicles]);
  const [nation, setNation] = useState(() => nationalities?.find((n) => nations.includes(n)) ?? nations[0]!);
  const list = vehicles.filter((v) => v.nationality === nation);
  const [pick, setPick] = useState<string | null>(null);
  const picked = list.find((v) => v.id === pick) ?? list[0];
  const img = picked && counterImage(picked.id, false);
  const hover = (n: number) => ({ onMouseEnter: () => setFocus(n), onMouseLeave: () => setFocus(null) });
  return (
    <div className="ch-grid">
      <Card title="Anatomy of an AFV counter" refs="ASLRB D1 · SK4 1.2.7" wide>
        <div className="afv-anatomy">
          <AfvDiagram focus={focus} setFocus={setFocus} />
          <ol className="afv-index">
            {D.AFV_KEYS.map((k) => (
              <li key={k.n} className={focus === k.n ? 'on' : ''} {...hover(k.n)}>
                <span className="afv-n">{k.n}</span>
                <span className="afv-index-title">{k.title}</span>
                <span className="afv-index-ex">
                  {k.example.m.map((m, i) => (
                    <AfvMark key={i} m={m} />
                  ))}
                  <span>{k.example.text}</span>
                </span>
              </li>
            ))}
            <li className={focus === 8 ? 'on' : ''} {...hover(8)}>
              <span className="afv-n">8</span>
              <span className="afv-index-title">Turret traverse</span>
              <span className="afv-index-ex">
                <span>The line around the depiction: thin circle, Fast Traverse</span>
              </span>
            </li>
          </ol>
        </div>
        <p className="ch-foot">Anything the front does not show (Special Ammo, smoke dispensers, Crew Survival) is on the back of the counter or in the Vehicle Notes.</p>
      </Card>
      <div className="afv-keys">
        {D.AFV_KEYS.map((k) => (
          <section key={k.n} className={`ch-card afv-key ${focus === k.n ? 'on' : ''}`} {...hover(k.n)}>
            <header>
              <h3>
                <span className="afv-n">{k.n}</span>
                {k.title}
              </h3>
              {k.ref && <span className="ch-ref">{k.ref}</span>}
            </header>
            {k.n === 7 && <MgArcs />}
            <p className="afv-example">
              {k.example.m.map((m, i) => (
                <AfvMark key={i} m={m} />
              ))}
              <span>{k.example.text}</span>
            </p>
            <table className="ch-drm afv-rows">
              <tbody>
                {k.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="v">
                      {r.m.map((m, j) => (
                        <AfvMark key={j} m={m} />
                      ))}
                    </td>
                    <td className="l">{r.label}</td>
                    <td className="r">{r.ref}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {k.notes && <Bullets items={k.notes.map((text) => ({ text }))} />}
          </section>
        ))}
        <section className={`ch-card afv-key ${focus === 8 ? 'on' : ''}`} {...hover(8)}>
          <header>
            <h3>
              <span className="afv-n">8</span>
              Turret traverse
            </h3>
            <span className="ch-ref">SK4 7.2</span>
          </header>
          <ul className="afv-turrets">
            {D.TURRET_TYPES.map((t) => (
              <li key={t.kind}>
                <TurretGlyph kind={t.kind} />
                <div>
                  <b>{t.name}</b>
                  <span className="ch-ref inline">{t.ref}</span>
                  {t.text && <span className="note">{t.text}</span>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <Card title="Read a counter" refs="from the game's counter data" wide>
        <div className="ch-seg" role="tablist" aria-label="Nationality">
          {nations.map((n) => (
            <button key={n} role="tab" aria-selected={n === nation} className={`side-${n} ${n === nation ? 'on' : ''}`} onClick={() => { setNation(n); setPick(null); }}>
              {NATION[n] ?? n}
            </button>
          ))}
        </div>
        <div className="afv-read">
          <div className="afv-pick" role="listbox" aria-label="Vehicle">
            {list.map((v) => (
              <button key={v.id} role="option" aria-selected={v.id === picked?.id} className={v.id === picked?.id ? 'on' : ''} onClick={() => setPick(v.id)}>
                {v.name}
              </button>
            ))}
          </div>
          {picked && (
            <div className={`afv-decoded side-${picked.nationality}`}>
              {img && <img src={img} alt={picked.name} className="afv-read-img" />}
              <table className="ch-drm">
                <tbody>
                  {decode(picked).map(([n, k, text]) => (
                    <tr key={n} className={focus === n ? 'on' : ''} {...hover(n)}>
                      <td className="v">
                        <span className="afv-n">{n}</span>
                      </td>
                      <td className="l">
                        <b>{k}</b> {text}
                      </td>
                    </tr>
                  ))}
                  {picked.smoke?.length ? (
                    <tr>
                      <td className="v" />
                      <td className="l">
                        <b>Smoke dispensers</b> {picked.smoke.map((s) => `${s.kind}${s.n}`).join(', ')}
                      </td>
                    </tr>
                  ) : null}
                  {picked.note !== undefined && (
                    <tr>
                      <td className="v" />
                      <td className="l">
                        <b>Vehicle Note</b> {picked.note}
                        {picked.cs !== undefined && ` · Crew Survival ${picked.cs}`}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------------------------ Sequence of Play

function SequenceSection() {
  return (
    <ol className="ch-seq">
      {D.SEQUENCE.map((p) => (
        <li key={p.abbr}>
          <div className="ch-seq-head">
            <span className="abbr">{p.abbr}</span>
            <span className="name">{p.name}</span>
            <span className="who">{p.who}</span>
            {p.ref && <span className="ch-ref">{p.ref}</span>}
          </div>
          <Bullets items={p.steps} />
        </li>
      ))}
    </ol>
  );
}
