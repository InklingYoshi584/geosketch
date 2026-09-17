/**
 * The engine barrel — the only surface the rest of the app imports.
 *
 * Object types register themselves as an import side effect, so M1 and beyond
 * add a type by writing `objects/<type>.ts` and adding one import line below.
 * No core file (registry.ts, scene.ts) is touched by a new type.
 */
import './objects/point-free';

export type { Doc, Id, Json, LabelSpec, ObjRecord, Style, Vec2, Viewport } from './types';
export type { Geometry, Scene } from './scene';
export type { ObjType, Undefined } from './registry';

export { createEmptyDoc, computeScene, DEFAULT_VIEWPORT, hitTest } from './scene';
export { registerType, registry } from './registry';
export { newId } from './ids';
