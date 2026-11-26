import { minGapFrames, RealAnalyzer, type RealGeometry, type RealResult } from './realAnalyzer';
import type { Gray } from './image';
import type { RealSetup } from './realSetup';

export interface SessionStatus {
  /** Ausgewertete Bilder, Rechenzeit je Bild (ms, Mittel und 95-%-Perzentil der letzten 300 Bilder). */
  frames: number;
  avgMs: number;
  p95Ms: number;
  /** Nullpunkte, Lochdurchgänge (netto, mit Richtung) und letzte Drehrichtung (+1 vorwärts). */
  markers: number;
  holes: number;
  dir: number;
  warnings: string[];
}

const timesKept = 300;
const now = () => performance.now();

/** Eine Messsitzung: nimmt Bilder (Ausschnitt `setup.crop`) entgegen und liefert Status und Ergebnis. Läuft im Worker und in Node-Tests. */
export class AnalysisSession {
  private readonly an: RealAnalyzer;
  private readonly times: number[] = [];
  private geometry: RealGeometry | undefined;

  constructor(readonly setup: RealSetup) {
    this.an = new RealAnalyzer(setup);
  }

  get analyzer(): RealAnalyzer {
    return this.an;
  }

  push(img: Gray): { ok: boolean; geometry?: RealGeometry } {
    const t0 = now();
    const r = this.an.push(img);
    this.times.push(now() - t0);
    if (this.times.length > timesKept) this.times.shift();
    if (r.geometry) this.geometry = r.geometry;
    return { ok: r.measure.ok, geometry: r.geometry };
  }

  status(): SessionStatus {
    const n = this.an.numbering();
    const sorted = [...this.times].sort((a, b) => a - b);
    const warnings: string[] = [];
    const recent = this.an.measures.slice(-30);
    if (recent.length === 30 && recent.every((m) => !m.ok)) warnings.push('Felge nicht erkannt');
    const ev = this.an.numEvents.slice(-6);
    if (ev.length >= 4 && ev.slice(1).some((e, i) => e.frame - ev[i].frame < minGapFrames)) warnings.push('Drehung zu schnell');
    return {
      frames: this.an.measures.length,
      avgMs: sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0,
      p95Ms: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))] : 0,
      markers: n.markers.length,
      holes: this.an.numEvents.filter((e) => e.kind === 'hole').reduce((s, e) => s + e.dir, 0),
      dir: this.an.numEvents.length ? this.an.numEvents[this.an.numEvents.length - 1].dir : 0,
      warnings,
    };
  }

  lastGeometry(): RealGeometry | undefined {
    return this.geometry;
  }

  result(): RealResult {
    return this.an.result();
  }
}
