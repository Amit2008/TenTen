// xorshift32_v1 (GDD 5.3). Part of the rules contract: changing any line here changes every future deal.
// Self-contained on purpose: the browser replay test runs this exact source in other JS engines.

/** One step from a nonzero unsigned 32-bit state; returns the next state (also the output). */
export function xorshift32(state: number): number {
  let x = state;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}

/** Unbiased bounded value from one generator output, or null when the output must be rejected and redrawn. */
export function boundedFromOutput(output: number, bound: number): number | null {
  const value = output - 1; // nonzero output, so value is in [0, 4294967294]
  const limit = Math.floor(4294967295 / bound) * bound;
  return value >= limit ? null : value % bound;
}

/** Draws a uniform integer in [0, bound); returns it with the advanced state. */
export function drawBounded(state: number, bound: number): { value: number; state: number } {
  let next = state;
  for (;;) {
    next = xorshift32(next);
    const value = boundedFromOutput(next, bound);
    if (value !== null) return { value, state: next };
  }
}
