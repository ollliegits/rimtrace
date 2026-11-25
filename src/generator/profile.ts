import { rng } from './rng';

export interface Outlier {
  spoke: number;
  mm: number;
  /** Breite der Beule in Speichen (Gauß-σ). */
  sigma: number;
}

export interface FlatSpot {
  center: number;
  /** Halbe Breite in Speichen; innen wird das Profil auf den Wert in der Mitte eingeebnet. */
  halfWidth: number;
}

export interface AxisConfig {
  /** Ordnungen der Sinusanteile (Perioden pro Umdrehung) und ihre Amplitude in mm: zufällig in [min, max]. */
  orders: number[];
  amplitudeMm: [number, number];
  outliers: Outlier[];
  flat?: FlatSpot;
}

export interface ProfileConfig {
  seed: number;
  lateral: AxisConfig;
  height: AxisConfig;
}

export const defaultProfileConfig: ProfileConfig = {
  seed: 1,
  lateral: {
    orders: [1, 2, 3],
    amplitudeMm: [0.4, 1.0],
    outliers: [
      { spoke: 7, mm: 0.8, sigma: 0.8 },
      { spoke: 19, mm: -0.7, sigma: 0.8 },
    ],
  },
  height: {
    orders: [1, 2, 3],
    amplitudeMm: [0.4, 1.0],
    outliers: [
      { spoke: 26, mm: 0.6, sigma: 0.8 },
      { spoke: 3, mm: -0.5, sigma: 0.8 },
    ],
    flat: { center: 13, halfWidth: 2.5 },
  },
};

export type RunoutFn = (phi: number) => number;

const wrap = (d: number, period: number) => d - period * Math.round(d / period);

function axisFn(cfg: AxisConfig, spokes: number, rand: () => number): RunoutFn {
  const parts = cfg.orders.map((order) => ({
    order,
    amp: cfg.amplitudeMm[0] + rand() * (cfg.amplitudeMm[1] - cfg.amplitudeMm[0]),
    phase: rand() * 2 * Math.PI,
  }));
  const base: RunoutFn = (phi) => {
    let v = 0;
    for (const p of parts) v += p.amp * Math.sin((2 * Math.PI * p.order * phi) / spokes + p.phase);
    for (const o of cfg.outliers) {
      const d = wrap(phi - o.spoke, spokes);
      v += o.mm * Math.exp(-(d * d) / (2 * o.sigma * o.sigma));
    }
    return v;
  };
  const flat = cfg.flat;
  if (!flat) return base;

  const level = base(flat.center);
  return (phi) => {
    const d = Math.abs(wrap(phi - flat.center, spokes)) / flat.halfWidth;
    // Tukey-Fenster: innen 60 % voll eingeebnet, außen weicher Übergang
    const w = d >= 1 ? 0 : d <= 0.6 ? 1 : 0.5 * (1 + Math.cos((Math.PI * (d - 0.6)) / 0.4));
    const v = base(phi);
    return v + w * (level - v);
  };
}

/** Ground-Truth-Schlagprofile über der Speichenposition φ (periodisch mit `spokes`). */
export function makeProfile(cfg: ProfileConfig, spokes: number): { lateral: RunoutFn; height: RunoutFn } {
  const rand = rng(cfg.seed);
  return { lateral: axisFn(cfg.lateral, spokes, rand), height: axisFn(cfg.height, spokes, rand) };
}
