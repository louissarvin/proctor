import { test, expect, beforeAll, afterAll } from 'bun:test';
import { prismaQuery } from '../src/lib/prisma.ts';
import {
  scheduleRetainer, scheduleWindowIsValid, MAX_SCHEDULE_SECONDS,
} from '../src/lib/payout/retainer.ts';

const S = `rt${Date.now()}`;
let orgId = '';
let witnessId = '';
let unpaidWitnessId = '';

beforeAll(async () => {
  const org = await prismaQuery.org.create({
    data: { name: 'Retainer Co', slug: `retainer-${S}`, operatorNullifier: '111', operatorEnrolledAt: new Date() },
  });
  orgId = org.id;

  witnessId = (await prismaQuery.witness.create({
    data: { orgId, nullifier: '222', label: 'on-call', hederaAccountId: '0.0.12345' },
  })).id;

  unpaidWitnessId = (await prismaQuery.witness.create({
    data: { orgId, nullifier: '333', label: 'no payout account', hederaAccountId: null },
  })).id;
});

afterAll(async () => {
  await prismaQuery.org.delete({ where: { id: orgId } }).catch(() => {});
});

// --- the window ------------------------------------------------------------

test('a retainer in the past is refused', () => {
  // Hedera rejects it anyway, but with an error that reads like a malformed
  // timestamp rather than "you asked for yesterday".
  expect(scheduleWindowIsValid(new Date(Date.now() - 1000))).toBe(false);
});

test('a retainer beyond the long-term cap is refused', () => {
  const past = new Date(Date.now() + (MAX_SCHEDULE_SECONDS + 60) * 1000);
  expect(scheduleWindowIsValid(past)).toBe(false);
});

test('a retainer inside the window is accepted', () => {
  expect(scheduleWindowIsValid(new Date(Date.now() + 3600 * 1000))).toBe(true);
});

test('the boundary is inclusive at the cap and exclusive at zero', () => {
  const now = new Date();
  expect(scheduleWindowIsValid(new Date(now.getTime() + MAX_SCHEDULE_SECONDS * 1000), now)).toBe(true);
  expect(scheduleWindowIsValid(now, now)).toBe(false);
});

// --- the record ------------------------------------------------------------

test('an out-of-range request writes NO row', () => {
  // A row for a schedule that was never attempted would show up in
  // reconciliation as a payment we owe and cannot explain.
  return scheduleRetainer(witnessId, new Date(Date.now() - 5000)).then(async (r) => {
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('execute_at_out_of_range');
    expect(await prismaQuery.retainer.count({ where: { witnessId } })).toBe(0);
  });
});

test('a witness with no payout account is refused before any row is written', async () => {
  const r = await scheduleRetainer(unpaidWitnessId, new Date(Date.now() + 3600 * 1000));

  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toBe('witness_has_no_payout_account');
  expect(await prismaQuery.retainer.count({ where: { witnessId: unpaidWitnessId } })).toBe(0);
});

test('the obligation is RECORDED even when scheduling is disabled', async () => {
  // Under test, no schedule is created. The row must still exist and say why,
  // because an intent we dropped silently is indistinguishable from one that
  // was never formed.
  const r = await scheduleRetainer(witnessId, new Date(Date.now() + 3600 * 1000));

  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toBe('scheduling_disabled');

  const row = await prismaQuery.retainer.findFirstOrThrow({ where: { witnessId } });
  expect(row.state).toBe('FAILED');
  expect(row.failureReason).toContain('disabled');
  // The amount is still on the record: what was owed does not depend on
  // whether we managed to commit it.
  expect(BigInt(row.amountAtomic)).toBeGreaterThan(0n);
  expect(row.scheduleId).toBeNull();
});
