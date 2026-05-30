/**
 * Core types for the Personal Memory MCP Server
 */

export interface Config {
  // Vault configuration
  vaultOwner: string;
  vaultRepo: string;
  vaultBranch: string;
  vaultRoot: string;
  dailyNotesDir: string;

  // Authentication
  githubToken: string;
  mcpAuthSecret: string;

  // Optional AI provider
  aiProvider?: string;
  aiApiKey?: string;

  // Limits
  maxFileSize: number;
  maxSearchResults: number;
  maxGraphNodes: number;
}

export interface Note {
  path: string;
  title: string;
  aliases: string[];
  tags: string[];
  type?: NoteType;
  created?: Date;
  updated?: Date;
  links: Link[];
  sections: Section[];
  tasks: Task[];
  frontmatter: Record<string, any>;
  content: string;
  rawContent: string;
}

export type NoteType = 'daily' | 'canonical' | 'decision' | 'person' | 'project' | 'reflection' | 'task' | 'reference';

export interface Link {
  type: 'wikilink' | 'markdown';
  target: string;
  alias?: string;
  line: number;
}

export interface Section {
  heading: string;
  level: number;
  content: string;
  startLine: number;
  endLine: number;
}

export interface Task {
  content: string;
  completed: boolean;
  line: number;
  heading?: string;
  tags: string[];
}

export interface SearchResult {
  path: string;
  title: string;
  score: number;
  excerpt?: string;
  matchType: 'title' | 'alias' | 'tag' | 'heading' | 'content' | 'property';
  matchContext?: string;
}

export interface NoteContext {
  note: Note;
  backlinks: BacklinkInfo[];
  unlinkedMentions: UnlinkedMention[];
  relatedNotes: SearchResult[];
  orphan: boolean;
  brokenLinks: string[];
}

export interface BacklinkInfo {
  sourcePath: string;
  sourceTitle: string;
  context: string;
  line: number;
}

export interface UnlinkedMention {
  sourcePath: string;
  sourceTitle: string;
  context: string;
  line: number;
}

export interface DailyEntryOptions {
  type: 'reflection' | 'event' | 'decision' | 'plan' | 'mood' | 'log' | 'expense' | 'custom';
  content: string;
  links?: string[];
  tags?: string[];
}

export interface CanonicalMemoryOptions {
  title: string;
  type: NoteType;
  content: string;
  tags?: string[];
  aliases?: string[];
  links?: string[];
  preserveHistory?: boolean;
}

export interface DecisionRecordOptions {
  title: string;
  context: string;
  options: string[];
  chosen: string;
  rationale: string;
  consequences?: string;
  links?: string[];
  tags?: string[];
}

export interface VaultHealth {
  totalNotes: number;
  orphanedNotes: string[];
  brokenLinks: Array<{ source: string; target: string }>;
  duplicateTitles: Array<{ title: string; paths: string[] }>;
  staleCanonicalMemories: string[];
  sparseStubs: string[];
}

export interface WriteConflict {
  path: string;
  expectedHash?: string;
  actualHash?: string;
  message: string;
}
