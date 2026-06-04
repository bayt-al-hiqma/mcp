import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"

export const OAUTH_SCOPES = ["memory:read", "memory:write"] as const
export const OAUTH_SCOPE = OAUTH_SCOPES.join(" ")

export type OAuthScope = (typeof OAUTH_SCOPES)[number]

// ============================================================================
// Dynamic Client Registration (RFC 7591)
// ============================================================================

export type OAuthClientMetadata = {
  redirect_uris: string[]
  token_endpoint_auth_method?: "none"
  grant_types?: string[]
  response_types?: string[]
  client_name?: string
  client_uri?: string
  logo_uri?: string
  scope?: string
  contacts?: string[]
  tos_uri?: string
  policy_uri?: string
  software_id?: string
  software_version?: string
}

export type RegisteredClient = {
  client_id: string
  client_secret?: string
  client_id_issued_at: number
  client_secret_expires_at?: number
  redirect_uris: string[]
  token_endpoint_auth_method: "none"
  grant_types: string[]
  response_types: string[]
  client_name?: string
  client_uri?: string
  logo_uri?: string
  scope: string
  contacts?: string[]
  tos_uri?: string
  policy_uri?: string
  software_id?: string
  software_version?: string
}

export type ClientRegistrationResponse = RegisteredClient & {
  registration_access_token?: string
  registration_client_uri?: string
}

export type ClientRegistrationError = {
  error: "invalid_redirect_uri" | "invalid_client_metadata" | "invalid_software_statement" | "unapproved_software_statement"
  error_description?: string
}

// In-memory client store for dynamically registered clients
// In production, this should be persisted to a database or file system
const dynamicClients = new Map<string, RegisteredClient>()

export function generateClientId(): string {
  return `dyn_${randomBytes(16).toString("hex")}`
}

export function generateClientSecret(): string {
  return randomBytes(32).toString("base64url")
}

