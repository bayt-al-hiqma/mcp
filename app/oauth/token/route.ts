import { NextRequest, NextResponse } from "next/server";
import { getOAuthConfig, getRegisteredClient, issueAccessToken, verifyAuthorizationCode } from "../../../lib/oauth";

export const runtime = "nodejs";

type OAuthErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "unsupported_grant_type"
  | "server_error";

type ParsedTokenRequest =
  | {
      ok: true;
      code: string;
      codeVerifier: string;
      clientId: string;
      redirectUri: string;
      resource?: string;
    }
  | {
      ok: false;
      error: OAuthErrorCode;
      description: string;
      status: number;
    };

export async function POST(request: NextRequest) {
  if (!isFormUrlEncoded(request.headers.get("content-type"))) {
    return oauthError("invalid_request", "Token requests must use application/x-www-form-urlencoded.", 400);
  }

  if (request.headers.has("authorization")) {
    return oauthError("invalid_client", "Client authentication is not supported for public clients.", 401);
  }

  const parsed = parseTokenRequest(new URLSearchParams(await request.text()));
  if (!parsed.ok) return oauthError(parsed.error, parsed.description, parsed.status);

  const oauth = getOAuthConfig({ request });
  if (!oauth.enabled) {
    return oauthError("server_error", "OAuth is not configured.", 500);
  }

  if (oauth.allowedClientId && parsed.clientId !== oauth.allowedClientId) {
    // Check if it's a valid dynamically registered client
    const dynamicClient = getRegisteredClient(parsed.clientId);
    if (!dynamicClient) {
      return oauthError("invalid_client", "client_id is not allowed.", 401);
    }
    // Validate redirect_uri matches a registered URI for dynamic clients
    if (!dynamicClient.redirect_uris.includes(parsed.redirectUri)) {
      return oauthError("invalid_grant", "redirect_uri does not match registered URIs.", 400);
    }
  } else if (!oauth.allowedClientId) {
    // No static client configured - check if it's a dynamically registered client
    const dynamicClient = getRegisteredClient(parsed.clientId);
    if (dynamicClient && !dynamicClient.redirect_uris.includes(parsed.redirectUri)) {
      return oauthError("invalid_grant", "redirect_uri does not match registered URIs.", 400);
    }
  }
  if (parsed.resource && parsed.resource !== oauth.resource) {
    return oauthError("invalid_grant", "resource does not match this MCP server.", 400);
  }

  const claims = verifyAuthorizationCode(parsed.code, {
    clientId: parsed.clientId,
    redirectUri: parsed.redirectUri,
    codeVerifier: parsed.codeVerifier,
    config: oauth,
  });

  if (!claims) {
    return oauthError("invalid_grant", "Authorization code is invalid, expired, or failed PKCE verification.", 400);
  }

  try {
    return tokenResponse({
      access_token: issueAccessToken({
        clientId: claims.clientId,
        scope: claims.scope,
        subject: claims.sub,
      }, oauth),
      token_type: "Bearer",
      expires_in: oauth.accessTokenTtlSeconds,
      scope: claims.scope,
    });
  } catch {
    return oauthError("server_error", "Unable to issue access token.", 500);
  }
}

function parseTokenRequest(params: URLSearchParams): ParsedTokenRequest {
  const grantType = requiredParam(params, "grant_type");
  if (!grantType.ok) return grantType;
  if (grantType.value !== "authorization_code") {
    return {
      ok: false,
      error: "unsupported_grant_type",
      description: "Only grant_type=authorization_code is supported.",
      status: 400,
    };
  }

  const code = requiredParam(params, "code");
  if (!code.ok) return code;
  const codeVerifier = requiredParam(params, "code_verifier");
  if (!codeVerifier.ok) return codeVerifier;
  const clientId = requiredParam(params, "client_id");
  if (!clientId.ok) return clientId;
  const redirectUri = requiredParam(params, "redirect_uri");
  if (!redirectUri.ok) return redirectUri;

  const clientSecret = optionalParam(params, "client_secret");
  if (!clientSecret.ok) return clientSecret;
  if (clientSecret.value) {
    return {
      ok: false,
      error: "invalid_request",
      description: "client_secret is not accepted for public clients.",
      status: 400,
    };
  }
  const resource = optionalParam(params, "resource");
  if (!resource.ok) return resource;

  return {
    ok: true,
    code: code.value,
    codeVerifier: codeVerifier.value,
    clientId: clientId.value,
    redirectUri: redirectUri.value,
    resource: resource.value,
  };
}

function requiredParam(
  params: URLSearchParams,
  name: string,
): { ok: true; value: string } | { ok: false; error: OAuthErrorCode; description: string; status: number } {
  const value = optionalParam(params, name);
  if (!value.ok) return value;
  if (!value.value) {
    return {
      ok: false,
      error: "invalid_request",
      description: `Missing required parameter: ${name}.`,
      status: 400,
    };
  }
  return { ok: true, value: value.value };
}

function optionalParam(
  params: URLSearchParams,
  name: string,
): { ok: true; value?: string } | { ok: false; error: OAuthErrorCode; description: string; status: number } {
  const values = params.getAll(name);
  if (values.length > 1) {
    return {
      ok: false,
      error: "invalid_request",
      description: `The ${name} parameter must not be repeated.`,
      status: 400,
    };
  }
  return { ok: true, value: values[0]?.trim() || undefined };
}

function isFormUrlEncoded(contentType: string | null): boolean {
  return contentType?.split(";")[0]?.trim().toLowerCase() === "application/x-www-form-urlencoded";
}

function tokenResponse(body: Record<string, string | number>) {
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    },
  });
}

function oauthError(error: OAuthErrorCode, description: string, status: number) {
  return NextResponse.json(
    { error, error_description: description },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    },
  );
}
