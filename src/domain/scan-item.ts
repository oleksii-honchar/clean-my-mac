import { z } from 'zod';

import type { ValueOf } from '../types/value-of';
import type { ScanCategory } from './scan-category';

export const SCAN_ITEM_TYPE = {
  FILE: 'file',
  DIRECTORY: 'directory',
  SYMLINK: 'symlink',
  OTHER: 'other',
} as const;

export type ScanItemType = ValueOf<typeof SCAN_ITEM_TYPE>;

export const SCAN_ITEM_TYPE_SCHEMA = z.enum(
  Object.values(SCAN_ITEM_TYPE) as [ScanItemType, ...ScanItemType[]],
);

export const RISK_LEVEL = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
} as const;

export type RiskLevel = ValueOf<typeof RISK_LEVEL>;

export const RISK_LEVEL_SCHEMA = z.enum(
  Object.values(RISK_LEVEL) as [RiskLevel, ...RiskLevel[]],
);

export type ScanItem = {
  name: string;
  path: string;
  category: ScanCategory;
  sizeKb: number;
  sizeBytes: number;
  modifiedAt: string;
  type: ScanItemType;
  riskLevel: RiskLevel;
};

export type SkippedItem = {
  path: string;
  reason: string;
};

export type ScanReport = {
  generatedAt: string;
  targets: ScanTarget[];
  items: ScanItem[];
  totalsByCategory: Record<ScanCategory, number>;
  skipped: SkippedItem[];
};

export type ScanTarget = {
  path: string;
  category: ScanCategory;
  isSystem: boolean;
  guideline?: string;
};
