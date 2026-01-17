import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { AppDetectionPort, InstalledApp } from '../application/ports/app-detection.port';
import type { FileSystemPort } from '../application/ports/file-system.port';

const execFileAsync = promisify(execFile);

export class MacOSAppDetection implements AppDetectionPort {
  public constructor(private readonly fileSystem: FileSystemPort) { }

  public async getInstalledApps(): Promise<InstalledApp[]> {
    const apps: InstalledApp[] = [];
    const appPaths = [
      '/Applications',
      path.join(os.homedir(), 'Applications'),
    ];

    for (const appPath of appPaths) {
      if (await this.fileSystem.exists(appPath)) {
        const foundApps = await this.scanApplicationsDirectory(appPath);
        apps.push(...foundApps);
      }
    }

    return apps;
  }

  private async scanApplicationsDirectory(appPath: string): Promise<InstalledApp[]> {
    const apps: InstalledApp[] = [];
    const entries = await this.fileSystem.listEntries(appPath);

    for (const entry of entries) {
      if (entry.type === 'directory' && entry.name.endsWith('.app')) {
        const appInfo = await this.getAppInfo(entry.path);
        if (appInfo) {
          apps.push(appInfo);
        }
      }
    }

    return apps;
  }

  private async getAppInfo(appPath: string): Promise<InstalledApp | null> {
    try {
      // Get app name from directory name (remove .app extension)
      const appName = path.basename(appPath, '.app');

      // Try to read bundle identifier from Info.plist
      const infoPlistPath = path.join(appPath, 'Contents', 'Info.plist');
      let bundleId: string | null = null;

      if (await this.fileSystem.exists(infoPlistPath)) {
        try {
          // Use plutil to read bundle identifier (more reliable on macOS)
          const { stdout } = await execFileAsync('plutil', [
            '-extract',
            'CFBundleIdentifier',
            'raw',
            infoPlistPath,
          ]);
          bundleId = stdout.trim() || null;
        } catch {
          // Fallback: try reading the plist file directly and parsing
          try {
            const plistContent = await fs.readFile(infoPlistPath, 'utf8');
            // Simple regex to extract CFBundleIdentifier (not perfect but works for most cases)
            const bundleIdMatch = plistContent.match(
              /<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/,
            );
            if (bundleIdMatch && bundleIdMatch[1]) {
              bundleId = bundleIdMatch[1].trim();
            }
          } catch {
            // If all methods fail, bundleId remains null
          }
        }
      }

      return {
        name: appName,
        bundleId,
        path: appPath,
      };
    } catch {
      return null;
    }
  }
}
