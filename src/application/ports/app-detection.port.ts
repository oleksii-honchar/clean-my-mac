export type InstalledApp = {
  name: string;
  bundleId: string | null;
  path: string;
};

export interface AppDetectionPort {
  /**
   * Scan for installed applications in /Applications and ~/Applications
   */
  getInstalledApps(): Promise<InstalledApp[]>;
}
