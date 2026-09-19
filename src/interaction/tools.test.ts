/**
 * The palette's click semantics, tool by tool: a click sequence in, a reduction
 * out. The harness drives the reducer exactly as the board does — hits come from
 * `hitTest` at the pointer's tolerance, and each click's `created` records are
 * appended to the document before the next click, so a sequence sees the figure
 * the teacher would see.
 */
import { describe, expect, it } from 'vitest';
import type { Tool } from '../app/store';
import {
  anchorsOf,
  computeScene,
  createEmptyDoc,
  hitTest,
  type Doc,
  type Id,
  type ObjRecord,
  type Scene,
  type Vec2,
} from '../engine';
import {
  emptyPending,
  finishPending,
  pendingCount,
  reduceClick,
  textRecord,
  type PendingState,
  type Reduction,
} from './tools';

/** 10 px at the default viewport scale of 64 — the touch tolerance. */
const TOL = 10 / 64;

interface Board {
  doc: Doc;
  scene: Scene;
  pending: PendingState;
}

function start(objects: ObjRecord[], tool: Tool): Board {
  // Copied, so a test's fixture cannot leak into the next one through the
  // harness pushing created records into the document's array.
  const doc: Doc = {
    ...createEmptyDoc(),
    objects: objects.map((rec) => ({ ...rec, parents: [...rec.parents] })),
  };
  return { doc, scene: computeScene(doc), pending: emptyPending(tool) };
}

function refresh(board: Board): void {
  board.scene = computeScene(board.doc);
}

/** The objects under `world`, exactly as `store.pick` gathers them. */
function hitsAt(board: Board, world: Vec2, tolWorld = TOL): Id[] {
  return hitTest(board.scene, world, tolWorld, anchorsOf(board.doc, board.scene));
}

/** One click: reduce, keep the pending state, apply what the board would apply. */
function click(board: Board, world: Vec2): Reduction {
  return clickWith(board, world, hitsAt(board, world));
}

function clickWith(board: Board, world: Vec2, hits: Id[]): Reduction {
  const result = reduceClick(
    { doc: board.doc, scene: board.scene, world, hits },
    board.pending,
  );
  board.pending = result.next;
  if (result.created.length > 0) {
    board.doc.objects.push(...result.created);
    refresh(board);
  }
  return result;
}

function tap(board: Board, x: number, y: number): Reduction {
  return click(board, { x, y });
}

function record(board: Board, type: string): ObjRecord {
  const found = board.doc.objects.filter((o) => o.type === type);
  expect(found).toHaveLength(1);
  return found[0];
}

function types(records: ObjRecord[]): string[] {
  return records.map((r) => r.type);
}

function point(id: string, x: number, y: number): ObjRecord {
  return { id, type: 'point.free', parents: [], params: { x, y } };
}

function segment(id: string, parents: [Id, Id]): ObjRecord {
  return { id, type: 'segment', parents, params: null };
}

function line(id: string, parents: [Id, Id]): ObjRecord {
  return { id, type: 'line', parents, params: null };
}

function square(): ObjRecord[] {
  return [
    point('A', -2, -1),
    point('B', 2, -1),
    point('C', 2, 2),
    point('D', -2, 2),
    { id: 'ABCD', type: 'polygon', parents: ['A', 'B', 'C', 'D'], params: null },
  ];
}

/** Every parent of every created (or existing) record must be in the document. */
function danglingParents(board: Board): Id[] {
  const ids = new Set(board.doc.objects.map((o) => o.id));
  return board.doc.objects
    .flatMap((o) => o.parents)
    .filter((parent) => !ids.has(parent));
}

