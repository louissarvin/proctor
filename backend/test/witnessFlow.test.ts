/**
 * The witness flow, end to end, against the real database.
 *
 * This needs NEITHER USDC NOR the Selfie Check feature flag: it exercises
 * everything from a dispatched decision through to a resolved outcome and a
 * verifiable evidence record.
 */
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { prismaQuery } from '../src/lib/prisma.ts';
import { decisionHash, policyHash } from '../src/lib/attestation/hash.ts';
import {
  mintWitnessToken, mintNonce, dispatchDecision, approveDecision, refuseDecision,
} from '../src/lib/decision/lifecycle.ts';
import { selectWitness } from '../src/lib/witness/dispatch.ts';
import { hashWitnessToken } from '../src/lib/decision/lifecycle.ts';
import { verifyWitnessProof } from '../src/lib/world/verify.ts';
import { hashSignal } from '@worldcoin/idkit-core/hashing';
import { buildAttestation, classifyIndependence } from '../src/lib/attestation/build.ts';
import { DEMO_POLICY } from '../src/lib/policy/evaluate.ts';
import { issueDecision } from '../src/lib/decision/issue.ts';

const S = `wf${Date.now()}`;
let orgId = '', agentId = '', witnessId = '';
const OPERATOR_NULLIFIER = '55555555555555555555';
const WITNESS_NULLIFIER = '77777777777777777777';

beforeAll(async () => {
  const org = await prismaQuery.org.create({
    data: {
      name: 'Flow Org', slug: `flow-${S}`,
      operatorNullifier: OPERATOR_NULLIFIER, operatorEnrolledAt: new Date(),
    },
  });
  orgId = org.id;
  agentId = (await prismaQuery.agent.create({ data: { orgId, label: 'agent', uaid: `uaid:aid:${S}` } })).id;
  witnessId = (await prismaQuery.witness.create({
    data: { orgId, nullifier: WITNESS_NULLIFIER, label: 'On-call witness', role: 'standard' },
  })).id;
});
afterAll(async () => { await prismaQuery.org.delete({ where: { id: orgId } }).catch(() => {}); });

const openDecision = async () => {
  const nonce = mintNonce();
  const { token, hash } = mintWitnessToken();
  const preimage = {
    action: { kind: 'transfer', asset: 'EUR', amount: '41200.00', counterparty: 'Meridian Logistics' },
    nonce, issuedAt: new Date().toISOString(),
  };
  const d = await issueDecision(orgId, {
      agentId, state: 'OPEN',
      preimage, decisionHash: decisionHash(preimage),
      humanLine: 'Release EUR 41,200 to Meridian Logistics?',
      nonce, witnessTokenHash: hash, policyHash: policyHash(DEMO_POLICY),
      expiresAt: new Date(Date.now() + 60_000),
  });
  return { id: d.id, token, decisionHash: d.decisionHash };
};

const proofFor = (dh: string, nullifier = WITNESS_NULLIFIER) => ({
  protocol_version: '3.0',
  nonce: '0xnonce',
  action: 'proctor-witness-approval',
  // The widget requests require_user_presence, so a real device proof carries
  // this. Without it the credential proves possession of a phone, not a human.
  user_presence_completed: true,
  responses: [{
    identifier: 'device',
    signal_hash: hashSignal(dh),
    nullifier: '0x' + BigInt(nullifier).toString(16),
  }],
});

test('a witness is selected from the rota', async () => {
  const w = await selectWitness(orgId, 'standard');
  expect(w?.id).toBe(witnessId);
});

test('the token resolves to exactly one decision and is stored hashed', async () => {
  const { id, token } = await openDecision();
  const row = await prismaQuery.decision.findUnique({ where: { witnessTokenHash: hashWitnessToken(token) } });
  expect(row?.id).toBe(id);
  // The plaintext token must never be in the database.
  const raw = await prismaQuery.decision.findFirst({ where: { witnessTokenHash: token } });
  expect(raw).toBeNull();
});

