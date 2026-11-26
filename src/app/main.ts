import './style.css';
import {
  Analyzer,
  RealAnalyzer,
  defaultRealSetup,
  realSetupError,
  defaultSetup,
  describe,
  parseSetup,
  recommend,
  type FrameResult,
  type RealGeometry,
  type RealSetup,
  type Setup,
} from '../core';
import { scenarioNames, type ScenarioName } from '../generator';
import { createRunoutChart, type ChartSeries } from './chart';
import type { Frame, FrameSource } from './frameSource';
import { GeneratorSource } from './generatorSource';
import { drawGray } from './gray';
import { recordTestVideo } from './recorder';
import { VideoFileSource } from './videoFileSource';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const FPS = 30;
const STORAGE_KEY = 'rimtrace.setup.v1';
const REAL_STORAGE_KEY = 'rimtrace.realsetup.v1';
const REV_COLORS = ['#4cc2ff', '#6fe39a', '#ffd666', '#ff9f43', '#ff5cf0', '#b39ddb'];
const WARN_MS = 2500;
const RECORD_SECONDS = 15;

let source: FrameSource;
let setup: Setup;
let analyzer: Analyzer;
// Echte Aufnahmen: eigener Analysepfad (Pfad „real“); sonst der synthetische aus Stufe 1/2
let real = false;
let realSetup: RealSetup = defaultRealSetup;
// Pflichtangaben fehlen: es wird nicht ausgewertet
let realError: string | undefined;
let realAnalyzer = new RealAnalyzer(defaultRealSetup);
let lastReal: { frame: Frame; geometry?: RealGeometry } | null = null;
let realInfo: { holesPerRev: number[]; stickers: number[] } = { holesPerRev: [], stickers: [] };
let realSum = { lateral: 0, height: 0, n: 0, failed: 0 };
let current: { blob: Blob; label: string; truth?: { lateral: number[]; height: number[] } } | null = null;
let imageData: ImageData;
type Chart = ReturnType<typeof createRunoutChart>;
let charts: { lat: Chart; h: Chart };
let truthMean = { lateral: 0, height: 0 };

let running = true;
let busy = false;
let frames = 0;
let tooFastCount = 0;
let tooFastUntil = 0;
let pace = 0;
let lastProfileFrame = 0;
let announcedEnd = false;
let last: { frame: Frame; result: FrameResult } | null = null;

const canvas = $<HTMLCanvasElement>('view');
const ctx = canvas.getContext('2d')!;
const setupText = $<HTMLTextAreaElement>('setupText');
const scenarioSelect = $<HTMLSelectElement>('scenario');
const pathSelect = $<HTMLSelectElement>('path');

scenarioSelect.innerHTML = scenarioNames.map((n) => `<option value="${n}">${n}</option>`).join('');

const isVideo = () => !!source && source.live === true;

function storedSetup(): Setup {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    return text ? parseSetup(text) : defaultSetup;
  } catch {
    return defaultSetup;
  }
}

function storedRealSetup(): RealSetup {
  try {
    const text = localStorage.getItem(REAL_STORAGE_KEY);
    return text ? parseSetup(text, defaultRealSetup) : defaultRealSetup;
  } catch {
    return defaultRealSetup;
  }
}

const synSeries: ChartSeries[] = [
  { label: 'Messwert', stroke: '#4cc2ff' },
  { label: 'Ground Truth', stroke: '#9aa4b2', dash: [6, 4], points: false },
];

function buildCharts(spokes: number, series: ChartSeries[]): void {
  for (const id of ['chartLat', 'chartH']) $(id).innerHTML = '';
  charts = {
    lat: createRunoutChart($('chartLat'), spokes, 'mm', series),
    h: createRunoutChart($('chartH'), spokes, 'mm', series),
  };
}
window.addEventListener('resize', () => {
  charts.lat.resize();
  charts.h.resize();
});

function resetMeasurement(): void {
  analyzer = new Analyzer(setup);
  realAnalyzer = new RealAnalyzer(realSetup);
  lastReal = null;
  realSum = { lateral: 0, height: 0, n: 0, failed: 0 };
  realInfo = { holesPerRev: [], stickers: [] };
  frames = 0;
  tooFastCount = 0;
  tooFastUntil = 0;
  lastProfileFrame = 0;
  announcedEnd = false;
  last = null;
  const gt = source.groundTruth?.();
  const m = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  truthMean = gt ? { lateral: m(gt.lateral), height: m(gt.height) } : { lateral: 0, height: 0 };
}

