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
import { decisionHash, policyHash, worldProofDigest } from '../src/lib/attestation/hash.ts';
import { canonical } from '../src/lib/attestation/canonical.ts';
import {
  mintWitnessToken, mintNonce, dispatchDecision, approveDecision, refuseDecision,
} from '../src/lib/decision/lifecycle.ts';
import { selectWitness } from '../src/lib/witness/dispatch.ts';
import { verifyWitnessProof } from '../src/lib/world/verify.ts';
import { buildAttestation, classifyIndependence } from '../src/lib/attestation/build.ts';
import { attestDecision } from '../src/lib/attestation/persist.ts';
import { issueDecision } from '../src/lib/decision/issue.ts';
import { payWitness } from '../src/lib/payout/witness.ts';
import { usingDemoAttestor } from '../src/lib/attestation/build.ts';
import { WITNESS_HEDERA_ACCOUNT } from '../src/config/main-config.ts';

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

const decision = await issueDecision(org.id, {
    agentId: agent.id, state: 'OPEN',
    preimage: preimage as never,
    decisionHash: decisionHash(preimage),
    humanLine: policy.humanLine,
    nonce, witnessTokenHash: hash, policyHash: policyHash(DEMO_POLICY),
    expiresAt: new Date(Date.now() + 60_000),
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
    decisionHash: decision.decisionHash, orgSeq: decision.orgSeq, outcome: 'REFUSE', agentUaid: agent.uaid,
    worldProofDigest: null, witnessNullifier: null,
    operatorNullifier: org.operatorNullifier!.toFixed(0),
    witnessAuth: 'token', independence: 'policy',
    policyHash: decision.policyHash!, meteredMs: 0, reviewMs: r.ok ? r.reviewMs : 0,
  });
  console.log('5. witness REFUSED. No proof required: refuse is the default outcome.');
  console.log('6. attestation   :', att.bodyBytes, 'bytes, wid=null, wa=token');
  const rr = await attestDecision(decision.id);
  console.log('7. evidence log  :', rr.ok ? `HCS seq #${rr.sequenceNumber}` : `not written (${rr.reason})`);

  // A refusal is paid too. Paying only for approvals would price the witness
  // to say yes, which is the incentive this product exists to remove.
  const rp = await payWitness(decision.id);
  console.log('8. witness paid  :', rp.ok ? `$${rp.amountUsd} for refusing` : `NOT SETTLED (${rp.reason})`);
  if (rp.ok) console.log('   hashscan      :', rp.explorerUrl);

  console.log('\n   The agent is NOT released.');
  if (usingDemoAttestor() || !rr.ok) {
    console.log('   (unconfigured run: see `bun run doctor` for what is missing)');
  }
  process.exit(0);
}

// A witness proof. In the live flow this comes from World; the verification
// path below is byte-for-byte the same either way.
const fresh = await prismaQuery.decision.findUniqueOrThrow({ where: { id: decision.id } });
const witnessRow = await prismaQuery.witness.findUniqueOrThrow({ where: { id: witness.id } });
const proof = {
  protocol_version: '3.0', nonce: '0xdemo', action: 'proctor-witness-approval',
  // The witness widget requests require_user_presence, so a real proof carries
  // this. Without it the credential proves possession of a phone, not that a
  // human was there, and the backend refuses it.
  user_presence_completed: true,
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

// Persist the proof BEFORE resolving, exactly as the witness route does.
//
// Without this the demo printed `ind=crypto` while attestDecision — which
// rebuilds the record from the DATABASE, not from the object above — wrote
// `wid:null, ind:policy` to the log. The console said one thing and the
// evidence said another, which is precisely the failure this product exists
// to detect. Now they agree because they read the same row.
await prismaQuery.worldProof.create({
  data: {
    decisionId: decision.id,
    witnessId: witness.id,
    raw: proof as never,
    rawDigest: worldProofDigest(canonical(proof)),
    signalHash: proof.responses[0]!.signal_hash,
    identifier: proof.responses[0]!.identifier,
    protocolVersion: proof.protocol_version,
    nullifier: witnessRow.nullifier.toFixed(0),
    userPresenceCompleted: proof.user_presence_completed === true,
    mode: 'DEVICE_DEV_ONLY',
  },
}).catch((e) => console.error('   proof persist failed:', e));

const approved = await approveDecision(decision.id);
const att = await buildAttestation({
  decisionHash: fresh.decisionHash, orgSeq: fresh.orgSeq, outcome: 'APPROVE', agentUaid: agent.uaid,
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

const written = await attestDecision(decision.id);
console.log('8. evidence log  :', written.ok ? `HCS seq #${written.sequenceNumber}` : `not written (${written.reason})`);

// The leg that separates this from the free approve-button every agent
// framework ships. Paying is what stops oversight being delegated to a script.
const paid = await payWitness(decision.id);
if (paid.ok) {
  console.log('9. witness paid  :', `$${paid.amountUsd} (${paid.tinybar} tinybar) -> ${WITNESS_HEDERA_ACCOUNT}`);
  console.log('   hashscan      :', paid.explorerUrl);
  // This script resolves in milliseconds, so the fee lands on the minimum
  // rather than on real attention. A human taking 30s earns ~$0.06. Said out
  // loud because a reader should not have to wonder why the number is tiny.
  console.log('   note          : floor-priced; the scripted review took',
    approved.ok ? `${approved.reviewMs}ms` : '?', 'not 30s');
} else {
  console.log('9. witness paid  :', `NOT SETTLED (${paid.reason})`, paid.recorded ? '- recorded as owed' : '');
}

// Say what actually happened, not what happens when everything is configured.
// A record signed by the published demo key and never written to a topic is not
// independently verifiable, and claiming otherwise here would be the exact
// overclaim this project exists to argue against.
if (written.ok && !usingDemoAttestor()) {
  console.log('\n   The agent is released. The evidence is independently verifiable.');
} else {
  console.log('\n   The agent is released. The oversight loop ran in full.');
  const missing: string[] = [];
  if (usingDemoAttestor()) missing.push('ATTESTOR_PRIVATE_KEY (signed with the published demo key)');
  if (!written.ok) missing.push(`HEDERA_OPERATOR_ID/KEY + HEDERA_TOPIC_ID (${written.reason})`);
  console.log('   NOT yet independently verifiable. Missing: ' + missing.join('; '));
  console.log('   Run `bun run doctor` for the full picture.');
}
await new Promise((r) => setTimeout(r, 6000));   // let mirror confirmation land
process.exit(0);
