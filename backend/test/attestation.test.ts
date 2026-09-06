import { test, expect } from 'bun:test';
import { verifyTypedData } from 'viem';
import {
  buildAttestation, signAttestation, attestorAccount,
  eip712Domain, eip712Types, classifyIndependence, type BuildInput,
} from '../src/lib/attestation/build.ts';

const base = (o: Partial<BuildInput> = {}): BuildInput => ({
  decisionHash: '0x' + 'a'.repeat(64),
  orgSeq: 47,
  outcome: 'APPROVE',
  agentUaid: 'uaid:aid:2Kj9xQm4vN8pLd3RtYwZbHcFgSaEuVnMkXoPqTrWyBiJ;registry=proctor',
  worldProofDigest: 'b'.repeat(64),
  witnessNullifier: '12345678901234567890123456789012345678901234567890',
  operatorNullifier: '98765432109876543210987654321098765432109876543210',
  witnessAuth: 'proof',
  independence: 'crypto',
  policyHash: 'c'.repeat(64),
  meteredMs: 6412,
  reviewMs: 6412,
  at: new Date('2026-09-10T14:22:07.412Z'),
  ...o,
});

test('an approval attestation fits in ONE HCS chunk', async () => {
  const a = await buildAttestation(base());
  expect(a.bodyBytes).toBeLessThanOrEqual(1024);
  console.log(`    approval record: ${a.bodyBytes} bytes (${1024 - a.bodyBytes} headroom)`);
});

test('SIZE ASSERTION fires before submit rather than silently chunking', async () => {
  // Above 1024 the SDK splits into N messages with N sequence numbers and the
  // single-chunk verification story dies with no error.
  await expect(buildAttestation(base({ agentUaid: 'x'.repeat(1200) })))
    .rejects.toThrow(/max 1024/);
});

test('the EIP-712 signature verifies against the published attestor address', async () => {
  const a = await buildAttestation(base());
  const ok = await verifyTypedData({
    address: a.attestorAddress as `0x${string}`,
    domain: eip712Domain(),
    types: eip712Types,
    primaryType: 'OversightRecord',
    message: {
      dh: a.core.dh, sq: a.core.sq, out: a.core.out, wid: a.core.wid ?? '', wn: a.core.wn ?? '',
      on: a.core.on, wa: a.core.wa, ind: a.core.ind, pol: a.core.pol,
      mtr: a.core.mtr, rev: a.core.rev, ts: a.core.ts,
    },
    signature: a.attestorSig as `0x${string}`,
  });
  expect(ok).toBe(true);
});

test('TAMPER: changing the outcome invalidates the signature', async () => {
  const a = await buildAttestation(base({ outcome: 'APPROVE' }));
  const forged = { ...a.core, out: 'REFUSE' as const };
  const ok = await verifyTypedData({
    address: a.attestorAddress as `0x${string}`,
    domain: eip712Domain(), types: eip712Types, primaryType: 'OversightRecord',
    message: {
      dh: forged.dh, sq: forged.sq, out: forged.out, wid: forged.wid ?? '', wn: forged.wn ?? '',
      on: forged.on, wa: forged.wa, ind: forged.ind, pol: forged.pol,
      mtr: forged.mtr, rev: forged.rev, ts: forged.ts,
    },
    signature: a.attestorSig as `0x${string}`,
  });
  expect(ok).toBe(false);
});

test('signing is deterministic for identical input', async () => {
  const core = (await buildAttestation(base())).core;
  expect(await signAttestation(core)).toBe(await signAttestation(core));
});

// --- refusal semantics -----------------------------------------------------

test('a REFUSAL carries wid:null and wa:"token", and that is CORRECT not missing', async () => {
  // Refuse is the default outcome. Requiring a liveness proof to press a stop
  // button would put a failure mode between a human and a brake pedal.
  const a = await buildAttestation(base({
    outcome: 'REFUSE', worldProofDigest: null, witnessAuth: 'token', independence: 'policy',
  }));
  expect(a.core.wid).toBeNull();
  expect(a.core.wa).toBe('token');
  expect(a.bodyBytes).toBeLessThanOrEqual(1024);
});

test('an EXPIRY still produces a full attestation', async () => {
  // A refusal by timeout is the outcome an auditor cares about most.
  const a = await buildAttestation(base({
    outcome: 'EXPIRE', worldProofDigest: null, witnessNullifier: null,
    witnessAuth: 'token', independence: 'policy', meteredMs: 0, reviewMs: 60000,
  }));
  expect(a.core.out).toBe('EXPIRE');
  expect(a.core.mtr).toBe('0');     // expiry meters to zero
  expect(a.core.rev).toBe('60000'); // but the elapsed time is still factual
});

// --- the honesty field -----------------------------------------------------

test('INDEPENDENCE is derived, never asserted', () => {
  // v3 credential, distinct nullifiers -> cryptographic.
  expect(classifyIndependence(true, '111', '222')).toBe('crypto');
  // Same account -> not independent at all.
  expect(classifyIndependence(true, '111', '111')).toBe('policy');
  // v4 one-time-use nullifier: two proofs from the SAME account differ, so the
  // comparison proves nothing. Must degrade to policy, not silently claim crypto.
  expect(classifyIndependence(false, '111', '222')).toBe('policy');
  // No witness nullifier at all.
  expect(classifyIndependence(true, null, '222')).toBe('policy');
});

test('the record commits to the operator nullifier so independence is CHECKABLE', async () => {
  const a = await buildAttestation(base());
  expect(a.core.on).toBe(base().operatorNullifier);
  expect(a.core.wn).not.toBe(a.core.on);
});

// --- reproducibility -------------------------------------------------------

test('bodyDigest is sha384 and matches the exact bytes', async () => {
  const a = await buildAttestation(base());
  expect(a.bodyDigest).toMatch(/^[0-9a-f]{96}$/);
  const crypto = require('node:crypto');
  expect(crypto.createHash('sha384').update(Buffer.from(a.body, 'utf8')).digest('hex')).toBe(a.bodyDigest);
});

test('the body is canonical: key order in the source cannot change the bytes', async () => {
  const a = await buildAttestation(base());
  const keys = [...a.body.matchAll(/"([a-z]+)":/g)].map(m => m[1]!);
  expect(keys).toEqual([...keys].sort());
});

test('attestor address is stable and publishable', () => {
  expect(attestorAccount().address).toMatch(/^0x[0-9a-fA-F]{40}$/);
});
