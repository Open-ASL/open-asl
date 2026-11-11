/**
 * Tells this browser's own writes to a hotseat match document apart from another device's.
 *
 * A hotseat recording is read once when the board opens and then appended to from this browser
 * only, so if the match document's action count ever takes a value this browser did not write,
 * the game has been played (or undone) somewhere else and this board is out of step with the
 * recording. The counts this browser writes are remembered in order; Firestore may coalesce
 * snapshots, so observing one of them also retires every earlier one.
 */
export class RecordingTracker {
  private ours: number[];

  constructor(initialCount: number) {
    this.ours = [initialCount];
  }

  /** This browser has written the match document with this action count. */
  wrote(count: number) {
    this.ours.push(count);
  }

  /**
   * The match document now shows this action count. True when it is one of ours (and the ones
   * written before it are retired); false when another writer produced it.
   */
  observe(count: number): boolean {
    const i = this.ours.indexOf(count);
    if (i < 0) return false;
    this.ours.splice(0, i);
    return true;
  }
}
