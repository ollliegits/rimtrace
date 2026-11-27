import { median, type SpokeProfile } from './aggregate';
import { spokeSide, type Setup } from './setup';
import { formatTurns } from './recommend';

/**
 * Einflussmodell: Eine Nippeldrehung bewegt die Felge nicht nur an der Speiche, sondern über mehrere Nachbarspeichen (Glocke).
 * Seitlich zieht das Anziehen zur Flanschseite der Speiche, in der Höhe stets zur Nabe.
 * Startwerte sind Annahmen (Größenordnung aus US 5 103 414), sie müssen am echten Rad kalibriert werden.
 */
export interface TruingModel {
  /** Felgenbewegung an der gedrehten Speiche je volle Umdrehung (mm). */
  lateralMmPerTurn: number;
  heightMmPerTurn: number;
  /** Breite der Glocke in Speichenabständen (Standardabweichung). */
  sigma: number;
}

export const defaultTruingModel: TruingModel = { lateralMmPerTurn: 1, heightMmPerTurn: 0.5, sigma: 2 };

export interface TruingOptions {
  toleranceLateralMm?: number;
  toleranceHeightMm?: number;
  model?: Partial<TruingModel>;
  /** Anteil der berechneten Drehung, der pro Durchgang ausgeführt wird (Modellfehler, danach nachmessen). */
  step?: number;
  /** Größte Drehung je Speiche und Durchgang (Umdrehungen). */
  maxTurns?: number;
  /** Kleinere Drehungen werden weggelassen. */
  minTurns?: number;
}

export interface TruingAction {
  spoke: number;
  side: 'left' | 'right';
  verb: 'tighten' | 'loosen';
  /** Nippeldrehung in Umdrehungen, auf 1/8 gerundet. */
  turns: number;
}

export interface TruingPlan {
  /** Nach Drehung absteigend. */
  actions: TruingAction[];
  /** Voraussichtliche Restabweichung (größter Betrag, mm) nach dem Durchgang. */
  residual: { lateralMm: number; heightMm: number };
  /** Breite der Auslenkung: Speichen mit mindestens der halben Spitzenabweichung. */
  widthSpokes: { lateral: number; height: number };
}

/** Bezug ist der Median: Ein Ausschlag soll nicht den Rest der Felge „absenken“. */
const aroundMedian = (v: number[]) => {
  const m = median(v.filter(Number.isFinite));
  return v.map((x) => x - m);
};

const maxAbs = (a: number[]) => a.reduce((m, v) => (Number.isFinite(v) ? Math.max(m, Math.abs(v)) : m), 0);

/** Gauß-Elimination mit Spaltenpivot für das kleine, symmetrisch positiv definite System. */
function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < n; r++) {
      const f = a[r][c] / a[c][c];
      for (let k = c; k < n; k++) a[r][k] -= f * a[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= a[r][k] * x[k];
    x[r] = s / a[r][r];
  }
  return x;
}

/** Anzahl der Speichen (zusammenhängend um die Spitze) mit mindestens halber Spitzenabweichung. */
function widthAtHalfMax(v: number[]): number {
  const peak = maxAbs(v);
  if (!peak) return 0;
  const n = v.length;
  const at = v.findIndex((x) => Math.abs(x) === peak);
  const big = (i: number) => Math.abs(v[((i % n) + n) % n]) >= peak / 2;
  let w = 1;
  for (let d = 1; d < n && big(at + d); d++) w++;
  for (let d = 1; d < n - w + 1 && big(at - d); d++) w++;
  return w;
}

/**
 * Drehungen aller Speichen aus kleinsten Fehlerquadraten über beide Achsen (Seite und Höhe, je auf die Toleranz bezogen).
 * Große Drehungen werden bestraft. Breite Auslenkungen ergeben dadurch viele kleine Drehungen im Verbund, schmale wenige größere.
 */
