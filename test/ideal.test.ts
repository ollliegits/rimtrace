import { describe, expect, it } from 'vitest';
import { Analyzer, centered, recommend, spokeSide, type Action } from '../src/core';
import { createGenerator } from '../src/generator';

const REVOLUTIONS = 4;

const key = (a: Action) => `${a.axis}:${a.spoke}:${a.verb}`;
const fmt = (v: number, w = 7) => (Number.isFinite(v) ? v.toFixed(3).padStart(w) : 'n/a'.padStart(w));

describe('Szenario ideal: Generator → Auswertung → Ground Truth', () => {
  const gen = createGenerator('ideal');
  const s = gen.setup;
  const an = new Analyzer(s);

  const frames = Math.ceil((REVOLUTIONS * s.spokes) / gen.config.spokesPerSecond * gen.config.fps);
  let assigned = 0;
  let wrongSpoke = 0;
  let measured = 0;
  let maxPhiErr = 0;
  let maxScaleErr = 0;

  for (let i = 0; i < frames; i++) {
    const { image, truth } = gen.next();
    const r = an.push(image);
    if (!r.rim) continue;
    measured++;
    maxScaleErr = Math.max(maxScaleErr, Math.abs(r.rim.mmPerPx / s.mmPerPx - 1));
    if (r.phi !== undefined) {
      const d = r.phi - (truth.phi % s.spokes);
      maxPhiErr = Math.max(maxPhiErr, Math.abs(d - s.spokes * Math.round(d / s.spokes)));
    }
    if (r.spoke !== undefined) {
      assigned++;
      if (r.spoke !== truth.spoke) wrongSpoke++;
    }
  }

  const truthRaw = gen.truthAtSpokes();
  const gtLat = centered(truthRaw.lateral);
  const gtH = centered(truthRaw.height);
  const prof = an.profile();
  const errLat = prof.lateral.map((v, i) => Math.abs(v - gtLat[i]));
  const errH = prof.height.map((v, i) => Math.abs(v - gtH[i]));
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

  it('gibt die Fehlertabelle aus', () => {
    const lines = ['', ' Sp Seite |  GT lat  mess lat   Fehler |   GT Höhe mess Höhe   Fehler |  n'];
    for (let i = 0; i < s.spokes; i++) {
      lines.push(
        `${String(i).padStart(3)} ${spokeSide(s, i).padEnd(5)} | ${fmt(gtLat[i])} ${fmt(prof.lateral[i], 9)} ${fmt(errLat[i], 8)} | ${fmt(gtH[i], 8)} ${fmt(prof.height[i], 9)} ${fmt(errH[i], 8)} | ${prof.count[i]}`,
      );
    }
    lines.push(
      `Seitenschlag: mittlere Abweichung ${avg(errLat).toFixed(4)} mm, größte ${Math.max(...errLat).toFixed(4)} mm`,
      `Höhenschlag:  mittlere Abweichung ${avg(errH).toFixed(4)} mm, größte ${Math.max(...errH).toFixed(4)} mm`,
      `Bilder ${frames}, gemessen ${measured}, Speichen zugeordnet ${assigned}, falsch ${wrongSpoke}`,
      `max. Winkelfehler ${maxPhiErr.toFixed(4)} Speichen, max. Maßstabsfehler ${(maxScaleErr * 100).toFixed(4)} %`,
    );
    console.log(lines.join('\n'));
    expect(prof.count.every((n) => n > 0)).toBe(true);
  });

  it('mittlere Abweichung je Speichenposition < 0,05 mm (beide Achsen)', () => {
    expect(avg(errLat)).toBeLessThan(0.05);
    expect(avg(errH)).toBeLessThan(0.05);
  });

  it('ordnet alle Bilder der richtigen Speiche zu', () => {
    expect(measured).toBe(frames);
    expect(assigned).toBeGreaterThan(0);
    expect(wrongSpoke).toBe(0);
  });

  it('erkennt die 3 größten Abweichungen richtig', () => {
    const opts = { toleranceMm: 0, count: 3 };
    const expected = recommend({ lateral: gtLat, height: gtH, count: [] }, s, opts);
    const actual = an.actions(opts);
    console.log(
      'Top-3 Ground Truth:',
      expected.map((a) => `${key(a)} (${a.deviationMm.toFixed(2)})`).join(', '),
      '\nTop-3 gemessen:    ',
      actual.map((a) => `${key(a)} (${a.deviationMm.toFixed(2)})`).join(', '),
    );
    expect(actual.map(key).sort()).toEqual(expected.map(key).sort());
  });
});
