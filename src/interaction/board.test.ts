import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../app/store';
import { createEmptyDoc, type Doc, type ObjRecord } from '../engine';
import { attachBoard, type BoardHandle } from './board';

const CSS_W = 800;
const CSS_H = 600;

/** Screen position of a world point at the default viewport (scale 64, centre 0,0). */
function screen(x: number, y: number): { x: number; y: number } {
  return { x: CSS_W / 2 + x * 64, y: CSS_H / 2 - y * 64 };
}

function freePoint(id: string, x: number, y: number): ObjRecord {
  return { id, type: 'point.free', parents: [], params: { x, y } };
}

function segment(id: string, parents: [string, string]): ObjRecord {
  return { id, type: 'segment', parents, params: null };
}

function docWith(objects: ObjRecord[]): Doc {
  return { ...createEmptyDoc(), objects };
}

type Handler = (event: Record<string, unknown>) => void;

interface Board {
  store: Store;
  handle: BoardHandle;
  /** The stubbed `window.confirm`: its answer, and what it was asked. */
  confirm: { answer: boolean; prompts: string[] };
  down(x: number, y: number): void;
  move(x: number, y: number): void;
  up(x: number, y: number): void;
  cancel(x: number, y: number): void;
  tap(x: number, y: number): void;
  key(key: string): void;
}

const HOST_GLOBALS = ['window', 'requestAnimationFrame', 'ResizeObserver', 'HTMLElement'];
const saved = new Map<string, unknown>();

beforeEach(() => {
  const g = globalThis as Record<string, unknown>;
  for (const name of HOST_GLOBALS) saved.set(name, g[name]);
  // The board is a DOM component; these are the host APIs it actually uses.
  g.requestAnimationFrame = () => 1;
  g.ResizeObserver = class {
    observe(): void {}
  };
  g.HTMLElement = class {};
});

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  for (const [name, value] of saved) {
    if (value === undefined) delete g[name];
    else g[name] = value;
  }
  saved.clear();
});

function attach(objects: ObjRecord[] = []): Board {
  const store = new Store(docWith(objects));
  const confirm = { answer: true, prompts: [] as string[] };
  const canvasHandlers = new Map<string, Handler[]>();
  const windowHandlers = new Map<string, Handler[]>();
  const listen =
    (into: Map<string, Handler[]>) =>
    (type: string, fn: Handler): void => {
      const list = into.get(type) ?? [];
      list.push(fn);
      into.set(type, list);
    };

  const canvas = {
    width: 0,
    height: 0,
    getContext: () => null,
    getBoundingClientRect: () => ({ width: CSS_W, height: CSS_H, left: 0, top: 0 }),
    setPointerCapture: () => {},
    hasPointerCapture: () => false,
    releasePointerCapture: () => {},
    addEventListener: listen(canvasHandlers),
  } as unknown as HTMLCanvasElement;

  (globalThis as Record<string, unknown>).window = {
    devicePixelRatio: 1,
    addEventListener: listen(windowHandlers),
    confirm: (message: string) => {
      confirm.prompts.push(message);
      return confirm.answer;
    },
  };

  const handle = attachBoard(canvas, store);

  const fire = (handlers: Map<string, Handler[]>, type: string, event: Record<string, unknown>): void => {
    for (const fn of handlers.get(type) ?? []) fn({ type, ...event });
  };
  const pointer = (type: string, x: number, y: number): void => {
    const at = screen(x, y);
    fire(canvasHandlers, type, {
      pointerId: 1,
      pointerType: 'touch',
      button: 0,
      clientX: at.x,
      clientY: at.y,
    });
  };

  const down = (x: number, y: number): void => pointer('pointerdown', x, y);
  const up = (x: number, y: number): void => pointer('pointerup', x, y);

  return {
    store,
    handle,
    confirm,
    down,
    move: (x, y) => pointer('pointermove', x, y),
    up,
    cancel: (x, y) => pointer('pointercancel', x, y),
    tap: (x, y) => {
      down(x, y);
      up(x, y);
    },
    key: (key) =>
      fire(windowHandlers, 'keydown', { key, target: null, preventDefault: () => {} }),
  };
}

