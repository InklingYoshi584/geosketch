/**
 * Tests for measurements (objects/measures.ts).
 *
 * A measurement is only useful if it is *true* for every configuration, so the
 * assertions are geometric laws — |AB| equals the distance, an angle obeys the
 * law of cosines and lands in [0, 180]°, an area matches shoelace/πr² — checked
 * over hand-written cases and a seeded sweep. Determinism matters as much as
 * correctness: recompute must never wobble (DESIGN.md §5 "recompute is
 * topological", D8), and no value may ever be NaN, or the readout and every
 * consumer of the number would break.
 */
import { describe, expect, it } from 'vitest';

import { isUndefined, registry } from './registry';
import type { Env, Undefined } from './registry';
import { anchorsOf, computeScene, DEFAULT_VIEWPORT, hitTest } from './scene';
import type { Geometry } from './scene';
import type { Doc, Json, ObjRecord, Vec2 } from './types';
import { dist } from './kernel/vec2';
import './objects/point-free';
import './objects/paths';
import './objects/measures';

const ENV: Env = { scale: 64 };

const V = (x: number, y: number): Vec2 => ({ x, y });
const P = (x: number, y: number): Geometry => ({ kind: 'point', at: V(x, y) });
const segment = (ax: number, ay: number, bx: number, by: number): Geometry => ({
  kind: 'segment',
  a: V(ax, ay),
  b: V(bx, by),
});
const polygon = (points: Vec2[]): Geometry => ({ kind: 'polygon', points });
const circle = (cx: number, cy: number, radius: number): Geometry => ({
  kind: 'circle',
  center: V(cx, cy),
  radius,
});
const line = (x: number, y: number, dx: number, dy: number): Geometry => ({
  kind: 'line',
  at: V(x, y),
  dir: V(dx, dy),
});
const ray = (x: number, y: number, dx: number, dy: number): Geometry => ({
  kind: 'ray',
  at: V(x, y),
  dir: V(dx, dy),
});

/**
 * An `arc` parent in the frozen shape: centre, radius, and a CCW sweep from
 * `from` to `to` in radians. The sweep is not normalised here — a measurement
 * must normalise whatever a document holds, exactly like the engine's own arc
 * machinery does (`positiveSweep`).
 */
const arc = (cx: number, cy: number, radius: number, from: number, to: number): Geometry => ({
  kind: 'arc',
  center: V(cx, cy),
  radius,
  from,
  to,
});
/** A `text` parent, used only to be refused by tests. */
const textGeom = (x: number, y: number, text: string): Geometry => ({
  kind: 'text',
  at: V(x, y),
  text,
});

const TWO_PI = Math.PI * 2;
const DEG_PER_RAD = 180 / Math.PI;

/** A `text` readout's two fields, for the measurements that are not numbers. */
interface TextReadout {
  kind: 'text';
  at: Vec2;
  text: string;
}

/** Deterministic uniform values in [-5, 5] (a 32-bit LCG). */
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

