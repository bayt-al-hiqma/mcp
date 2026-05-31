import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { handleJsonRpc, tools } from "../lib/mcp";
import { buildMarkdown, excerpt, parseMarkdown, replaceSection } from "../lib/markdown";
import { MemoryService } from "../lib/memory";
import { normalizeVaultPath } from "../lib/pathSafety";
import { LocalVaultBackend } from "../lib/vault";
import { configStatus } from "../lib/config";

let tmp: string;
const config = {
  backend: "local" as const,
  githubBranch: "main",
  vaultRoot: "",
  localVaultDir: "",
  dailyNotesDir: "Daily",
  canonicalNotesDir: "Memories",
  decisionsDir: "Decisions",
  searchResultLimit: 10,
  graphResultLimit: 10,
  maxFileSizeBytes: 262_144,
};

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "memory-mcp-"));
  delete process.env.DIAGNOSTICS_TOKEN;
  process.env.LOCAL_VAULT_DIR = tmp;
  process.env.VAULT_BACKEND = "local";
});
afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

function service() { return new MemoryService({ backend: new LocalVaultBackend(tmp), config: { ...config, localVaultDir: tmp }, now: new Date("2026-05-30T12:34:00Z") }); }
async function write(rel: string, content: string) { await fs.mkdir(path.dirname(path.join(tmp, rel)), { recursive: true }); await fs.writeFile(path.join(tmp, rel), content, "utf8"); }

describe("MCP protocol", () => {
  it("handles initialize, ping, tools/list, invalid JSON, unknown methods, and unknown tools", async () => {
    expect(await handleJsonRpc("{" )).toMatchObject({ error: { code: -32700 } });
    expect(await handleJsonRpc(JSON.stringify({ nope: true }))).toMatchObject({ error: { code: -32600 } });
    expect(await handleJsonRpc(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }))).toMatchObject({ id: 1, result: { capabilities: { tools: {} } } });
    expect(await handleJsonRpc(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }))).toMatchObject({ id: 2, result: {} });
    const list = await handleJsonRpc(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }));
    expect(list).toMatchObject({ result: { tools: expect.any(Array) } });
    expect(tools().some((t) => t.name === "memory_search")).toBe(true);
    expect(await handleJsonRpc(JSON.stringify({ jsonrpc: "2.0", id: 4, method: "missing" }))).toMatchObject({ error: { code: -32601 } });
    expect(await handleJsonRpc(JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "missing_tool" } }))).toMatchObject({ error: { code: -32000 } });
  });
});

describe("Markdown parsing", () => {
  it("parses frontmatter, title, aliases, tags, links, headings, tasks, sections, and excerpts", () => {
    const raw = buildMarkdown({ title: "User Preferences", aliases: ["Prefs"], tags: ["memory"], type: "canonical" }, "# User Preferences\n\nBody #inline\n\n## Food\n\n- [ ] Try [[Tea|green tea]] and [Note](Other.md)\n");
    const parsed = parseMarkdown(raw);
    expect(parsed.title).toBe("User Preferences");
    expect(parsed.aliases).toContain("Prefs");
    expect(parsed.tags).toEqual(expect.arrayContaining(["memory", "inline"]));
    expect(parsed.links.map((l) => l.target)).toEqual(expect.arrayContaining(["Tea", "Other.md"]));
    expect(parsed.headings.map((h) => h.text)).toEqual(["User Preferences", "Food"]);
    expect(parsed.tasks[0]).toMatchObject({ completed: false, heading: "Food" });
    expect(replaceSection(parsed.body, "Food", "New section")).toContain("## Food\n\nNew section");
    expect(excerpt(parsed.body, "Try")).toContain("Try");
  });
});

describe("search, context, writes, and health", () => {
  it("implements memory workflows", async () => {
    await write("People/Ada.md", buildMarkdown({ title: "Ada Lovelace", aliases: ["Ada"], tags: ["person"], type: "person" }, "# Ada Lovelace\n\nWorks on [[Analytical Engine]].\n- [ ] Send update #work\n"));
    await write("Projects/Engine.md", buildMarkdown({ title: "Analytical Engine", tags: ["project"], type: "project" }, "# Analytical Engine\n\nAda is related. See [[Missing Note]].\n"));
    const m = service();

    expect((await m.resolve("Ada")).status).toBe("exact");
    expect((await m.search("project", { tag: "project" }))[0].path).toBe("Projects/Engine.md");
    const read = await m.read("People/Ada.md");
    expect(read.tasks[0].text).toContain("Send update");
    expect(read.backlinks).toEqual([]);
    expect(read.unlinkedMentions).toContain("Projects/Engine.md");
    expect((await m.tasks())[0]).toMatchObject({ path: "People/Ada.md", completed: false });

    const daily = await m.appendDaily({ kind: "reflection", text: "Felt focused today.", links: ["Ada Lovelace"] });
    expect(daily.path).toBe("Daily/2026-05-30.md");
    const canonical = await m.upsertCanonical({ title: "Tea Preference", summary: "Prefers green tea.", tags: ["preference"] });
    expect(canonical.path).toBe("Memories/tea-preference.md");
    const updated = await m.upsertCanonical({ title: "Tea Preference", summary: "Prefers oolong tea.", path: canonical.path });
    expect(updated.sha).toBeDefined();
    expect((await m.read(canonical.path)).body).toContain("Prefers oolong tea");

    const decision = await m.recordDecision({ title: "Choose Vault Backend", context: "Need hosted memory.", options: ["GitHub", "Local"], chosen: "GitHub", rationale: "Works on Vercel." });
    expect(decision.path).toBe("Decisions/2026-05-30-choose-vault-backend.md");
    await m.updateSection({ path: decision.path, heading: "Consequences and Follow-up", content: "Configure branch protection." });
    await m.appendSnapshot({ path: canonical.path, note: "User corrected the tea preference." });

    const graph = await m.graph("Projects/Engine.md");
    expect(graph.missingLinks).toContainEqual({ source: "Projects/Engine.md", target: "Missing Note" });
    const health = await m.health();
    expect(health.brokenLinks.length).toBeGreaterThan(0);
    expect(health.noteCount).toBeGreaterThan(3);
  });

  it("rejects traversal, prevents overwrites, detects conflicts, and reports config", async () => {
    expect(() => normalizeVaultPath("../secret.md")).toThrow(/traversal/i);
    const m = service();
    await m.createNote({ path: "Notes/Safe.md", title: "Safe", body: "# Safe" });
    await expect(m.createNote({ path: "Notes/Safe.md", title: "Safe", body: "Again" })).rejects.toThrow(/overwrite/i);
    await expect(m.updateSection({ path: "Notes/Safe.md", heading: "X", content: "Y", expectedSha: "stale" })).rejects.toThrow(/Conflict/i);
    expect(configStatus()).toMatchObject({ ok: true, backend: "local", configured: { mcpAuth: "none", diagnosticsProtected: false } });
  });
});
