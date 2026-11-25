import type { Gray } from '../core/image';
import type { Truth } from '../generator';

export interface Frame {
  image: Gray;
  /** Nur bei synthetischen Quellen vorhanden. */
  truth?: Truth;
}

/**
 * Austauschbare Bildquelle. Später: Videodatei (<video> → Canvas) und Kamera (getUserMedia),
 * jeweils mit read() = aktuelles Bild als Graustufen, oder null, wenn noch keins vorliegt.
 */
export interface FrameSource {
  readonly width: number;
  readonly height: number;
  read(): Frame | null;
  /** Ground Truth je Speiche (roh), nur bei synthetischen Quellen. */
  groundTruth?(): { lateral: number[]; height: number[] };
  /** Zurück an den Anfang (nur wenn sinnvoll). */
  restart?(): void;
}