describe('point tool', () => {
  it('puts a free point on empty space, names it and selects it', () => {
    const board = start([], 'point');
    const result = tap(board, -4, 3);
    expect(types(result.created)).toEqual(['point.free']);
    expect(result.created[0].params).toEqual({ x: -4, y: 3 });
    expect(result.created[0].label?.text).toBe('A');
    expect(result.select).toEqual([result.created[0].id]);
    expect(pendingCount(board.pending)).toBe(0);
  });

  it('glues a point to a path with the click position as its parameter', () => {
    const board = start([point('A', 0, 0), point('B', 4, 0), segment('s', ['A', 'B'])], 'point');
    const result = click(board, { x: 1, y: 0 });
    expect(types(result.created)).toEqual(['point.onObject']);
    expect(result.created[0].parents).toEqual(['s']);
    expect(result.created[0].params).toEqual({ t: 0.25 });
  });

  it('makes nothing of a click on an existing point', () => {
    const board = start([point('A', 1, 1)], 'point');
    const result = click(board, { x: 1, y: 1 });
    expect(result.created).toEqual([]);
    expect(board.doc.objects).toHaveLength(1);
  });

  it('falls back to a free point on an object that is not a path', () => {
    const board = start(square(), 'point');
    const result = tap(board, 0, -1);
    expect(types(result.created)).toEqual(['point.free']);
  });

  it('names a new point with the next free letter', () => {
    const named: ObjRecord = { id: 'A', type: 'point.free', parents: [], params: { x: 0, y: 0 }, label: { text: 'A' } };
    const board = start([named], 'point');
    expect(tap(board, 3, 0).created[0].label?.text).toBe('B');
  });
});

describe('two-point constructions', () => {
  it('makes a segment from two empty clicks, one edit each', () => {
    const board = start([], 'segment');
    const first = tap(board, -2, 0);
    expect(types(first.created)).toEqual(['point.free']);
    expect(board.pending.points).toEqual(first.created.map((r) => r.id));
    expect(board.doc.objects).toHaveLength(1); // the point is real immediately

    const second = tap(board, 2, 1);
    expect(types(second.created)).toEqual(['point.free', 'segment']);
    const created = record(board, 'segment');
    expect(created.parents).toEqual([first.created[0].id, second.created[0].id]);
    expect(second.select).toEqual([created.id]);
    expect(pendingCount(board.pending)).toBe(0);
    expect(danglingParents(board)).toEqual([]);
  });

  it('reuses the point under the pointer instead of duplicating it', () => {
    const board = start([point('A', 0, 0), point('B', 4, 0)], 'segment');
    const first = click(board, { x: 0, y: 0 });
    expect(first.created).toEqual([]);
    expect(board.pending.points).toEqual(['A']);
    const second = click(board, { x: 4, y: 0 });
    expect(types(second.created)).toEqual(['segment']);
    expect(record(board, 'segment').parents).toEqual(['A', 'B']);
  });

  it('draws a line and a ray with the same two clicks', () => {
    for (const tool of ['line', 'ray'] as const) {
      const board = start([], tool);
      tap(board, 0, 0);
      const result = tap(board, 2, 2);
      expect(types(result.created)).toEqual(['point.free', tool]);
    }
  });

  it('draws a circle from centre then rim', () => {
    const board = start([], 'circle');
    const centre = tap(board, 0, 0);
    const result = tap(board, 3, 0);
    expect(types(result.created)).toEqual(['point.free', 'circle.centerPoint']);
    const circle = record(board, 'circle.centerPoint');
    expect(circle.parents).toEqual([centre.created[0].id, result.created[0].id]);
  });

  it('glues the point a click lands on a path, and the host carries it', () => {
    const board = start([point('A', 0, 0), point('B', 4, 0), segment('s', ['A', 'B'])], 'segment');
    const first = click(board, { x: 1, y: 0 });
    expect(types(first.created)).toEqual(['point.onObject']);
    expect(first.created[0].parents).toEqual(['s']);
    expect(first.created[0].params).toEqual({ t: 0.25 });
    expect(board.pending.points).toEqual([first.created[0].id]);

    // The record stores only the parameter, so moving the host's end carries it.
    board.doc.objects[1].params = { x: 0, y: 4 };
    refresh(board);
    expect(board.scene.geoms.get(first.created[0].id)).toEqual({
      kind: 'point',
      at: { x: 0, y: 1 },
    });

    const second = tap(board, 6, 6);
    expect(types(second.created)).toEqual(['point.free', 'segment']);
    expect(second.created[1].parents).toEqual([first.created[0].id, second.created[0].id]);
  });
});

