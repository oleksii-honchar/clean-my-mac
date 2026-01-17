export type ProcessedItemStats = {
  name: string;
  size: string;
  sizeBytes: number;
  status: 'added' | 'skipped';
};

/**
 * TUI Progress Display - Shows real-time progress on the same screen
 */
export class TUIProgress {
  private currentItem: {
    path: string;
    size?: string;
    sizeBytes?: number;
    entryCount?: number;
  } | null = null;
  private processedItems: ProcessedItemStats[] = [];
  private totalProcessed = 0;
  private totalSizeBytes = 0;

  /**
   * Update the current processing item
   */
  public updateCurrent(path: string, size?: string, sizeBytes?: number, entryCount?: number): void {
    this.currentItem = { path, size, sizeBytes, entryCount };
    this.render();
  }

  /**
   * Add a processed item to the list
   */
  public addProcessed(name: string, size: string, sizeBytes: number, status: 'added' | 'skipped'): void {
    this.processedItems.push({ name, size, sizeBytes, status });
    this.totalProcessed += 1;
    if (status === 'added') {
      this.totalSizeBytes += sizeBytes;
    }
    this.render();
  }

  /**
   * Clear the progress display
   */
  public clear(): void {
    process.stdout.write('\x1b[2J\x1b[H');
  }

  /**
   * Render the current state
   */
  private render(): void {
    // Move cursor to top-left and clear screen
    process.stdout.write('\x1b[H\x1b[2J');

    // Header
    process.stdout.write('╔═══════════════════════════════════════════════════════════╗\n');
    process.stdout.write('║           Clean My Mac - Scanning Progress                ║\n');
    process.stdout.write('╚═══════════════════════════════════════════════════════════╝\n\n');

    // Current item being processed
    process.stdout.write('📂 Current: ');
    if (this.currentItem) {
      let line = this.currentItem.path;
      if (this.currentItem.entryCount !== undefined) {
        line += ` (${this.currentItem.entryCount} entries)`;
      }
      if (this.currentItem.size) {
        line += ` - ${this.currentItem.size}`;
      }
      process.stdout.write(line);
    } else {
      process.stdout.write('Initializing...');
    }
    process.stdout.write('\n\n');

    // Statistics
    process.stdout.write('📊 Statistics:\n');
    process.stdout.write('  Total processed: ');
    process.stdout.write(String(this.totalProcessed));
    process.stdout.write(' items\n');
    process.stdout.write('  Total size: ');
    process.stdout.write(this.formatBytes(this.totalSizeBytes));
    process.stdout.write('\n');
    process.stdout.write('  Added: ');
    const addedCount = this.processedItems.filter((i) => i.status === 'added').length;
    process.stdout.write(String(addedCount));
    process.stdout.write(' items (');
    process.stdout.write(this.formatBytes(this.totalSizeBytes));
    process.stdout.write(')\n');
    process.stdout.write('  Skipped: ');
    const skippedCount = this.processedItems.filter((i) => i.status === 'skipped').length;
    process.stdout.write(String(skippedCount));
    process.stdout.write(' items\n');
    process.stdout.write('\n');

    // Processed items list (showing last 15, scrolling down)
    if (this.processedItems.length > 0) {
      process.stdout.write('📋 Processed Items:\n');
      process.stdout.write('───────────────────────────────────────────────────────────\n');

      // Show items in order (oldest first, newest at bottom) - last 15 items
      const startIndex = Math.max(0, this.processedItems.length - 15);
      const itemsToShow = this.processedItems.slice(startIndex);

      for (const item of itemsToShow) {
        const icon = item.status === 'added' ? '✓' : '⊘';
        const status = item.status === 'added' ? 'added' : 'skipped';
        process.stdout.write(`  ${icon} [${status}] ${item.name} (${item.size})\n`);
      }

      process.stdout.write('───────────────────────────────────────────────────────────\n');
    }

    // Flush output
    process.stdout.write('');
  }

  /**
   * Final render (keep the display after completion)
   */
  public finalize(): void {
    this.currentItem = null;
    this.render();
    process.stdout.write('\n✅ Scan complete!\n');
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`;
  }
}
