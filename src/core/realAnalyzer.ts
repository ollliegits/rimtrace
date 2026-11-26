import { centered, median, type SpokeProfile } from './aggregate';
import { HoleDetector, type DipEvent } from './holes';
import { levels, meanRows, type Gray } from './image';
import type { RealSetup } from './realSetup';
import { bottomEdge, flanks, lastDarkRow, topEdge } from './silhouette';

/** Messung eines Bildes in Pixeln (Maßstab folgt erst über das ganze Video). */
export interface RealMeasure {
  frame: number;
  ok: boolean;
  /** Außenbreite der Felge. */
  widthPx: number;
  /** Felgenmitte minus Referenzspeiche (nach rechts positiv). */
  lateralPx: number;
  /** Mittlere Hornspitze minus Oberkante Nippelkopf (nach unten positiv). */
  heightPx: number;
  /** Rechte minus linke Hornspitze (nur Diagnose). */
  tiltPx: number;
}

/** Messgeometrie des letzten Bildes in Videokoordinaten, für das Overlay. */
export interface RealGeometry {
  flankRows: [number, number];
  left: number;
  right: number;
  tipLeft: [number, number];
  tipRight: [number, number];
  ref: [number, number];
  refRows: [number, number];
  holeWindow: [number, number, number];
}

export interface RealProfile {
  /** mm je Pixel, aus der Felgenbreite über das ganze Video. */
  scale: number;
  /** Profil je Umdrehung (jeweils zentriert) und über alle Umdrehungen. */
  revolutions: SpokeProfile[];
  all: SpokeProfile;
  /** Gefundene Löcher je Umdrehung (Soll: Speichenzahl) und Bildnummern der Aufkleber. */
  holesPerRev: number[];
  stickers: number[];
}

interface Hole {
  frame: number;
  rev: number;
  k: number;
}

/** Auswertung echter Aufnahmen; erwartet je Bild den Ausschnitt `setup.crop` als Graustufen. */
export class RealAnalyzer {
  readonly measures: RealMeasure[] = [];
  readonly events: DipEvent[] = [];
  private readonly detector: HoleDetector;
  private frame = 0;
  private readonly ox: number;
  private readonly oy: number;

  constructor(readonly setup: RealSetup) {
    this.ox = setup.crop[0];
    this.oy = setup.crop[1];
    this.detector = new HoleDetector({
      drop: setup.holeDrop,
      release: setup.holeRelease,
      rise: setup.stickerRise,
      baselineFrames: setup.baselineFrames,
    });
  }

  reset(): void {
    this.measures.length = 0;
    this.events.length = 0;
    this.frame = 0;
    this.detector.reset();
  }

  push(img: Gray): { measure: RealMeasure; geometry?: RealGeometry } {
    const s = this.setup;
    const { ox, oy } = this;
    const frame = this.frame++;
    const fail = { measure: { frame, ok: false, widthPx: NaN, lateralPx: NaN, heightPx: NaN, tiltPx: NaN } };

    const { lo, hi } = levels(img);
    if (hi - lo < 60) return this.store(fail);
    const thr = (lo + hi) / 2;

    const x0 = s.rimX[0] - ox;
    const x1 = s.rimX[1] - ox;
    const yt = lastDarkRow(img, x0, x1, s.rimY[0] - oy, s.rimY[1] - oy, thr);
    if (yt < 0) return this.store(fail);

    const fy: [number, number] = [yt - s.flankRowsAbove[0], yt - s.flankRowsAbove[1] + 1];
    const fl = flanks(img, x0, x1, fy[0], fy[1], thr);
    if (!fl) return this.store(fail);

    const tipLeft = this.tip(img, Math.floor(fl.left) + s.tipColumns[0], Math.floor(fl.left) + s.tipColumns[1], yt, thr);
    const tipRight = this.tip(img, Math.ceil(fl.right) - s.tipColumns[1], Math.ceil(fl.right) - s.tipColumns[0], yt, thr);
    if (tipLeft === undefined || tipRight === undefined) return this.store(fail);

    const ref = this.reference(img, lo + s.refLevel * (hi - lo));
    if (!ref) return this.store(fail);

    const tipY = (tipLeft + tipRight) / 2;
    const center = (fl.left + fl.right) / 2;
    const [size, above] = s.holeWindow;
    const wx = Math.round(center - size / 2);
    const wy = Math.round(tipY - above - size / 2);
    if (wx < 0 || wy < 0 || wx + size > img.width || wy + size > img.height) return this.store(fail);
    let sum = 0;
    for (let y = wy; y < wy + size; y++) for (let x = wx; x < wx + size; x++) sum += img.data[y * img.width + x];
    const event = this.detector.push(frame, sum / (size * size));
    if (event) this.events.push(event);

    const measure: RealMeasure = {
      frame,
      ok: true,
      widthPx: fl.right - fl.left,
      lateralPx: center - ref.x,
      heightPx: tipY - ref.y,
      tiltPx: tipRight - tipLeft,
    };
    const xl = Math.floor(fl.left) + (s.tipColumns[0] + s.tipColumns[1]) / 2;
    const xr = Math.ceil(fl.right) - (s.tipColumns[0] + s.tipColumns[1]) / 2;
    return this.store({
      measure,
      geometry: {
        flankRows: [fy[0] + oy, fy[1] + oy],
        left: fl.left + ox,
        right: fl.right + ox,
        tipLeft: [xl + ox, tipLeft + oy],
        tipRight: [xr + ox, tipRight + oy],
        ref: [ref.x + ox, ref.y + oy],
        refRows: [ref.y + s.refRows[0] + oy, ref.y + s.refRows[1] + oy],
        holeWindow: [wx + ox, wy + oy, size],
      },
    });
  }

