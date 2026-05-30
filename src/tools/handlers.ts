/**
 * MCP Tool handlers
 */

import { MemoryStore } from '../lib/memory-store.js';
import { MarkdownParser } from '../lib/markdown-parser.js';
import { getDailyNotePath, ensureMarkdownExtension } from '../lib/path-safety.js';
import { Config, VaultHealth } from '../types/index.js';

export class ToolHandlers {
  private store: MemoryStore;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    this.store = new MemoryStore(config);
  }

  async handleSearchMemories(args: any) {
    const results = await this.store.searchNotes(args.query, {
      folder: args.folder,
      tags: args.tags,
      limit: args.limit || 10
    });

    return {
      results: results.map(r => ({
        path: r.path,
        title: r.title,
        matchType: r.matchType,
        matchContext: r.matchContext,
        excerpt: r.excerpt
      })),
      count: results.length
    };
  }

  async handleReadNote(args: any) {
    const context = await this.store.getNoteContext(args.path);

    return {
      note: {
        path: context.note.path,
        title: context.note.title,
        aliases: context.note.aliases,
        tags: context.note.tags,
        type: context.note.type,
        created: context.note.created?.toISOString(),
        updated: context.note.updated?.toISOString(),
        content: context.note.content,
        links: context.note.links,
        tasks: context.note.tasks,
        sections: context.note.sections.map(s => ({
          heading: s.heading,
          level: s.level
        }))
      },
      context: {
        backlinks: context.backlinks,
        unlinkedMentions: context.unlinkedMentions.slice(0, 10), // Limit to avoid overflow
        relatedNotes: context.relatedNotes.slice(0, 5),
        orphan: context.orphan,
        brokenLinks: context.brokenLinks
      }
    };
  }

  async handleResolveNote(args: any) {
    const note = await this.store.resolveNote(args.reference);

    if (!note) {
      return {
        found: false,
        message: `No note found for reference: ${args.reference}`
      };
    }

    return {
      found: true,
      note: {
        path: note.path,
        title: note.title,
        aliases: note.aliases,
        tags: note.tags,
        excerpt: note.content.slice(0, 200)
      }
    };
  }

  async handleListNotes(args: any) {
    const notes = await this.store.listNotes(args.folder);

    return {
      notes: notes.map(n => ({
        path: n.path,
        title: n.title,
        excerpt: n.excerpt
      })),
      count: notes.length
    };
  }

  async handleGetRecentNotes(args: any) {
    const notes = await this.store.getRecentNotes(args.limit || 10);

    return {
      notes: notes.map(n => ({
        path: n.path,
        title: n.title,
        excerpt: n.excerpt
      })),
      count: notes.length
    };
  }

  async handleAppendToDailyNote(args: any) {
    const today = new Date();
    const dailyPath = getDailyNotePath(today, this.config.dailyNotesDir);

    // Try to read existing daily note
    let existingNote;
    try {
      existingNote = await this.store.getNote(dailyPath);
    } catch {
      // Note doesn't exist, will create it
      existingNote = null;
    }

    const timestamp = today.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });

    let entryContent = `### ${timestamp} - ${args.type || 'Entry'}\n\n${args.content}`;

    // Add tags if provided
    if (args.tags && args.tags.length > 0) {
      entryContent += `\n\n${args.tags.map((t: string) => `#${t}`).join(' ')}`;
    }

    // Add links if provided
    if (args.links && args.links.length > 0) {
      entryContent += `\n\n${args.links.map((l: string) => `[[${l}]]`).join(' ')}`;
    }

    if (existingNote) {
      // Append to existing note
      await this.store.appendToNote(
        dailyPath,
        entryContent,
        `Add ${args.type || 'entry'} to daily note`
      );
    } else {
      // Create new daily note
      const frontmatter = MarkdownParser.stringifyFrontmatter({
        title: `Daily Note - ${today.toISOString().split('T')[0]}`,
        type: 'daily',
        created: today.toISOString(),
        tags: ['daily']
      });

      const content = frontmatter + `# ${today.toISOString().split('T')[0]}\n\n${entryContent}`;

      await this.store.writeNote(
        dailyPath,
        content,
        'Create daily note'
      );
    }

    return {
      success: true,
      path: dailyPath,
      message: `Entry added to daily note`
    };
  }

  async handleCreateCanonicalMemory(args: any) {
    const path = ensureMarkdownExtension(args.path);

    // Check if note exists
    let existingNote;
    let sha;
    try {
      existingNote = await this.store.getNote(path);
      // Note exists - will update
      const vaultSha = await this.store['vault'].getFileSha(path);
      sha = vaultSha || undefined;
    } catch {
      // Note doesn't exist - will create
      existingNote = null;
    }

    const frontmatter: any = {
      title: args.title,
      type: args.type || 'canonical',
      updated: new Date().toISOString()
    };

    if (!existingNote) {
      frontmatter.created = new Date().toISOString();
    }

    if (args.tags) frontmatter.tags = args.tags;
    if (args.aliases) frontmatter.aliases = args.aliases;

    let content = `# ${args.title}\n\n${args.content}`;

    // Add links if provided
    if (args.links && args.links.length > 0) {
      content += `\n\n## Related\n\n${args.links.map((l: string) => `- [[${l}]]`).join('\n')}`;
    }

    // Preserve history if requested and note exists
    if (args.preserveHistory && existingNote) {
      const historyEntry = `\n\n## History\n\n### ${new Date().toISOString()}\n\nPrevious version:\n\n${existingNote.content}`;
      content += historyEntry;
    }

    const fullContent = MarkdownParser.stringifyFrontmatter(frontmatter) + content;

    await this.store.writeNote(
      path,
      fullContent,
      existingNote ? `Update canonical memory: ${args.title}` : `Create canonical memory: ${args.title}`,
      sha
    );

    return {
      success: true,
      path,
      action: existingNote ? 'updated' : 'created',
      message: `Canonical memory ${existingNote ? 'updated' : 'created'}: ${args.title}`
    };
  }

  async handleCreateDecisionRecord(args: any) {
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0];
    const slug = args.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const path = `decisions/${dateStr}-${slug}.md`;

    const frontmatter = MarkdownParser.stringifyFrontmatter({
      title: args.title,
      type: 'decision',
      date: date.toISOString(),
      tags: args.tags || ['decision']
    });

    let content = `# ${args.title}\n\n`;
    content += `**Date:** ${dateStr}\n\n`;
    content += `## Context\n\n${args.context}\n\n`;
    content += `## Options Considered\n\n${args.options.map((opt: string) => `- ${opt}`).join('\n')}\n\n`;
    content += `## Decision\n\n${args.chosen}\n\n`;
    content += `## Rationale\n\n${args.rationale}\n\n`;

    if (args.consequences) {
      content += `## Consequences\n\n${args.consequences}\n\n`;
    }

    if (args.links && args.links.length > 0) {
      content += `## Related\n\n${args.links.map((l: string) => `- [[${l}]]`).join('\n')}\n\n`;
    }

    const fullContent = frontmatter + content;

    await this.store.writeNote(
      path,
      fullContent,
      `Create decision record: ${args.title}`
    );

    return {
      success: true,
      path,
      message: `Decision record created: ${args.title}`
    };
  }

  async handleUpdateNoteSection(args: any) {
    await this.store.updateSection(
      args.path,
      args.heading,
      args.content,
      `Update section '${args.heading}' in ${args.path}`
    );

    return {
      success: true,
      path: args.path,
      heading: args.heading,
      message: `Section '${args.heading}' updated`
    };
  }

  async handleGetTasks(args: any) {
    const tasks: any[] = [];

    if (args.notePath) {
      // Get tasks from specific note
      const note = await this.store.getNote(args.notePath);
      note.tasks.forEach(task => {
        if (args.completed !== undefined && task.completed !== args.completed) {
          return;
        }
        if (args.tags && !args.tags.some((t: string) => task.tags.includes(t))) {
          return;
        }
        tasks.push({
          content: task.content,
          completed: task.completed,
          notePath: note.path,
          noteTitle: note.title,
          heading: task.heading,
          line: task.line,
          tags: task.tags
        });
      });
    } else {
      // Get tasks from all notes
      const allNotes = await this.store.listNotes();
      for (const noteResult of allNotes) {
        const note = await this.store.getNote(noteResult.path);
        note.tasks.forEach(task => {
          if (args.completed !== undefined && task.completed !== args.completed) {
            return;
          }
          if (args.tags && !args.tags.some((t: string) => task.tags.includes(t))) {
            return;
          }
          tasks.push({
            content: task.content,
            completed: task.completed,
            notePath: note.path,
            noteTitle: note.title,
            heading: task.heading,
            line: task.line,
            tags: task.tags
          });
        });

        if (tasks.length >= (args.limit || 50)) {
          break;
        }
      }
    }

    return {
      tasks: tasks.slice(0, args.limit || 50),
      count: tasks.length
    };
  }

  async handleCheckVaultHealth(args: any) {
    const allNotes = await this.store.listNotes(args.folder);
    const health: VaultHealth = {
      totalNotes: allNotes.length,
      orphanedNotes: [],
      brokenLinks: [],
      duplicateTitles: [],
      staleCanonicalMemories: [],
      sparseStubs: []
    };

    const titleMap = new Map<string, string[]>();

    for (const noteResult of allNotes) {
      try {
        const context = await this.store.getNoteContext(noteResult.path);

        // Check for orphans
        if (context.orphan) {
          health.orphanedNotes.push(context.note.path);
        }

        // Collect broken links
        context.brokenLinks.forEach(target => {
          health.brokenLinks.push({
            source: context.note.path,
            target
          });
        });

        // Check for duplicates
        const title = context.note.title.toLowerCase();
        if (!titleMap.has(title)) {
          titleMap.set(title, []);
        }
        titleMap.get(title)!.push(context.note.path);

        // Check for sparse stubs (very short notes)
        if (context.note.content.length < 100 && context.note.sections.length <= 1) {
          health.sparseStubs.push(context.note.path);
        }

        // Check for stale canonical memories (not updated in 6 months)
        if (context.note.type === 'canonical' && context.note.updated) {
          const sixMonthsAgo = new Date();
          sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
          if (context.note.updated < sixMonthsAgo) {
            health.staleCanonicalMemories.push(context.note.path);
          }
        }
      } catch (error) {
        console.error(`Error checking health for ${noteResult.path}:`, error);
      }
    }

    // Find duplicate titles
    titleMap.forEach((paths, title) => {
      if (paths.length > 1) {
        health.duplicateTitles.push({ title, paths });
      }
    });

    return {
      health,
      summary: {
        totalNotes: health.totalNotes,
        orphanCount: health.orphanedNotes.length,
        brokenLinkCount: health.brokenLinks.length,
        duplicateCount: health.duplicateTitles.length,
        staleCount: health.staleCanonicalMemories.length,
        stubCount: health.sparseStubs.length
      }
    };
  }

  async callTool(name: string, args: any): Promise<any> {
    switch (name) {
      case 'search_memories':
        return await this.handleSearchMemories(args);
      case 'read_note':
        return await this.handleReadNote(args);
      case 'resolve_note':
        return await this.handleResolveNote(args);
      case 'list_notes':
        return await this.handleListNotes(args);
      case 'get_recent_notes':
        return await this.handleGetRecentNotes(args);
      case 'append_to_daily_note':
        return await this.handleAppendToDailyNote(args);
      case 'create_canonical_memory':
        return await this.handleCreateCanonicalMemory(args);
      case 'create_decision_record':
        return await this.handleCreateDecisionRecord(args);
      case 'update_note_section':
        return await this.handleUpdateNoteSection(args);
      case 'get_tasks':
        return await this.handleGetTasks(args);
      case 'check_vault_health':
        return await this.handleCheckVaultHealth(args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}