describe('select tool', () => {
  it('toggles an object in and out of the selection', () => {
    const board = attach([freePoint('p1', 0, 0)]);
    board.tap(0, 0);
    expect([...board.store.selection]).toEqual(['p1']);
    board.tap(0, 0);
    expect(board.store.selection.size).toBe(0);
    expect(board.store.doc.objects).toHaveLength(1);
  });

  it('appends tapped objects in click order and removes a re-tapped one', () => {
    const board = attach([freePoint('p1', 0, 0), freePoint('p2', 2, 0)]);
    board.tap(0, 0);
    board.tap(2, 0);
    expect([...board.store.selection]).toEqual(['p1', 'p2']);
    board.tap(0, 0);
    expect([...board.store.selection]).toEqual(['p2']);
  });

  it('only clears the selection on empty space — it creates no point', () => {
    const board = attach([freePoint('p1', 0, 0)]);
    board.tap(0, 0);
    board.tap(-4, 3);
    expect(board.store.selection.size).toBe(0);
    expect(board.store.doc.objects).toHaveLength(1);
    expect(board.store.canUndo()).toBe(false);
  });
});

describe('point tool', () => {
  it('puts a labelled free point on empty space and selects it', () => {
    const board = attach();
    board.store.setTool('point');
    board.tap(-4, 3);
    const objects = board.store.doc.objects;
    expect(objects).toHaveLength(1);
    expect(objects[0].type).toBe('point.free');
    expect(objects[0].params).toEqual({ x: -4, y: 3 });
    expect(objects[0].label?.text).toBe('A');
    expect([...board.store.selection]).toEqual([objects[0].id]);
  });

  it('makes a run of points, one undo entry each', () => {
    const board = attach();
    board.store.setTool('point');
    board.tap(-4, 3);
    board.tap(-2, 3);
    board.tap(-3, 1);
    expect(board.store.doc.objects).toHaveLength(3);
    // The newest point is the selection: three taps plus one action is now a
    // select-tool gesture, not an accumulation of taps.
    expect([...board.store.selection]).toEqual([board.store.doc.objects[2].id]);
    board.store.undo();
    expect(board.store.doc.objects).toHaveLength(2);
  });

  it('glues a point to the path under the pointer', () => {
    const board = attach([freePoint('a', 0, 0), freePoint('b', 4, 0), segment('s', ['a', 'b'])]);
    board.store.setTool('point');
    board.tap(1, 0);
    const glued = board.store.doc.objects[3];
    expect(glued.type).toBe('point.onObject');
    expect(glued.parents).toEqual(['s']);
    expect(glued.params).toEqual({ t: 0.25 });
  });
});

