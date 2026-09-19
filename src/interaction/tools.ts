/**
 * The tool palette's click semantics (DESIGN.md D6, revised after real use: the
 * palette is a persistent GSP-style strip whose tool you pick, then click the
 * canvas — only `select` still drives the contextual action bar).
 *
 * Everything here is a *pure reducer*: it reads the document, its computed
 * scene, the click position and the objects under it, and answers what that
 * click means — records for the caller to push through `store.edit`, the
 * selection to adopt, the object a delete lands on, and the pending-click state
 * for the next click. Nothing here touches the DOM, the store or a clock: the
 * same inputs always give the same reduction (up to the fresh ids `newId`
 * mints), which is what makes every tool testable as a plain click sequence.
 *
 * The only import from outside the engine and this folder is `Tool`, the union
 * the store owns — a type-only import, erased at compile time, so the app keeps
 * exactly one definition of what a tool is.
 *
 * The tolerance is not an input: `hits` (from `store.pick`) is already the set
 * of objects within the pointer's tolerance, so re-testing distances here would
 * be a second, drifting opinion about what the teacher tapped.
 *
 * One gesture cannot be finished here: the 文本 tool needs a string from the
 * teacher, and asking for it is the caller's job. That click therefore reduces
 * to `askAt` — "ask, and if the answer is confirmed, put text here" — so the
 * prompt (a DOM call) stays out of this module and the rest of the tool is still
 * covered by tests.
 *
 * Per-click undo granularity: every click that creates something is its own
 * edit (GSP's "the clicked point is real immediately"), so one reduction's
 * `created` records all belong to the click that produced them.
 */
import type { Tool } from '../app/store';
import {
  isPathGeometry,
  newId,
  projectPoint,
  type Doc,
  type Geometry,
  type Id,
  type Json,
  type ObjRecord,
  type Scene,
  type Vec2,
} from '../engine';

/**
 * The clicks a tool is holding. The tool is part of the state so a stale run of
 * clicks can never be applied to another tool's gesture: the board resets this
 * whenever `store.tool` changes.
 */
export interface PendingState {
  tool: Tool;
  /** Ids of point parents collected so far, in click order. */
  points: Id[];
  /** Ids of path parents (segment/line/ray/circle) collected so far, in click order. */
  paths: Id[];
}

/** Nothing collected yet (or a gesture abandoned by this tool). */
export function emptyPending(tool: Tool): PendingState {
  return { tool, points: [], paths: [] };
}

/** How many clicks the active tool is holding — what a status line reports. */
export function pendingCount(pending: PendingState): number {
  return pending.points.length + pending.paths.length;
}

export interface ClickContext {
  doc: Doc;
  scene: Scene;
  /** The click in world units (a tap's press position, not its release). */
  world: Vec2;
  /** Objects under the click, topmost first — `store.pick`'s result. */
  hits: readonly Id[];
}

export interface Reduction {
  /** Records the caller appends to the document; one `store.edit` per click. */
  created: ObjRecord[];
  /** The selection this click establishes, or `undefined` to leave it alone. */
  select?: Id[];
  /** The object a `delete` click landed on; the caller expands the cascade (D10). */
  remove?: Id;
  /**
   * The 文本 tool's click: the caller asks for the string and — only if the
   * teacher confirms — makes the text with `textRecord`.
   */
  askAt?: Vec2;
  /** What the tool is holding for the next click. */
  next: PendingState;
}

/** An object under the click that currently has geometry. */
interface Hit {
  id: Id;
  geom: Geometry;
}

/**
 * The clickable hits, topmost first. Undefined objects are dropped: they have
 * no geometry, so there is nothing to click (DESIGN.md D9) — a tool that
 * resolved to one would build on sand.
 */
function definedHits(ctx: ClickContext): Hit[] {
  const hits: Hit[] = [];
  for (const id of ctx.hits) {
    const geom = ctx.scene.geoms.get(id);
    if (geom !== undefined) hits.push({ id, geom });
  }
  return hits;
}

/** The topmost object under the click — what a click "means" when its role is open. */
function topHit(ctx: ClickContext): Hit | undefined {
  return definedHits(ctx)[0];
}

