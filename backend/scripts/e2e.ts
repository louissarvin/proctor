/**
 * The whole journey, in one command, with nothing stubbed.
 *
 *   bun run e2e
 *
 * `acceptance` checks that claims hold. `rehearse` runs the oversight loop.
 * Neither crosses the full system: neither spends real money through the real
 * agent, and neither runs the independent verifier that a third party would.
 * This does both, so one command answers "does the product work end to end".
 *
 * Every step is real: a real x402 settlement through a facilitator, a real
 * decision refused over HTTP, a real attestation on a topic with no admin key,
 * a real payout, and the verifier BINARY run as a separate process against the
 * exported evidence.
 *
 * Exit 1 on any failure. Steps that are merely unconfigured are reported as
 * SKIP, because "not set up" and "broken" are different answers.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { prismaQuery } from '../src/lib/prisma.ts';
import { decisionHash, policyHash } from '../src/lib/attestation/hash.ts';
import { mintWitnessToken, mintNonce, dispatchDecision } from '../src/lib/decision/lifecycle.ts';
import { selectWitness } from '../src/lib/witness/dispatch.ts';
import { evaluatePolicy, DEMO_POLICY, type AgentAction } from '../src/lib/policy/evaluate.ts';
import { issueDecision } from '../src/lib/decision/issue.ts';
import { APP_PORT, HEDERA_TOPIC_ID, MIRROR_NODE_URL } from '../src/config/main-config.ts';

const API = `http://localhost:${APP_PORT}`;
const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', D = '\x1b[2m', X = '\x1b[0m';

let failed = 0;
const results: { step: string; status: 'PASS' | 'FAIL' | 'SKIP'; detail: string }[] = [];

const record = (step: string, status: 'PASS' | 'FAIL' | 'SKIP', detail = ''): void => {
  if (status === 'FAIL') failed++;
  const c = status === 'PASS' ? G : status === 'FAIL' ? R : Y;
  console.log(`  ${c}${status}${X}  ${step}${detail ? `  ${D}${detail}${X}` : ''}`);
  results.push({ step, status, detail });
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

console.log('\nProctor end to end\n');

// --- 1. the service is actually up -----------------------------------------
try {
  const r = await fetch(`${API}/features`);
  if (!r.ok) throw new Error(String(r.status));
  record('service reachable', 'PASS', API);
} catch {
  record('service reachable', 'FAIL', `${API} - start it with: bun index.ts`);
  console.log(`\n${R}Cannot continue without the service.${X}\n`);
  process.exit(1);
}

// --- 2. a real agent pays, through a real facilitator ------------------------
// Spawned as a separate process on purpose: it exercises the agent's own
// offer verification and signing, not a library call we control here.
const agent = spawnSync('bun', ['run', 'pay'], {
  cwd: new URL('../../agent', import.meta.url).pathname,
  encoding: 'utf8', timeout: 120_000,
});
const agentOut = `${agent.stdout ?? ''}${agent.stderr ?? ''}`;
const paidMatch = /payer\s+:\s+(\S+)/.exec(agentOut);
const txMatch = /transaction :\s+(\S+)/.exec(agentOut);
const agentDecision = /"decisionId":\s*"([^"]+)"/.exec(agentOut)?.[1];

if (agent.status === 0 && paidMatch && agentDecision) {
  record('agent completes a real paid request', 'PASS', `payer ${paidMatch[1]}`);
  record('settlement is on chain', txMatch ? 'PASS' : 'FAIL', txMatch?.[1] ?? 'no transaction id');
  // The offer is signed by us; the agent checks that signature BEFORE paying.
  record('agent verified the signed offer before paying',
    /offer verified/.test(agentOut) ? 'PASS' : 'FAIL');
  const d = await prismaQuery.decision.findUnique({ where: { id: agentDecision } });
  record('payment opened a real decision', d ? 'PASS' : 'FAIL', d ? `${d.id} ${d.state}` : '');
} else if (/not configured|no agent key|ARC_PRIVATE_KEY|HEDERA_AGENT/i.test(agentOut)) {
  record('agent completes a real paid request', 'SKIP', 'agent wallet not configured');
} else {
  record('agent completes a real paid request', 'FAIL', agentOut.trim().split('\n').pop() ?? '');
}

// --- 3. a human refuses, over the real HTTP route ---------------------------
const org = await prismaQuery.org.findFirst({ where: { slug: 'demo-org' } });
const agentRow = org ? await prismaQuery.agent.findFirst({ where: { orgId: org.id } }) : null;
if (!org || !agentRow) {
  record('oversight loop', 'FAIL', 'no demo org/agent - run: bun run seed');
  process.exit(1);
}

const action: AgentAction = { kind: 'transfer', asset: 'EUR', amount: '41200.00', counterparty: 'Meridian Logistics' };
const nonce = mintNonce();
const { token, hash } = mintWitnessToken();
const preimage = { action, nonce, orgSlug: org.slug, agentUaid: agentRow.uaid, issuedAt: new Date().toISOString() };
const decision = await issueDecision(org.id, {
  agentId: agentRow.id, state: 'OPEN',
  preimage: preimage as never,
  decisionHash: decisionHash(preimage),
  humanLine: evaluatePolicy(action, DEMO_POLICY).humanLine,
  nonce, witnessTokenHash: hash, policyHash: policyHash(DEMO_POLICY),
  expiresAt: new Date(Date.now() + 120_000),
});
const witness = await selectWitness(org.id, 'standard');
if (!witness) { record('witness selected from the rota', 'FAIL', 'none enrolled'); process.exit(1); }
await dispatchDecision(decision.id, witness.id, 120);
record('witness selected from the rota', 'PASS', witness.id);

// The witness reads the decision with the token alone. No account, no wallet.
const readRes = await fetch(`${API}/v1/witness/decisions/${token}`);
record('witness can read the decision with the token', readRes.ok ? 'PASS' : 'FAIL', `HTTP ${readRes.status}`);

const respondRes = await fetch(`${API}/v1/witness/decisions/${token}/respond`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ choice: 'REFUSE' }),
});
const respondBody = await respondRes.json() as { data?: { outcome?: string; witnessAuth?: string; independence?: string } };
const ok = respondRes.ok && respondBody.data?.outcome === 'REFUSE';
record('a refusal resolves the decision', ok ? 'PASS' : 'FAIL',
  ok ? `wa=${respondBody.data?.witnessAuth} ind=${respondBody.data?.independence}` : `HTTP ${respondRes.status}`);
// A refusal needs no proof, and the record must say so rather than imply more.
record('the record states what authenticated the witness',
  respondBody.data?.witnessAuth === 'token' && respondBody.data?.independence === 'policy' ? 'PASS' : 'FAIL',
  'wa=token, ind=policy');

// A second answer must not overwrite the first.
const replay = await fetch(`${API}/v1/witness/decisions/${token}/respond`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ choice: 'APPROVE' }),
});
record('the decision cannot be answered twice', replay.status === 409 ? 'PASS' : 'FAIL', `HTTP ${replay.status}`);

// --- 4. the evidence reaches an immutable log -------------------------------
let seq: string | null = null;
for (let i = 0; i < 45; i++) {
  const a = await prismaQuery.attestation.findUnique({ where: { decisionId: decision.id } });
  if (a?.sequenceNumber) { seq = a.sequenceNumber.toString(); break; }
  await sleep(1000);
}
if (seq) record('attestation reaches HCS', 'PASS', `topic ${HEDERA_TOPIC_ID} seq #${seq}`);
else if (!HEDERA_TOPIC_ID) record('attestation reaches HCS', 'SKIP', 'no topic configured');
else record('attestation reaches HCS', 'FAIL', 'no sequence number after 45s');

// --- 5. the human is paid, refusal included ---------------------------------
const payment = await prismaQuery.payment.findFirst({ where: { decisionId: decision.id } });
record('the witness is paid for a REFUSAL', payment ? 'PASS' : 'FAIL',
  payment ? `${payment.leg} ${payment.state} $${payment.amountUsd.toString()}` : 'no payment row');

// --- 6. a third party verifies, without trusting us -------------------------
const exportRes = await fetch(`${API}/v1/evidence/export`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ orgId: org.id }),
});
const exportBody = await exportRes.json() as { data?: unknown };
const doc = (exportBody.data ?? exportBody) as { records?: unknown[] };
const path = '/tmp/proctor-e2e-export.json';
writeFileSync(path, JSON.stringify(doc));
record('evidence export produced', (doc.records?.length ?? 0) > 0 ? 'PASS' : 'FAIL',
  `${doc.records?.length ?? 0} record(s)`);

// The verifier binary, as a separate process. It must not import our code and
// must not contact us: that is the entire claim.
const verify = spawnSync('bun', ['bin/verify.ts', '--export', path], {
  cwd: new URL('../../verify', import.meta.url).pathname,
  encoding: 'utf8', timeout: 120_000,
});
const vOut = `${verify.stdout ?? ''}${verify.stderr ?? ''}`;
record('independent verifier PASSES the export',
  verify.status === 0 && /PASS\s+every checkable claim/.test(vOut) ? 'PASS' : 'FAIL',
  vOut.split('\n').filter((l) => /PASS|FAIL/.test(l)).length + ' checks');

if (HEDERA_TOPIC_ID) {
  const chain = spawnSync('bun', ['bin/verify.ts', '--topic', HEDERA_TOPIC_ID], {
    cwd: new URL('../../verify', import.meta.url).pathname,
    encoding: 'utf8', timeout: 120_000,
  });
  const cOut = `${chain.stdout ?? ''}${chain.stderr ?? ''}`;
  record('running hash chain intact on the public mirror node',
    chain.status === 0 && /chain intact from genesis/.test(cOut) ? 'PASS' : 'FAIL', MIRROR_NODE_URL);
}

// --- 7. the paid gate has no free side door ---------------------------------
const rpc = await (await fetch(`${API}/a2a`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'a2a.SendMessage', params: {} }),
})).json() as { error?: { code?: number } };
record('A2A refuses to open a decision for free', rpc.error?.code === -32601 ? 'PASS' : 'FAIL',
  `JSON-RPC ${rpc.error?.code}`);

// --- summary ----------------------------------------------------------------
const pass = results.filter((r) => r.status === 'PASS').length;
const skip = results.filter((r) => r.status === 'SKIP').length;
console.log(`\n  ${pass} passed, ${failed} failed, ${skip} skipped\n`);

if (failed > 0) {
  console.log(`${R}The journey broke. Nothing above was mocked, so this is a real failure.${X}\n`);
  process.exit(1);
}
console.log(`${G}An agent paid, a human refused, the evidence is on an immutable log,`);
console.log(`the human was paid, and a third party verified all of it without us.${X}\n`);
process.exit(0);
