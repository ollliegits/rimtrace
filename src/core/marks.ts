import { findEdges } from './edges';
import { meanRows, type Gray, type Levels } from './image';
import type { Setup } from './setup';

export interface Mark {
  x: number;
  double: boolean;
}

/** Findet die vollständig sichtbaren Marken (Doppelmarke = ein Eintrag mit double=true). */
export function detectMarks(img: Gray, s: Setup, lv: Levels, pitchPx: number): Mark[] {
  const edges = findEdges(meanRows(img, s.markScanRows[0], s.markScanRows[1]), lv);
  const centers: number[] = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    if (!edges[i].rising && edges[i + 1].rising) {
      centers.push((edges[i].x + edges[i + 1].x) / 2);
      i++;
    }
  }

  const marks: Mark[] = [];
  for (let i = 0; i < centers.length; i++) {
    const next = centers[i + 1];
    if (next !== undefined && next - centers[i] < pitchPx / 2) {
      marks.push({ x: (centers[i] + next) / 2, double: true });
      i++;
    } else {
      marks.push({ x: centers[i], double: false });
    }
  }
  return marks.filter((m) => m.x >= s.markMargin && m.x <= img.width - s.markMargin);
}

export interface Bracket {
  /** Marke links der Messstelle. */
  a: Mark;
  /** Marke rechts der Messstelle. */
  b: Mark;
  /** Lineare Position zwischen den Marken in Speichen: 0 = b an der Messstelle, 1 = a an der Messstelle. */
  f: number;
}

/**
 * Marken laufen bei positiver Drehung nach rechts. Zwischen den beiden Marken um die
 * Messstelle wird linear interpoliert; fehlt eine oder passt der Abstand nicht, ist das Bild ungültig.
 */
export function bracketMarks(marks: Mark[], xRead: number, pitchPx: number): Bracket | null {
  for (let i = 0; i + 1 < marks.length; i++) {
    const a = marks[i];
    const b = marks[i + 1];
    if (a.x <= xRead && xRead < b.x) {
      const gap = b.x - a.x;
      if (Math.abs(gap - pitchPx) > 0.3 * pitchPx) return null;
      return { a, b, f: (b.x - xRead) / gap };
    }
  }
  return null;
}

/**
 * Verfolgt die Speichenposition φ (in Speichen, 0 = Doppelmarke am Ventil).
 * Zwischen zwei Bildern wird die Differenz von f um ganze Marken korrigiert; das ist nur eindeutig,
 * solange sich das Rad um weniger als ½ Speiche pro Bild dreht. Ab `maxStep` gilt das Bild als zu schnell:
 * es wird verworfen und die Position gilt als verloren, bis die Doppelmarke sie neu verankert.
 */
export class PhaseTracker {
  private u = 0;
  private lastF: number | undefined;
  private offset: number | undefined;
  private hold = 0;

  /**
   * Oberhalb von ½ Speiche/Bild erscheint die Drehung als kleiner Rückwärtsschritt und ist nicht erkennbar; nur die Rampe
   * dorthin wird gemeldet. Nach einer Meldung wird deshalb `holdFrames` lang nicht neu verankert (sonst im Plateau falsch).
   */
  constructor(
    private readonly spokes: number,
    private readonly maxStep = 0.4,
    private readonly holdFrames = 30,
  ) {}

  reset(): void {
    this.lastF = undefined;
    this.offset = undefined;
    this.hold = 0;
    this.u = 0;
  }

  /** φ in [0, spokes) oder undefined, solange die Position unbekannt ist (kein Nullpunkt gesehen oder verloren). */
  update(br: Bracket | null): { phi?: number; tooFast: boolean } {
    if (!br) return { tooFast: false };
    let tooFast = false;
    if (this.lastF === undefined) this.u = br.f;
    else {
      const d = br.f - this.lastF;
      const step = d - Math.round(d);
      if (Math.abs(step) > this.maxStep) {
        tooFast = true;
        this.offset = undefined;
        this.hold = this.holdFrames;
      } else this.u += step;
    }
    this.lastF = br.f;
    if (tooFast) return { tooFast };
    if (this.hold > 0) {
      this.hold--;
      return { tooFast };
    }

    // b hat Index k, a hat k+1: φ = k + f. Doppelmarke als b → k = 0, als a → k = -1 (mod spokes).
    if (br.b.double || br.a.double) {
      const base = br.b.double ? 0 : -1;
      const abs = base + br.f;
      const n = this.offset === undefined ? 0 : Math.round((this.u + this.offset - abs) / this.spokes);
      this.offset = this.spokes * n + abs - this.u;
    }
    if (this.offset === undefined) return { tooFast };
    const phi = (this.u + this.offset) % this.spokes;
    return { phi: phi < 0 ? phi + this.spokes : phi, tooFast };
  }
}
