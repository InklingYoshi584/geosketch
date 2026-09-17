/**
 * `intersection` — where two paths meet (DESIGN.md §3 "intersections
 * (line/circle/segment families) with branch continuity").
 *
 * Roots are ordered by their parameter `t` along the **first** parent's
 * parameterisation, and `params.branch` picks one — so swapping the parents
 * reorders the branches, and a construction that names its branch keeps it.
 * A tangent root is reported twice, which makes branch 0 and branch 1 agree
 * exactly while a circle slides through tangency: that is what stops the figure
 * from jumping at the moment of tangency. Every failure is an `Undefined`
 * carrying the reason a teacher would give (`两直线平行`, `无交点`, …).
 */
import type { Geometry, LineLikeGeometry, PathGeometry } from '../scene';
import { evalPath, isPathGeometry, magnitude, projectPoint, unitDirection } from '../scene';
import type { Env, Undefined } from '../registry';
import { registerType } from '../registry';
import type { Json, Vec2 } from '../types';
import { EPS, cross, dist, dot, sub } from '../kernel/vec2';

/** A circle's on its own, for the solvers below. */
type CircleGeometry = Extract<Geometry, { kind: 'circle' }>;

/** Relative epsilon on a parameter: segment ratios and world-unit offsets alike. */
const PARAM_EPS = 1e-9;

/**
 * Roots, or the reason there are none. Wrapped rather than a bare array so a
 * caller can always tell "no roots" from "here are the roots".
 */
type Roots = { roots: number[] } | Undefined;

/** A straight path as an origin plus a unit direction — the form both solvers work in. */
interface LineForm {
  at: Vec2;
  dir: Vec2;
}

/** `undefined` for a degenerate (zero-length) segment; a circle is not straight at all. */
function lineForm(geom: LineLikeGeometry): LineForm | undefined {
  if (geom.kind !== 'segment') return { at: geom.at, dir: geom.dir };
  const dir = unitDirection(geom.a, geom.b);
  return dir === undefined ? undefined : { at: geom.a, dir };
}

/** The parent's own parameter for a world-unit offset from its origin along its direction. */
function paramFromOffset(path: LineLikeGeometry, offset: number): number {
  if (path.kind !== 'segment') return offset; // a line and a ray are parameterised in world units
  const length = dist(path.a, path.b);
  return length > 0 ? offset / length : 0;
}

/** Is the parent's own parameter inside its domain? Segments `[0,1]`, rays `t ≥ 0`, lines anything. */
function inDomain(path: LineLikeGeometry, t: number): boolean {
  if (path.kind === 'segment') return t >= -PARAM_EPS && t <= 1 + PARAM_EPS;
  if (path.kind === 'ray') return t >= -PARAM_EPS;
  return true;
}

/**
 * Two straight paths: at most one root. Parallel lines never meet, and a pair
 * sharing infinitely many points is not an intersection either — the two get
 * different reasons, because what the teacher has to fix differs.
 */
function straightThenStraight(first: LineLikeGeometry, second: LineLikeGeometry): Roots {
  const a = lineForm(first);
  const b = lineForm(second);
  if (a === undefined || b === undefined) return { reason: '退化' };
  const between = sub(b.at, a.at);
  const denominator = cross(a.dir, b.dir);
  if (Math.abs(denominator) <= EPS) {
    // `cross(unit, between)` is how far the second origin sits off the first line.
    const offset = Math.abs(cross(a.dir, between));
    return { reason: offset <= EPS * magnitude(a.at, b.at) ? '两直线重合' : '两直线平行' };
  }
  const t = paramFromOffset(first, cross(between, b.dir) / denominator);
  const s = paramFromOffset(second, cross(between, a.dir) / denominator);
  if (!inDomain(first, t) || !inDomain(second, s)) return { reason: '无交点' };
  return { roots: [t] };
}

