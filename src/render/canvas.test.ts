import { describe, expect, it } from 'vitest';
import { Store } from '../app/store';
import { toggleHidden, toggleTrace } from '../interaction/display';
import { computeScene, type Doc, type Geometry, type Id, type ObjRecord, type Scene } from '../engine';
import { drawScene, render } from './canvas';
import { ViewTransform } from './viewport';

const CSS_W = 800;
const CSS_H = 600;
const VIEWPORT = { cx: 0, cy: 0, scale: 64 };
/** World (0,0) lands at the middle of the canvas; 1 world unit is 64 CSS px. */
const TRANSFORM = new ViewTransform(VIEWPORT, CSS_W, CSS_H);

interface StubCall {
  op: string;
  args: unknown[];
}

interface StubContext {
  calls: StubCall[];
  strokeStyle: string;
  lineWidth: number;
  lineCap: string;
  globalAlpha: number;
  font: string;
}

/** A hand-rolled 2D context: records every call, so no canvas package is needed. */
function stubContext(): CanvasRenderingContext2D & StubContext {
  const calls: StubCall[] = [];
  const record =
    (op: string) =>
    (...args: unknown[]): undefined => {
      calls.push({ op, args });
      return undefined;
    };
  const ctx = {
    calls,
    lineCap: 'butt',
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    setTransform: record('setTransform'),
    clearRect: record('clearRect'),
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    arc: record('arc'),
    closePath: record('closePath'),
    stroke: record('stroke'),
    fill: record('fill'),
    strokeRect: record('strokeRect'),
    setLineDash: record('setLineDash'),
    fillText: record('fillText'),
    measureText: (text: string) => ({ width: text.length * 8 }),
  };
  // Style assignments are the only record that a *selection* overlay (or a
  // trail's reduced opacity) was drawn.
  for (const name of ['strokeStyle', 'lineWidth', 'globalAlpha'] as const) {
    let value: string | number = ctx[name];
    Object.defineProperty(ctx, name, {
      get: () => value,
      set: (next: string | number) => {
        value = next;
        calls.push({ op: `${name}=${next}`, args: [] });
      },
      configurable: true,
    });
  }
  return ctx as unknown as CanvasRenderingContext2D & StubContext;
}

interface Item {
  rec: ObjRecord;
  geom?: Geometry;
}

/** A canvas whose 2D context is the recording stub; nothing else is ever touched. */
function stubCanvas(ctx: CanvasRenderingContext2D): HTMLCanvasElement {
  return {
    width: 0,
    height: 0,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: CSS_W, height: CSS_H }),
  } as unknown as HTMLCanvasElement;
}

function item(id: Id, type: string, geom: Geometry | undefined, extra: Partial<ObjRecord> = {}): Item {
  return { rec: { id, type, parents: [], params: null, ...extra }, geom };
}

