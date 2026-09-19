import { newId, type Id } from '../engine';
import { cascadeIds, deleteWithPreview } from '../ui/inspector';
import type { Store } from './store';

/**
 * The browser-side command implementations behind the GSP-style menu bar.
 *
 * These live in the app layer so `main.ts` stays the single seam where UI,
 * interaction and the engine meet: the menu model takes this object as data
 * (see `engine/menu-model.ts`), it never imports the modules below itself.
 *
 * NOTE(layering): `cascadeIds` / `deleteWithPreview` currently live in
 * `src/ui/inspector.ts`; they are document operations and should move to the
 * engine (or this layer) once a third consumer appears.
 */

export function selectAll(store: Store): void {
  store.setSelection(store.doc.objects.map((rec) => rec.id));
}

/** GSP 编辑 → 选择父对象: the parents of everything currently selected. */
export function selectParents(store: Store): void {
  const selected = store.selection;
  const parents = new Set<Id>();
  for (const rec of store.doc.objects) {
    if (!selected.has(rec.id)) continue;
    for (const parent of rec.parents) parents.add(parent);
  }
  if (parents.size > 0) store.setSelection([...parents]);
}

/** GSP 编辑 → 选择子对象: everything defined from the current selection. */
export function selectChildren(store: Store): void {
  const selected = store.selection;
  const children = store.doc.objects
    .filter((rec) => rec.parents.some((parent) => selected.has(parent)))
    .map((rec) => rec.id);
  if (children.length > 0) store.setSelection(children);
}

/**
 * Delete the selection with the D10 preview. A single root reuses the
 * inspector's own path (identical wording); several roots are collected into
 * one preview and removed atomically, so undo restores the whole batch.
 */
export function deleteSelection(store: Store): void {
  const roots = [...store.selection];
  if (roots.length === 0) return;
  if (roots.length === 1) {
    deleteWithPreview(store, roots[0]);
    return;
  }

  const doomed = new Set<Id>();
  for (const root of roots) for (const id of cascadeIds(store.doc, root)) doomed.add(id);
  if (doomed.size > roots.length) {
    const names = store.doc.objects
      .filter((rec) => doomed.has(rec.id) && !roots.includes(rec.id))
      .map((rec) => rec.label?.text ?? rec.type);
    if (!window.confirm(`同时删除 ${names.length} 个依赖对象（${names.slice(0, 6).join('、')}${names.length > 6 ? '…' : ''}）？`)) return;
  }

  store.edit((doc) => {
    doc.objects = doc.objects.filter((rec) => !doomed.has(rec.id));
  });
  store.setSelection([]);
}

/**
 * GSP 编辑 → 分离: freeze dependent *point* objects at their current position.
 * Non-point objects are left alone (their frozen form would need the shape to
 * be rebuilt from its own geometry, which wave B's transforms make cheap).
 */
export function detachSelection(store: Store): void {
  const ids = [...store.selection].filter((id) => store.scene.geoms.get(id)?.kind === 'point');
  const detachable = ids.filter((id) => {
    const rec = store.doc.objects.find((o) => o.id === id);
    return rec !== undefined && rec.type !== 'point.free';
  });
  if (detachable.length === 0) return;

  store.edit((doc) => {
    for (const id of detachable) {
      const index = doc.objects.findIndex((rec) => rec.id === id);
      const rec = doc.objects[index];
      const at = store.scene.geoms.get(id);
      if (rec === undefined || at === undefined || at.kind !== 'point') continue;
      const frozen: (typeof doc.objects)[number] = {
        id: newId(),
        type: 'point.free',
        parents: [],
        params: { x: at.at.x, y: at.at.y },
      };
      if (rec.style !== undefined) frozen.style = rec.style;
      if (rec.label !== undefined) frozen.label = rec.label;
      doc.objects[index] = frozen;
    }
  });
}

/** Export the board as a PNG file (the canvas is drawn in CSS pixels × dpr). */
export function exportPng(fileName = 'geosketch.png'): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#board');
  if (canvas === null) return;
  canvas.toBlob((blob) => {
    if (blob === null) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, 'image/png');
}

export function printSketch(): void {
  window.print();
}
