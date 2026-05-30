/**
 * Tests for Markdown parser
 */

import { describe, it, expect } from 'vitest';
import { MarkdownParser } from '../src/lib/markdown-parser.js';

describe('MarkdownParser', () => {
  describe('parse', () => {
    it('should parse basic markdown with frontmatter', () => {
      const content = `---
title: Test Note
tags:
  - test
  - example
---

# Test Note

This is a test.`;

      const note = MarkdownParser.parse('test.md', content);

      expect(note.title).toBe('Test Note');
      expect(note.tags).toContain('test');
      expect(note.tags).toContain('example');
      expect(note.content).toContain('This is a test');
    });

    it('should extract title from first heading if no frontmatter', () => {
      const content = '# My Note Title\n\nContent here.';
      const note = MarkdownParser.parse('test.md', content);

      expect(note.title).toBe('My Note Title');
    });

    it('should fallback to filename for title', () => {
      const content = 'Just content, no title.';
      const note = MarkdownParser.parse('my-note.md', content);

      expect(note.title).toBe('my-note');
    });

    it('should extract wikilinks', () => {
      const content = 'Link to [[other note]] and [[another|with alias]].';
      const note = MarkdownParser.parse('test.md', content);

      expect(note.links).toHaveLength(2);
      expect(note.links[0].type).toBe('wikilink');
      expect(note.links[0].target).toBe('other note');
      expect(note.links[1].alias).toBe('with alias');
    });

    it('should extract markdown links', () => {
      const content = 'See [this note](notes/other.md) for details.';
      const note = MarkdownParser.parse('test.md', content);

      expect(note.links).toHaveLength(1);
      expect(note.links[0].type).toBe('markdown');
      expect(note.links[0].target).toBe('notes/other.md');
    });

    it('should ignore external http links', () => {
      const content = 'Visit [Google](https://google.com) for more.';
      const note = MarkdownParser.parse('test.md', content);

      expect(note.links).toHaveLength(0);
    });

    it('should extract inline tags', () => {
      const content = 'This has #tag1 and #tag2 inline.';
      const note = MarkdownParser.parse('test.md', content);

      expect(note.tags).toContain('tag1');
      expect(note.tags).toContain('tag2');
    });

    it('should extract sections by heading', () => {
      const content = `# Main Title

## Section 1
Content 1

## Section 2
Content 2`;

      const note = MarkdownParser.parse('test.md', content);

      expect(note.sections).toHaveLength(2);
      expect(note.sections[0].heading).toBe('Section 1');
      expect(note.sections[0].content).toContain('Content 1');
      expect(note.sections[1].heading).toBe('Section 2');
    });

    it('should extract tasks', () => {
      const content = `# Todo

- [ ] Incomplete task
- [x] Completed task
- [X] Also completed`;

      const note = MarkdownParser.parse('test.md', content);

      expect(note.tasks).toHaveLength(3);
      expect(note.tasks[0].completed).toBe(false);
      expect(note.tasks[1].completed).toBe(true);
      expect(note.tasks[2].completed).toBe(true);
      expect(note.tasks[0].heading).toBe('Todo');
    });

    it('should extract tags from tasks', () => {
      const content = '- [ ] Task with #tag1 and #tag2';
      const note = MarkdownParser.parse('test.md', content);

      expect(note.tasks[0].tags).toContain('tag1');
      expect(note.tasks[0].tags).toContain('tag2');
    });
  });

  describe('stringifyFrontmatter', () => {
    it('should generate valid YAML frontmatter', () => {
      const data = {
        title: 'Test',
        tags: ['tag1', 'tag2']
      };

      const yaml = MarkdownParser.stringifyFrontmatter(data);

      expect(yaml).toContain('---');
      expect(yaml).toContain('title: Test');
      expect(yaml).toContain('- tag1');
      expect(yaml).toContain('- tag2');
    });

    it('should return empty string for empty data', () => {
      const yaml = MarkdownParser.stringifyFrontmatter({});
      expect(yaml).toBe('');
    });
  });

  describe('replaceSection', () => {
    it('should replace existing section', () => {
      const content = `# Title

## Section 1
Old content

## Section 2
Other content`;

      const updated = MarkdownParser.replaceSection(content, 'Section 1', 'New content');

      expect(updated).toContain('## Section 1');
      expect(updated).toContain('New content');
      expect(updated).not.toContain('Old content');
      expect(updated).toContain('## Section 2');
    });

    it('should append section if not found', () => {
      const content = '# Title\n\nExisting content';
      const updated = MarkdownParser.replaceSection(content, 'New Section', 'New content');

      expect(updated).toContain('## New Section');
      expect(updated).toContain('New content');
      expect(updated).toContain('Existing content');
    });
  });

  describe('appendContent', () => {
    it('should append content with proper spacing', () => {
      const content = 'Existing content';
      const updated = MarkdownParser.appendContent(content, 'New content');

      expect(updated).toBe('Existing content\n\nNew content');
    });
  });
});
