/**
 * `point.free` — a point defined by nothing but its own coordinates (DESIGN.md
 * §3 "Free points"). This is the only object type in M0; it is also the template
 * every later type follows: validate params, return a Geometry or an Undefined
 * reason, and register the type as an import side effect.
 */
import type { Geometry } from '../scene';
import type { Env, Undefined } from '../registry';
import { registerType } from '../registry';
import type { Json } from '../types';

/** Read a finite number out of an untyped params bag. */
function readNumber(params: Json, key: 'x' | 'y'): number | undefined {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return undefined;
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

registerType({
  name: 'point.free',
  parentTypes: [[]],
  compute(_parents: Geometry[], params: Json, _env: Env): Geometry | Undefined {
    const x = readNumber(params, 'x');
    if (x === undefined) return { reason: 'bad params: x must be a finite number' };
    const y = readNumber(params, 'y');
    if (y === undefined) return { reason: 'bad params: y must be a finite number' };
    return { kind: 'point', at: { x, y } };
  },
});
