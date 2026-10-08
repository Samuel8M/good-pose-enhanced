import { applyShift, rankEntityCandidates, type Mapping, type Shift } from './analogy';
import { pooled, type Glasses } from './glasses';
import type { Hand } from './hands';
import { rankCandidates, type Match } from './match';
import type { Entity, Scene } from './scene';
import { FIXES, PROBLEMS, roleOf, type FixId, type Purpose, type Role, type SchemaId } from './schemas';
import { distance, type Box, type Face, type Photo, type Point } from './vision';

export type { Purpose } from './schemas';

/*
 * Finding what is wrong with a photo by comparison, the way people do, for every kind of thing
 * in it (people, faces, hands, glasses, animals, things being held, passers-by).
 *
 * A "bad" take is rarely bad in itself: closed eyes, a raised arm or a pulled face are only
 * wrong when everyone else in the shot is doing something else. So each construct is described
 * along the same dimensions, aligned with the others, and the problems are the *alignable
 * differences*: the same dimension with a different value (Markman & Gentner, 1993; Gentner &
 * Markman, 1994). There are two axes of comparison:
 *
 *  - across the group in one shot (is this person doing what everyone else is doing?), and
 *  - across shots of the same construct (is the dog sharper in the next shot? is this person in
 *    the other shots at all?).
 *
 * The group's shared values are its norm. When the group itself agrees on something unusual
 * (everyone pulling faces, everyone raising a glass), that is what the photo is *for*, so it is
 * not a problem: problems are judged by purpose, not surface, as Analogical Engines separates
 * purpose from mechanism. Every problem is an instance of an abstract problem schema
 * (schemas.ts), whose fix mechanisms are tried least-intervention first, each only after its
 * critical questions are checked against the other shot.
 */

export type Dim = 'eyes' | 'gaze' | 'head' | 'mouth' | 'glasses' | 'redeye' | 'blur' | 'covered' | 'arms' | 'hands' | 'lean' | 'presence';
export type Level = 'face' | 'person';

type ValueInfo = { text: string; weight: number; schema: SchemaId; purpose?: Purpose };
type DimInfo = {
  level: Level;
  /** Values that are never a problem. */
  good: string[];
  /** Values that are a problem even if others share them. */
  always: string[];
  purpose: Purpose;
  values: Record<string, ValueInfo>;
  /** How to say "the others are like this". */
  norm: Record<string, string>;
};

export const DIMS: Record<Dim, DimInfo> = {
  eyes: {
    level: 'face', good: ['open'], always: ['closed', 'half'], purpose: 'look-their-best',
    values: {
      closed: { text: 'Eyes closed', weight: 1, schema: 'closure' },
      half: { text: 'Eyes half-closed', weight: 0.55, schema: 'closure' },
      wink: { text: 'Winking', weight: 0.5, schema: 'odd-action', purpose: 'behave' },
    },
    norm: { open: "everyone else's eyes are open" },
  },
  gaze: {
    level: 'face', good: ['camera'], always: [], purpose: 'pay-attention',
    values: { away: { text: 'Looking away', weight: 0.5, schema: 'attention' }, down: { text: 'Looking down', weight: 0.45, schema: 'attention' } },
    norm: { camera: 'everyone else is looking at the camera', away: 'the others are looking away too', down: 'the others are looking down too' },
  },
  head: {
    level: 'person', good: ['toward'], always: [], purpose: 'pay-attention',
    values: { turned: { text: 'Head turned away', weight: 0.5, schema: 'attention' } },
    norm: { toward: 'everyone else faces the camera', turned: 'the others are turned too' },
  },
  mouth: {
    level: 'face', good: ['smile', 'closed'], always: [], purpose: 'look-their-best',
    values: {
      open: { text: 'Mouth open mid-word', weight: 0.4, schema: 'odd-action' },
      goofy: { text: 'Pulling a face', weight: 0.7, schema: 'odd-action', purpose: 'behave' },
      frown: { text: 'Frowning', weight: 0.3, schema: 'odd-action' },
    },
    norm: { smile: 'everyone else is smiling', closed: "everyone else's mouth is closed", goofy: 'the others are pulling faces too', open: 'the others are talking too' },
  },
  glasses: {
    level: 'face', good: ['none', 'clear', 'tinted'], always: ['glare'], purpose: 'picture-quality',
    values: { glare: { text: 'Glare on their glasses hides their eyes', weight: 0.6, schema: 'specular' } },
    norm: {},
  },
  redeye: {
    level: 'face', good: ['none'], always: ['red'], purpose: 'look-their-best',
    values: { red: { text: 'Red eyes from the flash', weight: 0.6, schema: 'retroreflection' } },
    norm: {},
  },
  blur: {
    level: 'face', good: ['sharp'], always: ['blurred'], purpose: 'picture-quality',
    values: { blurred: { text: 'Blurry (they moved)', weight: 0.7, schema: 'motion' } },
    norm: { sharp: 'everyone else is sharp' },
  },
  covered: {
    level: 'person', good: ['clear'], always: [], purpose: 'look-their-best',
    values: {
      hand: { text: 'Hand over their face', weight: 0.8, schema: 'occlusion' },
      object: { text: 'Something in front of their face', weight: 0.7, schema: 'occlusion' },
    },
    norm: { clear: "everyone else's face is clear", object: 'the others are doing it too' },
  },
  arms: {
    level: 'person', good: ['down'], always: [], purpose: 'pose',
    values: { raised: { text: 'Arm up in the air', weight: 0.6, schema: 'odd-action' } },
    norm: { down: "everyone else's arms are down", raised: 'the others have their arms up too' },
  },
  hands: {
    level: 'person', good: ['free'], always: [], purpose: 'behave',
    values: {
      'over-someone': { text: "Hand up behind someone's head (bunny ears?)", weight: 0.9, schema: 'odd-action' },
      'under-hand': { text: "Someone's hand is up behind their head (bunny ears?)", weight: 0.9, schema: 'odd-action' },
    },
    norm: { free: 'nobody else is doing that' },
  },
  lean: {
    level: 'person', good: ['upright'], always: [], purpose: 'pose',
    values: { leaning: { text: 'Leaning over', weight: 0.4, schema: 'odd-action' } },
    norm: { upright: 'everyone else is standing straight', leaning: 'the others are leaning too' },
  },
  presence: {
    level: 'person', good: ['member'], always: ['passer-by'], purpose: 'only-the-group',
    values: { 'passer-by': { text: "Not part of the group (only in this shot, facing elsewhere)", weight: 0.8, schema: 'intrusion' } },
    norm: {},
  },
};

