# Personal Memory MCP Specification

## 1. Purpose

This project specifies a personal memory MCP server for daily ChatGPT conversations. Its purpose is to give ChatGPT a durable, user-controlled memory layer comparable to Codex-style persistent memories, but optimized for ordinary daily talking rather than software development.

The MCP should let a conversational assistant remember useful facts, preferences, reflections, decisions, relationships, projects, recurring tasks, and evolving self-knowledge across chats. It should do this by reading from and writing to a private Markdown knowledge vault that remains owned by the user.

The desired product is not a generic note editor. It is a trusted memory companion that helps ChatGPT:

- recall relevant context at the right moment;
- store distilled memories without dumping whole conversations;
- update old memories when the user's life or preferences change;
- preserve an auditable history of important changes;
- keep memories organized enough to stay useful over months or years;
- run as a hosted Vercel app that exposes an MCP endpoint ChatGPT can call.

## 2. Product Principles

1. **User-owned memory**: The user's vault is the source of truth. The MCP must never make a proprietary hosted database the only copy of important memories.
2. **Distillation over transcripts**: The MCP stores concise, meaningful memories, reflections, decisions, and summaries rather than raw chat logs.
3. **Daily usefulness**: Tooling should support normal conversations about life, work, plans, emotions, people, ideas, purchases, health habits, and goals.
4. **Context on demand**: The assistant should retrieve the smallest relevant set of memories needed for the current conversation.
5. **Safe mutation**: Read operations should be easy. Writes should be structured, reversible, conflict-aware, and audit-friendly.
6. **Obsidian-compatible Markdown**: Notes should remain useful outside ChatGPT in common Markdown or Obsidian workflows.
7. **Transparent behavior**: The user should be able to inspect what was stored, why it was stored, and what changed.
8. **Portable deployment**: A new implementation should be able to run locally and as a Vercel-hosted web app.

## 3. Primary User Stories

### 3.1 Daily Conversation Memory

- As a user, I want ChatGPT to remember durable facts about me so I do not need to repeat them in future chats.
- As a user, I want ChatGPT to recall relevant preferences, constraints, projects, relationships, and prior decisions while chatting.
- As a user, I want ChatGPT to write a short daily reflection or log entry when something important happens.
- As a user, I want ChatGPT to distinguish between a temporary comment and a memory worth keeping.
- As a user, I want ChatGPT to update stale memories when I correct it or when my situation changes.

### 3.2 Codex-Style Memory Recreation for ChatGPT

- As a user, I want persistent, editable memories that survive across ChatGPT sessions.
- As a user, I want the assistant to search memories semantically and structurally before answering questions that depend on personal context.
- As a user, I want memories to be granular enough to retrieve individually, but connected enough to form a useful personal knowledge graph.
- As a user, I want memory writes to be summarized and categorized so that my vault stays understandable.

### 3.3 Vault Stewardship

- As a user, I want the MCP to find relevant notes by path, title, alias, tag, link, or natural phrase.
- As a user, I want the MCP to expose backlinks, related notes, tasks, and graph context.
- As a user, I want the MCP to identify clutter such as orphaned notes, broken links, duplicates, and stale canonical notes.
- As a user, I want the MCP to propose updates separately from applying them when the change could be risky.

### 3.4 Deployment and Operation

- As a user, I want to deploy the MCP as a Vercel app with a public HTTPS MCP endpoint protected by authentication.
- As a user, I want a simple setup page that explains required environment variables, vault configuration, and ChatGPT connection steps.
- As a developer, I want a test suite that lets me rebuild the MCP from this specification with confidence.

## 4. System Scope

### 4.1 In Scope

The MCP must provide:

- an MCP-compatible JSON-RPC endpoint;
- a tool catalog for reading, searching, creating, appending, and updating memory notes;
- a durable Markdown vault backend;
- daily-note support;
- canonical memory-note support;
- decision-record support;
- backlinks, tags, aliases, headings, wikilinks, tasks, and graph awareness;
- conflict detection for writes;
- path-safety validation;
- health checks and diagnostics;
- unit tests for core memory behavior;
- Vercel-compatible deployment.

### 4.2 Out of Scope for the Core Specification

The core specification does not require:

- a specific programming language or framework;
- a specific database, if Markdown remains the durable export/source of truth;
- a specific AI model provider for optional analysis features;
- full Obsidian plugin development;
- deletion or bulk destructive operations in the initial version;
- storage of raw full conversation transcripts by default.

## 5. Memory Model

The implementation should treat the vault as a collection of Markdown memory records. A record may be a daily note, canonical memory, decision record, project note, person note, task-bearing note, or ordinary reference note.

### 5.1 Required Note Concepts

