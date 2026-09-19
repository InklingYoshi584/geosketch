/**
 * Tests for the derived constructions (objects/derived.ts).
 *
 * The oracle is the *property* each construction must satisfy (DESIGN.md §7
 * "property / invariant tests"), not the arithmetic the implementation happens
 * to perform: a midpoint is equidistant, a perpendicular has zero dot product
 * with its parent, a bisector makes equal angles. Sweeps are fed by a seeded
 * generator so they cover more configurations than hand-written cases without
 * ever turning flaky.
 */
import { describe, expect, it } from 'vitest';

import { isUndefined, registry } from './registry';
import type { Env, Undefined } from './registry';
import type { Geometry } from './scene';
import type { Json, Vec2 } from './types';
import { cross, dist, dot, len, sub } from './kernel/vec2';
import './objects/derived';

const ENV: Env = { scale: 64 };

const V = (x: number, y: number): Vec2 => ({ x, y });
const P = (x: number, y: number): Geometry => ({ kind: 'point', at: V(x, y) });
const segment = (ax: number, ay: number, bx: number, by: number): Geometry => ({
  kind: 'segment',
  a: V(ax, ay),
  b: V(bx, by),
});
const unit = (dx: number, dy: number): Vec2 => {
  const l = Math.hypot(dx, dy);
  return V(dx / l, dy / l);
};
const line = (ax: number, ay: number, dx: number, dy: number): Geometry => ({
  kind: 'line',
  at: V(ax, ay),
  dir: unit(dx, dy),
});
const ray = (ax: number, ay: number, dx: number, dy: number): Geometry => ({
  kind: 'ray',
  at: V(ax, ay),
  dir: unit(dx, dy),
});
const circle = (cx: number, cy: number, radius: number): Geometry => ({
  kind: 'circle',
  center: V(cx, cy),
  radius,
});

/**
 * Deterministic uniform values in [-5, 5] (a 32-bit LCG): a property sweep must
 * exercise many shapes and still give the same answer on every run.
 */
function seededValues(seed: number, count: number): number[] {
  const values: number[] = [];
  let state = seed >>> 0;
  for (let i = 0; i < count; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    values.push((state / 4294967296) * 10 - 5);
  }
  return values;
}

function compute(name: string, parents: Geometry[], params: Json = null): Geometry | Undefined {
  const type = registry.get(name);
  if (!type) throw new Error(`type not registered: ${name}`);
  return type.compute(parents, params, ENV);
}

function defined(name: string, parents: Geometry[], params: Json = null): Geometry {
  const result = compute(name, parents, params);
  if (isUndefined(result)) throw new Error(`${name} unexpectedly undefined: ${result.reason}`);
  return result;
}

function reasonOf(name: string, parents: Geometry[]): string {
  const result = compute(name, parents);
  if (!isUndefined(result)) {
    throw new Error(`${name} unexpectedly defined: ${JSON.stringify(result)}`);
  }
  return result.reason;
}

function atOf(geometry: Geometry): Vec2 {
  if (geometry.kind !== 'point') throw new Error(`not a point: ${geometry.kind}`);
  return geometry.at;
}

function dirOf(geometry: Geometry): Vec2 {
  if (geometry.kind !== 'line' && geometry.kind !== 'ray') {
    throw new Error(`not a directed geometry: ${geometry.kind}`);
  }
  return geometry.dir;
}

function anchorOf(geometry: Geometry): Vec2 {
  if (geometry.kind !== 'line' && geometry.kind !== 'ray') {
    throw new Error(`not a directed geometry: ${geometry.kind}`);
  }
  return geometry.at;
}

/** Compute twice, from structurally identical but distinct inputs. */
function expectDeterministic(name: string, parents: Geometry[]): void {
  const clone = JSON.parse(JSON.stringify(parents)) as Geometry[];
  expect(compute(name, parents)).toEqual(compute(name, clone));
}

