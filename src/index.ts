/**
 * Main entry point for the Personal Memory MCP Server
 * Handles HTTP routes for Vercel deployment
 */

import { IncomingMessage, ServerResponse } from 'http';
import { loadConfig, validateConfig } from './lib/config.js';
import { MCPServer } from './lib/mcp-server.js';
import { MemoryStore } from './lib/memory-store.js';

let mcpServer: MCPServer | null = null;
let config: ReturnType<typeof loadConfig> | null = null;
let configError: string | null = null;

// Initialize on first request
function initialize() {
  if (mcpServer) return;

  try {
    config = loadConfig();
    const validation = validateConfig(config);

    if (!validation.valid) {
      configError = validation.errors.join(', ');
      console.error('Configuration errors:', validation.errors);
      return;
    }

    mcpServer = new MCPServer(config);
    console.log('MCP Server initialized successfully');
  } catch (error: any) {
    configError = error.message;
    console.error('Failed to initialize:', error);
  }
}

/**
 * Parse request body
 */
async function parseBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

/**
 * Send JSON response
 */
function sendJSON(res: ServerResponse, status: number, data: any) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data, null, 2));
}

/**
 * Send HTML response
 */
function sendHTML(res: ServerResponse, status: number, html: string) {
  res.writeHead(status, { 'Content-Type': 'text/html' });
  res.end(html);
}

/**
 * Main request handler
 */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.end();
    return;
  }

  // Initialize on first request
  initialize();

  // Route handling
  if (url.pathname === '/health' || url.pathname === '/api/health') {
    return handleHealth(req, res);
  }

  if (url.pathname === '/mcp' || url.pathname === '/api/mcp') {
    return handleMCP(req, res);
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    return handleLanding(req, res);
  }

  // 404 for unknown routes
  sendJSON(res, 404, { error: 'Not found' });
}

/**
 * Health endpoint
 */
async function handleHealth(req: IncomingMessage, res: ServerResponse) {
  if (!config || configError) {
    return sendJSON(res, 503, {
      status: 'error',
      configured: false,
      error: configError || 'Server not configured'
    });
  }

  try {
    const store = new MemoryStore(config);
    const vaultHealth = await store.checkHealth();

    sendJSON(res, vaultHealth.accessible ? 200 : 503, {
      status: vaultHealth.accessible ? 'ok' : 'error',
      configured: true,
      vault: {
        accessible: vaultHealth.accessible,
        error: vaultHealth.error
      }
    });
  } catch (error: any) {
    sendJSON(res, 500, {
      status: 'error',
      configured: true,
      error: error.message
    });
  }
}

/**
 * MCP endpoint
 */
async function handleMCP(req: IncomingMessage, res: ServerResponse) {
  if (!mcpServer || !config) {
    return sendJSON(res, 503, {
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32603,
        message: 'Server not initialized',
        data: { configError }
      }
    });
  }

  if (req.method !== 'POST') {
    return sendJSON(res, 405, {
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32600,
        message: 'Method not allowed'
      }
    });
  }

  // Verify authentication
  const authHeader = req.headers.authorization;
  if (!mcpServer.verifyAuth(authHeader)) {
    return sendJSON(res, 401, {
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32603,
        message: 'Unauthorized'
      }
    });
  }

  try {
    const body = await parseBody(req);
    const response = await mcpServer.handleRawRequest(body);
    sendJSON(res, 200, response);
  } catch (error: any) {
    sendJSON(res, 500, {
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32603,
        message: 'Internal server error',
        data: { error: error.message }
      }
    });
  }
}

/**
 * Landing page
 */
