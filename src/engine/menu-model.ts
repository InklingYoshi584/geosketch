/**
 * The menu model (DESIGN.md §8.1: the menu bar mirrors GSP's 文件/编辑/显示/构造/
 * 度量/变换/数据/绘图 structure).
 *
 * This module is **pure**: it holds the whole menu tree as plain records and the
 * DOM lives in `src/ui/menu.ts` (`attachMenuBar` + `menu.css`). Do not re-merge
 * them — `src/engine/**` is typechecked against `lib: ES2022` only and must stay
 * DOM-free.
 *
 * The 构造 and 度量 entries carry no behaviour of their own. An entry is enabled
 * exactly when `actionsFor(doc, scene, selection)` offers an action for it, and
 * running it applies that action — one `store.edit`, one undo entry, and the
 * objects it creates become the selection, so the menu builds the same way the
 * action bar does and can never offer a construction the engine cannot actually
 * build from what is selected. Every disabled entry that needs a selection
 * carries a short Chinese reason (`需要选择两个点`, …) derived from the type's
 * own signatures, so the wording cannot drift from the engine's arity rules.
 */
import type { Store } from '../app/store';
import { actionsFor, type Action } from './actions';
import { registry, type GeometryKind, type ObjType } from './registry';
import { isPathGeometry } from './scene';
import type { Json } from './types';

/** The commands `main.ts` injects — the one seam where the menu meets the app. */
export interface MenuCommands {
  newFile(): void;
  undo(): void;
  redo(): void;
  selectAll(): void;
  selectParents(): void;
  selectChildren(): void;
  deleteSelection(): void;
  detachSelection(): void;
  editStyle(): void;
  toggleHidden(): void;
  toggleTrace(): void;
  toggleAnimate(): void;
  eraseTraces(): void;
  showAllHidden(): void;
  openFile(): void;
  saveFile(): void;
  saveFileAs(): void;
  exportPng(): void;
  exportSvg(): void;
  print(): void;
}

export interface MenuItem {
  /** Stable, DOM-safe key: the action id it runs where it names one. */
  id: string;
  label: string;
  enabled: boolean;
  /** Why it is disabled, in one short line. Absent on an enabled item. */
  reason?: string;
  run(): void;
}

/** One top-level menu: its title and the entries under it. */
export interface MenuGroup {
  label: string;
  items: MenuItem[];
}

/** What a wave B/C entry says until its wave lands (DESIGN.md §8.1). */
const LATER = '后续版本';
/** The reason every selection-only 编辑/显示 entry carries when nothing is selected. */
const NEED_SELECTION = '需要先选择对象';
/** A disabled entry is never run; `run` still has to exist for the menu shape. */
const noop = (): void => {};

/**
 * 构造, in the order the menu shows them (the three circles are spelled out so
 * they read apart from each other, unlike the action bar's bare `圆`).
 */
const CONSTRUCTIONS: readonly TypeEntry[] = [
  { type: 'point.onObject' },
  { type: 'intersection' },
  { type: 'midpoint' },
  { type: 'perpendicular' },
  { type: 'parallel' },
  { type: 'angleBisector' },
  { type: 'perpendicularBisector' },
  { type: 'segment' },
  { type: 'line' },
  { type: 'ray' },
  { type: 'circle.centerPoint', label: '圆(圆心+点)' },
  { type: 'circle.centerRadius' },
  { type: 'circle.through3' },
  { type: 'arc.onCircle' },
  { type: 'arc.through3' },
  { type: 'polygon' },
];

/**
 * 度量. `长度` is the one-segment form of `measure.distance` (its second
 * signature), which is why the two entries name the same type; where a type
 * declares several signatures of the same gesture (面积: 多边形 or 圆) the entry
 * names none and runs whichever signature the selection offers.
 */
const MEASURES: readonly TypeEntry[] = [
  { type: 'measure.distance', sig: 0, label: '距离' },
  { type: 'measure.distance', sig: 1, label: '长度' },
  { type: 'measure.angle' },
  { type: 'measure.arcAngle' },
  { type: 'measure.arcLength' },
  { type: 'measure.area' },
  { type: 'measure.perimeter' },
  { type: 'measure.slope' },
  { type: 'measure.ratio' },
  { type: 'measure.coordinates' },
  { type: 'measure.equation' },
];

/** Wave C transformations — the entries exist, so the menu has GSP's shape. */
const TRANSFORMS: readonly [string, string][] = [
  ['transform.translate', '平移'],
  ['transform.rotate', '旋转'],
  ['transform.scale', '缩放'],
  ['transform.reflect', '反射'],
  ['transform.markCenter', '标记中心'],
  ['transform.markVector', '标记向量'],
  ['transform.markAngle', '标记角度'],
  ['transform.markRatio', '标记比'],
  ['transform.iterate', '迭代'],
];

