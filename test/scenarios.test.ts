import { beforeAll, describe, expect, it } from 'vitest';
import { Analyzer, centered, recommend, spokeSide, type Action } from '../src/core';
import { createGenerator, scenarioNames, type ScenarioName } from '../src/generator';

const REVOLUTIONS = 4;
const MAX_FRAMES = 6000;

interface Accept {
  meanMm?: number;
  maxMm?: number;
  /** Höchstens 0,5 % Abweichung des ermittelten vom wahren Maßstab. */
  scale?: boolean;
  top3?: boolean;
  /** `none`: kein Bild darf als zu schnell gelten; `required`: jede zu schnelle Phase muss erkannt werden. */
  tooFast?: 'none' | 'required';
}

const accept: Record<ScenarioName, Accept> = {
  ideal: { meanMm: 0.05, scale: true, top3: true, tooFast: 'none' },
  kamera: { meanMm: 0.05, maxMm: 0.2, scale: true, top3: true, tooFast: 'none' },
  handdrehung: { meanMm: 0.1, maxMm: 0.2, top3: true, tooFast: 'none' },
  'zu-schnell': { tooFast: 'required' },
};

const key = (a: Action) => `${a.axis}:${a.spoke}:${a.verb}`;
const fmt = (v: number, w = 7) => (Number.isFinite(v) ? v.toFixed(3).padStart(w) : 'n/a'.padStart(w));
const finite = (a: number[]) => a.filter(Number.isFinite);
const avg = (a: number[]) => finite(a).reduce((x, y) => x + y, 0) / finite(a).length;
const max = (a: number[]) => Math.max(...finite(a));

function run(name: ScenarioName) {
  const gen = createGenerator(name);
  const s = gen.setup;
  const an = new Analyzer(s);
  const target = gen.config.phi0 + REVOLUTIONS * s.spokes;

  let frames = 0;
  let assigned = 0;
  let wrong = 0;
  let flagged = 0;
  let maxPhiErr = 0;
  let maxScaleErr = 0;
  let prevPhi: number | undefined;
  // Pro Bild: wirklich zu schnell (> ½ Speiche seit dem letzten Bild) bzw. von der Auswertung gemeldet
  const trulyFast: boolean[] = [];
  const reported: boolean[] = [];

  for (; frames < MAX_FRAMES; frames++) {
    const { image, truth } = gen.next();
    if (truth.phi >= target) break;
    trulyFast.push(prevPhi !== undefined && Math.abs(truth.phi - prevPhi) > 0.5);
    prevPhi = truth.phi;

    const r = an.push(image);
    reported.push(!!r.tooFast);
    if (r.tooFast) flagged++;
    if (!r.rim) continue;
    maxScaleErr = Math.max(maxScaleErr, Math.abs(r.rim.mmPerPx / gen.config.mmPerPx - 1));
    if (r.phi !== undefined) {
      const d = r.phi - (truth.phi % s.spokes);
      maxPhiErr = Math.max(maxPhiErr, Math.abs(d - s.spokes * Math.round(d / s.spokes)));
    }
    if (r.spoke !== undefined) {
      assigned++;
      if (r.spoke !== truth.spoke) wrong++;
    }
  }
  if (frames === MAX_FRAMES) throw new Error('Testlauf erreicht das Ziel nicht');

  // Jede zusammenhängende zu schnelle Phase braucht eine Meldung, spätestens an ihrem Ende, frühestens 10 Bilder davor
  let missedRuns = 0;
  let runs = 0;
  for (let i = 0; i < trulyFast.length; i++) {
    if (!trulyFast[i]) continue;
    let j = i;
    while (trulyFast[j + 1]) j++;
    runs++;
    if (!reported.slice(Math.max(0, i - 10), j + 1).some(Boolean)) missedRuns++;
    i = j;
  }

  const truthRaw = gen.truthAtSpokes();
  const gtLat = centered(truthRaw.lateral);
  const gtH = centered(truthRaw.height);
  const prof = an.profile();
  const errLat = prof.lateral.map((v, i) => Math.abs(v - gtLat[i]));
  const errH = prof.height.map((v, i) => Math.abs(v - gtH[i]));
  return { gen, s, an, frames, assigned, wrong, flagged, runs, missedRuns, maxPhiErr, maxScaleErr, gtLat, gtH, prof, errLat, errH };
}

