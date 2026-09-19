/**
 * Measurements (DESIGN.md §3 "Measurements as objects"): first-class readout
 * objects. Most are a `number` geometry — they render as a numeric readout and
 * can feed other constructions (circle radius, calculations, …) exactly like any
 * other geometry. Two of them are deliberately *not* numbers: 坐标 and 方程 have
 * no single numeric value, so they produce the `text` kind — a readout anchored
 * at the parent, dragging along with it (see each type below).
 *
 * Values are world units (D18), y-up, and every `compute` is pure: the same
 * parents and params yield the same result, with no dependence on the viewport.
 * A measurement whose parents are degenerate returns an `Undefined` reason
 * (D9) rather than a NaN — a NaN readout would poison every consumer.
 */
import type { Geometry, LineLikeGeometry } from '../scene';
import { magnitude, positiveSweep, unitDirection } from '../scene';
import type { Env, Undefined } from '../registry';
import { registerType } from '../registry';
import type { Json, Vec2 } from '../types';
import { EPS, cross, dist, dot, lerp } from '../kernel/vec2';

/** Degrees per radian, as a named constant: `* 180 / Math.PI` reads as noise. */
const DEG_PER_RAD = 180 / Math.PI;

/** A full turn — the circle perimeter, and the top of an arc's sweep range. */
const TWO_PI = Math.PI * 2;

/** Both coordinates finite? Guards against a malformed document seeding NaN. */
function finite(v: Vec2): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y);
}

/** Read `n` point parents, or `undefined` if the arity/kinds are wrong. */
function asPoints(parents: Geometry[], n: number): Vec2[] | undefined {
  if (parents.length !== n) return undefined;
  const points: Vec2[] = [];
  for (const parent of parents) {
    if (parent.kind !== 'point') return undefined;
    points.push(parent.at);
  }
  return points;
}

/** What the slope and equation readouts read off a straight parent. */
interface Straight {
  /** Unit direction along the path — a segment's endpoint difference, a line/ray's own. */
  dir: Vec2;
  /**
   * The sample point a readout anchors at: a segment's midpoint, a line/ray's
   * `at` (the frozen `anchorsOf` rule). Always a fresh vector — nothing a
   * `compute` hands out ever aliases a parent's geometry.
   */
  anchor: Vec2;
}

/**
 * Resolve a straight parent, or say why it cannot be read: `非有限坐标` for a
 * malformed document, `退化` for a path with no direction at all (a zero-length
 * segment, a zero line direction). A vertical path is *not* a failure here — it
 * resolves with `dir.x = 0`, and the readouts that cannot live with that say so
 * themselves. Both readouts share this resolution so they agree about which
 * paths are degenerate.
 *
 * A line/ray direction is renormalised even though the contract stores a unit
 * vector, so a malformed document cannot shear the slope. `unitDirection`'s
 * relative test is what makes the segment case agree with the rest of the engine
 * about "this segment is really a point".
 */
function straightOf(parent: LineLikeGeometry): Straight | Undefined {
  if (parent.kind === 'segment') {
    if (!finite(parent.a) || !finite(parent.b)) return { reason: '非有限坐标' };
    const dir = unitDirection(parent.a, parent.b);
    return dir === undefined ? { reason: '退化' } : { dir, anchor: lerp(parent.a, parent.b, 0.5) };
  }
  if (!finite(parent.at) || !finite(parent.dir)) return { reason: '非有限坐标' };
  const length = Math.hypot(parent.dir.x, parent.dir.y);
  if (!(length > 0)) return { reason: '退化' };
  return {
    dir: { x: parent.dir.x / length, y: parent.dir.y / length },
    anchor: { x: parent.at.x, y: parent.at.y },
  };
}

/** Is `parent` a straight kind (segment, line or ray)? */
function isStraight(parent: Geometry): parent is LineLikeGeometry {
  return parent.kind === 'segment' || parent.kind === 'line' || parent.kind === 'ray';
}

/**
 * A line like this is vertical when its unit direction's `x` vanishes — an
 * absolute test on a *unit* vector, so it is relative to the geometry's own size
 * even though `EPS` is used bare: a segment leaning by less than a nanoradian is
 * vertical for every purpose the readout has.
 */
function isVertical(dir: Vec2): boolean {
  return Math.abs(dir.x) <= EPS;
}

/** `value` rounded to the two decimals every readout prints. */
function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The typographic minus, U+2212: a readout is mathematics, not code. */
const MINUS = '−';

/**
 * A number formatted as the readouts print it: two decimals, with `-` written as
 * a typographic minus. Rounding first is what keeps the printed *sign* in step
 * with the printed digits (`-0.004` must not read `-0.00`).
 */
