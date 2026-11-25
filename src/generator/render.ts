import type { Setup } from '../core/setup';

export interface Scene {
  /** Speichenposition φ in Speichen (unbegrenzt, 0 = Doppelmarke an der Messstelle). */
  phi: number;
  lateralMm: number;
  heightMm: number;
  mmPerPx: number;
}

const BACKGROUND = 230;
const DARK = 20;

/** Addiert die Flächenüberdeckung eines achsparallelen Rechtecks (exakte Antialiasing-Überdeckung). */
function addRect(cov: Float32Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number): void {
  const ix0 = Math.max(0, Math.floor(x0));
  const ix1 = Math.min(w, Math.ceil(x1));
  const iy0 = Math.max(0, Math.floor(y0));
  const iy1 = Math.min(h, Math.ceil(y1));
  for (let y = iy0; y < iy1; y++) {
    const cy = Math.min(y + 1, y1) - Math.max(y, y0);
    const o = y * w;
    for (let x = ix0; x < ix1; x++) {
      cov[o + x] += (Math.min(x + 1, x1) - Math.max(x, x0)) * cy;
    }
  }
}

/** Zeichnet Felgensilhouette, Referenzhalter und Markerspur auf einen hellen Hintergrund. */
export function renderScene(s: Setup, scene: Scene, cov: Float32Array, out: Uint8Array): void {
  const { width: w, height: h } = s;
  const px = (mm: number) => mm / scene.mmPerPx;
  cov.fill(0);

  // Referenzhalter
  addRect(cov, w, h, 0, s.refBarTop, w, s.refY);
  addRect(cov, w, h, 0, s.refY, s.refX, h);

  // Felge: Körper mit zwei Hörnern
  const cx = s.rimCenterX + px(scene.lateralMm);
  const left = cx - px(s.rimWidthMm) / 2;
  const right = cx + px(s.rimWidthMm) / 2;
  const top = s.hornTopY - px(scene.heightMm);
  const bed = top + px(s.hornHeightMm);
  const horn = px(s.hornWidthMm);
  addRect(cov, w, h, left, top, left + horn, bed);
  addRect(cov, w, h, right - horn, top, right, bed);
  addRect(cov, w, h, left, bed, right, h);

  // Markerspur: Marke k steht bei xRead + (φ − k)·Teilung; Marke 0 ist eine Doppelmarke
  const pitch = px(s.circumferenceMm / s.spokes);
  const half = px(s.markWidthMm) / 2;
  const dbl = px(s.doubleMarkSpacingMm) / 2;
  for (let k = Math.floor(scene.phi - 3); k <= Math.ceil(scene.phi + 3); k++) {
    const x = s.xRead + (scene.phi - k) * pitch;
    if (x < -dbl - half || x > w + dbl + half) continue;
    const isZero = ((k % s.spokes) + s.spokes) % s.spokes === 0;
    for (const c of isZero ? [x - dbl, x + dbl] : [x]) {
      addRect(cov, w, h, c - half, s.markRows[0], c + half, s.markRows[1]);
    }
  }

  const range = BACKGROUND - DARK;
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.round(BACKGROUND - Math.min(cov[i], 1) * range);
  }
}
