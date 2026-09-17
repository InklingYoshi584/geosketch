/**
 * The compute core: document in, scene out.
 *
 * `computeScene` resolves the construction DAG by depth-first search, memoising
 * each object so the graph is walked once. It knows nothing about individual
 * object types — it only asks the registry (DESIGN.md §5 "Engine rules").
 */
import type { Doc, Id, ObjRecord, Vec2, Viewport } from './types';
import { isUndefined, registry } from './registry';
import type { Env } from './registry';
import { distSq } from './kernel/vec2';

/**
 * Computed geometry, a discriminated union keyed by `kind`. M1 adds the other
 * kinds (segment, line, circle, polygon, …) here; individual object *types*
 * never touch this file — they only choose which kind they produce.
 */
export type Geometry = { kind: 'point'; at: Vec2 };

/**
 * The computed result for a document: geometry for every defined object, and a
 * reason for every object that could not be computed (DESIGN.md D9).
 *
 * Both maps iterate in **document order** — that is draw order, and it is what
 * `hitTest` uses to break ties.
 */
export interface Scene {
  geoms: Map<Id, Geometry>;
  undefined: Map<Id, string>;
}

/** World centre (0, 0) at 64 pixels per world unit. */
export const DEFAULT_VIEWPORT: Viewport = { cx: 0, cy: 0, scale: 64 };

/**
 * A fresh, empty document. The viewport is a fresh object, never the shared
 * `DEFAULT_VIEWPORT`, so callers may mutate their own copy.
 */
export function createEmptyDoc(): Doc {
  return { version: 1, viewport: { ...DEFAULT_VIEWPORT }, objects: [] };
}

/**
 * Compute every object in `doc`.
 *
 * Undefined handling, in the order the cases are decided:
 * - a parent id that is not in the document → `'missing parent'`;
 * - an unregistered type → `'unknown type: <name>'`;
 * - an edge that closes a cycle → `'cycle'` on the object the edge points at;
 * - a `compute` that yields `Undefined` → its own reason;
 * - anything else downstream of an undefined object inherits the root cause, so
 *   the chip stays actionable at any depth instead of saying "parent undefined".
 *
 * `doc.axes` is document data only in M0 — the coordinate system arrives with
 * the axes type in M2, so it is deliberately not computed here.
 */
export function computeScene(doc: Doc): Scene {
  const records = new Map<Id, ObjRecord>();
  for (const record of doc.objects) records.set(record.id, record);

  const env: Env = { scale: doc.viewport.scale };
  const states = new Map<Id, 'visiting' | 'done'>();
  const geoms = new Map<Id, Geometry>();
  const reasons = new Map<Id, string>();

  // Recursion depth is the length of a dependency chain, not the object count,
  // so memoisation also bounds the stack (quiz figures: tens of frames deep).
  const visit = (id: Id): void => {
    const state = states.get(id);
    if (state === 'done') return;
    if (state === 'visiting') {
      // Back edge: the object it points at is a cycle member.
      reasons.set(id, 'cycle');
      return;
    }

    const record = records.get(id);
    if (record === undefined) {
      states.set(id, 'done');
      reasons.set(id, 'missing parent');
      return;
    }

    const type = registry.get(record.type);
    if (type === undefined) {
      states.set(id, 'done');
      reasons.set(id, `unknown type: ${record.type}`);
      return;
    }

    states.set(id, 'visiting');

    let reason: string | undefined;
    const parents: Geometry[] = [];
    for (const parentId of record.parents) {
      visit(parentId);
      const parentGeom = geoms.get(parentId);
      if (parentGeom === undefined) {
        reason = reasons.get(parentId) ?? 'missing parent';
        break;
      }
      parents.push(parentGeom);
    }

    states.set(id, 'done');

    if (reasons.has(id)) return; // a back edge inside this subtree pointed here
    if (reason !== undefined) {
      reasons.set(id, reason);
      return;
    }

    const result = type.compute(parents, record.params, env);
    if (isUndefined(result)) reasons.set(id, result.reason);
    else geoms.set(id, result);
  };

  for (const record of doc.objects) visit(record.id);

  // Emit in document order (the DFS above reaches parents before children, which
  // is not document order).
  const scene: Scene = { geoms: new Map(), undefined: new Map() };
  for (const record of doc.objects) {
    const geom = geoms.get(record.id);
    if (geom !== undefined) scene.geoms.set(record.id, geom);
    const reason = reasons.get(record.id);
    if (reason !== undefined) scene.undefined.set(record.id, reason);
  }
  return scene;
}

/**
 * Distance from `world` to a geometry, squared. This switch is the extension
 * seam for new geometry kinds: adding one makes this non-exhaustive, which is a
 * compile error here.
 */
function distSqToGeometry(geom: Geometry, world: Vec2): number {
  switch (geom.kind) {
    case 'point':
      return distSq(geom.at, world);
  }
}

/**
 * Ids of objects within `tolWorld` of `world` (world units; the caller converts
 * from pixels), nearest first. Equal distances are broken by draw order — the
 * last drawn object wins, so `ids[0]` is the topmost hit.
 *
 * Objects that are undefined have no geometry and cannot be hit.
 */
export function hitTest(scene: Scene, world: Vec2, tolWorld: number): Id[] {
  const tolSq = tolWorld * tolWorld;
  const hits: { id: Id; dSq: number; order: number }[] = [];
  let order = 0;
  for (const [id, geom] of scene.geoms) {
    order += 1;
    const dSq = distSqToGeometry(geom, world);
    if (dSq <= tolSq) hits.push({ id, dSq, order });
  }
  hits.sort((a, b) => a.dSq - b.dSq || b.order - a.order);
  return hits.map((hit) => hit.id);
}