describe('polygon', () => {
  it('closes when the first vertex is clicked again', () => {
    const board = start([], 'polygon');
    const a = tap(board, 0, 0).created[0];
    const b = tap(board, 2, 0).created[0];
    const c = tap(board, 1, 2).created[0];
    expect(board.doc.objects).toHaveLength(3);
    expect(board.doc.objects.filter((o) => o.type === 'polygon')).toHaveLength(0);

    const result = click(board, { x: 0, y: 0 });
    expect(types(result.created)).toEqual(['polygon']);
    expect(result.created[0].parents).toEqual([a.id, b.id, c.id]);
    expect(result.select).toEqual([result.created[0].id]);
    expect(pendingCount(board.pending)).toBe(0);
    expect(danglingParents(board)).toEqual([]);
  });

  it('finishes on Enter, with a vertex collected from an existing point', () => {
    const board = start([point('A', 0, 0), point('B', 2, 0), point('C', 1, 2)], 'polygon');
    click(board, { x: 0, y: 0 });
    click(board, { x: 2, y: 0 });
    click(board, { x: 1, y: 2 });
    const result = finishPending(board.pending);
    expect(types(result.created)).toEqual(['polygon']);
    expect(result.created[0].parents).toEqual(['A', 'B', 'C']);
    expect(result.next.points).toEqual([]);
  });

  it('cancels silently with fewer than three vertices', () => {
    const board = start([point('A', 0, 0), point('B', 2, 0)], 'polygon');
    click(board, { x: 0, y: 0 });
    click(board, { x: 2, y: 0 });
    expect(finishPending(board.pending)).toEqual({
      created: [],
      next: emptyPending('polygon'),
    });
    // Clicking the first vertex is the same gesture: no polygon, nothing lost.
    const result = click(board, { x: 0, y: 0 });
    expect(result.created).toEqual([]);
    expect(pendingCount(board.pending)).toBe(0);
    expect(board.doc.objects).toHaveLength(2);
  });

  it('ignores a repeated vertex that is not the first one', () => {
    const board = start([point('A', 0, 0), point('B', 2, 0), point('C', 1, 2)], 'polygon');
    click(board, { x: 0, y: 0 });
    click(board, { x: 2, y: 0 });
    const repeat = click(board, { x: 2, y: 0 });
    expect(repeat.created).toEqual([]);
    expect(board.pending.points).toEqual(['A', 'B']);
  });

  it('abandons the pending vertices on Escape', () => {
    const board = start([point('A', 0, 0), point('B', 2, 0)], 'polygon');
    click(board, { x: 0, y: 0 });
    board.pending = emptyPending(board.pending.tool);
    // The points stay in the figure; the next click starts a new run.
    click(board, { x: 1, y: 2 });
    expect(board.pending.points).toHaveLength(1);
    expect(finishPending(board.pending).created).toEqual([]);
  });
});

describe('midpoint', () => {
  it('takes two points', () => {
    const board = start([point('A', 0, 0), point('B', 4, 0)], 'midpoint');
    click(board, { x: 0, y: 0 });
    const result = click(board, { x: 4, y: 0 });
    expect(types(result.created)).toEqual(['midpoint']);
    expect(result.created[0].parents).toEqual(['A', 'B']);
  });

  it('takes a single segment', () => {
    const board = start([point('A', 0, 0), point('B', 4, 0), segment('s', ['A', 'B'])], 'midpoint');
    const result = click(board, { x: 2, y: 0 });
    expect(types(result.created)).toEqual(['midpoint']);
    expect(result.created[0].parents).toEqual(['s']);
    expect(pendingCount(board.pending)).toBe(0);
  });

  it('glues the point it lands on a line, then takes a second point', () => {
    const board = start(
      [point('A', 0, 0), point('C', 0, 4), line('l', ['A', 'C']), point('P', 4, 0)],
      'midpoint',
    );
    const first = click(board, { x: 0, y: 2 });
    expect(types(first.created)).toEqual(['point.onObject']);
    expect(first.created[0].parents).toEqual(['l']);
    expect(first.created[0].params).toEqual({ t: 2 });

    const second = click(board, { x: 4, y: 0 });
    expect(types(second.created)).toEqual(['midpoint']);
    expect(second.created[0].parents).toEqual([first.created[0].id, 'P']);
  });

  it('prefers the point sitting on the segment to the segment itself', () => {
    const board = start(
      [point('A', 0, 0), point('B', 4, 0), segment('s', ['A', 'B']), point('M', 2, 0)],
      'midpoint',
    );
    const result = click(board, { x: 2, y: 0 });
    expect(result.created).toEqual([]);
    expect(board.pending.points).toEqual(['M']);
  });
});

