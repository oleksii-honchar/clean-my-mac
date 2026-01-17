import type { ScanReport } from './scan-item';

export type ScanCacheEntry = {
  report: ScanReport;
  scannedAt: string;
  targets: string[];
  totalSize: number;
  deletableSize: number;
  deletableCount: number;
};

export type ScanCache = {
  entries: ScanCacheEntry[];
  lastUpdated: string;
};
