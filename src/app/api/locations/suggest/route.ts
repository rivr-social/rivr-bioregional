/**
 * @module api/locations/suggest
 *
 * Location autocomplete API route that merges suggestions from two data sources:
 * 1. **Local Photon geocoder** -- an OpenStreetMap-based geocoding service
 *    running on localhost (Overture Maps / Photon).
 * 2. **Overture Places database** -- locally ingested place data stored in the
 *    `overture_places` PostgreSQL table, queried via Drizzle ORM.
 *
 * Results are deduplicated by label + coordinates and capped at the requested limit.
 *
 * Key exports:
 * - GET handler: returns `{ suggestions: LocationSuggestion[] }`
 *
 * Dependencies:
 * - Local Photon geocoder at LOCAL_PHOTON_URL (default http://127.0.0.1:2322/api)
 * - PostgreSQL `overture_places` table via Drizzle
 * - `@/lib/sql-like` for safe LIKE pattern escaping
 *
 * Security:
 * - No authentication required (location search is a public feature).
 * - Photon requests are restricted to localhost-only URLs via `toLocalHostOnlyUrl`.
 * - Query input is trimmed and whitespace-normalized before use.
 *
 * @see src/components/location-autocomplete-input.tsx - client-side consumer
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { escapeLikePattern } from "@/lib/sql-like";
import { getClientIp } from "@/lib/client-ip";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";

/** Shape of a single location suggestion returned to the client. */
type LocationSuggestion = {
  id: string;
  label: string;
  name?: string;
  locality?: string;
  adminRegion?: string;
  countryCode?: string;
  lat?: number;
  lon?: number;
  source?: string;
};

/** GeoJSON feature shape returned by the Photon geocoder. */
type PhotonFeature = {
  properties?: Record<string, unknown>;
  geometry?: { coordinates?: [number, number] };
};

/**
 * Normalizes user input by trimming leading/trailing whitespace and collapsing
 * internal runs of whitespace to a single space.
 *
 * @param input - Raw search query from the client.
 * @returns Cleaned query string.
 */
