import path from 'node:path';
import os from 'node:os';

import { checkbox, select } from '@inquirer/prompts';
import { buildTree, flattenTree, type FlatTreeNode } from './application/services/tree-navigation';

import { ScanService, categoryRisk } from './application/services/scan-service';
import type { ScanItem, ScanReport, ScanTarget } from './domain/scan-item';
import { SCAN_CATEGORY } from './domain/scan-category';
import { defaultTargets } from './domain/default-targets';
import { DuDiskUsage } from './infrastructure/du-disk-usage';
import { NodeFileSystem } from './infrastructure/node-file-system';
import { ProcessRunner } from './infrastructure/process-runner';
import { JsonCache } from './infrastructure/json-cache';
import { MacOSAppDetection } from './infrastructure/macos-app-detection';
import { getLogger } from './utils/get-logger';
import { TUIProgress } from './utils/tui-progress';

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

  // Clear terminal screen at startup for clean UI
  if (process.stdout.isTTY) {
    process.stdout.write('\x1b[2J\x1b[H');
  }

  // Always prompt for operation first if in TTY (unless help requested)
  if (process.stdin.isTTY && (!args.command || args.command === 'help' || args.command === '--help')) {
    if (args.command === 'help' || args.command === '--help') {
      printHelp();
      return;
    }

    const operation = await select({
      message: 'What would you like to do?',
      choices: [
        { name: 'Scan - Analyze disk usage and find deletable items', value: 'scan' },
        { name: 'Explore - Browse cached scan results', value: 'explore' },
        { name: 'ncdu - Interactive disk usage analyzer', value: 'ncdu' },
        { name: 'Help - Show usage information', value: 'help' },
      ],
    });

    // Clear terminal and ensure clean state before next prompt
    if (process.stdout.isTTY) {
      // Clear screen and move cursor to top
      process.stdout.write('\x1b[2J\x1b[H');
    }
    // Small delay to ensure terminal state is clean after select prompt
    await new Promise((resolve) => setTimeout(resolve, 100));

    if (operation === 'scan') {
      await runScan(args);
    } else if (operation === 'explore') {
      await runExplore();
    } else if (operation === 'ncdu') {
      await runNcdu();
    } else if (operation === 'help') {
      printHelp();
    }
    return;
  }

  // Non-interactive mode: use command from args
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

  if (args.command === 'explore') {
    await runExplore();
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
  const appDetection = new MacOSAppDetection(fileSystem);
  const progress = new TUIProgress();
  progress.clear();
  const scanService = new ScanService(fileSystem, diskUsage, appDetection, progress);
  const cache = new JsonCache(fileSystem);

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

  // Save to cache
  const targetPaths = targets.map((t) => t.path);
  await cache.addEntry(report, targetPaths);

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

  progress.finalize();
  printScanSummary(report, outputPath);
};

