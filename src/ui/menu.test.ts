import { describe, expect, it } from 'vitest';

import { Store } from '../app/store';
import { createEmptyDoc, type Id, type Json, type ObjRecord } from '../engine';
import { actionsFor } from '../engine/actions';
import { buildMenus, type MenuCommands, type MenuGroup, type MenuItem } from '../engine/menu-model';

function freePoint(id: Id, x: number, y: number): ObjRecord {
  return { id, type: 'point.free', parents: [], params: { x, y } };
}

function derived(id: Id, type: string, parents: Id[], params: Json = {}): ObjRecord {
  return { id, type, parents, params };
}

function board(objects: ObjRecord[], selection: Id[] = []): Store {
  const store = new Store({ ...createEmptyDoc(), objects });
  store.setSelection(selection);
  return store;
}

/** The injected commands, recording which ones the menu pressed. */
function stubCommands(): { commands: MenuCommands; seen: string[] } {
  const seen: string[] = [];
  const press = (name: string) => (): void => {
    seen.push(name);
  };
  const commands: MenuCommands = {
    newFile: press('newFile'),
    undo: press('undo'),
    redo: press('redo'),
    selectAll: press('selectAll'),
    selectParents: press('selectParents'),
    selectChildren: press('selectChildren'),
    deleteSelection: press('deleteSelection'),
    detachSelection: press('detachSelection'),
    editStyle: press('editStyle'),
    toggleHidden: press('toggleHidden'),
    toggleTrace: press('toggleTrace'),
    toggleAnimate: press('toggleAnimate'),
    eraseTraces: press('eraseTraces'),
    showAllHidden: press('showAllHidden'),
    openFile: press('openFile'),
    saveFile: press('saveFile'),
    saveFileAs: press('saveFileAs'),
    exportPng: press('exportPng'),
    exportSvg: press('exportSvg'),
    print: press('print'),
  };
  return { commands, seen };
}

function menuOf(groups: MenuGroup[], label: string): MenuGroup {
  const group = groups.find((candidate) => candidate.label === label);
  if (group === undefined) throw new Error(`no menu 标为 ${label}`);
  return group;
}

function itemOf(groups: MenuGroup[], id: string): MenuItem {
  for (const group of groups) {
    const item = group.items.find((candidate) => candidate.id === id);
    if (item !== undefined) return item;
  }
  throw new Error(`no menu item ${id}`);
}

/** Every entry that an engine type drives: 构造 and 度量. */
function typeItems(groups: MenuGroup[]): MenuItem[] {
  return [...menuOf(groups, '构造').items, ...menuOf(groups, '度量').items];
}

function labels(items: MenuItem[]): string[] {
  return items.map((item) => item.label);
}

describe('the menu bar tree', () => {
  it("lists GSP's menus in order", () => {
    const { commands } = stubCommands();
    const groups = buildMenus(board([]), commands);
    expect(groups.map((group) => group.label)).toEqual([
      '文件',
      '编辑',
      '显示',
      '构造',
      '度量',
      '变换',
      '数据',
      '绘图',
    ]);
  });

  it('lists 构造 in menu order, naming each circle form', () => {
    const { commands } = stubCommands();
    const groups = buildMenus(board([]), commands);
    expect(labels(menuOf(groups, '构造').items)).toEqual([
      '对象上的点',
      '交点',
      '中点',
      '垂线',
      '平行线',
      '角平分线',
      '垂直平分线',
      '线段',
      '直线',
      '射线',
      '圆(圆心+点)',
      '圆(圆心+半径)',
      '圆(三点)',
      '圆上的弧',
      '三点弧',
      '多边形',
    ]);
  });

  it('lists 度量 in menu order, with 长度 as the segment form of 距离', () => {
    const { commands } = stubCommands();
    const groups = buildMenus(board([]), commands);
    const items = menuOf(groups, '度量').items;
    expect(labels(items)).toEqual([
      '距离',
      '长度',
      '角度',
      '弧角',
      '弧长',
      '面积',
      '周长',
      '斜率',
      '比',
      '坐标',
      '方程',
    ]);
    expect(items[0].id).toBe('measure.distance:0');
    expect(items[1].id).toBe('measure.distance:1');
  });

  it('files 导出 SVG away as wave B work while the rest of 文件 works', () => {
    const { commands } = stubCommands();
    const groups = buildMenus(board([]), commands);
    const items = menuOf(groups, '文件').items;
    expect(items.find((item) => item.id === 'file.exportSvg')).toMatchObject({
      enabled: false,
      reason: '后续版本',
    });
    expect(items.filter((item) => item.enabled).map((item) => item.id)).toEqual([
      'file.new',
      'file.open',
      'file.save',
      'file.saveAs',
      'file.exportPng',
      'file.print',
    ]);
  });

  it('keeps 变换/数据/绘图 as disabled placeholders', () => {
    const { commands } = stubCommands();
    const groups = buildMenus(board([]), commands);
    for (const label of ['变换', '数据', '绘图']) {
      const items = menuOf(groups, label).items;
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((item) => !item.enabled && item.reason === '后续版本')).toBe(true);
    }
  });

  it('gives every disabled entry a reason and every enabled one none', () => {
    const { commands } = stubCommands();
    for (const store of [
      board([]),
      board([freePoint('A', 0, 0), freePoint('B', 2, 0)], ['A', 'B']),
      board([freePoint('A', 0, 0), freePoint('B', 2, 0), derived('s1', 'segment', ['A', 'B'])], [
        's1',
      ]),
    ]) {
      for (const group of buildMenus(store, commands)) {
        for (const item of group.items) {
          expect(item.enabled).toBe(item.reason === undefined);
        }
      }
    }
  });
});

