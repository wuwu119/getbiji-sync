// INPUT: obsidian (requestUrl), types (BijiNote)
// OUTPUT: AuthFatalError, requestWithRetry, fetchNotes, fetchLinkDetail, apiHeaders, API_BASE, DETAIL_DELAY
// POS: API client — HTTP requests with retry logic, pagination, link detail fetching

import { requestUrl, RequestUrlParam } from "obsidian";
import type { BijiNote } from "./types";

// ── AuthFatalError ──────────────────────────────────────────────────
// Thrown when authentication fails after JWT refresh+retry.
// Prevents "401 storm" where N notes x (call + refresh + retry) = 3N wasted requests.

export class AuthFatalError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "AuthFatalError";
  }
}

// ── Constants ───────────────────────────────────────────────────────

export const API_BASE = "https://get-notes.luojilab.com/voicenotes/web";
const PAGE_SIZE = 50;
const PAGE_DELAY = 300;
export const DETAIL_DELAY = 200;
const MAX_RETRIES = 3;
const BACKOFF_BASE = 1000;

// ── Types ───────────────────────────────────────────────────────────

export type JwtRefreshCallback = () => Promise<string>;

// ── Headers ─────────────────────────────────────────────────────────
// CRITICAL: X-OAuth-Version: 1 is REQUIRED. Missing it causes 403 InvalidToken.

export function apiHeaders(jwt: string): Record<string, string> {
  return {
    Authorization: `Bearer ${jwt}`,
    "X-OAuth-Version": "1",
    "Content-Type": "application/json",
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  };
}

// ── requestWithRetry ────────────────────────────────────────────────
// Retry logic:
// - 5xx / 429: exponential backoff (1s, 2s, 4s), max 3 attempts
//   - 429: use max(Retry-After header * 1000, calculated backoff)
// - 401 / 403: refreshJwtCallback() -> update Authorization -> retry ONCE
//   - If refresh fails -> AuthFatalError
//   - If retry still 401/403 -> AuthFatalError (double-fail)
// - Other 4xx: re-throw immediately
// - Network errors (no status): retry with exponential backoff, max 3 attempts
//
// Obsidian's requestUrl throws for non-2xx. Exception has .status property.
// On success returns { json, text, headers, status }.

export async function requestWithRetry(
  params: RequestUrlParam,
  refreshJwtCallback: JwtRefreshCallback,
): Promise<any> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await requestUrl(params);
    } catch (err: any) {
      const status = err?.status;

      // ── 401 / 403: JWT expired — refresh and retry once ──
      if (status === 401 || status === 403) {
        try {
          const newJwt = await refreshJwtCallback();
          params = {
            ...params,
            headers: { ...params.headers, Authorization: `Bearer ${newJwt}` },
          };
          try {
            return await requestUrl(params);
          } catch (retryErr: any) {
            if (retryErr?.status === 401 || retryErr?.status === 403) {
              throw new AuthFatalError(
                "Authentication failed after refresh",
                retryErr,
              );
            }
            throw retryErr;
          }
        } catch (refreshErr) {
          if (refreshErr instanceof AuthFatalError) throw refreshErr;
          throw new AuthFatalError(
            "JWT refresh failed",
            refreshErr as Error,
          );
        }
      }

      // ── Other 4xx (except 429): immediate fail ──
      if (status && status >= 400 && status < 500 && status !== 429) {
        throw err;
      }

      // ── 5xx, 429, or network error: retry with backoff ──
      if (attempt === MAX_RETRIES - 1) throw err;

      let delay = BACKOFF_BASE * Math.pow(2, attempt);
      if (status === 429) {
        const retryAfter = err?.headers?.["retry-after"];
        if (retryAfter) {
          delay = Math.max(parseInt(retryAfter, 10) * 1000, delay);
        }
      }

      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// ── fetchNotes ──────────────────────────────────────────────────────
// Yields pages of notes as AsyncIterable. Each yield is { notes, isLastPage }.
// The sync engine iterates pages and processes individual notes.

export async function* fetchNotes(
  jwt: string,
  refreshJwt: JwtRefreshCallback,
  signal?: AbortSignal,
): AsyncIterable<{ notes: BijiNote[]; isLastPage: boolean }> {
  let sinceId = "";

  while (true) {
    if (signal?.aborted) return;

    const url = `${API_BASE}/notes?limit=${PAGE_SIZE}&since_id=${encodeURIComponent(sinceId)}&sort=create_desc`;

    const response = await requestWithRetry(
      { url, headers: apiHeaders(jwt) },
      refreshJwt,
    );

    const list: BijiNote[] = response.json?.c?.list ?? [];
    const isLastPage = list.length < PAGE_SIZE;

    yield { notes: list, isLastPage };

    if (isLastPage || list.length === 0) return;

    // since_id for next page = last note's ID (oldest on current page)
    sinceId = list[list.length - 1].id;

    await new Promise((r) => setTimeout(r, PAGE_DELAY));
  }
}

// ── fetchLinkDetail ─────────────────────────────────────────────────
// Fetches full content for link-type notes.
// AuthFatalError MUST propagate. Other errors are non-fatal (returns null).

export async function fetchLinkDetail(
  jwt: string,
  noteId: string,
  refreshJwt: JwtRefreshCallback,
): Promise<string | null> {
  try {
    const response = await requestWithRetry(
      {
        url: `${API_BASE}/notes/${encodeURIComponent(noteId)}/links/detail`,
        headers: apiHeaders(jwt),
      },
      refreshJwt,
    );

    const data = response.json;
    if (data?.c?.has_content && data.c.content) {
      return data.c.content;
    }
  } catch (err) {
    // AuthFatalError must propagate — it signals unrecoverable auth failure
    if (err instanceof AuthFatalError) throw err;
    console.error(`Failed to fetch link detail for ${noteId}:`, err);
  }
  return null;
}
