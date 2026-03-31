/**
 * @module api/test-seed/get-agent-id
 *
 * Test-only API route that resolves an agent's email address to their UUID.
 * Used by end-to-end simulation tests to look up agent IDs after seeding
 * without querying the database directly.
 *
 * Key exports:
 * - GET handler: email-to-agent-ID lookup
 *
 * Dependencies:
 * - PostgreSQL via Drizzle ORM (agents table)
 *
 * Security:
 * - Double-gated: `ENABLE_TEST_ENDPOINTS=true` AND a matching `E2E_TEST_KEY` header.
 * - Returns 404 (not 403) when test endpoints are disabled, to avoid revealing
 *   the existence of test infrastructure.
 * - Must NEVER be enabled in production.
 *
 * @see src/app/api/test-seed/wallet-fund/route.ts - companion test endpoint
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { agents } from '@/db/schema';
import {
  STATUS_OK,
  STATUS_BAD_REQUEST,
  STATUS_UNAUTHORIZED,
  STATUS_NOT_FOUND,
  STATUS_INTERNAL_ERROR,
} from '@/lib/http-status';

/**
 * GET /api/test-seed/get-agent-id?email=...
 *
 * Resolves an email address to an agent UUID for e2e test automation.
 *
 * Auth: Requires `x-e2e-test-key` header matching `E2E_TEST_KEY` env var.
 * Gate: Requires `ENABLE_TEST_ENDPOINTS=true`.
 *
 * @param request - The incoming request; reads `email` from query params and
 *   `x-e2e-test-key` from headers.
 * @returns A NextResponse with `{ agentId: string }` on success, or an error
 *   response with the appropriate HTTP status code.
 *
 * @example
 * ```ts
 * const res = await fetch("/api/test-seed/get-agent-id?email=alice@example.com", {
 *   headers: { "x-e2e-test-key": process.env.E2E_TEST_KEY },
 * });
 * const { agentId } = await res.json();
 * ```
 */
export async function GET(request: NextRequest) {
  const enableTestEndpoints = process.env.ENABLE_TEST_ENDPOINTS === "true";
  if (!enableTestEndpoints) {
    return NextResponse.json(
      { error: "Not found" },
      { status: STATUS_NOT_FOUND },
    );
  }

  const testKey = process.env.E2E_TEST_KEY;

  if (!testKey) {
    return NextResponse.json(
      { error: 'Test endpoints not enabled' },
      { status: STATUS_NOT_FOUND },
    );
  }

  const headerKey = request.headers.get('x-e2e-test-key');

  if (headerKey !== testKey) {
    return NextResponse.json(
      { error: 'Invalid test key' },
      { status: STATUS_UNAUTHORIZED },
    );
  }

  const email = request.nextUrl.searchParams.get('email');

  if (!email) {
    return NextResponse.json(
      { error: 'email query parameter is required' },
      { status: STATUS_BAD_REQUEST },
    );
  }

  try {
    const results = await db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.email, email));

    const agent = results[0];

    if (!agent) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: STATUS_NOT_FOUND },
      );
    }

    return NextResponse.json(
      { agentId: agent.id },
      { status: STATUS_OK },
    );
  } catch (error) {
    console.error('Test get-agent-id route error:', error);
    return NextResponse.json(
      { error: 'Failed to resolve agent ID' },
      { status: STATUS_INTERNAL_ERROR },
    );
  }
}
