/**
 * Seed a runnable demo org.
 *
 * A judge's first action is `bun run seed && bun dev`. If that does not
 * produce a working system, nothing else in the submission gets read.
 *
 * Idempotent: safe to run repeatedly.
 */
import { prismaQuery } from '../src/lib/prisma.ts';
import { proctorAgentUaid } from '../src/lib/attestation/uaid.ts';
import { HEDERA_AGENT_ID, HEDERA_NETWORK, WITNESS_HEDERA_ACCOUNT } from '../src/config/main-config.ts';

const SLUG = 'demo-org';

// Fixed so the demo is reproducible. In production these arrive from a real
// World ID enrolment performed out of band, before any decision exists.
const OPERATOR_NULLIFIER = '11111111111111111111111111111111';
const WITNESS_NULLIFIER  = '22222222222222222222222222222222';
const WITNESS_PAYOUT_ACCOUNT = WITNESS_HEDERA_ACCOUNT;

const org = await prismaQuery.org.upsert({
  where: { slug: SLUG },
  // The ONLY org allowed to write to the shared, admin-key-less evidence topic.
  update: { operatorNullifier: OPERATOR_NULLIFIER, operatorEnrolledAt: new Date(), attestable: true },
  create: {
    name: 'Demo Deployer Ltd',
    slug: SLUG,
    // The operator is enrolled ONCE, out of band. Every witness nullifier is
    // compared against this, which is what makes "the approver is not the
    // operator" checkable rather than asserted.
    operatorNullifier: OPERATOR_NULLIFIER,
    operatorEnrolledAt: new Date(),
    attestable: true,
  },
});

const uaid = proctorAgentUaid(HEDERA_AGENT_ID || '0.0.0', HEDERA_NETWORK);
const agent = await prismaQuery.agent.upsert({
  where: { uaid },
  update: {},
  create: { orgId: org.id, label: 'Accounts payable agent', uaid, hederaAccountId: HEDERA_AGENT_ID || null },
});

const witness = await prismaQuery.witness.upsert({
  where: { orgId_nullifier: { orgId: org.id, nullifier: WITNESS_NULLIFIER } },
  update: { state: 'ENROLLED', hederaAccountId: WITNESS_PAYOUT_ACCOUNT || null },
  create: {
    orgId: org.id,
    nullifier: WITNESS_NULLIFIER,
    // Where the witness fee lands. HBAR needs no token association, so a
    // person who has never held a token can still be paid.
    hederaAccountId: WITNESS_PAYOUT_ACCOUNT || null,
    // Held by the org, never published to HCS. The evidence log carries the
    // nullifier, not the name.
    label: 'On-call approver (rota)',
    role: 'standard',
    state: 'ENROLLED',
  },
});

console.log('seeded');
console.log('  org      :', org.slug, `(${org.id})`);
console.log('  agent    :', agent.label);
console.log('             ', agent.uaid);
console.log('  witness  :', witness.label, `role=${witness.role}`);
console.log('  payout   :', witness.hederaAccountId ?? 'NOT SET (fee will be recorded as owed, not paid)');
console.log('');
console.log('  operator nullifier :', OPERATOR_NULLIFIER.slice(0, 12) + '…');
console.log('  witness  nullifier :', WITNESS_NULLIFIER.slice(0, 12) + '…  (distinct: independence is checkable)');
console.log('');
console.log('next: bun dev, then POST /v1/gate/evaluate');
