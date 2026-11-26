import { centered, median, type SpokeProfile } from './aggregate';
import { bedProfile, bedShift } from './bedShift';
import { HoleDetector, type DipEvent } from './holes';
import { levels, meanRows, type Gray } from './image';
import { numberHoles, type NumEvent, type Numbering } from './numbering';
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
  /** Verschiedene Löcher je Umdrehung (Soll: Speichenzahl) und Bildnummern der Nullpunkte (Ventil bzw. Aufkleber). */
  holesPerRev: number[];
  markers: number[];
}

/** Prüfergebnis der Messung: `messages` leer heißt, die Messung ist plausibel. */
export interface RealCheck {
  ok: boolean;
  messages: string[];
  fullRevolutions: number;
  /** Mittlere/größte Abweichung zwischen aufeinanderfolgenden vollen Umdrehungen (mm, beide Achsen). */
  agreeMeanMm: number;
  agreeMaxMm: number;
  /** Kleinster Bildabstand zwischen zwei Löchern. */
  minHoleGap: number;
  tooFast: boolean;
  discardedFrames: number;
}

export interface RealResult {
  profile: RealProfile;
  check: RealCheck;
  frames: number;
  /** Anzahl und Größenverhältnis erkannter Ventillöcher (leer bei Aufkleber). */
  valveRatios: number[];
}

/** Zwischen zwei Löchern brauchen die Bilder mindestens so viele Bilder, sonst ist die Drehung zu schnell. */
export const minGapFrames = 3;

