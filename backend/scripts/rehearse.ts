/**
 * Demo-day dress rehearsal: the whole loop through the REAL HTTP routes.
 *
 * `bun run demo` calls the libraries directly. That proves the mechanism but
 * skips every seam that only exists over HTTP — token auth, the RP signature
 * round trip, request validation, the response envelopes the PWA actually
 * parses. Three of the worst defects in this repo lived in exactly those seams
 * and passed a green unit suite.
 *
 * It also prints a LATENCY BUDGET per leg, because the video's hardest problem
 * is the wait: knowing which second is spent where is the difference between
 * cutting dead air and cutting the evidence.
 *
 *   bun run rehearse            # approve
 *   bun run rehearse refuse
 *
 * Read-only against a running server. It resolves one real decision and
 * therefore writes one real record, so point it at the demo org.
 */
import { hashSignal } from '@worldcoin/idkit-core/hashing';
import { prismaQuery } from '../src/lib/prisma.ts';
import { APP_PORT, WORLD_MODE, WORLD_ACTION } from '../src/config/main-config.ts';

const API = `http://localhost:${APP_PORT}`;
const choice = (process.argv[2] ?? 'approve').toUpperCase() as 'APPROVE' | 'REFUSE';

interface Leg { name: string; ms: number; note: string }
const legs: Leg[] = [];

const time = async <T>(name: string, note: string, fn: () => Promise<T>): Promise<T> => {
  const t0 = Date.now();
  const out = await fn();
  legs.push({ name, ms: Date.now() - t0, note });
  return out;
};

const json = async (res: Response) => {
  const body = await res.json() as { success?: boolean; data?: unknown; error?: { message?: string } };
  if (!res.ok || body.success === false) {
    throw new Error(`${res.status} ${body.error?.message ?? JSON.stringify(body).slice(0, 200)}`);
  }
  return body.data as never;
};

console.log(`\nRehearsal — ${choice}, through the real HTTP routes\n`);

// --- 0. the server must be up, and honest about what it can prove ----------
const roots = await (await fetch(`${API}/.well-known/proctor.json`)).json() as {
  hcs: { topicId: string | null }; attestor: { address: string }; world: { mode: string };
};
console.log(`  topic    ${roots.hcs.topicId ?? 'NOT CONFIGURED'}`);
console.log(`  attestor ${roots.attestor.address}`);
console.log(`  world    ${roots.world.mode}\n`);

// --- 1. open a decision ----------------------------------------------------
// Through the script rather than the gate, because paying the gate needs a
// funded agent and this rehearsal is about the HUMAN legs. `bun run agent`
// covers the payment leg separately.
const { spawnSync } = await import('node:child_process');
const opened = await time('open decision', 'policy fires, witness selected, push dispatched', async () => {
  const r = spawnSync('bun', ['scripts/open-decision.ts', '120'], { encoding: 'utf8' });
  const token = /w\/([A-Za-z0-9_-]+)/.exec(r.stdout)?.[1];
  if (!token) throw new Error(`could not open a decision:\n${r.stdout}\n${r.stderr}`);
  return token;
});

// --- 2. the phone loads the decision --------------------------------------
const decision = await time('GET witness decision', 'what the PWA renders', async () =>
  json(await fetch(`${API}/v1/witness/decisions/${opened}`)),
) as { decisionId: string; humanLine: string; signal: string; expiresAt: string };

console.log(`  "${decision.humanLine}"`);
console.log(`  signal ${decision.signal.slice(0, 26)}…\n`);

// --- 3. mint the RP signature ---------------------------------------------
// The single point of failure for the Approve button: until this returns, the
// widget cannot open and the button reads "Preparing…".
let rpNonce = '';
if (choice === 'APPROVE') {
  const sig = await time('POST rp-signature', 'ES256 over the RP payload, single-use nonce', async () =>
    json(await fetch(`${API}/v1/witness/rp-signature`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ witnessToken: opened }),
    })),
  ) as { nonce: string };
  // The proof must carry THIS nonce. Inventing one is rejected as
  // duplicate_nonce, which is assertion 6 doing its job: a proof that does not
  // answer the challenge we issued is a replay, whatever else is right about it.
  rpNonce = sig.nonce;
}