/** Wave B data surface. */
const DATA: readonly [string, string][] = [
  ['data.parameter', '新建参数'],
  ['data.calculation', '新建计算'],
  ['data.plotPoint', '绘制点'],
  ['data.plotFunction', '绘制函数'],
];

/** Wave B coordinate plane. */
const PLOT: readonly [string, string][] = [
  ['plot.axes', '定义坐标系'],
  ['plot.gridStyle', '网格样式'],
  ['plot.hideGrid', '隐藏网格'],
];

/** A menu entry driven by one engine type (and optionally one of its signatures). */
interface TypeEntry {
  type: string;
  /**
   * The signature this entry stands for. Omitted means "any signature the type
   * declares" — the entry then runs whichever one the selection offers.
   */
  sig?: number;
  /** Menu label, where it differs from the type's Chinese title. */
  label?: string;
}

/** The whole menu bar for the current document, selection and edit history. */
export function buildMenus(store: Store, commands: MenuCommands): MenuGroup[] {
  const actions = actionsFor(store.doc, store.scene, [...store.selection]);
  return [
    fileMenu(commands),
    editMenu(store, commands),
    displayMenu(store, commands),
    { label: '构造', items: CONSTRUCTIONS.map((entry) => typeItem(entry, store, actions)) },
    { label: '度量', items: MEASURES.map((entry) => typeItem(entry, store, actions)) },
    pending('变换', TRANSFORMS),
    pending('数据', DATA),
    pending('绘图', PLOT),
  ];
}

function fileMenu(commands: MenuCommands): MenuGroup {
  return {
    label: '文件',
    items: [
      { id: 'file.new', label: '新建', enabled: true, run: () => commands.newFile() },
      { id: 'file.open', label: '打开', enabled: true, run: () => commands.openFile() },
      { id: 'file.save', label: '保存', enabled: true, run: () => commands.saveFile() },
      { id: 'file.saveAs', label: '另存为', enabled: true, run: () => commands.saveFileAs() },
      { id: 'file.exportPng', label: '导出 PNG', enabled: true, run: () => commands.exportPng() },
      // No SVG serializer yet (wave B): the entry stays and says so.
      { id: 'file.exportSvg', label: '导出 SVG', enabled: false, reason: LATER, run: noop },
      { id: 'file.print', label: '打印', enabled: true, run: () => commands.print() },
    ],
  };
}

function editMenu(store: Store, commands: MenuCommands): MenuGroup {
  const selected = store.selection.size > 0;
  return {
    label: '编辑',
    items: [
      command('edit.undo', '撤销', store.canUndo(), '没有可撤销的操作', () => commands.undo()),
      command('edit.redo', '重做', store.canRedo(), '没有可重做的操作', () => commands.redo()),
      command(
        'edit.selectAll',
        '全选',
        store.doc.objects.length > 0,
        '图形为空',
        () => commands.selectAll(),
      ),
      command('edit.selectParents', '选择父对象', selected, NEED_SELECTION, () =>
        commands.selectParents(),
      ),
      command('edit.selectChildren', '选择子对象', selected, NEED_SELECTION, () =>
        commands.selectChildren(),
      ),
      command('edit.delete', '删除', selected, NEED_SELECTION, () => commands.deleteSelection()),
      command('edit.detach', '分离', selected, NEED_SELECTION, () => commands.detachSelection()),
    ],
  };
}

function displayMenu(store: Store, commands: MenuCommands): MenuGroup {
  const selected = store.selection.size > 0;
  const hidden = store.doc.objects.some((rec) => rec.display?.hidden === true);
  return {
    label: '显示',
    items: [
      command('display.style', '标签与样式…', selected, NEED_SELECTION, () => commands.editStyle()),
      command('display.trace', '追踪', selected, NEED_SELECTION, () => commands.toggleTrace()),
      command(
        'display.animate',
        '动画',
        canAnimate(store),
        selected ? '请选择路径上的点' : NEED_SELECTION,
        () => commands.toggleAnimate(),
      ),
      command('display.hidden', '隐藏', selected, NEED_SELECTION, () => commands.toggleHidden()),
      command('display.showAll', '取消隐藏全部', hidden, '没有隐藏的对象', () =>
        commands.showAllHidden(),
      ),
      // Traces live on the board, not in the document, so the menu cannot tell
      // whether any exist — wiping none is simply a no-op.
      command('display.eraseTraces', '擦除痕迹', true, undefined, () => commands.eraseTraces()),
    ],
  };
}

/**
 * Is anything selected that 动画 can actually move? DisplayOps advances
 * `params.t` of a point glued to a path, so a selection of free points and
 * segments has nothing to run and the entry would be a silent no-op.
 */