/** Auswertung echter Aufnahmen; erwartet je Bild den Ausschnitt `setup.crop` als Graustufen. */
export class RealAnalyzer {
  readonly measures: RealMeasure[] = [];
  readonly events: DipEvent[] = [];
  readonly numEvents: NumEvent[] = [];
  /** Bettverschiebung je Bild in Fahrtrichtung (px), NaN wenn nicht bestimmbar. */
  readonly shifts: number[] = [];
  private bed: Float32Array | undefined;
  private lastDir = 1;
  private lastSpeed = 1;
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
    this.numEvents.length = 0;
    this.shifts.length = 0;
    this.bed = undefined;
    this.lastDir = 1;
    this.frame = 0;
    this.detector.reset();
  }

  push(img: Gray): { measure: RealMeasure; geometry?: RealGeometry } {
    const s = this.setup;
    const { ox, oy } = this;
    const frame = this.frame++;
    const fail = { measure: { frame, ok: false, widthPx: NaN, lateralPx: NaN, heightPx: NaN, tiltPx: NaN } };
    this.trackBed(img);

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
    const event = this.detector.push(frame, sum / (size * size), this.speed(frame));
    if (event) this.addEvent(event);

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

  private trackBed(img: Gray): void {
    const s = this.setup;
    const cur = bedProfile(img, s.bedX[0] - this.ox, s.bedX[1] - this.ox, s.bedY[0] - this.oy, s.bedY[1] - this.oy);
    const d = this.bed ? bedShift(this.bed, cur, s.bedMaxShift) : NaN;
    this.bed = cur;
    this.shifts.push(s.travel === 'down' ? d : -d);
  }

  /** Bettweg des Bildes in px; bei unbestimmbarer Verschiebung der letzte bekannte Wert. */
  private speed(frame: number): number {
    const d = this.shifts[frame];
    if (Number.isFinite(d)) this.lastSpeed = Math.abs(d);
    return this.lastSpeed;
  }

  /** Richtung und Größe aus dem Bettweg während des Ereignisses. */
  private addEvent(e: DipEvent): void {
    this.events.push(e);
    let net = 0;
    let path = 0;
    for (let f = e.start; f <= e.end; f++) {
      const d = this.shifts[f];
      if (Number.isFinite(d)) {
        net += d;
        path += Math.abs(d);
      }
    }
    // Kehrt das Bett im Fenster um, ist der Nettoweg klein gegen den zurückgelegten Weg: kein Durchgang.
    const dir = path === 0 ? this.lastDir : Math.abs(net) < 0.5 * path ? 0 : Math.sign(net);
    if (dir !== 0) this.lastDir = dir;
    this.numEvents.push({ kind: e.kind, frame: e.frame, dir, size: e.area });
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

  numbering(): Numbering {
    const { marker, spokes, valveRatio } = this.setup;
    return numberHoles(this.numEvents, { marker, spokes, valveRatio });
  }

  profile(numbering = this.numbering()): RealProfile {
    const { spokes, binHalfWidth } = this.setup;
    const scale = this.scale();
    const { holes, markers } = numbering;
    const revs = holes.length ? Math.max(...holes.map((h) => h.rev)) + 1 : 0;
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
      // Nur Abschnitte zwischen benachbarten Löchern in einer Richtung sind zuordenbar.
      if (a.dir !== b.dir || b.ord - a.ord !== a.dir) continue;
      const d = (m.frame - a.frame) / (b.frame - a.frame);
      const h = d <= binHalfWidth ? a : d >= 1 - binHalfWidth ? b : undefined;
      if (!h) continue;
      lat[h.rev][h.k].push(m.lateralPx * scale);
      hei[h.rev][h.k].push(m.heightPx * scale);
    }

    const holesPerRev = Array.from({ length: revs }, (_, r) => new Set(holes.filter((h) => h.rev === r).map((h) => h.ord)).size);
    // Unvollständige Umdrehungen (Anlauf vor dem Nullpunkt, angefangene letzte) werden nicht ausgewertet.
    holesPerRev.forEach((n, r) => {
      if (n !== spokes) for (let k = 0; k < spokes; k++) lat[r][k] = hei[r][k] = [];
    });

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
      holesPerRev,
      markers,
    };
  }

  /** Ergebnis mit Plausibilitätsprüfung (M7). */
  result(): RealResult {
    const { spokes, agreeMeanMm, agreeMaxMm } = this.setup;
    const numbering = this.numbering();
    const profile = this.profile(numbering);
    const messages: string[] = [];
    const per = profile.holesPerRev;
    // Die letzte Umdrehung ist meist unvollständig, die erste (vor dem Nullpunkt) ebenso.
    const full = per.map((n, r) => ({ n, r })).filter((x) => x.n === spokes).map((x) => x.r);
    if (!numbering.markers.length) messages.push(`kein Nullpunkt (${this.setup.marker}) erkannt`);
    if (full.length < 2) messages.push(`nur ${full.length} volle Umdrehung(en), mindestens 2 nötig`);
    for (let r = 1; r < per.length - 1; r++) {
      if (per[r] !== spokes) messages.push(`Umdrehung ${r} hat ${per[r]} statt ${spokes} Löcher`);
    }

    const diffs: number[] = [];
    for (let i = 1; i < full.length; i++) {
      const a = profile.revolutions[full[i - 1]];
      const b = profile.revolutions[full[i]];
      for (const axis of ['lateral', 'height'] as const) {
        a[axis].forEach((v, k) => Number.isFinite(v) && Number.isFinite(b[axis][k]) && diffs.push(Math.abs(v - b[axis][k])));
      }
    }
    const agreeMean = diffs.length ? diffs.reduce((x, y) => x + y, 0) / diffs.length : NaN;
    const agreeMax = diffs.length ? Math.max(...diffs) : NaN;
    if (agreeMean > agreeMeanMm || agreeMax > agreeMaxMm) {
      messages.push(`Umdrehungen weichen voneinander ab (mittlere ${agreeMean.toFixed(2)} mm, größte ${agreeMax.toFixed(2)} mm)`);
    }

    const frames = numbering.holes.map((h) => h.frame).sort((a, b) => a - b);
    let minGap = Infinity;
    for (let i = 1; i < frames.length; i++) minGap = Math.min(minGap, frames[i] - frames[i - 1]);
    const tooFast = minGap < minGapFrames;
    if (tooFast) messages.push(`Drehung zu schnell (nur ${minGap.toFixed(1)} Bilder zwischen zwei Löchern, mindestens ${minGapFrames})`);

    const discarded = this.measures.filter((m) => !m.ok).length;
    if (discarded > 0.05 * this.measures.length) messages.push(`${discarded} von ${this.measures.length} Bildern nicht auswertbar`);
    if (numbering.ignored) messages.push(`${numbering.ignored} Ereignis(se) ohne Durchgang (Umkehr im Lochfenster)`);
    return {
      profile,
      check: { ok: !messages.length, messages, fullRevolutions: full.length, agreeMeanMm: agreeMean, agreeMaxMm: agreeMax, minHoleGap: minGap, tooFast, discardedFrames: discarded },
      frames: this.measures.length,
      valveRatios: numbering.valveRatios,
    };
  }
}
