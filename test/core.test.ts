import { describe, expect, it } from 'vitest';
import { defaultSetup, findEdges, recommend, spokeSide, type SpokeProfile } from '../src/core';

describe('findEdges', () => {
  it('liefert Subpixel-Position einer antialiasten Stufe', () => {
    // dunkel ab x = 10.3 (Pixel 10 zu 70 % dunkel)
    const line = Array.from({ length: 30 }, (_, i) => (i < 10 ? 230 : i === 10 ? 230 - 0.7 * 210 : 20));
    const [e] = findEdges(line, { lo: 20, hi: 230 });
    expect(e.rising).toBe(false);
    expect(e.x).toBeCloseTo(10.3, 6);
  });
});

describe('recommend (Faustregel)', () => {
  const s = defaultSetup;
  const empty = (): SpokeProfile => ({
    lateral: Array(s.spokes).fill(0),
    height: Array(s.spokes).fill(0),
    count: [],
  });

  it('Seitenschlag nach links: rechte Speiche anziehen, linke lösen', () => {
    const p = empty();
    p.lateral[3] = -1; // rechte Speiche (ungerade)
    p.lateral[4] = -1; // linke Speiche (gerade)
    const a = recommend(p, s, { toleranceMm: 0.1 });
    expect(spokeSide(s, 3)).toBe('right');
    expect(a.find((x) => x.spoke === 3)?.verb).toBe('tighten');
    expect(a.find((x) => x.spoke === 4)?.verb).toBe('loosen');
  });

  it('Höhe: zu hoch anziehen, zu tief lösen; nur Top-3 über Toleranz', () => {
    const p = empty();
    p.height[1] = 1.2;
    p.height[2] = -0.9;
    p.height[5] = 0.1;
    const a = recommend(p, s);
    expect(a.map((x) => [x.spoke, x.verb])).toEqual([[1, 'tighten'], [2, 'loosen']]);
  });
});