const ITEMS: Item[] = [
  item('a', 'point.free', { kind: 'point', at: { x: 0, y: 0 } }, { label: { text: 'A' } }),
  item('b', 'point.free', { kind: 'point', at: { x: 2, y: 0 } }, { style: { hollow: true } }),
  item(
    's',
    'segment',
    { kind: 'segment', a: { x: 0, y: 0 }, b: { x: 2, y: 0 } },
    { parents: ['a', 'b'] },
  ),
  item('l', 'line', { kind: 'line', at: { x: 0, y: 1 }, dir: { x: 1, y: 0 } }, { parents: ['a'] }),
  item('r', 'ray', { kind: 'ray', at: { x: 0, y: -1 }, dir: { x: 0, y: 1 } }, { parents: ['a'] }),
  item('c', 'circle.centerPoint', { kind: 'circle', center: { x: 0, y: 0 }, radius: 1.5 }),
  item('nc', 'circle.centerRadius', { kind: 'circle', center: { x: 0, y: 0 }, radius: 1.5 }, {
    style: { fill: '#dbeafe' },
  }),
  item('p', 'polygon', {
    kind: 'polygon',
    points: [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 0, y: 1 },
    ],
  }),
  item('np', 'polygon', {
    kind: 'polygon',
    points: [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 0, y: 1 },
    ],
  }, { style: { fill: '#ffcc00' } }),
  item('n', 'measure.distance', { kind: 'number', value: 3.14159 }, {
    parents: ['a', 'b'],
    label: { text: 'AB' },
  }),
  item('n2', 'measure.angle', { kind: 'number', value: 45, unit: 'deg' }, {
    parents: ['n'],
    label: { text: '∠A' },
  }),
  item('arc1', 'arc.through3', {
    kind: 'arc',
    center: { x: 0, y: 0 },
    radius: 1.5,
    from: 0,
    to: Math.PI / 2,
  }),
  item('txt', 'text.free', { kind: 'text', at: { x: 1, y: 1 }, text: 'free text' }),
  // Display-hidden: skipped by the renderer entirely (DESIGN.md §8.1 显示).
  item('hid', 'point.free', { kind: 'point', at: { x: 2, y: 2 } }, { display: { hidden: true } }),
  // Degenerate geometry: every one of these must be skipped, never drawn.
  item('dz-zero-radius', 'circle.centerRadius', { kind: 'circle', center: { x: 0, y: 0 }, radius: 0 }),
  item('dz-arc-radius', 'arc.through3', {
    kind: 'arc',
    center: { x: 0, y: 0 },
    radius: 0,
    from: 0,
    to: Math.PI,
  }),
  item('dz-arc-sweep', 'arc.through3', {
    kind: 'arc',
    center: { x: 0, y: 0 },
    radius: 2,
    from: Number.NaN,
    to: Math.PI,
  }),
  item('dz-text-empty', 'text.free', { kind: 'text', at: { x: 0, y: 0 }, text: '' }),
  item('dz-two-points', 'polygon', {
    kind: 'polygon',
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
  }),
  item('dz-nan', 'segment', { kind: 'segment', a: { x: Number.NaN, y: 0 }, b: { x: 1, y: 1 } }),
  item('dz-direction', 'line', { kind: 'line', at: { x: 0, y: 0 }, dir: { x: 0, y: 0 } }),
  item('dz-offscreen', 'line', { kind: 'line', at: { x: 0, y: 1000 }, dir: { x: 1, y: 0 } }),
  item('dz-value', 'measure.distance', { kind: 'number', value: Number.NaN }, { parents: ['a', 'b'] }),
  // A record the engine could not compute: no geometry at all.
  item('ghost', 'unknown.type', undefined),
];

const ALL_IDS = ITEMS.map((i) => i.rec.id);
const DEGENERATE_IDS = ALL_IDS.filter((id) => id.startsWith('dz'));

function docOf(ids: Id[]): Doc {
  return {
    version: 1,
    viewport: { ...VIEWPORT },
    objects: ITEMS.filter((i) => ids.includes(i.rec.id)).map((i) => i.rec),
  };
}

function sceneOf(ids: Id[]): Scene {
  const geoms = new Map<Id, Geometry>();
  for (const i of ITEMS) {
    if (ids.includes(i.rec.id) && i.geom !== undefined) geoms.set(i.rec.id, i.geom);
  }
  return { geoms, undefined: new Map([['ghost', 'unknown type: unknown.type']]) };
}

function draw(
  ids: Id[],
  selection: Id[] = [],
  traces?: ReadonlyMap<Id, readonly Geometry[]>,
): StubContext {
  const ctx = stubContext();
  drawScene(ctx, TRANSFORM, docOf(ids), sceneOf(ids), new Set(selection), traces);
  return ctx;
}

function ops(ctx: StubContext): string[] {
  return ctx.calls.map((c) => c.op);
}

function argsOf(ctx: StubContext, op: string): unknown[][] {
  return ctx.calls.filter((c) => c.op === op).map((c) => c.args);
}

