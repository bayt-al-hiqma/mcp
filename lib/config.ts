export type VaultBackendKind = "github" | "local";

export type AppConfig = {
  backend: VaultBackendKind;
  diagnosticsToken?: string;
  oauthOwnerPassword?: string;
  oauthTokenSecret?: string;
  oauthResource?: string;
  oauthTokenTtlSeconds?: number;
  oauthCodeTtlSeconds?: number;
  githubToken?: string;
  githubOwner?: string;
  githubRepo?: string;
  githubBranch: string;
  vaultRoot: string;
  localVaultDir: string;
  dailyNotesDir: string;
  canonicalNotesDir: string;
  decisionsDir: string;
  searchResultLimit: number;
  graphResultLimit: number;
  maxFileSizeBytes: number;
};

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function optionalNumberEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function getConfig(): AppConfig {
  const backend = (process.env.VAULT_BACKEND === "github" ? "github" : "local") as VaultBackendKind;
  return {
    backend,
    diagnosticsToken: process.env.DIAGNOSTICS_TOKEN,
    oauthOwnerPassword: process.env.OAUTH_OWNER_PASSWORD,
    oauthTokenSecret: process.env.OAUTH_TOKEN_SECRET,
    oauthResource: process.env.OAUTH_RESOURCE,
    oauthTokenTtlSeconds: optionalNumberEnv("OAUTH_TOKEN_TTL_SECONDS"),
    oauthCodeTtlSeconds: optionalNumberEnv("OAUTH_CODE_TTL_SECONDS"),
    githubToken: process.env.GITHUB_TOKEN,
    githubOwner: process.env.GITHUB_OWNER,
    githubRepo: process.env.GITHUB_REPO,
    githubBranch: process.env.GITHUB_BRANCH ?? "main",
    vaultRoot: process.env.VAULT_ROOT ?? "",
    localVaultDir: process.env.LOCAL_VAULT_DIR ?? "./vault",
    dailyNotesDir: process.env.DAILY_NOTES_DIR ?? "Daily",
    canonicalNotesDir: process.env.CANONICAL_NOTES_DIR ?? "Memories",
    decisionsDir: process.env.DECISIONS_DIR ?? "Decisions",
    searchResultLimit: numberEnv("SEARCH_RESULT_LIMIT", 8),
    graphResultLimit: numberEnv("GRAPH_RESULT_LIMIT", 20),
    maxFileSizeBytes: numberEnv("MAX_FILE_SIZE_BYTES", 262_144),
  };
}

export function configStatus(config = getConfig()) {
  const required = config.backend === "github"
    ? ["GITHUB_TOKEN", "GITHUB_OWNER", "GITHUB_REPO"]
    : ["LOCAL_VAULT_DIR"];
  const missing = required.filter((name) => !process.env[name]);
  const mcpAuth = config.oauthOwnerPassword && config.oauthTokenSecret ? "oauth" : "none";
  return {
    ok: missing.length === 0,
    backend: config.backend,
    missing,
    configured: {
      mcpAuth,
      oauthResource: config.oauthResource,
      oauthTokenTtlSeconds: config.oauthTokenTtlSeconds,
      oauthCodeTtlSeconds: config.oauthCodeTtlSeconds,
      diagnosticsProtected: Boolean(config.diagnosticsToken),
      githubOwner: Boolean(config.githubOwner),
      githubRepo: Boolean(config.githubRepo),
      githubBranch: config.githubBranch,
      vaultRoot: config.vaultRoot || "/",
      dailyNotesDir: config.dailyNotesDir,
      searchResultLimit: config.searchResultLimit,
      graphResultLimit: config.graphResultLimit,
      maxFileSizeBytes: config.maxFileSizeBytes,
    },
  };
}

export function redact(value: unknown): unknown {
  if (typeof value === "string") {
    if (!value) return value;
    return value.length <= 4 ? "****" : `${value.slice(0, 2)}***${value.slice(-2)}`;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, /token|secret|key|password/i.test(key) ? redact(String(val ?? "")) : redact(val)]));
  }
  return value;
}
