import { createGenerator, type ScenarioName } from '../generator';
import { drawGray } from './gray';

const MIME_TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];

/** Nimmt einen synthetischen Feed in Echtzeit per Canvas-Aufnahme (MediaRecorder) als Testvideo auf. */
export async function recordTestVideo(
  scenario: ScenarioName,
  seconds: number,
  onProgress: (frame: number, total: number) => void,
): Promise<{ blob: Blob; truth: { lateral: number[]; height: number[] } }> {
  const mimeType = MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
  if (!mimeType) throw new Error('MediaRecorder unterstützt kein Videoformat');

  // Gleichmäßige Szenarien drehen schneller als der Standard, damit wenige Sekunden mehrere Umdrehungen ergeben
  const gen = createGenerator(scenario, { spokesPerSecond: 8 });
  const { width, height } = gen.setup;
  const fps = gen.config.fps;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const buf = ctx.createImageData(width, height);

  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 40_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));

  const total = Math.round(seconds * fps);
  drawGray(ctx, gen.next().image, buf);
  recorder.start();
  track.requestFrame?.();
  const t0 = performance.now();
  for (let i = 1; i <= total; i++) {
    const wait = t0 + (i * 1000) / fps - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    drawGray(ctx, gen.next().image, buf);
    track.requestFrame?.();
    onProgress(i, total);
  }
  recorder.stop();
  await stopped;
  return { blob: new Blob(chunks, { type: mimeType }), truth: gen.truthAtSpokes() };
}