describe('segment tool', () => {
  it('builds a segment from two taps, each tap its own undo entry', () => {
    const board = attach();
    board.store.setTool('segment');
    board.tap(-2, 0);
    expect(board.handle.pendingCount()).toBe(1);
    expect(board.store.doc.objects).toHaveLength(1);

    board.tap(2, 1);
    expect(board.handle.pendingCount()).toBe(0);
    const objects = board.store.doc.objects;
    expect(objects.map((o) => o.type)).toEqual(['point.free', 'point.free', 'segment']);
    expect(objects[2].parents).toEqual([objects[0].id, objects[1].id]);
    expect([...board.store.selection]).toEqual([objects[2].id]);

    // One click, one edit: undo takes the segment and the point it made away.
    board.store.undo();
    expect(board.store.doc.objects.map((o) => o.type)).toEqual(['point.free']);
  });

  it('reuses the point under the pointer instead of making a second one', () => {
    const board = attach([freePoint('a', 0, 0), freePoint('b', 4, 0)]);
    board.store.setTool('segment');
    board.tap(0, 0);
    board.tap(4, 0);
    const types = board.store.doc.objects.map((o) => o.type);
    expect(types).toEqual(['point.free', 'point.free', 'segment']);
    expect(board.store.doc.objects[2].parents).toEqual(['a', 'b']);
  });

  it('abandons the first click on Escape, and clears the selection next', () => {
    const board = attach();
    board.store.setTool('segment');
    board.tap(-2, 0);
    expect(board.handle.pendingCount()).toBe(1);

    board.key('Escape');
    expect(board.handle.pendingCount()).toBe(0);
    // The point the click made is real, and it stays selected.
    expect(board.store.doc.objects).toHaveLength(1);
    expect(board.store.selection.size).toBe(1);

    board.key('Escape');
    expect(board.store.selection.size).toBe(0);
  });

  it('starts over when the tool changes between clicks', () => {
    const board = attach();
    board.store.setTool('segment');
    board.tap(-2, 0);
    expect(board.handle.pendingCount()).toBe(1);
    board.store.setTool('line');
    expect(board.handle.pendingCount()).toBe(0);
    board.tap(2, 0);
    expect(board.store.doc.objects.map((o) => o.type)).toEqual(['point.free', 'point.free']);
  });

  it('makes nothing of a cancelled gesture', () => {
    const board = attach();
    board.store.setTool('segment');
    board.down(-2, 0);
    board.cancel(-2, 0);
    expect(board.store.doc.objects).toHaveLength(0);
    expect(board.handle.pendingCount()).toBe(0);
  });
});

describe('polygon tool', () => {
  it('closes the polygon on Enter', () => {
    const board = attach();
    board.store.setTool('polygon');
    board.tap(0, 0);
    board.tap(2, 0);
    board.tap(1, 2);
    expect(board.handle.pendingCount()).toBe(3);

    board.key('Enter');
    const objects = board.store.doc.objects;
    expect(objects.map((o) => o.type)).toEqual(['point.free', 'point.free', 'point.free', 'polygon']);
    expect(objects[3].parents).toEqual(objects.slice(0, 3).map((o) => o.id));
    expect([...board.store.selection]).toEqual([objects[3].id]);
    expect(board.handle.pendingCount()).toBe(0);
  });

  it('closes the polygon by tapping the first vertex again', () => {
    const board = attach();
    board.store.setTool('polygon');
    board.tap(0, 0);
    board.tap(2, 0);
    board.tap(1, 2);
    board.tap(0, 0);
    const objects = board.store.doc.objects;
    expect(objects.map((o) => o.type)).toEqual(['point.free', 'point.free', 'point.free', 'polygon']);
    expect(board.handle.pendingCount()).toBe(0);
  });

  it('cancels a two-vertex run on Enter without creating anything', () => {
    const board = attach();
    board.store.setTool('polygon');
    board.tap(0, 0);
    board.tap(2, 0);
    board.key('Enter');
    expect(board.store.doc.objects.map((o) => o.type)).toEqual(['point.free', 'point.free']);
    expect(board.handle.pendingCount()).toBe(0);
  });
});

describe('delete tool', () => {
  const figure = () => [freePoint('a', 0, 0), freePoint('b', 4, 0), segment('s', ['a', 'b'])];

  it('removes the clicked object with its dependents, in one undo entry', () => {
    const board = attach(figure());
    board.store.setTool('delete');
    board.tap(0, 0); // one of the segment's endpoints
    expect(board.confirm.prompts).toHaveLength(1);
    expect(board.confirm.prompts[0]).toContain('删除');
    // The endpoint and the segment that is defined by it go together; the other
    // endpoint is defined by nothing and stays.
    expect(board.store.doc.objects.map((o) => o.id)).toEqual(['b']);
    expect(board.handle.pendingCount()).toBe(0);

    board.store.undo();
    expect(board.store.doc.objects).toHaveLength(3);
  });

  it('leaves the figure alone when the teacher declines', () => {
    const board = attach(figure());
    board.store.setTool('delete');
    board.confirm.answer = false;
    board.tap(0, 0);
    expect(board.store.doc.objects).toHaveLength(3);
    expect(board.store.canUndo()).toBe(false);
  });

  it('does nothing on empty space', () => {
    const board = attach(figure());
    board.store.setTool('delete');
    board.tap(-5, -5);
    expect(board.confirm.prompts).toHaveLength(0);
    expect(board.store.doc.objects).toHaveLength(3);
  });
});