describe('drawScene', () => {
  it('draws every geometry kind in one frame without throwing', () => {
    const ctx = stubContext();
    const doc = docOf(ALL_IDS);
    const scene = sceneOf(ALL_IDS);
    expect(() => drawScene(ctx, TRANSFORM, doc, scene, new Set(ALL_IDS))).not.toThrow();
    for (const op of ['arc', 'fill', 'moveTo', 'lineTo', 'closePath', 'stroke', 'fillText', 'strokeRect']) {
      expect(ops(ctx)).toContain(op);
    }
  });

  it('draws a segment as a stroked line with round caps', () => {
    const ctx = draw(['s']);
    expect(ops(ctx)).toEqual(expect.arrayContaining(['moveTo', 'lineTo', 'stroke']));
    expect(ctx.lineCap).toBe('round');
    expect(ops(ctx)).not.toContain('fill');
  });

  it('clips an unbounded line to the visible bounds', () => {
    const ctx = draw(['l']);
    const from = argsOf(ctx, 'moveTo')[0];
    const to = argsOf(ctx, 'lineTo')[0];
    expect(from[0] as number).toBeCloseTo(0);
    expect(from[1] as number).toBeCloseTo(236); // world y = 1
    expect(to[0] as number).toBeCloseTo(CSS_W);
    expect(to[1] as number).toBeCloseTo(236);
  });

  it('clips a ray to t >= 0 instead of extending it backwards', () => {
    const ctx = draw(['r']);
    const from = argsOf(ctx, 'moveTo')[0];
    const to = argsOf(ctx, 'lineTo')[0];
    expect(from[1] as number).toBeCloseTo(364); // world y = -1, the ray's origin
    expect(to[1] as number).toBeCloseTo(0);
  });

  it('strokes a circle and fills it only when style.fill is set', () => {
    expect(ops(draw(['c']))).toContain('stroke');
    expect(ops(draw(['c']))).not.toContain('fill');
    expect(ops(draw(['nc']))).toContain('fill');
  });

  it('closes a polygon and fills it only when style.fill is set', () => {
    expect(ops(draw(['p']))).toEqual(expect.arrayContaining(['closePath', 'stroke']));
    expect(ops(draw(['p']))).not.toContain('fill');
    expect(ops(draw(['np']))).toContain('fill');
  });

  it('writes a readout at the average of its parents sample points', () => {
    const ctx = draw(['a', 'b', 'n', 'n2']);
    // The point label A, then the two readouts: parents at (0,0) and (2,0) give
    // the anchor (1,0) → screen (464, 300), with the readout 14 px above it. A
    // number *used as a parent* samples to its own first parent (A at (0,0)), so
    // the readout of a readout hangs off that point rather than the average.
    expect(argsOf(ctx, 'fillText')).toEqual([
      ['A', 408, 292],
      ['AB = 3.14', 464, 286],
      ['∠A = 45.0°', 400, 286],
    ]);
  });

  it('skips degenerate geometry and ids with no geometry, drawing nothing', () => {
    const ctx = draw(DEGENERATE_IDS);
    expect(ctx.calls).toEqual([]);
  });

  it('skips an undefined scene entry even for a known id', () => {
    const ctx = draw(['ghost']);
    expect(ctx.calls).toEqual([]);
  });
});

