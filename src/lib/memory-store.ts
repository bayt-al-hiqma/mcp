/**
 * Memory store - Main interface for memory operations
 */

import { Config, Note, SearchResult, NoteContext, BacklinkInfo, UnlinkedMention } from '../types/index.js';
import { GitHubVault } from './vault.js';
import { MarkdownParser } from './markdown-parser.js';
import { ensureMarkdownExtension, stripMarkdownExtension, getFilenameWithoutExtension } from './path-safety.js';

export class MemoryStore {
  private vault: GitHubVault;
  private config: Config;
  private notesCache: Map<string, Note> = new Map();

  constructor(config: Config) {
    this.config = config;
    this.vault = new GitHubVault(config);
  }

  /**
   * Get a note by path
   */
  async getNote(path: string): Promise<Note> {
    const mdPath = ensureMarkdownExtension(path);

    const content = await this.vault.readFile(mdPath);
    const note = MarkdownParser.parse(mdPath, content);
    this.notesCache.set(mdPath, note);

    return note;
  }

  /**
   * Resolve a note reference (path, title, alias, wikilink)
   */
  async resolveNote(reference: string): Promise<Note | null> {
    // Try direct path match
    try {
      const mdPath = ensureMarkdownExtension(reference);
      return await this.getNote(mdPath);
    } catch {
      // Continue to other resolution methods
    }

    // Search for the note
    const results = await this.searchNotes(reference, { limit: 5 });

    // Exact title match
    const exactMatch = results.find(r =>
      r.title.toLowerCase() === reference.toLowerCase() ||
      r.matchType === 'alias'
    );

    if (exactMatch) {
      return await this.getNote(exactMatch.path);
    }

    // No match found
    return null;
  }

