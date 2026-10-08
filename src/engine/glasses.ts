import { distance, type Face, type Point } from './vision';

/*
 * Glasses as a physical object on the face. The face tracker does not report glasses, so the
 * evidence is measured from what frames and lenses do to the image:
 *
 *  - Frames: a thin, high-contrast edge across the bridge of the nose (skin there is smooth),
 *    edges along the lower rims under the eyes, and the arms running toward the ears.
 *  - Lenses: glare is specular reflection (angle of incidence = angle of reflection), seen as
 *    near-white, unsaturated blobs over the eye area; tinted lenses make the eye area much
 *    darker than the cheek beside it.
 *
 * The result is stored as an object in the person's structured description (wears / glare-on /
 * tinted), so the problem finder can reason about it and fixes can leave frames in place.
 */

export type GlassesState = 'none' | 'clear' | 'glare' | 'tinted';
export type Glasses = {
  state: GlassesState;
  /** False when the face is too small to see frames reliably. */
  readable: boolean;
  /** 0..1 evidence that frames are present. */
  frames: number;
  /** Fraction of the lens area that is specular glare, per eye [right, left]. */
  glare: [number, number];
  /** Lens brightness ÷ cheek brightness (low = tinted). */
  tint: number;
  evidence: { bridge: number; rims: number; arms: number };
};

