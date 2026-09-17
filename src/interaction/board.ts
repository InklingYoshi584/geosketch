import type { Store } from '../app/store';
import {
  isPathGeometry,
  newId,
  projectPoint,
  type Doc,
  type Id,
  type Json,
  type ObjRecord,
  type Scene,
  type Vec2,
  type Viewport,
} from '../engine';
import { render } from '../render/canvas';
import { ViewTransform, backingSize, panBy, zoomAt, type ScreenPoint } from '../render/viewport';

/** Finger/pen targets are fatter than mouse targets (DESIGN §3: touch & whiteboard). */
const TOUCH_TOLERANCE_PX = 10;
const MOUSE_TOLERANCE_PX = 6;

/** A press that neither travelled nor lingered becomes a tap (see `isTap`). */
const TAP_SLOP_PX = 4;
const TAP_MS = 250;

const WHEEL_SENSITIVITY = 0.0015;
/** Browsers report a pinch as ctrl+wheel with much smaller deltas. */
const PINCH_WHEEL_SENSITIVITY = 0.01;
/** Guards against a dropped frame turning into a huge pinch jump. */
const MAX_PINCH_STEP = 2;

/** How a grabbed object follows the pointer. */
type DragGrip = { kind: 'xy'; offset: Vec2 } | { kind: 'path'; parentId: Id };

interface PointerState {
  id: number;
  /** `drag` grips an object, `pan` is empty-space travel, `dead` is a spent gesture. */
  kind: 'none' | 'drag' | 'pan' | 'dead';
  startCss: ScreenPoint;
  lastCss: ScreenPoint;
  startTime: number;
  /** Set once the press has travelled past the tap slop. */
  moved: boolean;
  /** The object under the press; `null` is empty space. */
  hitId: Id | null;
  /** Selection state of `hitId` at press time — a tap toggles exactly that. */
  hitWasSelected: boolean;
  grip: DragGrip | null;
}

