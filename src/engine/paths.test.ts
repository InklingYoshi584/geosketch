import { describe, expect, it } from 'vitest';

import { anchorsOf, computeScene, evalPath, hitTest, isPathGeometry, projectPoint } from './scene';
import type { Geometry, Scene } from './scene';
import { isUndefined, kindMatches, registerType, registry } from './registry';
import type { Env, Undefined } from './registry';
import type { Doc, Id, Json, ObjRecord, Vec2 } from './types';
import { dist } from './kernel/vec2';
import './objects/point-free';
import './objects/paths';
import './objects/point-on-object';

const V = (x: number, y: number): Vec2 => ({ x, y });
const P = (x: number, y: number): Geometry => ({ kind: 'point', at: V(x, y) });
const SEGMENT = (ax: number, ay: number, bx: number, by: number): Geometry => ({
  kind: 'segment',
  a: V(ax, ay),
  b: V(bx, by),
});

/** A number the tests control directly, standing in for a measurement as a parent. */
const TEST_NUMBER = 'test.number';

registerType({
  name: TEST_NUMBER,
  title: '测试数值',
  parentKinds: [[]],
  compute(_parents: Geometry[], params: Json, _env: Env): Geometry | Undefined {
    if (typeof params !== 'object' || params === null || Array.isArray(params)) {
      return { reason: 'bad params' };
    }
    const value = params.value;
    if (typeof value !== 'number' || !Number.isFinite(value)) return { reason: 'bad params' };
    return params.unit === 'deg'
      ? { kind: 'number', value, unit: 'deg' }
      : { kind: 'number', value };
  },
});

/** A `number` geometry the tests pass around as a parent. */
const TEST_NUMBER_GEO: Geometry = { kind: 'number', value: 2.5 };

const ENV: Env = { scale: 64 };

function compute(type: string, parents: Geometry[], params: Json = {}): Geometry | Undefined {
  const objType = registry.get(type);
  if (objType === undefined) throw new Error(`unregistered type: ${type}`);
  return objType.compute(parents, params, ENV);
}

function defined(type: string, parents: Geometry[], params: Json = {}): Geometry {
  const result = compute(type, parents, params);
  if (isUndefined(result)) throw new Error(`${type} is undefined: ${result.reason}`);
  return result;
}

function reasonOf(type: string, parents: Geometry[], params: Json = {}): string {
  const result = compute(type, parents, params);
  if (!isUndefined(result)) throw new Error(`${type} is defined: ${JSON.stringify(result)}`);
  return result.reason;
}

/** A free-point record whose params say what the object *is* (like `point.free` writes). */
function point(id: Id, x: number, y: number, params: Json = { x, y }): ObjRecord {
  return { id, type: 'point.free', parents: [], params };
}

function sceneOf(objects: ObjRecord[]): Scene {
  const doc: Doc = { version: 1, viewport: { cx: 0, cy: 0, scale: 64 }, objects };
  return computeScene(doc);
}

function docOf(objects: ObjRecord[]): Doc {
  return { version: 1, viewport: { cx: 0, cy: 0, scale: 64 }, objects };
}

/** Trigonometry is only accurate to ~1e-16, so circle coordinates compare approximately. */
function expectClose(actual: Vec2, expected: Vec2): void {
  expect(actual.x).toBeCloseTo(expected.x, 12);
  expect(actual.y).toBeCloseTo(expected.y, 12);
}

