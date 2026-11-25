import { rng } from './rng';

/**
 * Normalverteiltes Bildrauschen. Der Vorrat wird einmal aus dem Seed erzeugt; jedes Bild liest
 * ab einem zufälligen Startpunkt, sodass dasselbe Pixel in verschiedenen Bildern unabhängige Werte bekommt.
 */
export class Noise {
  private static readonly SIZE = 1 << 21;
  private readonly pool = new Float32Array(Noise.SIZE);
  private readonly rand: () => number;

  constructor(seed: number, private readonly sigma: number) {
    this.rand = rng(seed);
    if (sigma <= 0) return;
    for (let i = 0; i < Noise.SIZE; i += 2) {
      const r = Math.sqrt(-2 * Math.log(1 - this.rand()));
      const a = 2 * Math.PI * this.rand();
      this.pool[i] = r * Math.cos(a) * sigma;
      this.pool[i + 1] = r * Math.sin(a) * sigma;
    }
  }

  /** Quantisiert `src` nach `out` (0–255), mit Rauschen falls sigma > 0. */
  apply(src: Float32Array, out: Uint8Array): void {
    if (this.sigma <= 0) {
      for (let i = 0; i < src.length; i++) out[i] = Math.round(src[i]);
      return;
    }
    let k = Math.floor(this.rand() * Noise.SIZE);
    for (let i = 0; i < src.length; i++) {
      const v = Math.round(src[i] + this.pool[k]);
      out[i] = v < 0 ? 0 : v > 255 ? 255 : v;
      if (++k === Noise.SIZE) k = 0;
    }
  }
}
