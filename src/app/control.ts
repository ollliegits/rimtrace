import './style.css';
import {
  defaultRealSetup,
  describeTruing,
  formatTurns,
  parseSetup,
  realSetupError,
  reviveNaN,
  sideName,
  SnapshotAssembler,
  spokeSides,
  truingPlan,
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
const COLORS = ['#56b4e9', '#e69f00', '#cc79a7', '#7a5195', '#b8a600'];
const MEDIAN_COLOR = '#14262d';
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
// Fortschritt im Ablauf (Schrittleiste)
let configOk = false;
let snapshotSeen = false;
let currentStep = 0;

function warn(text: string): void {
  $('warn').textContent = text;
  $('warn').hidden = !text;
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function setText(id: string, text: string, cls = ''): void {
  const el = $(id);
  if (el.textContent !== text) el.textContent = text;
  el.className = cls;
}

// Meldungen der Auswertung mit einem Hinweis, was zu tun ist.
const hints: [RegExp, string][] = [
  [/Felge nicht erkannt/, 'Felgenrahmen (gelb) am Standbild prüfen: beidseitig heller Rand, darunter nichts Dunkles.'],
  [/kein Nullpunkt/, 'Der blaue Bettstreifen muss das Ventilloch erfassen; Nullpunkt in den Einstellungen prüfen.'],
  [/volle Umdrehung/, 'Mindestens 2 volle Runden drehen, erst danach Stopp.'],
  [/statt \d+ Löcher/, 'Speichenzahl prüfen; gleichmäßig drehen; Bettstreifen (blau) nur über das Felgenbett legen.'],
  [/weichen voneinander ab/, 'Rad ruhig und gleichmäßig drehen; Halterung von Handy und Referenz auf Wackeln prüfen.'],
  [/zu schnell/i, 'Langsamer und gleichmäßig drehen (unter etwa 0,4 Speichen pro Bild).'],
  [/nicht auswertbar/, 'Messbereiche Felge (gelb) und Referenz (grün) am Standbild prüfen.'],
  [/ohne Durchgang/, 'Im Bereich der Löcher nicht hin- und herdrehen.'],
];
const hintFor = (msg: string) => hints.find(([re]) => re.test(msg))?.[1];

function friendlySetupError(msg: string): string {
  if (msg.startsWith('rimWidthMm')) return 'Felgenbreite fehlt: Außenbreite der Felge mit dem Messschieber messen und unter ⚙ Einstellungen eintragen. Ohne sie startet keine Messung.';
  if (msg.startsWith('spokes')) return 'Speichenzahl muss eine ganze Zahl ab 2 sein.';
  if (msg.includes('liegt nicht im Ausschnitt')) return `Ein Messbereich liegt außerhalb des Ausschnitts (rot): Rahmen am Standbild anpassen. (${msg})`;
  return msg;
}

function setCfgMsg(cls: string, text: string): void {
  setText('cfgMsg', text, `hint ${cls}`);
  setText('cfgDlgMsg', text, `msg hint ${cls}`);
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
  const missing = !(Number($<HTMLInputElement>('rimWidthMm').value) > 0);
  $('rimWidthMm').classList.toggle('req', missing);
  $('rimWidthMm').setAttribute('aria-invalid', String(missing));
}

const rimOk = () => Boolean(setup && setup.rimWidthMm > 0);

function renderConfigSummary(): void {
  const f = readForm();
  const row = (k: string, v: string, cls = '') => `<dt>${k}</dt><dd${cls ? ` class="${cls}"` : ''}>${v}</dd>`;
  const rim = Number(f.rimWidthMm) > 0 ? `${String(f.rimWidthMm).replace('.', ',')} mm` : 'fehlt – bitte eintragen';
  const html = [
    row('Felgenbreite', rim, Number(f.rimWidthMm) > 0 ? '' : 'bad'),
    row('Speichen', String(f.spokes ?? '–')),
    row('Nullpunkt', f.marker === 'aufkleber' ? 'Aufkleber' : 'Ventilloch'),
    row('Speiche 1', f.spoke1Side === 'bremse' ? 'Bremsscheibenseite' : 'Antriebsseite'),
    row('Toleranz', `Seite ±${String(f.toleranceLateralMm).replace('.', ',')} · Höhe ±${String(f.toleranceHeightMm).replace('.', ',')} mm`),
  ].join('');
  if ($('cfgSummary').innerHTML !== html) $('cfgSummary').innerHTML = html;
}

function openSettings(focusId?: string): void {
  const d = $<HTMLDialogElement>('settings');
  if (!d.open) d.showModal();
  if (focusId) $(focusId).focus();
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
  if (typeof s === 'string') {
    setCfgMsg('error', friendlySetupError(s));
    return false;
  }
  setup = s;
  localStorage.setItem(CONFIG_KEY, JSON.stringify(s));
  clearTimeout(ackTimer);
  configOk = false;
  if (link?.state === 'verbunden') {
    setCfgMsg('', 'gesendet, warte auf Bestätigung des Handys …');
    ackTimer = setTimeout(() => {
      setCfgMsg('error', 'Keine Bestätigung vom Handy: Verbindung prüfen oder die Seite am Handy neu laden.');
    }, 3000);
  } else setCfgMsg('', 'gespeichert (wird nach der Kopplung ans Handy gesendet)');
  link?.send({ t: 'config', setup: s });
  renderConfigSummary();
  drawSnapshot();
  return true;
}

// Kopplung
const linkBadge: Record<LinkState, string> = { neu: 'idle', wartet: 'busy', verbindet: 'busy', verbunden: 'ok', getrennt: 'bad', fehler: 'bad' };

function setLinkState(state: LinkState, detail: string): void {
  $('link').textContent = state === 'getrennt' || state === 'fehler' ? `${state}${detail ? ' – ' + detail : ''}` : state;
  $('linkStatus').dataset.state = linkBadge[state] ?? 'idle';
  $('relink').hidden = !(state === 'getrennt' || state === 'fehler' || state === 'verbunden');
  $('pairing').hidden = state === 'verbunden';
  if (state !== 'verbunden') configOk = false;
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
    warn(`Verbindung zum Handy ${state === 'fehler' ? 'fehlgeschlagen' : 'getrennt'}${detail ? ': ' + detail : ''}. Konfiguration und Ergebnis bleiben erhalten – „Neu koppeln“ wählen und den QR-Code erneut mit dem Handy scannen.`);
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
  $('pairing').hidden = false;
  $('pairing').scrollIntoView({ block: 'start' });
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
      configOk = true;
      setCfgMsg('ok', `✓ vom Handy bestätigt (${new Date().toLocaleTimeString()})`);
      break;
    case 'status':
      camera = m.camera;
      session = m.session;
      lastStatusAt = Date.now();
      break;
    case 'result':
      localStorage.setItem(RESULT_KEY, JSON.stringify({ at: Date.now(), result: m.result, setup }));
      showResult(m.result, setup, Date.now());
      ($('setup') as HTMLDetailsElement).open = false;
      $('resultCard').scrollIntoView({ block: 'start' });
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
    snapshotSeen = true;
    $('snapEmpty').hidden = true;
    $('snapView').hidden = false;
    $('snapLegend').hidden = false;
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
    { label: 'Median alle', stroke: MEDIAN_COLOR, dash: [6, 4] },
  ];
  charts = {
    lat: createRunoutChart($('chartLat'), spokes, 'mm', series, 1),
    h: createRunoutChart($('chartH'), spokes, 'mm', series, 1),
  };
}

let shownResult: { result: RealResult; setup?: RealSetup } | undefined;

const mm = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '–');

