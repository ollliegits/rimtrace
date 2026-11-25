import type { Gray } from '../core/image';
import type { Setup } from '../core/setup';
import type { Truth } from '../generator';

export interface Frame {
  image: Gray;
  /** Nur bei synthetischen Quellen vorhanden. */
  truth?: Truth;
}

/**
 * Austauschbare Bildquelle (synthetischer Generator, Videodatei, später Kamera via getUserMedia).
 * read() liefert das nächste Bild als Graustufen oder null, wenn gerade keins bereit ist.
 */
export interface FrameSource {
  readonly width: number;
  readonly height: number;
  /** Setup, mit dem die Quelle gezeichnet wurde; fehlt bei echten Aufnahmen (dann gilt das einstellbare Setup). */
  readonly setup?: Setup;
  /** Liefert Bilder im eigenen Takt (Video, Kamera); sonst bestimmt die Oberfläche das Tempo. */
  readonly live?: boolean;
  /** Quelle ist zu Ende (Video). */
  readonly finished?: boolean;
  read(): Frame | null;
  /** Ground Truth je Speiche (roh), nur wenn bekannt. */
  groundTruth?(): { lateral: number[]; height: number[] } | undefined;
  /** Zurück an den Anfang (nur wenn sinnvoll). */
  restart?(): void;
  setPaused?(paused: boolean): void;
  dispose?(): void;
}