export function truingPlan(p: SpokeProfile, s: Pick<Setup, 'evenSpokeSide'>, opts: TruingOptions = {}): TruingPlan {
  const { toleranceLateralMm = 0.2, toleranceHeightMm = 0.3, step = 0.6, maxTurns = 0.5, minTurns = 0.1 } = opts;
  const { lateralMmPerTurn, heightMmPerTurn, sigma } = { ...defaultTruingModel, ...opts.model };
  const n = p.lateral.length;
  const lat = aroundMedian(p.lateral);
  const hei = aroundMedian(p.height);
  const plan: TruingPlan = {
    actions: [],
    residual: { lateralMm: maxAbs(lat), heightMm: maxAbs(hei) },
    widthSpokes: { lateral: widthAtHalfMax(lat), height: widthAtHalfMax(hei) },
  };
  if (plan.residual.lateralMm < toleranceLateralMm && plan.residual.heightMm < toleranceHeightMm) return plan;

  const dist = (i: number, j: number) => Math.min(Math.abs(i - j), n - Math.abs(i - j));
  const bell = (i: number, j: number) => Math.exp(-(dist(i, j) ** 2) / (2 * sigma * sigma));
  const side = Array.from({ length: n }, (_, i) => spokeSide(s, i));
  // Wirkung von +1 Umdrehung (anziehen) an Speiche i auf Position j: seitlich zur Flanschseite, Höhenwert sinkt.
  const effectLat = (i: number, j: number) => (side[i] === 'left' ? -1 : 1) * lateralMmPerTurn * bell(i, j);
  const effectHei = (i: number, j: number) => -heightMmPerTurn * bell(i, j);

  const rows: { w: number; b: number; a: (i: number) => number }[] = [];
  for (let j = 0; j < n; j++) {
    if (Number.isFinite(lat[j])) rows.push({ w: 1 / toleranceLateralMm, b: lat[j], a: (i) => effectLat(i, j) });
    if (Number.isFinite(hei[j])) rows.push({ w: 1 / toleranceHeightMm, b: hei[j], a: (i) => effectHei(i, j) });
  }
  const ata = Array.from({ length: n }, () => Array<number>(n).fill(0));
  const atb = Array<number>(n).fill(0);
  for (const { w, b, a } of rows) {
    const col = Array.from({ length: n }, (_, i) => a(i));
    for (let i = 0; i < n; i++) {
      atb[i] -= w * w * col[i] * b;
      for (let k = 0; k < n; k++) ata[i][k] += w * w * col[i] * col[k];
    }
  }
  const scale = ata.reduce((m, row, i) => m + row[i], 0) / n;
  for (let i = 0; i < n; i++) ata[i][i] += 0.05 * scale;
  // Kleine Anteile (Ausläufer der Glocke) sind keine sinnvolle Handlung.
  const t = solve(ata, atb).map((v) => (Math.abs(v * step) < minTurns ? 0 : Math.round(Math.max(-maxTurns, Math.min(maxTurns, v * step)) * 8) / 8));

  plan.actions = t
    .map((v, spoke) => ({ spoke, side: side[spoke], verb: (v > 0 ? 'tighten' : 'loosen') as TruingAction['verb'], turns: Math.abs(v) }))
    .filter((a) => a.turns > 0)
    .sort((a, b) => b.turns - a.turns || a.spoke - b.spoke);

  const after = (v: number[], effect: (i: number, j: number) => number) => v.map((x, j) => x + t.reduce((sum, ti, i) => sum + ti * effect(i, j), 0));
  plan.residual = { lateralMm: maxAbs(after(lat, effectLat)), heightMm: maxAbs(after(hei, effectHei)) };
  return plan;
}

export function describeTruing(a: TruingAction, opts: { firstSpoke?: number; sideName?: (side: 'left' | 'right') => string } = {}): string {
  const { firstSpoke = 0, sideName = (x) => (x === 'left' ? 'links' : 'rechts') } = opts;
  return `Speiche ${a.spoke + firstSpoke} (${sideName(a.side)}) ${formatTurns(a.turns)} Umdr. ${a.verb === 'tighten' ? 'anziehen' : 'lösen'}`;
}
