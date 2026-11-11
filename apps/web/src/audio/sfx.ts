/**
 * Every sound effect is synthesized on the fly from noise and oscillators, so the game ships
 * no audio files. Each effect is a function of (context, output bus, start time in seconds).
 */
export interface SfxParams {
  /** Nationality of whoever is firing ('am' | 'ge' | 'ru' | …): decides the small arms heard. */
  nation?: string;
  /** How much is firing: squads for small arms (a half-squad counts a half). */
  intensity?: number;
}
export type Sfx = (c: BaseAudioContext, out: AudioNode, t: number, p: SfxParams) => void;

/* ----------------------------------------------------------------------------- building blocks */

let noiseBuf: AudioBuffer | null = null;
function noise(c: BaseAudioContext): AudioBuffer {
  if (noiseBuf && noiseBuf.sampleRate === c.sampleRate) return noiseBuf;
  const len = c.sampleRate * 2;
  noiseBuf = c.createBuffer(1, len, c.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

interface Env {
  /** Seconds. */
  dur: number;
  gain: number;
  attack?: number;
}

/** Gain node with an attack/decay envelope, connected to `out`. */
function envelope(c: BaseAudioContext, out: AudioNode, t: number, e: Env): GainNode {
  const g = c.createGain();
  const a = e.attack ?? 0.003;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(e.gain, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + e.dur);
  g.connect(out);
  return g;
}

interface BurstOpts extends Env {
  type?: BiquadFilterType;
  freq: number;
  /** Sweep the filter to this frequency over the burst. */
  freqEnd?: number;
  q?: number;
}

/** A filtered noise burst: cracks, thumps, swishes, hiss. */
function burst(c: BaseAudioContext, out: AudioNode, t: number, o: BurstOpts) {
  const src = c.createBufferSource();
  src.buffer = noise(c);
  src.loop = true;
  src.loopStart = rnd(0, 1.5);
  const f = c.createBiquadFilter();
  f.type = o.type ?? 'bandpass';
  f.frequency.setValueAtTime(o.freq, t);
  if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd, t + (o.attack ?? 0.003) + o.dur);
  f.Q.value = o.q ?? 1;
  const g = envelope(c, out, t, o);
  src.connect(f);
  f.connect(g);
  src.start(t, src.loopStart);
  src.stop(t + (o.attack ?? 0.003) + o.dur + 0.05);
}

interface ToneOpts extends Env {
  freq: number;
  freqEnd?: number;
  type?: OscillatorType;
  /** Lowpass the oscillator (saw/square) to soften it. */
  lowpass?: number;
  detune?: number;
}

function tone(c: BaseAudioContext, out: AudioNode, t: number, o: ToneOpts) {
  const osc = c.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.freq, t);
  if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(o.freqEnd, t + (o.attack ?? 0.003) + o.dur);
  if (o.detune) osc.detune.value = o.detune;
  const g = envelope(c, out, t, o);
  if (o.lowpass) {
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = o.lowpass;
    osc.connect(f);
    f.connect(g);
  } else osc.connect(g);
  osc.start(t);
  osc.stop(t + (o.attack ?? 0.003) + o.dur + 0.05);
}

/* ----------------------------------------------------------------------------- gunfire */

/*
 * A gunshot heard across a few hundred metres is not a click: it is a few milliseconds of
 * everything at once (the muzzle blast), the supersonic crack, a boom whose highs fall away in
 * a tenth of a second, a thump you feel in the chest, and then the echo off the trees and
 * buildings, which is what makes it sound outdoors. Each round is built from those parts, run
 * through a soft saturator for punch, and sent to a shared echo.
 */

const echoes = new WeakMap<AudioNode, GainNode>();

