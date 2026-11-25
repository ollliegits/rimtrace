import type { Gray } from '../core/image';
import { defaultSetup, type Setup } from '../core/setup';
import { defaultProfileConfig, makeProfile, type ProfileConfig, type RunoutFn } from './profile';
import { renderScene } from './render';

/** Störungen. Stufe 1 setzt sie noch nicht um; nur der Testfall `ideal` (alles aus) ist erlaubt. */
export interface Disturbances {
  noiseSigma: number;
  blurSigmaPx: number;
  shakePx: number;
  scaleDrift: number;
  /** Ungleichmäßige Drehung inkl. Stopps und Zurückdrehen. */
  irregularRotation: boolean;
  glare: boolean;
  missingMark: boolean;
}

export const noDisturbances: Disturbances = {
  noiseSigma: 0,
  blurSigmaPx: 0,
  shakePx: 0,
  scaleDrift: 0,
  irregularRotation: false,
  glare: false,
  missingMark: false,
};

export const scenarios = {
  ideal: noDisturbances,
} as const;

export type ScenarioName = keyof typeof scenarios;

export interface GeneratorConfig {
  setup: Setup;
  profile: ProfileConfig;
  disturbances: Disturbances;
  fps: number;
  /** Mittlere Drehgeschwindigkeit in Speichen pro Sekunde. */
  spokesPerSecond: number;
  /** Startposition in Speichen. */
  phi0: number;
}

export interface Truth {
  frame: number;
  t: number;
  /** Speichenposition φ, unbegrenzt wachsend. */
  phi: number;
  /** Nächstliegende Speiche. */
  spoke: number;
  /** Rohwerte der Ground Truth in mm (Seite: nach rechts +, Höhe: nach oben +). */
  lateralMm: number;
  heightMm: number;
}

export interface GeneratedFrame {
  image: Gray;
  truth: Truth;
}

export function makeConfig(scenario: ScenarioName = 'ideal', overrides: Partial<GeneratorConfig> = {}): GeneratorConfig {
  return {
    setup: defaultSetup,
    profile: defaultProfileConfig,
    disturbances: scenarios[scenario],
    fps: 30,
    spokesPerSecond: 32 / 12,
    phi0: 5.37,
    ...overrides,
  };
}

export class Generator {
  readonly setup: Setup;
  private readonly profile: { lateral: RunoutFn; height: RunoutFn };
  private readonly cov: Float32Array;
  private frame = 0;

  constructor(readonly config: GeneratorConfig) {
    if (Object.entries(config.disturbances).some(([k, v]) => v !== noDisturbances[k as keyof Disturbances])) {
      throw new Error('Störungen sind erst ab Stufe 2 umgesetzt; nur das Szenario `ideal` ist verfügbar.');
    }
    this.setup = config.setup;
    this.profile = makeProfile(config.profile, config.setup.spokes);
    this.cov = new Float32Array(config.setup.width * config.setup.height);
  }

  /** Ground Truth je Speiche (roh, nicht zentriert). */
  truthAtSpokes(): { lateral: number[]; height: number[] } {
    const idx = Array.from({ length: this.setup.spokes }, (_, i) => i);
    return { lateral: idx.map((i) => this.profile.lateral(i)), height: idx.map((i) => this.profile.height(i)) };
  }

  /** Drehwinkel-Verlauf über die Zeit (Stufe 1: gleichmäßig). */
  private phiAt(t: number): number {
    return this.config.phi0 + this.config.spokesPerSecond * t;
  }

  next(): GeneratedFrame {
    const { setup: s, fps } = this.config;
    const t = this.frame / fps;
    const phi = this.phiAt(t);
    const lateralMm = this.profile.lateral(phi);
    const heightMm = this.profile.height(phi);

    const data = new Uint8Array(s.width * s.height);
    renderScene(s, { phi, lateralMm, heightMm, mmPerPx: s.mmPerPx }, this.cov, data);

    const spoke = ((Math.round(phi) % s.spokes) + s.spokes) % s.spokes;
    return {
      image: { data, width: s.width, height: s.height },
      truth: { frame: this.frame++, t, phi, spoke, lateralMm, heightMm },
    };
  }
}

export function createGenerator(scenario: ScenarioName = 'ideal', overrides: Partial<GeneratorConfig> = {}): Generator {
  return new Generator(makeConfig(scenario, overrides));
}
