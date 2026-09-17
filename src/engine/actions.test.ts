import { describe, expect, it } from 'vitest';

import {
  computeScene,
  createEmptyDoc,
  type Doc,
  type Id,
  type Json,
  type ObjRecord,
  type Scene,
} from './index';
import { actionsFor, nextStepHint, type Action } from './actions';

function freePoint(id: Id, x: number, y: number, label?: string): ObjRecord {
  const rec: ObjRecord = { id, type: 'point.free', parents: [], params: { x, y } };
  if (label !== undefined) rec.label = { text: label };
  return rec;
}

function derived(id: Id, type: string, parents: Id[], params: Json = {}): ObjRecord {
  return { id, type, parents, params };
}

/** A document plus its computed scene — the two inputs `actionsFor` takes. */
function board(objects: ObjRecord[]): { doc: Doc; scene: Scene } {
  const doc: Doc = { ...createEmptyDoc(), objects };
  return { doc, scene: computeScene(doc) };
}

function ids(actions: Action[]): string[] {
  return actions.map((action) => action.id);
}

function actionOf(actions: Action[], id: string): Action {
  const found = actions.find((action) => action.id === id);
  if (found === undefined) throw new Error(`no action "${id}" in [${ids(actions).join(', ')}]`);
  return found;
}

function titleOf(doc: Doc, scene: Scene, selection: Id[], id: string): string {
  return actionOf(actionsFor(doc, scene, selection), id).title;
}

/** Two free points, plus the segment, circle and distance they determine. */
function canonical(): { doc: Doc; scene: Scene } {
  return board([
    freePoint('A', 0, 0, 'A'),
    freePoint('B', 2, 0, 'B'),
    derived('s1', 'segment', ['A', 'B']),
    derived('c1', 'circle.centerPoint', ['A', 'B']),
    derived('d1', 'measure.distance', ['A', 'B']),
  ]);
}

function polygonBoard(): { doc: Doc; scene: Scene } {
  return board([
    freePoint('P', 0, 0),
    freePoint('Q', 2, 0),
    freePoint('R', 2, 2),
    derived('poly', 'polygon', ['P', 'Q', 'R']),
  ]);
}

