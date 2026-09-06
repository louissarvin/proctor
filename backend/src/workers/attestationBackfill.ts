/**
 * Re-attests resolved decisions whose evidence record never reached HCS.
 *
 * attestDecision is dispatched fire-and-forget from the respond route and the
 * TTL sweeper, so the agent is never blocked on consensus. The cost is that a
 * transient failure -- a restart mid-submit, a mirror timeout, a network blip
 * -- drops that record permanently. Nothing retries it, and the gap is only
 * ever noticed by the completeness check, which reports it as `unpublished`.
 *
 * That gap is indistinguishable, to an auditor, from evidence being withheld.
 * This makes it self-healing instead.
 */
import nodeCron from 'node-cron';
import { attestDecision } from '../lib/attestation/persist.ts';
import { prismaQuery } from '../lib/prisma.ts';

/** Long enough that a normal in-flight attestation is never treated as failed. */
const GRACE_MS = 60_000;
const BATCH = 25;

let isRunning = false;

export const backfillOnce = async (): Promise<{ found: number; repaired: number }> => {
  const stale = await prismaQuery.decision.findMany({
    where: {
      outcome: { not: null },
      attestation: null,
      updatedAt: { lt: new Date(Date.now() - GRACE_MS) },
      org: { attestable: true, operatorNullifier: { not: null } },
    },
    select: { id: true, orgSeq: true },
    orderBy: { orgSeq: 'asc' },
    take: BATCH,
  });
  if (stale.length === 0) return { found: 0, repaired: 0 };

  let repaired = 0;
  for (const d of stale) {
    try {
      const r = await attestDecision(d.id);
      if (r.ok) {
        repaired++;
        console.log(`[AttestBackfill] repaired orgSeq ${d.orgSeq} -> HCS seq ${r.sequenceNumber}`);
      } else {
        // Not an error: a permanently ineligible row (unresolved, org opted
        // out) is reported once per tick rather than retried into a loop.
        console.warn(`[AttestBackfill] orgSeq ${d.orgSeq} not attestable: ${r.reason}`);
      }
    } catch (error) {
      console.error(`[AttestBackfill] orgSeq ${d.orgSeq} failed, will retry next tick:`, error);
    }
  }
  return { found: stale.length, repaired };
};

export const startAttestationBackfill = (): void => {
  console.log('[AttestBackfill] Scheduled: every 60s (evidence log self-heals)');
  nodeCron.schedule('0 * * * * *', async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      await backfillOnce();
    } catch (error) {
      console.error('[AttestBackfill] Error:', error);
    } finally {
      isRunning = false;
    }
  });
};