/** The purpose a value serves: its own if it has one (a goofy face is about behaving), else its dimension's. */
export const purposeOf = (dim: Dim, value: string): Purpose => DIMS[dim].values[value]?.purpose ?? DIMS[dim].purpose;
export const schemaOf = (dim: Dim, value: string): SchemaId => DIMS[dim].values[value]?.schema ?? 'odd-action';

/** Purposes a person would recognise, for explanations. */
export const PURPOSE_TEXT: Record<Purpose, string> = {
  'look-their-best': 'everyone looking their best',
  'pay-attention': 'everyone looking at the camera',
  behave: 'nobody goofing off',
  pose: 'everyone posing the same way',
  'picture-quality': 'a clear picture',
  'only-the-group': 'only the people the photo is of',
};

/** One construct (a person, or an animal) in one shot, described along every dimension it can see. */
export type Take = {
  key: string;
  photoId: string;
  kind: 'person' | 'animal';
  role: Role;
  label: string;
  face?: Face;
  entity?: Entity;
  glasses?: Glasses;
  values: Partial<Record<Dim, string>>;
  /** How far toward bad each measured dimension is (0 = fine, 1 = clearly bad), for comparing takes. */
  badness: Partial<Record<Dim, number>>;
  /** For 'over-someone': whose head the hand is over. */
  victim?: string;
  /** For 'over-someone' / 'under-hand' / a covering hand: the hand itself, if it was found. */
  hand?: Hand;
  /** For 'covered: object': what is in front of the face. */
  cover?: string;
};

/** What is known about one shot while describing the constructs in it. */
export type Shot = {
  photo: Photo;
  scene?: Scene;
  everyone: Construct[];
  hands: Hand[];
  /** Typical face sharpness in the main shot, so blur is judged relative to the camera. */
  sharpNorm: number;
  glassesOf: (face: Face, photo: Photo) => Glasses;
};
type Construct = { key: string; kind: 'person' | 'animal'; face?: Face; entity?: Entity };

export type Problem = {
  dim: Dim;
  value: string;
  schema: SchemaId;
  weight: number;
  /** The group's value it differs from, or undefined when judged against the prior schema. */
  norm?: string;
  /** How many others share the norm, out of how many could be seen. */
  agree: number;
  of: number;
  text: string;
  why: string;
};

export type Check = { text: string; ok: boolean };
/** One way of putting things right, with the critical questions it passed. */
export type Fix = {
  id: FixId;
  /** The other shot it takes from (none for a recolour). */
  photo?: Photo;
  resolves: Problem[];
  why: string;
  checks: Check[];
  face?: Face;
  donorFace?: Face;
  mode?: 'face' | 'lenses';
  donorEntity?: Entity;
  /** For 'area' and 'erase': what to restore from `photo`, lined up by `shift`. */
  area?: Box;
  keep?: Box;
  entity?: Entity;
  shift?: Shift;
};

export type PersonReport = {
  take: Take;
  problems: Problem[];
  /** Differences that are fine here (the group agrees on a playful value, etc.). */
  notes: string[];
  fixes: Fix[];
  /** Problems no fix could be found for, and why. */
  unresolved: Problem[];
  noFix?: string;
};

export type Report = {
  people: PersonReport[];
  /** What the photo seems to be for, when the group agrees on something unusual. */
  purpose: string[];
};

const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
const ex = (face: Face, name: string) => face.expression?.[name] ?? 0;
const visible = (entity: Entity, i: number) => (entity.pose?.visibility[i] ?? 0) > 0.5;
const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
/** The middle of a face, eyes to mouth: what a cover has to hide to matter. */
const faceMiddle = (face: Face): Box => ({ x: face.box.x + face.box.w * 0.15, y: face.box.y + face.box.h * 0.25, w: face.box.w * 0.7, h: face.box.h * 0.6 });

/** Every person and animal in a shot: faces (with their body, if found), bodies whose face was not found, and animals. */
export function constructsIn(photo: Photo, scene: Scene | undefined): Construct[] {
  const all: Construct[] = [];
  for (const face of photo.faces) {
    const entity = scene?.entities.find((x) => x.faceId === face.id);
    all.push({ key: entity?.id ?? face.id, kind: 'person', face, entity });
  }
  for (const entity of scene?.entities ?? []) {
    if (entity.kind === 'person' && !entity.faceId) all.push({ key: entity.id, kind: 'person', entity });
    else if (entity.kind === 'object' && roleOf(entity.label) === 'companion') all.push({ key: entity.id, kind: 'animal', entity });
  }
  return all;
}

