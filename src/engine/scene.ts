/**
 * The compute core: document in, scene out.
 *
 * `computeScene` resolves the construction DAG by depth-first search, memoising
 * each object so the graph is walked once. It knows nothing about individual
 * object types — it only asks the registry (DESIGN.md §5 "Engine rules").
 *
 * The rest of the file is the path math the whole engine shares: every kind's
 * parameterisation (`evalPath`), its inverse (`projectPoint`), the sample point
 * a label or number readout attaches to (`anchorsOf`), and the distance the hit
 * test measures (`hitTest`).
 */
import type { Doc, Id, ObjRecord, Vec2, Viewport } from './types';
import { isUndefined, registry } from './registry';
import type { Env } from './registry';
import { EPS, dist, distSq, dot, lerp, sub } from './kernel/vec2';

/**
 * Computed geometry, a discriminated union keyed by `kind`. Individual object
 * *types* never touch this file — they only choose which kind they produce.
 *
 * Parameterisation (frozen contract; `t` is world units for line/ray, a
 * proportion for a segment, an angle in radians for a circle):
 *   segment  P(t) = a + t(b − a),              t ∈ [0, 1]
 *   line     P(t) = at + t·dir,                t ∈ ℝ  (`dir` a unit vector)
 *   ray      P(t) = at + t·dir,                t ≥ 0  (`dir` a unit vector)
 *   circle   P(t) = center + r(cos t, sin t),  t ∈ [0, 2π)
 * Stored parameters are never rewritten by `compute` (a glued point keeps its
 * proportion when its parent moves); interaction clamps while dragging.
 */
export type Geometry =
  | { kind: 'point'; at: Vec2 }
  | { kind: 'segment'; a: Vec2; b: Vec2 }
  | { kind: 'line'; at: Vec2; dir: Vec2 }
  | { kind: 'ray'; at: Vec2; dir: Vec2 }
  | { kind: 'circle'; center: Vec2; radius: number }
  | { kind: 'polygon'; points: Vec2[] }
  | { kind: 'number'; value: number; unit?: 'deg' };

/** The parameterised kinds — what a `'path'` parent slot accepts. */
export type PathGeometry = Extract<Geometry, { kind: 'segment' | 'line' | 'ray' | 'circle' }>;

/** The parameterised kinds that are straight (everything but a circle). */
export type LineLikeGeometry = Extract<Geometry, { kind: 'segment' | 'line' | 'ray' }>;

/** Narrow a geometry to the parameterised kinds (`evalPath`/`projectPoint`). */
export function isPathGeometry(geom: Geometry): geom is PathGeometry {
  return (
    geom.kind === 'segment' || geom.kind === 'line' || geom.kind === 'ray' || geom.kind === 'circle'
  );
}

/**
 * The computed result for a document: geometry for every defined object, and a
 * reason for every object that could not be computed (DESIGN.md D9).
 *
 * Both maps iterate in **document order** — that is draw order, and it is what
 * `hitTest` uses to break ties.
 */
export interface Scene {
  geoms: Map<Id, Geometry>;
  undefined: Map<Id, string>;
}

/** World centre (0, 0) at 64 pixels per world unit. */
export const DEFAULT_VIEWPORT: Viewport = { cx: 0, cy: 0, scale: 64 };

/**
 * A fresh, empty document. The viewport is a fresh object, never the shared
 * `DEFAULT_VIEWPORT`, so callers may mutate their own copy.
 */
export function createEmptyDoc(): Doc {
  return { version: 1, viewport: { ...DEFAULT_VIEWPORT }, objects: [] };
}

/**
 * Compute every object in `doc`.
 *
 * Undefined handling, in the order the cases are decided:
 * - a parent id that is not in the document → `'missing parent'`;
 * - an unregistered type → `'unknown type: <name>'`;
 * - an edge that closes a cycle → `'cycle'` on the object the edge points at;
 * - a `compute` that yields `Undefined` → its own reason;
 * - anything else downstream of an undefined object inherits the root cause, so
 *   the chip stays actionable at any depth instead of saying "parent undefined".
 *
 * `doc.axes` is document data only in M0 — the coordinate system arrives with
 * the axes type in M2, so it is deliberately not computed here.
 */
