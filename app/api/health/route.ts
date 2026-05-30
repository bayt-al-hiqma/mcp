import { NextResponse } from "next/server";
import { configStatus } from "../../../lib/config";

export const runtime = "nodejs";

export async function GET() {
  const status = configStatus();
  return NextResponse.json({ status: status.ok ? "ok" : "misconfigured", ...status }, { status: status.ok ? 200 : 503 });
}
