import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createApiClient } from "@/web/api/create-api-client";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function createLockManager() {
  let tail = Promise.resolve();

  return {
    request: vi.fn(<T>(_name: string, callback: () => Promise<T>) => {
      const result = tail.then(callback);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    }),
  };
}

describe("createApiClient token refresh", () => {
  beforeEach(() => {
    const storage = new MemoryStorage();
    storage.setItem("access", "expired-access");
    storage.setItem("refresh", "single-use-refresh");

    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("window", { location: { pathname: "/zh/admin/ai-models", href: "" } });
    vi.stubGlobal("navigator", { locks: createLockManager() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("coordinates single-use refresh tokens across tabs", async () => {
    let refreshCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const authorization = new Headers(init?.headers).get("Authorization");

        if (url === "/refresh") {
          refreshCalls += 1;
          return Response.json({ data: { token: "fresh-access", refreshToken: "fresh-refresh" } });
        }

        if (authorization === "Bearer fresh-access") {
          return Response.json({ data: "ok" });
        }

        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }),
    );

    const config = {
      tokenKey: "access",
      refreshTokenKey: "refresh",
      refreshUrl: "/refresh",
      loginPath: "/admin/login",
    };
    // Separate instances model separate browser tabs: each has its own
    // in-memory refresh promise but shares localStorage and Web Locks.
    const firstTab = createApiClient(config);
    const secondTab = createApiClient(config);

    await expect(
      Promise.all([
        firstTab.get("/protected", z.string()),
        secondTab.get("/protected", z.string()),
      ]),
    ).resolves.toEqual(["ok", "ok"]);

    expect(refreshCalls).toBe(1);
    expect(localStorage.getItem("access")).toBe("fresh-access");
    expect(localStorage.getItem("refresh")).toBe("fresh-refresh");
    expect(window.location.href).toBe("");
  });
});
