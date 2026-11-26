import { median } from './aggregate';

export interface DipEvent {
  kind: 'hole' | 'sticker';
  /** Bildnummer (Subframe-genau, Schwerpunkt des Ereignisses). */
  frame: number;
  /** Erstes und letztes Bild des Ereignisses. */
  start: number;
  end: number;
  /** Größte Abweichung von der Basis (Grauwerte, positiv). */
  depth: number;
  /** Summe Abweichung × Bettweg (Grauwert·px): Größe des Ereignisses, unabhängig von der Drehgeschwindigkeit. */
  area: number;
}

export interface HoleDetectorOptions {
  /** Loch: Helligkeit unter Basis − drop; endet über Basis − release. */
  drop: number;
  release: number;
  /** Aufkleber: Helligkeit über Basis + rise. */
  rise: number;
  baselineFrames: number;
}

/**
 * Erkennt Löcher (dunkel) und Aufkleber (hell) im Helligkeitsverlauf eines Fensters in der Bettmitte.
 * Die Basis ist der gleitende Median; ein Ereignis wird gemeldet, sobald es abgeklungen ist.
 */
export class HoleDetector {
  private history: number[] = [];
  private state: 'idle' | 'hole' | 'sticker' = 'idle';
  private sum = 0;
  private weighted = 0;
  private start = 0;
  private depth = 0;
  private area = 0;

  constructor(private readonly o: HoleDetectorOptions) {}

  reset(): void {
    this.history.length = 0;
    this.state = 'idle';
  }

  baseline(): number {
    return this.history.length ? median(this.history) : NaN;
  }

  push(frame: number, brightness: number, speed = 1): DipEvent | undefined {
    const base = this.baseline();
    this.history.push(brightness);
    if (this.history.length > this.o.baselineFrames) this.history.shift();
    if (this.history.length < 30) return undefined;

    const { drop, release, rise } = this.o;
    const dev = brightness - base;
    if (this.state === 'idle') {
      if (dev < -drop) this.begin('hole', frame);
      else if (dev > rise) this.begin('sticker', frame);
      else return undefined;
    } else {
      const done = this.state === 'hole' ? dev > -release : dev < rise / 2;
      if (done) {
        const kind = this.state;
        const at = this.weighted / this.sum;
        this.state = 'idle';
        return { kind, frame: at, start: this.start, end: frame - 1, depth: this.depth, area: this.area };
      }
    }
    const w = Math.abs(dev);
    this.depth = Math.max(this.depth, w);
    this.sum += w;
    this.area += w * speed;
    this.weighted += w * frame;
    return undefined;
  }

  private begin(s: 'hole' | 'sticker', frame: number): void {
    this.state = s;
    this.start = frame;
    this.depth = 0;
    this.area = 0;
    this.sum = 0;
    this.weighted = 0;
  }
}
