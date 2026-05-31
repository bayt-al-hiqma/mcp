import { NextRequest, NextResponse } from "next/server";
import { getOAuthConfig } from "../../../lib/oauth";

export const runtime = "nodejs";

type ProtectedResourceMetadata = {
  resource: string;
  authorization_servers: string[];
  scopes_supported: string[];
  bearer_methods_supported: ["header"];
  resource_name: string;
  resource_documentation: string;
};

const RESOURCE_NAME = "Bayt al-Hiqma Personal Memory MCP";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version",
};

function protectedResourceMetadata(request: NextRequest): ProtectedResourceMetadata {
  const config = getOAuthConfig({ request });

  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: [...config.scopes],
    bearer_methods_supported: ["header"],
    resource_name: RESOURCE_NAME,
    resource_documentation: `${config.baseUrl}/`,
  };
}

export async function GET(request: NextRequest) {
  return NextResponse.json(protectedResourceMetadata(request), { headers: corsHeaders });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}
