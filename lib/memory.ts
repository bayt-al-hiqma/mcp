import { AppConfig, getConfig } from "./config";
import matter from "gray-matter";
import { buildMarkdown, excerpt, frontmatterDate, parseMarkdown, replaceSection } from "./markdown";
import { normalizeVaultFolderPath, normalizeVaultPath, slugifyTitle } from "./pathSafety";
import { createVaultBackend, VaultBackend, VaultFile } from "./vault";

export type NoteSummary = { path: string; title: string; aliases: string[]; tags: string[]; type?: string; score?: number; excerpt?: string; sha?: string; updatedAt?: string };
export type MemoryServiceOptions = { backend?: VaultBackend; config?: AppConfig; now?: Date };

export class MemoryService {
  private backend: VaultBackend;
  private config: AppConfig;
  private now: Date;

  constructor(options: MemoryServiceOptions = {}) {
    this.config = options.config ?? getConfig();
    this.backend = options.backend ?? createVaultBackend(this.config);
    this.now = options.now ?? new Date();
  }

  async listNotes(limit = this.config.searchResultLimit): Promise<NoteSummary[]> {
    const files = await this.backend.listMarkdownFiles();
    return files.map((file) => this.summarize(file)).sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""))).slice(0, limit);
  }

  async search(query: string, filters: { folder?: string; tag?: string; linkedNote?: string; hasTasks?: boolean; orphan?: boolean; limit?: number } = {}) {
    const files = await this.backend.listMarkdownFiles();
    const graph = this.graphFromFiles(files);
    const q = query.toLowerCase();
    return files.map((file) => {
      const parsed = parseMarkdown(file.content, filenameTitle(file.path));
      const fields = [parsed.title, file.path, ...parsed.aliases, ...parsed.tags, ...parsed.headings.map((h) => h.text), ...parsed.links.map((l) => l.target), JSON.stringify(parsed.frontmatter), parsed.body];
      let score = 0;
      fields.forEach((field, index) => {
        const lower = String(field).toLowerCase();
        if (lower === q) score += 50;
        else if (lower.includes(q)) score += Math.max(1, 25 - index);
      });
      return { file, parsed, score };
    }).filter(({ file, parsed, score }) => {
      if (query && score <= 0) return false;
      if (filters.folder && !file.path.startsWith(filters.folder.replace(/\/$/, "") + "/")) return false;
      if (filters.tag && !parsed.tags.includes(filters.tag.replace(/^#/, ""))) return false;
      if (filters.linkedNote && !parsed.links.some((l) => normalizeLinkTarget(l.target) === normalizeLinkTarget(filters.linkedNote!))) return false;
      if (filters.hasTasks !== undefined && (parsed.tasks.length > 0) !== filters.hasTasks) return false;
      if (filters.orphan !== undefined && graph.orphans.includes(file.path) !== filters.orphan) return false;
      return true;
    }).sort((a, b) => b.score - a.score).slice(0, filters.limit ?? this.config.searchResultLimit).map(({ file, parsed, score }) => ({ ...this.summarize(file, parsed), score, excerpt: excerpt(parsed.body, query) }));
  }

  async resolve(reference: string) {
    const normalizedReference = reference.replace(/^\[\[|\]\]$/g, "");
    const files = await this.backend.listMarkdownFiles();
    const exact = files.find((f) => f.path === normalizedReference || f.path === `${normalizedReference}.md`);
    if (exact) return { status: "exact", note: this.summarize(exact) };
    const candidates = files.map((file) => {
      const parsed = parseMarkdown(file.content, filenameTitle(file.path));
      const hay = [filenameTitle(file.path), parsed.title, ...parsed.aliases].map((s) => s.toLowerCase());
      const needle = normalizedReference.toLowerCase();
      const score = hay.includes(needle) ? 40 : hay.some((s) => s.includes(needle) || needle.includes(s)) ? 20 : similarity(hay.join(" "), needle);
      return { ...this.summarize(file, parsed), score };
    }).filter((c) => (c.score ?? 0) > 0).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 5);
    return candidates.length === 1 && (candidates[0].score ?? 0) >= 20 ? { status: "exact", note: candidates[0] } : { status: candidates.length ? "ambiguous" : "not_found", candidates };
  }

  async read(path: string) {
    const file = await this.backend.readFile(path);
    const parsed = parseMarkdown(file.content, filenameTitle(file.path));
    const files = await this.backend.listMarkdownFiles();
    const graph = this.graphFromFiles(files, file.path);
    const mentionTerms = [parsed.title, ...parsed.aliases, filenameTitle(file.path)].map((term) => term.toLowerCase()).filter(Boolean);
    const unlinkedMentions = files.filter((other) => {
      if (other.path === file.path) return false;
      const body = parseMarkdown(other.content, filenameTitle(other.path)).body.toLowerCase();
      return mentionTerms.some((term) => body.includes(term));
    }).map((other) => other.path).slice(0, this.config.graphResultLimit);
    return { ...this.summarize(file, parsed), frontmatter: parsed.frontmatter, body: parsed.body, headings: parsed.headings, outgoingLinks: parsed.links, backlinks: graph.backlinks[file.path] ?? [], unlinkedMentions, tasks: parsed.tasks, related: graph.neighborhood[file.path] ?? [] };
  }


  async readRaw(path: string) {
    const file = await this.backend.readFile(path);
    const split = splitFrontmatter(file.content);
    return { path: file.path, frontmatter: matter(file.content).data, body: split.body, sha: file.sha, updatedAt: file.updatedAt };
  }

  async replaceBody(args: { path: string; body: string; expectedSha: string }) {
    requireExpectedSha(args.expectedSha);
    const current = await this.backend.readFile(args.path);
    if (current.sha !== args.expectedSha) throw new Error("Conflict: file changed since expectedSha.");
    const split = splitFrontmatter(current.content);
    const next = await this.backend.writeFile(current.path, `${split.frontmatter}${args.body}`, { expectedSha: args.expectedSha, message: `Replace body in ${current.path}` });
    return { path: next.path, oldSha: current.sha, newSha: next.sha, summary: `Replaced Markdown body in ${next.path}; frontmatter preserved.` };
  }

  async moveNote(args: { sourcePath: string; destinationPath: string; expectedSha: string }) {
    requireExpectedSha(args.expectedSha);
    const source = await this.backend.readFile(args.sourcePath);
    if (source.sha !== args.expectedSha) throw new Error("Conflict: file changed since expectedSha.");
    const destinationPath = normalizeVaultPath(args.destinationPath);
    if (await this.backend.exists(destinationPath)) throw new Error("Refusing to overwrite existing note.");
    const moved = await this.backend.moveFile(source.path, destinationPath, { expectedSha: args.expectedSha, message: `Move note ${source.path} to ${destinationPath}` });
    return { sourcePath: source.path, destinationPath: moved.path, oldSha: source.sha, newSha: moved.sha, summary: `Moved ${source.path} to ${moved.path}. Links were not rewritten.` };
  }

  async trashNote(args: { path: string; expectedSha: string }) {
    const path = args?.path;
    try {
      requireExpectedSha(args.expectedSha);
      const current = await this.backend.readFile(args.path);
      if (current.sha !== args.expectedSha) throw new Error("SHA mismatch");
      const trashPath = normalizeVaultPath(`Archive/Trash/${current.path}`);
      if (await this.backend.exists(trashPath)) throw new Error(`Refusing to overwrite existing trash note: ${trashPath}`);
      const moved = await this.backend.moveFile(current.path, trashPath, { expectedSha: args.expectedSha, message: `Trash note ${current.path}` });
      return { path: current.path, oldSha: current.sha, trashPath: moved.path, success: true, summary: `Moved note to trash at ${moved.path}.` };
    } catch (error) {
      return { path, success: false, error: error instanceof Error ? error.message : "Failed to move note to trash." };
    }
  }

  async tree(path = "", depth = 3) {
    const root = normalizeVaultFolderPath(path);
    const maxDepth = Math.max(0, Math.min(Number(depth) || 3, 10));
    const files = (await this.backend.listMarkdownFiles()).map((f) => f.path).filter((filePath) => !root || filePath === root || filePath.startsWith(`${root}/`));
    const tree = buildTree(files.map((filePath) => root && filePath.startsWith(`${root}/`) ? filePath.slice(root.length + 1) : filePath), maxDepth);
    return { path: root || "/", depth: maxDepth, tree };
  }

  async diff(args: { path: string; proposedBody: string }) {
    const current = await this.backend.readFile(args.path);
    const split = splitFrontmatter(current.content);
    return { path: current.path, sha: current.sha, diff: unifiedDiff(current.path, split.body, args.proposedBody ?? "") };
  }

  async createNote(args: { path: string; title: string; body: string; type?: string; tags?: string[]; aliases?: string[]; links?: string[] }) {
    const path = normalizeVaultPath(args.path);
    if (await this.backend.exists(path)) throw new Error("Refusing to overwrite existing note.");
    const date = frontmatterDate(this.now);
    const content = buildMarkdown({ title: args.title, aliases: args.aliases ?? [], tags: args.tags ?? [], type: args.type ?? "reference", created: date, updated: date }, withLinks(args.body, args.links));
    return this.summarize(await this.backend.writeFile(path, content, { message: `Create memory note: ${args.title}` }));
  }

  async appendDaily(args: { date?: string; kind?: string; text: string; links?: string[] }) {
    const date = args.date ?? frontmatterDate(this.now);
    const path = normalizeVaultPath(`${this.config.dailyNotesDir}/${date}.md`);
    const entry = `\n\n### ${timeStamp(this.now)} ${args.kind ?? "memory"}\n\n${withLinks(args.text, args.links).trim()}\n`;
    if (!(await this.backend.exists(path))) {
      const content = buildMarkdown({ title: date, type: "daily", date, tags: ["daily"], created: date, updated: date }, `# ${date}\n${entry}`);
      return this.summarize(await this.backend.writeFile(path, content, { message: `Create daily note ${date}` }));
    }
    const current = await this.backend.readFile(path);
    const parsed = parseMarkdown(current.content, date);
    const content = buildMarkdown({ ...parsed.frontmatter, updated: date }, `${parsed.body.trimEnd()}${entry}`);
    return this.summarize(await this.backend.writeFile(path, content, { expectedSha: current.sha, message: `Append daily memory ${date}` }));
  }

  async upsertCanonical(args: { title: string; summary: string; path?: string; tags?: string[]; aliases?: string[]; links?: string[]; expectedSha?: string }) {
    const date = frontmatterDate(this.now);
    const path = normalizeVaultPath(args.path ?? `${this.config.canonicalNotesDir}/${slugifyTitle(args.title)}.md`);
    if (await this.backend.exists(path)) {
      const current = await this.backend.readFile(path);
      const parsed = parseMarkdown(current.content, args.title);
      const history = `- ${date}: ${parsed.body.split("\n").find((l) => l.trim() && !l.startsWith("#"))?.trim() ?? "Previous state updated."}`;
      let body = replaceSection(parsed.body, "Current", withLinks(args.summary, args.links));
      body = replaceSection(body, "History", `${history}\n${sectionText(body, "History")}`.trim());
      return this.summarize(await this.backend.writeFile(path, buildMarkdown({ ...parsed.frontmatter, title: args.title, aliases: args.aliases ?? parsed.aliases, tags: unique([...(args.tags ?? []), ...parsed.tags]), type: "canonical", updated: date }, body), { expectedSha: args.expectedSha ?? current.sha, message: `Update canonical memory: ${args.title}` }));
    }
    const body = `# ${args.title}\n\n## Current\n\n${withLinks(args.summary, args.links)}\n\n## History\n\n- ${date}: Created canonical memory.\n`;
    return this.createNote({ path, title: args.title, body, type: "canonical", tags: args.tags ?? ["memory"], aliases: args.aliases, links: [] });
  }

  async recordDecision(args: { title: string; context: string; options?: string[]; chosen: string; rationale: string; consequences?: string; links?: string[]; date?: string }) {
    const date = args.date ?? frontmatterDate(this.now);
    const path = normalizeVaultPath(`${this.config.decisionsDir}/${date}-${slugifyTitle(args.title)}.md`);
    const body = `# ${args.title}\n\n## Context\n\n${args.context}\n\n## Options Considered\n\n${(args.options ?? []).map((o) => `- ${o}`).join("\n") || "- Not recorded"}\n\n## Decision\n\n${args.chosen}\n\n## Rationale\n\n${args.rationale}\n\n## Consequences and Follow-up\n\n${args.consequences ?? "Not recorded."}\n${args.links?.length ? `\n## Related\n\n${args.links.map((l) => `- [[${l}]]`).join("\n")}\n` : ""}`;
    return this.createNote({ path, title: args.title, body, type: "decision", tags: ["decision"], links: [] });
  }

  async updateSection(args: { path: string; heading: string; content: string; expectedSha?: string }) {
    const current = await this.backend.readFile(args.path);
    const parsed = parseMarkdown(current.content, filenameTitle(current.path));
    return this.summarize(await this.backend.writeFile(current.path, buildMarkdown({ ...parsed.frontmatter, updated: frontmatterDate(this.now) }, replaceSection(parsed.body, args.heading, args.content)), { expectedSha: args.expectedSha ?? current.sha, message: `Update section ${args.heading} in ${current.path}` }));
  }

  async appendSnapshot(args: { path: string; note: string; expectedSha?: string }) {
    return this.updateSection({ path: args.path, heading: "History", content: `- ${frontmatterDate(this.now)}: ${args.note}\n${sectionText(parseMarkdown((await this.backend.readFile(args.path)).content).body, "History")}`, expectedSha: args.expectedSha });
  }

  async tasks(includeCompleted = false) {
    return (await this.backend.listMarkdownFiles()).flatMap((file) => parseMarkdown(file.content, filenameTitle(file.path)).tasks.filter((task) => includeCompleted || !task.completed).map((task) => ({ path: file.path, ...task })));
  }

  async graph(path?: string, limit = this.config.graphResultLimit) { return this.graphFromFiles(await this.backend.listMarkdownFiles(), path, limit); }
  async health(folder?: string) {
    const files = (await this.backend.listMarkdownFiles()).filter((f) => !folder || f.path.startsWith(folder.replace(/\/$/, "") + "/"));
    const graph = this.graphFromFiles(files);
    const titles = files.map((f) => ({ file: f, parsed: parseMarkdown(f.content, filenameTitle(f.path)) }));
    const titleCounts = new Map<string, string[]>();
    titles.forEach(({ file, parsed }) => titleCounts.set(parsed.title, [...(titleCounts.get(parsed.title) ?? []), file.path]));
    return { noteCount: files.length, orphanNotes: graph.orphans, brokenLinks: graph.missingLinks, duplicateTitles: [...titleCounts.entries()].filter(([, paths]) => paths.length > 1).map(([title, paths]) => ({ title, paths })), staleCanonicalMemories: titles.filter(({ file, parsed }) => parsed.type === "canonical" && daysSince(file.updatedAt) > 180).map(({ file }) => file.path), sparseStubs: titles.filter(({ file, parsed }) => parsed.body.length < 120).map(({ file }) => file.path) };
  }

  private summarize(file: VaultFile, parsed = parseMarkdown(file.content, filenameTitle(file.path))): NoteSummary { return { path: file.path, title: parsed.title, aliases: parsed.aliases, tags: parsed.tags, type: parsed.type, sha: file.sha, updatedAt: file.updatedAt }; }
  private graphFromFiles(files: VaultFile[], focus?: string, limit = this.config.graphResultLimit) {
    const noteByTarget = new Map<string, string>();
    files.forEach((file) => { const parsed = parseMarkdown(file.content, filenameTitle(file.path)); [file.path, filenameTitle(file.path), parsed.title, ...parsed.aliases].forEach((name) => noteByTarget.set(normalizeLinkTarget(name), file.path)); });
    const backlinks: Record<string, string[]> = {}; const outgoing: Record<string, string[]> = {}; const missingLinks: { source: string; target: string }[] = [];
    files.forEach((file) => { const parsed = parseMarkdown(file.content, filenameTitle(file.path)); outgoing[file.path] = unique(parsed.links.map((l) => noteByTarget.get(normalizeLinkTarget(l.target)) ?? l.target)); parsed.links.forEach((l) => { const target = noteByTarget.get(normalizeLinkTarget(l.target)); if (target) backlinks[target] = unique([...(backlinks[target] ?? []), file.path]); else missingLinks.push({ source: file.path, target: l.target }); }); });
    const neighborhood: Record<string, string[]> = {}; files.forEach((file) => neighborhood[file.path] = unique([...(backlinks[file.path] ?? []), ...(outgoing[file.path] ?? []).filter((p) => noteByTarget.has(normalizeLinkTarget(p)))]).slice(0, limit));
    const orphans = files.map((f) => f.path).filter((p) => !(backlinks[p]?.length) && !(outgoing[p]?.length));
    return focus ? { focus, backlinks, outgoing, neighborhood, missingLinks, orphans, local: neighborhood[focus]?.slice(0, limit) ?? [] } : { backlinks, outgoing, neighborhood, missingLinks, orphans };
  }
}


function requireExpectedSha(expectedSha?: string) { if (!expectedSha) throw new Error("expectedSha is required."); }
function splitFrontmatter(raw: string) {
  const match = /^---(?:\r?\n)([\s\S]*?)(?:\r?\n)---[^\S\r\n]*(?:\r?\n|$)/.exec(raw);
  if (!match) return { frontmatter: "", body: raw };
  return { frontmatter: match[0], body: raw.slice(match[0].length) };
}
function buildTree(files: string[], depth: number) {
  const root: Record<string, any> = {};
  for (const file of files.sort()) {
    const parts = file.split("/").filter(Boolean);
    let node = root;
    for (let index = 0; index < parts.length && index <= depth; index += 1) {
      const part = index === depth && index < parts.length - 1 ? "..." : parts[index];
      node[part] ??= {};
      node = node[part];
      if (part === "...") break;
    }
  }
  return renderTree(root);
}
function renderTree(node: Record<string, any>, prefix = ""): string[] {
  return Object.keys(node).flatMap((name, index, names) => {
    const last = index === names.length - 1;
    const branch = `${prefix}${last ? "└──" : "├──"} ${name}`;
    const childPrefix = `${prefix}${last ? "    " : "│   "}`;
    return [branch, ...renderTree(node[name], childPrefix)];
  });
}
function unifiedDiff(filePath: string, oldText: string, newText: string) {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const rows = [`--- a/${filePath}`, `+++ b/${filePath}`, `@@ -1,${oldLines.length} +1,${newLines.length} @@`];
  const max = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < max; i += 1) {
    if (oldLines[i] === newLines[i]) rows.push(` ${oldLines[i] ?? ""}`);
    else {
      if (i < oldLines.length) rows.push(`-${oldLines[i]}`);
      if (i < newLines.length) rows.push(`+${newLines[i]}`);
    }
  }
  return rows.join("\n");
}
function filenameTitle(filePath: string) { return filePath.split("/").pop()?.replace(/\.md$/, "") ?? filePath; }
function normalizeLinkTarget(target: string) { return target.replace(/\.md$/, "").split("#")[0].toLowerCase().trim(); }
function withLinks(body: string, links?: string[]) { return `${body.trim()}${links?.length ? `\n\nRelated: ${links.map((l) => `[[${l}]]`).join(", ")}` : ""}\n`; }
function timeStamp(date: Date) { return date.toISOString().slice(11, 16); }
function sectionText(body: string, heading: string) { const lines = body.split(/\r?\n/); const hs = lines.map((l, i) => ({ m: /^(#{1,6})\s+(.+)$/.exec(l), i })).filter((x) => x.m); const h = hs.find((x) => x.m?.[2].trim().toLowerCase() === heading.toLowerCase()); if (!h?.m) return ""; const next = hs.find((x) => x.i > h.i && (x.m?.[1].length ?? 9) <= h.m![1].length); return lines.slice(h.i + 1, next?.i).join("\n").trim(); }
function unique<T>(items: T[]) { return [...new Set(items)]; }
function similarity(a: string, b: string) { return a.split(/\s+/).filter((w) => b.includes(w)).length; }
function daysSince(iso?: string) { return iso ? (Date.now() - new Date(iso).getTime()) / 86_400_000 : 9999; }
