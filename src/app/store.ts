import { anchorsOf, computeScene, createEmptyDoc, hitTest, type Doc, type Id, type Scene, type Vec2, type Viewport } from '../engine';

const HISTORY_LIMIT = 200;

/**
 * Application spine: owns the document, its computed scene, the selection, and
 * snapshot-based undo/redo.
 *
 * Undo snapshots cover the *document content* (version, axes, objects) — never
 * the viewport. Panning/zooming is navigation: it is not undoable, and undoing
 * an edit must not yank the camera back to wherever it was when the edit
 * happened. The live viewport survives undo/redo untouched.
 *
 * Transaction pattern for continuous gestures (e.g. dragging a point):
 *   store.begin(); store.mutate(d => ...); store.mutate(d => ...); store.commit();
 * -> exactly one undo entry for the whole gesture.
 */
export class Store {
  doc: Doc;
  scene: Scene;
  selection = new Set<Id>();
  private readonly listeners = new Set<() => void>();
  private readonly undoStack: string[] = [];
  private readonly redoStack: string[] = [];
  private pending: string | null = null;

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

  /** Start a transaction; a content snapshot is taken for undo on commit. */
  begin(): void {
    this.pending = this.snapshot();
  }

  /** End a transaction: one undo entry if the content changed. */
  commit(): void {
    const before = this.pending;
    this.pending = null;
    if (before !== null && before !== this.snapshot()) this.pushUndo(before);
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

  setViewport(vp: Viewport): void {
    this.doc.viewport = vp;
    this.emit();
  }

  /** Hit-test against the current scene; world-space tolerance. Number readouts are hit via their anchors. */
  pick(world: Vec2, tolWorld: number): Id[] {
    return hitTest(this.scene, world, tolWorld, anchorsOf(this.doc, this.scene));
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
