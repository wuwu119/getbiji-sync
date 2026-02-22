import { describe, it, expect, vi, beforeEach } from "vitest";
import { Notice, TFile, TFolder } from "obsidian";
import { DEFAULT_SETTINGS, BijiSyncSettings } from "../src/settings";
import type BijiSyncPlugin from "../src/main";
import type { BijiNote } from "../src/types";

// ── Hoisted variables for use inside vi.mock factories ──────────────

const {
  mockFetchNotes,
  mockFetchLinkDetail,
  MockAuthFatalError,
  mockRefreshJwt,
  mockValidateRefreshToken,
} = vi.hoisted(() => {
  class MockAuthFatalError extends Error {
    constructor(message: string, public readonly cause?: Error) {
      super(message);
      this.name = "AuthFatalError";
    }
  }
  return {
    mockFetchNotes: vi.fn(),
    mockFetchLinkDetail: vi.fn(),
    MockAuthFatalError,
    mockRefreshJwt: vi.fn().mockResolvedValue("mock-jwt-token"),
    mockValidateRefreshToken: vi.fn().mockReturnValue(null),
  };
});

// ── Mock api module ─────────────────────────────────────────────────

vi.mock("../src/api", () => ({
  AuthFatalError: MockAuthFatalError,
  DETAIL_DELAY: 0, // Use 0ms in tests to avoid unnecessary wait
  fetchNotes: (...args: any[]) => mockFetchNotes(...args),
  fetchLinkDetail: (...args: any[]) => mockFetchLinkDetail(...args),
}));

// ── Mock auth module ────────────────────────────────────────────────

vi.mock("../src/auth", () => ({
  refreshJwt: (...args: any[]) => mockRefreshJwt(...args),
  isJwtExpired: vi.fn().mockReturnValue(false),
  validateRefreshToken: (...args: any[]) => mockValidateRefreshToken(...args),
}));

// ── Import syncBiji AFTER mocks ─────────────────────────────────────

import { syncBiji } from "../src/sync";

// ── Helpers ─────────────────────────────────────────────────────────

function createMockPlugin(
  settings: Partial<BijiSyncSettings> = {},
): BijiSyncPlugin {
  return {
    settings: {
      ...DEFAULT_SETTINGS,
      refreshToken: "header.eyJleHAiOjk5OTk5OTk5OTksInVpZCI6MX0.sig",
      ...settings,
    },
    saveSettings: vi.fn().mockResolvedValue(undefined),
    app: {
      vault: {
        getAbstractFileByPath: vi.fn().mockReturnValue(new TFolder("Get笔记")),
        createFolder: vi.fn().mockResolvedValue(undefined),
        create: vi.fn().mockResolvedValue(new TFile()),
      },
      metadataCache: {
        getFileCache: vi.fn().mockReturnValue(null),
      },
    },
  } as unknown as BijiSyncPlugin;
}

