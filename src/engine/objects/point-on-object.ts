/**
 * `point.onObject` — a point glued to a path (DESIGN.md §3 "point-on-object
 * (parameterized)", §5 "Point-on-object stores a path parameter … the parameter
 * is re-projected, never reset").
 *
 * The point stores nothing but its parameter `t`, so it stays glued when its
 * parent moves: dragging the parent path carries the point along, and dragging
 * the point slides it along the path. Storing the parameter instead of the
 * coordinates is the whole difference between a construction and a drawing.
 */
import type { Geometry } from '../scene';
import { evalPath, isPathGeometry } from '../scene';
import type { Env, Undefined } from '../registry';
import { registerType } from '../registry';
import type { Json } from '../types';

/** Where a freshly glued point starts: the middle of the path. */
const DEFAULT_T = 0.5;

registerType({
  name: 'point.onObject',
  title: '对象上的点',
  parentKinds: [['path']],
  /**
   * `evalPath` reads `t` clamped per kind, so a stored parameter outside the
   * path's domain is drawn at its end rather than off it — while the stored
   * value itself is never rewritten, so the point's proportion survives
   * whatever the parent does.
   */
  compute(parents: Geometry[], params: Json, _env: Env): Geometry | Undefined {
    if (parents.length !== 1) return { reason: '需要一个路径对象' };
    const path = parents[0];
    if (!isPathGeometry(path)) return { reason: '需要一个路径对象' };
    const t = readT(params);
    if (t === undefined) return { reason: '参数 t 必须是有限数' };
    return { kind: 'point', at: evalPath(path, t) };
  },
});

/**
 * `t` from the params bag. An absent (or absent-bodied) bag means the default,
 * so a freshly created object is never immediately undefined; present but not a
 * finite number means a corrupt document, and says so.
 */
function readT(params: Json): number | undefined {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return DEFAULT_T;
  const raw = params.t;
  if (raw === undefined) return DEFAULT_T;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}
