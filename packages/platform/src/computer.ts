/** Whether this build ships a computer opponent. */
export const COMPUTER_AVAILABLE: boolean = false;
/** The seat a computer opponent takes (its uid is not a user's). */
export const COMPUTER_UID = 'computer';
/** What players call the computer opponent. */
export const COMPUTER_NAME = 'the computer';

/** Scenarios with a computer opponent, and the sides it can play. */
export const COMPUTER_OPPONENTS: Record<string, string[]> = {};
