import { describe, expect, it } from 'vitest';
import { RecordingTracker } from '../src/match/recordingSync';

describe('RecordingTracker', () => {
  it('accepts the count the board was opened at', () => {
    const t = new RecordingTracker(7);
    expect(t.observe(7)).toBe(true);
    expect(t.observe(7)).toBe(true); // StrictMode runs the effect twice
  });

  it('accepts its own appends and undos in order', () => {
    const t = new RecordingTracker(3);
    t.wrote(4);
    expect(t.observe(4)).toBe(true);
    t.wrote(3); // undo
    expect(t.observe(3)).toBe(true);
    t.wrote(4);
    expect(t.observe(4)).toBe(true);
  });

  it('accepts a coalesced snapshot that skips intermediate counts', () => {
    const t = new RecordingTracker(3);
    t.wrote(4);
    t.wrote(5);
    t.wrote(6);
    expect(t.observe(6)).toBe(true);
  });

  it('accepts quick successive writes whose snapshots arrive one at a time', () => {
    const t = new RecordingTracker(3);
    t.wrote(4);
    t.wrote(5);
    expect(t.observe(4)).toBe(true);
    expect(t.observe(5)).toBe(true);
  });

  it('rejects a count another device wrote', () => {
    const t = new RecordingTracker(3);
    expect(t.observe(9)).toBe(false);
  });

  it('rejects the rollback of its own refused write', () => {
    const t = new RecordingTracker(3);
    t.wrote(4);
    expect(t.observe(4)).toBe(true); // latency-compensated
    expect(t.observe(3)).toBe(false); // the server refused it
  });

  it('rejects another device undoing below the count it opened at', () => {
    const t = new RecordingTracker(3);
    expect(t.observe(2)).toBe(false);
  });
});