describe('path types', () => {
  it('registers the frozen names, titles and parent signatures', () => {
    expect(registry.get('segment')).toMatchObject({
      title: '线段',
      parentKinds: [['point', 'point']],
    });
    expect(registry.get('line')).toMatchObject({ title: '直线', parentKinds: [['point', 'point']] });
    expect(registry.get('ray')).toMatchObject({ title: '射线', parentKinds: [['point', 'point']] });
    expect(registry.get('circle.centerPoint')).toMatchObject({
      title: '圆',
      parentKinds: [['point', 'point']],
    });
    expect(registry.get('circle.centerRadius')).toMatchObject({
      title: '圆(圆心+半径)',
      parentKinds: [['point', 'number']],
    });
    // Variadic: the action layer reads this single three-point signature as "≥ 3 points".
    expect(registry.get('polygon')).toMatchObject({
      title: '多边形',
      parentKinds: [['point', 'point', 'point']],
    });
    expect(registry.get('point.onObject')).toMatchObject({
      title: '对象上的点',
      parentKinds: [['path']],
    });
  });

  it('takes a segment, a line and a ray from two points', () => {
    const a = P(0, 0);
    const b = P(3, 4);

    expect(defined('segment', [a, b])).toEqual({ kind: 'segment', a: V(0, 0), b: V(3, 4) });
    // A unit direction, so `t` is world units: (3,4) is 5 long.
    expect(defined('line', [a, b])).toEqual({ kind: 'line', at: V(0, 0), dir: V(0.6, 0.8) });
    expect(defined('ray', [a, b])).toEqual({ kind: 'ray', at: V(0, 0), dir: V(0.6, 0.8) });
  });

  it('refuses a degenerate straight path instead of guessing a direction', () => {
    const same = P(2, 2);
    expect(reasonOf('segment', [same, P(2, 2)])).toBe('两点重合');
    expect(reasonOf('line', [same, P(2, 2)])).toBe('两点重合');
    expect(reasonOf('ray', [same, P(2, 2)])).toBe('两点重合');
  });

  it('needs the right parent kinds', () => {
    expect(reasonOf('segment', [P(0, 0)])).toBe('需要两个点');
    expect(reasonOf('segment', [P(0, 0), TEST_NUMBER_GEO])).toBe('需要两个点');
    expect(reasonOf('segment', [P(0, 0), P(Number.NaN, 1)])).toBe('非有限坐标');
  });

  it('centres a circle on a point either through another point or through a number', () => {
    expect(defined('circle.centerPoint', [P(0, 0), P(3, 4)])).toEqual({
      kind: 'circle',
      center: V(0, 0),
      radius: 5,
    });
    expect(reasonOf('circle.centerPoint', [P(1, 1), P(1, 1)])).toBe('半径为零');

    expect(defined('circle.centerRadius', [P(1, 2), TEST_NUMBER_GEO])).toEqual({
      kind: 'circle',
      center: V(1, 2),
      radius: 2.5,
    });
    expect(defined('circle.centerRadius', [P(1, 2), defined(TEST_NUMBER, [], { value: 0.5 })])).toEqual(
      { kind: 'circle', center: V(1, 2), radius: 0.5 },
    );
    // A negative or zero radius is a collapse, not a circle; an angle is a unit mismatch.
    expect(reasonOf('circle.centerRadius', [P(0, 0), defined(TEST_NUMBER, [], { value: 0 })])).toBe(
      '半径为零',
    );
    expect(reasonOf('circle.centerRadius', [P(0, 0), defined(TEST_NUMBER, [], { value: -3 })])).toBe(
      '半径不能为负',
    );
    expect(
      reasonOf('circle.centerRadius', [P(0, 0), defined(TEST_NUMBER, [], { value: 90, unit: 'deg' })]),
    ).toBe('半径不能是角度');
    expect(reasonOf('circle.centerRadius', [P(0, 0), P(1, 1)])).toBe('需要一个圆心和一个数值半径');
  });

  it('builds a polygon from three or more points, and rejects a flat one', () => {
    const polygon = defined('polygon', [P(0, 0), P(4, 0), P(0, 3)]);
    expect(polygon).toEqual({
      kind: 'polygon',
      points: [V(0, 0), V(4, 0), V(0, 3)],
    });

    expect(reasonOf('polygon', [P(0, 0), P(4, 0)])).toBe('多边形至少需要三个点');
    expect(reasonOf('polygon', [P(0, 0), P(1, 1), P(2, 2), P(3, 3)])).toBe('退化');
    expect(reasonOf('polygon', [P(0, 0), P(4, 0), P(0, 0)])).toBe('退化');
    expect(reasonOf('polygon', [P(0, 0), P(4, 0), TEST_NUMBER_GEO])).toBe('多边形只能由点构成');
    // Scale-free: a tiny triangle far from the origin is still a triangle.
    expect(defined('polygon', [P(1e6, 1e6), P(1e6 + 1e-3, 1e6), P(1e6, 1e6 + 1e-3)])).toMatchObject({
      kind: 'polygon',
    });
  });
});

