export type Rotate = 0 | 90 | 180 | 270;
export type Matrix = [number, number, number, number, number, number];

/** Größe des Bildes nach dem Drehen. */
export function orientedSize(w: number, h: number, rotate: number): [number, number] {
  return rotate === 90 || rotate === 270 ? [h, w] : [w, h];
}

/**
 * Canvas-Matrix (a, b, c, d, e, f für `setTransform`), die ein Videobild w×h um `rotate` Grad im Uhrzeigersinn dreht,
 * optional waagerecht spiegelt und so verschiebt, dass der Ausschnitt `crop` = [x, y, Breite, Höhe] (im gedrehten Bild)
 * bei (0, 0) beginnt.
 */
export function orientTransform(w: number, h: number, rotate: number, mirror: boolean, crop: number[] = [0, 0]): Matrix {
  let m: Matrix;
  if (rotate === 90) m = [0, 1, -1, 0, h, 0];
  else if (rotate === 180) m = [-1, 0, 0, -1, w, h];
  else if (rotate === 270) m = [0, -1, 1, 0, 0, w];
  else m = [1, 0, 0, 1, 0, 0];
  const [ow] = orientedSize(w, h, rotate);
  if (mirror) m = [0 - m[0], m[1], 0 - m[2], m[3], ow - m[4], m[5]];
  return [m[0], m[1], m[2], m[3], m[4] - crop[0], m[5] - crop[1]];
}

/** Dasselbe auf Graustufen (für Tests ohne Canvas): liest den gedrehten/gespiegelten Ausschnitt aus einem Videobild. */
export function orientCrop(
  src: { data: Uint8Array; width: number; height: number },
  rotate: number,
  mirror: boolean,
  crop: [number, number, number, number],
): { data: Uint8Array; width: number; height: number } {
  const [a, b, c, d, e, f] = orientTransform(src.width, src.height, rotate, mirror, crop);
  const det = a * d - b * c;
  const [, , cw, ch] = crop;
  const data = new Uint8Array(cw * ch);
  for (let v = 0; v < ch; v++) {
    for (let u = 0; u < cw; u++) {
      const px = u + 0.5 - e;
      const py = v + 0.5 - f;
      const x = (d * px - c * py) / det;
      const y = (-b * px + a * py) / det;
      data[v * cw + u] = src.data[Math.floor(y) * src.width + Math.floor(x)];
    }
  }
  return { data, width: cw, height: ch };
}
