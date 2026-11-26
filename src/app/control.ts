import './style.css';
import {
  centered,
  defaultRealSetup,
  describe,
  parseSetup,
  realSetupError,
  recommend,
  reviveNaN,
  sideName,
  SnapshotAssembler,
  spokeSides,
  type CameraStatus,
  type Message,
  type RealResult,
  type RealSetup,
  type SessionStatus,
} from '../core';
import { createRunoutChart, type ChartSeries } from './chart';
import { Link, type LinkState } from './rtc/link';
import { drawQr, scanQr } from './rtc/qr';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const CONFIG_KEY = 'rimtrace.control.v1';
const RESULT_KEY = 'rimtrace.result.v1';
const COLORS = ['#4cc2ff', '#ff9f4c', '#6fe39a', '#d58cff', '#ffe066'];
const statusTimeoutMs = 4000;

const formKeys = ['spokes', 'rimWidthMm', 'marker', 'spoke1Side', 'driveImageSide', 'travel', 'rotate', 'mirror', 'toleranceLateralMm', 'toleranceHeightMm'] as const;
type FormKey = (typeof formKeys)[number];

let link: Link | undefined;
let setup: RealSetup | undefined;
let camera: CameraStatus | undefined;
let session: SessionStatus | undefined;
let lastStatusAt = 0;
let stopScan: (() => void) | undefined;
let webcam: MediaStream | undefined;
let pair = '';
let chartKey = '';
let charts: { lat: ReturnType<typeof createRunoutChart>; h: ReturnType<typeof createRunoutChart> } | undefined;
let snapshotImage: HTMLImageElement | undefined;
let snapshotScale = 1;
let snapshotBlobUrl = '';
const assembler = new SnapshotAssembler();

function warn(text: string): void {
  $('warn').textContent = text;
  $('warn').hidden = !text;
}

// Konfiguration: Formular (häufige Felder) und JSON (alle übrigen Bereiche).
function readForm(): Partial<RealSetup> {
  const out: Record<string, unknown> = {};
  for (const k of formKeys) {
    const el = $<HTMLInputElement>(k);
    out[k] = el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' && k === 'rotate' ? Number(el.value) : el.type === 'number' ? Number(el.value) : el.value;
  }
  return out as Partial<RealSetup>;
}

function writeForm(s: RealSetup): void {
  for (const k of formKeys) {
    const el = $<HTMLInputElement>(k);
    const v = s[k as FormKey];
    if (el.type === 'checkbox') el.checked = Boolean(v);
    else el.value = k === 'rimWidthMm' && !(s.rimWidthMm > 0) ? '' : String(v);
  }
  const areas: Record<string, unknown> = { ...s };
  for (const k of formKeys) delete areas[k];
  $<HTMLTextAreaElement>('areas').value = JSON.stringify(areas, null, 1);
  markRequired();
}

function markRequired(): void {
  $('rimWidthMm').classList.toggle('req', !(Number($<HTMLInputElement>('rimWidthMm').value) > 0));
}

function loadConfig(): void {
  let s = defaultRealSetup;
  try {
    const saved = localStorage.getItem(CONFIG_KEY);
    if (saved) s = parseSetup(saved, defaultRealSetup);
  } catch {
    // gespeicherte Konfiguration unbrauchbar: Standardwerte
  }
  writeForm(s);
}

function currentSetup(): RealSetup | string {
  try {
    const s = parseSetup(JSON.stringify({ ...JSON.parse($<HTMLTextAreaElement>('areas').value), ...readForm() }), defaultRealSetup);
    return realSetupError(s) ?? s;
  } catch (e) {
    return `Bereiche (JSON) ungültig: ${(e as Error).message}`;
  }
}

