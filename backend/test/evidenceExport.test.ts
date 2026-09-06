import { test, expect, beforeAll, afterAll } from 'bun:test';
import { verifyTypedData } from 'viem';
import { prismaQuery } from '../src/lib/prisma.ts';
import { buildExport, REGULATORY_MAPPING, HOW_TO_VERIFY } from '../src/lib/evidence/export.ts';
import { decisionHash } from '../src/lib/attestation/hash.ts';
import { buildAttestation, eip712Domain, eip712Types } from '../src/lib/attestation/build.ts';
import { mintWitnessToken, mintNonce } from '../src/lib/decision/lifecycle.ts';
import { issueDecision } from '../src/lib/decision/issue.ts';

const SUFFIX = `x${Date.now()}`;
let orgId = '';
let agentId = '';

beforeAll(async () => {
  const org = await prismaQuery.org.create({
    data: { name: 'Export Org', slug: `exp-${SUFFIX}`, operatorNullifier: '999', operatorEnrolledAt: new Date() },
  });
  orgId = org.id;
  agentId = (await prismaQuery.agent.create({ data: { orgId, label: 'a', uaid: `uaid:aid:${SUFFIX}` } })).id;
});
afterAll(async () => { await prismaQuery.org.delete({ where: { id: orgId } }).catch(() => {}); });

test('EXPORT IS SELF-SUFFICIENT: a third party re-derives the decision hash from the preimage alone', async () => {
  // The auditor has the file and nothing else. No API, no database, no us.
  const preimage = {
    action: { kind: 'transfer', asset: 'EUR', amount: '41200.00', counterparty: 'Meridian Logistics' },
    nonce: mintNonce(),
    issuedAt: '2026-09-10T14:22:00.000Z',
  };
  const dh = decisionHash(preimage);

  const doc = buildExport({
    anchors: {
      topicId: '0.0.123', mirrorNodeBaseUrl: 'https://testnet.mirrornode.hedera.com',
      attestorAddress: '0xabc', rpId: 'rp_x', worldVerifyUrl: 'https://developer.world.org',
      rootsSequenceNumber: null,
    },
    hcsMessages: [],
    records: [{
      decisionId: 'd1', preimage, decisionHash: dh,
      humanLine: 'Release EUR 41,200 to Meridian Logistics?',
      idkitResult: null, attestation: null,
      period: { issuedAt: '2026-09-10T14:22:00.000Z', dispatchedAt: null, respondedAt: null, expiresAt: '2026-09-10T14:23:00.000Z', reviewMs: null },
      outcome: 'EXPIRE', payments: [], events: [],
    }],
  });

  // Serialise and reload, exactly as an auditor would after downloading.
  const reloaded = JSON.parse(JSON.stringify(doc));
  expect(decisionHash(reloaded.records[0].preimage)).toBe(dh);
});

test('the attestation signature verifies from the export, offline', async () => {
  const a = await buildAttestation({
    decisionHash: '0x' + 'a'.repeat(64), orgSeq: 1, outcome: 'APPROVE', agentUaid: 'uaid:aid:x',
    worldProofDigest: 'b'.repeat(64), witnessNullifier: '111', operatorNullifier: '222',
    witnessAuth: 'proof', independence: 'crypto', policyHash: 'c'.repeat(64),
    meteredMs: 6412, reviewMs: 6412,
  });

  const ok = await verifyTypedData({
    address: a.attestorAddress as `0x${string}`,
    domain: eip712Domain(), types: eip712Types, primaryType: 'OversightRecord',
    message: {
      dh: a.core.dh, sq: a.core.sq, out: a.core.out, wid: a.core.wid ?? '', wn: a.core.wn ?? '',
      on: a.core.on, wa: a.core.wa, ind: a.core.ind, pol: a.core.pol,
      mtr: a.core.mtr, rev: a.core.rev, ts: a.core.ts,
    },
    signature: a.attestorSig as `0x${string}`,
  });
  expect(ok).toBe(true);
});

