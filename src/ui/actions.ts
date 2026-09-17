import type { Store } from '../app/store';
import type { Id } from '../engine';
import { actionsFor, nextStepHint, type Action } from '../engine/actions';
import { createLiveGate } from './live';
import './actions.css';

/**
 * The contextual action bar (DESIGN.md D6 "selection-first + contextual
 * actions"). It is a pure view of `actionsFor`: nothing is offered that the
 * engine cannot actually build from the current selection, and nothing that is
 * possible is missing.
 *
 * Everything is driven by the store subscription — no polling, no local state.
 * A press builds its objects and pushes them in one `store.edit`, so one press
 * is one undo entry; the created objects become the selection, which is what
 * makes constructions chain (两点 → 线段 → 中点 → …).
 */
export function attachActionBar(el: HTMLElement, store: Store): void {
  const live = createLiveGate();
  const render = (): void => {
    // A Set iterates in insertion order, which is click order — the order the
    // engine reads parents in.
    const selection = [...store.selection];
    const actions = selection.length === 0 ? [] : actionsFor(store.doc, store.scene, selection);
    const key = `${selection.join('|')}#${actions.map((action) => `${action.id}:${action.title}`).join('|')}`;
    live(key, () => {
      if (selection.length === 0) {
        el.replaceChildren();
        el.hidden = true;
        return;
      }
      el.hidden = false;
      el.replaceChildren(...barChildren(store, selection, actions));
    });
  };

  store.subscribe(render);
  render();
}

/** The bar's children: one group per action group, then the clear button. */
function barChildren(store: Store, selection: Id[], actions: Action[]): Node[] {
  const nodes: Node[] = [];
  let group: string | undefined;
  let bucket: HTMLElement | null = null;
  for (const action of actions) {
    if (bucket === null || action.group !== group) {
      group = action.group;
      bucket = document.createElement('div');
      bucket.className = 'ab-group';
      if (group !== undefined) {
        const label = document.createElement('span');
        label.className = 'ab-group-label';
        label.textContent = group;
        bucket.append(label);
      }
      nodes.push(bucket);
    }
    bucket.append(actionButton(action, store));
  }
  if (actions.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'ab-empty';
    empty.textContent =
      nextStepHint(store.doc, store.scene, selection) ?? '当前选择没有可执行的操作';
    nodes.push(empty);
  }
  nodes.push(closeButton(store));
  return nodes;
}

function actionButton(action: Action, store: Store): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ab-btn';
  button.dataset.action = action.id;
  button.textContent = action.title;
  button.addEventListener('click', () => {
    const { created, select } = action.apply(store.doc, [...store.selection]);
    if (created.length === 0) return;
    store.edit((doc) => {
      doc.objects.push(...created);
    });
    store.setSelection(select ?? []);
  });
  return button;
}

function closeButton(store: Store): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ab-close';
  button.textContent = '✕';
  button.title = '清除选择';
  button.setAttribute('aria-label', '清除选择');
  button.addEventListener('click', () => {
    store.setSelection([]);
  });
  return button;
}