function applyConfig(): boolean {
  const s = currentSetup();
  const msg = $('cfgMsg');
  if (typeof s === 'string') {
    msg.className = 'error';
    msg.textContent = s;
    return false;
  }
  setup = s;
  localStorage.setItem(CONFIG_KEY, JSON.stringify(s));
  msg.className = 'muted';
  msg.textContent = link?.state === 'verbunden' ? 'gesendet' : 'gespeichert (wird nach der Kopplung gesendet)';
  link?.send({ t: 'config', setup: s });
  drawSnapshot();
  return true;
}

// Kopplung
function setLinkState(state: LinkState, detail: string): void {
  $('link').textContent = state === 'getrennt' || state === 'fehler' ? `${state}${detail ? ' – ' + detail : ''}` : state;
  $('relink').hidden = !(state === 'getrennt' || state === 'fehler' || state === 'verbunden');
  if (state === 'verbunden') {
    stopScan?.();
    warn('');
    $('pairMsg').textContent = 'verbunden';
    lastStatusAt = Date.now();
    link?.send({ t: 'hello', role: 'control' });
    if (setup ?? applyConfigSilently()) link?.send({ t: 'config', setup: setup! });
    void link?.candidatePair().then((p) => (pair = p));
  } else if (state === 'getrennt' || state === 'fehler') {
    warn(`Verbindung zum Handy ${state === 'fehler' ? 'fehlgeschlagen' : 'getrennt'}${detail ? ': ' + detail : ''}. Konfiguration und Ergebnis bleiben erhalten; „Neu koppeln“ wählen.`);
  }
}

function applyConfigSilently(): boolean {
  const s = currentSetup();
  if (typeof s === 'string') return false;
  setup = s;
  return true;
}

async function openWebcam(): Promise<void> {
  if (webcam?.active) return;
  try {
    const open = navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 } } });
    // Bleibt die Freigabeabfrage unbeantwortet, nicht ewig warten: der Antwort-Code kann auch eingefügt werden.
    webcam = await Promise.race([open, new Promise<never>((_, no) => setTimeout(() => no(new Error('keine Reaktion auf die Freigabeabfrage')), 10000))]);
    const v = $<HTMLVideoElement>('cam');
    v.srcObject = webcam;
    await v.play();
  } catch (e) {
    $('pairMsg').textContent = `Webcam nicht verfügbar (${(e as Error).message}); Antwort-Code bitte einfügen.`;
  }
}

function newLink(): Link {
  link?.close();
  const l = new Link();
  l.onMessage = onMessage;
  l.onState = setLinkState;
  l.onProblem = (t) => warn(`Ungültige Nachricht vom Handy: ${t}`);
  link = l;
  return l;
}

async function startPairing(): Promise<void> {
  $('pairMsg').textContent = 'Webcam wird geöffnet …';
  await openWebcam();
  $('pairMsg').textContent = 'Offer wird erzeugt …';
  camera = undefined;
  session = undefined;
  pair = '';
  try {
    const code = await newLink().createOffer();
    $('pairBox').hidden = false;
    const q = drawQr($<HTMLCanvasElement>('offerQr'), code);
    $('offerInfo').textContent = `Offer-QR: Version ${q.version}, ${q.bytes} Zeichen`;
    $<HTMLTextAreaElement>('offerOut').value = code;
    $('pairMsg').textContent = 'wartet auf Antwort des Handys';
    stopScan?.();
    if (webcam?.active) {
      stopScan = scanQr($<HTMLVideoElement>('cam'), (text) => {
        void applyAnswer(text);
        return true;
      });
    }
  } catch (e) {
    $('pairMsg').textContent = `Fehler: ${(e as Error).message}`;
  }
}

async function applyAnswer(code: string): Promise<void> {
  try {
    await link?.acceptAnswer(code.trim());
    $('pairMsg').textContent = 'verbindet …';
  } catch (e) {
    $('pairMsg').textContent = `Antwort-Code ungültig: ${(e as Error).message}`;
    if (webcam?.active && link) {
      stopScan?.();
      stopScan = scanQr($<HTMLVideoElement>('cam'), (t) => {
        void applyAnswer(t);
        return true;
      });
    }
  }
}