function handleLanding(req: IncomingMessage, res: ServerResponse) {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bayt al-Hiqma - Personal Memory MCP</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 2rem;
      line-height: 1.6;
      color: #333;
    }
    h1 { color: #2563eb; }
    h2 { color: #1e40af; margin-top: 2rem; }
    code {
      background: #f3f4f6;
      padding: 0.2rem 0.4rem;
      border-radius: 0.25rem;
      font-size: 0.9em;
    }
    pre {
      background: #1f2937;
      color: #f9fafb;
      padding: 1rem;
      border-radius: 0.5rem;
      overflow-x: auto;
    }
    pre code {
      background: none;
      padding: 0;
      color: inherit;
    }
    .status {
      padding: 0.5rem 1rem;
      border-radius: 0.5rem;
      margin: 1rem 0;
      display: inline-block;
    }
    .status.ok { background: #dcfce7; color: #166534; }
    .status.error { background: #fee2e2; color: #991b1b; }
    .endpoint {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      padding: 1rem;
      border-radius: 0.5rem;
      margin: 1rem 0;
    }
  </style>
</head>
<body>
  <h1>🏛️ Bayt al-Hiqma</h1>
  <p><strong>Personal Memory MCP Server</strong> - A durable memory layer for ChatGPT conversations</p>

  <div class="status ${configError ? 'error' : 'ok'}">
    Status: ${configError ? `⚠️ Configuration Error - ${configError}` : '✓ Configured'}
  </div>

  <h2>Configuration</h2>
  <p>Set these environment variables to configure the MCP server:</p>

  <div class="endpoint">
    <strong>Required:</strong>
    <ul>
      <li><code>VAULT_OWNER</code> - GitHub username or organization</li>
      <li><code>VAULT_REPO</code> - GitHub repository name containing your vault</li>
      <li><code>GITHUB_TOKEN</code> - GitHub personal access token with repo access</li>
      <li><code>MCP_AUTH_SECRET</code> - Secret token for MCP authentication</li>
    </ul>
    <strong>Optional:</strong>
    <ul>
      <li><code>VAULT_BRANCH</code> - Git branch (default: main)</li>
      <li><code>VAULT_ROOT</code> - Root directory in repo (default: "")</li>
      <li><code>DAILY_NOTES_DIR</code> - Daily notes directory (default: daily)</li>
      <li><code>MAX_FILE_SIZE</code> - Max file size in bytes (default: 1048576)</li>
      <li><code>MAX_SEARCH_RESULTS</code> - Max search results (default: 50)</li>
      <li><code>MAX_GRAPH_NODES</code> - Max graph nodes (default: 100)</li>
    </ul>
  </div>

  <h2>Endpoints</h2>

  <div class="endpoint">
    <strong>POST /mcp</strong> or <strong>POST /api/mcp</strong><br>
    MCP JSON-RPC endpoint for ChatGPT<br>
    <em>Requires: Bearer token authentication</em>
  </div>

  <div class="endpoint">
    <strong>GET /health</strong> or <strong>GET /api/health</strong><br>
    Health check endpoint
  </div>

  <h2>Connecting to ChatGPT</h2>
  <p>To connect this MCP server to ChatGPT:</p>
  <ol>
    <li>Deploy this application to Vercel</li>
    <li>Get your deployment URL (e.g., https://your-app.vercel.app)</li>
    <li>In ChatGPT settings, add a custom MCP server:
      <ul>
        <li><strong>Name:</strong> Personal Memory</li>
        <li><strong>URL:</strong> https://your-app.vercel.app/mcp</li>
        <li><strong>Auth:</strong> Bearer [your MCP_AUTH_SECRET]</li>
      </ul>
    </li>
  </ol>

  <h2>Available Tools</h2>
  <p>The MCP provides these memory tools to ChatGPT:</p>
  <ul>
    <li><code>search_memories</code> - Search across all notes</li>
    <li><code>read_note</code> - Read a note with full context</li>
    <li><code>resolve_note</code> - Find a note by reference</li>
    <li><code>list_notes</code> - List all notes in vault</li>
    <li><code>get_recent_notes</code> - Get recently modified notes</li>
    <li><code>append_to_daily_note</code> - Add entry to today's daily note</li>
    <li><code>create_canonical_memory</code> - Create/update canonical memories</li>
    <li><code>create_decision_record</code> - Record important decisions</li>
    <li><code>update_note_section</code> - Update a specific section</li>
    <li><code>get_tasks</code> - Get tasks from notes</li>
    <li><code>check_vault_health</code> - Check vault for issues</li>
  </ul>

  <h2>Documentation</h2>
  <p>For full specification and usage details, see <a href="https://github.com/maazghani/bayt-al-hiqma">the repository</a>.</p>

  <hr style="margin: 2rem 0; border: none; border-top: 1px solid #e5e7eb;">
  <p style="color: #6b7280; font-size: 0.875rem;">
    Bayt al-Hiqma (House of Wisdom) - Inspired by the historic center of learning in Baghdad
  </p>
</body>
</html>
  `;

  sendHTML(res, 200, html);
}
