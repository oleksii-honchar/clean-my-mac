export type FileSystemEntry = {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
};

export type FileStats = {
  modifiedAt: Date;
};

export interface FileSystemPort {
  exists(path: string): Promise<boolean>;
  listEntries(path: string): Promise<FileSystemEntry[]>;
  stat(path: string): Promise<FileStats>;
  ensureDirectory(path: string): Promise<void>;
  writeFile(path: string, contents: string): Promise<void>;
}
