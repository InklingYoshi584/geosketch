/**
 * Display operations (DESIGN.md §8.1 「显示」): hide, trace, animate, erase.
 *
 * These are *presentation* commands over the ordinary document — they never
 * introduce a new object type. The flags they flip live in `ObjRecord.display`
 * and are part of the sketch (so undo covers them); what a flag *produces* is
 * session state:
 *
 * - a **trail** is a bounded ring buffer of an object's past geometries, held
 *   here per store and never serialised (DESIGN.md §5 "trace = bounded ring
 *   buffer of past geometries per traced object");
 * - the **animation clock** is a `requestAnimationFrame` loop that advances the
 *   path parameter `t` of every running `point.onObject`, inside one store
 *   transaction opened when the animation starts and committed when it stops —
 *   so a whole run collapses into a single undo entry.
 *
 * Every document mutation goes through `store.edit`/`store.mutate`, so a command
 * is one undo entry and the clock's run is one.
 *
 * Hidden objects are skipped by the renderer (`render/canvas.ts`) and excluded
 * from picking (the store's `pick` filters via `hiddenIds`); they keep
 * computing, so dependents keep working (D9's cousin: hiding is a display fact,
 * never a modelling one).
 */
import type { Store } from '../app/store';
import {
  DEFAULT_VIEWPORT,
  isPathGeometry,
  type Doc,
  type Geometry,
  type Id,
  type Json,
  type ObjRecord,
  type PathGeometry,
  type Scene,
  type Vec2,
} from '../engine';

/** The document's display flags — `ObjRecord['display']`, without the barrel. */
type Display = NonNullable<ObjRecord['display']>;

/** How many past geometries one traced object keeps, oldest dropped first. */
const TRACE_CAPACITY = 120;

/** The frozen animation rules: parameter units per second, clamped. */
const DEFAULT_SPEED = 0.5;
const MIN_SPEED = 0.01;
const MAX_SPEED = 2;

/** A stalled frame must not teleport an animation; longer gaps advance this much. */
const MAX_FRAME_SECONDS = 0.1;

/**
 * The world span an animation traverses along an *unbounded* path (a line or a
 * ray), in CSS pixels at the current viewport scale. Animated parameters must
 * stay bounded or a point on a line would drift off the board, and the visible
 * board is a board's width — this is that board, expressed in pixels.
 */
const ANIMATION_SPAN_PX = 640;

const TWO_PI = Math.PI * 2;

/** The empty trace table handed out for a store that never traced anything. */
const NO_TRACES: ReadonlyMap<Id, readonly Geometry[]> = new Map();

// ---------------------------------------------------------------------------
// Trails
// ---------------------------------------------------------------------------

/**
 * A bounded ring of past geometries for one traced object: the last
 * `TRACE_CAPACITY` *distinct* samples, oldest first. Geometries are cloned on
 * the way in, so a later recompute can never rewrite what the trail shows.
 */
class Ring {
  private items: Geometry[] = [];
  /** Where the next push overwrites, once the ring has wrapped. */
  private next = 0;
  /** The newest sample, kept only to drop consecutive duplicates. */
  private last: Geometry | undefined;
  private view: readonly Geometry[] | null = null;

  /** Record `geom`; `false` when it repeats the newest sample (nothing changed). */
  push(geom: Geometry): boolean {
    if (this.last !== undefined && sameGeometry(this.last, geom)) return false;
    const copy = cloneGeometry(geom);
    this.last = copy;
    if (this.items.length < TRACE_CAPACITY) this.items.push(copy);
    else {
      this.items[this.next] = copy;
      this.next = (this.next + 1) % TRACE_CAPACITY;
    }
    this.view = null;
    return true;
  }

  /** Chronological snapshot (oldest first); the same array until the next push. */
  read(): readonly Geometry[] {
    if (this.view === null) {
      this.view =
        this.next === 0
          ? [...this.items]
          : [...this.items.slice(this.next), ...this.items.slice(0, this.next)];
    }
    return this.view;
  }

  /**
   * Forget every sample. The newest one stays the duplicate baseline, so a
   * motionless object does not immediately re-seed the trail it just lost.
   */
  clear(): void {
    this.items = [];
    this.next = 0;
    this.view = null;
  }
}

/**
 * Everything one store's display operations need: its trail table plus the
 * animation loop's bookkeeping. Held in a `WeakMap`, so a discarded store takes
 * its trails and its clock with it.
 */
