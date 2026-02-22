// INPUT: main.ts (BijiSyncPlugin), settings.ts (DEFAULT_SETTINGS, BijiSyncSettings)
// OUTPUT: Auto-sync feature tests
// POS: Test layer — validates auto-sync lifecycle, silent mode, MetadataCache gate

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DEFAULT_SETTINGS, BijiSyncSettings } from "../src/settings";

// ── Provide global `window` for Node environment (Obsidian runs in Electron) ─

const mockSetInterval = vi.fn().mockReturnValue(42);
const mockClearInterval = vi.fn();

(globalThis as any).window = {
  setInterval: (...args: any[]) => mockSetInterval(...args),
  clearInterval: (...args: any[]) => mockClearInterval(...args),
};

// ── Hoisted mocks ───────────────────────────────────────────────────

const {
  MockNotice,
  MockAuthFatalError,
  mockSyncBiji,
  mockCheckTokenExpiration,
} = vi.hoisted(() => {
  const MockNotice = vi.fn();
  class MockAuthFatalError extends Error {
    constructor(message: string, public readonly cause?: Error) {
      super(message);
      this.name = "AuthFatalError";
    }
  }
  return {
    MockNotice,
    MockAuthFatalError,
    mockSyncBiji: vi.fn().mockResolvedValue(undefined),
    mockCheckTokenExpiration: vi.fn().mockReturnValue(null),
  };
});

// ── Mock obsidian module ────────────────────────────────────────────

vi.mock("obsidian", () => ({
  Plugin: class {
    app: any = {};
    loadData = vi.fn().mockResolvedValue({});
    saveData = vi.fn().mockResolvedValue(undefined);
    addSettingTab = vi.fn();
    addRibbonIcon = vi.fn();
    addCommand = vi.fn();
    registerInterval = vi.fn();
    registerEvent = vi.fn();
  },
  Notice: class {
    message: string;
    constructor(message: string) {
      MockNotice(message);
      this.message = message;
    }
  },
  PluginSettingTab: class {},
  Setting: class {
    setName() { return this; }
    setDesc() { return this; }
    addText() { return this; }
    addToggle() { return this; }
    addDropdown() { return this; }
    addButton() { return this; }
  },
}));

// ── Mock sync module ────────────────────────────────────────────────

vi.mock("../src/sync", () => ({
  syncBiji: (...args: any[]) => mockSyncBiji(...args),
}));

// ── Mock api module ─────────────────────────────────────────────────

vi.mock("../src/api", () => ({
  AuthFatalError: MockAuthFatalError,
}));

// ── Mock auth module ────────────────────────────────────────────────

vi.mock("../src/auth", () => ({
  checkTokenExpiration: (...args: any[]) => mockCheckTokenExpiration(...args),
}));

// ── Import AFTER mocks ──────────────────────────────────────────────

import BijiSyncPlugin from "../src/main";

// ── Helpers ─────────────────────────────────────────────────────────

function createPlugin(
  settingsOverrides: Partial<BijiSyncSettings> = {},
): BijiSyncPlugin {
  const plugin = new BijiSyncPlugin();
  plugin.settings = {
    ...DEFAULT_SETTINGS,
    ...settingsOverrides,
  };
  // Set up app.metadataCache for onload tests
  plugin.app = {
    metadataCache: {
      resolved: true,
      on: vi.fn(),
      offref: vi.fn(),
    },
  } as any;
  return plugin;
}

// ── Tests ───────────────────────────────────────────────────────────