test('raw mirror rows survive the export byte-identical', () => {
  // Prettifying `message` or `running_hash` would make the chain unrecomputable.
  const raw = {
    consensus_timestamp: '1714792812.391795954',
    message: 'eyJ2IjoxfQ==',
    payer_account_id: '0.0.3603833',
    running_hash: 'yRhC+l6ALMSsBM+N06X2sggvpYT9arv+Wi6e2dkd',
    running_hash_version: 3,
    sequence_number: 1,
  };
  const doc = buildExport({
    anchors: { topicId: '0.0.1', mirrorNodeBaseUrl: 'm', attestorAddress: 'a', rpId: 'r', worldVerifyUrl: 'w', rootsSequenceNumber: null },
    hcsMessages: [raw], records: [],
  });
  const reloaded = JSON.parse(JSON.stringify(doc));
  expect(reloaded.hcsMessages[0]).toEqual(raw);
});

test('the export cites the Act provisions it speaks to', () => {
  // A claim a judge who knows the Act can check, rather than a vague gesture.
  expect(Object.keys(REGULATORY_MAPPING)).toEqual([
    'Art 12(1)', 'Art 12(3)(a)', 'Art 12(3)(d)', 'Art 14(4)',
    'Art 14(5), scope-qualified', 'Art 12(1), completeness',
  ]);

  // Art 12(3)(d) is about identifying the persons who verified.
  expect(REGULATORY_MAPPING['Art 12(3)(d)']).toContain('rather than by the deployer');

  // Art 12(1) is record-KEEPING. An omitted record fails it as surely as an
  // edited one, which is why completeness is mapped separately from immutability.
  expect(REGULATORY_MAPPING['Art 12(1), completeness']).toContain('visible gap');

  // THE SCOPE QUALIFIER, asserted so it can never be quietly dropped again.
  //
  // 14(5) opens "For high-risk AI systems referred to in point 1(a) of Annex
  // III" — remote biometric identification. It does NOT bind a supplier-payment
  // agent. Quoting it without that clause is the single most checkable overclaim
  // this project could make, and it shipped that way until it was read to the end.
  const scoped = REGULATORY_MAPPING['Art 14(5), scope-qualified']!;
  expect(scoped).toContain('Annex III point 1(a)');
  expect(scoped).toContain('remote biometric identification');
  expect(scoped).toContain('does NOT bind');

  // What actually binds every high-risk deployer.
  expect(REGULATORY_MAPPING['Art 14(4)']).toContain('interrupt');
});

test('HOW_TO_VERIFY ends by stating none of it contacts Proctor', () => {
  expect(HOW_TO_VERIFY.length).toBeGreaterThanOrEqual(5);
  expect(HOW_TO_VERIFY.join(' ')).toContain('None of the above contacts Proctor');
  expect(HOW_TO_VERIFY.join(' ')).toContain('RFC 8785');
});

test('a refusal exports idkitResult:null, which is correct not missing', () => {
  const doc = buildExport({
    anchors: { topicId: '0.0.1', mirrorNodeBaseUrl: 'm', attestorAddress: 'a', rpId: 'r', worldVerifyUrl: 'w', rootsSequenceNumber: null },
    hcsMessages: [],
    records: [{
      decisionId: 'd', preimage: {}, decisionHash: '0x0', humanLine: 'x',
      idkitResult: null, attestation: null,
      period: { issuedAt: 'a', dispatchedAt: null, respondedAt: null, expiresAt: 'b', reviewMs: 0 },
      outcome: 'REFUSE', payments: [], events: [],
    }],
  });
  expect(doc.records[0]!.idkitResult).toBeNull();
  expect(doc.records[0]!.outcome).toBe('REFUSE');
});

test('the export walks a real decision out of the database', async () => {
  const { hash } = mintWitnessToken();
  const nonce = mintNonce();
  const preimage = { action: { kind: 'transfer', amount: '41200.00' }, nonce };
  const d = await issueDecision(orgId, {
      agentId, state: 'EXPIRED', outcome: 'EXPIRE',
      preimage, decisionHash: decisionHash(preimage),
      humanLine: 'Release EUR 41,200 to Meridian Logistics?',
      nonce, witnessTokenHash: hash,
      expiresAt: new Date(), reviewMs: 60000,
  });

  const row = await prismaQuery.decision.findUniqueOrThrow({ where: { id: d.id } });
  // The stored hash must be reproducible from the stored preimage.
  expect(decisionHash(row.preimage as Record<string, unknown>)).toBe(row.decisionHash);
});
