import { NextResponse } from "next/server";
import type { HealthResponse } from "@exit-keepa/shared";

export function GET() {
  const body: HealthResponse = {
    status: "ok",
    service: "exit-keepa-web",
    timestamp: new Date().toISOString(),
  };
  return NextResponse.json(body);
}
