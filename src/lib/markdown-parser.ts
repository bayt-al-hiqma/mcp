/**
 * Markdown parser for extracting structure from notes
 */

import matter from 'gray-matter';
import { Note, Link, Section, Task, NoteType } from '../types/index.js';

export class MarkdownParser {
  /**
   * Parse a markdown file into a Note object
   */
  static parse(path: string, rawContent: string): Note {
    const parsed = matter(rawContent);
    const frontmatter = parsed.data;
    const content = parsed.content;

    return {
      path,
      title: this.extractTitle(frontmatter, content, path),
      aliases: this.extractAliases(frontmatter),
      tags: this.extractTags(frontmatter, content),
      type: frontmatter.type as NoteType,
      created: frontmatter.created ? new Date(frontmatter.created) : undefined,
      updated: frontmatter.updated ? new Date(frontmatter.updated) : undefined,
      links: this.extractLinks(content),
      sections: this.extractSections(content),
      tasks: this.extractTasks(content),
      frontmatter,
      content,
      rawContent
    };
  }

  /**
   * Extract title from frontmatter or first heading
   */
  private static extractTitle(frontmatter: any, content: string, path: string): string {
    if (frontmatter.title) {
      return frontmatter.title;
    }

    // Look for first # heading
    const headingMatch = content.match(/^#\s+(.+)$/m);
    if (headingMatch) {
      return headingMatch[1].trim();
    }

    // Fallback to filename
    const filename = path.split('/').pop() || path;
    return filename.replace(/\.md$/, '');
  }

  /**
   * Extract aliases from frontmatter
   */
  private static extractAliases(frontmatter: any): string[] {
    if (!frontmatter.aliases) return [];

    if (Array.isArray(frontmatter.aliases)) {
      return frontmatter.aliases.map((a: any) => String(a));
    }

    if (typeof frontmatter.aliases === 'string') {
      return [frontmatter.aliases];
    }

    return [];
  }

  /**
   * Extract tags from frontmatter and inline content
   */
  private static extractTags(frontmatter: any, content: string): string[] {
    const tags = new Set<string>();

    // From frontmatter
    if (frontmatter.tags) {
      const fmTags = Array.isArray(frontmatter.tags)
        ? frontmatter.tags
        : [frontmatter.tags];
      fmTags.forEach((tag: any) => tags.add(String(tag).replace(/^#/, '')));
    }

    // From inline content (#tag syntax)
    const inlineTagRegex = /#([a-zA-Z0-9_/-]+)/g;
    let match;
    while ((match = inlineTagRegex.exec(content)) !== null) {
      tags.add(match[1]);
    }

    return Array.from(tags);
  }

  /**
   * Extract wikilinks and markdown links
   */
  private static extractLinks(content: string): Link[] {
    const links: Link[] = [];
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      // Wikilinks: [[target]] or [[target|alias]]
      const wikilinkRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
      let match;
      while ((match = wikilinkRegex.exec(line)) !== null) {
        links.push({
          type: 'wikilink',
          target: match[1].trim(),
          alias: match[2]?.trim(),
          line: index + 1
        });
      }

      // Markdown links: [text](url)
      const mdLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
      while ((match = mdLinkRegex.exec(line)) !== null) {
        const url = match[2].trim();
        // Only include internal links (not http/https)
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          links.push({
            type: 'markdown',
            target: url,
            alias: match[1].trim(),
            line: index + 1
          });
        }
      }
    });

    return links;
  }

  /**
   * Extract sections by headings
   */
  private static extractSections(content: string): Section[] {
    const sections: Section[] = [];
    const lines = content.split('\n');
    let currentSection: Partial<Section> | null = null;

    lines.forEach((line, index) => {
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

      if (headingMatch) {
        // Close previous section
        if (currentSection) {
          const section = currentSection as any;
          if (section.heading && section.level !== undefined) {
            sections.push({
              heading: section.heading,
              level: section.level,
              content: section.content || '',
              startLine: section.startLine,
              endLine: index
            });
          }
        }

        // Start new section
        currentSection = {
          heading: headingMatch[2].trim(),
          level: headingMatch[1].length,
          content: '',
          startLine: index + 1,
          endLine: lines.length
        };
      } else if (currentSection) {
        currentSection.content = (currentSection.content || '') + line + '\n';
      }
    });

    // Close final section
    if (currentSection) {
      const section = currentSection as any;
      if (section.heading && section.level !== undefined) {
        sections.push({
          heading: section.heading,
          level: section.level,
          content: section.content || '',
          startLine: section.startLine,
          endLine: lines.length
        });
      }
    }

    return sections;
  }

  /**
   * Extract tasks from content
   */
  private static extractTasks(content: string): Task[] {
    const tasks: Task[] = [];
    const lines = content.split('\n');
    let currentHeading: string | undefined;

    lines.forEach((line, index) => {
      // Track current heading for context
      const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
      if (headingMatch) {
        currentHeading = headingMatch[1].trim();
        return;
      }

      // Match task syntax: - [ ] or - [x] or - [X]
      const taskMatch = line.match(/^[\s-]*\[([xX\s])\]\s+(.+)$/);
      if (taskMatch) {
        const completed = taskMatch[1].toLowerCase() === 'x';
        const taskContent = taskMatch[2].trim();

        // Extract inline tags from task
        const tagMatches = taskContent.match(/#([a-zA-Z0-9_/-]+)/g) || [];
        const taskTags = tagMatches.map(tag => tag.slice(1));

        tasks.push({
          content: taskContent,
          completed,
          line: index + 1,
          heading: currentHeading,
          tags: taskTags
        });
      }
    });

    return tasks;
  }

  /**
   * Generate frontmatter string
   */
  static stringifyFrontmatter(data: Record<string, any>): string {
    if (Object.keys(data).length === 0) return '';

    const yaml = Object.entries(data)
      .map(([key, value]) => {
        if (Array.isArray(value)) {
          if (value.length === 0) return `${key}: []`;
          return `${key}:\n${value.map(v => `  - ${v}`).join('\n')}`;
        }
        if (value instanceof Date) {
          return `${key}: ${value.toISOString()}`;
        }
        if (typeof value === 'string' && value.includes('\n')) {
          return `${key}: |\n${value.split('\n').map(l => `  ${l}`).join('\n')}`;
        }
        return `${key}: ${value}`;
      })
      .join('\n');

    return `---\n${yaml}\n---\n\n`;
  }

  /**
   * Replace a section in content
   */
  static replaceSection(content: string, heading: string, newContent: string): string {
    const lines = content.split('\n');
    const sections = this.extractSections(content);

    const section = sections.find(s =>
      s.heading.toLowerCase() === heading.toLowerCase()
    );

    if (!section) {
      // Section doesn't exist, append it
      return `${content}\n\n## ${heading}\n\n${newContent}`;
    }

    // Replace section content
    const before = lines.slice(0, section.startLine).join('\n');
    const headingLine = lines[section.startLine - 1];
    const after = section.endLine < lines.length
      ? '\n' + lines.slice(section.endLine).join('\n')
      : '';

    return `${before}${headingLine}\n\n${newContent}${after}`;
  }

  /**
   * Append content to end of note
   */
  static appendContent(content: string, addition: string): string {
    return `${content}\n\n${addition}`;
  }
}
