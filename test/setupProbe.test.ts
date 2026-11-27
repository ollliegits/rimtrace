import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decode, defaultRealSetup, encode, parseSetup, probeSetup, worstLight, type Gray, type ProbeArea, type ProbeResult, type RealSetup } from '../src/core';
import { readVideoGray } from './support/videoReader';

const W = 400;
const H = 400;
const BG = 230;
const DARK = 20;

// Aufbau wie am Rad: Felgenwand mit zwei Hörnern, Referenzspeiche rechts, ein Loch im Bett.
const setup: RealSetup = {
  ...defaultRealSetup,
  rimWidthMm: 27.5,
  crop: [0, 0, W, H],
  rimX: [90, 270],
  rimY: [100, 360],
  refX: [300, 380],
  refY: [120, 300],
  bedX: [150, 210],
  bedY: [100, 200],
};

function scene(opts: { dark?: number; bg?: number; spoke?: boolean; extraBar?: boolean } = {}): Gray {
  const data = new Uint8Array(W * H).fill(opts.bg ?? BG);
  const fill = (x0: number, x1: number, y0: number, y1: number, v: number) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data[y * W + x] = v;
  };
  const dark = opts.dark ?? DARK;
  fill(130, 230, 0, 300, dark);
  fill(130, 145, 300, 320, dark);
  fill(215, 230, 300, 320, dark);
  fill(170, 180, 140, 150, opts.bg ?? BG);
  if (opts.spoke !== false) {
    fill(333, 347, 150, 165, dark);
    fill(338, 342, 165, 330, dark);
  }
  if (opts.extraBar) fill(98, 108, 100, 340, dark);
  return { data, width: W, height: H };
}

const area = (r: ProbeResult, a: ProbeArea) => r.areas.find((x) => x.area === a)!;
const lights = (r: ProbeResult) => Object.fromEntries(r.areas.map((a) => [a.area, a.light]));

describe('Einrichtungsprüfung (synthetisch)', () => {
  it('gut eingerichtet: alles in Ordnung, Overlay zeigt die erkannten Kanten', () => {
    const r = probeSetup(scene(), setup);
    expect(lights(r)).toEqual({ crop: 'ok', rim: 'ok', tips: 'ok', ref: 'ok', hole: 'ok', bed: 'ok' });
    const near = (v: number | undefined, want: number) => expect(Math.abs(v! - want)).toBeLessThan(1);
    near(r.overlay.left, 130);
    near(r.overlay.right, 230);
    near(r.overlay.tipLeft?.[1], 320);
    near(r.overlay.ref?.[0], 340);
  });

  it('zu geringer Kontrast: Fehler an der Felge, abhängige Bereiche nicht prüfbar', () => {
    const r = probeSetup(scene({ bg: 200, dark: 160 }), setup);
    expect(area(r, 'rim')).toMatchObject({ light: 'error', text: 'Kontrast zu schwach' });
    expect(area(r, 'tips').light).toBe('error');
    expect(area(r, 'hole').light).toBe('error');
  });

  it('Rahmen ohne Felge: keine Kontur', () => {
    const r = probeSetup(scene(), { ...setup, rimX: [10, 100] });
    expect(area(r, 'rim')).toMatchObject({ light: 'error', text: 'keine Kontur gefunden' });
  });

  it('zwei dunkle Objekte im Felgenrahmen: uneindeutige Erkennung', () => {
    const r = probeSetup(scene({ extraBar: true }), setup);
    expect(area(r, 'rim')).toMatchObject({ light: 'error', text: expect.stringContaining('uneindeutig') });
  });

  it('Felge am Rahmenrand: Fehler mit Hinweis auf breiteren Rahmen', () => {
    const r = probeSetup(scene(), { ...setup, rimX: [130, 270] });
    expect(area(r, 'rim')).toMatchObject({ light: 'error', text: 'Felge berührt den Rand', hint: expect.stringContaining('breiter') });
  });

  it('Felge mit wenig Spielraum: Warnung', () => {
    const r = probeSetup(scene(), { ...setup, rimX: [125, 270] });
    expect(area(r, 'rim').light).toBe('warn');
  });

  it('Referenz fehlt: Fehler an der Referenz, Rest unberührt', () => {
    const r = probeSetup(scene({ spoke: false }), setup);
    expect(area(r, 'ref').light).toBe('error');
    expect(lights(r)).toMatchObject({ rim: 'ok', tips: 'ok', hole: 'ok', bed: 'ok' });
  });

  it('Lochfenster ragt über die Felge hinaus', () => {
    const r = probeSetup(scene(), { ...setup, holeWindow: [240, 100] });
    expect(area(r, 'hole')).toMatchObject({ light: 'error', text: 'Fenster liegt nicht auf der Felge' });
  });

  it('Bettstreifen breiter als die Felge: Warnung, ohne Felge: Fehler', () => {
    expect(area(probeSetup(scene(), { ...setup, bedX: [100, 300] }), 'bed').light).toBe('warn');
    expect(area(probeSetup(scene(), { ...setup, bedX: [10, 100] }), 'bed').light).toBe('error');
  });

  it('Rahmen außerhalb des Ausschnitts', () => {
    const r = probeSetup(scene(), { ...setup, refX: [300, 420] });
    expect(area(r, 'crop')).toMatchObject({ light: 'error', text: 'Messbereich außerhalb des Ausschnitts' });
    expect(worstLight(r.areas)).toBe('error');
  });
});

