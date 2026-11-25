import './style.css';
import { Analyzer, defaultSetup, describe, parseSetup, type FrameResult, type Setup } from '../core';
import { scenarioNames, type ScenarioName } from '../generator';
import { createRunoutChart } from './chart';
import type { Frame, FrameSource } from './frameSource';
import { GeneratorSource } from './generatorSource';
import { drawGray } from './gray';
import { recordTestVideo } from './recorder';
import { VideoFileSource } from './videoFileSource';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const FPS = 30;
const STORAGE_KEY = 'rimtrace.setup.v1';
const WARN_MS = 2500;
const RECORD_SECONDS = 15;

let source: FrameSource;
let setup: Setup;
let analyzer: Analyzer;
let imageData: ImageData;
let charts: { lat: ReturnType<typeof createRunoutChart>; h: ReturnType<typeof createRunoutChart> };
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

function buildCharts(): void {
  for (const id of ['chartLat', 'chartH']) $(id).innerHTML = '';
  charts = { lat: createRunoutChart($('chartLat'), setup.spokes, 'mm'), h: createRunoutChart($('chartH'), setup.spokes, 'mm') };
}
window.addEventListener('resize', () => {
  charts.lat.resize();
  charts.h.resize();
});

function resetMeasurement(): void {
  analyzer = new Analyzer(setup);
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

function useSource(next: FrameSource, label: string): void {
  source?.dispose?.();
  source = next;
  setup = next.setup ?? storedSetup();
  canvas.width = next.width;
  canvas.height = next.height;
  imageData = ctx.createImageData(next.width, next.height);
  ctx.clearRect(0, 0, next.width, next.height);
  setupText.value = JSON.stringify(setup, null, 2);
  setupText.readOnly = !isVideo();
  $('setupInfo').textContent = isVideo()
    ? 'Pixelbereiche der Videoaufnahme; Änderungen wirken sofort und werden im Browser gespeichert.'
    : 'Setup der synthetischen Quelle (nur lesbar). Für Videodateien ist es einstellbar.';
  $('setupMsg').textContent = '';
  $<HTMLSelectElement>('speed').disabled = isVideo();
  $('status').textContent = label;
  buildCharts();
  resetMeasurement();
  if (!running) source.setPaused?.(true);
  showProfile();
}

function useScenario(name: ScenarioName): void {
  scenarioSelect.value = name;
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

function showProfile(): void {
  const p = analyzer.profile();
  const gt = source.groundTruth?.();
  const centered = (a: number[]) => {
    const m = a.reduce((s, v) => s + v, 0) / a.length;
    return a.map((v) => v - m);
  };
  charts.lat.update(p.lateral, gt ? centered(gt.lateral) : []);
  charts.h.update(p.height, gt ? centered(gt.height) : []);

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

function loop(now: number): void {
  requestAnimationFrame(loop);
  const dt = Math.min(now - lastT, 100);
  lastT = now;
  $('warn').hidden = now > tooFastUntil;
  if (!running || busy) return;

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
    const result = analyzer.push(frame.image);
    frames++;
    if (result.tooFast) {
      tooFastCount++;
      tooFastUntil = now + WARN_MS;
    }
    last = { frame, result };
    got = true;
  }
  if (got && last) {
    render(last.frame, last.result);
    if (frames - lastProfileFrame >= 15) showProfile();
  }
  if (source.finished && !announcedEnd) {
    announcedEnd = true;
    showProfile();
    $('status').textContent += ' · Ende';
  }
}
let lastT = performance.now();

function applySetupText(): void {
  if (!isVideo()) return;
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
  if (setup.spokes !== charts.lat.spokes) buildCharts();
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
  setupText.value = JSON.stringify(defaultSetup, null, 2);
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
    useSource(await VideoFileSource.open(blob, truth), `Video · ${label}`);
  } catch (e) {
    $('status').textContent = (e as Error).message;
  }
}

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