/** Is the raised hand over this face's head: fingers just above the forehead, within its width? */
function handOverHead(hand: Hand, face: Face) {
  const b = face.box;
  const tips = [8, 12].map((i) => hand.points[i]);
  const above = tips.some((t) => t.x > b.x - b.w * 0.25 && t.x < b.x + b.w * 1.25 && t.y > b.y - b.h * 1.0 && t.y < b.y + b.h * 0.3);
  const raised = tips.every((t) => t.y < hand.points[0].y) && hand.points[0].y < b.y + b.h;
  return above && raised && distance(hand.points[9], face.center) > face.size * 0.45;
}

/** Whose visible body reaches this hand, if anyone's. */
function ownerOf(hand: Hand, everyone: Construct[]) {
  let best: { key: string; d: number } | undefined;
  for (const person of everyone) {
    const pose = person.entity?.pose;
    if (!pose) continue;
    for (const i of [15, 16, 19, 20]) {
      if (pose.visibility[i] < 0.4) continue;
      const d = distance(pose.points[i], hand.points[0]);
      if (d < hand.size * 0.9 && (!best || d < best.d)) best = { key: person.key, d };
    }
  }
  return best?.key;
}

const redCache = new Map<string, number>();
/**
 * Share of each pupil that is flash-red (retroreflection off the retina), the larger of the two.
 * Measured in a small circle at each eye's centre.
 */
function redEye(bitmap: ImageBitmap, face: Face) {
  const cached = redCache.get(face.id);
  if (cached !== undefined) return cached;
  let worst = 0;
  for (const [a, b, top, bottom] of [[33, 133, 159, 145], [263, 362, 386, 374]]) {
    const p = face.points;
    const c = { x: (p[a].x + p[b].x) / 2, y: (p[top].y + p[bottom].y) / 2 };
    const r = Math.max(2, distance(p[a], p[b]) * 0.16);
    const side = Math.ceil(r * 2);
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(bitmap, c.x - r, c.y - r, side, side, 0, 0, side, side);
    const data = context.getImageData(0, 0, side, side).data;
    let red = 0, n = 0;
    for (let y = 0; y < side; y += 1) {
      for (let x = 0; x < side; x += 1) {
        if ((x - r) ** 2 + (y - r) ** 2 > r * r) continue;
        const i = (y * side + x) * 4;
        n += 1;
        if (data[i] > 90 && data[i] > 1.8 * data[i + 1] && data[i] > 1.8 * data[i + 2]) red += 1;
      }
    }
    worst = Math.max(worst, n ? red / n : 0);
  }
  redCache.set(face.id, worst);
  return worst;
}

const sharpCache = new Map<string, number>();
/** Fine detail inside a thing's outline (variance of the Laplacian), at a fixed working size. */
export function entitySharpness(photo: Photo, entity: Entity) {
  const cached = sharpCache.get(entity.id);
  if (cached !== undefined) return cached;
  const b = entity.box;
  const scale = 256 / Math.max(b.w, b.h);
  const w = Math.max(8, Math.round(b.w * scale)), h = Math.max(8, Math.round(b.h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(photo.bitmap, b.x, b.y, b.w, b.h, 0, 0, w, h);
  const data = context.getImageData(0, 0, w, h).data;
  const lum = (x: number, y: number) => { const i = (y * w + x) * 4; return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; };
  const m = entity.mask;
  let sum = 0, squared = 0, n = 0;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const px = b.x + x / scale, py = b.y + y / scale;
      const mx = Math.floor(((px - m.box.x) / m.box.w) * m.width), my = Math.floor(((py - m.box.y) / m.box.h) * m.height);
      if (mx < 0 || my < 0 || mx >= m.width || my >= m.height || m.data[my * m.width + mx] < 0.5) continue;
      const v = lum(x - 1, y) + lum(x + 1, y) + lum(x, y - 1) + lum(x, y + 1) - 4 * lum(x, y);
      sum += v; squared += v * v; n += 1;
    }
  }
  const value = n > 30 ? squared / n - (sum / n) ** 2 : 0;
  sharpCache.set(entity.id, value);
  return value;
}

