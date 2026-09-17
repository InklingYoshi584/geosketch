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
import type { Geometry } from './scene';
import type { Json, Vec2 } from './types';
import { dist } from './kernel/vec2';
import './objects/measures';

const ENV: Env = { scale: 64 };

const V = (x: number, y: number): Vec2 => ({ x, y });
const P = (x: number, y: number): Geometry => ({ kind: 'point', at: V(x, y) });
const polygon = (points: Vec2[]): Geometry => ({ kind: 'polygon', points });

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

function expectDeterministic(name: string, parents: Geometry[]): void {
  const clone = JSON.parse(JSON.stringify(parents)) as Geometry[];
  expect(compute(name, parents)).toEqual(compute(name, clone));
}

describe('measure.distance', () => {
  it('is registered with the title and parent kinds the action bar reads', () => {
    expect(registry.get('measure.distance')?.title).toBe('距离');
    expect(registry.get('measure.distance')?.parentKinds).toEqual([['point', 'point']]);
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

  it('is deterministic for identical inputs', () => {
    expectDeterministic('measure.distance', [P(-2.5, 3.75), P(9, -1)]);
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