interface Attachment {
  /** The renderer's view: id → past geometries, oldest first. Mutated in place. */
  readonly traces: Map<Id, readonly Geometry[]>;
  readonly buffers: Map<Id, Ring>;
  /** Pending frame handle; 0 when the loop is idle. */
  frame: number;
  /**
   * Timestamp of the previous frame; `null` means "the next frame advances
   * nothing". Not `0`: a clock reading a frame stamped 0 is exactly the case
   * this sentinel exists to notice.
   */
  lastTs: number | null;
  /** Whether this attachment currently holds an open store transaction. */
  open: boolean;
}

const attachments = new WeakMap<Store, Attachment>();

/**
 * The trail of every traced object of `store`, oldest first, for the renderer.
 * Board-local and never serialised; the map is stable, entries appear and
 * disappear as tracing is turned on and off.
 */
export function tracesOf(store: Store): ReadonlyMap<Id, readonly Geometry[]> {
  return attachments.get(store)?.traces ?? NO_TRACES;
}

/** Ids the document hides (DESIGN.md §8.1 显示 › 隐藏). */
export function hiddenIds(doc: Doc): ReadonlySet<Id> {
  const hidden = new Set<Id>();
  for (const rec of doc.objects) if (rec.display?.hidden === true) hidden.add(rec.id);
  return hidden;
}

// ---------------------------------------------------------------------------
// Display commands
// ---------------------------------------------------------------------------

/**
 * 隐藏/显示: flip the `hidden` flag of every selected object (each is toggled
 * independently, so a mixed selection becomes fully hidden or fully shown).
 * Hidden objects keep computing — only the renderer and the pointer ignore
 * them. One undo entry.
 */
export function toggleHidden(store: Store): void {
  const targets = new Set(store.selection);
  if (targets.size === 0) return;
  store.edit((doc) => {
    for (const rec of doc.objects) {
      if (!targets.has(rec.id)) continue;
      setFlag(rec, 'hidden', rec.display?.hidden !== true);
    }
  });
}

/**
 * 显示全部隐藏: clear every hidden flag in one edit. Nothing is hidden → no
 * undo entry (the store diffs snapshots for us).
 */
export function showAllHidden(store: Store): void {
  store.edit((doc) => {
    for (const rec of doc.objects) clearFlag(rec, 'hidden');
  });
}

/**
 * 追踪: flip the `trace` flag of every selected object. Turning tracing on
 * seeds the trail with the object's current geometry (the store's edit notifies
 * the recorder); turning it off drops that object's trail, since a trail with
 * no tracer would otherwise reappear stale the next time tracing is enabled.
 * One undo entry; the trail itself is session state and is never undone.
 */
export function toggleTrace(store: Store): void {
  const targets = new Set(store.selection);
  if (targets.size === 0) return;
  const state = attach(store);
  const dropped: Id[] = [];
  store.edit((doc) => {
    for (const rec of doc.objects) {
      if (!targets.has(rec.id)) continue;
      if (rec.display?.trace === true) {
        clearFlag(rec, 'trace');
        dropped.push(rec.id);
      } else {
        setFlag(rec, 'trace', true);
      }
    }
  });
  for (const id of dropped) dropTrail(state, id);
}

/**
 * 擦除痕迹: empty every trail, leaving each traced object recording from its next
 * move. Trails are not document state, so this is not an undoable edit — but the
 * board repaints on store notifications, and without one the erased trail would
 * linger on screen until the next unrelated change.
 */
export function eraseTraces(store: Store): void {
  const state = attachments.get(store);
  if (state !== undefined) {
    for (const [id, buffer] of state.buffers) {
      buffer.clear();
      state.traces.set(id, buffer.read());
    }
  }
  store.mutate(() => {});
}

/**
 * 动画: flip the running state of every selected object's animation. Starting
 * only marks objects that can actually move (a numeric path parameter `t` with
 * a parameterised parent path); stopping clears the flag of the whole selection.
 *
 * The flag flip happens **inside** the run's transaction, and the transaction is
 * opened *before* the flag goes on, so its baseline carries `running: false` and
 * the parameter where the run starts. One undo therefore returns the flag *and*
 * everything the run moved — undoing a stopped animation cannot leave a live
 * `running: true` behind and silently start the motion again. A run of several
 * objects is one transaction, so stopping one of them keeps it open until the
 * last one stops.
 */
