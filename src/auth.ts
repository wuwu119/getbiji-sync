// INPUT: obsidian (requestUrl)
// OUTPUT: decodeJwt, isJwtExpired, refreshJwt, checkTokenExpiration, validateRefreshToken
// POS: Auth layer — JWT decoding, expiration checks, and token refresh

import { requestUrl } from "obsidian";

const REFRESH_URL =
  "https://notes-api.biji.com/account/v2/web/user/auth/refresh";

export interface JwtPayload {
  exp: number;
  uid?: number;
  iat?: number;
  [key: string]: unknown;
}

/**
 * Decode a JWT token and extract its payload.
 * Uses atob() for base64 decoding (Obsidian/browser environment).
 * Returns null for ALL error cases instead of throwing.
 */
export function decodeJwt(token: string): JwtPayload | null {
  try {
    const segments = token.split(".");
    if (segments.length !== 3) {
      return null;
    }

    // Base64url to standard base64: replace '-' with '+', '_' with '/'
    let base64 = segments[1].replace(/-/g, "+").replace(/_/g, "/");

    // Add padding if needed
    const padLength = (4 - (base64.length % 4)) % 4;
    base64 += "=".repeat(padLength);

    const jsonString = atob(base64);
    const payload = JSON.parse(jsonString);

    // Validate exp field exists and is a number
    if (typeof payload.exp !== "number") {
      return null;
    }

    return payload as JwtPayload;
  } catch {
    return null;
  }
}

/**
 * Check whether a JWT token is expired.
 * Returns true if the token is malformed or expired.
 */
export function isJwtExpired(jwt: string): boolean {
  const payload = decodeJwt(jwt);
  if (!payload) return true;
  return payload.exp * 1000 < Date.now();
}

/**
 * Refresh the access JWT using a refresh token.
 * Uses Obsidian's requestUrl (not fetch) for HTTP.
 * Throws on failure — caller should handle the error.
 */
export async function refreshJwt(refreshToken: string): Promise<string> {
  const response = await requestUrl({
    url: REFRESH_URL,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  const data = response.json;
  if (!data?.c?.success) {
    throw new Error("Refresh token invalid or expired");
  }
  return data.c.token.token;
}

/**
 * Check refresh token expiration at startup.
 * The refresh token may be JWT (old behavior) or opaque string (actual format).
 * For opaque tokens, we can't check expiration — return null silently.
 * Returns a warning message string, or null if no warning needed.
 */
export function checkTokenExpiration(refreshToken: string): string | null {
  if (!refreshToken) return null;

  // Try decoding as JWT — if it's an opaque token, decodeJwt returns null
  const payload = decodeJwt(refreshToken);
  if (!payload) return null; // Opaque token or malformed = skip check

  const daysUntilExpiry =
    (payload.exp * 1000 - Date.now()) / (1000 * 60 * 60 * 24);

  if (daysUntilExpiry <= 0) {
    return "Get笔记 refresh token has expired, please update in settings";
  }
  if (daysUntilExpiry <= 7) {
    return `Get笔记 refresh token expires in ${Math.ceil(daysUntilExpiry)} days, please update`;
  }
  return null;
}

/**
 * Validate refresh token before sync.
 * The refresh token is an opaque string (NOT a JWT), so we only check non-empty.
 * Returns error message, or null if valid.
 */
export function validateRefreshToken(refreshToken: string): string | null {
  if (!refreshToken)
    return "Please configure refresh token in settings";
  return null;
}
