import { assetUrl } from '../game/assets';
import { BUILTIN } from './builtin';
import type { SfxName, SfxParams } from './sfx';

/*
 * Recorded sound effects. A set of CC0 recordings ships with the game (builtin.ts). On top
 * of that, a manifest at audio/manifest.json among the other licensed assets (assets-local/
 * in development, the asset bucket in production) can replace any effect with files of your
 * own, say a bought weapons pack, without touching the repo. An effect with no sample at all
 * falls back to the synthesized version in sfx.ts. See apps/web/audio-manifest.example.json.
 *
 * Each manifest entry is a list of files (one is picked at random, never the same twice
 * running), or a map of nationality → files with "*" as the default, so an American squad
 * can sound like Garands and a German one like Kar98ks. `gain` scales the whole entry.
 */
type FileList = string[];
interface Entry {
  '*'?: FileList;
  [nation: string]: FileList | number | undefined;
  gain?: number;
}
type Manifest = Partial<Record<SfxName, FileList | Entry>>;

export interface SampleStatus {
  /** An audio/manifest.json was found and laid over the built-in set. */
  manifest: boolean;
  /** Effects with at least one sample. */
  effects: number;
  /** Files decoded / files listed. */
  loaded: number;
  total: number;
}

/** Effects → (nation →) URLs, the built-in set with the manifest's entries laid over it. */
let manifest: Manifest = Object.fromEntries(Object.entries(BUILTIN).map(([k, v]) => [k, { '*': v.files, gain: v.gain }])) as Manifest;
let status: SampleStatus = { manifest: false, effects: 0, loaded: 0, total: 0 };
const buffers = new Map<string, AudioBuffer>();
const lastPick = new Map<string, string>();
const listeners = new Set<() => void>();
let started = false;

export const getSampleStatus = () => status;
export function subscribeSamples(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
const emit = (patch: Partial<SampleStatus>) => {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
};

/** Read the manifest, if any, and decode every file. Called once the audio context exists. */
export function loadSamples(c: AudioContext) {
  if (started) return;
  started = true;
  void (async () => {
    let external = false;
    try {
      const res = await fetch(assetUrl('audio/manifest.json'), { cache: 'no-cache' });
      if (res.ok) {
        const m = (await res.json()) as Record<string, FileList | Entry | string>;
        // Manifest paths are relative to audio/; the built-in entries are already URLs.
        const resolve = (l: FileList) => l.map((f) => assetUrl(`audio/${f}`));
        for (const [k, entry] of Object.entries(m)) {
          if (k.startsWith('_') || typeof entry === 'string') continue;
          if (Array.isArray(entry)) manifest[k as SfxName] = resolve(entry);
          else manifest[k as SfxName] = Object.fromEntries(Object.entries(entry).map(([n, v]) => [n, Array.isArray(v) ? resolve(v) : v])) as Entry;
        }
        external = true;
      }
    } catch {
      /* no manifest: the built-in set alone */
    }
    const files = new Set<string>();
    let effects = 0;
    for (const entry of Object.values(manifest)) {
      const lists = Array.isArray(entry) ? [entry] : Object.values(entry).filter((v): v is FileList => Array.isArray(v));
      if (lists.some((l) => l.length)) effects++;
      for (const l of lists) for (const f of l) files.add(f);
    }
    emit({ manifest: external, effects, total: files.size, loaded: 0 });
    await Promise.all(
      [...files].map(async (f) => {
        try {
          const r = await fetch(f);
          if (!r.ok) throw new Error(r.statusText);
          buffers.set(f, await c.decodeAudioData(await r.arrayBuffer()));
          emit({ loaded: status.loaded + 1 });
        } catch (e) {
          console.warn(`[audio] could not load sample ${f}:`, e);
        }
      }),
    );
  })();
}

function choose(name: SfxName, p: SfxParams): { file: string; gain: number } | null {
  const entry = manifest?.[name];
  if (!entry) return null;
  let list: FileList | undefined;
  let gain = 1;
  if (Array.isArray(entry)) list = entry;
  else {
    const byNation = p.nation ? entry[p.nation] : undefined;
    list = Array.isArray(byNation) ? byNation : entry['*'];
    gain = entry.gain ?? 1;
  }
  const ready = (list ?? []).filter((f) => buffers.has(f));
  if (!ready.length) return null;
  let pick = ready[Math.floor(Math.random() * ready.length)]!;
  if (ready.length > 1 && pick === lastPick.get(name)) pick = ready[(ready.indexOf(pick) + 1) % ready.length]!;
  lastPick.set(name, pick);
  return { file: pick, gain };
}

/** Play a recorded sample for the effect if one is loaded. Returns false when the synth should play instead. */
export function playSample(c: AudioContext, out: AudioNode, name: SfxName, t: number, p: SfxParams): boolean {
  const first = choose(name, p);
  if (!first) return false;
  // Small arms from several squads: layer another take or two, a beat apart.
  const layers = name === 'fire.rifle' ? Math.min(3, Math.max(1, Math.round(p.intensity ?? 1))) : 1;
  for (let i = 0; i < layers; i++) {
    const pick = i === 0 ? first : choose(name, p);
    if (!pick) break;
    const src = c.createBufferSource();
    src.buffer = buffers.get(pick.file)!;
    src.playbackRate.value = 0.96 + Math.random() * 0.08;
    const g = c.createGain();
    g.gain.value = pick.gain * (i === 0 ? 1 : 0.8) * (0.9 + Math.random() * 0.1);
    src.connect(g);
    g.connect(out);
    src.start(t + i * (0.15 + Math.random() * 0.2));
  }
  return true;
}
