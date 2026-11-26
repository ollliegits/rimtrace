import type { Gray } from './image';

/** Linear interpolierte Stelle, an der die Folge `v` zwischen den Indizes i und i+1 die Schwelle `thr` kreuzt. */
function cross(v: ArrayLike<number>, i: number, thr: number): number {
  const a = v[i];
  const b = v[i + 1];
  return i + (a === b ? 0.5 : (thr - a) / (b - a));
}

/** Erste Kante von links (hell → dunkel) und letzte von rechts (dunkel → hell); nur gültig, wenn beide Ränder hell sind. */
export function spanEdges(v: ArrayLike<number>, thr: number): { left: number; right: number } | undefined {
  const n = v.length;
  if (n < 3 || v[0] < thr || v[n - 1] < thr) return undefined;
  let i = 0;
  while (v[i + 1] >= thr) i++;
  let j = n - 1;
  while (v[j - 1] >= thr) j--;
  if (i + 1 >= n || j - 1 < 0 || j - 1 < i + 1) return undefined;
  return { left: cross(v, i, thr), right: cross(v, j - 1, thr) };
}

/** Ausschnitt [x0, x1) einer Zeile. */
function rowSlice(img: Gray, y: number, x0: number, x1: number): Uint8Array {
  return img.data.subarray(y * img.width + x0, y * img.width + x1);
}

/** Unterste Zeile in [y0, y1), in der das Fenster [x0, x1) einen dunklen Pixel enthält (die erste Zeile ohne Dunkles beendet die Suche). */
export function lastDarkRow(img: Gray, x0: number, x1: number, y0: number, y1: number, thr: number): number {
  let last = -1;
  for (let y = y0; y < y1; y++) {
    const row = rowSlice(img, y, x0, x1);
    let dark = false;
    for (let i = 0; i < row.length && !dark; i++) dark = row[i] < thr;
    if (dark) last = y;
    else if (last >= 0) break;
  }
  return last;
}

export interface Flanks {
  left: number;
  right: number;
}

/** Linke/rechte Flanke, gemittelt über die Zeilen [y0, y1). Zeilen ohne gültige Kanten zählen nicht. */
export function flanks(img: Gray, x0: number, x1: number, y0: number, y1: number, thr: number): Flanks | undefined {
  let l = 0;
  let r = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    const e = spanEdges(rowSlice(img, y, x0, x1), thr);
    if (!e) continue;
    l += e.left;
    r += e.right;
    n++;
  }
  return n ? { left: x0 + l / n, right: x0 + r / n } : undefined;
}

/** Unterkante des Dunklen in Spalte x (Subpixel): von unten (Zeile yEnd-1) aufwärts bis zum ersten dunklen Pixel. */
export function bottomEdge(img: Gray, x: number, yStart: number, yEnd: number, thr: number): number | undefined {
  for (let y = yEnd - 1; y > yStart; y--) {
    const a = img.data[y * img.width + x];
    if (a >= thr) continue;
    const b = img.data[(y + 1) * img.width + x];
    return y + (b === a ? 0.5 : (thr - a) / (b - a));
  }
  return undefined;
}

/** Oberkante des Dunklen in Spalte x (Subpixel), von oben ab yStart. */
export function topEdge(img: Gray, x: number, yStart: number, yEnd: number, thr: number): number | undefined {
  for (let y = yStart; y < yEnd - 1; y++) {
    const a = img.data[y * img.width + x];
    if (a >= thr) continue;
    const p = img.data[(y - 1) * img.width + x];
    return y - 1 + (p === a ? 0.5 : (p - thr) / (p - a));
  }
  return undefined;
}
