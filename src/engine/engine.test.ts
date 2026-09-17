import { describe, expect, it } from 'vitest';

import {
  DEFAULT_VIEWPORT,
  computeScene,
  createEmptyDoc,
  hitTest,
  newId,
  registerType,
  type Doc,
  type Id,
  type ObjRecord,
} from './index';

const OFFSET = 'test.offset';

/**
 * A one-parent point type, registered from the test rather than the engine: if
 * this computes, types really are pluggable without touching scene.ts.
 */
function registerOffsetType(): void {
  registerType({
    name: OFFSET,
    title: '测试偏移点',
    parentKinds: [['point']],
    compute(parents, _params, _env) {
      const parent = parents[0];
      if (parent.kind !== 'point') return { reason: 'needs a point parent' };
      return { kind: 'point', at: { x: parent.at.x + 1, y: parent.at.y } };
    },
  });
}

function point(id: Id, x: number, y: number, extra: Partial<ObjRecord> = {}): ObjRecord {
  return { id, type: 'point.free', parents: [], params: { x, y }, ...extra };
}

function docWith(objects: ObjRecord[]): Doc {
  return { ...createEmptyDoc(), objects };
}

describe('createEmptyDoc', () => {
  it('starts empty at the default viewport, with an independent viewport', () => {
    const doc = createEmptyDoc();
    expect(doc).toEqual({ version: 1, viewport: { cx: 0, cy: 0, scale: 64 }, objects: [] });
    expect(DEFAULT_VIEWPORT).toEqual({ cx: 0, cy: 0, scale: 64 });
    expect(computeScene(doc).geoms.size).toBe(0);

    const other = createEmptyDoc();
    expect(other.viewport).not.toBe(doc.viewport);
    doc.viewport.scale = 8;
    expect(other.viewport.scale).toBe(64);
    expect(DEFAULT_VIEWPORT.scale).toBe(64);
  });
});

describe('computeScene', () => {
  it('computes every free point, in document order', () => {
    const doc = docWith([point('a', 0, 0), point('b', 3, 4), point('c', -2, 1.5)]);
    const scene = computeScene(doc);

    expect([...scene.geoms.keys()]).toEqual(['a', 'b', 'c']);
    expect(scene.undefined.size).toBe(0);
    expect(scene.geoms.get('a')).toEqual({ kind: 'point', at: { x: 0, y: 0 } });
    expect(scene.geoms.get('b')).toEqual({ kind: 'point', at: { x: 3, y: 4 } });
    expect(scene.geoms.get('c')).toEqual({ kind: 'point', at: { x: -2, y: 1.5 } });
  });

  it('computes a type registered outside the core', () => {
    registerOffsetType();
    const scene = computeScene(
      docWith([point('p', 2, 3), { id: 'q', type: OFFSET, parents: ['p'], params: null }]),
    );

    expect(scene.undefined.size).toBe(0);
    expect(scene.geoms.get('q')).toEqual({ kind: 'point', at: { x: 3, y: 3 } });
    expect([...scene.geoms.keys()]).toEqual(['p', 'q']);
  });

  it('marks an object whose parent id is absent, and its dependents', () => {
    registerOffsetType();
    const scene = computeScene(
      docWith([
        point('a', 0, 0, { parents: ['ghost'] }),
        { id: 'b', type: OFFSET, parents: ['a'], params: null },
      ]),
    );

    expect(scene.geoms.size).toBe(0);
    expect(scene.undefined.get('a')).toBe('missing parent');
    expect(scene.undefined.get('b')).toBe('missing parent');
    expect(hitTest(scene, { x: 0, y: 0 }, 10)).toEqual([]);
  });

  it('marks an unregistered type by name', () => {
    const scene = computeScene(docWith([{ id: 'x', type: 'circle.magic', parents: [], params: null }]));

    expect(scene.geoms.size).toBe(0);
    expect(scene.undefined.get('x')).toBe('unknown type: circle.magic');
  });

  it('marks every object reached by a cycle', () => {
    registerOffsetType();
    const scene = computeScene(
      docWith([
        { id: 'a', type: OFFSET, parents: ['b'], params: null },
        { id: 'b', type: OFFSET, parents: ['a'], params: null },
        { id: 'self', type: OFFSET, parents: ['self'], params: null },
        { id: 'downstream', type: OFFSET, parents: ['a'], params: null },
      ]),
    );

    expect(scene.geoms.size).toBe(0);
    expect(scene.undefined.get('a')).toBe('cycle');
    expect(scene.undefined.get('b')).toBe('cycle');
    expect(scene.undefined.get('self')).toBe('cycle');
    expect(scene.undefined.get('downstream')).toBe('cycle');
  });

  it('marks a free point with unusable params, naming the bad one', () => {
    const scene = computeScene(
      docWith([
        point('good', 1, 2),
        point('badX', 0, 0, { params: { x: 'two', y: 0 } }),
        point('badY', 0, 0, { params: { x: 0, y: Number.NaN } }),
        point('noParams', 0, 0, { params: null }),
      ]),
    );

    expect([...scene.geoms.keys()]).toEqual(['good']);
    expect(scene.undefined.get('badX')).toMatch(/\bx\b/);
    expect(scene.undefined.get('badY')).toMatch(/\by\b/);
    expect(scene.undefined.get('noParams')).toBeDefined();
  });
});

