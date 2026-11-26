import { orientTransform, orientedSize, type Gray } from '../core';
import type { Frame, FrameSource } from './frameSource';

export interface CameraConfig {
  /** Ausschnitt [x, y, Breite, Höhe] im gedrehten/gespiegelten Bild. */
  crop: number[];
  rotate: number;
  mirror: boolean;
}

export interface Snapshot {
  blob: Blob;
  width: number;
  height: number;
  fullWidth: number;
  fullHeight: number;
}

/** Rückkamera des Handys per getUserMedia. Pro Videobild wird nur der Messausschnitt in Graustufen gelesen. */
export class CameraSource implements FrameSource {
  readonly live = true;
  /** Wird für jedes Bild aufgerufen (Kamera-Seite reicht es an den Worker weiter). */
  onFrame?: (f: Frame) => void;
  fps = 0;
  private latest: Frame | null = null;
  private config?: CameraConfig;
  private ctx?: CanvasRenderingContext2D;
  private canvas = document.createElement('canvas');
  private stopped = false;
  private count = 0;
  private since = performance.now();

  private constructor(
    readonly video: HTMLVideoElement,
    private readonly stream: MediaStream,
  ) {
    this.loop();
  }

  static async open(): Promise<CameraSource> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } },
    });
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    return new CameraSource(video, stream);
  }

  /** Was die Kamera tatsächlich liefert (Auflösung, Bildrate), unabhängig vom Wunsch. */
  get settings(): MediaTrackSettings {
    return this.stream.getVideoTracks()[0].getSettings();
  }

  get width(): number {
    return this.config?.crop[2] ?? this.video.videoWidth;
  }

  get height(): number {
    return this.config?.crop[3] ?? this.video.videoHeight;
  }

  setConfig(config: CameraConfig | undefined): void {
    this.config = config;
    this.latest = null;
    if (config) {
      this.canvas.width = config.crop[2];
      this.canvas.height = config.crop[3];
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    }
  }

  read(): Frame | null {
    const f = this.latest;
    this.latest = null;
    return f;
  }

  private loop(): void {
    const next = () => {
      if (this.stopped) return;
      this.tick();
      if ('requestVideoFrameCallback' in this.video) this.video.requestVideoFrameCallback(next);
      else requestAnimationFrame(next);
    };
    next();
  }

  private tick(): void {
    this.count++;
    const t = performance.now();
    if (t - this.since >= 1000) {
      this.fps = (this.count * 1000) / (t - this.since);
      this.count = 0;
      this.since = t;
    }
    const c = this.config;
    if (!c || !this.ctx || !this.video.videoWidth) return;
    const { videoWidth: w, videoHeight: h } = this.video;
    const ctx = this.ctx;
    ctx.setTransform(...orientTransform(w, h, c.rotate, c.mirror, c.crop));
    ctx.drawImage(this.video, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const [cw, ch] = [c.crop[2], c.crop[3]];
    const rgba = ctx.getImageData(0, 0, cw, ch).data;
    const data = new Uint8Array(cw * ch);
    for (let i = 0, j = 0; i < data.length; i++, j += 4) data[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
    const image: Gray = { data, width: cw, height: ch };
    this.latest = { image };
    this.onFrame?.({ image });
  }

  /** Aktuelles Bild im gedrehten Zustand als verkleinertes JPEG für die Bereichseinstellung am Notebook. */
  snapshot(maxSize: number, rotate: number, mirror: boolean): Promise<Snapshot> {
    const { videoWidth: w, videoHeight: h } = this.video;
    const [fullWidth, fullHeight] = orientedSize(w, h, rotate);
    const k = Math.min(1, maxSize / Math.max(fullWidth, fullHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(fullWidth * k);
    canvas.height = Math.round(fullHeight * k);
    const ctx = canvas.getContext('2d')!;
    const m = orientTransform(w, h, rotate, mirror);
    ctx.setTransform(m[0] * k, m[1] * k, m[2] * k, m[3] * k, m[4] * k, m[5] * k);
    ctx.drawImage(this.video, 0, 0);
    return new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve({ blob, width: canvas.width, height: canvas.height, fullWidth, fullHeight }) : reject(new Error('JPEG-Erzeugung fehlgeschlagen'))),
        'image/jpeg',
        0.7,
      ),
    );
  }

  dispose(): void {
    this.stopped = true;
    this.stream.getTracks().forEach((t) => t.stop());
  }
}
