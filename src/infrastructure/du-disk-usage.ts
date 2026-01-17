import { execFile } from 'child_process';
import { promisify } from 'util';

import type { DiskUsagePort } from '../application/ports/disk-usage.port';

const execFileAsync = promisify(execFile);

export class DuDiskUsage implements DiskUsagePort {
  public constructor(private readonly useSudo: boolean) { }

  public async getSizeInKb(targetPath: string): Promise<number> {
    const command = this.useSudo ? 'sudo' : 'du';
    const args = this.useSudo ? ['du', '-sk', targetPath] : ['-sk', targetPath];
    try {
      const { stdout } = await execFileAsync(command, args);
      const [sizeToken] = stdout.trim().split(/\s+/);
      const size = Number.parseInt(sizeToken ?? '0', 10);
      return Number.isNaN(size) ? 0 : size;
    } catch (error) {
      const errorDetails = error as { stderr?: string; message?: string };
      const message = [errorDetails?.message, errorDetails?.stderr].filter(Boolean).join('\n');
      if (isPermissionError(message)) {
        throw new Error(
          [
            `Permission denied for ${targetPath}.`,
            'Grant Full Disk Access to your terminal (System Settings > Privacy & Security > Full Disk Access).',
          ].join(' '),
        );
      }
      throw error;
    }
  }
}

const isPermissionError = (message: string) => {
  const lower = message.toLowerCase();
  return lower.includes('permission denied') || lower.includes('operation not permitted');
};