type Result = ReturnType<typeof run>;

function table(name: string, r: Result): string {
  const { s, prof, gtLat, gtH, errLat, errH } = r;
  const lines = [``, `=== ${name} ===`, ' Sp Seite |  GT lat  mess lat   Fehler |   GT Höhe mess Höhe   Fehler |  n'];
  for (let i = 0; i < s.spokes; i++) {
    lines.push(
      `${String(i).padStart(3)} ${spokeSide(s, i).padEnd(5)} | ${fmt(gtLat[i])} ${fmt(prof.lateral[i], 9)} ${fmt(errLat[i], 8)} | ${fmt(gtH[i], 8)} ${fmt(prof.height[i], 9)} ${fmt(errH[i], 8)} | ${prof.count[i]}`,
    );
  }
  lines.push(
    `Seitenschlag: mittlere Abweichung ${avg(errLat).toFixed(4)} mm, größte ${max(errLat).toFixed(4)} mm`,
    `Höhenschlag:  mittlere Abweichung ${avg(errH).toFixed(4)} mm, größte ${max(errH).toFixed(4)} mm`,
    `Bilder ${r.frames}, Speichen zugeordnet ${r.assigned}, falsch ${r.wrong}, als zu schnell gemeldet ${r.flagged}` +
      ` (zu schnelle Phasen ${r.runs}, unerkannt ${r.missedRuns})`,
    `max. Winkelfehler ${r.maxPhiErr.toFixed(4)} Speichen, max. Maßstabsfehler ${(r.maxScaleErr * 100).toFixed(3)} % (wahr ${r.gen.config.mmPerPx} mm/px)`,
  );
  return lines.join('\n');
}

describe.each(scenarioNames)('Szenario %s: Generator → Auswertung → Ground Truth', (name) => {
  const acc = accept[name];
  let r: Result;

  beforeAll(() => {
    r = run(name);
    console.log(table(name, r));
  }, 300_000);

  it('hat keine falsche Speichenzuordnung', () => {
    expect(r.assigned).toBeGreaterThan(0);
    expect(r.wrong).toBe(0);
  });

  it.runIf(acc.meanMm !== undefined)('mittlere Abweichung je Speichenposition (beide Achsen)', () => {
    expect(r.prof.count.every((n) => n > 0)).toBe(true);
    expect(avg(r.errLat)).toBeLessThan(acc.meanMm!);
    expect(avg(r.errH)).toBeLessThan(acc.meanMm!);
  });

  it.runIf(acc.maxMm !== undefined)('größte Abweichung', () => {
    expect(max(r.errLat)).toBeLessThan(acc.maxMm!);
    expect(max(r.errH)).toBeLessThan(acc.maxMm!);
  });

  it.runIf(acc.top3)('erkennt die 3 größten Abweichungen richtig', () => {
    const opts = { toleranceMm: 0, count: 3 };
    const expected = recommend({ lateral: r.gtLat, height: r.gtH, count: [] }, r.s, opts);
    const actual = r.an.actions(opts);
    console.log(
      `${name} Top-3 Ground Truth:`,
      expected.map((a) => `${key(a)} (${a.deviationMm.toFixed(2)})`).join(', '),
      '\n' + `${name} Top-3 gemessen:    `,
      actual.map((a) => `${key(a)} (${a.deviationMm.toFixed(2)})`).join(', '),
    );
    expect(actual.map(key).sort()).toEqual(expected.map(key).sort());
  });

  it.runIf(acc.scale)('ermittelter Maßstab weicht höchstens 0,5 % vom wahren ab', () => {
    expect(r.maxScaleErr).toBeLessThan(0.005);
  });

  it.runIf(acc.tooFast === 'none')('meldet keine zu schnelle Drehung', () => {
    expect(r.flagged).toBe(0);
  });

  it.runIf(acc.tooFast === 'required')('meldet jede zu schnelle Drehphase', () => {
    expect(r.runs).toBeGreaterThan(0);
    expect(r.missedRuns).toBe(0);
    expect(r.flagged).toBeGreaterThan(0);
  });
});
