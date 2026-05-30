import matter from "gray-matter";

export type Frontmatter = Record<string, unknown>;
export type Heading = { level: number; text: string; line: number; slug: string };
export type Link = { raw: string; target: string; alias?: string; type: "wikilink" | "markdown" };
export type Task = { text: string; completed: boolean; line: number; heading?: string; tags: string[]; links: Link[] };
export type ParsedNote = {
  frontmatter: Frontmatter;
  body: string;
  title: string;
  aliases: string[];
  tags: string[];
  type?: string;
  headings: Heading[];
  links: Link[];
  tasks: Task[];
};

export function parseMarkdown(raw: string, fallbackTitle = "Untitled"): ParsedNote {
  const file = matter(raw);
  const body = file.content.trimStart();
  const headings = parseHeadings(body);
  const title = String(file.data.title ?? headings[0]?.text ?? fallbackTitle);
  const aliases = unique(toArray(file.data.aliases ?? file.data.alias).map(String));
  const tags = unique([...toArray(file.data.tags ?? file.data.tag).flatMap((t) => String(t).split(/[\s,]+/)), ...parseInlineTags(body)].map((t) => t.replace(/^#/, "")).filter(Boolean));
  const links = parseLinks(body);
  return { frontmatter: file.data, body, title, aliases, tags, type: typeof file.data.type === "string" ? file.data.type : undefined, headings, links, tasks: parseTasks(body, headings) };
}

export function buildMarkdown(frontmatter: Frontmatter, body: string): string {
  return matter.stringify(body.trimEnd() + "\n", frontmatter).replace(/^---\n{}\n---\n/, "");
}

export function parseHeadings(body: string): Heading[] {
  return body.split(/\r?\n/).flatMap((line, index) => {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    return match ? [{ level: match[1].length, text: match[2].trim(), line: index + 1, slug: slugHeading(match[2]) }] : [];
  });
}

export function parseLinks(body: string): Link[] {
  const links: Link[] = [];
  for (const match of body.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g)) links.push({ raw: match[0], target: match[1].trim(), alias: match[2]?.trim(), type: "wikilink" });
  for (const match of body.matchAll(/(?<!!).?\[([^\]]+)\]\(([^)]+)\)/g)) {
    const target = match[2].trim();
    if (!/^https?:\/\//i.test(target)) links.push({ raw: match[0].trim(), target, alias: match[1].trim(), type: "markdown" });
  }
  return links;
}

export function parseTasks(body: string, headings = parseHeadings(body)): Task[] {
  let current: string | undefined;
  const byLine = new Map(headings.map((h) => [h.line, h.text]));
  return body.split(/\r?\n/).flatMap((line, index) => {
    const lineNumber = index + 1;
    if (byLine.has(lineNumber)) current = byLine.get(lineNumber);
    const match = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/.exec(line);
    if (!match) return [];
    return [{ text: match[2].trim(), completed: match[1].toLowerCase() === "x", line: lineNumber, heading: current, tags: parseInlineTags(match[2]).map((t) => t.slice(1)), links: parseLinks(match[2]) }];
  });
}

export function replaceSection(body: string, heading: string, replacement: string): string {
  const lines = body.split(/\r?\n/);
  const headings = parseHeadings(body);
  const found = headings.find((h) => h.text.toLowerCase() === heading.toLowerCase());
  if (!found) return `${body.trimEnd()}\n\n## ${heading}\n\n${replacement.trim()}\n`;
  const next = headings.find((h) => h.line > found.line && h.level <= found.level);
  const start = found.line;
  const end = next ? next.line - 1 : lines.length;
  const newLines = [...lines.slice(0, start), "", ...replacement.trim().split(/\r?\n/), ...lines.slice(end)];
  return newLines.join("\n").trimEnd() + "\n";
}

export function excerpt(body: string, query = "", maxLength = 220): string {
  const normalized = body.replace(/\s+/g, " ").trim();
  if (!query) return normalized.slice(0, maxLength);
  const index = normalized.toLowerCase().indexOf(query.toLowerCase());
  const start = index > 50 ? index - 50 : 0;
  return normalized.slice(start, start + maxLength);
}

export function parseInlineTags(body: string): string[] {
  return [...body.matchAll(/(^|\s)#([\p{L}\p{N}/_-]+)/gu)].map((m) => `#${m[2]}`);
}

export function frontmatterDate(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function slugHeading(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-");
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}
function unique<T>(values: T[]): T[] { return [...new Set(values)]; }