describe("startAutoSync / stopAutoSync lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetInterval.mockReturnValue(42);
  });

  it("should call setInterval with correct milliseconds", () => {
    const plugin = createPlugin({ autoSyncInterval: 15 });
    (plugin as any).startAutoSync();

    expect(mockSetInterval).toHaveBeenCalledWith(
      expect.any(Function),
      15 * 60 * 1000,
    );
  });

  it("should register interval with Obsidian for cleanup", () => {
    const plugin = createPlugin({ autoSyncInterval: 30 });
    (plugin as any).startAutoSync();

    expect(plugin.registerInterval).toHaveBeenCalledWith(42);
  });

  it("should call clearInterval on stopAutoSync", () => {
    const plugin = createPlugin();
    (plugin as any).startAutoSync();
    (plugin as any).stopAutoSync();

    expect(mockClearInterval).toHaveBeenCalledWith(42);
  });

  it("should not call clearInterval if no timer is active", () => {
    const plugin = createPlugin();
    (plugin as any).stopAutoSync();

    expect(mockClearInterval).not.toHaveBeenCalled();
  });

  it("should clamp interval to minimum 5 minutes", () => {
    const plugin = createPlugin({ autoSyncInterval: 1 });
    (plugin as any).startAutoSync();

    expect(mockSetInterval).toHaveBeenCalledWith(
      expect.any(Function),
      5 * 60 * 1000, // Clamped to 5 min, not 1 min
    );
  });

  it("should invoke triggerSync with silent:true when interval callback fires", async () => {
    const plugin = createPlugin({ autoSyncInterval: 30 });
    const triggerSpy = vi.spyOn(plugin, "triggerSync").mockResolvedValue(undefined);

    (plugin as any).startAutoSync();

    // Extract and invoke the callback passed to setInterval
    const callback = mockSetInterval.mock.calls[0][0];
    callback();

    expect(triggerSpy).toHaveBeenCalledWith({ silent: true });
    triggerSpy.mockRestore();
  });

  it("should clear previous interval when startAutoSync is called again", () => {
    const plugin = createPlugin({ autoSyncInterval: 5 });

    mockSetInterval.mockReturnValueOnce(100).mockReturnValueOnce(200);

    (plugin as any).startAutoSync();
    (plugin as any).startAutoSync();

    expect(mockClearInterval).toHaveBeenCalledWith(100);
  });
});

describe("onAutoSyncSettingsChanged", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetInterval.mockReturnValue(42);
  });

  it("should start timer when autoSyncEnabled is true", () => {
    const plugin = createPlugin({ autoSyncEnabled: true, autoSyncInterval: 60 });
    plugin.onAutoSyncSettingsChanged();

    expect(mockSetInterval).toHaveBeenCalledWith(
      expect.any(Function),
      60 * 60 * 1000,
    );
  });

  it("should stop timer when autoSyncEnabled is false", () => {
    const plugin = createPlugin({ autoSyncEnabled: true });
    (plugin as any).startAutoSync();

    plugin.settings.autoSyncEnabled = false;
    plugin.onAutoSyncSettingsChanged();

    expect(mockClearInterval).toHaveBeenCalled();
  });
});

describe("MetadataCache readiness gate on load", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetInterval.mockReturnValue(42);
  });

  it("should start auto-sync immediately when metadataCache is resolved", async () => {
    const plugin = createPlugin({ autoSyncEnabled: true, autoSyncInterval: 30 });
    plugin.app.metadataCache.resolved = true;
    // loadData returns saved settings so loadSettings() preserves autoSyncEnabled
    (plugin.loadData as any).mockResolvedValue({ autoSyncEnabled: true, autoSyncInterval: 30 });

    await plugin.onload();

    expect(mockSetInterval).toHaveBeenCalledWith(
      expect.any(Function),
      30 * 60 * 1000,
    );
  });

  it("should defer auto-sync start when metadataCache is not yet resolved", async () => {
    const plugin = createPlugin({ autoSyncEnabled: true, autoSyncInterval: 30 });
    plugin.app.metadataCache.resolved = false;
    (plugin.loadData as any).mockResolvedValue({ autoSyncEnabled: true, autoSyncInterval: 30 });

    let resolvedCallback: (() => void) | null = null;
    (plugin.app.metadataCache.on as any).mockImplementation(
      (event: string, cb: () => void) => {
        if (event === "resolved") {
          resolvedCallback = cb;
        }
        return { id: "mock-ref" };
      },
    );

    await plugin.onload();

    // Timer should NOT be set yet
    expect(mockSetInterval).not.toHaveBeenCalled();
    expect(plugin.app.metadataCache.on).toHaveBeenCalledWith(
      "resolved",
      expect.any(Function),
    );

    // Simulate resolved event
    resolvedCallback!();

    expect(mockSetInterval).toHaveBeenCalledWith(
      expect.any(Function),
      30 * 60 * 1000,
    );
  });

  it("should not start auto-sync on load when autoSyncEnabled is false", async () => {
    const plugin = createPlugin({ autoSyncEnabled: false });
    (plugin.loadData as any).mockResolvedValue({ autoSyncEnabled: false });

    await plugin.onload();

    expect(mockSetInterval).not.toHaveBeenCalled();
    expect(plugin.app.metadataCache.on).not.toHaveBeenCalled();
  });
});

