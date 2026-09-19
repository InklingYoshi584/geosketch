/**
 * Arcs and the circumcircle (DESIGN.md §8.1 wave A): 圆上的弧 / 三点弧 / 圆(三点).
 *
 * An `arc` is a partial circle with a *direction*: counter-clockwise from `from`
 * to `to`, the sweep being `to − from` (see scene.ts). Every arc here is built
 * from its parents alone — the endpoints are angles derived from the parents,
 * never stored coordinates — so dragging any parent slides the whole arc (D8).
 *
 * Degeneracy is soft (D9): a construction that cannot exist returns an
 * `Undefined` with a short Chinese reason for the chip, never a throw and never
 * a NaN. `circle.through3` and `arc.through3` share the one circumcircle
 * helper, so "the three points are collinear" is decided exactly once.
 */
import type { Geometry } from '../scene';
import { magnitude, positiveSweep, unitDirection } from '../scene';
import type { Env, Undefined } from '../registry';
import { registerType } from '../registry';
import type { Json, Vec2 } from '../types';
import { EPS, cross, dist, sub } from '../kernel/vec2';

/** Both coordinates finite? Guards against a malformed document seeding NaN. */
function finite(v: Vec2): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y);
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

/** The circle through three points: its centre and radius. */
interface Circumcircle {
  center: Vec2;
  radius: number;
}

/**
 * The circumcircle of three points, or `undefined` when they do not determine
 * one — collinear, or two of them coincident (which is collinearity with an
 * extra step, and a circumcentre at infinity either way).
 *
 * The test is relative, like every other predicate in the engine: the triangle's
 * doubled area is compared against the square of its own bounding-box spread,
 * so a small triangle far from the origin is judged exactly as a large one at
 * it. The centre solves `m·u = |u|²/2`, `m·w = |w|²/2` for `m = center − a`,
 * which is the two perpendicular-bisector equations written as one 2×2 system.
 */
function circumcircle(a: Vec2, b: Vec2, c: Vec2): Circumcircle | undefined {
  const u = sub(b, a);
  const w = sub(c, a);
  const spread = Math.max(
    Math.max(a.x, b.x, c.x) - Math.min(a.x, b.x, c.x),
    Math.max(a.y, b.y, c.y) - Math.min(a.y, b.y, c.y),
  );
  const determinant = cross(u, w);
  if (!(spread > 0) || !(Math.abs(determinant) > EPS * spread * spread)) return undefined;
  const uSq = u.x * u.x + u.y * u.y;
  const wSq = w.x * w.x + w.y * w.y;
  const center = {
    x: a.x + (uSq * w.y - wSq * u.y) / (2 * determinant),
    y: a.y + (u.x * wSq - w.x * uSq) / (2 * determinant),
  };
  return { center, radius: dist(center, a) };
}

/** The angle of `point` about `center`, or `undefined` when the two coincide. */
function angleAbout(center: Vec2, point: Vec2): number | undefined {
  if (!(dist(center, point) > EPS * magnitude(center, point))) return undefined;
  return Math.atan2(point.y - center.y, point.x - center.x);
}

/**
 * Did the two angles land on the same point of the circle? Tested on the
 * *positions* they stand for rather than on the raw angles: two points a
 * fraction of a degree apart are still distinct endpoints when they are far
 * from the centre and further still when they are close to it, and a
 * dimensionless angular epsilon cannot see that difference.
 */
function sameEndpoint(center: Vec2, radius: number, first: number, second: number): boolean {
  const a = { x: center.x + radius * Math.cos(first), y: center.y + radius * Math.sin(first) };
  const b = { x: center.x + radius * Math.cos(second), y: center.y + radius * Math.sin(second) };
  return unitDirection(a, b) === undefined;
}

registerType({
  name: 'circle.through3',
  title: '圆(三点)',
  parentKinds: [['point', 'point', 'point']],
  /** The circumcircle of the three parents — the circle that passes through all of them. */
  compute(parents: Geometry[], _params: Json, _env: Env): Geometry | Undefined {
    const points = asPoints(parents, 3);
    if (!points) return { reason: 'bad parents: expected three points' };
    if (!points.every(finite)) return { reason: '非有限坐标' };
    const circle = circumcircle(points[0], points[1], points[2]);
    if (circle === undefined) return { reason: '三点共线' };
    return { kind: 'circle', center: circle.center, radius: circle.radius };
  },
});