describe('perpendicular and parallel', () => {
  it('takes point then path', () => {
    const board = start([point('A', 1, 1), point('B', 0, 0), point('C', 4, 0), line('l', ['B', 'C'])], 'perpendicular');
    click(board, { x: 1, y: 1 });
    const result = click(board, { x: 3, y: 0 });
    expect(types(result.created)).toEqual(['perpendicular']);
    expect(result.created[0].parents).toEqual(['A', 'l']);
  });

  it('takes path then point, storing the point parent first', () => {
    const board = start([point('A', 1, 1), point('B', 0, 0), point('C', 4, 0), line('l', ['B', 'C'])], 'parallel');
    const first = click(board, { x: 3, y: 0 });
    expect(first.created).toEqual([]);
    expect(board.pending.paths).toEqual(['l']);
    const result = click(board, { x: 1, y: 1 });
    expect(types(result.created)).toEqual(['parallel']);
    expect(result.created[0].parents).toEqual(['A', 'l']);
  });

  it('puts a free point where the teacher clicked when the point parent is missing', () => {
    const board = start([point('B', 0, 0), point('C', 4, 0), line('l', ['B', 'C'])], 'perpendicular');
    const first = click(board, { x: 3, y: 0 });
    expect(board.pending.paths).toEqual(['l']);
    const second = click(board, { x: 5, y: 5 });
    expect(types(second.created)).toEqual(['point.free', 'perpendicular']);
    expect(second.created[1].parents).toEqual([second.created[0].id, 'l']);
    expect(danglingParents(board)).toEqual([]);
    expect(first.created).toEqual([]);
  });

  it('accepts a circle as the path parent of a perpendicular', () => {
    const board = start(
      [
        point('O', 0, 0),
        point('R', 2, 0),
        { id: 'c', type: 'circle.centerPoint', parents: ['O', 'R'], params: null },
        point('P', 3, 3),
      ],
      'perpendicular',
    );
    click(board, { x: 3, y: 3 });
    const result = click(board, { x: 2, y: 0 });
    expect(result.created[0].parents).toEqual(['P', 'c']);
  });

  it('waits for the missing path instead of building on nothing', () => {
    const board = start([point('A', 1, 1)], 'perpendicular');
    click(board, { x: 1, y: 1 });
    const result = click(board, { x: 6, y: 6 });
    expect(result.created).toEqual([]);
    expect(board.pending.points).toEqual(['A']);
    expect(board.doc.objects).toHaveLength(1);
  });
});

describe('intersection', () => {
  const crossing = () => [
    point('A', 0, 0),
    point('B', 4, 0),
    segment('s1', ['A', 'B']),
    point('C', 2, -2),
    point('D', 2, 2),
    segment('s2', ['C', 'D']),
  ];

  it('takes two paths and starts at the first branch', () => {
    const board = start(crossing(), 'intersection');
    click(board, { x: 1, y: 0 });
    const result = click(board, { x: 2, y: 1 });
    expect(types(result.created)).toEqual(['intersection']);
    expect(result.created[0].parents).toEqual(['s1', 's2']);
    expect(result.created[0].params).toEqual({ branch: 0 });
    expect(pendingCount(board.pending)).toBe(0);
  });

  it('finds the path even when a point sits on top of it', () => {
    const objects = crossing();
    objects.push(point('M', 1, 0));
    const board = start(objects, 'intersection');
    const result = click(board, { x: 1, y: 0 });
    expect(board.pending.paths).toEqual(['s1']);
    expect(result.created).toEqual([]);
  });

  it('ignores a click that is not on a path', () => {
    const board = start(crossing(), 'intersection');
    click(board, { x: 1, y: 0 });
    const result = click(board, { x: 8, y: 8 });
    expect(result.created).toEqual([]);
    expect(board.pending.paths).toEqual(['s1']);
  });

  it('collects nothing from a click on a point that is not on a path', () => {
    const objects = crossing();
    objects.push(point('P', 6, 6));
    const board = start(objects, 'intersection');
    const result = click(board, { x: 6, y: 6 });
    expect(result.created).toEqual([]);
    expect(board.pending.paths).toEqual([]);
  });
});

