"use client"

/**
 * Interactive geospatial discovery page for events, groups, posts, and offerings.
 *
 * Route: `/map`
 *
 * Data requirements:
 * - Locale and basin catalogs from `useLocalesAndBasins()` hook.
 * - Event and group agents from `useEvents()` and `useGroups()` hooks.
 * - Posts and marketplace listings from `usePosts()` and `useMarketplace()` hooks.
 * - Selected scope from `useAppContext()` to filter entities by locale or basin.
 * - All data hooks implement IndexedDB-first caching (local DB → sessionStorage → server).
 *
 * Rendering model:
 * - Client Component (`"use client"`), because it uses effects, local UI state,
 *   client navigation, browser storage, and a browser-only map renderer.
 * - `MainMap` is dynamically imported with `ssr: false` to avoid server rendering
 *   browser API-dependent map logic.
 *
 * Metadata:
 * - No `metadata` or `generateMetadata` export is defined in this file.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { MapPin, Calendar, Users, Search, X, ChevronDown, Layers, Mountain, Building2, Type, View, Clock } from "lucide-react"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { useRouter } from "next/navigation"
import type { MapItem } from "@/components/modules/map"
import { useAppContext } from "@/contexts/app-context"
import { useLocalesAndBasins, useEvents, useGroups, usePosts, useMarketplace } from "@/lib/hooks/use-graph-data"

// Dynamic import — map renderer uses browser APIs
const MainMap = dynamic(
  () => import("@/components/modules/map/MainMap"),
  { ssr: false, loading: () => (
    <div className="h-full w-full flex items-center justify-center bg-gray-100 dark:bg-zinc-900">
      <div className="animate-pulse flex flex-col items-center">
        <div className="h-8 w-8 bg-gray-300 dark:bg-zinc-700 rounded-full mb-2" />
        <div className="h-4 w-32 bg-gray-300 dark:bg-zinc-700 rounded" />
      </div>
    </div>
  )}
)

// Dynamic import — AR view uses camera, gyroscope, and GPS browser APIs
const ARView = dynamic(
  () => import("@/components/ar-view"),
  { ssr: false, loading: () => (
    <div className="h-full w-full flex items-center justify-center bg-zinc-900">
      <div className="animate-pulse flex flex-col items-center">
        <div className="h-8 w-8 bg-zinc-700 rounded-full mb-2" />
        <div className="h-4 w-32 bg-zinc-700 rounded" />
      </div>
    </div>
  )}
)

type ViewMode = "map" | "ar"

/** Shape of a mapped group after transforming SerializedAgent data */
interface MappedGroup {
  id: string
  name: string
  description: string
  avatar: string
  chapterTags: string[]
  chapters: string[]
  location: unknown
  members: string[]
  geo: unknown
  modelUrl?: string
}

/** Shape of a mapped event after transforming SerializedAgent data */
interface MappedEvent {
  id: string
  name: string
  title: string
  description: string
  chapterTags: string[]
  timeframe: { start: string; end: string }
  startDate: string | undefined
  endDate: string | undefined
  location: Record<string, unknown> | string | undefined
  image: string
  geo: unknown
}

interface MappedResourcePoint {
  id: string
  name: string
  description: string
  chapterTags: string[]
  location: Record<string, unknown> | string | undefined
  geo: unknown
  image: string
  url: string
}


const GLOBAL_CENTER: [number, number] = [-98.5795, 39.8283] // USA center
const GLOBAL_ZOOM = 4

const FALLBACK_SCOPE_CENTERS: Record<string, [number, number]> = {
  nyc: [-74.006, 40.7128],
  sf: [-122.4194, 37.7749],
  la: [-118.2437, 34.0522],
  chi: [-87.6298, 41.8781],
  bos: [-71.0589, 42.3601],
  sea: [-122.3321, 47.6062],
  aus: [-97.7431, 30.2672],
  den: [-104.9903, 39.7392],
  por: [-122.6784, 45.5152],
  boulder: [-105.2705, 40.015],
  longmont: [-105.1019, 40.1672],
}

type BioregionGroup = "terrestrial" | "hydro"
type LayerScope = "off" | "na" | "global"

interface LayerSource {
  id: string
  url: string
  sourceLabel: string
  available: boolean
}

interface BioregionLayerConfig {
  label: string
  group: BioregionGroup
  stroke: string
  fill: string
  strokeWidth: number
  fillAlpha: number
  viewportAware?: boolean
  minZoom?: number
  labelMinSeparationDegrees?: number
  global?: LayerSource
  na?: LayerSource
}

const BIOREGION_LAYERS: Record<string, BioregionLayerConfig> = {
  // ── TERRESTRIAL ──────────────────────────────────────────────────────
  realm: {
    label: "Realm", group: "terrestrial", stroke: "#1e3a2f", fill: "#065f46", strokeWidth: 2, fillAlpha: 0.35,
    global: { id: "t-realm-g",  url: "/geojson/terrestrial/realms.geojson",              sourceLabel: "RESOLVE 2017 Realms",     available: true },
  },
  biome: {
    label: "Biome", group: "terrestrial", stroke: "#1e3a2f", fill: "#047857", strokeWidth: 1.5, fillAlpha: 0.35,
    global: { id: "t-biome-g",  url: "/geojson/terrestrial/biomes.geojson",              sourceLabel: "RESOLVE 2017 Biomes",     available: true },
  },
  bioregion: {
    label: "Bioregion", group: "terrestrial", stroke: "#374151", fill: "#22c55e", strokeWidth: 1.5, fillAlpha: 0.35,
    global: { id: "t-bioreg-g", url: "/geojson/terrestrial/bioregions-oneearth.geojson", sourceLabel: "One Earth 2023",           available: true },
    na:     { id: "t-bioreg-n", url: "/geojson/eco/eco-l1.geojson",                     sourceLabel: "EPA/CEC Level I",          available: true },
  },
  homeland: {
    label: "Terratype", group: "terrestrial", stroke: "#374151", fill: "#4ade80", strokeWidth: 1, fillAlpha: 0.30,
    global: { id: "t-home-g",   url: "/geojson/terrestrial/ecoregions.geojson",         sourceLabel: "RESOLVE 2017 Ecoregions", available: true },
    na:     { id: "t-home-n",   url: "/geojson/eco/eco-l2.geojson",                     sourceLabel: "EPA/CEC Level II",         available: true },
  },
  ecotope: {
    label: "Ecotope", group: "terrestrial", stroke: "#374151", fill: "#86efac", strokeWidth: 1, fillAlpha: 0.30,
    na:     { id: "t-eco-n",    url: "/geojson/eco/eco-l4.geojson",                      sourceLabel: "EPA Level IV",             available: true },
  },
  // ── HYDRO ────────────────────────────────────────────────────────────
  hydroRegion: {
    label: "Hydro Region", group: "hydro", stroke: "#1e3a5f", fill: "#3b82f6", strokeWidth: 1.5, fillAlpha: 0.35,
    na:     { id: "h-region-n", url: "/geojson/hydro/huc2.geojson",                     sourceLabel: "HUC-2",                    available: true },
  },
  basin: {
    label: "Basin", group: "hydro", stroke: "#1e3a5f", fill: "#60a5fa", strokeWidth: 1, fillAlpha: 0.30,
    na:     { id: "h-basin-n",  url: "/geojson/hydro/huc6.geojson",                     sourceLabel: "HUC-6",                    available: true },
  },
  watershed: {
    label: "Watershed", group: "hydro", stroke: "#1e3a5f", fill: "#93c5fd", strokeWidth: 1, fillAlpha: 0.30,
    na:     { id: "h-wshd-n",   url: "/geojson/hydro/huc8.geojson",                     sourceLabel: "HUC-8",                    available: true },
  },
  microshed: {
    label: "Microshed", group: "hydro", stroke: "#1e40af", fill: "#60a5fa", strokeWidth: 1, fillAlpha: 0.18,
    na:     { id: "h-micro-n",  url: "/api/map-microsheds",                             sourceLabel: "USGS WBD HUC-12",          available: true },
    viewportAware: true,
    minZoom: 12,
    labelMinSeparationDegrees: 0.03,
  },
  catchment: {
    label: "Catchment", group: "hydro", stroke: "#1e3a5f", fill: "#bfdbfe", strokeWidth: 1, fillAlpha: 0.25,
    na:     { id: "h-catch-n",  url: "",                                                 sourceLabel: "NHDPlus HR Catchments",    available: false },
  },
  riverReach: {
    label: "River Reach", group: "hydro", stroke: "#1e3a5f", fill: "#dbeafe", strokeWidth: 1, fillAlpha: 0.20,
    na:     { id: "h-reach-n",  url: "",                                                 sourceLabel: "NHDPlus HR Flowlines",     available: false },
  },
}

