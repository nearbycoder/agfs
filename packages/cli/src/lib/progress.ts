import readline from "node:readline";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return "<1s";
  }
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m${remainingSeconds}s`;
}

function trimLabel(label: string, maxLength = 26): string {
  if (label.length <= maxLength) {
    return label;
  }

  return `${label.slice(0, maxLength - 1)}…`;
}

export class TransferProgress {
  private current = 0;
  private readonly startedAt = Date.now();
  private lastRenderAt = 0;
  private readonly isInteractive = Boolean(process.stderr.isTTY);

  constructor(
    private readonly label: string,
    private readonly totalBytes: number,
  ) {}

  update(currentBytes: number) {
    this.current = currentBytes;
    const now = Date.now();
    if (now - this.lastRenderAt < 50 && currentBytes < this.totalBytes) {
      return;
    }

    this.lastRenderAt = now;
    this.render();
  }

  complete() {
    if (this.totalBytes > 0) {
      this.current = this.totalBytes;
    }
    this.render(true);
  }

  fail() {
    if (this.isInteractive) {
      process.stderr.write("\n");
    }
  }

  private render(done = false) {
    const elapsed = Math.max(Date.now() - this.startedAt, 1);
    const rate = this.current / (elapsed / 1000);
    const width = 20;
    const hasTotal = this.totalBytes > 0;
    const ratio = hasTotal ? Math.min(this.current / this.totalBytes, 1) : 0;
    const percent = Math.round(ratio * 100);
    const filled = Math.round(ratio * width);
    const bar = hasTotal
      ? `${"=".repeat(Math.max(0, filled - 1))}${filled > 0 ? ">" : ""}${" ".repeat(width - filled)}`
      : `${"=".repeat(((Math.floor(elapsed / 120) % width) + 1)).padEnd(width, " ")}`;
    const etaMs = rate > 0 && hasTotal ? ((this.totalBytes - this.current) / rate) * 1000 : 0;
    const detail = hasTotal
      ? `${String(percent).padStart(3)}% ${formatBytes(this.current)}/${formatBytes(this.totalBytes)} ${formatBytes(
          Math.round(rate),
        )}/s${done ? "" : ` ETA ${formatDuration(etaMs)}`}`
      : `${formatBytes(this.current)} transferred ${formatBytes(Math.round(rate))}/s`;
    const line = `${trimLabel(this.label).padEnd(27)} [${bar}] ${detail}`;

    if (this.isInteractive) {
      readline.cursorTo(process.stderr, 0);
      process.stderr.write(line);
      readline.clearLine(process.stderr, 1);
      if (done) {
        process.stderr.write("\n");
      }
      return;
    }

    if (done) {
      process.stderr.write(`${line}\n`);
    }
  }
}

export function summarizeFolderDownload(fileCount: number, destination: string) {
  const noun = fileCount === 1 ? "file" : "files";
  return `Downloaded ${fileCount} ${noun} into ${destination}`;
}
