import { configStatus, getConfig } from "./config";
import { MemoryService } from "./memory";

// Reusable output-schema fragments. Many tools return the same shapes, so we
// define them once instead of repeating per-tool. Schemas describe the meaningful
// fields without `additionalProperties: false`, keeping them informative for
// clients while staying forgiving as the implementation evolves.
const noteSummary = {
  type: "object",
  properties: {
    path: { type: "string" },
    title: { type: "string" },
    aliases: { type: "array", items: { type: "string" } },
    tags: { type: "array", items: { type: "string" } },
    type: { type: "string" },
    sha: { type: "string" },
    updatedAt: { type: "string" },
    score: { type: "number" },
    excerpt: { type: "string" },
  },
  required: ["path", "title", "aliases", "tags"],
} as const;

const link = {
  type: "object",
  properties: { raw: { type: "string" }, target: { type: "string" }, alias: { type: "string" }, type: { type: "string", enum: ["wikilink", "markdown"] } },
  required: ["target", "type"],
} as const;

const task = {
  type: "object",
  properties: { path: { type: "string" }, text: { type: "string" }, completed: { type: "boolean" }, line: { type: "number" }, heading: { type: "string" }, tags: { type: "array", items: { type: "string" } }, links: { type: "array", items: link } },
  required: ["text", "completed"],
} as const;

const mutationResult = {
  type: "object",
  properties: { path: { type: "string" }, oldSha: { type: "string" }, newSha: { type: "string" }, summary: { type: "string" } },
  required: ["path", "summary"],
} as const;

