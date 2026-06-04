import { NextRequest, NextResponse } from "next/server";
import {
  getOAuthConfig,
  isDynamicClientRegistrationEnabled,
  registerClient,
  validateClientMetadata,
  type ClientRegistrationResponse,
} from "../../../lib/oauth";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  const config = getOAuthConfig({ request });

  // Check if dynamic client registration is enabled
  if (!isDynamicClientRegistrationEnabled(config)) {
    return NextResponse.json(
      {
        error: "invalid_client_metadata",
        error_description: "Dynamic client registration is not enabled. A static client_id may be configured.",
      },
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Cache-Control": "no-store",
        },
      }
    );
  }

  // Validate content type
  const contentType = request.headers.get("content-type");
  if (!contentType?.includes("application/json")) {
    return NextResponse.json(
      {
        error: "invalid_client_metadata",
        error_description: "Content-Type must be application/json.",
      },
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Cache-Control": "no-store",
        },
      }
    );
  }

  // Parse request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: "invalid_client_metadata",
        error_description: "Request body must be valid JSON.",
      },
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Cache-Control": "no-store",
        },
      }
    );
  }

  // Validate client metadata
  const validation = validateClientMetadata(body);
  if (!validation.ok) {
    return NextResponse.json(validation.error, {
      status: 400,
      headers: {
        ...corsHeaders,
        "Cache-Control": "no-store",
      },
    });
  }

  // Register the client
  const client = registerClient(validation.metadata, config);

  // Build response per RFC 7591
  const response: ClientRegistrationResponse = {
    client_id: client.client_id,
    client_id_issued_at: client.client_id_issued_at,
    redirect_uris: client.redirect_uris,
    token_endpoint_auth_method: client.token_endpoint_auth_method,
    grant_types: client.grant_types,
    response_types: client.response_types,
    scope: client.scope,
    ...(client.client_name && { client_name: client.client_name }),
    ...(client.client_uri && { client_uri: client.client_uri }),
    ...(client.logo_uri && { logo_uri: client.logo_uri }),
    ...(client.contacts && { contacts: client.contacts }),
    ...(client.tos_uri && { tos_uri: client.tos_uri }),
    ...(client.policy_uri && { policy_uri: client.policy_uri }),
    ...(client.software_id && { software_id: client.software_id }),
    ...(client.software_version && { software_version: client.software_version }),
  };

  return NextResponse.json(response, {
    status: 201,
    headers: {
      ...corsHeaders,
      "Cache-Control": "no-store",
    },
  });
}