describe('point.onObject', () => {
  const segment = SEGMENT(0, 0, 4, 8);

  it('glues a point to its parent path by parameter', () => {
    expect(defined('point.onObject', [segment], {})).toEqual({ kind: 'point', at: V(2, 4) });
    expect(defined('point.onObject', [segment], null)).toEqual({ kind: 'point', at: V(2, 4) });
    expect(defined('point.onObject', [segment], { t: 0.25 })).toEqual({ kind: 'point', at: V(1, 2) });
  });

  it('reads `t` clipped to the path, never off the end of it', () => {
    expect(defined('point.onObject', [segment], { t: 4 })).toEqual({ kind: 'point', at: V(4, 8) });
    expect(defined('point.onObject', [segment], { t: -1 })).toEqual({ kind: 'point', at: V(0, 0) });
    const circle: Geometry = { kind: 'circle', center: V(0, 0), radius: 2 };
    expectClose(
      (defined('point.onObject', [circle], { t: Math.PI }) as { at: Vec2 }).at,
      V(-2, 0),
    );
  });

  it('reports a corrupt parameter and a non-path parent', () => {
    expect(reasonOf('point.onObject', [segment], { t: 'half' })).toBe('参数 t 必须是有限数');
    expect(reasonOf('point.onObject', [segment], { t: Number.NaN })).toBe('参数 t 必须是有限数');
    expect(reasonOf('point.onObject', [P(0, 0)], {})).toBe('需要一个路径对象');
    expect(reasonOf('point.onObject', [defined('polygon', [P(0, 0), P(1, 0), P(0, 1)])], {})).toBe(
      '需要一个路径对象',
    );
    expect(reasonOf('point.onObject', [], {})).toBe('需要一个路径对象');
  });
});

describe('evalPath', () => {
  it('parameterises a segment by proportion, clamped to its ends', () => {
    const segment = SEGMENT(0, 0, 4, 8);
    expect(evalPath(segment, 0)).toEqual(V(0, 0));
    expect(evalPath(segment, 0.25)).toEqual(V(1, 2));
    expect(evalPath(segment, 0.5)).toEqual(V(2, 4));
    expect(evalPath(segment, 1)).toEqual(V(4, 8));
    expect(evalPath(segment, -3)).toEqual(V(0, 0));
    expect(evalPath(segment, 7)).toEqual(V(4, 8));
    expect(evalPath(segment, Number.NaN)).toEqual(V(0, 0));
  });

  it('parameterises a line in world units, in both directions', () => {
    const line: Geometry = { kind: 'line', at: V(1, 2), dir: V(0, 1) };
    expect(evalPath(line, 3)).toEqual(V(1, 5));
    expect(evalPath(line, -2)).toEqual(V(1, 0));
  });

  it('parameterises a ray in world units, clamped at its origin', () => {
    const ray: Geometry = { kind: 'ray', at: V(1, 2), dir: V(1, 0) };
    expect(evalPath(ray, 4)).toEqual(V(5, 2));
    expect(evalPath(ray, 0)).toEqual(V(1, 2));
    expect(evalPath(ray, -4)).toEqual(V(1, 2));
  });

  it('parameterises a circle by angle, folded into [0, 2π)', () => {
    const circle: Geometry = { kind: 'circle', center: V(10, 10), radius: 2 };
    expectClose(evalPath(circle, 0), V(12, 10));
    expectClose(evalPath(circle, Math.PI / 2), V(10, 12));
    expectClose(evalPath(circle, Math.PI), V(8, 10));
    expectClose(evalPath(circle, -Math.PI / 2), V(10, 8));
    expectClose(evalPath(circle, Math.PI * 3), V(8, 10));
  });

  it('falls back to the sample point for kinds without a parameter', () => {
    expect(evalPath(P(3, 4), 0.7)).toEqual(V(3, 4));
    expect(evalPath({ kind: 'polygon', points: [V(0, 0), V(4, 0), V(4, 4)] }, 0.7)).toEqual(V(8 / 3, 4 / 3));
    expect(evalPath({ kind: 'number', value: 7 }, 0.7)).toEqual(V(0, 0));
  });
});

