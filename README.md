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
| `OAUTH_REFRESH_TOKEN_TTL_SECONDS` | Optional refresh-token lifetime; defaults to 2592000 (30 days). |
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
- `GET /.well-known/oauth-authorization-server`: OAuth authorization-server metadata; includes `registration_endpoint` when dynamic client registration is enabled.
- `POST /oauth/register`: Dynamic client registration endpoint (RFC 7591); enabled when `OAUTH_CLIENT_ID` is not set.
- `GET /oauth/authorize`: owner-password authorization page.
- `POST /oauth/authorize`: validates `OAUTH_OWNER_PASSWORD` and issues an authorization code.
- `POST /oauth/token`: exchanges an authorization code plus PKCE verifier for access and refresh tokens; also refreshes access tokens with `grant_type=refresh_token`.
- `GET /api/health`: public configuration health check without secrets.
- `GET /api/diagnostics`: redacted diagnostics; send `Authorization: Bearer <DIAGNOSTICS_TOKEN>` only if `DIAGNOSTICS_TOKEN` is set.
- `/`: setup page describing configuration and ChatGPT connection.

## Dynamic Client Registration (RFC 7591)

The server supports OAuth Dynamic Client Registration per RFC 7591, enabling clients like GitHub Copilot, Codex CLI, and other MCP-compatible tools to register themselves automatically without pre-configuration.

### When is dynamic registration enabled?

Dynamic client registration is enabled when:
1. OAuth is enabled (`OAUTH_TOKEN_SECRET` and `OAUTH_OWNER_PASSWORD` are set)
2. No static client is pinned via `OAUTH_CLIENT_ID`

When `OAUTH_CLIENT_ID` is set, only that specific client is allowed and dynamic registration is disabled.

### Registration flow

1. Client discovers the registration endpoint from `/.well-known/oauth-authorization-server` (the `registration_endpoint` field)
2. Client POSTs its metadata to `/oauth/register`:
   ```bash
   curl -X POST https://your-app.vercel.app/oauth/register \
     -H "Content-Type: application/json" \
     -d '{
       "redirect_uris": ["https://your-client.example/callback"],
       "grant_types": ["authorization_code", "refresh_token"],
       "client_name": "My MCP Client",
       "scope": "memory:read memory:write"
     }'
   ```
3. Server responds with client credentials:
   ```json
   {
     "client_id": "dyn_abc123...",
     "client_id_issued_at": 1234567890,
     "redirect_uris": ["https://your-client.example/callback"],
     "client_name": "My MCP Client",
     "token_endpoint_auth_method": "none",
     "grant_types": ["authorization_code", "refresh_token"],
     "response_types": ["code"],
     "scope": "memory:read memory:write"
   }
   ```
4. Client uses the `client_id` for the standard OAuth authorization code flow with PKCE

### Supported client metadata

| Field | Required | Description |
| --- | --- | --- |
| `redirect_uris` | Yes | Array of allowed redirect URIs. HTTPS required except for localhost. |
| `client_name` | No | Human-readable client name. |
| `client_uri` | No | URL of the client homepage. |
| `logo_uri` | No | URL of the client logo. |
| `scope` | No | Requested scopes; defaults to `memory:read memory:write`. |
| `contacts` | No | Array of contact emails. |
| `tos_uri` | No | URL of terms of service. |
| `policy_uri` | No | URL of privacy policy. |
| `software_id` | No | Unique identifier for the client software. |
| `software_version` | No | Version of the client software. |

### Security notes

- Only public clients are supported (`token_endpoint_auth_method=none`)
- `authorization_code` and `refresh_token` grant types are supported
- PKCE (S256) is required for all authorization requests
- Redirect URIs must use HTTPS except for localhost development
- Dynamically registered clients are validated against their registered redirect URIs

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
