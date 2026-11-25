import { SS_WIDTHS } from '@asl/platform';
import { Icon, SPEEDS, Timeline } from '../match/ReplayBoard';
import { nextTurnStep, prevTurnStep } from '../match/replayTimeline';
import type { SsCommand, SsControlsState, SsTool } from './bridge';
import { SHOT_MODES } from './checks';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

const TOOLS: { tool: SsTool; label: string; key: string; hint: string }[] = [
  { tool: 'look', label: 'Look', key: '1', hint: 'Click a hex to inspect its stack; drag to pan.' },
  { tool: 'ping', label: 'Ping', key: '2', hint: 'Click a hex to ping it for the other commentators (Ctrl+click pings with any tool).' },
  { tool: 'draw', label: 'Draw', key: '3', hint: 'Drag on the map to draw in your colour.' },
  { tool: 'los', label: 'LOS', key: '4', hint: 'Click the hex to look from, then the hex to look at.' },
  { tool: 'shot', label: 'Shot', key: '5', hint: 'Click the firing hex (Shift+click adds more), then the target hex, empty or not.' },
  { tool: 'move', label: 'Move', key: '6', hint: 'Drag a stack to another hex, or click a hex to move or remove its counters. Only the commentators see it.' },
];

const hexName = (h: string) => h.replace(/^[a-z]+/, '');

/**
 * A commentator's controls, in large type: the position (live, or any step of the recording), whose hidden information
 * is shown, the map tools and the ink. The same panel is docked beside the board or popped out into its own window,
 * so the stream can show the board alone.
 */
