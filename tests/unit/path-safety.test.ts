/**
 * Tests for path safety utilities
 */

import { describe, it, expect } from 'vitest';
import {
  validateVaultPath,
  ensureMarkdownExtension,
  stripMarkdownExtension,
  getFilenameWithoutExtension,
  getDailyNotePath,
  PathSafetyError
} from '../../dist/lib/path-safety.js';

describe('Path Safety', () => {
  describe('validateVaultPath', () => {
    it('should accept valid relative paths', () => {
      expect(validateVaultPath('notes/test.md')).toBe('notes/test.md');
      expect(validateVaultPath('daily/2024-01-01.md')).toBe('daily/2024-01-01.md');
    });

    it('should reject absolute paths', () => {
      expect(() => validateVaultPath('/etc/passwd')).toThrow(PathSafetyError);
      expect(() => validateVaultPath('/home/user/notes.md')).toThrow(PathSafetyError);
    });

    it('should reject path traversal attempts', () => {
      expect(() => validateVaultPath('../../../etc/passwd')).toThrow(PathSafetyError);
      expect(() => validateVaultPath('notes/../../etc/passwd')).toThrow(PathSafetyError);
      expect(() => validateVaultPath('notes/../..\\windows\\system32')).toThrow(PathSafetyError);
    });

    it('should reject empty paths', () => {
      expect(() => validateVaultPath('')).toThrow(PathSafetyError);
    });

    it('should normalize paths', () => {
      expect(validateVaultPath('notes//test.md')).toBe('notes/test.md');
      expect(validateVaultPath('notes/./test.md')).toBe('notes/test.md');
    });

    it('should validate against vault root', () => {
      const vaultRoot = 'vault';
      expect(validateVaultPath('notes/test.md', vaultRoot)).toBe('notes/test.md');
      expect(() => validateVaultPath('../outside.md', vaultRoot)).toThrow(PathSafetyError);
    });
  });

  describe('ensureMarkdownExtension', () => {
    it('should add .md extension if missing', () => {
      expect(ensureMarkdownExtension('test')).toBe('test.md');
      expect(ensureMarkdownExtension('notes/test')).toBe('notes/test.md');
    });

    it('should not add extension if already present', () => {
      expect(ensureMarkdownExtension('test.md')).toBe('test.md');
      expect(ensureMarkdownExtension('notes/test.md')).toBe('notes/test.md');
    });
  });

  describe('stripMarkdownExtension', () => {
    it('should remove .md extension', () => {
      expect(stripMarkdownExtension('test.md')).toBe('test');
      expect(stripMarkdownExtension('notes/test.md')).toBe('notes/test');
    });

    it('should not modify paths without .md extension', () => {
      expect(stripMarkdownExtension('test')).toBe('test');
      expect(stripMarkdownExtension('notes/test.txt')).toBe('notes/test.txt');
    });
  });

  describe('getFilenameWithoutExtension', () => {
    it('should extract filename without extension', () => {
      expect(getFilenameWithoutExtension('test.md')).toBe('test');
      expect(getFilenameWithoutExtension('notes/daily/2024-01-01.md')).toBe('2024-01-01');
    });
  });

  describe('getDailyNotePath', () => {
    it('should generate correct daily note path', () => {
      const date = new Date('2024-01-15');
      expect(getDailyNotePath(date, 'daily')).toBe('daily/2024-01-15.md');
    });

    it('should pad month and day with zeros', () => {
      const date = new Date('2024-03-05');
      expect(getDailyNotePath(date, 'journal')).toBe('journal/2024-03-05.md');
    });
  });
});
