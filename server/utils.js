import crypto from 'node:crypto';
import path from 'node:path';

export function createId(prefix = 'id') {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function isPathInside(rootPath, candidatePath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

export function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function normalizeTagList(values) {
  if (!Array.isArray(values)) return [];
  return unique(
    values
      .map((value) => String(value).trim())
      .filter((value) => value.length > 0 && value.length <= 30)
  ).slice(0, 12);
}
