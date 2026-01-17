import path from 'node:path';
import os from 'node:os';

import { checkbox } from '@inquirer/prompts';

import { ScanService, categoryRisk } from './application/services/scan-service';
import type { ScanItem, ScanReport, ScanTarget } from './domain/scan-item';
import { SCAN_CATEGORY } from './domain/scan-category';
import { defaultTargets } from './domain/default-targets';
import { DuDiskUsage } from './infrastructure/du-disk-usage';
import { NodeFileSystem } from './infrastructure/node-file-system';
import { ProcessRunner } from './infrastructure/process-runner';
import { getLogger } from './utils/get-logger';

type ParsedArgs = {
  command: string | null;
  outputPath: string | null;
  targets: string[];
  positional: string[];
  useSudo: boolean;
};

const logger = getLogger();

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.command || args.command === 'help' || args.command === '--help') {
    printHelp();
    return;
  }

  if (args.command === 'ncdu') {
    await runNcdu(args.positional[0]);
    return;
  }

  if (args.command === 'scan') {
    await runScan(args);
    return;
  }

  logger.error({ command: args.command }, 'Unknown command');
  printHelp();
};

const runNcdu = async (target?: string) => {
  const processRunner = new ProcessRunner();
  const resolvedTarget = target ? resolveHome(target) : os.homedir();

  logger.info({ target: resolvedTarget }, 'Starting ncdu');
  try {
    await processRunner.run('ncdu', [resolvedTarget]);
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : error },
      'Failed to run ncdu. Make sure it is installed: brew install ncdu',
    );
  }
};

const runScan = async (args: ParsedArgs) => {
  const fileSystem = new NodeFileSystem();
  const diskUsage = new DuDiskUsage(args.useSudo);
  const scanService = new ScanService(fileSystem, diskUsage);

  if (args.useSudo) {
    logger.info(
      'Using sudo for disk usage. If you see permission errors, grant Full Disk Access to your terminal.',
    );
  }

  const targets = await resolveTargets(args.targets);
  const report = await scanService.scan(targets);
  const outputPath =
    args.outputPath ??
    path.join(os.tmpdir(), 'clean-my-mac', 'scan-report.json');

  await fileSystem.ensureDirectory(path.dirname(outputPath));
  await fileSystem.writeFile(outputPath, JSON.stringify(report, null, 2));

  const totalBytes = report.items.reduce((sum, item) => sum + item.sizeBytes, 0);
  logger.info(
    {
      outputPath,
      targets: report.targets.length,
      items: report.items.length,
      totalBytes,
    },
    'Scan complete',
  );

  printScanSummary(report, outputPath);
};

const resolveTargets = async (requestedTargets: string[]): Promise<ScanTarget[]> => {
  if (requestedTargets.length === 0) {
    if (!process.stdin.isTTY) {
      return defaultTargets;
    }

    return promptForTargets(defaultTargets);
  }

  const knownTargets = new Map(
    defaultTargets.map((target) => [normalizePath(target.path), target]),
  );

  return requestedTargets.map((targetPath) => {
    const resolved = normalizePath(resolveHome(targetPath));
    const known = knownTargets.get(resolved);
    if (known) {
      return known;
    }

    return {
      path: resolved,
      category: resolved.startsWith('/Library')
        ? SCAN_CATEGORY.SYSTEM
        : SCAN_CATEGORY.APP_SUPPORT,
      isSystem: resolved.startsWith('/Library'),
    };
  });
};

const parseArgs = (args: string[]): ParsedArgs => {
  const [command, ...rest] = args;
  const parsed: ParsedArgs = {
    command: command ?? null,
    outputPath: null,
    targets: [],
    positional: [],
    useSudo: true,
  };

  let index = 0;
  while (index < rest.length) {
    const token = rest[index];
    if (!token) {
      index += 1;
      continue;
    }
    if (token === '--output' || token === '-o') {
      parsed.outputPath = rest[index + 1] ?? null;
      index += 2;
      continue;
    }
    if (token === '--sudo') {
      parsed.useSudo = true;
      index += 1;
      continue;
    }
    if (token === '--target' || token === '-t') {
      const targetPath = rest[index + 1];
      if (targetPath) {
        parsed.targets.push(targetPath);
      }
      index += 2;
      continue;
    }
    parsed.positional.push(token);
    index += 1;
  }

  return parsed;
};