/** The outdoors: early slaps off the treeline, then a diffuse tail that darkens as it dies. */
function echoSend(c: BaseAudioContext, out: AudioNode): GainNode {
  const got = echoes.get(out);
  if (got) return got;
  const sr = c.sampleRate;
  const len = Math.floor(sr * 1.8);
  const ir = c.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const tt = i / sr;
      const x = tt < 0.015 ? 0 : (Math.random() * 2 - 1) * Math.exp(-tt / 0.38);
      // One-pole lowpass whose cutoff falls with time: the tail loses its top end first.
      lp += (x - lp) * (0.35 - 0.3 * Math.min(1, tt / 1.4));
      d[i] = lp;
    }
    for (const [at, g] of [
      [0.045, 0.7],
      [0.09, 0.5],
      [0.16, 0.4],
      [0.27, 0.3],
      [0.41, 0.2],
    ] as const) {
      const from = Math.floor((at + rnd(-0.008, 0.008)) * sr);
      for (let k = 0; k < 200 && from + k < len; k++) d[from + k]! += (Math.random() * 2 - 1) * g * Math.exp(-k / 60);
    }
  }
  const conv = c.createConvolver();
  conv.buffer = ir;
  const send = c.createGain();
  send.connect(conv);
  conv.connect(out);
  echoes.set(out, send);
  return send;
}

let satCurve: Float32Array<ArrayBuffer> | null = null;
/** Soft clipping: the loud transients fold over instead of spiking, which is what gives a shot its punch. */
function saturator(c: BaseAudioContext): WaveShaperNode {
  if (!satCurve) {
    satCurve = new Float32Array(2048);
    const drive = 2.2;
    for (let i = 0; i < satCurve.length; i++) satCurve[i] = Math.tanh((drive * (i * 2)) / (satCurve.length - 1) - drive) / Math.tanh(drive);
  }
  const s = c.createWaveShaper();
  s.curve = satCurve;
  s.oversample = '2x';
  return s;
}

/** A voice: saturated, at `gain`, with `echo` of it sent to the outdoors. Returns the node to play into. */
function voice(c: BaseAudioContext, out: AudioNode, gain: number, echo: number): GainNode {
  const sum = c.createGain();
  const sat = saturator(c);
  const g = c.createGain();
  g.gain.value = gain;
  sum.connect(sat);
  sat.connect(g);
  g.connect(out);
  if (echo > 0) {
    const send = c.createGain();
    send.gain.value = echo;
    g.connect(send);
    send.connect(echoSend(c, out));
  }
  return sum;
}

/** What one round sounds like, by cartridge. */
interface Round {
  /** Centre of the crack (Hz) and how long it lasts. */
  crack: number;
  crackDur: number;
  /** Muzzle boom: where its top starts (Hz), how long it lasts, how loud. */
  boom: number;
  boomDur: number;
  boomGain: number;
  /** The thump: start pitch, length, level. */
  thump: number;
  thumpDur: number;
  thumpGain: number;
  /** How much of the shot goes to the echo. */
  echo: number;
  gain: number;
}

const ROUND = {
  /** Full-power rifle cartridge: 7.92 Mauser, .30-06, 7.62×54R. */
  rifle: { crack: 2600, crackDur: 0.022, boom: 2400, boomDur: 0.12, boomGain: 0.8, thump: 160, thumpDur: 0.11, thumpGain: 0.55, echo: 0.8, gain: 0.5 },
  /** Pistol cartridge from a submachine gun: 9 mm, 7.62×25. Sharper, lighter, less boom. */
  smg: { crack: 3300, crackDur: 0.012, boom: 1900, boomDur: 0.06, boomGain: 0.5, thump: 230, thumpDur: 0.06, thumpGain: 0.3, echo: 0.55, gain: 0.34 },
  /** A .45 pistol: a slow, heavy slap. */
  pistol: { crack: 2300, crackDur: 0.018, boom: 1500, boomDur: 0.09, boomGain: 0.65, thump: 150, thumpDur: 0.09, thumpGain: 0.5, echo: 0.65, gain: 0.42 },
  /** Rifle calibre from a machine gun: the rounds run together, so each is a little shorter. */
  mg: { crack: 2400, crackDur: 0.016, boom: 2200, boomDur: 0.09, boomGain: 0.75, thump: 150, thumpDur: 0.09, thumpGain: 0.5, echo: 0.75, gain: 0.42 },
  /** Heavy machine gun: .50 BMG, 12.7 mm. Deep, slow, enormous. */
  heavy: { crack: 1300, crackDur: 0.03, boom: 1500, boomDur: 0.22, boomGain: 1, thump: 105, thumpDur: 0.2, thumpGain: 0.95, echo: 0.95, gain: 0.6 },
} satisfies Record<string, Round>;

