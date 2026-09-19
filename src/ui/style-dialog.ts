import type { Store } from '../app/store';
import type { Id, Style } from '../engine';
import { objectLabel } from './labels';
import './menu.css';

/**
 * 显示 → 标签与样式…: the object property sheet (DESIGN.md §3 "Notation & styling",
 * GSP's 显示 menu entries for 颜色/线型/线宽/点大小/标签).
 *
 * Everything the selection shares is edited together and applied through one
 * `store.edit`, so one press of 应用 is one undo entry. Fields that do not apply
 * to anything selected (点大小 for a segment, 填充 for a line) are disabled
 * rather than hidden, so the sheet keeps one shape.
 */

/** The renderer's defaults (`render/canvas.ts`), so an unset field reads honestly. */
const DEFAULT_STROKE = '#1a1a1a';
const DEFAULT_STROKE_WIDTH = 1.5;
const DEFAULT_POINT_SIZE = 3.5;
const DEFAULT_LABEL_SIZE = 14;
/** GSP's interior colour: blue, translucent enough to read the strokes through. */
const DEFAULT_FILL = 'rgba(37, 99, 235, 0.18)';
/** What the fill swatch shows when the stored fill is not an `#rrggbb` colour. */
const FILL_SWATCH = '#bfdbfe';
/** The dash pattern 线型 = 虚线 writes; an empty/absent `dash` is solid. */
const DASH_PATTERN = [6, 4];

/** The fields of one open sheet. */
interface Fields {
  stroke: HTMLInputElement;
  lineStyle: HTMLSelectElement;
  width: HTMLInputElement;
  pointSize: HTMLInputElement;
  hollow: HTMLInputElement;
  fill: HTMLInputElement;
  fillColor: HTMLInputElement;
  label: HTMLInputElement;
  labelSize: HTMLInputElement;
  labelColor: HTMLInputElement;
}

export function showStyleDialog(store: Store): void {
  // One at a time: the sheet is modal, so a second press can only be a repeat.
  if (document.querySelector('.style-backdrop') !== null) return;
  const ids = new Set<Id>(store.selection);
  const records = store.doc.objects.filter((rec) => ids.has(rec.id));
  if (records.length === 0) return;

  const first = records[0];
  const kinds = records.map((rec) => store.scene.geoms.get(rec.id)?.kind);
  const hasPoints = kinds.includes('point');
  const hasInteriors = kinds.includes('polygon') || kinds.includes('circle');
  const storedFill = typeof first.style?.fill === 'string' ? first.style.fill : '';

  const fields: Fields = {
    stroke: colorInput(first.style?.stroke ?? DEFAULT_STROKE, DEFAULT_STROKE),
    lineStyle: selectInput(
      [
        ['solid', '实线'],
        ['dashed', '虚线'],
      ],
      first.style?.dash !== undefined && first.style.dash.length > 0 ? 'dashed' : 'solid',
    ),
    width: rangeInput(0.5, 6, 0.5, first.style?.strokeWidth ?? DEFAULT_STROKE_WIDTH),
    // Half-pixel steps: the renderer's own default radius is 3.5, and a slider
    // that cannot show it would silently rewrite every point as 4.
    pointSize: rangeInput(2, 12, 0.5, first.style?.pointSize ?? DEFAULT_POINT_SIZE),
    hollow: toggleInput(first.style?.hollow === true),
    fill: toggleInput(storedFill !== ''),
    fillColor: colorInput(storedFill === '' ? DEFAULT_FILL : storedFill, FILL_SWATCH),
    label: textInput(first.label?.text ?? ''),
    labelSize: rangeInput(8, 32, 1, first.label?.size ?? DEFAULT_LABEL_SIZE),
    labelColor: colorInput(first.label?.color ?? DEFAULT_STROKE, DEFAULT_STROKE),
  };
  fields.pointSize.disabled = !hasPoints;
  fields.hollow.disabled = !hasPoints;
  fields.fill.disabled = !hasInteriors;
  fields.fillColor.disabled = !hasInteriors || !fields.fill.checked;
  fields.fill.addEventListener('change', () => {
    fields.fillColor.disabled = !hasInteriors || !fields.fill.checked;
  });

  const backdrop = document.createElement('div');
  backdrop.className = 'style-backdrop';
  const sheet = document.createElement('div');
  sheet.className = 'style-dialog';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', '标签与样式');
  sheet.tabIndex = -1;

  const heading = document.createElement('h2');
  heading.textContent = '标签与样式';
  const subtitle = document.createElement('p');
  subtitle.className = 'style-subtitle';
  subtitle.textContent =
    records.length === 1
      ? `${objectLabel(store.doc, first.id)} 的属性`
      : `所选 ${records.length} 个对象一起修改`;

  const close = (): void => {
    backdrop.remove();
  };

  const apply = document.createElement('button');
  apply.type = 'button';
  apply.textContent = '应用';
  apply.className = 'style-apply';
  apply.addEventListener('click', () => {
    applyStyle(store, records, fields);
  });

  const done = document.createElement('button');
  done.type = 'button';
  done.textContent = '关闭';
  done.addEventListener('click', close);
  const actions = document.createElement('div');
  actions.className = 'style-actions';
  actions.append(apply, done);

  sheet.append(
    heading,
    subtitle,
    fieldRow('颜色', fields.stroke),
    fieldRow('线型', fields.lineStyle),
    fieldRow('线宽', withValue(fields.width)),
    fieldRow('点大小', withValue(fields.pointSize)),
    fieldRow('空心点', fields.hollow),
    fieldRow('填充', fields.fill),
    fieldRow('填充颜色', fields.fillColor),
    fieldRow('标签', fields.label),
    fieldRow('标签字号', withValue(fields.labelSize)),
    fieldRow('标签颜色', fields.labelColor),
    actions,
  );
  backdrop.append(sheet);

  // A tap outside is 取消; Escape too, and neither changes the document.
  backdrop.addEventListener('pointerdown', (event) => {
    if (event.target === backdrop) close();
  });
  sheet.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation(); // the board would read it as "cancel the tool"
    close();
  });

  document.body.append(backdrop);
  fields.label.focus();
}

