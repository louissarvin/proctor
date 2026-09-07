/**
 * The live demo, in one command.
 *
 *   bun run live            # 5 minute deadline
 *   bun run live 120        # shorter, for a tighter take
 *   bun run live 300 --pay  # a REAL agent payment opens the run first
 *
 * Opens a real decision, pops the operator handoff screen on this laptop, and
 * then streams the decision's state to the terminal until a human on a phone
 * resolves it. Nothing here is staged: the deadline is real, the refusal is
 * real, and the evidence lands on a topic nobody can edit.
 *
 * Why the handoff screen rather than a push notification: web push needs the
 * witness to have installed the PWA and granted permission, and on iOS that
 * means Add to Home Screen first. Zero witnesses are subscribed on a fresh
 * machine, so a demo built on push would silently do nothing. Scanning a code
 * always works, and it shows the operator/witness split on camera.
 */
import { spawnSync } from 'node:child_process';
import { prismaQuery } from '../src/lib/prisma.ts';
import { decisionHash, policyHash } from '../src/lib/attestation/hash.ts';
import { mintWitnessToken, mintNonce, dispatchDecision } from '../src/lib/decision/lifecycle.ts';
import { selectWitness } from '../src/lib/witness/dispatch.ts';
import { evaluatePolicy, DEMO_POLICY, type AgentAction } from '../src/lib/policy/evaluate.ts';
import { issueDecision } from '../src/lib/decision/issue.ts';
import { APP_PORT, WITNESS_APP_URL, HEDERA_TOPIC_ID, HASHSCAN_BASE } from '../src/config/main-config.ts';

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', B = '\x1b[1m', D = '\x1b[2m', X = '\x1b[0m';
const API = `http://localhost:${APP_PORT}`;

const args = process.argv.slice(2);
const ttl = Number(args.find((a) => /^\d+$/.test(a)) ?? 300);
const withPay = args.includes('--pay');

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

if (WITNESS_APP_URL.includes('localhost')) {
  console.log(`\n${Y}WITNESS_APP_URL is ${WITNESS_APP_URL}${X}`);
  console.log('A phone cannot resolve your laptop\'s localhost. Set it to your LAN address:');
  console.log(`  ${D}WITNESS_APP_URL="http://$(ipconfig getifaddr en0):3200"${X}\n`);
  process.exit(1);
}

console.log(`\n${B}Proctor live${X}  ${D}deadline ${ttl}s${X}\n`);

// --- optional: real money, through the real agent ---------------------------
if (withPay) {
  console.log(`${D}an agent is attempting a payment...${X}`);
  const pay = spawnSync('bun', ['run', 'pay'], {
    cwd: new URL('../../agent', import.meta.url).pathname, encoding: 'utf8', timeout: 120_000,
  });
  const out = `${pay.stdout ?? ''}${pay.stderr ?? ''}`;
  const tx = /transaction :\s+(\S+)/.exec(out)?.[1];
  const payer = /payer\s+:\s+(\S+)/.exec(out)?.[1];
  console.log(tx ? `  ${G}paid${X}  ${payer} -> settled ${tx}\n` : `  ${R}payment failed${X}\n`);
}

// --- open a real decision ---------------------------------------------------
const org = await prismaQuery.org.findFirst({ where: { slug: 'demo-org' } });
const agent = org ? await prismaQuery.agent.findFirst({ where: { orgId: org.id } }) : null;
if (!org || !agent) { console.error('Run: bun run seed'); process.exit(1); }

const action: AgentAction = { kind: 'transfer', asset: 'EUR', amount: '41200.00', counterparty: 'Meridian Logistics' };
const nonce = mintNonce();
const { token, hash } = mintWitnessToken();
const preimage = { action, nonce, orgSlug: org.slug, agentUaid: agent.uaid, issuedAt: new Date().toISOString() };
const decision = await issueDecision(org.id, {
  agentId: agent.id, state: 'OPEN',
  preimage: preimage as never,
  decisionHash: decisionHash(preimage),
  humanLine: evaluatePolicy(action, DEMO_POLICY).humanLine,
  nonce, witnessTokenHash: hash, policyHash: policyHash(DEMO_POLICY),
  expiresAt: new Date(Date.now() + ttl * 1000),
});
const witness = await selectWitness(org.id, 'standard');
if (!witness) { console.error('No witness enrolled. Run: bun run seed'); process.exit(1); }
await dispatchDecision(decision.id, witness.id, ttl);

const handoff = `${WITNESS_APP_URL}/handoff/${token}`;
console.log(`  ${B}"${decision.humanLine}"${X}`);
console.log(`  ${D}the agent is now blocked. it cannot proceed unless a person says so.${X}\n`);
console.log(`  handoff  ${handoff}   ${D}<- scan this${X}`);
console.log(`  witness  ${WITNESS_APP_URL}/w/${token}\n`);

// Pop the operator screen on this machine so the camera has something to show.
const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
const popped = spawnSync(opener, [handoff], { stdio: 'ignore' });
if (popped.status !== 0) console.log(`  ${Y}could not open a browser. Open the handoff URL yourself.${X}\n`);

// --- watch it, live ---------------------------------------------------------
const started = Date.now();
let last = '';
let outcome: string | null = null;

while (Date.now() - started < (ttl + 20) * 1000) {
  const d = await prismaQuery.decision.findUnique({
    where: { id: decision.id },
    include: { attestation: true, payments: true },
  });
  if (!d) break;

  const left = Math.max(0, Math.ceil((d.expiresAt.getTime() - Date.now()) / 1000));
  if (d.state !== last) {
    last = d.state;
    console.log(`  ${D}${new Date().toISOString().slice(11, 19)}${X}  state ${B}${d.state}${X}`);
  }
  if (!outcome && d.outcome) {
    outcome = d.outcome;
    const good = d.outcome === 'APPROVE';
    console.log(`\n  ${good ? G : R}${d.outcome}${X}  ${D}after ${((Date.now() - started) / 1000).toFixed(1)}s${X}`);
    if (!good) console.log(`  ${D}the agent is NOT released.${X}`);
  }
  if (outcome) {
    // The evidence lands after the agent is released, never on its critical path.
    if (d.attestation?.sequenceNumber) {
      console.log(`\n  evidence  HCS seq #${d.attestation.sequenceNumber}`);
      console.log(`            ${HASHSCAN_BASE}/topic/${HEDERA_TOPIC_ID}`);
      const paid = d.payments.find((p) => p.state === 'SETTLED');
      if (paid) console.log(`  witness   paid $${paid.amountUsd.toString()}  ${paid.explorerUrl ?? ''}`);
      console.log(`\n  ${D}verify it without trusting us:${X}`);
      console.log(`    cd verify && bun bin/verify.ts --topic ${HEDERA_TOPIC_ID}\n`);
      break;
    }
  } else if (left === 0) {
    console.log(`  ${Y}deadline passed. the sweeper refuses it by default.${X}`);
  }
  await sleep(1000);
}

if (!outcome) console.log(`\n  ${Y}nothing resolved in time.${X}\n`);
process.exit(0);