function canAnimate(store: Store): boolean {
  for (const id of store.selection) {
    const rec = store.doc.objects.find((object) => object.id === id);
    if (rec === undefined || rec.parents.length === 0) continue;
    const params = rec.params;
    if (typeof params !== 'object' || params === null || Array.isArray(params)) continue;
    if (typeof (params as Record<string, Json>).t !== 'number') continue;
    const parent = store.scene.geoms.get(rec.parents[0]);
    if (parent !== undefined && isPathGeometry(parent)) return true;
  }
  return false;
}

/** An entry that belongs to a wave which has not landed yet. */
function pending(label: string, entries: readonly [string, string][]): MenuGroup {
  return {
    label,
    items: entries.map(([id, itemLabel]) => ({
      id,
      label: itemLabel,
      enabled: false,
      reason: LATER,
      run: noop,
    })),
  };
}

/** A menu entry over an injected command, disabled with a reason when unusable. */
function command(
  id: string,
  label: string,
  enabled: boolean,
  reason: string | undefined,
  run: () => void,
): MenuItem {
  // A disabled entry is inert wherever it is called from — the renderer already
  // refuses the press, and nothing should be able to slip past that.
  const item: MenuItem = { id, label, enabled, run: enabled ? run : noop };
  if (!enabled && reason !== undefined) item.reason = reason;
  return item;
}

/**
 * A 构造/度量 entry. `id` is the action id the entry runs when it names one
 * signature (`measure.distance:1`), or the plain type name when any signature
 * will do (`measure.area`) — both stable enough to key the DOM on.
 */
function typeItem(entry: TypeEntry, store: Store, actions: Action[]): MenuItem {
  const type = registry.get(entry.type);
  const id = entry.sig === undefined ? entry.type : `${entry.type}:${entry.sig}`;
  const offered = actions.filter((action) =>
    entry.sig === undefined ? action.id.startsWith(`${entry.type}:`) : action.id === id,
  );
  const item: MenuItem = {
    id,
    label: entry.label ?? type?.title ?? entry.type,
    enabled: offered.length > 0,
    run: () => apply(store, offered),
  };
  if (!item.enabled) item.reason = type === undefined ? '暂不可用' : requirement(type, entry.sig);
  return item;
}

/**
 * Build the objects the offered action describes and push them through one
 * `store.edit` — the identical path the action bar's buttons take.
 */
function apply(store: Store, offered: Action[]): void {
  const action = offered[0];
  if (action === undefined) return;
  const { created, select } = action.apply(store.doc, [...store.selection]);
  if (created.length === 0) return;
  store.edit((doc) => {
    doc.objects.push(...created);
  });
  store.setSelection(select ?? []);
}

/**
 * `需要选择两个点或一条线段` — the type's own signatures, spelled out. `polygon`
 * is the one variadic type, so its three-point signature reads as "at least";
 * `sig` undefined means "any signature this type declares".
 */
function requirement(type: ObjType, sig: number | undefined): string {
  if (type.name === 'polygon') return '需要选择至少三个点';
  const declared = type.parentKinds;
  const signatures =
    sig === undefined ? declared : [declared[sig] ?? declared[0]];
  const phrases = signatures.filter((slots) => slots.length > 0).map(signaturePhrase);
  if (phrases.length === 0) return '暂不可用';
  return `需要选择${listPhrases(phrases)}`;
}

function listPhrases(phrases: string[]): string {
  if (phrases.length === 1) return phrases[0];
  return `${phrases.slice(0, -1).join('、')}或${phrases[phrases.length - 1]}`;
}

/** One signature as a phrase: `[point, point]` → `两个点`. */
function signaturePhrase(signature: readonly GeometryKind[]): string {
  const parts: string[] = [];
  let start = 0;
  while (start < signature.length) {
    let end = start + 1;
    while (end < signature.length && signature[end] === signature[start]) end++;
    parts.push(countPhrase(signature[start], end - start));
    start = end;
  }
  return parts.join('和');
}

/** `一个点`、`两个对象` — the measure word comes from the kind. */
function countPhrase(kind: GeometryKind, count: number): string {
  const noun = KIND_NOUNS[kind];
  return `${NUMERALS[count - 1] ?? String(count)}${noun.measure}${noun.noun}`;
}

const NUMERALS = ['一', '两', '三', '四', '五', '六', '七', '八'];

const KIND_NOUNS: Record<GeometryKind, { measure: string; noun: string }> = {
  point: { measure: '个', noun: '点' },
  segment: { measure: '条', noun: '线段' },
  line: { measure: '条', noun: '直线' },
  ray: { measure: '条', noun: '射线' },
  circle: { measure: '个', noun: '圆' },
  arc: { measure: '条', noun: '弧' },
  polygon: { measure: '个', noun: '多边形' },
  text: { measure: '个', noun: '文本' },
  number: { measure: '个', noun: '数值' },
  path: { measure: '个', noun: '对象' },
  any: { measure: '个', noun: '对象' },
};