describe("triggerSync silent mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSyncBiji.mockResolvedValue(undefined);
    mockSetInterval.mockReturnValue(42);
  });

  it("should not create Notice for non-auth errors in silent mode", async () => {
    const plugin = createPlugin();
    mockSyncBiji.mockRejectedValueOnce(new Error("Network error"));

    await plugin.triggerSync({ silent: true });

    // Notice should NOT be called with the sync failure message
    const noticeCalls = MockNotice.mock.calls.map((c: any[]) => c[0]);
    expect(noticeCalls).not.toContain("Sync failed, check console for details");
    // Also should not create "Syncing..." notice
    expect(noticeCalls).not.toContain("Syncing Get笔记...");
  });

  it("should create Notice AND stop auto-sync for AuthFatalError in silent mode", async () => {
    const plugin = createPlugin({ autoSyncEnabled: true });
    (plugin as any).startAutoSync();

    mockSyncBiji.mockRejectedValueOnce(
      new MockAuthFatalError("Token expired"),
    );

    await plugin.triggerSync({ silent: true });

    // Auth error Notice should still be shown
    const noticeCalls = MockNotice.mock.calls.map((c: any[]) => c[0]);
    expect(noticeCalls).toContain(
      "Authentication failed, please update refresh token in settings",
    );

    // Auto-sync should be stopped
    expect(mockClearInterval).toHaveBeenCalled();
  });

  it("should return silently when syncing=true and silent=true (no Notice)", async () => {
    const plugin = createPlugin();
    // Simulate an in-progress sync by triggering and not awaiting
    let resolveSyncPromise: () => void;
    mockSyncBiji.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSyncPromise = resolve;
        }),
    );

    // Start first sync (non-silent)
    const firstSync = plugin.triggerSync();

    // Try silent sync while first is in progress
    await plugin.triggerSync({ silent: true });

    // Should NOT create "Sync already in progress" Notice
    const noticeCalls = MockNotice.mock.calls.map((c: any[]) => c[0]);
    expect(noticeCalls).not.toContain("Sync already in progress");

    // Cleanup: resolve the pending sync
    resolveSyncPromise!();
    await firstSync;
  });

  it("should show Notice when syncing=true and not silent", async () => {
    const plugin = createPlugin();
    let resolveSyncPromise: () => void;
    mockSyncBiji.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSyncPromise = resolve;
        }),
    );

    const firstSync = plugin.triggerSync();
    await plugin.triggerSync(); // non-silent duplicate

    const noticeCalls = MockNotice.mock.calls.map((c: any[]) => c[0]);
    expect(noticeCalls).toContain("Sync already in progress");

    resolveSyncPromise!();
    await firstSync;
  });

  it("should not create start Notice in silent mode for successful sync", async () => {
    const plugin = createPlugin();
    mockSyncBiji.mockResolvedValueOnce(undefined);

    await plugin.triggerSync({ silent: true });

    const noticeCalls = MockNotice.mock.calls.map((c: any[]) => c[0]);
    expect(noticeCalls).not.toContain("Syncing Get笔记...");
  });
});

describe("onunload stops auto-sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetInterval.mockReturnValue(42);
  });

  it("should clear auto-sync interval on unload", () => {
    const plugin = createPlugin({ autoSyncEnabled: true });
    (plugin as any).startAutoSync();

    plugin.onunload();

    expect(mockClearInterval).toHaveBeenCalledWith(42);
  });
});
