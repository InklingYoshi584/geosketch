import type { Store } from '../app/store';
import type { Doc, Id, ObjRecord, Vec2 } from '../engine';
import { objectLabel, typeTitle } from './labels';
import { createLiveGate } from './live';
import './actions.css';

/** What a free point says about itself (DESIGN.md D10 lifecycle vocabulary). */
const FREE_POINT = '自由点';

/**
 * The dependency inspector (DESIGN.md §3 "Trust surface"): what is this thing
 * *made of*, what would deleting it take with it, and how do I cut it loose?
 *
 * Shown only for a single selected object — with nothing or several selected
 * there is no one definition to describe.
 */
export function attachInspector(el: HTMLElement, store: Store): void {
  const live = createLiveGate();
  const render = (): void => {
    const selection = [...store.selection];
    const rec =
      selection.length === 1
        ? store.doc.objects.find((object) => object.id === selection[0])
        : undefined;
    // The definition line covers labels, parents and the document; a drag only
    // moves the object, so the sheet does not have to follow it (its buttons
    // read the live store when pressed).
    const key =
      rec === undefined
        ? ''
        : [
            definitionLine(store.doc, rec),
            store.scene.undefined.get(rec.id) ?? '',
            detachPosition(store, rec) === undefined ? 'static' : 'point',
          ].join('#');
    live(key, () => {
      if (rec === undefined) {
        el.replaceChildren();
        el.hidden = true;
        return;
      }
      el.hidden = false;
      el.replaceChildren(...sheetChildren(store, rec));
    });
  };

  store.subscribe(render);
  render();
}

function sheetChildren(store: Store, rec: ObjRecord): Node[] {
  const title = document.createElement('div');
  title.className = 'sheet-title';
  title.textContent = definitionLine(store.doc, rec);
  const nodes: Node[] = [title];

  const reason = store.scene.undefined.get(rec.id);
  if (reason !== undefined) {
    const line = document.createElement('div');
    line.className = 'sheet-reason';
    line.textContent = `当前不可见：${reason}`;
    nodes.push(line);
  }

  const actions = document.createElement('div');
  actions.className = 'sheet-actions';
  actions.append(deleteButton(store, rec));
  if (detachPosition(store, rec) !== undefined) actions.append(detachButton(store, rec));
  nodes.push(actions);
  return nodes;
}

/** `M = 中点：由 A、B 定义` — the definition, in the parents' own names. */
function definitionLine(doc: Doc, rec: ObjRecord): string {
  const title = typeTitle(rec.type);
  const name = rec.label?.text;
  if (rec.type === 'point.free') {
    return name === undefined ? FREE_POINT : `${name} = ${FREE_POINT}`;
  }
  const head = name === undefined || name === title ? title : `${name} = ${title}`;
  if (rec.parents.length === 0) return head;
  const parents = rec.parents.map((id) => objectLabel(doc, id)).join('、');
  return `${head}：由 ${parents} 定义`;
}

/**
 * Detach is offered exactly for objects whose geometry *is* a point and which
 * have parents to cut: point.onObject, midpoint and intersection results. A
 * segment has no single position to freeze at.
 */
function detachPosition(store: Store, rec: ObjRecord): Vec2 | undefined {
  if (rec.parents.length === 0) return undefined;
  const geometry = store.scene.geoms.get(rec.id);
  return geometry?.kind === 'point' ? geometry.at : undefined;
}

function deleteButton(store: Store, rec: ObjRecord): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sheet-btn danger';
  button.textContent = '删除';
  button.addEventListener('click', () => {
    const doomed = [rec.id, ...cascadeIds(store.doc, rec.id)];
    if (!window.confirm(deletePreview(store.doc, rec, doomed))) return;
    const dead = new Set(doomed);
    // One edit for the whole cascade: undo restores the figure atomically (D10).
    store.edit((doc) => {
      doc.objects = doc.objects.filter((object) => !dead.has(object.id));
    });
    store.setSelection([...store.selection].filter((id) => !dead.has(id)));
  });
  return button;
}

function deletePreview(doc: Doc, rec: ObjRecord, doomed: Id[]): string {
  const name = objectLabel(doc, rec.id);
  const dependents = doomed.slice(1).map((id) => objectLabel(doc, id));
  if (dependents.length === 0) return `删除「${name}」？`;
  return [
    `删除「${name}」将同时删除 ${dependents.length} 个依赖对象：`,
    dependents.join('、'),
    '',
    '确定删除？',
  ].join('\n');
}

function detachButton(store: Store, rec: ObjRecord): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sheet-btn';
  button.textContent = '分离';
  button.title = '保留当前位置，断开与父对象的定义关系';
  button.addEventListener('click', () => {
    // Read the position now: the object may have been dragged since the sheet
    // last rendered, and detaching must freeze where it *is*.
    const at = detachPosition(store, rec);
    if (at === undefined) return;
    store.edit((doc) => {
      const index = doc.objects.findIndex((object) => object.id === rec.id);
      if (index === -1) return;
      // Same id, same place in the document: dependents on this object keep
      // working, they simply stop tracking anything.
      const free: ObjRecord = {
        id: rec.id,
        type: 'point.free',
        parents: [],
        params: { x: at.x, y: at.y },
      };
      if (rec.style !== undefined) free.style = rec.style;
      if (rec.label !== undefined) free.label = rec.label;
      doc.objects[index] = free;
    });
  });
  return button;
}

/**
 * Every object that depends on `root`, directly or transitively, in document
 * order — exactly the set a cascade delete removes, and exactly the set the
 * preview must list (D10). Cycle-safe.
 */
export function cascadeIds(doc: Doc, root: Id): Id[] {
  const children = new Map<Id, Id[]>();
  for (const rec of doc.objects) {
    for (const parent of rec.parents) {
      const siblings = children.get(parent);
      if (siblings === undefined) children.set(parent, [rec.id]);
      else siblings.push(rec.id);
    }
  }
  const seen = new Set<Id>([root]);
  const queue: Id[] = [root];
  for (let head = 0; head < queue.length; head++) {
    for (const child of children.get(queue[head]) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      queue.push(child);
    }
  }
  seen.delete(root);
  return doc.objects.filter((rec) => seen.has(rec.id)).map((rec) => rec.id);
}