// --- 4. respond ------------------------------------------------------------
const identifier = WORLD_MODE === 'SELFIE' ? 'selfie' : 'device';
const witnessRow = await prismaQuery.worldProof.findFirst().catch(() => null);
void witnessRow;

const resolved = await time('POST respond', 'seven assertions, then one conditional UPDATE', async () => {
  const body: Record<string, unknown> = { choice };
  if (choice === 'APPROVE') {
    const w = await prismaQuery.decision.findUniqueOrThrow({
      where: { id: decision.decisionId },
      select: { witness: { select: { nullifier: true } } },
    });
    body.idkitResult = {
      protocol_version: '3.0',
      nonce: rpNonce,
      action: WORLD_ACTION,
      // deviceLegacy carries no liveness of its own, so the widget requests
      // require_user_presence and the backend REQUIRES the result.
      user_presence_completed: true,
      responses: [{
        identifier,
        signal_hash: hashSignal(decision.signal),
        nullifier: '0x' + BigInt(w.witness!.nullifier.toFixed(0)).toString(16),
      }],
    };
  }
  const res = await fetch(`${API}/v1/witness/decisions/${opened}/respond`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  // THE APPROVE PATH CANNOT BE FAKED, and that is the correct design.
  //
  // This route forwards the proof to World's own verifier. A synthetic proof is
  // rejected there no matter how well-formed it is locally, so an approval on
  // camera requires a real credential from the Sandbox App. Worth knowing before
  // the shoot rather than during it. The REFUSE path needs no proof and
  // rehearses fully.
  if (res.status === 400 && choice === 'APPROVE') {
    const b = await res.json() as { error?: { code?: string } };
    if (b.error?.code === 'VERIFICATION_FAILED') {
      console.log('  \x1b[33mAPPROVE needs a REAL World proof.\x1b[0m');
      console.log('  The route forwards it to World, which correctly rejects a synthetic one.');
      console.log('  Rehearse the refusal fully with:  bun run rehearse refuse');
      console.log('  The approval needs the Sandbox App on a phone.\n');
      process.exit(2);
    }
  }
  return json(res);
}) as { outcome: string; reviewMs: number; witnessAuth: string; independence: string };

console.log(`  outcome ${resolved.outcome}  ·  wa=${resolved.witnessAuth}  ind=${resolved.independence}  review ${resolved.reviewMs}ms\n`);

// --- 5. the evidence, which lands AFTER the agent is released --------------
const seq = await time('attestation reaches HCS', 'off the critical path, so the agent never waits', async () => {
  for (let i = 0; i < 40; i++) {
    const d = await prismaQuery.attestation.findUnique({
      where: { decisionId: decision.decisionId },
      select: { sequenceNumber: true },
    });
    if (d?.sequenceNumber) return d.sequenceNumber.toString();
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
});

const paid = await time('witness fee settles', 'a refusal is paid exactly like an approval', async () => {
  for (let i = 0; i < 40; i++) {
    const p = await prismaQuery.payment.findFirst({
      where: { decisionId: decision.decisionId, leg: 'WITNESS_FEE' },
      select: { state: true, amountUsd: true, explorerUrl: true },
    });
    if (p && p.state !== 'QUOTED') return p;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
});

// --- 6. report -------------------------------------------------------------
console.log('  leg                          ms   what the camera sees');
console.log('  ' + '-'.repeat(74));
for (const l of legs) {
  console.log(`  ${l.name.padEnd(28)}${String(l.ms).padStart(5)}   ${l.note}`);
}
const human = legs.filter((l) => l.name !== 'open decision').reduce((a, l) => a + l.ms, 0);
console.log('  ' + '-'.repeat(74));
console.log(`  ${'human-visible total'.padEnd(28)}${String(human).padStart(5)}\n`);

console.log(`  evidence log   ${seq ? `HCS seq #${seq}` : 'NOT WRITTEN'}`);
console.log(`  witness paid   ${paid ? `${paid.state} $${paid.amountUsd}` : 'NOT SETTLED'}`);
if (paid?.explorerUrl) console.log(`                 ${paid.explorerUrl}`);

const ok = Boolean(seq) && paid?.state === 'SETTLED';
console.log(`\n  ${ok ? '\x1b[32mFull loop green through the real routes.\x1b[0m' : '\x1b[33mLoop completed with gaps above.\x1b[0m'}\n`);

process.exit(ok ? 0 : 1);