// Nachrichten vom Handy
function onMessage(m: Message): void {
  switch (m.t) {
    case 'hello':
      if (setup) link?.send({ t: 'config', setup });
      break;
    case 'status':
      camera = m.camera;
      session = m.session;
      lastStatusAt = Date.now();
      break;
    case 'result':
      localStorage.setItem(RESULT_KEY, JSON.stringify({ at: Date.now(), result: m.result, setup }));
      showResult(m.result, setup, Date.now());
      break;
    case 'snapshot': {
      const bytes = assembler.add(m);
      if (bytes) showSnapshot(bytes, assembler.width, assembler.fullWidth);
      break;
    }
    case 'error':
      warn(`Handy meldet: ${m.message}`);
      break;
    default:
  }
}

// Standbild
function showSnapshot(bytes: Uint8Array, width: number, fullWidth: number): void {
  if (snapshotBlobUrl) URL.revokeObjectURL(snapshotBlobUrl);
  snapshotBlobUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/jpeg' }));
  snapshotScale = width / fullWidth;
  const img = new Image();
  img.onload = () => {
    snapshotImage = img;
    drawSnapshot();
    $('snapMsg').textContent = `${img.width}×${img.height} (Maßstab ${snapshotScale.toFixed(3)} zum Vollbild)`;
  };
  img.src = snapshotBlobUrl;
}

function drawSnapshot(): void {
  if (!snapshotImage) return;
  const c = $<HTMLCanvasElement>('snapView');
  c.width = snapshotImage.width;
  c.height = snapshotImage.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(snapshotImage, 0, 0);
  const s = typeof currentSetup() === 'string' ? setup : (currentSetup() as RealSetup);
  if (!s) return;
  const k = snapshotScale;
  const box = (color: string, x: number, y: number, w: number, h: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x * k, y * k, w * k, h * k);
  };
  box('#ff4c4c', s.crop[0], s.crop[1], s.crop[2], s.crop[3]);
  box('#ffe066', s.rimX[0], s.rimY[0], s.rimX[1] - s.rimX[0], s.rimY[1] - s.rimY[0]);
  box('#6fe39a', s.refX[0], s.refY[0], s.refX[1] - s.refX[0], s.refY[1] - s.refY[0]);
  box('#4cc2ff', s.bedX[0], s.bedY[0], s.bedX[1] - s.bedX[0], s.bedY[1] - s.bedY[0]);
}

// Ergebnis
function buildCharts(spokes: number, revs: number): void {
  const key = `${spokes}/${revs}`;
  if (key === chartKey) return;
  chartKey = key;
  $('chartLat').replaceChildren();
  $('chartH').replaceChildren();
  const series: ChartSeries[] = [
    ...Array.from({ length: revs }, (_, i) => ({ label: `Umdrehung ${i + 1}`, stroke: COLORS[i % COLORS.length] })),
    { label: 'Median alle', stroke: '#ffffff', dash: [6, 4] },
  ];
  charts = {
    lat: createRunoutChart($('chartLat'), spokes, 'mm', series, 1),
    h: createRunoutChart($('chartH'), spokes, 'mm', series, 1),
  };
}

