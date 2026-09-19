import { anchorsOf, computeScene, createEmptyDoc, hitTest, type Doc, type Id, type Scene, type Vec2, type Viewport } from '../engine';

const HISTORY_LIMIT = 200;

/**
 * The active drawing tool (GSP-style persistent palette, D6 revised): the
 * palette is the primary way to create objects; the selection-based action bar
 * remains as a secondary path and is only shown while `select` is active.
 */
export type Tool =
  | 'select'
  | 'point'
  | 'text'
  | 'segment'
  | 'line'
  | 'ray'
  | 'circle'
  | 'polygon'
  | 'midpoint'
  | 'perpendicular'
  | 'parallel'
  | 'intersection'
  | 'measure.distance'
  | 'measure.angle'
  | 'measure.area'
  | 'delete';

/**
 * Application spine: owns the document, its computed scene, the selection, the
 * active tool, and snapshot-based undo/redo.
 *
 * Undo snapshots cover the *document content* (version, axes, objects) — never
 * the viewport and never the tool. Panning/zooming is navigation and the tool
 * is session state: undoing an edit must not change either.
 *
 * Transaction pattern for continuous gestures (e.g. dragging a point):
 *   store.begin(); store.mutate(d => ...); store.mutate(d => ...); store.commit();
 * -> exactly one undo entry for the whole gesture.
 */
export class Store {
  doc: Doc;
  scene: Scene;
  selection = new Set<Id>();
  /** Active palette tool; session state — never part of the document or undo. */
  tool: Tool = 'select';
  private readonly listeners = new Set<() => void>();
  private readonly undoStack: string[] = [];
  private readonly redoStack: string[] = [];
  private readonly pending: string[] = [];

  constructor(doc: Doc = createEmptyDoc()) {
    this.doc = doc;
    this.scene = computeScene(doc);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /**
   * Start a transaction; a content snapshot is taken for undo on commit.
   * Transactions nest (a drag can open inside an animation run): only the
   * outermost commit pushes an undo entry, so an inner gesture can never
   * clobber another's baseline.
   */
  begin(): void {
    this.pending.push(this.snapshot());
  }

  /** End a transaction: one undo entry when the outermost one closes with changes. */
  commit(): void {
    const before = this.pending.pop();
    if (before !== undefined && this.pending.length === 0 && before !== this.snapshot()) {
      this.pushUndo(before);
    }
    this.emit();
  }

  /** Standalone mutation: exactly one undo entry. */
  edit(mut: (doc: Doc) => void): void {
    const before = this.snapshot();
    mut(this.doc);
    if (before === this.snapshot()) return;
    this.pushUndo(before);
    this.recompute();
    this.emit();
  }

  /** In-transaction mutation (between begin/commit): no undo entry of its own. */
  mutate(mut: (doc: Doc) => void): void {
    mut(this.doc);
    this.recompute();
    this.emit();
  }

  undo(): void {
    const snapshot = this.undoStack.pop();
    if (snapshot === undefined) return;
    this.redoStack.push(this.snapshot());
    this.restore(snapshot);
  }

  redo(): void {
    const snapshot = this.redoStack.pop();
    if (snapshot === undefined) return;
    this.undoStack.push(this.snapshot());
    this.restore(snapshot);
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  load(doc: Doc): void {
    this.doc = doc;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.selection.clear();
    this.recompute();
    this.emit();
  }

  setSelection(ids: Id[]): void {
    this.selection = new Set(ids);
    this.emit();
  }

  setTool(tool: Tool): void {
    if (this.tool === tool) return;
    this.tool = tool;
    this.emit();
  }

  setViewport(vp: Viewport): void {
    this.doc.viewport = vp;
    this.emit();
  }

  /** Hit-test against the current scene; world-space tolerance. Number readouts are hit via their anchors; hidden objects are unhittable (a single mechanism: hitTest's optional `hidden` set). */
  pick(world: Vec2, tolWorld: number): Id[] {
    const hidden = new Set<Id>();
    for (const rec of this.doc.objects) if (rec.display?.hidden === true) hidden.add(rec.id);
    return hitTest(this.scene, world, tolWorld, anchorsOf(this.doc, this.scene), hidden);
  }

  /** Document content only — the viewport is deliberately excluded (see class docs). */
  private snapshot(): string {
    const { version, axes, objects } = this.doc;
    return JSON.stringify(axes === undefined ? { version, objects } : { version, axes, objects });
  }

  private restore(snapshot: string): void {
    const content = JSON.parse(snapshot) as Omit<Doc, 'viewport'>;
    this.doc = { ...content, viewport: this.doc.viewport };
    const alive = new Set(this.doc.objects.map((o) => o.id));
    for (const id of this.selection) if (!alive.has(id)) this.selection.delete(id);
    this.recompute();
    this.emit();
  }

  private pushUndo(snapshot: string): void {
    this.undoStack.push(snapshot);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  private recompute(): void {
    this.scene = computeScene(this.doc);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
