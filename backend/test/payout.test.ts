import { test, expect, beforeAll, afterAll } from 'bun:test';
import { prismaQuery } from '../src/lib/prisma.ts';
import { payWitness } from '../src/lib/payout/witness.ts';
import { meterTinybar, meterUsd } from '../src/lib/x402/meter.ts';
import { mintWitnessToken, mintNonce, approveDecision, dispatchDecision } from '../src/lib/decision/lifecycle.ts';
import { decisionHash } from '../src/lib/attestation/hash.ts';
import { issueDecision } from '../src/lib/decision/issue.ts';
import { proctorAgentUaid } from '../src/lib/attestation/uaid.ts';

const S = `po${Date.now()}`;
let orgId = '';
let agentId = '';
let witnessId = '';

beforeAll(async () => {
  const org = await prismaQuery.org.create({
    data: { name: 'Payout Co', slug: `payout-${S}`, operatorNullifier: '111', operatorEnrolledAt: new Date() },
  });
  orgId = org.id;

  const agent = await prismaQuery.agent.create({
    data: { orgId, label: 'agent', uaid: proctorAgentUaid(`0.0.${Date.now() % 100000}`, 'testnet') },
  });
  agentId = agent.id;

  const w = await prismaQuery.witness.create({
    data: { orgId, nullifier: '222', label: 'on-call', hederaAccountId: '0.0.12345' },
  });
  witnessId = w.id;
});

afterAll(async () => {
  await prismaQuery.org.delete({ where: { id: orgId } }).catch(() => {});
});

/** A resolved, approved decision with real elapsed review time. */
const resolved = async (reviewMs = 6000) => {
  const nonce = mintNonce();
  const { hash } = mintWitnessToken();
  const preimage = { action: 'transfer', amount: '41200.00', nonce };

  const d = await issueDecision(orgId, {
    agentId,
    state: 'OPEN',
    preimage,
    decisionHash: decisionHash(preimage),
    humanLine: 'Release EUR 41,200?',
    nonce,
    witnessTokenHash: hash,
    expiresAt: new Date(Date.now() + 60_000),
  });

  await dispatchDecision(d.id, witnessId, 60);
  // Backdate the dispatch so the meter has real seconds to bill for.
  await prismaQuery.decision.update({
    where: { id: d.id },
    data: { dispatchedAt: new Date(Date.now() - reviewMs) },
  });
  await approveDecision(d.id);
  return d.id;
};

test('the witness is owed the metered amount, not a flat fee', async () => {
  const id = await resolved(6000);
  await payWitness(id);

  const p = await prismaQuery.payment.findFirstOrThrow({
    where: { decisionId: id, leg: 'WITNESS_FEE' },
  });

  const d = await prismaQuery.decision.findUniqueOrThrow({ where: { id } });
  expect(p.amountAtomic).toBe(meterTinybar(d.reviewMs!, 'APPROVE').toString());
  expect(p.amountUsd.toString()).toBe(meterUsd(d.reviewMs!, 'APPROVE'));
  expect(p.witnessId).toBe(witnessId);
});

test('IDEMPOTENT: a second call cannot pay the same witness twice', async () => {
  const id = await resolved();
  await payWitness(id);
  const second = await payWitness(id);

  expect(second.ok).toBe(false);
  if (!second.ok) expect(second.reason).toBe('already_paid');

  // The DB constraint is the real guard, so assert on rows rather than on the
  // return value: a caller that ignores the result must still not double-pay.
  const rows = await prismaQuery.payment.findMany({ where: { decisionId: id, leg: 'WITNESS_FEE' } });
  expect(rows).toHaveLength(1);
});

test('CONCURRENT: racing calls still produce exactly one payment', async () => {
  const id = await resolved();
  await Promise.all([payWitness(id), payWitness(id), payWitness(id)]);

  const rows = await prismaQuery.payment.findMany({ where: { decisionId: id, leg: 'WITNESS_FEE' } });
  expect(rows).toHaveLength(1);
});

test('a REFUSAL is paid too', async () => {
  // Paying only for approvals would price the witness to say yes. The whole
  // product depends on refusing being as economically comfortable as approving.
  const nonce = mintNonce();
  const { hash } = mintWitnessToken();
  const preimage = { action: 'transfer', amount: '9', nonce };
  const d = await issueDecision(orgId, {
    agentId, state: 'OPEN', preimage,
    decisionHash: decisionHash(preimage),
    humanLine: 'Release?', nonce, witnessTokenHash: hash,
    expiresAt: new Date(Date.now() + 60_000),
  });
  await dispatchDecision(d.id, witnessId, 60);
  await prismaQuery.decision.update({
    where: { id: d.id }, data: { dispatchedAt: new Date(Date.now() - 5000) },
  });
  const { refuseDecision } = await import('../src/lib/decision/lifecycle.ts');
  await refuseDecision(d.id);

  await payWitness(d.id);
  const p = await prismaQuery.payment.findFirstOrThrow({ where: { decisionId: d.id, leg: 'WITNESS_FEE' } });
  expect(BigInt(p.amountAtomic)).toBeGreaterThan(0n);
});

test('an unresolved decision is not paid', async () => {
  const nonce = mintNonce();
  const { hash } = mintWitnessToken();
  const preimage = { action: 'transfer', amount: '1', nonce };
  const d = await issueDecision(orgId, {
    agentId, state: 'OPEN', preimage,
    decisionHash: decisionHash(preimage),
    humanLine: 'Release?', nonce, witnessTokenHash: hash,
    expiresAt: new Date(Date.now() + 60_000),
  });

  const r = await payWitness(d.id);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toBe('decision_unresolved');
  expect(await prismaQuery.payment.count({ where: { decisionId: d.id } })).toBe(0);
});

test('a witness with no payout account is recorded as OWED, never silently skipped', async () => {
  // The fee was earned. Dropping it because onboarding is incomplete would let
  // an org quietly consume human attention for free.
  const w = await prismaQuery.witness.create({
    data: { orgId, nullifier: '333', label: 'unpaid', hederaAccountId: null },
  });

  const nonce = mintNonce();
  const { hash } = mintWitnessToken();
  const preimage = { action: 'transfer', amount: '2', nonce };
  const d = await issueDecision(orgId, {
    agentId, state: 'OPEN', preimage,
    decisionHash: decisionHash(preimage),
    humanLine: 'Release?', nonce, witnessTokenHash: hash,
    expiresAt: new Date(Date.now() + 60_000),
  });
  await dispatchDecision(d.id, w.id, 60);
  await approveDecision(d.id);

  const r = await payWitness(d.id);
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.reason).toBe('witness_has_no_payout_account');
    expect(r.recorded).toBe(true);
  }

  const p = await prismaQuery.payment.findFirstOrThrow({ where: { decisionId: d.id, leg: 'WITNESS_FEE' } });
  expect(p.state).toBe('FAILED');
  expect(BigInt(p.amountAtomic)).toBeGreaterThan(0n);
});