const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Grey image of a region, scaled so an eye is about 40 px wide. */
function sample(bitmap: ImageBitmap, face: Face) {
  const eyeWidth = distance(face.points[33], face.points[133]);
  const scale = 40 / Math.max(4, eyeWidth);
  const box = { x: face.box.x - face.box.w * 0.1, y: face.box.y - face.box.h * 0.05, w: face.box.w * 1.2, h: face.box.h * 1.1 };
  const w = Math.max(8, Math.round(box.w * scale)), h = Math.max(8, Math.round(box.h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, box.x, box.y, box.w, box.h, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  const sat = new Float32Array(w * h);
  for (let i = 0; i < lum.length; i += 1) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    sat[i] = max ? (max - min) / max : 0;
  }
  const toLocal = (p: Point) => ({ x: (p.x - box.x) * scale, y: (p.y - box.y) * scale });
  const at = (x: number, y: number) => lum[Math.max(0, Math.min(h - 1, Math.round(y))) * w + Math.max(0, Math.min(w - 1, Math.round(x)))];
  return { w, h, lum, sat, toLocal, at };
}

/**
 * Contrast of the sharpest thin straight line crossing a short scan. Each step is averaged
 * across the scan's width first, so straight lines (frames) survive while skin texture,
 * wrinkles and pores, which do not line up, wash out. `vertical` scans down (finds horizontal
 * lines); otherwise it scans across (finds upright lines).
 */
function lineAcross(at: (x: number, y: number) => number, centre: number, halfWidth: number, from: number, to: number, vertical = true, steps = 24) {
  const values: number[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = from + ((to - from) * i) / steps;
    let sum = 0;
    for (let k = -2; k <= 2; k += 1) sum += vertical ? at(centre + (halfWidth * k) / 2, t) : at(t, centre + (halfWidth * k) / 2);
    values.push(sum / 5);
  }
  let best = 0;
  // Lines of a few thicknesses: a fine metal rim to a thick plastic one.
  for (const gap of [2, 3, 4]) {
    for (let i = gap; i < values.length - gap; i += 1) {
      const a = values[i - gap], b = values[i + gap];
      if (Math.sign(values[i] - a) === Math.sign(values[i] - b)) best = Math.max(best, Math.min(Math.abs(values[i] - a), Math.abs(values[i] - b)));
    }
  }
  return best;
}

export function detectGlasses(bitmap: ImageBitmap, face: Face): Glasses {
  const { lum, sat, w, h, toLocal, at } = sample(bitmap, face);
  const P = (i: number) => toLocal(face.points[i]);
  const eyeR = mid(P(33), P(133)), eyeL = mid(P(362), P(263));
  const ew = Math.max(4, distance(P(33), P(133)));
  // Skin texture for normalising: spread of brightness on the cheeks.
  const cheekStats = (c: Point) => {
    const vals: number[] = [];
    for (let dy = -4; dy <= 4; dy += 2) for (let dx = -4; dx <= 4; dx += 2) vals.push(at(c.x + dx, c.y + dy));
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    return { mean, sd: Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length) };
  };
  const cheekR = cheekStats(P(50)), cheekL = cheekStats(P(280));
  const skin = Math.max(6, (cheekR.sd + cheekL.sd) / 2 + 4);
  // Bridge: vertical line over the top of the nose between the eyes.
  const nasion = mid(P(133), P(362));
  const bridge = lineAcross(at, nasion.x, ew * 0.18, nasion.y - ew * 0.5, nasion.y + ew * 0.4) / skin;
  // Lower rims: vertical lines from just below each eye down toward the cheek.
  const rim = (eye: Point) => lineAcross(at, eye.x, ew * 0.3, eye.y + ew * 0.3, eye.y + ew * 1.0) / skin;
  const rims = (rim(eyeR) + rim(eyeL)) / 2;
  // Outer rims: upright lines just outside each outer eye corner.
  const outer = (corner: Point, edge: Point) => {
    const dir = Math.sign(edge.x - corner.x) || 1;
    return lineAcross(at, corner.y, ew * 0.2, corner.x + dir * ew * 0.1, corner.x + dir * ew * 0.75, false) / skin;
  };
  const arms = (outer(P(33), P(234)) + outer(P(263), P(454))) / 2;
  // The bridge is the telling part: a straight line across the top of the nose that skin never
  // makes. Lower rims add to it (half-rim frames have none; eye bags make weak ones).
  const frames = Math.max(0, Math.min(1, (bridge + 0.25 * Math.max(0, rims - 1.5) + 0.3 * Math.max(0, arms - 1.5) - 0.8) / 0.9));

  // Lens area: an ellipse around each eye, roughly the size of a lens.
  const cheek = (cheekR.mean + cheekL.mean) / 2;
  // Specular glare: brighter than the lit skin and nearly colourless (light reflects off the
  // lens surface, not through it). The white of the eye is excluded; it is bright too.
  const glareLevel = Math.min(250, Math.max(cheek * 1.3, cheek + 40));
  const lens = (eye: Point, outer: Point, inner: Point, upper: Point, lower: Point) => {
    const openW = distance(outer, inner) / 2 + 1, openH = Math.max(1, distance(upper, lower) / 2) + 1;
    let n = 0, sum = 0, glare = 0;
    for (let y = Math.floor(eye.y - ew * 0.55); y <= eye.y + ew * 0.6; y += 1) {
      for (let x = Math.floor(eye.x - ew * 0.95); x <= eye.x + ew * 0.95; x += 1) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        if (((x - eye.x) / (ew * 0.95)) ** 2 + ((y - eye.y) / (ew * 0.6)) ** 2 > 1) continue;
        const i = y * w + x;
        n += 1;
        sum += lum[i];
        if (((x - eye.x) / openW) ** 2 + ((y - eye.y) / openH) ** 2 <= 1) continue;
        if (lum[i] >= glareLevel && sat[i] < 0.15) glare += 1;
      }
    }
    return { mean: n ? sum / n : 0, glare: n ? glare / n : 0 };
  };
  const lr = lens(eyeR, P(33), P(133), P(159), P(145)), ll = lens(eyeL, P(263), P(362), P(386), P(374));
  const tint = ((lr.mean + ll.mean) / 2) / Math.max(1, cheek);
  const glare: [number, number] = [lr.glare, ll.glare];
  // Below about 60 px across, frames are only a pixel or two thick and cannot be told from skin.
  const readable = face.size >= 60;
  return { state: stateOf(readable, frames, glare, tint), readable, frames, glare, tint, evidence: { bridge, rims, arms } };
}

function stateOf(readable: boolean, frames: number, glare: [number, number], tint: number): GlassesState {
  if (!readable) return 'none';
  // Dark lenses, not just shadowed eye sockets: either very dark, or dark with frames seen.
  if (tint < 0.3 || (tint < 0.45 && frames >= 0.3)) return 'tinted';
  if (frames >= 0.5) return Math.max(...glare) > 0.04 ? 'glare' : 'clear';
  return 'none';
}

/**
 * Glasses are a lasting object: someone wearing them in one shot of a moment wears them in the
 * next. So the frame evidence is pooled over every shot of the same person (glare and tint stay
 * per shot, since they change with the angle of the head).
 */
export function pooled(own: Glasses, sameperson: Glasses[]): Glasses {
  const all = [own, ...sameperson].filter((x) => x.readable);
  if (!own.readable || all.length < 2) return own;
  const frames = all.reduce((s, x) => s + x.frames, 0) / all.length;
  return { ...own, frames, state: stateOf(true, frames, own.glare, own.tint) };
}
