import { findEdges } from './edges';
import { columnLine, rowLine, type Gray, type Levels } from './image';
import type { Setup } from './setup';

export interface RimMeasurement {
  /** Mitte der Felge relativ zur senkrechten Referenzkante, mm (nach rechts positiv). */
  lateralMm: number;
  /** Oberkante der Hörner relativ zur waagerechten Referenzkante, mm (nach oben positiv). */
  heightMm: number;
  mmPerPx: number;
  /** Rohwerte in Pixeln, für Overlay und Diagnose. */
  px: { refX: number; left: number; right: number; refY: number; topLeft: number; topRight: number };
}

const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;

export function measureRim(img: Gray, s: Setup, lv: Levels): RimMeasurement | null {
  // Flanken: Zeile = [Referenzkante (hell), linke Flanke (dunkel), rechte Flanke (hell)]
  const refXs: number[] = [];
  const lefts: number[] = [];
  const rights: number[] = [];
  for (let y = s.flankRows[0]; y < s.flankRows[1]; y++) {
    const e = findEdges(rowLine(img, y), lv);
    if (e.length !== 3 || !e[0].rising || e[1].rising || !e[2].rising) continue;
    refXs.push(e[0].x);
    lefts.push(e[1].x);
    rights.push(e[2].x);
  }
  const rows = s.flankRows[1] - s.flankRows[0];
  if (refXs.length < rows / 2) return null;

  const refX = mean(refXs);
  const left = mean(lefts);
  const right = mean(rights);
  const mmPerPx = s.rimWidthMm / (right - left);

  // Hörner: Spalte von oben = [Leistenoberkante, Leistenunterkante (Referenz), Hornoberkante]
  const columnRanges = [
    [left + s.hornColumnsMm[0] / mmPerPx, left + s.hornColumnsMm[1] / mmPerPx],
    [right - s.hornColumnsMm[1] / mmPerPx, right - s.hornColumnsMm[0] / mmPerPx],
  ];
  const tops: number[][] = [[], []];
  const refYs: number[] = [];
  for (let h = 0; h < 2; h++) {
    const [c0, c1] = columnRanges[h];
    for (let x = Math.ceil(c0); x <= Math.floor(c1); x++) {
      const e = findEdges(columnLine(img, x, s.columnScanStart, img.height), lv);
      if (e.length !== 3 || e[0].rising || !e[1].rising || e[2].rising) continue;
      refYs.push(e[1].x + s.columnScanStart);
      tops[h].push(e[2].x + s.columnScanStart);
    }
  }
  if (!tops[0].length || !tops[1].length) return null;

  const refY = mean(refYs);
  const topLeft = mean(tops[0]);
  const topRight = mean(tops[1]);

  return {
    lateralMm: ((left + right) / 2 - refX) * mmPerPx,
    heightMm: (refY - (topLeft + topRight) / 2) * mmPerPx,
    mmPerPx,
    px: { refX, left, right, refY, topLeft, topRight },
  };
}
