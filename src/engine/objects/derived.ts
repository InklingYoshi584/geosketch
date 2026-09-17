/**
 * Derived constructions (DESIGN.md §3: midpoints, perpendiculars, parallels,
 * angle bisectors). Every type here is *defined by* its parents — the point a
 * perpendicular passes through is a parent, not a stored coordinate — so
 * dragging a parent recomputes all of it (D8).
 *
 * Numeric model: float64 with *relative* epsilons (DESIGN.md §5). A direction
 * is "degenerate" when its length is not meaningfully larger than the
 * coordinates it was built from — `scene.unitDirection`/`scene.magnitude`, the
 * shared home for that test. It is scale-free: zooming the viewport can never
 * flip definedness.
 *
 * Degeneracy is soft by design (D9): an impossible construction returns an
 * `Undefined` reason — a short Chinese phrase for the chip — and never throws
 * or produces NaN.
 */
import type { Geometry } from '../scene';
import { magnitude, unitDirection } from '../scene';
import type { Env, Undefined } from '../registry';
import { registerType } from '../registry';
import type { Json, Vec2 } from '../types';
import { EPS, add, len } from '../kernel/vec2';

/** The straight path kinds, whose direction is a single vector. */
type Straight = Extract<Geometry, { kind: 'segment' | 'line' | 'ray' }>;

/** Both coordinates finite? Guards against a malformed document seeding NaN. */
function finite(v: Vec2): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y);
}

/** Unit direction of a straight path, or `undefined` when it is degenerate. */
function straightDirection(path: Straight): Vec2 | undefined {
  if (path.kind === 'segment') return unitDirection(path.a, path.b);
  // A line/ray carries a unit `dir` by contract; a malformed document might
  // not, and this guard is what keeps it from seeding a NaN downstream. The
  // reference is the direction vector itself — `magnitude(dir, dir)` — not
  // wherever the path happens to be anchored.
  const length = len(path.dir);
  if (!(length > EPS * magnitude(path.dir, path.dir))) return undefined;
  return { x: path.dir.x / length, y: path.dir.y / length };
}

/** Read `n` point parents, or `undefined` if the arity/kinds are wrong. */
function asPoints(parents: Geometry[], n: number): Vec2[] | undefined {
  if (parents.length !== n) return undefined;
  const points: Vec2[] = [];
  for (const parent of parents) {
    if (parent.kind !== 'point') return undefined;
    points.push(parent.at);
  }
  return points;
}

registerType({
  name: 'midpoint',
  title: '中点',
  parentKinds: [['point', 'point']],
  compute(parents: Geometry[], _params: Json, _env: Env): Geometry | Undefined {
    const points = asPoints(parents, 2);
    if (!points) return { reason: 'bad parents: expected two points' };
    if (!points.every(finite)) return { reason: '非有限坐标' };
    const a = points[0];
    const b = points[1];
    // Two coincident points still have a midpoint — themselves.
    return { kind: 'point', at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  },
});

registerType({
  name: 'perpendicular',
  title: '垂线',
  parentKinds: [['point', 'path']],
  /**
   * The line through the parent point perpendicular to the parent path.
   *
   * - segment/line/ray: perpendicular to the path's own direction.
   * - circle: perpendicular to the **radius at the nearest point on the
   *   circle** — i.e. parallel to the tangent there. The line still passes
   *   through the parent point, which is the classical construction when that
   *   point lies on the circle and the natural extension when it does not. The
   *   point *nearest on the circle* is not a stored parent, so the
   *   construction stays a pure function of the two parents. A point exactly
   *   at the centre has no nearest point, hence undefined.
   */
  compute(parents: Geometry[], _params: Json, _env: Env): Geometry | Undefined {
    if (parents.length !== 2) return { reason: 'bad parents: expected a point and a path' };
    const point = parents[0];
    const path = parents[1];
    if (point.kind !== 'point') return { reason: 'bad parents: expected a point and a path' };
    if (!finite(point.at)) return { reason: '非有限坐标' };
    if (path.kind === 'circle') {
      if (!(path.radius > 0)) return { reason: '半径为零' };
      if (!finite(path.center)) return { reason: '非有限坐标' };
      const radial = unitDirection(path.center, point.at);
      if (!radial) return { reason: '点在圆心上' };
      return { kind: 'line', at: point.at, dir: { x: -radial.y, y: radial.x } };
    }
    if (path.kind === 'segment' || path.kind === 'line' || path.kind === 'ray') {
      const dir = straightDirection(path);
      if (!dir) return { reason: '退化' };
      return { kind: 'line', at: point.at, dir: { x: -dir.y, y: dir.x } };
    }
    return { reason: 'bad parents: expected a point and a path' };
  },
});

registerType({
  name: 'parallel',
  title: '平行线',
  parentKinds: [['point', 'path']],
  /** The line through the parent point parallel to the parent path. A circle has no direction, hence no parallels. */
  compute(parents: Geometry[], _params: Json, _env: Env): Geometry | Undefined {
    if (parents.length !== 2) return { reason: 'bad parents: expected a point and a path' };
    const point = parents[0];
    const path = parents[1];
    if (point.kind !== 'point') return { reason: 'bad parents: expected a point and a path' };
    if (!finite(point.at)) return { reason: '非有限坐标' };
    if (path.kind === 'circle') return { reason: '圆没有平行线' };
    if (path.kind === 'segment' || path.kind === 'line' || path.kind === 'ray') {
      const dir = straightDirection(path);
      if (!dir) return { reason: '退化' };
      return { kind: 'line', at: point.at, dir };
    }
    return { reason: 'bad parents: expected a point and a path' };
  },
});

registerType({
  name: 'angleBisector',
  title: '角平分线',
  parentKinds: [['point', 'point', 'point']],
  /**
   * The internal bisector of ∠(parents[0], parents[1], parents[2]): the vertex
   * is the *middle* parent and the result is a ray from it. The internal
   * bisector of two unit arms `u`, `v` is `u + v` normalised — correct also for
   * a zero angle (arms coincide) and degenerate exactly when the arms are
   * opposite, where no bisector direction exists.
   */
  compute(parents: Geometry[], _params: Json, _env: Env): Geometry | Undefined {
    const points = asPoints(parents, 3);
    if (!points) return { reason: 'bad parents: expected three points' };
    if (!points.every(finite)) return { reason: '非有限坐标' };
    const vertex = points[1];
    const arm1 = unitDirection(vertex, points[0]);
    const arm2 = unitDirection(vertex, points[2]);
    if (!arm1 || !arm2) return { reason: '角的边退化' };
    const sum = add(arm1, arm2);
    const l = len(sum);
    // `arm1`/`arm2` are unit vectors, so |sum| = 2·cos(θ/2) is dimensionless:
    // an absolute epsilon is the right test here.
    if (!(l > EPS)) return { reason: '角的边共线' };
    return { kind: 'ray', at: vertex, dir: { x: sum.x / l, y: sum.y / l } };
  },
});