/**
 * The offsets along `form.dir` where a straight path meets a circle, ascending.
 * Tangency yields its single root twice, so a branch index never has to jump.
 * Solving `|at + u·dir − centre|² = r²` for `u` leaves `u² + 2·along·u + c = 0`.
 */
function straightCircleOffsets(form: LineForm, centre: Vec2, radius: number): Roots {
  if (!Number.isFinite(radius) || radius <= 0) return { reason: '半径为零' };
  const toCentre = sub(form.at, centre);
  const along = dot(toCentre, form.dir);
  const toCentreSq = dot(toCentre, toCentre);
  const discriminant = along * along - (toCentreSq - radius * radius);
  const reference = Math.max(toCentreSq, radius * radius);
  if (discriminant < -EPS * reference) return { reason: '无交点' }; // the line misses the circle
  if (discriminant <= EPS * reference) return { roots: [-along, -along] }; // tangent: one root, reported twice
  const root = Math.sqrt(discriminant);
  return { roots: [-along - root, -along + root] };
}

/** Straight path first: keep the circle roots the straight path's own domain admits. */
function straightThenCircle(first: LineLikeGeometry, second: CircleGeometry): Roots {
  const form = lineForm(first);
  if (form === undefined) return { reason: '退化' };
  const offsets = straightCircleOffsets(form, second.center, second.radius);
  if (!('roots' in offsets)) return offsets;
  const roots: number[] = [];
  for (const offset of offsets.roots) {
    const t = paramFromOffset(first, offset);
    if (inDomain(first, t)) roots.push(t);
  }
  return roots.length === 0 ? { reason: '无交点' } : { roots };
}

/**
 * Circle first: the same intersections, but read as *angles* on the circle and
 * ordered around it. `projectPoint` supplies the angle, so what `evalPath`
 * reads back is the same parameterisation hit-testing and dragging use.
 */
function circleThenStraight(first: CircleGeometry, second: LineLikeGeometry): Roots {
  const form = lineForm(second);
  if (form === undefined) return { reason: '退化' };
  const offsets = straightCircleOffsets(form, first.center, first.radius);
  if (!('roots' in offsets)) return offsets;
  const roots: number[] = [];
  for (const offset of offsets.roots) {
    const t = paramFromOffset(second, offset);
    if (!inDomain(second, t)) continue;
    roots.push(projectPoint(first, evalPath(second, t)));
  }
  roots.sort((a, b) => a - b);
  return roots.length === 0 ? { reason: '无交点' } : { roots };
}

/** The first parent's parameters where the two paths meet, ascending. */
function rootParams(first: PathGeometry, second: PathGeometry): Roots {
  if (first.kind === 'circle') {
    if (second.kind === 'circle') return { reason: '两圆相交暂不支持' };
    return circleThenStraight(first, second);
  }
  if (second.kind === 'circle') return straightThenCircle(first, second);
  return straightThenStraight(first, second);
}

/** `params.branch`, a non-negative integer; a fresh object starts on branch 0. */
function readBranch(params: Json): number {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return 0;
  const raw = params.branch;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0;
  return Math.max(0, Math.trunc(raw));
}

registerType({
  name: 'intersection',
  title: '交点',
  parentKinds: [['path', 'path']],
  /** The branch-th meeting of the two paths, as a point that follows both. */
  compute(parents: Geometry[], params: Json, _env: Env): Geometry | Undefined {
    if (parents.length !== 2) return { reason: '需要两个路径对象' };
    const first = parents[0];
    const second = parents[1];
    if (!isPathGeometry(first) || !isPathGeometry(second)) return { reason: '需要两个路径对象' };
    const found = rootParams(first, second);
    if (!('roots' in found)) return found;
    const branch = readBranch(params);
    // A branch the current configuration does not have is an undefined point,
    // not a wrong one: the chip explains it and the figure returns on drag-back.
    if (branch >= found.roots.length) return { reason: '无交点' };
    return { kind: 'point', at: evalPath(first, found.roots[branch]) };
  },
});
