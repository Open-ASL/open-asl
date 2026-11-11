import type { SfxName } from './sfx';

/*
 * The recorded effects that ship with the game (CC0 recordings, see sounds/CREDITS.md),
 * bundled by Vite. A manifest in the asset store (audio/manifest.json) can override any
 * entry; see samples.ts.
 */
const files = import.meta.glob('./sounds/*.mp3', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

/** URL of a bundled sound by its base name. */
const url = (name: string): string => {
  const u = files[`./sounds/${name}.mp3`];
  if (!u) throw new Error(`No bundled sound ${name}`);
  return u;
};
const all = (...names: string[]) => names.map(url);

export interface BuiltinEntry {
  files: string[];
  gain: number;
}

export const BUILTIN: Partial<Record<SfxName, BuiltinEntry>> = {
  'fire.rifle': { files: all('rifle_volley_1', 'rifle_volley_2', 'rifle_volley_3'), gain: 0.85 },
  'fire.pistol': { files: all('pistol_1', 'pistol_2'), gain: 0.7 },
  'fire.lmg': { files: all('lmg_1', 'lmg_2'), gain: 0.85 },
  'fire.mmg': { files: all('mmg_1', 'mmg_2', 'mmg_3'), gain: 0.9 },
  'fire.hmg': { files: all('hmg_1', 'hmg_2', 'hmg_3'), gain: 1 },
  'fire.ft': { files: all('flamethrower_1', 'flamethrower_2'), gain: 0.9 },
  'fire.explosion': { files: all('explosion_1', 'explosion_2', 'explosion_3'), gain: 1 },
  'hit.none': { files: all('ricochet_1', 'ricochet_2', 'ricochet_3', 'ricochet_4'), gain: 0.5 },
  'dice.roll': { files: all('dice_1', 'dice_2', 'dice_3'), gain: 0.7 },
  'move.step': { files: all('steps_walk'), gain: 0.6 },
  rout: { files: all('steps_run'), gain: 0.6 },
};
