import path from 'path';
import os from 'os';

import { SCAN_CATEGORY } from './scan-category';
import type { ScanTarget } from './scan-item';

const homeDir = os.homedir();

export const defaultTargets: ScanTarget[] = [
  {
    path: path.join(homeDir, 'Library', 'Application Support'),
    category: SCAN_CATEGORY.APP_SUPPORT,
    isSystem: false,
    guideline:
      'Contains app data, settings, and support files. Generally safe to clean after uninstalling apps, but active apps may lose preferences or data. Only delete folders for apps you no longer use. Cache folders within app bundles are usually safe.',
  },
  {
    path: path.join(homeDir, 'Library', 'Caches'),
    category: SCAN_CATEGORY.CACHES,
    isSystem: false,
    guideline:
      'Cache files can be safely deleted. Apps will regenerate them, but may run slightly slower initially. Safe to clean regularly. Older cache files (>30 days) are usually safe to remove. System caches may require admin access.',
  },
  {
    path: path.join(homeDir, 'Library', 'Preferences'),
    category: SCAN_CATEGORY.PREFERENCES,
    isSystem: false,
    guideline:
      'Contains app preference files (.plist). Deleting will reset app settings. Generally avoid deleting unless troubleshooting or uninstalling apps. Backup before deleting. Critical system preferences should never be deleted.',
  },
  {
    path: path.join(homeDir, 'Library', 'Saved Application State'),
    category: SCAN_CATEGORY.SAVED_APP_STATE,
    isSystem: false,
    guideline:
      'Stores window positions and document states. Safe to delete - apps will recreate on next launch. Useful for cleaning to reset app windows. No data loss, just UI state reset. Can free significant space for apps with many open windows.',
  },
  {
    path: path.join(homeDir, 'Library', 'Containers'),
    category: SCAN_CATEGORY.CONTAINERS,
    isSystem: false,
    guideline:
      'Sandboxed app containers. Contains app-specific data in isolated folders. Safe to delete containers for uninstalled apps (orphans). Active app containers may contain important data - review before deleting. Cache folders within containers are safe.',
  },
  {
    path: path.join(homeDir, 'Library', 'Group Containers'),
    category: SCAN_CATEGORY.GROUP_CONTAINERS,
    isSystem: false,
    guideline:
      'Shared containers used by multiple apps (e.g., iCloud, Messages). Be cautious - may contain synced data. Cache and temporary folders are usually safe. Review contents before deleting. Avoid deleting system containers (com.apple.*) unless you know what they contain.',
  },
  {
    path: '/Library/Application Support',
    category: SCAN_CATEGORY.SYSTEM,
    isSystem: true,
    guideline:
      'System-wide app support files. Requires admin access. Only clean if you know what you\'re doing. Avoid deleting system app folders. Third-party app leftovers are usually safe. Very high risk - can affect all users.',
  },
  {
    path: '/Library/Caches',
    category: SCAN_CATEGORY.SYSTEM,
    isSystem: true,
    guideline:
      'System-wide caches. Requires admin/sudo access. Generally safe to clean system caches, but macOS may recreate them immediately. Some caches improve performance - system may slow temporarily after cleanup. Safe for older cache files.',
  },
  {
    path: '/Library/Preferences',
    category: SCAN_CATEGORY.SYSTEM,
    isSystem: true,
    guideline:
      'System-wide preferences. Critical risk - do not delete without expert knowledge. Contains system configuration affecting all users. Mis-deletion can break macOS functionality. Only clean third-party app preferences you recognize and no longer use.',
  },
  {
    path: '/Library/LaunchAgents',
    category: SCAN_CATEGORY.LAUNCH_ITEMS,
    isSystem: true,
    guideline:
      'System-wide launch agents - apps/scripts that run automatically at login for all users. High risk - disabling may break system services or apps. Only remove agents from uninstalled apps. Review carefully before deletion. Keep system agents.',
  },
  {
    path: '/Library/LaunchDaemons',
    category: SCAN_CATEGORY.LAUNCH_ITEMS,
    isSystem: true,
    guideline:
      'System-wide launch daemons - run as root/system services. Critical risk - essential for macOS operation. Do not delete unless you are certain it\'s from malware or an uninstalled app. Removing system daemons can break macOS.',
  },
  {
    path: '/Library/StartupItems',
    category: SCAN_CATEGORY.LAUNCH_ITEMS,
    isSystem: true,
    guideline:
      'Legacy startup items (deprecated on modern macOS, replaced by LaunchAgents/Daemons). Usually safe to clean if folder exists - likely empty or contains outdated items. Very rare on macOS 10.4+. Review contents first.',
  },
  {
    path: path.join(homeDir, 'Library', 'LaunchAgents'),
    category: SCAN_CATEGORY.LAUNCH_ITEMS,
    isSystem: false,
    guideline:
      'User-specific launch agents - apps/scripts that run at your login. Medium-high risk - disabling may affect apps you use. Safe to remove agents from uninstalled apps. Review list - malware sometimes installs here. System agents should remain.',
  },
];
