import type { ScanCache, ScanCacheEntry } from '../../domain/scan-cache';
import type { ScanReport } from '../../domain/scan-item';

export interface CachePort {
  loadCache(): Promise<ScanCache | null>;
  saveCache(cache: ScanCache): Promise<void>;
  addEntry(report: ScanReport, targets: string[]): Promise<void>;
  getLatestEntry(): Promise<ScanCacheEntry | null>;
  clearCache(): Promise<void>;
}