describe('measurements', () => {
  it('measures a distance from two points', () => {
    const board = start([point('A', 0, 0), point('B', 3, 4)], 'measure.distance');
    click(board, { x: 0, y: 0 });
    const result = click(board, { x: 3, y: 4 });
    expect(types(result.created)).toEqual(['measure.distance']);
    expect(result.created[0].parents).toEqual(['A', 'B']);
  });

  it('measures a distance from one segment', () => {
    const board = start([point('A', 0, 0), point('B', 3, 4), segment('s', ['A', 'B'])], 'measure.distance');
    const result = click(board, { x: 1.5, y: 2 });
    expect(types(result.created)).toEqual(['measure.distance']);
    expect(result.created[0].parents).toEqual(['s']);
  });

  it('measures an angle with the middle click as the vertex', () => {
    const board = start([point('A', 4, 0), point('V', 0, 0), point('B', 0, 4)], 'measure.angle');
    click(board, { x: 4, y: 0 });
    click(board, { x: 0, y: 0 });
    const result = click(board, { x: 0, y: 4 });
    expect(types(result.created)).toEqual(['measure.angle']);
    expect(result.created[0].parents).toEqual(['A', 'V', 'B']);
  });

  it('measures a polygon and a circle', () => {
    const polygon = start(square(), 'measure.area');
    const onPolygon = tap(polygon, 0, -1);
    expect(types(onPolygon.created)).toEqual(['measure.area']);
    expect(onPolygon.created[0].parents).toEqual(['ABCD']);

    const circle = start(
      [
        point('O', 0, 0),
        point('R', 2, 0),
        { id: 'c', type: 'circle.centerPoint', parents: ['O', 'R'], params: null },
        point('P', 2, 0),
      ],
      'measure.area',
    );
    // The click is on the rim, where a separate point also sits.
    const onCircle = click(circle, { x: 2, y: 0 });
    expect(types(onCircle.created)).toEqual(['measure.area']);
    expect(onCircle.created[0].parents).toEqual(['c']);
  });

  it('ignores anything that is neither a polygon nor a circle', () => {
    const board = start([point('A', 0, 0), point('B', 4, 0), segment('s', ['A', 'B'])], 'measure.area');
    const result = click(board, { x: 2, y: 0 });
    expect(result.created).toEqual([]);
    expect(board.doc.objects).toHaveLength(3);
  });
});

describe('text tool', () => {
  it('asks the caller for the string at the clicked point, creating nothing itself', () => {
    const board = start([], 'text');
    const result = tap(board, -3, 2);
    expect(result.created).toEqual([]);
    expect(result.askAt).toEqual({ x: -3, y: 2 });
    expect(result.select).toBeUndefined();
    expect(board.doc.objects).toEqual([]);
  });

  it('asks at the click position even when it lands on an object — text does not snap', () => {
    const objects = [point('A', 0, 0), point('B', 4, 0), segment('s', ['A', 'B'])];
    const board = start(objects, 'text');
    const onSegment = click(board, { x: 2, y: 0 });
    expect(onSegment.askAt).toEqual({ x: 2, y: 0 });
    const onPoint = click(board, { x: 4, y: 0 });
    expect(onPoint.askAt).toEqual({ x: 4, y: 0 });
    expect(board.doc.objects).toHaveLength(3);
  });

  it('stays armed for the next click, holding nothing', () => {
    const board = start([], 'text');
    const result = tap(board, 1, 1);
    expect(result.next.tool).toBe('text');
    expect(pendingCount(result.next)).toBe(0);
  });

  it('makes a free text record from a confirmed answer', () => {
    const record = textRecord({ x: -3, y: 2.5 }, '= 4');
    expect(record.type).toBe('text.free');
    expect(record.parents).toEqual([]);
    expect(record.params).toEqual({ x: -3, y: 2.5, text: '= 4' });
    expect(textRecord({ x: 0, y: 0 }, 'a').id).not.toBe(textRecord({ x: 0, y: 0 }, 'a').id);
  });

  it('is plain JSON, so it round-trips through a .geosketch file', () => {
    const record = textRecord({ x: 1, y: -2 }, '∠ABC = 60°');
    expect(JSON.parse(JSON.stringify(record))).toEqual(record);
  });
});

