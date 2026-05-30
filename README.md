# Bayt al-Hiqma Personal Memory MCP

Bayt al-Hiqma is a Vercel-ready MCP server for daily ChatGPT memory. It exposes a JSON-RPC endpoint with no MCP authentication for ChatGPT compatibility. The server reads and writes a user-owned Markdown vault, preserving notes as plain Markdown with common frontmatter so the vault remains usable in Obsidian or any editor.

## Features

- MCP JSON-RPC methods: `initialize`, `ping`, `tools/list`, and `tools/call`.
- Tools for memory search, read context, note resolution, recent notes, daily-note appends, safe note creation, canonical memory upserts, decision records, section updates, historical snapshots, task listing, graph inspection, health checks, and diagnostics.
- Markdown awareness for frontmatter, aliases, tags, headings, wikilinks, Markdown links, tasks, excerpts, backlinks, missing links, orphans, duplicate titles, and stale canonical memories.
- Path traversal rejection, overwrite prevention, conflict detection through local mtimes or GitHub blob SHAs, and bounded result limits.
- GitHub vault backend for serverless Vercel deployments plus a local backend for development and tests.

## Local development

```bash
npm install
cp .env.example .env.local
# set VAULT_BACKEND=local and LOCAL_VAULT_DIR
npm run dev
```

Useful commands:

```bash
npm test
npm run typecheck
npm run build
```

## Deployment

Deploy to Vercel with server-side environment variables. Because ChatGPT MCP currently supports OAuth or no auth (not arbitrary bearer-token auth), this implementation uses no auth for `/api/mcp`; keep the deployment URL private or put OAuth/gateway protection in front if required:

| Variable | Purpose |
| --- | --- |
| `DIAGNOSTICS_TOKEN` | Optional bearer token for `/api/diagnostics`; `/api/mcp` is intentionally no-auth for ChatGPT compatibility. |
| `VAULT_BACKEND` | Use `github` on Vercel. |
| `GITHUB_TOKEN` | Token that can read/write the Markdown vault repository. |
| `GITHUB_OWNER` | Vault repository owner or organization. |
| `GITHUB_REPO` | Vault repository name. |
| `GITHUB_BRANCH` | Branch target, defaults to `main`. |
| `VAULT_ROOT` | Optional root path inside the repository. |
| `DAILY_NOTES_DIR` | Daily-note folder, defaults to `Daily`. |
| `CANONICAL_NOTES_DIR` | Canonical memory folder, defaults to `Memories`. |
| `DECISIONS_DIR` | Decision record folder, defaults to `Decisions`. |
| `SEARCH_RESULT_LIMIT` | Default search/list result bound. |
| `GRAPH_RESULT_LIMIT` | Default graph context bound. |
| `MAX_FILE_SIZE_BYTES` | Maximum Markdown file size to process. |

The durable vault should be GitHub or another future remote backend in production; the local filesystem backend is intended for development and automated tests.

## Endpoints

- `POST /api/mcp`: MCP JSON-RPC over HTTPS. Configure ChatGPT with **No authentication**.
- `GET /api/health`: public configuration health check without secrets.
- `GET /api/diagnostics`: redacted diagnostics; send `Authorization: Bearer <DIAGNOSTICS_TOKEN>` only if `DIAGNOSTICS_TOKEN` is set.
- `/`: setup page describing configuration and ChatGPT connection.

## ChatGPT usage guidance

Instruct ChatGPT to retrieve memories before relying on personal context, store only durable value, prefer daily notes for day-specific reflections, prefer canonical updates for durable facts, record meaningful commitments as decision records, and avoid irreversible cleanup.