export function computeScene(doc: Doc): Scene {
  const records = new Map<Id, ObjRecord>();
  for (const record of doc.objects) records.set(record.id, record);

  const env: Env = { scale: doc.viewport.scale };
  const states = new Map<Id, 'visiting' | 'done'>();
  const geoms = new Map<Id, Geometry>();
  const reasons = new Map<Id, string>();

  // Recursion depth is the length of a dependency chain, not the object count,
  // so memoisation also bounds the stack (quiz figures: tens of frames deep).
  const visit = (id: Id): void => {
    const state = states.get(id);
    if (state === 'done') return;
    if (state === 'visiting') {
      // Back edge: the object it points at is a cycle member.
      reasons.set(id, 'cycle');
      return;
    }

    const record = records.get(id);
    if (record === undefined) {
      states.set(id, 'done');
      reasons.set(id, 'missing parent');
      return;
    }

    const type = registry.get(record.type);
    if (type === undefined) {
      states.set(id, 'done');
      reasons.set(id, `unknown type: ${record.type}`);
      return;
    }

    states.set(id, 'visiting');

    let reason: string | undefined;
    const parents: Geometry[] = [];
    for (const parentId of record.parents) {
      visit(parentId);
      const parentGeom = geoms.get(parentId);
      if (parentGeom === undefined) {
        reason = reasons.get(parentId) ?? 'missing parent';
        break;
      }
      parents.push(parentGeom);
    }

    states.set(id, 'done');

    if (reasons.has(id)) return; // a back edge inside this subtree pointed here
    if (reason !== undefined) {
      reasons.set(id, reason);
      return;
    }

    const result = type.compute(parents, record.params, env);
    if (isUndefined(result)) reasons.set(id, result.reason);
    else geoms.set(id, result);
  };

  for (const record of doc.objects) visit(record.id);

  // Emit in document order (the DFS above reaches parents before children, which
  // is not document order).
  const scene: Scene = { geoms: new Map(), undefined: new Map() };
  for (const record of doc.objects) {
    const geom = geoms.get(record.id);
    if (geom !== undefined) scene.geoms.set(record.id, geom);
    const reason = reasons.get(record.id);
    if (reason !== undefined) scene.undefined.set(record.id, reason);
  }
  return scene;
}

const TWO_PI = Math.PI * 2;

/**
 * Magnitude reference for a relative epsilon: the largest coordinate among the
 * two points involved, never below 1 (DESIGN.md §5 "relative epsilons"). Points
 * near the origin are therefore compared against `EPS` itself.
 */
export function magnitude(a: Vec2, b: Vec2): number {
  return Math.max(1, Math.abs(a.x), Math.abs(a.y), Math.abs(b.x), Math.abs(b.y));
}

/**
 * The unit direction from `from` to `to`, or `undefined` when the two points
 * coincide relative to their own size (DESIGN.md §5: no absolute equality).
 */
export function unitDirection(from: Vec2, to: Vec2): Vec2 | undefined {
  const delta = sub(to, from);
  const length = Math.hypot(delta.x, delta.y);
  if (!(length > EPS * magnitude(from, to))) return undefined;
  return { x: delta.x / length, y: delta.y / length };
}

/** Fold an angle into `[0, 2π)` — a circle's parameter. */
function wrapTau(t: number): number {
  const wrapped = t % TWO_PI;
  return wrapped < 0 ? wrapped + TWO_PI : wrapped;
}

/** A segment's parameter. */
function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Mean of `points`, the origin for an empty list. */
function centroid(points: readonly Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  return points.length === 0 ? { x: 0, y: 0 } : { x: x / points.length, y: y / points.length };
}

/**
 * The sample point of a geometry: the representative point a label sits on, in
 * the frozen per-kind rule (point→at, segment→midpoint, line/ray→at,
 * circle→center, polygon→centroid). A `number` has no position of its own, so
 * `anchorsOf` — which has the parent graph — resolves it to the origin here.
 *
 * The returned vector is a fresh copy: callers may keep or mutate it freely.
 */
function samplePointOf(geom: Geometry): Vec2 {
  switch (geom.kind) {
    case 'point':
      return { x: geom.at.x, y: geom.at.y };
    case 'segment':
      return lerp(geom.a, geom.b, 0.5);
    case 'line':
      return { x: geom.at.x, y: geom.at.y };
    case 'ray':
      return { x: geom.at.x, y: geom.at.y };
    case 'circle':
      return { x: geom.center.x, y: geom.center.y };
    case 'polygon':
      return centroid(geom.points);
    case 'number':
      return { x: 0, y: 0 };
  }
}