describe('hitTest', () => {
  it('filters by tolerance, nearest first, last drawn breaking ties', () => {
    const scene = computeScene(
      docWith([point('near', 0.5, 0), point('far', 5, 0), point('edge', 2, 0), point('right', 1, 0), point('left', -1, 0)]),
    );
    const origin = { x: 0, y: 0 };

    expect([...scene.geoms.keys()]).toEqual(['near', 'far', 'edge', 'right', 'left']);
    // `right` and `left` are exactly on the tolerance and equidistant: the later
    // object in the document comes first.
    expect(hitTest(scene, origin, 1)).toEqual(['near', 'left', 'right']);
    expect(hitTest(scene, origin, 2)).toEqual(['near', 'left', 'right', 'edge']);
    expect(hitTest(scene, origin, 0.4)).toEqual([]);
    expect(hitTest(scene, { x: 5, y: 0 }, 0.1)).toEqual(['far']);
    // From (5, 0): far 0, edge 3, right 4, near 4.5, left 6 (out of tolerance).
    expect(hitTest(scene, { x: 5, y: 0 }, 5)).toEqual(['far', 'edge', 'right', 'near']);
  });

  it('prefers a point over the path it lies on when both are hit', () => {
    const scene = computeScene(
      docWith([
        point('a', 0, 0),
        point('b', 4, 0),
        { id: 'seg', type: 'segment', parents: ['a', 'b'], params: {} },
      ]),
    );
    // A tap on the vertex must select the vertex, or dragging a polygon's
    // vertex would be impossible (the segment is equidistant there).
    expect(hitTest(scene, { x: 0, y: 0 }, 0.5)[0]).toBe('a');
    // Mid-segment stays reachable: no point is within tolerance there.
    expect(hitTest(scene, { x: 2, y: 0 }, 0.5)).toEqual(['seg']);
  });
});

describe('document JSON round-trip', () => {
  it('survives stringify/parse deep-equal, including style, label and axes', () => {
    const doc: Doc = {
      version: 1,
      viewport: { cx: 12, cy: -4, scale: 80 },
      axes: {
        id: 'axes-1',
        type: 'axes.default',
        parents: [],
        params: { unit: 1 },
        style: { stroke: '#888888', strokeWidth: 1, dash: [] },
      },
      objects: [
        point('p1', 1, 2, {
          style: { stroke: '#123456', strokeWidth: 2, dash: [4, 2], hollow: true, pointSize: 6, fill: '#cccccc' },
          label: { text: 'A', dx: 6, dy: -6, size: 14, color: '#ff0000' },
        }),
        { id: 'p2', type: OFFSET, parents: ['p1'], params: {} },
      ],
    };

    const parsed = JSON.parse(JSON.stringify(doc)) as Doc;
    expect(parsed).toStrictEqual(doc);

    registerOffsetType();
    const scene = computeScene(parsed);
    expect([...scene.geoms.keys()]).toEqual(['p1', 'p2']);
    expect(scene.geoms.get('p2')).toEqual({ kind: 'point', at: { x: 2, y: 2 } });
  });

  it('mints distinct ids that are JSON-safe', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newId()));

    expect(ids.size).toBe(200);
    for (const id of ids) expect(JSON.parse(JSON.stringify(id))).toBe(id);
  });
});
