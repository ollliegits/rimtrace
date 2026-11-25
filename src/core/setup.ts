/** Geometrie und Felgenmaße. Generator zeichnet damit, die Auswertung nutzt sie nur für Suchbereiche. */
export interface Setup {
  width: number;
  height: number;
  /** Nominaler Maßstab. Nur der Generator nutzt ihn; die Auswertung kalibriert sich selbst. */
  mmPerPx: number;

  rimWidthMm: number;
  hornWidthMm: number;
  hornHeightMm: number;
  circumferenceMm: number;
  spokes: number;
  /** Speichen mit gerader Nummer sitzen auf dieser Seite, ungerade auf der anderen. */
  evenSpokeSide: 'left' | 'right';

  /** Referenzhalter: waagerechte Leiste (Unterkante bei refY) und senkrechte Leiste (rechte Kante bei refX). */
  refBarTop: number;
  refY: number;
  refX: number;

  /** Nominale Felgenlage im Bild (Mitte der Außenbreite, Oberkante der Hörner). */
  rimCenterX: number;
  hornTopY: number;

  /** Zeilen, in denen der Felgenkörper immer die volle Breite zeigt (Flankenmessung). */
  flankRows: [number, number];
  /** Ab dieser Zeile wird spaltenweise nach unten gesucht (über der Referenzleiste). */
  columnScanStart: number;
  /** Abstand der Messspalten von den Flanken, in mm. */
  hornColumnsMm: [number, number];

  /** Markerspur: Zeilen der Marken, Auswertungszeilen, Markenmaße. */
  markRows: [number, number];
  markScanRows: [number, number];
  markWidthMm: number;
  doubleMarkSpacingMm: number;
  /** Bildspalte, an der eine Marke steht, wenn die Speiche genau an der Messstelle ist. */
  xRead: number;
  /** Marken näher als dieser Abstand am Bildrand werden verworfen (evtl. angeschnitten). */
  markMargin: number;
}

export const defaultSetup: Setup = {
  width: 1920,
  height: 480,
  mmPerPx: 0.1,

  rimWidthMm: 27,
  hornWidthMm: 3,
  hornHeightMm: 5,
  circumferenceMm: 1750,
  spokes: 32,
  evenSpokeSide: 'left',

  refBarTop: 60,
  refY: 80,
  refX: 100,

  rimCenterX: 960,
  hornTopY: 200,

  flankRows: [300, 470],
  columnScanStart: 50,
  hornColumnsMm: [0.8, 2.2],

  markRows: [8, 48],
  markScanRows: [12, 44],
  markWidthMm: 3,
  doubleMarkSpacingMm: 8,
  xRead: 960,
  markMargin: 130,
};

export function spokeSide(s: Setup, spoke: number): 'left' | 'right' {
  const even = spoke % 2 === 0;
  const evenLeft = s.evenSpokeSide === 'left';
  return even === evenLeft ? 'left' : 'right';
}