/**
 * The topmost object under the click that is of a kind the tool wants, keeping
 * hit order *within* that kind. A tool whose only gesture is "click a path"
 * (`intersection`) or "click a shape" (`measure.area`) must not be blocked by a
 * point that happens to sit on top of it.
 */
function hitWhere(ctx: ClickContext, accept: (geom: Geometry) => boolean): Hit | undefined {
  return definedHits(ctx).find((hit) => accept(hit.geom));
}

/** Narrows to a point, so a resolved hit carries its coordinates. */
function isPoint(geom: Geometry): geom is Extract<Geometry, { kind: 'point' }> {
  return geom.kind === 'point';
}

/** A…Z, then A1, B1, … — the names a geometry teacher expects. */
function labelAt(index: number): string {
  const letter = String.fromCharCode(65 + (index % 26));
  return index < 26 ? letter : `${letter}${Math.floor(index / 26)}`;
}

/** The first unused point name, so deleting A and adding a point reuses A. */
function nextLabel(doc: Doc): string {
  const used = new Set<string>();
  for (const rec of doc.objects) {
    if (rec.label?.text) used.add(rec.label.text);
  }
  let i = 0;
  while (used.has(labelAt(i))) i += 1;
  return labelAt(i);
}

function freePoint(doc: Doc, at: Vec2): ObjRecord {
  return {
    id: newId(),
    type: 'point.free',
    parents: [],
    params: { x: at.x, y: at.y },
    label: { text: nextLabel(doc) },
  };
}

/** A point glued to a path: the click position becomes the path parameter (D8). */
function onObjectPoint(doc: Doc, path: Hit, world: Vec2): ObjRecord {
  return {
    id: newId(),
    type: 'point.onObject',
    parents: [path.id],
    params: { t: projectPoint(path.geom, world) },
    label: { text: nextLabel(doc) },
  };
}

/** A construction with no parameters of its own beyond what its type needs. */
function build(type: string, parents: Id[], params: Json = {}): ObjRecord {
  return { id: newId(), type, parents, params };
}

/**
 * A click read as a point: the point under the pointer if there is one, else a
 * new point — glued to the path the click landed on, or free on empty space.
 *
 * Gluing is the GSP behaviour and the reason it matters: a segment drawn onto a
 * line must keep its endpoint *on* that line after the line is dragged, and only
 * a `point.onObject` (which stores the path parameter, never a position) does
 * that. A free point is what an empty click — or a click on something that is
 * not a path, such as a polygon's outline or a readout — leaves behind.
 */
interface PointClick {
  id: Id;
  /** The record to create, when the click was not on an existing point. */
  created?: ObjRecord;
}

function pointClick(ctx: ClickContext): PointClick {
  const top = topHit(ctx);
  if (top !== undefined && isPoint(top.geom)) return { id: top.id };
  const created =
    top !== undefined && isPathGeometry(top.geom)
      ? onObjectPoint(ctx.doc, top, ctx.world)
      : freePoint(ctx.doc, ctx.world);
  return { id: created.id, created };
}

/** A reduction that creates nothing and leaves the pending state as it was. */
function unchanged(pending: PendingState): Reduction {
  return { created: [], next: pending };
}

/**
 * Drop pending ids the document no longer has: an undo (or the inspector's
 * delete) can take away a point that a half-finished gesture was about to build
 * on, and a record with a dangling parent would be undefined forever.
 */
function livePending(ctx: ClickContext, pending: PendingState): PendingState {
  const ids = new Set(ctx.doc.objects.map((rec) => rec.id));
  const keep = (list: Id[]): Id[] => list.filter((id) => ids.has(id));
  const points = keep(pending.points);
  const paths = keep(pending.paths);
  if (points.length === pending.points.length && paths.length === pending.paths.length) {
    return pending;
  }
  return { tool: pending.tool, points, paths };
}

/** Tools that collect two point clicks and then build one object of this type. */
const TWO_POINT: Record<
  'segment' | 'line' | 'ray' | 'circle' | 'midpoint' | 'measure.distance',
  string
> = {
  segment: 'segment',
  line: 'line',
  ray: 'ray',
  // The first click is the centre: `circle.centerPoint` takes [centre, on-circle].
  circle: 'circle.centerPoint',
  midpoint: 'midpoint',
  'measure.distance': 'measure.distance',
};

