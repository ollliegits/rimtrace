import './style.css';
import { Analyzer, defaultSetup, describe, type FrameResult } from '../core';
import { createRunoutChart } from './chart';
import type { Frame, FrameSource } from './frameSource';
import { GeneratorSource } from './generatorSource';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const source: FrameSource = new GeneratorSource('ideal');
const setup = defaultSetup;
const analyzer = new Analyzer(setup);

const canvas = $<HTMLCanvasElement>('view');
canvas.width = source.width;
canvas.height = source.height;
const ctx = canvas.getContext('2d')!;
const imageData = ctx.createImageData(source.width, source.height);

const chartLat = createRunoutChart($('chartLat'), setup.spokes, 'mm');
const chartH = createRunoutChart($('chartH'), setup.spokes, 'mm');
window.addEventListener('resize', () => {
  chartLat.resize();
  chartH.resize();
});

let running = true;
let frames = 0;
let truthMean = { lateral: 0, height: 0 };
const refreshTruthMean = () => {
  const gt = source.groundTruth?.();
  if (!gt) return;
  const m = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  truthMean = { lateral: m(gt.lateral), height: m(gt.height) };
};
refreshTruthMean();

function drawFrame({ image }: Frame, r: FrameResult): void {
  const px = imageData.data;
  const g = image.data;
  for (let i = 0, j = 0; i < g.length; i++, j += 4) {
    px[j] = px[j + 1] = px[j + 2] = g[i];
    px[j + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);

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

  $('values').innerHTML = `
    <h2>Live-Werte (zentriert, mm)</h2>
    <table>
      <tr><th></th><th>gemessen</th><th>Ground Truth</th><th>Differenz</th></tr>
      <tr><td>Seitenschlag</td><td>${signed(lat)}</td><td>${signed(gtLat)}</td><td>${signed(diff(lat, gtLat))}</td></tr>
      <tr><td>Höhenschlag</td><td>${signed(hgt)}</td><td>${signed(gtH)}</td><td>${signed(diff(hgt, gtH))}</td></tr>
    </table>
    <p class="muted">Maßstab ${r.rim ? (r.rim.mmPerPx * 1000).toFixed(1) : '–'} µm/px ·
      Position ${r.phi === undefined ? 'wartet auf Doppelmarke' : r.phi.toFixed(2) + ' Speichen'} ·
      Bild ${frames}</p>`;
}

function showProfile(): void {
  const p = analyzer.profile();
  const gt = source.groundTruth?.();
  const centered = (a: number[]) => {
    const m = a.reduce((s, v) => s + v, 0) / a.length;
    return a.map((v) => v - m);
  };
  chartLat.update(p.lateral, gt ? centered(gt.lateral) : []);
  chartH.update(p.height, gt ? centered(gt.height) : []);

  const actions = analyzer.actions();
  $('actions').innerHTML = actions.length
    ? actions.map((a) => `<li class="${a.verb}"><b>${describe(a)}</b></li>`).join('')
    : '<li class="muted">noch keine Daten bzw. alles innerhalb der Toleranz</li>';
}

function tick(): void {
  if (!running) return;
  const steps = Number($<HTMLSelectElement>('speed').value);
  let frame: Frame | null = null;
  let result: FrameResult | null = null;
  for (let i = 0; i < steps; i++) {
    frame = source.read();
    if (!frame) return;
    result = analyzer.push(frame.image);
    frames++;
  }
  if (!frame || !result) return;
  drawFrame(frame, result);
  showValues(frame, result);
  if (frames % 15 < steps) showProfile();
}

$('toggle').addEventListener('click', () => {
  running = !running;
  $('toggle').textContent = running ? 'Pause' : 'Weiter';
});
$('reset').addEventListener('click', () => {
  source.restart?.();
  analyzer.reset();
  refreshTruthMean();
  frames = 0;
  showProfile();
});

showProfile();
setInterval(tick, 1000 / 30);