function showSetupMsg(text: string, error: boolean): void {
  $('setupMsg').textContent = text;
  $('setupMsg').className = error ? 'error' : 'muted';
}

function sizeCanvas(): void {
  canvas.width = source.width;
  canvas.height = source.height;
  canvas.classList.toggle('tall', real);
  imageData = ctx.createImageData(source.width, source.height);
  ctx.clearRect(0, 0, source.width, source.height);
}

function useSource(next: FrameSource, label: string, realPath = false): void {
  source?.dispose?.();
  source = next;
  real = realPath && next instanceof VideoFileSource;
  setup = next.setup ?? storedSetup();
  if (real) {
    realSetup = storedRealSetup();
    (next as VideoFileSource).setCrop(realSetup.crop);
    realError = realSetupError(realSetup);
  } else realError = undefined;
  sizeCanvas();
  setupText.value = JSON.stringify(real ? realSetup : setup, null, 2);
  setupText.readOnly = !isVideo();
  $('setupInfo').textContent = real
    ? 'Echte Aufnahme: alle Koordinaten in Pixeln des Videobilds, ausgewertet wird nur der Ausschnitt „crop“. Änderungen wirken sofort und werden im Browser gespeichert.'
    : isVideo()
      ? 'Pixelbereiche der Videoaufnahme; Änderungen wirken sofort und werden im Browser gespeichert.'
      : 'Setup der synthetischen Quelle (nur lesbar). Für Videodateien ist es einstellbar.';
  showSetupMsg(realError ? realError : '', !!realError);
  $<HTMLSelectElement>('speed').disabled = isVideo();
  $('status').textContent = label;
  buildCharts(real ? realSetup.spokes : setup.spokes, real ? revSeries(0) : synSeries);
  resetMeasurement();
  if (!running) source.setPaused?.(true);
  showProfile();
}

function useScenario(name: ScenarioName): void {
  scenarioSelect.value = name;
  current = null;
  useSource(new GeneratorSource(name), `Synthetisch · ${name}`);
}

function drawFrame({ image }: Frame, r: FrameResult): void {
  drawGray(ctx, image, imageData);

  const w = canvas.width;
  const line = (x0: number, y0: number, x1: number, y1: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  };
  ctx.lineWidth = 2;

  // Messbereiche
  ctx.strokeStyle = 'rgba(76,194,255,0.8)';
  ctx.strokeRect(0, setup.markScanRows[0], w, setup.markScanRows[1] - setup.markScanRows[0]);
  ctx.strokeStyle = 'rgba(255,214,102,0.6)';
  ctx.strokeRect(0, setup.flankRows[0], w, setup.flankRows[1] - setup.flankRows[0]);
  line(setup.xRead, 0, setup.xRead, setup.markRows[1] + 6, '#ff5cf0');
  line(0, setup.columnScanStart, w, setup.columnScanStart, 'rgba(154,164,178,0.5)');
  line(setup.refX, setup.refY, setup.refX, setup.flankRows[1], 'rgba(255,159,67,0.4)');
  line(0, setup.refY, w, setup.refY, 'rgba(255,159,67,0.4)');

  for (const m of r.marks) {
    line(m.x, setup.markRows[0] - 6, m.x, setup.markRows[0], m.double ? '#ff5c5c' : '#ffd666');
  }

  if (r.rim) {
    const p = r.rim.px;
    const [a, b] = setup.flankRows;
    line(p.refX, a, p.refX, b, '#ff9f43');
    line(p.left, a, p.left, b, '#6fe39a');
    line(p.right, a, p.right, b, '#6fe39a');
    line(0, p.refY, w, p.refY, '#ff9f43');
    const hw = setup.hornWidthMm / r.rim.mmPerPx;
    line(p.left, p.topLeft, p.left + hw, p.topLeft, '#6fe39a');
    line(p.right - hw, p.topRight, p.right, p.topRight, '#6fe39a');
  }
}