function num(value: number): string {
  const text = rounded(value).toFixed(2);
  return text.startsWith('-') ? `${MINUS}${text.slice(1)}` : text;
}

/** `x²`, `(x − v)²` or `(x + v)²` — one coordinate term of a circle's equation. */
function squareTerm(name: string, value: number): string {
  const v = rounded(value);
  if (v === 0) return `${name}²`;
  return v > 0 ? `(${name} ${MINUS} ${num(v)})²` : `(${name} + ${num(-v)})²`;
}

/** The ` + b` / ` − b` tail of `y = mx + b`, empty when `b` prints as zero. */
function constantTerm(value: number): string {
  const v = rounded(value);
  if (v === 0) return '';
  return v > 0 ? ` + ${num(v)}` : ` ${MINUS} ${num(-v)}`;
}

/**
 * `y = mx + b` for the line of slope `m` through `anchor`. A slope that prints
 * as `0.00` is the horizontal line `y = b`, and an intercept that prints as zero
 * is dropped (`y = 0.75x`) — otherwise every readout would trail ` + 0.00`.
 */
function lineEquation(slope: number, anchor: Vec2): string {
  if (rounded(slope) === 0) return `y = ${num(anchor.y)}`;
  return `y = ${num(slope)}x${constantTerm(anchor.y - slope * anchor.x)}`;
}

registerType({
  name: 'measure.distance',
  title: '距离',
  // Two accepted signatures of different arities: two points, or one segment
  // whose length is the distance (the first is the general form, so
  // `measure.distance:0` keeps its meaning for the action layer).
  parentKinds: [['point', 'point'], ['segment']],
  /**
   * |AB| in world units. Two coincident points measure 0, which is a
   * legitimate distance — and so does a zero-length segment.
   */
  compute(parents: Geometry[], _params: Json, _env: Env): Geometry | Undefined {
    if (parents.length === 1) {
      const parent = parents[0];
      if (parent.kind !== 'segment') return { reason: 'bad parents: expected two points or a segment' };
      if (!finite(parent.a) || !finite(parent.b)) return { reason: '非有限坐标' };
      return { kind: 'number', value: dist(parent.a, parent.b) };
    }
    const points = asPoints(parents, 2);
    if (!points) return { reason: 'bad parents: expected two points' };
    if (!points.every(finite)) return { reason: '非有限坐标' };
    return { kind: 'number', value: dist(points[0], points[1]) };
  },
});

registerType({
  name: 'measure.angle',
  title: '角度',
  parentKinds: [['point', 'point', 'point']],
  /**
   * ∠(parents[0], parents[1], parents[2]) in degrees, the vertex being the
   * *middle* parent. `acos` of the clamped dot product of the two unit arms
   * lands in [0, 180] by construction; the clamp only absorbs the float error
   * that would otherwise make `acos` return NaN at exactly 0° or 180°.
   */
  compute(parents: Geometry[], _params: Json, _env: Env): Geometry | Undefined {
    const points = asPoints(parents, 3);
    if (!points) return { reason: 'bad parents: expected three points' };
    if (!points.every(finite)) return { reason: '非有限坐标' };
    const vertex = points[1];
    const arm1 = unitDirection(vertex, points[0]);
    const arm2 = unitDirection(vertex, points[2]);
    if (!arm1 || !arm2) return { reason: '角的边退化' };
    const cos = Math.min(1, Math.max(-1, dot(arm1, arm2)));
    return { kind: 'number', value: Math.acos(cos) * DEG_PER_RAD, unit: 'deg' };
  },
});

registerType({
  name: 'measure.area',
  title: '面积',
  // Two accepted signatures of the same arity (registry.ts `parentKinds` lists
  // one entry per legal signature, so a union of kinds is two entries).
  parentKinds: [['polygon'], ['circle']],
  /**
   * Area in world units² — the shoelace formula for a polygon (absolute value,
   * so vertex order may be either winding), πr² for a circle. A self-
   * intersecting polygon measures its signed regions summed, which is the
   * standard convention and not worth special-casing for quiz figures.
   */
  compute(parents: Geometry[], _params: Json, _env: Env): Geometry | Undefined {
    if (parents.length !== 1) return { reason: 'bad parents: expected a polygon or a circle' };
    const shape = parents[0];
    if (shape.kind === 'circle') {
      if (!Number.isFinite(shape.radius) || shape.radius < 0) return { reason: '半径为零' };
      return { kind: 'number', value: Math.PI * shape.radius * shape.radius };
    }
    if (shape.kind === 'polygon') {
      const points = shape.points;
      if (points.length < 3) return { reason: '退化' };
      if (!points.every(finite)) return { reason: '非有限坐标' };
      let twiceArea = 0;
      for (let i = 0; i < points.length; i++) {
        twiceArea += cross(points[i], points[(i + 1) % points.length]);
      }
      return { kind: 'number', value: Math.abs(twiceArea) / 2 };
    }
    return { reason: 'bad parents: expected a polygon or a circle' };
  },
});