function renderActions(r: RealResult, s: RealSetup | undefined): { count: number; done: boolean } {
  const p = r.profile;
  if (!s) {
    $('actions').innerHTML = '';
    $('planInfo').textContent = 'Ohne gespeicherte Konfiguration keine Maßnahmen: Messung wiederholen.';
    return { count: 0, done: false };
  }
  const plan = truingPlan(p.all, spokeSides(s), { toleranceLateralMm: s.toleranceLateralMm, toleranceHeightMm: s.toleranceHeightMm });
  const w = plan.widthSpokes;
  $('actions').innerHTML = plan.actions
    .map((a) => {
      const name = sideName(s, a.side);
      const drive = name === 'Antriebsseite';
      const verb = a.verb === 'tighten' ? 'anziehen' : 'lösen';
      const text = describeTruing(a, { firstSpoke: 1, sideName: (x) => sideName(s, x) });
      return (
        `<li class="action ${drive ? 'drive' : 'brake'}" aria-label="${esc(text)}">` +
        `<span class="no"><small>Speiche</small>${a.spoke + 1}</span>` +
        `<span class="side"><abbr title="${name}">${drive ? 'AS' : 'BS'}</abbr>${name}</span>` +
        `<span class="turns">${formatTurns(a.turns)} <small>Umdr.</small></span>` +
        `<span class="verb ${a.verb}">${verb}</span></li>`
      );
    })
    .join('');
  $('planInfo').textContent = plan.actions.length
    ? `Größte Drehung zuerst. Auslenkung etwa ${w.lateral} Speichen breit (Seite), ${w.height} (Höhe). Erwartet danach: Seite ±${mm(plan.residual.lateralMm, 1)} mm, Höhe ±${mm(plan.residual.heightMm, 1)} mm. Startwerte des Modells – danach neu messen.`
    : '';
  return { count: plan.actions.length, done: plan.actions.length === 0 };
}

