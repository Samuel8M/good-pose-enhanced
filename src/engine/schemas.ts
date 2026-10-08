import { has, knows } from './knowledge';

/*
 * The library of what goes wrong in photos and how it can be put right, in one common form.
 *
 * This follows how Analogical Engines breaks down an engineering or business problem
 * (analogicalengines.com/research; Hope, Chan, Kittur & Shahaf, KDD 2017; Kittur et al., PNAS
 * 2019; Kang et al., CHI 2025):
 *
 *  1. Turn the problem into a *problem schema*: what has to happen (function), between what
 *     (relations), under which limits (constraints and operating conditions), stated without
 *     the surface details, at several levels of abstraction. Their example: flossing becomes
 *     "disrupt a dense biofilm in a confined, fluid-filled space without abrasive contact".
 *  2. Keep a *mechanism library* where every entry, from any field, has the same form:
 *     purpose, causal mechanism, operating conditions. Because entries are described by what
 *     they do and why, a match can come from a distant domain.
 *  3. *Translate constraints*: adapt the underlying principle to the new setting rather than
 *     copying the solution.
 *  4. Look for *shortcuts to viability*: existing proof nearby that it works.
 *  5. *De-risk by branching into sub-problems*: the critical questions each idea must pass.
 *
 * In a photo the "problems" are things like closed eyes or glare, and the "domains" are the
 * kinds of things in the picture: people, faces, hands, glasses, animals, things people hold,
 * furniture, the background. Stated abstractly, one problem schema covers them all: glare on
 * glasses and a flash bouncing off a window are the same mechanism (a shiny surface reflecting a
 * light into the lens), and a blurry child, a blurry dog and a blurry waving hand are the same
 * (something moved while the shutter was open). So each schema lists its instances across
 * every kind of construct, and each fix mechanism states the conditions it needs. The shortcut
 * to viability is another shot of the same moment that already shows the good state; the
 * critical questions are checks run on that shot before a fix is offered.
 */

/** What a construct is *for* in the picture. */
export type Role = 'subject' | 'companion' | 'prop' | 'setting' | 'intruder';
export type SchemaId = 'closure' | 'attention' | 'odd-action' | 'occlusion' | 'specular' | 'retroreflection' | 'motion' | 'intrusion';
export type FixId = 'recolour' | 'lenses' | 'face' | 'area' | 'erase' | 'entity';
/** Why something matters: the purpose level of a problem. */
export type Purpose = 'look-their-best' | 'pay-attention' | 'behave' | 'pose' | 'picture-quality' | 'only-the-group';

export type ProblemSchema = {
  id: SchemaId;
  name: string;
  /** Function-level statement with the surface details abstracted away. */
  statement: string;
  /** The physical or social cause. */
  mechanism: string;
  /** When it counts as a problem at all. */
  conditions: string;
  roles: Role[];
  /** Concrete instances across different kinds of constructs: the "distant domains". */
  instances: string[];
  /** Fixes that serve this purpose, least intervention first. */
  fixes: FixId[];
};

export type FixMechanism = {
  id: FixId;
  name: string;
  purpose: string;
  mechanism: string;
  conditions: string;
  /** Critical questions checked before the fix is offered. */
  checks: string[];
};

