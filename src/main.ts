import { Store } from './app/store';
import { createEmptyDoc } from './engine';
import { attachBoard } from './interaction/board';
import { registerServiceWorker } from './io/pwa';
import { autosaveClear, autosaveLoad, autosaveSave, openDocFile, saveDocFile } from './io/persist';
import { attachActionBar } from './ui/actions';
import { attachChip } from './ui/chip';
import { attachInspector } from './ui/inspector';
import { attachToolbar } from './ui/toolbar';
import { toolHint } from './ui/labels';
import { attachMenuBar } from './ui/menu';
import { showStyleDialog } from './ui/style-dialog';
import { attachAnimationClock, eraseTraces, showAllHidden, toggleAnimate, toggleHidden, toggleTrace } from './interaction/display';
import { deleteSelection, detachSelection, exportPng, printSketch, selectAll, selectChildren, selectParents } from './app/commands';
import type { MenuCommands } from './engine/menu-model';

function el<T extends HTMLElement>(sel: string): T {
  const node = document.querySelector<T>(sel);
  if (!node) throw new Error(`missing element: ${sel}`);
  return node;
}

const board = el<HTMLCanvasElement>('#board');
const btnUndo = el<HTMLButtonElement>('#btn-undo');
const btnRedo = el<HTMLButtonElement>('#btn-redo');
const btnOpen = el<HTMLButtonElement>('#btn-open');
const btnSave = el<HTMLButtonElement>('#btn-save');
const status = el<HTMLElement>('#status');

const store = new Store();

const restored = autosaveLoad();
if (restored && window.confirm('发现未保存的图形，是否恢复？')) {
  store.load(restored);
  autosaveClear();
}

let fileName = 'untitled.geosketch';
let lastAutosave = 0;

function refreshChrome(): void {
  btnUndo.disabled = !store.canUndo();
  btnRedo.disabled = !store.canRedo();
  const count = store.doc.objects.length;
  const selected = store.selection.size;
  const hint = store.tool === 'select' ? '点选对象，拖动可移动' : toolHint(store.tool);
  status.textContent =
    selected > 0 ? `${count} 个对象 · 已选 ${selected}` : `${count} 个对象 · ${hint}`;
}

store.subscribe(() => {
  refreshChrome();
  const now = Date.now();
  if (now - lastAutosave > 2000) {
    lastAutosave = now;
    autosaveSave(store.doc);
  }
});

attachBoard(board, store);
attachToolbar(el<HTMLElement>('#tools'), store);
attachActionBar(el<HTMLElement>('#actionbar'), store);
attachChip(el<HTMLElement>('#chip'), store);
attachInspector(el<HTMLElement>('#sheet'), store);

// The single seam where UI, interaction and the engine meet: the menu model
// receives these as data, so no module underneath imports another layer.
const commands: MenuCommands = {
  newFile: () => {
    if (store.doc.objects.length > 0 && !window.confirm('新建将清空当前图形，继续？')) return;
    store.load(createEmptyDoc());
    autosaveClear();
    fileName = 'untitled.geosketch';
  },
  undo: () => store.undo(),
  redo: () => store.redo(),
  selectAll: () => selectAll(store),
  selectParents: () => selectParents(store),
  selectChildren: () => selectChildren(store),
  deleteSelection: () => deleteSelection(store),
  detachSelection: () => detachSelection(store),
  editStyle: () => showStyleDialog(store),
  toggleHidden: () => toggleHidden(store),
  toggleTrace: () => toggleTrace(store),
  toggleAnimate: () => toggleAnimate(store),
  eraseTraces: () => eraseTraces(store),
  showAllHidden: () => showAllHidden(store),
  openFile: () => btnOpen.click(),
  saveFile: () => btnSave.click(),
  saveFileAs: () => btnSave.click(),
  exportPng: () => exportPng(),
  // Disabled in the menu until the SVG serializer lands (wave B).
  exportSvg: () => undefined,
  print: () => printSketch(),
};
attachMenuBar(el<HTMLElement>('#menubar'), store, commands);
attachAnimationClock(store);
refreshChrome();

btnUndo.addEventListener('click', () => store.undo());
btnRedo.addEventListener('click', () => store.redo());

btnOpen.addEventListener('click', async () => {
  try {
    const result = await openDocFile();
    if (!result) return;
    store.load(result.doc);
    fileName = result.name;
    status.textContent = `已打开 ${result.name}`;
  } catch (err) {
    window.alert(`打开失败：${err instanceof Error ? err.message : String(err)}`);
  }
});

btnSave.addEventListener('click', async () => {
  try {
    await saveDocFile(store.doc, fileName);
    autosaveClear();
    status.textContent = `已保存 ${fileName}`;
  } catch (err) {
    window.alert(`保存失败：${err instanceof Error ? err.message : String(err)}`);
  }
});

window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const key = e.key.toLowerCase();
  if (key === 'z') {
    e.preventDefault();
    if (e.shiftKey) store.redo();
    else store.undo();
  } else if (key === 'y') {
    e.preventDefault();
    store.redo();
  } else if (key === 's') {
    e.preventDefault();
    btnSave.click();
  } else if (key === 'o') {
    e.preventDefault();
    btnOpen.click();
  }
});

registerServiceWorker();
