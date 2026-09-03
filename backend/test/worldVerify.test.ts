import { test, expect } from 'bun:test';
import { hashSignal } from '@worldcoin/idkit-core/hashing';
import {
  verifyWitnessProof, parseNullifier, hasStableNullifier,
  type VerifyInput, type ProofResult,
} from '../src/lib/world/verify.ts';
import { mintRpSignature } from '../src/lib/world/rp.ts';

const DECISION_HASH = '0x' + 'a'.repeat(64);
const OTHER_HASH    = '0x' + 'b'.repeat(64);
const WITNESS_NULL  = '0x1f4a3b';
const OPERATOR_NULL = '0x9c2d7e';

const proof = (o: Partial<ProofResult> = {}, item: Record<string, unknown> = {}): ProofResult => ({
  protocol_version: '3.0',
  nonce: '0xdead',
  action: 'proctor-witness-approval',
  responses: [{ identifier: 'selfie', signal_hash: hashSignal(DECISION_HASH), nullifier: WITNESS_NULL, ...item }],
  ...o,
});

const input = (o: Partial<VerifyInput> = {}): VerifyInput => ({
  raw: proof(),
  decision: { decisionHash: DECISION_HASH, expiresAt: new Date(Date.now() + 30_000) },
  operatorNullifier: parseNullifier(OPERATOR_NULL),
  mode: 'SELFIE',
  nonceValid: true,
  ...o,
});

test('a well-formed Selfie Check proof passes', () => {
  const r = verifyWitnessProof(input());
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.identifier).toBe('selfie');
    expect(r.nullifier).toBe(parseNullifier(WITNESS_NULL));
  }
});

// --- assertion 1: TTL, fail closed --------------------------------------
test('rejects after expiry: second 61 is a hard refuse', () => {
  const r = verifyWitnessProof(input({ decision: { decisionHash: DECISION_HASH, expiresAt: new Date(Date.now() - 1) } }));
  expect(r).toEqual({ ok: false, reason: 'decision_expired' });
});

test('TTL is judged at arrival, so a slow verifier cannot extend the deadline', () => {
  const expiresAt = new Date('2026-09-03T12:00:00Z');
  const arrived   = new Date('2026-09-03T11:59:59Z');
  const afterCall = new Date('2026-09-03T12:00:05Z');
  expect(verifyWitnessProof(input({ decision: { decisionHash: DECISION_HASH, expiresAt }, now: arrived })).ok).toBe(true);
  expect(verifyWitnessProof(input({ decision: { decisionHash: DECISION_HASH, expiresAt }, now: afterCall })).ok).toBe(false);
});

// --- assertion 4: THE ONE THAT MATTERS ----------------------------------
test('SECURITY: a valid proof for a DIFFERENT decision is rejected', () => {
  // Without this check Proctor is a paid captcha: any liveness proof would
  // satisfy any decision.
  const r = verifyWitnessProof(input({
    raw: proof({}, { signal_hash: hashSignal(OTHER_HASH) }),
  }));
  expect(r).toEqual({ ok: false, reason: 'signal_mismatch' });
});

test('SECURITY: a proof with NO signal_hash is rejected, not treated as a pass', () => {
  const r = verifyWitnessProof(input({ raw: proof({}, { signal_hash: undefined }) }));
  expect(r).toEqual({ ok: false, reason: 'signal_mismatch' });
});

test('signal comparison is case insensitive', () => {
  const r = verifyWitnessProof(input({
    raw: proof({}, { signal_hash: hashSignal(DECISION_HASH).toUpperCase() }),
  }));
  expect(r.ok).toBe(true);
});

// --- assertion 7: segregation of duties ---------------------------------
test('SECURITY: the operator cannot approve their own agent', () => {
  const r = verifyWitnessProof(input({ raw: proof({}, { nullifier: OPERATOR_NULL }) }));
  expect(r).toEqual({ ok: false, reason: 'witness_is_operator' });
});

