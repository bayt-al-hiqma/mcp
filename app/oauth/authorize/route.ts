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
    return htmlResponse(renderAuthorizationForm(oauthParams, { error: "Incorrect owner password. Please try again." }), 401);
  }

  try {
    const code = issueAuthorizationCode(validation.params, oauth);
    const redirectUri = new URL(validation.redirectUri.toString());
    redirectUri.searchParams.set("code", code);
    if (validation.params.state) redirectUri.searchParams.set("state", validation.params.state);
    // Use 303 See Other so the browser issues a GET to the client's redirect_uri.
    // A default 307 would replay this POST against the callback and trigger a "bad request".
    return NextResponse.redirect(redirectUri, 303);
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
  // 303 ensures the client callback is always reached with a GET, even when this
  // redirect originates from a POST submission of the authorization form.
  return NextResponse.redirect(url, 303);
}

function renderAuthorizationForm(params: URLSearchParams, options: { error?: string } = {}): string {
  const hiddenInputs = [...params.entries()]
    .filter(([name]) => name !== "password")
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join("\n          ");

  const clientLabel = optionalParamValue(params, "client_id");
  const errorBanner = options.error
    ? `<p class="error" role="alert" aria-live="assertive">${escapeHtml(options.error)}</p>`
    : "";

  return pageShell(
    "Authorize Bayt al-Hiqma",
    `<div class="brand">
        <span class="brand-mark" aria-hidden="true">ﷺ</span>
        <span class="brand-name">Bayt al-Hiqma</span>
      </div>
      <h1>Sign in to authorize</h1>
      <p class="subtitle">Enter the owner password to grant access to your personal memory server.</p>
      ${errorBanner}
      <form method="post" action="/oauth/authorize" novalidate>
        ${hiddenInputs}
        <label class="field-label" for="password">Owner password</label>
        <input
          id="password"
          name="password"
          type="password"
          autocomplete="current-password"
          placeholder="••••••••••••"
          required
          autofocus
        >
        <button type="submit">Authorize access</button>
      </form>
      ${clientLabel ? `<p class="meta">Requesting client: <code>${escapeHtml(clientLabel)}</code></p>` : ""}`,
  );
}

function renderErrorPage(message: string): string {
  return pageShell(
    "Authorization Error",
    `<div class="brand">
        <span class="brand-mark" aria-hidden="true">ﷺ</span>
        <span class="brand-name">Bayt al-Hiqma</span>
      </div>
      <h1>Authorization error</h1>
      <p class="error" role="alert">${escapeHtml(message)}</p>
      <p class="meta">Close this window and start the connection again from your client.</p>`,
  );
}

function pageShell(title: string, content: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        --bg: #0b0f14;
        --panel: #121823;
        --panel-border: #1f2937;
        --text: #e6edf3;
        --muted: #8b97a7;
        --accent: #e0b341;
        --accent-strong: #f2c75c;
        --danger-bg: #2a1416;
        --danger-border: #5b2327;
        --danger-text: #f7b4b4;
        --ring: rgba(224, 179, 65, 0.35);
      }
      * { box-sizing: border-box; }
      html { background: var(--bg); }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background:
          radial-gradient(900px 500px at 50% -10%, rgba(224, 179, 65, 0.12), transparent 60%),
          var(--bg);
        color: var(--text);
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        line-height: 1.5;
        -webkit-font-smoothing: antialiased;
      }
      main {
        width: 100%;
        max-width: 408px;
        background: var(--panel);
        border: 1px solid var(--panel-border);
        border-radius: 16px;
        padding: 32px;
        box-shadow: 0 24px 60px -24px rgba(0, 0, 0, 0.7);
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 24px;
      }
      .brand-mark {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        border-radius: 10px;
        background: rgba(224, 179, 65, 0.14);
        border: 1px solid rgba(224, 179, 65, 0.3);
        color: var(--accent-strong);
        font-size: 18px;
      }
      .brand-name {
        font-weight: 600;
        letter-spacing: 0.01em;
        color: var(--text);
      }
      h1 {
        margin: 0 0 6px;
        font-size: 22px;
        font-weight: 650;
        letter-spacing: -0.01em;
      }
      .subtitle {
        margin: 0 0 22px;
        color: var(--muted);
        font-size: 14px;
      }
      form { display: flex; flex-direction: column; gap: 10px; }
      .field-label {
        font-size: 13px;
        font-weight: 550;
        color: var(--muted);
      }
      input[type="password"] {
        width: 100%;
        padding: 12px 14px;
        font-size: 15px;
        color: var(--text);
        background: #0d131c;
        border: 1px solid var(--panel-border);
        border-radius: 10px;
        outline: none;
        transition: border-color 0.15s ease, box-shadow 0.15s ease;
      }
      input[type="password"]::placeholder { color: #4b5667; }
      input[type="password"]:focus {
        border-color: var(--accent);
        box-shadow: 0 0 0 4px var(--ring);
      }
      button[type="submit"] {
        margin-top: 8px;
        padding: 12px 16px;
        font-size: 15px;
        font-weight: 600;
        color: #1a1205;
        background: var(--accent);
        border: 1px solid var(--accent-strong);
        border-radius: 10px;
        cursor: pointer;
        transition: background 0.15s ease, transform 0.05s ease;
      }
      button[type="submit"]:hover { background: var(--accent-strong); }
      button[type="submit"]:active { transform: translateY(1px); }
      button[type="submit"]:focus-visible { box-shadow: 0 0 0 4px var(--ring); outline: none; }
      .error {
        margin: 0 0 18px;
        padding: 12px 14px;
        font-size: 14px;
        color: var(--danger-text);
        background: var(--danger-bg);
        border: 1px solid var(--danger-border);
        border-radius: 10px;
      }
      .meta {
        margin: 18px 0 0;
        font-size: 13px;
        color: var(--muted);
      }
      .meta code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
        color: var(--text);
        background: #0d131c;
        border: 1px solid var(--panel-border);
        border-radius: 6px;
        padding: 2px 6px;
      }
    </style>
  </head>
  <body>
    <main>
      ${content}
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
