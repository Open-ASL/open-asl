import { describe, expect, it } from 'vitest';
import type { AwardedMedal, ServiceResult, UserDoc } from '@asl/platform';
import { serviceAfter } from '../src/lib/service';

type Player = Pick<UserDoc, 'service' | 'medals' | 'betaScenarios'>;
const fresh = (): Player => ({ medals: [], betaScenarios: [] });
// sk-s7 is a free download scenario with a German and an American side, in Northwest Europe.
const german = (r: Partial<ServiceResult> = {}): ServiceResult => ({ pool: 'human', scenarioId: 'sk-s7', side: 'ge', outcome: 'win', reason: 'scenario end', opponentBalance: false, ...r });

function play(p: Player, results: ServiceResult[], at = 'day') {
  let last: ReturnType<typeof serviceAfter> | null = null;
  for (const r of results) {
    last = serviceAfter(p, r, at);
    p = { ...p, service: last.service, medals: last.medals };
  }
  return { player: p, last: last! };
}

describe('scoring a match for the decorations', () => {
  it('awards the Iron Cross 2nd Class on the 20th German win, not before, stamped with the time of that match', () => {
    const { player } = play(fresh(), Array(19).fill(german()));
    expect(player.medals.map((m) => m.id)).not.toContain('de-iron-cross-2nd-class');
    const twentieth = serviceAfter(player, german(), 'the 20th');
    expect(twentieth.medals).toContainEqual({ id: 'de-iron-cross-2nd-class', awardedAt: 'the 20th' });
    expect(twentieth.awards.earned).toEqual([{ id: 'de-iron-cross-2nd-class', level: 1 }]);
  });

  it('19 wins in a Brittany scenario also earn the EAME Campaign Medal with its Northern France battle star', () => {
    expect(play(fresh(), Array(19).fill(german())).player.medals).toEqual([{ id: 'us-eame-campaign', awardedAt: 'day', level: 2, levelAt: 'day' }]);
  });

  it('reports what the match moved closer, and publishes the headline counts', () => {
    const { last } = play(fresh(), [german()]);
    expect(last.awards.advanced).toEqual(expect.arrayContaining([{ id: 'de-knights-cross', value: 1, goal: 40 }, { id: 'us-medal-of-honor', value: 1, goal: 400 }]));
    expect(last.awardProgress['de-knights-cross']).toEqual([1, 40]);
    // Nothing for the Russians or the computer opponent moved.
    expect(last.awards.advanced.map((a) => a.id)).not.toContain('su-order-of-lenin');
    expect(last.awards.advanced.map((a) => a.id)).not.toContain('us-legion-of-merit');
  });

  it('drops retired decorations from the record it writes', () => {
    const old: AwardedMedal[] = [{ id: 'cib' as never, awardedAt: 0 }, { id: 'beta-service', awardedAt: 0 }];
    expect(serviceAfter({ ...fresh(), medals: old }, german(), 'now').medals).toEqual([{ id: 'beta-service', awardedAt: 0 }]);
  });

  it('a loss to the computer changes nothing', () => {
    const { player, last } = play(fresh(), [german({ pool: 'bot', outcome: 'loss' })]);
    expect(player.service!.bot).toEqual({});
    expect(last.awards).toEqual({ earned: [], advanced: [] });
  });
});
