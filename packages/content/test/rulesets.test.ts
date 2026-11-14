import { describe, expect, it } from 'vitest';
import { ALL_SCENARIOS, ASL_TESTBED_SCENARIO, COMMERCIAL_SCENARIOS, isPlayable, rulesetFor, scenariosOfRuleset, staticsFor } from '../src';
import { aslCoreModules, piecesModule, scenarioRuleset, sk1CoreModules, sk2CoreModules, sk3CoreModules, turnModule } from '@asl/rules';

/**
 * Every Starter Kit scenario's ruleset id and version hash, as they were before the Full ASL ruleset
 * was added (2026-11-04). Live matches are pinned to these hashes: adding ASL modules must never
 * change them. A deliberate SK ruleset change updates this table in the same commit.
 */
const SK_RULESETS: Record<string, [string, string]> = {
  'sk-s7': ['asl-sk1', 'af7a1c416c2b4230f894542767c32bac022cd6408676e917241e25572662d181'],
  'sk-s8': ['asl-sk1', 'af7a1c416c2b4230f894542767c32bac022cd6408676e917241e25572662d181'],
  'sk-s17': ['asl-sk2', '1c980a3de9543afa15ea723e000f17545359fb043a750cd784afc781baccaf5a'],
  'sk-s18': ['asl-sk2', 'f0269c65169e5d80555a91cfd87015a4f3dda81fb45cfa6c1635dfb9743f994c'],
  'sk-s19': ['asl-sk1', 'c655a950f1070bf14d3be7d780ba767f9f7b06be76643967b43cc71ddedec87e'],
  'sk-s28': ['asl-sk3', 'f30f6883879569a775ac33bb7a52895e0e7cb504c9e79ab49f42bf48a1fb0023'],
  'sk-s29': ['asl-sk2', '6ac29873eea3e5f54b56f0a1b2630a30646caee9b5954f2b3d00612103bef793'],
  'sk-s30': ['asl-sk3', '887a7683386c08e208c9080f3c3ed07b0f75c51f84aa41f7ba9550edd90143cc'],
  'sk-s31': ['asl-sk2', '7c3bf1e727c67e5ccf7630ee60cb695a56edef18b9a0dccea650366402425673'],
  'sk-s32': ['asl-sk2', '6ac29873eea3e5f54b56f0a1b2630a30646caee9b5954f2b3d00612103bef793'],
  'sk-s33': ['asl-sk3', '7a57d55598d8cf0efb73023c4d5a757b4aa655b1cafd00b8f22017c2378dd550'],
  'sk-s34': ['asl-sk3', '1c7b7a3d4649b43b38dcb3982399abd3050eb2e11b22aad3213f8fc0a0ce795a'],
  'sk-s35': ['asl-sk3', 'aa9350ff3f024946fa6f7f55941ca8eb396a0a309ac7004555af92fdd8577540'],
  'sk-s36': ['asl-sk3', 'e88afe8ddb5b3bc7e24330e04f429f4888e38d271f3e9a6a7b9b7fe2dd6fb704'],
  'lma-10': ['asl-sk3', '6cbd4233d83ace34b1a48509c419928a1d7bed8030b786af4ba94c634093be17'],
  'lma-8': ['asl-sk3', 'c1a42679fba2338500abb7db1bcd7db44e7cedc6c71c18ca6c001f1f83e13c9c'],
  'lma-6': ['asl-sk2', '0bc0ef15b8910a33817bd1cf5d3ac25121a0cd196689ea1f580fe4367c004358'],
  'lma-2': ['asl-sk2', 'cdc52a4645759c3263744844212e0a16986041ad75383c43d6a126d9e1ab4831'],
  'lma-9': ['asl-sk2', 'b71c67e49c434133fd1ddcc91f1fb1dc98a4a60b7871bcfab4ab66520cbf1f4a'],
  'lma-7': ['asl-sk2', '7637c41d4322860d407ffcc2a5d2622d88afb050b009330cecbba4bb8718026f'],
  'lma-4': ['asl-sk3', 'bb51408abd36bd8b4334243319fb67f06c9d820f3ceda6c1149df68c65ad6117'],
  'demo-crossroads': ['asl-sk1', 'af7a1c416c2b4230f894542767c32bac022cd6408676e917241e25572662d181'],
  'demo-gun-line': ['asl-sk2', 'cc125c396df1cbf891300997019e7788227129ba17d78d6c9954f285380397a9'],
  'demo-armor': ['asl-sk3', '31c6b1cc3a0e388b7199e55139fbb4dfa2ae1aa578b6d203835a052d580f35fb'],
  'demo-pacific': ['asl-sk4', '850baf78972726ea0adead05548d9419679e869be9ee975dc35b6bd99f34879a'],
  'demo-jungle': ['asl-sk4', '850baf78972726ea0adead05548d9419679e869be9ee975dc35b6bd99f34879a'],
  'lma-5': ['asl-sk3', 'ccd10f12fdc8440d9eb2d481d47ecf52d775b76cfec8208c30fd2fc7535d809e'],
};

describe('rulesets', () => {
  it('keeps every Starter Kit scenario on its ruleset id and version hash', () => {
    const commercial = new Set(COMMERCIAL_SCENARIOS.map((s) => s.id));
    const sk = ALL_SCENARIOS.filter((s) => isPlayable(s) && scenarioRuleset(s) === 'starter-kit' && !commercial.has(s.id));
    expect(sk.map((s) => s.id).sort()).toEqual(Object.keys(SK_RULESETS).sort());
    for (const s of sk) {
      const r = rulesetFor(s);
      expect([r.id, r.versionHash], s.id).toEqual(SK_RULESETS[s.id]);
    }
  });

  it('builds the Full ASL ruleset from every SK module plus the ASL modules', () => {
    const r = rulesetFor(ASL_TESTBED_SCENARIO);
    expect(r.id).toBe('asl-full');
    // Every SK module comes along, in order, then the ASL modules, which only add to or override them, then the
    // test bed's special rule (a fortified building).
    const ids = [...[piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules, ...aslCoreModules].map((m) => m.id), 'ssr.fortified-buildings'];
    expect(r.modules.map((m) => m.id)).toEqual(ids);
    expect(Object.values(SK_RULESETS).map(([, h]) => h)).not.toContain(r.versionHash);
  });

  it('lists the test bed only under the Full ASL ruleset', () => {
    expect(scenariosOfRuleset('full-asl').map((s) => s.id)).toEqual(['asl-testbed']);
    expect(scenariosOfRuleset('starter-kit').map((s) => s.id)).not.toContain('asl-testbed');
    // It has the full counter set, like an SK3 game.
    expect(staticsFor(ASL_TESTBED_SCENARIO).counters['ru.447']).toBeDefined();
  });
});
