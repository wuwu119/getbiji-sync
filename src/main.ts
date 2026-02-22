// INPUT: obsidian (Plugin, Notice), settings.ts, auth.ts, sync.ts
// OUTPUT: BijiSyncPlugin (main plugin class)
// POS: Entry point — plugin lifecycle, settings integration, sync triggering, commands

import { Notice, Plugin } from "obsidian";
import {
  BijiSyncSettings,
  BijiSyncSettingTab,
  DEFAULT_SETTINGS,
} from "./settings";
import { checkTokenExpiration } from "./auth";
import { AuthFatalError } from "./api";
import { syncBiji } from "./sync";

export default class BijiSyncPlugin extends Plugin {
  settings: BijiSyncSettings = DEFAULT_SETTINGS;
  private syncing = false;
  private syncAbortController: AbortController | null = null;
  private autoSyncIntervalId: number | null = null;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new BijiSyncSettingTab(this.app, this));

    // Startup token expiration check
    const warning = checkTokenExpiration(this.settings.refreshToken);
    if (warning) {
      new Notice(warning);
    }

    // Ribbon icon for sync
    this.addRibbonIcon("download", "Sync Get笔记", async () => {
      await this.triggerSync();
    });

    // Command: sync now
    this.addCommand({
      id: "sync-biji-now",
      name: "Sync Get笔记",
      callback: async () => {
        await this.triggerSync();
      },
    });

    // Command: cancel sync
    this.addCommand({
      id: "cancel-biji-sync",
      name: "Cancel Get笔记 sync",
      callback: () => {
        if (this.syncAbortController) {
          this.syncAbortController.abort();
          new Notice("Cancelling sync...");
        } else {
          new Notice("No sync in progress");
        }
      },
    });

    // Auto-sync initialization: wait for MetadataCache readiness
    if (this.settings.autoSyncEnabled) {
      if ((this.app.metadataCache as any).resolved) {
        this.startAutoSync();
      } else {
        const resolvedRef = this.app.metadataCache.on('resolved', () => {
          this.startAutoSync();
          this.app.metadataCache.offref(resolvedRef);
        });
        this.registerEvent(resolvedRef);
      }
    }

    console.log("Biji Sync plugin loaded");
  }

  private startAutoSync() {
    this.stopAutoSync();
    const minutes = Math.max(this.settings.autoSyncInterval, 5);
    const ms = minutes * 60 * 1000;
    this.autoSyncIntervalId = window.setInterval(() => {
      this.triggerSync({ silent: true });
    }, ms);
    this.registerInterval(this.autoSyncIntervalId);
  }

  private stopAutoSync() {
    if (this.autoSyncIntervalId !== null) {
      window.clearInterval(this.autoSyncIntervalId);
      this.autoSyncIntervalId = null;
    }
  }

  onAutoSyncSettingsChanged() {
    if (this.settings.autoSyncEnabled) {
      this.startAutoSync();
    } else {
      this.stopAutoSync();
    }
  }

  onunload() {
    this.stopAutoSync();
    this.syncAbortController?.abort();
    console.log("Biji Sync plugin unloaded");
  }

  async triggerSync(options?: { silent?: boolean }) {
    if (this.syncing) {
      if (!options?.silent) {
        new Notice("Sync already in progress");
      }
      return;
    }
    this.syncing = true;
    this.syncAbortController = new AbortController();
    try {
      if (!options?.silent) {
        new Notice("Syncing Get笔记...");
      }
      await syncBiji(this, this.syncAbortController.signal, {
        silent: options?.silent,
      });
    } catch (err) {
      if (err instanceof AuthFatalError) {
        console.error("Auth failed:", err.message, err.cause);
        new Notice(
          "Authentication failed, please update refresh token in settings",
        );
        if (options?.silent) {
          this.stopAutoSync();
        }
      } else {
        console.error("Sync failed:", err);
        if (!options?.silent) {
          new Notice("Sync failed, check console for details");
        }
      }
    } finally {
      this.syncing = false;
      this.syncAbortController = null;
    }
  }

  async loadSettings() {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      await this.loadData(),
    );
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