function showResult(r: RealResult, s: RealSetup | undefined, at: number): void {
  const p = r.profile;
  buildCharts(p.all.lateral.length, p.revolutions.length);
  charts!.lat.update([...p.revolutions.map((v) => v.lateral), p.all.lateral]);
  charts!.h.update([...p.revolutions.map((v) => v.height), p.all.height]);
  $('resultAge').textContent = `(${new Date(at).toLocaleTimeString()}, ${r.frames} Bilder, ${Number.isFinite(p.scale) ? p.scale.toFixed(4) : '–'} mm/px)`;
  const c = r.check;
  $('check').innerHTML =
    `<p><span class="pill ${c.ok ? 'ok' : 'bad'}">${c.ok ? 'Messung plausibel' : 'Messung unsicher'}</span> ` +
    `<span class="muted">volle Umdrehungen ${c.fullRevolutions} · Übereinstimmung Ø ${c.agreeMeanMm.toFixed(2)} / max ${c.agreeMaxMm.toFixed(2)} mm</span></p>` +
    (c.messages.length ? `<ul>${c.messages.map((m) => `<li class="error">${m}</li>`).join('')}</ul>` : '');
  if (s) {
    const lat = centered(p.all.lateral);
    const actions = recommend({ ...p.all, lateral: lat }, spokeSides(s), { toleranceMm: s.toleranceLateralMm, toleranceHeightMm: s.toleranceHeightMm });
    $('actions').innerHTML = actions.length
      ? actions.map((a) => `<li class="${a.verb}"><b>${describe(a, { firstSpoke: 1, sideName: (x) => sideName(s, x) })}</b></li>`).join('')
      : '<li class="muted">alles innerhalb der Toleranz</li>';
  }
}

function loadResult(): void {
  try {
    const saved = localStorage.getItem(RESULT_KEY);
    if (!saved) return;
    const { at, result, setup: s } = JSON.parse(saved, reviveNaN) as { at: number; result: RealResult; setup?: RealSetup };
    showResult(result, s, at);
    $('resultAge').textContent += ' · gespeichert';
  } catch {
    localStorage.removeItem(RESULT_KEY);
  }
}

function renderLive(): void {
  const row = (k: string, v: string) => `<tr><td>${k}</td><td>${v}</td></tr>`;
  const dir = session ? (session.dir > 0 ? '▶ vorwärts' : session.dir < 0 ? '◀ rückwärts' : '–') : '–';
  $('live').innerHTML = [
    row('Messung', camera ? (camera.running ? 'läuft' : 'gestoppt') : 'kein Handy'),
    row('Kamera', camera ? `${camera.width}×${camera.height} · ${camera.fps.toFixed(1)} fps · verworfen ${camera.dropped}` : '–'),
    row('Auswertung', session ? `${session.frames} Bilder · Ø ${session.avgMs.toFixed(2)} ms · p95 ${session.p95Ms.toFixed(2)} ms` : '–'),
    row('Löcher', session ? `Nullpunkte ${session.markers} · netto ${session.holes} · ${dir}` : '–'),
    row('Warnungen', session?.warnings.length ? session.warnings.join(', ') : 'keine'),
    row('Verbindung', `${link?.state ?? 'nicht gekoppelt'}${pair ? ' · ' + pair : ''}`),
    row('ICE', link?.diag() ?? '–'),
  ].join('');
}

setInterval(() => {
  renderLive();
  if (link?.state === 'verbunden' && Date.now() - lastStatusAt > statusTimeoutMs) warn('Seit über 4 s kein Status vom Handy (Display aus, App im Hintergrund oder WLAN-Problem?).');
  else if (link?.state === 'verbunden' && $('warn').textContent?.startsWith('Seit über')) warn('');
}, 500);

$('pair').onclick = () => void startPairing();
$('relink').onclick = () => void startPairing();
$('answerApply').onclick = () => void applyAnswer($<HTMLTextAreaElement>('answerIn').value);
$('apply').onclick = () => void applyConfig();
$('defaults').onclick = () => writeForm({ ...defaultRealSetup, ...(readForm() as RealSetup) });
$('rimWidthMm').oninput = markRequired;
$('snap').onclick = () => {
  if (!link?.send({ t: 'snapshot-request', maxSize: 960 })) return void ($('snapMsg').textContent = 'Nicht verbunden.');
  $('snapMsg').textContent = 'angefordert …';
};
$('start').onclick = () => {
  if (!applyConfig()) return;
  link?.send({ t: 'start' });
};
$('stop').onclick = () => link?.send({ t: 'stop' });

loadConfig();
applyConfigSilently();
loadResult();
renderLive();
