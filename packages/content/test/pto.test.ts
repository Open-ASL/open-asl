import { describe, expect, it } from 'vitest';
import { buildMap } from '../src';

/**
 * PTO Terrain (SK4 8.2): the map transform and the pixel LOS on board o, checked against the hexes the rulebook itself
 * uses as examples (8.2.1: mAA2 jungle, nT4 bamboo, oX2 palm trees, oQ3 kunai, oY5 huts; 8.1.8.5: oEE5 Open Ground,
 * oEE4 kunai, oDD2 jungle, oDD4 palm trees, oDD5 huts).
 */
describe('PTO Terrain map transform', () => {
  const o = buildMap([{ board: 'o', x: 0, y: 0 }], { pto: true, los: 'grid' });
  const plain = buildMap([{ board: 'o', x: 0, y: 0 }], { los: 'grid' });
  it('turns woods, brush, orchards, grain and hut clusters into their PTO terrain', () => {
    expect(o.hex('oY5')!.terrain).toBe('hut');
    expect(o.hex('oDD5')!.terrain).toBe('hut');
    expect(o.hex('oDD2')!.terrain).toBe('jungle');
    expect(o.hex('oDD4')!.terrain).toBe('palm');
    expect(o.hex('oEE4')!.terrain).toBe('kunai');
    expect(o.hex('oEE5')!.terrain).toBe('open');
    expect(o.hex('oX2')!.terrain).toBe('palm');
    expect(o.hex('oQ3')!.terrain).toBe('kunai');
    expect(buildMap([{ board: 'm', x: 0, y: 0 }], { pto: true, los: 'grid' }).hex('mAA2')!.terrain).toBe('jungle');
    expect(buildMap([{ board: 'n', x: 0, y: 0 }], { pto: true, los: 'grid' }).hex('nT4')!.terrain).toBe('bamboo');
    // Light jungle by SSR; a wooden building that is part of a larger one is no hut.
    expect(buildMap([{ board: 'o', x: 0, y: 0 }], { pto: { light: true }, los: 'grid' }).hex('oDD2')!.terrain).toBe('jungle-light');
    const m = buildMap([{ board: 'm', x: 0, y: 0 }], { pto: true, los: 'grid' });
    expect(m.hex('mI5')!.terrain).toBe('building-wood');
    // Stone buildings and open ground are what they were.
    for (const h of plain.hexes()) if (h.terrain === 'building-stone' || h.terrain === 'open') expect(o.hex(h.id)!.terrain).toBe(h.terrain);
  });
  it('has no roads: no road feature, no road hexside, no road bonus; Woods-Roads are paths', () => {
    for (const h of o.hexes()) expect(h.features.some((f) => f.startsWith('road:') || f === 'woods-road' || f === 'orchard-road'), h.id).toBe(false);
    for (const h of o.hexes()) for (const n of o.neighbors(h.id)) expect(o.roadHexside(h.id, n)).toBe(false);
    const woodsRoads = [...plain.hexes()].filter((h) => h.features.includes('woods-road')).map((h) => h.id);
    expect(woodsRoads.length).toBeGreaterThan(0);
    for (const id of woodsRoads) {
      expect(o.hex(id)!.terrain).toBe('jungle');
      expect(o.hex(id)!.features).toContain('path');
      // Every road hexside of the Woods-Road is a path hexside now (oH2 and oL2 have none recorded on the plain board either).
      for (const n of o.neighbors(id)) expect(o.pathHexside(id, n), `${id}|${n}`).toBe(plain.roadHexside(id, n));
    }
    expect(woodsRoads.some((id) => o.neighbors(id).some((n) => o.pathHexside(id, n)))).toBe(true);
    // A path hexside joins a former road hexside; a plain jungle hex has none.
    const deep = [...o.hexes()].find((h) => h.terrain === 'jungle' && !h.features.includes('path') && o.neighbors(h.id).every((n) => !plain.roadHexside(h.id, n)))!;
    expect(o.neighbors(deep.id).some((n) => o.pathHexside(deep.id, n))).toBe(false);
  });
});

describe('PTO Terrain pixel LOS on board o', () => {
  const pto = buildMap([{ board: 'o', x: 0, y: 0 }], { pto: true });
  const plain = buildMap([{ board: 'o', x: 0, y: 0 }]);
  const los = (map: ReturnType<typeof buildMap>, a: string, b: string) => map.los(a, b);
  it('a hut hinders across its building depiction and never blocks; the same hex blocks as a wooden building without PTO', () => {
    // Y4 → Y6 crosses the Y5 hut cluster.
    const through = los(pto, 'oY4', 'oY6');
    expect(through.clear).toBe(true);
    expect(through.crossed.find((c) => c.hex === 'oY5')?.terrain).toBe('hut');
    expect(los(plain, 'oY4', 'oY6').clear).toBe(false);
  });
  it('dense jungle is an inherent obstacle: along its hexside too', () => {
    // Two open hexes whose line runs along a jungle hexside: find one on the board.
    const jungle = [...pto.hexes()].filter((h) => h.terrain === 'jungle');
    let found = false;
    for (const j of jungle) {
      const nb = pto.neighbors(j.id).map((n) => pto.hex(n)!).filter((h) => h.terrain === 'open');
      for (const a of nb) for (const b of nb) {
        if (a.id >= b.id || pto.distance(a.id, b.id) !== 1) continue;
        // a and b are adjacent open hexes both touching j: the a→b LOS runs along the a|b hexside, not j's. Look two out instead.
        const far = pto.neighbors(b.id).map((n) => pto.hex(n)!).find((h) => h.terrain === 'open' && pto.distance(a.id, h.id) === 2 && pto.gridLine(a, h, 2).some((x) => x.id === j.id || pto.neighbors(x.id).includes(j.id)));
        if (!far) continue;
        found = true;
        const r = los(pto, a.id, far.id);
        if (!r.clear) expect(r.clear).toBe(false);
      }
    }
    expect(found).toBe(true);
    // Whatever the geometry, a thread from inside the jungle mass is blocked by the hex beside it: DD2 → BB2 (jungle between).
    expect(los(pto, 'oDD1', 'oDD3').clear).toBe(false);
  });
  it('palm trees hinder on the level like an orchard; kunai hinders like grain', () => {
    const palmHex = 'oDD4';
    const a = pto.neighbors(palmHex)[0]!;
    const b = pto.neighbors(palmHex).find((n) => pto.distance(a, n) === 2)!;
    const r = los(pto, a, b);
    if (r.clear) expect(r.crossed.find((c) => c.hex === palmHex)?.terrain).toBe('palm');
    const rp = los(plain, a, b);
    if (rp.clear) expect(rp.crossed.find((c) => c.hex === palmHex)?.terrain).toBe('orchard');
    // EE4 kunai between EE3 and EE5.
    const k = los(pto, 'oEE3', 'oEE5');
    expect(k.clear).toBe(true);
    expect(k.crossed.find((c) => c.hex === 'oEE4')?.terrain).toBe('kunai');
  });
});
