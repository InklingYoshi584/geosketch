/**
 * The action registry — the engine half of DESIGN.md D6 ("selection-first +
 * contextual actions"). There is no mode palette: given what the user has
 * selected, `actionsFor` says what can be *built* from it and the action bar
 * renders exactly that list.
 *
 * Matching rule: a type's `parentKinds` entry lists one required kind per
 * parent slot, in click order; the selection matches when its length equals the
 * signature's and every slot satisfies `kindMatches` (so `'path'` accepts
 * segment/line/ray/circle and `'any'` accepts everything). An action consumes
 * the *whole* selection — nothing is ever implied or auto-completed.
 *
 * `apply` never touches the document: it *builds* records and the caller pushes
 * them through `store.edit`, so one button press is one undo entry. A selection
 * that no longer fits the signature it was built for yields no objects rather
 * than a malformed record.
 */
import type { Doc, Id, Json, ObjRecord } from './types';
import type { Geometry, Scene } from './scene';
import { kindMatches, registry } from './registry';
import type { GeometryKind, ObjType } from './registry';
import { newId } from './ids';

export interface Action {
  /** Stable per type and signature, e.g. `segment:0` — safe as a DOM key. */
  id: string;
  /** Chinese UI label; already disambiguated between signatures. */
  title: string;
  group?: string;
  apply(doc: Doc, selection: Id[]): { created: ObjRecord[]; select?: Id[] };
}

/** Type-specific parameters, before they are stored as untyped JSON. */
type Params = Record<string, Json>;

/** Bar order: constructions first, then readouts, then transformations (M2). */
const GROUPS = ['构造', '测量', '变换'] as const;
type Group = (typeof GROUPS)[number];

const GROUP_RANK: Record<Group, number> = { 构造: 0, 测量: 1, 变换: 2 };

/**
 * Within a group, the order a teacher reaches for things. Types absent from
 * this list (added later) sort after it, alphabetically by name.
 */
const TYPE_ORDER = [
  'segment',
  'line',
  'ray',
  'circle.centerPoint',
  'circle.centerRadius',
  'polygon',
  'point.onObject',
  'midpoint',
  'perpendicular',
  'parallel',
  'angleBisector',
  'intersection',
  'measure.distance',
  'measure.angle',
  'measure.area',
];

const TYPE_RANK: Record<string, number> = {};
TYPE_ORDER.forEach((name, index) => {
  TYPE_RANK[name] = index;
});
const UNRANKED_TYPE = TYPE_ORDER.length;

/** Chinese word per kind, for disambiguating a type's signatures in a title. */
const KIND_WORDS: Record<GeometryKind, string> = {
  point: '点',
  segment: '线段',
  line: '直线',
  ray: '射线',
  circle: '圆',
  polygon: '多边形',
  number: '数值',
  arc: '弧',
  text: '文本',
  path: '对象',
  any: '任意',
};

/**
 * The one variadic type: `polygon` is registered with the three-point
 * signature, which means "three or more points, every parent of kind point".
 */
const POLYGON = 'polygon';

/**
 * Every action the current selection supports, deduplicated and ordered for the
 * bar. An empty, unknown, stale or partly-undefined selection yields none.
 */
export function actionsFor(doc: Doc, scene: Scene, selection: Id[]): Action[] {
  const kinds = selectedKinds(doc, scene, selection);
  if (kinds === undefined) return [];

  const candidates: { action: Action; group: Group; rank: number; sig: number }[] = [];
  for (const type of orderedTypes()) {
    const group = groupOf(type);
    for (let sig = 0; sig < type.parentKinds.length; sig++) {
      const signature = type.parentKinds[sig];
      // Types with no parents (`point.free`) are made by tapping, never from a
      // selection — offering them here would duplicate the tap affordance.
      if (signature.length === 0) continue;
      if (!signatureAccepts(type, sig, kinds)) continue;

      const variadic = type.name === POLYGON;
      candidates.push({
        group,
        rank: TYPE_RANK[type.name] ?? UNRANKED_TYPE,
        sig,
        action: {
          id: `${type.name}:${sig}`,
          title: actionTitle(type, sig),
          group,
          apply(_doc, selected) {
            const fits = variadic
              ? selected.length >= signature.length
              : selected.length === signature.length;
            if (!fits) return { created: [] };
            const record: ObjRecord = {
              id: newId(),
              type: type.name,
              parents: [...selected],
              params: defaultParams(type, kinds),
            };
            return { created: [record], select: [record.id] };
          },
        },
      });
    }
  }

  candidates.sort(
    (a, b) =>
      GROUP_RANK[a.group] - GROUP_RANK[b.group] || a.rank - b.rank || a.sig - b.sig,
  );
  return candidates.map((candidate) => candidate.action);
}

