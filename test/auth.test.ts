import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  decodeJwt,
  isJwtExpired,
  checkTokenExpiration,
  validateRefreshToken,
} from "../src/auth";

/**
 * Helper to create a JWT string with a given payload.
 * Uses btoa() (available in Node.js globals) — no Buffer.from.
 */
function makeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.fake-signature`;
}

describe("decodeJwt", () => {
  it("should decode a valid JWT and return payload with exp", () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const jwt = makeJwt({ exp, uid: 42, iat: 1000 });
    const result = decodeJwt(jwt);

    expect(result).not.toBeNull();
    expect(result!.exp).toBe(exp);
    expect(result!.uid).toBe(42);
    expect(result!.iat).toBe(1000);
  });

  it("should return null for malformed token (not 3 segments)", () => {
    expect(decodeJwt("only-one-part")).toBeNull();
    expect(decodeJwt("two.parts")).toBeNull();
    expect(decodeJwt("four.parts.here.extra")).toBeNull();
    expect(decodeJwt("")).toBeNull();
  });

  it("should return null for invalid base64 payload", () => {
    // Create a token with invalid base64 in the payload segment
    const header = btoa(JSON.stringify({ alg: "HS256" }));
    const invalidToken = `${header}.!!!invalid-base64!!!.signature`;
    expect(decodeJwt(invalidToken)).toBeNull();
  });

  it("should return null for invalid JSON in payload", () => {
    const header = btoa(JSON.stringify({ alg: "HS256" }));
    const notJson = btoa("this is not json {{{");
    const token = `${header}.${notJson}.signature`;
    expect(decodeJwt(token)).toBeNull();
  });

  it("should return null when exp field is missing", () => {
    const jwt = makeJwt({ uid: 1, iat: 1000 });
    expect(decodeJwt(jwt)).toBeNull();
  });

  it("should return null when exp field is not a number", () => {
    const jwt = makeJwt({ exp: "not-a-number", uid: 1 });
    expect(decodeJwt(jwt)).toBeNull();
  });

  it("should decode a token with base64 padding correctly", () => {
    // Create a payload that produces base64 requiring padding
    const exp = Math.floor(Date.now() / 1000) + 7200;
    const payload = { exp, data: "x" }; // short payload likely to need padding
    const jwt = makeJwt(payload);

    const result = decodeJwt(jwt);
    expect(result).not.toBeNull();
    expect(result!.exp).toBe(exp);
  });
});

describe("isJwtExpired", () => {
  it("should return true for an expired token", () => {
    const expiredExp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
    const jwt = makeJwt({ exp: expiredExp });
    expect(isJwtExpired(jwt)).toBe(true);
  });

  it("should return false for a valid (non-expired) token", () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    const jwt = makeJwt({ exp: futureExp });
    expect(isJwtExpired(jwt)).toBe(false);
  });

  it("should return true for a malformed token", () => {
    expect(isJwtExpired("not-a-jwt")).toBe(true);
    expect(isJwtExpired("")).toBe(true);
    expect(isJwtExpired("a.b")).toBe(true);
  });
});

describe("checkTokenExpiration", () => {
  let dateNowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Fix Date.now() for deterministic tests
    dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(1700000000000);
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
  });

  it("should return expired message when token is expired", () => {
    const expiredExp = Math.floor(1700000000000 / 1000) - 86400; // 1 day ago
    const jwt = makeJwt({ exp: expiredExp });
    const result = checkTokenExpiration(jwt);

    expect(result).toBe(
      "Get笔记 refresh token has expired, please update in settings"
    );
  });

  it("should return expiring-soon message when token expires within 7 days", () => {
    const soonExp = Math.floor(1700000000000 / 1000) + 3 * 86400; // 3 days from now
    const jwt = makeJwt({ exp: soonExp });
    const result = checkTokenExpiration(jwt);

    expect(result).toBe(
      "Get笔记 refresh token expires in 3 days, please update"
    );
  });

  it("should return null when token is valid and not expiring soon", () => {
    const futureExp = Math.floor(1700000000000 / 1000) + 30 * 86400; // 30 days
    const jwt = makeJwt({ exp: futureExp });
    const result = checkTokenExpiration(jwt);

    expect(result).toBeNull();
  });

  it("should return null for empty token", () => {
    expect(checkTokenExpiration("")).toBeNull();
  });

  it("should return null for malformed token", () => {
    expect(checkTokenExpiration("not.valid")).toBeNull();
    expect(checkTokenExpiration("a.b.c")).toBeNull(); // invalid base64/JSON
  });

  it("should return null for opaque refresh token (non-JWT)", () => {
    // Real refresh tokens are opaque strings — can't check expiration
    expect(
      checkTokenExpiration("AAAAAAAN9wuIOCZ9o0kMVPdduBEhX6o1AAAAAGoNWXJ_X_-tGGR_B64zfV-BVMUM.ieRTJkzB7nVr4_KnnreA-h7klv-mFi-ozFLLiuv15fg")
    ).toBeNull();
  });
});

describe("validateRefreshToken", () => {
  it("should return error message for empty token", () => {
    expect(validateRefreshToken("")).toBe(
      "Please configure refresh token in settings"
    );
  });

  it("should return null for opaque refresh token (non-JWT)", () => {
    // Real refresh tokens are opaque strings, not JWTs
    expect(
      validateRefreshToken("AAAAAAAN9wuIOCZ9o0kMVPdduBEhX6o1AAAAAGoNWXJ_X_-tGGR_B64zfV-BVMUM.ieRTJkzB7nVr4_KnnreA-h7klv-mFi-ozFLLiuv15fg")
    ).toBeNull();
  });

  it("should return null for JWT format token", () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const jwt = makeJwt({ exp });
    expect(validateRefreshToken(jwt)).toBeNull();
  });

  it("should return null for any non-empty string", () => {
    expect(validateRefreshToken("some-token")).toBeNull();
    expect(validateRefreshToken("two.parts")).toBeNull();
  });
});
