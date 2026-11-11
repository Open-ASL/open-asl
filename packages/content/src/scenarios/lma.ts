import type { ScenarioDef } from '@asl/rules';
import { LMA_10 } from './lma/lma10';
import { LMA_8 } from './lma/lma8';
import { LMA_6 } from './lma/lma6';
import { LMA_2 } from './lma/lma2';
import { LMA_9 } from './lma/lma9';
import { LMA_5 } from './lma/lma5';
import { LMA_7 } from './lma/lma7';
import { LMA_4 } from './lma/lma4';

/*
 * Laurent Martin's free ASL Starter Kit scenarios (LMA2–LMA10), published at lm.polar.free.fr/aslsk.htm. The cards are
 * French originals with partial English translations by Eddy Houghton; the text here is translated afresh from the
 * French (proper nouns kept in French), with the designer and the original translator credited on each card.
 * LMA1 and LMA3 were never published there. The Free French and the Canadians use British counters, as the cards do.
 */

export const LMA_SCENARIOS: ScenarioDef[] = [LMA_2, LMA_4, LMA_5, LMA_6, LMA_7, LMA_8, LMA_9, LMA_10];
export * from './lma/lma5';
