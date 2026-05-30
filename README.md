# 🏛️ Bayt al-Hiqma - Personal Memory MCP Server

A durable, user-controlled memory layer for ChatGPT conversations, inspired by the historic House of Wisdom in Baghdad.

## Overview

Bayt al-Hiqma ("House of Wisdom") is a Model Context Protocol (MCP) server that gives ChatGPT persistent memory across conversations. Instead of relying on proprietary hosted databases, your memories are stored in plain Markdown files in your own GitHub repository - a personal knowledge vault that remains yours forever.

### Key Features

- **User-Owned Memory**: Your vault is the source of truth, stored in your GitHub repository
- **Plain Markdown**: All notes are standard Markdown with frontmatter - no proprietary formats
- **Obsidian Compatible**: Works seamlessly with Obsidian and other Markdown tools
- **Distilled Memories**: Stores concise, meaningful memories rather than raw chat transcripts
- **Rich Context**: Backlinks, unlinked mentions, related notes, tasks, and graph awareness
- **Daily Notes**: Append-oriented records for day-specific reflections and events
- **Canonical Memories**: Durable source-of-truth records for preferences, goals, and facts
- **Decision Records**: Document important choices with context and rationale
- **Vault Health**: Identify orphaned notes, broken links, duplicates, and stale memories
- **Vercel Ready**: Deploy as a serverless function with HTTPS MCP endpoint

## Quick Start

### 1. Prerequisites

- Node.js 18+ installed
- A GitHub repository to use as your memory vault
- GitHub personal access token with `repo` permissions
- Vercel account (for deployment)

### 2. Local Development

```bash
# Clone the repository
git clone https://github.com/maazghani/bayt-al-hiqma.git
cd bayt-al-hiqma

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your configuration
# - VAULT_OWNER: Your GitHub username
# - VAULT_REPO: Your vault repository name
# - GITHUB_TOKEN: Your GitHub personal access token
# - MCP_AUTH_SECRET: A random secret for authentication

# Build the project
npm run build

# Start development server
npm run dev
```

The server will be available at `http://localhost:3000`

### 3. Deploy to Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel

# Set environment variables in Vercel dashboard:
# - VAULT_OWNER
# - VAULT_REPO
# - GITHUB_TOKEN
# - MCP_AUTH_SECRET
# - (optional) VAULT_BRANCH, VAULT_ROOT, DAILY_NOTES_DIR

# Redeploy with environment variables
vercel --prod
```

### 4. Connect to ChatGPT

1. Get your Vercel deployment URL (e.g., `https://your-app.vercel.app`)
2. In ChatGPT settings, add a custom MCP server:
   - **Name**: Personal Memory
   - **URL**: `https://your-app.vercel.app/mcp`
   - **Authentication**: Bearer token using your `MCP_AUTH_SECRET`

## Configuration

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| `VAULT_OWNER` | GitHub username or organization |
| `VAULT_REPO` | GitHub repository name for your vault |
| `GITHUB_TOKEN` | GitHub personal access token with repo access |
| `MCP_AUTH_SECRET` | Secret token for MCP authentication |

### Optional Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VAULT_BRANCH` | `main` | Git branch to use |
| `VAULT_ROOT` | `""` | Root directory in repository |
| `DAILY_NOTES_DIR` | `daily` | Directory for daily notes |
| `MAX_FILE_SIZE` | `1048576` | Maximum file size in bytes (1MB) |
| `MAX_SEARCH_RESULTS` | `50` | Maximum search results to return |
| `MAX_GRAPH_NODES` | `100` | Maximum nodes in graph queries |

## Available Tools

The MCP server provides these tools to ChatGPT:

### Discovery & Retrieval

- **`search_memories`** - Search across note titles, aliases, tags, headings, and content
- **`read_note`** - Read a note with full context (backlinks, mentions, related notes)
- **`resolve_note`** - Find a note by path, title, alias, or wikilink
- **`list_notes`** - List all notes in the vault or a folder
- **`get_recent_notes`** - Get recently modified notes

### Memory Capture

- **`append_to_daily_note`** - Add distilled entry to today's daily note
- **`create_canonical_memory`** - Create or update canonical memory notes
- **`create_decision_record`** - Document important decisions
- **`update_note_section`** - Update a specific section by heading

### Vault Stewardship

- **`get_tasks`** - Get tasks from notes (all or filtered)
- **`check_vault_health`** - Identify orphans, broken links, duplicates, stale memories

## Architecture

