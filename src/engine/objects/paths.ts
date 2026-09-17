/**
 * The path object types (DESIGN.md §3 "Construction core"): segments, lines,
 * rays, the two circles, and polygons.
 *
 * Every one of them is *defined by* its parents and derives its geometry from
 * them — a segment never stores its own endpoints — and every one fails softly:
 * a degenerate parent set yields an `Undefined` with a user-facing reason,
 * never a throw and never a NaN (DESIGN.md D9).
 *
 * Geometry values are immutable, so a child may share its parents' `Vec2`
 * objects; only `compute`'s inputs are ever read, never written.
 */
import type { Geometry } from '../scene';
import { magnitude, unitDirection } from '../scene';
import type { Env, Undefined } from '../registry';
import { registerType } from '../registry';
import type { Json, Vec2 } from '../types';
import { EPS, dist } from '../kernel/vec2';

/** Read `n` point parents — or `undefined` when the arity or the kinds are wrong. Omit `n` for "any number". */
function asPoints(parents: Geometry[], n?: number): Vec2[] | undefined {
  if (n !== undefined && parents.length !== n) return undefined;
  const points: Vec2[] = [];
  for (const parent of parents) {
    if (parent.kind !== 'point') return undefined;
    points.push(parent.at);
  }
  return points;
}

/** Every coordinate finite — a NaN must never reach the renderer or a hit test. */
function allFinite(points: readonly Vec2[]): boolean {
  return points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

registerType({
  name: 'segment',
  title: '线段',
  parentKinds: [['point', 'point']],
  /** The finite path from the first parent to the second; dragging either end drags it. */
  compute(parents: Geometry[], _params: Json, _env: Env): Geometry | Undefined {
    const points = asPoints(parents, 2);
    if (points === undefined) return { reason: '需要两个点' };
    const [a, b] = points;
    if (!allFinite(points)) return { reason: '非有限坐标' };
    if (unitDirection(a, b) === undefined) return { reason: '两点重合' };
    return { kind: 'segment', a, b };
  },
});

registerType({
  name: 'line',
  title: '直线',
  parentKinds: [['point', 'point']],
  /**
   * The infinite line through both parents, parameterised by world units along
   * its unit direction from the **first** parent (`P(t) = at + t·dir`).
   */
  compute(parents: Geometry[], _params: Json, _env: Env): Geometry | Undefined {
    const points = asPoints(parents, 2);
    if (points === undefined) return { reason: '需要两个点' };
    const [a, b] = points;
    if (!allFinite(points)) return { reason: '非有限坐标' };
    const dir = unitDirection(a, b);
    if (dir === undefined) return { reason: '两点重合' };
    return { kind: 'line', at: a, dir };
  },
});

registerType({
  name: 'ray',
  title: '射线',
  parentKinds: [['point', 'point']],
  /**
   * The half-line starting at the first parent and running through the second,
   * so dragging the second parent swings the ray while the first pivots it.
   */
  compute(parents: Geometry[], _params: Json, _env: Env): Geometry | Undefined {
    const points = asPoints(parents, 2);
    if (points === undefined) return { reason: '需要两个点' };
    const [a, b] = points;
    if (!allFinite(points)) return { reason: '非有限坐标' };
    const dir = unitDirection(a, b);
    if (dir === undefined) return { reason: '两点重合' };
    return { kind: 'ray', at: a, dir };
  },
});

registerType({
  name: 'circle.centerPoint',
  title: '圆',
  parentKinds: [['point', 'point']],
  /** The circle centred on the first parent, through the second — so dragging either resizes it. */
  compute(parents: Geometry[], _params: Json, _env: Env): Geometry | Undefined {
    const points = asPoints(parents, 2);
    if (points === undefined) return { reason: '需要一个圆心和一个圆上的点' };
    const [centre, through] = points;
    if (!allFinite(points)) return { reason: '非有限坐标' };
    const radius = dist(centre, through);
    if (!(radius > EPS * magnitude(centre, through))) return { reason: '半径为零' };
    return { kind: 'circle', center: centre, radius };
  },
});

registerType({
  name: 'circle.centerRadius',
  title: '圆(圆心+半径)',
  parentKinds: [['point', 'number']],
  /**
   * The circle centred on the parent point with a radius taken from a
   * measurement or number parameter (DESIGN.md §3 "center+radius-from-
   * measurement") — which is what lets a slider drive a circle, and what made
   * `measure.distance` a first-class object.
   */
  compute(parents: Geometry[], _params: Json, _env: Env): Geometry | Undefined {
    if (parents.length !== 2) return { reason: '需要一个圆心和一个数值半径' };
    const centre = parents[0];
    const size = parents[1];
    if (centre.kind !== 'point' || size.kind !== 'number') {
      return { reason: '需要一个圆心和一个数值半径' };
    }
    if (!Number.isFinite(centre.at.x) || !Number.isFinite(centre.at.y)) {
      return { reason: '非有限坐标' };
    }
    // A radius is a length; an angle measurement would silently mean nothing here.
    if (size.unit === 'deg') return { reason: '半径不能是角度' };
    const radius = size.value;
    if (!Number.isFinite(radius)) return { reason: '半径无效' };
    if (radius <= 0) return { reason: radius === 0 ? '半径为零' : '半径不能为负' };
    return { kind: 'circle', center: centre.at, radius };
  },
});

registerType({
  name: 'polygon',
  title: '多边形',
  // Three or more points, variadic: the action layer reads this single
  // three-point signature as "≥ 3 points, every slot of kind point" (registry.ts).
  parentKinds: [['point', 'point', 'point']],
  /**
   * The closed polygon through every parent point, in parent order — the
   * winding is the user's, not ours (area takes the absolute value).
   */
  compute(parents: Geometry[], _params: Json, _env: Env): Geometry | Undefined {
    if (parents.length < 3) return { reason: '多边形至少需要三个点' };
    const points = asPoints(parents);
    if (points === undefined) return { reason: '多边形只能由点构成' };
    if (!allFinite(points)) return { reason: '非有限坐标' };
    if (!hasArea(points)) return { reason: '退化' };
    return { kind: 'polygon', points };
  },
});

/**
 * Shoelace area test, relative to the figure's own size: collinear vertices
 * enclose nothing, and a polygon thinner than `EPS · width²` is a hairline
 * rather than a shape. Scale-free on purpose — a small triangle far from the
 * origin is as legitimate as a large one at it.
 */
function hasArea(points: readonly Vec2[]): boolean {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let twiceArea = 0;
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    const next = points[(i + 1) % points.length];
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
    twiceArea += point.x * next.y - next.x * point.y;
  }
  const spread = Math.max(maxX - minX, maxY - minY);
  return spread > 0 && Math.abs(twiceArea) > EPS * spread * spread;
}