function drawReal({ image }: Frame, g?: RealGeometry): void {
  drawGray(ctx, image, imageData);
  if (!g) return;
  const [ox, oy] = realSetup.crop;
  const line = (x0: number, y0: number, x1: number, y1: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(x0 - ox, y0 - oy);
    ctx.lineTo(x1 - ox, y1 - oy);
    ctx.stroke();
  };
  const box = (x: number, y: number, w: number, h: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.strokeRect(x - ox, y - oy, w, h);
  };
  ctx.lineWidth = 1;
  const { rimX, rimY, refX, refY } = realSetup;
  box(rimX[0], rimY[0], rimX[1] - rimX[0], rimY[1] - rimY[0], 'rgba(76,194,255,0.5)');
  box(refX[0], refY[0], refX[1] - refX[0], refY[1] - refY[0], 'rgba(255,159,67,0.5)');
  const [a, b] = g.flankRows;
  line(g.left, a, g.left, b, '#6fe39a');
  line(g.right, a, g.right, b, '#6fe39a');
  const half = (realSetup.tipColumns[1] - realSetup.tipColumns[0]) / 2;
  line(g.tipLeft[0] - half, g.tipLeft[1], g.tipLeft[0] + half, g.tipLeft[1], '#ffd666');
  line(g.tipRight[0] - half, g.tipRight[1], g.tipRight[0] + half, g.tipRight[1], '#ffd666');
  line(g.ref[0], g.refRows[0], g.ref[0], g.refRows[1], '#ff9f43');
  line(g.ref[0] - 10, g.ref[1], g.ref[0] + 10, g.ref[1], '#ff9f43');
  box(g.holeWindow[0], g.holeWindow[1], g.holeWindow[2], g.holeWindow[2], '#ff5cf0');
}

function showRealValues(): void {
  const m = lastReal && realAnalyzer.measures[realAnalyzer.measures.length - 1];
  const scale = realAnalyzer.scale();
  const n = realSum.n || 1;
  const lat = m?.ok ? (m.lateralPx - realSum.lateral / n) * scale : undefined;
  const hgt = m?.ok ? (m.heightPx - realSum.height / n) * scale : undefined;
  const { holesPerRev, stickers } = realInfo;
  $('values').innerHTML = `
    <h2>Live-Werte (relativ zum Mittelwert, mm)</h2>
    <table>
      <tr><th></th><th>gemessen</th></tr>
      <tr><td>Seitenschlag</td><td>${signed(lat)}</td></tr>
      <tr><td>Höhenschlag</td><td>${signed(hgt)}</td></tr>
    </table>
    <p class="muted">Maßstab ${Number.isFinite(scale) ? (scale * 1000).toFixed(1) : '–'} µm/px · Bild ${frames} ·
      nicht auswertbar ${realSum.failed} · Aufkleber ${stickers.length} · Löcher je Umdrehung ${holesPerRev.join(' / ') || '–'}</p>`;
}

const signed = (v: number | undefined) => (v !== undefined && Number.isFinite(v) ? (v > 0 ? '+' : '') + v.toFixed(2) : '–');

function showValues({ truth }: Frame, r: FrameResult): void {
  const means = analyzer.means();
  const lat = r.rim ? r.rim.lateralMm - means.lateral : undefined;
  const hgt = r.rim ? r.rim.heightMm - means.height : undefined;
  const gtLat = truth ? truth.lateralMm - truthMean.lateral : undefined;
  const gtH = truth ? truth.heightMm - truthMean.height : undefined;
  const diff = (a?: number, b?: number) => (a === undefined || b === undefined ? undefined : a - b);
  const position = r.tooFast
    ? 'zu schnell, Position verloren'
    : r.phi === undefined
      ? 'wartet auf Doppelmarke'
      : r.phi.toFixed(2) + ' Speichen';

  $('values').innerHTML = `
    <h2>Live-Werte (zentriert, mm)</h2>
    <table>
      <tr><th></th><th>gemessen</th><th>Ground Truth</th><th>Differenz</th></tr>
      <tr><td>Seitenschlag</td><td>${signed(lat)}</td><td>${signed(gtLat)}</td><td>${signed(diff(lat, gtLat))}</td></tr>
      <tr><td>Höhenschlag</td><td>${signed(hgt)}</td><td>${signed(gtH)}</td><td>${signed(diff(hgt, gtH))}</td></tr>
    </table>
    <p class="muted">Maßstab ${r.rim ? (r.rim.mmPerPx * 1000).toFixed(1) : '–'} µm/px ·
      Position ${position} · Bild ${frames} · verworfen (zu schnell) ${tooFastCount}</p>`;
}

