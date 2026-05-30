import { NextRequest, NextResponse } from "next/server";
import { configStatus, getConfig, redact } from "../../../lib/config";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const token = getConfig().authToken;
  if (!token || request.headers.get("authorization") !== `Bearer ${token}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(redact({ configuration: getConfig(), status: configStatus() }));
}
