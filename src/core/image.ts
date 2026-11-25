export interface Gray {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface Levels {
  lo: number;
  hi: number;
}

/** Spaltenprofil: Mittel über die Zeilen [y0, y1). */
export function meanRows(img: Gray, y0: number, y1: number): Float64Array {
  const { data, width } = img;
  const out = new Float64Array(width);
  for (let y = y0; y < y1; y++) {
    const o = y * width;
    for (let x = 0; x < width; x++) out[x] += data[o + x];
  }
  const n = y1 - y0;
  for (let x = 0; x < width; x++) out[x] /= n;
  return out;
}

export function rowLine(img: Gray, y: number): Float64Array {
  const { data, width } = img;
  const out = new Float64Array(width);
  const o = y * width;
  for (let x = 0; x < width; x++) out[x] = data[o + x];
  return out;
}

export function columnLine(img: Gray, x: number, y0: number, y1: number): Float64Array {
  const { data, width } = img;
  const out = new Float64Array(y1 - y0);
  for (let y = y0; y < y1; y++) out[y - y0] = data[y * width + x];
  return out;
}

/** Dunkel-/Hellpegel aus dem 2-%- und 98-%-Perzentil eines Teilrasters. */
export function levels(img: Gray, step = 3): Levels {
  const { data, width, height } = img;
  const hist = new Uint32Array(256);
  let n = 0;
  for (let y = 0; y < height; y += step) {
    const o = y * width;
    for (let x = 0; x < width; x += step) {
      hist[data[o + x]]++;
      n++;
    }
  }
  const pick = (q: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= q * n) return v;
    }
    return 255;
  };
  return { lo: pick(0.02), hi: pick(0.98) };
}
