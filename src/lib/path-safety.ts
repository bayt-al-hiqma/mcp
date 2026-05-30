/**
 * Path safety utilities to prevent path traversal attacks
 */

import { normalize, isAbsolute, relative, sep } from 'path';

export class PathSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathSafetyError';
  }
}

/**
 * Validates and normalizes a vault path
 * @throws PathSafetyError if path is unsafe
 */
export function validateVaultPath(path: string, vaultRoot: string = ''): string {
  if (!path) {
    throw new PathSafetyError('Path cannot be empty');
  }

  // Reject absolute paths
  if (isAbsolute(path)) {
    throw new PathSafetyError('Absolute paths are not allowed');
  }

  // Normalize the path
  const normalized = normalize(path);

  // Check for path traversal attempts
  if (normalized.startsWith('..') || normalized.includes(`${sep}..${sep}`) || normalized.includes(`${sep}..`)) {
    throw new PathSafetyError('Path traversal is not allowed');
  }

  // Combine with vault root if provided
  const fullPath = vaultRoot ? normalize(`${vaultRoot}/${normalized}`) : normalized;

  // Ensure the final path doesn't escape vault root
  if (vaultRoot) {
    const rel = relative(vaultRoot, fullPath);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new PathSafetyError('Path must be within vault root');
    }
  }

  return normalized;
}

/**
 * Ensures path has .md extension
 */
export function ensureMarkdownExtension(path: string): string {
  if (!path.endsWith('.md')) {
    return `${path}.md`;
  }
  return path;
}

/**
 * Strips .md extension if present
 */
export function stripMarkdownExtension(path: string): string {
  if (path.endsWith('.md')) {
    return path.slice(0, -3);
  }
  return path;
}

/**
 * Extracts filename from path without extension
 */
export function getFilenameWithoutExtension(path: string): string {
  const parts = path.split('/');
  const filename = parts[parts.length - 1];
  return stripMarkdownExtension(filename);
}

/**
 * Generates a daily note path for a given date
 */
export function getDailyNotePath(date: Date, dailyNotesDir: string): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${dailyNotesDir}/${year}-${month}-${day}.md`;
}