describe('projectPoint', () => {
  it('clamps to the ends of a segment and of a ray, but never to a line', () => {
    const segment = SEGMENT(0, 0, 4, 0);
    expect(projectPoint(segment, V(2, 9))).toBeCloseTo(0.5);
    expect(projectPoint(segment, V(-5, 1))).toBe(0);
    expect(projectPoint(segment, V(40, -2))).toBe(1);

    const line: Geometry = { kind: 'line', at: V(0, 0), dir: V(1, 0) };
    expect(projectPoint(line, V(7, 3))).toBeCloseTo(7);
    expect(projectPoint(line, V(-7, 3))).toBeCloseTo(-7);

    const ray: Geometry = { kind: 'ray', at: V(0, 0), dir: V(1, 0) };
    expect(projectPoint(ray, V(7, 3))).toBeCloseTo(7);
    expect(projectPoint(ray, V(-7, 3))).toBe(0);
  });

  it('returns an angle in [0, 2π) for a circle', () => {
    const circle: Geometry = { kind: 'circle', center: V(3, 3), radius: 2 };
    expect(projectPoint(circle, V(5, 3))).toBe(0);
    expect(projectPoint(circle, V(3, 5))).toBeCloseTo(Math.PI / 2);
    expect(projectPoint(circle, V(1, 3))).toBeCloseTo(Math.PI);
    expect(projectPoint(circle, V(3, 1))).toBeCloseTo(Math.PI * 1.5);
    const below = projectPoint(circle, V(3, 1));
    expect(below).toBeGreaterThanOrEqual(0);
    expect(below).toBeLessThan(Math.PI * 2);
  });

  it('is the inverse of evalPath: the projection is the nearest point on the path', () => {
    const paths: Geometry[] = [
      SEGMENT(1, 1, 5, 1),
      { kind: 'line', at: V(1, 1), dir: V(1, 0) },
      { kind: 'ray', at: V(1, 1), dir: V(1, 0) },
      { kind: 'circle', center: V(0, 0), radius: 2 },
    ];
    const probes = [V(-3, 4), V(0.5, 0), V(2, 2), V(9, -1)];

    for (const path of paths) {
      for (const world of probes) {
        const t = projectPoint(path, world);
        const nearest = dist(evalPath(path, t), world);
        // No nearby parameter — including ones clamped back onto the path — gets closer.
        for (const step of [-0.5, -0.05, 0.05, 0.5]) {
          expect(dist(evalPath(path, t + step), world)).toBeGreaterThanOrEqual(nearest - 1e-9);
        }
      }
    }
  });

  it('has no parameter for kinds that are not paths', () => {
    expect(projectPoint(P(5, 5), V(9, 9))).toBe(0);
    expect(projectPoint({ kind: 'polygon', points: [V(0, 0), V(4, 0), V(4, 4)] }, V(9, 9))).toBe(0);
    expect(projectPoint({ kind: 'number', value: 3 }, V(9, 9))).toBe(0);
  });
});

describe('isPathGeometry / kindMatches', () => {
  it('knows which kinds have a parameter', () => {
    expect(isPathGeometry(SEGMENT(0, 0, 1, 1))).toBe(true);
    expect(isPathGeometry({ kind: 'line', at: V(0, 0), dir: V(1, 0) })).toBe(true);
    expect(isPathGeometry({ kind: 'ray', at: V(0, 0), dir: V(1, 0) })).toBe(true);
    expect(isPathGeometry({ kind: 'circle', center: V(0, 0), radius: 1 })).toBe(true);
    expect(isPathGeometry(P(0, 0))).toBe(false);
    expect(isPathGeometry({ kind: 'polygon', points: [] })).toBe(false);
    expect(isPathGeometry({ kind: 'number', value: 1 })).toBe(false);
  });

  it('matches exact kinds, `path` and `any`', () => {
    expect(kindMatches('point', 'point')).toBe(true);
    expect(kindMatches('point', 'segment')).toBe(false);
    expect(kindMatches('path', 'segment')).toBe(true);
    expect(kindMatches('path', 'circle')).toBe(true);
    expect(kindMatches('path', 'polygon')).toBe(false);
    expect(kindMatches('path', 'number')).toBe(false);
    expect(kindMatches('any', 'number')).toBe(true);
    expect(kindMatches('any', 'polygon')).toBe(true);
  });
});

