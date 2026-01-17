import path from 'node:path';

import type { DiskUsagePort } from '../ports/disk-usage.port';
import type { FileSystemPort } from '../ports/file-system.port';
import type { AppDetectionPort } from '../ports/app-detection.port';
import { SCAN_CATEGORY } from '../../domain/scan-category';
import type { ScanCategory } from '../../domain/scan-category';
import type { RiskLevel, ScanItem, ScanReport, ScanTarget } from '../../domain/scan-item';
import {
  calculateDepth,
  isLeafCacheDirectory,
  isSafeToDelete,
} from '../../domain/deletability-rules';
import { getLogger } from '../../utils/get-logger';
import { parseSizeThreshold } from '../../utils/parse-size-threshold';
import { AppMatcher } from './app-matcher';
import type { TUIProgress } from '../../utils/tui-progress';

const DEFAULT_CONCURRENCY = 5;
const DEFAULT_SIZE_THRESHOLD_BYTES = 10 * 1024 * 1024; // 100MB default

export const categoryRisk: Record<ScanCategory, RiskLevel> = {
  [SCAN_CATEGORY.APP_SUPPORT]: 'medium',
  [SCAN_CATEGORY.CACHES]: 'low',
  [SCAN_CATEGORY.PREFERENCES]: 'high',
  [SCAN_CATEGORY.SAVED_APP_STATE]: 'low',
  [SCAN_CATEGORY.CONTAINERS]: 'medium',
  [SCAN_CATEGORY.GROUP_CONTAINERS]: 'medium',
  [SCAN_CATEGORY.LAUNCH_ITEMS]: 'high',
  [SCAN_CATEGORY.SYSTEM]: 'critical',
};

export class ScanService {
  private readonly logger = getLogger();
  private readonly sizeThresholdBytes: number;
  private appMatcher: AppMatcher | null = null;
  private progress: TUIProgress | null = null;

  public constructor(
    private readonly fileSystem: FileSystemPort,
    private readonly diskUsage: DiskUsagePort,
    private readonly appDetection?: AppDetectionPort,
    progress?: TUIProgress,
  ) {
    // Parse size threshold from environment, default to 100MB
    const envThreshold = parseSizeThreshold();
    this.sizeThresholdBytes = envThreshold ?? DEFAULT_SIZE_THRESHOLD_BYTES;

    if (envThreshold) {
      this.logger.info(
        `Size threshold set: ${(envThreshold / (1024 * 1024)).toFixed(0)}MB (from SKIP_ITEMS_SMALLER_THAN)`,
      );
    } else {
      this.logger.debug(
        `Using default size threshold: ${(this.sizeThresholdBytes / (1024 * 1024)).toFixed(0)}MB`,
      );
    }

    this.progress = progress ?? null;
  }

  public async scan(targets: ScanTarget[], concurrency = DEFAULT_CONCURRENCY): Promise<ScanReport> {
    // Suppress logger during scan if progress is enabled
    const originalLoggerLevel = this.logger.level;
    if (this.progress) {
      this.logger.level = 'error'; // Only show errors
    }

    // Initialize app matcher if app detection is available
    if (this.appDetection) {
      if (this.progress) {
        this.progress.updateCurrent('Scanning installed applications...');
      }
      const installedApps = await this.appDetection.getInstalledApps();
      this.appMatcher = new AppMatcher(installedApps);
      if (this.progress) {
        this.progress.updateCurrent(`Found ${installedApps.length} installed applications. Starting scan...`);
      }
    }

    const availableTargets = await this.filterExistingTargets(targets);
    const items: ScanItem[] = [];
    const skipped: ScanReport['skipped'] = [];

    for (const target of availableTargets) {
      if (this.progress) {
        this.progress.updateCurrent(target.path);
      }
      await this.scanTargetRecursive(target, items, skipped, concurrency, target.path, 0);
    }

    // Restore logger level
    if (this.progress) {
      this.logger.level = originalLoggerLevel;
    }

    const report: ScanReport = {
      generatedAt: new Date().toISOString(),
      targets: availableTargets,
      items,
      totalsByCategory: this.sumByCategory(items),
      skipped,
    };
    this.logger.info(
      `Scan finished: targets=${availableTargets.length}, items=${items.length}, skipped=${skipped.length}`,
    );
    return report;
  }

  private async filterExistingTargets(targets: ScanTarget[]): Promise<ScanTarget[]> {
    const existing: ScanTarget[] = [];
    for (const target of targets) {
      if (await this.fileSystem.exists(target.path)) {
        existing.push(target);
      } else {
        this.logger.debug(`Target missing: path=${target.path}`);
      }
    }
    return existing;
  }

