import path from "node:path/posix";

export function normalizeVaultPath(input: string): string {
  if (!input || typeof input !== "string") throw new Error("Path is required.");
  const normalizedSlashes = input.replace(/\\/g, "/").trim();
  if (normalizedSlashes.startsWith("/") || /^[a-zA-Z]:\//.test(normalizedSlashes)) throw new Error("Absolute vault paths are not allowed.");
  const normalized = path.normalize(normalizedSlashes);
  if (normalized === "." || normalized.startsWith("../") || normalized === ".." || normalized.includes("/../")) throw new Error("Path traversal is not allowed.");
  if (!normalized.endsWith(".md")) throw new Error("Vault paths must point to Markdown (.md) files.");
  return normalized;
}

export function joinVaultRoot(root: string, child: string): string {
  const safeChild = normalizeVaultPath(child);
  const safeRoot = root.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return safeRoot ? `${safeRoot}/${safeChild}` : safeChild;
}

export function slugifyTitle(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s_-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase();
  return slug || "untitled";
}