Each memory record should support, where applicable:

- **path**: unique vault-relative Markdown path;
- **title**: human-readable note title;
- **aliases**: alternative names the user or assistant may use;
- **tags**: lightweight categorization;
- **type**: note category such as daily, canonical, decision, person, project, reflection, task, or reference;
- **created date**;
- **updated date**;
- **links**: explicit wikilinks or Markdown links to other records;
- **sections**: headed Markdown regions that can be targeted safely;
- **history**: an optional evolution log for canonical memories;
- **review metadata**: optional freshness and review cadence fields.

### 5.2 Daily Notes

Daily notes are append-oriented records for the user's day. They should capture distilled conversational memories such as:

- reflections;
- events;
- plans;
- emotional state;
- decisions made during conversation;
- expenses or lightweight logs when explicitly requested;
- links to related canonical memories, people, projects, or decisions.

Daily notes must not become unfiltered transcript dumps. The assistant should write concise entries that remain useful when reread later.

### 5.3 Canonical Memories

Canonical memories are source-of-truth records about enduring or important topics. Examples include:

- user preferences;
- identity and background facts;
- health routines and constraints;
- long-running goals;
- relationships and people context;
- ongoing projects;
- beliefs, values, and decision principles;
- stable facts the assistant should remember in future conversations.

Canonical memories should support both current-state replacement and historical snapshots. The user should be able to see how a memory evolved over time.

### 5.4 Decision Records

Decision records preserve important choices and their rationale. A decision record should include:

- title;
- date;
- context;
- options considered;
- chosen option;
- rationale;
- consequences or follow-up notes;
- links to related memories.

### 5.5 Tasks

The MCP should detect Markdown task syntax in notes and expose task retrieval. Tasks should retain their note path, heading context, completion status, tags, linked notes, and surrounding context.

## 6. MCP Protocol Requirements

### 6.1 Endpoint

The application must expose an HTTPS-compatible MCP endpoint suitable for Vercel deployment and ChatGPT connection.

Required JSON-RPC methods:

- `initialize` returns protocol metadata and advertised capabilities.
- `tools/list` returns the available tool catalog.
- `tools/call` invokes a named tool with JSON arguments.
- `ping` returns a successful empty response.

### 6.2 Response Behavior

- All JSON-RPC responses must preserve request identifiers.
- Invalid JSON must return a parse error.
- Invalid JSON-RPC envelopes must return an invalid request error.
- Unknown methods or tools must return an appropriate not-found error.
- Tool failures must return structured errors without leaking secrets.

### 6.3 Tool Result Format

Tool results should be machine-readable, preferably JSON encoded in MCP text content unless richer MCP content types are intentionally supported. Results should include enough metadata for ChatGPT to decide what to do next without requiring another tool call unnecessarily.

## 7. Functional Capability Requirements

This specification intentionally does not prescribe a fixed set of MCP tool names or a required tool list. A conforming implementation should derive its exposed `tools/list` catalog from the user outcomes below, the MCP client constraints, and the implementation's safety model. Capabilities may be combined, split, renamed, or staged across multiple tools as long as the resulting MCP lets ChatGPT accomplish the desired memory workflows reliably and safely.

### 7.1 Memory Discovery and Retrieval

The MCP should let ChatGPT find and retrieve relevant memories without knowing exact file paths. The implementation should support identity resolution from common user references such as vault paths, filenames, note titles, aliases, wikilinks, folder/name references, and close or fuzzy matches. Low-confidence or ambiguous resolution should return enough alternatives for the assistant or user to choose safely.

The MCP should support ranked memory search across note titles, paths, aliases, tags, frontmatter/properties, headings, links, and body content. Search should be constrainable by useful dimensions such as folder, tag, linked note, task presence, property values, orphan status, and result limits. Results should include concise excerpts and metadata sufficient for deciding whether a follow-up read is needed.

The MCP should support reading an individual memory with its useful surrounding context. That context should include the note body, frontmatter, headings, outgoing links, backlinks, unlinked mentions, tasks, related-note hints, and storage metadata when available. The implementation should also support listing notes and identifying recently changed notes so ChatGPT can orient itself in the vault.

### 7.2 Relationship and Structure Awareness

The MCP should make the vault's structure available to ChatGPT in bounded, conversationally useful forms. It should be possible to inspect explicit backlinks, likely unlinked mentions, local note neighborhoods, tags, missing links, orphan notes, and task-bearing notes. Graph or relationship responses should be size-limited and focused so the assistant receives useful context rather than an overwhelming vault dump.

The MCP should preserve and understand Markdown structure well enough to work with headings, sections, tasks, wikilinks, Markdown links, frontmatter, aliases, tags, and canonical-memory history. This structure awareness is a product requirement independent of how many MCP tools expose it.

