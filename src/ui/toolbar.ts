import type { Store, Tool } from '../app/store';
import { TOOLS, toolTitle, type ToolInfo } from './labels';
import { createLiveGate } from './live';
import './toolbar.css';

/**
 * The GSP-style tool palette (DESIGN.md D6, revised after real classroom use):
 * a *persistent* strip whose tool the teacher picks once and then clicks the
 * canvas with. The selection-first action bar stays, but as the secondary path
 * — it is only shown while `select` is active.
 *
 * The strip is a pure view of `store.tool`: it renders from the store
 * subscription, never polls, and holds no state of its own. Buttons keep their
 * identity across renders (only the pressed attribute moves) so a finger
 * already resting on one is never yanked out from under it.
 */

/** The tool a digit picks, following `TOOLS` order (`1`…`9` then `0`). */
export function toolForShortcut(key: string): Tool | null {
  return TOOLS.find((info) => info.shortcut === key)?.tool ?? null;
}

/**
 * Picking the tool that is already active puts the palette back in `select` —
 * how a teacher backs out of a tool they picked by mistake. The digit keys
 * follow the same rule, so the palette is one press away from neutral.
 */
export function toggleTool(current: Tool, clicked: Tool): Tool {
  return current === clicked ? 'select' : clicked;
}

/** Whether a key event belongs to a text field, which owns its own digits. */
export function isTextEntry(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false;
  const node = target as { tagName?: unknown; isContentEditable?: unknown };
  if (node.isContentEditable === true) return true;
  const tag = typeof node.tagName === 'string' ? node.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** Render the palette into `el` (the container under the top chrome bar). */
export function attachToolbar(el: HTMLElement, store: Store): void {
  const buttons = TOOLS.map((info) => toolbarButton(info, store));
  el.replaceChildren(...buttons);

  const live = createLiveGate();
  const render = (): void => {
    live(store.tool, () => {
      for (const button of buttons) {
        button.setAttribute('aria-pressed', String(button.dataset.tool === store.tool));
      }
    });
  };

  window.addEventListener('keydown', (event) => {
    // Modified keys belong to the app shortcuts (undo/save/open), repeat to a
    // finger held down, and text fields to whoever is typing.
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (isTextEntry(event.target)) return;
    const tool = toolForShortcut(event.key);
    if (tool === null) return;
    event.preventDefault();
    store.setTool(toggleTool(store.tool, tool));
  });

  store.subscribe(render);
  render();
}

function toolbarButton(info: ToolInfo, store: Store): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ts-btn';
  button.dataset.tool = info.tool;
  button.textContent = info.label;
  button.title = toolTitle(info.tool);
  button.setAttribute('aria-label', `${info.label}：${info.hint}`);
  button.addEventListener('click', () => {
    store.setTool(toggleTool(store.tool, info.tool));
  });
  return button;
}
