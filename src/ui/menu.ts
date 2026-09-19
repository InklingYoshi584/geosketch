import type { Store } from '../app/store';
import { buildMenus, type MenuCommands, type MenuItem, type MenuGroup } from '../engine/menu-model';
import { createLiveGate } from './live';
import './menu.css';

/**
 * The GSP-style menu bar (DESIGN.md §8.1): 文件 编辑 显示 构造 度量 变换 数据 绘图,
 * rendered from `buildMenus` — the model in `engine/menu-model.ts` holds the tree,
 * this module owns the DOM and the stylesheet.
 *
 * Everything is driven by the store subscription; the bar itself holds no state
 * beyond which menu is open. A menu opens on **tap** and never on hover (the
 * classroom board has no hover — DESIGN.md §3 "no affordance that requires
 * hover"), closes on a tap outside it, on Escape, and after an entry runs.
 */
export function attachMenuBar(el: HTMLElement, store: Store, commands: MenuCommands): void {
  const titles: HTMLButtonElement[] = [];
  const popups: HTMLElement[] = [];
  /** The open menu, or `null` when the bar is closed. */
  let open: number | null = null;

  const setOpen = (index: number | null): void => {
    open = index;
    popups.forEach((popup, i) => {
      popup.hidden = i !== index;
    });
    titles.forEach((title, i) => {
      title.setAttribute('aria-expanded', String(i === index));
    });
    if (index === null) return;
    // Focus lands on the first entry that can actually run, the way a menubar is
    // expected to open; disabled entries stay reachable with the arrow keys.
    popups[index]
      .querySelector<HTMLButtonElement>('.menu-item:not([aria-disabled="true"])')
      ?.focus();
  };

  el.classList.add('menu-bar');
  el.setAttribute('role', 'menubar');
  el.replaceChildren(
    ...buildMenus(store, commands).map((group, index) => {
      const wrap = document.createElement('div');
      wrap.className = 'menu-group';

      const title = document.createElement('button');
      title.type = 'button';
      title.className = 'menu-title';
      title.id = `menu-title-${index}`;
      title.setAttribute('role', 'menuitem');
      title.setAttribute('aria-haspopup', 'true');
      title.setAttribute('aria-expanded', 'false');
      title.textContent = group.label;
      title.addEventListener('click', () => {
        setOpen(open === index ? null : index);
      });

      const popup = document.createElement('div');
      popup.className = 'menu-popup';
      popup.setAttribute('role', 'menu');
      popup.setAttribute('aria-labelledby', title.id);
      popup.hidden = true;

      wrap.append(title, popup);
      titles.push(title);
      popups.push(popup);
      return wrap;
    }),
  );

  const gate = createLiveGate();
  const render = (): void => {
    // A cheap digest first: the menus change with the selection, the object
    // count, undo/redo availability and hidden flags — never with the viewport,
    // which the store emits on every pan frame (see `live.ts`).
    const key = [
      [...store.selection].join(','),
      store.doc.objects.length,
      store.doc.objects.reduce((count, rec) => count + (rec.display?.hidden === true ? 1 : 0), 0),
      store.canUndo() ? 'undo' : '',
      store.canRedo() ? 'redo' : '',
    ].join('|');
    gate(key, () => {
      buildMenus(store, commands).forEach((group, index) => {
        popups[index].replaceChildren(
          ...group.items.map((item) => itemButton(item, () => setOpen(null))),
        );
      });
    });
  };

  // A tap anywhere outside the bar puts the menu away (touch's version of the
  // pointer leaving a menu, which a whiteboard cannot do).
  document.addEventListener('pointerdown', (event) => {
    if (open === null) return;
    const target = event.target;
    if (target instanceof Node && el.contains(target)) return;
    setOpen(null);
  });

  el.addEventListener('keydown', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const popup = target.closest('.menu-popup');
    const titleIndex = titles.indexOf(target as HTMLButtonElement);

    if (event.key === 'Escape' && open !== null) {
      const title = titles[open];
      // The board would otherwise read Escape as "cancel the pending tool".
      event.stopPropagation();
      setOpen(null);
      title.focus();
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (popup === null) {
        if (titleIndex < 0) return;
        event.preventDefault();
        setOpen(titleIndex);
        return;
      }
      const items = [
        ...popup.querySelectorAll<HTMLButtonElement>('.menu-item:not([aria-disabled="true"])'),
      ];
      if (items.length === 0) return;
      event.preventDefault();
      const current = items.indexOf(target as HTMLButtonElement);
      const step = event.key === 'ArrowDown' ? 1 : items.length - 1;
      items[(current + items.length + step) % items.length].focus();
      return;
    }

    if (titleIndex >= 0 && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
      event.preventDefault();
      const next =
        titleIndex + (event.key === 'ArrowRight' ? 1 : titles.length - 1);
      const wrapped = next % titles.length;
      // An open menubar carries the open menu along with the focus.
      if (open === null) titles[wrapped].focus();
      else setOpen(wrapped);
    }
  });

  store.subscribe(render);
  render();
}

/**
 * One entry. A disabled entry keeps `aria-disabled` instead of the `disabled`
 * attribute so it stays focusable and its reason is readable — on a touch board
 * there is no tooltip to fall back on, so the reason is a visible second line.
 */
function itemButton(item: MenuItem, close: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'menu-item';
  button.dataset.item = item.id;
  button.setAttribute('role', 'menuitem');

  const label = document.createElement('span');
  label.className = 'menu-item-label';
  label.textContent = item.label;
  button.append(label);

  if (item.reason !== undefined) {
    const reason = document.createElement('span');
    reason.className = 'menu-item-reason';
    reason.textContent = item.reason;
    button.append(reason);
  }

  if (item.enabled) {
    button.addEventListener('click', () => {
      close();
      item.run();
    });
  } else {
    button.setAttribute('aria-disabled', 'true');
  }
  return button;
}

/** Re-exported for callers that only import the UI layer (e.g. tests). */
export { buildMenus };
export type { MenuCommands, MenuGroup, MenuItem };
