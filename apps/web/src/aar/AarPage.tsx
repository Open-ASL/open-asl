import { useEffect, useState } from 'react';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { Link, useParams } from 'react-router';
import { COL, COMPUTER_NAME, type AarCasualty, type AarDoc, type AarHighlight, type AarSide, type MatchDoc } from '@asl/platform';
import { useAuth } from '../auth/AuthProvider';
import { db } from '../firebase';
import { Emblem as NationEmblem } from '../fx/TurnChit';
import { counterImage } from '../game/assets';
import { PHASE_NAME } from '../game/describe';
import { Emblem } from '../ui/Emblem';
import { toDate } from '../ui/time';
import { DiceChart, LuckChart, RaceChart, StrengthChart } from './charts';
import { SITE_HOST } from '../siteConfig';
import { loginPath, replayPath } from './links';

/*
 * The after action report of a finished match, at /aar/:matchId. Public: anyone with the link
 * reads it; only replaying the recording asks for an account. Everything shown comes from the
 * stored `aars/{matchId}` document the server wrote when the match completed.
 */

const PHASE_ORDER = Object.keys(PHASE_NAME);
const SHOWN_HIGHLIGHTS = 8;

export function AarPage() {
  const { matchId = '' } = useParams<{ matchId: string }>();
  const auth = useAuth();
  const [report, setReport] = useState<AarDoc | null | undefined>(undefined);
  useEffect(() => {
    if (!matchId) return;
    setReport(undefined);
    return onSnapshot(
      doc(db, COL.aars, matchId),
      (snap) => setReport((snap.data() as AarDoc | undefined) ?? null),
      () => setReport(null),
    );
  }, [matchId]);
  if (report === undefined) return <Shell><p className="aar-loading">Reading the after action report…</p></Shell>;
  if (!report) return <Shell><MissingReport matchId={matchId} signedIn={auth.status === 'member'} /></Shell>;
  return <Shell><Report report={report} /></Shell>;
}

