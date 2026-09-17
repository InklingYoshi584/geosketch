import { describe, expect, it } from 'vitest';

import { createEmptyDoc, type Doc, type ObjRecord } from '../engine';
import { cascadeIds } from './inspector';

function doc(objects: ObjRecord[]): Doc {
  return { ...createEmptyDoc(), objects };
}

/**
 * The cascade set is what a delete removes and what the preview lists (D10):
 * listed here in document order, root excluded.
 */
describe('cascadeIds', () => {
  it('lists every transitive dependent in document order', () => {
    const figure = doc([
      { id: 'A', type: 'point.free', parents: [], params: { x: 0, y: 0 } },
      { id: 'B', type: 'point.free', parents: [], params: { x: 2, y: 0 } },
      { id: 'M', type: 'midpoint', parents: ['A', 'B'], params: {} },
      { id: 'AB', type: 'segment', parents: ['A', 'B'], params: {} },
      { id: 'MB', type: 'segment', parents: ['M', 'B'], params: {} },
    ]);
    expect(cascadeIds(figure, 'A')).toEqual(['M', 'AB', 'MB']);
    expect(cascadeIds(figure, 'M')).toEqual(['MB']);
    expect(cascadeIds(figure, 'MB')).toEqual([]);
  });

  it('never returns the root itself, and survives a cyclic document', () => {
    const cyclic = doc([
      { id: 'A', type: 'x', parents: ['B'], params: {} },
      { id: 'B', type: 'x', parents: ['A'], params: {} },
      { id: 'C', type: 'x', parents: ['B'], params: {} },
    ]);
    expect(cascadeIds(cyclic, 'A')).toEqual(['B', 'C']);
    expect(cascadeIds(cyclic, 'C')).toEqual([]);
  });

  it('returns nothing for an id the document does not have', () => {
    expect(cascadeIds(doc([]), 'ghost')).toEqual([]);
  });
});