test('HAPPY PATH: dispatch, verify a proof, approve, attest', async () => {
  const { id, decisionHash: dh } = await openDecision();
  expect((await dispatchDecision(id, witnessId, 60)).ok).toBe(true);

  const decision = await prismaQuery.decision.findUniqueOrThrow({ where: { id } });
  const verified = verifyWitnessProof({
    raw: proofFor(dh) as never,
    decision: { decisionHash: decision.decisionHash, expiresAt: decision.expiresAt },
    operatorNullifier: BigInt(OPERATOR_NULLIFIER),
    mode: 'DEVICE_DEV_ONLY',
    nonceValid: true,
  });
  expect(verified.ok).toBe(true);

  const approved = await approveDecision(id);
  expect(approved.ok).toBe(true);

  const att = await buildAttestation({
    decisionHash: decision.decisionHash,
    orgSeq: decision.orgSeq,
    outcome: 'APPROVE',
    agentUaid: `uaid:aid:${S}`,
    worldProofDigest: 'a'.repeat(64),
    witnessNullifier: WITNESS_NULLIFIER,
    operatorNullifier: OPERATOR_NULLIFIER,
    witnessAuth: 'proof',
    independence: classifyIndependence(true, WITNESS_NULLIFIER, OPERATOR_NULLIFIER),
    policyHash: decision.policyHash!,
    meteredMs: approved.ok ? approved.reviewMs : 0,
    reviewMs: approved.ok ? approved.reviewMs : 0,
  });
  expect(att.core.ind).toBe('crypto');
  expect(att.bodyBytes).toBeLessThanOrEqual(1024);
});

test('SECURITY: the operator cannot approve their own agent', async () => {
  const { id, decisionHash: dh } = await openDecision();
  await dispatchDecision(id, witnessId, 60);
  const decision = await prismaQuery.decision.findUniqueOrThrow({ where: { id } });

  const r = verifyWitnessProof({
    raw: proofFor(dh, OPERATOR_NULLIFIER) as never,   // operator's own nullifier
    decision: { decisionHash: decision.decisionHash, expiresAt: decision.expiresAt },
    operatorNullifier: BigInt(OPERATOR_NULLIFIER),
    mode: 'DEVICE_DEV_ONLY',
    nonceValid: true,
  });
  expect(r).toEqual({ ok: false, reason: 'witness_is_operator' });
});

test('SECURITY: a proof for another decision is rejected', async () => {
  const a = await openDecision();
  const b = await openDecision();
  await dispatchDecision(a.id, witnessId, 60);
  const decision = await prismaQuery.decision.findUniqueOrThrow({ where: { id: a.id } });

  const r = verifyWitnessProof({
    raw: proofFor(b.decisionHash) as never,           // signal bound to B, presented for A
    decision: { decisionHash: decision.decisionHash, expiresAt: decision.expiresAt },
    operatorNullifier: BigInt(OPERATOR_NULLIFIER),
    mode: 'DEVICE_DEV_ONLY',
    nonceValid: true,
  });
  expect(r).toEqual({ ok: false, reason: 'signal_mismatch' });
});

test('REFUSAL requires no proof and still produces evidence', async () => {
  const { id } = await openDecision();
  await dispatchDecision(id, witnessId, 60);
  const r = await refuseDecision(id);
  expect(r.ok).toBe(true);

  const att = await buildAttestation({
    decisionHash: (await prismaQuery.decision.findUniqueOrThrow({ where: { id } })).decisionHash,
    orgSeq: (await prismaQuery.decision.findUniqueOrThrow({ where: { id } })).orgSeq,
    outcome: 'REFUSE',
    agentUaid: `uaid:aid:${S}`,
    worldProofDigest: null,
    witnessNullifier: null,
    operatorNullifier: OPERATOR_NULLIFIER,
    witnessAuth: 'token',
    independence: 'policy',
    policyHash: policyHash(DEMO_POLICY),
    meteredMs: r.ok ? r.reviewMs : 0,
    reviewMs: r.ok ? r.reviewMs : 0,
  });
  expect(att.core.wid).toBeNull();
  expect(att.core.wa).toBe('token');
});

test('the decision hash a third party re-derives matches the stored one', async () => {
  const { id } = await openDecision();
  const d = await prismaQuery.decision.findUniqueOrThrow({ where: { id } });
  expect(decisionHash(d.preimage as Record<string, unknown>)).toBe(d.decisionHash);
});

test('every decision leaves an append-only event trail', async () => {
  const { id } = await openDecision();
  await dispatchDecision(id, witnessId, 60);
  await approveDecision(id);
  const events = await prismaQuery.decisionEvent.findMany({ where: { decisionId: id }, orderBy: { at: 'asc' } });
  expect(events.map((e) => e.kind)).toEqual(['state.DISPATCHED', 'state.APPROVED']);
});

test('a refusal reports independence, and reports it as policy', () => {
  // Regression: the REFUSE branch omitted `independence` while the response
  // schema declared it, so the field silently vanished and clients read
  // undefined. The attestation always classifies it, so the API disagreed
  // with the record on the topic.
  //
  // It is always 'policy' for a refusal: no proof means no witness nullifier
  // to compare against the operator's, and classifyIndependence requires that
  // comparison before it will say 'crypto'.
  expect(classifyIndependence(true, null, OPERATOR_NULLIFIER)).toBe('policy');
  expect(classifyIndependence(false, null, OPERATOR_NULLIFIER)).toBe('policy');
});
