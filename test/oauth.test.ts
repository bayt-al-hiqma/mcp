import { createHash } from "node:crypto";
import { describe, expect, afterEach, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as authorizationServerMetadataGET } from "../app/.well-known/oauth-authorization-server/route";
import { GET as protectedResourceMetadataGET } from "../app/.well-known/oauth-protected-resource/route";
import { POST as mcpPOST } from "../app/api/mcp/route";
import {
  getOAuthConfig,
  issueAccessToken,
  issueAuthorizationCode,
  OAUTH_SCOPE,
  verifyAccessToken,
  verifyAuthorizationCode,
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

function stubOAuthEnv() {
  vi.stubEnv("MCP_OAUTH_ENABLED", "true");
  vi.stubEnv("OAUTH_OWNER_PASSWORD", "test-owner-password");
  vi.stubEnv("OAUTH_TOKEN_SECRET", SECRET);
  vi.stubEnv("OAUTH_BASE_URL", BASE_URL);
  vi.stubEnv("OAUTH_CLIENT_ID", CLIENT_ID);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("OAuth helpers", () => {
  it("signs authorization codes and access tokens, then enforces PKCE, expiry, tampering, and scopes", () => {
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
      grant_types_supported: ["authorization_code"],
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