describe('arcs and text', () => {
  it('renders a text object with the label font, at its own anchor', () => {
    const ctx = draw(['txt']);
    expect(argsOf(ctx, 'fillText')).toEqual([['free text', 464, 236]]); // world (1,1)
    expect(ctx.font).toContain('px');
    expect(ctx.font).toContain('Times New Roman');
    expect(ops(ctx)).not.toContain('strokeRect'); // selection boxes are for selections
  });

  it('boxes a selected text object instead of drawing its glyphs', () => {
    const ctx = draw(['txt'], ['txt']);
    expect(ops(ctx)).toEqual(expect.arrayContaining(['fillText', 'strokeRect']));
  });

  it('renders an arc as the swept part, counter-clockwise in world terms', () => {
    const ctx = draw(['arc1']);
    // One arc: the arc itself (a circle is a full sweep in one canvas arc).
    const arcs = argsOf(ctx, 'arc');
    expect(arcs).toHaveLength(1);
    expect(arcs[0][0]).toBeCloseTo(400); // centre (0, 0)
    expect(arcs[0][1]).toBeCloseTo(300);
    expect(arcs[0][2]).toBeCloseTo(96); // radius 1.5 world units × 64 px
    expect(arcs[0][3]).toBeCloseTo(0); // −from
    expect(arcs[0][4]).toBeCloseTo(-Math.PI / 2); // −to
    expect(arcs[0][5]).toBe(true); // counter-clockwise
    expect(ops(ctx)).toContain('stroke');
    expect(ops(ctx)).not.toContain('fill'); // arcs are strokes, never interiors
  });

  it('overlays a selected arc with the accent stroke', () => {
    const ctx = draw(['arc1'], ['arc1']);
    expect(ops(ctx)).toContain('strokeStyle=#2563eb');
  });
});

describe('display state', () => {
  it('draws nothing at all for a hidden object, whatever else it has', () => {
    // Hidden, selected, and carrying a trail: none of the three may draw.
    const trail: Geometry[] = [
      { kind: 'point', at: { x: 2, y: 2 } },
      { kind: 'point', at: { x: 3, y: 2 } },
    ];
    const ctx = draw(['hid'], ['hid'], new Map([['hid', trail]]));
    expect(ctx.calls).toEqual([]);
  });

  it('trails a point as lighter dots behind it', () => {
    const trail: Geometry[] = [
      { kind: 'point', at: { x: 0, y: 0 } },
      { kind: 'point', at: { x: 1, y: 0 } },
      { kind: 'point', at: { x: 2, y: 0 } },
    ];
    const ctx = draw(['a'], [], new Map([['a', trail]]));
    const arcs = argsOf(ctx, 'arc');
    expect(arcs).toHaveLength(4); // three trail dots, then the point itself
    expect(arcs[0][2]).toBeCloseTo(1.2); // trail dots are small…
    expect(arcs[3][2]).toBeCloseTo(3.5); // …the object is not
    // The trail pass runs first, so it can never cover the construction.
    expect(ctx.calls.indexOf(ctx.calls.find((c) => c.op === 'arc')!)).toBeGreaterThan(
      ops(ctx).indexOf('globalAlpha=0.35'),
    );
    expect(ctx.globalAlpha).toBe(1); // and the reduced opacity is restored
  });

  it('trails a path as a lighter stroke', () => {
    const trail: Geometry[] = [
      { kind: 'segment', a: { x: 0, y: 0 }, b: { x: 2, y: 0 } },
      { kind: 'segment', a: { x: 0, y: 1 }, b: { x: 2, y: 1 } },
    ];
    const ctx = draw(['s'], [], new Map([['s', trail]]));
    // Four moveTo/lineTo pairs from the trail, then the segment's own two.
    expect(argsOf(ctx, 'moveTo')).toHaveLength(3);
    expect(argsOf(ctx, 'lineTo')).toHaveLength(3);
    expect(ops(ctx)).toContain('globalAlpha=0.35');
    expect(ctx.globalAlpha).toBe(1);
  });

  it('skips degenerate trail samples instead of handing NaN to the canvas', () => {
    const trail: Geometry[] = [
      { kind: 'segment', a: { x: Number.NaN, y: 0 }, b: { x: 1, y: 1 } },
      { kind: 'circle', center: { x: 0, y: 0 }, radius: 0 },
      { kind: 'polygon', points: [{ x: 0, y: 0 }] },
      { kind: 'number', value: 1 },
      { kind: 'text', at: { x: 0, y: 0 }, text: 'no outline to trace' },
    ];
    const ctx = stubContext();
    const doc = docOf(['s']);
    const scene = sceneOf(['s']);
    expect(() => drawScene(ctx, TRANSFORM, doc, scene, new Set(), new Map([['s', trail]]))).not.toThrow();
    // Only the object's own segment was stroked; the trail added nothing.
    expect(argsOf(ctx, 'moveTo')).toHaveLength(1);
  });
});