describe('delete tool', () => {
  it('names the object under the click for the caller to cascade', () => {
    const board = start([point('A', 0, 0), point('B', 4, 0), segment('s', ['A', 'B'])], 'delete');
    const result = click(board, { x: 2, y: 0 });
    expect(result.remove).toBe('s');
    expect(result.created).toEqual([]);
    expect(pendingCount(board.pending)).toBe(0);
  });

  it('prefers the point over the path it lies on', () => {
    const board = start([point('A', 0, 0), point('B', 4, 0), segment('s', ['A', 'B'])], 'delete');
    expect(click(board, { x: 0, y: 0 }).remove).toBe('A');
  });

  it('does nothing on empty space', () => {
    const board = start([point('A', 0, 0)], 'delete');
    expect(click(board, { x: 9, y: 9 }).remove).toBeUndefined();
  });
});

describe('select tool', () => {
  it('leaves clicks to the board, which toggles and clears', () => {
    const board = start([point('A', 0, 0)], 'select');
    const result = click(board, { x: 0, y: 0 });
    expect(result).toEqual({ created: [], next: emptyPending('select') });
  });
});

describe('robustness', () => {
  it('treats a hit without geometry as empty (undefined objects are not clickable)', () => {
    // A segment whose parents coincide is undefined: no geometry, so nothing to click.
    const objects = [point('A', 0, 0), point('B', 0, 0), segment('s', ['A', 'B'])];
    const board = start(objects, 'point');
    expect(board.scene.undefined.get('s')).toBeDefined();
    expect(hitsAt(board, { x: 0, y: 0 })).not.toContain('s');
    const result = clickWith(board, { x: 5, y: 5 }, ['s']);
    expect(types(result.created)).toEqual(['point.free']);
  });

  it('drops pending ids the document lost (undo) instead of building on them', () => {
    const board = start([point('A', 0, 0)], 'segment');
    click(board, { x: 0, y: 0 });
    expect(board.pending.points).toEqual(['A']);
    board.doc.objects = [];
    refresh(board);
    const result = click(board, { x: 3, y: 0 });
    // The click restarts the run: a fresh point, still no segment.
    expect(types(result.created)).toEqual(['point.free']);
    expect(board.pending.points).toEqual([result.created[0].id]);
    expect(danglingParents(board)).toEqual([]);
  });

  it('reuses a point inside the tolerance and creates one outside it', () => {
    const inside = start([point('A', 0, 0)], 'segment');
    expect(click(inside, { x: 0, y: TOL * 0.9 }).created).toEqual([]);
    const outside = start([point('A', 0, 0)], 'segment');
    expect(types(click(outside, { x: 0, y: TOL * 1.1 }).created)).toEqual(['point.free']);
  });

  it('never mutates its inputs', () => {
    const board = start([point('A', 0, 0), point('B', 4, 0), segment('s', ['A', 'B'])], 'point');
    const before = JSON.stringify(board.doc);
    const pendingBefore = JSON.stringify(board.pending);
    const result = reduceClick(
      { doc: board.doc, scene: board.scene, world: { x: 2, y: 0 }, hits: ['s'] },
      board.pending,
    );
    expect(JSON.stringify(board.doc)).toBe(before);
    expect(JSON.stringify(board.pending)).toBe(pendingBefore);
    expect(result.created).toHaveLength(1);
  });
});

