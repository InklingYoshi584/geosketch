import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../app/store';
import { createEmptyDoc, type Doc, type Id, type ObjRecord } from '../engine';
import {
  attachAnimationClock,
  eraseTraces,
  hiddenIds,
  showAllHidden,
  toggleAnimate,
  toggleHidden,
  toggleTrace,
  tracesOf,
} from './display';

// ---------------------------------------------------------------------------
// Fixtures: a segment p0→p1 (0,0)→(4,0) with `q` glued at t = 0.25 → (1, 0),
// and a circle about p0 through p1 for the angular wrap.
// ---------------------------------------------------------------------------

function fixture(): Doc {
  const doc = createEmptyDoc();
  doc.objects = [
    { id: 'p0', type: 'point.free', parents: [], params: { x: 0, y: 0 } },
    { id: 'p1', type: 'point.free', parents: [], params: { x: 4, y: 0 } },
    { id: 's', type: 'segment', parents: ['p0', 'p1'], params: null },
    { id: 'q', type: 'point.onObject', parents: ['s'], params: { t: 0.25 } },
  ];
  return doc;
}

function circleFixture(t: number): Doc {
  const doc = createEmptyDoc();
  doc.objects = [
    { id: 'p0', type: 'point.free', parents: [], params: { x: 0, y: 0 } },
    { id: 'p1', type: 'point.free', parents: [], params: { x: 2, y: 0 } },
    { id: 'c', type: 'circle.centerPoint', parents: ['p0', 'p1'], params: null },
    { id: 'q', type: 'point.onObject', parents: ['c'], params: { t } },
  ];
  return doc;
}

function recordOf(doc: Doc, id: Id): ObjRecord {
  const rec = doc.objects.find((o) => o.id === id);
  if (rec === undefined) throw new Error(`no object ${id}`);
  return rec;
}

function paramsOf(doc: Doc, id: Id): Record<string, unknown> {
  const params = recordOf(doc, id).params;
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    throw new Error(`${id} has no parameter bag`);
  }
  return params;
}

function tOf(store: Store, id: Id): number {
  const t = paramsOf(store.doc, id).t;
  if (typeof t !== 'number') throw new Error(`${id} has no numeric t`);
  return t;
}

/** Drag the glued point by writing its parameter, the way the board does. */
function setT(store: Store, id: Id, t: number): void {
  store.edit((doc) => {
    paramsOf(doc, id).t = t;
  });
}

function animateOf(store: Store, id: Id): NonNullable<ObjRecord['display']>['animate'] {
  return recordOf(store.doc, id).display?.animate;
}

/** Mark an object animated straight in the document (as a loaded file could). */
function preanimated(doc: Doc, id: Id, speed: number, dir: 1 | -1): Doc {
  const rec = recordOf(doc, id);
  rec.display = { ...rec.display, animate: { running: true, speed, dir } };
  return doc;
}

/** The glued point's parameter, set before the store ever computes the document. */
function atT(doc: Doc, id: Id, t: number): Doc {
  paramsOf(doc, id).t = t;
  return doc;
}

// ---------------------------------------------------------------------------
// A hand-driven `requestAnimationFrame`: the clock is the only consumer, and a
// test decides exactly when a frame happens and what the clock reads.
// ---------------------------------------------------------------------------

let frames: Map<number, (ts: number) => void>;
let cancelled: number[];
let handles: number;

function frame(ts: number): void {
  const due = [...frames.values()];
  frames.clear();
  for (const fn of due) fn(ts);
}

const HOST_GLOBALS = ['requestAnimationFrame', 'cancelAnimationFrame'];
const saved = new Map<string, unknown>();

beforeEach(() => {
  const g = globalThis as Record<string, unknown>;
  for (const name of HOST_GLOBALS) saved.set(name, g[name]);
  frames = new Map();
  cancelled = [];
  handles = 1;
  g.requestAnimationFrame = (fn: (ts: number) => void): number => {
    const handle = handles++;
    frames.set(handle, fn);
    return handle;
  };
  g.cancelAnimationFrame = (handle: number): void => {
    cancelled.push(handle);
    frames.delete(handle);
  };
});

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  for (const [name, value] of saved) {
    if (value === undefined) delete g[name];
    else g[name] = value;
  }
  saved.clear();
});

