/** Colours telling a side's Guns apart (by their identity letter): on their badge, their Acquired Target counters and the line between. */
export const IDENT_COLORS = [0xffd166, 0x4cc9f0, 0xf72585, 0x80ed99, 0xff9f1c, 0xb388ff, 0xffffff];
export const identColor = (letter: string) => IDENT_COLORS[(letter.charCodeAt(0) - 65) % IDENT_COLORS.length]!;
/** The same colour as CSS. */
export const identCss = (letter: string) => `#${identColor(letter).toString(16).padStart(6, '0')}`;
