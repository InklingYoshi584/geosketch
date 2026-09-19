import type { Store } from '../app/store';
import {
  isPathGeometry,
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
// The delete tool shares the inspector's cascade-with-preview path, so the
// dependents listed in the confirm and the atomic edit exist in one place (D10).
import { deleteWithPreview } from '../ui/inspector';
import {
  emptyPending,
  finishPending,
  pendingCount,
  reduceClick,
  textRecord,
  type PendingState,
  type Reduction,
} from './tools';

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

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}

/** What the palette or a status line can ask the attached board. */
export interface BoardHandle {
  /** Clicks the active tool is holding (0 when it is waiting for nothing). */
  pendingCount(): number;
}

/**
 * Wires pointer, wheel and keyboard input plus the render loop to a canvas
 * backed by `store`. Nothing here needs hover, and nothing selects by dragging:
 * a tap is the whole vocabulary.
 *
 * The active tool decides what a tap *means* (`./tools.ts`); the board is what
 * applies it — pushes the records through one `store.edit`, sets the selection
 * and, for the delete tool, runs the cascade-with-preview. Keeping the reducer
 * out of the DOM is what lets every tool be tested as a click sequence.
 *
 * Touch-first semantics (DESIGN §2 D6, revised for the tool palette):
 * - `select` (the default): tap an object → toggle it in the selection; tap
 *   empty space → clear the selection;
 * - any other tool: tap → the tool's next click (a free or glued point, a
 *   construction, a measurement, a delete), each creation its own undo entry;
 * - drag an object → grip it, whatever the tool: the selection collapses onto it
 *   unless it was already selected, and free points / points on a path follow
 *   the pointer;
 * - drag empty space → pan; pinch, wheel → zoom;
 * - Escape abandons the clicks a tool is holding, else clears the selection;
 *   Enter closes a pending polygon.
 */
export function attachBoard(canvas: HTMLCanvasElement, store: Store): BoardHandle {
  const pointers = new Map<number, PointerState>();
  let pinch: { dist: number; mid: ScreenPoint } | null = null;

  /** The clicks the active tool is holding; reset whenever the tool changes. */
  let pending: PendingState = emptyPending(store.tool);

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
      if (store.tool === 'select') {
        // A tap on empty space only clears: points come from the palette's
        // point tool now, never from a stray tap.
        if (state.hitId === null) store.setSelection([]);
        else toggleSelection(state.hitId);
      } else {
        applyToolTap(state, e.pointerType);
      }
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

  /**
   * Apply what the reducer decided: the new records are their own undo entry
   * (GSP's "the clicked point is real immediately"), the selection follows the
   * click, and a delete goes through the inspector's cascade-with-preview.
   */
  function applyReduction(result: Reduction): void {
    pending = result.next;
    if (result.remove !== undefined) {
      deleteWithPreview(store, result.remove);
      return;
    }
    if (result.askAt !== undefined) {
      placeText(result.askAt);
      return;
    }
    if (result.created.length > 0) {
      store.edit((doc) => {
        doc.objects.push(...result.created);
      });
    }
    if (result.select !== undefined) store.setSelection(result.select);
  }

  /**
   * The 文本 tool: ask for the string, then put it where the click landed. Only a
   * confirmed answer makes an object — cancelling leaves the figure as it was —
   * and the tool stays armed so a teacher can annotate a whole figure in a row.
   */
  function placeText(at: Vec2): void {
    const text = window.prompt('文本内容', '文本');
    if (text === null) return;
    const record = textRecord(at, text);
    store.edit((doc) => {
      doc.objects.push(record);
    });
    store.setSelection([record.id]);
  }

  /** Hand a tap to the active tool: the press position, and what is under it. */
  function applyToolTap(state: PointerState, pointerType: string): void {
    const world = transform().toWorld(state.startCss);
    const tolWorld = tolerancePx(pointerType) / store.doc.viewport.scale;
    applyReduction(
      reduceClick(
        { doc: store.doc, scene: store.scene, world, hits: store.pick(world, tolWorld) },
        pending,
      ),
    );
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
      // Escape abandons the clicks a tool is holding; with nothing pending it
      // clears the selection, as it always did.
      if (pendingCount(pending) > 0) {
        pending = emptyPending(pending.tool);
        return;
      }
      store.setSelection([]);
      return;
    }
    if (e.key === 'Enter') {
      const result = finishPending(pending);
      // Still the same pending state means no tool has a finish gesture here.
      if (result.next === pending && result.created.length === 0) return;
      e.preventDefault();
      applyReduction(result);
      return;
    }
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    const doomed = new Set(store.selection);
    if (doomed.size === 0) return;
    e.preventDefault();
    // Deliberately single-object: the cascade-with-preview lives where the
    // teacher can see what is about to go (the inspector's 删除 button and the
    // palette's delete tool), not behind a stray Backspace.
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

  store.subscribe(() => {
    // A tool switch abandons the clicks the previous tool was holding: the
    // palette changes tools only through `store.setTool`.
    if (pending.tool !== store.tool) pending = emptyPending(store.tool);
    requestRender();
  });
  syncSize();

  return { pendingCount: () => pendingCount(pending) };
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
