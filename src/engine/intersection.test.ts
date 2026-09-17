import { describe, expect, it } from 'vitest';

import { computeScene, hitTest } from './scene';
import type { Geometry, Scene } from './scene';
import { isUndefined, registry } from './registry';
import type { Env, Undefined } from './registry';
import type { Doc, Id, Json, ObjRecord, Vec2 } from './types';
import './objects/point-free';
import './objects/paths';
import './objects/intersection';

const V = (x: number, y: number): Vec2 => ({ x, y });
const P = (x: number, y: number): Geometry => ({ kind: 'point', at: V(x, y) });
const unit = (x: number, y: number): Vec2 => {
  const length = Math.hypot(x, y);
  return { x: x / length, y: y / length };
};
const segment = (ax: number, ay: number, bx: number, by: number): Geometry => ({
  kind: 'segment',
  a: V(ax, ay),
  b: V(bx, by),
});
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

const ENV: Env = { scale: 64 };

/** Call the registered type the way the core calls it (the core does not re-check kinds). */
function intersect(parents: Geometry[], params: Json = {}): Geometry | Undefined {
  const type = registry.get('intersection');
  if (type === undefined) throw new Error('intersection is not registered');
  return type.compute(parents, params, ENV);
}

/** The branch's meeting point, or a failure if it should not have been undefined. */
function meeting(parents: Geometry[], params: Json = {}): Vec2 {
  const result = intersect(parents, params);
  if (isUndefined(result)) throw new Error(`unexpectedly undefined: ${result.reason}`);
  if (result.kind !== 'point') throw new Error(`not a point: ${result.kind}`);
  return result.at;
}

/** The reason there is no such point — what the undefined chip will show. */
function refusal(parents: Geometry[], params: Json = {}): string {
  const result = intersect(parents, params);
  if (!isUndefined(result)) throw new Error(`unexpectedly defined: ${JSON.stringify(result)}`);
  return result.reason;
}

function expectClose(actual: Vec2, expected: Vec2): void {
  expect(actual.x).toBeCloseTo(expected.x, 12);
  expect(actual.y).toBeCloseTo(expected.y, 12);
}

function point(id: Id, x: number, y: number, params: Json = { x, y }): ObjRecord {
  return { id, type: 'point.free', parents: [], params };
}

function docOf(objects: ObjRecord[]): Doc {
  return { version: 1, viewport: { cx: 0, cy: 0, scale: 64 }, objects };
}

describe('intersection registration', () => {
  it('is 交点 over two paths', () => {
    expect(registry.get('intersection')).toMatchObject({
      title: '交点',
      parentKinds: [['path', 'path']],
    });
  });
});

describe('straight × straight', () => {
  it('meets two segments where they cross', () => {
    expect(meeting([segment(-2, 0, 2, 0), segment(0, -3, 0, 3)])).toEqual(V(0, 0));
  });

  it('meets any pair of the straight kinds', () => {
    expect(meeting([line(0, 0, 1, 0), line(3, -1, 0, 1)])).toEqual(V(3, 0));
    expect(meeting([segment(0, 0, 4, 0), line(2, -1, 0, 1)])).toEqual(V(2, 0));
    expect(meeting([ray(0, 0, 1, 0), line(2, -1, 0, 1)])).toEqual(V(2, 0));
    expect(meeting([line(0, 0, 1, 0), segment(2, -1, 2, 1)])).toEqual(V(2, 0));
  });

  it('keeps the meeting inside both parents’ own domains', () => {
    // The infinite lines cross, but not where either bounded parent reaches.
    expect(refusal([segment(0, 0, 1, 0), line(2, -1, 0, 1)])).toBe('无交点');
    expect(refusal([line(0, 0, 1, 0), segment(3, 1, 3, 2)])).toBe('无交点');
    expect(refusal([ray(0, 0, -1, 0), line(2, -1, 0, 1)])).toBe('无交点');
  });

  it('distinguishes parallel lines from coincident ones', () => {
    expect(refusal([line(0, 0, 1, 0), line(0, 1, 1, 0)])).toBe('两直线平行');
    expect(refusal([segment(0, 0, 1, 0), segment(2, 1, 3, 1)])).toBe('两直线平行');
    expect(refusal([segment(0, 0, 4, 0), segment(2, 0, 3, 0)])).toBe('两直线重合');
    expect(refusal([ray(0, 0, -1, 0), line(1, 0, 1, 0)])).toBe('两直线重合');
    // Collinear segments share infinitely many points, so they are coincident
    // even where they overlap in a single endpoint.
    expect(refusal([segment(0, 0, 1, 0), segment(1, 0, 2, 0)])).toBe('两直线重合');
  });

  it('refuses a degenerate straight parent rather than inventing a direction', () => {
    expect(refusal([segment(1, 1, 1, 1), line(0, 0, 1, 0)])).toBe('退化');
  });
});

