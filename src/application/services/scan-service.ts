import type { DiskUsagePort } from '../ports/disk-usage.port';
import type { FileSystemPort } from '../ports/file-system.port';
import { SCAN_CATEGORY } from '../../domain/scan-category';
import type { ScanCategory } from '../../domain/scan-category';
import type { RiskLevel, ScanItem, ScanReport, ScanTarget } from '../../domain/scan-item';
import { getLogger } from '../../utils/get-logger';

const DEFAULT_CONCURRENCY = 5;

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

  public constructor(
    private readonly fileSystem: FileSystemPort,
    private readonly diskUsage: DiskUsagePort,
  ) { }

  public async scan(targets: ScanTarget[], concurrency = DEFAULT_CONCURRENCY): Promise<ScanReport> {
    this.logger.info(
      `Scan started: targets=${targets.length}, concurrency=${concurrency}`,
    );
    const availableTargets = await this.filterExistingTargets(targets);
    this.logger.info(`Targets available for scan: targets=${availableTargets.length}`);
    const items: ScanItem[] = [];
    const skipped: ScanReport['skipped'] = [];

    for (const target of availableTargets) {
      this.logger.info(
        `Scanning target: category=${target.category}, path=${target.path}`,
      );
      const entries = await this.fileSystem.listEntries(target.path);
      this.logger.debug(
        `Target entries loaded: path=${target.path}, entries=${entries.length}`,
      );
      const tasks = entries.map((entry, index) => async () => {
        try {
          if (index % 250 === 0) {
            this.logger.debug(
              `Scanning entry: path=${target.path}, entry=${entry.path}, index=${index}, total=${entries.length}`,
            );
          }
          const sizeKb = await this.diskUsage.getSizeInKb(entry.path);
          const stats = await this.fileSystem.stat(entry.path);
          const riskLevel = categoryRisk[target.category] ?? 'medium';
          items.push({
            name: entry.name,
            path: entry.path,
            category: target.category,
            sizeKb,
            sizeBytes: sizeKb * 1024,
            modifiedAt: stats.modifiedAt.toISOString(),
            type: entry.type,
            riskLevel,
          });
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
      this.logger.info(
        `Target scan complete: path=${target.path}, items=${entries.length}, skipped=${skipped.length}`,
      );
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

  private sumByCategory(items: ScanItem[]): Record<ScanCategory, number> {
    const totals = Object.fromEntries(
      Object.keys(categoryRisk).map((category) => [category, 0]),
    ) as Record<ScanCategory, number>;

    for (const item of items) {
      totals[item.category] = (totals[item.category] ?? 0) + item.sizeBytes;
    }

    return totals;
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
