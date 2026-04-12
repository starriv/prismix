import type { z } from "zod";

// ── Types ────────────────────────────────────────────────────────

interface ApiClientConfig {
  tokenKey: string;
  refreshTokenKey: string;
  refreshUrl: string;
  loginPath: string;
}

// ── ApiError ─────────────────────────────────────────────────────

export class ApiError extends Error {
  public code?: string;

  constructor(
    public status: number,
    message: string,
    code?: string,
  ) {
    super(message);
    this.code = code;
  }
}

// ── Factory ──────────────────────────────────────────────────────

export function createApiClient(config: ApiClientConfig) {
  const { tokenKey, refreshTokenKey, refreshUrl, loginPath } = config;

  /** Prepend the current URL language prefix to loginPath for 401 redirects. */
  function localizedLoginPath(): string {
    const match = window.location.pathname.match(/^\/(en|zh)(?:\/|$)/);
    return `/${match?.[1] ?? "en"}${loginPath}`;
  }

  // ── Cached localStorage reads ────────────────────────────────

  let tokenCache: string | null = localStorage.getItem(tokenKey);
  let refreshCache: string | null = localStorage.getItem(refreshTokenKey);

  function setToken(token: string | null) {
    tokenCache = token;
    if (token) {
      localStorage.setItem(tokenKey, token);
    } else {
      localStorage.removeItem(tokenKey);
    }
  }

  function getToken(): string | null {
    return tokenCache;
  }

  function setRefreshToken(token: string | null) {
    refreshCache = token;
    if (token) {
      localStorage.setItem(refreshTokenKey, token);
    } else {
      localStorage.removeItem(refreshTokenKey);
    }
  }

  function getRefreshToken(): string | null {
    return refreshCache;
  }

  function clearTokens(): void {
    setToken(null);
    setRefreshToken(null);
  }

  // ── Helpers ──────────────────────────────────────────────────

  async function extractError(res: Response): Promise<{ message: string; code?: string }> {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      message: typeof body.error === "string" ? body.error : "",
      code: typeof body.code === "string" ? body.code : undefined,
    };
  }

  function unwrap(json: unknown): unknown {
    return (json as { data: unknown }).data;
  }

  // ── Silent token refresh ─────────────────────────────────────

  let refreshPromise: Promise<string | null> | null = null;

  async function attemptRefresh(): Promise<string | null> {
    const rt = getRefreshToken();
    if (!rt) return null;

    try {
      const res = await fetch(refreshUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: rt }),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { data: { token: string; refreshToken?: string } };
      setToken(json.data.token);
      if (json.data.refreshToken) setRefreshToken(json.data.refreshToken);
      return json.data.token;
    } catch {
      return null;
    }
  }

  function doRefresh(): Promise<string | null> {
    if (!refreshPromise) {
      refreshPromise = attemptRefresh().finally(() => {
        refreshPromise = null;
      });
    }
    return refreshPromise;
  }

  // ── Authenticated API (auto-refresh on 401) ──────────────────

  async function api<T>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
    const token = getToken();
    const headers = new Headers(init?.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const res = await fetch(url, { ...init, headers });

    if (res.status === 401) {
      const newToken = await doRefresh();
      if (newToken) {
        const retryHeaders = new Headers(init?.headers);
        retryHeaders.set("Authorization", `Bearer ${newToken}`);
        const retryRes = await fetch(url, { ...init, headers: retryHeaders });
        if (retryRes.status === 401) {
          clearTokens();
          window.location.href = localizedLoginPath();
          throw new ApiError(401, "Unauthorized");
        }
        if (!retryRes.ok) {
          const e = await extractError(retryRes);
          throw new ApiError(retryRes.status, e.message, e.code);
        }
        return schema.parse(unwrap(await retryRes.json()));
      }
      clearTokens();
      window.location.href = localizedLoginPath();
      throw new ApiError(401, "Unauthorized");
    }

    if (!res.ok) {
      const e = await extractError(res);
      throw new ApiError(res.status, e.message, e.code);
    }
    return schema.parse(unwrap(await res.json()));
  }

  // ── Public helpers (no auth token, no 401 redirect) ──────────

  async function publicApi<T>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
    const res = await fetch(url, init);
    if (!res.ok) {
      const e = await extractError(res);
      throw new ApiError(res.status, e.message, e.code);
    }
    return schema.parse(unwrap(await res.json()));
  }

  // ── Token-explicit helpers (for auth flows) ──────────────────

  async function tokenApi<T>(
    url: string,
    schema: z.ZodType<T>,
    token: string,
    init?: RequestInit,
  ): Promise<T> {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    const res = await fetch(url, { ...init, headers });
    if (!res.ok) {
      const e = await extractError(res);
      throw new ApiError(res.status, e.message, e.code);
    }
    return schema.parse(unwrap(await res.json()));
  }

  // ── Stream helper ────────────────────────────────────────────

  async function streamPost(url: string, body: unknown): Promise<Response> {
    const token = getToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (res.status === 401) {
      const newToken = await doRefresh();
      if (newToken) {
        const retryRes = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${newToken}` },
          body: JSON.stringify(body),
        });
        if (retryRes.status === 401) {
          clearTokens();
          window.location.href = localizedLoginPath();
          throw new ApiError(401, "Unauthorized");
        }
        if (!retryRes.ok) {
          const e = await extractError(retryRes);
          throw new ApiError(retryRes.status, e.message, e.code);
        }
        return retryRes;
      }
      clearTokens();
      window.location.href = localizedLoginPath();
      throw new ApiError(401, "Unauthorized");
    }
    if (!res.ok) {
      const e = await extractError(res);
      throw new ApiError(res.status, e.message, e.code);
    }
    return res;
  }

  // ── Public surface ───────────────────────────────────────────

  const get = <T>(url: string, s: z.ZodType<T>) => api(url, s);

  const post = <T>(url: string, body: unknown, s: z.ZodType<T>) =>
    api(url, s, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const put = <T>(url: string, body: unknown, s: z.ZodType<T>) =>
    api(url, s, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const del = <T>(url: string, s: z.ZodType<T>) => api(url, s, { method: "DELETE" });

  const publicGet = <T>(url: string, s: z.ZodType<T>) => publicApi(url, s);

  const publicPost = <T>(url: string, body: unknown, s: z.ZodType<T>) =>
    publicApi(url, s, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const tokenGet = <T>(url: string, token: string, s: z.ZodType<T>) => tokenApi(url, s, token);

  const tokenPost = <T>(url: string, token: string, body: unknown, s: z.ZodType<T>) =>
    tokenApi(url, s, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  async function tokenPostVoid(url: string, token: string, body?: unknown): Promise<void> {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (body) headers["Content-Type"] = "application/json";
    await fetch(url, {
      method: "POST",
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    }).catch(() => {});
  }

  return {
    get,
    post,
    put,
    del,
    publicGet,
    publicPost,
    tokenGet,
    tokenPost,
    tokenPostVoid,
    streamPost,
    setToken,
    getToken,
    setRefreshToken,
    getRefreshToken,
    clearTokens,
    ApiError,
  };
}