export function toggleAnimate(store: Store): void {
  const targets = new Set(store.selection);
  if (targets.size === 0) return;
  const state = attach(store);
  const stopping = store.doc.objects.some(
    (rec) => targets.has(rec.id) && rec.display?.animate?.running === true,
  );
  const flip = (doc: Doc): void => {
    for (const rec of doc.objects) {
      if (!targets.has(rec.id)) continue;
      if (stopping) stopAnimation(rec);
      else startAnimation(rec, store.scene);
    }
  };

  if (!stopping) {
    // Nothing selected can move: no flag to set, and no transaction to open.
    const movable = store.doc.objects.some(
      (rec) => targets.has(rec.id) && animatablePath(rec, store.scene) !== undefined,
    );
    if (!movable) return;
    store.begin();
    state.open = true;
    store.mutate(flip);
    return;
  }

  // A run in flight already owns the transaction, so the flag flip goes inside
  // it. The clock commits that transaction the moment *nothing* is animating
  // any more — with this flip being the last, its commit happens during the
  // notification below, and the baseline it pushes carries `running: false`.
  if (state.open) store.mutate(flip);
  else store.edit(flip);
}

/**
 * Start the animation clock for `store` (idempotent). The clock also watches
 * the store, so an animation that arrives with a loaded document starts on its
 * own; calling this simply guarantees the watch is installed.
 */
export function attachAnimationClock(store: Store): void {
  attach(store);
}

// ---------------------------------------------------------------------------
// The animation clock
// ---------------------------------------------------------------------------

function attach(store: Store): Attachment {
  const existing = attachments.get(store);
  if (existing !== undefined) return existing;
  const state: Attachment = {
    traces: new Map(),
    buffers: new Map(),
    frame: 0,
    lastTs: null,
    open: false,
  };
  attachments.set(store, state);
  // One subscription powers both halves: trails record on every change, and the
  // clock starts or stops whenever the set of running animations changes.
  store.subscribe(() => {
    recordTraces(store, state);
    syncClock(store, state);
  });
  recordTraces(store, state);
  syncClock(store, state);
  return state;
}

/** Record the current geometry of every traced object; prune trails that ended. */
function recordTraces(store: Store, state: Attachment): void {
  const buffers = state.buffers;
  const live = buffers.size > 0 ? new Set<Id>() : null;
  for (const rec of store.doc.objects) {
    if (rec.display?.trace !== true) continue;
    const geom = store.scene.geoms.get(rec.id);
    if (geom === undefined) continue;
    live?.add(rec.id);
    let buffer = buffers.get(rec.id);
    if (buffer === undefined) {
      buffer = new Ring();
      buffers.set(rec.id, buffer);
    }
    if (buffer.push(geom)) state.traces.set(rec.id, buffer.read());
  }
  if (live === null) return;
  for (const id of [...buffers.keys()]) {
    if (!live.has(id)) dropTrail(state, id);
  }
}

function dropTrail(state: Attachment, id: Id): void {
  state.buffers.delete(id);
  state.traces.delete(id);
}

/** Start or stop the loop so that it runs exactly while something is animated. */
function syncClock(store: Store, state: Attachment): void {
  if (hasRunning(store)) startClock(store, state);
  else stopClock(store, state);
}

/** Whether any object is both marked running and actually able to move. */
function hasRunning(store: Store): boolean {
  return store.doc.objects.some(
    (rec) =>
      rec.display?.animate?.running === true && animatablePath(rec, store.scene) !== undefined,
  );
}

function startClock(store: Store, state: Attachment): void {
  if (state.frame !== 0) return;
  state.lastTs = null;
  state.frame = schedule((ts) => onFrame(store, state, ts));
}

function stopClock(store: Store, state: Attachment): void {
  if (state.frame !== 0) {
    if (typeof globalThis.cancelAnimationFrame === 'function') {
      globalThis.cancelAnimationFrame(state.frame);
    }
    state.frame = 0;
  }
  if (!state.open) return;
  state.open = false;
  store.commit();
}

