/**
 * Mint the evidence topic. Run ONCE, then put the id in HEDERA_TOPIC_ID.
 *
 * THERE IS NO UNDO. A topic with no admin key cannot be updated or deleted by
 * anyone, ever, including us. The memo is permanent and public. Get it right
 * the first time, because the second time is a different topic and a different
 * id in every document that cites it.
 *
 *   bun scripts/create-topic.ts --memo "Proctor oversight evidence log v2" --confirm
 *
 * Without --confirm it prints what it would do and exits, because an
 * irreversible chain write should not be one stray shell-history arrow away.
 */
import { createEvidenceTopic } from '../src/lib/hedera/hcs.ts';
import { hederaConfigured } from '../src/lib/hedera/client.ts';
import { HEDERA_TOPIC_ID, HEDERA_NETWORK, HASHSCAN_BASE } from '../src/config/main-config.ts';

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const memo = flag('memo') ?? 'Proctor oversight evidence log v1';
const confirmed = args.includes('--confirm');

if (!hederaConfigured()) {
  console.error('HEDERA_OPERATOR_ID / HEDERA_OPERATOR_KEY are not configured.');
  process.exit(1);
}

// 100 bytes is the protocol limit, and it truncates rather than failing.
const memoBytes = Buffer.byteLength(memo, 'utf8');

console.log('About to create an HCS topic.');
console.log(`  network   ${HEDERA_NETWORK}`);
console.log(`  memo      "${memo}"  (${memoBytes} bytes, max 100)`);
console.log('  adminKey  NONE     <- immutable and undeletable, by anyone, forever');
console.log('  submitKey operator <- only we can append');
console.log(`  cost      ~$0.01`);

if (memoBytes > 100) {
  console.error('\nFAIL: memo exceeds 100 bytes and would be truncated on chain.');
  process.exit(1);
}

if (HEDERA_TOPIC_ID) {
  console.log(`\nNOTE: HEDERA_TOPIC_ID is already set to ${HEDERA_TOPIC_ID}.`);
  console.log('      Creating another topic does not retire it. The old one is permanent.');
}

if (!confirmed) {
  console.log('\nDRY RUN. Nothing was created. Re-run with --confirm to actually mint it.');
  process.exit(0);
}

const topicId = await createEvidenceTopic(memo);

console.log(`\nCreated ${topicId}`);
console.log(`  ${HASHSCAN_BASE}/topic/${topicId}`);
console.log('\nNext:');
console.log(`  1. set HEDERA_TOPIC_ID="${topicId}" in backend/.env`);
console.log('  2. update the topic id in README.md and docs/hashscan-links.md');
console.log('  3. bun run seed && bun run demo && bun run demo refuse');
console.log(`  4. bun ../verify/bin/verify.ts --topic ${topicId}`);

// The SDK client keeps the event loop alive, so the script hangs after doing
// its work. Both earlier runs of these scripts had to be killed, and killing
// create-witness-account.ts is how account 0.0.10389138 lost its key.
process.exit(0);
