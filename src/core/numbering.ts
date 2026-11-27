import { median } from './aggregate';

/** Ereignis aus der Lochfenster-Erkennung mit Bewegungsrichtung und Größe (px Bettweg). */
export interface NumEvent {
  kind: 'hole' | 'sticker';
  frame: number;
  /** +1 vorwärts, −1 rückwärts, 0 = kein Durchgang (Bett kehrte im Fenster um). */
  dir: number;
  size: number;
  /** Zurückgelegter Bettweg bis zum Ereignis (px, Summe der Beträge). */
  pos?: number;
}

export interface NumberedHole {
  frame: number;
  /** Umdrehung: 0 = vor dem ersten Nullpunkt, danach je Nullpunkt eine. */
  rev: number;
  /** Speichenindex 0…N−1 ab dem Nullpunkt. */
  k: number;
  /** Lage im Lochraster (Nettozählung, unabhängig von der Drehrichtung). */
  ord: number;
  dir: number;
}

export interface Numbering {
  holes: NumberedHole[];
  /** Bildnummern der Nullpunkte (Ventil bzw. Aufkleber), je einer pro Umdrehung. */
  markers: number[];
  /** Ventilloch-Größe relativ zum Median der Löcher je Marker (nur Ventil). */
  valveRatios: number[];
  /** Ereignisse ohne Durchgang. */
  ignored: number;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/**
 * Löcher zählen und dem Nullpunkt zuordnen. Ein Nippelloch zählt vorwärts +1 und rückwärts −1, so dass Stopps und
 * Zurückdrehen die Nummerierung nicht verschieben. Der Nullpunkt (Ventilloch = deutlich größeres Loch, oder heller
 * Aufkleber) zählt nicht; zwei Aufkleber-Flecken mit weniger als 2 Löchern Abstand sind derselbe Aufkleber.
 * Speiche 1 (k = 0) ist das erste Loch nach dem Nullpunkt in Fahrtrichtung.
 */
export function numberHoles(
  events: NumEvent[],
  { marker, spokes, valveRatio, holeMinGap = 0 }: { marker: 'ventil' | 'aufkleber'; spokes: number; valveRatio: number; holeMinGap?: number },
): Numbering {
  const moving = events.filter((e) => e.dir !== 0);
  const sizes = moving.filter((e) => e.kind === 'hole').map((e) => e.size);
  const typical = sizes.length ? median(sizes) : 0;
  const isMarker = (e: NumEvent) => (marker === 'aufkleber' ? e.kind === 'sticker' : e.kind === 'hole' && typical > 0 && e.size > valveRatio * typical);

  // Störereignis: Loch in gleicher Richtung viel näher am vorigen als der übliche Lochabstand im Bettweg. Ein Fehlzähler
  // würde alle folgenden Speichen um eins verschieben.
  const gaps: number[] = [];
  let prevHole: NumEvent | undefined;
  for (const e of moving) {
    if (e.kind !== 'hole' || isMarker(e) || e.pos === undefined) continue;
    if (prevHole && prevHole.dir === e.dir) gaps.push(e.pos - (prevHole.pos as number));
    prevHole = e;
  }
  const minGap = holeMinGap * (gaps.length ? median(gaps) : 0);
  let last: NumEvent | undefined;
  const passes = moving.filter((e) => {
    if (e.kind !== 'hole' || isMarker(e) || e.pos === undefined) return true;
    if (last && last.dir === e.dir && e.pos - (last.pos as number) < minGap) return false;
    last = e;
    return true;
  });

  let p = 0;
  const found: { frame: number; ord: number; dir: number }[] = [];
  const marks: { frame: number; p: number }[] = [];
  const valveRatios: number[] = [];
  for (const e of passes) {
    if (isMarker(e)) {
      const last = marks[marks.length - 1];
      if (!last || Math.abs(p - last.p) >= 2) {
        marks.push({ frame: e.frame, p });
        if (marker === 'ventil') valveRatios.push(e.size / typical);
      }
    } else if (e.kind === 'hole') {
      if (e.dir < 0) p--;
      found.push({ frame: e.frame, ord: p, dir: e.dir });
      if (e.dir > 0) p++;
    }
  }

  const starts = marks.map((m) => m.p).sort((a, b) => a - b);
  const holes: NumberedHole[] = [];
  if (starts.length) {
    for (const h of found) {
      const r = starts.filter((s) => s <= h.ord).length;
      if (r === 0) {
        if (h.ord < starts[0] - spokes) continue;
        holes.push({ ...h, rev: 0, k: mod(h.ord - starts[0], spokes) });
      } else if (h.ord - starts[r - 1] < spokes) holes.push({ ...h, rev: r, k: h.ord - starts[r - 1] });
    }
  }
  return { holes, markers: marks.map((m) => m.frame), valveRatios, ignored: events.length - moving.length };
}
