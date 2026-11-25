import type { Gray } from '../core/image';

export function drawGray(ctx: CanvasRenderingContext2D, image: Gray, buf: ImageData): void {
  const px = buf.data;
  const g = image.data;
  for (let i = 0, j = 0; i < g.length; i++, j += 4) {
    px[j] = px[j + 1] = px[j + 2] = g[i];
    px[j + 3] = 255;
  }
  ctx.putImageData(buf, 0, 0);
}

export function readGray(src: CanvasImageSource, ctx: CanvasRenderingContext2D, width: number, height: number): Gray {
  ctx.drawImage(src, 0, 0, width, height);
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const data = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < data.length; i++, j += 4) data[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  return { data, width, height };
}