function showResult(r: RealResult, s: RealSetup | undefined, at: number): void {
  shownResult = { result: r, setup: s };
  $('resultEmpty').hidden = true;
  $('resultBody').hidden = false;
  const p = r.profile;
  buildCharts(p.all.lateral.length, p.revolutions.length);
  charts!.lat.update([...p.revolutions.map((v) => v.lateral), p.all.lateral]);
  charts!.h.update([...p.revolutions.map((v) => v.height), p.all.height]);
  $('resultAge').textContent = `Messung von ${new Date(at).toLocaleTimeString()} · ${r.frames} Bilder · ${Number.isFinite(p.scale) ? p.scale.toFixed(4) : '–'} mm/px`;
  const c = r.check;
  const { count, done } = renderActions(r, s);
  const tol = s ? ` (Seite ±${mm(s.toleranceLateralMm)} mm, Höhe ±${mm(s.toleranceHeightMm)} mm)` : '';
  const stats =
    `<p class="stats">Volle Umdrehungen ${c.fullRevolutions} · Übereinstimmung Ø ${mm(c.agreeMeanMm)} / max ${mm(c.agreeMaxMm)} mm · ` +
    `Löcher je Umdrehung ${p.holesPerRev.join(', ') || '–'} · Nullpunkte ${p.markers.length}</p>`;
  let verdict: string;
  if (!c.ok) {
    const items = c.messages.map((m) => `<li>${esc(m)}${hintFor(m) ? `<span class="todo">→ ${esc(hintFor(m)!)}</span>` : ''}</li>`).join('');
    verdict = `<div class="callout bad verdict"><h3>Messung unsicher – bitte wiederholen</h3><ul>${items}</ul>${stats}</div>`;
  } else if (done && s) verdict = `<div class="callout ok verdict"><h3>✓ Fertig – alle Speichen innerhalb der Toleranz</h3><p>Seiten- und Höhenschlag liegen innerhalb der eingestellten Toleranz${tol}.</p>${stats}</div>`;
  else verdict = `<div class="callout ok verdict"><h3>✓ Messung plausibel – ${count} ${count === 1 ? 'Speiche' : 'Speichen'} nachstellen</h3>${stats}</div>`;
  $('check').innerHTML = verdict;
  $('actions').classList.toggle('uncertain', !c.ok);
  if (!c.ok && count) $('planInfo').textContent = `Nur unter Vorbehalt (Messung unsicher). ${$('planInfo').textContent}`;
  $('next').textContent = !c.ok ? '↻ Messung wiederholen' : done ? '↻ Kontrollmessung' : '✓ Alles umgesetzt – nächste Messung';
  const marker = s?.marker === 'aufkleber' ? 'dem Aufkleber' : 'dem Ventilloch';
  $('countRule').innerHTML = `Zählung: <b>Speiche 1</b> ist die erste Speiche nach ${marker} in Fahrtrichtung, durchgehend über beide Seiten. <b>AS</b> = Antriebsseite, <b>BS</b> = Bremsscheibenseite.`;
  renderDebug(r);
}

