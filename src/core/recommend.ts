import type { SpokeProfile } from './aggregate';
import { spokeSide, type Setup } from './setup';

export interface Action {
  spoke: number;
  side: 'left' | 'right';
  axis: 'lateral' | 'height';
  verb: 'tighten' | 'loosen';
  /** Nippeldrehung in Umdrehungen, auf 1/8 gerundet. */
  turns: number;
  /** Abweichung, die korrigiert werden soll (mm, mit Vorzeichen des Profils). */
  deviationMm: number;
}

export interface RecommendOptions {
  /** Abweichungen darunter erzeugen keine Maßnahme. */
  toleranceMm?: number;
  count?: number;
  /** Faustwerte: Nippelumdrehungen je mm Abweichung. */
  turnsPerMm?: { lateral: number; height: number };
}

const defaultTurnsPerMm = { lateral: 0.5, height: 0.5 };

/**
 * Faustregel (Stufe 1):
 * - Felge an der Speiche zu weit links → rechte Speiche anziehen bzw. linke lösen (rechts analog).
 * - Felge zu hoch → Speiche anziehen, zu tief → lösen (beide Seiten gleich).
 */
export function recommend(p: SpokeProfile, s: Pick<Setup, 'evenSpokeSide'>, opts: RecommendOptions = {}): Action[] {
  const { toleranceMm = 0.2, count = 3, turnsPerMm = defaultTurnsPerMm } = opts;
  const actions: Action[] = [];

  p.lateral.forEach((dev, spoke) => {
    if (!Number.isFinite(dev) || Math.abs(dev) < toleranceMm) return;
    const side = spokeSide(s, spoke);
    // Abweichung nach rechts (dev > 0) korrigieren: linke Speiche anziehen, rechte lösen.
    const verb = (dev > 0) === (side === 'left') ? 'tighten' : 'loosen';
    actions.push({ spoke, side, axis: 'lateral', verb, turns: turns(dev, turnsPerMm.lateral), deviationMm: dev });
  });

  p.height.forEach((dev, spoke) => {
    if (!Number.isFinite(dev) || Math.abs(dev) < toleranceMm) return;
    const verb = dev > 0 ? 'tighten' : 'loosen';
    actions.push({
      spoke,
      side: spokeSide(s, spoke),
      axis: 'height',
      verb,
      turns: turns(dev, turnsPerMm.height),
      deviationMm: dev,
    });
  });

  return actions.sort((a, b) => Math.abs(b.deviationMm) - Math.abs(a.deviationMm)).slice(0, count);
}

function turns(devMm: number, perMm: number): number {
  return Math.max(0.125, Math.round(Math.abs(devMm) * perMm * 8) / 8);
}

const fraction = ['', '⅛', '¼', '⅜', '½', '⅝', '¾', '⅞'];

export function formatTurns(t: number): string {
  const whole = Math.floor(t);
  const frac = fraction[Math.round((t - whole) * 8) % 8];
  return `${whole || ''}${frac}` || '0';
}

export function describe(a: Action): string {
  const side = a.side === 'left' ? 'links' : 'rechts';
  const verb = a.verb === 'tighten' ? 'anziehen' : 'lösen';
  const what =
    a.axis === 'lateral'
      ? `Seitenschlag ${a.deviationMm > 0 ? '+' : ''}${a.deviationMm.toFixed(2)} mm`
      : `Höhenschlag ${a.deviationMm > 0 ? '+' : ''}${a.deviationMm.toFixed(2)} mm`;
  return `Speiche ${a.spoke} (${side}) ${formatTurns(a.turns)} Umdr. ${verb} – ${what}`;
}