### 7.3 Memory Capture and Mutation

The MCP should let ChatGPT store distilled memories in the right form for later daily use. Day-specific context should be appendable to daily notes, including reflections, logs, decisions, expenses, or custom entries when appropriate. Durable facts, preferences, goals, relationships, projects, beliefs, and constraints should be creatable or updatable as canonical memories. Important choices should be recordable as decision records with context, options, chosen path, rationale, consequences, and related links.

The MCP should support creating new Markdown notes with metadata and links while preventing accidental overwrites. It should support updating existing notes in safer targeted ways, especially by appending entries, updating specific sections, or adding historical snapshots. Full-note replacement may exist, but should be treated as higher risk than append-only or section-scoped changes.

The MCP should support non-mutating proposals for uncertain changes. For example, it should be possible for ChatGPT to ask for suggested improvements, missing links, duplicate candidates, structural fixes, or stale-memory updates without immediately applying them.

### 7.4 Vault Stewardship and Health

The MCP should help keep the user's memory vault useful over time. It should be able to report health signals such as orphan notes, broken links, stale canonical memories, duplicate titles, sparse stubs, and other clutter indicators. Cleanup-oriented capabilities should be advisory by default and should not delete or irreversibly transform notes automatically.

The application may also provide higher-level vault summaries, maps, theme clusters, or prune suggestions. If these features use an AI provider, the provider and model should be configurable and should not be required for the core read/write memory loop.

### 7.5 Safety Characteristics for Exposed Capabilities

Whatever tools are exposed, each capability should have an explicit safety posture. Read-only operations should be easy to call. Append-only and section-scoped mutations should be preferred for routine memory capture. Broad replacement, overwrite, cleanup, or destructive operations should be clearly distinguished, conflict-aware, and gated by additional safeguards.

## 8. Memory Behavior Requirements for Daily ChatGPT Use

A ChatGPT assistant using this MCP should follow these behavioral requirements:

1. **Retrieve before relying on memory**: For questions that depend on personal history, preferences, ongoing projects, or prior decisions, the assistant should search or read relevant memories before answering.
2. **Capture only durable value**: The assistant should store memories only when they are likely to matter later or when the user asks it to remember something.
3. **Prefer canonical updates for durable facts**: Stable user facts, preferences, constraints, and ongoing projects should become canonical memories or updates to existing canonical memories.
4. **Prefer daily notes for ephemeral day-level context**: Mood, events, temporary plans, and day-specific reflections should be appended to daily notes.
5. **Use decision records for meaningful commitments**: Important choices should be recorded with context and rationale.
6. **Avoid duplication**: Before creating a new canonical memory, the assistant should search for existing related memories and update or link them when appropriate.
7. **Handle corrections as updates**: When the user corrects a remembered fact, the assistant should update the old memory rather than merely adding contradictory text.
8. **Expose uncertainty**: Low-confidence resolution or ambiguous matches should be surfaced to the assistant or user before mutation.
9. **Keep memories readable**: Written notes should be concise, titled, linked, and tagged enough for later manual review.

## 9. Safety, Privacy, and Security Requirements

### 9.1 Authentication

A deployed MCP endpoint must require authentication for all non-public operations. A bearer token or equivalent secret is acceptable for the initial version.

### 9.2 Secret Handling

- API tokens, vault credentials, and model-provider keys must be server-side only.
- Secrets must never be returned in tool responses, logs intended for users, or client-side bundles.
- Diagnostic endpoints must redact secrets.

### 9.3 Path Safety

All vault paths must be normalized and validated. The MCP must reject path traversal, absolute paths, and paths outside the configured vault root.

### 9.4 Write Safety

- Writes must be auditable through the storage backend's history or an equivalent change log.
- Conflict detection must be available for updates.
- Append and targeted section updates should be preferred over full replacement.
- Destructive operations should be absent or explicitly gated in the initial version.

### 9.5 Privacy by Design

The MCP should minimize exposure of unrelated personal notes. Search and read tools should return bounded, relevant context rather than indiscriminately returning the whole vault.

## 10. Deployment Requirements

### 10.1 Vercel App Compatibility

A conforming implementation must be able to run as a Vercel app with:

- a server-side MCP route;
- a health endpoint;
- a setup or landing page explaining configuration;
- environment-variable based configuration;
- no reliance on local persistent disk for the durable vault;
- compatibility with serverless execution constraints.

### 10.2 Local Development

A conforming implementation should support local development with commands for:

- installing dependencies;
- running the web app locally;
- running unit tests;
- building for production;
- optionally running linting and type checks.

