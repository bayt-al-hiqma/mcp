import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { AppConfig, getConfig } from "./config";
import { joinVaultRoot, normalizeVaultPath } from "./pathSafety";

export type VaultFile = { path: string; content: string; sha?: string; updatedAt?: string };
export type WriteOptions = { expectedSha?: string; message?: string };
export type MoveOptions = { expectedSha: string; message?: string };

export interface VaultBackend {
  listMarkdownFiles(): Promise<VaultFile[]>;
  readFile(filePath: string): Promise<VaultFile>;
  writeFile(filePath: string, content: string, options?: WriteOptions): Promise<VaultFile>;
  moveFile(sourcePath: string, destinationPath: string, options: MoveOptions): Promise<VaultFile>;
  exists(filePath: string): Promise<boolean>;
}

export class LocalVaultBackend implements VaultBackend {
  constructor(private rootDir: string, private maxFileSizeBytes = 262_144) {}

  private fullPath(filePath: string): string {
    const safe = normalizeVaultPath(filePath);
    const base = path.resolve(this.rootDir);
    const full = path.resolve(base, safe);
    if (!full.startsWith(base + path.sep) && full !== base) throw new Error("Path escapes local vault root.");
    return full;
  }

  async listMarkdownFiles(): Promise<VaultFile[]> {
    await fs.mkdir(this.rootDir, { recursive: true });
    const out: VaultFile[] = [];
    const walk = async (dir: string) => {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.isFile() && entry.name.endsWith(".md")) {
          const stat = await fs.stat(full);
          if (stat.size <= this.maxFileSizeBytes) {
            const rel = path.relative(this.rootDir, full).replace(/\\/g, "/");
            const content = await fs.readFile(full, "utf8");
            out.push({ path: rel, content, sha: contentSha(content), updatedAt: stat.mtime.toISOString() });
          }
        }
      }
    };
    await walk(this.rootDir);
    return out;
  }

  async readFile(filePath: string): Promise<VaultFile> {
    const full = this.fullPath(filePath);
    const stat = await fs.stat(full);
    if (stat.size > this.maxFileSizeBytes) throw new Error("File exceeds MAX_FILE_SIZE_BYTES.");
    const content = await fs.readFile(full, "utf8");
    return { path: normalizeVaultPath(filePath), content, sha: contentSha(content), updatedAt: stat.mtime.toISOString() };
  }

  async exists(filePath: string): Promise<boolean> {
    try { await fs.access(this.fullPath(filePath)); return true; } catch { return false; }
  }

  async writeFile(filePath: string, content: string, options: WriteOptions = {}): Promise<VaultFile> {
    const safe = normalizeVaultPath(filePath);
    if (options.expectedSha) {
      const current = await this.readFile(safe);
      if (current.sha !== options.expectedSha) throw new Error("Conflict: file changed since expectedSha.");
    }
    const full = this.fullPath(safe);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf8");
    return this.readFile(safe);
  }

  async moveFile(sourcePath: string, destinationPath: string, options: MoveOptions): Promise<VaultFile> {
    if (!options.expectedSha) throw new Error("expectedSha is required.");
    const source = await this.readFile(sourcePath);
    if (source.sha !== options.expectedSha) throw new Error("Conflict: file changed since expectedSha.");
    const safeDestination = normalizeVaultPath(destinationPath);
    if (await this.exists(safeDestination)) throw new Error("Refusing to overwrite existing note.");
    const from = this.fullPath(source.path);
    const to = this.fullPath(safeDestination);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.rename(from, to);
    return this.readFile(safeDestination);
  }
}

export class GitHubVaultBackend implements VaultBackend {
  constructor(private config: AppConfig) {}

