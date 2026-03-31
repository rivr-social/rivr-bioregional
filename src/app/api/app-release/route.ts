import { NextResponse } from "next/server";
import { buildAppReleaseStatus } from "@/lib/app-release";

export async function GET() {
  const status = await buildAppReleaseStatus({
    appName: "rivr-bioregional",
    defaultVersion: "1.0.0",
    defaultUpstreamRepo: "rivr-social/rivr-bioregional",
  });

  return NextResponse.json(status, {
    headers: {
      "Cache-Control": "s-maxage=300, stale-while-revalidate=300",
    },
  });
}
