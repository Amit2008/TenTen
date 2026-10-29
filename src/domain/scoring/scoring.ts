import type { ScoreRules } from '../models/types';

/**
 * Proposed score policy (GDD 5.2, not a verified original formula): placed cells plus a fixed amount per completed
 * line. Lines count rows and columns separately, not unique cleared cells. No combo, streak or time bonus.
 */
export function scoreDelta(rules: ScoreRules, placedCells: number, completedLines: number): number {
  return checkedScore(rules.pointsPerPlacedCell * placedCells + rules.pointsPerCompletedLine * completedLines);
}

/** Adds a move's delta to the running score, refusing to round past the safe integer range. */
export function addScore(score: number, delta: number): number {
  return checkedScore(score + delta);
}

function checkedScore(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`score ${value} is outside the safe integer range`);
  return value;
}
