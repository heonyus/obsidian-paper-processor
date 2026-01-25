import { App, TFile, TFolder, FuzzySuggestModal, SuggestModal } from "obsidian";

/**
 * Modal for picking a PDF file
 */
export class PDFPickerModal extends FuzzySuggestModal<TFile> {
  private onChoose: (file: TFile) => void;

  constructor(app: App, onChoose: (file: TFile) => void) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder("Search for a PDF file...");
  }

  getItems(): TFile[] {
    return this.app.vault.getFiles().filter((file) => file.extension === "pdf");
  }

  getItemText(item: TFile): string {
    return item.path;
  }

  onChooseItem(item: TFile): void {
    this.onChoose(item);
  }
}

/**
 * Modal for picking a paper folder (containing original.md or translated.md)
 */
export class PaperFolderPickerModal extends SuggestModal<string> {
  private onChoose: (folder: string) => void;
  private paperFolders: string[] = [];

  constructor(app: App, outputFolder: string, onChoose: (folder: string) => void) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder("Search for a paper folder...");
    this.paperFolders = this.findPaperFolders(outputFolder);
  }

  private findPaperFolders(basePath: string): string[] {
    const folders: string[] = [];
    const baseFolder = this.app.vault.getAbstractFileByPath(basePath);

    if (baseFolder instanceof TFolder) {
      for (const child of baseFolder.children) {
        if (child instanceof TFolder) {
          // Check if folder contains paper files
          const hasOriginal = this.app.vault.getAbstractFileByPath(`${child.path}/original.md`);
          const hasTranslated = this.app.vault.getAbstractFileByPath(`${child.path}/translated.md`);
          const hasTranslatedRaw = this.app.vault.getAbstractFileByPath(`${child.path}/translated_raw.md`);

          if (hasOriginal || hasTranslated || hasTranslatedRaw) {
            folders.push(child.path);
          }
        }
      }
    }

    return folders;
  }

  getSuggestions(query: string): string[] {
    const lowerQuery = query.toLowerCase();
    return this.paperFolders.filter((folder) => folder.toLowerCase().includes(lowerQuery));
  }

  renderSuggestion(folder: string, el: HTMLElement): void {
    const folderName = folder.split("/").pop() || folder;
    el.createEl("div", { text: folderName, cls: "suggestion-title" });
    el.createEl("small", { text: folder, cls: "suggestion-note" });
  }

  onChooseSuggestion(folder: string): void {
    this.onChoose(folder);
  }
}

/**
 * Modal for picking a markdown file for translation
 */
export class MarkdownPickerModal extends FuzzySuggestModal<TFile> {
  private onChoose: (file: TFile) => void;
  private basePath: string;

  constructor(app: App, basePath: string, onChoose: (file: TFile) => void) {
    super(app);
    this.onChoose = onChoose;
    this.basePath = basePath;
    this.setPlaceholder("Search for a Markdown file to translate...");
  }

  getItems(): TFile[] {
    return this.app.vault.getFiles().filter((file) => {
      if (file.extension !== "md") return false;
      // Prioritize files in papers folder
      if (this.basePath && file.path.startsWith(this.basePath)) return true;
      // Include all markdown files
      return true;
    });
  }

  getItemText(item: TFile): string {
    return item.path;
  }

  onChooseItem(item: TFile): void {
    this.onChoose(item);
  }
}
