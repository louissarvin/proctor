import { test, expect } from 'bun:test';
import {
  makeUaid, uaidHash, canonicalUaidJson, parseUaid,
  proctorGateUaid, proctorAgentUaid, type UaidCanonicalFields,
} from '../src/lib/attestation/uaid.ts';

const fields = (o: Partial<UaidCanonicalFields> = {}): UaidCanonicalFields => ({
  registry: 'proctor',
  name: 'proctor-oversight-gate',
  version: '1.0.0',
  protocol: 'x402',
  nativeId: 'hedera:testnet:0.0.1234',
  skills: [1],
  ...o,
});

// --- FIXED VECTOR: a reader must be able to reproduce this exact string -----

test('FIXED TEST VECTOR: the UAID is deterministic and reproducible', () => {
  const uaid = makeUaid(fields());
  // Regenerating from the same inputs must give byte-identical output, forever.
  expect(uaid).toBe(makeUaid(fields()));
  expect(uaid).toMatchSnapshot();
  console.log(`    UAID: ${uaid}`);
});

test('canonical JSON contains ONLY the six required fields, alphabetically', () => {
  // Spec: "a canonical JSON representation containing ONLY these required
  // fields: registry, name, version, protocol, nativeId, skills"
  const json = canonicalUaidJson(fields());
  expect(JSON.parse(json)).toEqual({
    name: 'proctor-oversight-gate',
    nativeId: 'hedera:testnet:0.0.1234',
    protocol: 'x402',
    registry: 'proctor',
    skills: [1],
    version: '1.0.0',
  });
  expect(Object.keys(JSON.parse(json))).toEqual(
    ['name', 'nativeId', 'protocol', 'registry', 'skills', 'version'],
  );
});

// --- normalisation rules from the spec --------------------------------------

test('registry and protocol are lowercased, everything is trimmed', () => {
  expect(uaidHash(fields({ registry: '  PROCTOR  ', protocol: ' X402 ' })))
    .toBe(uaidHash(fields({ registry: 'proctor', protocol: 'x402' })));
});

test('name and version are trimmed but NOT lowercased', () => {
  // The spec lowercases only registry and protocol. Lowercasing name too would
  // silently merge two distinct agents.
  expect(uaidHash(fields({ name: '  MyAgent  ' }))).toBe(uaidHash(fields({ name: 'MyAgent' })));
  expect(uaidHash(fields({ name: 'MyAgent' }))).not.toBe(uaidHash(fields({ name: 'myagent' })));
});

test('skills sort NUMERICALLY ascending, not lexicographically', () => {
  // The classic bug: [2,10] sorted as strings gives [10,2] and a different hash.
  expect(uaidHash(fields({ skills: [10, 2, 1] }))).toBe(uaidHash(fields({ skills: [1, 2, 10] })));
  expect(canonicalUaidJson(fields({ skills: [10, 2, 1] }))).toContain('"skills":[1,2,10]');
});

test('input order never affects the hash', () => {
  const a: UaidCanonicalFields = { registry: 'r', name: 'n', version: 'v', protocol: 'p', nativeId: 'i', skills: [1] };
  const b: UaidCanonicalFields = { skills: [1], nativeId: 'i', protocol: 'p', version: 'v', name: 'n', registry: 'r' };
  expect(uaidHash(a)).toBe(uaidHash(b));
});

// --- hash and encoding ------------------------------------------------------

test('the id is Base58 of a SHA-384 digest', () => {
  const id = uaidHash(fields());
  // Base58 alphabet excludes 0, O, I and l.
  expect(id).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
  const bs58 = require('bs58').default ?? require('bs58');
  expect(Buffer.from(bs58.decode(id)).length).toBe(48);   // SHA-384 = 48 bytes
});

// --- grammar and routing ----------------------------------------------------

test('routing parameters appear in the spec order: uid, registry, proto, nativeId, domain', () => {
  const uaid = makeUaid(fields(), { uid: '7', domain: 'example.com' });
  const tail = uaid.split(';').slice(1).map((p) => p.split('=')[0]);
  expect(tail).toEqual(['uid', 'registry', 'proto', 'nativeId', 'domain']);
});

test('uid defaults to "0" when not applicable, as the spec requires', () => {
  expect(makeUaid(fields())).toContain(';uid=0;');
});

test('domain is omitted entirely when absent', () => {
  expect(makeUaid(fields())).not.toContain('domain=');
});

test('grammar is uaid:aid:{id};{params}', () => {
  expect(makeUaid(fields())).toMatch(/^uaid:aid:[1-9A-HJ-NP-Za-km-z]+;uid=/);
});

test('parseUaid round-trips a generated identifier', () => {
  const uaid = makeUaid(fields(), { uid: '3', domain: 'proctor.dev' });
  const parsed = parseUaid(uaid)!;
  expect(parsed.target).toBe('aid');
  expect(parsed.id).toBe(uaidHash(fields()));
  expect(parsed.params).toEqual({
    uid: '3', registry: 'proctor', proto: 'x402',
    nativeId: 'hedera:testnet:0.0.1234', domain: 'proctor.dev',
  });
});

test('parseUaid rejects a malformed identifier instead of guessing', () => {
  expect(parseUaid('not-a-uaid')).toBeNull();
  expect(parseUaid('uaid:bogus:abc')).toBeNull();
});

// --- required fields --------------------------------------------------------

test('every required field must be present and non-empty', () => {
  // Spec: "These must all be present and non-empty to generate a valid identifier."
  for (const k of ['registry', 'name', 'version', 'protocol', 'nativeId'] as const) {
    expect(() => makeUaid(fields({ [k]: '   ' } as never))).toThrow(/must be present and non-empty/);
  }
});

// --- the two identities Proctor publishes -----------------------------------

test('the gate and the paying agent get DISTINCT identifiers', () => {
  const gate = proctorGateUaid('0.0.1234');
  const agent = proctorAgentUaid('0.0.5678');
  expect(gate).not.toBe(agent);
  expect(gate).toContain('nativeId=hedera:testnet:0.0.1234');
  expect(agent).toContain('nativeId=hedera:testnet:0.0.5678');
});

test('the same agent on a different network is a different identity', () => {
  expect(proctorGateUaid('0.0.1234', 'testnet')).not.toBe(proctorGateUaid('0.0.1234', 'mainnet'));
});
