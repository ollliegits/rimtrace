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
 * Zwischen zwei Bildern wird die Differenz von f um ganze Marken korrigiert (< ½ Speiche pro Bild);
 * sichtbar wird die Doppelmarke zum Verankern des Nullpunkts genutzt.
 */
export class PhaseTracker {
  private u = 0;
  private lastF: number | undefined;
  private offset: number | undefined;

  constructor(private readonly spokes: number) {}

  reset(): void {
    this.lastF = undefined;
    this.offset = undefined;
    this.u = 0;
  }

  /** φ in [0, spokes) oder undefined, solange der Nullpunkt noch nicht gesehen wurde. */
  update(br: Bracket | null): number | undefined {
    if (!br) return undefined;
    if (this.lastF === undefined) this.u = br.f;
    else {
      const d = br.f - this.lastF;
      this.u += d - Math.round(d);
    }
    this.lastF = br.f;

    // b hat Index k, a hat k+1: φ = k + f. Doppelmarke als b → k = 0, als a → k = -1 (mod spokes).
    if (br.b.double || br.a.double) {
      const base = br.b.double ? 0 : -1;
      const abs = base + br.f;
      const n = this.offset === undefined ? 0 : Math.round((this.u + this.offset - abs) / this.spokes);
      this.offset = this.spokes * n + abs - this.u;
    }
    if (this.offset === undefined) return undefined;
    const phi = (this.u + this.offset) % this.spokes;
    return phi < 0 ? phi + this.spokes : phi;
  }
}
