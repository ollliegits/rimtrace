import type { Gray } from '../core/image';
import { defaultSetup, type Setup } from '../core/setup';
import { Noise } from './noise';
import { defaultProfileConfig, makeProfile, type ProfileConfig, type RunoutFn } from './profile';
import { renderScene } from './render';
import { defaultRotation, makeRotation, type RotationConfig } from './rotation';

/** Störungen. Rauschen, Unschärfe und ungleichmäßige Drehung sind umgesetzt; der Rest folgt später. */
export interface Disturbances {
  noiseSigma: number;
  blurSigmaPx: number;
  shakePx: number;
  scaleDrift: number;
  /** Drehung von Hand (Verlauf aus `rotation`) statt gleichmäßig. */
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

const camera: Disturbances = { ...noDisturbances, noiseSigma: 4, blurSigmaPx: 1.5 };

export interface Scenario {
  disturbances: Disturbances;
  rotation?: Partial<RotationConfig>;
}

export const scenarios = {
  ideal: { disturbances: noDisturbances },
  kamera: { disturbances: camera },
  handdrehung: { disturbances: { ...camera, irregularRotation: true } },
  // Drei Abschnitte mit 24 Speichen/s = 0,8 Speichen pro Bild bei 30 fps
  'zu-schnell': {
    disturbances: { ...camera, irregularRotation: true },
    rotation: {
      bursts: [
        { at: 6, duration: 0.8, spokesPerSecond: 24 },
        { at: 14, duration: 0.8, spokesPerSecond: 24 },
        { at: 22, duration: 0.8, spokesPerSecond: 24 },
      ],
    },
  },
} satisfies Record<string, Scenario>;

export type ScenarioName = keyof typeof scenarios;
export const scenarioNames = Object.keys(scenarios) as ScenarioName[];

export interface GeneratorConfig {
  setup: Setup;
  /** Wahrer Maßstab der Aufnahme in mm/px; die Auswertung kennt ihn nicht. */
  mmPerPx: number;
  profile: ProfileConfig;
  disturbances: Disturbances;
  rotation: RotationConfig;
  /** Seed für das Bildrauschen. */
  noiseSeed: number;
  fps: number;
  /** Gleichmäßige Drehung (wenn nicht `irregularRotation`) in Speichen pro Sekunde. */
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
  const sc: Scenario = scenarios[scenario];
  return {
    setup: defaultSetup,
    mmPerPx: 0.0937,
    profile: defaultProfileConfig,
    disturbances: sc.disturbances,
    rotation: { ...defaultRotation, ...sc.rotation },
    noiseSeed: 3,
    fps: 30,
    spokesPerSecond: 32 / 12,
    phi0: 5.37,
    ...overrides,
  };
}

const unsupported: (keyof Disturbances)[] = ['shakePx', 'scaleDrift', 'glare', 'missingMark'];

export class Generator {
  readonly setup: Setup;
  private readonly profile: { lateral: RunoutFn; height: RunoutFn };
  private readonly phiAt: (t: number) => number;
  private readonly noise: Noise;
  private readonly cov: Float32Array;
  private readonly lum: Float32Array;
  private frame = 0;

  constructor(readonly config: GeneratorConfig) {
    const bad = unsupported.filter((k) => config.disturbances[k] !== noDisturbances[k]);
    if (bad.length) throw new Error(`Störung noch nicht umgesetzt: ${bad.join(', ')}`);

    const { setup, disturbances: d } = config;
    this.setup = setup;
    this.profile = makeProfile(config.profile, setup.spokes);
    this.phiAt = d.irregularRotation
      ? makeRotation(config.rotation, config.phi0)
      : (t) => config.phi0 + config.spokesPerSecond * t;
    this.noise = new Noise(config.noiseSeed, d.noiseSigma);
    this.cov = new Float32Array(setup.width * setup.height);
    this.lum = new Float32Array(setup.width * setup.height);
  }

  /** Ground Truth je Speiche (roh, nicht zentriert). */
  truthAtSpokes(): { lateral: number[]; height: number[] } {
    const idx = Array.from({ length: this.setup.spokes }, (_, i) => i);
    return { lateral: idx.map((i) => this.profile.lateral(i)), height: idx.map((i) => this.profile.height(i)) };
  }

  next(): GeneratedFrame {
    const { setup: s, fps, mmPerPx, disturbances } = this.config;
    const t = this.frame / fps;
    const phi = this.phiAt(t);
    const lateralMm = this.profile.lateral(phi);
    const heightMm = this.profile.height(phi);

    renderScene(s, { phi, lateralMm, heightMm, mmPerPx, blurSigmaPx: disturbances.blurSigmaPx }, this.cov, this.lum);
    const data = new Uint8Array(s.width * s.height);
    this.noise.apply(this.lum, data);

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
