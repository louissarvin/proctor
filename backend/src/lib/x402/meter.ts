import { HBAR_ASSET_ID, HEDERA_TESTNET_CAIP2 } from '@x402/hedera';
import { prismaQuery } from '../prisma.ts';
import { meterableMs } from '../decision/lifecycle.ts';
import {
  METER_RATE_USD_PER_SEC, GATE_ASSET, PAY_TO_HEDERA,
  METER_MIN_TINYBAR, METER_TINYBAR_PER_SECOND,
} from '../../config/main-config.ts';

/**
 * Price the release from real elapsed review time.
 *
 * This is the second call of the gate protocol. The first charges a fixed fee to
 * interrupt a machine; this one charges for the seconds of human attention that
 * were actually consumed. Hedera has only the `exact` scheme, so the amount is
 * computed here and settled once rather than streamed.
 *
 * The decision id must arrive in the PATH, not the body: the x402 hook runs at
 * onRequest, before Fastify parses a body, so `getBody()` is undefined here.
 */

/** Integer arithmetic only. A float drifts within a single 60s decision. */
export const meterTinybar = (reviewMs: number, outcome: 'APPROVE' | 'REFUSE' | 'EXPIRE'): bigint => {
  const billableMs = meterableMs(outcome, reviewMs);
  const perSecond = BigInt(METER_TINYBAR_PER_SECOND);
  const amount = (perSecond * BigInt(Math.max(0, billableMs))) / 1000n;
  // An expiry meters to zero, but x402 cannot quote a zero-amount payment, so
  // callers must skip the paid route entirely in that case.
  return amount < BigInt(METER_MIN_TINYBAR) ? BigInt(METER_MIN_TINYBAR) : amount;
};

export const meterUsd = (reviewMs: number, outcome: 'APPROVE' | 'REFUSE' | 'EXPIRE'): string => {
  const billableMs = meterableMs(outcome, reviewMs);
  const micros = BigInt(Math.round(Number(METER_RATE_USD_PER_SEC) * 1_000_000));
  const total = (micros * BigInt(Math.max(0, billableMs))) / 1000n;
  return `${total / 1_000_000n}.${String(total % 1_000_000n).padStart(6, '0')}`;
};

/** Extract the decision id from `/v1/gate/decisions/:id/release`. */
export const decisionIdFromPath = (path: string): string | null =>
  /\/decisions\/([^/]+)\/release/.exec(path)?.[1] ?? null;

/**
 * DynamicPrice for the release route.
 *
 * Throws rather than returning zero on any unknown state. A zero-amount accepts
 * entry is NOT rejected by the library, so a silent fallback would hand out free
 * oversight and look like a working system.
 */
export const releasePrice = async (context: { path?: string }) => {
  const decisionId = decisionIdFromPath(context.path ?? '');
  if (!decisionId) throw new Error('release price: no decision id in path');

  const decision = await prismaQuery.decision.findUnique({
    where: { id: decisionId },
    select: { outcome: true, reviewMs: true },
  });
  if (!decision?.outcome) throw new Error(`release price: decision ${decisionId} is unresolved`);

  const amount = meterTinybar(decision.reviewMs ?? 0, decision.outcome as never);
  if (amount <= 0n) throw new Error('release price: computed a non-positive amount');

  return GATE_ASSET === 'HBAR'
    ? { asset: HBAR_ASSET_ID, amount: amount.toString() }
    : `$${meterUsd(decision.reviewMs ?? 0, decision.outcome as never)}`;
};

export const releaseOption = () => ({
  scheme: 'exact',
  network: HEDERA_TESTNET_CAIP2,
  payTo: PAY_TO_HEDERA,
  price: releasePrice as never,
  maxTimeoutSeconds: 180,
});
