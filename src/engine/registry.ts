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

/**
 * The kind of parent a signature slot accepts: a single geometry kind, or one
 * of two wildcards. `'path'` accepts exactly the parameterised kinds that
 * `evalPath`/`projectPoint` are defined on (segment, line, ray, circle);
 * `'any'` accepts every kind, including ones added later.
 */
export type GeometryKind = Geometry['kind'] | 'path' | 'any';

/**
 * What `'path'` stands for — the kinds with a parameter `t` (see scene.ts).
 * Exhaustive over `Geometry['kind']` on purpose: a new kind must decide here
 * whether it is parameterised, instead of silently defaulting to "no".
 */
const IS_PARAMETERISED: Record<Geometry['kind'], boolean> = {
  point: false,
  segment: true,
  line: true,
  ray: true,
  circle: true,
  polygon: false,
  number: false,
};

/**
 * Does a geometry of kind `actual` satisfy a signature slot requiring
 * `required`? Exact kinds match themselves; `'path'` matches the four
 * parameterised kinds; `'any'` matches everything.
 */
export function kindMatches(required: GeometryKind, actual: Geometry['kind']): boolean {
  if (required === 'any') return true;
  if (required === 'path') return IS_PARAMETERISED[actual];
  return required === actual;
}

export interface ObjType {
  /** Registry key, e.g. `"point.free"`. */
  name: string;
  /** Chinese UI label (the action bar's button text), e.g. `"中点"`. */
  title: string;
  /**
   * Acceptable parent signatures, one entry per legal signature — so a union of
   * kinds at the same arity is several entries (`measure.area` is `[['polygon'],
   * ['circle']]`). Each inner array lists the kinds allowed in that parent slot,
   * matched with `kindMatches`. A type that takes no parents declares `[[]]`.
   *
   * The one variadic type is `polygon`: it declares the three-point signature,
   * which the action layer reads as "three **or more** points, every slot of
   * kind `point`" (see objects/paths.ts).
   */
  parentKinds: GeometryKind[][];
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
