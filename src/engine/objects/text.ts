/**
 * `text.free` — free text annotation (DESIGN.md §3 "free text annotation",
 * §8.1 wave A): the object behind the 文本 tool.
 *
 * Unlike every other type it is defined by nothing at all — its position and
 * its string are its own parameters, exactly like `point.free` — so the text
 * kind is a *drawing* on the sketch rather than part of the construction. The
 * anchor is what the hit test measures to and what the renderer draws from,
 * since measuring a real text box would need font metrics the DOM-free engine
 * deliberately does not have (scene.ts `Geometry`).
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
  name: 'text.free',
  title: '文本',
  parentKinds: [[]],
  compute(_parents: Geometry[], params: Json, _env: Env): Geometry | Undefined {
    const x = readNumber(params, 'x');
    const y = readNumber(params, 'y');
    if (x === undefined || y === undefined) return { reason: '非有限坐标' };
    const text = typeof params === 'object' && params !== null && !Array.isArray(params) ? params.text : undefined;
    // An empty string is a legitimate annotation the user is still typing, so
    // only a missing or non-string one is refused.
    if (typeof text !== 'string') return { reason: '文本内容无效' };
    return { kind: 'text', at: { x, y }, text };
  },
});
