/**
 * Tests for wave A's two positional geometry kinds and the constructions that
 * produce them (scene.ts `Geometry`, objects/arcs.ts, objects/text.ts).
 *
 * As everywhere in the engine, the oracle is a *property* rather than the
 * arithmetic the implementation happens to perform (DESIGN.md §7): an arc must
 * contain its parents and sweep counter-clockwise, a circumcentre must be
 * equidistant from all three of them, and a hit test must be right on the swept
 * part of an arc and wrong on the unused part of the same circle. Degeneracy is
 * asserted by the reason string the chip shows (D9), never by "it throws".
 */
import { describe, expect, it } from 'vitest';

import { isUndefined, registerType, registry } from './registry';
import type { Env, Undefined } from './registry';
import { anchorsOf, computeScene, createEmptyDoc, hitTest } from './scene';
import type { Geometry } from './scene';
import type { Doc, Id, Json, ObjRecord, Vec2 } from './types';
import { dist } from './kernel/vec2';
import './objects/point-free';
import './objects/paths';
import './objects/arcs';
import './objects/text';

const ENV: Env = { scale: 64 };
const TWO_PI = Math.PI * 2;

type Arc = Extract<Geometry, { kind: 'arc' }>;

const V = (x: number, y: number): Vec2 => ({ x, y });
const P = (x: number, y: number): Geometry => ({ kind: 'point', at: V(x, y) });
const circle = (cx: number, cy: number, radius: number): Geometry => ({
  kind: 'circle',
  center: V(cx, cy),
  radius,
});

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

function reasonOf(name: string, parents: Geometry[], params: Json = null): string {
  const result = compute(name, parents, params);
  if (!isUndefined(result)) {
    throw new Error(`${name} unexpectedly defined: ${JSON.stringify(result)}`);
  }
  return result.reason;
}

function arcOf(geometry: Geometry): Arc {
  if (geometry.kind !== 'arc') throw new Error(`not an arc: ${geometry.kind}`);
  return geometry;
}

function circleOf(geometry: Geometry): Extract<Geometry, { kind: 'circle' }> {
  if (geometry.kind !== 'circle') throw new Error(`not a circle: ${geometry.kind}`);
  return geometry;
}

function textOf(geometry: Geometry): Extract<Geometry, { kind: 'text' }> {
  if (geometry.kind !== 'text') throw new Error(`not a text: ${geometry.kind}`);
  return geometry;
}

/** The point on `arc`'s circle at `angle` — where the arc would be if it reached there. */
function pointOnArc(arc: Arc, angle: number): Vec2 {
  return V(arc.center.x + arc.radius * Math.cos(angle), arc.center.y + arc.radius * Math.sin(angle));
}

/** `angle − from` folded into `[0, 2π)`: 0 exactly when the two coincide. */
function relAngle(from: number, angle: number): number {
  return ((angle - from) % TWO_PI + TWO_PI) % TWO_PI;
}

/** The counter-clockwise sweep from `from` to `to`, per the frozen `(0, 2π]` contract. */
function expectedSweep(from: number, to: number): number {
  const sweep = relAngle(from, to);
  return sweep === 0 ? TWO_PI : sweep;
}

/** The angle between two directions, ignoring a full turn: 0 for equal directions. */
function angleDistance(first: number, second: number): number {
  const delta = relAngle(first, second);
  return Math.min(delta, TWO_PI - delta);
}

/**
 * Does the arc's swept part reach the point at `angle`? An angle equal to
 * `from` up to float noise folds to a full turn rather than to zero, and a full
 * turn away is the *same direction* — on the arc, not off it.
 */
function arcReaches(arc: Arc, angle: number): boolean {
  if (angleDistance(arc.from, angle) < 1e-12) return true;
  return relAngle(arc.from, angle) <= relAngle(arc.from, arc.to) + 1e-12;
}

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

function pointObject(id: Id, x: number, y: number): ObjRecord {
  return { id, type: 'point.free', parents: [], params: { x, y } };
}

function docWith(objects: ObjRecord[]): Doc {
  return { ...createEmptyDoc(), objects };
}

const ARC_START = 'test.arcStart';

/**
 * A one-parent type registered from the test rather than the engine: the point
 * at the start of an arc. It exists to prove that an undefined arc propagates
 * its own reason into a *dependent point* (the shape wave B's point-on-arc will
 * have) without inventing engine behaviour wave A did not ask for.
 */