const toolDescriptions = [
  { name: "memory_search", description: "Ranked search across titles, paths, aliases, tags, headings, links, properties, and note bodies.", inputSchema: { type: "object", properties: { query: { type: "string" }, folder: { type: "string" }, tag: { type: "string" }, linkedNote: { type: "string" }, hasTasks: { type: "boolean" }, orphan: { type: "boolean" }, limit: { type: "number" } }, required: ["query"] }, outputSchema: { type: "array", items: noteSummary } },
  { name: "memory_read", description: "Read one note with frontmatter, body, headings, links, backlinks, tasks, unlinked mentions, and related-note hints.", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }, outputSchema: { type: "object", properties: { path: { type: "string" }, title: { type: "string" }, aliases: { type: "array", items: { type: "string" } }, tags: { type: "array", items: { type: "string" } }, type: { type: "string" }, sha: { type: "string" }, updatedAt: { type: "string" }, frontmatter: { type: "object" }, body: { type: "string" }, headings: { type: "array", items: { type: "object" } }, outgoingLinks: { type: "array", items: link }, backlinks: { type: "array", items: { type: "string" } }, unlinkedMentions: { type: "array", items: { type: "string" } }, tasks: { type: "array", items: task }, related: { type: "array", items: { type: "string" } } }, required: ["path", "title", "body"] } },
  { name: "memory_resolve", description: "Resolve a path, filename, title, alias, or wikilink to likely notes, surfacing ambiguous matches.", inputSchema: { type: "object", properties: { reference: { type: "string" } }, required: ["reference"] }, outputSchema: { type: "object", properties: { status: { type: "string", enum: ["exact", "ambiguous", "not_found"] }, note: noteSummary, candidates: { type: "array", items: noteSummary } }, required: ["status"] } },
  { name: "memory_list_recent", description: "List recently changed or available notes.", inputSchema: { type: "object", properties: { limit: { type: "number" } } }, outputSchema: { type: "array", items: noteSummary } },
  { name: "daily_append", description: "Append a concise day-specific distilled memory entry to a daily note; creates the daily note if needed.", inputSchema: { type: "object", properties: { date: { type: "string" }, kind: { type: "string" }, text: { type: "string" }, links: { type: "array", items: { type: "string" } } }, required: ["text"] }, outputSchema: noteSummary },
  { name: "note_read_raw", description: "Read the exact Markdown body, parsed frontmatter, and SHA for one note without truncation or interpretation.", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }, outputSchema: { type: "object", properties: { path: { type: "string" }, frontmatter: { type: "object" }, body: { type: "string" }, sha: { type: "string" }, updatedAt: { type: "string" } }, required: ["path", "body", "sha"] } },
  { name: "note_replace_body", description: "Replace only a note's Markdown body while preserving existing frontmatter; requires expectedSha and fails on conflicts.", inputSchema: { type: "object", properties: { path: { type: "string" }, body: { type: "string" }, expectedSha: { type: "string" } }, required: ["path", "body", "expectedSha"] }, outputSchema: mutationResult },
  { name: "note_move", description: "Move or rename one note without overwriting and without rewriting links; requires expectedSha.", inputSchema: { type: "object", properties: { sourcePath: { type: "string" }, destinationPath: { type: "string" }, expectedSha: { type: "string" } }, required: ["sourcePath", "destinationPath", "expectedSha"] }, outputSchema: { type: "object", properties: { sourcePath: { type: "string" }, destinationPath: { type: "string" }, oldSha: { type: "string" }, newSha: { type: "string" }, summary: { type: "string" } }, required: ["sourcePath", "destinationPath", "summary"] } },
  { name: "note_trash", description: "Move one note to Archive/Trash without permanent deletion; requires expectedSha and never overwrites trash files.", inputSchema: { type: "object", properties: { path: { type: "string" }, expectedSha: { type: "string" } }, required: ["path", "expectedSha"] }, outputSchema: { type: "object", properties: { path: { type: "string" }, success: { type: "boolean" }, oldSha: { type: "string" }, trashPath: { type: "string" }, summary: { type: "string" }, error: { type: "string" } }, required: ["path", "success"] } },
  { name: "vault_tree", description: "Return a simple Markdown note folder/file tree for the vault or a subfolder.", inputSchema: { type: "object", properties: { path: { type: "string" }, depth: { type: "number" } } }, outputSchema: { type: "object", properties: { path: { type: "string" }, depth: { type: "number" }, tree: { type: "array", items: { type: "string" } } }, required: ["path", "depth", "tree"] } },
  { name: "note_diff", description: "Preview a unified diff between the current note body and a proposed replacement body without writing.", inputSchema: { type: "object", properties: { path: { type: "string" }, proposedBody: { type: "string" } }, required: ["path", "proposedBody"] }, outputSchema: { type: "object", properties: { path: { type: "string" }, sha: { type: "string" }, diff: { type: "string" } }, required: ["path", "diff"] } },
  { name: "note_create", description: "Create a new Markdown note with metadata, refusing to overwrite existing notes.", inputSchema: { type: "object", properties: { path: { type: "string" }, title: { type: "string" }, body: { type: "string" }, type: { type: "string" }, tags: { type: "array", items: { type: "string" } }, aliases: { type: "array", items: { type: "string" } }, links: { type: "array", items: { type: "string" } } }, required: ["path", "title", "body"] }, outputSchema: noteSummary },
  { name: "canonical_upsert", description: "Create or update a durable canonical memory with current state and history.", inputSchema: { type: "object", properties: { title: { type: "string" }, summary: { type: "string" }, path: { type: "string" }, tags: { type: "array", items: { type: "string" } }, aliases: { type: "array", items: { type: "string" } }, links: { type: "array", items: { type: "string" } }, expectedSha: { type: "string" } }, required: ["title", "summary"] }, outputSchema: noteSummary },
  { name: "decision_record", description: "Create an auditable decision record with context, options, chosen path, rationale, consequences, and related links.", inputSchema: { type: "object", properties: { title: { type: "string" }, context: { type: "string" }, options: { type: "array", items: { type: "string" } }, chosen: { type: "string" }, rationale: { type: "string" }, consequences: { type: "string" }, links: { type: "array", items: { type: "string" } }, date: { type: "string" } }, required: ["title", "context", "chosen", "rationale"] }, outputSchema: noteSummary },
  { name: "note_update_section", description: "Safely replace or insert a heading-scoped section with conflict detection.", inputSchema: { type: "object", properties: { path: { type: "string" }, heading: { type: "string" }, content: { type: "string" }, expectedSha: { type: "string" } }, required: ["path", "heading", "content"] }, outputSchema: noteSummary },
  { name: "canonical_append_snapshot", description: "Append a historical snapshot to a note's History section.", inputSchema: { type: "object", properties: { path: { type: "string" }, note: { type: "string" }, expectedSha: { type: "string" } }, required: ["path", "note"] }, outputSchema: noteSummary },
  { name: "tasks_list", description: "List Markdown checkbox tasks with note path, heading context, tags, links, and completion status.", inputSchema: { type: "object", properties: { includeCompleted: { type: "boolean" } } }, outputSchema: { type: "array", items: task } },
  { name: "vault_graph", description: "Inspect bounded graph context, backlinks, outgoing links, missing links, orphan notes, and local neighborhoods.", inputSchema: { type: "object", properties: { path: { type: "string" }, limit: { type: "number" } } }, outputSchema: { type: "object", properties: { focus: { type: "string" }, backlinks: { type: "object" }, outgoing: { type: "object" }, neighborhood: { type: "object" }, missingLinks: { type: "array", items: { type: "object", properties: { source: { type: "string" }, target: { type: "string" } }, required: ["source", "target"] } }, orphans: { type: "array", items: { type: "string" } }, local: { type: "array", items: { type: "string" } } }, required: ["backlinks", "outgoing", "neighborhood", "missingLinks", "orphans"] } },
  { name: "vault_health", description: "Report advisory vault health signals: orphans, broken links, stale canonical memories, duplicate titles, sparse stubs.", inputSchema: { type: "object", properties: { folder: { type: "string" } } }, outputSchema: { type: "object", properties: { noteCount: { type: "number" }, orphanNotes: { type: "array", items: { type: "string" } }, brokenLinks: { type: "array", items: { type: "object", properties: { source: { type: "string" }, target: { type: "string" } }, required: ["source", "target"] } }, duplicateTitles: { type: "array", items: { type: "object", properties: { title: { type: "string" }, paths: { type: "array", items: { type: "string" } } }, required: ["title", "paths"] } }, staleCanonicalMemories: { type: "array", items: { type: "string" } }, sparseStubs: { type: "array", items: { type: "string" } } }, required: ["noteCount", "orphanNotes", "brokenLinks", "duplicateTitles", "staleCanonicalMemories", "sparseStubs"] } },
  { name: "vault_diagnostics", description: "Return redacted configuration and backend readiness diagnostics.", inputSchema: { type: "object", properties: {} }, outputSchema: { type: "object", properties: { ok: { type: "boolean" }, backend: { type: "string" }, missing: { type: "array", items: { type: "string" } }, configured: { type: "object" } }, required: ["ok", "backend", "missing"] } },
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
      const result = await callTool(name, req.params?.arguments ?? {});
      // Return structured content for clients that read the outputSchema, plus the
      // serialized JSON as a text block for backwards compatibility (per spec).
      return jsonRpcSuccess(req.id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result });
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
    case "note_read_raw": return memory.readRaw(String(args.path));
    case "note_replace_body": return memory.replaceBody(args);
    case "note_move": return memory.moveNote(args);
    case "note_trash": return memory.trashNote(args);
    case "vault_tree": return memory.tree(args.path, args.depth);
    case "note_diff": return memory.diff(args);
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
