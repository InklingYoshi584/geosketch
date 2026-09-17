import type { Vec2, Viewport } from '../engine';

/** Screen-space point in CSS pixels: y-down, origin at the canvas' top-left. */
export interface ScreenPoint {
  x: number;
  y: number;
}

/** Visible world rectangle, y-up. */
export interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Zoom limits: 1e-4 … 1e4 pixels per world unit. */
export const MIN_SCALE = 1e-4;
export const MAX_SCALE = 1e4;

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * Backing-store size in device pixels for a CSS-sized canvas: what
 * `canvas.width` / `canvas.height` must be set to. Shared by the resize
 * observer and the renderer so the two can never disagree.
 */
export function backingSize(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): { width: number; height: number } {
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const cssW = Number.isFinite(cssWidth) ? Math.max(0, cssWidth) : 0;
  const cssH = Number.isFinite(cssHeight) ? Math.max(0, cssHeight) : 0;
  return {
    width: Math.max(1, Math.round(cssW * ratio)),
    height: Math.max(1, Math.round(cssH * ratio)),
  };
}

/**
 * Maps world coordinates (y-up, origin at the viewport centre `cx/cy`) to CSS
 * pixels (y-down, origin at the canvas' top-left) and back.
 *
 * Screen geometry (all CSS px):
 *   sx = cssW/2 + (x - cx) * scale
 *   sy = cssH/2 - (y - cy) * scale
 */
export class ViewTransform {
  readonly viewport: Viewport;
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly dpr: number;

  constructor(viewport: Viewport, cssWidth: number, cssHeight: number, dpr = 1) {
    this.viewport = viewport;
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    this.dpr = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
  }

  toScreen(p: Vec2): ScreenPoint {
    const s = this.viewport.scale;
    return {
      x: this.cssWidth / 2 + (p.x - this.viewport.cx) * s,
      y: this.cssHeight / 2 - (p.y - this.viewport.cy) * s,
    };
  }

  toWorld(p: ScreenPoint): Vec2 {
    const s = this.viewport.scale;
    return {
      x: this.viewport.cx + (p.x - this.cssWidth / 2) / s,
      y: this.viewport.cy - (p.y - this.cssHeight / 2) / s,
    };
  }

  /** World rectangle covered by the canvas; used to bound grid drawing. */
  visibleBounds(): WorldBounds {
    const a = this.toWorld({ x: 0, y: 0 });
    const b = this.toWorld({ x: this.cssWidth, y: this.cssHeight });
    return {
      minX: Math.min(a.x, b.x),
      minY: Math.min(a.y, b.y),
      maxX: Math.max(a.x, b.x),
      maxY: Math.max(a.y, b.y),
    };
  }
}

/**
 * Zoom by `factor` about a screen anchor: the world point under `anchorCss`
 * keeps its screen position exactly, even when the scale hits a clamp bound.
 */
export function zoomAt(
  vp: Viewport,
  anchorCss: ScreenPoint,
  factor: number,
  cssW: number,
  cssH: number,
): Viewport {
  const target = vp.scale * factor;
  const scale = Number.isFinite(target) && target > 0 ? clampScale(target) : vp.scale;
  const anchorWorld = new ViewTransform(vp, cssW, cssH).toWorld(anchorCss);
  return {
    ...vp,
    cx: anchorWorld.x - (anchorCss.x - cssW / 2) / scale,
    cy: anchorWorld.y + (anchorCss.y - cssH / 2) / scale,
    scale,
  };
}

/** Translate the view by a CSS-pixel delta (content follows the finger). */
export function panBy(vp: Viewport, dxCss: number, dyCss: number): Viewport {
  return {
    ...vp,
    cx: vp.cx - dxCss / vp.scale,
    cy: vp.cy + dyCss / vp.scale,
  };
}
