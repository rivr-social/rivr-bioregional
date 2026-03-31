/**
 * @module api/map-style
 *
 * API route that serves Mapbox style JSON, sanitized for MapLibre GL compatibility.
 *
 * This route implements a strict local-only strategy: it serves a cached style
 * from the filesystem and does not fetch from Mapbox at runtime.
 *
 * Key exports:
 * - GET handler: serves sanitized map style JSON
 *
 * Dependencies:
 * - Local filesystem cache at MAP_DATA_ROOT/style/{owner}/{id}/style.json
 *
 * @see src/app/api/map-style-tiles/[z]/[x]/[y]/route.ts - companion tile proxy
 * @see src/app/api/map-tilesets/route.ts - tileset metadata endpoint
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

/** Mapbox account that owns the style document. */
const STYLE_OWNER = process.env.MAPBOX_STYLE_OWNER || process.env.NEXT_PUBLIC_MAPBOX_STYLE_OWNER || "camalot999";
/** Mapbox style identifier within the owner's account. */
const STYLE_ID = process.env.MAPBOX_STYLE_ID || process.env.NEXT_PUBLIC_MAPBOX_STYLE_ID || "clvfmv3sf00ek01rdfvfhc2gd";
/** Root directory for all locally cached map data (styles, tiles, tilesets). */
const MAP_DATA_ROOT = process.env.MAP_DATA_ROOT || path.join(process.cwd(), "data", "map");
/** Directory where the local style cache is persisted. */
const CACHE_ROOT = path.join(MAP_DATA_ROOT, "style", STYLE_OWNER, STYLE_ID);
/** Full path to the cached style JSON file. */
const CACHE_FILE = path.join(CACHE_ROOT, "style.json");

/** Recursive JSON type used for style property traversal. */
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/**
 * Recursively checks whether a JSON value tree contains Mapbox GL JS-specific
 * expression operators that MapLibre GL does not support.
 *
 * Unsupported operators include `config`, `measure-light`, `distance-from-center`,
 * `hsl`, `hsla`, and `to-hsla`. Any layer property containing these must be
 * stripped before the style is handed to MapLibre.
 *
 * @param value - A JSON value from a style layer's paint or layout property.
 * @returns True if the value or any nested descendant uses an unsupported expression.
 */
function hasUnsupportedExpression(value: JsonValue): boolean {
  if (Array.isArray(value)) {
    const op = typeof value[0] === "string" ? value[0] : "";
    if (
      op === "config" ||
      op === "measure-light" ||
      op === "distance-from-center" ||
      op === "hsl" ||
      op === "hsla" ||
      op === "to-hsla"
    ) return true;
    return value.some((entry) => hasUnsupportedExpression(entry));
  }
  if (value && typeof value === "object") {
    return Object.values(value).some((entry) => hasUnsupportedExpression(entry as JsonValue));
  }
  return false;
}

/**
 * Recursively sanitizes a style property value by removing any branches that
 * contain unsupported Mapbox expressions.
 *
 * @param value - A JSON value from a style layer property.
 * @returns The cleaned value, or `undefined` if the entire value must be discarded.
 */
function sanitizeStylePropertyValue(value: JsonValue): JsonValue | undefined {
  if (hasUnsupportedExpression(value)) return undefined;
  if (Array.isArray(value)) {
    const sanitizedEntries: JsonValue[] = [];
    for (const entry of value) {
      const cleaned = sanitizeStylePropertyValue(entry as JsonValue);
      if (cleaned === undefined) return undefined;
      sanitizedEntries.push(cleaned);
    }
    return sanitizedEntries;
  }
  if (value && typeof value === "object") {
    const next: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      const cleaned = sanitizeStylePropertyValue(entry as JsonValue);
      if (cleaned !== undefined) next[key] = cleaned;
    }
    return next;
  }
  return value;
}

/**
 * Sanitizes a single Mapbox style layer for MapLibre compatibility.
 *
 * Strips unsupported paint/layout expressions and removes emissive-strength
 * paint properties (3D lighting feature exclusive to Mapbox GL JS v3).
 *
 * @param layer - A raw Mapbox style layer object.
 * @returns A cleaned layer object, or `null` if the layer has no valid id/type.
 */