function revSeries(revs: number): ChartSeries[] {
  const per = Array.from({ length: revs }, (_, i) => ({ label: `Umdrehung ${i}`, stroke: REV_COLORS[i % REV_COLORS.length] }));
  return [...per, { label: 'Median alle', stroke: '#ffffff', dash: [6, 4] }];
}

function showRealProfile(): void {
  const p = realAnalyzer.profile();
  realInfo = { holesPerRev: p.holesPerRev, stickers: p.stickers };
  const spokes = realSetup.spokes;
  if (charts.lat.count !== p.revolutions.length + 1 || charts.lat.spokes !== spokes) {
    buildCharts(spokes, revSeries(p.revolutions.length));
  }
  charts.lat.update([...p.revolutions.map((r) => r.lateral), p.all.lateral]);
  charts.h.update([...p.revolutions.map((r) => r.height), p.all.height]);
  const actions = recommend(p.all, realSetup);
  $('actions').innerHTML = actions.length
    ? actions.map((a) => `<li class="${a.verb}"><b>${describe(a)}</b></li>`).join('')
    : '<li class="muted">noch keine Daten bzw. alles innerhalb der Toleranz</li>';
  lastProfileFrame = frames;
}

function showProfile(): void {
  if (real) return showRealProfile();
  const p = analyzer.profile();
  const gt = source.groundTruth?.();
  const centered = (a: number[]) => {
    const m = a.reduce((s, v) => s + v, 0) / a.length;
    return a.map((v) => v - m);
  };
  charts.lat.update([p.lateral, gt ? centered(gt.lateral) : []]);
  charts.h.update([p.height, gt ? centered(gt.height) : []]);

  const actions = analyzer.actions();
  $('actions').innerHTML = actions.length
    ? actions.map((a) => `<li class="${a.verb}"><b>${describe(a)}</b></li>`).join('')
    : '<li class="muted">noch keine Daten bzw. alles innerhalb der Toleranz</li>';
  lastProfileFrame = frames;
}

function render(frame: Frame, result: FrameResult): void {
  drawFrame(frame, result);
  showValues(frame, result);
}

function renderReal(): void {
  if (!lastReal) return;
  drawReal(lastReal.frame, lastReal.geometry);
  showRealValues();
}

function pushReal(frame: Frame): void {
  const { measure, geometry } = realAnalyzer.push(frame.image);
  if (measure.ok) {
    realSum.lateral += measure.lateralPx;
    realSum.height += measure.heightPx;
    realSum.n++;
  } else realSum.failed++;
  lastReal = { frame, geometry };
}

function loop(now: number): void {
  requestAnimationFrame(loop);
  const dt = Math.min(now - lastT, 100);
  lastT = now;
  $('warn').hidden = now > tooFastUntil;
  if (!running || busy || (real && realError)) return;

  let steps = 16;
  if (!source.live) {
    pace += (dt * FPS * Number($<HTMLSelectElement>('speed').value)) / 1000;
    steps = Math.min(Math.floor(pace), 32);
    pace -= Math.floor(pace);
  }
  let got = false;
  for (let i = 0; i < steps; i++) {
    const frame = source.read();
    if (!frame) break;
    frames++;
    got = true;
    if (real) {
      pushReal(frame);
      continue;
    }
    const result = analyzer.push(frame.image);
    if (result.tooFast) {
      tooFastCount++;
      tooFastUntil = now + WARN_MS;
    }
    last = { frame, result };
  }
  if (got) {
    if (real) renderReal();
    else if (last) render(last.frame, last.result);
    if (frames - lastProfileFrame >= 15) showProfile();
  }
  if (source.finished && !announcedEnd) {
    announcedEnd = true;
    showProfile();
    $('status').textContent += ' · Ende';
  }
}
let lastT = performance.now();