export const PROBLEMS: Record<SchemaId, ProblemSchema> = {
  closure: {
    id: 'closure',
    name: 'Something that should be open is shut',
    statement: 'A feature that shows a subject is present and engaged is closed at the instant of capture.',
    mechanism: 'A blink lasts about a tenth of a second, so in a group the chance that someone is mid-blink grows with every extra person.',
    conditions: 'Always a problem for a subject, unless the eyes are squeezed by a big smile.',
    roles: ['subject'],
    instances: ['eyes closed', 'eyes half-closed', 'eyes closed behind glasses'],
    fixes: ['lenses', 'face', 'entity'],
  },
  attention: {
    id: 'attention',
    name: 'Attention points elsewhere',
    statement: "A subject's facing direction disagrees with the direction everyone else shares.",
    mechanism: 'Eyes and head follow whatever is interesting off camera; the camera records the direction they point.',
    conditions: 'Only when the rest of the group faces the camera (a photo of people watching something is fine).',
    roles: ['subject', 'companion'],
    instances: ['looking away', 'looking down at a phone', 'head turned', 'a child looking at a parent'],
    fixes: ['lenses', 'face', 'entity'],
  },
  'odd-action': {
    id: 'odd-action',
    name: 'One person is doing something different',
    statement: "A subject's action is an alignable difference from the action the rest of the group shares.",
    mechanism: 'Social: one person breaks the shared pose on purpose (goofing off) or by accident (mid-word, mid-gesture).',
    conditions: 'Only when the group agrees on something else. If most of the group is doing it too, it is what the photo is for.',
    roles: ['subject'],
    instances: ['bunny ears behind someone', 'pulling a face', 'tongue out', 'winking', 'arm up', 'mouth open mid-word', 'leaning over'],
    fixes: ['area', 'entity', 'face'],
  },
  occlusion: {
    id: 'occlusion',
    name: 'Something hides what matters',
    statement: "A nearer construct covers part of a subject's face.",
    mechanism: 'Light travels in straight lines, so anything between a face and the camera hides it (the nearer thing wins).',
    conditions: 'When a face is more than slightly covered and the cover is not the point of the photo.',
    roles: ['subject', 'companion'],
    instances: ['a hand over a face', 'a cup or a phone in front of a face', 'a drink being sipped', 'a pet held up to a face'],
    fixes: ['entity', 'face'],
  },
  specular: {
    id: 'specular',
    name: 'A shiny surface reflects a light into the lens',
    statement: 'A smooth surface between a light source and the camera sends the light straight into the lens, hiding what is behind it.',
    mechanism: 'Law of reflection: the angle the light comes in at equals the angle it leaves at, so a small tilt of the surface moves the glare away.',
    conditions: 'When the reflection covers something that matters (eyes) and another shot has the surface at another angle.',
    roles: ['subject', 'prop', 'setting'],
    instances: ['glare on glasses', 'flash in a window behind the group', 'a bright spot on a shiny forehead', 'a phone screen flaring'],
    fixes: ['lenses', 'face', 'area'],
  },
  retroreflection: {
    id: 'retroreflection',
    name: 'Light bounces straight back from inside the eye',
    statement: 'Light from beside the lens enters the pupil and returns along the same path, colouring the pupil.',
    mechanism: 'A flash close to the lens lights the blood-rich retina, which reflects red straight back (in animals a reflective layer makes the eyes glow).',
    conditions: 'Flash photos in dim light, when the pupils are wide open.',
    roles: ['subject', 'companion'],
    instances: ['red eye', 'glowing pet eyes'],
    fixes: ['recolour', 'lenses', 'face'],
  },
  motion: {
    id: 'motion',
    name: 'Something moved while the shutter was open',
    statement: 'A construct changed position during the exposure, so its image is smeared along its path.',
    mechanism: 'Blur length is speed times exposure time; the same subject keeping still in another shot is sharp there.',
    conditions: 'When it is blurrier than the rest of the photo, or than the same thing in another shot.',
    roles: ['subject', 'companion', 'prop'],
    instances: ['a person who moved', 'a dog that turned its head', 'a waving hand', 'a child jumping'],
    fixes: ['face', 'entity'],
  },
  intrusion: {
    id: 'intrusion',
    name: "Someone who isn't part of the photo",
    statement: 'A construct appears in the shot that does not belong to the group the photo is of.',
    mechanism: 'Group members persist from shot to shot and face the camera; passers-by appear in one shot, face elsewhere and stand apart.',
    conditions: 'When another shot shows the same spot without them.',
    roles: ['intruder'],
    instances: ['a passer-by walking through', 'a photobomber', 'someone in the background facing away'],
    fixes: ['erase'],
  },
};

export const FIXES: Record<FixId, FixMechanism> = {
  recolour: {
    id: 'recolour',
    name: 'Recolour the pupils',
    purpose: 'Natural-looking eyes',
    mechanism: 'Remove the reflected red inside each pupil and darken it, keeping the bright catch-light.',
    conditions: 'Needs no other shot.',
    checks: ['The red is inside the pupil, not the iris colour'],
  },
  lenses: {
    id: 'lenses',
    name: 'Eyes from another shot, inside the glasses',
    purpose: 'Fix the eyes without touching the glasses',
    mechanism: 'Take only what is seen through each lens from another shot, lined up on the eye corners and the nose bridge, so the frames (a rigid object resting on the nose) stay put.',
    conditions: 'They wear glasses in both shots, and the problem is only in the eyes.',
    checks: ['The frames sit in the same place on the face', 'It is the same person'],
  },
  face: {
    id: 'face',
    name: 'Face from another shot',
    purpose: 'Fix the face while keeping the body',
    mechanism: 'Warp their face from another shot onto this head with a 468-point mesh, and relight it to this light.',
    conditions: 'Their head is turned about the same way in both shots.',
    checks: ['Their head is at a similar angle', 'It is the same person'],
  },
  area: {
    id: 'area',
    name: 'Put back what was behind',
    purpose: 'Remove a small intruding part (a hand)',
    mechanism: 'Copy that small area from another shot where it is clear, lined up on whatever it covers.',
    conditions: 'Another shot shows the same spot without it.',
    checks: ['The shots line up there', 'Nothing else is in that spot in the other shot'],
  },
  erase: {
    id: 'erase',
    name: 'Remove them',
    purpose: 'Show only the group',
    mechanism: 'Replace their whole outline with the background from a shot where they are not there, lined up on the background.',
    conditions: 'Another shot shows that spot empty.',
    checks: ['The shots line up there', 'Nothing else is in that spot in the other shot'],
  },
  entity: {
    id: 'entity',
    name: 'Whole take from another shot',
    purpose: 'Fix a pose, a gesture or something moving',
    mechanism: 'Swap their whole outline from another shot; whatever they hold or wear comes along, and things around them stay.',
    conditions: 'They can be found in the other shot.',
    checks: ['They were matched in the other shot', 'The shots line up'],
  },
};

/** The role a detected thing plays, from what it affords (object-knowledge.json). */
export function roleOf(label: string): Role {
  if (label === 'person') return 'subject';
  if (!knows(label)) return 'setting';
  if (has(label, 'companion')) return 'companion';
  if (has(label, 'grasp') || has(label, 'wear') || has(label, 'play')) return 'prop';
  return 'setting';
}