function onFrame(store: Store, state: Attachment, ts: number): void {
  // `state.frame` stays non-zero for the whole callback, so a store
  // notification raised by `advance` cannot schedule a second loop on top of
  // this one — `startClock` returns early while a frame is in flight.
  const elapsed = state.lastTs === null ? 0 : (ts - state.lastTs) / 1000;
  // A stalled tab must not teleport an animation: a long gap advances a frame's
  // worth at most.
  const dt = Number.isFinite(elapsed) && elapsed > 0 ? Math.min(elapsed, MAX_FRAME_SECONDS) : 0;
  state.lastTs = ts;
  if (dt > 0) advance(store, state, dt);
  if (!hasRunning(store)) {
    state.frame = 0;
    stopClock(store, state);
    return;
  }
  state.frame = schedule((next) => onFrame(store, state, next));
}

/** Advance every running animation by `dt` seconds, in one in-transaction pass. */
function advance(store: Store, state: Attachment, dt: number): void {
  if (!state.open) {
    // The start command already opened the run's transaction; this is the other
    // way a run begins — a document that arrives with `running: true` (a loaded
    // file, an undone redo). Opening it here keeps *any* run one undo entry,
    // while a run that never moves (or stops before its first frame) leaves
    // nothing behind.
    store.begin();
    state.open = true;
  }
  const scale = store.doc.viewport.scale;
  store.mutate((doc) => {
    for (const rec of doc.objects) {
      const animate = rec.display?.animate;
      if (animate?.running !== true) continue;
      const t = paramNumber(rec, 't');
      if (t === null) continue;
      // The path is read from the scene this frame started with: every animated
      // record is advanced from the same snapshot rather than from the object
      // next to it.
      const parentId = rec.parents[0];
      const path = parentId === undefined ? undefined : store.scene.geoms.get(parentId);
      if (path === undefined || !isPathGeometry(path)) continue;
      const speed = clampSpeed(animate.speed);
      const dir = animate.dir === -1 ? -1 : 1;
      setParam(rec, 't', wrapParameter(path, t + speed * dir * dt, scale));
    }
  });
}

/**
 * Fold an advanced path parameter back into the kind's traversal window, so an
 * animation loops instead of falling off the end of a finite path:
 *
 * - segment `[0, 1)` — a point leaves one end and comes back at the other;
 * - circle `[0, 2π)` — it keeps going round;
 * - ray `[0, L)`, line `[−L, L)` — unbounded paths have no end of their own, so
 *   the window is the world span of a board's width at the current viewport
 *   scale (`ANIMATION_SPAN_PX`): the point traverses the visible board and
 *   reappears at the far end rather than drifting off into nowhere.
 *
 * A parameter that is not finite folds to the window's start: a malformed
 * document can never put a NaN into `params.t`.
 */
function wrapParameter(path: PathGeometry, t: number, scale: number): number {
  if (!Number.isFinite(t)) return 0;
  switch (path.kind) {
    case 'segment':
      return wrapInto(t, 0, 1);
    case 'circle':
      return wrapInto(t, 0, TWO_PI);
    case 'ray':
      return wrapInto(t, 0, lineSpan(scale));
    case 'line': {
      const half = lineSpan(scale) / 2;
      return wrapInto(t, -half, half * 2);
    }
  }
}

/** The trajectory length an animation covers on a line or ray, in world units. */
function lineSpan(scale: number): number {
  const usable = Number.isFinite(scale) && scale > 0 ? scale : DEFAULT_VIEWPORT.scale;
  return ANIMATION_SPAN_PX / usable;
}

/** Wrap `t` into `[from, from + span)`; `span` means "cannot move". */
function wrapInto(t: number, from: number, span: number): number {
  if (!(span > 0) || !Number.isFinite(span)) return from;
  const offset = (t - from) % span;
  return (offset < 0 ? offset + span : offset) + from;
}

function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return DEFAULT_SPEED;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));
}

function schedule(fn: (ts: number) => void): number {
  return typeof globalThis.requestAnimationFrame === 'function'
    ? globalThis.requestAnimationFrame(fn)
    : 0;
}

// ---------------------------------------------------------------------------
// Flags, parameters and geometry copies
// ---------------------------------------------------------------------------

/** The path a `point.onObject` rides, or `undefined` if it cannot be animated. */
function animatablePath(rec: ObjRecord, scene: Scene): PathGeometry | undefined {
  if (paramNumber(rec, 't') === null) return undefined;
  const parentId = rec.parents[0];
  const path = parentId === undefined ? undefined : scene.geoms.get(parentId);
  return path !== undefined && isPathGeometry(path) ? path : undefined;
}

