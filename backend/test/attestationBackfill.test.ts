import { test, expect } from 'bun:test';
import { backfillOnce } from '../src/workers/attestationBackfill.ts';
import { reconcile } from '../src/lib/evidence/completeness.ts';

// The bug this worker exists for, reproduced at the level that matters:
// attestDecision is dispatched fire-and-forget, so a transient failure leaves
// a resolved decision with no attestation. Completeness reports it as
// `unpublished`, which is indistinguishable from evidence being withheld.
test('an unpublished record is a gap, and is distinguished from a deletion', () => {
  const r = reconcile(3, [
    { orgSeq: 1, sequenceNumber: '1' },
    { orgSeq: 2, sequenceNumber: null }, // row written, HCS submit failed
    { orgSeq: 3, sequenceNumber: '3' },
  ]);
  expect(r.complete).toBe(false);
  expect(r.gaps).toEqual([{ orgSeq: 2, kind: 'unpublished' }]);
});

test('backfill is safe to run when there is nothing to repair', async () => {
  // Under the test runner attestDecision refuses to touch the real topic, so
  // this asserts the query and guards hold, not that a write happened.
  const r = await backfillOnce();
  expect(r.repaired).toBe(0);
  expect(r.found).toBeGreaterThanOrEqual(0);
});