describe('selection overlay', () => {
  it('rings a point rather than redrawing it', () => {
    const ctx = draw(['a'], ['a']);
    const arcs = argsOf(ctx, 'arc');
    expect(arcs).toHaveLength(2); // the disc, then the ring
    expect(arcs[1][2] as number).toBeCloseTo(6.5); // pointSize 3.5 + 3 px gap
    expect(ops(ctx)).toContain('strokeStyle=#2563eb');
  });

  it('overlays a larger kind with an unfilled 2 px accent stroke', () => {
    const ctx = draw(['s'], ['s']);
    expect(ops(ctx)).toContain('strokeStyle=#2563eb');
    expect(ops(ctx)).toContain('lineWidth=2');
    expect(ops(ctx)).not.toContain('fill');
  });

  it('boxes a selected readout, which has no outline to re-trace', () => {
    const ctx = draw(['a', 'b', 'n'], ['n']);
    expect(ops(ctx)).toContain('strokeRect');
    expect(ops(ctx)).toContain('fillText');
  });

  it('ignores a selected id that has no geometry', () => {
    const ctx = draw(['ghost'], ['ghost']);
    expect(ctx.calls).toEqual([]);
  });
});

describe('render', () => {
  it('runs a whole frame on a stub canvas', () => {
    const ctx = stubContext();
    const canvas = stubCanvas(ctx);
    const store = new Store();
    store.doc = docOf(ALL_IDS);
    store.scene = sceneOf(ALL_IDS);
    store.selection = new Set(['a', 'n']);
    expect(() => render(canvas, store)).not.toThrow();
    expect(ops(ctx)).toEqual(expect.arrayContaining(['setTransform', 'clearRect', 'stroke']));
    expect(canvas.width).toBe(CSS_W);
    expect(canvas.height).toBe(CSS_H);
  });

  it('renders an empty document with nothing but grid and axes', () => {
    const ctx = stubContext();
    expect(() => render(stubCanvas(ctx), new Store())).not.toThrow();
    expect(ops(ctx)).toContain('clearRect');
    expect(ops(ctx)).not.toContain('arc');
    expect(ops(ctx)).not.toContain('fillText');
  });
});

describe('display state through render()', () => {
  /** Real types, so the scene comes from the engine the way the app's does. */
  const doc: Doc = {
    version: 1,
    viewport: { ...VIEWPORT },
    objects: [
      { id: 'A', type: 'point.free', parents: [], params: { x: 0, y: 0 } },
      { id: 'B', type: 'point.free', parents: [], params: { x: 4, y: 0 } },
      { id: 's', type: 'segment', parents: ['A', 'B'], params: null },
      { id: 'q', type: 'point.onObject', parents: ['s'], params: { t: 0.25 } },
    ],
  };

  it('draws the trail the display layer recorded, and drops it when hidden', () => {
    const store = new Store(doc);
    store.setSelection(['q']);
    toggleTrace(store);
    store.edit((d) => {
      const rec = d.objects.find((o) => o.id === 'q');
      if (rec !== undefined) (rec.params as { t: number }).t = 0.75;
    });

    const traced = stubContext();
    render(stubCanvas(traced), store);
    // Two recorded samples → two trail dots, drawn at reduced opacity.
    expect(argsOf(traced, 'arc').filter((args) => args[2] === 1.2)).toHaveLength(2);
    expect(ops(traced)).toContain('globalAlpha=0.35');

    store.setSelection(['q']);
    toggleHidden(store);
    const hidden = stubContext();
    render(stubCanvas(hidden), store);
    // Hidden: no trail dots, no point — while A and B keep drawing.
    expect(argsOf(hidden, 'arc').filter((args) => args[2] === 1.2)).toHaveLength(0);
    expect(argsOf(hidden, 'arc').filter((args) => args[2] === 3.5)).toHaveLength(2);
  });
});

