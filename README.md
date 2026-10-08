# Good Pose Enhanced

Fixes bad photos. Add a few shots of the same moment, and it finds what looks off, says why, and fixes it from the other shots:

- closed or half-closed eyes, including **behind glasses**
- glare on glasses, and red eyes from the flash
- someone looking away, pulling a face, mid-word, or with an arm up when nobody else has
- **bunny ears**, even when the prankster is hidden behind the group
- a hand or a cup in front of a face
- a pet that moved
- a stranger walking through the back of the shot

**Use it:** https://samuel8m.github.io/good-pose-enhanced/

Everything runs in the browser. Photos are never uploaded. It is the sister app of [Good Pose & Face](https://github.com/Samuel8M/good-pose-and-face), and every manual tool from that app is still here.

## How to use it

1. Add 2 or more photos of the same moment (button or drag and drop).
2. Read **What looks off**. Each item says what is wrong, why it counts as wrong, how it would be fixed, and the checks that fix passed.
3. Tap **Fix**, or **It's fine** if you like it that way. **Fix everything** does them all.
4. **Save photo**. The saved photo is rebuilt from the originals at full resolution.

Each Fix / It's fine choice teaches it what *you* consider a bad photo (see *Learning* below).

## How it decides what is wrong

The method follows how [Analogical Engines](https://www.analogicalengines.com/research) breaks down engineering and business problems. See [docs/ANALOGICAL_METHOD.md](docs/ANALOGICAL_METHOD.md) for the full mapping.

1. **Nothing is bad on its own: compare.** Each person is described along the same dimensions (eyes, gaze, head, mouth, glasses, hands, arms, lean, blur, what covers the face). The problems are the *alignable differences* from what the rest of the group shares (Markman & Gentner, 1993). People are also compared with themselves in the other shots.
2. **Judge by purpose.** If most of the group is pulling faces or raising a glass, that is what the photo is for, so it is not a problem. If someone does the same thing in every shot (holding up a flag corner), it is intended. With no group to compare with (a portrait), only things that are always wrong count: closed eyes, glare, red eye, blur and pranks.
3. **One problem schema, every kind of thing.** Problems are described by how they come about, not how they look. *A shiny surface reflects a light into the lens* covers glare on glasses and a flash in a window. *Something moved while the shutter was open* covers a person, a dog and a waving hand. The library is in `src/engine/schemas.ts` and is shown in the app.
4. **Fixes in a common form, checked before they are offered.** Each fix mechanism has a purpose, a mechanism, conditions and *critical questions*: do the shots line up there, is it the same person, do the glasses sit in the same place, is anyone else standing in that spot. Fixes are tried least-intervention first. A fix that fails its checks falls through to the next mechanism.

| Fix | What it does |
|---|---|
| Recolour the pupils | Red eye. Needs no other shot. |
| Eyes inside the glasses | Swaps only what is seen through each lens from another shot, lined up on the eye corners and nose bridge, so the frames (a rigid object on the nose) are not bent by a face warp. |
| Face from another shot | 468-point mesh warp, relit to this photo's light. |
| Put back what was behind | Removes a hand over someone's head by restoring that area from a shot where it is clear, lined up on the victim's head (hair moves with the head, not the camera). |
| Remove them | Erases a passer-by using the background from a shot where they are absent. |
| Whole take from another shot | Swaps a person's or pet's whole outline; what they hold comes along and what is around them stays (from Good Pose & Face). |

## Learning

Each choice is stored as a structured description (structure-mapping), at three levels of abstraction:

- what it is: *pulling a face*
- how it comes about: *one person doing something different from the group*
- what it is for: *nobody goofing off*

A new problem is judged by retrieval (MAC/FAC), most specific level first. Relational constraints must hold before a memory may speak, so a lesson about a pulled face can relax a wink or bunny ears (same mechanism and purpose) but never closed eyes.

While idle the app "dreams". It merges lessons about the same kind of problem into schemas (SAGE, as in analogical encoding: Gentner, Loewenstein & Thompson, 2003), and states what it learned and what it carries over by analogy.

## Engine files

| File | What it does |
|---|---|
| `src/engine/schemas.ts` | The library of problem schemas and fix mechanisms, and each construct's role (subject, companion, prop, setting, intruder) from object knowledge. |
| `src/engine/problems.ts` | Describes every person and animal in each shot, compares them across the group and across shots, judges by purpose, and chooses checked fixes. |
| `src/engine/glasses.ts` | Glasses from image evidence: a straight line across the nose bridge (skin never makes one), rims, side arms. It also measures glare (specular highlights) and tint. Evidence is pooled over every shot of a person, because glasses persist. |
| `src/engine/hands.ts` | Finds hands directly, including at higher zoom around heads, and classifies the gesture. |
| `src/engine/lessons.ts` | Learning from Fix / It's fine at three levels of abstraction, with dreaming. |
| `src/engine/compose.ts`, `composeScene.ts` | Lens-only eye swap, red-eye recolour, area restore and outline erase, plus the face and whole-person swaps. |
| Everything else | Inherited from Good Pose & Face: faces, scene, structure-mapping, physics, object knowledge, memory. |

## Tested on

Real photos from Wikimedia Commons:
- an iPhone burst of eight people, five of them in glasses
- a large night-time group in front of the Brandenburg Gate, with passers-by
- bunny-ears photos, including ones where the prankster is hidden
- red-eye portraits, one of them with glasses

Faces narrower than 60 px are never judged. Glasses are found in about 9 of 10 cases tested, with no false alarms on about 40 faces without glasses. Bunny ears need the hand to be visible. Matching is a same-session heuristic, not identity verification. Please only edit photos of people who'd be happy with it, and keep the originals.

## Develop

```sh
npm install
npm run dev          # http://localhost:5188
npm run typecheck
npm run build:pages  # static build with relative paths, for GitHub Pages
```

The MediaPipe WASM runtime is bundled from the installed `@mediapipe/tasks-vision` (0.10.35). Models download from Google's MediaPipe model storage on first use.