export function validateClientMetadata(metadata: unknown): { ok: true; metadata: OAuthClientMetadata } | { ok: false; error: ClientRegistrationError } {
  if (!metadata || typeof metadata !== "object") {
    return { ok: false, error: { error: "invalid_client_metadata", error_description: "Request body must be a JSON object." } }
  }

  const meta = metadata as Record<string, unknown>

  // redirect_uris is REQUIRED per RFC 7591
  if (!Array.isArray(meta.redirect_uris) || meta.redirect_uris.length === 0) {
    return { ok: false, error: { error: "invalid_client_metadata", error_description: "redirect_uris is required and must be a non-empty array." } }
  }

  // Validate each redirect_uri
  for (const uri of meta.redirect_uris) {
    if (typeof uri !== "string") {
      return { ok: false, error: { error: "invalid_redirect_uri", error_description: "Each redirect_uri must be a string." } }
    }
    try {
      const parsed = new URL(uri)
      // Allow http for localhost, require https otherwise
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return { ok: false, error: { error: "invalid_redirect_uri", error_description: `redirect_uri must use http or https: ${uri}` } }
      }
      if (parsed.protocol === "http:" && !isLocalhostUri(parsed)) {
        return { ok: false, error: { error: "invalid_redirect_uri", error_description: `Non-localhost redirect_uri must use https: ${uri}` } }
      }
    } catch {
      return { ok: false, error: { error: "invalid_redirect_uri", error_description: `Invalid redirect_uri: ${uri}` } }
    }
  }

  // Validate token_endpoint_auth_method - we only support "none" (public clients)
  if (meta.token_endpoint_auth_method !== undefined && meta.token_endpoint_auth_method !== "none") {
    return { ok: false, error: { error: "invalid_client_metadata", error_description: "Only token_endpoint_auth_method=none is supported (public clients)." } }
  }

  // Validate grant_types if provided
  // We accept refresh_token in DCR metadata for compatibility with clients like ChatGPT,
  // but we only actually support authorization_code. The response will reflect what we support.
  const ALLOWED_GRANT_TYPES = ["authorization_code", "refresh_token"] as const
  if (meta.grant_types !== undefined) {
    if (!Array.isArray(meta.grant_types)) {
      return { ok: false, error: { error: "invalid_client_metadata", error_description: "grant_types must be an array." } }
    }
    for (const gt of meta.grant_types) {
      if (!ALLOWED_GRANT_TYPES.includes(gt as typeof ALLOWED_GRANT_TYPES[number])) {
        return { ok: false, error: { error: "invalid_client_metadata", error_description: `Unsupported grant_type: ${gt}. Only authorization_code and refresh_token are accepted.` } }
      }
    }
  }

  // Validate response_types if provided
  if (meta.response_types !== undefined) {
    if (!Array.isArray(meta.response_types)) {
      return { ok: false, error: { error: "invalid_client_metadata", error_description: "response_types must be an array." } }
    }
    for (const rt of meta.response_types) {
      if (rt !== "code") {
        return { ok: false, error: { error: "invalid_client_metadata", error_description: `Unsupported response_type: ${rt}. Only code is supported.` } }
      }
    }
  }

  // Validate optional URI fields
  const uriFields = ["client_uri", "logo_uri", "tos_uri", "policy_uri"] as const
  for (const field of uriFields) {
    if (meta[field] !== undefined) {
      if (typeof meta[field] !== "string") {
        return { ok: false, error: { error: "invalid_client_metadata", error_description: `${field} must be a string.` } }
      }
      try {
        new URL(meta[field] as string)
      } catch {
        return { ok: false, error: { error: "invalid_client_metadata", error_description: `Invalid ${field}: ${meta[field]}` } }
      }
    }
  }

  // Validate optional string fields
  const stringFields = ["client_name", "software_id", "software_version"] as const
  for (const field of stringFields) {
    if (meta[field] !== undefined && typeof meta[field] !== "string") {
      return { ok: false, error: { error: "invalid_client_metadata", error_description: `${field} must be a string.` } }
    }
  }

  // Validate contacts if provided
  if (meta.contacts !== undefined) {
    if (!Array.isArray(meta.contacts)) {
      return { ok: false, error: { error: "invalid_client_metadata", error_description: "contacts must be an array." } }
    }
    for (const contact of meta.contacts) {
      if (typeof contact !== "string") {
        return { ok: false, error: { error: "invalid_client_metadata", error_description: "Each contact must be a string." } }
      }
    }
  }

  // Validate scope if provided
  if (meta.scope !== undefined && typeof meta.scope !== "string") {
    return { ok: false, error: { error: "invalid_client_metadata", error_description: "scope must be a string." } }
  }

  return {
    ok: true,
    metadata: {
      redirect_uris: meta.redirect_uris as string[],
      token_endpoint_auth_method: "none",
      grant_types: (meta.grant_types as string[] | undefined) ?? ["authorization_code"],
      response_types: (meta.response_types as string[] | undefined) ?? ["code"],
      client_name: meta.client_name as string | undefined,
      client_uri: meta.client_uri as string | undefined,
      logo_uri: meta.logo_uri as string | undefined,
      scope: (meta.scope as string | undefined) ?? OAUTH_SCOPE,
      contacts: meta.contacts as string[] | undefined,
      tos_uri: meta.tos_uri as string | undefined,
      policy_uri: meta.policy_uri as string | undefined,
      software_id: meta.software_id as string | undefined,
      software_version: meta.software_version as string | undefined,
    },
  }
}

function isLocalhostUri(url: URL): boolean {
  const host = url.hostname.toLowerCase()
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1"
}

export function registerClient(metadata: OAuthClientMetadata, config = getOAuthConfig()): RegisteredClient {
  const clientId = generateClientId()
  const now = epochSeconds()

  // Only store grant_types we actually support (authorization_code)
  // Even if client requested refresh_token, we don't support it yet
  const client: RegisteredClient = {
    client_id: clientId,
    client_id_issued_at: now,
    redirect_uris: metadata.redirect_uris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code"], // Only support authorization_code for now
    response_types: metadata.response_types ?? ["code"],
    client_name: metadata.client_name,
    client_uri: metadata.client_uri,
    logo_uri: metadata.logo_uri,
    scope: metadata.scope ?? OAUTH_SCOPE,
    contacts: metadata.contacts,
    tos_uri: metadata.tos_uri,
    policy_uri: metadata.policy_uri,
    software_id: metadata.software_id,
    software_version: metadata.software_version,
  }

  dynamicClients.set(clientId, client)
  return client
}

export function getRegisteredClient(clientId: string): RegisteredClient | null {
  return dynamicClients.get(clientId) ?? null
}

