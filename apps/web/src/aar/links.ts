/** The public after action report page of a match. */
export const aarPath = (matchId: string) => `/aar/${matchId}`;

/** The replay page of a match; sign-in is required to open it. */
export const replayPath = (matchId: string) => `/match/${matchId}/replay`;

/** The sign-in page, returning to `next` (a same-origin path) afterwards. */
export const loginPath = (next: string) => `/login?next=${encodeURIComponent(next)}`;
