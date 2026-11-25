export interface SpokeProfile {
  /** Seitenschlag je Speiche in mm, Mittelwert über alle Speichen abgezogen (nach rechts positiv). */
  lateral: number[];
  /** Höhenschlag je Speiche in mm, Mittelwert abgezogen (nach oben positiv). */
  height: number[];
  count: number[];
}

export function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Zieht den Mittelwert ab; NaN-Einträge (keine Daten) bleiben NaN. */
export function centered(values: number[]): number[] {
  const ok = values.filter(Number.isFinite);
  const m = ok.reduce((s, v) => s + v, 0) / (ok.length || 1);
  return values.map((v) => v - m);
}

/**
 * Sammelt Messwerte je Speichenposition über mehrere Umdrehungen und fasst sie per Median zusammen.
 * Nur Bilder nahe an einer Speiche (± halfWidth) zählen, damit der Verlauf zwischen den Speichen nicht einfließt.
 */
export class SpokeAccumulator {
  private lateral: number[][];
  private height: number[][];

  constructor(
    private readonly spokes: number,
    private readonly halfWidth = 0.15,
    private readonly maxPerBin = 25,
  ) {
    this.lateral = Array.from({ length: spokes }, () => []);
    this.height = Array.from({ length: spokes }, () => []);
  }

  /** Gibt die Speichennummer zurück, wenn das Bild einer Speiche zugeordnet wurde. */
  add(phi: number, lateralMm: number, heightMm: number): number | undefined {
    const k = Math.round(phi);
    if (Math.abs(phi - k) > this.halfWidth) return undefined;
    const i = ((k % this.spokes) + this.spokes) % this.spokes;
    for (const [bin, v] of [[this.lateral[i], lateralMm], [this.height[i], heightMm]] as const) {
      bin.push(v);
      if (bin.length > this.maxPerBin) bin.shift();
    }
    return i;
  }

  reset(): void {
    this.lateral.forEach((b) => (b.length = 0));
    this.height.forEach((b) => (b.length = 0));
  }

  /** Mittelwerte der Speichenmediane (für die Zentrierung); NaN ohne Daten. */
  means(): { lateral: number; height: number } {
    const m = (bins: number[][]) => {
      const v = bins.filter((b) => b.length).map(median);
      return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN;
    };
    return { lateral: m(this.lateral), height: m(this.height) };
  }

  profile(): SpokeProfile {
    const med = (bins: number[][]) => bins.map((b) => (b.length ? median(b) : NaN));
    return {
      lateral: centered(med(this.lateral)),
      height: centered(med(this.height)),
      count: this.lateral.map((b) => b.length),
    };
  }
}
