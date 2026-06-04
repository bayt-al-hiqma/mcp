import { createHash } from "node:crypto";
import { describe, expect, afterEach, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as authorizationServerMetadataGET } from "../app/.well-known/oauth-authorization-server/route";
import { GET as protectedResourceMetadataGET } from "../app/.well-known/oauth-protected-resource/route";
import { POST as mcpPOST } from "../app/api/mcp/route";
import { POST as registerPOST } from "../app/oauth/register/route";
import { POST as tokenPOST } from "../app/oauth/token/route";
import {
  clearDynamicClients,
  getOAuthConfig,
  getRegisteredClient,
  isClientAllowed,
  issueAccessToken,
  issueAuthorizationCode,
  issueRefreshToken,
  OAUTH_SCOPE,
  registerClient,
  validateClientMetadata,
  verifyAccessToken,
  verifyAuthorizationCode,
  verifyRefreshToken,
  verifyPkceS256,
} from "../lib/oauth";

const CLIENT_ID = "test-client";
const BASE_URL = "https://memory.example";
const REDIRECT_URI = "https://client.example/callback";
const SECRET = "test-oauth-secret";

function oauthConfig() {
  return getOAuthConfig({
    env: {
      NODE_ENV: "test",
      MCP_OAUTH_ENABLED: "true",
      OAUTH_OWNER_PASSWORD: "test-owner-password",
      OAUTH_TOKEN_SECRET: SECRET,
      OAUTH_BASE_URL: BASE_URL,
      OAUTH_CLIENT_ID: CLIENT_ID,
    },
  });
}

function pkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

function tamper(token: string) {
  return `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
}

function mcpRequest(headers: HeadersInit = {}) {
  return new NextRequest(`${BASE_URL}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: "ping-1", method: "ping" }),
  });
}