  private headers() {
    if (!this.config.githubToken) throw new Error("GITHUB_TOKEN is required for GitHub vault access.");
    return { Authorization: `Bearer ${this.config.githubToken}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  }

  private api(pathname: string) {
    if (!this.config.githubOwner || !this.config.githubRepo) throw new Error("GITHUB_OWNER and GITHUB_REPO are required.");
    return `https://api.github.com/repos/${this.config.githubOwner}/${this.config.githubRepo}${pathname}`;
  }

  private repoPath(filePath: string) { return joinVaultRoot(this.config.vaultRoot, filePath); }

  async listMarkdownFiles(): Promise<VaultFile[]> {
    const treeUrl = this.api(`/git/trees/${encodeURIComponent(this.config.githubBranch)}?recursive=1`);
    const treeRes = await fetch(treeUrl, { headers: this.headers(), cache: "no-store" });
    if (!treeRes.ok) throw new Error(`GitHub tree request failed: ${treeRes.status}`);
    const treeJson = await treeRes.json() as { tree: { path: string; type: string; size?: number }[] };
    const prefix = this.config.vaultRoot.replace(/^\/+|\/+$/g, "");
    const files = treeJson.tree
      .filter((item) => item.type === "blob" && item.path.endsWith(".md") && (!prefix || item.path === prefix || item.path.startsWith(`${prefix}/`)) && (item.size ?? 0) <= this.config.maxFileSizeBytes)
      .slice(0, 500);
    return Promise.all(files.map(async (item) => {
      const vaultPath = prefix ? item.path.slice(prefix.length + 1) : item.path;
      return this.readFile(vaultPath);
    }));
  }

  async readFile(filePath: string): Promise<VaultFile> {
    const safe = normalizeVaultPath(filePath);
    const repoPath = this.repoPath(safe);
    const res = await fetch(this.api(`/contents/${encodeURIComponent(repoPath).replaceAll("%2F", "/")}?ref=${encodeURIComponent(this.config.githubBranch)}`), { headers: this.headers(), cache: "no-store" });
    if (!res.ok) throw new Error(`GitHub read failed for ${safe}: ${res.status}`);
    const json = await res.json() as { content: string; encoding: string; sha: string };
    if (json.encoding !== "base64") throw new Error("Unsupported GitHub content encoding.");
    return { path: safe, content: Buffer.from(json.content, "base64").toString("utf8"), sha: json.sha };
  }

  async exists(filePath: string): Promise<boolean> { try { await this.readFile(filePath); return true; } catch { return false; } }

  async writeFile(filePath: string, content: string, options: WriteOptions = {}): Promise<VaultFile> {
    const safe = normalizeVaultPath(filePath);
    const repoPath = this.repoPath(safe);
    const body: Record<string, string> = { message: options.message ?? `Update ${safe}`, content: Buffer.from(content, "utf8").toString("base64"), branch: this.config.githubBranch };
    if (options.expectedSha) body.sha = options.expectedSha;
    const res = await fetch(this.api(`/contents/${encodeURIComponent(repoPath).replaceAll("%2F", "/")}`), { method: "PUT", headers: { ...this.headers(), "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    if (res.status === 409) throw new Error("Conflict: GitHub rejected stale sha.");
    if (!res.ok) throw new Error(`GitHub write failed for ${safe}: ${res.status}`);
    return this.readFile(safe);
  }

  async moveFile(sourcePath: string, destinationPath: string, options: MoveOptions): Promise<VaultFile> {
    if (!options.expectedSha) throw new Error("expectedSha is required.");
    const source = await this.readFile(sourcePath);
    if (source.sha !== options.expectedSha) throw new Error("Conflict: file changed since expectedSha.");
    const destination = normalizeVaultPath(destinationPath);
    if (await this.exists(destination)) throw new Error("Refusing to overwrite existing note.");
    const refRes = await fetch(this.api(`/git/ref/heads/${encodeURIComponent(this.config.githubBranch)}`), { headers: this.headers(), cache: "no-store" });
    if (!refRes.ok) throw new Error(`GitHub ref request failed: ${refRes.status}`);
    const ref = await refRes.json() as { object: { sha: string } };
    const commitRes = await fetch(this.api(`/git/commits/${ref.object.sha}`), { headers: this.headers(), cache: "no-store" });
    if (!commitRes.ok) throw new Error(`GitHub commit request failed: ${commitRes.status}`);
    const commit = await commitRes.json() as { tree: { sha: string } };
    const treeRes = await fetch(this.api("/git/trees"), { method: "POST", headers: { ...this.headers(), "Content-Type": "application/json" }, body: JSON.stringify({ base_tree: commit.tree.sha, tree: [{ path: this.repoPath(destination), mode: "100644", type: "blob", sha: source.sha }, { path: this.repoPath(source.path), mode: "100644", type: "blob", sha: null }] }), cache: "no-store" });
    if (!treeRes.ok) throw new Error(`GitHub move tree request failed: ${treeRes.status}`);
    const tree = await treeRes.json() as { sha: string };
    const newCommitRes = await fetch(this.api("/git/commits"), { method: "POST", headers: { ...this.headers(), "Content-Type": "application/json" }, body: JSON.stringify({ message: options.message ?? `Move note ${source.path} to ${destination}`, tree: tree.sha, parents: [ref.object.sha] }), cache: "no-store" });
    if (!newCommitRes.ok) throw new Error(`GitHub move commit request failed: ${newCommitRes.status}`);
    const newCommit = await newCommitRes.json() as { sha: string };
    const updateRefRes = await fetch(this.api(`/git/refs/heads/${encodeURIComponent(this.config.githubBranch)}`), { method: "PATCH", headers: { ...this.headers(), "Content-Type": "application/json" }, body: JSON.stringify({ sha: newCommit.sha, force: false }), cache: "no-store" });
    if (updateRefRes.status === 409) throw new Error("Conflict: GitHub branch changed during move.");
    if (!updateRefRes.ok) throw new Error(`GitHub move ref update failed: ${updateRefRes.status}`);
    return this.readFile(destination);
  }
}

function contentSha(content: string) { return crypto.createHash("sha256").update(content).digest("hex"); }

export function createVaultBackend(config = getConfig()): VaultBackend {
  return config.backend === "github" ? new GitHubVaultBackend(config) : new LocalVaultBackend(config.localVaultDir, config.maxFileSizeBytes);
}
