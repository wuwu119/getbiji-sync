// INPUT: obsidian (PluginSettingTab, Setting, Notice, App), main.ts (BijiSyncPlugin)
// OUTPUT: BijiSyncSettings interface, DEFAULT_SETTINGS, BijiSyncSettingTab
// POS: Configuration layer — defines plugin settings schema and settings UI

import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type BijiSyncPlugin from "./main";

export interface BijiSyncSettings {
  refreshToken: string;
  targetFolder: string;
  lastSyncId: string | null;
  lastSyncTime: number | null;
  autoSyncEnabled: boolean;
  autoSyncInterval: number;
}

export const DEFAULT_SETTINGS: BijiSyncSettings = {
  refreshToken: "",
  targetFolder: "Get笔记",
  lastSyncId: null,
  lastSyncTime: null,
  autoSyncEnabled: false,
  autoSyncInterval: 30,
};

export class BijiSyncSettingTab extends PluginSettingTab {
  plugin: BijiSyncPlugin;

  constructor(app: App, plugin: BijiSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Get笔记 sync settings").setHeading();

    // Refresh token input (password field)
    new Setting(containerEl)
      .setName("Refresh token")
      .setDesc(
        "浏览器打开 biji.com → F12 → Application → Local Storage → www.biji.com → refresh_token"
      )
      .addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.addClass("getbiji-token-input");
        text
          .setPlaceholder("Enter refresh token")
          .setValue(this.plugin.settings.refreshToken)
          .onChange(async (value) => {
            this.plugin.settings.refreshToken = value.trim();
            await this.plugin.saveSettings();
          });
      });

    // Target folder input
    new Setting(containerEl)
      .setName("Target folder")
      .setDesc("Folder where synced notes will be saved")
      .addText((text) =>
        text
          .setPlaceholder("Get笔记")
          .setValue(this.plugin.settings.targetFolder)
          .onChange(async (value) => {
            this.plugin.settings.targetFolder = value;
            await this.plugin.saveSettings();
          })
      );

    // Auto sync toggle
    new Setting(containerEl)
      .setName("Auto sync")
      .setDesc("Automatically sync at regular intervals")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoSyncEnabled)
          .onChange(async (value) => {
            this.plugin.settings.autoSyncEnabled = value;
            await this.plugin.saveSettings();
            this.plugin.onAutoSyncSettingsChanged();
            this.display(); // Re-render to update dropdown disabled state
          })
      );

    // Sync interval dropdown
    new Setting(containerEl)
      .setName("Sync interval")
      .setDesc("Minutes between automatic syncs")
      .addDropdown((dropdown) => {
        dropdown
          .addOptions({
            "5": "5 minutes",
            "15": "15 minutes",
            "30": "30 minutes",
            "60": "1 hour",
            "120": "2 hours",
          })
          .setValue(String(this.plugin.settings.autoSyncInterval))
          .setDisabled(!this.plugin.settings.autoSyncEnabled)
          .onChange(async (value) => {
            this.plugin.settings.autoSyncInterval = Number(value);
            await this.plugin.saveSettings();
            this.plugin.onAutoSyncSettingsChanged();
          });
      });

    // Last sync time (read-only display)
    const lastSyncTime = this.plugin.settings.lastSyncTime;
    const formattedTime = lastSyncTime
      ? new Date(lastSyncTime).toLocaleString()
      : "从未同步";

    new Setting(containerEl)
      .setName("Last sync time")
      .setDesc(formattedTime);

    // Reset sync state button
    new Setting(containerEl)
      .setName("Reset sync state")
      .setDesc("Clear sync cursor so next sync fetches all notes")
      .addButton((button) =>
        button.setButtonText("Reset").onClick(async () => {
          this.plugin.settings.lastSyncId = null;
          await this.plugin.saveSettings();
          new Notice(
            "Sync state reset, next sync will fetch all notes"
          );
          this.display(); // Refresh the settings pane
        })
      );
  }
}
