/**
 * @module api/test-seed/wallet-fund
 *
 * Test-only API route that directly credits an agent's wallet balance,
 * bypassing the normal Stripe payment flow. Used by e2e simulation tests
 * to set up wallet balances for purchase and marketplace scenarios.
 *
 * The endpoint performs three database operations:
 * 1. Gets or creates a personal wallet for the agent.
 * 2. Atomically increments the wallet balance.
 * 3. Inserts a wallet transaction record and ledger entry for auditability.
 *
 * Key exports:
 * - POST handler: wallet funding
 *
 * Dependencies:
 * - PostgreSQL via Drizzle ORM (wallets, walletTransactions, ledger tables)
 *
 * Security:
 * - Double-gated: `ENABLE_TEST_ENDPOINTS=true` AND a matching `E2E_TEST_KEY` header.
 * - Returns 404 (not 403) when disabled to hide test infrastructure.
 * - Must NEVER be enabled in production -- allows arbitrary balance injection.
 *
 * @see src/app/api/test-seed/get-agent-id/route.ts - companion test endpoint
 * @see src/app/api/wallet/deposit/route.ts - production wallet funding via Stripe
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '@/db';
import { wallets, walletTransactions, ledger } from '@/db/schema';
import {
  STATUS_OK,
  STATUS_BAD_REQUEST,
  STATUS_UNAUTHORIZED,
  STATUS_NOT_FOUND,
  STATUS_INTERNAL_ERROR,
} from '@/lib/http-status';

/**
 * POST /api/test-seed/wallet-fund
 *
 * Directly credits an agent's wallet for e2e test automation, bypassing Stripe.
 *
 * Auth: Requires `x-e2e-test-key` header matching `E2E_TEST_KEY` env var.
 * Gate: Requires `ENABLE_TEST_ENDPOINTS=true`.
 *
 * Request body:
 * - `agentId` (string, required): UUID of the agent whose wallet to fund.
 * - `amountCents` (number, required): Positive integer amount in cents to credit.
 *
 * @param request - The incoming POST request with JSON body and test key header.
 * @returns A NextResponse with `{ success: true, walletId: string }` on success,
 *   or an error response with the appropriate HTTP status code.
 *
 * @example
 * ```ts
 * const res = await fetch("/api/test-seed/wallet-fund", {
 *   method: "POST",
 *   headers: {
 *     "Content-Type": "application/json",
 *     "x-e2e-test-key": process.env.E2E_TEST_KEY,
 *   },
 *   body: JSON.stringify({ agentId: "uuid-here", amountCents: 5000 }),
 * });
 * const { walletId } = await res.json();
 * ```
 */
export async function POST(request: NextRequest) {
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

  let body: { agentId?: unknown; amountCents?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: STATUS_BAD_REQUEST },
    );
  }

  const { agentId, amountCents } = body as { agentId?: string; amountCents?: number };

  if (!agentId || typeof agentId !== 'string') {
    return NextResponse.json(
      { error: 'agentId is required and must be a string' },
      { status: STATUS_BAD_REQUEST },
    );
  }

  if (!amountCents || typeof amountCents !== 'number' || !Number.isInteger(amountCents) || amountCents <= 0) {
    return NextResponse.json(
      { error: 'amountCents is required and must be a positive integer' },
      { status: STATUS_BAD_REQUEST },
    );
  }

  try {
    // Get or create a personal wallet for the agent. Each agent has at most one
    // personal wallet; organization wallets are separate and not created here.
    const existingWallets = await db
      .select()
      .from(wallets)
      .where(and(eq(wallets.ownerId, agentId), eq(wallets.type, 'personal')));

    let wallet = existingWallets[0];

    if (!wallet) {
      const inserted = await db
        .insert(wallets)
        .values({
          ownerId: agentId,
          type: 'personal',
          balanceCents: 0,
          currency: 'usd',
        })
        .returning();

      wallet = inserted[0];
    }

    // Atomically increment the wallet balance using SQL addition to avoid
    // race conditions from concurrent funding requests.
    await db
      .update(wallets)
      .set({
        balanceCents: sql`${wallets.balanceCents} + ${amountCents}`,
        updatedAt: new Date(),
      })
      .where(eq(wallets.id, wallet.id));

    // Record a wallet transaction for the deposit. Uses 'stripe_deposit' type
    // to match the production schema, even though no actual Stripe charge occurred.
    await db.insert(walletTransactions).values({
      type: 'stripe_deposit',
      toWalletId: wallet.id,
      amountCents,
      currency: 'usd',
      description: 'E2E simulation test deposit',
      status: 'completed',
    });

    // Write a ledger entry for the fund verb so the activity feed and
    // audit trail correctly reflect this balance change.
    await db.insert(ledger).values({
      verb: 'fund',
      subjectId: agentId,
      objectId: wallet.id,
      objectType: 'wallet',
      metadata: { source: 'e2e-simulation', amountCents },
    });

    return NextResponse.json(
      { success: true, walletId: wallet.id },
      { status: STATUS_OK },
    );
  } catch (error) {
    console.error('Test wallet-fund route error:', error);
    return NextResponse.json(
      { error: 'Failed to fund wallet' },
      { status: STATUS_INTERNAL_ERROR },
    );
  }
}
