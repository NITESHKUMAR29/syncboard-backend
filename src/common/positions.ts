/**
 * Fractional ordering for drag and drop (Part B §7.2).
 *
 * Positions are doubles. To drop an item between two neighbours the client sends their
 * midpoint, so reordering touches one row instead of renumbering the list. Repeated
 * halving eventually exhausts the precision of a double, so once neighbours get closer
 * than MIN_GAP the board is renumbered back to clean multiples of STEP.
 */

export const POSITION_STEP = 1000;
export const MIN_POSITION_GAP = 0.0001;

/** The position for an item appended to the end of a list. */
export function appendPosition(currentMax: number | null): number {
  return currentMax === null ? POSITION_STEP : currentMax + POSITION_STEP;
}

/** True when any two neighbours have drifted too close to split again (FR-TSK-7). */
export function needsRenumbering(sortedPositions: readonly number[]): boolean {
  for (let i = 1; i < sortedPositions.length; i += 1) {
    const previous = sortedPositions[i - 1];
    const current = sortedPositions[i];

    if (previous === undefined || current === undefined) continue;
    if (current - previous < MIN_POSITION_GAP) return true;
  }

  return false;
}

/** Evenly spaced positions for a list of that length: 1000, 2000, 3000, … */
export function renumber(count: number): number[] {
  return Array.from({ length: count }, (_, index) => (index + 1) * POSITION_STEP);
}
