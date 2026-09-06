import { describe as suite, expect, test } from 'bun:test';
import { reconcile, describe, type AttestedSeq } from '../src/lib/evidence/completeness.ts';

/** Every issued number present and on the log. */
const published = (n: number): AttestedSeq[] =>
  Array.from({ length: n }, (_, i) => ({ orgSeq: i + 1, sequenceNumber: String(i + 1) }));

suite('evidence completeness', () => {
  test('a fully published log is complete', () => {
    const r = reconcile(4, published(4));
    expect(r.complete).toBe(true);
    expect(r.gaps).toEqual([]);
    expect(r.attested).toBe(4);
    expect(describe(r)).toContain('PASS');
  });

  test('THE ATTACK: a refusal suppressed before submission is caught', () => {
    // The operator never writes #2. Nothing is deleted, so the running hash
    // chain over what WAS submitted stays perfectly intact and `bun verify`
    // still prints PASS. Only the dense numbering exposes it.
    const rows = published(4).filter((a) => a.orgSeq !== 2);

    const r = reconcile(4, rows);
    expect(r.complete).toBe(false);
    expect(r.gaps).toEqual([{ orgSeq: 2, kind: 'missing' }]);
    expect(describe(r)).toContain('#2');
  });

  test('held locally but never published is reported distinctly from absent', () => {
    const rows = published(3);
    rows[1] = { orgSeq: 2, sequenceNumber: null, unpublished: true };

    expect(reconcile(3, rows).gaps).toEqual([{ orgSeq: 2, kind: 'unpublished' }]);
  });

  test('decisions still in flight are trailing, NOT gaps', () => {
    // Two issued, one resolved and attested. The second is open, not withheld.
    // Reporting it as a gap would make the check cry wolf constantly.
    const r = reconcile(2, published(1));
    expect(r.gaps).toEqual([]);
    expect(r.trailing).toEqual([2]);
    expect(r.complete).toBe(true);
  });

  test('an interior hole is still caught when a trailing run also exists', () => {
    const rows = published(4).filter((a) => a.orgSeq !== 2);
    const r = reconcile(6, rows);

    expect(r.gaps).toEqual([{ orgSeq: 2, kind: 'missing' }]);
    expect(r.trailing).toEqual([5, 6]);
  });

  test('several suppressed records are all named', () => {
    const rows = published(6).filter((a) => a.orgSeq !== 2 && a.orgSeq !== 4);
    const r = reconcile(6, rows);

    expect(r.gaps.map((g) => g.orgSeq)).toEqual([2, 4]);
    expect(describe(r)).toContain('#2');
    expect(describe(r)).toContain('#4');
  });

  test('an org that has issued nothing is complete, not broken', () => {
    const r = reconcile(0, []);
    expect(r.complete).toBe(true);
    expect(r.issued).toBe(0);
  });

  test('THE RESIDUAL WEAKNESS, asserted so it is never claimed away', () => {
    // Stopping entirely from #3 on is indistinguishable from "nothing further
    // happened". This check makes suppression loud, not impossible, and the
    // README says so. If someone ever "fixes" this into a gap, that is an
    // overclaim and this test is what stops it shipping.
    const r = reconcile(5, published(2));

    expect(r.gaps).toEqual([]);
    expect(r.trailing).toEqual([3, 4, 5]);
  });
});

suite('log-scoped range', () => {
  test('an issuer that wrote to an EARLIER log is not accused of withholding', () => {
    // After a topic migration the issuer's numbering continues, so this log
    // legitimately starts at 15. Counting 1..14 as gaps would accuse the
    // operator of suppressing records that are filed on the previous topic.
    const rows: AttestedSeq[] = [
      { orgSeq: 15, sequenceNumber: '1' },
      { orgSeq: 16, sequenceNumber: '2' },
      { orgSeq: 17, sequenceNumber: '3' },
    ];
    const r = reconcile(17, rows, 15);

    expect(r.complete).toBe(true);
    expect(r.gaps).toEqual([]);
    expect(r.from).toBe(15);
    expect(describe(r)).toContain('#15..#17');
  });

  test('a hole INSIDE the scoped range is still caught', () => {
    const r = reconcile(17, [
      { orgSeq: 15, sequenceNumber: '1' },
      { orgSeq: 17, sequenceNumber: '2' },
    ], 15);

    expect(r.complete).toBe(false);
    expect(r.gaps).toEqual([{ orgSeq: 16, kind: 'missing' }]);
  });

  test('the bound never goes below 1', () => {
    expect(reconcile(2, published(2), 0).from).toBe(1);
    expect(reconcile(2, published(2), -5).from).toBe(1);
  });
});

suite('in flight vs withheld', () => {
  test('an OPEN decision below an attested one is in flight, not a gap', () => {
    // Found live. Decisions resolve OUT OF ORDER, so an undecided number
    // routinely sits below an already-attested one. Reporting it as missing
    // evidence accuses an operator of withholding a decision nobody has made
    // yet, and made the console show FAIL whenever a decision was left open.
    const rows: AttestedSeq[] = [
      { orgSeq: 1, sequenceNumber: '1', resolved: true },
      { orgSeq: 2, sequenceNumber: null, resolved: false },
      { orgSeq: 3, sequenceNumber: '2', resolved: true },
    ];
    const r = reconcile(3, rows);

    expect(r.complete).toBe(true);
    expect(r.gaps).toEqual([]);
    expect(r.inFlight).toEqual([2]);
  });

  test('a RESOLVED decision with no record is still a gap', () => {
    // The distinction that matters: decided-but-unpublished is suppression,
    // undecided is not. It reports as `unpublished` rather than `missing`
    // because we still hold the row: we know exactly what we did not publish.
    const rows: AttestedSeq[] = [
      { orgSeq: 1, sequenceNumber: '1', resolved: true },
      { orgSeq: 2, sequenceNumber: null, resolved: true },
      { orgSeq: 3, sequenceNumber: '2', resolved: true },
    ];
    const r = reconcile(3, rows);

    expect(r.complete).toBe(false);
    expect(r.gaps).toEqual([{ orgSeq: 2, kind: 'unpublished' }]);
    expect(r.inFlight).toEqual([]);
  });

  test('a decision ROW deleted outright is reported as missing', () => {
    // orgSeq is dense from creation, so an absent row means someone removed it
    // from the index. That is its own finding, not an in-flight decision.
    const r = reconcile(3, [
      { orgSeq: 1, sequenceNumber: '1', resolved: true },
      { orgSeq: 3, sequenceNumber: '2', resolved: true },
    ]);

    expect(r.gaps).toEqual([{ orgSeq: 2, kind: 'missing' }]);
    expect(r.inFlight).toEqual([]);
  });

  test('callers that omit `resolved` keep the old meaning', () => {
    // Defaulting to resolved keeps every existing caller honest: a record with
    // no outcome information is assumed to owe the log something. Uses an
    // INTERIOR hole, because a trailing one would be excused as in flight
    // regardless of how it is classified.
    const r = reconcile(3, [
      { orgSeq: 1, sequenceNumber: '1' },
      { orgSeq: 2, sequenceNumber: null },
      { orgSeq: 3, sequenceNumber: '2' },
    ]);

    expect(r.gaps).toEqual([{ orgSeq: 2, kind: 'unpublished' }]);
    expect(r.inFlight).toEqual([]);
  });
});
