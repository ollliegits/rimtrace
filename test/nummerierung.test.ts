import { describe, expect, it } from 'vitest';
import {
  bedShift,
  defaultRealSetup,
  describe as describeAction,
  numberHoles,
  orientCrop,
  orientTransform,
  realSetupError,
  sideName,
  spokeSides,
  spoke1ImageSide,
  type NumEvent,
} from '../src/core';

const N = 6;

/** Läuft einen Weg (Lochabstände als Position x) ab und erzeugt die Ereignisse, die die Erkennung liefern würde. Loch j bei x = j, Ventil bei x = k·N − ½. */
function walk(path: number[], marker: 'ventil' | 'aufkleber' = 'ventil') {
  const events: NumEvent[] = [];
  const truth = new Map<number, number>();
  let x = path[0];
  let t = 0;
  const cross = (a: number, b: number, at: number, kind: 'hole' | 'sticker', size: number, j?: number) => {
    if ((a < at) === (b < at)) return;
    const dir = b > a ? 1 : -1;
    events.push({ kind, frame: t, dir, size });
    if (j !== undefined) truth.set(t, j);
    t += 3;
  };
  for (const target of path.slice(1)) {
    const step = Math.sign(target - x) * 0.05;
    while (Math.abs(target - x) > 1e-9) {
      const nx = Math.round((x + step) * 1e6) / 1e6;
      for (let j = Math.floor(Math.min(x, nx)) - 1; j <= Math.ceil(Math.max(x, nx)) + 1; j++) {
        cross(x, nx, j, 'hole', 1, j);
        if (j % N === 0 && j !== 0) {
          if (marker === 'ventil') cross(x, nx, j - 0.5, 'hole', 5);
          else cross(x, nx, j - 0.5, 'sticker', 5);
        }
      }
      x = nx;
    }
  }
  return { events, truth };
}

const opts = { marker: 'ventil' as const, spokes: N, valveRatio: 2 };

function expectTrueNumbers(path: number[], marker: 'ventil' | 'aufkleber' = 'ventil') {
  const { events, truth } = walk(path, marker);
  const n = numberHoles(events, { ...opts, marker });
  expect(n.holes.length).toBeGreaterThan(0);
  for (const h of n.holes) {
    const j = truth.get(h.frame) as number;
    expect([h.rev, h.k]).toEqual([Math.floor(j / N), ((j % N) + N) % N]);
  }
  return n;
}

describe('Nummerierung mit Drehrichtung', () => {
  it('vorwärts über 2,5 Umdrehungen: Ventil als Nullpunkt, Speiche 1 = erstes Loch danach', () => {
    const n = expectTrueNumbers([-0.1, 2.5 * N]);
    expect(n.markers).toHaveLength(2);
    expect(n.valveRatios.every((r) => r === 5)).toBe(true);
  });

  it('Stopp, Zurückdrehen über das Ventil und wieder vorwärts ändern die Nummern nicht', () => {
    const n = expectTrueNumbers([-0.1, 3.2, 2.4, 3.1, 8.3, 5.2, 7.4, 2.5 * N + 1]);
    expect(n.markers).toHaveLength(2);
    expect(new Set(n.holes.map((h) => h.ord)).size).toBe(n.holes.length - n.holes.filter((h, i, all) => all.findIndex((o) => o.ord === h.ord) !== i).length);
  });

  it('Rückwärtsdrehen mehrerer Löcher vor dem ersten Nullpunkt', () => {
    expectTrueNumbers([-0.1, 4.4, 1.6, 2 * N + 3]);
  });

  it('Aufkleber: zwei Flecken mit einem Loch dazwischen sind ein Nullpunkt', () => {
    const { events } = walk([-0.1, 2.5 * N], 'aufkleber');
    const sticker = events.filter((e) => e.kind === 'sticker');
    const extra: NumEvent = { kind: 'sticker', frame: sticker[0].frame + 4, dir: 1, size: 5 };
    // zweiter Fleck eine Position später (nach dem Loch N)
    const idx = events.findIndex((e) => e.kind === 'hole' && e.frame > sticker[0].frame);
    const withExtra = [...events.slice(0, idx + 1), extra, ...events.slice(idx + 1)];
    const n = numberHoles(withExtra, { ...opts, marker: 'aufkleber' });
    expect(n.markers).toHaveLength(2);
  });

  it('Ereignis ohne Durchgang (dir 0) wird nicht gezählt', () => {
    const { events } = walk([-0.1, 2 * N + 0.2]);
    const noisy: NumEvent[] = [{ kind: 'hole', frame: 0.5, dir: 0, size: 1 }, ...events];
    expect(numberHoles(noisy, opts).ignored).toBe(1);
    expect(numberHoles(noisy, opts).holes).toEqual(numberHoles(events, opts).holes);
  });

  it('ohne Nullpunkt keine Zuordnung', () => {
    expect(numberHoles(walk([-0.1, N - 1]).events, opts).holes).toHaveLength(0);
  });
});