registerType({
  name: 'arc.onCircle',
  title: '圆上的弧',
  parentKinds: [['circle', 'point', 'point']],
  /**
   * The counter-clockwise arc of the parent circle from the first parent point
   * to the second.
   *
   * A point that is not on the circle is **radially projected** onto it, so the
   * construction is the natural one when the endpoints are glued to other
   * objects (a point inside the circle still picks an angle, and the arc tracks
   * it as it moves). Coincident endpoints would be an arc of no extent — which
   * the geometry cannot represent, since a sweep is folded into `(0, 2π]` —
   * hence undefined; the chip says so while the figure stays recoverable.
   */
  compute(parents: Geometry[], _params: Json, _env: Env): Geometry | Undefined {
    if (parents.length !== 3) return { reason: 'bad parents: expected a circle and two points' };
    const shape = parents[0];
    const fromPoint = parents[1];
    const toPoint = parents[2];
    if (shape.kind !== 'circle' || fromPoint.kind !== 'point' || toPoint.kind !== 'point') {
      return { reason: 'bad parents: expected a circle and two points' };
    }
    if (!finite(shape.center) || !finite(fromPoint.at) || !finite(toPoint.at)) {
      return { reason: '非有限坐标' };
    }
    // A malformed document can carry a NaN or infinite radius; both would make
    // every endpoint test meaningless, so they are refused here rather than
    // producing an arc nothing can hit.
    if (!Number.isFinite(shape.radius)) return { reason: '非有限坐标' };
    if (!(shape.radius > 0)) return { reason: '半径为零' };
    const from = angleAbout(shape.center, fromPoint.at);
    const to = angleAbout(shape.center, toPoint.at);
    // A point sitting on the centre has no angle of its own — `atan2(0, 0)`
    // would silently mean "angle 0" and jump the arc about as it passed through.
    if (from === undefined || to === undefined) return { reason: '点在圆心上' };
    if (sameEndpoint(shape.center, shape.radius, from, to)) return { reason: '弧的端点重合' };
    return { kind: 'arc', center: shape.center, radius: shape.radius, from, to: from + positiveSweep(from, to) };
  },
});

registerType({
  name: 'arc.through3',
  title: '三点弧',
  parentKinds: [['point', 'point', 'point']],
  /**
   * The arc of the circumcircle of the three parents, running from the first
   * parent through the second to the third — the classic "draw an arc through
   * these three points", and the only reading under which the middle parent
   * actually lies on the result.
   *
   * Which of the two arcs between the outer points qualifies is decided by that
   * requirement: going counter-clockwise from the first, the middle point must
   * be reached before the last, otherwise the arc runs the other way (from the
   * last back to the first). Collinear parents have no circumcircle, hence
   * undefined.
   */
  compute(parents: Geometry[], _params: Json, _env: Env): Geometry | Undefined {
    const points = asPoints(parents, 3);
    if (!points) return { reason: 'bad parents: expected three points' };
    if (!points.every(finite)) return { reason: '非有限坐标' };
    const circle = circumcircle(points[0], points[1], points[2]);
    if (circle === undefined) return { reason: '三点共线' };
    const first = Math.atan2(points[0].y - circle.center.y, points[0].x - circle.center.x);
    const middle = Math.atan2(points[1].y - circle.center.y, points[1].x - circle.center.x);
    const last = Math.atan2(points[2].y - circle.center.y, points[2].x - circle.center.x);
    // Distinct points on a circle have distinct angles, so this is a strict
    // comparison: the CCW arc from `first` that contains `middle` is the one to
    // `last` exactly when `last` is reached after `middle`.
    const from = positiveSweep(first, middle) < positiveSweep(first, last) ? first : last;
    const to = from === first ? last : first;
    return {
      kind: 'arc',
      center: circle.center,
      radius: circle.radius,
      from,
      to: from + positiveSweep(from, to),
    };
  },
});
