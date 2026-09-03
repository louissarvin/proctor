#!/usr/bin/env bun
/**
 * Proctor evidence verifier.
 *
 * Recomputes the HCS running hash chain from genesis. If it prints PASS, no
 * message on that topic was inserted, removed, reordered, or altered, and you
 * did not have to trust Proctor or the mirror node operator to learn that.
 *
 *   bun bin/verify.ts --topic 0.0.4320226
 *   bun bin/verify.ts --export ./evidence.json
 */
import { verifyChain, fetchTopic, type MirrorMessage } from '../src/verifyTopic.ts';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const mirror = flag('mirror') ?? 'https://testnet.mirrornode.hedera.com';
const topicFlag = flag('topic');
const exportFlag = flag('export');

if (!topicFlag && !exportFlag) {
  console.error('usage: verify --topic <0.0.X> [--mirror <url>]');
  console.error('       verify --export <evidence.json>');
  process.exit(2);
}

let topicId: string;
let messages: MirrorMessage[];

if (exportFlag) {
  // Offline path: everything needed is inside the export. No network at all.
  const doc = JSON.parse(await Bun.file(exportFlag).text());
  topicId = doc.anchors?.topicId;
  messages = doc.hcsMessages ?? [];
  if (!topicId) { console.error('FAIL: export has no anchors.topicId'); process.exit(1); }
  console.log(`Verifying export ${exportFlag}`);
  console.log(`  topic    ${topicId}`);
  console.log(`  messages ${messages.length}  (offline, no network)`);
} else {
  topicId = topicFlag!;
  console.log(`Verifying topic ${topicId} via ${mirror}`);
  messages = await fetchTopic(topicId, mirror);
  console.log(`  fetched ${messages.length} messages`);
}

const result = verifyChain(topicId, messages);

console.log('');
if (result.ok) {
  console.log(`PASS  ${result.checked} messages, chain intact from genesis.`);
  console.log('      No message was inserted, removed, reordered, or altered.');
  process.exit(0);
}

console.log(`FAIL  chain broken at sequence number ${result.brokeAt}`);
console.log(`      reason: ${result.reason}`);
if (result.expected) {
  console.log(`      expected ${result.expected.slice(0, 64)}`);
  console.log(`      computed ${result.computed!.slice(0, 64)}`);
}
console.log(`      ${result.checked} messages verified before the break.`);
process.exit(1);
