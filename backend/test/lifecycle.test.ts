/**
 * Lifecycle tests run against the REAL database, because the property under
 * test is a PostgreSQL concurrency guarantee. A mock would prove nothing.
 */
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { prismaQuery } from '../src/lib/prisma.ts';
import {
  dispatchDecision, approveDecision, refuseDecision,
  expireOverdueDecisions, meterableMs, mintWitnessToken, mintNonce,
} from '../src/lib/decision/lifecycle.ts';

const SUFFIX = `t${Date.now()}`;
let orgId = '';
let agentId = '';
let witnessId = '';

beforeAll(async () => {
  const org = await prismaQuery.org.create({
    data: { name: 'Test Org', slug: `test-${SUFFIX}`, operatorNullifier: '12345', operatorEnrolledAt: new Date() },
  });
  orgId = org.id;
  agentId = (await prismaQuery.agent.create({
    data: { orgId, label: 'test agent', uaid: `uaid:aid:${SUFFIX}` },
  })).id;
  witnessId = (await prismaQuery.witness.create({
    data: { orgId, nullifier: '67890', label: 'test witness' },
  })).id;
});

afterAll(async () => {
  await prismaQuery.org.delete({ where: { id: orgId } }).catch(() => {});
});

/** A decision already in OPEN, ready to dispatch. */
const makeDecision = async (): Promise<string> => {
  const { hash } = mintWitnessToken();
  const nonce = mintNonce();
  const d = await prismaQuery.decision.create({
    data: {
      orgId, agentId, state: 'OPEN',
      preimage: { action: 'transfer', amount: '41200.00' },
      decisionHash: `0x${nonce}${'0'.repeat(64 - nonce.length)}`,
      humanLine: 'Release EUR 41,200 to Meridian Logistics?',
      nonce, witnessTokenHash: hash,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  return d.id;
};

test('dispatch starts the clock from the SERVER, once', async () => {
  const id = await makeDecision();
  const r = await dispatchDecision(id, witnessId, 60);
  expect(r.ok).toBe(true);

  const d = await prismaQuery.decision.findUniqueOrThrow({ where: { id } });
  expect(d.state).toBe('DISPATCHED');
  expect(d.dispatchedAt).not.toBeNull();
  const ttl = d.expiresAt.getTime() - d.dispatchedAt!.getTime();
  expect(ttl).toBe(60_000);
});

test('approve inside the TTL succeeds and records reviewMs', async () => {
  const id = await makeDecision();
  await dispatchDecision(id, witnessId, 60);
  const r = await approveDecision(id);
  expect(r.ok).toBe(true);

  const d = await prismaQuery.decision.findUniqueOrThrow({ where: { id } });
  expect(d.state).toBe('APPROVED');
  expect(d.outcome).toBe('APPROVE');
  expect(d.reviewMs).toBeGreaterThanOrEqual(0);
});

test('SECURITY: second 61 is a hard refuse', async () => {
  const id = await makeDecision();
  await dispatchDecision(id, witnessId, 60);
  // Force the deadline into the past, as if 61 seconds had elapsed.
  await prismaQuery.decision.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });

  const r = await approveDecision(id);
  expect(r.ok).toBe(false);
  expect(await prismaQuery.decision.findUniqueOrThrow({ where: { id } }).then(d => d.state)).toBe('DISPATCHED');
});

test('FAIL CLOSED: the sweeper resolves an overdue decision to EXPIRED', async () => {
  const id = await makeDecision();
  await dispatchDecision(id, witnessId, 60);
  await prismaQuery.decision.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });

  const expired = await expireOverdueDecisions();
  expect(expired).toContain(id);

  const d = await prismaQuery.decision.findUniqueOrThrow({ where: { id } });
  expect(d.state).toBe('EXPIRED');
  expect(d.outcome).toBe('EXPIRE');
  // Written explicitly: a null here makes a downstream meter throw mid-demo.
  expect(d.reviewMs).not.toBeNull();
});

