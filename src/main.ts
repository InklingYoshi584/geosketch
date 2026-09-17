import { Store } from './app/store';
import { attachBoard } from './interaction/board';
import { registerServiceWorker } from './io/pwa';
import { autosaveClear, autosaveLoad, autosaveSave, openDocFile, saveDocFile } from './io/persist';

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
  status.textContent = `${store.doc.objects.length} 个对象`;
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
