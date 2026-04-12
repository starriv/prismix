import { API_AUTH_REFRESH } from "./constants";
import { ApiError, createApiClient } from "./create-api-client";

const client = createApiClient({
  tokenKey: "prismix_user_token",
  refreshTokenKey: "prismix_user_refresh_token",
  refreshUrl: API_AUTH_REFRESH,
  loginPath: "/user/login",
});

export const userGet = client.get;
export const userPost = client.post;
export const userPut = client.put;
export const userDel = client.del;
export const userPublicGet = client.publicGet;
export const userPublicPost = client.publicPost;
export const userTokenGet = client.tokenGet;
export const userTokenPost = client.tokenPost;
export const userTokenPostVoid = client.tokenPostVoid;
export const setUserToken = client.setToken;
export const getUserToken = client.getToken;
export const setUserRefreshToken = client.setRefreshToken;
export const getUserRefreshToken = client.getRefreshToken;

// Re-export ApiError with the user name for backward compat
export { ApiError as UserApiError };
