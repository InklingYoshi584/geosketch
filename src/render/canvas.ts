import type { Store } from '../app/store';
import {
  anchorsOf,
  type Doc,
  type Geometry,
  type Id,
  type ObjRecord,
  type Scene,
  type Style,
  type Vec2,
} from '../engine';
import { tracesOf } from '../interaction/display';
import { formatNumber } from './format';
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
const DEFAULT_STROKE_WIDTH = 1.5;
const DEFAULT_LABEL_DX = 8;
const DEFAULT_LABEL_DY = -8;
const DEFAULT_LABEL_SIZE = 14;
/** A readout sits centred above the point it is anchored to. */
const NUMBER_LABEL_DY = -14;
const NUMBER_SELECTION_PAD = 4;
const HOLLOW_STROKE_WIDTH = 1.5;
const SELECTION_GAP_PX = 3;
const SELECTION_WIDTH_PX = 2;
/** How far outside the canvas a circle may reach before it is culled entirely. */
const CULL_MARGIN_PX = 16;

/** A traced object's trail: lighter and thinner than the object it shadows. */
const TRAIL_ALPHA = 0.35;
const TRAIL_WIDTH_PX = 1;
const TRAIL_DOT_RADIUS = 1.2;

const NO_DASH: number[] = [];

/** Resolved paint for one shape; a selection always overrides the object's own style. */
interface Paint {
  stroke: string;
  width: number;
  dash: number[];
  fill: string | null;
}

/**
 * Draws one frame of the board: background grid, world axes, every object of
 * `store.doc` in document order (which is also draw order), then the selection
 * overlay. Touches nothing but the canvas, and is safe to call at any time — an
 * empty document or empty scene renders an empty grid, and a degenerate or
 * unknown object is skipped rather than drawn.
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
  const dpr = devicePixelRatio();
  const { width, height } = backingSize(cssWidth, cssHeight, dpr);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const t = new ViewTransform(store.doc.viewport, cssWidth, cssHeight, dpr);
  drawGrid(ctx, t);
  drawAxes(ctx, t);
  drawScene(ctx, t, store.doc, store.scene, store.selection, tracesOf(store));
}

/** Device pixel ratio, defaulting to 1 where there is no window (headless render). */
function devicePixelRatio(): number {
  const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

/**
 * Draws the construction itself — no grid, no canvas sizing — so a frame can be
 * driven from a stub context in tests. Objects whose geometry is missing (an
 * undefined or unregistered id) are skipped.
 *
 * Two display rules ride on top (DESIGN.md §8.1 显示): an object the document
 * *hides* is skipped entirely — trail included, since the whole point of hiding
 * is that nothing of it shows — and a traced object's trail is drawn as one
 * lighter pass *behind* the construction, so the trail never covers the objects
 * it shadows. `traces` is optional: without it a frame is exactly the document.
 */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  t: ViewTransform,
  doc: Doc,
  scene: Scene,
  selection: ReadonlySet<Id>,
  traces?: ReadonlyMap<Id, readonly Geometry[]>,
): void {
  if (traces !== undefined && traces.size > 0) {
    for (const rec of doc.objects) {
      if (rec.display?.hidden === true) continue;
      const trail = traces.get(rec.id);
      if (trail !== undefined && trail.length > 0) drawTrail(ctx, t, rec, trail);
    }
  }

  // Readouts are the only kind whose place comes from other objects, so the
  // anchor table (shared with hit-testing) is built on demand.
  let anchors: ReadonlyMap<Id, Vec2> | null = null;
  const overlay: ObjRecord[] | null = selection.size === 0 ? null : [];
  for (const rec of doc.objects) {
    if (rec.display?.hidden === true) continue;
    const geom = scene.geoms.get(rec.id);
    if (geom === undefined) continue;
    if (geom.kind === 'number' && anchors === null) anchors = anchorsOf(doc, scene);
    drawObject(ctx, t, rec, geom, anchors, false);
    if (overlay !== null && selection.has(rec.id)) overlay.push(rec);
  }
  if (overlay === null) return;
  for (const rec of overlay) {
    if (rec.display?.hidden === true) continue;
    const geom = scene.geoms.get(rec.id);
    if (geom !== undefined) drawObject(ctx, t, rec, geom, anchors, true);
  }
}

