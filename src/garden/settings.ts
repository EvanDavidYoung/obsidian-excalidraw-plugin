import { App, Modal, Setting } from "obsidian";

/**
 * The garden's own settings, kept in garden.json beside the plugin's data.json
 * so the fork doesn't touch upstream's settings or settings tab.
 */
export type GardenSettings = {
  /** Where `pipeline categorize` serves the queue. */
  notesServer: string;
  /** The drawing the old garden canvas imports into, relative to the vault. */
  boardDrawing: string;
};

export const DEFAULT_SETTINGS: GardenSettings = {
  notesServer: "http://127.0.0.1:8642",
  boardDrawing: "Excalidraw/Garden.md",
};

export function withDefaults(saved: unknown): GardenSettings {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<GardenSettings>;
  return { ...DEFAULT_SETTINGS, ...s };
}

export class GardenSettingsModal extends Modal {
  constructor(app: App, private settings: GardenSettings, private save: (s: GardenSettings) => Promise<void>) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    const draft = { ...this.settings };
    contentEl.createEl("h3", { text: "Garden" });
    new Setting(contentEl)
      .setName("Notes server")
      .setDesc("Where `pipeline categorize` runs; the card queue comes from here.")
      .addText(t => t.setValue(draft.notesServer).onChange(v => (draft.notesServer = v.trim())));
    new Setting(contentEl)
      .setName("Board drawing")
      .setDesc("The drawing the old garden canvas imports into, relative to the vault.")
      .addText(t => t.setValue(draft.boardDrawing).onChange(v => (draft.boardDrawing = v.trim())));
    new Setting(contentEl).addButton(b =>
      b.setButtonText("Save").setCta().onClick(async () => {
        await this.save(draft);
        this.close();
      }));
  }

  onClose() {
    this.contentEl.empty();
  }
}