test('operator match is detected across hex casing and 0x prefix', () => {
  // '0x9C2D7E' and '9c2d7e' are the same human. String compare would miss it.
  for (const variant of ['0x9C2D7E', '9c2d7e', '0x9c2d7e']) {
    const r = verifyWitnessProof(input({ raw: proof({}, { nullifier: variant }) }));
    expect(r).toEqual({ ok: false, reason: 'witness_is_operator' });
  }
});

// --- remaining assertions ------------------------------------------------
test('rejects a v4 proof presented on the SELFIE path', () => {
  expect(verifyWitnessProof(input({ raw: proof({ protocol_version: '4.0' }) })))
    .toEqual({ ok: false, reason: 'protocol_mismatch' });
});

test('rejects the wrong credential', () => {
  expect(verifyWitnessProof(input({ raw: proof({}, { identifier: 'device' }) })))
    .toEqual({ ok: false, reason: 'identifier_mismatch' });
});

test('rejects a replayed RP nonce', () => {
  expect(verifyWitnessProof(input({ nonceValid: false })))
    .toEqual({ ok: false, reason: 'duplicate_nonce' });
});

test('ORB_PRESENCE requires user_presence_completed', () => {
  const v4 = (presence?: boolean): ProofResult => ({
    protocol_version: '4.0', nonce: '0x1', action: 'a',
    user_presence_completed: presence,
    responses: [{ identifier: 'proof_of_human', signal_hash: hashSignal(DECISION_HASH), nullifier: WITNESS_NULL }],
  });
  expect(verifyWitnessProof(input({ raw: v4(undefined), mode: 'ORB_PRESENCE' })))
    .toEqual({ ok: false, reason: 'no_liveness' });
  expect(verifyWitnessProof(input({ raw: v4(true), mode: 'ORB_PRESENCE' })).ok).toBe(true);
});

test('rejects an empty responses array instead of throwing', () => {
  expect(verifyWitnessProof(input({ raw: proof({ responses: [] }) })))
    .toEqual({ ok: false, reason: 'malformed_proof' });
});

test('assertion order: expiry is reported before shape problems', () => {
  const r = verifyWitnessProof(input({
    raw: proof({ protocol_version: '4.0', responses: [] }),
    decision: { decisionHash: DECISION_HASH, expiresAt: new Date(Date.now() - 1) },
  }));
  expect(r).toEqual({ ok: false, reason: 'decision_expired' });
});

// --- the finding that decides the fallback -------------------------------
test('DOCUMENTED RISK: only v3 credentials give a stable nullifier', () => {
  // Assertion 7 is only meaningful where the nullifier is stable. On a v4
  // uniqueness proof, two proofs from the SAME account differ, so
  // witness !== operator passes trivially and the property is silently false.
  expect(hasStableNullifier('SELFIE')).toBe(true);
  expect(hasStableNullifier('DEVICE_DEV_ONLY')).toBe(true);
  expect(hasStableNullifier('ORB_PRESENCE')).toBe(false);
});

// --- RP signing, against the real configured key --------------------------
test('mintRpSignature produces a live, single-use, TTL-bounded signature', () => {
  const a = mintRpSignature(300);
  expect(a.sig).toMatch(/^0x[0-9a-f]+$/i);
  expect(a.sig.length).toBe(132);                    // 65-byte EIP-191 signature
  expect(a.nonce.length).toBe(66);                   // 32-byte nonce
  expect(a.expires_at - a.created_at).toBe(300);
  expect(a.rp_id).toBe('rp_4d44df4ba311add1');
  expect(mintRpSignature(300).nonce).not.toBe(a.nonce);
});

test('RP timestamps are unix SECONDS, not milliseconds', () => {
  const s = mintRpSignature(60);
  const nowSec = Math.floor(Date.now() / 1000);
  expect(Math.abs(s.created_at - nowSec)).toBeLessThan(5);
});
