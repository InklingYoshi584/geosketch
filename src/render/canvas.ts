import type { Store } from '../app/store';
import type { Geometry, ObjRecord, Vec2 } from '../engine';
import { ViewTransform, backingSize, type ScreenPoint } from './viewport';

const GRID_COLOR = '#e5e7eb';
const AXIS_COLOR = '#9ca3af';
const INK_COLOR = '#1a1a1a';
const SELECTION_COLOR = '#2563eb';
const HOLLOW_FILL = '#ffffff';
const LABEL_FONT_STACK = '"Times New Roman", "Songti SC", Georgia, serif';

/** Grid lines land 40–120 CSS px apart; the "nice" steps are 1/2/5 × 10ⁿ. */
const GRID_MIN_PX = 40;
const GRID_MAX_PX = 120;
/** Past this zoom a grid is unreadable noise, so it is skipped entirely. */
const GRID_SCALE_LIMIT = 1e3;

const DEFAULT_POINT_RADIUS = 3.5;
const DEFAULT_LABEL_DX = 8;
const DEFAULT_LABEL_DY = -8;
const DEFAULT_LABEL_SIZE = 14;
const HOLLOW_STROKE_WIDTH = 1.5;
const SELECTION_GAP_PX = 3;
const SELECTION_WIDTH_PX = 2;

/**
 * Draws one frame of the board: background grid, world axes, then every object
 * of `store.doc` in document order (which is also draw order), finished by the
 * selection rings. Touches nothing but the canvas, and is safe to call at any
 * time — an empty document or empty scene renders an empty grid.
 *
 * The CSS-pixel viewport is set up as `(0,0)` = canvas top-left with the
 * coordinate system already scaled by the device pixel ratio, so every length
 * below is a CSS pixel.
 */
export function render(canvas: HTMLCanvasElement, store: Store): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const rect = canvas.getBoundingClientRect();
  const cssWidth = Math.max(1, rect.width);
  const cssHeight = Math.max(1, rect.height);
  const dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  const { width, height } = backingSize(cssWidth, cssHeight, dpr);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const t = new ViewTransform(store.doc.viewport, cssWidth, cssHeight, dpr);
  drawGrid(ctx, t);
  drawAxes(ctx, t);
  drawObjects(ctx, t, store);
  drawSelectionRings(ctx, t, store);
}

/** World spacing of the grid, or `null` when no sensible spacing exists. */
function gridSpacing(scale: number): number | null {
  if (!Number.isFinite(scale) || scale <= 0 || scale > GRID_SCALE_LIMIT) return null;
  let decade = Math.pow(10, Math.floor(Math.log10(GRID_MIN_PX / scale)));
  for (let step = 0; step < 3; step++) {
    for (const mantissa of [1, 2, 5]) {
      const spacing = mantissa * decade;
      const px = spacing * scale;
      if (px >= GRID_MIN_PX) return px <= GRID_MAX_PX ? spacing : null;
    }
    decade *= 10;
  }
  return null;
}

function drawGrid(ctx: CanvasRenderingContext2D, t: ViewTransform): void {
  const spacing = gridSpacing(t.viewport.scale);
  if (spacing === null) return;

  const b = t.visibleBounds();
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let k = Math.ceil(b.minX / spacing); k <= b.maxX / spacing; k++) {
    const x = Math.round(t.toScreen({ x: k * spacing, y: 0 }).x) + 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, t.cssHeight);
  }
  for (let k = Math.ceil(b.minY / spacing); k <= b.maxY / spacing; k++) {
    const y = Math.round(t.toScreen({ x: 0, y: k * spacing }).y) + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(t.cssWidth, y);
  }
  ctx.stroke();
}

function drawAxes(ctx: CanvasRenderingContext2D, t: ViewTransform): void {
  const b = t.visibleBounds();
  const origin = t.toScreen({ x: 0, y: 0 });
  ctx.strokeStyle = AXIS_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (b.minY <= 0 && b.maxY >= 0) {
    const y = Math.round(origin.y) + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(t.cssWidth, y);
  }
  if (b.minX <= 0 && b.maxX >= 0) {
    const x = Math.round(origin.x) + 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, t.cssHeight);
  }
  ctx.stroke();
}

function drawObjects(ctx: CanvasRenderingContext2D, t: ViewTransform, store: Store): void {
  for (const rec of store.doc.objects) {
    const at = pointAt(store.scene.geoms.get(rec.id));
    if (!at) continue;
    const screen = t.toScreen(at);
    drawPoint(ctx, rec, screen);
    drawLabel(ctx, rec, screen);
  }
}

function drawPoint(ctx: CanvasRenderingContext2D, rec: ObjRecord, at: ScreenPoint): void {
  const radius = finiteOr(rec.style?.pointSize, DEFAULT_POINT_RADIUS);
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius > 0 ? radius : DEFAULT_POINT_RADIUS, 0, Math.PI * 2);
  if (rec.style?.hollow) {
    ctx.fillStyle = HOLLOW_FILL;
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = HOLLOW_STROKE_WIDTH;
    ctx.stroke();
    return;
  }
  ctx.fillStyle = INK_COLOR;
  ctx.fill();
}

function drawLabel(ctx: CanvasRenderingContext2D, rec: ObjRecord, at: ScreenPoint): void {
  const label = rec.label;
  if (!label?.text) return;
  const size = finiteOr(label.size, DEFAULT_LABEL_SIZE);
  ctx.fillStyle = label.color ?? INK_COLOR;
  ctx.font = `italic ${size > 0 ? size : DEFAULT_LABEL_SIZE}px ${LABEL_FONT_STACK}`;
  ctx.textAlign = 'start';
  ctx.textBaseline = 'middle';
  ctx.fillText(label.text, at.x + finiteOr(label.dx, DEFAULT_LABEL_DX), at.y + finiteOr(label.dy, DEFAULT_LABEL_DY));
}

function drawSelectionRings(ctx: CanvasRenderingContext2D, t: ViewTransform, store: Store): void {
  if (store.selection.size === 0) return;
  ctx.strokeStyle = SELECTION_COLOR;
  ctx.lineWidth = SELECTION_WIDTH_PX;
  for (const id of store.selection) {
    const at = pointAt(store.scene.geoms.get(id));
    if (!at) continue;
    const rec = store.doc.objects.find((o) => o.id === id);
    const radius = finiteOr(rec?.style?.pointSize, DEFAULT_POINT_RADIUS) + SELECTION_GAP_PX;
    const screen = t.toScreen(at);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** M0's only geometry: everything else is undefined-hidden in the scene. */
function pointAt(g: Geometry | undefined): Vec2 | null {
  return g && g.kind === 'point' ? g.at : null;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