export function isClientAllowed(clientId: string, redirectUri: string, config = getOAuthConfig()): boolean {
  // If OAUTH_CLIENT_ID is set, only that specific client is allowed (static client)
  if (config.allowedClientId) {
    return clientId === config.allowedClientId
  }

  // Check if this is a dynamically registered client
  const dynamicClient = getRegisteredClient(clientId)
  if (dynamicClient) {
    // Validate the redirect_uri matches one of the registered URIs
    return dynamicClient.redirect_uris.includes(redirectUri)
  }

  // If no static client is configured and client is not dynamically registered,
  // allow any client (backwards compatible with the original behavior)
  return true
}

export function isDynamicClientRegistrationEnabled(config = getOAuthConfig()): boolean {
  // Dynamic client registration is enabled when OAuth is enabled
  // and no specific client_id is pinned via OAUTH_CLIENT_ID
  return config.enabled && !config.allowedClientId
}

// For testing purposes
export function clearDynamicClients(): void {
  dynamicClients.clear()
}

export type OAuthConfig = {
  enabled: boolean
  requested: boolean
  ownerPasswordConfigured: boolean
  baseUrl: string
  issuer: string
  resource: string
  resourceMetadataUrl: string
  secret?: string
  subject: string
  allowedClientId?: string
  codeTtlSeconds: number
  accessTokenTtlSeconds: number
  scopes: readonly OAuthScope[]
}

export type OAuthEnabledStatus = {
  enabled: boolean
  requested: boolean
  missing: string[]
}

export type OAuthConfigOptions = {
  env?: NodeJS.ProcessEnv
  request?: OAuthRequestLike
}

export type OAuthRequestLike = {
  url?: string
  headers?: HeadersLike
}

type HeadersLike = {
  get(name: string): string | null
}

export type AuthorizationCodeClaims = {
  kind: "authorization_code"
  iss: string
  aud: string
  sub: string
  clientId: string
  redirectUri: string
  codeChallenge: string
  codeChallengeMethod: "S256"
  scope: string
  iat: number
  exp: number
  jti: string
}

export type AccessTokenClaims = {
  kind: "access_token"
  iss: string
  aud: string
  sub: string
  clientId: string
  scope: string
  iat: number
  exp: number
  jti: string
}

export type IssueAuthorizationCodeInput = {
  clientId: string
  redirectUri: string
  codeChallenge: string
  scope?: string | readonly string[]
  subject?: string
  ttlSeconds?: number
  now?: Date | number
}

export type VerifyAuthorizationCodeOptions = {
  clientId?: string
  redirectUri?: string
  codeVerifier?: string
  now?: Date | number
  config?: OAuthConfig
}

export type IssueAccessTokenInput = {
  clientId: string
  scope?: string | readonly string[]
  subject?: string
  ttlSeconds?: number
  now?: Date | number
}

export type VerifyAccessTokenOptions = {
  requiredScopes?: string | readonly string[]
  clientId?: string
  now?: Date | number
  config?: OAuthConfig
}

export type UnauthorizedChallengeOptions = {
  realm?: string
  scope?: string | readonly string[]
  resourceMetadataUrl?: string
  error?: "invalid_request" | "invalid_token" | "insufficient_scope"
  errorDescription?: string
}

type SignedEnvelopeHeader = {
  alg: "HS256"
  typ: "oauth+jws"
}

const DEFAULT_CODE_TTL_SECONDS = 300
const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 3600
const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/
const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/

