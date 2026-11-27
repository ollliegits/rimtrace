/**
 * Einstellungen für echte Aufnahmen (Hochformat-Video, Felge hängt von oben ins Bild, Referenzspeiche rechts daneben).
 * Alle Koordinaten sind Pixel im Videobild; ausgewertet wird nur der Ausschnitt `crop`.
 * Vorzeichen: Seitenschlag nach rechts positiv, Höhenschlag positiv, wenn die Hornspitzen weiter unten im Bild liegen.
 */
export interface RealSetup {
  spokes: number;
  /** Nullpunkt der Nummerierung: Ventilloch (größer als ein Nippelloch) oder heller Aufkleber (Testvideos). */
  marker: 'ventil' | 'aufkleber';
  /** Speiche 1 = erste Speiche nach dem Nullpunkt in Fahrtrichtung; sie liegt auf dieser Seite, danach wechseln die Seiten. */
  spoke1Side: 'antrieb' | 'bremse';
  /** Auf welcher Bildseite (links/rechts) die Antriebsseite der Felge liegt. */
  driveImageSide: 'left' | 'right';
  /** Richtung, in die sich das Felgenbett im Bild bewegt, wenn das Rad vorwärts dreht. */
  travel: 'up' | 'down';
  /** Kamerabild drehen (0, 90, 180, 270 Grad im Uhrzeigersinn) und danach spiegeln, damit die Felge von oben ins Bild hängt. */
  rotate: number;
  mirror: boolean;
  /** Toleranz, ab der eine Maßnahme vorgeschlagen wird. */
  toleranceLateralMm: number;
  toleranceHeightMm: number;
  /** Außenbreite der Felge in mm (Pflichtfeld, je Felge); der Maßstab folgt aus der gemessenen Breite in px. */
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
  /** Ventilloch: größer als dieser Faktor mal die mittlere Lochgröße (Fläche des Dunkelereignisses, unabhängig von der Drehgeschwindigkeit). */
  valveRatio: number;
  /** Ein Loch im Abstand unter diesem Anteil des üblichen Lochabstands (Bettweg) zum vorigen Loch ist eine Störung. */
  holeMinGap: number;
  /** Bettstreifen (Videokoordinaten [von, bis]) für die Drehrichtung: Spalten und Zeilen, die nur das Felgenbett mit seinen Löchern zeigen. */
  bedX: number[];
  bedY: number[];
  /** Größte erwartete Verschiebung des Bettes zwischen zwei Bildern (px). */
  bedMaxShift: number;
  /** Prüfung der Umdrehungen untereinander (mm je Speiche, beide Achsen): mittlere und größte Abweichung. */
  agreeMeanMm: number;
  agreeMaxMm: number;
  /** Bilder für den gleitenden Median der Basis. */
  baselineFrames: number;
  /** Bilder bis zu ± diesem Anteil eines Lochabstands um ein Loch gehören zur Speiche. */
  binHalfWidth: number;
}

/** Fehlermeldung, wenn Pflichtangaben fehlen oder Werte ungültig sind; sonst undefined. */
export function realSetupError(s: RealSetup): string | undefined {
  if (!(s.rimWidthMm > 0)) return 'rimWidthMm ist ein Pflichtfeld: Außenbreite der Felge in mm (mit Messschieber messen) eintragen';
  if (!Number.isInteger(s.spokes) || s.spokes < 2) return 'spokes muss eine ganze Zahl ≥ 2 sein';
  const [cx, cy, cw, ch] = s.crop;
  for (const [name, [a, b], [lo, hi]] of [
    ['rimX', s.rimX, [cx, cx + cw]],
    ['rimY', s.rimY, [cy, cy + ch]],
    ['refX', s.refX, [cx, cx + cw]],
    ['refY', s.refY, [cy, cy + ch]],
    ['bedX', s.bedX, [cx, cx + cw]],
    ['bedY', s.bedY, [cy, cy + ch]],
  ] as const) {
    if (a < lo || b > hi) return `${name} [${a}, ${b}] liegt nicht im Ausschnitt crop [${lo}, ${hi}]: Messbereich oder Ausschnitt anpassen`;
  }
  const oneOf = (v: string, list: string[], name: string) => (list.includes(v) ? undefined : `${name} muss ${list.join(' oder ')} sein`);
  return (
    oneOf(s.marker, ['ventil', 'aufkleber'], 'marker') ??
    oneOf(s.spoke1Side, ['antrieb', 'bremse'], 'spoke1Side') ??
    oneOf(s.driveImageSide, ['left', 'right'], 'driveImageSide') ??
    oneOf(s.travel, ['up', 'down'], 'travel') ??
    oneOf(String(s.rotate), ['0', '90', '180', '270'], 'rotate')
  );
}

/** Bildseite (links/rechts) von Speiche 1; ungerade Speichen liegen auf der anderen Seite. */
export function spoke1ImageSide(s: Pick<RealSetup, 'spoke1Side' | 'driveImageSide'>): 'left' | 'right' {
  const other = s.driveImageSide === 'left' ? 'right' : 'left';
  return s.spoke1Side === 'antrieb' ? s.driveImageSide : other;
}

/** Seitenzuordnung der Speichen für `recommend`/`spokeSide`. */
export const spokeSides = (s: Pick<RealSetup, 'spoke1Side' | 'driveImageSide'>) => ({ evenSpokeSide: spoke1ImageSide(s) });

export const sideName = (s: Pick<RealSetup, 'driveImageSide'>, side: 'left' | 'right') =>
  side === s.driveImageSide ? 'Antriebsseite' : 'Bremsscheibenseite';

export const defaultRealSetup: RealSetup = {
  spokes: 28,
  marker: 'ventil',
  spoke1Side: 'antrieb',
  driveImageSide: 'left',
  travel: 'down',
  rotate: 0,
  mirror: false,
  toleranceLateralMm: 0.2,
  toleranceHeightMm: 0.3,
  rimWidthMm: 0,
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
  valveRatio: 2,
  holeMinGap: 0.5,
  bedX: [445, 525],
  bedY: [580, 900],
  bedMaxShift: 60,
  agreeMeanMm: 0.5,
  agreeMaxMm: 1.5,
  baselineFrames: 301,
  binHalfWidth: 0.25,
};
