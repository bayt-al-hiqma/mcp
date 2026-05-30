/**
 * MCP Tool definitions
 */

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export const MEMORY_TOOLS: MCPTool[] = [
  {
    name: 'search_memories',
    description: 'Search for memories across note titles, aliases, tags, headings, and content. Returns ranked results with excerpts.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query text'
        },
        folder: {
          type: 'string',
          description: 'Optional folder to search within'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags to filter by'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 10)',
          default: 10
        }
      },
      required: ['query']
    }
  },
  {
    name: 'read_note',
    description: 'Read a note with full context including backlinks, unlinked mentions, related notes, and tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the note (with or without .md extension)'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'resolve_note',
    description: 'Resolve a note reference (path, title, alias, or wikilink) to find the actual note.',
    inputSchema: {
      type: 'object',
      properties: {
        reference: {
          type: 'string',
          description: 'Note reference (path, title, alias, or wikilink)'
        }
      },
      required: ['reference']
    }
  },
  {
    name: 'list_notes',
    description: 'List all notes in the vault or a specific folder.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: {
          type: 'string',
          description: 'Optional folder path to list notes from'
        }
      }
    }
  },
  {
    name: 'get_recent_notes',
    description: 'Get recently modified notes.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of notes to return (default: 10)',
          default: 10
        }
      }
    }
  },
  {
    name: 'append_to_daily_note',
    description: 'Append a distilled memory entry to today\'s daily note. Creates the note if it doesn\'t exist.',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Content to append to the daily note'
        },
        type: {
          type: 'string',
          enum: ['reflection', 'event', 'decision', 'plan', 'mood', 'log', 'expense', 'custom'],
          description: 'Type of daily entry',
          default: 'custom'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags for the entry'
        },
        links: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional wikilinks to related notes'
        }
      },
      required: ['content']
    }
  },
  {
    name: 'create_canonical_memory',
    description: 'Create or update a canonical memory note (durable facts, preferences, goals, relationships, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path for the canonical memory note'
        },
        title: {
          type: 'string',
          description: 'Title of the memory'
        },
        content: {
          type: 'string',
          description: 'Content of the canonical memory'
        },
        type: {
          type: 'string',
          enum: ['canonical', 'person', 'project', 'reference'],
          description: 'Type of canonical memory',
          default: 'canonical'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorization'
        },
        aliases: {
          type: 'array',
          items: { type: 'string' },
          description: 'Alternative names or aliases'
        },
        links: {
          type: 'array',
          items: { type: 'string' },
          description: 'Wikilinks to related notes'
        },
        preserveHistory: {
          type: 'boolean',
          description: 'Append historical snapshot before updating',
          default: false
        }
      },
      required: ['path', 'title', 'content']
    }
  },
  {
    name: 'create_decision_record',
    description: 'Create a decision record documenting an important choice with context, options, and rationale.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Title of the decision'
        },
        context: {
          type: 'string',
          description: 'Context and background for the decision'
        },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: 'Options that were considered'
        },
        chosen: {
          type: 'string',
          description: 'The option that was chosen'
        },
        rationale: {
          type: 'string',
          description: 'Reasoning for the choice'
        },
        consequences: {
          type: 'string',
          description: 'Expected consequences or follow-up notes'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorization'
        },
        links: {
          type: 'array',
          items: { type: 'string' },
          description: 'Wikilinks to related notes'
        }
      },
      required: ['title', 'context', 'options', 'chosen', 'rationale']
    }
  },
  {
    name: 'update_note_section',
    description: 'Update a specific section of a note by heading. Creates the section if it doesn\'t exist.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the note'
        },
        heading: {
          type: 'string',
          description: 'Heading name of the section to update'
        },
        content: {
          type: 'string',
          description: 'New content for the section'
        }
      },
      required: ['path', 'heading', 'content']
    }
  },
  {
    name: 'get_tasks',
    description: 'Get all tasks from the vault or filtered by tags, completion status, or containing note.',
    inputSchema: {
      type: 'object',
      properties: {
        notePath: {
          type: 'string',
          description: 'Optional path to get tasks from a specific note'
        },
        completed: {
          type: 'boolean',
          description: 'Filter by completion status'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by tags'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of tasks to return',
          default: 50
        }
      }
    }
  },
  {
    name: 'check_vault_health',
    description: 'Check vault health and identify issues like orphaned notes, broken links, duplicates, and stale memories.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: {
          type: 'string',
          description: 'Optional folder to check (checks entire vault if not specified)'
        }
      }
    }
  }
];