describe('anchorsOf', () => {
  it('anchors every kind at its sample point', () => {
    const doc = docOf([
      point('a', 0, 0),
      point('b', 4, 0),
      { id: 's', type: 'segment', parents: ['a', 'b'], params: {} },
      { id: 'l', type: 'line', parents: ['a', 'b'], params: {} },
      { id: 'c', type: 'circle.centerPoint', parents: ['a', 'b'], params: {} },
      { id: 'poly', type: 'polygon', parents: ['a', 'b', 't'], params: {} },
      point('t', 4, 4),
    ]);
    const anchors = anchorsOf(doc, computeScene(doc));

    expect(anchors.get('a')).toEqual(V(0, 0));
    expect(anchors.get('s')).toEqual(V(2, 0)); // midpoint
    expect(anchors.get('l')).toEqual(V(0, 0)); // the line's origin point
    expect(anchors.get('c')).toEqual(V(0, 0)); // the centre
    expect(anchors.get('poly')).toEqual(V(8 / 3, 4 / 3)); // centroid
  });

  it('anchors a number at the average of its parents, recursing into a number parent', () => {
    const doc = docOf([
      point('a', 0, 0),
      point('b', 4, 0),
      { id: 's', type: 'segment', parents: ['a', 'b'], params: {} },
      { id: 'n1', type: TEST_NUMBER, parents: ['s'], params: { value: 4 } },
      { id: 'n2', type: TEST_NUMBER, parents: ['n1', 'a'], params: { value: 8 } },
      { id: 'n3', type: TEST_NUMBER, parents: [], params: { value: 1 } },
    ]);
    const anchors = anchorsOf(doc, computeScene(doc));

    expect(anchors.get('n1')).toEqual(V(2, 0)); // its parent segment's midpoint
    expect(anchors.get('n2')).toEqual(V(1, 0)); // average of (segment midpoint, point a)
    expect(anchors.get('n3')).toEqual(V(0, 0)); // no parents at all: the origin
  });

  it('leaves undefined objects out', () => {
    const doc = docOf([
      point('a', 0, 0),
      point('bad', 0, 0, { x: 'nope', y: 0 }),
      { id: 's', type: 'segment', parents: ['a', 'bad'], params: {} },
    ]);
    const scene = computeScene(doc);
    const anchors = anchorsOf(doc, scene);

    expect(scene.undefined.get('s')).toBeDefined();
    expect(anchors.has('s')).toBe(false);
    expect(anchors.has('bad')).toBe(false);
    expect(anchors.get('a')).toEqual(V(0, 0));
  });
});

