# How Analogical Engines breaks down a problem, applied to photos

## Their method

[Analogical Engines](https://www.analogicalengines.com/research) (a Carnegie Mellon spin-out founded in 2025 by Niki Kittur and colleagues) helps R&D and business teams solve problems by finding mechanisms in distant fields. From their white paper:

1. **Problem schema.** The problem is converted into "a structured set of problem schemas — vector embeddings and relational constraints that describe its key functions and relations at multiple levels of abstraction." A schema lists the **functions** needed, the **relations** between the parts, the **constraints**, and the **operating conditions**. Their example turns flossing into "disrupt a dense biofilm in a confined, fluid-filled space without abrasive contact."
2. **Mechanism library.** Every entry, from patents, papers, biology or products, "encodes a system's purpose, causal mechanism, and operating conditions in a common form." Searching by function rather than wording is what surfaces distant matches. In the flossing example, a vascular clot-removal mechanism matched because both *remove obstructing material from narrow passages*.
3. **Constraint translation.** A distant mechanism is not copied but adapted. In the example, magnetic beads from medicine became food-safe beads sized for gaps between teeth.
4. **Shortcuts to viability.** Look for nearby proof that the adapted idea already works somewhere.
5. **Sub-problem branching.** Each idea is de-risked through the critical questions it must pass, each with a test.

This builds on their research: separate purpose and mechanism representations (Hope, Chan, Kittur & Shahaf, KDD 2017), analogy at scale with crowds and AI (Kittur et al., PNAS 2019), and adapting inspirations to a new domain (Kang et al., BioSpark, CHI 2025). All of it rests on structure-mapping (Gentner, 1983).

## The same method in this app

| Their step | In Good Pose Enhanced |
|---|---|
| Problem schema at several levels of abstraction | Every problem is an instance of an abstract schema in `src/engine/schemas.ts`, such as *a shiny surface between a light and the camera sends the light into the lens, hiding what is behind it*. Each schema has a statement, a physical or social **mechanism**, **conditions** for when it counts, the **roles** it applies to, and concrete **instances**. Lessons are stored at three levels: what it is, how it comes about, and what it is for. |
| Common form for every entry | Every construct in the picture (person, face, hand, glasses, animal, held thing, background) gets a role from what it affords (`object-knowledge.json`): subject, companion, prop, setting or intruder. Every person or animal is described along the same dimensions, so anything can be compared with anything. |
| Distant domains | The "domains" are kinds of things. Stated by mechanism, one schema covers them all. Glare on glasses ≈ a flash in a window. A blurry child ≈ a blurry dog ≈ a waving hand. A hand over a face ≈ a cup in front of a face. Bunny ears ≈ a pulled face ≈ a raised arm (one person doing something different from the group). |
| Purpose vs mechanism | A difference is only a problem if it defeats the photo's purpose. If the group agrees on something unusual, that is the purpose. Fixes are listed by purpose and mechanism, so the same purpose (natural eyes) can be met by a different mechanism (recolour red eyes, no other shot needed). |
| Relational constraints confirm a match | Learned lessons are retrieved by similarity, then must pass constraints (same mechanism and purpose) before they count. Without that, every lesson looks alike, because all share the same person/difference/group scaffolding. |
| Constraint translation | Fix mechanisms adapt to the case. Eyes behind glasses are swapped only inside the lenses, because frames are rigid. A hand over a head is removed by aligning on the head (hair moves with it) rather than on the camera. |
| Shortcut to viability | Another shot of the same moment that already shows the good state. |
| Critical questions | Each fix lists checks it must pass before it is offered: the shots line up there; it is the same person; the head is at a similar angle; the frames sit in the same place; nobody else is in that spot; no hand is there in the other shot. A fix that fails falls through to the next mechanism for that schema. |
| Expert feedback | Fix / It's fine choices are stored as episodes, merged while dreaming into schemas, and carried over by analogy to problems with the same mechanism and purpose. |

## The problem library

| Schema | Mechanism | Instances | Fixes, in order |
|---|---|---|---|
| Something that should be open is shut | A blink lasts about 0.1 s; more people make it likelier someone is mid-blink | eyes closed, half-closed, closed behind glasses | eyes inside glasses, face, whole take |
| Attention points elsewhere | Eyes and head follow what is interesting off camera | looking away, down at a phone, head turned | eyes inside glasses, face, whole take |
| One person is doing something different | Social: one person breaks the shared pose | bunny ears, pulled face, tongue out, wink, arm up, mid-word, leaning | put back what was behind, whole take, face |
| Something hides what matters | Light travels in straight lines; the nearer thing wins | hand or cup or phone over a face | whole take, face |
| A shiny surface reflects a light into the lens | Law of reflection; a small tilt moves the glare | glare on glasses, flash in a window, shiny forehead | eyes inside glasses, face, area |
| Light bounces straight back from inside the eye | Flash near the lens lights the retina | red eye, glowing pet eyes | recolour, eyes inside glasses, face |
| Something moved while the shutter was open | Blur = speed × exposure time | person, dog, waving hand | face, whole take |
| Someone who isn't part of the photo | Group members persist and face the camera; passers-by appear once, face elsewhere | passer-by, photobomber | remove them |
