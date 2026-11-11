import { SFX, type SfxName, type SfxParams } from './sfx';
import { loadSamples, playSample } from './samples';

/* ----------------------------------------------------------------------------- settings */

export interface AudioSettings {
  /** 0..1 */
  master: number;
  sfx: number;
  muted: boolean;
}

const KEY = 'asl.audio';
const DEFAULTS: AudioSettings = { master: 0.8, sfx: 0.9, muted: false };

function read(): AudioSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<AudioSettings>;
      const num = (x: unknown, d: number) => (typeof x === 'number' && x >= 0 && x <= 1 ? x : d);
      return { master: num(v.master, DEFAULTS.master), sfx: num(v.sfx, DEFAULTS.sfx), muted: v.muted === true };
    }
  } catch {
    /* private mode etc. */
  }
  return DEFAULTS;
}

let settings: AudioSettings = read();
const listeners = new Set<() => void>();

export const getAudioSettings = () => settings;

export function setAudioSettings(patch: Partial<AudioSettings>) {
  settings = { ...settings, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
  applyGains();
  listeners.forEach((l) => l());
}

export function subscribeAudio(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/* ----------------------------------------------------------------------------- graph */

/** Dev only: the effects played, for checking the wiring without ears. */
const played: string[] = [];
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;

/** Browsers only let audio start after a user gesture: the context is created on the first one. */
function ensure(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as typeof AudioContext | undefined;
  if (!Ctor) return null;
  ctx = new Ctor();
  master = ctx.createGain();
  sfxBus = ctx.createGain();
  // A gentle limiter so a volley of cracks never clips.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12;
  comp.knee.value = 20;
  comp.ratio.value = 6;
  comp.attack.value = 0.003;
  comp.release.value = 0.2;
  sfxBus.connect(master);
  master.connect(comp);
  comp.connect(ctx.destination);
  applyGains();
  return ctx;
}

function applyGains() {
  if (!ctx || !master || !sfxBus) return;
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(settings.muted ? 0 : settings.master, t, 0.03);
  sfxBus.gain.setTargetAtTime(settings.sfx, t, 0.03);
}

/** Called on the first user gesture (and whenever the page comes back): start the clock. */
export function unlockAudio() {
  const c = ensure();
  if (!c) return;
  if (c.state !== 'running') void c.resume();
  loadSamples(c);
}

export function audioUnlocked(): boolean {
  return !!ctx && ctx.state === 'running';
}

/**
 * Play an effect, optionally some milliseconds from now: the recorded sample when one is
 * loaded for it, otherwise the synthesized version. `params` say who is firing and how much.
 */
export function playSfx(name: SfxName, delayMs = 0, params: SfxParams = {}) {
  if (settings.muted || settings.sfx === 0 || settings.master === 0) return;
  if (!ctx || !sfxBus || ctx.state !== 'running') return;
  const fn = SFX[name];
  if (!fn) return;
  const t = ctx.currentTime + Math.max(0, delayMs) / 1000;
  try {
    const sampled = playSample(ctx, sfxBus, name, t, params);
    if (import.meta.env.DEV) played.push(`${name}@${Math.round(delayMs)}${params.nation ? ':' + params.nation : ''}${sampled ? ' (sample)' : ''}`);
    if (!sampled) fn(ctx, sfxBus, t, params);
  } catch {
    /* a synth that fails must never break the game */
  }
}

/* ----------------------------------------------------------------------------- lifecycle */

if (typeof window !== 'undefined') {
  const unlock = () => unlockAudio();
  window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
  window.addEventListener('keydown', unlock, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend();
    else void ctx.resume();
  });
  if (import.meta.env.DEV) {
    (window as unknown as { aslAudio: unknown }).aslAudio = {
      play: playSfx,
      settings: getAudioSettings,
      set: setAudioSettings,
      state: () => ({ ctx: ctx?.state ?? 'none' }),
      names: () => Object.keys(SFX),
      played: () => played.splice(0),
      /** Render an effect offline and report its loudness per 100 ms, for tuning without ears. */
      render: async (name: SfxName, params: SfxParams = {}, secs = 2.5) => {
        const oc = new OfflineAudioContext(1, Math.round(44100 * secs), 44100);
        SFX[name](oc, oc.destination, 0.05, params);
        const d = (await oc.startRendering()).getChannelData(0);
        const win = 4410;
        const rows: { t: number; peak: number; rms: number }[] = [];
        for (let i = 0; i + win <= d.length; i += win) {
          let peak = 0;
          let sq = 0;
          for (let k = i; k < i + win; k++) {
            const v = Math.abs(d[k]!);
            if (v > peak) peak = v;
            sq += v * v;
          }
          rows.push({ t: i / 44100, peak: +peak.toFixed(3), rms: +Math.sqrt(sq / win).toFixed(3) });
        }
        return rows;
      },
    };
  }
}
