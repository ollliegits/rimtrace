import type { Frame, FrameSource } from './frameSource';
import { readGray } from './gray';

const QUEUE_MAX = 8;
const QUEUE_RESUME = 4;

type Truth = { lateral: number[]; height: number[] };

/**
 * Videodatei als Bildquelle: <video> → Canvas → Graustufen, jedes dargestellte Bild genau einmal.
 * Mit `crop` [x, y, Breite, Höhe] wird nur der Ausschnitt gelesen (echte Aufnahmen).
 */
export class VideoFileSource implements FrameSource {
  readonly live = true;
  private readonly queue: Frame[] = [];
  private readonly ctx: CanvasRenderingContext2D;
  private paused = false;
  private cropRect?: number[];

  private constructor(
    private readonly video: HTMLVideoElement,
    private readonly url: string,
    readonly videoWidth: number,
    readonly videoHeight: number,
    private readonly truth?: Truth,
  ) {
    const canvas = document.createElement('canvas');
    canvas.width = videoWidth;
    canvas.height = videoHeight;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    this.watch();
    void this.video.play();
  }

  static async open(file: Blob, truth?: Truth): Promise<VideoFileSource> {
    const video = document.createElement('video');
    if (!('requestVideoFrameCallback' in video)) throw new Error('Browser unterstützt requestVideoFrameCallback nicht');
    video.muted = true;
    video.playsInline = true;
    const url = URL.createObjectURL(file);
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Video konnte nicht geladen werden'));
    });
    return new VideoFileSource(video, url, video.videoWidth, video.videoHeight, truth);
  }

  get width(): number {
    return this.cropRect ? this.cropRect[2] : this.videoWidth;
  }

  get height(): number {
    return this.cropRect ? this.cropRect[3] : this.videoHeight;
  }

  get crop(): number[] | undefined {
    return this.cropRect;
  }

  /** Liefert danach nur noch den Ausschnitt; bereits gepufferte Bilder werden verworfen. */
  setCrop(crop: number[] | undefined): void {
    this.cropRect = crop;
    this.queue.length = 0;
  }

  get finished(): boolean {
    return this.video.ended && this.queue.length === 0;
  }

  private watch(): void {
    const onFrame = () => {
      this.queue.push({ image: readGray(this.video, this.ctx, this.videoWidth, this.videoHeight, this.cropRect) });
      // Auswertung hinkt hinterher: Video anhalten, statt Bilder zu verlieren
      if (this.queue.length >= QUEUE_MAX) this.video.pause();
      this.video.requestVideoFrameCallback(onFrame);
    };
    this.video.requestVideoFrameCallback(onFrame);
  }

  read(): Frame | null {
    const frame = this.queue.shift() ?? null;
    if (this.queue.length < QUEUE_RESUME && this.video.paused && !this.paused && !this.video.ended) void this.video.play();
    return frame;
  }

  groundTruth() {
    return this.truth;
  }

  restart(): void {
    this.queue.length = 0;
    this.video.currentTime = 0;
    if (!this.paused) void this.video.play();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.video.pause();
    else if (!this.video.ended) void this.video.play();
  }

  dispose(): void {
    this.video.pause();
    this.video.removeAttribute('src');
    URL.revokeObjectURL(this.url);
  }
}
