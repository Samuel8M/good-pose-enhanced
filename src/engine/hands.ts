import { HandLandmarker } from '@mediapipe/tasks-vision';
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import { distance, FriendlyError, type Box, type Photo, type Point } from './vision';

/*
 * Hands as objects in their own right. A prank like bunny ears is often done by someone hidden
 * behind the group, so the body the hand belongs to may not be visible at all. Hands are
 * therefore found directly (21 points each) and then related to the people: whose head they are
 * over, and, if a visible body reaches them, whose hand it is.
 */

export type Gesture = 'v-sign' | 'open' | 'point' | 'fist' | 'other';
export type Hand = { points: Point[]; box: Box; size: number; gesture: Gesture };

const HAND_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
let handsPromise: Promise<HandLandmarker> | undefined;

export function prepareHandModel() {
  handsPromise ??= HandLandmarker.createFromOptions({ wasmLoaderPath, wasmBinaryPath }, {
    baseOptions: { modelAssetPath: HAND_URL, delegate: 'CPU' },
    runningMode: 'IMAGE',
    numHands: 4,
    minHandDetectionConfidence: 0.45,
    minHandPresenceConfidence: 0.45,
  }).catch((error: unknown) => {
    handsPromise = undefined;
    console.error(error);
    throw new FriendlyError('The hand finder could not start. Please check your internet connection and try again.');
  });
  return handsPromise;
}

/** Extended fingers: tip clearly farther from the wrist than the knuckle is. */
function gestureOf(p: Point[]): Gesture {
  const extended = [[8, 5], [12, 9], [16, 13], [20, 17]].map(([tip, knuckle]) => distance(p[tip], p[0]) > distance(p[knuckle], p[0]) * 1.45);
  const [index, middle, ring, pinky] = extended;
  if (index && middle && !ring && !pinky) return 'v-sign';
  if (index && !middle && !ring && !pinky) return 'point';
  if (extended.every(Boolean)) return 'open';
  if (!extended.some(Boolean)) return 'fist';
  return 'other';
}

function boxOf(points: Point[]): Box {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/**
 * Finds hands in the whole photo and, at higher zoom, in the space around and above each face,
 * where small raised hands (bunny ears, waves, hands over faces) are.
 */
export async function findHands(photo: Photo): Promise<Hand[]> {
  const model = await prepareHandModel();
  const regions: Box[] = [{ x: 0, y: 0, w: photo.width, h: photo.height }];
  for (const face of photo.faces) {
    const b = face.box;
    const x = Math.max(0, b.x - b.w * 1.4), y = Math.max(0, b.y - b.h * 1.6);
    regions.push({ x, y, w: Math.min(photo.width, b.x + b.w * 2.4) - x, h: Math.min(photo.height, b.y + b.h * 1.4) - y });
  }
  const found: Hand[] = [];
  for (const region of regions) {
    const scale = Math.min(1, 768 / Math.max(region.w, region.h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(region.w * scale));
    canvas.height = Math.max(1, Math.round(region.h * scale));
    const context = canvas.getContext('2d')!;
    context.imageSmoothingQuality = 'high';
    context.drawImage(photo.bitmap, region.x, region.y, region.w, region.h, 0, 0, canvas.width, canvas.height);
    const result = model.detect(canvas);
    for (const landmarks of result.landmarks) {
      const points = landmarks.map((l) => ({ x: region.x + l.x * region.w, y: region.y + l.y * region.h }));
      const size = distance(points[0], points[9]) * 2;
      // The same hand seen in two overlapping regions: keep the first.
      if (found.some((h) => distance(h.points[0], points[0]) < h.size * 0.3)) continue;
      found.push({ points, box: boxOf(points), size, gesture: gestureOf(points) });
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return found;
}