describe('构造 and 度量 follow actionsFor', () => {
  it('enables an entry exactly when actionsFor offers its action', () => {
    const { commands } = stubCommands();
    const cases: Store[] = [
      board([]),
      board([freePoint('A', 0, 0)]),
      board([freePoint('A', 0, 0), freePoint('B', 2, 0)], ['A', 'B']),
      board([freePoint('A', 0, 0), freePoint('B', 2, 0), freePoint('C', 2, 2)], ['A', 'B', 'C']),
      board([freePoint('A', 0, 0), freePoint('B', 2, 0), derived('s1', 'segment', ['A', 'B'])], [
        's1',
      ]),
      board([freePoint('A', 0, 0), freePoint('B', 2, 0)], ['A']),
    ];
    for (const store of cases) {
      const available = actionsFor(store.doc, store.scene, [...store.selection]).map(
        (action) => action.id,
      );
      for (const item of typeItems(buildMenus(store, commands))) {
        const offered = available.some(
          (id) => id === item.id || id.startsWith(`${item.id}:`),
        );
        expect([item.id, item.enabled]).toEqual([item.id, offered]);
      }
    }
  });

  it('holds the strict-arity line: three points build no segment', () => {
    const { commands } = stubCommands();
    const groups = buildMenus(
      board([freePoint('A', 0, 0), freePoint('B', 2, 0), freePoint('C', 2, 2)], ['A', 'B', 'C']),
      commands,
    );
    expect(itemOf(groups, 'segment')).toMatchObject({ enabled: false, reason: '需要选择两个点' });
    expect(itemOf(groups, 'polygon')).toMatchObject({ enabled: true });
    expect(itemOf(groups, 'circle.through3')).toMatchObject({ enabled: true });
  });

  it('says what a disabled entry needs, in the engine’s own arity', () => {
    const { commands } = stubCommands();
    const twoPoints = buildMenus(board([freePoint('A', 0, 0), freePoint('B', 2, 0)], ['A', 'B']), commands);
    expect(itemOf(twoPoints, 'intersection').reason).toBe('需要选择两个对象');
    expect(itemOf(twoPoints, 'measure.area').reason).toBe('需要选择一个多边形或一个圆');

    const onePoint = buildMenus(board([freePoint('A', 0, 0)], ['A']), commands);
    expect(itemOf(onePoint, 'midpoint').reason).toBe('需要选择两个点或一条线段');
    // 坐标 takes exactly one point, so two selected points put it out of reach.
    expect(itemOf(twoPoints, 'measure.coordinates').reason).toBe('需要选择一个点');

    const oneSegment = buildMenus(
      board([freePoint('A', 0, 0), freePoint('B', 2, 0), derived('s1', 'segment', ['A', 'B'])], ['s1']),
      commands,
    );
    // A lone segment is 长度's selection, which puts 距离 (two points) out of reach.
    expect(itemOf(oneSegment, 'measure.distance:1')).toMatchObject({ enabled: true });
    expect(itemOf(oneSegment, 'measure.distance:0').reason).toBe('需要选择两个点');
    expect(itemOf(oneSegment, 'measure.arcLength').reason).toBe('需要选择一条弧');
  });

  it('builds through the same path as the action bar, as one undo entry', () => {
    const { commands } = stubCommands();
    const store = board([freePoint('A', 0, 0), freePoint('B', 2, 0)], ['A', 'B']);
    const groups = buildMenus(store, commands);
    itemOf(groups, 'segment').run();
    expect(store.doc.objects).toHaveLength(3);
    const created = store.doc.objects[2];
    expect(created.type).toBe('segment');
    expect(created.parents).toEqual(['A', 'B']);
    expect([...store.selection]).toEqual([created.id]);
    expect(store.canUndo()).toBe(true);

    // The new selection chains: the segment now offers its length and midpoint.
    const next = buildMenus(store, commands);
    expect(itemOf(next, 'measure.distance:1')).toMatchObject({ enabled: true });
    expect(itemOf(next, 'midpoint')).toMatchObject({ enabled: true });
  });

  it('runs whichever signature the selection offers for a shared entry', () => {
    const { commands } = stubCommands();
    const store = board(
      [
        freePoint('A', 0, 0),
        freePoint('B', 2, 0),
        freePoint('C', 0, 3),
        derived('s1', 'segment', ['A', 'B']),
        derived('s2', 'segment', ['A', 'C']),
      ],
      ['s1', 's2'],
    );
    itemOf(buildMenus(store, commands), 'measure.ratio').run();
    expect(store.doc.objects).toHaveLength(6);
    expect(store.doc.objects[5].type).toBe('measure.ratio');
  });
});

