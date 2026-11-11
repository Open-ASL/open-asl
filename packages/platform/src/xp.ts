/** Experience awarded by the server when a match completes. */
export const XP = {
  // Hotseat is useful practice, but it is self-reported play on a shared device. Keep its
  // participation award well below even an online loss so it cannot shortcut the rank ladder.
  hotseatComplete: 10,
  onlineWin: 150,
  onlineDraw: 100,
  onlineLoss: 75,
} as const;
