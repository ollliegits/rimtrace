import type { Levels } from './image';

export interface Edge {
  /** Subpixel-Position; Pixel i belegt [i, i+1). */
  x: number;
  /** true: dunkel → hell, false: hell → dunkel. */
  rising: boolean;
}

/**
 * Findet Kanten einer 1D-Linie. Grobposition über den Mittelwert-Durchgang,
 * Feinposition über die „Dunkelmenge“ im Fenster ±w: Für eine Stufe, die mit einem
 * symmetrischen Kern geglättet wurde (Pixelbox, Unschärfe), ist sie exakt die Kantenlage.
 * Voraussetzung: im Fenster liegt nur diese eine Kante (Strukturen ≥ 2w+1 Pixel).
 */
export function findEdges(line: ArrayLike<number>, { lo, hi }: Levels, w = 5): Edge[] {
  const n = line.length;
  const mid = (lo + hi) / 2;
  const range = hi - lo;
  const edges: Edge[] = [];
  if (range <= 0) return edges;

  for (let j = 0; j < n - 1; j++) {
    const a = line[j];
    const b = line[j + 1];
    const falling = a >= mid && b < mid;
    const rising = a < mid && b >= mid;
    if (!falling && !rising) continue;
    const s = j - w + 1;
    const e = j + w + 1;
    if (s < 0 || e > n) continue;
    let dark = 0;
    for (let i = s; i < e; i++) dark += (hi - line[i]) / range;
    edges.push({ x: rising ? s + dark : e - dark, rising });
  }
  return edges;
}