/** Describes one construct in one shot along every dimension the shot lets us see. */
export function describeTake(construct: Construct, shot: Shot): Take {
  const { photo, everyone, sharpNorm, glassesOf } = shot;
  const { face, entity } = construct;
  const values: Partial<Record<Dim, string>> = {};
  const badness: Partial<Record<Dim, number>> = {};
  const take: Take = {
    key: construct.key, photoId: photo.id, kind: construct.kind, role: construct.kind === 'animal' ? 'companion' : 'subject',
    label: entity?.label ?? 'person', face, entity, values, badness,
  };
  if (construct.kind === 'animal') return take; // judged across shots (motion), see findProblems

  if (face && face.size >= 60) {
    const blinkL = ex(face, 'eyeBlinkLeft'), blinkR = ex(face, 'eyeBlinkRight');
    if (Math.abs(blinkL - blinkR) > 0.45 && Math.min(blinkL, blinkR) < 0.3) values.eyes = 'wink';
    // A big smile squints the eyes nearly shut, so closed needs a stricter reading then, and
    // "half-closed" only counts without a smile.
    else values.eyes = face.eyesOpen < (face.smile > 0.6 ? 0.15 : 0.35) ? 'closed' : face.eyesOpen < 0.5 && face.smile < 0.35 ? 'half' : 'open';
    badness.eyes = values.eyes === 'wink' ? 1 : 1 - face.eyesOpen;
    if (values.eyes === 'open') {
      const side1 = (ex(face, 'eyeLookOutLeft') + ex(face, 'eyeLookInRight')) / 2;
      const side2 = (ex(face, 'eyeLookInLeft') + ex(face, 'eyeLookOutRight')) / 2;
      const up = (ex(face, 'eyeLookUpLeft') + ex(face, 'eyeLookUpRight')) / 2;
      const down = (ex(face, 'eyeLookDownLeft') + ex(face, 'eyeLookDownRight')) / 2;
      values.gaze = Math.max(side1, side2, up) > 0.55 ? 'away' : down > 0.6 ? 'down' : 'camera';
      badness.gaze = Math.max(side1 / 0.55, side2 / 0.55, up / 0.55, down / 0.6);
      const red = redEye(photo.bitmap, face);
      values.redeye = red > 0.2 ? 'red' : 'none';
      badness.redeye = red / 0.2;
    }
    const pucker = ex(face, 'mouthPucker'), funnel = ex(face, 'mouthFunnel'), puff = ex(face, 'cheekPuff');
    const tongue = ex(face, 'tongueOut'), sideways = Math.max(ex(face, 'mouthLeft'), ex(face, 'mouthRight'));
    const jaw = ex(face, 'jawOpen'), browsUp = ex(face, 'browInnerUp');
    const frown = (ex(face, 'mouthFrownLeft') + ex(face, 'mouthFrownRight')) / 2;
    if (pucker > 0.6 || funnel > 0.45 || puff > 0.45 || tongue > 0.4 || sideways > 0.5 || (jaw > 0.5 && browsUp > 0.6)) values.mouth = 'goofy';
    else if (face.smile > 0.35) values.mouth = 'smile';
    else if (jaw > 0.35) values.mouth = 'open';
    else if (frown > 0.4) values.mouth = 'frown';
    else values.mouth = 'closed';
    badness.mouth = Math.max(pucker / 0.6, funnel / 0.45, puff / 0.45, tongue / 0.4, sideways / 0.5, face.smile > 0.35 ? 0 : jaw / 0.35);
    if (sharpNorm > 0.05) {
      values.blur = face.sharpness < sharpNorm * 0.45 ? 'blurred' : 'sharp';
      badness.blur = 1 - face.sharpness / sharpNorm;
    }
    take.glasses = glassesOf(face, photo);
    if (take.glasses.readable) values.glasses = take.glasses.state;
    badness.glasses = Math.max(...take.glasses.glare) / 0.04;
  }
  if (face) {
    values.head = Math.abs(face.yaw) > 0.35 ? 'turned' : 'toward';
    badness.head = Math.abs(face.yaw) / 0.35;
    // Occlusion: a hand or a held thing over the middle of the face.
    const middle = faceMiddle(face);
    const area = middle.w * middle.h;
    const byHand = shot.hands.filter((h) => !everyone.some((o) => o.face && handOverHead(h, o.face))).map((h) => ({ h, f: overlap(h.box, middle) / area })).sort((a, b) => b.f - a.f)[0];
    const props = (shot.scene?.entities ?? []).filter((x) => x.kind === 'object' && roleOf(x.label) === 'prop');
    const byObject = props.map((x) => ({ x, f: overlap(x.box, middle) / area })).sort((a, b) => b.f - a.f)[0];
    values.covered = 'clear';
    badness.covered = Math.max(byHand?.f ?? 0, byObject?.f ?? 0) / 0.2;
    if (byHand && byHand.f > 0.2) {
      values.covered = 'hand';
      take.hand = byHand.h;
    } else if (byObject && byObject.f > 0.2) {
      values.covered = 'object';
      take.cover = byObject.x.label;
    }
  }

  const pose = entity?.pose;
  if (entity && pose && visible(entity, 11) && visible(entity, 12)) {
    const p = pose.points;
    const shoulders = distance(p[11], p[12]);
    // Up in the air means above the top of the head; a hand at head height is usually holding
    // something (a flag corner, a sign) or resting on someone.
    const headTop = face ? face.box.y - face.box.h * 0.05 : p[0].y - shoulders * 0.6;
    const wrists = [15, 16, 19, 20].filter((i) => visible(entity, i)).map((i) => p[i]);
    values.arms = wrists.some((h) => h.y < headTop) ? 'raised' : 'down';
    values.hands = 'free';
    if (face && values.covered === 'clear' && wrists.some((h) => distance(h, face.center) < face.size * 0.55)) values.covered = 'hand';
    // A hand over someone else's head: just above their forehead, within their width.
    for (const other of everyone) {
      if (other.key === construct.key || !other.face) continue;
      const b = other.face.box;
      const over = (h: Point) => h.x > b.x - b.w * 0.15 && h.x < b.x + b.w * 1.15 && h.y > b.y - b.h * 0.9 && h.y < b.y + b.h * 0.3;
      if (wrists.some(over) && (!face || wrists.filter(over).every((h) => distance(h, face.center) > face.size * 0.8))) {
        values.hands = 'over-someone';
        take.victim = other.key;
        take.hand = shot.hands.find((h) => ownerOf(h, everyone) === construct.key && handOverHead(h, other.face!));
        break;
      }
    }
    if (visible(entity, 23) && visible(entity, 24)) {
      const hip = { x: (p[23].x + p[24].x) / 2, y: (p[23].y + p[24].y) / 2 };
      const top = { x: (p[11].x + p[12].x) / 2, y: (p[11].y + p[12].y) / 2 };
      const tilt = Math.abs(Math.atan2(top.x - hip.x, hip.y - top.y));
      values.lean = tilt > (20 * Math.PI) / 180 ? 'leaning' : 'upright';
    }
  }
  // Hands found on their own: one held up over someone's head.
  for (const h of shot.hands) {
    const owner = ownerOf(h, everyone);
    if (owner === construct.key && values.hands !== 'over-someone') {
      const target = everyone.find((o) => o.key !== construct.key && o.face && handOverHead(h, o.face));
      if (target) {
        values.hands = 'over-someone';
        take.victim = target.key;
        take.hand = h;
      }
    }
    // Nobody visible owns it (the prankster is hidden behind): it is this person's problem.
    if (!owner && face && handOverHead(h, face) && values.hands !== 'over-someone') {
      values.hands = 'under-hand';
      take.hand = h;
    }
  }
  if (values.hands === 'over-someone') values.arms = 'down'; // one gesture, one problem
  if (values.hands) badness.hands = values.hands === 'free' ? 0 : 1;
  return take;
}

