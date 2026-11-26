import './style.css';
import { splitBase64, type CameraStatus, type Message, type RealResult, type RealSetup, type SessionStatus } from '../core';
import { CameraSource } from './cameraSource';
import type { FromWorker, ToWorker } from './analysis.worker';
import { Link, type LinkState } from './rtc/link';
import { drawQr, scanQr } from './rtc/qr';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const maxInFlight = 3;

let source: CameraSource | undefined;
let link: Link | undefined;
let setup: RealSetup | undefined;
let running = false;
let dropped = 0;
let inFlight = 0;
let session: SessionStatus | undefined;
let lastResult: RealResult | undefined;
let snapshotId = 0;
let stopScan: (() => void) | undefined;
let pair = '';
let qrInfo = '';
let wakeLock: WakeLockSentinel | undefined;
let wakeState = 'nicht angefordert';

const worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
const toWorker = (m: ToWorker, transfer: Transferable[] = []) => worker.postMessage(m, transfer);

worker.onmessage = (e: MessageEvent<FromWorker>) => {
  const m = e.data;
  if (m.t === 'ack') inFlight = Math.max(0, inFlight - 1);
  else if (m.t === 'status') session = m.status;
  else if (m.t === 'result') {
    lastResult = m.result;
    link?.send({ t: 'result', result: m.result });
  } else warn(`Auswertung: ${m.message}`);
};

function warn(text: string): void {
  $('warn').textContent = text;
  $('warn').hidden = !text;
}

function cameraStatus(): CameraStatus {
  return { running, fps: source?.fps ?? 0, width: source?.video.videoWidth ?? 0, height: source?.video.videoHeight ?? 0, dropped };
}

const send = (m: Message) => link?.send(m);

function applyConfig(s: RealSetup): void {
  setup = s;
  toWorker({ t: 'config', setup: s });
  source?.setConfig({ crop: s.crop, rotate: s.rotate, mirror: s.mirror });
}

function feed(): void {
  if (!source) return;
  source.onFrame = ({ image }) => {
    if (!running) return;
    if (inFlight >= maxInFlight) {
      dropped++;
      return;
    }
    inFlight++;
    toWorker({ t: 'frame', data: image.data.buffer as ArrayBuffer, width: image.width, height: image.height }, [image.data.buffer as ArrayBuffer]);
  };
}

async function sendSnapshot(maxSize: number): Promise<void> {
  if (!source || !setup) {
    send({ t: 'error', message: 'Kamera nicht gestartet oder keine Konfiguration empfangen' });
    return;
  }
  const snap = await source.snapshot(maxSize, setup.rotate, setup.mirror);
  const parts = splitBase64(new Uint8Array(await snap.blob.arrayBuffer()));
  const id = ++snapshotId;
  for (let index = 0; index < parts.length; index++) {
    while (link && link.bufferedAmount > 256 * 1024) await new Promise((r) => setTimeout(r, 20));
    send({ t: 'snapshot', id, index, count: parts.length, data: parts[index], width: snap.width, height: snap.height, fullWidth: snap.fullWidth, fullHeight: snap.fullHeight });
  }
}

function onMessage(m: Message): void {
  switch (m.t) {
    case 'hello':
      send({ t: 'hello', role: 'camera' });
      send({ t: 'status', camera: cameraStatus(), session });
      if (lastResult) send({ t: 'result', result: lastResult });
      break;
    case 'config':
      applyConfig(m.setup);
      break;
    case 'snapshot-request':
      void sendSnapshot(m.maxSize);
      break;
    case 'start':
      if (!source || !setup) {
        send({ t: 'error', message: 'Kamera nicht gestartet oder keine Konfiguration empfangen' });
        break;
      }
      dropped = 0;
      inFlight = 0;
      session = undefined;
      lastResult = undefined;
      running = true;
      toWorker({ t: 'start' });
      break;
    case 'stop':
      if (running) {
        running = false;
        toWorker({ t: 'stop' });
      }
      break;
    default:
  }
}

