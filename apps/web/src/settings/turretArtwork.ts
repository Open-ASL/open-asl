import { useSyncExternalStore } from 'react';

const key = 'asl.rotatingTurretArtwork';
const listeners = new Set<() => void>();
let enabled = true;
try {
  enabled = localStorage.getItem(key) !== 'off';
} catch {
  // The board still supports session-only preferences when storage is unavailable.
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useTurretArtwork() {
  return useSyncExternalStore(subscribe, () => enabled, () => true);
}

export function setTurretArtwork(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(key, on ? 'on' : 'off');
  } catch {
    // Keep the in-memory setting.
  }
  for (const listener of listeners) listener();
}
