import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { queryKeys } from "@/web/api/query-keys";

describe("queryKeys.aiLogs", () => {
  it("keeps requestId='all' distinct from the unfiltered logs cache key", () => {
    const qc = new QueryClient();

    qc.setQueryData(queryKeys.aiLogs(), "unfiltered");
    qc.setQueryData(queryKeys.aiLogs({ requestId: "all" }), "filtered");

    expect(qc.getQueryData(queryKeys.aiLogs())).toBe("unfiltered");
    expect(qc.getQueryData(queryKeys.aiLogs({ requestId: "all" }))).toBe("filtered");
  });
});
