// Minimal Obsidian mock for vitest

export class Notice {
  message: string;
  constructor(message: string) {
    this.message = message;
  }
}

export class TFile {
  path: string;
  name: string;
  basename: string;
  extension: string;
  constructor(path: string = "") {
    this.path = path;
    this.name = path.split("/").pop() ?? "";
    this.basename = this.name.replace(/\.[^.]+$/, "");
    this.extension = "md";
  }
}

export class TFolder {
  path: string;
  constructor(path: string = "") {
    this.path = path;
  }
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

export class Plugin {
  app: any;
  manifest: any;
  constructor() {
    this.app = {};
    this.manifest = {};
  }
  loadData() {
    return Promise.resolve(null);
  }
  saveData(_data: any) {
    return Promise.resolve();
  }
  addSettingTab(_tab: any) {}
  addRibbonIcon(_icon: string, _title: string, _callback: () => void) {}
  addCommand(_command: any) {}
}

export class PluginSettingTab {
  app: any;
  plugin: any;
  containerEl: any;
  constructor(app: any, plugin: any) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = { empty: () => {}, createEl: () => ({}) };
  }
  display() {}
}

export class Setting {
  constructor(_containerEl: any) {}
  setName(_name: string) {
    return this;
  }
  setDesc(_desc: string) {
    return this;
  }
  addText(_cb: (text: any) => void) {
    return this;
  }
  addButton(_cb: (button: any) => void) {
    return this;
  }
}

export function requestUrl(_params: any): Promise<any> {
  return Promise.resolve({ json: {}, text: "", headers: {}, status: 200 });
}

export type RequestUrlParam = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

export class App {
  vault: any;
  metadataCache: any;
}
