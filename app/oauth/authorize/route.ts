import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getOAuthConfig, issueAuthorizationCode as issueSharedAuthorizationCode } from "../../../lib/oauth";

export const runtime = "nodejs";

type AuthorizationParams = {
  clientId: string;
  redirectUri: string;
  scope?: string;
  state?: string;
  resource?: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
};

type ValidationResult =
  | { ok: true; params: AuthorizationParams; redirectUri: URL }
  | { ok: false; response: NextResponse };

const REQUIRED_PARAMS = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method"] as const;

export async function GET(request: NextRequest) {
  const validation = validateAuthorizationParams(request.nextUrl.searchParams);
  if (!validation.ok) return validation.response;

  const oauth = getOAuthConfig({ request });
  if (!resourceMatches(validation.params.resource, oauth.resource)) {
    return redirectWithError(validation.redirectUri, "invalid_request", "resource does not match this MCP server.", validation.params.state);
  }

  if (!process.env.OAUTH_OWNER_PASSWORD) {
    return redirectWithError(validation.redirectUri, "server_error", "Authorization is not configured.", validation.params.state);
  }

  return htmlResponse(renderAuthorizationForm(request.nextUrl.searchParams));
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const oauthParams = oauthParamsFromForm(formData);
  const validation = validateAuthorizationParams(oauthParams);
  if (!validation.ok) return validation.response;

  const oauth = getOAuthConfig({ request });
  if (!resourceMatches(validation.params.resource, oauth.resource)) {
    return redirectWithError(validation.redirectUri, "invalid_request", "resource does not match this MCP server.", validation.params.state);
  }

  const ownerPassword = process.env.OAUTH_OWNER_PASSWORD;
  if (!ownerPassword) {
    return redirectWithError(validation.redirectUri, "server_error", "Authorization is not configured.", validation.params.state);
  }

  const submittedPassword = formValue(formData, "password");
  if (!passwordMatches(submittedPassword, ownerPassword)) {
    return redirectWithError(validation.redirectUri, "access_denied", "Invalid owner password.", validation.params.state);
  }

  try {
    const code = issueAuthorizationCode(validation.params, oauth);
    const redirectUri = new URL(validation.redirectUri.toString());
    redirectUri.searchParams.set("code", code);
    if (validation.params.state) redirectUri.searchParams.set("state", validation.params.state);
    return NextResponse.redirect(redirectUri);
  } catch {
    return redirectWithError(validation.redirectUri, "server_error", "Could not issue authorization code.", validation.params.state);
  }
}

function validateAuthorizationParams(params: URLSearchParams): ValidationResult {
  const state = paramValue(params, "state");
  const redirectUriResult = parseRedirectUri(paramValue(params, "redirect_uri"));
  if (!redirectUriResult.ok) {
    return {
      ok: false,
      response: htmlResponse(renderErrorPage(redirectUriResult.message), redirectUriResult.status),
    };
  }

  const missing = REQUIRED_PARAMS.filter((name) => !paramValue(params, name));
  if (missing.length > 0) {
    return {
      ok: false,
      response: redirectWithError(redirectUriResult.redirectUri, "invalid_request", `Missing required parameter: ${missing[0]}.`, state),
    };
  }

  if (paramValue(params, "response_type") !== "code") {
    return {
      ok: false,
      response: redirectWithError(redirectUriResult.redirectUri, "unsupported_response_type", "Only response_type=code is supported.", state),
    };
  }

  if (paramValue(params, "code_challenge_method") !== "S256") {
    return {
      ok: false,
      response: redirectWithError(redirectUriResult.redirectUri, "invalid_request", "code_challenge_method must be S256.", state),
    };
  }

  return {
    ok: true,
    redirectUri: redirectUriResult.redirectUri,
    params: {
      clientId: paramValue(params, "client_id"),
      redirectUri: paramValue(params, "redirect_uri"),
      scope: optionalParamValue(params, "scope"),
      state: optionalParamValue(params, "state"),
      resource: optionalParamValue(params, "resource"),
      codeChallenge: paramValue(params, "code_challenge"),
      codeChallengeMethod: "S256",
    },
  };
}

function parseRedirectUri(value: string): { ok: true; redirectUri: URL } | { ok: false; status: number; message: string } {
  if (!value) return { ok: false, status: 400, message: "Missing required parameter: redirect_uri." };

  try {
    const redirectUri = new URL(value);
    if (redirectUri.protocol !== "https:" && redirectUri.protocol !== "http:") {
      return { ok: false, status: 400, message: "redirect_uri must use http or https." };
    }
    return { ok: true, redirectUri };
  } catch {
    return { ok: false, status: 400, message: "redirect_uri must be an absolute URL." };
  }
}

function issueAuthorizationCode(params: AuthorizationParams, oauth: ReturnType<typeof getOAuthConfig>): string {
  return issueSharedAuthorizationCode(
    {
      clientId: params.clientId,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      scope: params.scope,
    },
    oauth,
  );
}

function resourceMatches(requested: string | undefined, expected: string): boolean {
  return !requested || requested === expected;
}

function redirectWithError(redirectUri: URL, error: string, description: string, state?: string): NextResponse {
  const url = new URL(redirectUri.toString());
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", description);
  if (state) url.searchParams.set("state", state);
  return NextResponse.redirect(url);
}

function renderAuthorizationForm(params: URLSearchParams): string {
  const hiddenInputs = [...params.entries()]
    .filter(([name]) => name !== "password")
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join("\n        ");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Authorize Bayt al-Hiqma</title>
  </head>
  <body>
    <main>
      <h1>Authorize Bayt al-Hiqma</h1>
      <form method="post" action="/oauth/authorize">
        ${hiddenInputs}
        <p>
          <label for="password">Owner password</label><br>
          <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
        </p>
        <button type="submit">Authorize</button>
      </form>
    </main>
  </body>
</html>`;
}

function renderErrorPage(message: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Authorization Error</title>
  </head>
  <body>
    <main>
      <h1>Authorization Error</h1>
      <p role="alert">${escapeHtml(message)}</p>
    </main>
  </body>
</html>`;
}

function htmlResponse(body: string, status = 200): NextResponse {
  return new NextResponse(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function oauthParamsFromForm(formData: FormData): URLSearchParams {
  const params = new URLSearchParams();
  for (const [name, value] of formData.entries()) {
    if (name === "password" || typeof value !== "string") continue;
    params.append(name, value);
  }
  return params;
}

function paramValue(params: URLSearchParams, name: string): string {
  return params.get(name)?.trim() ?? "";
}

function optionalParamValue(params: URLSearchParams, name: string): string | undefined {
  return paramValue(params, name) || undefined;
}

function formValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function passwordMatches(submittedPassword: string, ownerPassword: string): boolean {
  const submitted = Buffer.from(submittedPassword);
  const expected = Buffer.from(ownerPassword);
  return submitted.length === expected.length && timingSafeEqual(submitted, expected);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