describe('midpoint', () => {
  it('is registered with the title and parent kinds the action bar reads', () => {
    expect(registry.get('midpoint')?.title).toBe('中点');
    // One entry per legal signature, the two-point form first: the palette and
    // the tool reducer both address `midpoint:0` as the two-point construction,
    // and the one-segment form is the additional signature `midpoint:1`.
    expect(registry.get('midpoint')?.parentKinds).toEqual([['point', 'point'], ['segment']]);
  });

  it('is exactly halfway between its parents', () => {
    expect(atOf(defined('midpoint', [P(0, 0), P(4, 2)]))).toEqual({ x: 2, y: 1 });
    expect(atOf(defined('midpoint', [P(-3, 7), P(3, -7)]))).toEqual({ x: 0, y: 0 });
  });

  it('is equidistant from both parents, over a seeded sweep', () => {
    const values = seededValues(20260917, 600);
    for (let i = 0; i + 3 < values.length; i += 4) {
      const a = V(values[i], values[i + 1]);
      const b = V(values[i + 2], values[i + 3]);
      const m = atOf(defined('midpoint', [P(a.x, a.y), P(b.x, b.y)]));
      expect(Math.abs(dist(m, a) - dist(m, b))).toBeLessThan(1e-12);
      expect(dist(m, a)).toBeCloseTo(dist(a, b) / 2, 9);
      expect(m).toEqual({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }
  });

  it('keeps a coincident pair defined, at that same point', () => {
    expect(atOf(defined('midpoint', [P(2, -5), P(2, -5)]))).toEqual({ x: 2, y: -5 });
  });

  it('is deterministic for identical inputs', () => {
    expectDeterministic('midpoint', [P(1.5, -2.25), P(7, 3)]);
  });

  it('refuses anything that is not two points', () => {
    expect(reasonOf('midpoint', [P(0, 0), segment(0, 0, 1, 1)])).toMatch(/bad parents/);
    // Arity is strict, never a subsequence: a segment among two parents is not
    // the one-segment signature, and an empty selection is nothing at all.
    expect(reasonOf('midpoint', [segment(0, 0, 1, 1), P(2, 2)])).toBe('bad parents: expected two points');
    expect(reasonOf('midpoint', [segment(0, 0, 1, 1), segment(2, 2, 3, 3)])).toBe(
      'bad parents: expected two points',
    );
    expect(reasonOf('midpoint', [])).toBe('bad parents: expected two points');
  });

  it('takes a single segment and returns the midpoint of its endpoints', () => {
    expect(atOf(defined('midpoint', [segment(0, 0, 4, 2)]))).toEqual({ x: 2, y: 1 });
    expect(atOf(defined('midpoint', [segment(-3, 7, 3, -7)]))).toEqual({ x: 0, y: 0 });
    // Either endpoint order gives the same point.
    expect(atOf(defined('midpoint', [segment(6, -1, -2, 5)]))).toEqual(
      atOf(defined('midpoint', [segment(-2, 5, 6, -1)])),
    );
  });

  it('agrees with the two-point form over a seeded sweep of segments', () => {
    const values = seededValues(20260918, 800);
    for (let i = 0; i + 3 < values.length; i += 4) {
      const a = V(values[i], values[i + 1]);
      const b = V(values[i + 2], values[i + 3]);
      const bySegment = atOf(defined('midpoint', [segment(a.x, a.y, b.x, b.y)]));
      expect(bySegment).toEqual(atOf(defined('midpoint', [P(a.x, a.y), P(b.x, b.y)])));
      expect(Math.abs(dist(bySegment, a) - dist(bySegment, b))).toBeLessThan(1e-12);
      expect(dist(a, bySegment)).toBeCloseTo(dist(a, b) / 2, 9);
    }
  });

  it('keeps a zero-length segment defined, at that same point', () => {
    expect(atOf(defined('midpoint', [segment(2, -5, 2, -5)]))).toEqual({ x: 2, y: -5 });
  });

  it('is deterministic for a segment parent', () => {
    expectDeterministic('midpoint', [segment(-1, 4, 7, -2)]);
  });

  it('refuses a lone parent that is not a segment', () => {
    // The one-parent signature is segments only: there is no centre-of-a-circle
    // tool, so a circle is refused rather than reinterpreted as its centre.
    const refused: Geometry[] = [
      P(0, 0),
      line(0, 0, 1, 1),
      ray(0, 0, 1, 1),
      circle(0, 0, 2),
      { kind: 'polygon', points: [V(0, 0), V(1, 0), V(0, 1)] },
    ];
    for (const parent of refused) {
      expect(reasonOf('midpoint', [parent])).toBe('bad parents: expected two points or a segment');
    }
  });

  it('reports non-finite coordinates for both signatures', () => {
    expect(reasonOf('midpoint', [P(Number.NaN, 0), P(1, 1)])).toBe('非有限坐标');
    expect(reasonOf('midpoint', [segment(Number.NaN, 0, 1, 1)])).toBe('非有限坐标');
    expect(reasonOf('midpoint', [segment(0, 0, Number.POSITIVE_INFINITY, 1)])).toBe('非有限坐标');
  });
});

describe('perpendicular', () => {
  it('is registered with the title and parent kinds the action bar reads', () => {
    expect(registry.get('perpendicular')?.title).toBe('垂线');
    expect(registry.get('perpendicular')?.parentKinds).toEqual([['point', 'path']]);
  });

  it('passes through the point and is perpendicular to a segment', () => {
    const result = defined('perpendicular', [P(1, 3), segment(0, 0, 4, 0)]);
    expect(result.kind).toBe('line');
    expect(anchorOf(result)).toEqual({ x: 1, y: 3 });
    expect(len(dirOf(result))).toBeCloseTo(1, 12);
    expect(Math.abs(dot(dirOf(result), V(1, 0)))).toBeLessThan(1e-9);
  });

  it('is perpendicular to a line and to a ray', () => {
    const parentDir = unit(3, -4);
    for (const parent of [line(1, 1, 3, -4), ray(1, 1, 3, -4)]) {
      const dir = dirOf(defined('perpendicular', [P(-2, 6), parent]));
      expect(Math.abs(dot(dir, parentDir))).toBeLessThan(1e-9);
    }
  });

  it('is perpendicular to its parent over a seeded sweep of segments', () => {
    const values = seededValues(4242, 1200);
    for (let i = 0; i + 5 < values.length; i += 6) {
      const a = V(values[i], values[i + 1]);
      const b = V(values[i + 2], values[i + 3]);
      if (len(sub(b, a)) < 0.5) continue;
      const parentDir = unit(b.x - a.x, b.y - a.y);
      const result = compute('perpendicular', [P(values[i + 4], values[i + 5]), segment(a.x, a.y, b.x, b.y)]);
      if (isUndefined(result)) throw new Error(`unexpectedly undefined: ${result.reason}`);
      expect(Math.abs(dot(dirOf(result), parentDir))).toBeLessThan(1e-9);
    }
  });

  it('uses the radius at the nearest point on a circle', () => {
    // Nearest point to (4, 0) on the circle of radius 2 about the origin is
    // (2, 0): the perpendicular is therefore the vertical through (4, 0).
    const outside = defined('perpendicular', [P(4, 0), circle(0, 0, 2)]);
    expect(Math.abs(dot(dirOf(outside), V(1, 0)))).toBeLessThan(1e-9);
    expect(dirOf(outside).y).toBeCloseTo(1, 12);

    // On the circle the same rule gives the tangent at the point itself.
    const onCircle = defined('perpendicular', [P(0, 2), circle(0, 0, 2)]);
    expect(Math.abs(dot(dirOf(onCircle), V(0, 1)))).toBeLessThan(1e-9);

    // Any nearest point: perpendicular to the radius direction P − centre.
    const radial = unit(3, 4);
    const skewed = defined('perpendicular', [P(3, 4), circle(0, 0, 1)]);
    expect(Math.abs(dot(dirOf(skewed), radial))).toBeLessThan(1e-9);
  });

  it('reports why it cannot be built', () => {
    expect(reasonOf('perpendicular', [P(1, 1), circle(0, 0, 0)])).toBe('半径为零');
    expect(reasonOf('perpendicular', [P(0, 0), circle(0, 0, 2)])).toBe('点在圆心上');
    expect(reasonOf('perpendicular', [P(1, 1), segment(1, 1, 1, 1)])).toBe('退化');
    expect(reasonOf('perpendicular', [P(1, 1), line(0, 0, 0, 0)])).toBe('退化');
    expect(reasonOf('perpendicular', [P(1, 1), { kind: 'polygon', points: [V(0, 0), V(1, 0), V(0, 1)] }])).toMatch(
      /bad parents/,
    );
  });

  it('is deterministic for identical inputs', () => {
    expectDeterministic('perpendicular', [P(2, 5), segment(-1, -1, 3, 2)]);
    expectDeterministic('perpendicular', [P(2, 5), circle(1, 1, 3)]);
  });
});

describe('parallel', () => {
  it('is registered with the title and parent kinds the action bar reads', () => {
    expect(registry.get('parallel')?.title).toBe('平行线');
    expect(registry.get('parallel')?.parentKinds).toEqual([['point', 'path']]);
  });

  it('passes through the point and keeps the parent direction', () => {
    const parentDir = unit(2, -1);
    for (const parent of [segment(0, 0, 2, -1), line(5, 5, 2, -1), ray(5, 5, 2, -1)]) {
      const result = defined('parallel', [P(-4, 3), parent]);
      expect(result.kind).toBe('line');
      expect(anchorOf(result)).toEqual({ x: -4, y: 3 });
      expect(Math.abs(cross(dirOf(result), parentDir))).toBeLessThan(1e-9);
      // Same orientation, not the antiparallel one: downstream parameters
      // (point-on-object t, intersections) rely on the direction being kept.
      expect(dot(dirOf(result), parentDir)).toBeCloseTo(1, 9);
    }
  });

  it('stays parallel over a seeded sweep of segments', () => {
    const values = seededValues(99, 900);
    for (let i = 0; i + 5 < values.length; i += 6) {
      const a = V(values[i], values[i + 1]);
      const b = V(values[i + 2], values[i + 3]);
      if (len(sub(b, a)) < 0.5) continue;
      const parentDir = unit(b.x - a.x, b.y - a.y);
      const dir = dirOf(defined('parallel', [P(values[i + 4], values[i + 5]), segment(a.x, a.y, b.x, b.y)]));
      expect(Math.abs(cross(dir, parentDir))).toBeLessThan(1e-9);
      expect(Math.abs(len(dir) - 1)).toBeLessThan(1e-12);
    }
  });

  it('reports why it cannot be built', () => {
    expect(reasonOf('parallel', [P(1, 1), circle(0, 0, 2)])).toBe('圆没有平行线');
    expect(reasonOf('parallel', [P(1, 1), segment(1, 1, 1, 1)])).toBe('退化');
    expect(reasonOf('parallel', [P(1, 1), { kind: 'number', value: 3 }])).toMatch(/bad parents/);
  });

  it('is deterministic for identical inputs', () => {
    expectDeterministic('parallel', [P(-3, 8), ray(0, 0, 1, 4)]);
  });
});

describe('angleBisector', () => {
  it('is registered with the title and parent kinds the action bar reads', () => {
    expect(registry.get('angleBisector')?.title).toBe('角平分线');
    expect(registry.get('angleBisector')?.parentKinds).toEqual([['point', 'point', 'point']]);
  });

  it('bisects a right angle and starts at the middle parent', () => {
    const result = defined('angleBisector', [P(1, 0), P(0, 0), P(0, 1)]);
    expect(result.kind).toBe('ray');
    expect(anchorOf(result)).toEqual({ x: 0, y: 0 });
    expect(dirOf(result).x).toBeCloseTo(Math.SQRT1_2, 12);
    expect(dirOf(result).y).toBeCloseTo(Math.SQRT1_2, 12);
  });

  it('makes equal angles with both arms over a seeded sweep of apertures', () => {
    for (let degrees = 5; degrees < 360; degrees += 5) {
      if (degrees === 180) continue;
      const half = (degrees / 2) * (Math.PI / 180);
      const vertex = V(1.5, -2.5);
      const armA = V(vertex.x + Math.cos(half), vertex.y + Math.sin(half));
      const armB = V(vertex.x + Math.cos(-half), vertex.y + Math.sin(-half));
      const dir = dirOf(defined('angleBisector', [P(armA.x, armA.y), P(vertex.x, vertex.y), P(armB.x, armB.y)]));
      const angleToA = Math.acos(Math.min(1, Math.max(-1, dot(dir, unit(armA.x - vertex.x, armA.y - vertex.y)))));
      const angleToB = Math.acos(Math.min(1, Math.max(-1, dot(dir, unit(armB.x - vertex.x, armB.y - vertex.y)))));
      expect(Math.abs(angleToA - angleToB)).toBeLessThan(1e-9);
      // The *internal* bisector: the split halves never exceed a right angle.
      expect(angleToA).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
    }
  });

  it('keeps coincident arms defined, along the shared arm', () => {
    const dir = dirOf(defined('angleBisector', [P(2, 0), P(0, 0), P(5, 0)]));
    expect(dir.x).toBeCloseTo(1, 12);
    expect(dir.y).toBeCloseTo(0, 12);
  });

  it('reports why it cannot be built', () => {
    expect(reasonOf('angleBisector', [P(0, 0), P(0, 0), P(1, 1)])).toBe('角的边退化');
    expect(reasonOf('angleBisector', [P(1, 1), P(0, 0), P(0, 0)])).toBe('角的边退化');
    expect(reasonOf('angleBisector', [P(-1, 0), P(0, 0), P(1, 0)])).toBe('角的边共线');
    expect(reasonOf('angleBisector', [P(1, 0), P(0, 0)])).toMatch(/bad parents/);
  });

  it('is deterministic for identical inputs', () => {
    expectDeterministic('angleBisector', [P(4, 1), P(0, 0), P(1, 4)]);
  });
});

describe('perpendicularBisector', () => {
  it('is registered with the title and parent kinds the action bar reads', () => {
    expect(registry.get('perpendicularBisector')?.title).toBe('垂直平分线');
    expect(registry.get('perpendicularBisector')?.parentKinds).toEqual([['point', 'point']]);
  });

  it('passes through the midpoint and is perpendicular to the parents', () => {
    const a = V(-2, 1);
    const b = V(4, 5);
    const result = defined('perpendicularBisector', [P(a.x, a.y), P(b.x, b.y)]);

    expect(result.kind).toBe('line');
    expect(anchorOf(result)).toEqual(atOf(defined('midpoint', [P(a.x, a.y), P(b.x, b.y)])));
    expect(len(dirOf(result))).toBeCloseTo(1, 12);
    expect(Math.abs(dot(dirOf(result), unit(b.x - a.x, b.y - a.y)))).toBeLessThan(1e-9);
  });

  it('is the locus of the points equidistant from both parents', () => {
    const values = seededValues(31337, 1200);
    for (let i = 0; i + 3 < values.length; i += 4) {
      const a = V(values[i], values[i + 1]);
      const b = V(values[i + 2], values[i + 3]);
      if (len(sub(b, a)) < 0.5) continue;
      const result = defined('perpendicularBisector', [P(a.x, a.y), P(b.x, b.y)]);
      const at = anchorOf(result);
      const dir = dirOf(result);

      // The midpoint is on the line…
      expect(dist(at, a)).toBeCloseTo(dist(at, b), 9);
      expect(Math.abs(dot(dir, sub(at, a)))).toBeLessThan(1e-9);
      // …and every other point along it is equidistant too.
      for (const t of [-7, -1.25, 0, 0.75, 3]) {
        const point = V(at.x + dir.x * t, at.y + dir.y * t);
        expect(Math.abs(dist(point, a) - dist(point, b))).toBeLessThan(1e-9 * (1 + dist(a, b)));
      }
    }
  });

  it('reports why it cannot be built', () => {
    expect(reasonOf('perpendicularBisector', [P(2, -1), P(2, -1)])).toBe('两点重合');
    expect(reasonOf('perpendicularBisector', [P(Number.NaN, 0), P(1, 1)])).toBe('非有限坐标');
    expect(reasonOf('perpendicularBisector', [P(0, 0)])).toMatch(/bad parents/);
    expect(reasonOf('perpendicularBisector', [P(0, 0), segment(0, 0, 1, 1)])).toMatch(/bad parents/);
  });

  it('is deterministic for identical inputs', () => {
    expectDeterministic('perpendicularBisector', [P(-1, 3), P(5, -2)]);
  });
});