  private store<T extends { measure: RealMeasure }>(r: T): T {
    this.measures.push(r.measure);
    return r;
  }

  /** Hornspitze: Median der untersten Kante über die Spalten [c0, c1]. */
  private tip(img: Gray, c0: number, c1: number, yt: number, thr: number): number | undefined {
    const v: number[] = [];
    for (let x = c0; x <= c1; x++) {
      const e = bottomEdge(img, x, yt - 40, this.setup.rimY[1] - this.oy, thr);
      if (e !== undefined) v.push(e);
    }
    return v.length ? median(v) : undefined;
  }

  /** Referenz: Oberkante des Nippelkopfs (y) und Mitte der Speiche darunter (x). */
  private reference(img: Gray, thr: number): { x: number; y: number } | undefined {
    const s = this.setup;
    const [rx0, rx1] = [s.refX[0] - this.ox, s.refX[1] - this.ox];
    const [ry0, ry1] = [s.refY[0] - this.oy, s.refY[1] - this.oy];
    const profile = meanRows(img, ry0, ry1);
    let xc = rx0;
    for (let x = rx0; x < rx1; x++) if (profile[x] < profile[xc]) xc = x;
    const top = topEdge(img, xc, ry0, ry1, thr);
    if (top === undefined) return undefined;
    const body = flanks(img, rx0, rx1, Math.round(top) + s.refRows[0], Math.round(top) + s.refRows[1], thr);
    return body ? { x: (body.left + body.right) / 2, y: top } : undefined;
  }

  /** mm je Pixel aus dem Median der gemessenen Felgenbreite. */
  scale(): number {
    const w = this.measures.filter((m) => m.ok).map((m) => m.widthPx);
    return w.length ? this.setup.rimWidthMm / median(w) : NaN;
  }

  /**
   * Löcher mit Umdrehung und Nummer; Nummer 0 ist das erste Loch nach dem Aufkleber.
   * Löcher vor dem ersten Aufkleber (Umdrehung 0) werden rückwärts vom Aufkleber aus nummeriert.
   * Der Aufkleber erscheint als zwei helle Flecken mit einem Loch dazwischen; ein Fleck mit weniger als zwei Löchern
   * Abstand zum vorigen gehört zum selben Aufkleber.
   */
  sequence(): { holes: Hole[]; stickers: number[] } {
    const { spokes } = this.setup;
    const pre: number[] = [];
    const holes: Hole[] = [];
    const stickers: number[] = [];
    let k = 0;
    for (const e of this.events) {
      if (e.kind === 'sticker') {
        if (stickers.length && k < 2) continue;
        stickers.push(e.frame);
        k = 0;
      } else if (!stickers.length) pre.push(e.frame);
      else if (k < spokes) holes.push({ frame: e.frame, rev: stickers.length, k: k++ });
    }
    if (!stickers.length) return { holes: [], stickers };
    const head = pre.slice(-spokes).map((frame, i, a) => ({ frame, rev: 0, k: spokes - a.length + i }));
    return { holes: [...head, ...holes], stickers };
  }

  profile(): RealProfile {
    const { spokes, binHalfWidth } = this.setup;
    const scale = this.scale();
    const { holes, stickers } = this.sequence();
    const revs = holes.length ? holes[holes.length - 1].rev + 1 : 0;
    const bins = (n: number) => Array.from({ length: n }, () => Array.from({ length: spokes }, () => [] as number[]));
    const lat = bins(revs);
    const hei = bins(revs);

    let i = 0;
    for (const m of this.measures) {
      if (!m.ok || holes.length < 2) continue;
      while (i + 2 < holes.length && holes[i + 1].frame <= m.frame) i++;
      const a = holes[i];
      const b = holes[i + 1];
      if (m.frame < a.frame || m.frame >= b.frame) continue;
      const d = (m.frame - a.frame) / (b.frame - a.frame);
      const h = d <= binHalfWidth ? a : d >= 1 - binHalfWidth ? b : undefined;
      if (!h) continue;
      lat[h.rev][h.k].push(m.lateralPx * scale);
      hei[h.rev][h.k].push(m.heightPx * scale);
    }

    const toProfile = (l: number[][], h: number[][]): SpokeProfile => ({
      lateral: centered(l.map((b) => (b.length ? median(b) : NaN))),
      height: centered(h.map((b) => (b.length ? median(b) : NaN))),
      count: l.map((b) => b.length),
    });
    const merge = (r: number[][][]) => Array.from({ length: spokes }, (_, k) => r.flatMap((rev) => rev[k]));
    return {
      scale,
      revolutions: lat.map((l, r) => toProfile(l, hei[r])),
      all: toProfile(merge(lat), merge(hei)),
      holesPerRev: Array.from({ length: revs }, (_, r) => holes.filter((h) => h.rev === r).length),
      stickers,
    };
  }
}
