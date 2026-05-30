import { configStatus, getConfig } from "./config";
import { MemoryService } from "./memory";

const toolDescriptions = [
  { name: "memory_search", description: "Ranked search across titles, paths, aliases, tags, headings, links, properties, and note bodies.", inputSchema: { type: "object", properties: { query: { type: "string" }, folder: { type: "string" }, tag: { type: "string" }, linkedNote: { type: "string" }, hasTasks: { type: "boolean" }, orphan: { type: "boolean" }, limit: { type: "number" } }, required: ["query"] } },
  { name: "memory_read", description: "Read one note with frontmatter, body, headings, links, backlinks, tasks, unlinked mentions, and related-note hints.", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "memory_resolve", description: "Resolve a path, filename, title, alias, or wikilink to likely notes, surfacing ambiguous matches.", inputSchema: { type: "object", properties: { reference: { type: "string" } }, required: ["reference"] } },
  { name: "memory_list_recent", description: "List recently changed or available notes.", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
  { name: "daily_append", description: "Append a concise day-specific distilled memory entry to a daily note; creates the daily note if needed.", inputSchema: { type: "object", properties: { date: { type: "string" }, kind: { type: "string" }, text: { type: "string" }, links: { type: "array", items: { type: "string" } } }, required: ["text"] } },
  { name: "note_create", description: "Create a new Markdown note with metadata, refusing to overwrite existing notes.", inputSchema: { type: "object", properties: { path: { type: "string" }, title: { type: "string" }, body: { type: "string" }, type: { type: "string" }, tags: { type: "array", items: { type: "string" } }, aliases: { type: "array", items: { type: "string" } }, links: { type: "array", items: { type: "string" } } }, required: ["path", "title", "body"] } },
  { name: "canonical_upsert", description: "Create or update a durable canonical memory with current state and history.", inputSchema: { type: "object", properties: { title: { type: "string" }, summary: { type: "string" }, path: { type: "string" }, tags: { type: "array", items: { type: "string" } }, aliases: { type: "array", items: { type: "string" } }, links: { type: "array", items: { type: "string" } }, expectedSha: { type: "string" } }, required: ["title", "summary"] } },
  { name: "decision_record", description: "Create an auditable decision record with context, options, chosen path, rationale, consequences, and related links.", inputSchema: { type: "object", properties: { title: { type: "string" }, context: { type: "string" }, options: { type: "array", items: { type: "string" } }, chosen: { type: "string" }, rationale: { type: "string" }, consequences: { type: "string" }, links: { type: "array", items: { type: "string" } }, date: { type: "string" } }, required: ["title", "context", "chosen", "rationale"] } },
  { name: "note_update_section", description: "Safely replace or insert a heading-scoped section with conflict detection.", inputSchema: { type: "object", properties: { path: { type: "string" }, heading: { type: "string" }, content: { type: "string" }, expectedSha: { type: "string" } }, required: ["path", "heading", "content"] } },
  { name: "canonical_append_snapshot", description: "Append a historical snapshot to a note's History section.", inputSchema: { type: "object", properties: { path: { type: "string" }, note: { type: "string" }, expectedSha: { type: "string" } }, required: ["path", "note"] } },
  { name: "tasks_list", description: "List Markdown checkbox tasks with note path, heading context, tags, links, and completion status.", inputSchema: { type: "object", properties: { includeCompleted: { type: "boolean" } } } },
  { name: "vault_graph", description: "Inspect bounded graph context, backlinks, outgoing links, missing links, orphan notes, and local neighborhoods.", inputSchema: { type: "object", properties: { path: { type: "string" }, limit: { type: "number" } } } },
  { name: "vault_health", description: "Report advisory vault health signals: orphans, broken links, stale canonical memories, duplicate titles, sparse stubs.", inputSchema: { type: "object", properties: { folder: { type: "string" } } } },
  { name: "vault_diagnostics", description: "Return redacted configuration and backend readiness diagnostics.", inputSchema: { type: "object", properties: {} } },
];

export function jsonRpcSuccess(id: unknown, result: unknown) { return { jsonrpc: "2.0", id, result }; }
export function jsonRpcError(id: unknown, code: number, message: string, data?: unknown) { return { jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } }; }

export async function handleJsonRpc(raw: string) {
  let req: any;
  try { req = JSON.parse(raw); } catch { return jsonRpcError(null, -32700, "Parse error"); }
  if (!req || req.jsonrpc !== "2.0" || typeof req.method !== "string") return jsonRpcError(req?.id ?? null, -32600, "Invalid Request");
  try {
    if (req.method === "initialize") return jsonRpcSuccess(req.id, { protocolVersion: "2024-11-05", serverInfo: { name: "bayt-al-hiqma", version: "0.1.0" }, capabilities: { tools: {} } });
    if (req.method === "ping") return jsonRpcSuccess(req.id, {});
    if (req.method === "tools/list") return jsonRpcSuccess(req.id, { tools: toolDescriptions });
    if (req.method === "tools/call") {
      const name = req.params?.name;
      if (!name) return jsonRpcError(req.id, -32602, "Tool name is required.");
      return jsonRpcSuccess(req.id, { content: [{ type: "text", text: JSON.stringify(await callTool(name, req.params?.arguments ?? {}), null, 2) }] });
    }
    return jsonRpcError(req.id, -32601, "Method not found");
  } catch (error) {
    return jsonRpcError(req.id, -32000, error instanceof Error ? error.message : "Tool failure");
  }
}

export async function callTool(name: string, args: any) {
  const memory = new MemoryService();
  switch (name) {
    case "memory_search": return memory.search(String(args.query ?? ""), args);
    case "memory_read": return memory.read(String(args.path));
    case "memory_resolve": return memory.resolve(String(args.reference));
    case "memory_list_recent": return memory.listNotes(args.limit);
    case "daily_append": return memory.appendDaily(args);
    case "note_create": return memory.createNote(args);
    case "canonical_upsert": return memory.upsertCanonical(args);
    case "decision_record": return memory.recordDecision(args);
    case "note_update_section": return memory.updateSection(args);
    case "canonical_append_snapshot": return memory.appendSnapshot(args);
    case "tasks_list": return memory.tasks(Boolean(args.includeCompleted));
    case "vault_graph": return memory.graph(args.path, args.limit);
    case "vault_health": return memory.health(args.folder);
    case "vault_diagnostics": return configStatus(getConfig());
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

export function tools() { return toolDescriptions; }