export function getOAuthConfig(options: OAuthConfigOptions = {}): OAuthConfig {
  const env = options.env ?? process.env
  const baseUrl = absoluteBaseUrl(options.request, env)
  const secret = emptyToUndefined(env.OAUTH_TOKEN_SECRET) ?? emptyToUndefined(env.OAUTH_SECRET)
  const ownerPasswordConfigured = Boolean(emptyToUndefined(env.OAUTH_OWNER_PASSWORD))
  const requested = oauthRequested(env, secret)
  const resource = normalizeAbsoluteUrl(env.OAUTH_RESOURCE ?? `${baseUrl}/api/mcp`)
  const issuer = normalizeAbsoluteUrl(env.OAUTH_ISSUER ?? baseUrl)

  return {
    enabled: requested && Boolean(secret) && ownerPasswordConfigured,
    requested,
    ownerPasswordConfigured,
    baseUrl,
    issuer,
    resource,
    resourceMetadataUrl: oauthResourceMetadataUrl(baseUrl),
    secret,
    subject: env.OAUTH_SUBJECT ?? "single-user",
    allowedClientId: emptyToUndefined(env.OAUTH_CLIENT_ID),
    codeTtlSeconds: positiveIntegerEnv(env.OAUTH_CODE_TTL_SECONDS, DEFAULT_CODE_TTL_SECONDS),
    accessTokenTtlSeconds: positiveIntegerEnv(env.OAUTH_TOKEN_TTL_SECONDS ?? env.OAUTH_ACCESS_TOKEN_TTL_SECONDS, DEFAULT_ACCESS_TOKEN_TTL_SECONDS),
    scopes: OAUTH_SCOPES,
  }
}

export function oauthEnabledStatus(config = getOAuthConfig()): OAuthEnabledStatus {
  const missing = config.requested
    ? [
        ...(!config.secret ? ["OAUTH_TOKEN_SECRET"] : []),
        ...(!config.ownerPasswordConfigured ? ["OAUTH_OWNER_PASSWORD"] : []),
      ]
    : []
  return { enabled: config.enabled, requested: config.requested, missing }
}

export function isOAuthEnabled(config = getOAuthConfig()): boolean {
  return oauthEnabledStatus(config).enabled
}

export function absoluteBaseUrl(request?: OAuthRequestLike, env: NodeJS.ProcessEnv = process.env): string {
  const configured = emptyToUndefined(env.OAUTH_BASE_URL)
    ?? emptyToUndefined(env.NEXT_PUBLIC_APP_URL)
    ?? emptyToUndefined(env.NEXT_PUBLIC_BASE_URL)
    ?? emptyToUndefined(env.MCP_PUBLIC_ORIGIN)
    ?? emptyToUndefined(env.BASE_URL)
    ?? fromVercelUrl(env)
    ?? fromRequestHeaders(request)
    ?? fromRequestUrl(request)
    ?? "http://localhost:3000"

  return normalizeOrigin(configured)
}

export function oauthResourceMetadataUrl(baseUrl = absoluteBaseUrl()): string {
  return `${normalizeOrigin(baseUrl)}/.well-known/oauth-protected-resource`
}

export function issueAuthorizationCode(input: IssueAuthorizationCodeInput, config = getOAuthConfig()): string {
  assertUsableConfig(config)
  assertClientAllowed(input.clientId, config)
  if (!input.redirectUri) throw new Error("redirectUri is required")
  if (!input.codeChallenge) throw new Error("codeChallenge is required")
  if (!PKCE_CHALLENGE_PATTERN.test(input.codeChallenge)) throw new Error("codeChallenge must be a valid S256 challenge")

  const iat = epochSeconds(input.now)
  const payload: AuthorizationCodeClaims = {
    kind: "authorization_code",
    iss: config.issuer,
    aud: config.resource,
    sub: input.subject ?? config.subject,
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    codeChallengeMethod: "S256",
    scope: grantScope(input.scope),
    iat,
    exp: iat + (input.ttlSeconds ?? config.codeTtlSeconds),
    jti: randomTokenId(),
  }

  return signPayload(payload, config.secret)
}

export function verifyAuthorizationCode(token: string, options: VerifyAuthorizationCodeOptions = {}): AuthorizationCodeClaims | null {
  const config = options.config ?? getOAuthConfig()
  if (!config.secret) return null

  const payload = verifyPayload<AuthorizationCodeClaims>(token, "authorization_code", config, options.now)
  if (!payload) return null
  if (options.clientId && payload.clientId !== options.clientId) return null
  if (options.redirectUri && payload.redirectUri !== options.redirectUri) return null
  if (options.codeVerifier && !verifyPkceS256(options.codeVerifier, payload.codeChallenge)) return null
  if (config.allowedClientId && payload.clientId !== config.allowedClientId) return null

  return payload
}