function renderDebug(r: RealResult): void {
  const p = r.profile;
  const holes = p.holes ?? [];
  const events = p.events ?? [];
  const row = (k: string, v: string) => `<dt>${k}</dt><dd>${esc(v)}</dd>`;
  $('debug').innerHTML =
    `<dl class="kv">${row('Bilder', String(r.frames))}${row('Maßstab', `${Number.isFinite(p.scale) ? p.scale.toFixed(4) : '–'} mm/px`)}` +
    `${row('Löcher je Umdrehung', p.holesPerRev.join(', ') || '–')}${row('Nullpunkte (Bild)', p.markers.join(', ') || '–')}` +
    `${row('Ventilloch-Verhältnis', r.valveRatios?.map((v) => v.toFixed(2)).join(', ') || '–')}` +
    `${row('Verworfene Bilder', String(r.check.discardedFrames ?? '–'))}${row('Kleinster Lochabstand', `${Number.isFinite(r.check.minHoleGap) ? r.check.minHoleGap.toFixed(1) : '–'} Bilder`)}</dl>` +
    `<details class="more"><summary>Erkannte Löcher (${holes.length})</summary><pre class="mono">${holes.map((h) => `Bild ${h.frame} · Umdr. ${h.rev} · Speiche ${h.k + 1}`).join('\n') || '–'}</pre></details>` +
    `<details class="more"><summary>Rohereignisse Lochfenster (${events.length})</summary><pre class="mono">${events.map((e) => `Bild ${e.frame} · ${esc(e.kind)} · Richtung ${e.dir} · Größe ${e.size}`).join('\n') || '–'}</pre></details>` +
    `<details class="more"><summary>Bettweg je Bild (px)</summary><pre class="mono">${esc(p.shifts ?? '–')}</pre></details>`;
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

const dirText = (s?: SessionStatus) => (s ? (s.dir > 0 ? '▶ vorwärts' : s.dir < 0 ? '◀ rückwärts' : '–') : '–');

function renderLive(): void {
  const linked = link?.state === 'verbunden';
  const running = Boolean(linked && camera?.running);
  const runText = !linked || !camera ? 'kein Handy' : running ? 'läuft' : 'bereit';
  setText('runState', runText);
  $('runStatus').dataset.state = running ? 'busy' : linked && camera ? 'ok' : 'idle';
  $('start').toggleAttribute('disabled', running);
  $('stop').toggleAttribute('disabled', !running);
  $('next').toggleAttribute('disabled', running);

  const warnings = session?.warnings ?? [];
  const dd = (k: string, v: string, cls = '') => `<dt>${k}</dt><dd${cls ? ` class="${cls}"` : ''}>${esc(v)}</dd>`;
  const status = [
    dd('Handy', linked ? 'verbunden' : link?.state ?? 'nicht gekoppelt', linked ? '' : link?.state === 'getrennt' || link?.state === 'fehler' ? 'bad' : ''),
    dd('Messung', runText),
    dd('Kamera', camera ? `${camera.fps.toFixed(0)} Bilder/s` : '–'),
    dd('Warnungen', warnings.length ? warnings.join(', ') : 'keine', warnings.length ? 'warn' : ''),
  ].join('');
  if ($('statusList').innerHTML !== status) $('statusList').innerHTML = status;

  const big = (k: string, v: string) => `<div><span>${k}</span><b>${v}</b></div>`;
  $('liveBig').innerHTML = [
    big('Löcher (netto)', session ? String(session.holes) : '–'),
    big('Nullpunkte', session ? String(session.markers) : '–'),
    big('Richtung', dirText(session)),
    big('Bilder', session ? String(session.frames) : '–'),
  ].join('');
  const liveWarn = warnings.map((w) => `<b>${esc(w)}</b>${hintFor(w) ? ` – ${esc(hintFor(w)!)}` : ''}`).join('<br>');
  $('liveWarn').hidden = !liveWarn;
  if ($('liveWarn').innerHTML !== liveWarn) $('liveWarn').innerHTML = liveWarn;

  const row = (k: string, v: string) => `<tr><td>${k}</td><td>${esc(v)}</td></tr>`;
  $('live').innerHTML = [
    row('Messung', camera ? (camera.running ? 'läuft' : 'gestoppt') : 'kein Handy'),
    row('Kamera', camera ? `${camera.width}×${camera.height} · ${camera.fps.toFixed(1)} fps · verworfen ${camera.dropped}` : '–'),
    row('Auswertung', session ? `${session.frames} Bilder · Ø ${session.avgMs.toFixed(2)} ms · p95 ${session.p95Ms.toFixed(2)} ms` : '–'),
    row('Löcher', session ? `Nullpunkte ${session.markers} · netto ${session.holes} · ${dirText(session)}` : '–'),
    row('Warnungen', warnings.length ? warnings.join(', ') : 'keine'),
    row('Verbindung', `${link?.state ?? 'nicht gekoppelt'}${pair ? ' · ' + pair : ''}`),
    row('ICE', link?.diag() ?? '–'),
  ].join('');
  renderSteps(linked, running);
}

// Schrittleiste: Koppeln → Einrichten → Messen → Maßnahmen umsetzen
function renderSteps(linked: boolean, running: boolean): void {
  const check = shownResult?.result.check;
  const step = !linked ? 1 : !rimOk() || !configOk || !(snapshotSeen || shownResult) ? 2 : running || !shownResult ? 3 : 4;
  for (let i = 1; i <= 4; i++) {
    const li = $(`step${i}`);
    li.classList.toggle('done', i < step || (i === 1 && linked));
    li.classList.toggle('current', i === step);
    const a = li.querySelector('a')!;
    if (i === step) a.setAttribute('aria-current', 'step');
    else a.removeAttribute('aria-current');
  }
  const hint =
    step === 1
      ? 'Kopplung starten und den QR-Code mit dem Handy (Seite „Kamera“) scannen.'
      : step === 2
        ? !rimOk()
          ? 'Felgenbreite fehlt: unter ⚙ Einstellungen eintragen (mit dem Messschieber messen).'
          : !configOk
            ? 'Konfiguration wird ans Handy gesendet …'
            : 'Standbild holen und die Messbereiche prüfen, dann messen.'
        : step === 3
          ? running
            ? 'Messung läuft: gleichmäßig mindestens 2 volle Runden drehen, dann Stopp.'
            : 'Bereit: Start drücken und das Rad gleichmäßig drehen.'
          : check && !check.ok
            ? 'Messung unsicher: Hinweise beachten und die Messung wiederholen.'
            : 'Maßnahmen am Rad umsetzen, dann „Alles umgesetzt – nächste Messung“.';
  setText('stepHint', hint, 'step-hint');
  if (step !== currentStep) {
    if (step === 2) ($('setup') as HTMLDetailsElement).open = true;
    currentStep = step;
  }
}

setInterval(() => {
  renderLive();
  if (link?.state === 'verbunden' && Date.now() - lastStatusAt > statusTimeoutMs) warn('Seit über 4 s kein Status vom Handy: Display aus, Seite im Hintergrund oder WLAN-Problem? Handy prüfen, ggf. „Neu koppeln“.');
  else if (link?.state === 'verbunden' && $('warn').textContent?.startsWith('Seit über')) warn('');
}, 500);

function startMeasurement(): void {
  const msg = $('runMsg');
  if (!applyConfig()) {
    msg.className = 'error';
    msg.textContent = $('cfgMsg').textContent ?? '';
    if (!(Number($<HTMLInputElement>('rimWidthMm').value) > 0)) openSettings('rimWidthMm');
    return;
  }
  if (!link?.send({ t: 'start' })) {
    msg.className = 'error';
    msg.textContent = 'Nicht verbunden – zuerst das Handy koppeln.';
    return;
  }
  msg.className = 'muted';
  msg.textContent = `Start gesendet (${new Date().toLocaleTimeString()})`;
  ($('setup') as HTMLDetailsElement).open = false;
}

$('pair').onclick = () => void startPairing();
$('relink').onclick = () => void startPairing();
$<HTMLTextAreaElement>('areas').oninput = drawSnapshot;
window.onresize = () => {
  drawSnapshot();
  charts?.lat.resize();
  charts?.h.resize();
};
$('setup').addEventListener('toggle', drawSnapshot);
$('answerApply').onclick = () => void applyAnswer($<HTMLTextAreaElement>('answerIn').value);
$('openSettings').onclick = () => openSettings();
$('editSettings').onclick = () => openSettings();
$('apply').onclick = () => {
  if (applyConfig()) $<HTMLDialogElement>('settings').close();
};
$('settingsForm').addEventListener('submit', (e) => {
  e.preventDefault();
  $('apply').click();
});
// Abbrechen verwirft ungesendete Änderungen im Formular.
const revertSettings = () => {
  if (setup) writeForm(setup);
  renderConfigSummary();
};
$('cancelSettings').onclick = () => {
  revertSettings();
  $<HTMLDialogElement>('settings').close();
};
$('settings').addEventListener('cancel', revertSettings);
$('defaults').onclick = () => writeForm({ ...defaultRealSetup, ...(readForm() as RealSetup) });
$('rimWidthMm').oninput = markRequired;
$('snap').onclick = () => {
  if (!link?.send({ t: 'snapshot-request', maxSize: 960 })) return void ($('snapMsg').textContent = 'Nicht verbunden – zuerst das Handy koppeln.');
  $('snapMsg').textContent = 'angefordert …';
};
$('start').onclick = startMeasurement;
$('next').onclick = () => {
  startMeasurement();
  $('measure').scrollIntoView({ block: 'start' });
};
$('start').addEventListener('click', () => $('measure').scrollIntoView({ block: 'start' }));
$('copyResult').onclick = async () => {
  const text = JSON.stringify({ ...shownResult, camera, session }, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v), 1);
  try {
    await navigator.clipboard.writeText(text);
    $('copyMsg').textContent = 'kopiert';
  } catch {
    $('copyMsg').textContent = 'Kopieren nicht möglich';
  }
};
$('stop').onclick = () => link?.send({ t: 'stop' });

loadConfig();
applyConfigSilently();
renderConfigSummary();
loadResult();
renderLive();
