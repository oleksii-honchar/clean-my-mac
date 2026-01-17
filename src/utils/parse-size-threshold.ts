/**
 * Parse size threshold from environment variable
 * Supports formats like: "100MB", "1GB", "500KB", "1024" (bytes)
 * @returns Size in bytes, or undefined if not set or invalid
 */
export const parseSizeThreshold = (): number | undefined => {
  const envValue = process.env.SKIP_ITEMS_SMALLER_THAN;
  if (!envValue) {
    return undefined;
  }

  const trimmed = envValue.trim().toUpperCase();

  // Try to match patterns like "100MB", "1GB", "500KB"
  const sizePattern = /^(\d+(?:\.\d+)?)\s*(KB|MB|GB|TB|B)?$/;
  const match = trimmed.match(sizePattern);

  if (!match) {
    return undefined;
  }

  const value = Number.parseFloat(match[1] ?? '0');
  const unit = match[2] ?? 'B';

  if (Number.isNaN(value) || value < 0) {
    return undefined;
  }

  // Convert to bytes
  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
    TB: 1024 * 1024 * 1024 * 1024,
  };

  const multiplier = multipliers[unit] ?? 1;
  return Math.floor(value * multiplier);
};
