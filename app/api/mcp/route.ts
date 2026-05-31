import { NextRequest, NextResponse } from "next/server";
import { handleJsonRpc } from "../../../lib/mcp";
import { getOAuthConfig, OAUTH_SCOPE, unauthorizedChallenge, verifyAccessToken } from "../../../lib/oauth";

export const runtime = "nodejs";

function bearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  return authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
}

function unauthorized(config: ReturnType<typeof getOAuthConfig>) {
  return NextResponse.json(
    { error: "Unauthorized" },
    { status: 401, headers: { "WWW-Authenticate": unauthorizedChallenge({ scope: OAUTH_SCOPE }, config) } },
  );
}

export async function POST(request: NextRequest) {
  const oauth = getOAuthConfig({ request });
  if (oauth.enabled && !verifyAccessToken(bearerToken(request) ?? "", { config: oauth, requiredScopes: OAUTH_SCOPE })) return unauthorized(oauth);
  return NextResponse.json(await handleJsonRpc(await request.text()));
}

export async function GET(request: NextRequest) {
  const oauth = getOAuthConfig({ request });
  return NextResponse.json({
    name: "bayt-al-hiqma",
    endpoint: "/api/mcp",
    transport: "json-rpc-over-http",
    authentication: oauth.enabled ? "oauth" : "none",
    ...(oauth.enabled ? { oauth: { resource_metadata: oauth.resourceMetadataUrl, scope: OAUTH_SCOPE } } : {}),
  });
}
