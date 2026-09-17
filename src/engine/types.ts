/**
 * The document model.
 *
 * Everything here is plain JSON data — no Maps, no class instances, no
 * functions — so a `Doc` round-trips through `JSON.stringify`/`JSON.parse`
 * losslessly. That is the `.geosketch` file format (DESIGN.md §6).
 */

export type Id = string;

/** Any JSON value. Object parameters are type-specific, so they stay untyped here. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** A point in world coordinates: abstract units, y-up (DESIGN.md §3). */
export interface Vec2 {
  x: number;
  y: number;
}

/** World point at the centre of the view, plus pixels-per-world-unit. */
export interface Viewport {
  cx: number;
  cy: number;
  scale: number;
}

/** Paint attributes; an absent field means "use the app default". */
export interface Style {
  /** CSS colour. */
  stroke?: string;
  /** Stroke width in pixels. */
  strokeWidth?: number;
  /** Dash pattern in pixels, e.g. `[4, 4]`. Absent or empty means solid. */
  dash?: number[];
  /** CSS colour for interiors. */
  fill?: string;
  /** Point radius in pixels. */
  pointSize?: number;
  /** Draw a point as a ring rather than a disc. */
  hollow?: boolean;
}

/** A draggable label; offsets are pixels relative to the labelled object. */
export interface LabelSpec {
  text: string;
  dx?: number;
  dy?: number;
  size?: number;
  color?: string;
}

/**
 * One object of the construction: its identity, its type (a key into the type
 * registry), the objects it is *defined by*, and its type-specific parameters.
 */
export interface ObjRecord {
  id: Id;
  type: string;
  parents: Id[];
  params: Json;
  style?: Style;
  label?: LabelSpec;
}

/** A whole sketch. `version` is bumped only for breaking schema changes. */
export interface Doc {
  version: 1;
  viewport: Viewport;
  /**
   * The sketch's single optional coordinate system, if it has one (DESIGN.md §3
   * "Coordinates"). Reserved in the schema from M0; the axes object type and its
   * UI arrive in M2, so M0 neither computes nor creates it.
   */
  axes?: ObjRecord;
  objects: ObjRecord[];
}
