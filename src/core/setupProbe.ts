import { median } from './aggregate';
import { levels, meanRows, type Gray } from './image';
import type { RealGeometry } from './realAnalyzer';
import { realSetupError, type RealSetup } from './realSetup';
import { bottomEdge, lastDarkRow, spanEdges, topEdge } from './silhouette';

export type Light = 'ok' | 'warn' | 'error';
export type ProbeArea = 'crop' | 'rim' | 'tips' | 'ref' | 'hole' | 'bed';

export interface AreaProbe {
  area: ProbeArea;
  light: Light;
  text: string;
  /** Was zu tun ist; nur bei Warnung/Fehler. */
  hint?: string;
  metrics: { label: string; value: string }[];
}

export interface ProbeResult {
  areas: AreaProbe[];
  /** Erkannte Kanten, Spitzen und Referenz in Videokoordinaten (nur, was erkannt wurde). */
  overlay: Partial<RealGeometry>;
}

/** Schwellen der Einrichtungsprüfung (Graustufen, Pixel bzw. Anteile). */
export const PROBE = {
  contrastMin: 60,
  contrastWarn: 90,
  rowsUniqueMin: 0.8,
  wallOneMin: 0.3,
  rowsTouchMax: 0.2,
  edgeJumpPx: 5,
  wallRowsMin: 5,
  scaleMm: [0.05, 0.5],
  rimMarginMin: 0.1,
  tipMarginPx: 20,
  refRowsValidMin: 0.8,
  refCenterStdMax: 0.7,
  bedDarkError: 0.4,
  bedDarkWarn: 0.75,
  bedStructureMin: 4,
} as const;

const worst = (a: Light, b: Light): Light => (a === 'error' || b === 'error' ? 'error' : a === 'warn' || b === 'warn' ? 'warn' : 'ok');
const f = (v: number, d = 0) => (Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '–');

interface Issue {
  light: Light;
  text: string;
  hint: string;
}

class Collector {
  readonly issues: Issue[] = [];
  readonly metrics: { label: string; value: string }[] = [];
  constructor(readonly area: ProbeArea) {}

  add(light: Light, text: string, hint: string): void {
    this.issues.push({ light, text, hint });
  }

  metric(label: string, value: string): void {
    this.metrics.push({ label, value });
  }

  done(okText: string): AreaProbe {
    const light = this.issues.reduce<Light>((l, i) => worst(l, i.light), 'ok');
    const first = this.issues.find((i) => i.light === light);
    return { area: this.area, light, text: first?.text ?? okText, hint: first?.hint, metrics: this.metrics };
  }
}

const inside = (img: Gray, x0: number, x1: number, y0: number, y1: number) => x0 >= 0 && y0 >= 0 && x1 <= img.width && y1 <= img.height && x1 > x0 && y1 > y0;

/** Dunkle Abschnitte (Pixel unter `thr`) einer Zeile. */
function darkRuns(img: Gray, y: number, x0: number, x1: number, thr: number): number {
  let runs = 0;
  let prev = false;
  for (let x = x0; x < x1; x++) {
    const d = img.data[y * img.width + x] < thr;
    if (d && !prev) runs++;
    prev = d;
  }
  return runs;
}

const rowSlice = (img: Gray, y: number, x0: number, x1: number) => img.data.subarray(y * img.width + x0, y * img.width + x1);

/**
 * Bewertet für ein Bild im Messausschnitt (`setup.crop`, Graustufen) jeden Messbereich einzeln.
 * Prüft dieselben Bedingungen, an denen `RealAnalyzer` ein Bild verwirft, und meldet, warum.
 */
