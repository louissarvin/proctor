import { buildAttestation } from './src/lib/attestation/build.ts';
import { submitAttestation, confirmAttestation } from './src/lib/hedera/hcs.ts';
import { decisionHash, policyHash } from './src/lib/attestation/hash.ts';
import { proctorAgentUaid } from './src/lib/attestation/uaid.ts';
import { HEDERA_TOPIC_ID, HASHSCAN_BASE } from './src/config/main-config.ts';

// A realistic decision: the one from the demo.
const preimage = {
  action: { kind: 'transfer', asset: 'EUR', amount: '41200.00', counterparty: 'Meridian Logistics' },
  nonce: 'a1b2c3d4e5f6a7b8',
  issuedAt: '2026-09-04T12:00:00.000Z',
};

const att = await buildAttestation({
  decisionHash: decisionHash(preimage),
  outcome: 'APPROVE',
  agentUaid: proctorAgentUaid('0.0.10349667'),
  worldProofDigest: 'd'.repeat(64),
  witnessNullifier: '12345678901234567890',
  operatorNullifier: '98765432109876543210',
  witnessAuth: 'proof',
  independence: 'crypto',
  policyHash: policyHash({ amountThreshold: '25000' }),
  meteredMs: 6412,
  reviewMs: 6412,
});

console.log('attestation:', att.bodyBytes, 'bytes');
console.log('signed by  :', att.attestorAddress);

const t0 = Date.now();
const r = await submitAttestation(att.body);
const submitMs = Date.now() - t0;

console.log('\nSUBMITTED in', submitMs, 'ms');
console.log('  sequence #  :', r.sequenceNumber);
console.log('  runningHash :', r.runningHash.slice(0, 32), '...');
console.log('  tx id       :', r.transactionId);
console.log('  hashscan    :', `${HASHSCAN_BASE}/topic/${HEDERA_TOPIC_ID}`);

// Measure mirror lag: this decides the video's HashScan timing.
console.log('\nmeasuring mirror node lag...');
const start = Date.now();
for (let i = 0; i < 40; i++) {
  const c = await confirmAttestation(HEDERA_TOPIC_ID, r.sequenceNumber, r.runningHash);
  if (c.confirmed) {
    console.log(`  CONFIRMED after ${Date.now() - start} ms`);
    console.log('  consensus timestamp :', c.consensusTimestamp);
    console.log('  running hash version:', c.runningHashVersion);
    break;
  }
  await new Promise((s) => setTimeout(s, 500));
}
