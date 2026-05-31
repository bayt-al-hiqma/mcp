import { NextRequest, NextResponse } from "next/server";
import { getOAuthConfig } from "../../../lib/oauth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const config = getOAuthConfig({ request });

  return NextResponse.json({
    issuer: config.issuer,
    authorization_endpoint: new URL("/oauth/authorize", config.baseUrl).toString(),
    token_endpoint: new URL("/oauth/token", config.baseUrl).toString(),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    client_id_metadata_document_supported: true,
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [...config.scopes],
  });
}
