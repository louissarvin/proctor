/**
 * Commit the next on-call retainer on chain.
 *
 *   bun run retainer            # dry run, shows what would be scheduled
 *   bun run retainer --confirm  # actually schedules it
 *   bun run retainer --confirm --in 300   # fire in 300 seconds
 *
 * The point of the exercise is that after this runs, the witness can verify
 * their next payment exists on Hedera without asking us and without trusting
 * that our server will still be running when it is due.
 */
import { prismaQuery } from '../src/lib/prisma.ts';
import { scheduleRetainer, MAX_SCHEDULE_SECONDS } from '../src/lib/payout/retainer.ts';
import { RETAINER_TINYBAR, HASHSCAN_BASE } from '../src/config/main-config.ts';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const seconds = Number(arg('in') ?? 24 * 60 * 60);
if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_SCHEDULE_SECONDS) {
  console.error(`--in must be between 1 and ${MAX_SCHEDULE_SECONDS} seconds (Hedera's long-term cap).`);
  process.exit(1);
}

const witness = await prismaQuery.witness.findFirst({
  where: { state: 'ENROLLED', hederaAccountId: { not: null } },
  orderBy: { enrolledAt: 'asc' },
});

if (!witness) {
  console.error('No enrolled witness with a payout account. Run: bun run seed');
  process.exit(1);
}

const executeAt = new Date(Date.now() + seconds * 1000);

console.log('On-call retainer');
console.log(`  witness   ${witness.label}`);
console.log(`  payout    ${witness.hederaAccountId}`);
console.log(`  amount    ${RETAINER_TINYBAR} tinybar`);
console.log(`  fires at  ${executeAt.toISOString()}  (in ${seconds}s)`);
console.log('  clock     HEDERA, not ours — it fires whether or not this server is running');

if (!process.argv.includes('--confirm')) {
  console.log('\nDRY RUN. Re-run with --confirm.');
  process.exit(0);
}

const r = await scheduleRetainer(witness.id, executeAt);

if (!r.ok) {
  console.error(`\nFAILED: ${r.reason}`);
  process.exit(1);
}

console.log(`\nscheduled ${r.scheduleId}`);
console.log(`  ${r.explorerUrl}`);
console.log('');
console.log('The witness can check that payment exists right now, without asking us:');
console.log(`  curl -s ${HASHSCAN_BASE.replace('hashscan.io/testnet', 'testnet.mirrornode.hedera.com/api/v1')}/schedules/${r.scheduleId} | jq`);

process.exit(0);
