import { test, expect } from 'bun:test';
import { canonical } from '../src/lib/attestation/canonical.ts';
import { decisionHash, policyHash, worldProofDigest } from '../src/lib/attestation/hash.ts';

// ---------------------------------------------------------------------------
// DEFECT A1. These are the tests a flat-object-only suite cannot fail.
// ---------------------------------------------------------------------------

test('A1: NESTED object keys are sorted at every depth', () => {
  // The naive implementation delegates nested values to JSON.stringify, which
  // preserves insertion order. That is the bug.
  const a = { outer: { b: 1, a: 2 } };
  const b = { outer: { a: 2, b: 1 } };
  expect(canonical(a)).toBe('{"outer":{"a":2,"b":1}}');
  expect(canonical(a)).toBe(canonical(b));
});

test('A1: objects INSIDE ARRAYS get sorted keys, array order preserved', () => {
  const v = { items: [{ z: 1, a: 2 }, { m: 3, b: 4 }] };
  expect(canonical(v)).toBe('{"items":[{"a":2,"z":1},{"b":4,"m":3}]}');
});

test('A1: deep nesting stays canonical', () => {
  const a = { l1: { l2: { l3: { b: [{ y: 1, x: 2 }], a: 'v' } } } };
  const b = { l1: { l2: { l3: { a: 'v', b: [{ x: 2, y: 1 }] } } } };
  expect(canonical(a)).toBe(canonical(b));
  expect(canonical(a)).toBe('{"l1":{"l2":{"l3":{"a":"v","b":[{"x":2,"y":1}]}}}}');
});

test('A1 REGRESSION: two different POLICIES must not hash identically', () => {
  // The precise symptom of the original bug: every policy hashed the same,
  // because the rules live in a nested object.
  const p1 = { rules: { amountThreshold: '25000', kinds: ['data_export'] } };
  const p2 = { rules: { amountThreshold: '99999', kinds: ['data_export'] } };
  expect(policyHash(p1)).not.toBe(policyHash(p2));
});

test('A1 REGRESSION: a nested change must change the decision hash', () => {
  const base = { action: { kind: 'transfer', amount: '41200.00', counterparty: 'Meridian' }, nonce: 'n1' };
  const edit = { action: { kind: 'transfer', amount: '41200.01', counterparty: 'Meridian' }, nonce: 'n1' };
  expect(decisionHash(base)).not.toBe(decisionHash(edit));
});

// ---------------------------------------------------------------------------
// RFC 8785 conformance
// ---------------------------------------------------------------------------

test('JCS: array order is DATA and is never sorted', () => {
  expect(canonical([3, 1, 2])).toBe('[3,1,2]');
});

test('JCS: keys sort by UTF-16 code units, not locale', () => {
  expect(canonical({ b: 1, a: 2, A: 3, '1': 4 })).toBe('{"1":4,"A":3,"a":2,"b":1}');
});

test('JCS: no whitespace anywhere', () => {
  expect(canonical({ a: [1, { b: 2 }] })).not.toMatch(/\s/);
});

test('JCS: control characters use lowercase \\uhhhh, predefined escapes preserved', () => {
  expect(canonical(String.fromCharCode(1))).toBe('"\\u0001"');
  expect(canonical('\t\n')).toBe('"\\t\\n"');
});

test('JCS: numbers use ECMAScript Number::toString', () => {
  expect(canonical(1e21)).toBe('1e+21');
  expect(canonical(0.1)).toBe('0.1');
  expect(canonical(-0)).toBe('0');
});

test('JCS: non-ASCII is preserved, not escaped', () => {
  expect(canonical({ name: 'déjà' })).toBe('{"name":"déjà"}');
});

// ---------------------------------------------------------------------------
// Semantics we rely on elsewhere
// ---------------------------------------------------------------------------

test('undefined is DROPPED, null is PRESERVED', () => {
  // wid is null on a refusal and that is meaningful evidence, not a gap.
  expect(canonical({ a: 1, b: undefined, c: null })).toBe('{"a":1,"c":null}');
});

test('key insertion order never affects the hash', () => {
  const a = { z: 1, m: { q: 2, b: 3 }, a: [1, 2] };
  const b = { a: [1, 2], m: { b: 3, q: 2 }, z: 1 };
  expect(decisionHash(a)).toBe(decisionHash(b));
});

test('rejects values that would silently corrupt a hash', () => {
  expect(() => canonical(NaN)).toThrow(/NaN/);
  expect(() => canonical(Infinity)).toThrow();
  expect(() => canonical(10n)).toThrow(/bigint/);
  expect(() => canonical(new Date())).toThrow(/Date/);
});

test('decisionHash is keccak256 and 32 bytes', () => {
  const h = decisionHash({ action: 'x', nonce: 'n' });
  expect(h).toMatch(/^0x[0-9a-f]{64}$/);
});

test('worldProofDigest hashes the EXACT bytes received', () => {
  // Byte-identical input must give an identical digest; a single space must not.
  const raw = '{"protocol_version":"3.0","responses":[]}';
  expect(worldProofDigest(raw)).toBe(worldProofDigest(Buffer.from(raw, 'utf8')));
  expect(worldProofDigest(raw)).not.toBe(worldProofDigest(raw + ' '));
});

test('a third party can reproduce the hash from the export alone', () => {
  // Round trip through JSON, exactly as an auditor would after downloading it.
  const preimage = { action: { kind: 'transfer', amount: '41200.00' }, nonce: 'abc', ts: '2026-09-03T12:00:00Z' };
  const asShipped = JSON.parse(JSON.stringify(preimage));
  expect(decisionHash(asShipped)).toBe(decisionHash(preimage));
});


// ---------------------------------------------------------------------------
// Proof that the bug is real, not hypothetical.
// ---------------------------------------------------------------------------

/** The implementation almost everyone writes first. Sorts only the top level. */
const naiveCanonical = (v: unknown): string => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return JSON.stringify(v);
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${JSON.stringify(o[k])}`).join(',')}}`;
};

test('THE BUG: the naive canonicaliser produces DIFFERENT bytes for identical data', () => {
  const a = { outer: { b: 1, a: 2 } };
  const b = { outer: { a: 2, b: 1 } };

  // Logically the same record. The naive version disagrees.
  expect(naiveCanonical(a)).not.toBe(naiveCanonical(b));   // <- the defect
  expect(canonical(a)).toBe(canonical(b));                  // <- fixed

  // Concretely:
  expect(naiveCanonical(a)).toBe('{"outer":{"b":1,"a":2}}');
  expect(canonical(a)).toBe('{"outer":{"a":2,"b":1}}');
});

test('THE BUG: under the naive version, an auditor re-serialising the export gets a different hash', () => {
  // JSON.parse/stringify does not preserve key order guarantees across
  // implementations, so an auditor's copy can differ from ours. With JCS both
  // sides agree; with the naive version they silently do not.
  const preimage = { action: { counterparty: 'Meridian', amount: '41200.00' }, nonce: 'n1' };
  const reordered = { action: { amount: '41200.00', counterparty: 'Meridian' }, nonce: 'n1' };

  expect(naiveCanonical(preimage)).not.toBe(naiveCanonical(reordered));
  expect(canonical(preimage)).toBe(canonical(reordered));
});