```
src/
├── index.ts                 # HTTP server and routes
├── types/                   # TypeScript type definitions
├── lib/
│   ├── config.ts           # Configuration loader
│   ├── path-safety.ts      # Path validation and sanitization
│   ├── markdown-parser.ts  # Markdown parsing and manipulation
│   ├── vault.ts            # GitHub vault backend
│   ├── memory-store.ts     # High-level memory operations
│   └── mcp-server.ts       # MCP JSON-RPC protocol
└── tools/
    ├── definitions.ts      # MCP tool schemas
    └── handlers.ts         # Tool implementation

```

## Memory Model

### Note Types

- **Daily Notes**: Append-oriented daily logs with reflections, events, plans, and decisions
- **Canonical Memories**: Source-of-truth records for preferences, goals, relationships, projects
- **Decision Records**: Important choices with context, options, rationale, and consequences
- **Person Notes**: Information about relationships and people
- **Project Notes**: Ongoing project documentation
- **Reference Notes**: General reference material

### Note Structure

Each note supports:
- **Frontmatter**: YAML metadata (title, type, tags, aliases, dates)
- **Wikilinks**: `[[note name]]` or `[[note name|alias]]`
- **Markdown links**: `[text](path.md)`
- **Tags**: `#tag` inline or in frontmatter
- **Tasks**: `- [ ]` uncompleted, `- [x]` completed
- **Sections**: Headed sections for targeted updates
- **History**: Optional snapshots for canonical memories

## Usage Examples

### Daily Reflection
```json
{
  "tool": "append_to_daily_note",
  "arguments": {
    "content": "Had a productive morning working on the MCP server. Feeling energized.",
    "type": "reflection",
    "tags": ["mood", "productivity"]
  }
}
```

### Create Canonical Memory
```json
{
  "tool": "create_canonical_memory",
  "arguments": {
    "path": "preferences/coffee.md",
    "title": "Coffee Preferences",
    "content": "I prefer light roast coffee, single origin from Ethiopia or Kenya. Best brewing method is pour-over with 1:16 ratio.",
    "type": "canonical",
    "tags": ["preferences", "food"]
  }
}
```

### Record Decision
```json
{
  "tool": "create_decision_record",
  "arguments": {
    "title": "Chose TypeScript for MCP Server",
    "context": "Need to build a robust MCP server with good type safety",
    "options": ["TypeScript", "Python", "Go"],
    "chosen": "TypeScript",
    "rationale": "Best MCP SDK support, familiar ecosystem, excellent Vercel integration",
    "tags": ["technical", "architecture"]
  }
}
```

### Search Memories
```json
{
  "tool": "search_memories",
  "arguments": {
    "query": "coffee preferences",
    "limit": 5
  }
}
```

## Security

- **Authentication**: Bearer token authentication required for MCP endpoint
- **Path Safety**: All vault paths validated to prevent traversal attacks
- **Secret Handling**: Tokens never exposed in responses or client-side code
- **Write Safety**: Conflict detection, auditable through Git history
- **Privacy**: Bounded queries prevent exposing entire vault unnecessarily

## Testing

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Type checking
npm run type-check

# Linting
npm run lint
```

## API Endpoints

### POST /mcp or /api/mcp
MCP JSON-RPC endpoint for ChatGPT. Requires Bearer token authentication.

### GET /health or /api/health
Health check endpoint. Returns configuration and vault status.

### GET /
Landing page with setup instructions and documentation.

## Development

### Project Structure

The codebase follows the specification in `SPEC.md`:
- Clean separation between vault backend, parsing, and protocol layers
- Type-safe interfaces throughout
- Modular tool handlers
- Comprehensive path safety validation
- GitHub-based durable storage

### Adding New Tools

1. Add tool definition to `src/tools/definitions.ts`
2. Implement handler in `src/tools/handlers.ts`
3. Tool will be automatically exposed via MCP protocol

## Troubleshooting

### Configuration Errors
- Check `/health` endpoint for configuration status
- Verify all required environment variables are set
- Ensure GitHub token has correct repository permissions

### Vault Access Issues
- Verify `VAULT_OWNER` and `VAULT_REPO` are correct
- Check GitHub token hasn't expired
- Ensure repository exists and is accessible

### Authentication Failures
- Verify `MCP_AUTH_SECRET` matches in both server and ChatGPT config
- Check Authorization header format: `Bearer <token>`

## Contributing

Contributions are welcome! Please:
1. Follow the existing code style
2. Add tests for new functionality
3. Update documentation
4. Ensure all tests pass

## License

MIT License - see LICENSE file for details

## Acknowledgments

Inspired by:
- The historic Bayt al-Hiqma (House of Wisdom) in Baghdad
- Obsidian's personal knowledge management philosophy
- The Model Context Protocol (MCP) specification
- Codex-style persistent memories for assistants

---

**Note**: This implementation follows the complete specification in `SPEC.md`, providing a production-ready personal memory system for ChatGPT with full Vercel deployment support.