function tokenRequest(body: Record<string, string>) {
  return new NextRequest(`${BASE_URL}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
}

function stubOAuthEnv() {
  vi.stubEnv("MCP_OAUTH_ENABLED", "true");
  vi.stubEnv("OAUTH_OWNER_PASSWORD", "test-owner-password");
  vi.stubEnv("OAUTH_TOKEN_SECRET", SECRET);
  vi.stubEnv("OAUTH_BASE_URL", BASE_URL);
  vi.stubEnv("OAUTH_CLIENT_ID", CLIENT_ID);
}

afterEach(() => {
  vi.unstubAllEnvs();
  clearDynamicClients();
});

describe("OAuth helpers", () => {
  it("signs authorization codes, access tokens, and refresh tokens, then enforces PKCE, expiry, tampering, and scopes", () => {
    const config = oauthConfig();
    const now = new Date("2026-05-30T12:00:00Z");
    const validAt = new Date("2026-05-30T12:00:30Z");
    const expiredAt = new Date("2026-05-30T12:02:01Z");
    const verifier = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
    const challenge = pkceChallenge(verifier);

    expect(verifyPkceS256(verifier, challenge)).toBe(true);
    expect(verifyPkceS256("wrong-verifier-that-is-still-long-enough-to-validate", challenge)).toBe(false);

    const code = issueAuthorizationCode(
      {
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
        codeChallenge: challenge,
        scope: "memory:read",
        now,
        ttlSeconds: 120,
      },
      config,
    );

    expect(verifyAuthorizationCode(code, { clientId: CLIENT_ID, redirectUri: REDIRECT_URI, codeVerifier: verifier, now: validAt, config })).toMatchObject({
      kind: "authorization_code",
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
      scope: "memory:read",
    });
    expect(verifyAuthorizationCode(code, { clientId: CLIENT_ID, redirectUri: REDIRECT_URI, codeVerifier: "wrong-verifier-that-is-still-long-enough-to-validate", now: validAt, config })).toBeNull();
    expect(verifyAuthorizationCode(code, { clientId: CLIENT_ID, redirectUri: REDIRECT_URI, codeVerifier: verifier, now: expiredAt, config })).toBeNull();
    expect(verifyAuthorizationCode(tamper(code), { clientId: CLIENT_ID, redirectUri: REDIRECT_URI, codeVerifier: verifier, now: validAt, config })).toBeNull();

    const accessToken = issueAccessToken(
      {
        clientId: CLIENT_ID,
        scope: "memory:read",
        now,
        ttlSeconds: 120,
      },
      config,
    );

    expect(verifyAccessToken(accessToken, { clientId: CLIENT_ID, requiredScopes: "memory:read", now: validAt, config })).toMatchObject({
      kind: "access_token",
      clientId: CLIENT_ID,
      scope: "memory:read",
    });
    expect(verifyAccessToken(accessToken, { clientId: CLIENT_ID, requiredScopes: "memory:write", now: validAt, config })).toBeNull();
    expect(verifyAccessToken(tamper(accessToken), { clientId: CLIENT_ID, requiredScopes: "memory:read", now: validAt, config })).toBeNull();

    const refreshToken = issueRefreshToken(
      {
        clientId: CLIENT_ID,
        scope: "memory:read",
        now,
        ttlSeconds: 120,
      },
      config,
    );

    expect(verifyRefreshToken(refreshToken, { clientId: CLIENT_ID, now: validAt, config })).toMatchObject({
      kind: "refresh_token",
      clientId: CLIENT_ID,
      scope: "memory:read",
    });
    expect(verifyRefreshToken(refreshToken, { clientId: "wrong-client", now: validAt, config })).toBeNull();
    expect(verifyRefreshToken(refreshToken, { clientId: CLIENT_ID, now: expiredAt, config })).toBeNull();
    expect(verifyRefreshToken(tamper(refreshToken), { clientId: CLIENT_ID, now: validAt, config })).toBeNull();
  });
});

describe("OAuth metadata routes", () => {
  it("returns protected-resource and authorization-server metadata in the advertised shape", async () => {
    stubOAuthEnv();

    const protectedResponse = await protectedResourceMetadataGET(new NextRequest(`${BASE_URL}/.well-known/oauth-protected-resource`));
    expect(protectedResponse.headers.get("Access-Control-Allow-Origin")).toBe("*");
    await expect(protectedResponse.json()).resolves.toEqual({
      resource: `${BASE_URL}/api/mcp`,
      authorization_servers: [BASE_URL],
      scopes_supported: ["memory:read", "memory:write"],
      bearer_methods_supported: ["header"],
      resource_name: "Bayt al-Hiqma Personal Memory MCP",
      resource_documentation: `${BASE_URL}/`,
    });

    const authorizationResponse = await authorizationServerMetadataGET(new NextRequest(`${BASE_URL}/.well-known/oauth-authorization-server`));
    await expect(authorizationResponse.json()).resolves.toMatchObject({
      issuer: BASE_URL,
      authorization_endpoint: `${BASE_URL}/oauth/authorize`,
      token_endpoint: `${BASE_URL}/oauth/token`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      client_id_metadata_document_supported: true,
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["memory:read", "memory:write"],
    });
  });
});

describe("MCP OAuth enforcement", () => {
  it("returns a 401 Bearer challenge when OAuth is enabled and the request has no valid token", async () => {
    stubOAuthEnv();

    const response = await mcpPOST(mcpRequest());
    const challenge = response.headers.get("WWW-Authenticate");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(challenge).toContain('Bearer realm="bayt-al-hiqma"');
    expect(challenge).toContain(`resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource"`);
    expect(challenge).toContain(`scope="${OAUTH_SCOPE}"`);
  });

  it("allows a valid bearer token to reach JSON-RPC handling", async () => {
    stubOAuthEnv();
    const token = issueAccessToken(
      {
        clientId: CLIENT_ID,
        scope: OAUTH_SCOPE,
        ttlSeconds: 60,
      },
      getOAuthConfig(),
    );

    const response = await mcpPOST(mcpRequest({ authorization: `Bearer ${token}` }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      id: "ping-1",
      result: {},
    });
  });
});