describe('actionsFor', () => {
  it('offers exactly the constructions two points determine', () => {
    const { doc, scene } = canonical();
    const actions = ids(actionsFor(doc, scene, ['A', 'B']));
    for (const id of [
      'segment:0',
      'line:0',
      'ray:0',
      'circle.centerPoint:0',
      'midpoint:0',
      'measure.distance:0',
    ]) {
      expect(actions).toContain(id);
    }
    // Nothing that needs a path, a third point or a number.
    for (const id of [
      'perpendicular:0',
      'parallel:0',
      'point.onObject:0',
      'angleBisector:0',
      'polygon:0',
      'intersection:0',
      'circle.centerRadius:0',
    ]) {
      expect(actions).not.toContain(id);
    }
    expect(new Set(actions).size).toBe(actions.length);
  });

  it('reads the selection in click order', () => {
    const { doc, scene } = canonical();
    // Strict arity: two selected objects can only match two-slot signatures, so
    // the point of `[point, path]` is the point the line must pass through.
    expect(new Set(ids(actionsFor(doc, scene, ['A', 's1'])))).toEqual(
      new Set(['perpendicular:0', 'parallel:0']),
    );
    expect(ids(actionsFor(doc, scene, ['s1', 'A']))).not.toContain('perpendicular:0');
    // A point on an object is built from the object alone.
    expect(ids(actionsFor(doc, scene, ['s1']))).toContain('point.onObject:0');
  });

  it('offers the angle, the readout and the polygon three points determine', () => {
    const { doc, scene } = board([
      freePoint('A', 0, 0),
      freePoint('B', 2, 0),
      freePoint('C', 2, 2),
    ]);
    const actions = ids(actionsFor(doc, scene, ['A', 'B', 'C']));
    expect(actions).toContain('angleBisector:0');
    expect(actions).toContain('measure.angle:0');
    expect(actions).toContain('polygon:0');
    expect(actions).not.toContain('segment:0');
  });

  it('reads the three-point polygon signature as "three or more" — one action', () => {
    const { doc, scene } = board([
      freePoint('P1', 0, 0),
      freePoint('P2', 4, 0),
      freePoint('P3', 4, 3),
      freePoint('P4', 0, 3),
      freePoint('P5', 2, -2),
    ]);
    const selection = ['P1', 'P2', 'P3', 'P4', 'P5'];
    const actions = actionsFor(doc, scene, selection);
    expect(ids(actions).filter((id) => id === 'polygon:0')).toHaveLength(1);

    const created = actionOf(actions, 'polygon:0').apply(doc, selection);
    expect(created.created[0].parents).toEqual(selection);
    expect(created.created[0].params).toEqual({});
  });

  it('offers intersection for two paths, but not for two points', () => {
    const { doc, scene } = board([
      freePoint('A', 0, 0),
      freePoint('B', 2, 0),
      freePoint('C', 2, 2),
      derived('s1', 'segment', ['A', 'B']),
      derived('s2', 'segment', ['B', 'C']),
    ]);
    const paths = ids(actionsFor(doc, scene, ['s1', 's2']));
    expect(paths).toContain('intersection:0');
    expect(paths).not.toContain('segment:0');
  });

  it('matches the circle-by-radius signature against a number parent', () => {
    const { doc, scene } = canonical();
    const actions = ids(actionsFor(doc, scene, ['A', 'd1']));
    expect(actions).toContain('circle.centerRadius:0');
    expect(actions).not.toContain('circle.centerPoint:0');
  });

  it('matches both signatures of a type accepting different parents at one arity', () => {
    const polygon = polygonBoard();
    expect(ids(actionsFor(polygon.doc, polygon.scene, ['poly']))).toContain('measure.area:0');
    const { doc, scene } = canonical();
    expect(ids(actionsFor(doc, scene, ['c1']))).toContain('measure.area:1');
  });

  it('disambiguates a type whose signatures share a title', () => {
    const { doc, scene } = canonical();
    const byPoint = titleOf(doc, scene, ['A', 'B'], 'circle.centerPoint:0');
    const byRadius = titleOf(doc, scene, ['A', 'd1'], 'circle.centerRadius:0');
    expect(byPoint).not.toBe(byRadius);
    expect(byPoint).toContain('圆');
    expect(byRadius).toContain('圆');

    const polygon = polygonBoard();
    const byPolygon = titleOf(polygon.doc, polygon.scene, ['poly'], 'measure.area:0');
    const byCircle = titleOf(doc, scene, ['c1'], 'measure.area:1');
    expect(byPolygon).not.toBe(byCircle);
  });

  it('collapses duplicate ids and refuses unknown, undefined or empty selections', () => {
    const { doc, scene } = canonical();
    expect(ids(actionsFor(doc, scene, ['A', 'A', 'B']))).toContain('segment:0');
    expect(actionsFor(doc, scene, ['A', 'B', 'ghost'])).toEqual([]);
    expect(actionsFor(doc, scene, [])).toEqual([]);
    expect(actionsFor(doc, scene, ['A'])).toEqual([]);

    // Two parallel segments intersect nowhere: the intersection is undefined and
    // has no kind left to match a signature against.
    const parallel = board([
      freePoint('A', 0, 0),
      freePoint('B', 2, 0),
      freePoint('C', 0, 1),
      freePoint('D', 2, 1),
      derived('s1', 'segment', ['A', 'B']),
      derived('s2', 'segment', ['C', 'D']),
      derived('x', 'intersection', ['s1', 's2'], { branch: 0 }),
    ]);
    expect(parallel.scene.undefined.has('x')).toBe(true);
    expect(actionsFor(parallel.doc, parallel.scene, ['x'])).toEqual([]);
  });

  it('orders constructions before readouts', () => {
    const { doc, scene } = canonical();
    const rank: Record<string, number> = { 构造: 0, 测量: 1, 变换: 2 };
    const groups = actionsFor(doc, scene, ['A', 'B']).map((action) => rank[action.group ?? '构造']);
    expect(groups).toEqual([...groups].sort((a, b) => a - b));
  });
});

