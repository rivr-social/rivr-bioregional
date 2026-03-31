import { NextResponse } from "next/server";
import { access, readdir } from "node:fs/promises";
import path from "node:path";

type Probe = {
  ok: boolean;
  detail: string;
};

function envStyleOwner(): string {
  return process.env.MAPBOX_STYLE_OWNER || process.env.NEXT_PUBLIC_MAPBOX_STYLE_OWNER || "camalot999";
}

function envStyleId(): string {
  return process.env.MAPBOX_STYLE_ID || process.env.NEXT_PUBLIC_MAPBOX_STYLE_ID || "clvfmv3sf00ek01rdfvfhc2gd";
}

function isServerLocalUrl(raw: string): boolean {
  if (!raw) return false;
  if (raw.startsWith("/")) return true;
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function hasAnyTilePng(root: string, depth = 5): Promise<boolean> {
  if (depth < 0) return false;
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    const nextPath = path.join(root, entry.name);
    if (entry.isFile() && entry.name.endsWith(".png")) return true;
    if (entry.isDirectory()) {
      if (await hasAnyTilePng(nextPath, depth - 1)) return true;
    }
  }
  return false;
}

async function probeHttp(url: string): Promise<Probe> {
  if (!url) return { ok: false, detail: "not configured" };
  if (!isServerLocalUrl(url)) return { ok: false, detail: `non-local URL: ${url}` };
  try {
    const response = await fetch(url, { method: "GET", cache: "no-store" });
    return {
      ok: response.ok,
      detail: `${response.status} ${response.statusText}`,
    };
  } catch (error) {
    return { ok: false, detail: String(error) };
  }
}

export async function GET() {
  const enableTestEndpoints = process.env.ENABLE_TEST_ENDPOINTS === "true";
  if (!enableTestEndpoints) {
    return NextResponse.json(
      { error: "Not found" },
      { status: 404 }
    );
  }

  const styleOwner = envStyleOwner();
  const styleId = envStyleId();
  const mapDataRoot = process.env.MAP_DATA_ROOT || path.join(process.cwd(), "data", "map");

  const styleFile = path.join(mapDataRoot, "style", styleOwner, styleId, "style.json");
  const tilesetsFile = path.join(mapDataRoot, "style", styleOwner, styleId, "tilesets.json");
  const tilesRoot = path.join(mapDataRoot, "tiles", styleOwner, styleId);

  const terrainUrl = (
    process.env.NEXT_PUBLIC_LOCAL_TERRAIN_URL ||
    process.env.NEXT_PUBLIC_CESIUM_TERRAIN_URL ||
    ""
  ).trim();
  const buildingsUrl = (
    process.env.NEXT_PUBLIC_LOCAL_BUILDINGS_3DTILES_URL ||
    process.env.NEXT_PUBLIC_CESIUM_BUILDINGS_URL ||
    ""
  ).trim();
  const streetsUrl = (
    process.env.NEXT_PUBLIC_LOCAL_STREETS_TILES_URL ||
    process.env.NEXT_PUBLIC_STREETS_TILES_URL ||
    "/api/map-style-tiles/{z}/{x}/{y}"
  ).trim();
  const boundariesUrl = (process.env.NEXT_PUBLIC_LOCAL_BASEMAP_URL || "/api/map-style-tiles/{z}/{x}/{y}").trim();

  const styleExists = await fileExists(styleFile);
  const tilesetsExists = await fileExists(tilesetsFile);
  const hasTiles = await hasAnyTilePng(tilesRoot);

  const terrainProbe = await probeHttp(terrainUrl);
  const buildingsProbe = await probeHttp(buildingsUrl);

  const mapboxRuntimeDisabled = !process.env.MAPBOX_TOKEN && !process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  return NextResponse.json(
    {
      mode: "server-local-only",
      mapDataRoot,
      styleOwner,
      styleId,
      mapboxRuntimeDisabled,
      files: {
        styleExists,
        tilesetsExists,
        hasTiles,
        styleFile,
        tilesetsFile,
        tilesRoot,
      },
      urls: {
        streetsUrl,
        boundariesUrl,
        terrainUrl,
        buildingsUrl,
      },
      probes: {
        terrain: terrainProbe,
        buildings: buildingsProbe,
      },
      localPolicy: {
        streetsUrlIsLocal: isServerLocalUrl(streetsUrl),
        boundariesUrlIsLocal: isServerLocalUrl(boundariesUrl),
        terrainUrlIsLocal: isServerLocalUrl(terrainUrl),
        buildingsUrlIsLocal: isServerLocalUrl(buildingsUrl),
      },
    },
    { status: 200 }
  );
}
