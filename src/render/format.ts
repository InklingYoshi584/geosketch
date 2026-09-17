/**
 * How a measured number reads on the board.
 *
 * A pure formatting concern, kept apart from canvas.ts so it can be exercised
 * without a canvas (DESIGN.md §7 "Unit tests"). Where a readout is *placed* is
 * the engine's business (`anchorsOf`), so that render and hit-test agree.
 */

/**
 * `label.text` becomes a prefix ("AB = 3.00"), angles carry a degree sign and
 * one decimal, everything else two decimals.
 */
export function formatNumber(value: number, unit: 'deg' | undefined, text?: string): string {
  const prefix = text ? `${text} = ` : '';
  return prefix + (unit === 'deg' ? `${value.toFixed(1)}°` : value.toFixed(2));
}