export function SsControls({ state, send, onPopOut, docked }: { state: SsControlsState; send(c: SsCommand): void; onPopOut?(): void; docked: boolean }) {
  const { step, last, marks } = state;
  const seek = (to: number) => send({ type: 'seek', step: Math.max(0, Math.min(last, to)) });
  // The timeline waits while the board is virtual.
  const held = !!state.virtual;
  return (
    <div className={`ss-controls${docked ? ' docked' : ''}`} aria-label="Commentator controls">
      <header className="ss-head">
        <span className="ss-kicker">Commentary</span>
        <b className="ss-title">{state.title}</b>
        <div className="ss-members">
          {state.members.map((m) => (
            <span key={m.uid} className="ss-member" style={{ ['--c' as string]: hex(m.color) }}>{m.name}</span>
          ))}
        </div>
        {onPopOut && <button className="ss-btn ghost" onClick={onPopOut} title="Open these controls in their own window, so the stream shows the board alone">Pop out ⧉</button>}
      </header>
      {state.error && <p className="ss-error">{state.error}</p>}

      <section className={`ss-section${state.virtual ? ' ss-virtual' : ''}`}>
        <h3>Board</h3>
        {state.virtual ? (
          <>
            <p className="ss-alert">
              Virtual board: {state.virtual.changes} change{state.virtual.changes === 1 ? '' : 's'} to step {state.virtual.base}
              {state.virtual.behind > 0 ? ` · the game is ${state.virtual.behind} action${state.virtual.behind === 1 ? '' : 's'} on` : ''}
            </p>
            <button className="ss-btn ss-snap" onClick={() => send({ type: 'snapBack' })}>
              {state.live ? '⟲ Snap back to live' : '⟲ Snap back to the game'}
            </button>
          </>
        ) : (
          <p className="ss-hint">The real game{state.following && state.live ? ', live' : ''}. Move or remove counters with the Move tool to make a virtual board.</p>
        )}
      </section>

      <section className="ss-section">
        <h3>Position</h3>
        <div className="ss-where">
          <b>{state.where}</b>
          <span>Step {step} of {last}</span>
        </div>
        <div className="ss-row">
          <button className="ss-btn" onClick={() => seek(0)} disabled={held || step === 0} aria-label="Start"><Icon d="M6 5v14M19 5 9 12l10 7z" /></button>
          <button className="ss-btn" onClick={() => seek(prevTurnStep(marks, step))} disabled={held || step === 0} aria-label="Previous Player Turn">«</button>
          <button className="ss-btn" onClick={() => seek(step - 1)} disabled={held || step === 0} aria-label="Step back">‹</button>
          <button className="ss-btn" onClick={() => seek(step + 1)} disabled={held || step >= last} aria-label="Step forward">›</button>
          <button className="ss-btn" onClick={() => seek(nextTurnStep(marks, step, last))} disabled={held || step >= last} aria-label="Next Player Turn">»</button>
          <button className={`ss-btn ss-live${state.following ? ' on' : ''}`} onClick={() => send({ type: 'follow' })} disabled={held || state.following} title={state.live ? 'Follow the game as it is played' : 'The end of the game'}>
            {state.live ? '● Back to live' : 'To the end'}
          </button>
        </div>
        <div className="ss-row" role="group" aria-label="Autoplay">
          <button
            className={`ss-btn ss-play${state.playing ? ' on' : ''}`}
            onClick={() => send({ type: 'play' })}
            disabled={!state.playing && (held || (state.following && state.live))}
            aria-label={state.playing ? 'Pause' : 'Play'}
            title={held ? 'Snap back to play the game' : state.following && state.live ? 'Already following the game live' : 'Play every commentator\'s board on together (Space)'}
          >
            {state.playing ? (
              <>
                <Icon d="M8 5v14M16 5v14" /> Pause
              </>
            ) : (
              <>
                <Icon d="M7 5l12 7-12 7z" /> Play
              </>
            )}
          </button>
          {SPEEDS.map((sp, i) => (
            <button key={sp.label} className={`ss-btn small${state.speed === i ? ' on' : ''}`} aria-pressed={state.speed === i} onClick={() => send({ type: 'speed', speed: i })}>
              {sp.label}
            </button>
          ))}
          {state.playing && <span className="ss-hint">Played by {state.driver}</span>}
        </div>
        {held ? <p className="ss-hint">Snap back to move through the game again.</p> : <Timeline step={step} last={last} marks={marks} onJump={seek} sideName={(s) => state.sides.find((x) => x.side === s)?.name ?? s} />}
      </section>

      <section className="ss-section">
        <h3>Hidden information</h3>
        {state.sides.map(({ side, name }) => (
          <label key={side} className="ss-toggle">
            <input type="checkbox" checked={!!state.show[side]} onChange={(e) => send({ type: 'show', side, on: e.target.checked })} />
            <span>Show {name} hidden units</span>
          </label>
        ))}
      </section>

      <section className="ss-section">
        <h3>Tools</h3>
        <div className="ss-row" role="group" aria-label="Map tool">
          {TOOLS.map((t) => (
            <button key={t.tool} className={`ss-btn${state.tool === t.tool ? ' on' : ''}`} aria-pressed={state.tool === t.tool} onClick={() => send({ type: 'tool', tool: t.tool })} title={`${t.hint} (${t.key})`}>
              {t.label}
            </button>
          ))}
        </div>
        <p className="ss-hint">{TOOLS.find((t) => t.tool === state.tool)?.hint}</p>
        <div className="ss-row" role="group" aria-label="Line width">
          {SS_WIDTHS.map((w, i) => (
            <button key={w} className={`ss-btn ss-width${state.width === i ? ' on' : ''}`} aria-pressed={state.width === i} aria-label={`Line width ${w}`} onClick={() => send({ type: 'width', width: i })}>
              <span style={{ width: w + 4, height: w + 4, background: hex(state.color) }} />
            </button>
          ))}
          <button className="ss-btn danger" onClick={() => send({ type: 'erase' })}>Erase all drawings</button>
        </div>
      </section>

      {state.tool === 'move' && (
        <section className="ss-section">
          <h3>Move</h3>
          {state.carrying.length > 0 ? (
            <div className="ss-row">
              <p className="ss-alert">Click the hex to put {state.carrying.length === 1 ? 'it' : `the ${state.carrying.length}`} down in.</p>
              <button className="ss-btn ghost" onClick={() => send({ type: 'carry', ids: [] })}>Cancel</button>
            </div>
          ) : !state.picked ? (
            <p className="ss-hint">Click a hex to list its counters.</p>
          ) : state.picked.pieces.length === 0 ? (
            <p className="ss-hint">Nothing in {hexName(state.picked.hex)}.</p>
          ) : (
            <>
              <div className="ss-row">
                <b className="ss-where">{hexName(state.picked.hex)}</b>
                <button className="ss-btn small" onClick={() => send({ type: 'carry', ids: state.picked!.pieces.filter((p) => !p.held).map((p) => p.id) })}>Move stack…</button>
                <button className="ss-btn small danger" onClick={() => send({ type: 'remove', ids: state.picked!.pieces.filter((p) => !p.held).map((p) => p.id) })}>Remove stack (Del)</button>
              </div>
              <div className="ss-firers">
                {state.picked.pieces.map((p) => (
                  <div key={p.id} className="ss-row ss-piece">
                    <span>{p.held ? `↳ ${p.label}` : p.label}</span>
                    <button className="ss-btn small" onClick={() => send({ type: 'carry', ids: [p.id] })}>Move…</button>
                    <button className="ss-btn small danger" onClick={() => send({ type: 'remove', ids: [p.id] })}>Remove</button>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}
      {state.check?.kind === 'shot' && <ShotPanel state={state} send={send} />}
      {state.check?.kind === 'los' && (
        <section className="ss-section">
          <h3>Line of sight</h3>
          <div className="ss-row">
            <span className="ss-where">
              <b>{state.check.to ? `${hexName(state.check.from)} → ${hexName(state.check.to)}` : `From ${hexName(state.check.from)}: pick the hex to look at`}</b>
            </span>
            <button className="ss-btn ghost" onClick={() => send({ type: 'clearCheck' })}>Clear (Esc)</button>
          </div>
        </section>
      )}

      <section className="ss-section">
        <h3>Danger map</h3>
        <div className="ss-row" role="group" aria-label="Danger map">
          {state.sides.map(({ side, name }) => (
            <button key={side} className={`ss-btn${state.heat?.side === side ? ' on' : ''}`} aria-pressed={state.heat?.side === side} onClick={() => send({ type: 'heat', side })}>
              Danger to {name}
            </button>
          ))}
        </div>
        {state.heat ? (
          <>
            <div className="ss-row" role="group" aria-label="Danger map fire">
              {(
                [
                  ['prep', 'Prep / Defensive Fire'],
                  ['advancing', 'Advancing Fire'],
                ] as const
              ).map(([m, label]) => (
                <button key={m} className={`ss-btn small${(state.heat!.mode === 'first' ? 'prep' : state.heat!.mode) === m ? ' on' : ''}`} onClick={() => send({ type: 'heat', mode: m })}>
                  {label}
                </button>
              ))}
            </div>
            <div className="ss-row" role="group" aria-label="Danger map shows">
              {(
                [
                  ['break', 'Break chance'],
                  ['fp', 'Raw FP'],
                ] as const
              ).map(([m, label]) => (
                <button key={m} className={`ss-btn small${(state.heat!.measure ?? 'break') === m ? ' on' : ''}`} aria-pressed={(state.heat!.measure ?? 'break') === m} onClick={() => send({ type: 'heat', measure: m })}>
                  {label}
                </button>
              ))}
            </div>
            <label className="ss-toggle">
              <input type="checkbox" checked={state.heat.sw} onChange={(e) => send({ type: 'heat', sw: e.target.checked })} />
              <span>Include Support Weapons</span>
            </label>
            {state.heatProgress < 1 && <p className="ss-hint">Working out… {Math.round(state.heatProgress * 100)}%</p>}
          </>
        ) : (
          <p className="ss-hint">One side at a time: the FP its enemy can put on each hex, over the board.</p>
        )}
      </section>

      <section className="ss-section">
        <h3>View</h3>
        <label className="ss-toggle">
          <input type="checkbox" checked={state.hideUnits} onChange={(e) => send({ type: 'hideUnits', on: e.target.checked })} />
          <span>Hide units</span>
        </label>
        <label className="ss-toggle">
          <input type="checkbox" checked={state.hideMarkers} onChange={(e) => send({ type: 'hideMarkers', on: e.target.checked })} />
          <span>Hide markers</span>
        </label>
      </section>
    </div>
  );
}

/** The shot being checked: its fire mode, how the target is taken, and which pieces in the firing hexes take part. */
function ShotPanel({ state, send }: { state: SsControlsState; send(c: SsCommand): void }) {
  const check = state.check;
  if (check?.kind !== 'shot') return null;
  return (
    <section className="ss-section">
      <h3>Shot</h3>
      <div className="ss-row">
        <span className="ss-where">
          <b>
            {check.firers.map(hexName).join(' + ')} → {check.target ? hexName(check.target) : 'pick the target hex'}
          </b>
        </span>
        <button className="ss-btn ghost" onClick={() => send({ type: 'clearCheck' })}>Clear (Esc)</button>
      </div>
      <div className="ss-row" role="group" aria-label="Fire mode">
        {SHOT_MODES.map((m) => (
          <button key={m.mode} className={`ss-btn small${check.mode === m.mode ? ' on' : ''}`} aria-pressed={check.mode === m.mode} onClick={() => send({ type: 'shot', mode: m.mode })}>
            {m.label}
          </button>
        ))}
      </div>
      <label className="ss-toggle">
        <input type="checkbox" checked={check.areaFire} onChange={(e) => send({ type: 'shot', areaFire: e.target.checked })} />
        <span>Area Fire (at concealed units: ½ FP)</span>
      </label>
      <div className="ss-row" role="group" aria-label="Target moving">
        {(
          [
            ['none', 'Target still'],
            ['moving', 'Target moving'],
            ['assault', 'Assault Movement'],
          ] as const
        ).map(([m, label]) => (
          <button key={m} className={`ss-btn small${check.moving === m ? ' on' : ''}`} aria-pressed={check.moving === m} onClick={() => send({ type: 'shot', moving: m })}>
            {label}
          </button>
        ))}
      </div>
      {state.firers.some((f) => f.role === 'ordnance' && !f.out) && (
        <div className="ss-row" role="group" aria-label="To Hit check">
          <button className={`ss-btn small${!check.weapon ? ' on' : ''}`} aria-pressed={!check.weapon} onClick={() => send({ type: 'shot', weapon: null })}>
            IFT attack
          </button>
          {state.firers
            .filter((f) => f.role === 'ordnance' && !f.out)
            .map((f) => (
              <button key={f.id} className={`ss-btn small${check.weapon === f.id ? ' on' : ''}`} aria-pressed={check.weapon === f.id} onClick={() => send({ type: 'shot', weapon: f.id })}>
                To Hit: {f.label}
              </button>
            ))}
        </div>
      )}
      {state.firers.length > 0 && !check.weapon && (
        <div className="ss-firers">
          {state.firers.filter((f) => f.role !== 'ordnance').map((f) => (
            <label key={f.id} className={`ss-toggle${f.out ? ' out' : ''}`} title={f.out}>
              <input type="checkbox" disabled={!!f.out} checked={!f.out && !check.exclude.includes(f.id)} onChange={(e) => send({ type: 'shotExclude', id: f.id, out: !e.target.checked })} />
              <span>
                {f.role === 'leader' ? 'Directs: ' : f.role === 'sw' ? '↳ ' : ''}
                {f.label}
                {f.out ? ` (${f.out})` : ''}
              </span>
            </label>
          ))}
        </div>
      )}
    </section>
  );
}