registerType({
  name: 'measure.perimeter',
  title: '周长',
  // One entry per legal signature, as in `measure.area`: "polygon or circle" is
  // two signatures of the same arity.
  parentKinds: [['polygon'], ['circle']],
  /**
   * Perimeter in world units: the sum of a polygon's edges (closed back to the
   * first vertex), 2πr for a circle. A zero radius is the legitimate 0; a
   * negative one is a malformed document, not a shape.
   */
  compute(parents: Geometry[], _params: Json, _env: Env): Geometry | Undefined {
    if (parents.length !== 1) return { reason: 'bad parents: expected a polygon or a circle' };
    const shape = parents[0];
    if (shape.kind === 'circle') {
      if (!finite(shape.center) || !Number.isFinite(shape.radius)) return { reason: '非有限坐标' };
      if (shape.radius < 0) return { reason: '半径为零' };
      return { kind: 'number', value: TWO_PI * shape.radius };
    }
    if (shape.kind === 'polygon') {
      const points = shape.points;
      if (points.length < 3) return { reason: '退化' };
      if (!points.every(finite)) return { reason: '非有限坐标' };
      let perimeter = 0;
      for (let i = 0; i < points.length; i++) {
        perimeter += dist(points[i], points[(i + 1) % points.length]);
      }
      return { kind: 'number', value: perimeter };
    }
    return { reason: 'bad parents: expected a polygon or a circle' };
  },
});

registerType({
  name: 'measure.slope',
  title: '斜率',
  // Three signatures of the same arity: a segment, a line, or a ray. The slope
  // of a segment and of the line through it is one number, so they share a type
  // instead of one type per shape.
  parentKinds: [['segment'], ['line'], ['ray']],
  /**
   * dy/dx of a straight object. A vertical path has no slope at all, so it is
   * `Undefined`'s 斜率不存在 rather than an infinity: an infinite readout cannot
   * be dragged back into meaning, and every consumer of the number would inherit
   * it. A path with no direction (zero length, zero direction) is 退化.
   */
  compute(parents: Geometry[], _params: Json, _env: Env): Geometry | Undefined {
    const parent = parents.length === 1 ? parents[0] : undefined;
    if (parent === undefined || !isStraight(parent)) {
      return { reason: 'bad parents: expected a segment, line or ray' };
    }
    const straight = straightOf(parent);
    if ('reason' in straight) return straight;
    if (isVertical(straight.dir)) return { reason: '斜率不存在' };
    // `|| 0` folds the negative zero a right-to-left horizontal segment produces
    // (0 ÷ negative = −0): the readout prints two decimals, and `−0.00` would be
    // a claim about the sign that the geometry does not make. Nothing else can be
    // falsy here — the vertical test above guarantees a non-zero divisor.
    return { kind: 'number', value: straight.dir.y / straight.dir.x || 0 };
  },
});

registerType({
  name: 'measure.ratio',
  title: '比',
  parentKinds: [['segment', 'segment']],
  /**
   * |AB| / |CD|, in click order — the numerator is the first segment selected,
   * which is the only thing that makes a ratio's order visible to the user. A
   * zero-length *numerator* is the legitimate 0; a zero-length *divisor* has no
   * quotient, hence 比的分母为零. The divisor is tested for zero relatively (D9:
   * no absolute equality), so a segment collapsed by a degenerate construction
   * is refused rather than allowed to emit a meaningless huge number.
   */
  compute(parents: Geometry[], _params: Json, _env: Env): Geometry | Undefined {
    if (parents.length !== 2) return { reason: 'bad parents: expected two segments' };
    const numerator = parents[0];
    const denominator = parents[1];
    if (numerator.kind !== 'segment' || denominator.kind !== 'segment') {
      return { reason: 'bad parents: expected two segments' };
    }
    for (const end of [numerator.a, numerator.b, denominator.a, denominator.b]) {
      if (!finite(end)) return { reason: '非有限坐标' };
    }
    const divisor = dist(denominator.a, denominator.b);
    if (!(divisor > EPS * magnitude(denominator.a, denominator.b))) {
      return { reason: '比的分母为零' };
    }
    return { kind: 'number', value: dist(numerator.a, numerator.b) / divisor };
  },
});

