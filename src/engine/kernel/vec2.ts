/**
 * 2D vector math. All functions are pure and allocation-conscious: `add`, `sub`,
 * `scale` and `lerp` allocate one vector, the rest allocate nothing.
 *
 * Numeric model (DESIGN.md §5): float64 with *relative* epsilons, so predicates
 * compare relative quantities rather than using absolute equality.
 */
import type { Vec2 } from '../types';

/** Relative epsilon for float comparisons; callers scale it by the viewport. */
export const EPS = 1e-9;

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Vec2, k: number): Vec2 {
  return { x: a.x * k, y: a.y * k };
}

export function len(a: Vec2): number {
  return Math.sqrt(a.x * a.x + a.y * a.y);
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.sqrt(distSq(a, b));
}

/** Squared distance — for comparisons and tolerances, where the root is wasted work. */
export function distSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/** 2D cross product, i.e. the z component of the 3D cross: `> 0` means `b` is left of `a`. */
export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
