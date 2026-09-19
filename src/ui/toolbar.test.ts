import { describe, expect, it } from 'vitest';

import type { Tool } from '../app/store';
import { TOOLS, toolHint, toolTitle } from './labels';
import { isTextEntry, toolForShortcut, toggleTool } from './toolbar';

/** The palette contract: order, button face, digit. The order is the shortcut order. */
const PALETTE: readonly [Tool, string, string | null][] = [
  ['select', '选择', '1'],
  ['point', '点', '2'],
  ['segment', '线段', '3'],
  ['line', '直线', '4'],
  ['ray', '射线', '5'],
  ['circle', '圆', '6'],
  ['polygon', '多边形', '7'],
  ['midpoint', '中点', '8'],
  ['perpendicular', '垂线', '9'],
  ['parallel', '平行线', '0'],
  ['intersection', '交点', null],
  ['measure.distance', '距离', null],
  ['measure.angle', '角度', null],
  ['measure.area', '面积', null],
  ['text', '文本', null],
  ['delete', '删除', null],
];

describe('the tool palette table', () => {
  it('covers every tool exactly once, in palette order', () => {
    expect(TOOLS.map((info) => [info.tool, info.label, info.shortcut])).toEqual(PALETTE);
    expect(new Set(TOOLS.map((info) => info.label)).size).toBe(PALETTE.length);
  });

  it('gives every tool a single-line hint', () => {
    for (const info of TOOLS) {
      expect(info.hint.length).toBeGreaterThan(0);
      expect(info.hint).not.toContain('\n');
      expect(toolHint(info.tool)).toBe(info.hint);
    }
  });

  it('shows the digit in the tooltip only for the tools that have one', () => {
    expect(toolTitle('select')).toBe('选择 (1)');
    expect(toolTitle('segment')).toBe('线段 (3)');
    expect(toolTitle('parallel')).toBe('平行线 (0)');
    expect(toolTitle('intersection')).toBe('交点');
    expect(toolTitle('measure.area')).toBe('面积');
    expect(toolTitle('delete')).toBe('删除');
  });
});

describe('digit shortcuts', () => {
  it('maps 1-9 and 0 onto the first ten tools', () => {
    expect('1234567890'.split('').map(toolForShortcut)).toEqual([
      'select',
      'point',
      'segment',
      'line',
      'ray',
      'circle',
      'polygon',
      'midpoint',
      'perpendicular',
      'parallel',
    ]);
  });

  it('ignores everything that is not exactly one mapped digit', () => {
    expect(toolForShortcut('q')).toBeNull();
    expect(toolForShortcut('10')).toBeNull();
    expect(toolForShortcut('')).toBeNull();
    expect(toolForShortcut(' ')).toBeNull();
  });
});

describe('picking the active tool again', () => {
  it('falls back to select', () => {
    expect(toggleTool('select', 'segment')).toBe('segment');
    expect(toggleTool('segment', 'segment')).toBe('select');
    expect(toggleTool('select', 'select')).toBe('select');
  });

  it('is its own inverse for any other tool', () => {
    expect(toggleTool(toggleTool('select', 'circle'), 'circle')).toBe('select');
    expect(toggleTool(toggleTool('delete', 'delete'), 'delete')).toBe('delete');
  });
});

describe('key events that belong to a text field', () => {
  it('claims inputs, textareas, selects and contenteditable hosts', () => {
    expect(isTextEntry({ tagName: 'input' })).toBe(true);
    expect(isTextEntry({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTextEntry({ tagName: 'select' })).toBe(true);
    expect(isTextEntry({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('leaves the canvas, the body and nothing at all to the palette', () => {
    expect(isTextEntry({ tagName: 'BODY' })).toBe(false);
    expect(isTextEntry({ tagName: 'CANVAS' })).toBe(false);
    expect(isTextEntry({ tagName: 'DIV', isContentEditable: false })).toBe(false);
    expect(isTextEntry(null)).toBe(false);
    expect(isTextEntry(undefined)).toBe(false);
  });
});