/**
 * Two point clicks, then one object. A click that is not on an existing point
 * makes one (glued to a path, free on empty space) — so the first click of a
 * segment is already a real, undoable point in the figure.
 */
function reduceTwoPoint(
  ctx: ClickContext,
  pending: PendingState,
  type: string,
  oneSegment: boolean,
): Reduction {
  if (pending.points.length === 0) {
    // `midpoint` and `measure.distance` are also defined by a single segment
    // (engine signature), so one click on one completes them.
    if (oneSegment) {
      const top = topHit(ctx);
      if (top !== undefined && top.geom.kind === 'segment') {
        const record = build(type, [top.id]);
        return { created: [record], select: [record.id], next: emptyPending(pending.tool) };
      }
    }
    const first = pointClick(ctx);
    return {
      created: first.created === undefined ? [] : [first.created],
      select: [first.id],
      next: { ...pending, points: [first.id] },
    };
  }

  const second = pointClick(ctx);
  const record = build(type, [pending.points[0], second.id]);
  return {
    created: second.created === undefined ? [record] : [second.created, record],
    select: [record.id],
    next: emptyPending(pending.tool),
  };
}

/**
 * Three or more point clicks; the polygon is closed by clicking the first
 * vertex again or by pressing Enter, and Esc abandons it.
 */
function reducePolygon(ctx: ClickContext, pending: PendingState): Reduction {
  const first = pending.points[0];
  if (first !== undefined && definedHits(ctx).some((hit) => hit.id === first)) {
    return finishPending(pending);
  }
  const click = pointClick(ctx);
  // Re-tapping a vertex the run already has would fold the polygon onto itself.
  if (pending.points.includes(click.id)) return unchanged(pending);
  return {
    created: click.created === undefined ? [] : [click.created],
    select: [click.id],
    next: { ...pending, points: [...pending.points, click.id] },
  };
}

/**
 * The explicit finish gesture: Enter, or clicking the first polygon vertex a
 * second time. Only the polygon has one — every other tool completes on its own
 * next click — and a run shorter than three vertices cancels silently, because
 * there is no polygon to make (and nothing was lost: the points stay).
 */
export function finishPending(pending: PendingState): Reduction {
  if (pending.tool !== 'polygon') return unchanged(pending);
  if (pending.points.length < 3) return { created: [], next: emptyPending(pending.tool) };
  const record = build('polygon', [...pending.points]);
  return { created: [record], select: [record.id], next: emptyPending(pending.tool) };
}

/**
 * A perpendicular/parallel takes one point parent and one path parent in either
 * click order. The first click picks its own role from the topmost object (a
 * click on empty space makes the point); the second supplies whichever parent is
 * still missing, and the record stores them in the engine's order — point first,
 * path second — whatever order they were clicked.
 */
function reducePointPath(ctx: ClickContext, pending: PendingState): Reduction {
  if (pending.points.length === 0 && pending.paths.length === 0) {
    const top = topHit(ctx);
    if (top !== undefined && isPathGeometry(top.geom)) {
      return { created: [], select: [top.id], next: { ...pending, paths: [top.id] } };
    }
    if (top !== undefined && isPoint(top.geom)) {
      return { created: [], select: [top.id], next: { ...pending, points: [top.id] } };
    }
    // Empty space (or an object that cannot parent a line): put a point there.
    const created = freePoint(ctx.doc, ctx.world);
    return {
      created: [created],
      select: [created.id],
      next: { ...pending, points: [created.id] },
    };
  }

  if (pending.paths.length === 0) {
    const path = hitWhere(ctx, isPathGeometry);
    // A point is already collected, so the missing parent is a path and only a
    // path: an empty click changes nothing.
    if (path === undefined) return unchanged(pending);
    const record = build(pending.tool, [pending.points[0], path.id]);
    return { created: [record], select: [record.id], next: emptyPending(pending.tool) };
  }

  const point = pointClick(ctx);
  const record = build(pending.tool, [point.id, pending.paths[0]]);
  return {
    created: point.created === undefined ? [record] : [point.created, record],
    select: [record.id],
    next: emptyPending(pending.tool),
  };
}

