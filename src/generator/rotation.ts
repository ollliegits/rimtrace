import { rng } from './rng';

export interface Burst {
  /** Beginn in s. */
  at: number;
  duration: number;
  spokesPerSecond: number;
}

export interface RotationConfig {
  seed: number;
  meanSpokesPerSecond: number;
  /** Relative Geschwindigkeitsschwankung (0,4 = ±40 %). */
  wobble: number;
  /** Abstand zwischen Stopps bzw. Zurückdrehen in s. */
  eventGapS: [number, number];
  stopS: [number, number];
  reverseSpokes: [number, number];
  /** Abschnitte mit fester (hoher) Geschwindigkeit, z. B. um die Grenze der Winkelverfolgung zu überschreiten. */
  bursts: Burst[];
}

export const defaultRotation: RotationConfig = {
  seed: 7,
  meanSpokesPerSecond: 6,
  wobble: 0.4,
  eventGapS: [2, 5],
  stopS: [0.5, 2],
  reverseSpokes: [0.1, 0.5],
  bursts: [],
};

const DT = 1 / 480;
const HORIZON_S = 120;
const REVERSE_S = 0.4;
const RAMP_S = 0.15;

const ramp = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
/** 0 → 1 → 0, voll zwischen t0 und t1, mit weichen Flanken der Länge r. */
const window = (t: number, t0: number, t1: number, r: number) => ramp((t - t0) / r) * (1 - ramp((t - t1) / r));

interface Event {
  kind: 'stop' | 'reverse';
  at: number;
  /** Dauer (stop) bzw. Weg in Speichen (reverse). */
  size: number;
}

/** Drehverlauf von Hand: φ(t) in Speichen. Deterministisch über den Seed. */
export function makeRotation(cfg: RotationConfig, phi0: number): (t: number) => number {
  const rand = rng(cfg.seed);
  const between = ([a, b]: [number, number]) => a + rand() * (b - a);
  const p1 = rand() * 2 * Math.PI;
  const p2 = rand() * 2 * Math.PI;

  const events: Event[] = [];
  for (let t = 2; t < HORIZON_S; ) {
    const stop = rand() < 0.5;
    const size = stop ? between(cfg.stopS) : between(cfg.reverseSpokes);
    events.push({ kind: stop ? 'stop' : 'reverse', at: t, size });
    t += (stop ? size : REVERSE_S) + between(cfg.eventGapS);
  }

  const velocity = (t: number) => {
    let v = cfg.meanSpokesPerSecond * (1 + cfg.wobble * (0.6 * Math.sin((2 * Math.PI * t) / 1.7 + p1) + 0.4 * Math.sin((2 * Math.PI * t) / 0.63 + p2)));
    let extra = 0;
    for (const e of events) {
      if (e.kind === 'stop') v *= 1 - window(t, e.at, e.at + e.size, RAMP_S);
      else {
        v *= 1 - window(t, e.at - 0.1, e.at + REVERSE_S, 0.1);
        if (t >= e.at && t <= e.at + REVERSE_S) extra -= ((Math.PI * e.size) / (2 * REVERSE_S)) * Math.sin((Math.PI * (t - e.at)) / REVERSE_S);
      }
    }
    for (const b of cfg.bursts) {
      const w = window(t, b.at, b.at + b.duration, 0.3);
      v = v * (1 - w) + b.spokesPerSecond * w;
    }
    return v + extra;
  };

  const n = Math.ceil(HORIZON_S / DT);
  const phi = new Float64Array(n + 1);
  phi[0] = phi0;
  for (let k = 0; k < n; k++) phi[k + 1] = phi[k] + velocity((k + 0.5) * DT) * DT;

  return (t) => {
    if (t >= HORIZON_S) return phi[n] + cfg.meanSpokesPerSecond * (t - HORIZON_S);
    const x = t / DT;
    const k = Math.floor(x);
    return phi[k] + (phi[k + 1] - phi[k]) * (x - k);
  };
}
