import { NextResponse } from "next/server"

const MIN_ZOOM = 12
const USGS_WBD_HUC12_QUERY_URL =
  "https://hydro.nationalmap.gov/arcgis/rest/services/wbd/FeatureServer/6/query"

function parseNumber(value: string | null): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function buildViewportUrl(
  west: number,
  south: number,
  east: number,
  north: number,
): string {
  const params = new URLSearchParams({
    where: "1=1",
    geometry: `${west},${south},${east},${north}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    returnGeometry: "true",
    outFields: "name,huc12,states,areasqkm,tohuc,humod,hutype",
    outSR: "4326",
    f: "geojson",
  })

  return `${USGS_WBD_HUC12_QUERY_URL}?${params.toString()}`
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const west = parseNumber(searchParams.get("west"))
  const south = parseNumber(searchParams.get("south"))
  const east = parseNumber(searchParams.get("east"))
  const north = parseNumber(searchParams.get("north"))
  const zoom = parseNumber(searchParams.get("zoom"))

  if (west === null || south === null || east === null || north === null || zoom === null) {
    return NextResponse.json({ error: "Missing viewport params." }, { status: 400 })
  }

  if (zoom < MIN_ZOOM) {
    return NextResponse.json({ type: "FeatureCollection", features: [] })
  }

  try {
    const response = await fetch(buildViewportUrl(west, south, east, north), {
      headers: { "User-Agent": "Rivr/1.0 (https://dev.rivr.social)" },
      next: { revalidate: 300 },
    })

    if (!response.ok) {
      throw new Error(`USGS WBD query failed with ${response.status}`)
    }

    const geojson = (await response.json()) as Record<string, unknown>
    const features = Array.isArray(geojson.features) ? geojson.features.length : 0

    return NextResponse.json({
      ...geojson,
      meta: {
        source: "USGS National Map WBD HUC-12",
        featureCount: features,
      },
    })
  } catch (error) {
    console.error("[map-microsheds] failed:", error)
    return NextResponse.json({ error: "Failed to load microsheds." }, { status: 500 })
  }
}
