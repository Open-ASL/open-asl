import { useSyncExternalStore } from 'react';
import { getAudioSettings, setAudioSettings, subscribeAudio, type AudioSettings } from './engine';
import { getSampleStatus, subscribeSamples, type SampleStatus } from './samples';

/** The persisted audio settings, live across every component that shows them. */
export function useAudioSettings(): [AudioSettings, (patch: Partial<AudioSettings>) => void] {
  const s = useSyncExternalStore(subscribeAudio, getAudioSettings, getAudioSettings);
  return [s, setAudioSettings];
}

/** Whether recorded samples were found and how many have loaded. */
export function useSampleStatus(): SampleStatus {
  return useSyncExternalStore(subscribeSamples, getSampleStatus, getSampleStatus);
}
