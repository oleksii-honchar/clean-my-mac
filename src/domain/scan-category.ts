import { z } from 'zod';

import type { ValueOf } from '../types/value-of';

export const SCAN_CATEGORY = {
  APP_SUPPORT: 'application-support',
  CACHES: 'caches',
  PREFERENCES: 'preferences',
  SAVED_APP_STATE: 'saved-application-state',
  CONTAINERS: 'containers',
  GROUP_CONTAINERS: 'group-containers',
  LAUNCH_ITEMS: 'launch-items',
  SYSTEM: 'system',
} as const;

export type ScanCategory = ValueOf<typeof SCAN_CATEGORY>;

export const scanCategorySchema = z.enum(
  Object.values(SCAN_CATEGORY) as [ScanCategory, ...ScanCategory[]],
);
