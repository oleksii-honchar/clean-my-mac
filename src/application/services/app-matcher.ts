import type { InstalledApp } from '../ports/app-detection.port';

export type AppMatchResult = {
  isInstalled: boolean;
  matchedApp: InstalledApp | null;
  matchType: 'exact-name' | 'bundle-id' | 'partial-name' | 'none';
};

/**
 * Match Application Support folder names with installed applications
 */
export class AppMatcher {
  private readonly installedApps: InstalledApp[];
  private readonly appNameMap: Map<string, InstalledApp>;
  private readonly bundleIdMap: Map<string, InstalledApp>;

  public constructor(installedApps: InstalledApp[]) {
    this.installedApps = installedApps;
    this.appNameMap = new Map();
    this.bundleIdMap = new Map();

    // Build lookup maps
    for (const app of installedApps) {
      // Map by app name (normalized)
      const normalizedName = this.normalizeName(app.name);
      if (!this.appNameMap.has(normalizedName)) {
        this.appNameMap.set(normalizedName, app);
      }

      // Map by bundle ID
      if (app.bundleId) {
        const normalizedBundleId = this.normalizeBundleId(app.bundleId);
        if (!this.bundleIdMap.has(normalizedBundleId)) {
          this.bundleIdMap.set(normalizedBundleId, app);
        }
      }
    }
  }

  /**
   * Match a folder name (from Application Support) with installed apps
   */
  public match(folderName: string): AppMatchResult {
    const normalizedFolderName = this.normalizeName(folderName);
    const folderNameLower = folderName.toLowerCase();

    // Strategy 1: Try exact name match first
    const exactMatch = this.appNameMap.get(normalizedFolderName);
    if (exactMatch) {
      return {
        isInstalled: true,
        matchedApp: exactMatch,
        matchType: 'exact-name',
      };
    }

    // Strategy 2: Try bundle ID match (folder might be named after bundle ID)
    // Check exact bundle ID match
    const bundleIdMatch = this.bundleIdMap.get(normalizedFolderName);
    if (bundleIdMatch) {
      return {
        isInstalled: true,
        matchedApp: bundleIdMatch,
        matchType: 'bundle-id',
      };
    }

    // Strategy 3: Check if folder name contains app name using case-insensitive regex
    // e.g., "com.tomjwatson.breaktimer.ShipIt" should match "BreakTimer" app
    // e.g., "net.whatsapp.WhatsApp" should match "WhatsApp" app
    for (const app of this.installedApps) {
      const appNameLower = app.name.toLowerCase();
      const appNameNormalized = this.normalizeName(app.name);

      // Use case-insensitive regex to find app name in folder name
      // Escape special regex characters in app name
      const escapedAppName = app.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const appNameRegex = new RegExp(escapedAppName, 'i');

      if (appNameRegex.test(folderName)) {
        return {
          isInstalled: true,
          matchedApp: app,
          matchType: 'partial-name',
        };
      }

      // Create regex patterns to match app name words in folder name
      // Handle camelCase, PascalCase, and spaces
      const appNameWords = app.name
        .replace(/([A-Z])/g, ' $1') // Split camelCase
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word.length > 2); // Only words longer than 2 chars

      // Check if all significant words from app name are in folder name (case-insensitive)
      if (appNameWords.length > 0) {
        const allWordsMatch = appNameWords.every((word) => {
          const wordRegex = new RegExp(word, 'i');
          return wordRegex.test(folderNameLower);
        });
        if (allWordsMatch && appNameWords.length >= 1) {
          return {
            isInstalled: true,
            matchedApp: app,
            matchType: 'partial-name',
          };
        }
      }

      // Also check normalized name (e.g., "breaktimer" in folder name)
      if (normalizedFolderName.includes(appNameNormalized) && appNameNormalized.length >= 4) {
        return {
          isInstalled: true,
          matchedApp: app,
          matchType: 'partial-name',
        };
      }
    }

    // Strategy 4: Check if folder name matches bundle ID components
    // e.g., "notion" folder might match bundle ID "notion.id" or "com.notion.id"
    for (const [bundleId, app] of this.bundleIdMap.entries()) {
      // Check if folder name is part of bundle ID (e.g., "notion" in "notion.id")
      const bundleIdParts = bundleId.split('.');
      if (bundleIdParts.includes(normalizedFolderName) || bundleId.includes(normalizedFolderName)) {
        return {
          isInstalled: true,
          matchedApp: app,
          matchType: 'bundle-id',
        };
      }

      // Check if bundle ID is contained in folder name
      // e.g., "com.tomjwatson.breaktimer.ShipIt" contains "breaktimer"
      if (folderNameLower.includes(bundleId) || normalizedFolderName.includes(bundleId.replace(/\./g, ''))) {
        return {
          isInstalled: true,
          matchedApp: app,
          matchType: 'bundle-id',
        };
      }

      // Check reverse: if bundle ID component is in folder name
      // e.g., "notion.id" bundle ID matches "notion" folder
      const lastBundleIdPart = bundleIdParts[bundleIdParts.length - 1];
      if (lastBundleIdPart && normalizedFolderName.includes(lastBundleIdPart)) {
        return {
          isInstalled: true,
          matchedApp: app,
          matchType: 'bundle-id',
        };
      }
    }

    // Strategy 5: Try partial name match (e.g., "BraveSoftware" matches "Brave Browser")
    // But be more careful - only match if there's significant overlap
    for (const [appName, app] of this.appNameMap.entries()) {
      // Check if folder name contains app name or vice versa
      // But require at least 4 characters overlap to avoid false positives
      const minOverlap = Math.min(4, Math.min(normalizedFolderName.length, appName.length));
      if (
        (normalizedFolderName.includes(appName) && appName.length >= minOverlap) ||
        (appName.includes(normalizedFolderName) && normalizedFolderName.length >= minOverlap)
      ) {
        return {
          isInstalled: true,
          matchedApp: app,
          matchType: 'partial-name',
        };
      }
    }

    // Strategy 6: Check if folder name matches app name with common variations
    // e.g., "Notion" app might have "notion" or "NotionApp" folder
    for (const app of this.installedApps) {
      const appNameLower = app.name.toLowerCase();
      // Check if folder name starts with app name or vice versa
      if (
        folderNameLower.startsWith(appNameLower) ||
        appNameLower.startsWith(folderNameLower) ||
        folderNameLower === appNameLower.replace(/\s+/g, '') ||
        folderNameLower === appNameLower.replace(/\s+/g, '').replace(/app$/i, '')
      ) {
        return {
          isInstalled: true,
          matchedApp: app,
          matchType: 'partial-name',
        };
      }
    }

    // No match found - app is likely uninstalled
    return {
      isInstalled: false,
      matchedApp: null,
      matchType: 'none',
    };
  }

  /**
   * Normalize app name for matching (lowercase, remove spaces, special chars)
   */
  private normalizeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  /**
   * Normalize bundle ID for matching (lowercase)
   */
  private normalizeBundleId(bundleId: string): string {
    return bundleId.toLowerCase();
  }
}
