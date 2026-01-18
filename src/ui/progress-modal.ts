import { App, Modal } from "obsidian";

/**
 * Modal for showing processing progress
 */
export class ProgressModal extends Modal {
  private headerEl: HTMLElement;
  private messageEl: HTMLElement;
  private progressBarEl: HTMLElement;
  private progressFillEl: HTMLElement;
  private logEl: HTMLElement;

  constructor(app: App, title: string) {
    super(app);
    this.headerEl = this.contentEl.createEl("h2", { text: title });
    this.messageEl = this.contentEl.createEl("p", { text: "Initializing...", cls: "progress-message" });

    const progressContainer = this.contentEl.createDiv({ cls: "progress-container" });
    this.progressBarEl = progressContainer.createDiv({ cls: "progress-bar" });
    this.progressFillEl = this.progressBarEl.createDiv({ cls: "progress-fill" });

    this.logEl = this.contentEl.createDiv({ cls: "progress-log" });
  }

  setProgress(percent: number, message: string): void {
    this.progressFillEl.style.width = `${percent}%`;
    this.messageEl.setText(message);
    this.addLog(message);
  }

  addLog(message: string): void {
    const logItem = this.logEl.createDiv({ cls: "log-item" });
    logItem.setText(`[${new Date().toLocaleTimeString()}] ${message}`);
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  updateTitle(title: string): void {
    this.headerEl.setText(title);
  }

  complete(message: string): void {
    this.setProgress(100, message);
    this.messageEl.addClass("complete");

    // Add close button
    const closeBtn = this.contentEl.createEl("button", { text: "Close", cls: "mod-cta" });
    closeBtn.addEventListener("click", () => this.close());
  }

  error(message: string): void {
    this.messageEl.setText(`Error: ${message}`);
    this.messageEl.addClass("error");

    const closeBtn = this.contentEl.createEl("button", { text: "Close" });
    closeBtn.addEventListener("click", () => this.close());
  }
}

/**
 * Simple confirmation modal
 */
export class ConfirmModal extends Modal {
  private result: boolean = false;
  private resolvePromise: ((value: boolean) => void) | null = null;

  constructor(app: App, title: string, message: string) {
    super(app);

    this.contentEl.createEl("h2", { text: title });
    this.contentEl.createEl("p", { text: message });

    const buttonContainer = this.contentEl.createDiv({ cls: "modal-button-container" });

    const cancelBtn = buttonContainer.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => {
      this.result = false;
      this.close();
    });

    const confirmBtn = buttonContainer.createEl("button", { text: "Confirm", cls: "mod-cta" });
    confirmBtn.addEventListener("click", () => {
      this.result = true;
      this.close();
    });
  }

  async waitForResult(): Promise<boolean> {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      this.open();
    });
  }

  onClose(): void {
    if (this.resolvePromise) {
      this.resolvePromise(this.result);
    }
  }
}