  /**
   * Search notes
   */
  async searchNotes(
    query: string,
    options: {
      folder?: string;
      tags?: string[];
      limit?: number;
      type?: string;
    } = {}
  ): Promise<SearchResult[]> {
    const allFiles = await this.vault.listFiles(options.folder);
    const results: SearchResult[] = [];

    const lowerQuery = query.toLowerCase();
    const limit = options.limit || this.config.maxSearchResults;

    for (const path of allFiles) {
      try {
        const note = await this.getNote(path);

        // Filter by type if specified
        if (options.type && note.type !== options.type) {
          continue;
        }

        // Filter by tags if specified
        if (options.tags && !options.tags.some(tag => note.tags.includes(tag))) {
          continue;
        }

        let score = 0;
        let matchType: SearchResult['matchType'] = 'content';
        let matchContext: string | undefined;

        // Title match (highest priority)
        if (note.title.toLowerCase().includes(lowerQuery)) {
          score += 100;
          matchType = 'title';
          matchContext = note.title;
        }

        // Alias match
        if (note.aliases.some(alias => alias.toLowerCase().includes(lowerQuery))) {
          score += 80;
          matchType = 'alias';
          matchContext = note.aliases.find(a => a.toLowerCase().includes(lowerQuery));
        }

        // Tag match
        if (note.tags.some(tag => tag.toLowerCase().includes(lowerQuery))) {
          score += 60;
          matchType = 'tag';
          matchContext = note.tags.find(t => t.toLowerCase().includes(lowerQuery));
        }

        // Heading match
        const matchingHeading = note.sections.find(s =>
          s.heading.toLowerCase().includes(lowerQuery)
        );
        if (matchingHeading) {
          score += 40;
          matchType = 'heading';
          matchContext = matchingHeading.heading;
        }

        // Content match
        if (note.content.toLowerCase().includes(lowerQuery)) {
          score += 20;
          matchType = 'content';

          // Extract excerpt around match
          const index = note.content.toLowerCase().indexOf(lowerQuery);
          const start = Math.max(0, index - 50);
          const end = Math.min(note.content.length, index + query.length + 50);
          matchContext = '...' + note.content.slice(start, end) + '...';
        }

        if (score > 0) {
          results.push({
            path: note.path,
            title: note.title,
            score,
            matchType,
            matchContext,
            excerpt: note.content.slice(0, 200)
          });
        }
      } catch (error) {
        console.error(`Error processing ${path}:`, error);
      }
    }

    // Sort by score and return limited results
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Get note with full context
   */
  async getNoteContext(path: string): Promise<NoteContext> {
    const note = await this.getNote(path);
    const allFiles = await this.vault.listFiles();

    const backlinks: BacklinkInfo[] = [];
    const unlinkedMentions: UnlinkedMention[] = [];
    const brokenLinks: string[] = [];

    // Check each link target
    for (const link of note.links) {
      const targetExists = await this.resolveNote(link.target);
      if (!targetExists) {
        brokenLinks.push(link.target);
      }
    }

    // Find backlinks and unlinked mentions
    for (const filePath of allFiles) {
      if (filePath === path) continue;

      try {
        const otherNote = await this.getNote(filePath);

        // Check for explicit links
        const linkedToThis = otherNote.links.some(link => {
          const resolved = stripMarkdownExtension(link.target);
          return resolved === stripMarkdownExtension(path) ||
                 resolved === stripMarkdownExtension(note.title);
        });

        if (linkedToThis) {
          const linkLine = otherNote.links.find(l =>
            stripMarkdownExtension(l.target) === stripMarkdownExtension(path)
          );

          backlinks.push({
            sourcePath: otherNote.path,
            sourceTitle: otherNote.title,
            context: this.getLineContext(otherNote.content, linkLine?.line || 1),
            line: linkLine?.line || 1
          });
        }

        // Check for unlinked mentions
        const noteTitle = note.title.toLowerCase();
        if (otherNote.content.toLowerCase().includes(noteTitle) && !linkedToThis) {
          const lines = otherNote.content.split('\n');
          lines.forEach((line, idx) => {
            if (line.toLowerCase().includes(noteTitle)) {
              unlinkedMentions.push({
                sourcePath: otherNote.path,
                sourceTitle: otherNote.title,
                context: line,
                line: idx + 1
              });
            }
          });
        }
      } catch (error) {
        // Skip notes that can't be read
      }
    }

    // Check if note is orphaned (no backlinks and no links out)
    const orphan = backlinks.length === 0 && note.links.length === 0;

    // Find related notes based on shared tags
    const relatedNotes = await this.findRelatedNotes(note);

    return {
      note,
      backlinks,
      unlinkedMentions,
      relatedNotes,
      orphan,
      brokenLinks
    };
  }

  /**
   * Find related notes based on tags and links
   */
  private async findRelatedNotes(note: Note): Promise<SearchResult[]> {
    const related: SearchResult[] = [];

    if (note.tags.length > 0) {
      for (const tag of note.tags.slice(0, 3)) { // Limit to first 3 tags
        const tagged = await this.searchNotes(tag, { limit: 5 });
        related.push(...tagged.filter(r => r.path !== note.path));
      }
    }

    return related.slice(0, this.config.maxSearchResults);
  }

  /**
   * Get context around a line
   */
  private getLineContext(content: string, lineNum: number, contextLines: number = 1): string {
    const lines = content.split('\n');
    const start = Math.max(0, lineNum - contextLines - 1);
    const end = Math.min(lines.length, lineNum + contextLines);
    return lines.slice(start, end).join('\n');
  }

  /**
   * List all notes
   */
  async listNotes(folder?: string): Promise<SearchResult[]> {
    const files = await this.vault.listFiles(folder);
    const results: SearchResult[] = [];

    for (const path of files) {
      try {
        const note = await this.getNote(path);
        results.push({
          path: note.path,
          title: note.title,
          score: 0,
          matchType: 'title',
          excerpt: note.content.slice(0, 200)
        });
      } catch (error) {
        console.error(`Error listing ${path}:`, error);
      }
    }

    return results;
  }

  /**
   * Get recently modified notes
   */
  async getRecentNotes(limit: number = 10): Promise<SearchResult[]> {
    const recent = await this.vault.getRecentlyModified(limit);
    const results: SearchResult[] = [];

    for (const { path } of recent) {
      try {
        const note = await this.getNote(path);
        results.push({
          path: note.path,
          title: note.title,
          score: 0,
          matchType: 'title',
          excerpt: note.content.slice(0, 200)
        });
      } catch (error) {
        console.error(`Error fetching ${path}:`, error);
      }
    }

    return results;
  }

  /**
   * Write a note
   */
  async writeNote(
    path: string,
    content: string,
    message: string,
    expectedSha?: string
  ): Promise<void> {
    const mdPath = ensureMarkdownExtension(path);

    // Check for conflicts if expectedSha is provided
    if (expectedSha) {
      const currentSha = await this.vault.getFileSha(mdPath);
      if (currentSha && currentSha !== expectedSha) {
        throw new Error(`Write conflict: File has been modified since read`);
      }
    }

    await this.vault.writeFile(mdPath, content, message, expectedSha);

    // Clear cache for this note
    this.notesCache.delete(mdPath);
  }

  /**
   * Append to a note
   */
  async appendToNote(path: string, addition: string, message: string): Promise<void> {
    const note = await this.getNote(path);
    const newContent = MarkdownParser.appendContent(note.content, addition);
    const fullContent = MarkdownParser.stringifyFrontmatter(note.frontmatter) + newContent;

    const sha = await this.vault.getFileSha(path);
    await this.writeNote(path, fullContent, message, sha || undefined);
  }

  /**
   * Update a section in a note
   */
  async updateSection(
    path: string,
    heading: string,
    content: string,
    message: string
  ): Promise<void> {
    const note = await this.getNote(path);
    const newContent = MarkdownParser.replaceSection(note.content, heading, content);
    const fullContent = MarkdownParser.stringifyFrontmatter(note.frontmatter) + newContent;

    const sha = await this.vault.getFileSha(path);
    await this.writeNote(path, fullContent, message, sha || undefined);
  }

  /**
   * Check vault health
   */
  async checkHealth(): Promise<{ accessible: boolean; error?: string }> {
    return await this.vault.checkHealth();
  }
}
