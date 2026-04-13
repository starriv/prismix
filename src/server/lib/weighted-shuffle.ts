/**
 * Weighted shuffle — reorder items so higher-weight items appear first probabilistically.
 *
 * Uses cumulative threshold selection (no float drift).
 * Each iteration picks an item proportional to its weight, removes it from the pool.
 */
export function weightedShuffle<T>(items: T[], getWeight: (item: T) => number): T[] {
  const pool = items.filter((item) => getWeight(item) > 0);
  if (pool.length === 0) {
    return [...items];
  }
  const result: T[] = [];

  while (pool.length > 0) {
    const totalWeight = pool.reduce((sum, item) => sum + getWeight(item), 0);
    const rand = Math.random() * totalWeight;
    let cumulative = 0;
    let pickedIdx = pool.length - 1; // fallback — covers float-precision edge case

    for (let i = 0; i < pool.length; i++) {
      cumulative += getWeight(pool[i]);
      if (rand < cumulative) {
        pickedIdx = i;
        break;
      }
    }

    result.push(pool[pickedIdx]);
    pool.splice(pickedIdx, 1);
  }

  return result;
}
