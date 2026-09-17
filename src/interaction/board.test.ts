import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../app/store';
import { createEmptyDoc, type Doc, type ObjRecord } from '../engine';
import { attachBoard } from './board';

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
  down(x: number, y: number): void;
  move(x: number, y: number): void;
  up(x: number, y: number): void;
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
  };

  attachBoard(canvas, store);

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
    down,
    move: (x, y) => pointer('pointermove', x, y),
    up,
    tap: (x, y) => {
      down(x, y);
      up(x, y);
    },
    key: (key) =>
      fire(windowHandlers, 'keydown', { key, target: null, preventDefault: () => {} }),
  };
}

describe('tap', () => {
  it('creates a free point on empty space and adds it to the selection', () => {
    const board = attach();
    board.tap(-4, 3);
    const objects = board.store.doc.objects;
    expect(objects).toHaveLength(1);
    expect(objects[0].type).toBe('point.free');
    expect(objects[0].params).toEqual({ x: -4, y: 3 });
    expect(objects[0].label?.text).toBe('A');
    expect([...board.store.selection]).toEqual([objects[0].id]);
  });

  it('appends every new point, so a run of taps can become a construction', () => {
    const board = attach();
    board.tap(-4, 3);
    board.tap(-2, 3);
    board.tap(-3, 1);
    expect(board.store.doc.objects).toHaveLength(3);
    expect([...board.store.selection]).toEqual(board.store.doc.objects.map((o) => o.id));
  });

  it('toggles an object in and out of the selection instead of creating a point', () => {
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