/** One round fired. */
function shot(c: BaseAudioContext, out: AudioNode, t: number, r: Round, level = 1) {
  const v = voice(c, out, r.gain * level, r.echo);
  // Muzzle blast: a few milliseconds of everything at once.
  burst(c, v, t, { type: 'highpass', freq: 600, dur: 0.004, gain: 1.6, attack: 0.0004 });
  // The crack.
  burst(c, v, t, { freq: r.crack * rnd(0.9, 1.1), q: 0.6, dur: r.crackDur, gain: 1, attack: 0.0006 });
  // The boom: wideband at first, its top falling away fast.
  burst(c, v, t + 0.002, { type: 'lowpass', freq: r.boom, freqEnd: 110, dur: r.boomDur, gain: r.boomGain, attack: 0.002 });
  // The thump.
  tone(c, v, t + 0.002, { freq: r.thump, freqEnd: r.thump * 0.32, dur: r.thumpDur, gain: r.thumpGain, attack: 0.0015 });
}

/** Riflemen working bolts: a shot every half second or so per man, the men out of step. */
function bolt(c: BaseAudioContext, out: AudioNode, t: number, r: Round, men: number, dur: number, level = 1) {
  for (let m = 0; m < men; m++) {
    let at = t + rnd(0, 0.3);
    while (at < t + dur) {
      shot(c, out, at, r, level * rnd(0.75, 1));
      at += rnd(0.55, 0.95);
    }
  }
}

/** Semi-automatic rifles: each man fires as fast as he can aim. */
function semi(c: BaseAudioContext, out: AudioNode, t: number, r: Round, men: number, dur: number, level = 1) {
  for (let m = 0; m < men; m++) {
    let at = t + rnd(0, 0.25);
    while (at < t + dur) {
      shot(c, out, at, r, level * rnd(0.75, 1));
      at += rnd(0.16, 0.32);
    }
  }
}

/** Automatic fire at a cyclic rate (rounds per minute): bursts of so many rounds with pauses between. */
function auto(c: BaseAudioContext, out: AudioNode, t: number, r: Round, rpm: number, bursts: number[], level = 1, pause: [number, number] = [0.3, 0.5]) {
  const gap = 60 / rpm;
  let at = t;
  for (const n of bursts) {
    for (let i = 0; i < n; i++) {
      shot(c, out, at, r, level * rnd(0.85, 1));
      at += gap * rnd(0.96, 1.04);
    }
    at += rnd(pause[0], pause[1]);
  }
}

const burstsOf = (k: number, lo: number, hi: number) => Array.from({ length: k }, () => Math.round(rnd(lo, hi)));

/** The M1 Garand's empty clip ringing out. */
function ping(c: BaseAudioContext, out: AudioNode, t: number) {
  tone(c, out, t, { freq: 3150, freqEnd: 3050, dur: 0.28, gain: 0.07, attack: 0.001 });
  tone(c, out, t, { freq: 5200, dur: 0.12, gain: 0.03, attack: 0.001 });
}

type Nation = 'am' | 'ge' | 'ru' | 'other';
const nation = (p: SfxParams): Nation => (p.nation === 'am' || p.nation === 'ge' || p.nation === 'ru' ? p.nation : 'other');
const squads = (p: SfxParams) => Math.max(1, Math.min(4, Math.round(p.intensity ?? 1)));

function snareRoll(c: BaseAudioContext, out: AudioNode, t: number, dur: number, gain: number) {
  const n = Math.round(dur / 0.045);
  for (let i = 0; i < n; i++) {
    const k = i / Math.max(1, n - 1);
    burst(c, out, t + i * 0.045, { freq: 1900, q: 0.7, dur: 0.07, gain: gain * (0.35 + 0.65 * k) });
  }
}