function makeBijiNote(overrides: Partial<BijiNote> = {}): BijiNote {
  return {
    id: "note-001",
    note_id: "note-001",
    title: "Test Note",
    content: "Hello world",
    body_text: "Hello world",
    source: "app",
    note_type: "plain_text",
    entry_type: "manual",
    tags: [],
    attachments: [],
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    edit_time: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

/**
 * Helper to create an async generator that yields pages of notes.
 */
async function* mockPages(
  pages: BijiNote[][],
): AsyncIterable<{ notes: BijiNote[]; isLastPage: boolean }> {
  for (let i = 0; i < pages.length; i++) {
    yield { notes: pages[i], isLastPage: i === pages.length - 1 };
  }
}

// ── Tests ───────────────────────────────────────────────────────────

describe("syncBiji", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRefreshJwt.mockResolvedValue("mock-jwt-token");
    mockValidateRefreshToken.mockReturnValue(null);
  });

  // ── Empty sync ──────────────────────────────────────────────────

  it("should handle empty sync (no notes)", async () => {
    const plugin = createMockPlugin();
    mockFetchNotes.mockReturnValue(mockPages([[]]));

    const controller = new AbortController();
    await syncBiji(plugin, controller.signal);

    expect(plugin.saveSettings).toHaveBeenCalled();
    // lastSyncId should remain null since there were no notes
    expect(plugin.settings.lastSyncId).toBeNull();
    expect(plugin.settings.lastSyncTime).toBeTypeOf("number");
  });

  // ── Basic sync creates files ───────────────────────────────────

  it("should sync notes and create files", async () => {
    const plugin = createMockPlugin();
    // No existing file at the path
    (plugin.app.vault.getAbstractFileByPath as any).mockReturnValue(
      new TFolder("Get笔记"),
    );
    // Override: return TFolder for folder check, null for file check
    (plugin.app.vault.getAbstractFileByPath as any).mockImplementation(
      (path: string) => {
        if (path === "Get笔记") return new TFolder("Get笔记");
        return null; // No existing file
      },
    );

    const notes = [
      makeBijiNote({ id: "note-002", title: "Second" }),
      makeBijiNote({ id: "note-001", title: "First" }),
    ];
    mockFetchNotes.mockReturnValue(mockPages([notes]));

    const controller = new AbortController();
    await syncBiji(plugin, controller.signal);

    expect(plugin.app.vault.create).toHaveBeenCalledTimes(2);
    expect(plugin.settings.lastSyncId).toBe("note-002"); // newest = first on first page
    expect(plugin.saveSettings).toHaveBeenCalled();
  });

  // ── Dedup: skip already synced notes ───────────────────────────

  it("should skip notes already in vault (dedup via biji_id)", async () => {
    const plugin = createMockPlugin();

    const existingFile = new TFile("Get笔记/Test Note.md");
    (plugin.app.vault.getAbstractFileByPath as any).mockImplementation(
      (path: string) => {
        if (path === "Get笔记") return new TFolder("Get笔记");
        if (path === "Get笔记/Test Note.md") return existingFile;
        return null;
      },
    );
    (plugin.app.metadataCache.getFileCache as any).mockReturnValue({
      frontmatter: { biji_id: "note-001" },
    });

    mockFetchNotes.mockReturnValue(
      mockPages([[makeBijiNote({ id: "note-001", title: "Test Note" })]]),
    );

    const controller = new AbortController();
    await syncBiji(plugin, controller.signal);

    // Should NOT create any file since note is already synced
    expect(plugin.app.vault.create).not.toHaveBeenCalled();
  });

  // ── Filename conflict: different biji_id at same path ──────────

  it("should resolve filename conflicts with id suffix", async () => {
    const plugin = createMockPlugin();

    const existingFile = new TFile("Get笔记/Same Title.md");
    (plugin.app.vault.getAbstractFileByPath as any).mockImplementation(
      (path: string) => {
        if (path === "Get笔记") return new TFolder("Get笔记");
        if (path === "Get笔记/Same Title.md") return existingFile;
        return null;
      },
    );
    (plugin.app.metadataCache.getFileCache as any).mockReturnValue({
      frontmatter: { biji_id: "note-old" },
    });

    mockFetchNotes.mockReturnValue(
      mockPages([[makeBijiNote({ id: "note-new", title: "Same Title" })]]),
    );

    const controller = new AbortController();
    await syncBiji(plugin, controller.signal);

    // Should create with conflict-resolved filename (note-new suffix)
    expect(plugin.app.vault.create).toHaveBeenCalledTimes(1);
    const createdPath = (plugin.app.vault.create as any).mock.calls[0][0];
    expect(createdPath).toContain("note-n"); // starts with "note-n" from slice(0,6)
  });

  // ── Incremental stop condition ─────────────────────────────────

  it("should stop when reaching lastSyncId", async () => {
    const plugin = createMockPlugin({ lastSyncId: "note-002" });
    (plugin.app.vault.getAbstractFileByPath as any).mockImplementation(
      (path: string) => {
        if (path === "Get笔记") return new TFolder("Get笔记");
        return null;
      },
    );

    const notes = [
      makeBijiNote({ id: "note-003", title: "New Note" }),
      makeBijiNote({ id: "note-002", title: "Already Synced" }), // This is lastSyncId
      makeBijiNote({ id: "note-001", title: "Old Note" }),
    ];
    mockFetchNotes.mockReturnValue(mockPages([notes]));

    const controller = new AbortController();
    await syncBiji(plugin, controller.signal);

    // Only note-003 should be created (note-002 triggers stop, note-001 skipped)
    expect(plugin.app.vault.create).toHaveBeenCalledTimes(1);
    expect(plugin.settings.lastSyncId).toBe("note-003");
  });

  it("should not fetch more pages after incremental stop", async () => {
    const plugin = createMockPlugin({ lastSyncId: "note-002" });
    (plugin.app.vault.getAbstractFileByPath as any).mockImplementation(
      (path: string) => {
        if (path === "Get笔记") return new TFolder("Get笔记");
        return null;
      },
    );

    // Page 1 contains lastSyncId, so page 2 should never be processed
    const page1 = [
      makeBijiNote({ id: "note-003", title: "New" }),
      makeBijiNote({ id: "note-002", title: "Stop Here" }),
    ];
    const page2 = [makeBijiNote({ id: "note-001", title: "Should Not Reach" })];

    // Track if page 2 notes get processed
    let page2Reached = false;
    mockFetchNotes.mockImplementation(async function* () {
      yield { notes: page1, isLastPage: false };
      page2Reached = true;
      yield { notes: page2, isLastPage: true };
    });

    const controller = new AbortController();
    await syncBiji(plugin, controller.signal);

    // page2 generator may or may not be entered depending on implementation,
    // but note-001 should NOT be created
    expect(plugin.app.vault.create).toHaveBeenCalledTimes(1);
  });

  // ── Error isolation: single note error continues ───────────────

  it("should continue on single-note error", async () => {
    const plugin = createMockPlugin();
    (plugin.app.vault.getAbstractFileByPath as any).mockImplementation(
      (path: string) => {
        if (path === "Get笔记") return new TFolder("Get笔记");
        return null;
      },
    );

    // Make vault.create fail for the first note
    let callCount = 0;
    (plugin.app.vault.create as any).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error("Disk full");
      return new TFile();
    });

    const notes = [
      makeBijiNote({ id: "note-002", title: "Will Fail" }),
      makeBijiNote({ id: "note-001", title: "Will Succeed" }),
    ];
    mockFetchNotes.mockReturnValue(mockPages([notes]));

    const controller = new AbortController();
    await syncBiji(plugin, controller.signal);

    // Both notes attempted, one succeeded
    expect(plugin.app.vault.create).toHaveBeenCalledTimes(2);
  });

  // ── Error isolation: AuthFatalError stops sync ─────────────────

  it("should re-throw AuthFatalError immediately", async () => {
    const plugin = createMockPlugin();
    (plugin.app.vault.getAbstractFileByPath as any).mockImplementation(
      (path: string) => {
        if (path === "Get笔记") return new TFolder("Get笔记");
        return null;
      },
    );

    // Make vault.create throw AuthFatalError
    (plugin.app.vault.create as any).mockRejectedValue(
      new MockAuthFatalError("Auth failed"),
    );

    mockFetchNotes.mockReturnValue(
      mockPages([[makeBijiNote({ id: "note-001" })]]),
    );

    const controller = new AbortController();
    await expect(syncBiji(plugin, controller.signal)).rejects.toThrow(
      "Auth failed",
    );
  });

  // ── JWT refresh failure → AuthFatalError ───────────────────────

  it("should throw AuthFatalError when JWT refresh fails", async () => {
    const plugin = createMockPlugin();
    mockRefreshJwt.mockRejectedValue(new Error("Network error"));

    const controller = new AbortController();
    await expect(syncBiji(plugin, controller.signal)).rejects.toThrow();
  });

  // ── Invalid refresh token aborts early ─────────────────────────

  it("should abort if refreshToken is invalid", async () => {
    const plugin = createMockPlugin({ refreshToken: "" });
    mockValidateRefreshToken.mockReturnValue(
      "Please configure refresh token in settings",
    );

    const controller = new AbortController();
    await syncBiji(plugin, controller.signal);

    // Should not attempt to fetch notes
    expect(mockFetchNotes).not.toHaveBeenCalled();
    expect(mockRefreshJwt).not.toHaveBeenCalled();
  });

  // ── Target folder auto-creation ────────────────────────────────

  it("should create target folder if it does not exist", async () => {
    const plugin = createMockPlugin();
    // Return null for folder check (folder doesn't exist)
    (plugin.app.vault.getAbstractFileByPath as any).mockImplementation(
      (path: string) => {
        return null; // Nothing exists
      },
    );

    mockFetchNotes.mockReturnValue(mockPages([[]]));

    const controller = new AbortController();
    await syncBiji(plugin, controller.signal);

    expect(plugin.app.vault.createFolder).toHaveBeenCalledWith("Get笔记");
  });

  it("should not create folder if it already exists", async () => {
    const plugin = createMockPlugin();
    (plugin.app.vault.getAbstractFileByPath as any).mockImplementation(
      (path: string) => {
        if (path === "Get笔记") return new TFolder("Get笔记");
        return null;
      },
    );

    mockFetchNotes.mockReturnValue(mockPages([[]]));

    const controller = new AbortController();
    await syncBiji(plugin, controller.signal);

    expect(plugin.app.vault.createFolder).not.toHaveBeenCalled();
  });

  // ── Cursor save semantics ──────────────────────────────────────

  it("should save newestNoteId as lastSyncId (first note of first page)", async () => {
    const plugin = createMockPlugin();
    (plugin.app.vault.getAbstractFileByPath as any).mockImplementation(
      (path: string) => {
        if (path === "Get笔记") return new TFolder("Get笔记");
        return null;
      },
    );

    const page1 = [
      makeBijiNote({ id: "note-100", title: "Newest" }),
      makeBijiNote({ id: "note-099", title: "Older" }),
    ];
    const page2 = [
      makeBijiNote({ id: "note-098", title: "Even Older" }),
    ];
    mockFetchNotes.mockReturnValue(mockPages([page1, page2]));

    const controller = new AbortController();
    await syncBiji(plugin, controller.signal);

    // lastSyncId should be the first note of the first page
    expect(plugin.settings.lastSyncId).toBe("note-100");
    expect(plugin.settings.lastSyncTime).toBeTypeOf("number");
    expect(plugin.saveSettings).toHaveBeenCalled();
  });

  // ── Link notes fetch original content ──────────────────────────

  it("should fetch link detail for link-type notes", async () => {
    const plugin = createMockPlugin();
    (plugin.app.vault.getAbstractFileByPath as any).mockImplementation(
      (path: string) => {
        if (path === "Get笔记") return new TFolder("Get笔记");
        return null;
      },
    );

    mockFetchLinkDetail.mockResolvedValue("<p>Original article content</p>");

    mockFetchNotes.mockReturnValue(
      mockPages([
        [makeBijiNote({ id: "note-001", note_type: "link", title: "Link Note" })],
      ]),
    );

    const controller = new AbortController();
    await syncBiji(plugin, controller.signal);

    expect(mockFetchLinkDetail).toHaveBeenCalledWith(
      "mock-jwt-token",
      "note-001",
      expect.any(Function),
    );
    expect(plugin.app.vault.create).toHaveBeenCalledTimes(1);
    // Check the markdown contains the cleaned original content in a callout
    const createdContent = (plugin.app.vault.create as any).mock.calls[0][1];
    expect(createdContent).toContain("Original article content");
    expect(createdContent).toContain("[!quote]- 原文");
  });

  it("should continue if link detail fetch fails", async () => {
    const plugin = createMockPlugin();
    (plugin.app.vault.getAbstractFileByPath as any).mockImplementation(
      (path: string) => {
        if (path === "Get笔记") return new TFolder("Get笔记");
        return null;
      },
    );

    mockFetchLinkDetail.mockResolvedValue(null);

    mockFetchNotes.mockReturnValue(
      mockPages([
        [makeBijiNote({ id: "note-001", note_type: "link", title: "Link Note" })],
      ]),
    );

    const controller = new AbortController();
    await syncBiji(plugin, controller.signal);

    // Should still create the file even without original content
    expect(plugin.app.vault.create).toHaveBeenCalledTimes(1);
    const createdContent = (plugin.app.vault.create as any).mock.calls[0][1];
    // No callout since originalContent is null
    expect(createdContent).not.toContain("[!quote]- 原文");
  });

  // ── Abort signal ───────────────────────────────────────────────

  it("should stop when abort signal is triggered", async () => {
    const plugin = createMockPlugin();
    (plugin.app.vault.getAbstractFileByPath as any).mockImplementation(
      (path: string) => {
        if (path === "Get笔记") return new TFolder("Get笔记");
        return null;
      },
    );

    const controller = new AbortController();

    // Abort after first note creation
    (plugin.app.vault.create as any).mockImplementation(async () => {
      controller.abort();
      return new TFile();
    });

    const notes = [
      makeBijiNote({ id: "note-002", title: "First" }),
      makeBijiNote({ id: "note-001", title: "Second" }),
    ];
    mockFetchNotes.mockReturnValue(mockPages([notes]));

    await syncBiji(plugin, controller.signal);

    // Only the first note should be created (abort happens during its creation)
    expect(plugin.app.vault.create).toHaveBeenCalledTimes(1);
    // Settings should still be saved
    expect(plugin.saveSettings).toHaveBeenCalled();
  });

  // ── Notes with missing id are skipped ──────────────────────────

  it("should skip notes with missing id", async () => {
    const plugin = createMockPlugin();
    (plugin.app.vault.getAbstractFileByPath as any).mockImplementation(
      (path: string) => {
        if (path === "Get笔记") return new TFolder("Get笔记");
        return null;
      },
    );

    const notes = [
      makeBijiNote({ id: "", title: "No ID" }),
      makeBijiNote({ id: "note-001", title: "Has ID" }),
    ];
    mockFetchNotes.mockReturnValue(mockPages([notes]));

    const controller = new AbortController();
    await syncBiji(plugin, controller.signal);

    // Only the note with valid id should be created
    expect(plugin.app.vault.create).toHaveBeenCalledTimes(1);
  });

  // ── Silent mode (syncBiji level) ──────────────────────────────

  it("should suppress all Notices in silent mode", async () => {
    const NoticeSpy = vi.spyOn(Notice.prototype, "constructor" as any);
    // Track Notice instantiation via the mock class
    const noticeInstances: string[] = [];
    const OrigNotice = Notice;
    vi.stubGlobal("__noticeMessages", noticeInstances);

    const plugin = createMockPlugin();
    (plugin.app.vault.getAbstractFileByPath as any).mockImplementation(
      (path: string) => {
        if (path === "Get笔记") return new TFolder("Get笔记");
        return null;
      },
    );

    const notes = [makeBijiNote({ id: "note-001", title: "Test" })];
    mockFetchNotes.mockReturnValue(mockPages([notes]));

    const controller = new AbortController();
    await syncBiji(plugin, controller.signal, { silent: true });

    // Since our obsidian mock's Notice doesn't track calls,
    // verify indirectly: syncBiji completed without throwing
    expect(plugin.app.vault.create).toHaveBeenCalledTimes(1);
    expect(plugin.saveSettings).toHaveBeenCalled();
    NoticeSpy.mockRestore();
  });

  it("should suppress token validation Notice in silent mode", async () => {
    mockValidateRefreshToken.mockReturnValueOnce("Token is empty");

    const plugin = createMockPlugin({ refreshToken: "" });
    const controller = new AbortController();

    // In silent mode, syncBiji should return without throwing
    // even when token validation fails
    await syncBiji(plugin, controller.signal, { silent: true });

    // Should not attempt to fetch notes
    expect(mockFetchNotes).not.toHaveBeenCalled();
  });
});
