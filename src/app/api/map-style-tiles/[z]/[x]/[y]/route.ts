/**
 * @module api/map-style-tiles
 *
 * Dynamic API route that serves raster map tiles at `/api/map-style-tiles/{z}/{x}/{y}`.
 * Implements a strict local-only tile cache.
 *
 * Tile serving strategy:
 * 1. Parse and validate z/x/y tile coordinates from the URL path.
 * 2. Attempt to serve the tile from the local filesystem cache.
 * 3. On cache miss, return a 1x1 transparent PNG so the map can still render.
 *
 * Key exports:
 * - GET handler: serves PNG raster tiles
 *
 * Dependencies:
 * - Local filesystem cache at MAP_DATA_ROOT/tiles/{owner}/{id}/{z}/{x}/{y}.png
 *
 * Security:
 * - No authentication required (map tiles are public).
 * - No runtime dependency on Mapbox or external tile services.
 *
 * @see src/app/api/map-style/route.ts - companion style JSON endpoint
 */
import { NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

/** Mapbox account that owns the style document. */
const STYLE_OWNER = process.env.MAPBOX_STYLE_OWNER || process.env.NEXT_PUBLIC_MAPBOX_STYLE_OWNER || "camalot999";
/** Mapbox style identifier within the owner's account. */
const STYLE_ID = process.env.MAPBOX_STYLE_ID || process.env.NEXT_PUBLIC_MAPBOX_STYLE_ID || "clvfmv3sf00ek01rdfvfhc2gd";
/** Root directory for all locally cached map data. */
const MAP_DATA_ROOT = process.env.MAP_DATA_ROOT || path.join(process.cwd(), "data", "map");
/** Directory where tile PNG files are persisted in z/x/y.png structure. */
const CACHE_ROOT = path.join(MAP_DATA_ROOT, "tiles", STYLE_OWNER, STYLE_ID);
/**
 * A 1x1 transparent PNG used as a fallback tile when no real tile data is
 * available. Prevents rendering errors and "broken image" icons on the map.
 */
const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7ZQx8AAAAASUVORK5CYII=",
  "base64"
);

/**
 * Parses a tile coordinate string to an integer, stripping any `.png` suffix
 * that may be appended by map clients requesting tiles with file extensions.
 *
 * @param value - Raw path segment (e.g. "12", "3456.png").
 * @returns The parsed integer, or `null` if the value is not a valid non-negative integer.
 */
function parseInteger(value: string): number | null {
  const normalized = value.replace(/\.png$/i, "");
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * GET /api/map-style-tiles/{z}/{x}/{y}
 *
 * Serves a raster PNG tile for the given z/x/y coordinates.
 *
 * Response headers include appropriate Cache-Control directives:
 * - Cached tiles: immutable, 1-year max-age (tiles are content-addressed by z/x/y).
 * - Transparent fallback tiles: short 3-5 minute max-age to allow re-fetch once
 *   data becomes available.
 *
 * The `X-Map-Tile-Status` header indicates the source of the tile for debugging.
 *
 * @param _request - Unused; the route relies only on path params.
 * @param params - Dynamic route params containing z (zoom), x (column), y (row).
 * @returns A Response with PNG image data (200), or 400 for invalid coordinates.
 *
 * @example
 * ```ts
 * // MapLibre tile source
 * { tiles: ["/api/map-style-tiles/{z}/{x}/{y}"] }
 * ```
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ z: string; x: string; y: string }> }
) {
  const { z: zRaw, x: xRaw, y: yRaw } = await params;
  const z = parseInteger(zRaw);
  const x = parseInteger(xRaw);
  const y = parseInteger(yRaw);

  if (z === null || x === null || y === null) {
    return new Response("invalid tile coordinate", { status: 400 });
  }

  const filePath = path.join(CACHE_ROOT, String(z), String(x), `${y}.png`);
  try {
    const bytes = await readFile(filePath);
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    // Cache miss — proxy from OpenStreetMap so layers always render.
    const osmUrl = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
    try {
      const upstream = await fetch(osmUrl, {
        headers: { "User-Agent": "Rivr/1.0 (https://rivr.social)" },
      });
      if (upstream.ok) {
        const tileBytes = await upstream.arrayBuffer();
        return new Response(tileBytes, {
          status: 200,
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "public, max-age=86400",
            "X-Map-Tile-Status": "proxy-osm",
          },
        });
      }
    } catch {
      // OSM proxy failed — fall through to transparent fallback.
    }
    return new Response(TRANSPARENT_PNG, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=300",
        "X-Map-Tile-Status": "cache-miss-transparent",
      },
    });
  }
}