describe('a scene the engine actually computed', () => {
  /** Real object types, so every kind is produced by `computeScene` rather than by hand. */
  const doc: Doc = {
    version: 1,
    viewport: { ...VIEWPORT },
    objects: [
      { id: 'A', type: 'point.free', parents: [], params: { x: 0, y: 0 }, label: { text: 'A' } },
      { id: 'B', type: 'point.free', parents: [], params: { x: 4, y: 0 }, label: { text: 'B' } },
      { id: 'C', type: 'point.free', parents: [], params: { x: 0, y: 3 }, label: { text: 'C' } },
      { id: 's', type: 'segment', parents: ['A', 'B'], params: null },
      { id: 'l', type: 'line', parents: ['A', 'B'], params: null },
      { id: 'r', type: 'ray', parents: ['A', 'B'], params: null },
      { id: 'k', type: 'circle.centerPoint', parents: ['A', 'B'], params: null },
      {
        id: 'poly',
        type: 'polygon',
        parents: ['A', 'B', 'C'],
        params: null,
        style: { fill: '#dbeafe' },
      },
      { id: 'q', type: 'point.onObject', parents: ['s'], params: { t: 0.5 } },
      { id: 'm', type: 'midpoint', parents: ['A', 'B'], params: null },
      { id: 'u', type: 'perpendicular', parents: ['C', 's'], params: null },
      { id: 'v', type: 'parallel', parents: ['C', 's'], params: null },
      { id: 'w', type: 'angleBisector', parents: ['A', 'C', 'B'], params: null },
      { id: 'x', type: 'intersection', parents: ['s', 'k'], params: { branch: 0 } },
      {
        id: 'num',
        type: 'measure.distance',
        parents: ['A', 'B'],
        params: null,
        label: { text: 'AB' },
      },
      { id: 'rad', type: 'circle.centerRadius', parents: ['A', 'num'], params: null },
      {
        id: 'ang',
        type: 'measure.angle',
        parents: ['A', 'C', 'B'],
        params: null,
        label: { text: '∠ACB' },
      },
      { id: 'area', type: 'measure.area', parents: ['poly'], params: null },
      { id: 'arc', type: 'arc.through3', parents: ['A', 'B', 'C'], params: null },
      { id: 'note', type: 'text.free', parents: [], params: { x: 1, y: 2, text: 'free text' } },
    ],
  };

  it('produces every geometry kind, and every one of them draws', () => {
    const scene = computeScene(doc);
    const kinds = [...new Set([...scene.geoms.values()].map((g) => g.kind))].sort();
    expect(kinds).toEqual([
      'arc',
      'circle',
      'line',
      'number',
      'point',
      'polygon',
      'ray',
      'segment',
      'text',
    ]);

    const ctx = stubContext();
    const all = doc.objects.map((o) => o.id);
    expect(() => drawScene(ctx, TRANSFORM, doc, scene, new Set(all))).not.toThrow();
    expect(ops(ctx)).toEqual(
      expect.arrayContaining(['arc', 'closePath', 'fill', 'fillText', 'stroke', 'strokeRect']),
    );
    // The engine's arc reaches the canvas as a finite *sweep* — only the arc
    // renderer asks for a counter-clockwise partial circle.
    expect(argsOf(ctx, 'arc').some((args) => args[5] === true)).toBe(true);
  });

  it('renders it through render() as well', () => {
    const ctx = stubContext();
    expect(() => render(stubCanvas(ctx), new Store(doc))).not.toThrow();
    expect(ops(ctx)).toEqual(expect.arrayContaining(['setTransform', 'clearRect', 'fillText']));
  });
});