registerType({
  name: 'measure.arcLength',
  title: '弧长',
  parentKinds: [['arc']],
  /**
   * r · θ for the arc's swept angle θ (the frozen `arc` shape normalises the CCW
   * sweep into (0, 2π]). A zero radius is the legitimate 0; a negative one is a
   * malformed document.
   */
  compute(parents: Geometry[], _params: Json, _env: Env): Geometry | Undefined {
    const arc = parents.length === 1 ? parents[0] : undefined;
    if (arc === undefined || arc.kind !== 'arc') return { reason: 'bad parents: expected an arc' };
    if (!finite(arc.center) || !Number.isFinite(arc.radius) || !Number.isFinite(arc.from) || !Number.isFinite(arc.to)) {
      return { reason: '非有限坐标' };
    }
    if (arc.radius < 0) return { reason: '半径为零' };
    return { kind: 'number', value: arc.radius * positiveSweep(arc.from, arc.to) };
  },
});

registerType({
  name: 'measure.arcAngle',
  title: '弧角',
  parentKinds: [['arc']],
  /**
   * The arc's swept angle in degrees, tagged `unit: 'deg'` so the readout prints
   * `45.0°` like an angle measurement (the number type carries only that one
   * unit). The sweep itself is the same (0, 2π] quantity 弧长 uses, so the two
   * readouts can never disagree about how much arc there is.
   */
  compute(parents: Geometry[], _params: Json, _env: Env): Geometry | Undefined {
    const arc = parents.length === 1 ? parents[0] : undefined;
    if (arc === undefined || arc.kind !== 'arc') return { reason: 'bad parents: expected an arc' };
    if (!finite(arc.center) || !Number.isFinite(arc.radius) || !Number.isFinite(arc.from) || !Number.isFinite(arc.to)) {
      return { reason: '非有限坐标' };
    }
    if (arc.radius < 0) return { reason: '半径为零' };
    return { kind: 'number', value: positiveSweep(arc.from, arc.to) * DEG_PER_RAD, unit: 'deg' };
  },
});

registerType({
  name: 'measure.coordinates',
  title: '坐标',
  parentKinds: [['point']],
  /**
   * A point's coordinates as a `text` readout — deliberately *not* a `number`:
   * a pair is not one value, and pretending otherwise would let a pair silently
   * feed a circle radius or a calculation. Anchored at the point itself (the
   * frozen `anchorsOf` rule for text: its own `at`), so the readout drags with
   * the point it describes; the label offset is what visibly displaces it, which
   * keeps this free of any viewport dependence (D18). Until the axis object
   * lands (wave B) these are world coordinates.
   */
  compute(parents: Geometry[], _params: Json, _env: Env): Geometry | Undefined {
    const point = parents.length === 1 ? parents[0] : undefined;
    if (point === undefined || point.kind !== 'point') return { reason: 'bad parents: expected a point' };
    if (!finite(point.at)) return { reason: '非有限坐标' };
    return {
      kind: 'text',
      at: { x: point.at.x, y: point.at.y },
      text: `(${num(point.at.x)}, ${num(point.at.y)})`,
    };
  },
});

registerType({
  name: 'measure.equation',
  title: '方程',
  // One entry per legal signature: the three straight kinds then the circle.
  parentKinds: [['segment'], ['line'], ['ray'], ['circle']],
  /**
   * The parent's equation as a `text` readout (again not a `number`: an equation
   * is not a value). A straight path gives `y = mx + b`, or `x = c` when it is
   * vertical; a circle gives `(x − a)² + (y − b)² = r²`. Two decimals, the
   * readout precision of the rest of the engine, and a typographic minus so it
   * reads like the mathematics it is. Anchored at the parent's sample point —
   * segment midpoint, line/ray `at`, circle centre — per the frozen `anchorsOf`
   * rule for text objects, so it drags with what it describes.
   */
  compute(parents: Geometry[], _params: Json, _env: Env): Geometry | Undefined {
    if (parents.length !== 1) return { reason: 'bad parents: expected a segment, line, ray or circle' };
    const parent = parents[0];
    if (parent.kind === 'circle') {
      if (!finite(parent.center) || !Number.isFinite(parent.radius)) return { reason: '非有限坐标' };
      if (parent.radius < 0) return { reason: '半径为零' };
      const left = `${squareTerm('x', parent.center.x)} + ${squareTerm('y', parent.center.y)}`;
      return {
        kind: 'text',
        at: { x: parent.center.x, y: parent.center.y },
        text: `${left} = ${num(parent.radius * parent.radius)}`,
      };
    }
    if (!isStraight(parent)) return { reason: 'bad parents: expected a segment, line, ray or circle' };
    const straight = straightOf(parent);
    if ('reason' in straight) return straight;
    const { dir, anchor } = straight;
    return {
      kind: 'text',
      at: anchor,
      text: isVertical(dir) ? `x = ${num(anchor.x)}` : lineEquation(dir.y / dir.x, anchor),
    };
  },
});
