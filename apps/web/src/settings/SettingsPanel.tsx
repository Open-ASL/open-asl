import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { playSfx } from '../audio/engine';
import { useAudioSettings, useSampleStatus } from '../audio/useAudio';
import type { FxLevel } from '../fx/settings';

interface Props {
  fx: FxLevel;
  onFx(l: FxLevel): void;
  /** Weather drawn over the map (snow, rain, fog). */
  weatherFx: boolean;
  onWeatherFx(on: boolean): void;
  /** The "your call" strip over the board while a decision waits on this player. */
  callStrip: boolean;
  onCallStrip(on: boolean): void;
  onClose(): void;
}

/** Settings: sound volumes and mute, how much motion the interface plays, and the weather on the map. */
export function SettingsPanel({ fx, onFx, weatherFx, onWeatherFx, callStrip, onCallStrip, onClose }: Props) {
  const [audio, setAudio] = useAudioSettings();
  const samples = useSampleStatus();
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  const slider = (label: string, key: 'master' | 'sfx', test?: () => void) => (
    <label className="set-row">
      <span className="set-label">{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(audio[key] * 100)}
        disabled={audio.muted}
        onChange={(e) => setAudio({ [key]: Number(e.target.value) / 100 })}
        onPointerUp={test}
        aria-label={`${label} volume`}
      />
      <span className="set-val">{Math.round(audio[key] * 100)}</span>
    </label>
  );

  return createPortal(
    <div className="set-backdrop" onClick={onClose}>
      <div className="set-panel" role="dialog" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <div className="set-head">
          <span className="kicker">Settings</span>
          <button className="ghost" onClick={onClose} aria-label="Close settings">
            ✕
          </button>
        </div>

        <section>
          <h3>Sound</h3>
          <div className="set-row toggle">
            <span className="set-label">Mute everything</span>
            <label className="switch">
              <input type="checkbox" checked={audio.muted} onChange={(e) => setAudio({ muted: e.target.checked })} />
              <span className="knob" />
            </label>
          </div>
          {slider('Master', 'master', () => playSfx('ui.select'))}
          {slider('Effects', 'sfx', () => playSfx('fire.rifle', 0, { nation: 'am' }))}
          <div className="set-tests">
            <span className="muted small">Try:</span>
            <button onClick={() => playSfx('fire.rifle', 0, { nation: 'am' })}>Rifles</button>
            <button onClick={() => playSfx('fire.lmg', 0, { nation: 'ge' })}>Light MG</button>
            <button onClick={() => playSfx('fire.hmg', 0, { nation: 'am' })}>Heavy MG</button>
            <button onClick={() => playSfx('fire.explosion')}>Explosion</button>
            <button onClick={() => playSfx('dice.roll')}>Dice</button>
            <button onClick={() => playSfx('phase.turn')}>Phase wheel</button>
          </div>
          <p className="muted small">
            Recorded sounds: {samples.effects} effects, {samples.loaded}/{samples.total} files loaded{samples.manifest ? ', with your audio/manifest.json' : ''}. The rest are synthesized.
          </p>
        </section>

        <section>
          <h3>Motion</h3>
          <div className="set-row">
            <span className="set-label">Cinematics</span>
            <span className="seg">
              {(['full', 'fast', 'off'] as FxLevel[]).map((l) => (
                <button key={l} className={fx === l ? 'on' : ''} onClick={() => onFx(l)}>
                  {l}
                </button>
              ))}
            </span>
          </div>
          <p className="muted small">Full plays the phase wheel, dice and combat results at a readable pace; Fast shortens them; Off skips them.</p>
          <div className="set-row toggle">
            <span className="set-label">Weather on the map</span>
            <label className="switch">
              <input type="checkbox" checked={weatherFx} onChange={(e) => onWeatherFx(e.target.checked)} />
              <span className="knob" />
            </label>
          </div>
          <p className="muted small">Falling snow, rain and fog drawn over the map when the scenario has them. Off with cinematics off.</p>
        </section>

        <section>
          <h3>Prompts</h3>
          <div className="set-row toggle">
            <span className="set-label">"Your call" strip</span>
            <label className="switch">
              <input type="checkbox" checked={callStrip} onChange={(e) => onCallStrip(e.target.checked)} />
              <span className="knob" />
            </label>
          </div>
          <p className="muted small">The strip over the board when the game waits on you mid-phase (Defensive First Fire, a ROF choice). Off, the board edge still glows and Pass waits in the top bar, on the action wheel and in the orders panel.</p>
        </section>
      </div>
    </div>,
    document.body,
  );
}