const normalizePath = (targetPath: string) => path.resolve(targetPath);

const resolveHome = (targetPath: string) => {
  if (targetPath.startsWith('~')) {
    return path.join(os.homedir(), targetPath.slice(1));
  }
  return targetPath;
};

const printHelp = () => {
  const message = `
clean-my-mac

Usage:
  clean-my-mac scan [--output <path>] [--target <path>...] [--sudo]
  clean-my-mac ncdu [path]

Examples:
  clean-my-mac scan
  clean-my-mac scan --target ~/Library/Caches --target /Library/Caches
  clean-my-mac scan --sudo
  clean-my-mac ncdu ~/Library
`;

  process.stdout.write(message);
};

const promptForTargets = async (targets: ScanTarget[]): Promise<ScanTarget[]> => {
  const riskOrder: Record<string, number> = {
    low: 0,
    medium: 1,
    high: 2,
    critical: 3,
  };

  const sortedTargets = [...targets].sort((left, right) => {
    const leftRisk = categoryRisk[left.category] ?? 'medium';
    const rightRisk = categoryRisk[right.category] ?? 'medium';
    return (riskOrder[leftRisk] ?? 1) - (riskOrder[rightRisk] ?? 1);
  });

  const choices = sortedTargets.map((target) => {
    const riskLevel = categoryRisk[target.category] ?? 'medium';
    return {
      value: target.path,
      name: `[${riskLevel}] ${target.path}`,
      checked: true,
    };
  });

  const selected = (await checkbox({
    message: 'Select targets to scan',
    choices,
    pageSize: 12,
    loop: false,
  })) as string[];

  const lookup = new Map(targets.map((target) => [target.path, target]));
  return selected
    .map((targetPath) => lookup.get(targetPath))
    .filter((target): target is ScanTarget => !!target);
};

const printScanSummary = (report: ScanReport, outputPath: string) => {
  const totalSize = report.items.reduce((sum, item) => sum + item.sizeBytes, 0);
  const totalsEntries = Object.entries(report.totalsByCategory) as Array<[string, number]>;
  const totals = totalsEntries
    .sort(([, left], [, right]) => right - left)
    .map(([category, total]) => `  - ${category}: ${formatBytes(total)}`)
    .join('\n');

  // Group items by target path
  const itemsByTarget = new Map<string, ScanItem[]>();
  for (const item of report.items) {
    // Find which target this item belongs to
    const target = report.targets.find((t) => item.path.startsWith(t.path));
    if (target) {
      const existing = itemsByTarget.get(target.path) ?? [];
      existing.push(item);
      itemsByTarget.set(target.path, existing);
    }
  }

  // Build target sections with items and guidelines
  const targetSections = report.targets.map((target) => {
    const riskLevel = categoryRisk[target.category] ?? 'medium';
    const items = itemsByTarget.get(target.path) ?? [];
    const targetSize = items.reduce((sum, item) => sum + item.sizeBytes, 0);
    const topItems = [...items]
      .sort((left, right) => right.sizeBytes - left.sizeBytes)
      .slice(0, 5)
      .map((item) => `    - ${formatBytes(item.sizeBytes)} ${item.path}`)
      .join('\n');

    return `
[${riskLevel}] ${target.path}
  Items: ${items.length}, Size: ${formatBytes(targetSize)}
  ${target.guideline ? `Guideline: ${target.guideline}` : ''}
  ${topItems ? `Top items:\n${topItems}` : '  (no items)'}`;
  });

  const summary = `
Scan summary
Output: ${outputPath}
Total targets: ${report.targets.length}
Total items: ${report.items.length}
Total size: ${formatBytes(totalSize)}

Totals by category:
${totals || '  - (none)'}

${targetSections.join('\n')}
`;

  process.stdout.write(summary);
};

const formatBytes = (value: number) => {
  if (value <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / Math.pow(1024, index);
  return `${scaled.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
};

const run = async () => {
  try {
    await main();
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : error }, 'Fatal error');
    process.exitCode = 1;
  }
};

void run();
