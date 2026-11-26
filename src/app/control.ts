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
let ackTimer: ReturnType<typeof setTimeout> | undefined;
let stopScan: (() => void) | undefined;
let webcam: MediaStream | undefined;
let pair = '';
let chartKey = '';
let charts: { lat: ReturnType<typeof createRunoutChart>; h: ReturnType<typeof createRunoutChart> } | undefined;
let snapshotImage: HTMLImageElement | undefined;
let snapshotScale = 1;
let viewK = 1; // Videopixel → Canvaspixel
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
  clearTimeout(ackTimer);
  if (link?.state === 'verbunden') {
    msg.textContent = 'gesendet, warte auf Bestätigung des Handys …';
    ackTimer = setTimeout(() => {
      msg.className = 'error';
      msg.textContent = 'keine Bestätigung vom Handy (Verbindung prüfen, Seite am Handy neu laden)';
    }, 3000);
  } else msg.textContent = 'gespeichert (wird nach der Kopplung gesendet)';
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
    stopWebcam();
    $('pairBox').hidden = true;
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

// Die Webcam wird nur für den Antwort-QR gebraucht.
function stopWebcam(): void {
  webcam?.getTracks().forEach((t) => t.stop());
  webcam = undefined;
  $<HTMLVideoElement>('cam').srcObject = null;
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
    $('pairMsg').textContent = 'wartet auf Antwort des Handys – Antwort-QR vor die Webcam halten (wird automatisch erkannt)';
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
    $('pairMsg').textContent = 'Antwort erkannt, verbindet …';
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
    case 'config-ok':
      clearTimeout(ackTimer);
      $('cfgMsg').className = 'ok';
      $('cfgMsg').textContent = `vom Handy bestätigt (${new Date().toLocaleTimeString()})`;
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

// Die Rahmen folgen dem JSON; ist es gerade ungültig, gilt die zuletzt übernommene Konfiguration.
function shownSetup(): RealSetup | undefined {
  const s = currentSetup();
  return typeof s === 'string' ? setup : s;
}

// Das Canvas wird in Anzeigeauflösung gezeichnet, damit Linien und Schrift scharf bleiben.
function drawSnapshot(): void {
  if (!snapshotImage) return;
  const c = $<HTMLCanvasElement>('snapView');
  c.width = Math.round((c.clientWidth || snapshotImage.width) * (window.devicePixelRatio || 1));
  c.height = Math.round((c.width * snapshotImage.height) / snapshotImage.width);
  viewK = c.width / (snapshotImage.width / snapshotScale);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(snapshotImage, 0, 0, c.width, c.height);
  const s = shownSetup();
  if (!s) return;
  const k = viewK;
  const u = pxPerCss(c);
  ctx.font = `bold ${14 * u}px sans-serif`;
  ctx.lineJoin = 'round';
  for (const def of boxDefs) {
    const b = def.get(s);
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 2 * u;
    ctx.strokeRect(b.x0 * k, b.y0 * k, (b.x1 - b.x0) * k, (b.y1 - b.y0) * k);
    const ty = b.y0 * k > 20 * u ? b.y0 * k - 8 * u : b.y0 * k + 18 * u;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3 * u;
    ctx.strokeText(def.label, b.x0 * k + 4 * u, ty);
    ctx.fillStyle = def.color;
    ctx.fillText(def.label, b.x0 * k + 4 * u, ty);
    for (const [x, y] of corners(b)) {
      const h = handleCss * u;
      ctx.lineWidth = u;
      ctx.strokeStyle = '#000';
      ctx.fillRect(x * k - h, y * k - h, 2 * h, 2 * h);
      ctx.strokeRect(x * k - h, y * k - h, 2 * h, 2 * h);
    }
  }
}

// Messbereiche am Standbild mit der Maus: Ecken ziehen ändert die Größe, im Rahmen ziehen verschiebt ihn.
type Box = { x0: number; y0: number; x1: number; y1: number };
type BoxDef = { color: string; label: string; get(s: RealSetup): Box; set(a: Record<string, number[]>, b: Box): void };

const handleCss = 6;
const xyBox = (color: string, label: string, kx: 'rimX' | 'refX' | 'bedX', ky: 'rimY' | 'refY' | 'bedY'): BoxDef => ({
  color,
  label,
  get: (s) => ({ x0: s[kx][0], x1: s[kx][1], y0: s[ky][0], y1: s[ky][1] }),
  set: (a, b) => {
    a[kx] = [b.x0, b.x1];
    a[ky] = [b.y0, b.y1];
  },
});
const boxDefs: BoxDef[] = [
  {
    color: '#ff4c4c',
    label: 'Ausschnitt',
    get: (s) => ({ x0: s.crop[0], y0: s.crop[1], x1: s.crop[0] + s.crop[2], y1: s.crop[1] + s.crop[3] }),
    set: (a, b) => {
      a.crop = [b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0];
    },
  },
  xyBox('#ffe066', 'Felge', 'rimX', 'rimY'),
  xyBox('#6fe39a', 'Referenz', 'refX', 'refY'),
  xyBox('#4cc2ff', 'Bettstreifen', 'bedX', 'bedY'),
];

type Drag = { def: BoxDef; start: Box; x: number; y: number; cx?: 0 | 1; cy?: 0 | 1 };
let drag: Drag | undefined;

const corners = (b: Box): [number, number][] => [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]];
const pxPerCss = (c: HTMLCanvasElement) => (c.clientWidth ? c.width / c.clientWidth : 1);