registerType({
  name: ARC_START,
  title: '弧起点',
  parentKinds: [['arc']],
  compute(parents) {
    const arc = parents[0];
    if (arc.kind !== 'arc') return { reason: 'bad parents: expected an arc' };
    return {
      kind: 'point',
      at: {
        x: arc.center.x + arc.radius * Math.cos(arc.from),
        y: arc.center.y + arc.radius * Math.sin(arc.from),
      },
    };
  },
});

describe('arc.onCircle', () => {
  it('is registered with the title and parent kinds the menu reads', () => {
    expect(registry.get('arc.onCircle')?.title).toBe('圆上的弧');
    expect(registry.get('arc.onCircle')?.parentKinds).toEqual([['circle', 'point', 'point']]);
  });

  it('sweeps counter-clockwise from the first parent to the second', () => {
    const quarter = arcOf(defined('arc.onCircle', [circle(0, 0, 2), P(2, 0), P(0, 2)]));
    expect(quarter.center).toEqual({ x: 0, y: 0 });
    expect(quarter.radius).toBe(2);
    expect(quarter.from).toBeCloseTo(0, 12);
    expect(quarter.to - quarter.from).toBeCloseTo(Math.PI / 2, 12);

    // The same two points the other way round are the *other* arc: a quarter
    // turn is not an equivalence class.
    const rest = arcOf(defined('arc.onCircle', [circle(0, 0, 2), P(0, 2), P(2, 0)]));
    expect(rest.from).toBeCloseTo(Math.PI / 2, 12);
    expect(rest.to - rest.from).toBeCloseTo((3 * Math.PI) / 2, 12);
  });

  it('normalises every endpoint pair into a sweep in (0, 2π]', () => {
    const values = seededValues(20260919, 800);
    for (let i = 0; i + 5 < values.length; i += 6) {
      const first = values[i];
      const second = values[i + 3];
      const from = V(3 * Math.cos(first), 3 * Math.sin(first));
      const to = V(3 * Math.cos(second), 3 * Math.sin(second));
      const arc = arcOf(defined('arc.onCircle', [circle(0, 0, 3), P(from.x, from.y), P(to.x, to.y)]));

      expect(arc.center).toEqual({ x: 0, y: 0 });
      expect(arc.radius).toBe(3);
      // `to − from` is the sweep, straight out of the frozen contract...
      expect(arc.to - arc.from).toBeGreaterThan(0);
      expect(arc.to - arc.from).toBeLessThanOrEqual(TWO_PI + 1e-12);
      // ...and it is the counter-clockwise one, computed here independently.
      expect(arc.to - arc.from).toBeCloseTo(expectedSweep(first, second), 9);
      // The two endpoints are exactly the parent points, which sit on the circle.
      expect(dist(pointOnArc(arc, arc.from), from)).toBeLessThan(1e-9);
      expect(dist(pointOnArc(arc, arc.to), to)).toBeLessThan(1e-9);
      expect(arcReaches(arc, first)).toBe(true);
      expect(arcReaches(arc, second)).toBe(true);
    }
  });

  it('projects an endpoint that is not on the circle radially onto it', () => {
    const projected = arcOf(defined('arc.onCircle', [circle(0, 0, 2), P(4, 0), P(0, 7)]));
    const exact = arcOf(defined('arc.onCircle', [circle(0, 0, 2), P(2, 0), P(0, 2)]));
    expect(projected).toEqual(exact);
    // A point inside the circle still names an angle, which is the whole reason
    // the projection is radial rather than a rejection.
    expect(arcOf(defined('arc.onCircle', [circle(0, 0, 2), P(1, 0), P(0, 0.5)]))).toEqual(exact);
  });

  it('reports why it cannot be built', () => {
    expect(reasonOf('arc.onCircle', [circle(0, 0, 0), P(1, 0), P(0, 1)])).toBe('半径为零');
    // Two points on the same ray share one endpoint, wherever they sit on it.
    expect(reasonOf('arc.onCircle', [circle(0, 0, 2), P(2, 0), P(3, 0)])).toBe('弧的端点重合');
    expect(reasonOf('arc.onCircle', [circle(0, 0, 2), P(2, 0), P(2, 0)])).toBe('弧的端点重合');
    expect(reasonOf('arc.onCircle', [circle(0, 0, 2), P(0, 0), P(0, 2)])).toBe('点在圆心上');
    expect(reasonOf('arc.onCircle', [circle(0, 0, 2), P(Number.NaN, 0), P(0, 2)])).toBe('非有限坐标');
    expect(reasonOf('arc.onCircle', [circle(0, 0, Number.POSITIVE_INFINITY), P(1, 0), P(0, 1)])).toBe(
      '非有限坐标',
    );
    expect(reasonOf('arc.onCircle', [circle(0, 0, 2), P(1, 0)])).toMatch(/bad parents/);
    expect(reasonOf('arc.onCircle', [P(1, 0), P(1, 0), P(0, 1)])).toMatch(/bad parents/);
  });
});

