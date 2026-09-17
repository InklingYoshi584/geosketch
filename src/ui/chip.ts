import type { Store } from '../app/store';
import type { Id } from '../engine';
import { objectLabel, typeTitle } from './labels';
import { createLiveGate } from './live';
import './actions.css';

/**
 * The undefined chip (DESIGN.md D9). A construction that cannot be computed is
 * hidden, never wrong — but silently disappearing objects are frightening, so
 * the chip says how many are gone and, on tap, *why* each one is gone.
 *
 * Tap once to open, tap again (or anywhere else) to close. The chip itself
 * disappears the moment nothing is undefined, which is the quiet auto-return.
 */
export function attachChip(el: HTMLElement, store: Store): void {
  const live = createLiveGate();
  const text = document.createElement('span');
  text.className = 'chip-text';
  const popover = document.createElement('div');
  popover.className = 'chip-pop';
  popover.hidden = true;
  el.replaceChildren(text, popover);
  el.setAttribute('role', 'button');
  el.setAttribute('aria-haspopup', 'true');

  let open = false;
  const setOpen = (next: boolean): void => {
    open = next;
    popover.hidden = !next;
    el.setAttribute('aria-expanded', String(next));
  };

  el.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('.chip-pop') !== null) return;
    if (open) {
      setOpen(false);
      return;
    }
    renderPopover(store, popover);
    setOpen(true);
  });

  document.addEventListener('click', (event) => {
    if (open && !el.contains(event.target as Node)) setOpen(false);
  });

  const render = (): void => {
    const entries = [...store.scene.undefined];
    live(
      entries.map(([id, reason]) => `${id}:${reason}`).join('|'),
      () => {
        if (entries.length === 0) {
          setOpen(false);
          popover.replaceChildren();
          el.hidden = true;
          return;
        }
        el.hidden = false;
        text.textContent = `${entries.length} 个对象当前不可见`;
      },
    );
  };

  store.subscribe(render);
  render();
}

/** Who is missing, and why — the user-facing half of an `Undefined` reason. */
function renderPopover(store: Store, popover: HTMLElement): void {
  const title = document.createElement('div');
  title.className = 'chip-pop-title';
  title.textContent = '不可见的对象（拖动可使其恢复）';
  const items = [...store.scene.undefined].map(([id, reason]) =>
    popoverItem(store, id, reason),
  );
  popover.replaceChildren(title, ...items);
}

function popoverItem(store: Store, id: Id, reason: string): HTMLElement {
  const item = document.createElement('div');
  item.className = 'chip-item';
  const rec = store.doc.objects.find((object) => object.id === id);
  const type = rec === undefined ? id : typeTitle(rec.type);
  const name = document.createElement('span');
  name.className = 'chip-item-name';
  name.textContent = rec?.label === undefined ? type : `${objectLabel(store.doc, id)} · ${type}`;
  const why = document.createElement('span');
  why.className = 'chip-item-reason';
  why.textContent = ` — ${reason}`;
  item.append(name, why);
  return item;
}
