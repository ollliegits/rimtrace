import { defaultRealSetup, realSetupError, type RealSetup } from './realSetup';
import type { RealResult } from './realAnalyzer';
import type { SessionStatus } from './session';
import { parseSetup } from './setup';

export const PROTOCOL_VERSION = 1;

/** Kamera-Zustand für die Diagnose (vom Handy gemessen). */
export interface CameraStatus {
  running: boolean;
  fps: number;
  width: number;
  height: number;
  /** Per Backpressure verworfene Bilder. */
  dropped: number;
}

export type Message =
  | { t: 'hello'; role: 'control' | 'camera' }
  | { t: 'config'; setup: RealSetup }
  | { t: 'snapshot-request'; maxSize: number }
  | { t: 'snapshot'; id: number; index: number; count: number; data: string; width: number; height: number; fullWidth: number; fullHeight: number }
  | { t: 'start' }
  | { t: 'stop' }
  | { t: 'status'; camera: CameraStatus; session?: SessionStatus }
  | { t: 'result'; result: RealResult }
  | { t: 'error'; message: string };

/** JSON kennt kein NaN (wird zu null); beim Lesen wird null wieder zu NaN ("keine Daten"). */
export const reviveNaN = (_key: string, v: unknown): unknown => (v === null ? NaN : v);

export const encode = (m: Message): string => JSON.stringify({ v: PROTOCOL_VERSION, ...m });

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Prüft eine empfangene Nachricht; liefert die Nachricht oder eine Fehlermeldung. */
export function decode(text: string): { message: Message } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text, reviveNaN);
  } catch {
    return { error: 'kein JSON' };
  }
  if (!isObj(raw)) return { error: 'keine Nachricht' };
  if (raw.v !== PROTOCOL_VERSION) return { error: `Protokollversion ${String(raw.v)} nicht unterstützt (erwartet ${PROTOCOL_VERSION})` };
  switch (raw.t) {
    case 'hello':
      return raw.role === 'control' || raw.role === 'camera' ? { message: { t: 'hello', role: raw.role } } : { error: 'hello: Rolle fehlt' };
    case 'start':
    case 'stop':
      return { message: { t: raw.t } };
    case 'config': {
      if (!isObj(raw.setup)) return { error: 'config: setup fehlt' };
      try {
        const setup = parseSetup(JSON.stringify(raw.setup), defaultRealSetup);
        const error = realSetupError(setup);
        return error ? { error: `config: ${error}` } : { message: { t: 'config', setup } };
      } catch (e) {
        return { error: `config: ${(e as Error).message}` };
      }
    }
    case 'snapshot-request':
      return isNum(raw.maxSize) && raw.maxSize > 0 ? { message: { t: 'snapshot-request', maxSize: raw.maxSize } } : { error: 'snapshot-request: maxSize fehlt' };
    case 'snapshot': {
      const { id, index, count, data, width, height, fullWidth, fullHeight } = raw;
      if (!isNum(id) || !isNum(index) || !isNum(count) || !isNum(width) || !isNum(height) || !isNum(fullWidth) || !isNum(fullHeight) || typeof data !== 'string') return { error: 'snapshot: Felder fehlen' };
      if (!Number.isInteger(index) || !Number.isInteger(count) || count < 1 || index < 0 || index >= count) return { error: 'snapshot: ungültiger Teil' };
      return { message: { t: 'snapshot', id, index, count, data, width, height, fullWidth, fullHeight } };
    }
    case 'status': {
      const c = raw.camera;
      if (!isObj(c) || !isNum(c.fps) || !isNum(c.width) || !isNum(c.height) || !isNum(c.dropped) || typeof c.running !== 'boolean') return { error: 'status: camera fehlt' };
      const camera: CameraStatus = { running: c.running, fps: c.fps, width: c.width, height: c.height, dropped: c.dropped };
      const s = raw.session;
      if (s === undefined) return { message: { t: 'status', camera } };
      if (!isObj(s) || !isNum(s.frames) || !isNum(s.avgMs) || !isNum(s.p95Ms) || !isNum(s.markers) || !isNum(s.holes) || !isNum(s.dir) || !Array.isArray(s.warnings)) {
        return { error: 'status: session ungültig' };
      }
      return { message: { t: 'status', camera, session: s as unknown as SessionStatus } };
    }
    case 'result': {
      const r = raw.result;
      if (!isObj(r) || !isObj(r.profile) || !isObj(r.check) || !Array.isArray(r.profile.revolutions) || !isObj(r.profile.all)) return { error: 'result: ungültig' };
      return { message: { t: 'result', result: r as unknown as RealResult } };
    }
    case 'error':
      return typeof raw.message === 'string' ? { message: { t: 'error', message: raw.message } } : { error: 'error: Text fehlt' };
    default:
      return { error: `unbekannte Nachricht: ${String(raw.t)}` };
  }
}

/** Bytes in Base64-Teile; jeder Teil passt sicher in eine Datenkanal-Nachricht. */
export function splitBase64(bytes: Uint8Array, chunkBytes = 12000): string[] {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkBytes) {
    let bin = '';
    const end = Math.min(bytes.length, i + chunkBytes);
    for (let j = i; j < end; j += 8192) bin += String.fromCharCode(...bytes.subarray(j, Math.min(end, j + 8192)));
    parts.push(btoa(bin));
  }
  return parts;
}

/** Setzt Standbild-Teile zusammen; Reihenfolge egal, doppelte Teile werden ignoriert, ein neues Bild (andere id) verwirft das alte. */
export class SnapshotAssembler {
  private id = -1;
  private parts = new Map<number, string>();
  private count = 0;
  width = 0;
  height = 0;
  fullWidth = 0;
  fullHeight = 0;

  add(m: Extract<Message, { t: 'snapshot' }>): Uint8Array | undefined {
    if (m.id !== this.id || m.count !== this.count) {
      this.id = m.id;
      this.count = m.count;
      this.parts.clear();
    }
    this.width = m.width;
    this.height = m.height;
    this.fullWidth = m.fullWidth;
    this.fullHeight = m.fullHeight;
    this.parts.set(m.index, m.data);
    if (this.parts.size < this.count) return undefined;
    const chunks = Array.from({ length: this.count }, (_, i) => atob(this.parts.get(i) as string));
    const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let o = 0;
    for (const c of chunks) for (let i = 0; i < c.length; i++) bytes[o++] = c.charCodeAt(i);
    this.parts.clear();
    this.id = -1;
    return bytes;
  }
}
