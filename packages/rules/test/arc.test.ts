import { describe, expect, it } from 'vitest';
import { cubeNeighbors, type Cube } from '@asl/engine';
import { arcNeighbours, caChangeDrm, inCoveredArc, nearestSpine, spineChange } from '../src';

const O: Cube = { q: 0, r: 0, s: 0 };
const add = (a: Cube, b: Cube): Cube => ({ q: a.q + b.q, r: a.r + b.r, s: a.s + b.s });
const scale = (a: Cube, n: number): Cube => ({ q: a.q * n, r: a.r * n, s: a.s * n });
const D = cubeNeighbors(O);

/** Every hex within `radius` of the origin. */
function disc(radius: number): Cube[] {
  const out: Cube[] = [];
  for (let q = -radius; q <= radius; q++) for (let r = -radius; r <= radius; r++) {
    const s = -q - r;
    if (Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) <= radius) out.push({ q, r, s });
  }
  return out;
}

/** Rotate a cube 60° clockwise about the origin. */
const rot = (c: Cube): Cube => ({ q: -c.r, r: -c.s, s: -c.q });

describe('Covered Arc geometry (SK4 3.2.4)', () => {
  it('covers the Gun hex, the two hexes joined by the spine and the wedge between their hexrows', () => {
    expect(inCoveredArc(O, 0, O)).toBe(true);
    const [a, b] = arcNeighbours(O, 0);
    expect(inCoveredArc(O, 0, a)).toBe(true);
    expect(inCoveredArc(O, 0, b)).toBe(true);
    expect(inCoveredArc(O, 0, scale(a, 4))).toBe(true);
    expect(inCoveredArc(O, 0, add(scale(a, 2), scale(b, 3)))).toBe(true);
    // The other four neighbours are outside.
    const same = (x: Cube, y: Cube) => x.q === y.q && x.r === y.r;
    for (const n of D) if (!same(n, a) && !same(n, b)) expect(inCoveredArc(O, 0, n)).toBe(false);
  });

  it('is a 60° sector: n + 1 hexes of each ring of 6n, the six arcs tiling the ring with shared bounding rows', () => {
    const ring = disc(6).filter((c) => Math.max(Math.abs(c.q), Math.abs(c.r), Math.abs(c.s)) === 6);
    for (let s = 0; s < 6; s++) expect(ring.filter((c) => inCoveredArc(O, s, c)).length).toBe(7);
    const covered = new Set<string>();
    for (let s = 0; s < 6; s++) for (const c of ring) if (inCoveredArc(O, s, c)) covered.add(`${c.q},${c.r}`);
    expect(covered.size).toBe(ring.length);
  });

  it('is invariant under rotating the target and the spine together', () => {
    for (const c of disc(4)) {
      for (let s = 0; s < 6; s++) {
        expect(inCoveredArc(O, s, c)).toBe(inCoveredArc(O, (s + 1) % 6, rot(c)));
      }
    }
  });

  it('measures hexspine changes the short way round and prices them per mount', () => {
    expect(spineChange(0, 0)).toBe(0);
    expect(spineChange(0, 1)).toBe(1);
    expect(spineChange(0, 5)).toBe(1);
    expect(spineChange(0, 3)).toBe(3);
    expect(spineChange(4, 1)).toBe(3);
    expect(caChangeDrm('360', 1)).toBe(1);
    expect(caChangeDrm('360', 2)).toBe(2);
    expect(caChangeDrm('NT', 1)).toBe(3);
    expect(caChangeDrm('NT', 2)).toBe(4);
    expect(caChangeDrm('NT', 0)).toBe(0);
  });

  it('finds the nearest spine covering a target', () => {
    // A target straight down a hexrow lies on the bounding row of two arcs; the nearer one wins.
    const t = scale(D[3]!, 3);
    expect(nearestSpine(O, 0, t)).toBe(2);
    expect(nearestSpine(O, 4, t)).toBe(3);
    const t2 = add(scale(D[2]!, 2), D[3]!);
    expect(nearestSpine(O, 0, t2)).toBe(2);
    expect(nearestSpine(O, 4, t2)).toBe(2);
  });
});
