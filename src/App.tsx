import {
  ArrowDownToLine,
  Brain,
  Check,
  CircleCheck,
  Eye,
  EyeOff,
  ImagePlus,
  Layers,
  LoaderCircle,
  LockKeyhole,
  PersonStanding,
  RotateCcw,
  ScanSearch,
  Sparkles,
  Star,
  ThumbsUp,
  TriangleAlert,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { explain as explainInvolvement, mapScenes, personQuality, planSwap, rankEntityCandidates, type Involvement, type Mapping, type Shift } from './engine/analogy';
import { dream, forget, learn, learnedCount, loadMemory, type Decision } from './engine/memory';
import { exportJpeg, renderOverlay, type Placed, type PlacedSceneSwap, type Swap, type SwapMode } from './engine/compose';
import { areaRegion, drawRegionPreview, editRegion, outlineRegion, type EditRegion, type SceneSwap } from './engine/composeScene';
import { detectGlasses, type Glasses } from './engine/glasses';
import { findHands, prepareHandModel, type Hand } from './engine/hands';
import { dreamLessons, forgetLessons, loadLessons, predict, teach, type Prediction } from './engine/lessons';
import { correspond, eyesLookClosed, eyesReadable, quality, rankCandidates, type Match } from './engine/match';
import { findProblems, type Fix, type PersonReport, type Problem } from './engine/problems';
import { displayName, perceiveScene, prepareSceneModels, type Entity, type Scene } from './engine/scene';
import { FIXES, PROBLEMS } from './engine/schemas';
import { FriendlyError, prepareModels, readPhoto, type Face, type Photo } from './engine/vision';

const ACCEPT = 'image/*,.jpg,.jpeg,.jfif,.png,.webp,.heic,.heif';
const IMAGE_NAME = /\.(jpe?g|jfif|png|webp|gif|bmp|avif|heic|heif)$/i;

type Selection = { entityId?: string; faceId?: string };
type Tab = 'face' | 'pose';
type SceneChoice = { donorId: string; overrides: Record<string, Decision> };
/** A restored area (hand removed, passer-by erased): the other shot, how it lines up, and where. */
type AreaChoice = { photoId: string; shift: Shift; region: EditRegion };
type Verdict = 'fix' | 'fine';
const problemKey = (report: PersonReport, problem: Problem) => `${report.take.key}:${problem.dim}`;
const fixKey = (report: PersonReport, fix: Fix) => `${report.take.key}:${fix.id}`;

function explain(error: unknown, fileName: string) {
  if (error instanceof FriendlyError) return error.message;
  console.error(error);
  return `Something went wrong with "${fileName}". Please try a different photo.`;
}

/** The photo with the most people in it, then the most open eyes, makes the best starting point. */
function pickMain(photos: Photo[]) {
  const score = (photo: Photo) => photo.faces.length * 10 + photo.faces.reduce((sum, face) => sum + quality(face), 0);
  return photos.reduce((best, photo) => (score(photo) > score(best) ? photo : best));
}

function OptionTile({ thumb, title, notes, star, active, onClick }: {
  thumb: string; title: string; notes: { text: string; warn?: boolean; icon?: 'eye' | 'eye-off' }[]; star?: boolean; active: boolean; onClick: () => void;
}) {
  return (
    <button className={active ? 'option active' : 'option'} onClick={onClick} type="button" aria-pressed={active}>
      <img src={thumb} alt="" />
      {active && <span className="option-check"><Check size={16} strokeWidth={3} /></span>}
      <span className="option-title">{star && <Star size={13} fill="currentColor" />}{title}</span>
      {notes.map((note) => (
        <span className={note.warn ? 'option-note warn' : 'option-note'} key={note.text}>
          {note.icon === 'eye' && <Eye size={13} />}{note.icon === 'eye-off' && <EyeOff size={13} />}{note.text}
        </span>
      ))}
    </button>
  );
}

function eyeNotes(face: Face | undefined) {
  if (!face || !eyesReadable(face)) return [];
  return eyesLookClosed(face) ? [{ text: 'Eyes closed', warn: true, icon: 'eye-off' as const }] : [{ text: 'Eyes open', icon: 'eye' as const }];
}

export default function App() {
  const fileInput = useRef<HTMLInputElement>(null);
  const baseCanvas = useRef<HTMLCanvasElement>(null);
  const overlayCanvas = useRef<HTMLCanvasElement>(null);
  const previewCanvas = useRef<HTMLCanvasElement>(null);
  const pickerRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const regionCache = useRef(new Map<string, EditRegion>());
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [scenes, setScenes] = useState<Record<string, Scene>>({});
  const [mainId, setMainId] = useState('');
  // Target face id → donor face id ('' = looked at and kept as taken).
  const [faceSwaps, setFaceSwaps] = useState<Record<string, string>>({});
  // Target entity id → donor entity and any "moves / stays" overrides for related things.
  const [sceneSwaps, setSceneSwaps] = useState<Record<string, SceneChoice>>({});
  // Target face id → eyes-only inside the glasses, or the whole face.
  const [faceModes, setFaceModes] = useState<Record<string, SwapMode>>({});
  const [areas, setAreas] = useState<Record<string, AreaChoice>>({});
  const [redEyes, setRedEyes] = useState<Record<string, true>>({});
  const [hands, setHands] = useState<Record<string, Hand[]>>({});
  // What the person said about each problem found: fix it, or it's fine as it is.
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [lessons, setLessons] = useState(loadLessons);
  const glassesCache = useRef(new Map<string, Glasses>());
  const [selection, setSelection] = useState<Selection | null>(null);
  const [tab, setTab] = useState<Tab>('face');
  const [showEveryone, setShowEveryone] = useState(false);
  const [showRegion, setShowRegion] = useState(true);
  const [memory, setMemory] = useState(loadMemory);
  const learned = learnedCount(memory);
  // Dream (consolidate new lessons into general rules) whenever there are new ones and the
  // device is idle, so it never slows down editing.
  const unconsolidated = memory.episodes.filter((e) => !e.consolidated).length;
  useEffect(() => {
    if (!unconsolidated) return;
    const run = () => setMemory((current) => dream(current));
    if ('requestIdleCallback' in window) {
      const handle = window.requestIdleCallback(run, { timeout: 4000 });
      return () => window.cancelIdleCallback(handle);
    }
    const handle = setTimeout(run, 1500);
    return () => clearTimeout(handle);
  }, [unconsolidated]);
  const newLessons = lessons.episodes.filter((e) => !e.consolidated).length;
  useEffect(() => {
    if (!newLessons) return;
    const handle = setTimeout(() => setLessons((current) => dreamLessons(current)), 1500);
    return () => clearTimeout(handle);
  }, [newLessons]);
  const [busy, setBusy] = useState<{ text: string; progress: number } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [saved, setSaved] = useState('');
  const [saving, setSaving] = useState(false);

  const main = photos.find((photo) => photo.id === mainId) ?? photos[0];
  const scene = main ? scenes[main.id] : undefined;
  const others = useMemo(() => photos.filter((photo) => photo.id !== main?.id), [photos, main]);
  const photoNumber = (photo: Photo) => photos.indexOf(photo) + 1;
  const faceIndex = useMemo(
    () => new Map(photos.flatMap((photo) => photo.faces.map((face) => [face.id, { face, photo }] as const))),
    [photos],
  );
  const entityIndex = useMemo(
    () => new Map(photos.flatMap((photo) => (scenes[photo.id]?.entities ?? []).map((entity) => [entity.id, { entity, photo }] as const))),
    [photos, scenes],
  );
  const faceOf = (entity: Entity) => (entity.faceId ? faceIndex.get(entity.faceId)?.face : undefined);
  const nameOf = (entity: Entity) => displayName(entity, scenes[entity.photoId]);

  const matches = useMemo(() => {
    const result = new Map<string, Map<string, Match>>();
    if (main) for (const photo of others) result.set(photo.id, correspond(main, photo));
    return result;
  }, [main, others]);
  const mappings = useMemo(() => {
    const result = new Map<string, Mapping>();
    if (main && scene) for (const photo of others) if (scenes[photo.id]) result.set(photo.id, mapScenes(main, scene, photo, scenes[photo.id], matches.get(photo.id)));
    return result;
  }, [main, scene, others, scenes, matches]);
  const faceCandidates = useMemo(
    () => new Map((main?.faces ?? []).map((face) => [face.id, rankCandidates(face, others, matches)])),
    [main, others, matches],
  );
  const keyName = (key: string) => {
    const entity = entityIndex.get(key)?.entity;
    if (entity) return nameOf(entity);
    const index = main?.faces.findIndex((f) => f.id === key) ?? -1;
    return index >= 0 ? `Person ${index + 1}` : 'someone';
  };
  // Everything that looks off in the main photo, each with the fixes that passed their checks.
  const report = useMemo(() => {
    if (!main || !scenes[main.id]) return undefined;
    const glassesOf = (face: Face, photo: Photo) => {
      let found = glassesCache.current.get(face.id);
      if (!found) {
        found = detectGlasses(photo.bitmap, face);
        glassesCache.current.set(face.id, found);
      }
      return found;
    };
    return findProblems({ main, scenes, photos, matches, mappings, glassesOf, hands, nameOf: keyName, faceOf });
    // keyName and faceOf only read the indexes listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [main, scenes, photos, matches, mappings, hands, faceIndex, entityIndex]);
  const groupSize = report?.people.filter((p) => p.take.kind === 'person').length ?? 0;
  const predictions = useMemo(() => {
    const result = new Map<string, Prediction>();
    for (const person of report?.people ?? []) {
      for (const problem of person.problems) {
        const guess = predict(lessons, problem, person.take, groupSize);
        if (guess) result.set(problemKey(person, problem), guess);
      }
    }
    return result;
  }, [report, lessons, groupSize]);

  // Whole-person/object swaps, each with its analogy-based plan and edit region.
  const placedSceneSwaps: (PlacedSceneSwap & { involved: Involvement[] })[] = [];
  if (main && scene) {
    for (const [targetId, choice] of Object.entries(sceneSwaps)) {
      const target = scene.entities.find((e) => e.id === targetId);
      const donor = entityIndex.get(choice.donorId);
      const mapping = donor && mappings.get(donor.photo.id);
      if (!target || !donor || !mapping) continue;
      const involved = planSwap(target, donor.entity, scene, scenes[donor.photo.id], mapping, memory, choice.overrides);
      const swap: SceneSwap = { target, donor: donor.entity, donorPhoto: donor.photo, shift: mapping.shift, involved };
      const key = `${main.id}|${target.id}|${donor.entity.id}|${involved.map((i) => `${i.entity.id}:${i.decision}`).join(',')}`;
      let region = regionCache.current.get(key);
      if (!region) {
        region = editRegion(main, swap);
        regionCache.current.set(key, region);
      }
      placedSceneSwaps.push({ swap, region, involved });
    }
  }
  const bodySwappedFaces = new Set(placedSceneSwaps.map((p) => p.swap.target.faceId).filter(Boolean));
  const activeFaceSwaps: Swap[] = (main?.faces ?? []).flatMap((target) => {
    const donor = faceSwaps[target.id] ? faceIndex.get(faceSwaps[target.id]) : undefined;
    return donor && !bodySwappedFaces.has(target.id) ? [{ target, donor: donor.face, donorPhoto: donor.photo, mode: faceModes[target.id] ?? 'face' }] : [];
  });
  const placedAreas: Placed[] = Object.values(areas).flatMap((area) => {
    const photo = photos.find((p) => p.id === area.photoId);
    return photo ? [{ swap: { shift: area.shift, donorPhoto: photo }, region: area.region }] : [];
  });
  const redFaces = (main?.faces ?? []).filter((face) => redEyes[face.id]);
  const changed = activeFaceSwaps.length > 0 || placedSceneSwaps.length > 0 || placedAreas.length > 0 || redFaces.length > 0;

  const applied = (person: PersonReport, fix: Fix) => {
    if (fix.id === 'face') return !!fix.face && !!fix.donorFace && faceSwaps[fix.face.id] === fix.donorFace.id;
    if (fix.id === 'entity') return !!fix.entity && !!fix.donorEntity && sceneSwaps[fix.entity.id]?.donorId === fix.donorEntity.id;
    if (fix.id === 'recolour') return !!fix.face && !!redEyes[fix.face.id];
    return !!areas[fixKey(person, fix)];
  };
  const isFixed = (person: PersonReport) => person.fixes.length > 0 && person.fixes.every((fix) => applied(person, fix));
  /** People whose problems are still open: not fixed, not said to be fine. */
  const openPeople = (report?.people ?? []).filter((person) =>
    person.problems.some((p) => verdicts[problemKey(person, p)] !== 'fine') && !isFixed(person));
  const likelyFine = (person: PersonReport) =>
    person.problems.every((p) => predictions.get(problemKey(person, p))?.choice === 'fine' || verdicts[problemKey(person, p)] === 'fine');
  const fixable = openPeople.filter((person) => person.fixes.length > 0 && !likelyFine(person));
  const flagged = new Set(openPeople.flatMap((person) => [person.take.face?.id, person.take.entity?.id].filter(Boolean) as string[]));

  const selectedEntity = selection?.entityId ? scene?.entities.find((e) => e.id === selection.entityId) : undefined;
  const selectedFace = selection?.faceId ? main?.faces.find((f) => f.id === selection.faceId) : selectedEntity ? (selectedEntity.faceId ? main?.faces.find((f) => f.id === selectedEntity.faceId) : undefined) : undefined;
  const selectedPlan = selectedEntity ? placedSceneSwaps.find((p) => p.swap.target.id === selectedEntity.id) : undefined;

  useEffect(() => {
    const canvas = baseCanvas.current;
    if (!canvas || !main) return;
    canvas.width = main.width;
    canvas.height = main.height;
    canvas.getContext('2d')?.drawImage(main.bitmap, 0, 0);
  }, [main]);

  const swapKey = [
    ...activeFaceSwaps.map((swap) => `${swap.target.id}>${swap.donor.id}:${swap.mode}`),
    ...placedSceneSwaps.map((p) => `${p.swap.target.id}>${p.swap.donor.id}:${p.involved.map((i) => i.decision[0]).join('')}`),
    ...Object.keys(areas),
    ...redFaces.map((face) => `red:${face.id}`),
  ].join();
  useEffect(() => {
    const canvas = overlayCanvas.current;
    if (!canvas || !main) return;
    try {
      renderOverlay(canvas, main, activeFaceSwaps, [...placedSceneSwaps, ...placedAreas], redFaces);
    } catch (error) {
      setProblems([explain(error, main.name)]);
    }
    // The swap lists are rebuilt each render; swapKey captures what they contain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [main, swapKey]);

  const previewKey = selectedPlan && showRegion ? `${selectedPlan.swap.target.id}:${swapKey}` : '';
  useEffect(() => {
    const canvas = previewCanvas.current;
    if (!canvas || !main) return;
    if (selectedPlan && showRegion) drawRegionPreview(canvas, main, [selectedPlan.region]);
    else canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [main, previewKey]);

  useEffect(() => {
    if (!selection) return;
    // On phones the choices sit under the photo, so keep the photo in view to show each change.
    if (window.matchMedia('(max-width: 960px)').matches) stageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else pickerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selection]);

  async function addFiles(files: File[]) {
    if (busy || !files.length) return;
    const images = files.filter((file) => file.type.startsWith('image/') || IMAGE_NAME.test(file.name));
    if (!images.length) {
      setProblems(["Those files don't look like photos. Please choose JPG or PNG pictures."]);
      return;
    }
    setProblems([]);
    setSaved('');
    setBusy({ text: 'Getting ready… the first time takes a few seconds', progress: 0 });
    try {
      await Promise.all([prepareModels(), prepareSceneModels()]);
    } catch (error) {
      setProblems([explain(error, images[0].name)]);
      setBusy(null);
      return;
    }
    const added: Photo[] = [];
    const addedScenes: Record<string, Scene> = {};
    const addedHands: Record<string, Hand[]> = {};
    // Hands help spot pranks and covered faces; without them everything else still works.
    const handsReady = await prepareHandModel().then(() => true, () => false);
    const issues: string[] = [];
    for (const [index, file] of images.entries()) {
      const label = images.length > 1 ? ` in photo ${index + 1} of ${images.length}` : '';
      try {
        const photo = await readPhoto(file, (fraction) => setBusy({ text: `Looking for faces${label}…`, progress: (index + fraction * 0.3) / images.length }));
        const found = await perceiveScene(photo, (fraction) => setBusy({ text: `Understanding people and things${label}…`, progress: (index + 0.3 + fraction * 0.6) / images.length }));
        if (photo.faces.length || found.entities.length) {
          setBusy({ text: `Looking at hands${label}…`, progress: (index + 0.92) / images.length });
          addedHands[photo.id] = handsReady ? await findHands(photo).catch(() => []) : [];
          added.push(photo);
          addedScenes[photo.id] = found;
        } else {
          photo.bitmap.close();
          issues.push(`Nothing to change was found in "${file.name}". Try a photo with people in it.`);
        }
      } catch (error) {
        issues.push(explain(error, file.name));
      }
    }
    setScenes((current) => ({ ...current, ...addedScenes }));
    setHands((current) => ({ ...current, ...addedHands }));
    setPhotos((current) => [...current, ...added]);
    if (!main && added.length) setMainId(pickMain(added).id);
    setProblems(issues);
    setBusy(null);
  }

  const addFilesRef = useRef(addFiles);
  addFilesRef.current = addFiles;
  useEffect(() => {
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files');
    const over = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragging(true);
    };
    const leave = (event: DragEvent) => {
      if (!event.relatedTarget) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      // Without this the browser navigates away to show the dropped picture.
      event.preventDefault();
      setDragging(false);
      void addFilesRef.current(Array.from(event.dataTransfer?.files ?? []));
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  function select(next: Selection, preferred: Tab) {
    setSelection(next);
    setShowEveryone(false);
    const entity = next.entityId ? scene?.entities.find((e) => e.id === next.entityId) : undefined;
    setTab(entity && (sceneSwaps[entity.id] || !entity.faceId) ? 'pose' : preferred);
  }

  function chooseFace(targetId: string, donorId: string) {
    setFaceSwaps((current) => ({ ...current, [targetId]: donorId }));
    setSaved('');
  }

  function chooseScene(targetId: string, donorId: string | null) {
    setSceneSwaps((current) => {
      const next = { ...current };
      if (donorId) next[targetId] = { donorId, overrides: current[targetId]?.donorId === donorId ? current[targetId].overrides : {} };
      else delete next[targetId];
      return next;
    });
    setSaved('');
  }

  function decide(targetId: string, target: Entity, involvement: Involvement, decision: Decision) {
    setSceneSwaps((current) => {
      const choice = current[targetId];
      if (!choice) return current;
      return { ...current, [targetId]: { ...choice, overrides: { ...choice.overrides, [involvement.entity.id]: decision } } };
    });
    // Teach the case library: next time an analogous situation comes up, this choice counts.
    if (decision !== involvement.verdict.decision) {
      setMemory((current) => learn(current, involvement.situation, decision, `${nameOf(involvement.entity).toLowerCase()} and ${nameOf(target)}`));
    }
    setSaved('');
  }

  function applyFixes(people: PersonReport[]) {
    if (!main) return;
    const faceUpdates: Record<string, string> = {}, modeUpdates: Record<string, SwapMode> = {};
    const areaUpdates: Record<string, AreaChoice> = {}, redUpdates: Record<string, true> = {};
    const sceneUpdates: Record<string, string> = {};
    for (const person of people) {
      for (const fix of person.fixes) {
        if (fix.id === 'face' && fix.face && fix.donorFace) {
          faceUpdates[fix.face.id] = fix.donorFace.id;
          modeUpdates[fix.face.id] = fix.mode ?? 'face';
        } else if (fix.id === 'entity' && fix.entity && fix.donorEntity) {
          sceneUpdates[fix.entity.id] = fix.donorEntity.id;
        } else if (fix.id === 'recolour' && fix.face) {
          redUpdates[fix.face.id] = true;
        } else if ((fix.id === 'area' || fix.id === 'erase') && fix.photo && fix.shift) {
          const region = fix.id === 'area' && fix.area ? areaRegion(main, fix.area, fix.keep) : fix.entity ? outlineRegion(main, fix.entity) : undefined;
          if (region) areaUpdates[fixKey(person, fix)] = { photoId: fix.photo.id, shift: fix.shift, region };
        }
      }
    }
    setFaceSwaps((current) => ({ ...current, ...faceUpdates }));
    setFaceModes((current) => ({ ...current, ...modeUpdates }));
    setAreas((current) => ({ ...current, ...areaUpdates }));
    setRedEyes((current) => ({ ...current, ...redUpdates }));
    setSceneSwaps((current) => {
      const next = { ...current };
      for (const [target, donorId] of Object.entries(sceneUpdates)) next[target] = { donorId, overrides: {} };
      return next;
    });
    setSaved('');
  }

  function undoFixes(person: PersonReport) {
    for (const fix of person.fixes) {
      if (fix.id === 'face' && fix.face) chooseFace(fix.face.id, '');
      if (fix.id === 'entity' && fix.entity) chooseScene(fix.entity.id, null);
      if (fix.id === 'recolour' && fix.face) setRedEyes((current) => { const next = { ...current }; delete next[fix.face!.id]; return next; });
      if (fix.id === 'area' || fix.id === 'erase') setAreas((current) => { const next = { ...current }; delete next[fixKey(person, fix)]; return next; });
    }
    setVerdicts((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${person.take.key}:`))));
  }

  /** Records the choice, and remembers it as a lesson for analogous photos. */
  function judgeProblems(person: PersonReport, verdict: Verdict) {
    setVerdicts((current) => ({ ...current, ...Object.fromEntries(person.problems.map((p) => [problemKey(person, p), verdict])) }));
    setLessons((current) => person.problems.reduce((acc, problem) => teach(acc, problem, person.take, groupSize, verdict), current));
    if (verdict === 'fix') applyFixes([person]);
  }

  function fixAll() {
    applyFixes(fixable);
    setVerdicts((current) => ({ ...current, ...Object.fromEntries(fixable.flatMap((person) => person.problems.map((p) => [problemKey(person, p), 'fix' as Verdict]))) }));
  }

  function resetEdits() {
    setFaceSwaps({});
    setFaceModes({});
    setAreas({});
    setRedEyes({});
    setVerdicts({});
    setSceneSwaps({});
    setSaved('');
  }

  function switchMain(photo: Photo) {
    if (photo.id === main?.id) return;
    if (changed && !window.confirm('Use this as the main photo instead? Your changes will be reset.')) return;
    setMainId(photo.id);
    resetEdits();
    setSelection(null);
  }

  function startOver() {
    if (changed && !window.confirm('Start over? Your changes will be cleared (your original photos are not affected).')) return;
    photos.forEach((photo) => photo.bitmap.close());
    setPhotos([]);
    setScenes({});
    setHands({});
    glassesCache.current.clear();
    setMainId('');
    resetEdits();
    setSelection(null);
    setProblems([]);
    regionCache.current.clear();
  }

  async function save() {
    if (!main || saving) return;
    setSaving(true);
    setSaved('');
    try {
      const blob = await exportJpeg(main, activeFaceSwaps, [...placedSceneSwaps, ...placedAreas], redFaces);
      const name = `${main.name.replace(/\.[^.]+$/, '')}-fixed.jpg`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setSaved(`Saved! Look in your Downloads folder for "${name}".`);
    } catch (error) {
      setProblems([explain(error, main.name)]);
    } finally {
      setSaving(false);
    }
  }

  const holdCompare = {
    onPointerDown: () => setComparing(true),
    onPointerUp: () => setComparing(false),
    onPointerLeave: () => setComparing(false),
    onPointerCancel: () => setComparing(false),
    onKeyDown: (event: KeyboardEvent) => { if (event.key === ' ' || event.key === 'Enter') setComparing(true); },
    onKeyUp: () => setComparing(false),
    onContextMenu: (event: MouseEvent) => event.preventDefault(),
  };

  const faceOptions = selectedFace ? faceCandidates.get(selectedFace.id) ?? [] : [];
  const everyoneElse = selectedFace
    ? others.flatMap((photo) => photo.faces.filter((face) => !faceOptions.some((c) => c.face.id === face.id)).map((face) => ({ face, photo })))
    : [];
  const entityOptions = selectedEntity ? rankEntityCandidates(selectedEntity, others, mappings, faceOf) : [];
  const currentQuality = selectedEntity ? (selectedEntity.kind === 'person' ? personQuality(selectedEntity, faceOf(selectedEntity)) : selectedEntity.score) : 0;
  const objects = scene?.entities.filter((e) => e.kind === 'object') ?? [];
  const facelessPeople = scene?.entities.filter((e) => e.kind === 'person' && !e.faceId) ?? [];
  const title = selectedEntity ? nameOf(selectedEntity) : selectedFace && main ? `Person ${main.faces.indexOf(selectedFace) + 1}` : '';
  const guide = photos.length === 1
    ? 'Add at least one more photo of the same moment, so there are better takes to choose from.'
    : selection
      ? 'Now pick the take you like best in the list.'
      : 'Tap a face or a label in the picture to change it.';

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand"><span className="brand-mark"><PersonStanding size={20} /></span>Good Pose Enhanced</span>
        <span className="private"><LockKeyhole size={15} />Your photos never leave this device</span>
      </header>

      <main className="page">
        {!main && !busy && (
          <section className="welcome">
            <h1>Turn bad photos<br /><em>into the one you wanted.</em></h1>
            <p className="lead">Closed eyes, glare on glasses, red eyes, someone pulling a face or giving bunny ears, a stranger walking through. Add a few shots of the same moment and it finds what looks off, explains why, and fixes it from the other shots.</p>
            <ol className="steps">
              <li><b>1</b><span>Add 2 or more photos taken at the same moment</span></li>
              <li><b>2</b><span>Read what looks off and why</span></li>
              <li><b>3</b><span>Tap Fix (or It's fine), then Save</span></li>
            </ol>
            <button className="drop-target" onClick={() => fileInput.current?.click()} type="button">
              <Upload size={30} />
              <strong>Choose photos</strong>
              <span>or drag them onto this page</span>
            </button>
          </section>
        )}

        {busy && (
          <section className="working" aria-live="polite">
            <LoaderCircle className="spin" size={26} />
            <p>{busy.text}</p>
            <div className="progress"><span style={{ width: `${Math.round(busy.progress * 100)}%` }} /></div>
          </section>
        )}

        {problems.length > 0 && (
          <div className="problems" role="alert">
            <ul>{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
            <button className="text-button" onClick={() => setProblems([])} type="button">OK</button>
          </div>
        )}

        {main && (
          <section className="editor">
            <div className="stage-column">
              <p className="guide">{guide}</p>
              {fixable.length > 0 && (
                <div className="suggestion">
                  <TriangleAlert size={20} />
                  <span>{fixable.length === 1 ? `${keyName(fixable[0].take.key)}: ${fixable[0].problems[0].text.toLowerCase()}.` : `${fixable.length} things look off. See the list for what and why.`}</span>
                  <button className="button primary" onClick={fixAll} type="button"><Sparkles size={17} />Fix {fixable.length === 1 ? 'it' : 'everything'} for me</button>
                </div>
              )}
              <div className="stage" ref={stageRef} style={{ aspectRatio: `${main.width} / ${main.height}`, width: `min(100%, calc(72vh * ${main.width / main.height}))` }}>
                <canvas ref={baseCanvas} className="layer" aria-label="Your main photo" />
                <canvas ref={overlayCanvas} className="layer" style={{ visibility: comparing ? 'hidden' : 'visible' }} />
                <canvas ref={previewCanvas} className="layer region" style={{ visibility: comparing || !selectedPlan || !showRegion ? 'hidden' : 'visible' }} />
                {comparing ? <span className="stage-tag">Original</span> : (
                  <>
                    {main.faces.map((face, index) => {
                      const entity = scene?.entities.find((e) => e.faceId === face.id);
                      const replaced = !!faceSwaps[face.id] || bodySwappedFaces.has(face.id);
                      const closed = !replaced && (flagged.has(face.id) || (!!entity && flagged.has(entity.id)));
                      const active = selectedFace?.id === face.id;
                      return (
                        <button
                          className={['ring', active && 'selected', replaced && 'replaced', closed && 'closed'].filter(Boolean).join(' ')}
                          key={face.id}
                          onClick={() => select(entity ? { entityId: entity.id, faceId: face.id } : { faceId: face.id }, 'face')}
                          style={{
                            left: `${((face.box.x - face.box.w * 0.14) / main.width) * 100}%`,
                            top: `${((face.box.y - face.box.h * 0.1) / main.height) * 100}%`,
                            width: `${((face.box.w * 1.28) / main.width) * 100}%`,
                            height: `${((face.box.h * 1.2) / main.height) * 100}%`,
                          }}
                          type="button"
                          aria-label={`${entity ? nameOf(entity) : `Person ${index + 1}`}${closed ? ', something looks off' : ''}${replaced ? ', changed' : ''}`}
                        >
                          <span className="ring-badge">{replaced ? <Check size={14} strokeWidth={3} /> : closed ? (eyesLookClosed(face) ? <EyeOff size={14} /> : <TriangleAlert size={14} />) : index + 1}</span>
                        </button>
                      );
                    })}
                    {[...objects, ...facelessPeople].map((entity) => (
                      <button
                        className={['chip', selectedEntity?.id === entity.id && 'selected', sceneSwaps[entity.id] && 'replaced', flagged.has(entity.id) && 'flagged'].filter(Boolean).join(' ')}
                        key={entity.id}
                        onClick={() => select({ entityId: entity.id }, 'pose')}
                        style={{ left: `${(entity.box.x / main.width) * 100}%`, top: `${(entity.box.y / main.height) * 100}%` }}
                        type="button"
                      >
                        {sceneSwaps[entity.id] && <Check size={12} strokeWidth={3} />}{nameOf(entity)}
                      </button>
                    ))}
                  </>
                )}
              </div>
            </div>

            <div className="actions-area">
              <div className="actions">
                <button className="button primary large" disabled={!changed || saving} onClick={() => void save()} type="button">
                  {saving ? <><LoaderCircle className="spin" size={20} />Saving…</> : <><ArrowDownToLine size={20} />Save photo</>}
                </button>
                <button className="button large" disabled={!changed} type="button" {...holdCompare}><Eye size={20} />Hold to see original</button>
                {changed && <button className="text-button" onClick={resetEdits} type="button"><RotateCcw size={16} />Undo changes</button>}
              </div>
              {saved && <p className="saved"><Check size={18} />{saved}</p>}
            </div>

            <aside className="side">
              {report && !selection && (
                <section className="checkup" aria-label="What looks off">
                  <div className="checkup-head">
                    <h2><ScanSearch size={20} />What looks off</h2>
                    {fixable.length > 1 && <button className="button primary small" onClick={fixAll} type="button"><Sparkles size={16} />Fix everything</button>}
                  </div>
                  {report.purpose.map((text) => <p className="purpose" key={text}>{text}</p>)}
                  {report.people.every((person) => !person.problems.length) && (
                    <p className="hint">Nothing looks off: eyes open, nobody goofing off, no glare or red eyes. You can still tap anyone to pick another take.</p>
                  )}
                  <ul className="issues">
                    {report.people.filter((person) => person.problems.length).map((person) => {
                      const fixed = isFixed(person);
                      const fine = person.problems.every((p) => verdicts[problemKey(person, p)] === 'fine');
                      const guessFine = !fixed && !fine && likelyFine(person);
                      const thumb = person.take.face?.thumb ?? person.take.entity?.thumb;
                      const name = keyName(person.take.key);
                      const state = fixed ? 'fixed' : fine ? 'fine' : guessFine ? 'guess-fine' : 'open';
                      return (
                        <li className={state} key={person.take.key}>
                          <button className="issue-who" onClick={() => {
                            const entity = person.take.entity;
                            select(entity ? { entityId: entity.id, faceId: person.take.face?.id } : { faceId: person.take.face?.id }, 'face');
                          }} type="button" aria-label={`Show ${name}'s takes`}>
                            {thumb && <img src={thumb} alt="" />}
                          </button>
                          <div className="issue-body">
                            <b className="issue-name">{name}{fixed && <span className="tag"><CircleCheck size={14} />Fixed</span>}{fine && <span className="tag quiet">Left as it is</span>}</b>
                            {person.problems.map((problem) => {
                              const guess = predictions.get(problemKey(person, problem));
                              return (
                                <div className="issue" key={problem.dim}>
                                  <span className="issue-what">{problem.text}</span>
                                  <small>{problem.why}</small>
                                  {guess && !fixed && !fine && <small className="memory"><Brain size={13} />{guess.because}</small>}
                                </div>
                              );
                            })}
                            {person.notes.map((note) => <small className="note" key={note}>{note}</small>)}
                            {!fixed && !fine && person.fixes.map((fix) => (
                              <div className="plan" key={fix.id + (fix.mode ?? '')}>
                                <span className="plan-name">{fix.mode === 'lenses' ? FIXES.lenses.name : FIXES[fix.id].name}</span>
                                <small>{fix.why}</small>
                                <ul className="checks">{fix.checks.map((check) => <li key={check.text}><Check size={13} strokeWidth={3} />{check.text}</li>)}</ul>
                              </div>
                            ))}
                            {!fixed && !fine && person.unresolved.length > 0 && person.noFix && <small className="note">{person.noFix}</small>}
                            <div className="issue-actions">
                              {fixed ? (
                                <button className="button small" onClick={() => undoFixes(person)} type="button"><RotateCcw size={15} />Undo</button>
                              ) : fine ? (
                                <button className="button small" onClick={() => setVerdicts((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${person.take.key}:`))))} type="button">Look again</button>
                              ) : (
                                <>
                                  {person.fixes.length > 0 && <button className="button primary small" onClick={() => judgeProblems(person, 'fix')} type="button"><Sparkles size={15} />{guessFine ? 'Fix anyway' : 'Fix'}</button>}
                                  <button className="button small" onClick={() => judgeProblems(person, 'fine')} type="button"><ThumbsUp size={15} />It's fine</button>
                                </>
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
              {selection && (
                <section className="picker" ref={pickerRef} aria-label="Choose a better take">
                  <div className="picker-head">
                    <img src={selectedEntity?.thumb ?? selectedFace?.thumb} alt="" />
                    <div>
                      <h2>{title}</h2>
                      <p>Tap the take you like best. You'll see it in the picture right away.</p>
                    </div>
                    <button className="close" onClick={() => setSelection(null)} type="button" aria-label="Close"><X size={20} /></button>
                  </div>

                  {selectedEntity?.kind === 'person' && selectedFace && (
                    <div className="tabs" role="tablist">
                      <button className={tab === 'face' ? 'tab active' : 'tab'} onClick={() => setTab('face')} role="tab" aria-selected={tab === 'face'} type="button">Better face</button>
                      <button className={tab === 'pose' ? 'tab active' : 'tab'} onClick={() => setTab('pose')} role="tab" aria-selected={tab === 'pose'} type="button">Better pose</button>
                    </div>
                  )}

                  {tab === 'face' && selectedFace && (bodySwappedFaces.has(selectedFace.id) ? (
                    <p className="hint">Their whole pose comes from another photo, so their face does too. To pick just a face, set <b>Better pose</b> back to "As taken".</p>
                  ) : (
                    <>
                      <div className="options">
                        <OptionTile thumb={selectedFace.thumb} title="As taken" notes={eyeNotes(selectedFace)} active={!faceSwaps[selectedFace.id]} onClick={() => chooseFace(selectedFace.id, '')} />
                        {faceOptions.map((candidate, index) => {
                          const best = index === 0 && candidate.quality > quality(selectedFace) + 0.05;
                          return (
                            <OptionTile
                              key={candidate.face.id}
                              thumb={candidate.face.thumb}
                              title={best ? 'Best pick' : `From photo ${photoNumber(candidate.photo)}`}
                              star={best}
                              notes={eyeNotes(candidate.face)}
                              active={faceSwaps[selectedFace.id] === candidate.face.id}
                              onClick={() => chooseFace(selectedFace.id, candidate.face.id)}
                            />
                          );
                        })}
                      </div>
                      {faceOptions.length === 0 && (
                        <p className="hint">{others.length ? "We couldn't spot this face in your other photos. Tap \"Show everyone\" to pick it yourself." : 'Add another photo of the same moment to get choices.'}</p>
                      )}
                      {everyoneElse.length > 0 && (
                        <button className="text-button" onClick={() => setShowEveryone((value) => !value)} type="button">
                          <Users size={16} />{showEveryone ? 'Hide the other faces' : 'Not the right person? Show everyone'}
                        </button>
                      )}
                      {showEveryone && (
                        <div className="options compact">
                          {everyoneElse.map(({ face, photo }) => (
                            <OptionTile key={face.id} thumb={face.thumb} title={`Photo ${photoNumber(photo)}`} notes={eyeNotes(face)} active={faceSwaps[selectedFace.id] === face.id} onClick={() => chooseFace(selectedFace.id, face.id)} />
                          ))}
                        </div>
                      )}
                    </>
                  ))}

                  {(tab === 'pose' || !selectedFace) && selectedEntity && (
                    <>
                      <div className="options">
                        <OptionTile thumb={selectedEntity.thumb} title="As taken" notes={selectedEntity.kind === 'person' ? eyeNotes(faceOf(selectedEntity)) : []} active={!sceneSwaps[selectedEntity.id]} onClick={() => chooseScene(selectedEntity.id, null)} />
                        {entityOptions.map((candidate, index) => {
                          const best = index === 0 && candidate.quality > currentQuality + 0.05;
                          const frontal = candidate.entity.pose && Math.abs(candidate.entity.pose.points[0].x - (candidate.entity.pose.points[11].x + candidate.entity.pose.points[12].x) / 2) < Math.abs(candidate.entity.pose.points[11].x - candidate.entity.pose.points[12].x) * 0.25;
                          return (
                            <OptionTile
                              key={candidate.entity.id}
                              thumb={candidate.entity.thumb}
                              title={best ? 'Best pick' : `From photo ${photoNumber(candidate.photo)}`}
                              star={best}
                              notes={[...eyeNotes(faceOf(candidate.entity)), ...(frontal ? [{ text: 'Facing camera' }] : [])]}
                              active={sceneSwaps[selectedEntity.id]?.donorId === candidate.entity.id}
                              onClick={() => chooseScene(selectedEntity.id, candidate.entity.id)}
                            />
                          );
                        })}
                      </div>
                      {entityOptions.length === 0 && (
                        <p className="hint">{others.length ? `We couldn't find this ${selectedEntity.kind === 'person' ? 'person' : 'thing'} in your other photos.` : 'Add another photo of the same moment to get choices.'}</p>
                      )}
                      {selectedPlan && (
                        <div className="changes">
                          <div className="changes-head">
                            <h3><Layers size={17} />What else changes</h3>
                            <label className="toggle">
                              <input checked={showRegion} onChange={(event) => setShowRegion(event.target.checked)} type="checkbox" />
                              <span>Show on photo</span>
                            </label>
                          </div>
                          {showRegion && <p className="legend"><i className="swatch take" />From the other photo <i className="swatch keep" />Kept as it is</p>}
                          {selectedPlan.involved.length === 0 ? (
                            <p className="hint">Nothing else is touched.</p>
                          ) : (
                            <ul className="involved">
                              {selectedPlan.involved.map((item) => {
                                const text = explainInvolvement(item, title);
                                const flip: Decision = item.decision === 'moves' ? 'stays' : 'moves';
                                return (
                                  <li key={item.entity.id} className={item.decision}>
                                    <img src={item.entity.thumb} alt="" />
                                    <div>
                                      <b>{nameOf(item.entity)}</b>
                                      <span className="verdict">{text.verdict}</span>
                                      <small>{text.why}</small>
                                    </div>
                                    <button className="button small" onClick={() => decide(selectedEntity.id, selectedEntity, item, flip)} type="button">
                                      {flip === 'stays' ? 'Keep it as is' : `Bring it along`}
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      )}
                    </>
                  )}
                  <button className="button primary large done" onClick={() => setSelection(null)} type="button"><Check size={20} />Done</button>
                </section>
              )}

              <section className="photos">
                <h2>Your photos</h2>
                <p>The big picture is your main photo. Tap another one to use it instead.</p>
                <div className="photo-grid">
                  {photos.map((photo) => {
                    const people = scenes[photo.id]?.entities.filter((e) => e.kind === 'person').length ?? photo.faces.length;
                    const things = scenes[photo.id]?.entities.filter((e) => e.kind === 'object').length ?? 0;
                    return (
                      <button className={photo.id === main.id ? 'photo-tile main' : 'photo-tile'} key={photo.id} onClick={() => switchMain(photo)} type="button" aria-pressed={photo.id === main.id}>
                        <img src={photo.thumb} alt="" />
                        <span>{photo.id === main.id ? 'Main photo' : `Photo ${photoNumber(photo)}`}</span>
                        <small>{people} {people === 1 ? 'person' : 'people'}{things ? `, ${things} ${things === 1 ? 'thing' : 'things'}` : ''}</small>
                      </button>
                    );
                  })}
                  <button className="photo-tile add" onClick={() => fileInput.current?.click()} type="button" disabled={!!busy}>
                    <ImagePlus size={26} />
                    <span>Add photos</span>
                  </button>
                </div>
                <button className="text-button quiet" onClick={startOver} type="button">Start over</button>
              </section>
            </aside>
          </section>
        )}

        <details className="how">
          <summary>How does it know what looks off?</summary>
          <div className="how-body">
            <p>
              It understands a photo the way you would: as people and things, and how they stand to each other.
              It then treats two shots of the same moment as an <em>analogy</em> and works out what corresponds to what.
            </p>
            <p>
              <b>Finding what looks off, by comparison.</b> Nothing is bad on its own. Closed eyes, a raised arm or a pulled face stand out
              because everyone else is doing something different, so each person is compared with the rest of the group, and with themselves
              in the other shots. If the whole group is pulling faces, that is what the photo is for. If someone does it in every shot, they mean it.
            </p>
            <p>
              <b>One problem, every kind of thing.</b> Like an engineer looking for a solution in a different field, each problem is described by
              how it happens, not by what it looks like. Glare on glasses and a flash in a window are the same thing: a shiny surface reflecting a light into the lens.
              That lets the same reasoning and the same fixes work for people, hands, glasses, pets and things people hold.
            </p>
            <div className="library">
              {Object.values(PROBLEMS).map((problem) => (
                <div key={problem.id}>
                  <b>{problem.name}</b>
                  <small>{problem.mechanism}</small>
                  <small className="instances">For example: {problem.instances.join(', ')}.</small>
                </div>
              ))}
            </div>
            <p>
              <b>Checked before it is offered.</b> Each fix has questions it must pass first: do the shots line up there, is it the same person,
              do the glasses sit in the same place, is anyone else standing in that spot. The ticks under a fix are the questions it passed.
            </p>
            <ul>
              <li><b>Seeing the scene.</b> People (with their body pose), faces and everyday things like chairs, cups, bags and pets are found and cut out precisely.</li>
              <li><b>Relations.</b> Who is <em>holding</em>, <em>carrying</em> or <em>sitting on</em> what, who stands <em>in front of</em> whom, and who is beside whom.</li>
              <li><b>Who is who (structure-mapping).</b> The shots are lined up using the background. A person only maps to a person and a cup to a cup; among those, the mapping that keeps the most relations intact wins over any single look-alike.</li>
              <li><b>What else changes.</b> Swapping someone's pose brings along what belongs to them (what they hold or wear) and leaves alone what doesn't (the chair they sit on, people in front or behind). Each decision shows its reason.</li>
              <li><b>Physics.</b> Each decision is reasoned out from how the physical world works: something held up only by a hand would fall if left behind (gravity), a rider and a bike move as one, a chair stays because the floor holds it, and nearer things hide farther ones. New faces are also relit to match the light in the photo.</li>
              <li><b>Learning and dreaming.</b> When you change one of those decisions, it remembers that moment. While the app is idle it "dreams": it replays those memories, merges similar ones into general rules, compares them with the physics, and extends them to similar things (a lesson about chairs also covers couches).</li>
            </ul>
            <p className="learned">
              <Brain size={16} />
              {learned ? `It has learned from ${learned} of your choices on this device.` : 'It has not learned from your choices yet.'}
              {learned > 0 && <button className="text-button" onClick={() => setMemory(forget())} type="button">Forget what it learned</button>}
            </p>
            <p className="learned">
              <Brain size={16} />
              {lessons.episodes.length ? `It has learned what you consider a bad photo from ${lessons.episodes.length} of your Fix / It's fine choices.` : "Each Fix or It's fine you choose teaches it what you consider a bad photo."}
              {lessons.episodes.length > 0 && <button className="text-button" onClick={() => setLessons(forgetLessons())} type="button">Forget</button>}
            </p>
            {lessons.insights.length > 0 && (
              <div className="dreams">
                <b>What it has learned about your photos</b>
                <ul>{lessons.insights.map((insight) => <li key={insight}>{insight}</li>)}</ul>
              </div>
            )}
            {memory.insights.length > 0 && (
              <div className="dreams">
                <b>What it worked out while dreaming</b>
                <ul>{memory.insights.map((insight) => <li key={insight}>{insight}</li>)}</ul>
              </div>
            )}
            <p className="fine">Everything runs inside your browser. The models download once from Google MediaPipe. Your original files are never changed. Please only edit photos of people who'd be happy with it.</p>
          </div>
        </details>
      </main>

      {dragging && <div className="drop-overlay"><Upload size={40} /><p>Drop your photos here</p></div>}
      <input
        ref={fileInput}
        accept={ACCEPT}
        className="visually-hidden"
        multiple
        onChange={(event) => { void addFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }}
        type="file"
      />
    </div>
  );
}
