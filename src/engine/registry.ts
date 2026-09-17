/**
 * The object-type registry. The core (see scene.ts) knows nothing about any
 * particular type; it only looks one up by name and calls `compute`. Adding a
 * type is one new module under `objects/` that calls `registerType` — no core
 * file changes.
 */
import type { Json } from './types';
import type { Geometry } from './scene';

/**
 * Compute environment: values that come from the *view* rather than the
 * document, so tolerances can be expressed relative to what the user sees.
 */
export interface Env {
  /** Pixels per world unit. */
  scale: number;
}

/**
 * Why an object could not be computed. The reason string is user-facing: it is
 * what the undefined chip shows (DESIGN.md §5 "UNDEFINED carries a reason").
 */
export interface Undefined {
  reason: string;
}

/** Narrow a compute result to the failure case. */
export function isUndefined(value: Geometry | Undefined): value is Undefined {
  return !('kind' in value);
}

export interface ObjType {
  /** Registry key, e.g. `"point.free"`. */
  name: string;
  /**
   * Acceptable parent signatures, one entry per legal arity: each inner array
   * lists the *geometry kinds* (see `Geometry`) allowed in that parent slot.
   * A type that takes no parents declares `[[]]`.
   */
  parentTypes: string[][];
  /**
   * Compute this object from its already-computed parents. Pure: the same
   * inputs must yield the same result, and nothing outside `parents`/`params`
   * may be read (except view-dependent values from `env`).
   */
  compute(parents: Geometry[], params: Json, env: Env): Geometry | Undefined;
}

/** Every registered type, keyed by `ObjType.name`. */
export const registry = new Map<string, ObjType>();

/** Register (or replace) a type. Replacement keeps hot reload working. */
export function registerType(type: ObjType): void {
  registry.set(type.name, type);
}