const TERRESTRIAL_KEYS = Object.keys(BIOREGION_LAYERS).filter((k) => BIOREGION_LAYERS[k].group === "terrestrial")
const HYDRO_KEYS = Object.keys(BIOREGION_LAYERS).filter((k) => BIOREGION_LAYERS[k].group === "hydro")


/**
 * Computes the centroid of lng/lat points.
 *
 * @param points - Geographic points in `[lng, lat]` order.
 * @returns Center point or `null` when no points are provided.
 */
function centerFromPoints(points: Array<[number, number]>): [number, number] | null {
  if (points.length === 0) return null
  const [lngSum, latSum] = points.reduce(
    (acc, [lng, lat]) => [acc[0] + lng, acc[1] + lat],
    [0, 0]
  )
  return [lngSum / points.length, latSum / points.length]
}

/**
 * Resolves a fallback center from a known locale/basin name alias map.
 *
 * @param name - Human-readable scope name.
 * @returns Approximate center coordinates when recognized.
 */
function centerFromName(name: string): [number, number] | null {
  const lower = name.toLowerCase()
  if (FALLBACK_SCOPE_CENTERS[lower]) return FALLBACK_SCOPE_CENTERS[lower]
  const compact = lower.replace(/\s+/g, "-")
  if (FALLBACK_SCOPE_CENTERS[compact]) return FALLBACK_SCOPE_CENTERS[compact]
  const firstWord = lower.split(/\s+/)[0]
  if (firstWord && FALLBACK_SCOPE_CENTERS[firstWord]) return FALLBACK_SCOPE_CENTERS[firstWord]
  return null
}

/**
 * Converts loose location payloads into normalized lowercase text for matching.
 *
 * @param value - Location field that may be string/object/null.
 * @returns Lowercase searchable text.
 */
function locationText(value: unknown): string {
  if (typeof value === "string") return value.toLowerCase()
  if (!value || typeof value !== "object") return ""
  const record = value as Record<string, unknown>
  if (typeof record.address === "string") return record.address.toLowerCase()
  if (typeof record.name === "string") return record.name.toLowerCase()
  return ""
}

/**
 * Extracts explicit coordinates from heterogeneous structures.
 *
 * @param entity - Candidate object with `lat/lng`, `latitude/longitude`, or `lon`.
 * @returns Coordinates as `[lng, lat]`, or `null` when unavailable.
 */
function getExplicitCoords(entity: unknown): [number, number] | null {
  if (!entity || typeof entity !== "object") return null
  const record = entity as Record<string, unknown>

  const toFiniteNumber = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
    return null
  }

  const latCandidate =
    toFiniteNumber(record.lat) ??
    toFiniteNumber(record.latitude) ??
    toFiniteNumber(record.y)

  const lngCandidate =
    toFiniteNumber(record.lng) ??
    toFiniteNumber(record.longitude) ??
    toFiniteNumber(record.lon) ??
    toFiniteNumber(record.x)

  if (typeof latCandidate === "number" && typeof lngCandidate === "number") {
    return [lngCandidate, latCandidate]
  }

  if (Array.isArray(record.coordinates) && record.coordinates.length >= 2) {
    const lng = toFiniteNumber(record.coordinates[0])
    const lat = toFiniteNumber(record.coordinates[1])
    if (typeof lat === "number" && typeof lng === "number") {
      return [lng, lat]
    }
  }

  if (Array.isArray(record.coords) && record.coords.length >= 2) {
    const lng = toFiniteNumber(record.coords[0])
    const lat = toFiniteNumber(record.coords[1])
    if (typeof lat === "number" && typeof lng === "number") {
      return [lng, lat]
    }
  }

  if (record.coordinates && typeof record.coordinates === "object") {
    const nested = getExplicitCoords(record.coordinates)
    if (nested) return nested
  }

  if (record.geometry && typeof record.geometry === "object") {
    const geometry = record.geometry as Record<string, unknown>
    if (Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2) {
      const lng = toFiniteNumber(geometry.coordinates[0])
      const lat = toFiniteNumber(geometry.coordinates[1])
      if (typeof lat === "number" && typeof lng === "number") {
        return [lng, lat]
      }
    }
  }

  return null
}

/** Session-level geocoding cache to avoid redundant Nominatim requests. */
const geocodeCache = new Map<string, [number, number] | null>()

/**
 * Geocodes an address string to [lng, lat] using Nominatim (OSM).
 * Results are cached in-memory for the session to respect rate limits.
 *
 * @param address - Human-readable address string.
 * @returns Coordinates as `[lng, lat]`, or `null` when geocoding fails.
 */
