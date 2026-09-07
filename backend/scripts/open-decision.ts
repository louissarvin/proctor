/**
 * Open a real decision and print the witness URL.
 *
 * Development and rehearsal helper: the witness PWA needs a live token to
 * render against, and waiting for a push notification while iterating on CSS is
 * a bad loop.
 *
 *   bun run open              # 60s deadline
 *   bun run open -- 300       # longer, for unhurried UI work
 */
import { prismaQuery } from '../src/lib/prisma.ts';
import { decisionHash, policyHash } from '../src/lib/attestation/hash.ts';
import { mintWitnessToken, mintNonce, dispatchDecision } from '../src/lib/decision/lifecycle.ts';
import { selectWitness } from '../src/lib/witness/dispatch.ts';
import { evaluatePolicy, DEMO_POLICY, type AgentAction } from '../src/lib/policy/evaluate.ts';
import { APP_PORT, WITNESS_APP_URL, DECISION_TTL_SECONDS } from '../src/config/main-config.ts';
import { issueDecision } from '../src/lib/decision/issue.ts';

const ttl = Number(process.argv[2] ?? DECISION_TTL_SECONDS);

const org = await prismaQuery.org.findFirst({ where: { slug: 'demo-org' } });
if (!org) { console.error('No demo org. Run: bun run seed'); process.exit(1); }
const agent = await prismaQuery.agent.findFirst({ where: { orgId: org.id } });
if (!agent) { console.error('No agent. Run: bun run seed'); process.exit(1); }

const action: AgentAction = {
  kind: 'transfer', asset: 'EUR', amount: '41200.00', counterparty: 'Meridian Logistics',
};
const policy = evaluatePolicy(action, DEMO_POLICY);
const nonce = mintNonce();
const { token, hash } = mintWitnessToken();
const preimage = { action, nonce, orgSlug: org.slug, agentUaid: agent.uaid, issuedAt: new Date().toISOString() };

const decision = await issueDecision(org.id, {
    agentId: agent.id, state: 'OPEN',
    preimage: preimage as never,
    decisionHash: decisionHash(preimage),
    humanLine: policy.humanLine,
    nonce, witnessTokenHash: hash, policyHash: policyHash(DEMO_POLICY),
    expiresAt: new Date(Date.now() + ttl * 1000),
});

const witness = await selectWitness(org.id, 'standard');
if (!witness) { console.error('No witness enrolled. Run: bun run seed'); process.exit(1); }
await dispatchDecision(decision.id, witness.id, ttl);

console.log('decision open, deadline running\n');
console.log('  decision  :', decision.id);
console.log('  ttl       :', ttl + 's');
console.log('  line      :', decision.humanLine);
console.log('');
console.log('  WITNESS   :', `${WITNESS_APP_URL}/w/${token}`);
// The operator-side screen. Open this on the laptop and let the witness scan it:
// a phone cannot resolve the operator's localhost, so handing over the raw
// witness URL only works if it already points somewhere the phone can reach.
console.log('  HANDOFF   :', `${WITNESS_APP_URL}/handoff/${token}`, '  <- show this, let the phone scan it');
console.log('  api       :', `http://localhost:${APP_PORT}/v1/witness/decisions/${token}`);
console.log('  stream    :', `http://localhost:${APP_PORT}/v1/gate/decisions/${decision.id}/stream`);
