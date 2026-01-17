import path from 'node:path';

import type { ScanItem, ScanReport } from '../../domain/scan-item';
import { categoryRisk } from './scan-service';

export type TreeNode = {
  name: string;
  fullPath: string;
  sizeBytes: number;
  items: ScanItem[];
  children: Map<string, TreeNode>;
  isLeaf: boolean;
  depth: number;
  appInstalled?: boolean;
  matchedAppName?: string;
  isOrphaned: boolean;
};

/**
 * Build a tree structure from scan items
 */
export const buildTree = (items: ScanItem[], basePath: string): Map<string, TreeNode> => {
  const root = new Map<string, TreeNode>();

  for (const item of items) {
    // Get relative path from base
    const relativePath = item.path.slice(basePath.length + 1);
    const parts = relativePath.split('/').filter((p) => p.length > 0);

    if (parts.length === 0) continue;

    // Find or create nodes for each path part
    let currentMap = root;
    let currentPath = basePath;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const isLast = i === parts.length - 1;
      currentPath = path.join(currentPath, part);

      let node = currentMap.get(part);
      if (!node) {
        node = {
          name: part,
          fullPath: currentPath,
          sizeBytes: 0,
          items: [],
          children: new Map(),
          isLeaf: false,
          depth: i,
          isOrphaned: false,
        };
        currentMap.set(part, node);
      }

      if (isLast) {
        // This is the actual item
        node.items.push(item);
        node.sizeBytes += item.sizeBytes;
        node.isLeaf = true;
        node.appInstalled = item.appInstalled;
        node.matchedAppName = item.matchedAppName;
        node.isOrphaned = item.appInstalled === false;
      } else {
        // Update parent size
        node.sizeBytes += item.sizeBytes;
        // Inherit app status from children if not set
        if (node.appInstalled === undefined && item.appInstalled !== undefined) {
          node.appInstalled = item.appInstalled;
          node.matchedAppName = item.matchedAppName;
          node.isOrphaned = item.appInstalled === false;
        }
        currentMap = node.children;
      }
    }
  }

  return root;
};

/**
 * Flatten tree for display with expand/collapse state
 */
export type FlatTreeNode = {
  value: string;
  name: string;
  sizeBytes: number;
  depth: number;
  isExpanded: boolean;
  hasChildren: boolean;
  isLeaf: boolean;
  isOrphaned: boolean;
  appInstalled?: boolean;
  matchedAppName?: string;
};

export const flattenTree = (
  tree: Map<string, TreeNode>,
  expandedPaths: Set<string>,
  basePath: string,
  riskLevel: string,
): FlatTreeNode[] => {
  const result: FlatTreeNode[] = [];

  const traverse = (nodes: Map<string, TreeNode>, currentPath: string, depth: number) => {
    const sortedNodes = Array.from(nodes.entries()).sort(([, a], [, b]) => {
      // Sort orphaned first, then by size
      if (a.isOrphaned && !b.isOrphaned) return -1;
      if (!a.isOrphaned && b.isOrphaned) return 1;
      return b.sizeBytes - a.sizeBytes;
    });

    for (const [name, node] of sortedNodes) {
      const nodePath = path.join(currentPath, name);
      const isExpanded = expandedPaths.has(nodePath);
      const hasChildren = node.children.size > 0;
      const indent = '  '.repeat(depth);
      const prefix = hasChildren ? (isExpanded ? '▼ ' : '▶ ') : '  ';
      const orphanedLabel = node.isOrphaned ? '⚠️  ORPHANED ' : '';
      const installedLabel = node.appInstalled && !node.isOrphaned
        ? `[INSTALLED${node.matchedAppName ? `: ${node.matchedAppName}` : ''}] `
        : '';

      result.push({
        value: nodePath,
        name: `${indent}${prefix}${orphanedLabel}${installedLabel}${name} (${formatBytes(node.sizeBytes)})`,
        sizeBytes: node.sizeBytes,
        depth,
        isExpanded,
        hasChildren,
        isLeaf: node.isLeaf,
        isOrphaned: node.isOrphaned,
        appInstalled: node.appInstalled,
        matchedAppName: node.matchedAppName,
      });

      // If expanded, show children
      if (isExpanded && hasChildren) {
        traverse(node.children, nodePath, depth + 1);
      }
    }
  };

  traverse(tree, basePath, 0);
  return result;
};

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`;
};
