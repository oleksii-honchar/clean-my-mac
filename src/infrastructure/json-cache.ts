import path from 'node:path';
import os from 'node:os';

import type { CachePort } from '../application/ports/cache.port';
import type { ScanCache, ScanCacheEntry } from '../domain/scan-cache';
import type { ScanReport } from '../domain/scan-item';
import type { FileSystemPort } from '../application/ports/file-system.port';

export class JsonCache implements CachePort {
  private readonly cachePath: string;

  public constructor(private readonly fileSystem: FileSystemPort) {
    this.cachePath = path.join(os.tmpdir(), 'clean-my-mac', 'scan-cache.json');
  }

  public async loadCache(): Promise<ScanCache | null> {
    try {
      if (!(await this.fileSystem.exists(this.cachePath))) {
        return null;
      }
      // Read file - we need to add readFile to FileSystemPort or use Node directly
      const { readFile } = await import('node:fs/promises');
      const content = await readFile(this.cachePath, 'utf8');
      return JSON.parse(content) as ScanCache;
    } catch {
      return null;
    }
  }

  public async saveCache(cache: ScanCache): Promise<void> {
    await this.fileSystem.ensureDirectory(path.dirname(this.cachePath));
    await this.fileSystem.writeFile(this.cachePath, JSON.stringify(cache, null, 2));
  }

  public async addEntry(report: ScanReport, targets: string[]): Promise<void> {
    const deletableItems = report.items.filter((item) => item.safeToDelete);
    const deletableSize = deletableItems.reduce((sum, item) => sum + item.sizeBytes, 0);
    const totalSize = report.items.reduce((sum, item) => sum + item.sizeBytes, 0);

    const entry: ScanCacheEntry = {
      report,
      scannedAt: report.generatedAt,
      targets,
      totalSize,
      deletableSize,
      deletableCount: deletableItems.length,
    };

    const cache = (await this.loadCache()) ?? { entries: [], lastUpdated: new Date().toISOString() };
    cache.entries.push(entry);
    cache.entries.sort((a, b) => new Date(b.scannedAt).getTime() - new Date(a.scannedAt).getTime());
    // Keep only last 10 entries
    if (cache.entries.length > 10) {
      cache.entries = cache.entries.slice(0, 10);
    }
    cache.lastUpdated = new Date().toISOString();

    await this.saveCache(cache);
  }

  public async getLatestEntry(): Promise<ScanCacheEntry | null> {
    const cache = await this.loadCache();
    if (!cache || cache.entries.length === 0) {
      return null;
    }
    return cache.entries[0] ?? null;
  }

  public async clearCache(): Promise<void> {
    if (await this.fileSystem.exists(this.cachePath)) {
      // Would need delete method on FileSystemPort, or use writeFile with empty
      await this.saveCache({ entries: [], lastUpdated: new Date().toISOString() });
    }
  }
}
