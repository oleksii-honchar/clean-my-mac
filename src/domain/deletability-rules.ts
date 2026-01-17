import type { ScanCategory } from './scan-category';

/**
 * Patterns that identify safe-to-delete subfolders/files within app directories
 */
const SAFE_DELETE_PATTERNS: Array<RegExp | string> = [
  // Cache-related
  /[Cc]ache[Ss]torage?$/,
  /[Cc]ache[s]?$/,
  /[Cc]aches$/,
  /\.cache$/,
  /[Cc]ache\.db$/,

  // Logs
  /[Ll]og[s]?$/,
  /\.log$/,

  // Temporary files
  /[Tt]emp[s]?$/,
  /[Tt]emporary/,
  /[Tt]mp$/,

  // Service Worker caches
  /[Ss]ervice\s*[Ww]orker/,
  /[Ss]w\.js$/,

  // IndexedDB (browser databases - usually safe)
  /[Ii]ndexedDB$/,

  // Local Storage (browser storage - usually safe)
  /[Ll]ocal\s*[Ss]torage$/,

  // Browser-specific safe folders
  /[Gg]pucache$/,
  /[Ss]hadercache$/,
  /[Cc]ode\s*[Cc]ache$/,

  // Old/backup files
  /\.old$/,
  /\.bak$/,
  /\.backup$/,
];

/**
 * Patterns that identify risky/important subfolders that should NOT be deleted
 */
const UNSAFE_PATTERNS: Array<RegExp | string> = [
  // User data (but not cache.db which is handled by safe patterns)
  /[Dd]ata$/,
  /[Uu]ser\s*[Dd]ata$/,
  /[Dd]atabase[s]?$/,
  // Only match .db files that are NOT cache.db (checked after safe patterns)

  // Preferences
  /[Pp]reference[s]?$/,
  /[Pp]refs?$/,

  // Extensions/plugins
  /[Ee]xtension[s]?$/,
  /[Pp]lugin[s]?$/,

  // Saved state
  /[Ss]aved\s*[Ss]tate$/,

  // Application bundles
  /\.app$/,
  /\.app\.dSYM$/,

  // Code signing
  /[Cc]ode[Ss]ignature/,
];

/**
 * Determine if a path within a target is safe to delete
 */
export const isSafeToDelete = (
  itemPath: string,
  itemName: string,
  category: ScanCategory,
  depth: number,
): boolean => {
  // Don't mark items as deletable if they're too deep (avoid scanning huge trees)
  // Limit to 3-4 levels deep for performance
  if (depth > 4) {
    return false;
  }

  // For certain categories, be more conservative
  if (category === 'preferences' || category === 'launch-items') {
    return false; // Never mark preferences or launch items as safe to delete
  }

  // Check safe patterns first (give priority to safe-to-delete indicators)
  for (const pattern of SAFE_DELETE_PATTERNS) {
    if (typeof pattern === 'string') {
      if (itemName.toLowerCase().includes(pattern.toLowerCase())) {
        return true;
      }
    } else {
      if (pattern.test(itemPath) || pattern.test(itemName)) {
        return true;
      }
    }
  }

  // Check unsafe patterns (override safe if both match - except cache.db handled above)
  for (const pattern of UNSAFE_PATTERNS) {
    if (typeof pattern === 'string') {
      if (itemName.toLowerCase().includes(pattern.toLowerCase())) {
        return false;
      }
    } else {
      if (pattern.test(itemPath) || pattern.test(itemName)) {
        return false;
      }
    }
  }

  // Also block .db files that weren't caught by cache.db pattern
  if (/\.db$/.test(itemPath) && !/[Cc]ache\.db/.test(itemPath)) {
    return false;
  }

  // For caches category, everything is generally safe
  if (category === 'caches') {
    return true;
  }

  // For saved-application-state, everything is generally safe
  if (category === 'saved-application-state') {
    return true;
  }

  // Default: not safe (conservative approach)
  return false;
};

/**
 * Calculate depth of a path relative to a base path
 */
export const calculateDepth = (itemPath: string, basePath: string): number => {
  const relative = itemPath.slice(basePath.length);
  const parts = relative.split('/').filter((p) => p.length > 0);
  return parts.length;
};

/**
 * Patterns that identify cache/history/log directories that should be treated as leaf nodes
 * (not scanned deeper - treat the entire directory as a single unit)
 */
const LEAF_CACHE_DIR_PATTERNS: Array<RegExp | string> = [
  // IndexedDB directories
  /[Ii]ndexedDB/,
  /\.indexeddb\.leveldb$/,
  /\.leveldb$/,

  // Local Storage
  /[Ll]ocal\s*[Ss]torage/,
  /leveldb$/,

  // Cache directories
  /[Cc]ache[Ss]torage?$/,
  /[Cc]ache[s]?$/,
  /[Cc]aches$/,
  /\.cache$/,

  // Log directories
  /[Ll]og[s]?$/,

  // History directories
  /[Hh]istory$/,

  // Temporary directories
  /[Tt]emp[s]?$/,
  /[Tt]emporary/,
  /[Tt]mp$/,

  // Note: Service Worker is NOT a leaf - we need to scan inside to find CacheStorage
  // /[Ss]ervice\s*[Ww]orker/,  // Removed - need to scan inside to find CacheStorage

  // Browser-specific cache directories
  /[Gg]pucache$/,
  /[Ss]hadercache$/,
  /[Cc]ode\s*[Cc]ache$/,
];

/**
 * Check if a directory should be treated as a leaf (not scanned deeper)
 * Returns true if the directory matches cache/history/log patterns
 */
export const isLeafCacheDirectory = (dirPath: string, dirName: string): boolean => {
  for (const pattern of LEAF_CACHE_DIR_PATTERNS) {
    if (typeof pattern === 'string') {
      if (dirName.toLowerCase().includes(pattern.toLowerCase())) {
        return true;
      }
    } else {
      if (pattern.test(dirPath) || pattern.test(dirName)) {
        return true;
      }
    }
  }
  return false;
};