function sanitizeLayer(layer: Record<string, JsonValue>): Record<string, JsonValue> | null {
  const id = typeof layer.id === "string" ? layer.id : null;
  const type = typeof layer.type === "string" ? layer.type : null;
  if (!id || !type) return null;

  const cleaned: Record<string, JsonValue> = { id, type };
  const passthroughKeys = ["source", "source-layer", "minzoom", "maxzoom", "filter", "metadata"] as const;
  for (const key of passthroughKeys) {
    if (key in layer) cleaned[key] = layer[key] as JsonValue;
  }

  if ("layout" in layer && layer.layout && typeof layer.layout === "object") {
    const layout = sanitizeStylePropertyValue(layer.layout as JsonValue);
    if (layout && typeof layout === "object" && Object.keys(layout).length > 0) {
      cleaned.layout = layout;
    }
  }

  if ("paint" in layer && layer.paint && typeof layer.paint === "object") {
    const paintIn = layer.paint as Record<string, JsonValue>;
    const paintOut: Record<string, JsonValue> = {};
    for (const [key, value] of Object.entries(paintIn)) {
      if (key.endsWith("-emissive-strength")) continue;
      const cleanedValue = sanitizeStylePropertyValue(value as JsonValue);
      if (cleanedValue !== undefined) {
        paintOut[key] = cleanedValue;
      }
    }
    if (Object.keys(paintOut).length > 0) {
      cleaned.paint = paintOut;
    }
  }

  return cleaned;
}

/**
 * Parses a raw Mapbox style JSON string and produces a MapLibre-compatible
 * style document. Preserves sources, glyphs, sprite, terrain, and camera
 * defaults while filtering layers through {@link sanitizeLayer}.
 *
 * @param raw - The raw JSON string from the Mapbox Styles API or local cache.
 * @returns A JSON string representing the sanitized style.
 */
function sanitizeForMapLibre(raw: string): string {
  const parsed = JSON.parse(raw) as Record<string, JsonValue>;
  const layers = Array.isArray(parsed.layers) ? parsed.layers as Array<Record<string, JsonValue>> : [];

  const cleanedLayers = layers
    .map((layer) => sanitizeLayer(layer))
    .filter((layer): layer is Record<string, JsonValue> => !!layer);

  const sanitized: Record<string, JsonValue> = {
    version: typeof parsed.version === "number" ? parsed.version : 8,
    name: typeof parsed.name === "string" ? parsed.name : "RIVR Style",
    metadata: {} as JsonValue,
    center: (parsed.center ?? [-105.2705, 40.015]) as JsonValue,
    zoom: (parsed.zoom ?? 8) as JsonValue,
    bearing: (parsed.bearing ?? 0) as JsonValue,
    pitch: (parsed.pitch ?? 0) as JsonValue,
    sprite: parsed.sprite as JsonValue,
    glyphs: parsed.glyphs as JsonValue,
    sources: (parsed.sources ?? {}) as JsonValue,
    layers: cleanedLayers as unknown as JsonValue,
  };

  if (parsed.terrain && typeof parsed.terrain === "object") {
    sanitized.terrain = parsed.terrain as JsonValue;
  }

  return JSON.stringify(sanitized);
}

/**
 * GET /api/map-style
 *
 * Returns a MapLibre-compatible style JSON document. The strategy is:
 * 1. Attempt to serve from the local filesystem cache (fast path).
 * 2. If cache is missing, return 404 with setup guidance.
 *
 * No authentication is required -- map styles are public resources.
 *
 * @param _request - The incoming Next.js request.
 * @returns A Response with sanitized style JSON, or an error payload.
 *
 * @example
 * ```ts
 * // Client-side fetch
 * const res = await fetch("/api/map-style");
 * const style = await res.json();
 * ```
 */
export async function GET(_request: Request) {
  try {
    const cached = await readFile(CACHE_FILE, "utf8");
    const sanitized = sanitizeForMapLibre(cached);
    return new Response(sanitized, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
        "X-Map-Style-Source": "cache",
      },
    });
  } catch {
    // cache miss; return local-only error below.
  }

  return new Response(
    JSON.stringify({
      error: "style cache missing",
      cacheFile: CACHE_FILE,
      hint: "Run `pnpm map:mirror:style` once to populate local map data.",
    }),
    { status: 404, headers: { "Content-Type": "application/json; charset=utf-8" } }
  );
}