function normalizeQuery(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

/**
 * Validates that a URL string points to a localhost address. This is a security
 * measure to prevent SSRF: the Photon geocoder should only run locally.
 *
 * Allowed hostnames: localhost, 127.0.0.1, 0.0.0.0, photon (Docker service name).
 *
 * @param urlRaw - The raw URL string to validate.
 * @returns A parsed URL if valid and local, or `null` otherwise.
 */
function toLocalHostOnlyUrl(urlRaw: string): URL | null {
  try {
    const url = new URL(urlRaw);
    const localHosts = new Set(["localhost", "127.0.0.1", "0.0.0.0", "photon"]);
    if (!localHosts.has(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * Joins non-empty address parts into a comma-separated display label.
 *
 * @param parts - Address components (name, city, state, etc.), may be null/empty.
 * @returns A formatted label string like "Boulder, Colorado, US".
 */
function buildLabel(parts: Array<string | null | undefined>): string {
  return parts.map((part) => (part ?? "").trim()).filter(Boolean).join(", ");
}

/**
 * Maps a raw Photon GeoJSON feature into the application's LocationSuggestion format.
 *
 * Extracts structured address fields (name, city/locality, state/region, country code,
 * street, house number, postcode) and OSM classification metadata. Constructs a
 * human-readable label from these parts.
 *
 * @param feature - A GeoJSON feature from the Photon geocoder response.
 * @returns A LocationSuggestion, or `null` if no meaningful label could be built.
 */
function mapPhotonFeature(feature: PhotonFeature): LocationSuggestion | null {
  const props = feature.properties ?? {};
  const name = typeof props.name === "string" ? props.name : "";
  const locality = typeof props.city === "string" ? props.city : (typeof props.locality === "string" ? props.locality : "");
  const adminRegion = typeof props.state === "string" ? props.state : (typeof props.region === "string" ? props.region : "");
  const countryCode = typeof props.countrycode === "string" ? props.countrycode.toUpperCase() : "";
  const street = typeof props.street === "string" ? props.street : "";
  const houseNumber = typeof props.housenumber === "string" ? props.housenumber : "";
  const postcode = typeof props.postcode === "string" ? props.postcode : "";
  const osmKey = typeof props.osm_key === "string" ? props.osm_key : "";
  const osmValue = typeof props.osm_value === "string" ? props.osm_value : "";
  const lon = Number(feature.geometry?.coordinates?.[0]);
  const lat = Number(feature.geometry?.coordinates?.[1]);
  const hasCoords = Number.isFinite(lon) && Number.isFinite(lat);

  const line1 = buildLabel([name || street, houseNumber]);
  const line2 = buildLabel([locality, adminRegion, postcode, countryCode]);
  const label = buildLabel([line1, line2]);
  if (!label) return null;

  return {
    id: `photon:${osmKey}:${osmValue}:${label}`.toLowerCase(),
    label,
    name: name || street || label,
    locality: locality || undefined,
    adminRegion: adminRegion || undefined,
    countryCode: countryCode || undefined,
    lat: hasCoords ? lat : undefined,
    lon: hasCoords ? lon : undefined,
    source: "photon",
  };
}

/**
 * Fetches location suggestions from the local Photon geocoder.
 *
 * Controlled by the `LOCAL_PHOTON_ENABLED` and `LOCAL_PHOTON_URL` environment
 * variables. The limit is clamped to [1, 15] to prevent abuse.
 *
 * @param query - Normalized search text.
 * @param limit - Maximum number of results to return.
 * @returns An array of LocationSuggestions, or empty on error/disabled.
 */
async function fetchPhotonSuggestions(query: string, limit: number): Promise<LocationSuggestion[]> {
  const enabled = (process.env.LOCAL_PHOTON_ENABLED ?? "true").toLowerCase() !== "false";
  if (!enabled) return [];
  const localPhotonUrl = process.env.LOCAL_PHOTON_URL ?? "http://127.0.0.1:2322/api";
  const baseUrl = toLocalHostOnlyUrl(localPhotonUrl);
  if (!baseUrl) return [];

  const params = new URLSearchParams({
    q: query,
    limit: String(Math.max(1, Math.min(limit, 15))),
  });
  if (!params.has("lang")) params.set("lang", "en");

  const requestUrl = `${baseUrl.toString().replace(/\/$/, "")}?${params.toString()}`;
  const response = await fetch(requestUrl, {
    method: "GET",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return [];

  const payload = (await response.json()) as { features?: PhotonFeature[] };
  const features = Array.isArray(payload.features) ? payload.features : [];
  return features
    .map(mapPhotonFeature)
    .filter((entry): entry is LocationSuggestion => !!entry)
    .slice(0, limit);
}

/**
 * Queries the local `overture_places` database table for location suggestions.
 *
 * Uses a weighted ranking system:
 * - Exact name match: 1000
 * - Name prefix match: 700
 * - Display name prefix match: 500
 * - Exact locality match: 450
 * - Fallback substring match: 100
 *
 * Results are ordered by rank score descending, then by display name length
 * ascending (shorter/more specific names first).
 *
 * @param query - Normalized search text.
 * @param limit - Maximum number of results to return.
 * @returns An array of LocationSuggestions from the Overture Places table.
 */
async function fetchOvertureSuggestions(query: string, limit: number): Promise<LocationSuggestion[]> {
  const escaped = escapeLikePattern(query.toLowerCase());
  const pattern = `%${escaped}%`;

  const rows = await db.execute(sql`
    SELECT
      id,
      name,
      display_name,
      locality,
      admin_region,
      country_code,
      lat,
      lon,
      source,
      (
        CASE
          WHEN lower(name) = lower(${query}) THEN 1000
          WHEN lower(name) LIKE lower(${query + "%"}) ESCAPE '\' THEN 700
          WHEN lower(display_name) LIKE lower(${query + "%"}) ESCAPE '\' THEN 500
          WHEN lower(locality) = lower(${query}) THEN 450
          ELSE 100
        END
      ) AS rank_score
    FROM overture_places
    WHERE
      lower(name) LIKE lower(${pattern}) ESCAPE '\'
      OR lower(display_name) LIKE lower(${pattern}) ESCAPE '\'
      OR lower(locality) LIKE lower(${pattern}) ESCAPE '\'
    ORDER BY rank_score DESC, char_length(display_name) ASC
    LIMIT ${limit}
  `);

  return (rows as Array<Record<string, unknown>>).map((row) => {
    const label = String(row.display_name ?? row.name ?? "").trim();
    return {
      id: String(row.id),
      label,
      name: String(row.name ?? label),
      locality: row.locality ? String(row.locality) : undefined,
      adminRegion: row.admin_region ? String(row.admin_region) : undefined,
      countryCode: row.country_code ? String(row.country_code) : undefined,
      lat: typeof row.lat === "number" ? row.lat : undefined,
      lon: typeof row.lon === "number" ? row.lon : undefined,
      source: typeof row.source === "string" ? row.source : "overture",
    } satisfies LocationSuggestion;
  });
}

/** Shape of a single Nominatim search result. */
type NominatimResult = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  address?: Record<string, string>;
};

/**
 * Fetches location suggestions from the public OpenStreetMap Nominatim geocoder.
 * Used as a fallback when Photon is disabled and the Overture table is unavailable.
 */
async function fetchNominatimSuggestions(query: string, limit: number): Promise<LocationSuggestion[]> {
  const params = new URLSearchParams({
    q: query,
    format: "json",
    addressdetails: "1",
    limit: String(Math.max(1, Math.min(limit, 10))),
  });

  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?${params.toString()}`,
    {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "User-Agent": "RIVR/1.0 (location-search)",
      },
    }
  );
  if (!response.ok) return [];

  const results = (await response.json()) as NominatimResult[];
  return results.map((r) => {
    const addr = r.address ?? {};
    const locality = addr.city || addr.town || addr.village || "";
    const adminRegion = addr.state || addr.county || "";
    const countryCode = (addr.country_code || "").toUpperCase();

    return {
      id: `nominatim:${r.place_id}`,
      label: r.display_name,
      name: addr.road
        ? buildLabel([addr.house_number, addr.road])
        : r.display_name.split(",")[0].trim(),
      locality: locality || undefined,
      adminRegion: adminRegion || undefined,
      countryCode: countryCode || undefined,
      lat: Number.parseFloat(r.lat) || undefined,
      lon: Number.parseFloat(r.lon) || undefined,
      source: "nominatim",
    } satisfies LocationSuggestion;
  });
}

/**
 * Deduplicates suggestions by label (lowercased) + coordinates.
 *
 * Since results come from two independent sources (Photon and Overture), the
 * same location may appear twice. This function keeps the first occurrence
 * and stops once the limit is reached.
 *
 * @param values - Combined suggestions from all sources.
 * @param limit - Maximum number of unique results to return.
 * @returns Deduplicated array of LocationSuggestions.
 */
function dedupeSuggestions(values: LocationSuggestion[], limit: number): LocationSuggestion[] {
  const seen = new Set<string>();
  const out: LocationSuggestion[] = [];
  for (const value of values) {
    const key = `${value.label.toLowerCase()}|${value.lat ?? ""}|${value.lon ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * GET /api/locations/suggest?q=<query>&limit=<n>
 *
 * Returns location autocomplete suggestions from Photon and Overture sources.
 *
 * Query parameters:
 * - `q` (required): search text; must be at least 2 characters.
 * - `limit` (optional): max results, clamped to [1, 15], default 8.
 *
 * No authentication required.
 *
 * Error handling: individual data source failures are caught and silenced;
 * the response always returns a valid `{ suggestions }` array. If both
 * sources fail entirely, the error message is included for diagnostics.
 *
 * @param request - The incoming Next.js request with query parameters.
 * @returns A NextResponse with `{ suggestions: LocationSuggestion[] }` (always 200).
 *
 * @example
 * ```ts
 * const res = await fetch("/api/locations/suggest?q=Boulder&limit=5");
 * const { suggestions } = await res.json();
 * ```
 */
export async function GET(request: NextRequest) {
  const query = normalizeQuery(request.nextUrl.searchParams.get("q") ?? "");
  const limitRaw = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "8", 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 15)) : 8;

  const clientIp = getClientIp(request.headers);
  const limiter = await rateLimit(
    `locations:${clientIp}`,
    RATE_LIMITS.LOCATIONS.limit,
    RATE_LIMITS.LOCATIONS.windowMs,
  );
  if (!limiter.success) {
    return NextResponse.json(
      { suggestions: [], error: "Rate limit exceeded. Please try again later." },
      { status: 429 },
    );
  }

  if (query.length < 2) {
    return NextResponse.json({ suggestions: [] }, { status: 200 });
  }

  try {
    const [photon, overture] = await Promise.all([
      fetchPhotonSuggestions(query, limit).catch(() => []),
      fetchOvertureSuggestions(query, limit).catch(() => []),
    ]);

    let combined = [...photon, ...overture];

    // Fallback to Nominatim if both primary sources returned nothing
    if (combined.length === 0) {
      combined = await fetchNominatimSuggestions(query, limit).catch(() => []);
    }

    const suggestions = dedupeSuggestions(combined, limit);
    return NextResponse.json({ suggestions }, { status: 200 });
  } catch (error) {
    console.error("[locations/suggest] Failed to fetch suggestions:", error);
    return NextResponse.json(
      { suggestions: [], error: "Unable to fetch location suggestions right now." },
      { status: 200 }
    );
  }
}