/** Two path clicks; the branch hint starts at the first root the engine finds. */
function reduceIntersection(ctx: ClickContext, pending: PendingState): Reduction {
  const path = hitWhere(ctx, isPathGeometry);
  if (path === undefined) return unchanged(pending);
  if (pending.paths.length === 0) {
    return { created: [], select: [path.id], next: { ...pending, paths: [path.id] } };
  }
  const record = build('intersection', [pending.paths[0], path.id], { branch: 0 });
  return { created: [record], select: [record.id], next: emptyPending(pending.tool) };
}

/** Three point clicks; the vertex is the middle one, exactly as the engine reads the signature. */
function reduceAngle(ctx: ClickContext, pending: PendingState): Reduction {
  const click = pointClick(ctx);
  const points = [...pending.points, click.id];
  const pointRecords = click.created === undefined ? [] : [click.created];
  if (points.length < 3) {
    return { created: pointRecords, select: [click.id], next: { ...pending, points } };
  }
  const record = build('measure.angle', points);
  return {
    created: [...pointRecords, record],
    select: [record.id],
    next: emptyPending(pending.tool),
  };
}

/**
 * One click on a polygon or a circle. The shape comes from anywhere in the hit
 * list rather than from its top: a polygon's interior is not hittable, so the
 * teacher must tap its outline — and its vertices are exactly where points sit.
 */
function reduceArea(ctx: ClickContext, pending: PendingState): Reduction {
  // A polygon or a circle: the two things that enclose an area.
  const shape = hitWhere(ctx, (geom) => geom.kind === 'polygon' || geom.kind === 'circle');
  if (shape === undefined) return unchanged(pending);
  const record = build('measure.area', [shape.id]);
  return { created: [record], select: [record.id], next: emptyPending(pending.tool) };
}

/**
 * `point`: an existing point is left alone, and anything else is the same point
 * click every other tool makes — glued to a path, free on empty space. Every
 * click is its own point, so nothing pends.
 */
function reducePointTool(ctx: ClickContext, pending: PendingState): Reduction {
  const top = topHit(ctx);
  if (top !== undefined && isPoint(top.geom)) return unchanged(pending);
  const { id, created } = pointClick(ctx);
  return { created: created === undefined ? [] : [created], select: [id], next: pending };
}

/**
 * `text`: free text sits where it was typed, so the click carries no parents and
 * snaps to nothing — a click on an object places the text over that object
 * without becoming part of its definition. The string itself comes from the
 * caller (`askAt`), which is what keeps the prompt out of this module.
 */
function reduceText(ctx: ClickContext, pending: PendingState): Reduction {
  return { created: [], askAt: ctx.world, next: pending };
}

/**
 * The record a confirmed 文本 click makes: a free text at world `at`, defined by
 * nothing, so it never moves with the figure (and never disappears with it).
 */
export function textRecord(at: Vec2, text: string): ObjRecord {
  return { id: newId(), type: 'text.free', parents: [], params: { x: at.x, y: at.y, text } };
}

/**
 * `delete`: the topmost object under the click. The cascade and its preview are
 * the caller's — this only decides *which* object was aimed at.
 */
function reduceDelete(ctx: ClickContext, pending: PendingState): Reduction {
  const top = topHit(ctx);
  if (top === undefined) return unchanged(pending);
  return { created: [], remove: top.id, next: pending };
}

/** What one click means for the active tool. */
export function reduceClick(ctx: ClickContext, pending: PendingState): Reduction {
  const state = livePending(ctx, pending);
  switch (state.tool) {
    // Selection taps (toggle, and empty space clears) are the board's own; the
    // palette's tools are the only ones that reach this reducer.
    case 'select':
      return unchanged(state);
    case 'point':
      return reducePointTool(ctx, state);
    case 'segment':
    case 'line':
    case 'ray':
    case 'circle':
      return reduceTwoPoint(ctx, state, TWO_POINT[state.tool], false);
    case 'polygon':
      return reducePolygon(ctx, state);
    case 'midpoint':
    case 'measure.distance':
      return reduceTwoPoint(ctx, state, TWO_POINT[state.tool], true);
    case 'perpendicular':
    case 'parallel':
      return reducePointPath(ctx, state);
    case 'intersection':
      return reduceIntersection(ctx, state);
    case 'measure.angle':
      return reduceAngle(ctx, state);
    case 'measure.area':
      return reduceArea(ctx, state);
    case 'text':
      return reduceText(ctx, state);
    case 'delete':
      return reduceDelete(ctx, state);
  }
}
