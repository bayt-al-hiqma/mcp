# Bayt al-Hiqma Personal Memory MCP

Bayt al-Hiqma is a Vercel-ready MCP server for daily ChatGPT memory. It exposes a JSON-RPC MCP endpoint that can be protected with a simple single-user OAuth flow. The server reads and writes a user-owned Markdown vault, preserving notes as plain Markdown with common frontmatter so the vault remains usable in Obsidian or any editor.

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

Deploy to Vercel with server-side environment variables. For the simplest single-user ChatGPT setup, set an owner password for the consent page and a random token-signing secret; ChatGPT completes the OAuth authorization-code flow and then calls `/api/mcp` with a bearer token.

| Variable | Purpose |
| --- | --- |
| `OAUTH_OWNER_PASSWORD` | Required for OAuth. Password you enter on `/oauth/authorize` when ChatGPT connects. |
| `OAUTH_TOKEN_SECRET` | Required for OAuth. Long random secret for signing authorization codes and access tokens. Generate with `openssl rand -hex 32`. |
| `OAUTH_BASE_URL` | Public app origin, for example `https://your-app.vercel.app`. Recommended so OAuth metadata uses stable URLs. |
| `OAUTH_RESOURCE` | Optional MCP resource URL; defaults to `${OAUTH_BASE_URL}/api/mcp`. |
| `OAUTH_CLIENT_ID` | Optional allowlist for one OAuth client ID. Leave unset unless you need to pin a client. |
| `OAUTH_CODE_TTL_SECONDS` | Optional authorization-code lifetime; defaults to 300. |
| `OAUTH_TOKEN_TTL_SECONDS` | Optional access-token lifetime; defaults to 3600. |
| `DIAGNOSTICS_TOKEN` | Optional bearer token for `/api/diagnostics`. |
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

In ChatGPT, add the MCP server URL `https://your-app.vercel.app/api/mcp` and choose OAuth. On first connect, ChatGPT opens the authorization page; enter `OAUTH_OWNER_PASSWORD` to approve this single-user server.

## Endpoints

- `POST /api/mcp`: MCP JSON-RPC over HTTPS; requires `Authorization: Bearer <access_token>` when OAuth is enabled.
- `GET /api/mcp`: public MCP endpoint metadata, including OAuth resource metadata when enabled.
- `GET /.well-known/oauth-protected-resource`: OAuth protected-resource metadata for ChatGPT discovery.
- `GET /.well-known/oauth-authorization-server`: OAuth authorization-server metadata.
- `GET /oauth/authorize`: owner-password authorization page.
- `POST /oauth/authorize`: validates `OAUTH_OWNER_PASSWORD` and issues an authorization code.
- `POST /oauth/token`: exchanges an authorization code plus PKCE verifier for an access token.
- `GET /api/health`: public configuration health check without secrets.
- `GET /api/diagnostics`: redacted diagnostics; send `Authorization: Bearer <DIAGNOSTICS_TOKEN>` only if `DIAGNOSTICS_TOKEN` is set.
- `/`: setup page describing configuration and ChatGPT connection.

## Verification

```bash
npm test
npm run typecheck
npm run build
```

Local OAuth smoke test:

```bash
export OAUTH_BASE_URL=http://localhost:3000
export OAUTH_OWNER_PASSWORD=change-me
export OAUTH_TOKEN_SECRET="$(openssl rand -hex 32)"
export VAULT_BACKEND=local
export LOCAL_VAULT_DIR=./vault
npm run dev
```

In another shell:

```bash
curl -i "$OAUTH_BASE_URL/.well-known/oauth-protected-resource"
curl -i "$OAUTH_BASE_URL/.well-known/oauth-authorization-server"
curl -i -X POST "$OAUTH_BASE_URL/api/mcp" \
  -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","id":1,"method":"ping"}'
```

The MCP smoke request should return `401 Unauthorized` with a `WWW-Authenticate` header until ChatGPT completes OAuth and sends a bearer token.

## ChatGPT usage guidance

Instruct ChatGPT to retrieve memories before relying on personal context, store only durable value, prefer daily notes for day-specific reflections, prefer canonical updates for durable facts, record meaningful commitments as decision records, and avoid irreversible cleanup.
