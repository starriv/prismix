import { describe, expect, it } from "vitest";

import { weightedShuffle } from "@/server/lib/weighted-shuffle";

describe("weightedShuffle", () => {
  it("preserves original order when all weights are zero", () => {
    const items = [
      { id: "a", weight: 0 },
      { id: "b", weight: 0 },
      { id: "c", weight: 0 },
    ];

    const result = weightedShuffle(items, (item) => item.weight);

    expect(result).toEqual(items);
  });

  it("preserves original order when the input is empty", () => {
    expect(weightedShuffle([], () => 0)).toEqual([]);
  });
});