describe('hitTest', () => {
  it('finds every kind at its own geometry, and nothing anywhere else', () => {
    const doc = docOf([
      point('p', 0, 0),
      point('s0', 10, 0),
      point('s1', 20, 0),
      { id: 's', type: 'segment', parents: ['s0', 's1'], params: {} },
      point('l0', 0, 10),
      point('l1', 1, 10),
      { id: 'l', type: 'line', parents: ['l0', 'l1'], params: {} },
      point('r0', 0, -10),
      point('r1', 1, -10),
      { id: 'r', type: 'ray', parents: ['r0', 'r1'], params: {} },
      point('c0', 30, 0),
      point('c1', 32, 0),
      { id: 'c', type: 'circle.centerPoint', parents: ['c0', 'c1'], params: {} },
      point('q0', 0, 30),
      point('q1', 10, 30),
      point('q2', 10, 40),
      point('q3', 0, 40),
      { id: 'poly', type: 'polygon', parents: ['q0', 'q1', 'q2', 'q3'], params: {} },
      point('na', 60, 0),
      point('nb', 64, 0),
      { id: 'num', type: TEST_NUMBER, parents: ['na', 'nb'], params: { value: 5 } },
    ]);
    const scene = computeScene(doc);
    const anchors = anchorsOf(doc, scene);
    expect(scene.undefined.size).toBe(0);

    const near = (world: Vec2): Id[] => hitTest(scene, world, 0.5, anchors);

    expect(near(V(15, 0))).toContain('s'); // on the segment
    expect(near(V(25, 0))).not.toContain('s'); // past its end: a segment is bounded
    expect(near(V(100, 10))).toContain('l'); // a line is not
    expect(near(V(50, -10))).toContain('r'); // a ray is bounded only behind its origin
    expect(near(V(-3, -10))).not.toContain('r');
    expect(near(V(30, 2))).toContain('c'); // on the ring
    expect(near(V(30, 0))).not.toContain('c'); // the centre is not on the circle
    expect(near(V(5, 30))).toContain('poly'); // an edge
    expect(near(V(0, 40))).toContain('poly'); // a vertex
    expect(near(V(5, 35))).not.toContain('poly'); // the interior is NOT a hit
    expect(near(V(62, 0))).toContain('num'); // a number is hit at its anchor
    expect(hitTest(scene, V(62, 0), 0.5)).not.toContain('num'); // …which needs the anchor map
    expect(hitTest(scene, V(1000, 1000), 1)).toEqual([]);
  });

  it('cannot hit an object that is undefined', () => {
    const scene = sceneOf([
      point('a', 0, 0),
      point('b', 0, 0, { x: Number.NaN, y: 0 }),
      { id: 's', type: 'segment', parents: ['a', 'b'], params: {} },
    ]);
    expect(hitTest(scene, V(0, 0), 5)).toEqual(['a']);
  });
});

describe('computeScene with the path types', () => {
  it('refuses to glue a point to a polygon: only paths take a glued point', () => {
    const objects: ObjRecord[] = [
      point('a', 0, 0),
      point('b', 4, 0),
      point('c', 4, 4),
      { id: 'poly', type: 'polygon', parents: ['a', 'b', 'c'], params: {} },
      { id: 'g', type: 'point.onObject', parents: ['poly'], params: { t: 0.5 } },
    ];
    expect(sceneOf(objects).undefined.get('g')).toBe('需要一个路径对象');
  });

  it('marks a path whose point parent is unusable, and everything downstream', () => {
    const scene = sceneOf([
      point('a', 0, 0),
      point('b', 2, 0, { x: Number.NaN, y: 0 }),
      { id: 's', type: 'segment', parents: ['a', 'b'], params: {} },
      { id: 'g', type: 'point.onObject', parents: ['s'], params: { t: 0.5 } },
      { id: 'poly', type: 'polygon', parents: ['a'], params: {} },
    ]);

    expect([...scene.geoms.keys()]).toEqual(['a']);
    expect(scene.undefined.get('s')).toBe(scene.undefined.get('b'));
    expect(scene.undefined.get('g')).toBe(scene.undefined.get('b'));
    expect(scene.undefined.get('poly')).toBe('多边形至少需要三个点');
  });

  it('follows a drag: moving a parent carries its dependents', () => {
    const objects: ObjRecord[] = [
      point('a', 0, 0),
      point('b', 4, 0),
      { id: 's', type: 'segment', parents: ['a', 'b'], params: {} },
      { id: 'g', type: 'point.onObject', parents: ['s'], params: { t: 0.25 } },
      { id: 'm', type: 'circle.centerRadius', parents: ['g', 'num'], params: {} },
      { id: 'num', type: TEST_NUMBER, parents: [], params: { value: 1.5 } },
    ];
    const before = computeScene(docOf(objects));
    expect(before.geoms.get('g')).toEqual({ kind: 'point', at: V(1, 0) });
    expect(before.geoms.get('m')).toEqual({ kind: 'circle', center: V(1, 0), radius: 1.5 });

    const moved = docOf(objects);
    (moved.objects[0].params as { x: number }).x = 2; // drag point A
    const after = computeScene(moved);
    expect(after.geoms.get('g')).toEqual({ kind: 'point', at: V(2.5, 0) });
    expect(after.geoms.get('m')).toEqual({ kind: 'circle', center: V(2.5, 0), radius: 1.5 });
  });
});