export function issueAccessToken(input: IssueAccessTokenInput, config = getOAuthConfig()): string {
  assertUsableConfig(config)
  assertClientAllowed(input.clientId, config)

  const iat = epochSeconds(input.now)
  const payload: AccessTokenClaims = {
    kind: "access_token",
    iss: config.issuer,
    aud: config.resource,
    sub: input.subject ?? config.subject,
    clientId: input.clientId,
    scope: grantScope(input.scope),
    iat,
    exp: iat + (input.ttlSeconds ?? config.accessTokenTtlSeconds),
    jti: randomTokenId(),
  }

  return signPayload(payload, config.secret)
}

export function verifyAccessToken(token: string, options: VerifyAccessTokenOptions = {}): AccessTokenClaims | null {
  const config = options.config ?? getOAuthConfig()
  if (!config.secret) return null

  const payload = verifyPayload<AccessTokenClaims>(token, "access_token", config, options.now)
  if (!payload) return null
  if (options.clientId && payload.clientId !== options.clientId) return null
  if (config.allowedClientId && payload.clientId !== config.allowedClientId) return null
  if (!hasRequiredScopes(payload.scope, options.requiredScopes)) return null

  return payload
}

export function verifyPkceS256(verifier: string, challenge: string): boolean {
  if (!PKCE_VERIFIER_PATTERN.test(verifier) || !challenge) return false
  const derived = createHash("sha256").update(verifier).digest("base64url")
  return safeEqual(derived, challenge)
}

export function unauthorizedChallenge(options: UnauthorizedChallengeOptions = {}, config = getOAuthConfig()): string {
  const params = [
    ["realm", options.realm ?? "bayt-al-hiqma"],
    ["resource_metadata", options.resourceMetadataUrl ?? config.resourceMetadataUrl],
    ["scope", normalizeScope(options.scope)],
    ["error", options.error],
    ["error_description", options.errorDescription],
  ].filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0)

  return `Bearer ${params.map(([key, value]) => `${key}="${escapeHeaderValue(value)}"`).join(", ")}`
}

