import type { Setup } from '../core/setup';

export interface Scene {
  /** Speichenposition φ in Speichen (unbegrenzt, 0 = Doppelmarke an der Messstelle). */
  phi: number;
  lateralMm: number;
  heightMm: number;
  /** Wahrer Maßstab der Aufnahme; die Auswertung kennt ihn nicht. */
  mmPerPx: number;
  /** Gauß-Unschärfe in px (0 = keine). */
  blurSigmaPx: number;
}

export const BACKGROUND = 230;
export const DARK = 20;

// Abramowitz-Stegun 7.1.26, Fehler < 1,5e-7
function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

// ∫Φ(z)dz
const cumPhi = (z: number) => z * 0.5 * (1 + erf(z * Math.SQRT1_2)) + Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);

/**
 * Pixelüberdeckung eines Intervalls [a, b] entlang einer Achse, falls nötig mit Gauß gefaltet
 * (exakte Pixelintegration). Gibt den Startindex und die Werte zurück.
 */
function coverage1d(n: number, a: number, b: number, sigma: number): { i0: number; v: Float64Array } {
  const reach = 5 * sigma;
  const i0 = Math.max(0, Math.floor(a - reach));
  const i1 = Math.min(n, Math.ceil(b + reach));
  const v = new Float64Array(Math.max(0, i1 - i0));
  if (sigma > 0) {
    const A = (t: number) => sigma * (cumPhi((t - a) / sigma) - cumPhi((t - b) / sigma));
    let prev = A(i0);
    for (let k = 0; k < v.length; k++) {
      const next = A(i0 + k + 1);
      v[k] = next - prev;
      prev = next;
    }
  } else {
    for (let k = 0; k < v.length; k++) v[k] = Math.max(0, Math.min(i0 + k + 1, b) - Math.max(i0 + k, a));
  }
  return { i0, v };
}

const FAR = 1e4;

/** Addiert die (ggf. unscharfe) Überdeckung eines achsparallelen Rechtecks; Rechtecke dürfen sich nicht überlappen. */
function addRect(cov: Float32Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number, sigma: number): void {
  const px = coverage1d(w, x0, x1, sigma);
  const py = coverage1d(h, y0, y1, sigma);
  for (let j = 0; j < py.v.length; j++) {
    const o = (py.i0 + j) * w + px.i0;
    const cy = py.v[j];
    for (let i = 0; i < px.v.length; i++) cov[o + i] += px.v[i] * cy;
  }
}

/** Zeichnet Felgensilhouette, Referenzhalter und Markerspur als Helligkeit (Float) auf hellem Hintergrund. */
export function renderScene(s: Setup, scene: Scene, cov: Float32Array, out: Float32Array): void {
  const { width: w, height: h } = s;
  const sg = scene.blurSigmaPx;
  const px = (mm: number) => mm / scene.mmPerPx;
  cov.fill(0);

  // Referenzhalter; Ränder weit außerhalb, damit am Bildrand nichts ausblutet
  addRect(cov, w, h, -FAR, s.refBarTop, FAR, s.refY, sg);
  addRect(cov, w, h, -FAR, s.refY, s.refX, FAR, sg);

  // Felge: Körper mit zwei Hörnern
  const cx = s.rimCenterX + px(scene.lateralMm);
  const left = cx - px(s.rimWidthMm) / 2;
  const right = cx + px(s.rimWidthMm) / 2;
  const top = s.hornTopY - px(scene.heightMm);
  const bed = top + px(s.hornHeightMm);
  const horn = px(s.hornWidthMm);
  addRect(cov, w, h, left, top, left + horn, bed, sg);
  addRect(cov, w, h, right - horn, top, right, bed, sg);
  addRect(cov, w, h, left, bed, right, FAR, sg);

  // Markerspur: Marke k steht bei xRead + (φ − k)·Teilung; Marke 0 ist eine Doppelmarke
  const pitch = px(s.circumferenceMm / s.spokes);
  const half = px(s.markWidthMm) / 2;
  const dbl = px(s.doubleMarkSpacingMm) / 2;
  for (let k = Math.floor(scene.phi - 3); k <= Math.ceil(scene.phi + 3); k++) {
    const x = s.xRead + (scene.phi - k) * pitch;
    if (x < -dbl - half || x > w + dbl + half) continue;
    const isZero = ((k % s.spokes) + s.spokes) % s.spokes === 0;
    for (const c of isZero ? [x - dbl, x + dbl] : [x]) {
      addRect(cov, w, h, c - half, s.markRows[0], c + half, s.markRows[1], sg);
    }
  }

  const range = BACKGROUND - DARK;
  for (let i = 0; i < out.length; i++) out[i] = BACKGROUND - Math.min(cov[i], 1) * range;
}