describe('nextStepHint', () => {
  it('names the one object that would unlock something', () => {
    const { doc, scene } = canonical();
    expect(nextStepHint(doc, scene, ['A'])).toContain('线段');
  });

  it('says nothing once the selection builds something, or is a dead end', () => {
    const { doc, scene } = canonical();
    expect(nextStepHint(doc, scene, ['A', 'B'])).toBeUndefined();
    expect(nextStepHint(doc, scene, ['A', 's1'])).toBeUndefined();
    expect(nextStepHint(doc, scene, [])).toBeUndefined();
    expect(nextStepHint(doc, scene, ['A', 'B', 'C', 's1'])).toBeUndefined();
  });
});

describe('Action.apply', () => {
  it('builds a well-formed record and leaves the document untouched', () => {
    const { doc, scene } = canonical();
    const before = JSON.stringify(doc);
    const { created, select } = actionOf(actionsFor(doc, scene, ['A', 'B']), 'midpoint:0').apply(
      doc,
      ['A', 'B'],
    );

    expect(created).toHaveLength(1);
    const record = created[0];
    expect(record.type).toBe('midpoint');
    expect(record.parents).toEqual(['A', 'B']);
    expect(record.params).toEqual({});
    expect(record.id.length).toBeGreaterThan(0);
    expect(select).toEqual([record.id]);
    expect(JSON.stringify(doc)).toBe(before);
    expect(doc.objects).toHaveLength(5);
  });

  it('starts a point-on-object mid-segment and at the origin elsewhere', () => {
    const { doc, scene } = board([
      freePoint('A', 0, 0),
      freePoint('B', 2, 0),
      derived('s1', 'segment', ['A', 'B']),
      derived('l1', 'line', ['A', 'B']),
      derived('c1', 'circle.centerPoint', ['A', 'B']),
    ]);
    for (const [parent, t] of [
      ['s1', 0.5],
      ['l1', 0],
      ['c1', 0],
    ] as const) {
      const applied = actionOf(actionsFor(doc, scene, [parent]), 'point.onObject:0').apply(doc, [
        parent,
      ]);
      expect(applied.created[0].params).toEqual({ t });
      expect(applied.created[0].parents).toEqual([parent]);
    }
  });

  it('starts an intersection on branch 0', () => {
    const { doc, scene } = board([
      freePoint('A', 0, 0),
      freePoint('B', 2, 0),
      freePoint('C', 2, 2),
      derived('s1', 'segment', ['A', 'B']),
      derived('s2', 'segment', ['B', 'C']),
    ]);
    const applied = actionOf(actionsFor(doc, scene, ['s1', 's2']), 'intersection:0').apply(doc, [
      's1',
      's2',
    ]);
    expect(applied.created[0].params).toEqual({ branch: 0 });
  });

  it('mints a distinct id per created object', () => {
    const { doc, scene } = canonical();
    const action = actionOf(actionsFor(doc, scene, ['A', 'B']), 'segment:0');
    const first = action.apply(doc, ['A', 'B']).created[0];
    const second = action.apply(doc, ['A', 'B']).created[0];
    expect(first.id).not.toBe(second.id);
  });

  it('builds nothing from a selection that no longer fits the signature', () => {
    const { doc, scene } = canonical();
    const segment = actionOf(actionsFor(doc, scene, ['A', 'B']), 'segment:0');
    expect(segment.apply(doc, ['A']).created).toEqual([]);
    expect(segment.apply(doc, ['A', 'B', 'C']).created).toEqual([]);
  });
});