describe('the command menus', () => {
  it('tracks the undo history', () => {
    const { commands } = stubCommands();
    const store = board([freePoint('A', 0, 0)]);
    expect(itemOf(buildMenus(store, commands), 'edit.undo')).toMatchObject({
      enabled: false,
      reason: '没有可撤销的操作',
    });
    expect(itemOf(buildMenus(store, commands), 'edit.redo')).toMatchObject({ enabled: false });

    store.edit((doc) => {
      doc.objects.push(freePoint('B', 2, 0));
    });
    expect(itemOf(buildMenus(store, commands), 'edit.undo')).toMatchObject({ enabled: true });
    store.undo();
    expect(itemOf(buildMenus(store, commands), 'edit.redo')).toMatchObject({ enabled: true });
  });

  it('asks for a selection where the command needs one', () => {
    const { commands } = stubCommands();
    const groups = buildMenus(board([freePoint('A', 0, 0)]), commands);
    for (const id of [
      'edit.selectParents',
      'edit.selectChildren',
      'edit.delete',
      'edit.detach',
      'display.style',
      'display.trace',
      'display.animate',
      'display.hidden',
    ]) {
      expect(itemOf(groups, id)).toMatchObject({ enabled: false, reason: '需要先选择对象' });
    }
    expect(itemOf(groups, 'edit.selectAll')).toMatchObject({ enabled: true });
    expect(itemOf(groups, 'display.eraseTraces')).toMatchObject({ enabled: true });
  });

  it('offers 动画 only when a point glued to a path is selected', () => {
    const { commands } = stubCommands();
    const flat = board(
      [freePoint('A', 0, 0), freePoint('B', 2, 0), derived('s1', 'segment', ['A', 'B'])],
      ['A', 'B', 's1'],
    );
    expect(itemOf(buildMenus(flat, commands), 'display.animate')).toMatchObject({
      enabled: false,
      reason: '请选择路径上的点',
    });

    const glued = board(
      [
        freePoint('A', 0, 0),
        freePoint('B', 2, 0),
        derived('s1', 'segment', ['A', 'B']),
        derived('P', 'point.onObject', ['s1'], { t: 0.5 }),
      ],
      ['P'],
    );
    expect(itemOf(buildMenus(glued, commands), 'display.animate')).toMatchObject({ enabled: true });
  });

  it('offers 取消隐藏全部 only while something is hidden', () => {
    const { commands } = stubCommands();
    const shown = board([freePoint('A', 0, 0)]);
    expect(itemOf(buildMenus(shown, commands), 'display.showAll')).toMatchObject({
      enabled: false,
      reason: '没有隐藏的对象',
    });
    const hidden = board([{ ...freePoint('A', 0, 0), display: { hidden: true } }]);
    expect(itemOf(buildMenus(hidden, commands), 'display.showAll')).toMatchObject({ enabled: true });
  });

  it('presses exactly the injected command for each entry', () => {
    const { commands, seen } = stubCommands();
    const groups = buildMenus(board([freePoint('A', 0, 0)], ['A']), commands);
    for (const item of menuOf(groups, '文件').items) if (item.enabled) item.run();
    for (const item of menuOf(groups, '显示').items) if (item.enabled) item.run();
    // 动画 is left out: a free point has no path parameter to advance.
    expect(seen).toEqual([
      'newFile',
      'openFile',
      'saveFile',
      'saveFileAs',
      'exportPng',
      'print',
      'editStyle',
      'toggleTrace',
      'toggleHidden',
      'eraseTraces',
    ]);
  });

  it('never runs a disabled entry', () => {
    const { commands, seen } = stubCommands();
    const groups = buildMenus(board([freePoint('A', 0, 0)]), commands);
    itemOf(groups, 'edit.delete').run();
    itemOf(groups, 'edit.undo').run();
    itemOf(groups, 'file.exportSvg').run();
    expect(seen).toEqual([]);
  });
});
