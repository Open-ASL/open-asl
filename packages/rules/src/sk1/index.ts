import type { RuleModule } from '@asl/engine';
import { fireModule, fireResultModule } from './fire';
import { firePhasesModule } from './firePhases';
import { movementModule } from './movement';
import { rallyModule } from './rally';
import { routModule } from './rout';
import { advanceModule } from './advance';
import { closeCombatModule } from './closeCombat';
import { scenarioModule } from './scenario';
import { moraleModule } from './morale';
import { phasesModule } from './phases';
import { statusModule } from './status';
import { terrainModule } from './terrain';
import { weatherModule } from './weather';

export * from './status';
export * from './terrain';
export * from './morale';
export * from './fire';
export * from './phases';
export * from './firePhases';
export * from './movement';
export * from './known';
export * from './rally';
export * from './rout';
export * from './advance';
export * from './closeCombat';
export * from './scenario';
export * from './fortified';
export * from './weather';
export * from './variableReinforcements';
export * from './forceChart';
export * from './startMalfunctioned';
export * from './disassembledSw';
export * from './river';
export * from './exhaustion';
export * from './scatterSetup';
export * from './entryGroups';
export * from './secretEntryTurns';
export * from './entryOrderDr';
export * from './entryLosses';
export * from './entryStretch';
export * from './entryAfterFire';
export * from './forceRules';
export * from './losFirepower';
export * from './areaVp';
export * from './vpTally';
export * from './commissar';
export * from './terrainCost';
export * from './embankmentRailroad';
export * from './secretSw';
export * from './secretLength';
export * from './reinforcementTable';
export * from './selfRallyOnly';
export * from './offboardArtillery';
export * from './leaderRelief';
export * from './rangeHindrance';
export * from './roadsOpenGround';
export * from './preparedPositions';
export * from './setupDeploy';
export * from './clearAreas';
export * from './data/terrain';

/** SK1 modules in install order (phase flow modules are added as they land). */
export const sk1CoreModules: RuleModule[] = [
  statusModule,
  terrainModule,
  moraleModule,
  fireModule,
  fireResultModule,
  weatherModule,
  phasesModule,
  firePhasesModule,
  movementModule,
  rallyModule,
  routModule,
  advanceModule,
  closeCombatModule,
  scenarioModule,
];