### 10.3 Required Configuration

The application must document configuration for:

- vault backend credentials;
- vault owner or namespace;
- vault repository or storage identifier;
- branch or version target when applicable;
- vault root path;
- daily notes directory;
- MCP authentication secret;
- optional AI provider credentials;
- search and graph result limits;
- maximum processed file size.

## 11. Observability and Diagnostics

The application should provide:

- a health endpoint indicating whether required configuration is present;
- a vault diagnostics endpoint or equivalent setup check for maintainers;
- clear error messages for missing credentials, inaccessible vaults, invalid paths, conflicts, and rate limits;
- logs that are useful for debugging without exposing secrets or excessive personal content.

## 12. Interoperability Requirements

The vault content must remain useful if the MCP is removed. Therefore:

- notes should be plain Markdown;
- metadata should use common frontmatter conventions;
- links should use Obsidian-style wikilinks or standard Markdown links;
- tasks should use common Markdown checkbox syntax;
- generated notes should avoid opaque binary or proprietary formats.

## 13. Quality and Test Requirements

A new implementation must include automated tests for the memory system. At minimum, tests should cover the following categories.

### 13.1 Protocol Tests

- initialize response shape;
- tools/list response shape and advertised capability metadata;
- tools/call dispatch for the implementation-derived tool catalog;
- invalid JSON and invalid request handling;
- unknown method and unknown tool errors;
- ping behavior.

### 13.2 Markdown and Note Parsing Tests

- frontmatter parsing and generation;
- title extraction;
- alias extraction;
- tag extraction from frontmatter and inline content;
- wikilink parsing;
- Markdown link parsing;
- heading parsing;
- section detection and replacement;
- task parsing;
- excerpt generation.

### 13.3 Search and Resolution Tests

- exact path resolution;
- filename resolution;
- title resolution;
- alias resolution;
- wikilink resolution;
- fuzzy or ambiguous matches;
- ranked search by title, alias, tag, heading, property, link, and body content;
- folder, tag, linked-note, task, property, and orphan filters.

### 13.4 Read Context Tests

- backlinks;
- unlinked mentions;
- related-note hints;
- graph generation;
- missing links;
- orphan detection.

### 13.5 Write Capability Tests

- daily note creation;
- daily note append;
- structured daily entry kinds;
- note creation with metadata and links;
- overwrite prevention;
- conflict detection;
- full note update;
- section upsert;
- snapshot append;
- canonical memory create and update;
- decision record creation;
- path traversal rejection.

### 13.6 Vault Health Tests

- orphan detection;
- broken link detection;
- stale canonical memory detection;
- duplicate title detection;
- folder-scoped health checks.

### 13.7 Deployment and Configuration Tests

- missing required environment variables are reported clearly;
- health endpoint behavior;
- Vercel production build succeeds;
- server-only secrets are not exposed to client-rendered pages.

## 14. Acceptance Criteria

A rebuilt implementation satisfies this specification when:

1. It can be deployed to Vercel and exposes a working authenticated MCP endpoint.
2. ChatGPT can list and call tools from the MCP endpoint.
3. The assistant can search, read, and retrieve relevant personal memories during daily conversation.
4. The assistant can append distilled daily memories and create or update canonical memories.
5. The assistant can record important decisions with context and rationale.
6. The assistant can inspect backlinks, tasks, recent notes, and local graph context.
7. Writes are path-safe, conflict-aware, and auditable.
8. The vault remains plain Markdown and usable outside the MCP.
9. Unit tests cover protocol, parsing, search, context, write capabilities, health checks, and deployment-critical behavior.
10. Documentation explains setup, configuration, security expectations, and ChatGPT usage.

## 15. Non-Goals and Anti-Requirements

- The MCP should not silently save everything the user says.
- The MCP should not require the user to abandon their Markdown vault.
- The MCP should not expose the full vault to every conversation when only a few memories are relevant.
- The MCP should not perform irreversible cleanup automatically.
- The MCP should not depend on a single AI provider for core memory read/write behavior.
- The MCP should not hide memory changes from the user.

## 16. Suggested First Conversation Flow

A new implementation should support this practical daily flow:

1. The user chats normally with ChatGPT.
2. When the conversation needs personal context, ChatGPT searches and reads relevant memories.
3. When something should be remembered, ChatGPT stores a concise distilled entry.
4. If the memory is day-specific, ChatGPT appends to the daily note.
5. If the memory is durable, ChatGPT creates or updates a canonical memory.
6. If the memory is an important choice, ChatGPT records a decision.
7. ChatGPT links new memories to related notes where useful.
8. The user can later ask what ChatGPT remembers, inspect the vault, correct memories, or request cleanup suggestions.
