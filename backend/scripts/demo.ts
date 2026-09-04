/**
 * Drive one decision end to end, without payment or a real phone.
 *
 * Proves the whole oversight loop: policy fires, decision opens, a witness is
 * dispatched, a proof is verified, the outcome resolves, and an attestation is
 * built. Exists so a judge can see the mechanism working in one command
 * without a funded wallet or a World ID feature flag.
 */
import { prismaQuery } from '../src/lib/prisma.ts';
import { hashSignal } from '@worldcoin/idkit-core/hashing';
import { evaluatePolicy, DEMO_POLICY, type AgentAction } from '../src/lib/policy/evaluate.ts';
import { decisionHash, policyHash } from '../src/lib/attestation/hash.ts';
import {
  mintWitnessToken, mintNonce, dispatchDecision, approveDecision, refuseDecision,
} from '../src/lib/decision/lifecycle.ts';
import { selectWitness } from '../src/lib/witness/dispatch.ts';
import { verifyWitnessProof } from '../src/lib/world/verify.ts';
import { buildAttestation, classifyIndependence } from '../src/lib/attestation/build.ts';

const choice = (process.argv[2] ?? 'approve').toUpperCase() as 'APPROVE' | 'REFUSE';

const action: AgentAction = {
  kind: 'transfer', asset: 'EUR', amount: '41200.00', counterparty: 'Meridian Logistics',
};

const org = await prismaQuery.org.findFirst({ where: { slug: 'demo-org' } });
if (!org) {
  console.error('No demo org found. Run:  bun run seed');
  process.exit(1);
}
const agent = await prismaQuery.agent.findFirst({ where: { orgId: org.id } });
if (!agent) {
  console.error('No agent registered. Run:  bun run seed');
  process.exit(1);
}

console.log('1. agent proposes:', `${action.asset} ${action.amount} -> ${action.counterparty}`);

const policy = evaluatePolicy(action, DEMO_POLICY);
console.log('2. policy        :', policy.escalate ? `ESCALATE (${policy.reason})` : `proceed (${policy.reason})`);
if (!policy.escalate) process.exit(0);

const nonce = mintNonce();
const { token, hash } = mintWitnessToken();
const preimage = { action, nonce, orgSlug: org.slug, agentUaid: agent.uaid, issuedAt: new Date().toISOString() };

const decision = await prismaQuery.decision.create({
  data: {
    orgId: org.id, agentId: agent.id, state: 'OPEN',
    preimage: preimage as never,
    decisionHash: decisionHash(preimage),
    humanLine: policy.humanLine,
    nonce, witnessTokenHash: hash, policyHash: policyHash(DEMO_POLICY),
    expiresAt: new Date(Date.now() + 60_000),
  },
});
console.log('3. decision      :', decision.id);
console.log('   human line    :', decision.humanLine);
console.log('   signal        :', decision.decisionHash.slice(0, 26) + '…');

const witness = await selectWitness(org.id, 'standard');
if (!witness) { console.error('no witness enrolled: run `bun run seed`'); process.exit(1); }
await dispatchDecision(decision.id, witness.id, 60);
console.log('4. dispatched to the rota, 60s deadline running');

if (choice === 'REFUSE') {
  const r = await refuseDecision(decision.id);
  const att = await buildAttestation({
    decisionHash: decision.decisionHash, outcome: 'REFUSE', agentUaid: agent.uaid,
    worldProofDigest: null, witnessNullifier: null,
    operatorNullifier: org.operatorNullifier!.toFixed(0),
    witnessAuth: 'token', independence: 'policy',
    policyHash: decision.policyHash!, meteredMs: 0, reviewMs: r.ok ? r.reviewMs : 0,
  });
  console.log('5. witness REFUSED. No proof required: refuse is the default outcome.');
  console.log('6. attestation   :', att.bodyBytes, 'bytes, wid=null, wa=token');
  console.log('\n   The agent is NOT released.');
  process.exit(0);
}

// A witness proof. In the live flow this comes from World; the verification
// path below is byte-for-byte the same either way.
const fresh = await prismaQuery.decision.findUniqueOrThrow({ where: { id: decision.id } });
const witnessRow = await prismaQuery.witness.findUniqueOrThrow({ where: { id: witness.id } });
const proof = {
  protocol_version: '3.0', nonce: '0xdemo', action: 'proctor-witness-approval',
  responses: [{
    identifier: 'device',
    signal_hash: hashSignal(fresh.decisionHash),
    nullifier: '0x' + BigInt(witnessRow.nullifier.toFixed(0)).toString(16),
  }],
};

const verified = verifyWitnessProof({
  raw: proof as never,
  decision: { decisionHash: fresh.decisionHash, expiresAt: fresh.expiresAt },
  operatorNullifier: BigInt(org.operatorNullifier!.toFixed(0)),
  mode: 'DEVICE_DEV_ONLY',
  nonceValid: true,
});
console.log('5. proof         :', verified.ok ? 'VERIFIED' : `REJECTED (${(verified as { reason: string }).reason})`);
if (!verified.ok) process.exit(1);
console.log('   signal matched this decision, and the witness is not the operator');

const approved = await approveDecision(decision.id);
const att = await buildAttestation({
  decisionHash: fresh.decisionHash, outcome: 'APPROVE', agentUaid: agent.uaid,
  worldProofDigest: 'demo'.padEnd(64, '0'),
  witnessNullifier: witnessRow.nullifier.toFixed(0),
  operatorNullifier: org.operatorNullifier!.toFixed(0),
  witnessAuth: 'proof',
  independence: classifyIndependence(true, witnessRow.nullifier.toFixed(0), org.operatorNullifier!.toFixed(0)),
  policyHash: fresh.policyHash!, meteredMs: approved.ok ? approved.reviewMs : 0,
  reviewMs: approved.ok ? approved.reviewMs : 0,
});

console.log('6. APPROVED in', approved.ok ? approved.reviewMs : '?', 'ms');
console.log('7. attestation   :', att.bodyBytes, 'bytes, ind=' + att.core.ind);
console.log('   signed by     :', att.attestorAddress);
console.log('\n   The agent is released. The evidence is independently verifiable.');
