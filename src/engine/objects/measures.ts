/**
 * Measurements (DESIGN.md §3 "Measurements as objects"): first-class numeric
 * objects. A measurement *is* a `number` geometry — it renders as a readout
 * (see the renderer's number display) and can feed other constructions
 * (circle radius, calculations, …) exactly like any other geometry.
 *
 * Values are world units (D18), y-up, and every `compute` is pure: the same
 * parents and params yield the same number, with no dependence on the viewport.
 * A measurement whose parents are degenerate returns an `Undefined` reason
 * (D9) rather than a NaN — a NaN readout would poison every consumer.
 */
import type { Geometry } from '../scene';
import { unitDirection } from '../scene';
import type { Env, Undefined } from '../registry';
import { registerType } from '../registry';
import type { Json, Vec2 } from '../types';
import { cross, dist, dot } from '../kernel/vec2';

/** Degrees per radian, as a named constant: `* 180 / Math.PI` reads as noise. */
const DEG_PER_RAD = 180 / Math.PI;

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

registerType({
  name: 'measure.distance',
  title: '距离',
  // Two accepted signatures of different arities: two points, or one segment
  // whose length is the distance (the first is the general form, so
  // `measure.distance:0` keeps its meaning for the action layer).
  parentKinds: [['point', 'point'], ['segment']],
  /**
   * |AB| in world units. Two coincident points measure 0, which is a
   * legitimate distance — and so does a zero-length segment.
   */
  compute(parents: Geometry[], _params: Json, _env: Env): Geometry | Undefined {
    if (parents.length === 1) {
      const parent = parents[0];
      if (parent.kind !== 'segment') return { reason: 'bad parents: expected two points or a segment' };
      if (!finite(parent.a) || !finite(parent.b)) return { reason: '非有限坐标' };
      return { kind: 'number', value: dist(parent.a, parent.b) };
    }
    const points = asPoints(parents, 2);
    if (!points) return { reason: 'bad parents: expected two points' };
    if (!points.every(finite)) return { reason: '非有限坐标' };
    return { kind: 'number', value: dist(points[0], points[1]) };
  },
});

registerType({
  name: 'measure.angle',
  title: '角度',
  parentKinds: [['point', 'point', 'point']],
  /**
   * ∠(parents[0], parents[1], parents[2]) in degrees, the vertex being the
   * *middle* parent. `acos` of the clamped dot product of the two unit arms
   * lands in [0, 180] by construction; the clamp only absorbs the float error
   * that would otherwise make `acos` return NaN at exactly 0° or 180°.
   */
  compute(parents: Geometry[], _params: Json, _env: Env): Geometry | Undefined {
    const points = asPoints(parents, 3);
    if (!points) return { reason: 'bad parents: expected three points' };
    if (!points.every(finite)) return { reason: '非有限坐标' };
    const vertex = points[1];
    const arm1 = unitDirection(vertex, points[0]);
    const arm2 = unitDirection(vertex, points[2]);
    if (!arm1 || !arm2) return { reason: '角的边退化' };
    const cos = Math.min(1, Math.max(-1, dot(arm1, arm2)));
    return { kind: 'number', value: Math.acos(cos) * DEG_PER_RAD, unit: 'deg' };
  },
});

registerType({
  name: 'measure.area',
  title: '面积',
  // Two accepted signatures of the same arity (registry.ts `parentKinds` lists
  // one entry per legal signature, so a union of kinds is two entries).
  parentKinds: [['polygon'], ['circle']],
  /**
   * Area in world units² — the shoelace formula for a polygon (absolute value,
   * so vertex order may be either winding), πr² for a circle. A self-
   * intersecting polygon measures its signed regions summed, which is the
   * standard convention and not worth special-casing for quiz figures.
   */
  compute(parents: Geometry[], _params: Json, _env: Env): Geometry | Undefined {
    if (parents.length !== 1) return { reason: 'bad parents: expected a polygon or a circle' };
    const shape = parents[0];
    if (shape.kind === 'circle') {
      if (!Number.isFinite(shape.radius) || shape.radius < 0) return { reason: '半径为零' };
      return { kind: 'number', value: Math.PI * shape.radius * shape.radius };
    }
    if (shape.kind === 'polygon') {
      const points = shape.points;
      if (points.length < 3) return { reason: '退化' };
      if (!points.every(finite)) return { reason: '非有限坐标' };
      let twiceArea = 0;
      for (let i = 0; i < points.length; i++) {
        twiceArea += cross(points[i], points[(i + 1) % points.length]);
      }
      return { kind: 'number', value: Math.abs(twiceArea) / 2 };
    }
    return { reason: 'bad parents: expected a polygon or a circle' };
  },
});