// Position in Videokoordinaten
function pointerPos(e: PointerEvent): { x: number; y: number } {
  const r = view.getBoundingClientRect();
  return { x: ((e.clientX - r.left) * pxPerCss(view)) / viewK, y: ((e.clientY - r.top) * pxPerCss(view)) / viewK };
}

function hitBox(e: PointerEvent): Drag | undefined {
  const s = shownSetup();
  if (!s || !snapshotImage) return undefined;
  const p = pointerPos(e);
  const reach = (handleCss * 1.5 * pxPerCss(view)) / viewK;
  let move: Drag | undefined;
  let area = Infinity;
  let near: Drag | undefined;
  let dist = reach;
  for (const def of boxDefs) {
    const b = def.get(s);
    for (const [i, [x, y]] of corners(b).entries()) {
      const d = Math.max(Math.abs(p.x - x), Math.abs(p.y - y));
      if (d <= dist) {
        dist = d;
        near = { def, start: b, x: p.x, y: p.y, cx: (i % 2) as 0 | 1, cy: Math.floor(i / 2) as 0 | 1 };
      }
    }
    const a = (b.x1 - b.x0) * (b.y1 - b.y0);
    if (p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1 && a < area) {
      area = a;
      move = { def, start: b, x: p.x, y: p.y };
    }
  }
  return near ?? move;
}

function dragTo(e: PointerEvent): void {
  if (!drag) return;
  const p = pointerPos(e);
  const dx = p.x - drag.x;
  const dy = p.y - drag.y;
  const { start: b } = drag;
  let n: Box;
  if (drag.cx === undefined) n = { x0: b.x0 + dx, x1: b.x1 + dx, y0: b.y0 + dy, y1: b.y1 + dy };
  else {
    const x = (drag.cx ? b.x1 : b.x0) + dx;
    const y = (drag.cy ? b.y1 : b.y0) + dy;
    n = { x0: Math.min(x, drag.cx ? b.x0 : b.x1), x1: Math.max(x, drag.cx ? b.x0 : b.x1), y0: Math.min(y, drag.cy ? b.y0 : b.y1), y1: Math.max(y, drag.cy ? b.y0 : b.y1) };
  }
  const r = (v: number) => Math.max(0, Math.round(v));
  try {
    const a = JSON.parse($<HTMLTextAreaElement>('areas').value);
    drag.def.set(a, { x0: r(n.x0), x1: r(n.x1), y0: r(n.y0), y1: r(n.y1) });
    $<HTMLTextAreaElement>('areas').value = JSON.stringify(a, null, 1);
    drawSnapshot();
  } catch {
    // JSON ungültig: erst dort korrigieren
  }
}

const view = $<HTMLCanvasElement>('snapView');
view.onpointerdown = (e) => {
  drag = hitBox(e);
  if (drag) view.setPointerCapture(e.pointerId);
};
view.onpointermove = (e) => {
  if (drag) return dragTo(e);
  const h = hitBox(e);
  view.style.cursor = !h ? '' : h.cx === undefined ? 'move' : 'crosshair';
};
view.onpointerup = () => {
  if (!drag) return;
  drag = undefined;
  applyConfig();
};

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
$<HTMLTextAreaElement>('areas').oninput = drawSnapshot;
window.onresize = drawSnapshot;
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