function startAnimation(rec: ObjRecord, scene: Scene): void {
  if (animatablePath(rec, scene) === undefined) return;
  const previous = rec.display?.animate;
  rec.display = {
    ...rec.display,
    animate: {
      running: true,
      speed: clampSpeed(previous?.speed ?? DEFAULT_SPEED),
      dir: previous?.dir === -1 ? -1 : 1,
    },
  };
}

/** Stop an animation but keep its speed and direction for the next start. */
function stopAnimation(rec: ObjRecord): void {
  const animate = rec.display?.animate;
  if (animate === undefined || animate.running === false) return;
  rec.display = { ...rec.display, animate: { ...animate, running: false } };
}

function setFlag(rec: ObjRecord, key: 'hidden' | 'trace', value: boolean): void {
  rec.display = { ...rec.display, [key]: value };
}

/** Drop one flag, and the whole `display` object when nothing is left in it. */
function clearFlag(rec: ObjRecord, key: 'hidden' | 'trace'): void {
  const display = rec.display;
  if (display === undefined || display[key] === undefined) return;
  const next: Display = { ...display };
  delete next[key];
  rec.display = isEmptyDisplay(next) ? undefined : next;
}

function isEmptyDisplay(display: Display): boolean {
  return display.hidden === undefined && display.trace === undefined && display.animate === undefined;
}

/** Read one finite numeric parameter, or `null` when it is missing or unusable. */
function paramNumber(rec: ObjRecord, key: string): number | null {
  const raw: Json | undefined = rec.params;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const value = raw[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Write one numeric parameter, preserving the object's other parameters. */
function setParam(rec: ObjRecord, key: string, value: number): void {
  const params = rec.params;
  if (typeof params === 'object' && params !== null && !Array.isArray(params)) {
    params[key] = value;
    return;
  }
  rec.params = { [key]: value };
}

function sameVec(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}

function copyVec(v: Vec2): Vec2 {
  return { x: v.x, y: v.y };
}

/** Value equality, used to keep a motionless object from filling its own trail. */
function sameGeometry(a: Geometry, b: Geometry): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'point':
      return b.kind === 'point' && sameVec(a.at, b.at);
    case 'segment':
      return b.kind === 'segment' && sameVec(a.a, b.a) && sameVec(a.b, b.b);
    case 'line':
    case 'ray':
      return (
        (b.kind === 'line' || b.kind === 'ray') && sameVec(a.at, b.at) && sameVec(a.dir, b.dir)
      );
    case 'circle':
      return b.kind === 'circle' && sameVec(a.center, b.center) && a.radius === b.radius;
    case 'polygon': {
      if (b.kind !== 'polygon' || a.points.length !== b.points.length) return false;
      for (let i = 0; i < a.points.length; i += 1) {
        if (!sameVec(a.points[i], b.points[i])) return false;
      }
      return true;
    }
    case 'arc':
      return (
        b.kind === 'arc' &&
        sameVec(a.center, b.center) &&
        a.radius === b.radius &&
        a.from === b.from &&
        a.to === b.to
      );
    case 'text':
      return b.kind === 'text' && sameVec(a.at, b.at) && a.text === b.text;
    case 'number':
      return b.kind === 'number' && a.value === b.value && a.unit === b.unit;
  }
}

/** A deep copy, so a recorded sample survives the next recompute untouched. */
function cloneGeometry(geom: Geometry): Geometry {
  switch (geom.kind) {
    case 'point':
      return { kind: 'point', at: copyVec(geom.at) };
    case 'segment':
      return { kind: 'segment', a: copyVec(geom.a), b: copyVec(geom.b) };
    case 'line':
      return { kind: 'line', at: copyVec(geom.at), dir: copyVec(geom.dir) };
    case 'ray':
      return { kind: 'ray', at: copyVec(geom.at), dir: copyVec(geom.dir) };
    case 'circle':
      return { kind: 'circle', center: copyVec(geom.center), radius: geom.radius };
    case 'polygon':
      return { kind: 'polygon', points: geom.points.map(copyVec) };
    case 'arc':
      return {
        kind: 'arc',
        center: copyVec(geom.center),
        radius: geom.radius,
        from: geom.from,
        to: geom.to,
      };
    case 'text':
      return { kind: 'text', at: copyVec(geom.at), text: geom.text };
    case 'number':
      return geom.unit === undefined
        ? { kind: 'number', value: geom.value }
        : { kind: 'number', value: geom.value, unit: geom.unit };
  }
}