function Shell({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const member = auth.status === 'member';
  return (
    <div className="public-profile-shell aar-shell">
      <header>
        <Link to="/" className="command-brand" aria-label="Open ASL"><Emblem /><span><b>OPEN ASL</b><small>After action report</small></span></Link>
        <nav>{member ? <Link to="/app">Enter Lobby</Link> : <Link to="/login">Sign in</Link>}</nav>
      </header>
      <div className="aar-page">{children}</div>
    </div>
  );
}

/**
 * No report document (yet). A player who just finished a public game sees it being prepared
 * for a short while, since the server writes it a moment after scoring; everyone else, and the
 * player once the wait is over, is told why there is none.
 */
function MissingReport({ matchId, signedIn }: { matchId: string; signedIn: boolean }) {
  const [pending, setPending] = useState<boolean | null>(null);
  useEffect(() => {
    if (!signedIn) return setPending(false);
    let live = true;
    void getDoc(doc(db, COL.matches, matchId))
      .then((snap) => {
        const m = snap.data() as MatchDoc | undefined;
        if (live) setPending(!!m && (m.status === 'active' || m.status === 'complete') && (m.visibility ?? 'public') === 'public');
      })
      .catch(() => { if (live) setPending(false); });
    return () => { live = false; };
  }, [matchId, signedIn]);
  // The server writes the report in its own function once the match is scored; a long game takes it a minute or two.
  useEffect(() => {
    if (!pending) return;
    const id = setTimeout(() => setPending(false), 180_000);
    return () => clearTimeout(id);
  }, [pending]);
  if (pending === null || pending) return <p className="aar-loading">{pending ? 'Preparing the report… a long game takes a minute or two.' : 'Reading the after action report…'}</p>;
  return (
    <section className="aar-card aar-hero aar-missing">
      <span className="eyebrow">After action report</span>
      <h1>No report for this game</h1>
      <p>Private games do not get an after action report. Public games, games against {COMPUTER_NAME} and hotseat games get a shareable report with casualties, dice luck and highlights.</p>
      <Link to="/" className="btn">Open ASL</Link>
    </section>
  );
}

function Report({ report }: { report: AarDoc }) {
  const auth = useAuth();
  const sideOf = (id: string | null | undefined) => report.sides.find((s) => s.side === id);
  const sideName = (id: string) => sideOf(id)?.name ?? id;
  const winner = sideOf(report.result.winner);
  const loser = report.sides.find((s) => s.side !== report.result.winner) ?? report.sides[1];
  const signedOut = auth.status === 'signed-out';
  const replay = signedOut ? loginPath(replayPath(report.matchId)) : replayPath(report.matchId);
  const played = toDate(report.playedAt);
  const hrs = report.durationMin === null ? null : Math.floor(report.durationMin / 60);
  const mins = report.durationMin === null ? null : report.durationMin % 60;
  const kind = report.competition === 'ranked' ? 'Ranked' : report.mode === 'hotseat' ? 'Hotseat' : report.mode === 'computer' ? `vs ${COMPUTER_NAME}` : 'Friendly';
  const highlights = [...report.highlights]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, SHOWN_HIGHLIGHTS)
    .sort((a, b) => a.turn - b.turn || PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase));

  return (
    <>
      <section className="aar-card aar-hero">
        <div className="aar-head">
          <div className="scenario">
            <span className="eyebrow">After action report · {kind}{played ? ` · ${played.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}</span>
            <h1>{report.scenario.number} {report.scenario.title}</h1>
            <div className="meta">
              <span>{[report.scenario.place, report.scenario.date].filter(Boolean).join(', ')}</span>
              <span>{report.scenario.turns} turns</span>
              {hrs !== null && <span>Played in {hrs ? `${hrs} h ` : ''}{mins} min</span>}
            </div>
          </div>
          <div className="actions">
            <Link className="btn primary" to={replay}>{signedOut ? 'Sign in to replay' : '▶ Replay the match'}</Link>
            <ShareButton matchId={report.matchId} title={`${report.scenario.number} ${report.scenario.title} · Open ASL`} />
            <span className="hint">Replaying needs a free Open ASL account.</span>
          </div>
        </div>
        <div className={`result-band ${winner ? `side-${winner.side}` : ''}`}>
          <div>
            <div className="kicker">{winner ? 'Victory' : 'Draw'}</div>
            <div className="big">{winner ? winner.name : 'Stalemate'}</div>
            <div className="how">{report.result.how}</div>
            <div className="reason">{report.result.reason} · Turn {report.result.endedTurn}, {PHASE_NAME[report.result.endedPhase] ?? report.result.endedPhase}</div>
          </div>
          <div className="vs">
            {winner ? <Who side={winner} competition={report.competition} /> : report.sides[0] && <Who side={report.sides[0]} competition={report.competition} />}
            <span className="vsmark">VS</span>
            {loser && <Who side={loser} competition={report.competition} />}
          </div>
        </div>
      </section>

      <div className="two">
        <section className="aar-card">
          <div className="card-head"><h2>How it was won</h2><span className="muted">{report.scenario.victoryText ? 'Victory conditions as printed' : 'Victory conditions'}</span></div>
          <div className="vc">
            {report.scenario.victoryText && <blockquote>{report.scenario.victoryText}</blockquote>}
            {report.victory.map((v, i) => (
              <div key={i} className="vc-row">
                <div>
                  <div className="vc-text">{v.text}</div>
                  {v.items.length > 0 && (
                    <div className="chips">
                      {v.items.map((it, k) => (
                        <span key={k} className={`chip ${it.holder ? `side-${it.holder}` : 'none'}`}><i />{it.label}{it.holder ? ` · ${sideName(it.holder)}${it.since ? ` since ${it.since}` : ''}` : ''}</span>
                      ))}
                    </div>
                  )}
                </div>
                <span className={`ok ${v.met ? '' : 'not'}`}>{v.met ? 'Met' : 'Not met'} · {v.have}/{v.need}</span>
              </div>
            ))}
          </div>
        </section>
        {report.control ? (
          <section className="aar-card">
            <div className="card-head"><h2>{report.control.kind === 'buildings' ? 'Building control' : 'Hex control'}</h2><span className="muted">Who held each objective at the end of every turn</span></div>
            <div className="control-grid" style={{ gridTemplateColumns: `54px repeat(${report.control.byTurn.length}, 1fr)` }}>
              <span />
              {report.control.byTurn.map((_, t) => <span key={t} className="turn">T{t + 1}</span>)}
              {report.control.labels.map((label, i) => (
                <ControlRow key={label} label={label} index={i} control={report.control!} sideName={sideName} />
              ))}
            </div>
            <div className="legend">
              {report.sides.map((s) => <span key={s.side} className={`side-${s.side}`}><i className="dot" />{s.name}</span>)}
              <span>▣ changed hands that turn</span>
            </div>
          </section>
        ) : report.race ? (
          <section className="aar-card">
            <div className="card-head"><h2>{report.race.label}</h2><span className="muted">Per player turn</span></div>
            <RaceChart data={report.race} sideName={sideName} />
            <Legend sides={report.sides} />
          </section>
        ) : null}
      </div>

      <section className="aar-card">
        <div className="card-head"><h2>The course of the battle</h2><span className="muted">Squad-equivalents on the board at the end of each player turn · half-squads count ½ · leaders not counted</span></div>
        <StrengthChart data={report.strength} sideName={sideName} />
        <Legend sides={report.sides} extra={<span><i className="dot neutral" />a loss in that player turn</span>} />
      </section>

      <div className="two">
        <section className="aar-card">
          <div className="card-head"><h2>Dice distribution</h2><span className="muted">Share of each side's DRs by result, against the 2d6 curve</span></div>
          <DiceChart hist={report.dice} sideName={sideName} />
          <Legend sides={report.sides} extra={<span><i className="gray" />Expected 2d6</span>} />
        </section>
        <section className="aar-card">
          <div className="card-head"><h2>Luck swing</h2><span className="muted">Running total of (7 − DR) across the match · above zero is lucky</span></div>
          <LuckChart data={report.luck} sideName={sideName} />
          <Legend sides={report.sides} extra={<><span><i className="dot good" />original 2</span><span><i className="dot bad" />original 12</span></>} />
        </section>
      </div>

      <section className="aar-card">
        <div className="card-head"><h2>Dice luck</h2><span className="muted">What the dice did for each side</span></div>
        <div className="dice-cols">
          {report.sides.map((s) => <DiceTiles key={s.side} side={s} dice={report.dice[s.side]} />)}
        </div>
      </section>

      <section className="aar-card">
        <div className="card-head"><h2>Casualties</h2><span className="muted">Every loss, in the order it happened · CVP as the Casualty Victory Point table counts them</span></div>
        <div className="two">
          {report.sides.map((s) => <CasualtyTable key={s.side} side={s} rows={report.casualties.filter((c) => c.side === s.side)} />)}
        </div>
      </section>

      {highlights.length > 0 && (
        <section className="aar-card">
          <div className="card-head"><h2>Highlights</h2><span className="muted">Moments worth telling the story around</span></div>
          <ul className="hl-list">
            {highlights.map((h, i) => <Highlight key={i} h={h} sideName={sideName} />)}
          </ul>
        </section>
      )}

      <footer className="aar-foot">
        <div className="actions">
          <Link className="btn primary" to={replay}>{signedOut ? 'Sign in to replay' : '▶ Replay the match'}</Link>
          <ShareButton matchId={report.matchId} title={`${report.scenario.number} ${report.scenario.title} · Open ASL`} />
        </div>
        <span>Replaying needs an Open ASL account · the report itself is public</span>
        <span className="eyebrow">Generated by Open ASL{SITE_HOST ? ` · ${SITE_HOST}` : ''}</span>
      </footer>
    </>
  );
}

function SideMark({ side }: { side: AarSide }) {
  return (
    <span className={`side-badge side-${side.side}`}>
      <i className="side-emblem" aria-hidden><svg viewBox="-24 -24 48 48"><NationEmblem side={side.nationality} /></svg></i>
      <span>{side.name}</span>
    </span>
  );
}

function Who({ side, competition }: { side: AarSide; competition: string }) {
  const p = side.player;
  const delta = p.eloDelta !== undefined
    ? <span className={`delta ${p.eloDelta > 0 ? 'up' : p.eloDelta < 0 ? 'down' : ''}`}>{p.eloDelta > 0 ? '+' : p.eloDelta < 0 ? '−' : '±'}{Math.abs(p.eloDelta)} Elo</span>
    : competition === 'ranked' ? null : <span className="delta">{p.computer ? COMPUTER_NAME : 'Friendly'}</span>;
  const name = p.computer || !p.uid ? <span className="nick">{p.nickname}</span> : <Link className="nick" to={`/profile/${p.nickname.toLowerCase()}`}>{p.nickname}</Link>;
  return (
    <div className={`who side-${side.side}`}>
      <SideMark side={side} />
      {name}
      <span className="delta">{p.elo !== undefined ? <>{p.elo} · </> : null}{delta}</span>
    </div>
  );
}

function ControlRow({ label, index, control, sideName }: { label: string; index: number; control: NonNullable<AarDoc['control']>; sideName(s: string): string }) {
  return (
    <>
      <span className="rowlabel">{label}</span>
      {control.byTurn.map((row, t) => {
        const holder = row.holders[index] ?? null;
        const flip = t > 0 && (control.byTurn[t - 1]?.holders[index] ?? null) !== holder;
        return <span key={t} className={`cell ${holder ? `side-${holder}` : 'none'} ${flip ? 'flip' : ''}`} title={`${label} · end of Turn ${t + 1} · ${holder ? sideName(holder) : 'nobody'}`} />;
      })}
    </>
  );
}

function Legend({ sides, extra }: { sides: AarSide[]; extra?: React.ReactNode }) {
  return (
    <div className="legend">
      {sides.map((s) => <span key={s.side} className={`side-${s.side}`}><i />{s.name}</span>)}
      {extra}
    </div>
  );
}

function DiceTiles({ side, dice }: { side: AarSide; dice: AarDoc['dice'][string] | undefined }) {
  if (!dice) return null;
  const luck = dice.drs === 0 ? '' : dice.avg < 7 ? 'lucky' : dice.avg > 7 ? 'unlucky' : '';
  const expected = (dice.drs / 36).toFixed(1);
  return (
    <div className={`dice-side side-${side.side}`}>
      <SideMark side={side} />
      <div className="tiles">
        <div className={`tile ${luck}`}><span className="k">Average DR</span><span className="v">{dice.drs ? dice.avg.toFixed(2) : '—'}</span><span className="s">{dice.drs ? `${dice.avg < 7 ? `${(7 - dice.avg).toFixed(2)} under` : dice.avg > 7 ? `${(dice.avg - 7).toFixed(2)} over` : 'exactly'} 7.00 · ${dice.drs} DRs` : 'no DRs'}</span></div>
        <div className="tile"><span className="k">Original 2s</span><span className="v">{dice.twos}</span><span className="s">expected {expected}</span></div>
        <div className="tile"><span className="k">Original 12s</span><span className="v">{dice.twelves}</span><span className="s">expected {expected}</span></div>
        <div className="tile"><span className="k">Morale checks</span><span className="v">{dice.mc.passed}<small>/ {dice.mc.passed + dice.mc.failed}</small></span><span className="s">passed</span></div>
        <div className="tile"><span className="k">Rallies</span><span className="v">{dice.rally.made}<small>/ {dice.rally.made + dice.rally.failed}</small></span><span className="s">made</span></div>
        <div className="tile"><span className="k">ELR failures</span><span className="v">{dice.elr}</span><span className="s">units replaced</span></div>
        <div className="tile"><span className="k">Heat of Battle</span><span className="v">{dice.hob}</span><span className="s">leaders created</span></div>
        <div className="tile"><span className="k">Best streak</span><span className="v">{dice.streak}</span><span className="s">checks passed in a row</span></div>
      </div>
    </div>
  );
}

function CounterImage({ c }: { c: AarCasualty }) {
  const [broken, setBroken] = useState(false);
  const src = counterImage(c.def, false);
  if (!src || broken) return <span className="fallback">{c.label.split(' ')[0]}</span>;
  return <img src={src} alt="" width={30} height={30} onError={() => setBroken(true)} />;
}

function CasualtyTable({ side, rows }: { side: AarSide; rows: AarCasualty[] }) {
  const total = rows.reduce((a, c) => a + c.cvp, 0);
  return (
    <div>
      <div className="cas-head"><SideMark side={side} /><span className="muted">{rows.filter((c) => c.kind === 'eliminated').length} eliminated · {rows.filter((c) => c.kind === 'reduced').length} reduced</span></div>
      <div className="table-wrap">
        <table className="cas-table">
          <thead><tr><th>When</th><th>Unit</th><th>Where</th><th>How</th><th className="cvp">CVP</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="muted">No losses.</td></tr>}
            {rows.map((c, i) => (
              <tr key={i} className={`${c.kind} ${c.leader ? 'leader' : ''} ${c.vehicle ? 'vehicle' : ''}`}>
                <td className="when">T{c.turn} {(PHASE_NAME[c.phase] ?? c.phase).replace(/ Phase$/, '')}</td>
                <td className="unit"><CounterImage c={c} /><b>{c.label}</b>{c.sw ? <span className="muted"> + {c.sw}</span> : null}</td>
                <td className="mono">{c.hex ?? '—'}</td>
                <td>{c.cause}</td>
                <td className="cvp">{c.cvp}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={4}>{side.name} losses</td><td className="cvp">{total}</td></tr></tfoot>
        </table>
      </div>
    </div>
  );
}

function Highlight({ h, sideName }: { h: AarHighlight; sideName(s: string): string }) {
  return (
    <li className={`hl ${h.side ? `side-${h.side}` : ''}`}>
      <span className="when"><b>T{h.turn}</b>{(PHASE_NAME[h.phase] ?? h.phase).replace(/ Phase$/, '')}</span>
      <span>
        <span className="title">{h.title}{h.side ? <span className="muted"> · {sideName(h.side)}</span> : null}</span>
        <div className="text">{h.text}</div>
      </span>
    </li>
  );
}

function ShareButton({ matchId, title }: { matchId: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${location.origin}/aar/${matchId}`;
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title, url });
      else { await navigator.clipboard.writeText(url); setCopied(true); }
    } catch {
      // The share sheet was dismissed, or the clipboard refused: nothing to report.
    }
  };
  return <button className="btn" onClick={share}>{copied ? 'Link copied' : 'Share'}</button>;
}