function drawObject(
  ctx: CanvasRenderingContext2D,
  t: ViewTransform,
  rec: ObjRecord,
  geom: Geometry,
  anchors: ReadonlyMap<Id, Vec2> | null,
  selected: boolean,
): void {
  switch (geom.kind) {
    case 'point': {
      const at = toScreenPoint(t, geom.at);
      if (at === null) return;
      if (selected) {
        drawSelectionRing(ctx, rec, at);
        return;
      }
      drawPoint(ctx, rec, at);
      drawLabel(ctx, rec, at);
      return;
    }
    case 'segment':
      drawSegment(ctx, t, rec, geom.a, geom.b, selected);
      return;
    case 'line':
      drawOpenLine(ctx, t, rec, geom.at, geom.dir, false, selected);
      return;
    case 'ray':
      drawOpenLine(ctx, t, rec, geom.at, geom.dir, true, selected);
      return;
    case 'circle':
      drawCircle(ctx, t, rec, geom.center, geom.radius, selected);
      return;
    case 'arc':
      drawArc(ctx, t, rec, geom.center, geom.radius, geom.from, geom.to, selected);
      return;
    case 'polygon':
      drawPolygon(ctx, t, rec, geom.points, selected);
      return;
    case 'text': {
      const at = toScreenPoint(t, geom.at);
      if (at === null) return;
      drawText(ctx, rec, geom.text, at, selected);
      return;
    }
    case 'number':
      drawNumber(ctx, t, rec, geom.value, geom.unit, anchors?.get(rec.id), selected);
      return;
  }
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
  ctx.setLineDash(NO_DASH);
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
  ctx.setLineDash(NO_DASH);
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

/**
 * World → screen, or `null` when the result is not finite. Every shape goes
 * through here, so degenerate geometry is skipped in one place instead of being
 * handed to the canvas as NaN.
 */
function toScreenPoint(t: ViewTransform, p: Vec2): ScreenPoint | null {
  const s = t.toScreen(p);
  return Number.isFinite(s.x) && Number.isFinite(s.y) ? s : null;
}

/** Selection paint overrides an object's own style; `fill` needs an explicit style.fill. */
function paintOf(style: Style | undefined, selected: boolean): Paint {
  if (selected) return { stroke: SELECTION_COLOR, width: SELECTION_WIDTH_PX, dash: NO_DASH, fill: null };
  const width = style?.strokeWidth;
  const dash = style?.dash;
  const fill = style?.fill;
  const stroke = style?.stroke;
  return {
    stroke: typeof stroke === 'string' && stroke !== '' ? stroke : INK_COLOR,
    width: typeof width === 'number' && Number.isFinite(width) && width > 0 ? width : DEFAULT_STROKE_WIDTH,
    dash:
      Array.isArray(dash) && dash.length > 0 && dash.every((v) => Number.isFinite(v) && v >= 0)
        ? dash
        : NO_DASH,
    fill:
      typeof fill === 'string' && fill !== '' && fill !== 'none' && fill !== 'transparent' ? fill : null,
  };
}

/** Stroke the current path with `paint`, filling it first when it has a fill. */
function strokePath(ctx: CanvasRenderingContext2D, paint: Paint): void {
  ctx.setLineDash(paint.dash);
  ctx.lineWidth = paint.width;
  ctx.strokeStyle = paint.stroke;
  ctx.stroke();
}

function strokeScreenLine(
  ctx: CanvasRenderingContext2D,
  rec: ObjRecord,
  selected: boolean,
  a: ScreenPoint,
  b: ScreenPoint,
): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineCap = 'round';
  strokePath(ctx, paintOf(rec.style, selected));
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

/** A point's selection ring: a gap around the disc, so a filled point stays readable. */
function drawSelectionRing(ctx: CanvasRenderingContext2D, rec: ObjRecord, at: ScreenPoint): void {
  ctx.setLineDash(NO_DASH);
  ctx.strokeStyle = SELECTION_COLOR;
  ctx.lineWidth = SELECTION_WIDTH_PX;
  const radius = finiteOr(rec.style?.pointSize, DEFAULT_POINT_RADIUS) + SELECTION_GAP_PX;
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
  ctx.stroke();
}

function drawSegment(
  ctx: CanvasRenderingContext2D,
  t: ViewTransform,
  rec: ObjRecord,
  a: Vec2,
  b: Vec2,
  selected: boolean,
): void {
  const pa = toScreenPoint(t, a);
  const pb = toScreenPoint(t, b);
  if (pa === null || pb === null) return;
  strokeScreenLine(ctx, rec, selected, pa, pb);
}

/** Lines and rays are unbounded, so they are clipped to the visible rectangle first. */
function drawOpenLine(
  ctx: CanvasRenderingContext2D,
  t: ViewTransform,
  rec: ObjRecord,
  at: Vec2,
  dir: Vec2,
  ray: boolean,
  selected: boolean,
): void {
  const span = clipToBounds(t, at, dir, ray);
  if (span === null) return;
  const pa = toScreenPoint(t, span[0]);
  const pb = toScreenPoint(t, span[1]);
  if (pa === null || pb === null) return;
  strokeScreenLine(ctx, rec, selected, pa, pb);
}

/**
 * The visible part of `P(t) = at + t·dir`, clipped by the slab method: a line
 * keeps every `t`, a ray only `t ≥ 0`. `null` when nothing is visible or the
 * direction is degenerate.
 */
function clipToBounds(t: ViewTransform, at: Vec2, dir: Vec2, ray: boolean): [Vec2, Vec2] | null {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;
  if (!Number.isFinite(dir.x) || !Number.isFinite(dir.y)) return null;
  if (dir.x === 0 && dir.y === 0) return null;

  const b = t.visibleBounds();
  const spanX = clipSlab(at.x, dir.x, b.minX, b.maxX, ray ? 0 : -Infinity, Infinity);
  if (spanX === null) return null;
  const spanY = clipSlab(at.y, dir.y, b.minY, b.maxY, spanX[0], spanX[1]);
  if (spanY === null) return null;

  const [t0, t1] = spanY;
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return null;
  return [
    { x: at.x + t0 * dir.x, y: at.y + t0 * dir.y },
    { x: at.x + t1 * dir.x, y: at.y + t1 * dir.y },
  ];
}

/** Clip one axis' slab against `[min, max]`, narrowing a running `[lo, hi]`. */
function clipSlab(
  a: number,
  d: number,
  min: number,
  max: number,
  lo: number,
  hi: number,
): [number, number] | null {
  if (d === 0) return a >= min && a <= max ? [lo, hi] : null;
  let t0 = (min - a) / d;
  let t1 = (max - a) / d;
  if (t0 > t1) {
    const swap = t0;
    t0 = t1;
    t1 = swap;
  }
  const nextLo = Math.max(lo, t0);
  const nextHi = Math.min(hi, t1);
  return nextLo <= nextHi ? [nextLo, nextHi] : null;
}

function drawCircle(
  ctx: CanvasRenderingContext2D,
  t: ViewTransform,
  rec: ObjRecord,
  center: Vec2,
  radius: number,
  selected: boolean,
): void {
  const at = toScreenPoint(t, center);
  const r = radius * t.viewport.scale;
  if (at === null || !Number.isFinite(r) || r <= 0) return;
  // Far-out circles still cross the canvas, so cull by their bounding box.
  if (
    at.x + r < -CULL_MARGIN_PX ||
    at.x - r > t.cssWidth + CULL_MARGIN_PX ||
    at.y + r < -CULL_MARGIN_PX ||
    at.y - r > t.cssHeight + CULL_MARGIN_PX
  ) {
    return;
  }
  ctx.beginPath();
  ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
  const paint = paintOf(rec.style, selected);
  if (paint.fill !== null) {
    ctx.fillStyle = paint.fill;
    ctx.fill();
  }
  strokePath(ctx, paint);
}

function drawPolygon(
  ctx: CanvasRenderingContext2D,
  t: ViewTransform,
  rec: ObjRecord,
  points: Vec2[],
  selected: boolean,
): void {
  if (points.length < 3) return;
  const screen: ScreenPoint[] = [];
  for (const p of points) {
    const at = toScreenPoint(t, p);
    if (at === null) return;
    screen.push(at);
  }
  ctx.beginPath();
  ctx.moveTo(screen[0].x, screen[0].y);
  for (let i = 1; i < screen.length; i++) ctx.lineTo(screen[i].x, screen[i].y);
  ctx.closePath();
  const paint = paintOf(rec.style, selected);
  if (paint.fill !== null) {
    ctx.fillStyle = paint.fill;
    ctx.fill();
  }
  strokePath(ctx, paint);
}

/**
 * An arc: the part of the circle about `center` that sweeps counter-clockwise
 * from `from` to `to` (radians; the engine normalises the sweep into `(0, 2π]`).
 * World angles are y-up and the canvas is y-down, so both angles are negated —
 * a positive world sweep then reads counter-clockwise on screen. Arcs are
 * strokes: `style.fill` is for interiors (polygons and circles), not for them.
 */
function drawArc(
  ctx: CanvasRenderingContext2D,
  t: ViewTransform,
  rec: ObjRecord,
  center: Vec2,
  radius: number,
  from: number,
  to: number,
  selected: boolean,
): void {
  const at = toScreenPoint(t, center);
  const r = radius * t.viewport.scale;
  if (at === null || !Number.isFinite(r) || r <= 0) return;
  if (!Number.isFinite(from) || !Number.isFinite(to)) return;
  if (
    at.x + r < -CULL_MARGIN_PX ||
    at.x - r > t.cssWidth + CULL_MARGIN_PX ||
    at.y + r < -CULL_MARGIN_PX ||
    at.y - r > t.cssHeight + CULL_MARGIN_PX
  ) {
    return;
  }
  ctx.beginPath();
  ctx.arc(at.x, at.y, r, -from, -to, true);
  strokePath(ctx, paintOf(rec.style, selected));
}

/**
 * A free text object: its string, at its own anchor, in the label font and
 * left-aligned. Its colour falls back from the label's to the style's stroke,
 * so both the label dialog and the style dialog can colour it. A selected text
 * gets the box a selected readout gets — there is no outline to re-trace on
 * glyphs.
 */
function drawText(
  ctx: CanvasRenderingContext2D,
  rec: ObjRecord,
  text: string,
  at: ScreenPoint,
  selected: boolean,
): void {
  if (text === '') return;
  const label = rec.label;
  const size = finiteOr(label?.size, DEFAULT_LABEL_SIZE);
  ctx.font = `${size > 0 ? size : DEFAULT_LABEL_SIZE}px ${LABEL_FONT_STACK}`;
  ctx.textAlign = 'start';
  ctx.textBaseline = 'middle';
  if (selected) {
    ctx.setLineDash(NO_DASH);
    ctx.strokeStyle = SELECTION_COLOR;
    ctx.lineWidth = SELECTION_WIDTH_PX;
    const half = ctx.measureText(text).width / 2 + NUMBER_SELECTION_PAD;
    ctx.strokeRect(
      at.x - half,
      at.y - size / 2 - NUMBER_SELECTION_PAD,
      half * 2,
      size + NUMBER_SELECTION_PAD * 2,
    );
    return;
  }
  ctx.fillStyle = label?.color ?? rec.style?.stroke ?? INK_COLOR;
  ctx.fillText(text, at.x, at.y);
}

/**
 * A measured number: text anchored at the anchor table's entry for its parents
 * (the average of their sample points), offset by `label.dx/dy`, and formatted
 * with the label as a prefix. A selected readout gets a box rather than a
 * stroke overlay — there is no outline to re-trace on text.
 */
function drawNumber(
  ctx: CanvasRenderingContext2D,
  t: ViewTransform,
  rec: ObjRecord,
  value: number,
  unit: 'deg' | undefined,
  anchor: Vec2 | undefined,
  selected: boolean,
): void {
  if (!Number.isFinite(value) || anchor === undefined) return;
  const at = toScreenPoint(t, anchor);
  if (at === null) return;

  const label = rec.label;
  const size = finiteOr(label?.size, DEFAULT_LABEL_SIZE);
  const x = at.x + finiteOr(label?.dx, 0);
  const y = at.y + finiteOr(label?.dy, NUMBER_LABEL_DY);
  const text = formatNumber(value, unit, label?.text);
  ctx.font = `${size > 0 ? size : DEFAULT_LABEL_SIZE}px ${LABEL_FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (selected) {
    ctx.setLineDash(NO_DASH);
    ctx.strokeStyle = SELECTION_COLOR;
    ctx.lineWidth = SELECTION_WIDTH_PX;
    const half = ctx.measureText(text).width / 2 + NUMBER_SELECTION_PAD;
    ctx.strokeRect(x - half, y - size / 2 - NUMBER_SELECTION_PAD, half * 2, size + NUMBER_SELECTION_PAD * 2);
    return;
  }
  ctx.fillStyle = label?.color ?? INK_COLOR;
  ctx.fillText(text, x, y);
}

/**
 * A traced object's past geometries, drawn as one lighter pass *behind* the
 * construction (DESIGN.md §8.1 显示 › 追踪): paths are stroked, points become the
 * dotted trail GSP leaves behind. Readouts and free text have no outline to
 * trace, so they are skipped rather than smeared. The paint is the object's own
 * colour at reduced opacity — thin, never filled, so a trail can never blot out
 * the objects drawn over it.
 */
function drawTrail(
  ctx: CanvasRenderingContext2D,
  t: ViewTransform,
  rec: ObjRecord,
  trail: readonly Geometry[],
): void {
  const paint = paintOf(rec.style, false);
  ctx.setLineDash(NO_DASH);
  ctx.lineWidth = Math.max(TRAIL_WIDTH_PX, paint.width * 0.75);
  ctx.strokeStyle = paint.stroke;
  ctx.fillStyle = paint.stroke;
  ctx.globalAlpha = TRAIL_ALPHA;
  strokeTrailPaths(ctx, t, trail);
  fillTrailDots(ctx, t, trail);
  ctx.globalAlpha = 1;
}

function strokeTrailPaths(
  ctx: CanvasRenderingContext2D,
  t: ViewTransform,
  trail: readonly Geometry[],
): void {
  ctx.beginPath();
  let started = false;
  for (const geom of trail) {
    if (appendTrailPath(ctx, t, geom)) started = true;
  }
  if (started) ctx.stroke();
}

/** Append one past geometry to the current path; `false` when it has no stroke. */
function appendTrailPath(
  ctx: CanvasRenderingContext2D,
  t: ViewTransform,
  geom: Geometry,
): boolean {
  switch (geom.kind) {
    case 'segment': {
      const a = toScreenPoint(t, geom.a);
      const b = toScreenPoint(t, geom.b);
      if (a === null || b === null) return false;
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      return true;
    }
    case 'line':
    case 'ray': {
      const span = clipToBounds(t, geom.at, geom.dir, geom.kind === 'ray');
      if (span === null) return false;
      const a = toScreenPoint(t, span[0]);
      const b = toScreenPoint(t, span[1]);
      if (a === null || b === null) return false;
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      return true;
    }
    case 'circle': {
      const at = toScreenPoint(t, geom.center);
      const r = geom.radius * t.viewport.scale;
      if (at === null || !Number.isFinite(r) || r <= 0) return false;
      ctx.moveTo(at.x + r, at.y);
      ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
      return true;
    }
    case 'arc': {
      const at = toScreenPoint(t, geom.center);
      const r = geom.radius * t.viewport.scale;
      if (at === null || !Number.isFinite(r) || r <= 0) return false;
      if (!Number.isFinite(geom.from) || !Number.isFinite(geom.to)) return false;
      const start = toScreenPoint(t, {
        x: geom.center.x + geom.radius * Math.cos(geom.from),
        y: geom.center.y + geom.radius * Math.sin(geom.from),
      });
      if (start === null) return false;
      ctx.moveTo(start.x, start.y);
      ctx.arc(at.x, at.y, r, -geom.from, -geom.to, true);
      return true;
    }
    case 'polygon': {
      if (geom.points.length < 3) return false;
      const screen: ScreenPoint[] = [];
      for (const p of geom.points) {
        const at = toScreenPoint(t, p);
        if (at === null) return false;
        screen.push(at);
      }
      ctx.moveTo(screen[0].x, screen[0].y);
      for (let i = 1; i < screen.length; i++) ctx.lineTo(screen[i].x, screen[i].y);
      ctx.closePath();
      return true;
    }
    case 'point':
    case 'number':
    case 'text':
      return false;
  }
}

/** A traced point leaves dots, which is the trail a teacher reads as a locus. */
function fillTrailDots(
  ctx: CanvasRenderingContext2D,
  t: ViewTransform,
  trail: readonly Geometry[],
): void {
  ctx.beginPath();
  let started = false;
  for (const geom of trail) {
    if (geom.kind !== 'point') continue;
    const at = toScreenPoint(t, geom.at);
    if (at === null) continue;
    ctx.moveTo(at.x + TRAIL_DOT_RADIUS, at.y);
    ctx.arc(at.x, at.y, TRAIL_DOT_RADIUS, 0, Math.PI * 2);
    started = true;
  }
  if (started) ctx.fill();
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