function applyRealSetupText(): void {
  const video = source as VideoFileSource;
  let next: RealSetup;
  try {
    next = parseSetup(setupText.value, defaultRealSetup);
    const [x, y, w, h] = next.crop;
    if (x < 0 || y < 0 || w < 1 || h < 1 || x + w > video.videoWidth || y + h > video.videoHeight) {
      throw new Error(`crop liegt nicht im Videobild (${video.videoWidth}×${video.videoHeight})`);
    }
    localStorage.setItem(REAL_STORAGE_KEY, JSON.stringify(next));
  } catch (e) {
    showSetupMsg((e as Error).message, true);
    return;
  }
  realError = realSetupError(next);
  showSetupMsg(realError ?? 'übernommen', !!realError);
  const cropChanged = next.crop.join() !== realSetup.crop.join();
  const frame = lastReal?.frame;
  realSetup = next;
  resetMeasurement();
  frames = 0;
  buildCharts(realSetup.spokes, revSeries(0));
  if (cropChanged) {
    video.setCrop(realSetup.crop);
    sizeCanvas();
    video.restart();
  } else if (frame && !realError) {
    frames = 1;
    pushReal(frame);
    renderReal();
  }
  showProfile();
}

function applySetupText(): void {
  if (!isVideo()) return;
  if (real) return applyRealSetupText();
  try {
    setup = parseSetup(setupText.value);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(setup));
    $('setupMsg').textContent = 'übernommen';
    $('setupMsg').className = 'muted';
  } catch (e) {
    $('setupMsg').textContent = (e as Error).message;
    $('setupMsg').className = 'error';
    return;
  }
  const frame = last?.frame;
  if (setup.spokes !== charts.lat.spokes) buildCharts(setup.spokes, synSeries);
  analyzer = new Analyzer(setup);
  frames = 0;
  tooFastCount = 0;
  last = null;
  if (frame) {
    const result = analyzer.push(frame.image);
    last = { frame, result };
    render(frame, result);
  }
}
setupText.addEventListener('input', applySetupText);
$('setupDefault').addEventListener('click', () => {
  if (!isVideo()) return;
  setupText.value = JSON.stringify(real ? { ...defaultRealSetup, rimWidthMm: realSetup.rimWidthMm } : defaultSetup, null, 2);
  applySetupText();
});

$('toggle').addEventListener('click', () => {
  running = !running;
  source.setPaused?.(!running);
  $('toggle').textContent = running ? 'Pause' : 'Weiter';
});
$('reset').addEventListener('click', () => {
  source.restart?.();
  resetMeasurement();
  showProfile();
});
scenarioSelect.addEventListener('change', () => useScenario(scenarioSelect.value as ScenarioName));

async function openVideo(blob: Blob, label: string, truth?: { lateral: number[]; height: number[] }): Promise<void> {
  try {
    current = { blob, label, truth };
    useSource(await VideoFileSource.open(blob, truth), `Video · ${label}`, pathSelect.value === 'real');
  } catch (e) {
    $('status').textContent = (e as Error).message;
  }
}

pathSelect.addEventListener('change', () => {
  if (isVideo() && current) void openVideo(current.blob, current.label, current.truth);
});

$<HTMLInputElement>('file').addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) void openVideo(file, file.name);
});

$('record').addEventListener('click', async () => {
  busy = true;
  const buttons = document.querySelectorAll<HTMLButtonElement>('header button, header select, header input');
  buttons.forEach((b) => (b.disabled = true));
  const scenario = scenarioSelect.value as ScenarioName;
  try {
    const { blob, truth } = await recordTestVideo(scenario, RECORD_SECONDS, (i, n) => {
      $('status').textContent = `Nehme Testvideo „${scenario}“ auf … ${i}/${n}`;
    });
    const link = $<HTMLAnchorElement>('download');
    link.href = URL.createObjectURL(blob);
    link.download = `rimtrace-${scenario}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`;
    link.hidden = false;
    busy = false;
    pathSelect.value = 'synthetic';
    await openVideo(blob, `Testvideo ${scenario}`, truth);
  } catch (e) {
    $('status').textContent = (e as Error).message;
  } finally {
    busy = false;
    buttons.forEach((b) => (b.disabled = false));
    $<HTMLSelectElement>('speed').disabled = isVideo();
  }
});

useScenario('ideal');
requestAnimationFrame(loop);
