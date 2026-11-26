import jsQR from 'jsqr';
import qrcode from 'qrcode-generator';

/** Zeichnet `text` als QR-Code (ECC M) mit ruhigem Rand auf das Canvas und liefert die QR-Version. */
export function drawQr(canvas: HTMLCanvasElement, text: string, size = 360): { version: number; bytes: number } {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4;
  const cell = Math.max(2, Math.floor(size / (n + 2 * quiet)));
  canvas.width = canvas.height = cell * (n + 2 * quiet);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
  return { version: (n - 17) / 4, bytes: new TextEncoder().encode(text).length };
}

/** Liest laufend QR-Codes aus einem Video, bis der Rückruf true liefert; gibt eine Stopp-Funktion zurück. */
export function scanQr(video: HTMLVideoElement, onCode: (text: string) => boolean | void): () => void {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    if (video.videoWidth) {
      const k = Math.min(1, 1000 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * k);
      canvas.height = Math.round(video.videoHeight * k);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      if (hit?.data && onCode(hit.data) === true) return;
    }
    setTimeout(tick, 120);
  };
  tick();
  return () => {
    stopped = true;
  };
}
