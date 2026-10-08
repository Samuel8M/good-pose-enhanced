import { DIMS, purposeOf, PURPOSE_TEXT, type Dim, type Problem, type Purpose, type Take } from './problems';
import { PROBLEMS } from './schemas';
import { expr, keyOf, parse, similarity, type Description, type Expr } from './sme';

/*
 * What this person considers a bad photo, learned from their own choices.
 *
 * Each time someone says "Fix" or "It's fine" about a problem, the moment is stored at once as
 * a structured description (an episode, as the hippocampus stores it): the person P, the
 * difference D, the group G and how they relate. Comparing two such episodes is analogical
 * encoding (Gentner, Loewenstein & Thompson, 2003): what they share becomes a schema that
 * applies to new cases far better than either example alone. That happens while "dreaming"
 * (offline replay, as in sleep): similar episodes are merged into generalizations (SAGE), and
 * each lesson is described at three levels, as Analogical Engines describes a problem at
 * several levels of abstraction: what it is (closed eyes, for this person), how it comes about
 * (its problem schema: a shiny surface reflecting a light into the lens, see schemas.ts), and
 * what it is for (everyone looking their best). A lesson about glare on glasses can then carry
 * over to a flash in a window (same mechanism), and one kind of goofing off to another (same
 * purpose).
 *
 * New problems are judged by retrieval (MAC/FAC): first by what they are (specific level),
 * then by how they come about (mechanism level), then, most cautiously, by what they are for.
 */

export type Choice = 'fix' | 'fine';
type Stored = string[];
export type Lesson = { id: string; specific: Stored; mechanism?: Stored; purpose: Stored; choice: Choice; about: string; created: number; consolidated: boolean };
export type Schema = { id: string; counts: Record<string, number>; members: number; votes: Record<Choice, number>; about: string; purposeOf: Purpose };
export type Lessons = { episodes: Lesson[]; schemas: Schema[]; insights: string[] };
export type Prediction = { choice: Choice; confidence: number; because: string };

const KEY = 'good-pose-enhanced:lessons:v1';
const SPECIFIC = 0.72; // retrieval threshold on SME similarity at the specific level
const MECHANISM = 0.8; // same physical or social cause
const PURPOSE = 0.85; // a purpose-level analogy must be close to count
const ASSIMILATE = 0.75;

/** A problem as a structured description, at the specific or the purpose level. */
export function describeProblem(problem: Problem, take: Take, groupSize: number, level: 'specific' | 'mechanism' | 'purpose'): Description {
  const info = DIMS[problem.dim];
  const has = expr('has', 'P', 'D');
  const exprs: Expr[] = [has, expr(`purpose-${purposeOf(problem.dim, problem.value)}`, 'D'), expr(`level-${info.level}`, 'D')];
  if (level === 'specific') exprs.push(expr(`dim-${problem.dim}`, 'D'), expr(`value-${problem.value}`, 'D'), expr(`is-${take.label.replace(/s+/g, '-')}`, 'P'));
  if (level !== 'purpose') exprs.push(expr(`schema-${problem.schema}`, 'D'), expr(`role-${take.role}`, 'P'));
  if (problem.norm) {
    exprs.push(expr('differs-from', 'D', 'G'), expr(problem.agree === problem.of ? 'all-agree' : 'most-agree', 'G'));
    exprs.push(expr('cause', has, expr('stands-out', 'P', 'G')));
  } else {
    exprs.push(expr('unlike-usual', 'D'));
  }
  exprs.push(expr(groupSize <= 1 ? 'alone' : groupSize <= 3 ? 'small-group' : 'large-group', 'P'));
  if (take.glasses && (take.glasses.state === 'clear' || take.glasses.state === 'glare')) exprs.push(expr('wears-glasses', 'P'));
  if (problem.value === 'over-someone') exprs.push(expr('over-head-of', 'P', 'V'), expr('person', 'V'));
  return { name: `${problem.dim}:${problem.value}`, exprs };
}

const store = (d: Description): Stored => d.exprs.map(keyOf);
/**
 * Relational constraints checked after the similarity score, as Analogical Engines confirms
 * embedding matches with constraints: all lessons share the same scaffolding (a person, a
 * difference, a group), so similarity alone would let any lesson speak for any problem.
 */
const holds = (stored: Stored | undefined, statement: string) => !!stored?.includes(statement);
const restore = (s: Stored, name = 'lesson'): Description => ({ name, exprs: s.map((x) => parse(x)) });
const schemaDescription = (s: Schema): Description => ({ name: s.id, exprs: Object.entries(s.counts).filter(([, n]) => n / s.members >= 0.5).map(([x]) => parse(x)) });

