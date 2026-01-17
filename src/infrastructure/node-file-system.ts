import { promises as fs } from 'node:fs';
import type { Dirent } from 'node:fs';
import path from 'node:path';

import type { FileSystemEntry, FileSystemPort, FileStats } from '../application/ports/file-system.port';

const mapEntryType = (entry: Dirent): FileSystemEntry['type'] => {
  if (entry.isFile()) {
    return 'file';
  }
  if (entry.isDirectory()) {
    return 'directory';
  }
  if (entry.isSymbolicLink()) {
    return 'symlink';
  }
  return 'other';
};

export class NodeFileSystem implements FileSystemPort {
  public async exists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  public async listEntries(targetPath: string): Promise<FileSystemEntry[]> {
    const entries = await fs.readdir(targetPath, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      path: path.join(targetPath, entry.name),
      type: mapEntryType(entry),
    }));
  }

  public async stat(targetPath: string): Promise<FileStats> {
    const stats = await fs.stat(targetPath);
    return {
      modifiedAt: stats.mtime,
    };
  }

  public async ensureDirectory(targetPath: string): Promise<void> {
    await fs.mkdir(targetPath, { recursive: true });
  }

  public async writeFile(targetPath: string, contents: string): Promise<void> {
    await fs.writeFile(targetPath, contents, 'utf8');
  }
}
