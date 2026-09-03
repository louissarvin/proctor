/**
 * The decision state machine.
 *
 * WHY EVERY TRANSITION IS A SINGLE CONDITIONAL updateMany
 * ------------------------------------------------------
 * Two writers race for every decision: the witness approving, and the TTL
 * sweeper expiring. Exactly one must win, and the loser must find out.
 *
 * PostgreSQL READ COMMITTED gives us that for free (verified against the
 * official docs, and this database reports `read committed`):
 *
 *   "the would-be updater will wait for the first updating transaction to
 *    commit or roll back ... The search condition of the command (the WHERE
 *    clause) is re-evaluated to see if the updated version of the row still
 *    matches the search condition."
 *
 * So `UPDATE ... WHERE state = 'DISPATCHED'` blocks behind a concurrent
 * writer, re-reads the row, sees the new state, no longer matches, and reports
 * 0 rows affected. count === 0 IS the "you lost the race" signal.
 *
 * No transactions, no SELECT FOR UPDATE, no advisory locks, no Redis. Adding
 * any of them would only add failure modes to a nine-day build.
 *
 * FAIL CLOSED
 * -----------
 * The default outcome is EXPIRE, and EXPIRE never releases the agent. If
 * Proctor is down, agents stay blocked. An oversight gate that fails open is
 * worse than no gate at all, because it manufactures evidence of oversight
 * that did not happen.
 */
import crypto from 'node:crypto';
import { prismaQuery } from '../prisma.ts';
import type { Prisma } from '../../../prisma/generated/client.js';
import { DECISION_TTL_SECONDS } from '../../config/main-config.ts';

export type TransitionResult =
  | { ok: true; reviewMs: number }
  | { ok: false; reason: 'already_resolved' | 'not_found' | 'expired' };

/** Opaque bearer token for the push deep link. Hashed at rest. */
export const mintWitnessToken = (): { token: string; hash: string } => {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: hashWitnessToken(token) };
};

export const hashWitnessToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');

/** Single-use randomness inside the preimage. Makes two identical actions distinct. */
export const mintNonce = (): string => crypto.randomBytes(16).toString('hex');

/** Append to the event log. Never throws into the caller's path. */
export const recordEvent = async (
  decisionId: string,
  kind: string,
  detail?: Record<string, unknown>,
): Promise<void> => {
  try {
    // Prisma's InputJsonValue does not accept a bare Record under strict mode.
    const payload = detail === undefined ? undefined : (detail as Prisma.InputJsonValue);
    await prismaQuery.decisionEvent.create({ data: { decisionId, kind, detail: payload } });
  } catch (error) {
    console.error('[lifecycle] failed to record event', kind, error);
  }
};

/**
 * OPEN -> DISPATCHED. Starts the clock.
 *
 * expiresAt is computed HERE, from the server clock, once. Every later TTL
 * judgement is made against this stored value, never against a client
 * timestamp and never against a recomputed "now + ttl".
 */
export const dispatchDecision = async (
  decisionId: string,
  witnessId: string,
  ttlSeconds: number = DECISION_TTL_SECONDS,
): Promise<TransitionResult> => {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

  const { count } = await prismaQuery.decision.updateMany({
    where: { id: decisionId, state: 'OPEN' },
    data: { state: 'DISPATCHED', witnessId, dispatchedAt: now, expiresAt },
  });

  if (count === 0) return { ok: false, reason: 'already_resolved' };
  await recordEvent(decisionId, 'state.DISPATCHED', { witnessId, expiresAt: expiresAt.toISOString() });
  return { ok: true, reviewMs: 0 };
};

/**
 * DISPATCHED -> APPROVED | REFUSED.
 *
 * The `expiresAt: { gt: now }` predicate is what makes second 61 a hard
 * refuse. It is evaluated by Postgres inside the same statement that performs
 * the write, so there is no window between checking and acting.
 */
const resolve = async (
  decisionId: string,
  outcome: 'APPROVE' | 'REFUSE',
): Promise<TransitionResult> => {
  const now = new Date();

  const current = await prismaQuery.decision.findUnique({
    where: { id: decisionId },
    select: { dispatchedAt: true, state: true },
  });
  if (!current) return { ok: false, reason: 'not_found' };

  const reviewMs = current.dispatchedAt ? now.getTime() - current.dispatchedAt.getTime() : 0;

  const { count } = await prismaQuery.decision.updateMany({
    where: { id: decisionId, state: 'DISPATCHED', expiresAt: { gt: now } },
    data: {
      state: outcome === 'APPROVE' ? 'APPROVED' : 'REFUSED',
      outcome,
      respondedAt: now,
      reviewMs,
    },
  });

  if (count === 0) {
    // Either the sweeper expired it, or it was already answered. Both are
    // "you lost", and both must be reported rather than retried.
    return { ok: false, reason: current.state === 'DISPATCHED' ? 'expired' : 'already_resolved' };
  }

  await recordEvent(decisionId, `state.${outcome === 'APPROVE' ? 'APPROVED' : 'REFUSED'}`, { reviewMs });
  return { ok: true, reviewMs };
};

export const approveDecision = (id: string) => resolve(id, 'APPROVE');
export const refuseDecision = (id: string) => resolve(id, 'REFUSE');

/**
 * DISPATCHED -> EXPIRED, for every decision past its deadline.
 *
 * This is the sweeper's ONLY query, and @@index([state, expiresAt]) exists for
 * it specifically.
 *
 * reviewMs is written explicitly. Leaving it null means a downstream meter
 * computes a price from `undefined` and throws mid-demo.
 */
export const expireOverdueDecisions = async (now: Date = new Date()): Promise<string[]> => {
  const overdue = await prismaQuery.decision.findMany({
    where: { state: 'DISPATCHED', expiresAt: { lte: now } },
    select: { id: true, dispatchedAt: true, expiresAt: true },
  });
  if (overdue.length === 0) return [];

  const expired: string[] = [];
  for (const d of overdue) {
    const reviewMs = d.dispatchedAt ? d.expiresAt.getTime() - d.dispatchedAt.getTime() : 0;
    const { count } = await prismaQuery.decision.updateMany({
      where: { id: d.id, state: 'DISPATCHED', expiresAt: { lte: now } },
      data: { state: 'EXPIRED', outcome: 'EXPIRE', respondedAt: now, reviewMs },
    });
    if (count > 0) {
      expired.push(d.id);
      await recordEvent(d.id, 'state.EXPIRED', { reviewMs, sweptAt: now.toISOString() });
    }
    // count === 0 means a witness answered first. Correct, and not an error.
  }
  return expired;
};

/**
 * Milliseconds the agent is billed for.
 *
 * DECIDED ONCE, AND THIS IS THE ONLY PLACE IT IS DECIDED: an expiry meters to
 * ZERO. The agent paid a fixed fee to interrupt a machine; it consumed no
 * human attention, so it owes nothing for attention. reviewMs still records
 * what really elapsed, because the evidence should be factual even where the
 * bill is zero.
 */
export const meterableMs = (outcome: 'APPROVE' | 'REFUSE' | 'EXPIRE', reviewMs: number): number =>
  outcome === 'EXPIRE' ? 0 : reviewMs;