describe('hide', () => {
  it('hides the selection, keeps it computing, and takes it out of picking', () => {
    const store = new Store(fixture());
    expect(store.pick({ x: 1, y: 0 }, 0.1)).toContain('q');

    store.setSelection(['q']);
    toggleHidden(store);
    expect(recordOf(store.doc, 'q').display?.hidden).toBe(true);
    // Still computed: hiding is display state, so dependents keep working.
    expect(store.scene.geoms.has('q')).toBe(true);
    // Unhittable: the segment underneath still is.
    expect(store.pick({ x: 1, y: 0 }, 0.1)).not.toContain('q');
    expect(store.pick({ x: 1, y: 0 }, 0.1)).toContain('s');

    store.undo();
    expect(hiddenIds(store.doc).size).toBe(0);
    expect(store.pick({ x: 1, y: 0 }, 0.1)).toContain('q');
  });

  it('flips each selected object on its own, so a mixed selection unifies', () => {
    const store = new Store(fixture());
    store.setSelection(['q']);
    toggleHidden(store);
    store.setSelection(['q', 's']);
    toggleHidden(store);
    expect(recordOf(store.doc, 'q').display?.hidden).toBe(false);
    expect(recordOf(store.doc, 's').display?.hidden).toBe(true);
  });

  it('shows every hidden object again in one edit', () => {
    const store = new Store(fixture());
    store.setSelection(['q', 's']);
    toggleHidden(store);
    expect(hiddenIds(store.doc)).toEqual(new Set(['q', 's']));

    showAllHidden(store);
    expect(hiddenIds(store.doc).size).toBe(0);
    // One undo restores *both* flags, so showing was a single edit.
    store.undo();
    expect(hiddenIds(store.doc)).toEqual(new Set(['q', 's']));
  });

  it('does nothing without a selection', () => {
    const store = new Store(fixture());
    toggleHidden(store);
    expect(store.canUndo()).toBe(false);
  });
});

describe('trace', () => {
  it('records past geometries, ignores motionless notifications, and erases', () => {
    const store = new Store(fixture());
    store.setSelection(['q']);
    toggleTrace(store);
    const trail = (): readonly unknown[] => tracesOf(store).get('q') ?? [];
    // Turning tracing on seeds the trail with where the object is now.
    expect(trail()).toEqual([{ kind: 'point', at: { x: 1, y: 0 } }]);

    setT(store, 'q', 0.5);
    setT(store, 'q', 0.75);
    expect(trail()).toEqual([
      { kind: 'point', at: { x: 1, y: 0 } },
      { kind: 'point', at: { x: 2, y: 0 } },
      { kind: 'point', at: { x: 3, y: 0 } },
    ]);

    // A notification that does not move the object must not pad the trail.
    store.setSelection([]);
    expect(trail()).toHaveLength(3);

    eraseTraces(store);
    expect(trail()).toHaveLength(0);
    // …and the object keeps recording from its next move.
    setT(store, 'q', 1);
    expect(trail()).toEqual([{ kind: 'point', at: { x: 4, y: 0 } }]);
  });

  it('keeps at most 120 samples, oldest first', () => {
    const store = new Store(fixture());
    store.setSelection(['q']);
    toggleTrace(store);
    for (let i = 0; i < 200; i += 1) setT(store, 'q', (i % 100) / 100);

    const trail = tracesOf(store).get('q') ?? [];
    expect(trail).toHaveLength(120);
    // 201 samples were recorded; the last 120 survive, in chronological order.
    expect(trail[0]).toEqual({ kind: 'point', at: { x: 3.2, y: 0 } });
    expect(trail[119]).toEqual({ kind: 'point', at: { x: 3.96, y: 0 } });
  });

  it('drops the trail when tracing is turned off, not just the flag', () => {
    const store = new Store(fixture());
    store.setSelection(['q']);
    toggleTrace(store);
    setT(store, 'q', 0.5);
    expect(tracesOf(store).get('q')).toHaveLength(2);

    toggleTrace(store);
    expect(recordOf(store.doc, 'q').display?.trace).toBeUndefined();
    expect(tracesOf(store).get('q')).toBeUndefined();
  });

  it('forgets the trail of an object that is deleted', () => {
    const store = new Store(fixture());
    store.setSelection(['q']);
    toggleTrace(store);
    store.edit((doc) => {
      doc.objects = doc.objects.filter((o) => o.id !== 'q');
    });
    expect(tracesOf(store).size).toBe(0);
  });
});