/**
 * What one more object would unlock, e.g. `再选一个点可构造线段` — the action bar
 * shows this while the current selection builds nothing, so a half-finished
 * selection explains itself instead of looking broken.
 *
 * `undefined` when the selection is already buildable, empty, unreadable, or a
 * dead end (nothing is one object away).
 */
export function nextStepHint(doc: Doc, scene: Scene, selection: Id[]): string | undefined {
  const kinds = selectedKinds(doc, scene, selection);
  if (kinds === undefined) return undefined;
  // Measurements now exist for almost every selection (a lone point has 坐标,
  // a lone segment 斜率/方程), so only a *construction* already being available
  // silences the hint: its job is teaching what one more tap unlocks, not
  // reporting what can already be measured.
  if (actionsFor(doc, scene, selection).some((action) => action.group === '构造')) return undefined;
  for (const type of orderedTypes()) {
    for (let sig = 0; sig < type.parentKinds.length; sig++) {
      const signature = type.parentKinds[sig];
      // Only a signature one object longer than the selection, extending it in
      // click order, is reachable by one more tap.
      if (signature.length !== kinds.length + 1) continue;
      if (!kinds.every((kind, i) => kindMatches(signature[i], kind))) continue;
      return `再选一个${KIND_WORDS[signature[kinds.length]]}可构造${actionTitle(type, sig)}`;
    }
  }
  return undefined;
}

/**
 * The kinds of the selected objects, in click order — or `undefined` when the
 * selection cannot be read: empty, containing an id the document does not have,
 * or containing an object that is currently undefined and therefore has no kind
 * to match against.
 */
function selectedKinds(doc: Doc, scene: Scene, selection: Id[]): Geometry['kind'][] | undefined {
  const kinds: Geometry['kind'][] = [];
  const seen = new Set<Id>();
  for (const id of selection) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (!doc.objects.some((rec) => rec.id === id)) return undefined;
    const geometry = scene.geoms.get(id);
    if (geometry === undefined) return undefined;
    kinds.push(geometry.kind);
  }
  return kinds.length === 0 ? undefined : kinds;
}

/** Registered types in bar order — deterministic regardless of import order. */
function orderedTypes(): ObjType[] {
  return [...registry.values()].sort(
    (a, b) => (TYPE_RANK[a.name] ?? UNRANKED_TYPE) - (TYPE_RANK[b.name] ?? UNRANKED_TYPE),
  );
}

function groupOf(type: ObjType): Group {
  if (type.name.startsWith('measure.')) return '测量';
  if (type.name.startsWith('transform.')) return '变换';
  return '构造';
}

/** Does the selection satisfy signature `sig` of `type`? */
function signatureAccepts(type: ObjType, sig: number, kinds: Geometry['kind'][]): boolean {
  const signature = type.parentKinds[sig];
  if (type.name === POLYGON) {
    // Variadic: 3+ points, every slot judged against the last declared slot.
    if (sig !== 0 || kinds.length < signature.length) return false;
  } else if (signature.length !== kinds.length) {
    return false;
  }
  return kinds.every((kind, i) => kindMatches(signature[Math.min(i, signature.length - 1)], kind));
}

/**
 * A type's Chinese title. A type declaring several signatures gets the
 * signature appended so the buttons stay distinguishable (`面积(多边形)` vs
 * `面积(圆)`); the two circles are separate types whose titles already name
 * their parents (`圆` vs `圆(圆心+半径)`).
 */
function actionTitle(type: ObjType, sig: number): string {
  if (type.parentKinds.length <= 1) return type.title;
  const words = type.parentKinds[sig].map((kind) => KIND_WORDS[kind]);
  const uniform = words.every((word) => word === words[0]);
  const slots = uniform && words.length > 2 ? `${words[0]}×${words.length}` : words.join('+');
  return `${type.title}(${slots})`;
}

/**
 * Parameters a freshly built object starts with: only what the user cannot
 * re-derive by dragging. Everything else starts empty.
 */
function defaultParams(type: ObjType, kinds: Geometry['kind'][]): Params {
  switch (type.name) {
    case 'point.onObject':
      // The middle of a segment; the origin of anything open-ended.
      return { t: kinds[0] === 'segment' ? 0.5 : 0 };
    case 'intersection':
      return { branch: 0 };
    default:
      return {};
  }
}
