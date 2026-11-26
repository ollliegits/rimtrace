import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import type { Gray } from '../../src/core';

/** Liest den Ausschnitt [x, y, w, h] jedes Bildes einer Videodatei als Graustufen (ffmpeg-static, ohne Neuberechnung der Bildrate). */
export async function* readVideoGray(file: string, crop: [number, number, number, number]): AsyncGenerator<Gray> {
  const [x, y, width, height] = crop;
  const ff = spawn(
    ffmpegPath as string,
    ['-v', 'error', '-i', file, '-map', '0:v:0', '-vf', `crop=${width}:${height}:${x}:${y},format=gray`,
      '-f', 'rawvideo', '-pix_fmt', 'gray', '-vsync', 'passthrough', 'pipe:1'],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const size = width * height;
  let buf = Buffer.alloc(0);
  for await (const chunk of ff.stdout) {
    buf = Buffer.concat([buf, chunk as Buffer]);
    while (buf.length >= size) {
      yield { data: new Uint8Array(buf.subarray(0, size)), width, height };
      buf = buf.subarray(size);
    }
  }
}
