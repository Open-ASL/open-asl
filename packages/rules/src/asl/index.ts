import type { RuleModule } from '@asl/engine';
import { aslBypassModule } from './bypass';
import { aslFieldPromotionModule } from './fieldPromotion';
import { aslLeaderCreationModule } from './leaderCreation';
import { aslLevelsModule } from './levels';
import { aslLocationsModule } from './locations';
import { aslLosModule } from './los';
import { aslRandomSelectionModule } from './randomSelection';
import { aslSwRepairModule } from './swRepair';
import { aslTerrainModule } from './terrain';

export { aslBypassModule, bypassable, bypassCorners, plan as bypassPlan } from './bypass';
export { aslFieldPromotionModule } from './fieldPromotion';
export { aslLeaderCreationModule } from './leaderCreation';
export { aslLevelsModule, interiorBuildingHex } from './levels';
export { aslLocationsModule } from './locations';
export { aslLosModule } from './los';
export { aslRandomSelectionModule } from './randomSelection';
export { aslSwRepairModule } from './swRepair';
export { aslTerrainModule } from './terrain';

/**
 * Full ASL (the ASL Rulebook, Chapter A first) on top of the Starter Kit modules.
 *
 * Both rulesets live on one code base. The SK rules are a less detailed version of the same rules,
 * so a full ASL game installs every SK module and then these, which extend, suppress or replace
 * the SK contributions: `r.contribute` adds a DRM, MF or FP term, `r.suppress` switches an SK
 * contribution off by id, a `ReplacementDef` replaces an event, and new procedures and actions are
 * added the same way. Nothing is duplicated.
 *
 * A fix that applies to both rulebooks (the SK text agrees with ASL or is silent) goes into the
 * shared SK module, citing both (`// SK4 5.3; ASLRB A18.11`). Only where the SK text explicitly
 * differs does the ASL reading go into a module here. Where SK legality is hard-coded, the step
 * that needs to change it first turns that spot into a query whose default is the SK answer.
 *
 * One module per topic; `packages/rules/docs/asl-chapter-a.md` tracks which rule is where.
 */
export const aslCoreModules: RuleModule[] = [aslLocationsModule, aslLevelsModule, aslLosModule, aslRandomSelectionModule, aslFieldPromotionModule, aslLeaderCreationModule, aslSwRepairModule, aslTerrainModule, aslBypassModule];
