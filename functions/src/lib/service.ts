import { serviceCatalogue } from '@asl/content';
import { COMPUTER_OPPONENTS, serviceAfter as scoreService, type ServiceResult, type UserDoc } from '@asl/platform';

/** The scenarios the decorations count, with the sides the computer opponent plays. */
export const SERVICE_CATALOGUE = serviceCatalogue(COMPUTER_OPPONENTS);

/** A counted result applied to a player's decorations, against the scenarios in this build (see @asl/platform). */
export const serviceAfter = (user: Pick<UserDoc, 'service' | 'medals' | 'betaScenarios'>, result: ServiceResult, at: unknown) =>
  scoreService(user, result, at, SERVICE_CATALOGUE);