/**
 * One press of 应用: the whole selection takes the sheet's values, as a single
 * undo entry. Point-only and interior-only fields are written to the records
 * that can carry them, whatever the sheet's own disabled state is.
 */
function applyStyle(
  store: Store,
  records: { id: Id; style?: Style }[],
  fields: Fields,
): void {
  const ids = new Set(records.map((rec) => rec.id));
  const dashed = fields.lineStyle.value === 'dashed';
  const fillOn = fields.fill.checked;
  store.edit((doc) => {
    for (const rec of doc.objects) {
      if (!ids.has(rec.id)) continue;
      const kind = store.scene.geoms.get(rec.id)?.kind;
      const style: Style = {
        ...rec.style,
        stroke: colorValue(fields.stroke),
        strokeWidth: Number(fields.width.value),
      };
      if (dashed) style.dash = [...DASH_PATTERN];
      else delete style.dash;
      if (kind === 'point') {
        style.pointSize = Number(fields.pointSize.value);
        if (fields.hollow.checked) style.hollow = true;
        else delete style.hollow;
      }
      if (kind === 'polygon' || kind === 'circle') {
        if (fillOn) style.fill = colorValue(fields.fillColor);
        else delete style.fill;
      }
      rec.style = style;

      const text = fields.label.value.trim();
      if (text === '') delete rec.label;
      else {
        rec.label = {
          ...rec.label,
          text,
          size: Number(fields.labelSize.value),
          color: colorValue(fields.labelColor),
        };
      }
    }
  });
}

function fieldRow(text: string, control: HTMLElement): HTMLElement {
  const label = document.createElement('label');
  label.htmlFor = control.id;
  label.textContent = text;
  const row = document.createElement('div');
  row.className = 'style-row';
  row.append(label, control);
  return row;
}

/** A slider plus the number it currently reads, updated as it is dragged. */
function withValue(range: HTMLInputElement): HTMLElement {
  const value = document.createElement('span');
  value.className = 'style-value';
  value.textContent = range.value;
  range.addEventListener('input', () => {
    value.textContent = range.value;
  });
  const wrap = document.createElement('div');
  wrap.className = 'style-slider';
  wrap.append(range, value);
  return wrap;
}

let fieldSeq = 0;

/**
 * A colour swatch. `<input type=color>` only holds `#rrggbb`, so any other
 * stored colour (a CSS name, or a translucent fill) is kept aside and written
 * back untouched until the swatch itself is used — opening the sheet and
 * pressing 应用 must never be the thing that rewrites a colour.
 */
function colorInput(value: string, fallback: string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'color';
  input.id = `style-field-${fieldSeq++}`;
  const hex = /^#[0-9a-f]{6}$/i.test(value);
  input.value = hex ? value : fallback;
  if (!hex) input.dataset.raw = value;
  input.addEventListener('input', () => {
    delete input.dataset.raw;
  });
  return input;
}

/** The colour a swatch stands for: the stored value until the user picks one. */
function colorValue(input: HTMLInputElement): string {
  return input.dataset.raw ?? input.value;
}

function textInput(value: string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.id = `style-field-${fieldSeq++}`;
  input.value = value;
  return input;
}

function rangeInput(min: number, max: number, step: number, value: number): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'range';
  input.id = `style-field-${fieldSeq++}`;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  return input;
}

function toggleInput(checked: boolean): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = `style-field-${fieldSeq++}`;
  input.checked = checked;
  return input;
}

function selectInput(options: [string, string][], value: string): HTMLSelectElement {
  const select = document.createElement('select');
  select.id = `style-field-${fieldSeq++}`;
  for (const [optionValue, optionLabel] of options) {
    const option = document.createElement('option');
    option.value = optionValue;
    option.textContent = optionLabel;
    select.append(option);
  }
  select.value = value;
  return select;
}
