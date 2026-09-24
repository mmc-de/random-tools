/**
 * Pure utilities for the bucket-draw tool.
 *
 * No DOM, no localStorage, no globals — so these can be exercised by tests,
 * run during SSR, or reused by other tools.
 *
 * Randomness is sourced from `shuffle` in ./random.ts, which uses
 * `crypto.getRandomValues` (cryptographically unbiased). We do NOT call
 * `Math.random` anywhere — see the stack decision record.
 */

import { shuffle } from './random.ts';

export type DrawMode = 'with' | 'without';

export type DrawResult<T> = {
  drawn: T;
  remaining: T[];
};

/**
 * Pick one item uniformly at random from `items`.
 *
 * - `withReplacement: false` → `remaining` is a NEW array equal to `items`
 *   minus the drawn item. `items` is not mutated.
 * - `withReplacement: true`  → `remaining` is a NEW array equal to `items`
 *   (the drawn item is conceptually returned to the pool).
 *
 * Throws on an empty input so callers must guard upstream.
 */
export function draw<T>(
  items: readonly T[],
  opts: { withReplacement: boolean },
): DrawResult<T> {
  if (items.length === 0) {
    throw new Error('draw: cannot draw from an empty bucket');
  }
  // Reuse shuffle() — it uses uniformInt(crypto.getRandomValues) under the
  // hood and returns a uniformly-distributed permutation. shuffled[0] is
  // therefore a uniform pick over the input, which is exactly what we want.
  const shuffled = shuffle(items);
  const drawn = shuffled[0]!;
  if (opts.withReplacement) {
    // Return a fresh copy so the contract "draw does not mutate" holds even
    // when the caller happens to hand us the same array as `remaining`.
    return { drawn, remaining: items.slice() };
  }
  // Without replacement: drop exactly the first occurrence of `drawn` from a
  // NEW copy of `items`. Equality is reference-based, matching `===` (generic
  // over T). Duplicates in the input would all be removed by index-by-index
  // matching of the first equal element — but the caller dedupes via
  // parseBucketInput so duplicates don't reach us in practice.
  const remaining: T[] = [];
  let dropped = false;
  for (const item of items) {
    if (!dropped && item === drawn) {
      dropped = true;
      continue;
    }
    remaining.push(item);
  }
  return { drawn, remaining };
}

/**
 * Parse a newline-separated bucket: split, trim, drop empties, dedupe
 * (case-sensitive), preserve order of first occurrence.
 */
export function parseBucketInput(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
}