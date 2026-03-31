import { NextResponse } from "next/server"
import { readFile } from "node:fs/promises"
import path from "node:path"

const MIN_ZOOM = 12
const BASE_DATASET_PATH = path.join(process.cwd(), "data", "overture_us_neighborhoods.geojson")
const BOULDER_SUPPLEMENT_PATH = path.join(process.cwd(), "data", "boulder-neighborhoods-complete.geojson")

type Bbox = [number, number, number, number]

type GeoJsonGeometry = {
  type: string
  coordinates: unknown
}

type DatasetFeature = {
  type: "Feature"
  properties: {
    id: string
    subtype?: string | null
    name?: string | null
    source?: string | null
    boundary_kind?: string | null
  }
  geometry: GeoJsonGeometry | null
}

type IndexedFeature = {
  id: string
  bbox: Bbox
  feature: {
    type: "Feature"
    id: string
    properties: {
      id: string
      name: string | null
      subtype: string
      source: string
      boundaryKind: string | null
      bbox: Bbox
    }
    geometry: GeoJsonGeometry | null
  }
}

type FeatureCollection = {
  type: "FeatureCollection"
  features: IndexedFeature["feature"][]
}

let indexedDatasetPromise: Promise<IndexedFeature[]> | null = null

function parseNumber(value: string | null): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function clampLat(lat: number): number {
  return Math.max(-85.05112878, Math.min(85.05112878, lat))
}

function clampLng(lng: number): number {
  if (!Number.isFinite(lng)) return 0
  let normalized = lng
  while (normalized < -180) normalized += 360
  while (normalized > 180) normalized -= 360
  return normalized
}

function normalizeBbox(
  west: number,
  south: number,
  east: number,
  north: number,
): Array<[number, number, number, number]> {
  const clampedSouth = clampLat(south)
  const clampedNorth = clampLat(north)
  const normalizedWest = clampLng(west)
  const normalizedEast = clampLng(east)

  if (normalizedEast >= normalizedWest) {
    return [[normalizedWest, clampedSouth, normalizedEast, clampedNorth]]
  }

  return [
    [normalizedWest, clampedSouth, 180, clampedNorth],
    [-180, clampedSouth, normalizedEast, clampedNorth],
  ]
}

function bboxIntersects(a: Bbox, b: Bbox): boolean {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3])
}

function updateBboxPoint(bbox: Bbox, lng: number, lat: number) {
  bbox[0] = Math.min(bbox[0], lng)
  bbox[1] = Math.min(bbox[1], lat)
  bbox[2] = Math.max(bbox[2], lng)
  bbox[3] = Math.max(bbox[3], lat)
}

function accumulateCoordinates(value: unknown, bbox: Bbox) {
  if (!Array.isArray(value) || value.length === 0) return

  if (typeof value[0] === "number" && typeof value[1] === "number") {
    updateBboxPoint(bbox, value[0], value[1])
    return
  }

  for (const child of value) {
    accumulateCoordinates(child, bbox)
  }
}

function geometryBbox(geometry: GeoJsonGeometry | null): Bbox | null {
  if (!geometry) return null
  const bbox: Bbox = [Infinity, Infinity, -Infinity, -Infinity]
  accumulateCoordinates(geometry.coordinates, bbox)
  if (!Number.isFinite(bbox[0])) return null
  return bbox
}

async function loadDataset(
  datasetPath: string,
  datasetSource: string,
): Promise<IndexedFeature[]> {
  const raw = await readFile(datasetPath, "utf8")
  const parsed = JSON.parse(raw) as { features: DatasetFeature[] }

  return parsed.features.flatMap((feature) => {
    const bbox = geometryBbox(feature.geometry)
    if (!bbox) return []
    const id = feature.properties.id
    return [
      {
        id,
        bbox,
        feature: {
          type: "Feature" as const,
          id,
          properties: {
            id,
            name: feature.properties.name ?? null,
            subtype: feature.properties.subtype ?? "neighborhood",
            source: feature.properties.source ?? datasetSource,
            boundaryKind: feature.properties.boundary_kind ?? null,
            bbox,
          },
          geometry: feature.geometry,
        },
      },
    ]
  })
}

async function loadIndexedDataset(): Promise<IndexedFeature[]> {
  if (!indexedDatasetPromise) {
    indexedDatasetPromise = (async () => {
      const [baseFeatures, boulderSupplement] = await Promise.all([
        loadDataset(BASE_DATASET_PATH, "local_us_neighborhoods_geojson"),
        loadDataset(BOULDER_SUPPLEMENT_PATH, "boulder_complete_supplement"),
      ])

      return [...baseFeatures, ...boulderSupplement]
    })()
  }

  return indexedDatasetPromise
}

async function loadViewportFeatures(
  west: number,
  south: number,
  east: number,
  north: number,
): Promise<IndexedFeature["feature"][]> {
  const dataset = await loadIndexedDataset()
  const viewportBboxes = normalizeBbox(west, south, east, north)
  const visible = dataset
    .filter((item) => viewportBboxes.some((bbox) => bboxIntersects(item.bbox, bbox)))
    .sort((a, b) => {
      const aPriority = a.feature.properties.source === "boulder_complete_supplement" ? 1 : 0
      const bPriority = b.feature.properties.source === "boulder_complete_supplement" ? 1 : 0
      return aPriority - bPriority
    })

  const deduped = new Map<string, IndexedFeature["feature"]>()
  for (const item of visible) {
    const name = item.feature.properties.name?.trim().toLowerCase()
    const dedupeKey = name && name.length > 0 ? `name:${name}` : `id:${item.id}`
    deduped.set(dedupeKey, item.feature)
  }

  return [...deduped.values()]
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
    const features = await loadViewportFeatures(west, south, east, north)
    const response: FeatureCollection & {
      meta: { source: string; datasetPath: string; featureCount: number }
    } = {
      type: "FeatureCollection",
      features,
      meta: {
        source: "Local us-neighborhoods-geojson dataset with Boulder supplement",
        datasetPath: "data/overture_us_neighborhoods.geojson + data/boulder-neighborhoods-complete.geojson",
        featureCount: features.length,
      },
    }
    return NextResponse.json(response)
  } catch (error) {
    console.error("[map-neighborhoods] failed:", error)
    return NextResponse.json({ error: "Failed to load neighborhoods." }, { status: 500 })
  }
}
