import type { Store } from '../app/store';
import { newId, type Doc, type Id, type Json, type ObjRecord, type Vec2, type Viewport } from '../engine';
import { render } from '../render/canvas';
import { ViewTransform, backingSize, panBy, zoomAt, type ScreenPoint } from '../render/viewport';

/** Finger/pen targets are fatter than mouse targets (DESIGN §3: touch & whiteboard). */
const TOUCH_TOLERANCE_PX = 10;
const MOUSE_TOLERANCE_PX = 6;

/** A press that neither moved nor lingered becomes a tap (creates a point). */
const TAP_SLOP_PX = 4;
const TAP_MS = 250;

const WHEEL_SENSITIVITY = 0.0015;
/** Browsers report a pinch as ctrl+wheel with much smaller deltas. */
const PINCH_WHEEL_SENSITIVITY = 0.01;
/** Guards against a dropped frame turning into a huge pinch jump. */
const MAX_PINCH_STEP = 2;

interface PointerState {
  id: number;
  kind: 'none' | 'drag' | 'pan' | 'dead';
  startCss: ScreenPoint;
  lastCss: ScreenPoint;
  startTime: number;
  /** World offset from the pointer to the grabbed point, so the grip never jumps. */
  grabOffset: Vec2;
  dragId: Id | null;
}

/** A free point's parameters: `point.free` stores exactly `{x, y}` world units. */
function pointParams(rec: ObjRecord | undefined): Vec2 | null {
  const raw: Json | undefined = rec?.params;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const { x, y } = raw;
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
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
 * backed by `store`. Nothing here needs hover or a mode: press a point to drag
 * it, tap empty space to create one, drag empty space to pan, pinch or wheel to
 * zoom.
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

  function beginDrag(state: PointerState, id: Id): void {
    const world = transform().toWorld(state.startCss);
    const at = pointParams(findObject(store.doc, id));
    store.setSelection([id]);
    if (!at) {
      state.kind = 'dead';
      return;
    }
    state.kind = 'drag';
    state.dragId = id;
    state.grabOffset = { x: at.x - world.x, y: at.y - world.y };
    store.begin();
  }

  /** A second finger turns the gesture into a pinch; any drag in flight is settled first. */
  function beginPinch(): void {
    const [a, b] = [...pointers.values()];
    for (const state of pointers.values()) {
      if (state.kind === 'drag') store.commit();
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
      grabOffset: { x: 0, y: 0 },
      dragId: null,
    };
    pointers.set(e.pointerId, state);

    if (pointers.size > 1) {
      beginPinch();
      return;
    }

    const hit = store.pick(
      transform().toWorld(css),
      tolerancePx(e.pointerType) / store.doc.viewport.scale,
    )[0];
    if (hit === undefined) state.kind = 'pan';
    else beginDrag(state, hit);
  }

  function onPointerMove(e: PointerEvent): void {
    const state = pointers.get(e.pointerId);
    if (!state) return;
    const css = eventCss(e);

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

    if (state.kind === 'drag' && state.dragId !== null) {
      const world = transform().toWorld(css);
      const id = state.dragId;
      const grab = state.grabOffset;
      // Absolute from the grab offset, never a snap: the point keeps the grip
      // even when the finger landed slightly off its centre.
      store.mutate((doc) => {
        const rec = findObject(doc, id);
        if (!rec) return;
        rec.params = { x: world.x + grab.x, y: world.y + grab.y };
      });
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

    if (state.kind === 'drag') {
      store.commit();
    } else if (e.type === 'pointerup' && pointers.size === 0 && isTap(state)) {
      createPointAt(state.startCss);
    }

    // Any surviving finger starts a fresh gesture rather than a jumpy half-pinch.
    if (pointers.size < 2) pinch = null;
    for (const rest of pointers.values()) rest.kind = 'dead';
  }

  function isTap(state: PointerState): boolean {
    return (
      state.kind === 'pan' &&
      performance.now() - state.startTime <= TAP_MS &&
      Math.hypot(state.startCss.x - state.lastCss.x, state.startCss.y - state.lastCss.y) <= TAP_SLOP_PX
    );
  }

  function createPointAt(css: ScreenPoint): void {
    const world = transform().toWorld(css);
    store.edit((doc) => {
      doc.objects.push({
        id: newId(),
        type: 'point.free',
        parents: [],
        params: { x: world.x, y: world.y },
        label: { text: nextLabel(doc) },
      });
    });
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
    // M0 has no dependents, so a selected object is removed on its own.
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
