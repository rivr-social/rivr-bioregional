/**
 * @module api/map-tilesets
 *
 * Local-only API route that serves cached tileset metadata used by map layer controls.
 * Runtime never fetches Mapbox upstream; populate cache once via mirror scripts.
 */
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

type TileSetCategory = "regions" | "basins" | "watersheds";

interface TileSetEntry {
  id: string;
  categories: TileSetCategory[];
  vectorLayers: string[];
}

const STYLE_OWNER = process.env.MAPBOX_STYLE_OWNER || process.env.NEXT_PUBLIC_MAPBOX_STYLE_OWNER || "camalot999";
const STYLE_ID = process.env.MAPBOX_STYLE_ID || process.env.NEXT_PUBLIC_MAPBOX_STYLE_ID || "clvfmv3sf00ek01rdfvfhc2gd";
const MAP_DATA_ROOT = process.env.MAP_DATA_ROOT || path.join(process.cwd(), "data", "map");
const CACHE_ROOT = path.join(MAP_DATA_ROOT, "style", STYLE_OWNER, STYLE_ID);
const TILESET_CACHE_FILE = path.join(CACHE_ROOT, "tilesets.json");

export async function GET() {
  try {
    const cached = await readFile(TILESET_CACHE_FILE, "utf8");
    const parsed = JSON.parse(cached) as { tilesets?: TileSetEntry[] };
    return NextResponse.json({ tilesets: parsed.tilesets ?? [] }, { status: 200 });
  } catch {
    return NextResponse.json(
      {
        error: "tileset cache missing",
        tilesets: [],
        cacheFile: TILESET_CACHE_FILE,
        hint: "Run `pnpm map:mirror:style` once to populate local map data.",
      },
      { status: 200 }
    );
  }
}
