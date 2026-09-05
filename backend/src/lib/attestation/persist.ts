import { prismaQuery } from '../prisma.ts';
import type { Prisma } from '../../../prisma/generated/client.js';
import { buildAttestation, classifyIndependence, type Outcome } from './build.ts';
import { policyHash } from './hash.ts';
import { submitAttestation, confirmAttestation } from '../hedera/hcs.ts';
import { hasStableNullifier } from '../world/verify.ts';
import { recordEvent, meterableMs } from '../decision/lifecycle.ts';
import { HEDERA_TOPIC_ID, HASHSCAN_BASE, WORLD_MODE, ATTEST_DISABLED } from '../../config/main-config.ts';
import { hederaConfigured } from '../hedera/client.ts';
import { DEMO_POLICY } from '../policy/evaluate.ts';

/**
 * Build, sign, submit and persist the evidence record for a resolved decision.
 *
 * Runs off the agent's critical path: the agent is released on the decision
 * outcome, not on consensus. Mirror confirmation is slower still and happens
 * afterwards.
 */
/**
 * Tests create decisions with synthetic hashes. Writing those to HCS pollutes an
 * immutable evidence log with records that can never be removed, and a full
 * verifier run then fails on hashes that were never real. Guard, do not trust
 * discipline.
 */
const isTestRun = (): boolean =>
  process.env.NODE_ENV === 'test' || Boolean(process.env.BUN_TEST) || ATTEST_DISABLED;

export async function attestDecision(decisionId: string): Promise<{ ok: boolean; reason?: string; sequenceNumber?: string }> {
  if (isTestRun()) return { ok: false, reason: 'attestation_disabled_in_test' };

  const decision = await prismaQuery.decision.findUnique({
    where: { id: decisionId },
    include: { org: true, agent: true, proof: true, attestation: true },
  });
  if (!decision) return { ok: false, reason: 'decision_not_found' };
  if (decision.attestation) return { ok: true, sequenceNumber: decision.attestation.sequenceNumber?.toString() };
  if (!decision.outcome) return { ok: false, reason: 'decision_unresolved' };
  if (decision.org.operatorNullifier === null) return { ok: false, reason: 'operator_not_enrolled' };

  // The topic has no admin key, so a junk record is permanent for everyone.
  // Orgs opt IN. isTestRun() only guards the test runner; the TTL sweeper runs
  // in a normal dev server and will happily attest leftover fixture rows.
  if (!decision.org.attestable) return { ok: false, reason: 'org_not_attestable' };

  const witnessNullifier = decision.proof?.nullifier.toFixed(0) ?? null;
  const operatorNullifier = decision.org.operatorNullifier.toFixed(0);
  const reviewMs = decision.reviewMs ?? 0;

  const built = await buildAttestation({
    decisionHash: decision.decisionHash,
    orgSeq: decision.orgSeq,
    outcome: decision.outcome as Outcome,
    agentUaid: decision.agent.uaid,
    worldProofDigest: decision.proof?.rawDigest || null,
    witnessNullifier,
    operatorNullifier,
    // A refusal is authenticated by the bearer token alone. Recording that
    // prevents the record overstating what was proven.
    witnessAuth: decision.proof ? 'proof' : 'token',
    independence: classifyIndependence(
      hasStableNullifier(
        WORLD_MODE === 'SELFIE' ? 'SELFIE' : WORLD_MODE === 'ORB' ? 'ORB_PRESENCE' : 'DEVICE_DEV_ONLY',
      ),
      witnessNullifier,
      operatorNullifier,
    ),
    policyHash: decision.policyHash ?? policyHash(DEMO_POLICY),
    meteredMs: meterableMs(decision.outcome as Outcome, reviewMs),
    reviewMs,
  });

  const row = await prismaQuery.attestation.create({
    data: {
      decisionId,
      state: 'PENDING',
      body: built.body,
      bodyBytes: built.bodyBytes,
      bodyDigest: built.bodyDigest,
      attestorSig: built.attestorSig,
      attestorAddress: built.attestorAddress,
      topicId: HEDERA_TOPIC_ID || '',
    },
  });

  if (!hederaConfigured() || !HEDERA_TOPIC_ID) {
    await recordEvent(decisionId, 'attestation.built_offline');
    return { ok: false, reason: 'hedera_not_configured' };
  }

  try {
    const receipt = await submitAttestation(built.body);
    await prismaQuery.attestation.update({
      where: { id: row.id },
      data: {
        state: 'SUBMITTED',
        sequenceNumber: BigInt(receipt.sequenceNumber),
        runningHash: receipt.runningHash,
        runningHashVersion: receipt.runningHashVersion,
        transactionId: receipt.transactionId,
        explorerUrl: `${HASHSCAN_BASE}/topic/${receipt.topicId}`,
        submittedAt: new Date(),
      },
    });
    await recordEvent(decisionId, 'attestation.submitted', { sequenceNumber: receipt.sequenceNumber });

    void confirmLater(row.id, receipt.topicId, receipt.sequenceNumber, receipt.runningHash, decisionId);
    return { ok: true, sequenceNumber: receipt.sequenceNumber };
  } catch (error) {
    await prismaQuery.attestation.update({ where: { id: row.id }, data: { state: 'FAILED' } });
    await recordEvent(decisionId, 'attestation.submit_failed', { error: String(error) });
    return { ok: false, reason: 'submit_failed' };
  }
}

/** Mirror node lags consensus by seconds, so confirmation never blocks a caller. */
async function confirmLater(
  attestationId: string, topicId: string, sequenceNumber: string,
  runningHash: string, decisionId: string,
): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const c = await confirmAttestation(topicId, sequenceNumber, runningHash);
      if (c.confirmed) {
        await prismaQuery.attestation.update({
          where: { id: attestationId },
          data: { state: 'CONFIRMED', consensusTimestamp: c.consensusTimestamp, confirmedAt: new Date() },
        });
        await recordEvent(decisionId, 'attestation.confirmed', { consensusTimestamp: c.consensusTimestamp });
        return;
      }
    } catch { /* transient mirror error; keep polling */ }
  }
  await recordEvent(decisionId, 'attestation.confirm_timeout');
}
