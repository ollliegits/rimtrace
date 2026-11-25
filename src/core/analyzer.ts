import { SpokeAccumulator, type SpokeProfile } from './aggregate';
import { levels, type Gray } from './image';
import { bracketMarks, detectMarks, PhaseTracker, type Mark } from './marks';
import { measureRim, type RimMeasurement } from './measure';
import { recommend, type Action, type RecommendOptions } from './recommend';
import type { Setup } from './setup';

export interface FrameResult {
  rim: RimMeasurement | null;
  marks: Mark[];
  /** Speichenposition φ in [0, spokes); undefined, solange die Position unbekannt ist. */
  phi?: number;
  /** Speiche, der das Bild zugeordnet wurde (nur nahe an einer Speiche). */
  spoke?: number;
  /** Das Rad hat sich zwischen zwei Bildern zu weit gedreht; das Bild wurde verworfen. */
  tooFast?: boolean;
}

/** Bild für Bild auswerten: Messung, Drehwinkel, Aggregation je Speiche. */
export class Analyzer {
  private readonly tracker: PhaseTracker;
  private readonly acc: SpokeAccumulator;

  constructor(readonly setup: Setup) {
    this.tracker = new PhaseTracker(setup.spokes);
    this.acc = new SpokeAccumulator(setup.spokes);
  }

  push(img: Gray): FrameResult {
    const s = this.setup;
    const lv = levels(img);
    const rim = measureRim(img, s, lv);
    if (!rim) return { rim, marks: [] };

    const pitchPx = s.circumferenceMm / s.spokes / rim.mmPerPx;
    const marks = detectMarks(img, s, lv, pitchPx);
    const { phi, tooFast } = this.tracker.update(bracketMarks(marks, s.xRead, pitchPx));
    const spoke = phi === undefined ? undefined : this.acc.add(phi, rim.lateralMm, rim.heightMm);
    return { rim, marks, phi, spoke, tooFast };
  }

  profile(): SpokeProfile {
    return this.acc.profile();
  }

  /** Mittelwert der Speichenmediane; Bezug, um Einzelwerte zu zentrieren. */
  means(): { lateral: number; height: number } {
    return this.acc.means();
  }

  actions(opts?: RecommendOptions): Action[] {
    return recommend(this.profile(), this.setup, opts);
  }

  reset(): void {
    this.tracker.reset();
    this.acc.reset();
  }
}