test('the sweeper ignores decisions still inside their TTL', async () => {
  const id = await makeDecision();
  await dispatchDecision(id, witnessId, 60);
  expect(await expireOverdueDecisions()).not.toContain(id);
  expect(await prismaQuery.decision.findUniqueOrThrow({ where: { id } }).then(d => d.state)).toBe('DISPATCHED');
});

test('a resolved decision cannot be resolved again', async () => {
  const id = await makeDecision();
  await dispatchDecision(id, witnessId, 60);
  expect((await approveDecision(id)).ok).toBe(true);

  const second = await approveDecision(id);
  expect(second.ok).toBe(false);
  if (!second.ok) expect(second.reason).toBe('already_resolved');
  expect((await refuseDecision(id)).ok).toBe(false);
});

test('THE RACE: approve vs sweep, both directions, exactly one wins every time', async () => {
  // The property the whole gate rests on. Both writers fire at the same row.
  // Postgres READ COMMITTED re-evaluates the WHERE clause after blocking, so
  // the loser matches zero rows. No transaction, no lock, no Redis.
  //
  // Three regimes, so we prove BOTH failure directions, not just fail-closed:
  //   past   -> the sweeper must win (fail closed)
  //   future -> the approver must win (a valid approval is never stolen)
  //   knife  -> either may win, but never both and never neither
  const run = async (offsetMs: number) => {
    const id = await makeDecision();
    await dispatchDecision(id, witnessId, 60);
    await prismaQuery.decision.update({
      where: { id }, data: { expiresAt: new Date(Date.now() + offsetMs) },
    });

    const [approve, swept] = await Promise.all([approveDecision(id), expireOverdueDecisions()]);
    const approverWon = approve.ok;
    const sweeperWon = swept.includes(id);

    // THE INVARIANT: never both, never neither.
    expect(approverWon && sweeperWon).toBe(false);
    expect(approverWon || sweeperWon).toBe(true);

    const d = await prismaQuery.decision.findUniqueOrThrow({ where: { id } });
    expect(d.outcome).toBe(approverWon ? 'APPROVE' : 'EXPIRE');
    expect(d.state).toBe(approverWon ? 'APPROVED' : 'EXPIRED');
    return approverWon;
  };

  // 1. Already overdue: the sweeper MUST win. Fail closed.
  for (let i = 0; i < 15; i++) expect(await run(-50)).toBe(false);

  // 2. Comfortably inside the TTL: the approver MUST win. A valid approval is
  //    never stolen by a sweeper that happens to run at the same moment.
  for (let i = 0; i < 15; i++) expect(await run(5_000)).toBe(true);

  // 3. Knife edge: either outcome is legitimate, the invariant must still hold.
  let approver = 0, sweeper = 0;
  for (let i = 0; i < 20; i++) (await run(0)) ? approver++ : sweeper++;
  expect(approver + sweeper).toBe(20);
  console.log(`    knife-edge: approver ${approver}, sweeper ${sweeper} (both legitimate)`);
}, 90_000);

test('every transition is written to the append-only event log', async () => {
  const id = await makeDecision();
  await dispatchDecision(id, witnessId, 60);
  await approveDecision(id);

  const events = await prismaQuery.decisionEvent.findMany({ where: { decisionId: id }, orderBy: { at: 'asc' } });
  expect(events.map(e => e.kind)).toEqual(['state.DISPATCHED', 'state.APPROVED']);
});

test('METERING POLICY: an expiry meters to zero, an answer does not', () => {
  // Decided once. The agent paid a fixed fee to interrupt a machine; it
  // consumed no human attention, so it owes nothing for attention.
  expect(meterableMs('EXPIRE', 60_000)).toBe(0);
  expect(meterableMs('APPROVE', 6_412)).toBe(6_412);
  expect(meterableMs('REFUSE', 2_100)).toBe(2_100);
});

test('witness tokens are opaque, unique, and stored hashed', async () => {
  const a = mintWitnessToken();
  const b = mintWitnessToken();
  expect(a.token).not.toBe(b.token);
  expect(a.hash).not.toBe(a.token);          // never stored in the clear
  expect(a.hash).toMatch(/^[0-9a-f]{64}$/);  // sha256
});