export function probeSetup(img: Gray, s: RealSetup): ProbeResult {
  const [ox, oy] = s.crop;
  const overlay: Partial<RealGeometry> = {};
  const out: AreaProbe[] = [];

  const crop = new Collector('crop');
  const cropErr = realSetupError({ ...s, rimWidthMm: 1 });
  if (cropErr?.includes('liegt nicht im Ausschnitt')) crop.add('error', 'Messbereich außerhalb des Ausschnitts', 'Rahmen liegen teilweise außerhalb des roten Ausschnitts: Ausschnitt vergrößern oder Rahmen verschieben.');
  if (img.width !== s.crop[2] || img.height !== s.crop[3]) crop.add('error', 'Bildgröße passt nicht zum Ausschnitt', 'Konfiguration neu senden und Standbild neu holen.');
  crop.metric('Ausschnitt', `${s.crop[2]}×${s.crop[3]} px`);
  out.push(crop.done('alle Messbereiche im Ausschnitt'));

  const rim = new Collector('rim');
  const tips = new Collector('tips');
  const ref = new Collector('ref');
  const hole = new Collector('hole');
  const bed = new Collector('bed');
  const skip = (c: Collector, why: string, hint: string) => c.add('error', why, hint);

  const x0 = s.rimX[0] - ox;
  const x1 = s.rimX[1] - ox;
  const ry0 = s.rimY[0] - oy;
  const ry1 = s.rimY[1] - oy;
  const geomOk = inside(img, x0, x1, ry0, ry1);

  const { lo, hi } = levels(img);
  const contrast = hi - lo;
  const thr = (lo + hi) / 2;
  rim.metric('Kontrast Hintergrund/Felge', `${contrast} Graustufen`);

  let fl: { left: number; right: number } | undefined;
  let yt = -1;
  let tipY: number | undefined;

  if (!geomOk) skip(rim, 'Rahmen liegt nicht im Bild', 'Rahmen Felge (gelb) komplett ins Bild und in den Ausschnitt legen.');
  else if (contrast < PROBE.contrastMin) rim.add('error', 'Kontrast zu schwach', `Nur ${contrast} Graustufen zwischen Hintergrund und Felge (mindestens ${PROBE.contrastMin}): Hintergrund heller beleuchten oder Belichtung prüfen.`);
  else {
    if (contrast < PROBE.contrastWarn) rim.add('warn', 'Kontrast knapp', `Nur ${contrast} Graustufen Unterschied: Hintergrund heller beleuchten.`);
    yt = lastDarkRow(img, x0, x1, ry0, ry1, thr);
    if (yt < 0) rim.add('error', 'keine Kontur gefunden', 'Im gelben Rahmen liegt keine dunkle Felge: Rahmen über die Felge legen.');
    else {
      const flankRows: number[] = [];
      for (let y = yt - s.flankRowsAbove[0]; y < yt - s.flankRowsAbove[1] + 1; y++) if (y >= 0 && y < img.height) flankRows.push(y);
      const spans = flankRows.map((y) => spanEdges(rowSlice(img, y, x0, x1), thr));
      const valid = spans.filter((e): e is { left: number; right: number } => e !== undefined);
      const touch = flankRows.filter((y) => rowSlice(img, y, x0, x1)[0] < thr || rowSlice(img, y, x0, x1)[x1 - x0 - 1] < thr).length;
      const mL = median(valid.map((e) => e.left));
      const mR = median(valid.map((e) => e.right));
      const stable = valid.filter((e) => Math.abs(e.left - mL) <= PROBE.edgeJumpPx && Math.abs(e.right - mR) <= PROBE.edgeJumpPx);
      // Oberhalb der Hörner ist die Felgenwand massiv dunkel: dort muss jede Zeile genau einen dunklen Bereich haben.
      let wall = 0;
      let wallOne = 0;
      for (let y = ry0; y < yt - s.flankRowsAbove[0] - 5; y++) {
        wall++;
        if (darkRuns(img, y, x0, x1, thr) === 1) wallOne++;
      }
      const touchShare = flankRows.length ? touch / flankRows.length : 0;
      const stableShare = flankRows.length ? stable.length / flankRows.length : 0;
      rim.metric('Zeilen mit stabiler Kantenlage', `${f(stableShare * 100)} %`);
      if (wall >= PROBE.wallRowsMin) rim.metric('Wandzeilen mit einem dunklen Bereich', `${f((wallOne / wall) * 100)} %`);
      if (stable.length) fl = { left: x0 + median(stable.map((e) => e.left)), right: x0 + median(stable.map((e) => e.right)) };
      if (touchShare > PROBE.rowsTouchMax) rim.add('error', 'Felge berührt den Rand', 'Die Felge reicht bis an den Rahmenrand: Rahmen Felge (gelb) seitlich breiter ziehen.');
      else if (!valid.length) rim.add('error', 'keine Kontur gefunden', 'Beidseits der Felge muss ein heller Rand im gelben Rahmen liegen.');
      else if (stableShare < PROBE.rowsUniqueMin || (wall >= PROBE.wallRowsMin && wallOne / wall < PROBE.wallOneMin)) {
        rim.add('error', 'uneindeutige Erkennung: mehrere dunkle Bereiche', 'Im Rahmen liegt neben der Felge noch etwas Dunkles (Speiche, Schatten, Hand): Rahmen verkleinern oder Hintergrund freiräumen.');
      }
    }
  }

  if (fl && !rim.issues.some((i) => i.light === 'error')) {
    const width = fl.right - fl.left;
    rim.metric('Breite', `${f(width, 1)} px`);
    rim.metric('Spielraum links / rechts', `${f(fl.left - x0)} / ${f(x1 - fl.right)} px`);
    const margin = Math.min(fl.left - x0, x1 - fl.right);
    if (margin < PROBE.rimMarginMin * width) rim.add('warn', 'wenig Spielraum zum Rand', 'Die Felge schlägt beim Drehen seitlich aus: Rahmen Felge (gelb) links und rechts breiter ziehen.');
    if (s.rimWidthMm > 0) {
      const scale = s.rimWidthMm / width;
      rim.metric('Maßstab', `${f(scale, 3)} mm/px`);
      if (scale < PROBE.scaleMm[0] || scale > PROBE.scaleMm[1]) rim.add('warn', 'Breite passt nicht zur Felgenbreite', `Aus ${f(s.rimWidthMm, 1)} mm ergeben sich ${f(scale, 2)} mm/px (üblich ${f(PROBE.scaleMm[0], 2)} bis ${f(PROBE.scaleMm[1], 2)}): Felgenbreite in den Einstellungen und die Rahmen prüfen.`);
    }
    overlay.flankRows = [yt - s.flankRowsAbove[0] + oy, yt - s.flankRowsAbove[1] + 1 + oy];
    overlay.left = fl.left + ox;
    overlay.right = fl.right + ox;
  }

  // Hornspitzen
  const rimFound = fl && !rim.issues.some((i) => i.light === 'error');
  if (!rimFound) skip(tips, 'nicht prüfbar: Felge nicht erkannt', 'Zuerst den Rahmen Felge (gelb) korrigieren.');
  else {
    const edge = (c0: number, c1: number): number | undefined => {
      const v: number[] = [];
      for (let x = c0; x <= c1; x++) {
        if (x < 0 || x >= img.width) return undefined;
        const e = bottomEdge(img, x, yt - 40, ry1, thr);
        if (e !== undefined) v.push(e);
      }
      return v.length ? median(v) : undefined;
    };
    const [t0, t1] = s.tipColumns;
    const tl = edge(Math.floor(fl!.left) + t0, Math.floor(fl!.left) + t1);
    const tr = edge(Math.ceil(fl!.right) - t1, Math.ceil(fl!.right) - t0);
    if (tl === undefined || tr === undefined) tips.add('error', 'Unterkante nicht gefunden', 'Hornspitzen liegen nicht im Bild: Rahmen Felge (gelb) bzw. Ausschnitt nach unten vergrößern.');
    else {
      tipY = (tl + tr) / 2;
      const room = ry1 - Math.max(tl, tr);
      tips.metric('Unterkante links / rechts', `${f(tl + oy, 1)} / ${f(tr + oy, 1)} px`);
      tips.metric('Abstand zum Rahmenrand unten', `${f(room)} px`);
      if (room < 2) tips.add('error', 'Felge reicht über den Rahmen', 'Rahmen Felge (gelb) unten tiefer ziehen, sodass unter den Hornspitzen noch heller Hintergrund liegt.');
      else if (room < PROBE.tipMarginPx) tips.add('warn', 'wenig Platz unter den Hornspitzen', 'Beim Höhenschlag wandert die Unterkante: Rahmen Felge (gelb) unten tiefer ziehen.');
      const xl = Math.floor(fl!.left) + (t0 + t1) / 2;
      const xr = Math.ceil(fl!.right) - (t0 + t1) / 2;
      overlay.tipLeft = [xl + ox, tl + oy];
      overlay.tipRight = [xr + ox, tr + oy];
    }
  }

  // Referenz
  const [rx0, rx1] = [s.refX[0] - ox, s.refX[1] - ox];
  const [rY0, rY1] = [s.refY[0] - oy, s.refY[1] - oy];
  if (!inside(img, rx0, rx1, rY0, rY1)) skip(ref, 'Rahmen liegt nicht im Bild', 'Rahmen Referenz (grün) komplett ins Bild und in den Ausschnitt legen.');
  else {
    const rthr = lo + s.refLevel * (hi - lo);
    const profile = meanRows(img, rY0, rY1);
    let xc = rx0;
    for (let x = rx0; x < rx1; x++) if (profile[x] < profile[xc]) xc = x;
    const top = topEdge(img, xc, rY0, rY1, rthr);
    if (top === undefined) ref.add('error', 'Referenz nicht gefunden', 'Im grünen Rahmen liegt keine dunkle Speiche mit Nippelkopf: Rahmen Referenz (grün) darüber legen.');
    else if (top <= rY0 + 2) ref.add('error', 'Oberkante nicht erkennbar', 'Das Dunkle beginnt schon am oberen Rand des grünen Rahmens (Felge?): Rahmen nach unten schieben, über dem Nippelkopf muss heller Hintergrund liegen.');
    else if (Math.round(top) + s.refRows[1] > img.height) ref.add('error', 'Speiche reicht nicht bis ins Bild', 'Unter dem Nippelkopf fehlt Bild für die Messzeilen: Ausschnitt unten vergrößern.');
    else {
      const y0 = Math.round(top) + s.refRows[0];
      const y1 = Math.round(top) + s.refRows[1];
      const centers: number[] = [];
      let n = 0;
      let dark = 0;
      for (let y = y0; y < y1; y++) {
        n++;
        const e = spanEdges(rowSlice(img, y, rx0, rx1), rthr);
        if (e) centers.push(rx0 + (e.left + e.right) / 2);
        dark += img.data[y * img.width + xc];
      }
      const refContrast = hi - dark / Math.max(1, n);
      const share = centers.length / Math.max(1, n);
      const cm = centers.length ? centers.reduce((a, b) => a + b, 0) / centers.length : NaN;
      const std = centers.length ? Math.sqrt(centers.reduce((a, b) => a + (b - cm) ** 2, 0) / centers.length) : NaN;
      ref.metric('Kontrast Speiche', `${f(refContrast)} Graustufen`);
      ref.metric('Zeilen mit eindeutiger Kante', `${f(share * 100)} %`);
      ref.metric('Streuung der Kantenlage', `${f(std, 2)} px`);
      if (refContrast < PROBE.contrastMin) ref.add('error', 'Kontrast zu schwach', `Die Referenz ist nur ${f(refContrast)} Graustufen dunkler als der Hintergrund: Speiche besser beleuchten oder Referenzschwelle senken.`);
      if (share < PROBE.refRowsValidMin) ref.add('error', 'senkrechte Kante nicht eindeutig', 'Die Speiche ist im grünen Rahmen nicht frei: Rahmen schmaler ziehen, links und rechts der Speiche muss heller Hintergrund liegen.');
      else if (std > PROBE.refCenterStdMax) ref.add('warn', 'Referenz nicht gerade bzw. unscharf', 'Die Kantenlage schwankt über die Zeilen: Referenz gerade ausrichten und scharf stellen.');
      const body = share >= PROBE.refRowsValidMin;
      if (body) {
        overlay.ref = [cm + ox, top + oy];
        overlay.refRows = [top + s.refRows[0] + oy, top + s.refRows[1] + oy];
      }
    }
  }

  // Lochfenster
  const [size, above] = s.holeWindow;
  if (!rimFound || tipY === undefined) skip(hole, 'nicht prüfbar: Felge nicht erkannt', 'Zuerst Felge und Hornspitzen einrichten.');
  else {
    const wx = Math.round((fl!.left + fl!.right) / 2 - size / 2);
    const wy = Math.round(tipY - above - size / 2);
    if (!inside(img, wx, wx + size, wy, wy + size)) hole.add('error', 'Lochfenster außerhalb des Bildes', 'Das Fenster liegt über den Hornspitzen: Ausschnitt oben vergrößern oder die Felge tiefer ins Bild bringen.');
    else {
      const mean = (px: number, py: number) => {
        let sum = 0;
        for (let y = py; y < py + size; y++) for (let x = px; x < px + size; x++) sum += img.data[y * img.width + x];
        return sum / (size * size);
      };
      const b = mean(wx, wy);
      overlay.holeWindow = [wx + ox, wy + oy, size];
      hole.metric('Helligkeit im Fenster', f(b));
      if (b > thr) hole.add('error', 'Fenster liegt nicht auf der Felge', 'Das Lochfenster erfasst hellen Hintergrund: Felge muss darüber im Bild sein (Ausschnitt oben vergrößern).');
    }
  }

  // Bettstreifen
  const [bx0, bx1] = [s.bedX[0] - ox, s.bedX[1] - ox];
  const [by0, by1] = [s.bedY[0] - oy, s.bedY[1] - oy];
  if (!inside(img, bx0, bx1, by0, by1)) skip(bed, 'Rahmen liegt nicht im Bild', 'Rahmen Bettstreifen (blau) komplett ins Bild und in den Ausschnitt legen.');
  else {
    let dark = 0;
    for (let y = by0; y < by1; y++) for (let x = bx0; x < bx1; x++) if (img.data[y * img.width + x] < thr) dark++;
    const share = dark / ((bx1 - bx0) * (by1 - by0));
    bed.metric('Anteil Felge im Streifen', `${f(share * 100)} %`);
    let structure = 0;
    let prev = NaN;
    for (let y = by0; y < by1; y++) {
      let sum = 0;
      for (let x = bx0; x < bx1; x++) sum += img.data[y * img.width + x];
      const m = sum / (bx1 - bx0);
      if (Number.isFinite(prev)) structure = Math.max(structure, Math.abs(m - prev));
      prev = m;
    }
    bed.metric('Struktur (größter Helligkeitssprung)', f(structure, 1));
    if (share < PROBE.bedDarkError) bed.add('error', 'Streifen liegt nicht auf der Felge', 'Der blaue Streifen muss ganz auf dem Felgenbett liegen: schmaler und mittig über die Löcher ziehen.');
    else if (share < PROBE.bedDarkWarn) bed.add('warn', 'Streifen ragt über die Felge hinaus', 'Der blaue Streifen muss ganz auf dem Felgenbett liegen: schmaler ziehen, damit er auch bei Seitenschlag auf der Felge bleibt.');
    else if (structure < PROBE.bedStructureMin) bed.add('warn', 'Streifen ohne Struktur', 'Im Streifen ist gerade kein Loch zu sehen: Rad etwas drehen und die Prüfung erneut ausführen.');
  }

  out.push(rim.done('Kanten eindeutig erkannt'), tips.done('Unterkante beider Hörner erkannt'), ref.done('Referenz erkannt'), hole.done('Fenster liegt auf der Felge'), bed.done('Streifen liegt auf dem Felgenbett'));
  return { areas: out, overlay };
}

/** Zuordnung der Prüfbereiche zu den Rahmen am Standbild. */
export const probeAreasOf: Record<'crop' | 'rim' | 'ref' | 'bed', ProbeArea[]> = { crop: ['crop'], rim: ['rim', 'tips'], ref: ['ref'], bed: ['hole', 'bed'] };

export const worstLight = (areas: AreaProbe[]): Light => areas.reduce<Light>((l, a) => worst(l, a.light), 'ok');
