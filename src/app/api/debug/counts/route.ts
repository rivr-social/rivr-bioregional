/**
 * @module api/debug/counts
 *
 * Debug API route that returns aggregate entity counts from the database.
 * Intended for development and test environments to verify data seeding
 * and entity creation without inspecting the database directly.
 *
 * Key exports:
 * - GET handler: returns a breakdown of agents and resources by type.
 *
 * Dependencies:
 * - PostgreSQL via Drizzle ORM (raw SQL for multi-count aggregation)
 * - NextAuth session for authentication
 *
 * Security:
 * - Gated behind `ENABLE_TEST_ENDPOINTS=true` environment variable.
 * - Requires an authenticated session (any logged-in user).
 * - Should NEVER be enabled in production to prevent data enumeration.
 *
 * @see src/app/api/test-seed/ - related test-only endpoints
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { agents } from "@/db/schema";
import { sql, eq } from "drizzle-orm";
import {
  STATUS_OK,
  STATUS_UNAUTHORIZED,
  STATUS_FORBIDDEN,
  STATUS_INTERNAL_ERROR,
  STATUS_NOT_FOUND,
} from "@/lib/http-status";

/**
 * GET /api/debug/counts
 *
 * Returns a comprehensive breakdown of entity counts across the database,
 * including agents by type (person, organization, place, event, project),
 * domain-specific counts (basins, locales, councils), and resources by type
 * (event, project, group, asset/place/venue).
 *
 * Only active (non-deleted) records are counted.
 *
 * Auth: Requires an authenticated session.
 * Gate: Requires `ENABLE_TEST_ENDPOINTS=true`.
 *
 * @returns A NextResponse with `{ ok: true, timestamp, counts }` on success,
 *   or an error response with appropriate HTTP status.
 *
 * @example
 * ```ts
 * const res = await fetch("/api/debug/counts");
 * const { counts } = await res.json();
 * // counts.agents_total, counts.events_resources, etc.
 * ```
 */
export async function GET() {
  const enableTestEndpoints = process.env.ENABLE_TEST_ENDPOINTS === "true";
  if (!enableTestEndpoints) {
    return NextResponse.json(
      { error: "Not found" },
      { status: STATUS_NOT_FOUND }
    );
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: STATUS_UNAUTHORIZED }
    );
  }

  // Admin role check: only platform admins can view debug counts.
  const [agent] = await db
    .select({ metadata: agents.metadata })
    .from(agents)
    .where(eq(agents.id, session.user.id))
    .limit(1);

  const agentMeta =
    agent?.metadata && typeof agent.metadata === "object" && !Array.isArray(agent.metadata)
      ? (agent.metadata as Record<string, unknown>)
      : {};

  if (agentMeta.siteRole !== "admin") {
    return NextResponse.json(
      { error: "Forbidden: admin privileges required" },
      { status: STATUS_FORBIDDEN }
    );
  }

  try {
    const [row] = await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM agents WHERE deleted_at IS NULL) AS agents_total,
        (SELECT COUNT(*)::int FROM resources WHERE deleted_at IS NULL) AS resources_total,

        (SELECT COUNT(*)::int FROM agents WHERE deleted_at IS NULL AND type = 'person') AS people_agents,
        (SELECT COUNT(*)::int FROM agents WHERE deleted_at IS NULL AND type = 'organization') AS organization_agents,
        (SELECT COUNT(*)::int FROM agents WHERE deleted_at IS NULL AND type = 'place') AS place_agents_legacy,
        (SELECT COUNT(*)::int FROM agents WHERE deleted_at IS NULL AND type = 'event') AS event_agents_legacy,
        (SELECT COUNT(*)::int FROM agents WHERE deleted_at IS NULL AND type = 'project') AS project_agents_legacy,

        (SELECT COUNT(*)::int FROM agents WHERE deleted_at IS NULL AND metadata->>'placeType' = 'basin') AS basins,
        (SELECT COUNT(*)::int FROM agents WHERE deleted_at IS NULL AND metadata->>'placeType' = 'chapter') AS locales,
        (SELECT COUNT(*)::int FROM agents WHERE deleted_at IS NULL AND metadata->>'placeType' = 'council') AS councils,
        (SELECT COUNT(*)::int FROM agents WHERE deleted_at IS NULL AND COALESCE(metadata->>'groupType', '') <> '') AS groups_with_groupType,

        (SELECT COUNT(*)::int FROM resources WHERE deleted_at IS NULL AND type = 'event') AS events_resources,
        (SELECT COUNT(*)::int FROM resources WHERE deleted_at IS NULL AND type = 'project') AS projects_resources,
        (SELECT COUNT(*)::int FROM resources WHERE deleted_at IS NULL AND type = 'group') AS groups_resources,
        (SELECT COUNT(*)::int FROM resources WHERE deleted_at IS NULL AND type = 'asset') AS places_resources,
        (SELECT COUNT(*)::int FROM resources WHERE deleted_at IS NULL AND metadata->>'resourceKind' = 'place') AS places_resourceKind_place,
        (SELECT COUNT(*)::int FROM resources WHERE deleted_at IS NULL AND metadata->>'resourceKind' = 'venue') AS venues_resourceKind_venue
    `);

    return NextResponse.json(
      {
        ok: true,
        timestamp: new Date().toISOString(),
        counts: row,
      },
      { status: STATUS_OK }
    );
  } catch (error) {
    console.error("[debug/counts] failed:", error);
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to fetch debug counts",
      },
      { status: STATUS_INTERNAL_ERROR }
    );
  }
}
