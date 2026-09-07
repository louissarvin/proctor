import { test, expect } from 'bun:test';
import { verifyCompleteness } from '../src/completeness.ts';

const msg = (seq: number, body: unknown) => ({
  sequence_number: seq,
  message: Buffer.from(JSON.stringify(body), 'utf8').toString('base64'),
});

/** An attestation as it appears on the topic, reduced to what this check reads. */
const att = (seq: number, sq: number, on = '111') =>
  msg(seq, { v: 1, dh: `0x${'a'.repeat(64)}`, sq: String(sq), on, out: 'APPROVE' });

test('a complete run of issuance numbers passes', () => {
  const r = verifyCompleteness([att(1, 1), att(2, 2), att(3, 3)]);
  expect(r.ok).toBe(true);
  expect(r.missing).toEqual([]);
  expect(r.found).toEqual([1, 2, 3]);
});

test('THE ATTACK: a decision withheld before submission is caught offline', () => {
  // The operator never submitted #2. Nothing was deleted, so the running hash
  // chain over what WAS submitted is perfectly intact and verifyChain passes.
  // Only the issuance numbering exposes it, and this runs against the public
  // mirror node with no access to Proctor at all.
  const r = verifyCompleteness([att(1, 1), att(2, 3), att(3, 4)]);

  expect(r.ok).toBe(false);
  expect(r.missing).toEqual([2]);
});

test('order on the topic does not matter, only the set of numbers', () => {
  // Decisions resolve out of order, so attestations land out of order too.
  // That is normal and must not read as a gap.
  const r = verifyCompleteness([att(1, 3), att(2, 1), att(3, 2)]);
  expect(r.ok).toBe(true);
});

test('messages carrying no `sq` are reported, not counted as gaps', () => {
  // Trust roots and other envelopes legitimately have no issuance number.
  const r = verifyCompleteness([msg(1, { v: 1, roots: 'published' }), att(2, 1), att(3, 2)]);

  expect(r.ok).toBe(true);
  expect(r.unnumbered).toEqual(['1']);
  expect(r.found).toEqual([1, 2]);
});

test('a topic with no attestations is not a failure', () => {
  const r = verifyCompleteness([msg(1, { roots: 'only' })]);
  expect(r.ok).toBe(true);
  expect(r.found).toEqual([]);
});

test('two records claiming one issuance number is renumbering, and fails', () => {
  const r = verifyCompleteness([att(1, 1), att(2, 2), att(3, 2)]);
  expect(r.ok).toBe(false);
  expect(r.reason).toContain('share an issuance number');
});

test('malformed or non-JSON payloads do not throw', () => {
  const junk = { sequence_number: 1, message: Buffer.from('not json at all').toString('base64') };
  const r = verifyCompleteness([junk, att(2, 1)]);

  expect(r.ok).toBe(true);
  expect(r.unnumbered).toEqual(['1']);
});

test('THE RESIDUAL WEAKNESS, asserted so it is never claimed away', () => {
  // Stopping entirely after #2 is indistinguishable from "nothing further
  // happened", because the topic cannot know what was never issued. This check
  // makes suppression loud, not impossible. If someone ever "fixes" this into a
  // failure, that is an overclaim and this test is what stops it shipping.
  const r = verifyCompleteness([att(1, 1), att(2, 2)]);
  expect(r.ok).toBe(true);
});

test('two issuers on one topic are checked SEPARATELY, not merged', () => {
  // Found by running this against the real topic. Without grouping, a second
  // org's #1 reads as a duplicate and its interleaving invents gaps, which is
  // a false accusation of withholding evidence. `sq` is dense per issuer, not
  // per topic.
  const r = verifyCompleteness([
    att(1, 1, 'orgA'), att(2, 1, 'orgB'),
    att(3, 2, 'orgA'), att(4, 2, 'orgB'),
  ]);

  expect(r.ok).toBe(true);
  expect(r.missing).toEqual([]);
  expect(r.issuers).toBe(2);
});

test('a gap in ONE issuer is still caught when another issuer is complete', () => {
  const r = verifyCompleteness([
    att(1, 1, 'orgA'), att(2, 1, 'orgB'),
    att(3, 3, 'orgA'), att(4, 2, 'orgB'),
  ]);

  expect(r.ok).toBe(false);
  expect(r.missing).toEqual([2]);
});

test('the range checked is what is VISIBLE, not an assumed start at 1', () => {
  // Records written before `sq` existed carry no issuance number, and a mirror
  // query window may not reach the first one. Claiming a gap at 1..5 in either
  // case accuses an operator of withholding records that are simply outside
  // this view. The claim is deliberately bounded to the observed range.
  const r = verifyCompleteness([att(1, 6), att(2, 7), att(3, 8)]);

  expect(r.ok).toBe(true);
  expect(r.missing).toEqual([]);
});

test('a hole INSIDE the visible range is still caught', () => {
  const r = verifyCompleteness([att(1, 6), att(2, 8)]);
  expect(r.ok).toBe(false);
  expect(r.missing).toEqual([7]);
});


test('an absent number is a QUESTION, not a verdict of suppression', () => {
  // From outside, an open decision and a suppressed one are both simply absent.
  // The checker reports the hole; it must not decide which reading is true.
  // Regression guard for the CLI wording, which used to assert "Something was
  // never written" and fired on every live run with a decision still open.
  const r = verifyCompleteness([att(1, 1), att(2, 3)]);

  expect(r.ok).toBe(false);
  expect(r.missing).toEqual([2]);
  // No field claims intent. `missing` is positional fact, nothing more.
  expect(Object.keys(r).sort()).toEqual(['found', 'issuers', 'missing', 'ok', 'reason', 'unnumbered']);
});
