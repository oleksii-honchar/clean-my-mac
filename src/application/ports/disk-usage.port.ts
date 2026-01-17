export interface DiskUsagePort {
  getSizeInKb(path: string): Promise<number>;
}