/**
 * The point at parameter `t` on a path, per the frozen parameterisation.
 * **Clamped per kind** — segment `[0, 1]`, ray `≥ 0`, circle folded into
 * `[0, 2π)`, line unbounded — so nothing is ever computed off the end of a
 * finite path; the stored parameter is untouched, only this reading of it is.
 * A non-finite `t` reads as 0 rather than poisoning the geometry with NaN.
 *
 * Kinds without a parameterisation fall back to their sample point, which keeps
 * this total for a renderer that walks every geometry.
 */
export function evalPath(geom: Geometry, t: number): Vec2 {
  const u = Number.isFinite(t) ? t : 0;
  switch (geom.kind) {
    case 'segment':
      return lerp(geom.a, geom.b, clamp01(u));
    case 'line':
      return { x: geom.at.x + geom.dir.x * u, y: geom.at.y + geom.dir.y * u };
    case 'ray': {
      const along = u > 0 ? u : 0;
      return { x: geom.at.x + geom.dir.x * along, y: geom.at.y + geom.dir.y * along };
    }
    case 'circle': {
      const angle = wrapTau(u);
      return {
        x: geom.center.x + geom.radius * Math.cos(angle),
        y: geom.center.y + geom.radius * Math.sin(angle),
      };
    }
    case 'point':
    case 'polygon':
    case 'number':
      return samplePointOf(geom);
  }
}

/**
 * The parameter whose `evalPath` is nearest to `world` — the clamped inverse of
 * `evalPath`. This is what re-projects a point glued to a path while it is
 * dragged (DESIGN.md §5 "the parameter is re-projected, never reset"). Kinds
 * without a parameterisation return 0.
 */
export function projectPoint(geom: Geometry, world: Vec2): number {
  const raw = rawProjection(geom, world);
  return Number.isFinite(raw) ? raw : 0;
}

function rawProjection(geom: Geometry, world: Vec2): number {
  switch (geom.kind) {
    case 'segment': {
      const along = sub(geom.b, geom.a);
      const lengthSq = dot(along, along);
      if (!(lengthSq > 0)) return 0; // degenerate: every t is as good as every other
      return clamp01(dot(sub(world, geom.a), along) / lengthSq);
    }
    case 'line':
      return dot(sub(world, geom.at), geom.dir);
    case 'ray': {
      const t = dot(sub(world, geom.at), geom.dir);
      return t > 0 ? t : 0;
    }
    case 'circle':
      return wrapTau(Math.atan2(world.y - geom.center.y, world.x - geom.center.x));
    case 'point':
    case 'polygon':
    case 'number':
      return 0;
  }
}

/**
 * Squared distance from `world` to the segment `a`→`b`. Used for segments and
 * for every polygon edge — a polygon's interior is deliberately not a hit, so
 * this is what makes its boundary tappable.
 */
function distSqToSegment(a: Vec2, b: Vec2, world: Vec2): number {
  const along = sub(b, a);
  const lengthSq = dot(along, along);
  const t = lengthSq > 0 ? clamp01(dot(sub(world, a), along) / lengthSq) : 0;
  return distSq(lerp(a, b, t), world);
}

/**
 * Distance from `world` to a geometry, squared. This switch is the extension
 * seam for new geometry kinds: adding one makes this non-exhaustive, which is a
 * compile error here.
 *
 * A point, a segment and a ray are hit at their nearest point; a line is hit at
 * its nearest point, which is unclamped; a circle is hit on its ring, never at
 * its centre; a polygon is hit on its boundary only; and a `number` is
 * positionless, so `hitTest` measures to the anchor its parents give it.
 */
function distSqToGeometry(geom: Geometry, world: Vec2): number {
  switch (geom.kind) {
    case 'point':
      return distSq(geom.at, world);
    case 'segment':
      return distSqToSegment(geom.a, geom.b, world);
    case 'line':
    case 'ray':
      return distSq(evalPath(geom, projectPoint(geom, world)), world);
    case 'circle': {
      const radial = dist(geom.center, world) - geom.radius;
      return radial * radial;
    }
    case 'polygon': {
      const points = geom.points;
      if (points.length === 0) return Number.POSITIVE_INFINITY;
      let nearest = Number.POSITIVE_INFINITY;
      for (let i = 0; i < points.length; i += 1) {
        nearest = Math.min(nearest, distSqToSegment(points[i], points[(i + 1) % points.length], world));
      }
      return nearest;
    }
    case 'number':
      return Number.POSITIVE_INFINITY;
  }
}

