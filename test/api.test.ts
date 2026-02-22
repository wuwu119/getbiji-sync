import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock is hoisted — replaces the obsidian alias with a controlled mock
vi.mock("obsidian", () => ({
  requestUrl: vi.fn(),
}));

import { requestUrl } from "obsidian";
import {
  requestWithRetry,
  AuthFatalError,
  fetchLinkDetail,
  apiHeaders,
  API_BASE,
} from "../src/api";

const mockRequestUrl = vi.mocked(requestUrl);

beforeEach(() => {
  mockRequestUrl.mockReset();
});

// ── apiHeaders ──────────────────────────────────────────────────────

describe("apiHeaders", () => {
  it("should include required X-OAuth-Version header", () => {
    const h = apiHeaders("test-jwt");
    expect(h["X-OAuth-Version"]).toBe("1");
    expect(h["Authorization"]).toBe("Bearer test-jwt");
    expect(h["Content-Type"]).toBe("application/json");
  });
});

// ── requestWithRetry ────────────────────────────────────────────────

describe("requestWithRetry", () => {
  const dummyRefresh = vi.fn<[], Promise<string>>();
  const params = {
    url: "https://example.com/api",
    headers: { Authorization: "Bearer old-jwt" },
  };

  beforeEach(() => {
    dummyRefresh.mockReset();
  });

  // 1. Success on first try
  it("should return response on first successful call", async () => {
    const expected = { json: { ok: true }, status: 200 };
    mockRequestUrl.mockResolvedValueOnce(expected);

    const result = await requestWithRetry(params, dummyRefresh);
    expect(result).toBe(expected);
    expect(mockRequestUrl).toHaveBeenCalledTimes(1);
  });

  // 2. 500 retry — fails twice, succeeds third time
  it("should retry on 500 and succeed on third attempt", async () => {
    vi.useFakeTimers();

    const err500 = { status: 500, message: "Internal Server Error" };
    const expected = { json: { ok: true }, status: 200 };

    mockRequestUrl
      .mockRejectedValueOnce(err500)
      .mockRejectedValueOnce(err500)
      .mockResolvedValueOnce(expected);

    const promise = requestWithRetry(params, dummyRefresh);

    // Advance past first backoff (1000ms)
    await vi.advanceTimersByTimeAsync(1000);
    // Advance past second backoff (2000ms)
    await vi.advanceTimersByTimeAsync(2000);

    const result = await promise;
    expect(result).toBe(expected);
    expect(mockRequestUrl).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });

  // 3. 500 all retries exhausted
  it("should throw after 3 failed 500 attempts", async () => {
    vi.useFakeTimers();

    const err500 = { status: 500, message: "Internal Server Error" };
    mockRequestUrl
      .mockRejectedValueOnce(err500)
      .mockRejectedValueOnce(err500)
      .mockRejectedValueOnce(err500);

    const promise = requestWithRetry(params, dummyRefresh);

    // Attach rejection handler early to prevent unhandled rejection warning
    const resultPromise = promise.catch((e) => e);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);

    const caught = await resultPromise;
    expect(caught).toEqual(err500);
    expect(mockRequestUrl).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });

  // 4. 429 with Retry-After header
  it("should respect Retry-After header on 429", async () => {
    vi.useFakeTimers();

    const err429 = {
      status: 429,
      message: "Too Many Requests",
      headers: { "retry-after": "10" },
    };
    const expected = { json: { ok: true }, status: 200 };

    mockRequestUrl
      .mockRejectedValueOnce(err429)
      .mockResolvedValueOnce(expected);

    const promise = requestWithRetry(params, dummyRefresh);

    // Retry-After = 10s = 10000ms, backoff = 1000ms, max = 10000ms
    await vi.advanceTimersByTimeAsync(10000);

    const result = await promise;
    expect(result).toBe(expected);

    vi.useRealTimers();
  });

  // 5. 401 then refresh succeeds
  it("should refresh JWT on 401 and retry successfully", async () => {
    const err401 = { status: 401, message: "Unauthorized" };
    const expected = { json: { ok: true }, status: 200 };

    mockRequestUrl
      .mockRejectedValueOnce(err401)
      .mockResolvedValueOnce(expected);

    dummyRefresh.mockResolvedValueOnce("new-jwt");

    const result = await requestWithRetry(params, dummyRefresh);
    expect(result).toBe(expected);
    expect(dummyRefresh).toHaveBeenCalledTimes(1);

    // Verify the retry used the new JWT
    const retryCall = mockRequestUrl.mock.calls[1][0];
    expect(retryCall.headers.Authorization).toBe("Bearer new-jwt");
  });

  // 6. 401 double fail — AuthFatalError
  it("should throw AuthFatalError on 401 double fail", async () => {
    const err401 = { status: 401, message: "Unauthorized" };

    // First call: 401 -> refresh succeeds -> retry still 401 -> AuthFatalError
    mockRequestUrl
      .mockRejectedValueOnce(err401)
      .mockRejectedValueOnce(err401);

    dummyRefresh.mockResolvedValueOnce("new-jwt");

    await expect(requestWithRetry(params, dummyRefresh)).rejects.toThrow(
      AuthFatalError,
    );
  });

  // 7. 401 refresh fails — AuthFatalError
  it("should throw AuthFatalError when refresh callback fails", async () => {
    const err401 = { status: 401, message: "Unauthorized" };

    mockRequestUrl.mockRejectedValueOnce(err401);
    dummyRefresh.mockRejectedValueOnce(new Error("Refresh failed"));

    await expect(requestWithRetry(params, dummyRefresh)).rejects.toThrow(
      AuthFatalError,
    );
    expect(dummyRefresh).toHaveBeenCalledTimes(1);
  });

  // 8. 404 immediate fail — no retry
  it("should throw immediately on 404 without retrying", async () => {
    const err404 = { status: 404, message: "Not Found" };
    mockRequestUrl.mockRejectedValueOnce(err404);

    await expect(requestWithRetry(params, dummyRefresh)).rejects.toEqual(
      err404,
    );
    expect(mockRequestUrl).toHaveBeenCalledTimes(1);
    expect(dummyRefresh).not.toHaveBeenCalled();
  });

  // 9. Network error (no status) — retries with backoff
  it("should retry network errors (no status) with backoff", async () => {
    vi.useFakeTimers();

    const networkErr = new Error("ECONNRESET");
    const expected = { json: { ok: true }, status: 200 };

    mockRequestUrl
      .mockRejectedValueOnce(networkErr)
      .mockResolvedValueOnce(expected);

    const promise = requestWithRetry(params, dummyRefresh);

    await vi.advanceTimersByTimeAsync(1000);

    const result = await promise;
    expect(result).toBe(expected);
    expect(mockRequestUrl).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});

// ── fetchLinkDetail ─────────────────────────────────────────────────

describe("fetchLinkDetail", () => {
  const dummyRefresh = vi.fn<[], Promise<string>>();

  beforeEach(() => {
    dummyRefresh.mockReset();
  });

  // 10. has_content true — returns content
  it("should return content when has_content is true", async () => {
    mockRequestUrl.mockResolvedValueOnce({
      json: { c: { has_content: true, content: "<p>Article text</p>" } },
      status: 200,
    });

    const result = await fetchLinkDetail("jwt", "note-123", dummyRefresh);
    expect(result).toBe("<p>Article text</p>");

    // Verify correct URL was called
    const callUrl = mockRequestUrl.mock.calls[0][0].url;
    expect(callUrl).toBe(`${API_BASE}/notes/note-123/links/detail`);
  });

  // 11. has_content false — returns null
  it("should return null when has_content is false", async () => {
    mockRequestUrl.mockResolvedValueOnce({
      json: { c: { has_content: false } },
      status: 200,
    });

    const result = await fetchLinkDetail("jwt", "note-456", dummyRefresh);
    expect(result).toBeNull();
  });

  // 12. Request fails (non-auth) — returns null (non-fatal)
  it("should return null on non-auth request failure", async () => {
    mockRequestUrl.mockRejectedValueOnce({
      status: 500,
      message: "Internal Server Error",
    });
    // Retry attempts also fail
    mockRequestUrl.mockRejectedValueOnce({
      status: 500,
      message: "Internal Server Error",
    });
    mockRequestUrl.mockRejectedValueOnce({
      status: 500,
      message: "Internal Server Error",
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await fetchLinkDetail("jwt", "note-789", dummyRefresh);
    expect(result).toBeNull();

    consoleSpy.mockRestore();
  });

  // 13. AuthFatalError propagates
  it("should propagate AuthFatalError", async () => {
    // 401 -> refresh fails -> AuthFatalError
    mockRequestUrl.mockRejectedValueOnce({
      status: 401,
      message: "Unauthorized",
    });
    dummyRefresh.mockRejectedValueOnce(new Error("Refresh failed"));

    await expect(
      fetchLinkDetail("jwt", "note-xxx", dummyRefresh),
    ).rejects.toThrow(AuthFatalError);
  });
});
