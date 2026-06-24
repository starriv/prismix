/**
 * API client — re-exports admin client as the primary client.
 *
 * In the single-operator model, all dashboard API calls go through the
 * admin auth client. This file provides backward-compatible exports so
 * existing pages don't need import changes.
 */
export {
  adminDel as del,
  adminGet as get,
  adminPost as post,
  adminPut as put,
  adminPublicGet as publicGet,
  adminPublicPost as publicPost,
  adminTokenGet as tokenGet,
  adminTokenPost as tokenPost,
  adminTokenPostVoid as tokenPostVoid,
  AdminApiError as ApiError,
  getAdminRefreshToken as getRefreshToken,
  getAdminToken as getAuthToken,
  refreshAdminAccessToken as refreshAuthToken,
  setAdminRefreshToken as setRefreshToken,
  setAdminToken as setAuthToken,
} from "./admin-client";