describe('arc.through3', () => {
  it('is registered with the title and parent kinds the menu reads', () => {
    expect(registry.get('arc.through3')?.title).toBe('三点弧');
    expect(registry.get('arc.through3')?.parentKinds).toEqual([['point', 'point', 'point']]);
  });

  it('runs from the first parent through the second to the third', () => {
    const upper = arcOf(defined('arc.through3', [P(1, 0), P(0, 1), P(-1, 0)]));
    expect(upper.center.x).toBeCloseTo(0, 12);
    expect(upper.center.y).toBeCloseTo(0, 12);
    expect(upper.radius).toBeCloseTo(1, 12);
    expect(upper.to - upper.from).toBeCloseTo(Math.PI, 12);
    expect(arcReaches(upper, Math.PI / 2)).toBe(true);
    expect(arcReaches(upper, -Math.PI / 2)).toBe(false);

    // Same three points, middle one below: the arc cannot be the upper half.
    const lower = arcOf(defined('arc.through3', [P(1, 0), P(0, -1), P(-1, 0)]));
    expect(arcReaches(lower, -Math.PI / 2)).toBe(true);
    expect(arcReaches(lower, Math.PI / 2)).toBe(false);
    expect(lower.to - lower.from).toBeCloseTo(Math.PI, 12);
    expect(dist(lower.center, V(-1, 0))).toBeCloseTo(1, 12);
  });

  it('contains all three parents, with the middle one strictly inside', () => {
    // Twelve evenly spaced points on one circle: every ordered triple is a
    // distinct configuration, and each must produce an arc that all three
    // parents lie on, whose ends are the two outer parents.
    const center = V(-1, 2.5);
    const radius = 4;
    const step = Math.PI / 6;
    for (let i = 0; i < 12; i++) {
      for (let j = 0; j < 12; j++) {
        if (j === i) continue;
        for (let k = 0; k < 12; k++) {
          if (k === i || k === j) continue;
          const angles = [i * step, j * step, k * step];
          const parents = angles.map((angle) =>
            P(center.x + radius * Math.cos(angle), center.y + radius * Math.sin(angle)),
          );
          const arc = arcOf(defined('arc.through3', parents));

          expect(dist(arc.center, center)).toBeLessThan(1e-9);
          expect(arc.radius).toBeCloseTo(radius, 9);
          for (const angle of angles) {
            expect(
              arcReaches(arc, angle),
              `i=${i} j=${j} k=${k} angles=${JSON.stringify(angles)} from=${arc.from} to=${arc.to} angle=${angle}`,
            ).toBe(true);
          }
          const sweep = relAngle(arc.from, arc.to);
          expect(relAngle(arc.from, angles[1])).toBeGreaterThan(0);
          expect(relAngle(arc.from, angles[1])).toBeLessThan(sweep);
          // The endpoints are the outer two parents, whatever the order.
          const endpoints = [arc.from, arc.to];
          for (const angle of [angles[0], angles[2]]) {
            const matched = endpoints.some((endpoint) => angleDistance(endpoint, angle) < 1e-9);
            expect(
              matched,
              `i=${i} j=${j} k=${k} angles=${JSON.stringify(angles)} from=${arc.from} to=${arc.to} endpoints=${JSON.stringify(endpoints)}`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it('reports why it cannot be built', () => {
    expect(reasonOf('arc.through3', [P(0, 0), P(1, 1), P(2, 2)])).toBe('三点共线');
    expect(reasonOf('arc.through3', [P(3, -1), P(3, -1), P(5, 2)])).toBe('三点共线');
    expect(reasonOf('arc.through3', [P(2, 2), P(2, 2), P(2, 2)])).toBe('三点共线');
    expect(reasonOf('arc.through3', [P(0, 0), P(1, 1), P(Number.NaN, 2)])).toBe('非有限坐标');
    expect(reasonOf('arc.through3', [P(0, 0), P(1, 1)])).toMatch(/bad parents/);
    expect(reasonOf('arc.through3', [P(0, 0), P(1, 1), circle(0, 0, 1)])).toMatch(/bad parents/);
  });

  it('is deterministic for identical inputs', () => {
    const parents = [P(1.5, -2), P(4, 0.5), P(-1, 3)];
    const clone = JSON.parse(JSON.stringify(parents)) as Geometry[];
    expect(compute('arc.through3', parents)).toEqual(compute('arc.through3', clone));
  });
});

describe('circle.through3', () => {
  it('is registered with the title and parent kinds the menu reads', () => {
    expect(registry.get('circle.through3')?.title).toBe('圆(三点)');
    expect(registry.get('circle.through3')?.parentKinds).toEqual([['point', 'point', 'point']]);
  });

  it('is the circumcircle of its three parents', () => {
    const circum = circleOf(defined('circle.through3', [P(0, 0), P(4, 0), P(0, 2)]));
    expect(circum.center.x).toBeCloseTo(2, 9);
    expect(circum.center.y).toBeCloseTo(1, 9);
    expect(circum.radius).toBeCloseTo(Math.sqrt(5), 9);
  });

  it('is equidistant from all three parents over a seeded sweep', () => {
    const values = seededValues(424242, 600);
    let circumscribed = 0;
    for (let i = 0; i + 5 < values.length; i += 6) {
      const parents = [V(values[i], values[i + 1]), V(values[i + 2], values[i + 3]), V(values[i + 4], values[i + 5])];
      const result = compute('circle.through3', parents.map((point) => P(point.x, point.y)));
      // Three near-collinear points genuinely have no circumcentre (the usual
      // relative epsilon rejects them); the reasons test below pins that.
      if (isUndefined(result)) continue;
      circumscribed += 1;
      const circum = circleOf(result);
      for (const point of parents) {
        expect(Math.abs(dist(circum.center, point) - circum.radius)).toBeLessThan(1e-9 * (1 + circum.radius));
      }
    }
    expect(circumscribed).toBeGreaterThan(90);
  });

  it('reports why it cannot be built', () => {
    expect(reasonOf('circle.through3', [P(0, 0), P(1, 1), P(2, 2)])).toBe('三点共线');
    expect(reasonOf('circle.through3', [P(-1, 4), P(-1, 4), P(0, 0)])).toBe('三点共线');
    expect(reasonOf('circle.through3', [P(0, 0), P(0, 0), P(0, 0)])).toBe('三点共线');
    expect(reasonOf('circle.through3', [P(0, 0), P(1, 0), P(0, Number.POSITIVE_INFINITY)])).toBe('非有限坐标');
    expect(reasonOf('circle.through3', [P(0, 0)])).toMatch(/bad parents/);
    expect(reasonOf('circle.through3', [P(0, 0), P(1, 0), { kind: 'text', at: V(0, 0), text: 'x' }])).toMatch(
      /bad parents/,
    );
  });
});

describe('text.free', () => {
  it('is registered with the title the 文本 tool reads', () => {
    expect(registry.get('text.free')?.title).toBe('文本');
    // Defined by nothing: a text is made by the tool, never built from a
    // selection, exactly like `point.free`.
    expect(registry.get('text.free')?.parentKinds).toEqual([[]]);
  });

  it('carries its own string and anchor', () => {
    const text = textOf(defined('text.free', [], { x: 1.5, y: -2, text: '∠ABC = 60°' }));
    expect(text).toEqual({ kind: 'text', at: { x: 1.5, y: -2 }, text: '∠ABC = 60°' });
    // An empty string is a label the user has not typed into yet, not a failure.
    expect(textOf(defined('text.free', [], { x: 0, y: 0, text: '' })).text).toBe('');
  });

  it('reports why it cannot be built', () => {
    expect(reasonOf('text.free', [], { x: 0, y: 0, text: 5 })).toBe('文本内容无效');
    expect(reasonOf('text.free', [], { x: 0, y: 0 })).toBe('文本内容无效');
    expect(reasonOf('text.free', [], null)).toBe('非有限坐标');
    expect(reasonOf('text.free', [], { x: Number.NaN, y: 0, text: 'ok' })).toBe('非有限坐标');
    expect(reasonOf('text.free', [], { x: 0, y: Number.POSITIVE_INFINITY, text: 'ok' })).toBe('非有限坐标');
  });
});

describe('scene integration', () => {
  /** Two free points, the circle through them, and the arc of it from 0° to 90°. */
  function arcDoc(): Doc {
    return docWith([
      pointObject('o', 0, 0),
      pointObject('a', 1, 0),
      { id: 'c', type: 'circle.centerPoint', parents: ['o', 'a'], params: {} },
      pointObject('p', 1, 0),
      pointObject('q', 0, 1),
      { id: 'arc', type: 'arc.onCircle', parents: ['c', 'p', 'q'], params: {} },
      { id: 'label', type: 'text.free', parents: [], params: { x: -2, y: -2, text: '弧 AB' } },
    ]);
  }

  it('computes both new kinds and anchors them at the centre and the anchor', () => {
    const doc = arcDoc();
    const scene = computeScene(doc);

    expect(scene.undefined.size).toBe(0);
    expect(scene.geoms.get('arc')).toEqual({
      kind: 'arc',
      center: V(0, 0),
      radius: 1,
      from: 0,
      to: Math.PI / 2,
    });

    const anchors = anchorsOf(doc, scene);
    expect(anchors.get('arc')).toEqual(V(0, 0));
    expect(anchors.get('label')).toEqual(V(-2, -2));
  });

  it('hits the swept part of an arc and nothing else on the same circle', () => {
    const scene = computeScene(arcDoc());
    const near = (world: Vec2, tol = 0.1): Id[] => hitTest(scene, world, tol);

    // 45°: on the swept part.
    expect(near(V(Math.SQRT1_2, Math.SQRT1_2))).toContain('arc');
    // 180° and 270°: on the same circle, off the arc — and far beyond the
    // tolerance of its endpoints, so the arc must not be reported at all.
    expect(near(V(-1, 0))).not.toContain('arc');
    expect(near(V(0, -1))).not.toContain('arc');
    // Neither a chord of the arc nor the wedge's interior is the arc.
    expect(near(V(0.7, 0))).not.toContain('arc');
    // Just below 0°: off the sweep, but within tolerance of its start endpoint.
    expect(near(V(Math.cos(-0.05), Math.sin(-0.05)))).toContain('arc');
    expect(hitTest(scene, V(-1, 0), 1e-6)).not.toContain('arc');
  });

  it('hits a text at its anchor, and lets a point at that anchor win the tie', () => {
    const doc = docWith([
      pointObject('p', 2, 3),
      { id: 'onPoint', type: 'text.free', parents: [], params: { x: 2, y: 3, text: 'A' } },
      { id: 'free', type: 'text.free', parents: [], params: { x: 5, y: 3, text: 'B' } },
    ]);
    const scene = computeScene(doc);

    expect(scene.undefined.size).toBe(0);
    // A text needs no anchor map: unlike a `number`, its anchor is its own.
    expect(hitTest(scene, V(2, 3), 0.5)).toEqual(['p', 'onPoint']);
    expect(hitTest(scene, V(5, 3), 0.5)).toEqual(['free']);
    expect(hitTest(scene, V(5.3, 3), 0.5)).toEqual(['free']);
    expect(hitTest(scene, V(5.6, 3), 0.5)).toEqual([]);
  });

  it('propagates an undefined arc into a dependent point, and back out again', () => {
    const build = (qx: number, qy: number): Doc =>
      docWith([
        pointObject('o', 0, 0),
        pointObject('a', 2, 0),
        { id: 'c', type: 'circle.centerPoint', parents: ['o', 'a'], params: {} },
        pointObject('p', 2, 0),
        pointObject('q', qx, qy),
        { id: 'arc', type: 'arc.onCircle', parents: ['c', 'p', 'q'], params: {} },
        { id: ARC_START, type: ARC_START, parents: ['arc'], params: null },
      ]);

    // q on the same ray as p: the endpoints coincide, so the arc — and the point
    // defined by it — carry the arc's own reason, not "parent undefined".
    const collapsed = computeScene(build(3, 0));
    expect(collapsed.undefined.get('arc')).toBe('弧的端点重合');
    expect(collapsed.undefined.get(ARC_START)).toBe('弧的端点重合');
    expect(collapsed.geoms.has(ARC_START)).toBe(false);
    expect(hitTest(collapsed, V(2, 0), 0.5)).not.toContain(ARC_START);

    // Dragging q away is all it takes: the dependent point returns at the arc's
    // start endpoint (D9 "auto-return to defined is silent").
    const recovered = computeScene(build(0, 2));
    expect(recovered.undefined.size).toBe(0);
    expect(recovered.geoms.get(ARC_START)).toEqual({ kind: 'point', at: V(2, 0) });
  });

  it('skips display-hidden objects when the hidden set is passed', () => {
    const scene = computeScene(arcDoc());
    const hidden = new Set<Id>(['arc']);
    const atStart = V(1, 0);

    expect(hitTest(scene, atStart, 0.1)).toContain('arc');
    expect(hitTest(scene, atStart, 0.1, undefined, new Set())).toContain('arc');
    const withoutArc = hitTest(scene, atStart, 0.1, undefined, hidden);
    expect(withoutArc).not.toContain('arc');
    // Hiding is per object: everything else stays tappable.
    expect(withoutArc).toContain('p');
  });
});