/** The shared value of a dimension among `takes`, if most of them agree. */
function normOf(takes: Take[], dim: Dim) {
  const counts = new Map<string, number>();
  for (const t of takes) {
    const v = t.values[dim];
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const of = [...counts.values()].reduce((s, n) => s + n, 0);
  const [value, agree] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [undefined, 0];
  // A norm needs at least two others, most of them agreeing.
  return of >= 2 && agree / of >= 0.6 ? { value, agree, of } : { value: undefined, agree, of };
}

const capital = (text: string) => text[0].toUpperCase() + text.slice(1);

/** The problems of one take, judged against the other people in the main shot. */
export function judge(take: Take, others: Take[], nameOf: (key: string) => string): { problems: Problem[]; notes: string[] } {
  const problems: Problem[] = [];
  const notes: string[] = [];
  const group = others.filter((o) => o.kind === 'person');
  for (const dim of Object.keys(DIMS) as Dim[]) {
    const info = DIMS[dim];
    const value = take.values[dim];
    if (!value || info.good.includes(value)) continue;
    const word = info.values[value];
    if (!word) continue;
    const norm = take.kind === 'person' ? normOf(group, dim) : { value: undefined, agree: 0, of: 0 };
    if (!info.always.includes(value) && norm.value && !info.good.includes(norm.value) && norm.value === value) {
      // The group agrees on something unusual itself: that is what the photo is for.
      notes.push(`${word.text}, but so are the others, so it looks intended.`);
      continue;
    }
    // A difference needs something to differ from. With no group agreeing on another value
    // (a portrait, a couple), a turned head or a raised arm is a style, not a mistake: only what
    // is always a problem (closed eyes, glare, red eye, blur) and pranks done to someone count.
    const prank = value === 'over-someone' || value === 'under-hand';
    if (take.kind === 'person' && !norm.value && !info.always.includes(value) && !prank) continue;
    const schema = schemaOf(dim, value);
    let text = word.text;
    let why: string;
    if (take.kind === 'animal') {
      text = `The ${take.label} moved (blurry)`;
      why = `It is sharper in another shot. ${PROBLEMS.motion.mechanism}`;
    } else if (dim === 'glasses' || dim === 'redeye' || dim === 'presence') {
      why = PROBLEMS[schema].mechanism;
    } else if (norm.value && info.norm[norm.value]) {
      why = norm.agree === norm.of ? `${capital(info.norm[norm.value])}.` : `Most others: ${info.norm[norm.value].replace(/^everyone else's/, 'their').replace(/^everyone else/, 'they')}.`;
    } else {
      why = `In a good photo, ${PURPOSE_TEXT[purposeOf(dim, value)]}.`;
    }
    if (dim === 'hands' && value === 'over-someone' && take.victim) text = `Hand up behind ${nameOf(take.victim)}'s head (bunny ears?)`;
    if (dim === 'covered' && value === 'object' && take.cover) text = `A ${take.cover} is in front of their face`;
    problems.push({ dim, value, schema, weight: word.weight, norm: norm.value, agree: norm.agree, of: norm.of, text, why });
  }
  return { problems: problems.sort((a, b) => b.weight - a.weight), notes };
}

const cost = (problems: Problem[]) => problems.reduce((s, p) => s + p.weight, 0);
// A take only counts as fixing a problem when it is clearly better on that measure, not just
// over the line: otherwise a barely different take would be swapped in for nothing.
const MARGIN = 0.15;
function fixedBy(open: Problem[], before: Take, after: Take, theirs: Problem[]) {
  return open.filter((p) => {
    if (theirs.some((r) => r.dim === p.dim)) return false;
    const b = before.badness[p.dim], a = after.badness[p.dim];
    return !(b !== undefined && a !== undefined && b - a < MARGIN);
  });
}
const photoName = (n: number) => `photo ${n}`;

/** RMS distance between the eye corners and nose bridge after the best rigid fit, ÷ face size. */
function frameMisfit(target: Face, donor: Face) {
  const ids = [33, 133, 362, 263, 168, 6, 197];
  const from = ids.map((i) => donor.points[i]), to = ids.map((i) => target.points[i]);
  const mean = (ps: Point[]) => ({ x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length });
  const fm = mean(from), tm = mean(to);
  let a = 0, b = 0, norm = 0;
  from.forEach((f, i) => {
    const fx = f.x - fm.x, fy = f.y - fm.y, tx = to[i].x - tm.x, ty = to[i].y - tm.y;
    a += fx * tx + fy * ty; b += fx * ty - fy * tx; norm += fx * fx + fy * fy;
  });
  const cos = a / norm, sin = b / norm;
  const err = from.reduce((s, f, i) => {
    const x = cos * (f.x - fm.x) - sin * (f.y - fm.y) + tm.x, y = sin * (f.x - fm.x) + cos * (f.y - fm.y) + tm.y;
    return s + (x - to[i].x) ** 2 + (y - to[i].y) ** 2;
  }, 0);
  return Math.sqrt(err / ids.length) / target.size;
}

type Context = {
  main: Photo;
  others: Photo[];
  number: (photo: Photo) => number;
  scenes: Record<string, Scene>;
  matches: Map<string, Map<string, Match>>;
  mappings: Map<string, Mapping>;
  hands: Record<string, Hand[]>;
  shotOf: (photo: Photo) => Shot;
  everyone: Construct[];
  rest: Take[];
  nameOf: (key: string) => string;
  faceOf: (entity: Entity) => Face | undefined;
};

const FACE_DIMS: Dim[] = ['eyes', 'gaze', 'mouth', 'glasses', 'redeye', 'blur'];
const LENS_DIMS: Dim[] = ['eyes', 'gaze', 'glasses', 'redeye'];

/** Tries one fix mechanism for a take's open problems; returns it only if its critical questions pass. */
function tryFix(id: FixId, take: Take, open: Problem[], c: Context): Fix | undefined {
  const judgeOther = (t: Take) => judge(t, c.rest, c.nameOf).problems;
  const wearing = (g?: Glasses) => !!g && (g.state === 'clear' || g.state === 'glare');

  if (id === 'recolour') {
    const red = open.filter((p) => p.dim === 'redeye');
    if (!red.length || !take.face) return undefined;
    return { id, resolves: red, face: take.face, why: 'The red inside each pupil is taken out and the pupil darkened. No other shot is needed.', checks: [{ text: 'The red is inside the pupil', ok: true }] };
  }

  if ((id === 'lenses' || id === 'face') && take.face) {
    const dims = id === 'lenses' ? LENS_DIMS : FACE_DIMS;
    const target = open.filter((p) => dims.includes(p.dim));
    if (!target.length || (id === 'lenses' && !wearing(take.glasses))) return undefined;
    const options = rankCandidates(take.face, c.others, c.matches).slice(0, 6).flatMap((candidate) => {
      const shot = c.shotOf(candidate.photo);
      const self = shot.everyone.find((x) => x.face?.id === candidate.face.id) ?? { key: candidate.face.id, kind: 'person' as const, face: candidate.face };
      const described = describeTake(self, shot);
      const resolves = fixedBy(target, take, described, judgeOther(described).filter((p) => dims.includes(p.dim)));
      const checks: Check[] = [{ text: `It is the same person (${Math.round(candidate.confidence * 100)}% sure)`, ok: candidate.confidence > 0.3 }];
      if (id === 'lenses') {
        const misfit = frameMisfit(take.face!, candidate.face);
        checks.unshift({ text: 'They wear the glasses in that shot too', ok: wearing(described.glasses) });
        checks.push({ text: 'The frames sit in the same place on the face', ok: misfit < 0.035 });
      } else {
        checks.unshift({ text: 'Their head is at a similar angle', ok: candidate.pose > 0.35 });
      }
      return resolves.length && checks.every((x) => x.ok) ? [{ candidate, resolves, checks, score: cost(resolves) + 0.25 * candidate.score }] : [];
    });
    const best = options.sort((a, b) => b.score - a.score)[0];
    if (!best) return undefined;
    const n = photoName(c.number(best.candidate.photo));
    let why = id === 'lenses'
      ? `Use their eyes from ${n}, only inside the lenses. Their glasses stay exactly as they are.`
      : `Use their face from ${n}, fitted to how their head sits here and relit to match.`;
    if (best.resolves.some((p) => p.dim === 'glasses')) why += ` In ${n} their head is at a slightly different angle, so the reflection misses the camera.`;
    return { id: 'face', mode: id === 'lenses' ? 'lenses' : 'face', photo: best.candidate.photo, face: take.face, donorFace: best.candidate.face, resolves: best.resolves, why, checks: best.checks };
  }

  if (id === 'area' && take.hand) {
    const handProblem = open.find((p) => p.value === 'under-hand' || p.value === 'over-someone');
    if (!handProblem) return undefined;
    const victimFace = take.values.hands === 'under-hand' ? take.face : take.victim ? c.everyone.find((x) => x.key === take.victim)?.face : undefined;
    const h = take.hand;
    const pad = h.size * 0.35;
    const area: Box = { x: h.box.x - pad, y: h.box.y - pad, w: h.box.w + 2 * pad, h: h.box.h + 2 * pad + h.size * 0.4 };
    for (const photo of [...c.others].sort((a, b) => (c.mappings.get(b.id)?.shift.quality ?? 0) - (c.mappings.get(a.id)?.shift.quality ?? 0))) {
      const mapping = c.mappings.get(photo.id);
      if (!mapping) continue;
      // What's behind the hand is mostly their hair and forehead, which move with their head,
      // not with the camera: line the area up on their face in that shot when it's there.
      const there = victimFace && c.matches.get(photo.id)?.get(victimFace.id)?.face;
      let shift = mapping.shift;
      if (victimFace && there) {
        const scale = there.size / victimFace.size;
        shift = { scale, dx: there.center.x - scale * victimFace.center.x, dy: there.center.y - scale * victimFace.center.y, quality: shift.quality };
      }
      const a = applyShift(shift, { x: area.x, y: area.y }), b = applyShift(shift, { x: area.x + area.w, y: area.y + area.h });
      const mapped = { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
      const checks: Check[] = [
        { text: there ? 'Their head was found in that shot to line up on' : `The shots line up (${Math.round(mapping.shift.quality * 100)}%)`, ok: !!there || mapping.shift.quality > 0.3 },
        { text: 'No hand is in that spot in the other shot', ok: !(c.hands[photo.id] ?? []).some((o) => overlap(o.box, mapped) > 0) },
      ];
      if (!checks.every((x) => x.ok)) continue;
      const n = photoName(c.number(photo));
      return {
        id, photo, area, keep: victimFace?.box, shift, resolves: [handProblem], checks,
        why: `In ${n} there's no hand there, so what's behind it is put back from ${n}, lined up with this shot.${victimFace ? ' Their face is left as it is.' : ''}`,
      };
    }
    return undefined;
  }

  if (id === 'erase' && take.entity) {
    const problem = open.find((p) => p.dim === 'presence');
    if (!problem) return undefined;
    for (const photo of c.others) {
      const mapping = c.mappings.get(photo.id);
      if (!mapping) continue;
      const box = take.entity.box;
      const a = applyShift(mapping.shift, { x: box.x, y: box.y }), b = applyShift(mapping.shift, { x: box.x + box.w, y: box.y + box.h });
      const mapped = { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
      const crowd = (c.scenes[photo.id]?.entities ?? []).filter((x) => x.kind === 'person' && overlap(x.box, mapped) > 0.15 * mapped.w * mapped.h);
      const checks: Check[] = [
        { text: `The shots line up on the background (${Math.round(mapping.shift.quality * 100)}%)`, ok: mapping.shift.quality > 0.35 },
        { text: 'Nobody is standing in that spot in the other shot', ok: crowd.length === 0 },
      ];
      if (!checks.every((x) => x.ok)) continue;
      const n = photoName(c.number(photo));
      return { id, photo, entity: take.entity, shift: mapping.shift, resolves: [problem], checks, why: `They're not in ${n}, so the background there is used instead, lined up with this shot.` };
    }
    return undefined;
  }

  if (id === 'entity' && take.entity) {
    const options = rankEntityCandidates(take.entity, c.others, c.mappings, c.faceOf).slice(0, 6).flatMap((candidate) => {
      let resolves: Problem[];
      if (take.kind === 'animal') {
        const mine = entitySharpness(c.main, take.entity!), theirs = entitySharpness(candidate.photo, candidate.entity);
        resolves = theirs > mine * 1.5 ? open.filter((p) => p.dim === 'blur') : [];
      } else {
        const shot = c.shotOf(candidate.photo);
        const self = shot.everyone.find((x) => x.key === candidate.entity.id) ?? { key: candidate.entity.id, kind: 'person' as const, entity: candidate.entity, face: c.faceOf(candidate.entity) };
        const described = describeTake(self, shot);
        resolves = fixedBy(open, take, described, judgeOther(described));
      }
      const checks: Check[] = [
        { text: `They were matched in that shot (${Math.round(candidate.mapping * 100)}%)`, ok: candidate.mapping > 0.3 },
        { text: `The shots line up (${Math.round((c.mappings.get(candidate.photo.id)?.shift.quality ?? 0) * 100)}%)`, ok: (c.mappings.get(candidate.photo.id)?.shift.quality ?? 0) > 0.25 },
      ];
      return resolves.length && checks.every((x) => x.ok) ? [{ candidate, resolves, checks, score: cost(resolves) + 0.25 * candidate.score }] : [];
    });
    const best = options.sort((a, b) => b.score - a.score)[0];
    if (!best) return undefined;
    const n = photoName(c.number(best.candidate.photo));
    const what = take.kind === 'animal' ? `the ${take.label} from ${n}, where it's sharp` : `how they stand in ${n}`;
    return {
      id, photo: best.candidate.photo, entity: take.entity, donorEntity: best.candidate.entity, resolves: best.resolves, checks: best.checks,
      why: `Use ${what}. ${take.kind === 'animal' ? '' : 'Whatever they hold or wear comes along; people around them stay.'}`.trim(),
    };
  }
  return undefined;
}

/** Finds every person's and animal's problems in the main shot and the best fixes from the other shots. */
export function findProblems(args: {
  main: Photo;
  scenes: Record<string, Scene>;
  photos: Photo[];
  matches: Map<string, Map<string, Match>>;
  mappings: Map<string, Mapping>;
  glassesOf: (face: Face, photo: Photo) => Glasses;
  /** Hands found in each photo, by photo id. */
  hands: Record<string, Hand[]>;
  nameOf: (key: string) => string;
  faceOf: (entity: Entity) => Face | undefined;
}): Report {
  const { main, scenes, photos, matches, mappings, hands, nameOf, faceOf } = args;
  const others = photos.filter((p) => p.id !== main.id);
  // Every shot of each person, so lasting things (glasses) are judged from all of them at once.
  const sameperson = new Map<string, { face: Face; photo: Photo }[]>();
  for (const face of main.faces) {
    const group = [{ face, photo: main }];
    for (const photo of others) {
      const match = matches.get(photo.id)?.get(face.id);
      if (match) group.push({ face: match.face, photo });
    }
    for (const member of group) sameperson.set(member.face.id, group);
  }
  const glassesOf = (face: Face, photo: Photo) => pooled(
    args.glassesOf(face, photo),
    (sameperson.get(face.id) ?? []).filter((m) => m.face.id !== face.id).map((m) => args.glassesOf(m.face, m.photo)),
  );
  const sharpNorm = median(main.faces.filter((f) => f.size >= 60).map((f) => f.sharpness));
  const shotOf = (photo: Photo): Shot => ({ photo, scene: scenes[photo.id], everyone: constructsIn(photo, scenes[photo.id]), hands: hands[photo.id] ?? [], sharpNorm, glassesOf });
  const mainShot = shotOf(main);
  const everyone = mainShot.everyone;
  const takes = everyone.map((construct) => describeTake(construct, mainShot));

  // One prank, one problem: if a visible prankster's hand is over someone's head, it is the
  // prankster's problem, not also the victim's (and the prankster gets the hand that was found).
  for (const prankster of takes.filter((t) => t.values.hands === 'over-someone')) {
    const victim = takes.find((t) => t.key === prankster.victim);
    if (victim?.values.hands === 'under-hand') {
      prankster.hand ??= victim.hand;
      victim.values.hands = 'free';
      victim.badness.hands = 0;
      victim.hand = undefined;
    }
  }

  // Across shots. Group members persist from shot to shot; a person found in none of the other
  // shots who is also turned away or much smaller than the group is passing through. An animal
  // that is much sharper in another shot moved in this one.
  const faceSizes = median(main.faces.map((f) => f.size));
  const inOthers = (t: Take) => others.filter((p) => (mappings.get(p.id)?.pairs.get(t.key)?.score ?? 0) > 0.25).length;
  for (const t of takes) {
    if (!others.length || !t.entity) continue;
    if (t.kind === 'person') {
      const apart = !t.face || Math.abs(t.face.yaw) > 0.35 || t.face.size < faceSizes * 0.55;
      if (inOthers(t) === 0 && apart && takes.filter((x) => x.kind === 'person').length >= 2) {
        t.values.presence = 'passer-by';
        t.role = 'intruder';
      }
    } else {
      const mine = entitySharpness(main, t.entity);
      const best = Math.max(0, ...others.map((p) => {
        const pair = mappings.get(p.id)?.pairs.get(t.key);
        return pair ? entitySharpness(p, pair.entity) : 0;
      }));
      if (best > 0 && mine > 0) {
        t.values.blur = best > mine * 1.8 ? 'blurred' : 'sharp';
        t.badness.blur = 1 - mine / best;
      }
    }
  }

  // What the photo is for: a value most of the group shares that isn't a usual "good" one.
  const purpose: string[] = [];
  const people = takes.filter((t) => t.kind === 'person');
  for (const dim of Object.keys(DIMS) as Dim[]) {
    const norm = normOf(people, dim);
    if (people.length >= 3 && norm.value && !DIMS[dim].good.includes(norm.value) && !DIMS[dim].always.includes(norm.value)) {
      purpose.push(`Most people are doing the same thing (${DIMS[dim].values[norm.value]?.text.toLowerCase() ?? norm.value}), so that's treated as part of the photo.`);
    }
  }

  const number = (photo: Photo) => photos.indexOf(photo) + 1;
  const reports = takes.map((take): PersonReport => {
    const rest = takes.filter((t) => t !== take && t.role !== 'intruder');
    const judged = judge(take, rest, nameOf);
    const notes = judged.notes;
    // Goofing off is momentary; a part someone plays in the picture lasts. A difference this
    // person shows in every other shot too (holding up a flag, a pose they keep) is intended.
    const counterparts = take.kind === 'person' && take.entity
      ? others.flatMap((photo) => {
        const pair = mappings.get(photo.id)?.pairs.get(take.key);
        if (!pair || pair.score < 0.3) return [];
        const shot = shotOf(photo);
        const self = shot.everyone.find((x) => x.key === pair.entity.id);
        return self ? [describeTake(self, shot)] : [];
      })
      : [];
    const problems = judged.problems.filter((p) => {
      const lasting = counterparts.length > 0 && !DIMS[p.dim].always.includes(p.value) && p.value !== 'over-someone' && p.value !== 'under-hand'
        && counterparts.every((t) => t.values[p.dim] === p.value);
      if (lasting) notes.push(`${p.text} in every shot, so it looks intended.`);
      return !lasting;
    });
    if (!problems.length) return { take, problems, notes, fixes: [], unresolved: [] };
    const context: Context = { main, others, number, scenes, matches, mappings, hands, shotOf, everyone, rest, nameOf, faceOf };
    const fixes: Fix[] = [];
    let open = [...problems];
    // Each problem's schema lists fix mechanisms least-intervention first; the first whose
    // critical questions pass is used, and it may put right other problems along the way. A
    // whole-take swap already brings a new face, so it rules out face fixes and vice versa.
    for (const problem of problems) {
      if (!open.includes(problem)) continue;
      for (const id of PROBLEMS[problem.schema].fixes) {
        const used = new Set(fixes.map((f) => f.id === 'face' ? (f.mode === 'lenses' ? 'lenses' : 'face') : f.id));
        if ((id === 'face' || id === 'lenses') && (used.has('entity') || used.has('face') || used.has('lenses'))) continue;
        if (id === 'entity' && (used.has('entity') || used.has('face') || used.has('lenses'))) continue;
        const fix = tryFix(id, take, open, context);
        if (!fix) continue;
        fixes.push(fix);
        open = open.filter((p) => !fix.resolves.includes(p));
        break;
      }
    }
    const noFix = open.length
      ? others.length ? 'None of the other shots has a better take for this.' : 'Add another shot of the same moment so there is a better take to use.'
      : undefined;
    return { take, problems, notes, fixes, unresolved: open, noFix };
  });
  return { people: reports, purpose };
}

export { FIXES, PROBLEMS };