describe('drag', () => {
  it('moves a free point by its {x, y} parameters as one undo step', () => {
    const board = attach([freePoint('p1', 0, 0)]);
    board.down(0, 0);
    board.move(1, 0.5);
    board.up(1, 0.5);
    expect(board.store.doc.objects[0].params).toEqual({ x: 1, y: 0.5 });
    expect(board.store.canUndo()).toBe(true);
  });

  it('takes the selection over when the grabbed object was not selected', () => {
    const board = attach([freePoint('p1', 0, 0), freePoint('p2', 2, 0)]);
    board.tap(0, 0);
    board.down(2, 0);
    board.move(3, 0);
    board.up(3, 0);
    expect([...board.store.selection]).toEqual(['p2']);
  });

  it('keeps a multi-selection when the grabbed object is part of it', () => {
    const board = attach([freePoint('p1', 0, 0), freePoint('p2', 2, 0)]);
    board.tap(0, 0);
    board.tap(2, 0);
    board.down(2, 0);
    board.move(3, 0);
    board.up(3, 0);
    expect([...board.store.selection]).toEqual(['p1', 'p2']);
    expect(board.store.doc.objects[1].params).toEqual({ x: 3, y: 0 });
  });

  it('selects a segment without moving anything', () => {
    const board = attach([freePoint('a', 0, 0), freePoint('b', 4, 0), segment('s', ['a', 'b'])]);
    board.down(2, 0);
    board.move(3, 1);
    board.up(3, 1);
    expect([...board.store.selection]).toEqual(['s']);
    expect(board.store.doc.objects.map((o) => o.params)).toEqual([{ x: 0, y: 0 }, { x: 4, y: 0 }, null]);
    expect(board.store.canUndo()).toBe(false);
  });

  it('re-projects a point on a path by its {t} parameter, clamped to the path', () => {
    const board = attach([
      freePoint('a', 0, 0),
      freePoint('b', 4, 0),
      segment('s', ['a', 'b']),
      { id: 'q', type: 'point.onObject', parents: ['s'], params: { t: 0.5 } },
    ]);
    board.down(2, 0);
    board.move(3, 0);
    expect(board.store.doc.objects[3].params).toEqual({ t: 0.75 });
    board.move(10, 0); // past the end of the segment
    board.up(10, 0);
    expect(board.store.doc.objects[3].params).toEqual({ t: 1 });
  });

  it('still drags an object while a construction tool is active', () => {
    const board = attach([freePoint('p1', 0, 0)]);
    board.store.setTool('segment');
    board.down(0, 0);
    board.move(1, 0);
    board.up(1, 0);
    expect(board.store.doc.objects[0].params).toEqual({ x: 1, y: 0 });
    // A drag is not a click: nothing is pending.
    expect(board.handle.pendingCount()).toBe(0);
  });
});

describe('keyboard', () => {
  it('Escape clears the selection', () => {
    const board = attach([freePoint('p1', 0, 0)]);
    board.tap(0, 0);
    expect(board.store.selection.size).toBe(1);
    board.key('Escape');
    expect(board.store.selection.size).toBe(0);
  });

  it('Delete removes the selected objects', () => {
    const board = attach([freePoint('p1', 0, 0), freePoint('p2', 2, 0)]);
    board.tap(0, 0);
    board.tap(2, 0);
    board.key('Delete');
    expect(board.store.doc.objects).toHaveLength(0);
    expect(board.store.selection.size).toBe(0);
    expect(board.store.canUndo()).toBe(true);
  });
});