function signPayload<T extends object>(payload: T, secret: string): string {
  const header: SignedEnvelopeHeader = { alg: "HS256", typ: "oauth+jws" }
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`
  const signature = createHmac("sha256", secret).update(signingInput).digest("base64url")
  return `${signingInput}.${signature}`
}

function verifyPayload<T extends { kind: string; iss: string; aud: string; exp: number }>(
  token: string,
  kind: T["kind"],
  config: OAuthConfig,
  now?: Date | number,
): T | null {
  const [encodedHeader, encodedPayload, signature, ...extra] = token.split(".")
  if (!encodedHeader || !encodedPayload || !signature || extra.length > 0 || !config.secret) return null

  const expected = createHmac("sha256", config.secret).update(`${encodedHeader}.${encodedPayload}`).digest("base64url")
  if (!safeEqual(signature, expected)) return null

  const header = parseBase64UrlJson<SignedEnvelopeHeader>(encodedHeader)
  if (!header || header.alg !== "HS256" || header.typ !== "oauth+jws") return null

  const payload = parseBase64UrlJson<T>(encodedPayload)
  if (!payload || payload.kind !== kind) return null
  if (!urlsEquivalent(payload.iss, config.issuer) || !urlsEquivalent(payload.aud, config.resource)) return null
  if (!Number.isFinite(payload.exp) || payload.exp <= epochSeconds(now)) return null

  return payload
}

function normalizeScope(scope?: string | readonly string[]): string {
  try {
    return grantScope(scope) || OAUTH_SCOPE
  } catch {
    return OAUTH_SCOPE
  }
}

function grantScope(scope?: string | readonly string[]): string {
  const requested = scopeValues(scope)
  const unique = [...new Set(requested.map((value) => value.trim()).filter(Boolean))]
  const allowed = unique.filter((value): value is OAuthScope => (OAUTH_SCOPES as readonly string[]).includes(value))
  if (allowed.length > 0) return allowed.join(" ")
  if (unique.length === 0) return OAUTH_SCOPE
  throw new Error("scope is not supported")
}

function hasRequiredScopes(actual: string, required?: string | readonly string[]): boolean {
  if (!required) return true
  const actualSet = new Set(actual.split(/\s+/).filter(Boolean))
  const requiredScopes = scopeValues(required)
  return requiredScopes.every((scope) => !scope || actualSet.has(scope))
}

function scopeValues(scope?: string | readonly string[]): string[] {
  if (!scope) return OAUTH_SCOPE.split(/\s+/)
  return typeof scope === "string" ? scope.split(/\s+/) : [...scope]
}

function assertUsableConfig(config: OAuthConfig): asserts config is OAuthConfig & { secret: string } {
  if (!config.enabled || !config.secret) throw new Error("OAuth is not enabled or required OAuth secrets are missing")
}

function assertClientAllowed(clientId: string, config: OAuthConfig): void {
  if (!clientId) throw new Error("clientId is required")
  // Note: For dynamic clients, we also validate redirect_uri in isClientAllowed()
  // Here we only check if a static client is pinned and doesn't match
  if (config.allowedClientId && clientId !== config.allowedClientId) {
    // Check if this is a valid dynamically registered client
    const dynamicClient = getRegisteredClient(clientId)
    if (!dynamicClient) {
      throw new Error("clientId is not allowed")
    }
  }
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url")
}

function parseBase64UrlJson<T>(value: string): T | null {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T
  } catch {
    return null
  }
}

function randomTokenId(): string {
  return randomBytes(16).toString("base64url")
}

function epochSeconds(value?: Date | number): number {
  if (value instanceof Date) return Math.floor(value.getTime() / 1000)
  if (typeof value === "number") return Math.floor(value > 10_000_000_000 ? value / 1000 : value)
  return Math.floor(Date.now() / 1000)
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

function urlsEquivalent(a: string, b: string): boolean {
  try {
    const urlA = new URL(a)
    const urlB = new URL(b)
    // Normalize: compare origin + pathname without trailing slash
    const normalizedA = urlA.origin + urlA.pathname.replace(/\/$/, "")
    const normalizedB = urlB.origin + urlB.pathname.replace(/\/$/, "")
    return normalizedA.toLowerCase() === normalizedB.toLowerCase()
  } catch {
    // Fallback to direct comparison if URLs are invalid
    return a === b
  }
}

function oauthRequested(env: NodeJS.ProcessEnv, secret?: string): boolean {
  const explicit = optionalBooleanEnv(env.MCP_OAUTH_ENABLED) ?? optionalBooleanEnv(env.OAUTH_ENABLED)
  if (explicit !== undefined) return explicit

  const authMode = emptyToUndefined(env.MCP_AUTH ?? env.MCP_AUTHENTICATION ?? env.AUTH_MODE)?.toLowerCase()
  if (authMode) return authMode === "oauth"

  return Boolean(secret && env.OAUTH_OWNER_PASSWORD)
}

function optionalBooleanEnv(value: string | undefined): boolean | undefined {
  if (!value) return undefined
  const normalized = value.trim().toLowerCase()
  if (["1", "true", "yes", "on", "oauth"].includes(normalized)) return true
  if (["0", "false", "no", "off", "none"].includes(normalized)) return false
  return undefined
}

function positiveIntegerEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function emptyToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function fromVercelUrl(env: NodeJS.ProcessEnv): string | undefined {
  const vercelUrl = emptyToUndefined(env.VERCEL_PROJECT_PRODUCTION_URL) ?? emptyToUndefined(env.VERCEL_URL)
  return vercelUrl ? `https://${vercelUrl.replace(/^https?:\/\//, "")}` : undefined
}

function fromRequestHeaders(request?: OAuthRequestLike): string | undefined {
  const host = request?.headers?.get("x-forwarded-host") ?? request?.headers?.get("host")
  if (!host) return undefined
  const proto = request?.headers?.get("x-forwarded-proto") ?? inferProtocol(host)
  return `${proto.split(",")[0]}://${host.split(",")[0]}`
}

function fromRequestUrl(request?: OAuthRequestLike): string | undefined {
  if (!request?.url) return undefined
  try {
    return new URL(request.url).origin
  } catch {
    return undefined
  }
}

function normalizeOrigin(raw: string): string {
  const url = new URL(raw.includes("://") ? raw : `${inferProtocol(raw)}://${raw}`)
  return url.origin
}

function normalizeAbsoluteUrl(raw: string): string {
  const url = new URL(raw.includes("://") ? raw : `${inferProtocol(raw)}://${raw}`)
  return url.toString().replace(/\/$/, "")
}

function inferProtocol(host: string): "http" | "https" {
  return /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host) ? "http" : "https"
}

function escapeHeaderValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}