/** A free point's parameters: `point.free` stores exactly `{x, y}` world units. */
function pointParams(rec: ObjRecord | undefined): Vec2 | null {
  const raw: Json | undefined = rec?.params;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const { x, y } = raw;
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/** Read one finite numeric parameter, or `null` when it is missing or unusable. */
function paramNumber(rec: ObjRecord, key: string): number | null {
  const raw: Json | undefined = rec.params;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const value = raw[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * How a grabbed object can move, or `null` when it has no draggable parameters
 * (segments, circles, polygons, readouts: selectable but not movable).
 *
 * Two shapes exist: a free point follows the pointer by `{x, y}`, a point glued
 * to a path by its re-projected `{t}` parameter.
 */
function dragGrip(rec: ObjRecord, scene: Scene, world: Vec2): DragGrip | null {
  if (paramNumber(rec, 't') !== null && rec.parents.length > 0) {
    const parentId = rec.parents[0];
    const path = scene.geoms.get(parentId);
    if (path !== undefined && isPathGeometry(path)) return { kind: 'path', parentId };
  }
  const at = pointParams(rec);
  if (at === null) return null;
  return { kind: 'xy', offset: { x: at.x - world.x, y: at.y - world.y } };
}

function findObject(doc: Doc, id: Id): ObjRecord | undefined {
  return doc.objects.find((o) => o.id === id);
}

/** A…Z, then A1, B1, … — the labels a geometry teacher expects. */
function labelAt(index: number): string {
  const letter = String.fromCharCode(65 + (index % 26));
  return index < 26 ? letter : `${letter}${Math.floor(index / 26)}`;
}

function nextLabel(doc: Doc): string {
  const used = new Set<string>();
  for (const o of doc.objects) {
    if (o.label?.text) used.add(o.label.text);
  }
  let i = 0;
  while (used.has(labelAt(i))) i += 1;
  return labelAt(i);
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}

/**
 * Wires pointer, wheel and keyboard input plus the render loop to a canvas
 * backed by `store`. Nothing here needs hover or a mode, and nothing selects by
 * dragging: the selection is built by taps and read by the action bar.
 *
 * Touch-first semantics (DESIGN §2 D6):
 * - tap empty space → create a free point *and* add it to the selection, so
 *   three taps plus one action button make a triangle;
 * - tap an object → toggle it in the selection (append, else remove);
 * - drag an object → grip it: the selection collapses onto it unless it was
 *   already selected, and free points / points on a path follow the pointer;
 * - drag empty space → pan; pinch, wheel → zoom; Escape clears the selection.
 */
export function attachBoard(canvas: HTMLCanvasElement, store: Store): void {
  const pointers = new Map<number, PointerState>();
  let pinch: { dist: number; mid: ScreenPoint } | null = null;

  let cssWidth = 1;
  let cssHeight = 1;
  let dpr = 1;
  let rect = canvas.getBoundingClientRect();

  let frame = 0;

  /** Store notifications arrive far faster than frames; collapse them into one. */
  function requestRender(): void {
    if (frame !== 0) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      render(canvas, store);
    });
  }

  function transform(): ViewTransform {
    return new ViewTransform(store.doc.viewport, cssWidth, cssHeight, dpr);
  }

  function syncSize(): void {
    rect = canvas.getBoundingClientRect();
    cssWidth = Math.max(1, rect.width);
    cssHeight = Math.max(1, rect.height);
    dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    const { width, height } = backingSize(cssWidth, cssHeight, dpr);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    requestRender();
  }

  function eventCss(e: { clientX: number; clientY: number }): ScreenPoint {
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function setViewport(vp: Viewport): void {
    const usable =
      Number.isFinite(vp.cx) && Number.isFinite(vp.cy) && Number.isFinite(vp.scale) && vp.scale > 0;
    if (usable) store.setViewport(vp);
  }

  /** Move the gripped object so it follows the pointer. */
  function dragTo(state: PointerState, world: Vec2): void {
    const id = state.hitId;
    const grip = state.grip;
    if (id === null || grip === null) return;

    if (grip.kind === 'xy') {
      const offset = grip.offset;
      store.mutate((doc) => {
        const rec = findObject(doc, id);
        if (rec !== undefined) rec.params = { x: world.x + offset.x, y: world.y + offset.y };
      });
      return;
    }

    // Re-project onto the path as it is *now* (the parent may itself have moved
    // during this gesture), and store the parameter — never a position.
    const path = store.scene.geoms.get(grip.parentId);
    if (path === undefined || !isPathGeometry(path)) return;
    const t = projectPoint(path, world);
    store.mutate((doc) => {
      const rec = findObject(doc, id);
      if (rec !== undefined) rec.params = { t };
    });
  }

  /** A second finger turns the gesture into a pinch; any drag in flight is settled first. */
  function beginPinch(): void {
    const [a, b] = [...pointers.values()];
    for (const state of pointers.values()) {
      if (state.grip !== null) store.commit();
      state.kind = 'dead';
    }
    pinch = { dist: Math.hypot(a.lastCss.x - b.lastCss.x, a.lastCss.y - b.lastCss.y), mid: midpoint(a.lastCss, b.lastCss) };
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    rect = canvas.getBoundingClientRect();
    const css = eventCss(e);
    canvas.setPointerCapture(e.pointerId);

    const state: PointerState = {
      id: e.pointerId,
      kind: 'none',
      startCss: css,
      lastCss: css,
      startTime: performance.now(),
      moved: false,
      hitId: null,
      hitWasSelected: false,
      grip: null,
    };
    pointers.set(e.pointerId, state);

    if (pointers.size > 1) {
      beginPinch();
      return;
    }

    const world = transform().toWorld(css);
    const hit = store.pick(
      world,
      tolerancePx(e.pointerType) / store.doc.viewport.scale,
    )[0];
    const rec = hit === undefined ? undefined : findObject(store.doc, hit);
    if (hit === undefined || rec === undefined) {
      state.kind = 'pan';
      return;
    }

    // Pressing an object opens a gesture that is either a grip (once it moves)
    // or a selection toggle (if it is released without moving). The selection is
    // deliberately left alone here, so a tap can append to it.
    state.kind = 'drag';
    state.hitId = hit;
    state.hitWasSelected = store.selection.has(hit);
    const grip = dragGrip(rec, store.scene, world);
    if (grip === null) return; // selectable, but nothing to move
    state.grip = grip;
    store.begin();
  }

  function onPointerMove(e: PointerEvent): void {
    const state = pointers.get(e.pointerId);
    if (!state) return;
    const css = eventCss(e);

    if (!state.moved && Math.hypot(css.x - state.startCss.x, css.y - state.startCss.y) > TAP_SLOP_PX) {
      state.moved = true;
      // The grip owns the selection; a multi-selection survives only when the
      // grabbed object was already part of it.
      if (state.kind === 'drag' && state.hitId !== null && !state.hitWasSelected) {
        store.setSelection([state.hitId]);
      }
    }

    if (pinch && pointers.size === 2) {
      state.lastCss = css;
      applyPinch();
      return;
    }

    if (state.kind === 'pan') {
      setViewport(panBy(store.doc.viewport, css.x - state.lastCss.x, css.y - state.lastCss.y));
      state.lastCss = css;
      return;
    }

    if (state.kind === 'drag') {
      dragTo(state, transform().toWorld(css));
      state.lastCss = css;
    }
  }

  function applyPinch(): void {
    if (!pinch) return;
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.lastCss.x - b.lastCss.x, a.lastCss.y - b.lastCss.y);
    const mid = midpoint(a.lastCss, b.lastCss);
    if (pinch.dist >= 1 && dist >= 1) {
      const factor = clampPinchStep(dist / pinch.dist);
      const zoomed = zoomAt(store.doc.viewport, mid, factor, cssWidth, cssHeight);
      setViewport(panBy(zoomed, mid.x - pinch.mid.x, mid.y - pinch.mid.y));
    }
    pinch = { dist, mid };
  }

  function onPointerUp(e: PointerEvent): void {
    const state = pointers.get(e.pointerId);
    if (!state) return;
    pointers.delete(e.pointerId);
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);

    if (state.kind === 'drag' && state.grip !== null) store.commit();

    if (e.type === 'pointerup' && pointers.size === 0 && isTap(state)) {
      if (state.hitId === null) createPointAt(state.startCss);
      else toggleSelection(state.hitId);
    }

    // Any surviving finger starts a fresh gesture rather than a jumpy half-pinch.
    if (pointers.size < 2) pinch = null;
    for (const rest of pointers.values()) rest.kind = 'dead';
  }

  function isTap(state: PointerState): boolean {
    return (
      (state.kind === 'pan' || state.kind === 'drag') &&
      !state.moved &&
      performance.now() - state.startTime <= TAP_MS
    );
  }

  /** Toggle an object in the selection; the set remembers click order. */
  function toggleSelection(id: Id): void {
    const next = new Set(store.selection);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    store.setSelection([...next]);
  }

  function createPointAt(css: ScreenPoint): void {
    const world = transform().toWorld(css);
    const id = newId();
    store.edit((doc) => {
      doc.objects.push({
        id,
        type: 'point.free',
        parents: [],
        params: { x: world.x, y: world.y },
        label: { text: nextLabel(doc) },
      });
    });
    // The fresh point joins the selection, so a run of taps can be turned into a
    // construction with one action.
    store.setSelection([...store.selection, id]);
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? cssHeight : 1;
    const sensitivity = e.ctrlKey ? PINCH_WHEEL_SENSITIVITY : WHEEL_SENSITIVITY;
    rect = canvas.getBoundingClientRect();
    setViewport(
      zoomAt(
        store.doc.viewport,
        eventCss(e),
        Math.exp(-e.deltaY * unit * sensitivity),
        cssWidth,
        cssHeight,
      ),
    );
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (isTypingTarget(e.target)) return;
    if (e.key === 'Escape') {
      store.setSelection([]);
      return;
    }
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    const doomed = new Set(store.selection);
    if (doomed.size === 0) return;
    e.preventDefault();
    // M1 has no dependents yet, so a selected object is removed on its own;
    // cascade deletion arrives with the dependency graph.
    store.edit((doc) => {
      doc.objects = doc.objects.filter((o) => !doomed.has(o.id));
    });
    store.setSelection([]);
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', syncSize);

  new ResizeObserver(syncSize).observe(canvas);

  store.subscribe(requestRender);
  syncSize();
}

function tolerancePx(pointerType: string): number {
  return pointerType === 'mouse' ? MOUSE_TOLERANCE_PX : TOUCH_TOLERANCE_PX;
}

function midpoint(a: ScreenPoint, b: ScreenPoint): ScreenPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function clampPinchStep(factor: number): number {
  if (!Number.isFinite(factor) || factor <= 0) return 1;
  return Math.min(MAX_PINCH_STEP, Math.max(1 / MAX_PINCH_STEP, factor));
}
