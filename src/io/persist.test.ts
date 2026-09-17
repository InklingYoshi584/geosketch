import { describe, expect, it, vi } from 'vitest';
import type { Doc } from '../engine';
import { autosaveClear, autosaveLoad, autosaveSave, parseDoc, serializeDoc } from './persist';

const VIEWPORT = { cx: 12.5, cy: -8, scale: 96 };

/** A document as the live Store holds it (plain data, not a parsed file). */
const LIVE: Doc = {
  version: 1,
  viewport: { ...VIEWPORT },
  objects: [
    { id: 'p1', type: 'point.free', parents: [], params: { x: 0, y: 0 }, style: {} },
    { id: 'p2', type: 'point.free', parents: [], params: { x: 3, y: 4 }, style: {} },
    { id: 's1', type: 'segment', parents: ['p1', 'p2'], params: { branch: 0 }, style: {} },
  ],
};

describe('serializeDoc', () => {
  it('writes pretty JSON in the frozen root key order', () => {
    expect(serializeDoc(LIVE)).toBe(JSON.stringify({ version: 1, viewport: VIEWPORT, objects: LIVE.objects }, null, 2));
  });
});

describe('parseDoc', () => {
  it('round-trips a live document unchanged', () => {
    expect(parseDoc(serializeDoc(LIVE))).toEqual(LIVE);
  });

  it('is stable across repeated save/load cycles', () => {
    const once = parseDoc(serializeDoc(LIVE));
    expect(parseDoc(serializeDoc(once))).toEqual(once);
  });

  it('preserves unknown root fields, record fields and object types verbatim', () => {
    const raw = {
      version: 1,
      viewport: { cx: 0, cy: 0, scale: 64 },
      futureRootField: [1, 2, 3],
      objects: [
        {
          id: 'p1',
          type: 'point.free',
          parents: [],
          params: { x: 0, y: 0 },
          style: { stroke: '#123456' },
          futureRecordField: 'kept',
        },
        { id: 'x1', type: 'locus.custom', parents: ['p1'], params: { samples: 64 }, style: {} },
      ],
    };

    const parsed = parseDoc(JSON.stringify(raw));
    expect(parsed).toEqual(raw);
    expect(parsed.objects[1]?.type).toBe('locus.custom');
    // ...and a re-save keeps them, which is what a future version depends on.
    expect(parseDoc(serializeDoc(parsed))).toEqual(raw);
  });

  it('keeps the optional axes record', () => {
    const raw = {
      version: 1,
      viewport: { cx: 0, cy: 0, scale: 64 },
      axes: { id: 'ax', type: 'axes', parents: [], params: { unit: 1 }, style: {} },
      objects: [],
    };
    const parsed = parseDoc(JSON.stringify(raw));
    expect(parsed).toEqual(raw);
    expect(serializeDoc(parsed)).toBe(JSON.stringify(raw, null, 2));
  });
});

describe('parseDoc validation', () => {
  const ok = '{"version":1,"viewport":{"cx":0,"cy":0,"scale":64},"objects":[]}';

  it('rejects text that is not JSON', () => {
    expect(() => parseDoc('{ not json')).toThrow(/invalid JSON/);
  });

  it('rejects a document from another schema version', () => {
    expect(() => parseDoc('{"version":2,"viewport":{"cx":0,"cy":0,"scale":64},"objects":[]}')).toThrow(/version 2/);
    expect(() => parseDoc('{"viewport":{"cx":0,"cy":0,"scale":64},"objects":[]}')).toThrow(/version/);
  });

  it('rejects a non-array objects field', () => {
    expect(() => parseDoc('{"version":1,"viewport":{"cx":0,"cy":0,"scale":64},"objects":{}}')).toThrow(
      /"objects" must be an array/,
    );
  });

  it('rejects a record missing params', () => {
    expect(() =>
      parseDoc(
        '{"version":1,"viewport":{"cx":0,"cy":0,"scale":64},"objects":[{"id":"p1","type":"point.free","parents":[]}]}',
      ),
    ).toThrow(/params/);
  });

  it('rejects a record missing parents', () => {
    expect(() =>
      parseDoc(
        '{"version":1,"viewport":{"cx":0,"cy":0,"scale":64},"objects":[{"id":"p1","type":"point.free","params":{}}]}',
      ),
    ).toThrow(/parents/);
  });

  it('rejects a document whose object ids collide', () => {
    expect(() =>
      parseDoc(
        '{"version":1,"viewport":{"cx":0,"cy":0,"scale":64},"objects":[' +
          '{"id":"p1","type":"point.free","parents":[],"params":{}},' +
          '{"id":"p1","type":"point.free","parents":[],"params":{}}]}',
      ),
    ).toThrow(/duplicate object id/);
  });

  it('accepts a minimal valid document', () => {
    expect(parseDoc(ok).objects).toEqual([]);
  });
});

describe('autosave', () => {
  it('reports nothing to recover where there is no storage (node)', () => {
    autosaveSave(LIVE);
    expect(autosaveLoad()).toBeNull();
    autosaveClear();
    expect(autosaveLoad()).toBeNull();
  });

  it('round-trips the document through local storage for crash recovery', () => {
    const slots = new Map<string, string>();
    stubStorage(slots);
    try {
      autosaveSave(LIVE);

      expect([...slots.keys()]).toEqual(['geosketch.autosave.v1']);
      expect(autosaveLoad()).toEqual(LIVE);

      autosaveClear();
      expect(autosaveLoad()).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('treats an unreadable slot as nothing to recover', () => {
    const slots = new Map<string, string>([['geosketch.autosave.v1', 'not a payload']]);
    stubStorage(slots);
    try {
      expect(autosaveLoad()).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/** A Map-backed `localStorage`; also gives the module the `window` it probes for. */
function stubStorage(slots: Map<string, string>): void {
  vi.stubGlobal('window', {});
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => slots.get(key) ?? null,
    setItem: (key: string, value: string) => void slots.set(key, value),
    removeItem: (key: string) => void slots.delete(key),
  });
}
