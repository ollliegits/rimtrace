import type { Gray } from './image';

/** Zeilenprofil des Bettstreifens: Mittel über die Spalten [x0, x1), abgeleitet (unabhängig von Helligkeitsdrift). */
export function bedProfile(img: Gray, x0: number, x1: number, y0: number, y1: number): Float32Array {
  const { data, width } = img;
  const n = y1 - y0;
  const row = new Float32Array(n);
  for (let y = 0; y < n; y++) {
    const o = (y0 + y) * width;
    let s = 0;
    for (let x = x0; x < x1; x++) s += data[o + x];
    row[y] = s / (x1 - x0);
  }
  const d = new Float32Array(n);
  for (let y = 1; y < n; y++) d[y] = row[y] - row[y - 1];
  return d;
}

/**
 * Verschiebung des Bettes zwischen zwei Profilen in Pixeln (positiv = Inhalt wandert nach unten),
 * über normierte Kreuzkorrelation mit Parabel-Verfeinerung. NaN, wenn nichts Verwertbares im Streifen ist.
 */
export function bedShift(prev: Float32Array, cur: Float32Array, maxShift: number): number {
  const n = prev.length;
  const score = new Float64Array(2 * maxShift + 1);
  let best = -Infinity;
  let bi = -1;
  for (let k = -maxShift; k <= maxShift; k++) {
    let ab = 0;
    let aa = 0;
    let bb = 0;
    for (let y = Math.max(0, k); y < Math.min(n, n + k); y++) {
      const a = prev[y - k];
      const b = cur[y];
      ab += a * b;
      aa += a * a;
      bb += b * b;
    }
    const sc = aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
    score[k + maxShift] = sc;
    if (sc > best) {
      best = sc;
      bi = k + maxShift;
    }
  }
  if (!(best > 0.2)) return NaN;
  let frac = 0;
  if (bi > 0 && bi < score.length - 1) {
    const [l, c, r] = [score[bi - 1], score[bi], score[bi + 1]];
    const den = l - 2 * c + r;
    if (den < 0) frac = (0.5 * (l - r)) / den;
  }
  return bi - maxShift + frac;
}
