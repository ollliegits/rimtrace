/**
 * Einstellungen für echte Aufnahmen (Hochformat-Video, Felge hängt von oben ins Bild, Referenzspeiche rechts daneben).
 * Alle Koordinaten sind Pixel im Videobild; ausgewertet wird nur der Ausschnitt `crop`.
 * Vorzeichen: Seitenschlag nach rechts positiv, Höhenschlag positiv, wenn die Hornspitzen weiter unten im Bild liegen.
 */
export interface RealSetup {
  spokes: number;
  evenSpokeSide: 'left' | 'right';
  /** Bekannte Außenbreite der Felge in mm; der Maßstab folgt aus der gemessenen Breite in px. */
  rimWidthMm: number;
  /** Ausgewerteter Bildausschnitt [x, y, Breite, Höhe]. */
  crop: number[];
  /** Spaltenbereich [x0, x1], der die Felge mit hellem Rand auf beiden Seiten enthalten muss. */
  rimX: number[];
  /** Zeilenbereich [y0, y1], in dem die Hornspitzen liegen. */
  rimY: number[];
  /** Flankenzeilen: von … bis … Zeilen oberhalb der untersten Felgenzeile. */
  flankRowsAbove: number[];
  /** Hornspalten: Abstand [von, bis] px innerhalb der Flanke. */
  tipColumns: number[];
  /** Suchbereich der Referenzspeiche mit Nippelkopf. */
  refX: number[];
  refY: number[];
  /** Zeilen [von, bis] unterhalb der Nippelkopf-Oberkante, in denen die Speichenmitte gemessen wird. */
  refRows: number[];
  /** Schwelle der Referenz zwischen Felgendunkel (0) und Papier (1); ein grauer Block braucht einen höheren Wert als eine schwarze Speiche. */
  refLevel: number;
  /** Lochfenster: [Kantenlänge, Abstand in px oberhalb der Hornspitzen]. */
  holeWindow: number[];
  /** Schwellen gegen die Helligkeitsbasis (Grauwerte). */
  holeDrop: number;
  holeRelease: number;
  stickerRise: number;
  /** Bilder für den gleitenden Median der Basis. */
  baselineFrames: number;
  /** Bilder bis zu ± diesem Anteil eines Lochabstands um ein Loch gehören zur Speiche. */
  binHalfWidth: number;
}

export const defaultRealSetup: RealSetup = {
  spokes: 28,
  evenSpokeSide: 'left',
  rimWidthMm: 27.5,
  crop: [380, 560, 300, 450],
  rimX: [400, 575],
  rimY: [600, 1000],
  flankRowsAbove: [40, 15],
  tipColumns: [5, 11],
  refX: [572, 596],
  refY: [922, 1000],
  refRows: [5, 65],
  refLevel: 0.5,
  holeWindow: [16, 120],
  holeDrop: 12,
  holeRelease: 5,
  stickerRise: 40,
  baselineFrames: 301,
  binHalfWidth: 0.25,
};
