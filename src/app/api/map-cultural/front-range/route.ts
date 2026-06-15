import { NextResponse } from "next/server"
import { FRONT_RANGE_CULTURAL_GEOJSON } from "@/lib/map-cultural/front-range"

export function GET() {
  return NextResponse.json(FRONT_RANGE_CULTURAL_GEOJSON, {
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  })
}