  private async scanTargetRecursive(
    target: ScanTarget,
    items: ScanItem[],
    skipped: ScanReport['skipped'],
    concurrency: number,
    basePath: string,
    currentDepth: number,
  ): Promise<void> {
    // Limit recursion depth for performance and safety
    if (currentDepth > 4) {
      return;
    }

    const entries = await this.fileSystem.listEntries(basePath);

    // Update progress (only for top-level folders to avoid too many updates)
    if (this.progress && currentDepth <= 1) {
      const relativePath = basePath.replace(target.path, '').slice(1) || path.basename(basePath);
      this.progress.updateCurrent(relativePath, undefined, undefined, entries.length);
    }

    const tasks = entries.map((entry, index) => async () => {
      try {
        if (index % 250 === 0) {
          this.logger.debug(
            `Scanning entry: path=${basePath}, entry=${entry.path}, index=${index}, total=${entries.length}`,
          );
        }

        // Only scan directories, skip individual files at this level
        // Files will be included when we scan their parent directory as a unit
        if (entry.type !== 'directory') {
          return;
        }

        // Check folder size first - if it's below threshold, skip it entirely (don't scan inside)
        const sizeKb = await this.diskUsage.getSizeInKb(entry.path);
        const sizeBytes = sizeKb * 1024;

        // Skip folders smaller than the threshold (don't scan inside)
        if (sizeBytes < this.sizeThresholdBytes) {
          if (this.progress && currentDepth <= 1) {
            this.progress.addProcessed(
              entry.name,
              this.formatBytes(sizeBytes),
              sizeBytes,
              'skipped',
            );
          }
          return;
        }

        // Folder is >= threshold, so include it and scan inside
        const stats = await this.fileSystem.stat(entry.path);
        const riskLevel = categoryRisk[target.category] ?? 'medium';
        const depth = calculateDepth(entry.path, target.path);
        let safeToDelete = isSafeToDelete(entry.path, entry.name, target.category, depth);

        // Check if app is installed (for Application Support folders)
        let appInstalled: boolean | undefined;
        let matchedAppName: string | undefined;

        if (
          this.appMatcher &&
          target.category === SCAN_CATEGORY.APP_SUPPORT
        ) {
          const match = this.appMatcher.match(entry.name);
          appInstalled = match.isInstalled;
          matchedAppName = match.matchedApp?.name;

          // If app is not installed (orphaned), mark as safer to delete
          // This overrides the normal safeToDelete logic for orphaned app folders
          if (!match.isInstalled && !safeToDelete) {
            // Mark orphaned app folders as safe to delete (they're from uninstalled apps)
            // But still respect unsafe patterns (like preferences, data, etc.)
            const hasUnsafePattern = /[Pp]reference[s]?|[Dd]ata$|[Uu]ser\s*[Dd]ata/.test(entry.path);
            if (!hasUnsafePattern) {
              safeToDelete = true;
            }
          }
        }

        items.push({
          name: entry.name,
          path: entry.path,
          category: target.category,
          sizeKb,
          sizeBytes,
          modifiedAt: stats.modifiedAt.toISOString(),
          type: entry.type,
          riskLevel,
          safeToDelete,
          parentTargetPath: target.path,
          appInstalled,
          matchedAppName,
        });

        // Update progress for added items
        if (this.progress && currentDepth <= 1) {
          this.progress.addProcessed(
            entry.name,
            this.formatBytes(sizeBytes),
            sizeBytes,
            'added',
          );
        }

        // Recursively scan directories only if:
        // 1. It's a directory (already checked above)
        // 2. We haven't exceeded depth limit
        // 3. It's not a leaf cache directory (cache/history/log dirs should be treated as single units)
        // 4. It's in a category that allows recursion
        // Note: We only recurse into folders that are >= threshold (already checked above)
        const isLeafCache = isLeafCacheDirectory(entry.path, entry.name);
        // Increase depth limit for Application Support to reach nested cache folders
        const maxDepth = target.category === SCAN_CATEGORY.APP_SUPPORT ? 4 : 3;
        const shouldRecurse =
          currentDepth < maxDepth &&
          !isLeafCache &&
          (target.category === SCAN_CATEGORY.APP_SUPPORT ||
            target.category === SCAN_CATEGORY.CONTAINERS ||
            target.category === SCAN_CATEGORY.GROUP_CONTAINERS ||
            target.category === SCAN_CATEGORY.CACHES);

        if (shouldRecurse) {
          await this.scanTargetRecursive(
            target,
            items,
            skipped,
            concurrency,
            entry.path,
            currentDepth + 1,
          );
        } else if (isLeafCache) {
          this.logger.debug(
            `Skipping deep scan of leaf cache directory: path=${entry.path}`,
          );
        }
      } catch (error) {
        skipped.push({
          path: entry.path,
          reason: error instanceof Error ? error.message : 'Unknown error',
        });
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.debug(`Skipped entry: path=${entry.path}, error=${errorMessage}`);
      }
    });

    await runWithConcurrency(tasks, concurrency);
  }

  private sumByCategory(items: ScanItem[]): Record<ScanCategory, number> {
    const totals = Object.fromEntries(
      Object.keys(categoryRisk).map((category) => [category, 0]),
    ) as Record<ScanCategory, number>;

    for (const item of items) {
      totals[item.category] = (totals[item.category] ?? 0) + item.sizeBytes;
    }

    return totals;
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`;
  }
}

const runWithConcurrency = async <T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> => {
  const results: T[] = [];
  let index = 0;

  const workers = new Array(Math.min(concurrency, tasks.length)).fill(null).map(async () => {
    while (index < tasks.length) {
      const current = index;
      index += 1;
      const task = tasks[current];
      if (!task) {
        break;
      }
      results[current] = await task();
    }
  });

  await Promise.all(workers);
  return results;
};
