import { describe, expect, it } from 'vitest';
import type { Viewport } from '../engine';
import { MAX_SCALE, MIN_SCALE, ViewTransform, backingSize, panBy, zoomAt } from './viewport';

const CSS_W = 800;
const CSS_H = 600;
const VIEW_BOUNDS_W = 400;

function vp(cx = 0, cy = 0, scale = 64): Viewport {
  return { cx, cy, scale };
}

describe('ViewTransform', () => {
  it('places the world centre at the middle of the canvas', () => {
    const t = new ViewTransform(vp(3, -7, 64), CSS_W, CSS_H, 2);
    expect(t.toScreen({ x: 3, y: -7 })).toEqual({ x: CSS_W / 2, y: CSS_H / 2 });
  });

  it('flips y: higher world y is higher on screen (smaller screen y)', () => {
    const t = new ViewTransform(vp(0, 0, 64), CSS_W, CSS_H);
    expect(t.toScreen({ x: 0, y: 2 }).y).toBeLessThan(CSS_H / 2);
    expect(t.toScreen({ x: 0, y: -2 }).y).toBeGreaterThan(CSS_H / 2);
    expect(t.toScreen({ x: 0, y: 2 }).y - t.toScreen({ x: 0, y: 1 }).y).toBeCloseTo(-64, 9);
    expect(t.toScreen({ x: 2, y: 0 }).x - t.toScreen({ x: 1, y: 0 }).x).toBeCloseTo(64, 9);
  });

  it('round-trips world -> screen -> world', () => {
    const cases: Viewport[] = [
      vp(),
      vp(1.5, -2.25, 64),
      vp(-100, 40, 0.5),
      vp(0, 0, MIN_SCALE),
      vp(0, 0, MAX_SCALE),
      vp(1e5, -1e5, 3.75),
    ];
    for (const viewport of cases) {
      const t = new ViewTransform(viewport, CSS_W, CSS_H);
      for (const p of [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: -13.25, y: 7.5 },
        { x: 1000, y: -1000 },
      ]) {
        const w = t.toWorld(t.toScreen(p));
        expect(w.x).toBeCloseTo(p.x, 6);
        expect(w.y).toBeCloseTo(p.y, 6);
      }
    }
  });

  it('round-trips screen -> world -> screen at extreme scales', () => {
    for (const scale of [MIN_SCALE, MAX_SCALE]) {
      const t = new ViewTransform(vp(0, 0, scale), CSS_W, CSS_H);
      for (const s of [
        { x: 0, y: 0 },
        { x: CSS_W, y: CSS_H },
        { x: 137, y: 411 },
      ]) {
        const back = t.toScreen(t.toWorld(s));
        expect(back.x).toBeCloseTo(s.x, 6);
        expect(back.y).toBeCloseTo(s.y, 6);
      }
    }
  });

  it('reports visible bounds as min/max in world space', () => {
    const b = new ViewTransform(vp(0, 0, 50), VIEW_BOUNDS_W, 100).visibleBounds();
    expect(b.minX).toBeCloseTo(-4, 9);
    expect(b.maxX).toBeCloseTo(4, 9);
    expect(b.minY).toBeCloseTo(-1, 9);
    expect(b.maxY).toBeCloseTo(1, 9);
  });

  it('sizes the backing store by dpr, never below 1', () => {
    expect(backingSize(300, 200, 2)).toEqual({ width: 600, height: 400 });
    expect(backingSize(300.5, 200.4, 1.5)).toEqual({ width: 451, height: 301 });
    expect(backingSize(0, 0, 0)).toEqual({ width: 1, height: 1 });
    expect(backingSize(Number.NaN, 100, 1)).toEqual({ width: 1, height: 100 });
  });
});

describe('zoomAt', () => {
  it('keeps the world point under the anchor fixed', () => {
    const anchors = [
      { x: 0, y: 0 },
      { x: CSS_W / 2, y: CSS_H / 2 },
      { x: 733, y: 12 },
      { x: 5, y: 599 },
    ];
    const factors = [1.0001, 1.25, 2, 0.5, 10, 0.1];
    for (const start of [vp(), vp(2, -3, 64), vp(-0.5, 0.25, 7.5)]) {
      for (const anchor of anchors) {
        for (const factor of factors) {
          const before = new ViewTransform(start, CSS_W, CSS_H).toWorld(anchor);
          const next = zoomAt(start, anchor, factor, CSS_W, CSS_H);
          const after = new ViewTransform(next, CSS_W, CSS_H).toScreen(before);
          expect(after.x).toBeCloseTo(anchor.x, 6);
          expect(after.y).toBeCloseTo(anchor.y, 6);
        }
      }
    }
  });

  it('scales by the factor and clamps at the limits', () => {
    expect(zoomAt(vp(0, 0, 64), { x: 400, y: 300 }, 2, CSS_W, CSS_H).scale).toBeCloseTo(128, 9);
    const big = zoomAt(vp(0, 0, 64), { x: 733, y: 12 }, 1e9, CSS_W, CSS_H);
    expect(big.scale).toBe(MAX_SCALE);
    const anchorWorld = new ViewTransform(vp(0, 0, 64), CSS_W, CSS_H).toWorld({ x: 733, y: 12 });
    const back = new ViewTransform(big, CSS_W, CSS_H).toScreen(anchorWorld);
    expect(back.x).toBeCloseTo(733, 6);
    expect(back.y).toBeCloseTo(12, 6);
    expect(zoomAt(vp(0, 0, 64), { x: 400, y: 300 }, 1e-9, CSS_W, CSS_H).scale).toBe(MIN_SCALE);
  });

  it('ignores a non-positive or non-finite factor', () => {
    const start = vp(1, 2, 64);
    expect(zoomAt(start, { x: 10, y: 20 }, 0, CSS_W, CSS_H)).toEqual(start);
    expect(zoomAt(start, { x: 10, y: 20 }, Number.NaN, CSS_W, CSS_H)).toEqual(start);
  });

  it('does not mutate the input viewport', () => {
    const start = vp(1, 2, 64);
    zoomAt(start, { x: 10, y: 20 }, 3, CSS_W, CSS_H);
    expect(start).toEqual({ cx: 1, cy: 2, scale: 64 });
  });
});

describe('panBy', () => {
  it('moves content with the finger: dragging right/down shifts screen position by the same delta', () => {
    const start = vp(0, 0, 64);
    const moved = panBy(start, 30, -20);
    const t0 = new ViewTransform(start, CSS_W, CSS_H);
    const t1 = new ViewTransform(moved, CSS_W, CSS_H);
    const world = { x: 1, y: 2 };
    const a = t0.toScreen(world);
    const b = t1.toScreen(world);
    expect(b.x - a.x).toBeCloseTo(30, 9);
    expect(b.y - a.y).toBeCloseTo(-20, 9);
    expect(moved.cx).toBeCloseTo(-30 / 64, 9);
    expect(moved.cy).toBeCloseTo(-20 / 64, 9);
  });

  it('is invertible and keeps the scale', () => {
    const start = vp(2.5, -1.5, 0.125);
    const back = panBy(panBy(start, 17, -42), -17, 42);
    expect(back.cx).toBeCloseTo(start.cx, 9);
    expect(back.cy).toBeCloseTo(start.cy, 9);
    expect(back.scale).toBe(start.scale);
  });

  it('does not mutate the input viewport', () => {
    const start = vp(2.5, -1.5, 64);
    panBy(start, 17, -42);
    expect(start).toEqual({ cx: 2.5, cy: -1.5, scale: 64 });
  });
});