describe('straight × circle', () => {
  it('meets a circle twice, ordered along the first parent', () => {
    const axis = line(-3, 0, 1, 0); // the x-axis, parameterised from (-3, 0)
    const target = circle(0, 0, 2);

    // Line first: roots ascend along the line, so (-2,0) comes before (2,0).
    expectClose(meeting([axis, target], { branch: 0 }), V(-2, 0));
    expectClose(meeting([axis, target], { branch: 1 }), V(2, 0));

    // Circle first: roots ascend by angle, so they come out the other way round.
    expectClose(meeting([target, axis], { branch: 0 }), V(2, 0));
    expectClose(meeting([target, axis], { branch: 1 }), V(-2, 0));
  });

  it('drops the roots a bounded straight parent cannot reach', () => {
    const target = circle(0, 0, 5);
    // The vertical line x = 3 crosses the circle at (3, ±4); this segment stays well inside.
    expect(refusal([segment(3, -1, 3, 1), target])).toBe('无交点');
    expect(refusal([target, segment(3, -1, 3, 1)])).toBe('无交点');
    // A segment that does reach keeps both, ascending from its own first endpoint.
    expectClose(meeting([segment(3, -5, 3, 5), target], { branch: 0 }), V(3, -4));
    expectClose(meeting([segment(3, -5, 3, 5), target], { branch: 1 }), V(3, 4));
    // …whereas a ray reaching only one root has nothing to offer on branch 1.
    const rayAcross = ray(1, 0, -1, 0);
    expectClose(meeting([rayAcross, circle(0, 0, 2)], { branch: 0 }), V(-2, 0));
    expect(refusal([rayAcross, circle(0, 0, 2)], { branch: 1 })).toBe('无交点');
  });

  it('reports a tangent root twice, so neither branch jumps at tangency', () => {
    const tangent = line(0, 1, 1, 0); // the line y = 1, touching the unit circle at (0,1)
    const target = circle(0, 0, 1);

    expectClose(meeting([tangent, target], { branch: 0 }), V(0, 1));
    expectClose(meeting([tangent, target], { branch: 1 }), V(0, 1));
    expectClose(meeting([target, tangent], { branch: 0 }), V(0, 1));
    expectClose(meeting([target, tangent], { branch: 1 }), V(0, 1));
  });

  it('says so when the paths miss each other', () => {
    expect(refusal([circle(0, 0, 1), line(0, 5, 1, 0)])).toBe('无交点');
    expect(refusal([line(0, 5, 1, 0), circle(0, 0, 1)])).toBe('无交点');
    expect(refusal([circle(5, 10, 1), ray(0, 0, 1, 0)])).toBe('无交点');
  });

  it('does not pretend to solve circle pairs yet', () => {
    expect(refusal([circle(0, 0, 2), circle(1, 0, 1)])).toBe('两圆相交暂不支持');
    expect(refusal([circle(0, 0, 2), circle(1, 0, 1)], { branch: 1 })).toBe('两圆相交暂不支持');
  });
});