/**
 * The records a tool builds must be *constructions*, not undefined objects: a
 * wrong parent order, a missing parameter or a signature the engine does not
 * have would all show up as an "undefined" chip right after a click.
 */
describe('what the tools build computes', () => {
  const figure = (): ObjRecord[] => [
    point('A', 0, 0),
    point('B', 4, 0),
    point('C', 0, 3),
    point('D', 2, -2),
    point('E', 2, 2),
    point('P', -6, -5),
    point('Q', -2, -5),
    point('R', -4, -2),
    segment('s1', ['A', 'B']),
    segment('s2', ['D', 'E']),
    line('l', ['A', 'C']),
    { id: 'c', type: 'circle.centerPoint', parents: ['A', 'B'], params: null },
    { id: 'tri', type: 'polygon', parents: ['P', 'Q', 'R'], params: null },
  ];

  const cases: { tool: Tool; clicks: [number, number][]; type: string; finish?: boolean }[] = [
    { tool: 'point', clicks: [[6, 6]], type: 'point.free' },
    { tool: 'point', clicks: [[2, 0]], type: 'point.onObject' },
    { tool: 'segment', clicks: [[6, 6], [8, 6]], type: 'segment' },
    // A click on a path glues, whatever the tool collects points for.
    { tool: 'segment', clicks: [[0, 1], [6, 6]], type: 'point.onObject' },
    { tool: 'polygon', clicks: [[0, 1], [8, 6], [7, 8]], type: 'point.onObject', finish: true },
    { tool: 'midpoint', clicks: [[0, 1], [6, 6]], type: 'point.onObject' },
    { tool: 'measure.distance', clicks: [[0, 1], [6, 6]], type: 'point.onObject' },
    { tool: 'measure.angle', clicks: [[0, 1], [6, 6], [8, 6]], type: 'point.onObject' },
    { tool: 'line', clicks: [[6, 6], [8, 6]], type: 'line' },
    { tool: 'ray', clicks: [[6, 6], [8, 6]], type: 'ray' },
    { tool: 'circle', clicks: [[6, 6], [9, 6]], type: 'circle.centerPoint' },
    { tool: 'polygon', clicks: [[6, 6], [8, 6], [7, 8]], type: 'polygon', finish: true },
    { tool: 'midpoint', clicks: [[6, 6], [8, 6]], type: 'midpoint' },
    { tool: 'midpoint', clicks: [[2, 0]], type: 'midpoint' },
    { tool: 'perpendicular', clicks: [[6, 6], [2, 0]], type: 'perpendicular' },
    { tool: 'parallel', clicks: [[2, 0], [6, 6]], type: 'parallel' },
    { tool: 'intersection', clicks: [[1, 0], [2, 1]], type: 'intersection' },
    { tool: 'measure.distance', clicks: [[6, 6], [8, 6]], type: 'measure.distance' },
    { tool: 'measure.distance', clicks: [[2, 0]], type: 'measure.distance' },
    { tool: 'measure.angle', clicks: [[6, 6], [8, 6], [7, 4]], type: 'measure.angle' },
    { tool: 'measure.area', clicks: [[-4, -5]], type: 'measure.area' },
    { tool: 'measure.area', clicks: [[4, 0]], type: 'measure.area' },
  ];

  it.each(cases)('$tool', ({ tool, clicks, type, finish }) => {
    const board = start(figure(), tool);
    const before = new Set(board.doc.objects.map((o) => o.id));
    for (const [x, y] of clicks) tap(board, x, y);
    if (finish === true) {
      const result = finishPending(board.pending);
      board.pending = result.next;
      board.doc.objects.push(...result.created);
      refresh(board);
    }

    const made = board.doc.objects.filter((o) => !before.has(o.id));
    const built = made.find((o) => o.type === type);
    expect(built).toBeDefined();
    for (const rec of made) {
      expect(board.scene.undefined.get(rec.id), `${tool}: ${rec.type}`).toBeUndefined();
    }
    expect(danglingParents(board)).toEqual([]);
  });
});