function defined(name: string, parents: Geometry[]): Geometry {
  const result = compute(name, parents);
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

function numberOf(geometry: Geometry): number {
  if (geometry.kind !== 'number') throw new Error(`not a number: ${geometry.kind}`);
  return geometry.value;
}

function unitOf(geometry: Geometry): 'deg' | undefined {
  if (geometry.kind !== 'number') throw new Error(`not a number: ${geometry.kind}`);
  return geometry.unit;
}

/** Narrow a compute result to the `text` readout. */
function textOf(geometry: Geometry): TextReadout {
  if (geometry.kind !== 'text') throw new Error(`not a text readout: ${geometry.kind}`);
  return geometry;
}

function expectDeterministic(name: string, parents: Geometry[]): void {
  const clone = JSON.parse(JSON.stringify(parents)) as Geometry[];
  expect(compute(name, parents)).toEqual(compute(name, clone));
}

describe('measure.distance', () => {
  it('is registered with the title and parent kinds the action bar reads', () => {
    expect(registry.get('measure.distance')?.title).toBe('距离');
    // One entry per legal signature, the two-point form first: the palette and
    // the tool reducer both address `measure.distance:0` as the two-point
    // readout, and the one-segment form is the additional signature
    // `measure.distance:1`.
    expect(registry.get('measure.distance')?.parentKinds).toEqual([['point', 'point'], ['segment']]);
  });

  it('measures |AB| in world units', () => {
    expect(numberOf(defined('measure.distance', [P(0, 0), P(3, 4)]))).toBe(5);
    expect(numberOf(defined('measure.distance', [P(2, -1), P(2, -1)]))).toBe(0);
    expect(unitOf(defined('measure.distance', [P(0, 0), P(1, 0)]))).toBeUndefined();
  });

  it('stays finite and symmetric over a seeded sweep', () => {
    const values = seededValues(777, 800);
    for (let i = 0; i + 3 < values.length; i += 4) {
      const a = V(values[i], values[i + 1]);
      const b = V(values[i + 2], values[i + 3]);
      const ab = numberOf(defined('measure.distance', [P(a.x, a.y), P(b.x, b.y)]));
      const ba = numberOf(defined('measure.distance', [P(b.x, b.y), P(a.x, a.y)]));
      expect(Number.isFinite(ab)).toBe(true);
      expect(ab).toBeCloseTo(dist(a, b), 9);
      expect(ba).toBe(ab);
    }
  });

  it('refuses anything that is not two points', () => {
    expect(reasonOf('measure.distance', [P(0, 0)])).toMatch(/bad parents/);
    expect(
      reasonOf('measure.distance', [P(0, 0), polygon([V(0, 0), V(1, 0), V(0, 1)])]),
    ).toMatch(/bad parents/);
  });

  it('measures a single segment as the distance between its endpoints', () => {
    expect(numberOf(defined('measure.distance', [segment(0, 0, 3, 4)]))).toBe(5);
    expect(numberOf(defined('measure.distance', [segment(2, -1, 2, -1)]))).toBe(0);
    expect(unitOf(defined('measure.distance', [segment(0, 0, 1, 0)]))).toBeUndefined();
    // Either endpoint order measures the same length.
    expect(numberOf(defined('measure.distance', [segment(6, -1, -2, 5)]))).toBe(
      numberOf(defined('measure.distance', [segment(-2, 5, 6, -1)])),
    );
  });

  it('agrees with the two-point form over a seeded sweep of segments', () => {
    const values = seededValues(20260918, 800);
    for (let i = 0; i + 3 < values.length; i += 4) {
      const a = V(values[i], values[i + 1]);
      const b = V(values[i + 2], values[i + 3]);
      const bySegment = numberOf(defined('measure.distance', [segment(a.x, a.y, b.x, b.y)]));
      expect(bySegment).toBeCloseTo(numberOf(defined('measure.distance', [P(a.x, a.y), P(b.x, b.y)])), 12);
      expect(bySegment).toBeCloseTo(dist(a, b), 9);
    }
  });

  it('refuses a lone parent that is not a segment, and any other arity', () => {
    const refused: Geometry[] = [
      P(0, 0),
      { kind: 'line', at: V(0, 0), dir: V(1, 0) },
      { kind: 'ray', at: V(0, 0), dir: V(1, 0) },
      { kind: 'circle', center: V(0, 0), radius: 2 },
      polygon([V(0, 0), V(1, 0), V(0, 1)]),
    ];
    for (const parent of refused) {
      expect(reasonOf('measure.distance', [parent])).toBe('bad parents: expected two points or a segment');
    }
    // Strict arity, never a subsequence: segment-plus-point is not a signature.
    expect(reasonOf('measure.distance', [segment(0, 0, 1, 1), P(2, 2)])).toBe(
      'bad parents: expected two points',
    );
    expect(reasonOf('measure.distance', [])).toBe('bad parents: expected two points');
  });

  it('reports non-finite coordinates for both signatures', () => {
    expect(reasonOf('measure.distance', [P(Number.NaN, 0), P(1, 1)])).toBe('非有限坐标');
    expect(reasonOf('measure.distance', [segment(0, 0, Number.POSITIVE_INFINITY, 1)])).toBe('非有限坐标');
  });

  it('is deterministic for identical inputs', () => {
    expectDeterministic('measure.distance', [P(-2.5, 3.75), P(9, -1)]);
    expectDeterministic('measure.distance', [segment(-2.5, 3.75, 9, -1)]);
  });
});

describe('measure.angle', () => {
  it('is registered with the title and parent kinds the action bar reads', () => {
    expect(registry.get('measure.angle')?.title).toBe('角度');
    expect(registry.get('measure.angle')?.parentKinds).toEqual([['point', 'point', 'point']]);
  });

  it('reads a right angle as 90°', () => {
    const angle = defined('measure.angle', [P(1, 0), P(0, 0), P(0, 1)]);
    expect(numberOf(angle)).toBeCloseTo(90, 9);
    expect(unitOf(angle)).toBe('deg');
  });

  it('reads the straight, zero and 60° cases', () => {
    expect(numberOf(defined('measure.angle', [P(-1, 0), P(0, 0), P(1, 0)]))).toBeCloseTo(180, 6);
    expect(numberOf(defined('measure.angle', [P(1, 0), P(0, 0), P(3, 0)]))).toBeCloseTo(0, 6);
    const cos60 = Math.cos(Math.PI / 3);
    const sin60 = Math.sin(Math.PI / 3);
    expect(numberOf(defined('measure.angle', [P(1, 0), P(0, 0), P(cos60, sin60)]))).toBeCloseTo(60, 6);
  });

  it('always lands in [0, 180]° and obeys the law of cosines, over a seeded sweep', () => {
    for (let degrees = 5; degrees <= 355; degrees += 5) {
      const half = (degrees / 2) * (Math.PI / 180);
      const vertex = V(-1.25, 4.5);
      const armA = V(vertex.x + Math.cos(half) * 2, vertex.y + Math.sin(half) * 2);
      const armB = V(vertex.x + Math.cos(-half) * 3, vertex.y + Math.sin(-half) * 3);
      const measured = numberOf(
        defined('measure.angle', [P(armA.x, armA.y), P(vertex.x, vertex.y), P(armB.x, armB.y)]),
      );
      const expected = degrees <= 180 ? degrees : 360 - degrees;
      expect(Number.isFinite(measured)).toBe(true);
      expect(measured).toBeGreaterThanOrEqual(0);
      expect(measured).toBeLessThanOrEqual(180);
      expect(measured).toBeCloseTo(expected, 4);
    }
  });

  it('is invariant under rescaling the arms (law of cosines)', () => {
    const values = seededValues(31337, 600);
    for (let i = 0; i + 5 < values.length; i += 6) {
      const v = V(values[i], values[i + 1]);
      const a = V(values[i + 2], values[i + 3]);
      const c = V(values[i + 4], values[i + 5]);
      if (dist(v, a) < 0.5 || dist(v, c) < 0.5) continue;
      const direct = numberOf(defined('measure.angle', [P(a.x, a.y), P(v.x, v.y), P(c.x, c.y)]));
      const stretched = numberOf(
        defined('measure.angle', [
          P(v.x + (a.x - v.x) * 7, v.y + (a.y - v.y) * 7),
          P(v.x, v.y),
          P(v.x + (c.x - v.x) * 0.2, v.y + (c.y - v.y) * 0.2),
        ]),
      );
      expect(direct).toBeCloseTo(stretched, 6);
    }
  });

  it('reports why it cannot be measured', () => {
    expect(reasonOf('measure.angle', [P(0, 0), P(0, 0), P(1, 1)])).toBe('角的边退化');
    expect(reasonOf('measure.angle', [P(1, 1), P(0, 0), P(0, 0)])).toBe('角的边退化');
    expect(reasonOf('measure.angle', [P(1, 0), P(0, 0)])).toMatch(/bad parents/);
  });

  it('is deterministic for identical inputs', () => {
    expectDeterministic('measure.angle', [P(4, 1), P(0, 0), P(-1, 3)]);
  });
});

describe('measure.area', () => {
  it('is registered with the title and parent kinds the action bar reads', () => {
    expect(registry.get('measure.area')?.title).toBe('面积');
    // One entry per legal signature: registry `parentKinds` allows one kind per
    // parent slot, so "polygon or circle" is two signatures of the same arity.
    expect(registry.get('measure.area')?.parentKinds).toEqual([['polygon'], ['circle']]);
  });

  it('measures a 3-4-5 triangle as 6', () => {
    expect(numberOf(defined('measure.area', [polygon([V(0, 0), V(4, 0), V(0, 3)])]))).toBe(6);
  });

  it('ignores the winding of the polygon', () => {
    const clockwise = numberOf(defined('measure.area', [polygon([V(0, 0), V(4, 0), V(0, 3)])]));
    const counterClockwise = numberOf(defined('measure.area', [polygon([V(0, 3), V(4, 0), V(0, 0)])]));
    expect(counterClockwise).toBe(clockwise);
    expect(numberOf(defined('measure.area', [polygon([V(0, 0), V(2, 0), V(2, 2), V(0, 2)])]))).toBe(4);
  });

  it('measures a circle as πr²', () => {
    const result = defined('measure.area', [{ kind: 'circle', center: V(1, -1), radius: 2 }]);
    expect(numberOf(result)).toBeCloseTo(4 * Math.PI, 12);
    expect(unitOf(result)).toBeUndefined();
  });

  it('stays finite and translation-invariant over a seeded sweep of triangles', () => {
    const values = seededValues(5150, 900);
    for (let i = 0; i + 5 < values.length; i += 6) {
      const a = V(values[i], values[i + 1]);
      const b = V(values[i + 2], values[i + 3]);
      const c = V(values[i + 4], values[i + 5]);
      const area = numberOf(defined('measure.area', [polygon([a, b, c])]));
      expect(Number.isFinite(area)).toBe(true);
      const shifted = numberOf(
        defined('measure.area', [
          polygon([V(a.x + 12, a.y - 7), V(b.x + 12, b.y - 7), V(c.x + 12, c.y - 7)]),
        ]),
      );
      expect(shifted).toBeCloseTo(area, 6);
    }
  });

  it('reports why it cannot be measured', () => {
    expect(reasonOf('measure.area', [polygon([V(0, 0), V(1, 1)])])).toBe('退化');
    expect(reasonOf('measure.area', [{ kind: 'circle', center: V(0, 0), radius: -1 }])).toBe('半径为零');
    expect(reasonOf('measure.area', [P(0, 0)])).toMatch(/bad parents/);
    expect(reasonOf('measure.area', [polygon([V(0, 0), V(1, 0), V(0, 1)]), polygon([V(0, 0), V(1, 0), V(0, 1)])])).toMatch(
      /bad parents/,
    );
  });

  it('is deterministic for identical inputs', () => {
    expectDeterministic('measure.area', [polygon([V(0, 0), V(5, 1), V(3, 6), V(-2, 4)])]);
    expectDeterministic('measure.area', [{ kind: 'circle', center: V(2, 2), radius: 3 }]);
  });
});

describe('measure.perimeter', () => {
  it('is registered with the title and parent kinds the action bar reads', () => {
    expect(registry.get('measure.perimeter')?.title).toBe('周长');
    // Two signatures of the same arity: a polygon or a circle.
    expect(registry.get('measure.perimeter')?.parentKinds).toEqual([['polygon'], ['circle']]);
  });

  it('adds the three sides of the 3-4-5 triangle to 12', () => {
    expect(numberOf(defined('measure.perimeter', [polygon([V(0, 0), V(4, 0), V(0, 3)])]))).toBe(12);
    expect(numberOf(defined('measure.perimeter', [polygon([V(0, 0), V(2, 0), V(2, 2), V(0, 2)])]))).toBe(8);
  });

  it('counts the closing edge, not just the drawn ones', () => {
    // A 3-4-5 triangle: 3 + 4 + 5. A perimeter that forgot to close would be 7.
    expect(numberOf(defined('measure.perimeter', [polygon([V(0, 0), V(3, 0), V(0, 4)])]))).toBe(12);
    // Repeated consecutive vertices contribute zero-length edges: the picture is
    // degenerate but the number is still the boundary length.
    expect(numberOf(defined('measure.perimeter', [polygon([V(0, 0), V(0, 0), V(4, 0), V(0, 3)])]))).toBe(12);
  });

  it('measures a circle as 2πr', () => {
    const result = defined('measure.perimeter', [circle(1, -1, 2)]);
    expect(numberOf(result)).toBeCloseTo(4 * Math.PI, 12);
    expect(numberOf(defined('measure.perimeter', [circle(0, 0, 0)]))).toBe(0);
    expect(unitOf(result)).toBeUndefined();
  });

  it('stays finite and translation-invariant over a seeded sweep of triangles', () => {
    const values = seededValues(31415, 900);
    for (let i = 0; i + 5 < values.length; i += 6) {
      const a = V(values[i], values[i + 1]);
      const b = V(values[i + 2], values[i + 3]);
      const c = V(values[i + 4], values[i + 5]);
      const perimeter = numberOf(defined('measure.perimeter', [polygon([a, b, c])]));
      expect(Number.isFinite(perimeter)).toBe(true);
      expect(perimeter).toBeCloseTo(dist(a, b) + dist(b, c) + dist(c, a), 9);
      const shifted = numberOf(
        defined('measure.perimeter', [
          polygon([V(a.x + 9, a.y - 4), V(b.x + 9, b.y - 4), V(c.x + 9, c.y - 4)]),
        ]),
      );
      expect(shifted).toBeCloseTo(perimeter, 6);
    }
  });

  it('reports why it cannot be measured', () => {
    expect(reasonOf('measure.perimeter', [polygon([V(0, 0), V(1, 1)])])).toBe('退化');
    expect(reasonOf('measure.perimeter', [polygon([V(0, 0), V(Number.NaN, 1), V(1, 1)])])).toBe('非有限坐标');
    expect(reasonOf('measure.perimeter', [circle(0, 0, -1)])).toBe('半径为零');
    expect(reasonOf('measure.perimeter', [circle(0, 0, Number.NaN)])).toBe('非有限坐标');
    expect(reasonOf('measure.perimeter', [P(0, 0)])).toMatch(/bad parents/);
    expect(reasonOf('measure.perimeter', [])).toMatch(/bad parents/);
  });

  it('is deterministic for identical inputs', () => {
    expectDeterministic('measure.perimeter', [polygon([V(0, 0), V(5, 1), V(3, 6), V(-2, 4)])]);
    expectDeterministic('measure.perimeter', [circle(2, 2, 3)]);
  });
});

describe('measure.slope', () => {
  it('is registered with the title and parent kinds the action bar reads', () => {
    expect(registry.get('measure.slope')?.title).toBe('斜率');
    // One signature per straight kind: segment, line, ray.
    expect(registry.get('measure.slope')?.parentKinds).toEqual([['segment'], ['line'], ['ray']]);
  });

  it('measures the 3-4-5 direction as 3/4', () => {
    const result = defined('measure.slope', [segment(0, 0, 4, 3)]);
    expect(numberOf(result)).toBeCloseTo(0.75, 9);
    expect(unitOf(result)).toBeUndefined();
    // The slope belongs to the line through the segment, not to the direction of
    // travel, so the reversed segment measures the same number.
    expect(numberOf(defined('measure.slope', [segment(4, 3, 0, 0)]))).toBeCloseTo(0.75, 9);
    expect(numberOf(defined('measure.slope', [segment(0, 0, 4, -3)]))).toBeCloseTo(-0.75, 9);
    // A horizontal segment measures 0 whichever way it was drawn: a right-to-left
    // one divides 0 by a negative and would otherwise read `−0.00`.
    expect(numberOf(defined('measure.slope', [segment(-1, 5, 3, 5)]))).toBe(0);
    expect(numberOf(defined('measure.slope', [segment(4, 3, 0, 3)]))).toBe(0);
  });

  it('reads a line and a ray through the same direction', () => {
    expect(numberOf(defined('measure.slope', [line(2, -3, 4, 3)]))).toBeCloseTo(0.75, 9);
    expect(numberOf(defined('measure.slope', [ray(2, -3, 4, 3)]))).toBeCloseTo(0.75, 9);
    // The stored direction is normalised, so its length never reaches the slope.
    expect(numberOf(defined('measure.slope', [line(0, 0, 400, 300)]))).toBeCloseTo(0.75, 9);
    expect(numberOf(defined('measure.slope', [ray(0, 0, -400, -300)]))).toBeCloseTo(0.75, 9);
  });

  it('refuses vertical paths: a vertical line has no slope', () => {
    expect(reasonOf('measure.slope', [segment(2, -1, 2, 3)])).toBe('斜率不存在');
    expect(reasonOf('measure.slope', [line(5, 0, 0, 1)])).toBe('斜率不存在');
    expect(reasonOf('measure.slope', [ray(-3, 1, 0, -2)])).toBe('斜率不存在');
    // Relative, like every other predicate in the engine: a segment leaning by
    // less than the relative epsilon is vertical for the readout's purposes.
    expect(reasonOf('measure.slope', [segment(0, 0, 1e-12, 5)])).toBe('斜率不存在');
  });

  it('reports a path with no direction as degenerate', () => {
    expect(reasonOf('measure.slope', [segment(1, 1, 1, 1)])).toBe('退化');
    expect(reasonOf('measure.slope', [line(1, 1, 0, 0)])).toBe('退化');
    expect(reasonOf('measure.slope', [ray(1, 1, 0, 0)])).toBe('退化');
  });

  it('agrees with dy/dx over a seeded sweep of segments', () => {
    const values = seededValues(20260919, 800);
    for (let i = 0; i + 3 < values.length; i += 4) {
      const a = V(values[i], values[i + 1]);
      const b = V(values[i + 2], values[i + 3]);
      const result = compute('measure.slope', [segment(a.x, a.y, b.x, b.y)]);
      const along = V(b.x - a.x, b.y - a.y);
      if (isUndefined(result)) {
        // The only refusal a pair of distinct random points can earn is the
        // vertical one, and it must be the relative test that decides it.
        expect(Math.abs(along.x) / Math.hypot(along.x, along.y)).toBeLessThanOrEqual(1e-9);
        continue;
      }
      expect(Number.isFinite(numberOf(result))).toBe(true);
      const slope = numberOf(result);
      const analytic = along.y / along.x;
      // Relative, not absolute: a near-vertical segment's slope is a huge number.
      expect(Math.abs(slope - analytic) / Math.max(1, Math.abs(analytic))).toBeLessThan(1e-9);
    }
  });

  it('refuses anything that is not a straight path', () => {
    const refused: Geometry[] = [circle(0, 0, 2), polygon([V(0, 0), V(1, 0), V(0, 1)]), P(0, 0)];
    for (const parent of refused) {
      expect(reasonOf('measure.slope', [parent])).toBe('bad parents: expected a segment, line or ray');
    }
    expect(reasonOf('measure.slope', [segment(0, 0, 1, 1), segment(0, 0, 2, 2)])).toBe(
      'bad parents: expected a segment, line or ray',
    );
    expect(reasonOf('measure.slope', [segment(0, 0, Number.POSITIVE_INFINITY, 1)])).toBe('非有限坐标');
    // A malformed line direction is refused before anything divides by it.
    expect(reasonOf('measure.slope', [line(0, 0, Number.NaN, 1)])).toBe('非有限坐标');
  });

  it('is deterministic for identical inputs', () => {
    expectDeterministic('measure.slope', [segment(-2.5, 3.75, 9, -1)]);
    expectDeterministic('measure.slope', [line(-1, 2, 3, -7)]);
  });
});

describe('measure.ratio', () => {
  it('is registered with the title and parent kinds the action bar reads', () => {
    expect(registry.get('measure.ratio')?.title).toBe('比');
    expect(registry.get('measure.ratio')?.parentKinds).toEqual([['segment', 'segment']]);
  });

  it('measures one segment against another as 2', () => {
    expect(numberOf(defined('measure.ratio', [segment(0, 0, 6, 0), segment(0, 0, 3, 0)]))).toBe(2);
    // Click order is the only visible thing about a ratio: the first selection
    // is the numerator, so the same two segments swapped is 1/2.
    expect(numberOf(defined('measure.ratio', [segment(0, 0, 3, 0), segment(0, 0, 6, 0)]))).toBe(0.5);
    // The lengths, not the coordinates: 5/5 is 1 wherever the segments sit.
    expect(numberOf(defined('measure.ratio', [segment(0, 0, 3, 4), segment(-7, 2, -2, 2)]))).toBe(1);
  });

  it('treats a zero-length numerator as the legitimate 0', () => {
    expect(numberOf(defined('measure.ratio', [segment(1, 1, 1, 1), segment(0, 0, 3, 0)]))).toBe(0);
  });

  it('refuses a zero-length divisor', () => {
    expect(reasonOf('measure.ratio', [segment(0, 0, 3, 0), segment(2, 2, 2, 2)])).toBe('比的分母为零');
    // Relative, not absolute: a divisor collapsed to an artefact of the
    // construction is zero too, and must not emit a meaningless huge number.
    expect(reasonOf('measure.ratio', [segment(0, 0, 3, 0), segment(2, 2, 2 + 1e-12, 2)])).toBe('比的分母为零');
  });

  it('is invariant under scaling both segments, over a seeded sweep', () => {
    const values = seededValues(24680, 800);
    for (let i = 0; i + 7 < values.length; i += 8) {
      const a = V(values[i], values[i + 1]);
      const b = V(values[i + 2], values[i + 3]);
      const c = V(values[i + 4], values[i + 5]);
      const d = V(values[i + 6], values[i + 7]);
      if (dist(c, d) < 0.5) continue; // near-degenerate divisors are refused, not measured
      const ratio = numberOf(
        defined('measure.ratio', [segment(a.x, a.y, b.x, b.y), segment(c.x, c.y, d.x, d.y)]),
      );
      expect(Number.isFinite(ratio)).toBe(true);
      expect(ratio).toBeCloseTo(dist(a, b) / dist(c, d), 6);
      // A ratio is what a similarity preserves: scale both segments by the same
      // factor — and move the whole figure — and the number must not budge.
      const x = (v: number) => v * 7 + 12;
      const y = (v: number) => v * 7 - 5;
      const scaled = numberOf(
        defined('measure.ratio', [
          segment(x(a.x), y(a.y), x(b.x), y(b.y)),
          segment(x(c.x), y(c.y), x(d.x), y(d.y)),
        ]),
      );
      expect(scaled).toBeCloseTo(ratio, 6);
    }
  });

  it('refuses anything that is not two segments', () => {
    expect(reasonOf('measure.ratio', [segment(0, 0, 1, 0)])).toMatch(/bad parents/);
    expect(reasonOf('measure.ratio', [P(0, 0), P(1, 0)])).toMatch(/bad parents/);
    expect(reasonOf('measure.ratio', [segment(0, 0, 1, 0), line(0, 0, 1, 0)])).toMatch(/bad parents/);
    expect(reasonOf('measure.ratio', [segment(0, 0, 1, 0), segment(0, 0, Number.NaN, 1)])).toBe('非有限坐标');
    expect(reasonOf('measure.ratio', [segment(Number.POSITIVE_INFINITY, 0, 1, 0), segment(0, 0, 1, 0)])).toBe(
      '非有限坐标',
    );
  });

  it('is deterministic for identical inputs', () => {
    expectDeterministic('measure.ratio', [segment(0, 0, 3, 4), segment(1, 1, 4, 5)]);
  });
});

describe('measure.arcLength', () => {
  it('is registered with the title and parent kinds the action bar reads', () => {
    expect(registry.get('measure.arcLength')?.title).toBe('弧长');
    expect(registry.get('measure.arcLength')?.parentKinds).toEqual([['arc']]);
  });

  it('measures a quarter circle as πr/2', () => {
    const result = defined('measure.arcLength', [arc(1, -2, 2, 0, Math.PI / 2)]);
    expect(numberOf(result)).toBeCloseTo(Math.PI, 12); // 2 · (π/2)
    expect(unitOf(result)).toBeUndefined();
    expect(numberOf(defined('measure.arcLength', [arc(0, 0, 4, Math.PI / 2, Math.PI)]))).toBeCloseTo(
      2 * Math.PI,
      12,
    );
  });

  it('measures a full turn as the whole circumference', () => {
    // from === to is a full circle, not a zero-length arc: the sweep lives in
    // (0, 2π], which is what drawing an arc all the way round means.
    expect(numberOf(defined('measure.arcLength', [arc(0, 0, 3, 0, 0)]))).toBeCloseTo(6 * Math.PI, 9);
    expect(numberOf(defined('measure.arcLength', [arc(0, 0, 3, 0, TWO_PI)]))).toBeCloseTo(6 * Math.PI, 9);
  });

  it('sweeps counter-clockwise, so a reversed arc is the reflex arc', () => {
    const quarter = numberOf(defined('measure.arcLength', [arc(0, 0, 2, 0, Math.PI / 2)]));
    const reflex = numberOf(defined('measure.arcLength', [arc(0, 0, 2, Math.PI / 2, 0)]));
    expect(reflex).toBeCloseTo(2 * 1.5 * Math.PI, 9);
    expect(quarter + reflex).toBeCloseTo(2 * TWO_PI, 9);
  });

  it('grows with the radius and stays additive across a split sweep', () => {
    for (let k = 1; k <= 12; k++) {
      const sweep = (k * TWO_PI) / 13; // 1/13 … 12/13 of a turn
      const radius = 0.5 + k * 0.25;
      const whole = numberOf(defined('measure.arcLength', [arc(0.5, -1.5, radius, 0.3, 0.3 + sweep)]));
      const half = numberOf(defined('measure.arcLength', [arc(0.5, -1.5, radius, 0.3, 0.3 + sweep / 2)]));
      expect(whole).toBeCloseTo(radius * sweep, 9);
      expect(half * 2).toBeCloseTo(whole, 9);
    }
  });

  it('reports why it cannot be measured', () => {
    expect(reasonOf('measure.arcLength', [arc(0, 0, -1, 0, 1)])).toBe('半径为零');
    expect(reasonOf('measure.arcLength', [arc(0, 0, Number.NaN, 0, 1)])).toBe('非有限坐标');
    expect(reasonOf('measure.arcLength', [arc(Number.NaN, 0, 1, 0, 1)])).toBe('非有限坐标');
    expect(reasonOf('measure.arcLength', [arc(0, 0, 1, Number.NaN, 1)])).toBe('非有限坐标');
    expect(reasonOf('measure.arcLength', [circle(0, 0, 1)])).toBe('bad parents: expected an arc');
    expect(reasonOf('measure.arcLength', [arc(0, 0, 1, 0, 1), arc(0, 0, 1, 0, 1)])).toMatch(/bad parents/);
  });

  it('is deterministic for identical inputs', () => {
    expectDeterministic('measure.arcLength', [arc(2, -1, 3.5, -1.25, 2.75)]);
  });
});

describe('measure.arcAngle', () => {
  it('is registered with the title and parent kinds the action bar reads', () => {
    expect(registry.get('measure.arcAngle')?.title).toBe('弧角');
    expect(registry.get('measure.arcAngle')?.parentKinds).toEqual([['arc']]);
  });

  it('reads a quarter circle as 90°', () => {
    const result = defined('measure.arcAngle', [arc(1, -2, 2, 0, Math.PI / 2)]);
    expect(numberOf(result)).toBeCloseTo(90, 9);
    expect(unitOf(result)).toBe('deg');
  });

  it('normalises the sweep into (0, 360°], so a full turn is 360', () => {
    expect(numberOf(defined('measure.arcAngle', [arc(0, 0, 1, 0, 0)]))).toBeCloseTo(360, 9);
    expect(numberOf(defined('measure.arcAngle', [arc(0, 0, 1, 0, TWO_PI)]))).toBeCloseTo(360, 9);
    expect(numberOf(defined('measure.arcAngle', [arc(0, 0, 1, 0, Math.PI)]))).toBeCloseTo(180, 9);
    expect(numberOf(defined('measure.arcAngle', [arc(0, 0, 1, Math.PI / 2, 0)]))).toBeCloseTo(270, 9);
    expect(numberOf(defined('measure.arcAngle', [arc(0, 0, 1, 0, -Math.PI / 2)]))).toBeCloseTo(270, 9);
  });

  it('ignores the radius it does not need', () => {
    // The angle is a property of the sweep alone — including at radius 0, where
    // the arc has no length but still spans an angle.
    const angles = [0, 0.5, 3, 17].map((radius) =>
      numberOf(defined('measure.arcAngle', [arc(1, 1, radius, 0.4, 0.4 + Math.PI / 3)])),
    );
    for (const angle of angles) expect(angle).toBeCloseTo(60, 9);
  });

  it('agrees with arc length over a sweep of radii and sweeps', () => {
    for (let k = 1; k <= 12; k++) {
      const sweep = (k * TWO_PI) / 13;
      const radius = 0.25 + k;
      const length = numberOf(defined('measure.arcLength', [arc(0, 0, radius, 0.7, 0.7 + sweep)]));
      const angle = numberOf(defined('measure.arcAngle', [arc(0, 0, radius, 0.7, 0.7 + sweep)]));
      expect(angle).toBeCloseTo((length / radius) * DEG_PER_RAD, 6);
    }
  });

  it('reports why it cannot be measured', () => {
    expect(reasonOf('measure.arcAngle', [arc(0, 0, -1, 0, 1)])).toBe('半径为零');
    expect(reasonOf('measure.arcAngle', [arc(0, 0, 1, 0, Number.POSITIVE_INFINITY)])).toBe('非有限坐标');
    expect(reasonOf('measure.arcAngle', [P(0, 0)])).toBe('bad parents: expected an arc');
    expect(reasonOf('measure.arcAngle', [])).toMatch(/bad parents/);
  });

  it('is deterministic for identical inputs', () => {
    expectDeterministic('measure.arcAngle', [arc(-3, 4, 2, 1.1, -2.2)]);
  });
});

describe('measure.coordinates', () => {
  it('is registered with the title and parent kinds the action bar reads', () => {
    expect(registry.get('measure.coordinates')?.title).toBe('坐标');
    expect(registry.get('measure.coordinates')?.parentKinds).toEqual([['point']]);
  });

  it('reads a point as a text readout anchored at the point', () => {
    const result = textOf(defined('measure.coordinates', [P(3, -4)]));
    expect(result.text).toBe('(3.00, −4.00)');
    expect(result.at).toEqual(V(3, -4));
  });

  it('prints two decimals, the precision of every other readout', () => {
    expect(textOf(defined('measure.coordinates', [P(2.567, 1.234)])).text).toBe('(2.57, 1.23)');
    expect(textOf(defined('measure.coordinates', [P(0, 0)])).text).toBe('(0.00, 0.00)');
    // A value that rounds to zero must not print a negative zero.
    expect(textOf(defined('measure.coordinates', [P(-0.004, -0.001)])).text).toBe('(0.00, 0.00)');
  });

  it('follows the point it describes, so the readout drags with it', () => {
    // It is deliberately not a `number`: a pair is not one value. The text is
    // anchored at the parent, so a moved point moves the readout with it — which
    // is what makes it a live readout rather than a caption.
    const moved = textOf(defined('measure.coordinates', [P(-1.5, 8)]));
    expect(moved.at).toEqual(V(-1.5, 8));
    expect(moved.text).toBe('(−1.50, 8.00)');
  });

  it('never aliases the parent geometry it is computed from', () => {
    const parent = P(3, -4);
    const result = textOf(defined('measure.coordinates', [parent]));
    if (parent.kind !== 'point') throw new Error('unreachable');
    result.at.x = 99;
    expect(parent.at.x).toBe(3);
  });

  it('reports why it cannot be read', () => {
    expect(reasonOf('measure.coordinates', [P(Number.NaN, 0)])).toBe('非有限坐标');
    expect(reasonOf('measure.coordinates', [segment(0, 0, 1, 1)])).toBe('bad parents: expected a point');
    expect(reasonOf('measure.coordinates', [P(0, 0), P(1, 1)])).toMatch(/bad parents/);
  });

  it('is deterministic for identical inputs', () => {
    expectDeterministic('measure.coordinates', [P(-2.5, 3.75)]);
  });
});

describe('measure.equation', () => {
  it('is registered with the title and parent kinds the action bar reads', () => {
    expect(registry.get('measure.equation')?.title).toBe('方程');
    // One signature per straight kind, then the circle.
    expect(registry.get('measure.equation')?.parentKinds).toEqual([
      ['segment'],
      ['line'],
      ['ray'],
      ['circle'],
    ]);
  });

  it('writes a sloped line as y = mx + b', () => {
    const result = textOf(defined('measure.equation', [segment(0, 1, 4, 4)]));
    expect(result.text).toBe('y = 0.75x + 1.00');
    // Anchored at the parent's sample point — a segment's midpoint.
    expect(result.at).toEqual(V(2, 2.5));
  });

  it('writes a horizontal line as y = b and drops a zero intercept', () => {
    expect(textOf(defined('measure.equation', [segment(0, 3, 4, 3)])).text).toBe('y = 3.00');
    // Through the origin: `y = 0.75x`, never `y = 0.75x + 0.00`.
    expect(textOf(defined('measure.equation', [line(0, 0, 400, 300)])).text).toBe('y = 0.75x');
    expect(textOf(defined('measure.equation', [ray(0, 0, 400, 300)])).text).toBe('y = 0.75x');
  });

  it('writes a negative intercept and a negative slope with a typographic minus', () => {
    expect(textOf(defined('measure.equation', [segment(0, -1, 4, 2)])).text).toBe('y = 0.75x − 1.00');
    expect(textOf(defined('measure.equation', [segment(0, 1, 4, -2)])).text).toBe('y = −0.75x + 1.00');
  });

  it('writes a vertical path as x = c — there is no y = form for it', () => {
    expect(textOf(defined('measure.equation', [segment(2, -1, 2, 3)])).text).toBe('x = 2.00');
    expect(textOf(defined('measure.equation', [line(5, 0, 0, 1)])).text).toBe('x = 5.00');
    expect(textOf(defined('measure.equation', [ray(-3, 1, 0, -2)])).text).toBe('x = −3.00');
    // Relative verticality, exactly as in the slope readout.
    expect(textOf(defined('measure.equation', [segment(0, 0, 1e-12, 5)])).text).toBe('x = 0.00');
  });

  it('writes a circle as (x − a)² + (y − b)² = r²', () => {
    expect(textOf(defined('measure.equation', [circle(1, 2, 3)])).text).toBe(
      '(x − 1.00)² + (y − 2.00)² = 9.00',
    );
    expect(textOf(defined('measure.equation', [circle(-1, 0, 2)])).text).toBe('(x + 1.00)² + y² = 4.00');
    expect(textOf(defined('measure.equation', [circle(0, 0, 2)])).text).toBe('x² + y² = 4.00');
  });

  it('anchors at the parent it describes', () => {
    expect(textOf(defined('measure.equation', [segment(0, 0, 4, 0)])).at).toEqual(V(2, 0));
    expect(textOf(defined('measure.equation', [line(1, 2, 1, 0)])).at).toEqual(V(1, 2));
    expect(textOf(defined('measure.equation', [ray(1, 2, 1, 0)])).at).toEqual(V(1, 2));
    // A circle's sample point is its centre.
    expect(textOf(defined('measure.equation', [circle(1, 2, 3)])).at).toEqual(V(1, 2));
  });

  it('never aliases the parent geometry in its anchor', () => {
    const parent = circle(1, 2, 3);
    const result = textOf(defined('measure.equation', [parent]));
    if (parent.kind !== 'circle') throw new Error('unreachable');
    result.at.x = 99;
    expect(parent.center.x).toBe(1);
  });

  it('reports why it cannot be written', () => {
    expect(reasonOf('measure.equation', [segment(1, 1, 1, 1)])).toBe('退化');
    expect(reasonOf('measure.equation', [line(0, 0, 0, 0)])).toBe('退化');
    expect(reasonOf('measure.equation', [ray(0, 0, 0, 0)])).toBe('退化');
    expect(reasonOf('measure.equation', [circle(0, 0, -1)])).toBe('半径为零');
    expect(reasonOf('measure.equation', [circle(Number.NaN, 0, 1)])).toBe('非有限坐标');
    expect(reasonOf('measure.equation', [segment(0, 0, Number.NaN, 1)])).toBe('非有限坐标');
    expect(reasonOf('measure.equation', [segment(0, 0, 0, Number.POSITIVE_INFINITY)])).toBe('非有限坐标');
    const refused: Geometry[] = [
      P(0, 0),
      polygon([V(0, 0), V(1, 0), V(0, 1)]),
      textGeom(0, 0, 'x = 1'),
      arc(0, 0, 1, 0, 1),
    ];
    for (const parent of refused) {
      expect(reasonOf('measure.equation', [parent])).toBe(
        'bad parents: expected a segment, line, ray or circle',
      );
    }
    expect(reasonOf('measure.equation', [circle(0, 0, 1), circle(0, 0, 1)])).toMatch(/bad parents/);
  });

  it('never prints NaN or Infinity over a seeded sweep of straight paths', () => {
    const values = seededValues(424242, 800);
    for (let i = 0; i + 3 < values.length; i += 4) {
      const result = compute('measure.equation', [
        segment(values[i], values[i + 1], values[i + 2], values[i + 3]),
      ]);
      if (isUndefined(result)) continue; // refused, never printed
      const readout = textOf(result);
      expect(readout.text).not.toMatch(/NaN|Infinity/);
      expect(Number.isFinite(readout.at.x)).toBe(true);
      expect(Number.isFinite(readout.at.y)).toBe(true);
    }
  });

  it('is deterministic for identical inputs', () => {
    expectDeterministic('measure.equation', [segment(-2.5, 3.75, 9, -1)]);
    expectDeterministic('measure.equation', [line(1.5, -0.25, 3, 4)]);
    expectDeterministic('measure.equation', [circle(-1.25, 2.5, 0.75)]);
  });
});

/**
 * The registry `compute` above is only half the contract: a measurement is
 * useful once `computeScene` resolves it out of a document and `anchorsOf`
 * places it, because that is what makes it selectable and draggable. These are
 * the readouts whose *result kind* is not a number, so they are the ones for
 * which the core integration can silently go wrong.
 */
describe('measurements in a document', () => {
  it('resolves readouts through the DAG and anchors them where the frozen rule says', () => {
    const doc: Doc = {
      version: 1,
      viewport: { ...DEFAULT_VIEWPORT },
      objects: [
        { id: 'A', type: 'point.free', parents: [], params: { x: 3, y: -4 } },
        { id: 'B', type: 'point.free', parents: [], params: { x: 7, y: 0 } },
        { id: 'AB', type: 'segment', parents: ['A', 'B'], params: {} },
        { id: 'coords', type: 'measure.coordinates', parents: ['A'], params: null },
        { id: 'line', type: 'measure.equation', parents: ['AB'], params: null },
      ],
    };
    const scene = computeScene(doc);
    expect([...scene.undefined]).toEqual([]);
    // The segment runs (3, −4) → (7, 0): slope 1, so `y = x − 7`.
    expect(scene.geoms.get('coords')).toEqual({ kind: 'text', at: V(3, -4), text: '(3.00, −4.00)' });
    expect(scene.geoms.get('line')).toEqual({ kind: 'text', at: V(5, -2), text: 'y = 1.00x − 7.00' });
    // A text readout is hit where its own anchor is, and a segment's anchor is
    // its midpoint — which is what makes the equation draggable with the figure.
    const anchors = anchorsOf(doc, scene);
    expect(anchors.get('coords')).toEqual(V(3, -4));
    expect(anchors.get('line')).toEqual(V(5, -2));
    expect(hitTest(scene, V(3, -4), 0.01, anchors)).toContain('coords');
  });

  it('keeps a readout defined while its parent moves, and undefined when it cannot be read', () => {
    const records: ObjRecord[] = [
      { id: 'A', type: 'point.free', parents: [], params: { x: 0, y: 0 } },
      { id: 'B', type: 'point.free', parents: [], params: { x: 4, y: 0 } },
      { id: 'AB', type: 'segment', parents: ['A', 'B'], params: {} },
      { id: 'slope', type: 'measure.slope', parents: ['AB'], params: null },
      { id: 'coords', type: 'measure.coordinates', parents: ['A'], params: null },
    ];
    const doc: Doc = { version: 1, viewport: { ...DEFAULT_VIEWPORT }, objects: records };
    expect(computeScene(doc).geoms.get('slope')).toEqual({ kind: 'number', value: 0 });

    // Move B onto A's vertical: the horizontal readout becomes vertical, so the
    // slope goes undefined *with its reason* (D9) instead of the construction
    // emitting an infinity, and the coordinate readout drags along as it should.
    records[1] = { ...records[1], params: { x: 0, y: 3 } };
    const moved = computeScene(doc);
    expect(moved.geoms.has('slope')).toBe(false);
    expect(moved.undefined.get('slope')).toBe('斜率不存在');
    expect(moved.geoms.get('coords')).toEqual({ kind: 'text', at: V(0, 0), text: '(0.00, 0.00)' });
  });
});
