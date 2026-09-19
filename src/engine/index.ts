/**
 * The engine barrel — the only surface the rest of the app imports.
 *
 * Object types register themselves as an import side effect, so M1 and beyond
 * add a type by writing `objects/<type>.ts` and adding one import line below.
 * No core file (registry.ts, scene.ts) is touched by a new type.
 */
import './objects/point-free';
import './objects/paths';
import './objects/arcs';
import './objects/point-on-object';
import './objects/intersection';
import './objects/derived';
import './objects/measures';
import './objects/text';

export type { Doc, Id, Json, LabelSpec, ObjRecord, Style, Vec2, Viewport } from './types';
export type { Geometry, LineLikeGeometry, PathGeometry, Scene } from './scene';
export type { GeometryKind, ObjType, Undefined } from './registry';

export {
  anchorsOf,
  computeScene,
  createEmptyDoc,
  DEFAULT_VIEWPORT,
  evalPath,
  hitTest,
  isPathGeometry,
  projectPoint,
} from './scene';
export { kindMatches, registerType, registry } from './registry';
export { newId } from './ids';