describe('Protokoll der Einrichtungsprüfung', () => {
  it('probe-request und probe laufen hin und zurück', () => {
    const probe = probeSetup(scene(), setup);
    expect(decode(encode({ t: 'probe-request' }))).toEqual({ message: { t: 'probe-request' } });
    expect(decode(encode({ t: 'probe', probe }))).toEqual({ message: { t: 'probe', probe } });
  });

  it('weist ungültige Prüfergebnisse ab', () => {
    const bad = (probe: unknown) => decode(JSON.stringify({ v: 1, t: 'probe', probe }));
    expect(bad(undefined)).toHaveProperty('error');
    expect(bad({ areas: 'x', overlay: {} })).toHaveProperty('error');
    expect(bad({ areas: [{ area: 'rim', light: 'gelb', text: 'x', metrics: [] }], overlay: {} })).toHaveProperty('error');
    expect(bad({ areas: [{ area: 'rim', light: 'ok', text: 'x', metrics: [{ label: 1 }] }], overlay: {} })).toHaveProperty('error');
    expect(bad({ areas: [], overlay: [] })).toHaveProperty('error');
  });
});

describe.runIf(existsSync('videos/IMG_0977.MOV'))('Einrichtungsprüfung an echten Bildern (IMG_0977)', () => {
  it('richtiges Setup: keine Fehler; verschobene Rahmen: erwartete Fehler', async () => {
    const good = parseSetup(readFileSync('test/real/IMG_0977.json', 'utf8'), defaultRealSetup);
    const shifted: RealSetup = { ...good, rimX: good.rimX.map((v) => v + 150), refX: [good.crop[0], good.crop[0] + 40] };
    const crop = good.crop as [number, number, number, number];
    const badLights: string[] = [];
    let n = 0;
    let rimFail = 0;
    let refFail = 0;
    let i = 0;
    for await (const img of readVideoGray('videos/IMG_0977.MOV', crop)) {
      if (i++ < 280 || i % 25 !== 0) continue;
      n++;
      for (const a of probeSetup(img, good).areas) if (a.light === 'error') badLights.push(`${i} ${a.area}: ${a.text}`);
      const s = probeSetup(img, shifted);
      if (area(s, 'rim').light === 'error') rimFail++;
      if (area(s, 'ref').light !== 'ok') refFail++;
    }
    expect(n).toBeGreaterThan(40);
    expect(badLights).toEqual([]);
    expect(rimFail).toBe(n);
    expect(refFail).toBe(n);
  });
});