const runExplore = async () => {
  const fileSystem = new NodeFileSystem();
  const cache = new JsonCache(fileSystem);

  const latestEntry = await cache.getLatestEntry();
  if (!latestEntry) {
    logger.info('No cached scan results found. Run a scan first.');
    return;
  }

  await navigateResults(latestEntry.report);
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
  clean-my-mac [scan|explore|ncdu] [options]
  
  If no command is specified and running in TTY, you'll be prompted to choose.

Commands:
  scan     - Analyze disk usage and find deletable items (saves to cache)
  explore  - Browse cached scan results and select items for deletion
  ncdu     - Interactive disk usage analyzer

Scan options:
  --output, -o <path>    Output path for scan report JSON
  --target, -t <path>    Specific target path to scan (can be used multiple times)
  --sudo                 Use sudo for disk usage (default: true)

Examples:
  clean-my-mac                    # Interactive mode - choose operation
  clean-my-mac scan                # Run new scan
  clean-my-mac explore             # Browse cached results
  clean-my-mac scan --target ~/Library/Caches
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

  // Temporarily disable logger completely to prevent stdout interference
  const originalLevel = logger.level;
  logger.level = 'silent'; // Completely silence logger during prompt

  // Ensure stdout is flushed and ready
  if (process.stdout.isTTY) {
    process.stdout.write('');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const selected = (await checkbox({
    message: 'Select targets to scan',
    choices,
    pageSize: 12,
    loop: false,
    required: true, // Require at least one selection
  })) as string[];

  // Restore logger level
  logger.level = originalLevel;

  if (selected.length === 0) {
    logger.warn('No targets selected. Using all default targets.');
    return targets;
  }

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
    const deletableItems = items.filter((item) => item.safeToDelete);
    const deletableSize = deletableItems.reduce((sum, item) => sum + item.sizeBytes, 0);

    // Group deletable items by app folder (parent directory)
    const deletableByApp = new Map<string, ScanItem[]>();
    for (const item of deletableItems) {
      // Extract app folder name (e.g., BraveSoftware, Cursor, etc.)
      // For Application Support: ~/Library/Application Support/BraveSoftware/... -> BraveSoftware
      const pathParts = item.path.slice(target.path.length + 1).split('/');
      const appFolder = pathParts[0] ?? 'Unknown';
      const existing = deletableByApp.get(appFolder) ?? [];
      existing.push(item);
      deletableByApp.set(appFolder, existing);
    }

    // Build deletable items section grouped by app
    const deletableSections = Array.from(deletableByApp.entries())
      .sort(([, left], [, right]) => {
        const leftSize = left.reduce((sum, item) => sum + item.sizeBytes, 0);
        const rightSize = right.reduce((sum, item) => sum + item.sizeBytes, 0);
        return rightSize - leftSize;
      })
      .map(([appFolder, appItems]) => {
        const appSize = appItems.reduce((sum, item) => sum + item.sizeBytes, 0);
        // Check if app is installed (use first item's status as they should all be the same)
        const firstItem = appItems[0];
        const isInstalled = firstItem?.appInstalled ?? false;
        const matchedAppName = firstItem?.matchedAppName;
        const isOrphaned = !isInstalled;

        // Highlight orphaned folders more prominently
        const statusLabel = isInstalled
          ? `[INSTALLED${matchedAppName ? `: ${matchedAppName}` : ''}]`
          : '⚠️  [ORPHANED - App not found - Safe to delete]';

        const sortedItems = [...appItems]
          .sort((left, right) => right.sizeBytes - left.sizeBytes)
          .slice(0, 10)
          .map((item) => `      - ${formatBytes(item.sizeBytes)} ${item.path}`)
          .join('\n');

        // Sort orphaned folders first, then by size
        return {
          appFolder,
          statusLabel,
          appSize,
          sortedItems,
          isOrphaned,
        };
      })
      .sort((left, right) => {
        // Sort orphaned first, then by size
        if (left.isOrphaned && !right.isOrphaned) return -1;
        if (!left.isOrphaned && right.isOrphaned) return 1;
        return right.appSize - left.appSize;
      })
      .map(({ appFolder, statusLabel, appSize, sortedItems }) => {
        return `    ${appFolder} ${statusLabel} (${formatBytes(appSize)} deletable):
${sortedItems}`;
      })
      .join('\n\n');

    const topItems = [...items]
      .sort((left, right) => right.sizeBytes - left.sizeBytes)
      .slice(0, 5)
      .map((item) => `    - ${formatBytes(item.sizeBytes)} ${item.path}`)
      .join('\n');

    return `
[${riskLevel}] ${target.path}
  Items: ${items.length}, Size: ${formatBytes(targetSize)}
  Safe to delete: ${deletableItems.length} items, ${formatBytes(deletableSize)}
  ${target.guideline ? `Guideline: ${target.guideline}` : ''}
  ${deletableSections ? `Deletable targets:\n${deletableSections}` : ''}
  ${topItems ? `Top items (all):\n${topItems}` : '  (no items)'}`;
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

const navigateResults = async (report: ScanReport) => {
  const deletableItems = report.items.filter((item) => item.safeToDelete);

  if (deletableItems.length === 0) {
    logger.info('No deletable items found in cached results.');
    return;
  }

  // Group items by target
  const itemsByTarget = new Map<string, ScanItem[]>();
  for (const item of deletableItems) {
    const target = report.targets.find((t) => item.path.startsWith(t.path));
    if (!target) continue;
    const existing = itemsByTarget.get(target.path) ?? [];
    existing.push(item);
    itemsByTarget.set(target.path, existing);
  }

  // Let user select target first
  const targetChoices = Array.from(itemsByTarget.entries()).map(([targetPath, items]) => {
    const target = report.targets.find((t) => t.path === targetPath);
    const riskLevel = target ? categoryRisk[target.category] ?? 'medium' : 'medium';
    const totalSize = items.reduce((sum, item) => sum + item.sizeBytes, 0);
    return {
      value: targetPath,
      name: `[${riskLevel}] ${targetPath} (${formatBytes(totalSize)}, ${items.length} items)`,
    };
  });

  const selectedTarget = await select({
    message: 'Select target to explore',
    choices: targetChoices,
    pageSize: 12,
  });

  const targetItems = itemsByTarget.get(selectedTarget) ?? [];
  const target = report.targets.find((t) => t.path === selectedTarget);
  const riskLevel = target ? categoryRisk[target.category] ?? 'medium' : 'medium';

  // Build tree structure
  const tree = buildTree(targetItems, selectedTarget);
  const expandedPaths = new Set<string>();
  const selectedPaths = new Set<string>();

  // Interactive tree navigation loop
  while (true) {
    const flatTree = flattenTree(tree, expandedPaths, selectedTarget, riskLevel);

    if (flatTree.length === 0) {
      logger.info('No items to display.');
      return;
    }

    // Build choices with checkboxes for selection
    const choices = flatTree.map((node) => {
      const isSelected = selectedPaths.has(node.value);
      const checkbox = isSelected ? '☑ ' : '☐ ';
      return {
        value: node.value,
        name: `${checkbox}${node.name}`,
        checked: isSelected,
      };
    });

    const selected = (await checkbox({
      message: 'Select items to delete (Space: toggle, →: expand/collapse folders, Enter: done)',
      choices,
      pageSize: 20,
      loop: false,
      required: false,
    })) as string[];

    // Update selected paths
    selectedPaths.clear();
    for (const path of selected) {
      selectedPaths.add(path);
    }

    // Ask what to do next
    const nextAction = await select({
      message: 'What would you like to do?',
      choices: [
        { name: '✓ Done - proceed to deletion', value: 'done' },
        { name: 'Expand/Collapse folders', value: 'expand' },
        { name: '← Back to target selection', value: 'back' },
      ],
    });

    if (nextAction === 'back') {
      return; // Go back to target selection
    }

    if (nextAction === 'done') {
      break; // Proceed to deletion
    }

    if (nextAction === 'expand') {
      // Let user select a folder to expand/collapse
      const expandChoices = flatTree
        .filter((n) => n.hasChildren)
        .map((node) => ({
          value: node.value,
          name: `${expandedPaths.has(node.value) ? '▼ Collapse' : '▶ Expand'} ${node.name}`,
        }));

      if (expandChoices.length === 0) {
        logger.info('No folders to expand/collapse.');
        continue;
      }

      const folderToToggle = await select({
        message: 'Select folder to expand/collapse',
        choices: expandChoices,
        pageSize: 15,
      });

      if (expandedPaths.has(folderToToggle)) {
        expandedPaths.delete(folderToToggle);
      } else {
        expandedPaths.add(folderToToggle);
      }
    }
  }

  // Collect all selected items (including items in selected folders)
  const itemsToDelete: ScanItem[] = [];
  for (const selectedPath of selectedPaths) {
    // Find all items that match this path (including children)
    for (const item of targetItems) {
      if (item.path === selectedPath || item.path.startsWith(selectedPath + '/')) {
        itemsToDelete.push(item);
      }
    }
  }

  // Remove duplicates
  const uniqueItems = Array.from(new Map(itemsToDelete.map((item) => [item.path, item])).values());

  if (uniqueItems.length === 0) {
    logger.info('No items selected.');
    return;
  }

  const totalSize = uniqueItems.reduce((sum, item) => sum + item.sizeBytes, 0);
  logger.info(`Selected ${uniqueItems.length} items totaling ${formatBytes(totalSize)}`);

  const confirm = await select({
    message: `Delete ${uniqueItems.length} items (${formatBytes(totalSize)})?`,
    choices: [
      { name: 'Yes, delete selected items', value: 'yes' },
      { name: 'No, cancel', value: 'no' },
      { name: 'Show details first', value: 'details' },
    ],
  });

  if (confirm === 'details') {
    // Show top 20 items
    const topItems = [...uniqueItems]
      .sort((left, right) => right.sizeBytes - left.sizeBytes)
      .slice(0, 20)
      .map((item) => `  ${formatBytes(item.sizeBytes)} ${item.path}`)
      .join('\n');
    process.stdout.write(`\nTop items to delete:\n${topItems}\n\n`);
    logger.info('Use explore mode again to select items for deletion.');
  } else if (confirm === 'yes') {
    // TODO: Implement actual deletion
    logger.info('Deletion not yet implemented. Selected items:');
    uniqueItems.slice(0, 10).forEach((item) => {
      logger.info(`  ${item.path}`);
    });
  }
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