/** Depth cap for the anchor walk — a malformed (cyclic) document must not hang the app. */
const ANCHOR_DEPTH_LIMIT = 64;

/**
 * Where every object's label sits — and where a `number` readout is drawn and
 * hit — as the **average sample point of its parents**, with a `number` used as
 * a parent recursing into its first parent (frozen rule). Objects that are
 * currently undefined have no anchor, so they are absent from the map.
 *
 * `hitTest` needs this because a `number` has no position of its own. Pure; one
 * pass over the document, cheap enough for a pointer-down.
 */
export function anchorsOf(doc: Doc, scene: Scene): Map<Id, Vec2> {
  const records = new Map<Id, ObjRecord>();
  for (const record of doc.objects) records.set(record.id, record);

  /** A number's own sample point: its first parent's, recursively. */
  const sampleOf = (id: Id, depth: number): Vec2 | undefined => {
    const geom = scene.geoms.get(id);
    if (geom === undefined) return undefined;
    if (geom.kind !== 'number') return samplePointOf(geom);
    if (depth >= ANCHOR_DEPTH_LIMIT) return undefined;
    const first = records.get(id)?.parents[0];
    return first === undefined ? undefined : sampleOf(first, depth + 1);
  };

  const anchorOf = (id: Id, depth: number): Vec2 | undefined => {
    const geom = scene.geoms.get(id);
    if (geom === undefined) return undefined;
    if (geom.kind !== 'number') return samplePointOf(geom);
    if (depth >= ANCHOR_DEPTH_LIMIT) return undefined;
    let x = 0;
    let y = 0;
    let count = 0;
    for (const parentId of records.get(id)?.parents ?? []) {
      const sample = sampleOf(parentId, depth + 1);
      if (sample === undefined) continue;
      x += sample.x;
      y += sample.y;
      count += 1;
    }
    return count === 0 ? { x: 0, y: 0 } : { x: x / count, y: y / count };
  };

  const anchors = new Map<Id, Vec2>();
  for (const record of doc.objects) {
    const anchor = anchorOf(record.id, 0);
    if (anchor !== undefined) anchors.set(record.id, anchor);
  }
  return anchors;
}

/**
 * Hit priority by object size, used only when distances tie (or nearly do):
 * a point must beat the path it lies on, or dragging a triangle vertex — or any
 * vertex of a polygon — would be impossible (`ids[0]` is what a tap selects).
 */
function hitRank(geom: Geometry): number {
  switch (geom.kind) {
    case 'point':
      return 0;
    case 'number':
      return 1;
    default:
      return 2;
  }
}

/**
 * Ids of objects within `tolWorld` of `world` (world units; the caller converts
 * from pixels), nearest first. Ties are broken by hit priority (point before
 * number before path) and then by draw order — the last drawn object wins — so
 * `ids[0]` is what a tap should select.
 *
 * Objects that are undefined have no geometry and cannot be hit. A `number` is
 * positionless, so it is hit at the anchor `anchors` gives it (see
 * `anchorsOf`); called without that map, numbers are simply not hit.
 */
export function hitTest(
  scene: Scene,
  world: Vec2,
  tolWorld: number,
  anchors?: ReadonlyMap<Id, Vec2>,
): Id[] {
  const tolSq = tolWorld * tolWorld;
  const hits: { id: Id; dSq: number; rank: number; order: number }[] = [];
  let order = 0;
  for (const [id, geom] of scene.geoms) {
    order += 1;
    let dSq: number;
    if (geom.kind === 'number') {
      const anchor = anchors?.get(id);
      dSq = anchor === undefined ? Number.POSITIVE_INFINITY : distSq(anchor, world);
    } else {
      dSq = distSqToGeometry(geom, world);
    }
    if (dSq <= tolSq) hits.push({ id, dSq, rank: hitRank(geom), order });
  }
  hits.sort((a, b) => a.dSq - b.dSq || a.rank - b.rank || b.order - a.order);
  return hits.map((hit) => hit.id);
}
