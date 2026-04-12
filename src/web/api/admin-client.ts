import { API_ADMIN_AUTH_REFRESH } from "./constants";
import { ApiError, createApiClient } from "./create-api-client";

const client = createApiClient({
  tokenKey: "prismix_admin_token",
  refreshTokenKey: "prismix_admin_refresh_token",
  refreshUrl: API_ADMIN_AUTH_REFRESH,
  loginPath: "/admin/login",
});

export const adminGet = client.get;
export const adminPost = client.post;
export const adminPut = client.put;
export const adminDel = client.del;
export const adminPublicGet = client.publicGet;
export const adminPublicPost = client.publicPost;
export const adminTokenGet = client.tokenGet;
export const adminTokenPost = client.tokenPost;
export const adminTokenPostVoid = client.tokenPostVoid;
export const setAdminToken = client.setToken;
export const getAdminToken = client.getToken;
export const setAdminRefreshToken = client.setRefreshToken;
export const getAdminRefreshToken = client.getRefreshToken;

// Re-export ApiError with the admin name for backward compat
export { ApiError as AdminApiError };