describe("Dynamic Client Registration (RFC 7591)", () => {
  function stubOAuthEnvWithoutStaticClient() {
    vi.stubEnv("MCP_OAUTH_ENABLED", "true");
    vi.stubEnv("OAUTH_OWNER_PASSWORD", "test-owner-password");
    vi.stubEnv("OAUTH_TOKEN_SECRET", SECRET);
    vi.stubEnv("OAUTH_BASE_URL", BASE_URL);
    // Note: No OAUTH_CLIENT_ID - enables dynamic registration
  }

  function registrationRequest(body: unknown) {
    return new NextRequest(`${BASE_URL}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  describe("validateClientMetadata", () => {
    it("validates required redirect_uris", () => {
      expect(validateClientMetadata({})).toMatchObject({
        ok: false,
        error: { error: "invalid_client_metadata" },
      });

      expect(validateClientMetadata({ redirect_uris: [] })).toMatchObject({
        ok: false,
        error: { error: "invalid_client_metadata" },
      });

      expect(validateClientMetadata({ redirect_uris: ["not-a-url"] })).toMatchObject({
        ok: false,
        error: { error: "invalid_redirect_uri" },
      });
    });

    it("requires https for non-localhost URIs", () => {
      expect(validateClientMetadata({ redirect_uris: ["http://example.com/callback"] })).toMatchObject({
        ok: false,
        error: { error: "invalid_redirect_uri" },
      });

      // localhost is allowed with http
      expect(validateClientMetadata({ redirect_uris: ["http://localhost:3000/callback"] })).toMatchObject({
        ok: true,
      });

      // https is always allowed
      expect(validateClientMetadata({ redirect_uris: ["https://example.com/callback"] })).toMatchObject({
        ok: true,
      });
    });

    it("only allows supported grant_types and response_types", () => {
      expect(validateClientMetadata({
        redirect_uris: ["https://example.com/callback"],
        grant_types: ["authorization_code", "refresh_token"],
      })).toMatchObject({
        ok: true,
        metadata: { grant_types: ["authorization_code", "refresh_token"] },
      });

      expect(validateClientMetadata({
        redirect_uris: ["https://example.com/callback"],
        grant_types: ["client_credentials"],
      })).toMatchObject({
        ok: false,
        error: { error: "invalid_client_metadata", error_description: expect.stringContaining("client_credentials") },
      });

      expect(validateClientMetadata({
        redirect_uris: ["https://example.com/callback"],
        response_types: ["token"],
      })).toMatchObject({
        ok: false,
        error: { error: "invalid_client_metadata", error_description: expect.stringContaining("token") },
      });
    });

    it("only allows public clients (token_endpoint_auth_method=none)", () => {
      expect(validateClientMetadata({
        redirect_uris: ["https://example.com/callback"],
        token_endpoint_auth_method: "client_secret_basic",
      })).toMatchObject({
        ok: false,
        error: { error: "invalid_client_metadata" },
      });
    });

    it("accepts valid client metadata", () => {
      const result = validateClientMetadata({
        redirect_uris: ["https://example.com/callback", "https://example.com/callback2"],
        client_name: "Test Client",
        client_uri: "https://example.com",
        scope: "memory:read",
      });

      expect(result).toMatchObject({
        ok: true,
        metadata: {
          redirect_uris: ["https://example.com/callback", "https://example.com/callback2"],
          client_name: "Test Client",
          client_uri: "https://example.com",
          scope: "memory:read",
        },
      });
    });
  });

  describe("registerClient", () => {
    it("creates a client with a unique client_id", () => {
      stubOAuthEnvWithoutStaticClient();
      const config = getOAuthConfig();

      const client1 = registerClient({ redirect_uris: ["https://a.example/cb"] }, config);
      const client2 = registerClient({ redirect_uris: ["https://b.example/cb"] }, config);

      expect(client1.client_id).toMatch(/^dyn_[a-f0-9]{32}$/);
      expect(client2.client_id).toMatch(/^dyn_[a-f0-9]{32}$/);
      expect(client1.client_id).not.toBe(client2.client_id);
    });

    it("stores client for later retrieval", () => {
      stubOAuthEnvWithoutStaticClient();
      const config = getOAuthConfig();

      const client = registerClient({
        redirect_uris: ["https://example.com/callback"],
        client_name: "My Test Client",
      }, config);

      const retrieved = getRegisteredClient(client.client_id);
      expect(retrieved).toMatchObject({
        client_id: client.client_id,
        redirect_uris: ["https://example.com/callback"],
        client_name: "My Test Client",
      });
    });
  });

  describe("isClientAllowed", () => {
    it("allows dynamically registered clients with matching redirect_uri", () => {
      stubOAuthEnvWithoutStaticClient();
      const config = getOAuthConfig();

      const client = registerClient({ redirect_uris: ["https://example.com/callback"] }, config);

      expect(isClientAllowed(client.client_id, "https://example.com/callback", config)).toBe(true);
      expect(isClientAllowed(client.client_id, "https://other.com/callback", config)).toBe(false);
    });

    it("respects static OAUTH_CLIENT_ID when set", () => {
      stubOAuthEnv();
      const config = getOAuthConfig();

      // Static client is allowed (any redirect_uri because we don't track it for static clients)
      expect(isClientAllowed(CLIENT_ID, REDIRECT_URI, config)).toBe(true);

      // Other clients are not allowed when static client is configured
      expect(isClientAllowed("other-client", "https://other.com/callback", config)).toBe(false);
    });
  });

  describe("/oauth/register endpoint", () => {
    it("returns 400 when dynamic registration is disabled (static client configured)", async () => {
      stubOAuthEnv(); // This sets OAUTH_CLIENT_ID

      const response = await registerPOST(registrationRequest({
        redirect_uris: ["https://example.com/callback"],
      }));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: "invalid_client_metadata",
        error_description: expect.stringContaining("not enabled"),
      });
    });

    it("registers a client successfully when dynamic registration is enabled", async () => {
      stubOAuthEnvWithoutStaticClient();

      const response = await registerPOST(registrationRequest({
        redirect_uris: ["https://example.com/callback"],
        grant_types: ["authorization_code", "refresh_token"],
        client_name: "Codex Test Client",
        scope: "memory:read memory:write",
      }));

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body).toMatchObject({
        client_id: expect.stringMatching(/^dyn_[a-f0-9]{32}$/),
        client_id_issued_at: expect.any(Number),
        redirect_uris: ["https://example.com/callback"],
        client_name: "Codex Test Client",
        scope: "memory:read memory:write",
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      });
    });

    it("rejects invalid client metadata", async () => {
      stubOAuthEnvWithoutStaticClient();

      const response = await registerPOST(registrationRequest({
        redirect_uris: ["not-a-valid-url"],
      }));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: "invalid_redirect_uri",
      });
    });

    it("rejects non-JSON content type", async () => {
      stubOAuthEnvWithoutStaticClient();

      const response = await registerPOST(new NextRequest(`${BASE_URL}/oauth/register`, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "not json",
      }));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: "invalid_client_metadata",
        error_description: expect.stringContaining("application/json"),
      });
    });
  });

  describe("authorization server metadata", () => {
    it("includes registration_endpoint when dynamic registration is enabled", async () => {
      stubOAuthEnvWithoutStaticClient();

      const response = await authorizationServerMetadataGET(
        new NextRequest(`${BASE_URL}/.well-known/oauth-authorization-server`)
      );

      const body = await response.json();
      expect(body).toMatchObject({
        registration_endpoint: `${BASE_URL}/oauth/register`,
      });
    });

    it("omits registration_endpoint when static client is configured", async () => {
      stubOAuthEnv();

      const response = await authorizationServerMetadataGET(
        new NextRequest(`${BASE_URL}/.well-known/oauth-authorization-server`)
      );

      const body = await response.json();
      expect(body).not.toHaveProperty("registration_endpoint");
    });
  });

  describe("end-to-end dynamic client flow", () => {
    it("allows a dynamically registered client to complete the OAuth flow", async () => {
      stubOAuthEnvWithoutStaticClient();
      const config = getOAuthConfig();

      // 1. Register a client
      const client = registerClient({
        redirect_uris: ["https://codex.example/callback"],
        grant_types: ["authorization_code", "refresh_token"],
        client_name: "Codex CLI",
      }, config);

      // 2. Issue an authorization code for the dynamic client
      const verifier = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
      const challenge = pkceChallenge(verifier);

      const code = issueAuthorizationCode({
        clientId: client.client_id,
        redirectUri: "https://codex.example/callback",
        codeChallenge: challenge,
        scope: "memory:read",
      }, config);

      // 3. Verify the authorization code
      const claims = verifyAuthorizationCode(code, {
        clientId: client.client_id,
        redirectUri: "https://codex.example/callback",
        codeVerifier: verifier,
        config,
      });

      expect(claims).toMatchObject({
        kind: "authorization_code",
        clientId: client.client_id,
        scope: "memory:read",
      });

      // 4. Exchange the authorization code for access and refresh tokens
      const tokenResponse = await tokenPOST(tokenRequest({
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        client_id: client.client_id,
        redirect_uri: "https://codex.example/callback",
      }));

      expect(tokenResponse.status).toBe(200);
      const tokenBody = await tokenResponse.json();
      expect(tokenBody).toMatchObject({
        access_token: expect.any(String),
        refresh_token: expect.any(String),
        token_type: "Bearer",
        expires_in: config.accessTokenTtlSeconds,
        scope: "memory:read",
      });

      // 5. Verify the access token
      const tokenClaims = verifyAccessToken(tokenBody.access_token, {
        clientId: client.client_id,
        requiredScopes: "memory:read",
        config,
      });

      expect(tokenClaims).toMatchObject({
        kind: "access_token",
        clientId: client.client_id,
        scope: "memory:read",
      });

      expect(verifyRefreshToken(tokenBody.refresh_token, {
        clientId: client.client_id,
        config,
      })).toMatchObject({
        kind: "refresh_token",
        clientId: client.client_id,
        scope: "memory:read",
      });

      // 6. Refresh the access token without another authorization code
      const refreshResponse = await tokenPOST(tokenRequest({
        grant_type: "refresh_token",
        refresh_token: tokenBody.refresh_token,
        client_id: client.client_id,
      }));

      expect(refreshResponse.status).toBe(200);
      const refreshBody = await refreshResponse.json();
      expect(refreshBody).toMatchObject({
        access_token: expect.any(String),
        refresh_token: expect.any(String),
        token_type: "Bearer",
        expires_in: config.accessTokenTtlSeconds,
        scope: "memory:read",
      });

      expect(verifyAccessToken(refreshBody.access_token, {
        clientId: client.client_id,
        requiredScopes: "memory:read",
        config,
      })).toMatchObject({
        kind: "access_token",
        clientId: client.client_id,
        scope: "memory:read",
      });
    });
  });
});
