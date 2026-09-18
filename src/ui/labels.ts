/**
 * Names objects are shown under in the UI chrome. One place, because the chip
 * and the inspector must agree: "A" on the board is "A" in the popover.
 *
 * The palette's tools live here too, for the same reason: the strip labels its
 * buttons from this table, and so does anything else that has to talk about the
 * active tool (the status line, tooltips, the shortcut legend).
 */
import type { Tool } from '../app/store';
import { registry, type Doc, type Id } from '../engine';

/** The Chinese title of a registered type, falling back to its raw name. */
export function typeTitle(type: string): string {
  return registry.get(type)?.title ?? type;
}

/** The name an object is shown under: its label if it has one, else its type. */
export function objectLabel(doc: Doc, id: Id): string {
  const rec = doc.objects.find((object) => object.id === id);
  if (rec === undefined) return id;
  return rec.label?.text ?? typeTitle(rec.type);
}

/** One palette entry: the short button text, its tooltip and its digit shortcut. */
export interface ToolInfo {
  tool: Tool;
  /** Button face — two characters where Chinese allows it. */
  label: string;
  /** One line telling the teacher what the next clicks do. */
  hint: string;
  /** The digit that selects this tool, or `null` past the tenth entry. */
  shortcut: string | null;
}

/**
 * The palette, in click order and in shortcut order: `1`–`9` then `0` are the
 * first ten entries, exactly the way a teacher's hand falls on the number row.
 * The measurement and delete tools sit past the digits and are reached by tap
 * or by clicking their button.
 */
export const TOOLS: readonly ToolInfo[] = [
  { tool: 'select', label: '选择', hint: '点选对象，拖动移动，点空白处取消选择', shortcut: '1' },
  { tool: 'point', label: '点', hint: '点空白放自由点，点线段/直线/圆放对象上的点', shortcut: '2' },
  { tool: 'segment', label: '线段', hint: '点击两点画线段', shortcut: '3' },
  { tool: 'line', label: '直线', hint: '点击两点画直线', shortcut: '4' },
  { tool: 'ray', label: '射线', hint: '先点端点，再点方向点画射线', shortcut: '5' },
  { tool: 'circle', label: '圆', hint: '先点圆心，再点圆上一点画圆', shortcut: '6' },
  { tool: 'polygon', label: '多边形', hint: '依次点击顶点，再点第一个点完成', shortcut: '7' },
  { tool: 'midpoint', label: '中点', hint: '点击两点取中点，或点一条线段取中点', shortcut: '8' },
  { tool: 'perpendicular', label: '垂线', hint: '点击一点和一条路径作垂线（顺序不限）', shortcut: '9' },
  { tool: 'parallel', label: '平行线', hint: '点击一点和一条路径作平行线（顺序不限）', shortcut: '0' },
  { tool: 'intersection', label: '交点', hint: '点击两条路径取它们的交点', shortcut: null },
  { tool: 'measure.distance', label: '距离', hint: '点击两点（或一条线段）测量距离', shortcut: null },
  { tool: 'measure.angle', label: '角度', hint: '点击三点测角度，中间的点是顶点', shortcut: null },
  { tool: 'measure.area', label: '面积', hint: '点击一个多边形或圆测量面积', shortcut: null },
  { tool: 'delete', label: '删除', hint: '点击要删除的对象', shortcut: null },
];

/** The palette entry for a tool; unknown tools degrade to a bare label. */
export function toolInfo(tool: Tool): ToolInfo {
  return TOOLS.find((info) => info.tool === tool) ?? { tool, label: tool, hint: '', shortcut: null };
}

/**
 * The button tooltip: the label plus its digit where it has one — `线段 (3)`.
 * The digit is shown, not taught, because a teacher only ever needs to notice
 * it once.
 */
export function toolTitle(tool: Tool): string {
  const info = toolInfo(tool);
  return info.shortcut === null ? info.label : `${info.label} (${info.shortcut})`;
}

/** The one-line instruction for the active tool. */
export function toolHint(tool: Tool): string {
  return toolInfo(tool).hint;
}