function setLinkState(state: LinkState, detail: string): void {
  $('link').textContent = state === 'getrennt' || state === 'fehler' ? `${state}${detail ? ' – ' + detail : ''}` : state;
  $('relink').hidden = !(state === 'getrennt' || state === 'fehler');
  if (state === 'getrennt' || state === 'fehler') warn(`Verbindung zur Steuerung ${state === 'fehler' ? 'fehlgeschlagen' : 'getrennt'}. ${running ? 'Die Messung läuft weiter; ' : ''}„Neu koppeln“ wählen.`);
  else if (state === 'verbunden') {
    warn('');
    void link?.candidatePair().then((p) => (pair = p));
  }
}

function newLink(): Link {
  link?.close();
  const l = new Link();
  l.onMessage = onMessage;
  l.onState = setLinkState;
  l.onProblem = (t) => warn(`Ungültige Nachricht: ${t}`);
  link = l;
  return l;
}

async function acceptOffer(code: string): Promise<void> {
  try {
    const answer = await newLink().acceptOffer(code.trim());
    $('answerBox').hidden = false;
    $<HTMLTextAreaElement>('answerOut').value = answer;
    const q = drawQr($<HTMLCanvasElement>('answerQr'), answer);
    qrInfo = `Antwort-QR: Version ${q.version}, ${q.bytes} Zeichen`;
    $('answerInfo').textContent = qrInfo;
    warn('');
  } catch (e) {
    warn(`Offer-Code ungültig: ${(e as Error).message}`);
  }
}

async function requestWakeLock(): Promise<void> {
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeState = 'aktiv';
    wakeLock.onrelease = () => (wakeState = 'freigegeben');
  } catch (e) {
    wakeState = `nicht verfügbar (${(e as Error).message})`;
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && source) void requestWakeLock();
});

$('camStart').onclick = async () => {
  try {
    source = await CameraSource.open();
    $('preview').replaceChildren(source.video);
    feed();
    if (setup) applyConfig(setup);
    $('camMsg').textContent = 'läuft';
    await requestWakeLock();
  } catch (e) {
    $('camMsg').textContent = `Kamera nicht verfügbar: ${(e as Error).message}`;
  }
};

$('scan').onclick = () => {
  if (!source) return warn('Zuerst die Kamera starten.');
  stopScan?.();
  stopScan = scanQr(source.video, (text) => {
    void acceptOffer(text);
    return true;
  });
};
$('offerApply').onclick = () => void acceptOffer($<HTMLTextAreaElement>('offerIn').value);
$('relink').onclick = () => {
  $('answerBox').hidden = true;
  $('relink').hidden = true;
  $('link').textContent = 'nicht gekoppelt';
  warn('');
  link?.close();
  link = undefined;
};

function renderDiag(): void {
  const s = source?.settings;
  const row = (k: string, v: string) => `<tr><td>${k}</td><td>${v}</td></tr>`;
  const t = session;
  const dirText = t ? (t.dir > 0 ? '▶ vorwärts' : t.dir < 0 ? '◀ rückwärts' : '–') : '–';
  $('diagRows').innerHTML = [
    row('Auflösung (getSettings)', s ? `${s.width}×${s.height} @ ${s.frameRate ?? '?'} fps` : '–'),
    row('Videogröße', source ? `${source.video.videoWidth}×${source.video.videoHeight}` : '–'),
    row('Bildrate gemessen', source ? `${source.fps.toFixed(1)} fps` : '–'),
    row('Rechenzeit je Bild', t ? `Mittel ${t.avgMs.toFixed(2)} ms · p95 ${t.p95Ms.toFixed(2)} ms` : '–'),
    row('Ausgewertet / verworfen', `${t?.frames ?? 0} / ${dropped}`),
    row('Lochzustand', t ? `Nullpunkte ${t.markers} · Löcher netto ${t.holes} · ${dirText}` : '–'),
    row('Warnungen', t?.warnings.length ? t.warnings.join(', ') : 'keine'),
    row('Messung', running ? 'läuft' : 'gestoppt'),
    row('Verbindung', `${link?.state ?? 'nicht gekoppelt'}${pair ? ' · ' + pair : ''}`),
    row('QR', qrInfo || '–'),
    row('Display bleibt an', wakeState),
  ].join('');
}

setInterval(() => {
  send({ t: 'status', camera: cameraStatus(), session });
  renderDiag();
}, 500);
renderDiag();
