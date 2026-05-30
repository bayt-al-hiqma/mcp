import { NextRequest, NextResponse } from "next/server";
import { handleJsonRpc } from "../../../lib/mcp";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return NextResponse.json(await handleJsonRpc(await request.text()));
}

export async function GET() {
  return NextResponse.json({ name: "bayt-al-hiqma", endpoint: "/api/mcp", transport: "json-rpc-over-http", authentication: "none" });
}