describe('branch selection', () => {
  it('defaults to branch 0 and ignores an unusable hint', () => {
    const axis = line(-3, 0, 1, 0);
    const target = circle(0, 0, 2);

    expectClose(meeting([axis, target]), V(-2, 0));
    expectClose(meeting([axis, target], null), V(-2, 0));
    expectClose(meeting([axis, target], { branch: Number.NaN }), V(-2, 0));
    expectClose(meeting([axis, target], { branch: 'second' }), V(-2, 0));
    expectClose(meeting([axis, target], { branch: -1.8 }), V(-2, 0));
    expectClose(meeting([axis, target], { branch: 1.7 }), V(2, 0)); // truncated, not rounded
  });

  it('is undefined — not wrong — when the current configuration has no such root', () => {
    const axis = line(-3, 0, 1, 0);
    const target = circle(0, 0, 2);
    expect(refusal([axis, target], { branch: 2 })).toBe('无交点');
    expect(refusal([line(0, 0, 1, 0), line(3, -1, 0, 1)], { branch: 1 })).toBe('无交点');
  });
});

describe('parents', () => {
  it('needs exactly two paths', () => {
    expect(refusal([P(0, 0), line(0, 0, 1, 0)])).toBe('需要两个路径对象');
    expect(refusal([line(0, 0, 1, 0)])).toBe('需要两个路径对象');
    expect(refusal([line(0, 0, 1, 0), P(1, 1), P(2, 2)])).toBe('需要两个路径对象');
    expect(refusal([{ kind: 'polygon', points: [V(0, 0), V(1, 0), V(0, 1)] }, line(0, 0, 1, 0)])).toBe(
      '需要两个路径对象',
    );
    expect(refusal([{ kind: 'number', value: 3 }, line(0, 0, 1, 0)])).toBe('需要两个路径对象');
  });

  it('returns a point that lies on both parents', () => {
    const cases: [Geometry, Geometry][] = [
      [segment(-2, 0, 2, 0), segment(0, -3, 0, 3)],
      [line(-3, 0, 1, 0), circle(0, 0, 2)],
      [circle(1, 1, 3), segment(-4, 1, 4, 1)],
      [ray(1, 0, -1, 0), circle(0, 0, 2)],
      [line(0, 0, 1, 1), line(2, -2, 1, -1)],
      [ray(0, 0, 1, 2), circle(-5, -10, 2)],
    ];

    for (const [first, second] of cases) {
      for (const branch of [0, 1]) {
        const result = intersect([first, second], { branch });
        if (isUndefined(result)) continue;
        if (result.kind !== 'point') throw new Error(`not a point: ${result.kind}`);
        const scene: Scene = {
          geoms: new Map([
            ['i', result],
            ['a', first],
            ['b', second],
          ]),
          undefined: new Map(),
        };
        // The point is within a relative epsilon of both parents, as the hit test measures them.
        expect(hitTest(scene, result.at, 1e-9)).toEqual(expect.arrayContaining(['a', 'b', 'i']));
      }
    }
  });
});

describe('intersection in a document', () => {
  const objects = (nanOnB = false): ObjRecord[] => [
    point('a', -2, 0),
    nanOnB
      ? { id: 'b', type: 'point.free', parents: [], params: { x: Number.NaN, y: 0 } }
      : point('b', 2, 0),
    { id: 's', type: 'segment', parents: ['a', 'b'], params: {} },
    point('c', 0, -3),
    point('d', 0, 3),
    { id: 't', type: 'segment', parents: ['c', 'd'], params: {} },
    { id: 'x', type: 'intersection', parents: ['s', 't'], params: { branch: 0 } },
  ];

  it('computes from real parent objects and follows them when they move', () => {
    const before = computeScene(docOf(objects()));
    expect(before.undefined.size).toBe(0);
    expect(before.geoms.get('x')).toEqual({ kind: 'point', at: { x: 0, y: 0 } });

    const moved = docOf(objects());
    (moved.objects[4].params as { x: number }).x = 2; // drag point D from (0,3) to (2,3)
    const after = computeScene(moved).geoms.get('x');
    if (after?.kind !== 'point') throw new Error(`expected a point, got ${JSON.stringify(after)}`);
    expectClose(after.at, V(1, 0));
  });

  it('inherits the root reason of an undefined parent, and never a NaN point', () => {
    const scene = computeScene(docOf(objects(true)));

    expect(scene.geoms.has('x')).toBe(false);
    expect(scene.undefined.get('s')).toBe(scene.undefined.get('b'));
    expect(scene.undefined.get('x')).toBe(scene.undefined.get('b'));
  });
});