function drum(c: BaseAudioContext, out: AudioNode, t: number, gain: number) {
  tone(c, out, t, { freq: 110, freqEnd: 42, dur: 0.35, gain });
  burst(c, out, t, { type: 'lowpass', freq: 900, dur: 0.05, gain: gain * 0.6 });
}

function steps(c: BaseAudioContext, out: AudioNode, t: number, n: number, gap: number, gain: number) {
  for (let i = 0; i < n; i++) {
    const at = t + i * gap + rnd(-0.01, 0.01);
    burst(c, out, at, { type: 'lowpass', freq: rnd(300, 420), dur: 0.045, gain: gain * rnd(0.7, 1) });
    burst(c, out, at + 0.01, { freq: rnd(2500, 4000), q: 2, dur: 0.012, gain: gain * 0.25 });
  }
}

/* ----------------------------------------------------------------------------- the effects */

export const SFX = {
  /* --- interface --- */
  'ui.tick': (c, out, t) => {
    burst(c, out, t, { type: 'highpass', freq: 3200, dur: 0.012, gain: 0.12 });
    tone(c, out, t, { freq: 1500, freqEnd: 1100, dur: 0.03, gain: 0.08 });
  },
  'ui.open': (c, out, t) => {
    burst(c, out, t, { freq: 500, freqEnd: 2600, q: 1.5, dur: 0.16, gain: 0.14, attack: 0.01 });
    tone(c, out, t + 0.02, { freq: 660, freqEnd: 990, dur: 0.08, gain: 0.05 });
  },
  'ui.close': (c, out, t) => {
    burst(c, out, t, { freq: 2400, freqEnd: 500, q: 1.5, dur: 0.14, gain: 0.11, attack: 0.01 });
  },
  'ui.select': (c, out, t) => {
    burst(c, out, t, { type: 'highpass', freq: 3000, dur: 0.012, gain: 0.14 });
    tone(c, out, t, { freq: 880, dur: 0.07, gain: 0.1 });
    tone(c, out, t + 0.04, { freq: 1320, dur: 0.06, gain: 0.05 });
  },
  'ui.deny': (c, out, t) => {
    tone(c, out, t, { freq: 150, type: 'square', lowpass: 500, dur: 0.1, gain: 0.07 });
    tone(c, out, t + 0.12, { freq: 120, type: 'square', lowpass: 500, dur: 0.14, gain: 0.07 });
  },
  /** A counter set down on the map. */
  'ui.place': (c, out, t) => {
    burst(c, out, t, { type: 'lowpass', freq: 700, dur: 0.05, gain: 0.3 });
    tone(c, out, t, { freq: 210, freqEnd: 90, dur: 0.09, gain: 0.25 });
  },
  /** A cardboard counter picked up and flipped onto its other side. */
  'ui.flip': (c, out, t) => {
    burst(c, out, t, { type: 'highpass', freq: 1800, dur: 0.02, gain: 0.1 });
    burst(c, out, t + 0.3, { type: 'lowpass', freq: 650, dur: 0.05, gain: 0.3 });
    tone(c, out, t + 0.3, { freq: 190, freqEnd: 85, dur: 0.09, gain: 0.2 });
  },
  /** The phase wheel ratchets round to the next phase and chimes. */
  'phase.turn': (c, out, t) => {
    const gaps = [0, 0.07, 0.13, 0.18, 0.22, 0.25];
    for (const g of gaps) burst(c, out, t + g, { type: 'highpass', freq: 2500, dur: 0.015, gain: 0.14 });
    tone(c, out, t + 0.3, { freq: 659, dur: 0.5, gain: 0.09 });
    tone(c, out, t + 0.3, { freq: 1318, dur: 0.3, gain: 0.02 });
    tone(c, out, t + 0.42, { freq: 880, dur: 0.7, gain: 0.09 });
  },
  /** A new player turn: drums and a chord. */
  'phase.playerTurn': (c, out, t) => {
    snareRoll(c, out, t, 0.55, 0.18);
    drum(c, out, t + 0.58, 0.5);
    for (const [i, f] of [440, 523, 659].entries()) tone(c, out, t + 0.6 + i * 0.12, { freq: f, type: 'sawtooth', lowpass: 1800, dur: 0.9 - i * 0.1, gain: 0.05 });
  },
  /** Setup / deployment begins. */
  'phase.setup': (c, out, t) => {
    drum(c, out, t, 0.45);
    drum(c, out, t + 0.3, 0.35);
    for (const [i, f] of [392, 494, 587].entries()) tone(c, out, t + 0.35 + i * 0.1, { freq: f, type: 'triangle', dur: 0.8, gain: 0.07 });
  },
  'dice.roll': (c, out, t) => {
    let at = t;
    for (let i = 0; i < 7; i++) {
      burst(c, out, at, { freq: rnd(2200, 4200), q: 4, dur: 0.02, gain: 0.22 });
      burst(c, out, at, { type: 'lowpass', freq: 1200, dur: 0.015, gain: 0.15 });
      at += rnd(0.03, 0.06);
    }
    burst(c, out, at + 0.03, { type: 'lowpass', freq: 800, dur: 0.07, gain: 0.3 });
  },

  /* --- weapons --- */
  /** A squad's small arms: what its nation carried. More squads, more men firing for longer. */
  'fire.rifle': (c, out, t, p) => {
    const n = squads(p);
    switch (nation(p)) {
      case 'am':
        // M1 Garands, semi-automatic, with the squad's BAR working in short bursts.
        semi(c, out, t, ROUND.rifle, 2 + n, 1.1 + n * 0.15);
        auto(c, out, t + rnd(0.15, 0.4), ROUND.mg, 500, burstsOf(n > 1 ? 2 : 1, 4, 7), 0.8);
        if (Math.random() < 0.6) ping(c, out, t + rnd(0.7, 1.2));
        break;
      case 'ge':
        // Kar98k bolt actions, and often an MP40.
        bolt(c, out, t, ROUND.rifle, 3 + n, 1.4 + n * 0.15);
        if (Math.random() < 0.7) auto(c, out, t + rnd(0.1, 0.5), ROUND.smg, 520, burstsOf(1, 5, 8), 0.8);
        break;
      case 'ru':
        // Mosin-Nagants and the PPSh, which empties its drum very fast.
        bolt(c, out, t, ROUND.rifle, 2 + n, 1.3 + n * 0.15);
        auto(c, out, t + rnd(0.05, 0.4), ROUND.smg, 900, burstsOf(n > 1 ? 2 : 1, 8, 14), 0.85);
        break;
      default:
        bolt(c, out, t, ROUND.rifle, 3 + n, 1.4 + n * 0.15);
    }
  },
  /** A lone leader: a pistol, a few shots. */
  'fire.pistol': (c, out, t, p) => {
    const r = nation(p) === 'am' ? ROUND.pistol : ROUND.smg;
    let at = t;
    for (let i = 0; i < 3; i++) {
      shot(c, out, at, r);
      at += rnd(0.28, 0.4);
    }
  },
  'fire.lmg': (c, out, t, p) => {
    switch (nation(p)) {
      case 'ge': // MG42 or MG34: the buzz-saw.
        auto(c, out, t, ROUND.mg, Math.random() < 0.5 ? 1150 : 850, burstsOf(3, 6, 12), 0.9);
        break;
      case 'ru': // DP-28.
        auto(c, out, t, ROUND.mg, 550, burstsOf(3, 5, 8), 0.9);
        break;
      case 'am': // BAR / M1919A6.
        auto(c, out, t, ROUND.mg, 500, burstsOf(3, 4, 7), 0.9);
        break;
      default: // Bren.
        auto(c, out, t, ROUND.mg, 520, burstsOf(3, 5, 8), 0.9);
    }
  },
  'fire.mmg': (c, out, t, p) => {
    switch (nation(p)) {
      case 'ge': // MG42 on the tripod: long bursts at 1,200 rounds a minute.
        auto(c, out, t, ROUND.mg, 1150, burstsOf(2, 12, 20), 1, [0.35, 0.55]);
        break;
      case 'ru': // Maxim M1910: slow, sustained.
        auto(c, out, t, ROUND.mg, 560, burstsOf(2, 14, 24), 1);
        break;
      case 'am': // M1919A4.
        auto(c, out, t, ROUND.mg, 480, burstsOf(2, 10, 16), 1);
        break;
      default: // Vickers.
        auto(c, out, t, ROUND.mg, 500, burstsOf(2, 10, 16), 1);
    }
  },
  'fire.hmg': (c, out, t, p) => {
    switch (nation(p)) {
      case 'ge': // MG42 on the Lafette, sustained.
        auto(c, out, t, { ...ROUND.mg, gain: 0.5, echo: 0.9 }, 1150, burstsOf(2, 16, 26), 1, [0.35, 0.55]);
        break;
      case 'ru': // DShK 12.7 mm.
        auto(c, out, t, ROUND.heavy, 600, burstsOf(2, 8, 12), 1);
        break;
      case 'am': // M2 .50 calibre.
        auto(c, out, t, ROUND.heavy, 520, burstsOf(2, 7, 11), 1);
        break;
      default: // Vickers, sustained.
        auto(c, out, t, { ...ROUND.mg, gain: 0.5, echo: 0.9 }, 500, burstsOf(2, 14, 22), 1);
    }
  },
  'fire.ft': (c, out, t) => {
    const v = voice(c, out, 0.9, 0.35);
    burst(c, v, t, { type: 'lowpass', freq: 500, freqEnd: 1800, dur: 0.25, gain: 0.5, attack: 0.08 });
    burst(c, v, t + 0.2, { type: 'lowpass', freq: 1600, freqEnd: 300, dur: 0.9, gain: 0.6, attack: 0.05 });
    tone(c, v, t + 0.15, { freq: 70, freqEnd: 40, dur: 0.8, gain: 0.3, attack: 0.1 });
    for (let i = 0; i < 12; i++) burst(c, out, t + 0.2 + rnd(0, 0.9), { freq: rnd(1500, 3500), q: 3, dur: 0.02, gain: 0.08 });
  },
  'fire.explosion': (c, out, t) => {
    const v = voice(c, out, 0.9, 1);
    burst(c, v, t, { type: 'highpass', freq: 400, dur: 0.012, gain: 1.6, attack: 0.0004 });
    burst(c, v, t, { type: 'lowpass', freq: 4000, freqEnd: 60, dur: 1.1, gain: 1.2, attack: 0.002 });
    tone(c, v, t, { freq: 65, freqEnd: 24, dur: 1.0, gain: 0.9, attack: 0.002 });
    for (let i = 0; i < 8; i++) burst(c, out, t + rnd(0.3, 1.2), { type: 'lowpass', freq: rnd(300, 900), dur: 0.08, gain: 0.12 });
  },

  /* --- results --- */
  /** Shots that found nothing: a ricochet whine. */
  'hit.none': (c, out, t) => {
    burst(c, out, t, { freq: 3000, q: 3, dur: 0.03, gain: 0.1 });
    tone(c, out, t + 0.01, { freq: 2900, freqEnd: 650, dur: 0.24, gain: 0.07 });
  },
  /** A morale/pin check is coming: a tense sting. */
  'hit.mc': (c, out, t) => {
    tone(c, out, t, { freq: 220, type: 'sawtooth', lowpass: 1200, dur: 0.4, gain: 0.06 });
    tone(c, out, t, { freq: 233, type: 'sawtooth', lowpass: 1200, dur: 0.4, gain: 0.06 });
    tone(c, out, t + 0.05, { freq: 110, type: 'triangle', dur: 0.45, gain: 0.08 });
  },
  'hit.pin': (c, out, t) => {
    burst(c, out, t, { type: 'lowpass', freq: 320, dur: 0.1, gain: 0.4 });
    tone(c, out, t, { freq: 130, freqEnd: 55, dur: 0.14, gain: 0.35 });
  },
  'hit.break': (c, out, t) => {
    tone(c, out, t, { freq: 440, freqEnd: 330, type: 'sawtooth', lowpass: 1500, dur: 0.18, gain: 0.09 });
    tone(c, out, t + 0.17, { freq: 330, freqEnd: 233, type: 'sawtooth', lowpass: 1400, dur: 0.32, gain: 0.09 });
    burst(c, out, t + 0.05, { type: 'lowpass', freq: 600, dur: 0.25, gain: 0.1, attack: 0.05 });
  },
  'hit.kia': (c, out, t) => {
    burst(c, out, t, { type: 'lowpass', freq: 2000, freqEnd: 90, dur: 0.75, gain: 0.6 });
    tone(c, out, t, { freq: 60, freqEnd: 30, dur: 0.7, gain: 0.4 });
    tone(c, out, t + 0.1, { freq: 196, freqEnd: 98, type: 'sawtooth', lowpass: 800, dur: 0.6, gain: 0.05 });
  },
  'hit.pass': (c, out, t) => {
    tone(c, out, t, { freq: 523, type: 'triangle', dur: 0.12, gain: 0.09 });
    tone(c, out, t + 0.1, { freq: 659, type: 'triangle', dur: 0.2, gain: 0.09 });
  },
  rally: (c, out, t) => {
    for (const [i, f] of [392, 494, 587, 784].entries()) tone(c, out, t + i * 0.13, { freq: f, type: 'sawtooth', lowpass: 2200, dur: 0.35 + (i === 3 ? 0.4 : 0), gain: 0.07 });
  },
  'rally.fail': (c, out, t) => {
    tone(c, out, t, { freq: 196, type: 'sawtooth', lowpass: 900, dur: 0.22, gain: 0.07 });
    tone(c, out, t + 0.2, { freq: 147, type: 'sawtooth', lowpass: 800, dur: 0.4, gain: 0.07 });
  },

  /* --- movement and melee --- */
  'move.step': (c, out, t) => steps(c, out, t, 3, 0.17, 0.26),
  rout: (c, out, t) => steps(c, out, t, 6, 0.1, 0.22),
  'move.smoke': (c, out, t) => {
    burst(c, out, t, { type: 'lowpass', freq: 1200, dur: 0.04, gain: 0.3 });
    burst(c, out, t + 0.03, { type: 'lowpass', freq: 1000, freqEnd: 350, dur: 0.9, gain: 0.22, attack: 0.06 });
  },
  cc: (c, out, t) => {
    for (const [i, at] of [0, 0.17, 0.3, 0.52].entries()) {
      burst(c, out, t + at, { type: 'highpass', freq: 2500, dur: 0.05, gain: 0.3 });
      tone(c, out, t + at, { freq: 3300 - i * 150, freqEnd: 2500, dur: 0.12, gain: 0.06 });
      burst(c, out, t + at, { type: 'lowpass', freq: 500, dur: 0.06, gain: 0.25 });
    }
    shot(c, out, t + 0.42, ROUND.smg);
    shot(c, out, t + 0.55, ROUND.smg);
    shot(c, out, t + 0.74, ROUND.pistol);
  },

  /* --- announcements --- */
  /** A player pings a hex: two soft sine notes, like a sonar blip. */
  ping: (c, out, t) => {
    tone(c, out, t, { freq: 1047, dur: 0.35, gain: 0.05, attack: 0.012 });
    tone(c, out, t + 0.09, { freq: 1568, dur: 0.5, gain: 0.04, attack: 0.015 });
  },
  callout: (c, out, t) => {
    tone(c, out, t, { freq: 988, dur: 0.1, gain: 0.08 });
    tone(c, out, t + 0.12, { freq: 1319, dur: 0.22, gain: 0.08 });
  },
  'game.end': (c, out, t) => {
    snareRoll(c, out, t, 0.6, 0.2);
    drum(c, out, t + 0.6, 0.6);
    for (const [i, f] of [440, 554, 659, 880].entries()) tone(c, out, t + 0.65 + i * 0.16, { freq: f, type: 'sawtooth', lowpass: 2200, dur: i === 3 ? 1.4 : 0.35, gain: 0.08 });
    drum(c, out, t + 1.15, 0.5);
  },
} satisfies Record<string, Sfx>;

export type SfxName = keyof typeof SFX;
