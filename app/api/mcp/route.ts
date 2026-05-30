import { NextRequest, NextResponse } from "next/server";
import { getConfig } from "../../../lib/config";
import { handleJsonRpc, jsonRpcError } from "../../../lib/mcp";

export const runtime = "nodejs";

function authorized(request: NextRequest) {
  const token = getConfig().authToken;
  if (!token) return false;
  return request.headers.get("authorization") === `Bearer ${token}`;
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json(jsonRpcError(null, -32001, "Unauthorized"), { status: 401 });
  return NextResponse.json(await handleJsonRpc(await request.text()));
}

export async function GET() {
  return NextResponse.json({ name: "bayt-al-hiqma", endpoint: "/api/mcp", transport: "json-rpc-over-http", authenticated: true });
}