describe('Bettverschiebung, Orientierung, Setup', () => {
  const sig = (shift: number) => Float32Array.from({ length: 300 }, (_, y) => Math.exp(-((y - 120 - shift) ** 2) / 40) - Math.exp(-((y - 200 - shift) ** 2) / 90));
  it('bestimmt Betrag und Vorzeichen unterhalb eines Pixels', () => {
    expect(bedShift(sig(0), sig(7.3), 40)).toBeCloseTo(7.3, 1);
    expect(bedShift(sig(0), sig(-12.6), 40)).toBeCloseTo(-12.6, 1);
    expect(bedShift(sig(0), new Float32Array(300), 40)).toBeNaN();
  });

  it('Orientierung: Drehen und Spiegeln des Ausschnitts', () => {
    const w = 4;
    const h = 3;
    const src = { data: Uint8Array.from({ length: w * h }, (_, i) => i), width: w, height: h };
    // 90° im Uhrzeigersinn: erste Spalte (unten nach oben gelesen) wird erste Zeile
    expect(Array.from(orientCrop(src, 90, false, [0, 0, 3, 4]).data.slice(0, 3))).toEqual([8, 4, 0]);
    expect(Array.from(orientCrop(src, 180, false, [0, 0, 4, 3]).data.slice(0, 4))).toEqual([11, 10, 9, 8]);
    expect(Array.from(orientCrop(src, 270, false, [0, 0, 3, 4]).data.slice(0, 3))).toEqual([3, 7, 11]);
    expect(Array.from(orientCrop(src, 0, true, [0, 0, 4, 3]).data.slice(0, 4))).toEqual([3, 2, 1, 0]);
    expect(orientTransform(w, h, 90, false)).toEqual([0, 1, -1, 0, h, 0]);
    expect(orientTransform(w, h, 0, true)).toEqual([-1, 0, 0, 1, w, 0]);
    expect(orientTransform(w, h, 0, false, [10, 20, 5, 5])).toEqual([1, 0, 0, 1, -10, -20]);
  });

  it('Felgenbreite fehlt oder Aufzählung ungültig → Fehlermeldung', () => {
    expect(realSetupError(defaultRealSetup)).toMatch(/rimWidthMm/);
    const ok = { ...defaultRealSetup, rimWidthMm: 27.5 };
    expect(realSetupError(ok)).toBeUndefined();
    expect(realSetupError({ ...ok, travel: 'left' as never })).toMatch(/travel/);
    expect(realSetupError({ ...ok, spokes: 1 })).toMatch(/spokes/);
  });

  it('Speiche 1 liegt auf der gewählten Seite; Ausgabe zählt ab 1 mit Seitennamen', () => {
    const s = { ...defaultRealSetup, rimWidthMm: 27.5, spoke1Side: 'bremse' as const, driveImageSide: 'left' as const };
    expect(spoke1ImageSide(s)).toBe('right');
    expect(spokeSides(s).evenSpokeSide).toBe('right');
    const a = { spoke: 0, side: 'right' as const, axis: 'lateral' as const, verb: 'tighten' as const, turns: 1, deviationMm: 1 };
    expect(describeAction(a, { firstSpoke: 1, sideName: (x) => sideName(s, x) })).toContain('Speiche 1 (Bremsscheibenseite)');
  });
});