async function geocodeAddress(address: string): Promise<[number, number] | null> {
  const key = address.trim().toLowerCase()
  if (!key) return null
  if (geocodeCache.has(key)) return geocodeCache.get(key) ?? null

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`
    const response = await fetch(url, {
      headers: { "User-Agent": "Rivr/1.0 (https://rivr.social)" },
    })
    if (!response.ok) {
      geocodeCache.set(key, null)
      return null
    }
    const results = await response.json() as Array<{ lat: string; lon: string }>
    if (results.length === 0) {
      geocodeCache.set(key, null)
      return null
    }
    const coords: [number, number] = [parseFloat(results[0].lon), parseFloat(results[0].lat)]
    geocodeCache.set(key, coords)
    return coords
  } catch {
    geocodeCache.set(key, null)
    return null
  }
}

/**
 * Extracts a plain address string from heterogeneous location payloads.
 *
 * @param location - Location field that may be string, object with address, or null.
 * @returns Plain address string or empty string.
 */
function extractAddressString(location: unknown): string {
  if (typeof location === "string") return location
  if (location && typeof location === "object") {
    const record = location as Record<string, unknown>
    if (typeof record.address === "string") return record.address
    if (typeof record.name === "string") return record.name
  }
  return ""
}

function stableIsoFallback(id: string, createdAtMap: Map<string, string>): string {
  return createdAtMap.get(id) || "2024-01-01T00:00:00.000Z"
}


/**
 * Normalizes scope values for case-insensitive matching.
 *
 * @param value - Raw scope value.
 * @returns Trimmed lowercase value.
 */
function normalizeScopeValue(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * Resolves a raw scope input into a canonical locale or basin ID.
 *
 * @param rawScope - Current selected scope from app state.
 * @param locales - Available locale entries.
 * @param basins - Available basin entries.
 * @returns Canonical scope ID or `"all"` fallback.
 */
function resolveScopeToCanonicalId(
  rawScope: string,
  locales: Array<{ id: string; slug: string; name: string; basinId: string }>,
  basins: Array<{ id: string; name: string }>
): string {
  if (!rawScope) return "all"
  if (rawScope === "all") return "all"

  const normalized = normalizeScopeValue(rawScope)
  const localeMatch = locales.find((locale) => {
    return (
      locale.id === rawScope ||
      locale.slug === rawScope ||
      normalizeScopeValue(locale.id) === normalized ||
      normalizeScopeValue(locale.slug) === normalized ||
      normalizeScopeValue(locale.name) === normalized
    )
  })
  if (localeMatch) return localeMatch.id

  const basinMatch = basins.find((basin) => {
    return basin.id === rawScope || normalizeScopeValue(basin.id) === normalized || normalizeScopeValue(basin.name) === normalized
  })
  if (basinMatch) return basinMatch.id

  return "all"
}

/**
 * Renders the map page with scope-aware filtering, layer toggles, and marker navigation.
 */
export default function MapPage() {
  const router = useRouter()
  const { state: appState, setSelectedChapter: setScope } = useAppContext()
  // IndexedDB-first data hooks (3-phase: local DB → sessionStorage → server)
  const { data: localeBasinData } = useLocalesAndBasins()
  const { events: hookEvents } = useEvents(240)
  const { groups: hookGroups } = useGroups(240)
  const { posts: hookPosts } = usePosts(500)
  const { listings: hookListings } = useMarketplace(500)

  // Geocoded coordinate overlay map — populated asynchronously by the geocoding effect below.
  const [geocodedGeo, setGeocodedGeo] = useState<Record<string, { lat: number; lng: number }>>({})

  // Live invitations — fetched periodically, scoped by locale/group
  const [liveInvitations, setLiveInvitations] = useState<Array<{
    id: string; content: string; lat: number; lng: number;
    author: { id: string; name: string; avatar: string };
  }>>([])

  useEffect(() => {
    const fetchLiveInvitations = async () => {
      try {
        const params = new URLSearchParams()
        if (appState.selectedChapter && appState.selectedChapter !== "all") {
          params.set("localeId", appState.selectedChapter)
        }
        const res = await fetch(`/api/live-invitations?${params.toString()}`)
        if (res.ok) {
          const data = await res.json()
          setLiveInvitations(data.invitations ?? [])
        }
      } catch {
        // Silently fail — live invitations are not critical
      }
    }
    fetchLiveInvitations()
    const interval = setInterval(fetchLiveInvitations, 30_000)
    return () => clearInterval(interval)
  }, [appState.selectedChapter])

  // Derive locale catalog from hook data with inferred centers for viewport logic.
  const locales = useMemo(() => localeBasinData.locales.map(locale => ({
    id: locale.id,
    name: locale.name,
    slug: locale.slug,
    basinId: locale.basinId,
    center: centerFromName(locale.name) || undefined,
  })), [localeBasinData.locales])

  // Derive basin catalog from hook data with inferred centers.
  const basins = useMemo(() => localeBasinData.basins.map(basin => ({
    id: basin.id,
    name: basin.name,
    center: centerFromName(basin.name) || undefined,
  })), [localeBasinData.basins])

  // Map hook events into the map-specific MappedEvent shape.
  const projects = useMemo<MappedEvent[]>(() => hookEvents.map(event => {
    const coords = (event.location as { coordinates?: { lat: number; lng: number } } | undefined)?.coordinates
    return {
      id: event.id,
      name: event.name,
      title: event.title || event.name,
      description: event.description || "",
      chapterTags: event.chapterTags || [],
      timeframe: event.timeframe || { start: "", end: "" },
      startDate: event.timeframe?.start,
      endDate: event.timeframe?.end,
      location: event.location as Record<string, unknown> | string | undefined,
      image: event.image || "/placeholder.svg",
      geo: geocodedGeo[event.id] || coords || null,
    }
  }), [hookEvents, geocodedGeo])

  // Map hook groups into the map-specific MappedGroup shape.
  const groups = useMemo<MappedGroup[]>(() => hookGroups.map(group => ({
    id: group.id,
    name: group.name,
    description: group.description || "",
    avatar: group.image || group.avatar || "/placeholder.svg",
    chapterTags: group.chapterTags || [],
    chapters: group.chapterTags || [],
    location: group.location,
    members: group.members || [],
    geo: geocodedGeo[group.id] || null,
    modelUrl: group.modelUrl,
  })), [hookGroups, geocodedGeo])

  // Map hook posts into the map-specific MappedResourcePoint shape.
  const resourcePosts = useMemo<MappedResourcePoint[]>(() => hookPosts.map(post => ({
    id: post.id,
    name: post.title || (post.content ? post.content.slice(0, 50) + (post.content.length > 50 ? "..." : "") : "Post"),
    description: post.content || "",
    chapterTags: post.chapterTags || [],
    location: undefined,
    geo: geocodedGeo[post.id] || null,
    image: post.images?.[0] || "/placeholder.svg",
    url: `/posts/${post.id}`,
  })), [hookPosts, geocodedGeo])

  // Map hook marketplace listings into the map-specific MappedResourcePoint shape.
  const resourceOfferings = useMemo<MappedResourcePoint[]>(() => hookListings.map(listing => ({
    id: listing.id,
    name: listing.title || "Offering",
    description: listing.description || "",
    chapterTags: listing.tags || [],
    location: listing.location as Record<string, unknown> | string | undefined,
    geo: geocodedGeo[listing.id] || null,
    image: listing.images?.[0] || "/placeholder.svg",
    url: `/marketplace/${listing.id}`,
  })), [hookListings, geocodedGeo])

  // Resource-based events are covered by agent events via useEvents(); empty placeholder for filter compatibility.
  const resourceEvents: MappedResourcePoint[] = []

  // Build a lookup map from entity ID to createdAt ISO string for timeframe filtering.
  const createdAtMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const e of hookEvents) map.set(e.id, e.timeframe?.start || "")
    for (const g of hookGroups) map.set(g.id, g.createdAt || "")
    for (const p of hookPosts) map.set(p.id, p.createdAt || "")
    for (const l of hookListings) map.set(l.id, l.createdAt || "")
    return map
  }, [hookEvents, hookGroups, hookPosts, hookListings])

  const [searchQuery, setSearchQuery] = useState("")
  const [selectedTab, setSelectedTab] = useState("all")
  const [viewMode, setViewMode] = useState<ViewMode>("map")
  const [_hoveredItem, setHoveredItem] = useState<string | null>(null)
  const [showMobileLayerPanel, setShowMobileLayerPanel] = useState(false)
  const [mapLayers, setMapLayers] = useState({
    basemap: true,
    terrain: true,
    buildings: true,
    labels: false,
    neighborhoods: false,
  })
  const ionConfigured = Boolean(process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN)
  const [bioregionLayers, setBioregionLayers] = useState<Record<string, LayerScope>>({
    realm: "off",
    biome: "off",
    bioregion: "off",
    homeland: "off",
    ecotope: "off",
    hydroRegion: "off",
    basin: "off",
    watershed: "off",
    microshed: "off",
    catchment: "off",
    riverReach: "off",
  })
  const [bioregionLabels, setBioregionLabels] = useState<Record<string, boolean>>({
    realm: false,
    biome: false,
    bioregion: false,
    homeland: false,
    ecotope: false,
    hydroRegion: false,
    basin: false,
    watershed: false,
    microshed: false,
    catchment: false,
    riverReach: false,
  })
  const terrainSourceConfigured = Boolean(
    process.env.NEXT_PUBLIC_LOCAL_TERRAIN_URL ||
    process.env.NEXT_PUBLIC_CESIUM_TERRAIN_URL ||
    ionConfigured
  )
  const buildingsSourceConfigured = Boolean(
    process.env.NEXT_PUBLIC_LOCAL_BUILDINGS_3DTILES_URL ||
    process.env.NEXT_PUBLIC_CESIUM_BUILDINGS_URL ||
    ionConfigured
  )

  // ── Timeframe range slider state ──
  const [showTimeSlider, setShowTimeSlider] = useState(false)
  // Slider range stored as epoch-ms pair [start, end]; null means "use full extent"
  const [timeRange, setTimeRange] = useState<[number, number] | null>(null)

  // Compute the global date extent from all items with known createdAt values.
  const timeExtent = useMemo(() => {
    const NOW = Date.now()
    const DEFAULT_LOOKBACK_MS = 365 * 24 * 60 * 60 * 1000 // 1 year
    let min = NOW
    let max = 0
    let count = 0
    createdAtMap.forEach((iso) => {
      if (!iso) return
      const t = new Date(iso).getTime()
      if (!Number.isFinite(t)) return
      if (t < min) min = t
      if (t > max) max = t
      count++
    })
    if (count === 0) return { min: NOW - DEFAULT_LOOKBACK_MS, max: NOW }
    // Ensure at least 1 day range
    if (max - min < 86_400_000) max = min + 86_400_000
    return { min, max }
  }, [createdAtMap])

  const selectedScopeRaw = appState.selectedChapter || "all"
  const scopeCatalogReady = locales.length > 0 || basins.length > 0
  const selectedScope = scopeCatalogReady
    ? resolveScopeToCanonicalId(selectedScopeRaw, locales, basins)
    : selectedScopeRaw
  const basinIds = new Set(basins.map((basin) => basin.id))
  const selectedLocaleRecord = locales.find((locale) => locale.id === selectedScope || locale.slug === selectedScope)
  const selectedLocaleName = selectedLocaleRecord?.name.toLowerCase() ?? ""
  const selectedScopeAliases = new Set(
    [selectedScope, selectedLocaleRecord?.id, selectedLocaleRecord?.slug].filter((value): value is string => !!value)
  )

  // --- Orbit-on-arrival state: fires once per locale/basin selection change ---
  const [shouldOrbit, setShouldOrbit] = useState(false)
  const prevScopeRef = useRef(selectedScope)
  useEffect(() => {
    if (selectedScope !== prevScopeRef.current) {
      prevScopeRef.current = selectedScope
      // Orbit when navigating to a specific locale/basin, not "all".
      setShouldOrbit(selectedScope !== "all")
    }
  }, [selectedScope])

  // Data fetching is handled by hooks above (useLocalesAndBasins, useEvents, useGroups, usePosts, useMarketplace).
  // Each hook implements: Phase 1 (IndexedDB instant read) → Phase 2 (server sync + IndexedDB persist).

  // Geocode entities that have address strings but no explicit geo coordinates.
  useEffect(() => {
    let cancelled = false

    const geocodeEntities = async () => {
      const targets: Array<{ id: string; address: string }> = []

      for (const event of hookEvents) {
        const loc = event.location
        if (loc && typeof loc === "object" && "coordinates" in loc && loc.coordinates) continue
        const addr = extractAddressString(event.location)
        if (addr) targets.push({ id: event.id, address: addr })
      }
      for (const group of hookGroups) {
        const addr = extractAddressString(group.location)
        if (addr) targets.push({ id: group.id, address: addr })
      }
      for (const listing of hookListings) {
        const addr = extractAddressString(listing.location)
        if (addr) targets.push({ id: listing.id, address: addr })
      }

      if (targets.length === 0) return

      const newGeo: Record<string, { lat: number; lng: number }> = {}
      for (const target of targets) {
        if (cancelled) return
        const coords = await geocodeAddress(target.address)
        if (coords) newGeo[target.id] = { lat: coords[1], lng: coords[0] }
        // Nominatim rate limit: max 1 req/sec
        await new Promise((resolve) => setTimeout(resolve, 200))
      }

      if (cancelled || Object.keys(newGeo).length === 0) return
      setGeocodedGeo(prev => ({ ...prev, ...newGeo }))
    }

    void geocodeEntities()
    return () => { cancelled = true }
    // Re-run only when hook data changes (geocodeAddress has internal cache for dedup)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hookEvents, hookGroups, hookListings])

  useEffect(() => {
    // Keep app-level scope canonical once locale/basin catalogs are available.
    if (scopeCatalogReady && selectedScopeRaw !== selectedScope) {
      setScope(selectedScope)
    }
  }, [scopeCatalogReady, selectedScopeRaw, selectedScope, setScope])

  const selectedBasinLocaleIds =
    selectedScope !== "all" && basinIds.has(selectedScope)
      ? new Set(
          locales
            .filter((locale) => locale.basinId === selectedScope)
            .flatMap((locale) => [locale.id, locale.slug].filter((value): value is string => !!value))
        )
      : null

  /**
   * Checks whether a free-form location value appears to reference the selected locale.
   *
   * @param value - Location payload from an entity.
   * @returns `true` when the location text matches locale name/tokens.
   */
  const matchesSelectedLocaleByLocation = (value: unknown): boolean => {
    if (!selectedLocaleRecord || selectedScope === "all") return false
    const text = locationText(value)
    if (!text) return false
    if (text.includes(selectedLocaleName)) return true
    const tokens = selectedLocaleName.split(/\s+/).filter((token) => token.length >= 4)
    return tokens.some((token) => text.includes(token))
  }

  const filteredEvents = projects.filter((event) => {
    const eventTags = event.chapterTags || []
    const isInChapter =
      selectedScope === "all" ||
      eventTags.some((tag: string) => selectedScopeAliases.has(tag)) ||
      (selectedBasinLocaleIds ? eventTags.some((tag: string) => selectedBasinLocaleIds.has(tag)) : false) ||
      matchesSelectedLocaleByLocation(event.location)
    const matchesSearch =
      (event.title || event.name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (event.description || "").toLowerCase().includes(searchQuery.toLowerCase())
    return isInChapter && matchesSearch
  })

  const filteredGroups = groups.filter((group) => {
    const groupScopeTags = ((group.chapters || group.chapterTags || []) as string[])
    const isInChapter =
      selectedScope === "all" ||
      groupScopeTags.some((tag) => selectedScopeAliases.has(tag)) ||
      (selectedBasinLocaleIds ? groupScopeTags.some((tag) => selectedBasinLocaleIds.has(tag)) : false) ||
      matchesSelectedLocaleByLocation(group.location)
    const matchesSearch =
      (group.name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (group.description || "").toLowerCase().includes(searchQuery.toLowerCase())
    return isInChapter && matchesSearch
  })

  /**
   * Reusable scope predicate for resource-like entities.
   *
   * @param tags - Normalized chapter/locale tags.
   * @param location - Optional location payload for textual fallback matching.
   * @returns `true` when the entity belongs in the selected scope.
   */
  const isInSelectedScope = (tags: string[], location?: unknown) =>
    selectedScope === "all" ||
    tags.some((tag) => selectedScopeAliases.has(tag)) ||
    (selectedBasinLocaleIds ? tags.some((tag) => selectedBasinLocaleIds.has(tag)) : false) ||
    matchesSelectedLocaleByLocation(location)

  const filteredResourceEvents = resourceEvents.filter((event) => {
    const tags = event.chapterTags || []
    const matchesSearch =
      event.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      event.description.toLowerCase().includes(searchQuery.toLowerCase())
    return isInSelectedScope(tags, event.location) && matchesSearch
  })

  const filteredPosts = resourcePosts.filter((post) => {
    const tags = post.chapterTags || []
    const matchesSearch =
      post.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      post.description.toLowerCase().includes(searchQuery.toLowerCase())
    return isInSelectedScope(tags, post.location) && matchesSearch
  })

  const filteredOfferings = resourceOfferings.filter((offering) => {
    const tags = offering.chapterTags || []
    const matchesSearch =
      offering.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      offering.description.toLowerCase().includes(searchQuery.toLowerCase())
    return isInSelectedScope(tags, offering.location) && matchesSearch
  })

  /**
   * Resolves fallback coordinates from an entity's chapterTags by looking up locale centers.
   * Returns [lng, lat] or null when no locale center is available.
   */
  const coordsFromChapterTags = (tags: string[]): [number, number] | null => {
    for (const tag of tags) {
      const locale = locales.find((l) => l.id === tag || l.slug === tag)
      if (locale?.center) return locale.center
    }
    return null
  }

  // Build map items with real coordinates; fall back to locale centers for entities with chapterTags.
  const mapItems = useMemo(() => [
    ...filteredEvents.flatMap((event) => {
      const fallbackIso = stableIsoFallback(event.id, createdAtMap)
      let addressString = "Unknown Location"
      if (typeof event.location === "string") {
        addressString = event.location
      } else if (event.location && typeof event.location === "object" && "address" in event.location) {
        addressString = String(event.location.address)
      } else if (event.chapterTags && event.chapterTags.length > 0) {
        addressString = locales.find((locale) => locale.id === event.chapterTags[0])?.name || "Unknown Location"
      }

      const locationCoordinates =
        typeof event.location === "object" && event.location !== null
          ? (event.location as Record<string, unknown>).coordinates
          : undefined
      const explicitCoords =
        getExplicitCoords(locationCoordinates) ||
        getExplicitCoords(event.geo) ||
        getExplicitCoords(event) ||
        coordsFromChapterTags(event.chapterTags || [])
      if (!explicitCoords) return []
      return {
        id: event.id,
        type: "event" as const,
        name: event.title || event.name || "Unnamed Event",
        description: event.description || "",
        geo: { lat: explicitCoords[1], lng: explicitCoords[0] },
        location: { address: addressString },
        timeframe: {
          start: event.startDate || event.timeframe?.start || fallbackIso,
          end: event.endDate || event.timeframe?.end || fallbackIso,
        },
        image: event.image || "/placeholder.svg",
        tags: event.chapterTags || [],
        url: `/events/${event.id}`,
        createdAt: event.startDate || event.timeframe?.start || fallbackIso,
      }
    }),
    ...filteredResourceEvents.flatMap((event) => {
      const fallbackIso = stableIsoFallback(event.id, createdAtMap)
      let addressString = "Unknown Location"
      if (typeof event.location === "string") {
        addressString = event.location
      } else if (event.location && typeof event.location === "object" && "address" in event.location) {
        addressString = String(event.location.address)
      } else if (event.chapterTags.length > 0) {
        addressString = locales.find((locale) => locale.id === event.chapterTags[0])?.name || "Unknown Location"
      }
      const locationCoordinates =
        typeof event.location === "object" && event.location !== null
          ? (event.location as Record<string, unknown>).coordinates
          : undefined
      const explicitCoords =
        getExplicitCoords(locationCoordinates) ||
        getExplicitCoords(event.geo) ||
        getExplicitCoords(event) ||
        coordsFromChapterTags(event.chapterTags || [])
      if (!explicitCoords) return []
      return {
        id: event.id,
        type: "event" as const,
        name: event.name || "Unnamed Event",
        description: event.description || "",
        geo: { lat: explicitCoords[1], lng: explicitCoords[0] },
        location: { address: addressString },
        image: event.image || "/placeholder.svg",
        tags: event.chapterTags || [],
        url: event.url,
        createdAt: fallbackIso,
      }
    }),
    ...filteredGroups.flatMap((group) => {
      const fallbackIso = stableIsoFallback(group.id, createdAtMap)
      const groupLocationCoordinates =
        typeof group.location === "object" && group.location !== null
          ? (group.location as Record<string, unknown>).coordinates
          : undefined
      const explicitCoords =
        getExplicitCoords(groupLocationCoordinates) ||
        getExplicitCoords(group.geo) ||
        getExplicitCoords(group) ||
        coordsFromChapterTags((group.chapters.length > 0 ? group.chapters : group.chapterTags) as string[])
      if (!explicitCoords) return []
      return {
        id: group.id,
        type: "group" as const,
        name: group.name || "Unnamed Group",
        description: group.description || "",
        geo: { lat: explicitCoords[1], lng: explicitCoords[0] },
        location: {
          address:
            (group.chapters.length > 0 ? group.chapters : group.chapterTags)
              .map((tag: string) => locales.find((locale) => locale.id === tag)?.name || tag)
              .join(", ") || "Multiple locations",
        },
        image: group.avatar || "/placeholder.svg",
        tags: group.chapterTags || [],
        memberCount: Array.isArray(group.members) ? group.members.length : 0,
        url: `/groups/${group.id}`,
        modelUrl: group.modelUrl,
        createdAt: fallbackIso,
      }
    }),
    ...filteredPosts.flatMap((post) => {
      const fallbackIso = stableIsoFallback(post.id, createdAtMap)
      let addressString = "Unknown Location"
      if (typeof post.location === "string") {
        addressString = post.location
      } else if (post.location && typeof post.location === "object" && "address" in post.location) {
        addressString = String(post.location.address)
      }
      const locationCoordinates =
        typeof post.location === "object" && post.location !== null
          ? (post.location as Record<string, unknown>).coordinates
          : undefined
      const explicitCoords =
        getExplicitCoords(locationCoordinates) ||
        getExplicitCoords(post.geo) ||
        getExplicitCoords(post) ||
        coordsFromChapterTags(post.chapterTags || [])
      if (!explicitCoords) return []
      return {
        id: post.id,
        type: "post" as const,
        name: post.name || "Post",
        description: post.description || "",
        geo: { lat: explicitCoords[1], lng: explicitCoords[0] },
        location: { address: addressString },
        image: post.image || "/placeholder.svg",
        tags: post.chapterTags || [],
        url: post.url,
        createdAt: fallbackIso,
      }
    }),
    ...filteredOfferings.flatMap((offering) => {
      const fallbackIso = stableIsoFallback(offering.id, createdAtMap)
      let addressString = "Unknown Location"
      if (typeof offering.location === "string") {
        addressString = offering.location
      } else if (offering.location && typeof offering.location === "object" && "address" in offering.location) {
        addressString = String(offering.location.address)
      }
      const locationCoordinates =
        typeof offering.location === "object" && offering.location !== null
          ? (offering.location as Record<string, unknown>).coordinates
          : undefined
      const explicitCoords =
        getExplicitCoords(locationCoordinates) ||
        getExplicitCoords(offering.geo) ||
        getExplicitCoords(offering) ||
        coordsFromChapterTags(offering.chapterTags || [])
      if (!explicitCoords) return []
      return {
        id: offering.id,
        type: "offering" as const,
        name: offering.name || "Offering",
        description: offering.description || "",
        geo: { lat: explicitCoords[1], lng: explicitCoords[0] },
        location: { address: addressString },
        image: offering.image || "/placeholder.svg",
        tags: offering.chapterTags || [],
        url: offering.url,
        createdAt: fallbackIso,
      }
    }),
    // Live invitations — pulsing markers from real-time geolocation
    ...liveInvitations.map((inv) => ({
      id: `live-${inv.id}`,
      type: "live" as const,
      name: `${inv.author.name} is here!`,
      description: inv.content,
      geo: { lat: inv.lat, lng: inv.lng },
      location: undefined,
      image: inv.author.avatar,
      tags: [] as string[],
      url: `/posts/${inv.id}`,
    })),
  ], [filteredEvents, createdAtMap, filteredResourceEvents, filteredGroups, filteredPosts, filteredOfferings, liveInvitations, locales])

  const displayedItems = useMemo(() =>
    selectedTab === "all"
      ? mapItems
      : selectedTab === "events"
        ? mapItems.filter((item) => item.type === "event" || item.type === "live")
        : selectedTab === "groups"
          ? mapItems.filter((item) => item.type === "group")
          : selectedTab === "posts"
            ? mapItems.filter((item) => item.type === "post" || item.type === "live")
            : mapItems.filter((item) => item.type === "offering")
  , [selectedTab, mapItems])

  // Apply timeframe range filter when the slider is active
  const timeFilteredItems = useMemo(() => {
    if (!timeRange) return displayedItems
    const [rangeStart, rangeEnd] = timeRange
    return displayedItems.filter((item) => {
      const iso = "createdAt" in item ? (item as { createdAt?: string }).createdAt : undefined
      if (!iso) return true // keep items without dates (e.g. live invitations)
      const t = new Date(iso).getTime()
      if (!Number.isFinite(t)) return true
      return t >= rangeStart && t <= rangeEnd
    })
  }, [displayedItems, timeRange])

  const layerFilteredItems = useMemo(() => timeFilteredItems, [timeFilteredItems])

  const olMapItems: MapItem[] = useMemo(() => layerFilteredItems.map((item) => ({
    id: item.id,
    geo: item.geo,
    name: item.name,
    type: item.type,
    modelUrl: "modelUrl" in item ? (item as { modelUrl?: string }).modelUrl : undefined,
  })), [layerFilteredItems])
  const mapLayerVisibility = useMemo(() => ({
    basemap: mapLayers.basemap,
    terrain: mapLayers.terrain,
    buildings: mapLayers.buildings,
    labels: mapLayers.labels,
  }), [mapLayers])

  const geoJsonLayers = useMemo(() => {
    const layers: Array<{ id: string; url: string; visible: boolean; stroke: string; fill: string; strokeWidth: number; fillAlpha: number; showLabels: boolean; viewportAware?: boolean; minZoom?: number; labelMinSeparationDegrees?: number }> = []
    for (const [key, config] of Object.entries(BIOREGION_LAYERS)) {
      const scope = bioregionLayers[key] ?? "off"
      const active = scope === "global" ? config.global : scope === "na" ? config.na : null
      const labelsOn = bioregionLabels[key] ?? false
      // Register both sources so toggling between NA/Global hides the old one
      if (config.global?.available) {
        layers.push({ id: config.global.id, url: config.global.url, visible: active?.id === config.global.id, stroke: config.stroke, fill: config.fill, strokeWidth: config.strokeWidth, fillAlpha: config.fillAlpha, showLabels: labelsOn, viewportAware: config.viewportAware, minZoom: config.minZoom, labelMinSeparationDegrees: config.labelMinSeparationDegrees })
      }
      if (config.na?.available) {
        layers.push({ id: config.na.id, url: config.na.url, visible: active?.id === config.na.id, stroke: config.stroke, fill: config.fill, strokeWidth: config.strokeWidth, fillAlpha: config.fillAlpha, showLabels: labelsOn, viewportAware: config.viewportAware, minZoom: config.minZoom, labelMinSeparationDegrees: config.labelMinSeparationDegrees })
      }
    }
    layers.push({
      id: "overture-neighborhoods",
      url: "/api/map-neighborhoods",
      visible: mapLayers.neighborhoods,
      stroke: "#f59e0b",
      fill: "#fbbf24",
      strokeWidth: 1,
      fillAlpha: 0.22,
      showLabels: true,
      viewportAware: true,
      minZoom: 12,
      labelMinSeparationDegrees: 0.006,
    })
    return layers
  }, [bioregionLayers, bioregionLabels, mapLayers.neighborhoods])

  const setBioregionScope = useCallback((key: string, scope: LayerScope) => {
    setBioregionLayers((prev) => ({ ...prev, [key]: scope }))
  }, [])

  const toggleBioregionLabels = useCallback((key: string) => {
    setBioregionLabels((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  /**
   * Toggles a base map layer visibility flag.
   *
   * @param key - Layer key in `mapLayers`.
   */
  const toggleLayer = (key: keyof typeof mapLayers) => {
    setMapLayers((prev) => ({ ...prev, [key]: !prev[key] }))
  }


  // Derive viewport from selected scope, then fall back to visible marker centroid or global defaults.
  const mapViewport = useMemo(() => {
    if (selectedScope === "all") {
      return { center: GLOBAL_CENTER, zoom: GLOBAL_ZOOM }
    }

    const visiblePoints = layerFilteredItems.map((item) => [item.geo.lng, item.geo.lat] as [number, number])
    const visibleCenter = centerFromPoints(visiblePoints)

    const selectedLocale = locales.find((locale) => locale.id === selectedScope || locale.slug === selectedScope)
    if (selectedLocale) {
      if (selectedLocale.center) return { center: selectedLocale.center, zoom: 12 }
      if (visibleCenter) return { center: visibleCenter, zoom: 12 }
      const byName = centerFromName(selectedLocale.name)
      if (byName) return { center: byName, zoom: 12 }
    }

    const selectedBasin = basins.find((basin) => basin.id === selectedScope)
    if (selectedBasin) {
      const basinCenters = locales
        .filter((locale) => locale.basinId === selectedScope)
        .map((locale) => locale.center)
        .filter((coords): coords is [number, number] => Array.isArray(coords))
      const basinCenter = centerFromPoints(basinCenters)
      if (basinCenter) return { center: basinCenter, zoom: 8 }
      if (selectedBasin.center) return { center: selectedBasin.center, zoom: 8 }
      if (visibleCenter) return { center: visibleCenter, zoom: 8 }
      const byName = centerFromName(selectedBasin.name)
      if (byName) return { center: byName, zoom: 8 }
    }

    if (visibleCenter) return { center: visibleCenter, zoom: 10 }
    return { center: GLOBAL_CENTER, zoom: GLOBAL_ZOOM }
  }, [selectedScope, layerFilteredItems, locales, basins, selectedLocaleRecord, basinIds])

  /**
   * Navigates to the selected card/marker target route.
   *
   * @param item - Marker descriptor emitted by `MainMap`.
   */
  const handleMarkerClick = (item: MapItem) => {
    const full = displayedItems.find((d) => d.id === item.id)
    if (full && "url" in full) {
      // Client-side route transition; no auth redirect logic is performed in this page.
      router.push(full.url)
    }
  }

  /**
   * Formats an ISO-ish date string for compact card display.
   *
   * @param dateString - Date input for event cards.
   * @returns Localized short date string.
   */
  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  }

  return (
    <div className="h-[calc(100dvh-8rem)] overflow-hidden flex flex-col">
      {/* ── Desktop controls header (hidden on mobile) ── */}
      <div className="hidden md:flex flex-col gap-2 p-3 border-b shrink-0 bg-card">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search locations..."
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                className="absolute right-2.5 top-2.5 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Tabs defaultValue="all" className="flex-1" onValueChange={(v) => { setSelectedTab(v); setViewMode("map") }}>
            <TabsList className="grid grid-cols-5">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="events">Events</TabsTrigger>
              <TabsTrigger value="groups">Groups</TabsTrigger>
              <TabsTrigger value="posts">Posts</TabsTrigger>
              <TabsTrigger value="offerings">Offerings</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            variant={viewMode === "ar" ? "default" : "outline"}
            size="sm"
            className="h-9 px-3 gap-1.5 shrink-0"
            onClick={() => setViewMode(viewMode === "ar" ? "map" : "ar")}
          >
            <View className="h-4 w-4" />
            AR
          </Button>
        </div>

        <div className="flex flex-wrap gap-1 pt-1">
          <Button variant={mapLayers.terrain ? "default" : "outline"} size="sm" className="h-7 px-3 text-xs" onClick={() => toggleLayer("terrain")} disabled={!terrainSourceConfigured} title={terrainSourceConfigured ? "Toggle 3D terrain" : "Set NEXT_PUBLIC_LOCAL_TERRAIN_URL or NEXT_PUBLIC_CESIUM_ION_TOKEN to enable"}>
            Terrain
          </Button>
          <Button variant={mapLayers.buildings ? "default" : "outline"} size="sm" className="h-7 px-3 text-xs" onClick={() => toggleLayer("buildings")} disabled={!buildingsSourceConfigured} title={buildingsSourceConfigured ? "Toggle 3D buildings" : "Set NEXT_PUBLIC_LOCAL_BUILDINGS_3DTILES_URL or NEXT_PUBLIC_CESIUM_ION_TOKEN to enable"}>
            Buildings
          </Button>
          <Button variant={mapLayers.labels ? "default" : "outline"} size="sm" className="h-7 px-3 text-xs" onClick={() => toggleLayer("labels")}>
            Item Labels
          </Button>
          <Button variant={mapLayers.neighborhoods ? "default" : "outline"} size="sm" className="h-7 px-3 text-xs" onClick={() => toggleLayer("neighborhoods")}>
            Neighborhoods
          </Button>
          <Button variant={showTimeSlider ? "default" : "outline"} size="sm" className="h-7 px-3 text-xs" onClick={() => { setShowTimeSlider((prev) => !prev); if (showTimeSlider) setTimeRange(null) }}>
            <Clock className="h-3 w-3 mr-1" />
            Timeframe
          </Button>
        </div>

        <details className="group pt-1">
          <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground flex items-center gap-1 hover:text-foreground transition-colors">
            <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
            Bioregions
          </summary>
          <div className="mt-1.5 ml-4 space-y-2.5">
            {([["Terrestrial", TERRESTRIAL_KEYS], ["Hydro", HYDRO_KEYS]] as const).map(([groupLabel, keys]) => (
              <div key={groupLabel}>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">{groupLabel}</p>
                <div className="space-y-1">
                  {keys.map((key) => {
                    const config = BIOREGION_LAYERS[key]
                    const scope = bioregionLayers[key] ?? "off"
                    const hasGlobal = !!config.global
                    const hasNA = !!config.na
                    const globalAvail = config.global?.available ?? false
                    const naAvail = config.na?.available ?? false
                    const anyAvail = globalAvail || naAvail
                    const labelsOn = bioregionLabels[key] ?? false
                    return (
                      <div key={key} className={cn("flex items-center gap-2 text-xs", !anyAvail && "opacity-40")}>
                        <span className="inline-block w-2.5 h-2.5 rounded-sm border shrink-0" style={{ borderColor: config.stroke, backgroundColor: scope !== "off" ? config.fill + "40" : config.fill + "10" }} />
                        <span className="w-[72px] shrink-0 font-medium truncate">{config.label}</span>
                        <div className="flex items-center gap-0.5">
                          {hasGlobal && (
                            <button
                              className={cn(
                                "px-1.5 py-0.5 rounded text-[10px] border transition-colors",
                                scope === "global"
                                  ? "bg-emerald-600 text-white border-emerald-700"
                                  : "bg-muted text-muted-foreground border-border hover:border-ring",
                              )}
                              disabled={!globalAvail}
                              title={config.global!.sourceLabel}
                              onClick={() => setBioregionScope(key, scope === "global" ? "off" : "global")}
                            >
                              Global
                            </button>
                          )}
                          {hasNA && (
                            <button
                              className={cn(
                                "px-1.5 py-0.5 rounded text-[10px] border transition-colors",
                                scope === "na"
                                  ? "bg-blue-600 text-white border-blue-700"
                                  : "bg-muted text-muted-foreground border-border hover:border-ring",
                              )}
                              disabled={!naAvail}
                              title={config.na!.sourceLabel}
                              onClick={() => setBioregionScope(key, scope === "na" ? "off" : "na")}
                            >
                              NA
                            </button>
                          )}
                          <button
                            className={cn(
                              "px-1 py-0.5 rounded text-[10px] border transition-colors font-semibold",
                              labelsOn
                                ? "bg-gray-700 text-white border-gray-800"
                                : "bg-muted text-muted-foreground border-border hover:border-ring",
                            )}
                            disabled={scope === "off"}
                            title="Toggle labels"
                            onClick={() => toggleBioregionLabels(key)}
                          >
                            Aa
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </details>

        <p className="text-[11px] text-muted-foreground pt-1">
          Basemap: Cesium Ion | Terrain: {terrainSourceConfigured ? "ready" : "off"} | Buildings: {buildingsSourceConfigured ? "ready" : "off"}
        </p>
      </div>

      {/* ── Map / AR + floating overlays ── */}
      <div className="relative flex-1 min-h-0">
        {viewMode === "ar" ? (
          <ARView items={olMapItems} onBack={() => setViewMode("map")} />
        ) : (
          <MainMap
            items={olMapItems}
            onMarkerClick={handleMarkerClick}
            center={mapViewport.center}
            zoom={mapViewport.zoom}
            layerVisibility={mapLayerVisibility}
            geoJsonLayers={geoJsonLayers}
            orbitOnArrival={shouldOrbit}
            onOrbitComplete={() => setShouldOrbit(false)}
          />
        )}

        {/* ── Mobile floating filter tabs (always visible, includes AR toggle) ── */}
        <div className="absolute top-2 left-3 right-3 z-20 md:hidden">
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
            {(["all", "events", "groups", "posts", "offerings"] as const).map((tab) => (
              <button
                key={tab}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap shadow-sm transition-colors",
                  selectedTab === tab && viewMode === "map"
                    ? "bg-zinc-900 text-white shadow-md"
                    : "bg-background/90 backdrop-blur-sm text-zinc-600"
                )}
                onClick={() => { setSelectedTab(tab); setViewMode("map") }}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
            <button
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap shadow-sm transition-colors flex items-center gap-1",
                viewMode === "ar"
                  ? "bg-zinc-900 text-white shadow-md"
                  : "bg-background/90 backdrop-blur-sm text-zinc-600"
              )}
              onClick={() => setViewMode(viewMode === "ar" ? "map" : "ar")}
            >
              <View className="h-3 w-3" />
              AR
            </button>
          </div>
        </div>

        {viewMode === "map" && (<>
        {/* ── Mobile floating search bar ── */}
        <div className="absolute top-12 left-3 right-3 z-20 md:hidden">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search locations..."
              className="pl-9 pr-9 bg-background/95 backdrop-blur-sm shadow-lg border-0 rounded-full h-10"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                className="absolute right-3 top-2.5"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            )}
          </div>
        </div>

        {/* ── Mobile floating layer controls (bottom-left) ── */}
        <div className="absolute bottom-24 left-3 z-20 md:hidden flex flex-col gap-1.5">
          <button
            className={cn(
              "h-9 w-9 rounded-full shadow-lg flex items-center justify-center transition-colors",
              mapLayers.terrain ? "bg-zinc-900 text-white" : "bg-background/90 backdrop-blur-sm text-zinc-600"
            )}
            onClick={() => toggleLayer("terrain")}
            disabled={!terrainSourceConfigured}
            aria-label="Toggle terrain"
          >
            <Mountain className="h-4 w-4" />
          </button>
          <button
            className={cn(
              "h-9 w-9 rounded-full shadow-lg flex items-center justify-center transition-colors",
              mapLayers.buildings ? "bg-zinc-900 text-white" : "bg-background/90 backdrop-blur-sm text-zinc-600"
            )}
            onClick={() => toggleLayer("buildings")}
            disabled={!buildingsSourceConfigured}
            aria-label="Toggle buildings"
          >
            <Building2 className="h-4 w-4" />
          </button>
          <button
            className={cn(
              "h-9 w-9 rounded-full shadow-lg flex items-center justify-center transition-colors",
              mapLayers.labels ? "bg-zinc-900 text-white" : "bg-background/90 backdrop-blur-sm text-zinc-600"
            )}
            onClick={() => toggleLayer("labels")}
            aria-label="Toggle labels"
          >
            <Type className="h-4 w-4" />
          </button>
          <button
            className={cn(
              "h-9 w-9 rounded-full shadow-lg flex items-center justify-center transition-colors",
              mapLayers.neighborhoods ? "bg-zinc-900 text-white" : "bg-background/90 backdrop-blur-sm text-zinc-600"
            )}
            onClick={() => toggleLayer("neighborhoods")}
            aria-label="Toggle neighborhoods"
          >
            <Layers className="h-4 w-4" />
          </button>
          <button
            className={cn(
              "h-9 w-9 rounded-full shadow-lg flex items-center justify-center transition-colors",
              showMobileLayerPanel ? "bg-zinc-900 text-white" : "bg-background/90 backdrop-blur-sm text-zinc-600"
            )}
            onClick={() => setShowMobileLayerPanel((prev) => !prev)}
            aria-label="Bioregion layers"
          >
            <Layers className="h-4 w-4" />
          </button>
          <button
            className={cn(
              "h-9 w-9 rounded-full shadow-lg flex items-center justify-center transition-colors",
              showTimeSlider ? "bg-zinc-900 text-white" : "bg-background/90 backdrop-blur-sm text-zinc-600"
            )}
            onClick={() => { setShowTimeSlider((prev) => !prev); if (showTimeSlider) setTimeRange(null) }}
            aria-label="Toggle timeframe filter"
          >
            <Clock className="h-4 w-4" />
          </button>
        </div>

        {/* ── Mobile bioregion bottom sheet ── */}
        {showMobileLayerPanel && (
          <div className="absolute inset-0 z-30 md:hidden" onClick={() => setShowMobileLayerPanel(false)}>
            <div className="absolute inset-0 bg-black/20" />
            <div
              className="absolute bottom-0 inset-x-0 bg-card rounded-t-2xl shadow-2xl max-h-[60%] overflow-y-auto p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">Bioregion Layers</h3>
                <button onClick={() => setShowMobileLayerPanel(false)} aria-label="Close">
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>
              <div className="space-y-3">
                {([["Terrestrial", TERRESTRIAL_KEYS], ["Hydro", HYDRO_KEYS]] as const).map(([groupLabel, keys]) => (
                  <div key={groupLabel}>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{groupLabel}</p>
                    <div className="space-y-1.5">
                      {keys.map((key) => {
                        const config = BIOREGION_LAYERS[key]
                        const scope = bioregionLayers[key] ?? "off"
                        const hasGlobal = !!config.global
                        const hasNA = !!config.na
                        const globalAvail = config.global?.available ?? false
                        const naAvail = config.na?.available ?? false
                        const anyAvail = globalAvail || naAvail
                        const labelsOn = bioregionLabels[key] ?? false
                        return (
                          <div key={key} className={cn("flex items-center gap-2 text-xs", !anyAvail && "opacity-40")}>
                            <span className="inline-block w-2.5 h-2.5 rounded-sm border shrink-0" style={{ borderColor: config.stroke, backgroundColor: scope !== "off" ? config.fill + "40" : config.fill + "10" }} />
                            <span className="w-[72px] shrink-0 font-medium truncate">{config.label}</span>
                            <div className="flex items-center gap-0.5">
                              {hasGlobal && (
                                <button
                                  className={cn(
                                    "px-1.5 py-0.5 rounded text-[10px] border transition-colors",
                                    scope === "global"
                                      ? "bg-emerald-600 text-white border-emerald-700"
                                      : "bg-muted text-muted-foreground border-border hover:border-ring",
                                  )}
                                  disabled={!globalAvail}
                                  title={config.global!.sourceLabel}
                                  onClick={() => setBioregionScope(key, scope === "global" ? "off" : "global")}
                                >
                                  Global
                                </button>
                              )}
                              {hasNA && (
                                <button
                                  className={cn(
                                    "px-1.5 py-0.5 rounded text-[10px] border transition-colors",
                                    scope === "na"
                                      ? "bg-blue-600 text-white border-blue-700"
                                      : "bg-muted text-muted-foreground border-border hover:border-ring",
                                  )}
                                  disabled={!naAvail}
                                  title={config.na!.sourceLabel}
                                  onClick={() => setBioregionScope(key, scope === "na" ? "off" : "na")}
                                >
                                  NA
                                </button>
                              )}
                              <button
                                className={cn(
                                  "px-1 py-0.5 rounded text-[10px] border transition-colors font-semibold",
                                  labelsOn
                                    ? "bg-gray-700 text-white border-gray-800"
                                    : "bg-muted text-muted-foreground border-border hover:border-ring",
                                )}
                                disabled={scope === "off"}
                                title="Toggle labels"
                                onClick={() => toggleBioregionLabels(key)}
                              >
                                Aa
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground pt-3 border-t mt-3">
                Basemap: Cesium Ion | Terrain: {terrainSourceConfigured ? "ready" : "off"} | Buildings: {buildingsSourceConfigured ? "ready" : "off"}
              </p>
            </div>
          </div>
        )}

        {/* ── Timeframe range slider overlay ── */}
        {showTimeSlider && (
          <div className="absolute bottom-28 md:bottom-24 left-1/2 -translate-x-1/2 z-20 w-[calc(100%-3rem)] max-w-lg pointer-events-auto">
            <div className="bg-background/80 backdrop-blur-md rounded-lg border shadow-lg px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Timeframe Filter
                </span>
                <button
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => { setTimeRange(null); setShowTimeSlider(false) }}
                >
                  Reset
                </button>
              </div>
              <Slider
                min={timeExtent.min}
                max={timeExtent.max}
                step={86_400_000}
                value={timeRange ?? [timeExtent.min, timeExtent.max]}
                onValueChange={(val) => setTimeRange([val[0], val[1]])}
                className="w-full"
              />
              <div className="flex justify-between mt-1.5 text-[10px] text-muted-foreground">
                <span>
                  {new Date(timeRange?.[0] ?? timeExtent.min).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </span>
                <span>
                  {new Date(timeRange?.[1] ?? timeExtent.max).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ── Card rail (floating at bottom) ── */}
        <div className="absolute inset-x-0 bottom-2 md:bottom-16 z-10 pointer-events-none px-3 pb-2">
          {layerFilteredItems.length === 0 ? (
            <div className="pointer-events-auto mx-auto max-w-sm rounded-md border bg-card px-4 py-3 text-center text-sm text-muted-foreground shadow">
              <p>No locations found matching your criteria</p>
              <Button
                variant="link"
                className="mt-1"
                onClick={() => {
                  setSearchQuery("")
                }}
              >
                Reset filters
              </Button>
            </div>
          ) : (
            <div className="pointer-events-auto flex gap-2 overflow-x-auto no-scrollbar pb-1">
              {layerFilteredItems.map((item) => (
                <Link
                  href={item.url}
                  key={item.id}
                  className="min-w-[200px] max-w-[240px] md:min-w-[280px] md:max-w-[320px] rounded-md border bg-card hover:border-primary transition-colors overflow-hidden flex shrink-0 shadow"
                  onMouseEnter={() => setHoveredItem(item.id)}
                  onMouseLeave={() => setHoveredItem(null)}
                >
                  <div className="relative h-20 w-20 md:h-24 md:w-24 shrink-0">
                    <Image src={item.image || "/placeholder-event.jpg"} alt={item.name} fill className="object-cover" />
                    <div
                      className={cn(
                        "absolute top-2 left-2 rounded-full w-6 h-6 flex items-center justify-center",
                        item.type === "event"
                          ? "bg-primary"
                          : item.type === "group"
                            ? "bg-blue-500"
                            : item.type === "post"
                              ? "bg-emerald-500"
                              : "bg-amber-500",
                      )}
                    >
                      {item.type === "event" ? <Calendar className="h-3 w-3 text-white" /> : null}
                      {item.type === "group" ? <Users className="h-3 w-3 text-white" /> : null}
                      {item.type === "post" ? <MapPin className="h-3 w-3 text-white" /> : null}
                      {item.type === "offering" ? <MapPin className="h-3 w-3 text-white" /> : null}
                    </div>
                  </div>
                  <div className="p-2 min-w-0">
                    <h3 className="font-medium text-sm truncate">{item.name}</h3>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <p className="truncate">{(item.location as Record<string, unknown> | undefined)?.address as string || "Unknown location"}</p>
                    </div>
                    {item.type === "event" && "timeframe" in item ? (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                        <Calendar className="h-3 w-3 shrink-0" />
                        <p>{formatDate((item.timeframe as { start?: string }).start || "2024-01-01T00:00:00.000Z")}</p>
                      </div>
                    ) : null}
                    {item.type === "group" && "memberCount" in item ? (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                        <Users className="h-3 w-3 shrink-0" />
                        <p>{item.memberCount || 0} members</p>
                      </div>
                    ) : null}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
        </>)}
      </div>
    </div>
  )
}