describe('animation', () => {
  it('advances t by speed × dt and commits the whole run as one entry', () => {
    const store = new Store(fixture());
    store.setSelection(['q']);
    toggleAnimate(store);
    expect(animateOf(store, 'q')).toEqual({ running: true, speed: 0.5, dir: 1 });
    expect(frames.size).toBe(1);

    frame(0); // the first frame only takes the clock's time base
    expect(tOf(store, 'q')).toBeCloseTo(0.25);
    frame(100); // 0.1 s at speed 0.5
    expect(tOf(store, 'q')).toBeCloseTo(0.3);
    frame(200);
    expect(tOf(store, 'q')).toBeCloseTo(0.35);

    toggleAnimate(store);
    expect(animateOf(store, 'q')?.running).toBe(false);
    // The loop is off: nothing scheduled, and the pending frame was cancelled.
    expect(frames.size).toBe(0);
    expect(cancelled).toHaveLength(1);

    // The whole run is one undo entry: undo returns the start of the run, and
    // the restarted clock holds no half-open transaction (a dangling one would
    // push an entry here and clear the redo stack).
    store.undo();
    expect(tOf(store, 'q')).toBeCloseTo(0.25);
    expect(animateOf(store, 'q')?.running).toBe(true);
    expect(store.canRedo()).toBe(true);
    store.commit();
    expect(store.canRedo()).toBe(true);

    toggleAnimate(store); // let the restarted clock go again
    expect(frames.size).toBe(0);
  });

  it('wraps a segment parameter into [0, 1)', () => {
    const store = new Store(preanimated(atT(fixture(), 'q', 0.9), 'q', 2, 1));
    attachAnimationClock(store);
    frame(0);
    frame(100); // 0.9 + 0.2 leaves the segment and comes back at the start
    expect(tOf(store, 'q')).toBeCloseTo(0.1);
  });

  it('wraps a circle parameter into [0, 2π)', () => {
    const store = new Store(preanimated(circleFixture(6.4), 'q', 1, 1));
    attachAnimationClock(store);
    frame(0);
    frame(100);
    expect(tOf(store, 'q')).toBeCloseTo(6.5 - Math.PI * 2);
  });

  it('honours direction, clamps the speed, and caps a stalled frame', () => {
    const store = new Store(preanimated(fixture(), 'q', 99, -1));
    attachAnimationClock(store);
    frame(0);
    frame(100); // a frame's worth: speed clamps to 2, direction −1
    expect(tOf(store, 'q')).toBeCloseTo(0.05);
    frame(5000); // a five-second stall must not teleport the animation, and the
    // negative side wraps like the positive one
    expect(tOf(store, 'q')).toBeCloseTo(0.85);
  });

  it('refuses to animate a selection that has no path parameter', () => {
    const store = new Store(fixture());
    store.setSelection(['p0']);
    toggleAnimate(store);
    expect(recordOf(store.doc, 'p0').display?.animate).toBeUndefined();
    expect(frames.size).toBe(0);
    expect(store.canUndo()).toBe(false); // an edit that changed nothing
  });

  it('stops by itself when the animated object is deleted', () => {
    const store = new Store(preanimated(fixture(), 'q', 1, 1));
    attachAnimationClock(store);
    frame(0);
    frame(100);
    expect(tOf(store, 'q')).toBeCloseTo(0.35);

    store.edit((doc) => {
      doc.objects = doc.objects.filter((o) => o.id !== 'q');
    });
    expect(frames.size).toBe(0);
    expect(cancelled).toHaveLength(1);
  });

  it('is not attached twice by a second call', () => {
    const store = new Store(preanimated(fixture(), 'q', 1, 1));
    attachAnimationClock(store);
    attachAnimationClock(store);
    expect(frames.size).toBe(1);
    frame(0);
    frame(100);
    expect(tOf(store, 'q')).toBeCloseTo(0.35); // one clock, not two
  });
});

describe('the document', () => {
  it('stays plain JSON: no trail, no clock, and erasing traces is not an edit', () => {
    const store = new Store(fixture());
    store.setSelection(['q']);
    toggleTrace(store);
    toggleAnimate(store);
    frame(0);
    frame(100);
    store.setSelection(['q']);
    toggleAnimate(store);

    const json = JSON.stringify(store.doc);
    expect(json).not.toContain('trail');
    expect(JSON.parse(json)).toEqual(store.doc);
    expect(Object.keys(JSON.parse(json) as object)).toEqual(['version', 'viewport', 'objects']);

    const before = JSON.stringify(store.doc);
    eraseTraces(store);
    expect(JSON.stringify(store.doc)).toBe(before);
    expect(store.canUndo()).toBe(true); // erasing added no history of its own
  });
});
