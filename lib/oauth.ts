import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"

export const OAUTH_SCOPES = ["memory:read", "memory:write"] as const
export const OAUTH_SCOPE = OAUTH_SCOPES.join(" ")

export type OAuthScope = (typeof OAUTH_SCOPES)[number]

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
  if (payload.iss !== config.issuer || payload.aud !== config.resource) return null
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
  if (config.allowedClientId && clientId !== config.allowedClientId) throw new Error("clientId is not allowed")
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