export function loadLessons(): Lessons {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Lessons | null;
    if (parsed && Array.isArray(parsed.episodes)) return { episodes: parsed.episodes, schemas: parsed.schemas ?? [], insights: parsed.insights ?? [] };
  } catch {
    // Storage blocked or unreadable: start fresh.
  }
  return { episodes: [], schemas: [], insights: [] };
}

function save(lessons: Lessons) {
  try {
    localStorage.setItem(KEY, JSON.stringify(lessons));
  } catch {
    // Private mode: lessons last for this visit only.
  }
  return lessons;
}

export function forgetLessons(): Lessons {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to remove.
  }
  return { episodes: [], schemas: [], insights: [] };
}

export function teach(lessons: Lessons, problem: Problem, take: Take, groupSize: number, choice: Choice): Lessons {
  const lesson: Lesson = {
    id: `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    specific: store(describeProblem(problem, take, groupSize, 'specific')),
    mechanism: store(describeProblem(problem, take, groupSize, 'mechanism')),
    purpose: store(describeProblem(problem, take, groupSize, 'purpose')),
    choice,
    about: problem.text.toLowerCase(),
    created: Date.now(),
    consolidated: false,
  };
  // A newer choice about the very same kind of moment replaces the older one.
  const same = (l: Lesson) => l.specific.join() === lesson.specific.join();
  return save({ ...lessons, episodes: [...lessons.episodes.filter((l) => !same(l)), lesson].slice(-200) });
}

/** Cheap first pass (MAC): share of predicates in common. */
function overlap(a: Stored, b: Stored) {
  const preds = (s: Stored) => new Set(s.map((x) => x.slice(1).split(' ')[0]));
  const pa = preds(a), pb = preds(b);
  let n = 0;
  pa.forEach((p) => { if (pb.has(p)) n += 1; });
  return n / Math.sqrt(pa.size * pb.size || 1);
}

/** What the remembered choices say about a new problem, if anything close enough is remembered. */
export function predict(lessons: Lessons, problem: Problem, take: Take, groupSize: number): Prediction | undefined {
  if (!lessons.episodes.length) return undefined;
  const specific = describeProblem(problem, take, groupSize, 'specific');
  const purpose = describeProblem(problem, take, groupSize, 'purpose');
  const mechanism = describeProblem(problem, take, groupSize, 'mechanism');
  type Hit = { choice: Choice; sim: number; about: string; times: number; level: 'specific' | 'mechanism' | 'purpose' };
  const hits: Hit[] = [];
  for (const s of lessons.schemas) {
    const choice: Choice = s.votes.fine > s.votes.fix ? 'fine' : 'fix';
    const described = schemaDescription(s);
    if (!described.exprs.some((x) => keyOf(x) === `(value-${problem.value} D)`)) continue;
    hits.push({ choice, sim: similarity(described, specific), about: s.about, times: s.members, level: 'specific' });
  }
  const shortlist = lessons.episodes.filter((l) => holds(l.specific, `(value-${problem.value} D)`) && holds(l.specific, `(dim-${problem.dim} D)`) && overlap(l.specific, store(specific)) > 0.5).slice(-40);
  for (const l of shortlist) hits.push({ choice: l.choice, sim: similarity(restore(l.specific), specific), about: l.about, times: 1, level: 'specific' });
  const sameMechanism = `(schema-${problem.schema} D)`, samePurpose = `(purpose-${purposeOf(problem.dim, problem.value)} D)`;
  for (const l of lessons.episodes.slice(-60)) if (l.mechanism && holds(l.mechanism, sameMechanism) && holds(l.purpose, samePurpose)) hits.push({ choice: l.choice, sim: similarity(restore(l.mechanism), mechanism) * 0.92, about: l.about, times: 1, level: 'mechanism' });
  // Purpose-level analogies only relax judgement on problems that depend on context; closed
  // eyes, glare and blur are always worth fixing, whatever was said about something else.
  const relaxable = !DIMS[problem.dim].always.includes(problem.value);
  if (relaxable) for (const l of lessons.episodes.slice(-40)) if (l.choice === 'fine' && holds(l.purpose, samePurpose)) hits.push({ choice: l.choice, sim: similarity(restore(l.purpose), purpose) * 0.85, about: l.about, times: 1, level: 'purpose' });
  const best = hits
    .filter((h) => h.sim >= (h.level === 'specific' ? SPECIFIC : h.level === 'mechanism' ? MECHANISM * 0.92 : PURPOSE * 0.85))
    .sort((a, b) => b.sim + 0.02 * b.times - (a.sim + 0.02 * a.times))[0];
  if (!best) return undefined;
  const said = best.choice === 'fine' ? 'was fine' : 'should be fixed';
  const times = best.times > 1 ? ` (${best.times} times)` : '';
  const because = best.level === 'specific'
    ? `You said ${best.about} ${said} before${times}.`
    : best.level === 'mechanism'
    ? `Like ${best.about}, which you said ${said}: both happen the same way (${PROBLEMS[problem.schema].name.toLowerCase()}).`
    : `Like ${best.about}, which you said ${said}: both are about ${PURPOSE_TEXT[purposeOf(problem.dim, problem.value)]}.`;
  return { choice: best.choice, confidence: best.sim, because };
}

/**
 * Dreaming. Replays new lessons and merges each into the most similar schema (or pairs it with
 * a similar lesson to start one), then states what each schema means and what it carries over
 * to by analogy (other problems with the same purpose).
 */
export function dreamLessons(lessons: Lessons): Lessons {
  const schemas = lessons.schemas.map((s) => ({ ...s, counts: { ...s.counts }, votes: { ...s.votes } }));
  const episodes = lessons.episodes.map((l) => ({ ...l }));
  const absorb = (s: Schema, l: Lesson) => {
    for (const x of l.specific) s.counts[x] = (s.counts[x] ?? 0) + 1;
    s.members += 1;
    s.votes[l.choice] += 1;
    l.consolidated = true;
  };
  const purposeIn = (l: Lesson) => (l.purpose.find((x) => x.startsWith('(purpose-'))?.slice(9).split(' ')[0] ?? 'behave') as Purpose;
  for (const l of episodes) {
    if (l.consolidated) continue;
    const d = restore(l.specific);
    const kind = l.specific.find((x) => x.startsWith('(value-'));
    const sameKind = (stored: Stored) => !!kind && stored.includes(kind);
    const best = schemas.filter((s) => sameKind(Object.keys(s.counts))).map((s) => ({ s, sim: similarity(schemaDescription(s), d) })).sort((a, b) => b.sim - a.sim)[0];
    if (best && best.sim >= ASSIMILATE) {
      absorb(best.s, l);
      continue;
    }
    // Analogical encoding: two lessons that align well become a schema of what they share.
    const partner = episodes.find((o) => o !== l && !o.consolidated && sameKind(o.specific) && similarity(restore(o.specific), d) >= ASSIMILATE);
    if (partner) {
      const s: Schema = { id: `s${schemas.length + 1}`, counts: {}, members: 0, votes: { fix: 0, fine: 0 }, about: l.about, purposeOf: purposeIn(l) };
      absorb(s, l);
      absorb(s, partner);
      schemas.push(s);
    }
  }
  const insights: string[] = [];
  const reflections = [
    ...schemas.map((s) => ({ about: s.about, choice: (s.votes.fine > s.votes.fix ? 'fine' : 'fix') as Choice, times: s.members, purpose: s.purposeOf, d: schemaDescription(s) })),
    ...episodes.filter((l) => !l.consolidated).map((l) => ({ about: l.about, choice: l.choice, times: 1, purpose: purposeIn(l), d: restore(l.specific) })),
  ];
  for (const r of reflections) {
    const verb = r.choice === 'fine' ? "doesn't need fixing" : 'should be fixed';
    const context = r.d.exprs.some((x) => x.pred === 'alone') ? ' when they are alone' : r.d.exprs.some((x) => x.pred === 'large-group') ? ' in big groups' : '';
    // REM-like transfer: the same purpose covers other problems by analogy.
    const kin = (Object.keys(DIMS) as Dim[]).flatMap((dim) => Object.entries(DIMS[dim].values).filter(([value]) => purposeOf(dim, value) === r.purpose && !DIMS[dim].always.includes(value)).map(([, v]) => v.text.toLowerCase())).filter((t) => t !== r.about).slice(0, 3);
    const also = kin.length && r.choice === 'fine' ? ` By analogy (same purpose: ${PURPOSE_TEXT[r.purpose]}), it is more relaxed about ${kin.join(', ')} too.` : '';
    insights.push(`${r.about[0].toUpperCase()}${r.about.slice(1)} ${verb}${context}${r.times > 1 ? ` (learned from ${r.times} choices)` : ''}.${also}`);
  }
  return save({ episodes, schemas, insights });
}
