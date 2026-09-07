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
import { verifyExport, type EvidenceExport } from '../src/verifyExport.ts';
import { verifyCompleteness } from '../src/completeness.ts';

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
  const doc = JSON.parse(await Bun.file(exportFlag).text()) as EvidenceExport;
  if (!doc.anchors?.topicId) { console.error('FAIL: export has no anchors.topicId'); process.exit(1); }

  console.log(`Verifying export ${exportFlag}`);
  console.log(`  topic    ${doc.anchors.topicId}`);
  console.log(`  records  ${doc.records?.length ?? 0}`);
  console.log(`  messages ${doc.hcsMessages?.length ?? 0}  (offline, no network)`);
  console.log('');

  const verdict = verifyExport(doc);

  const line = (ok: boolean, name: string, n: number) =>
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${n ? `  (${n} checked)` : '  (none present)'}`);

  line(verdict.chain.ok, 'HCS running hash chain, from genesis', verdict.chain.checked);
  if (!verdict.chain.ok) {
    console.log(`        broken at sequence ${verdict.chain.brokeAt}: ${verdict.chain.reason}`);
  }
  for (const c of verdict.checks) {
    line(c.ok, c.name, c.checked);
    for (const f of c.failures.slice(0, 5)) console.log(`        ${f}`);
    if (c.failures.length > 5) console.log(`        ... and ${c.failures.length - 5} more`);
  }

  console.log('');
  if (verdict.ok) {
    console.log('PASS  every checkable claim in this export holds.');
    console.log('      Nothing above contacted Proctor.');
    process.exit(0);
  }
  console.log('FAIL  this export is not evidence.');
  process.exit(1);
}

{
  topicId = topicFlag!;
  console.log(`Verifying topic ${topicId}`);
  console.log(`  mirror   ${mirror}`);
  messages = await fetchTopic(topicId, mirror);
  console.log(`  messages ${messages.length}  (fetched from the public mirror node)`);
}

const result = verifyChain(topicId, messages);

// Integrity and completeness are DIFFERENT claims, so report them separately.
// A log can be perfectly intact and still be missing the one record that
// mattered.
const gaps = verifyCompleteness(messages as never);

console.log('');
if (result.ok) {
  console.log(`PASS  ${result.checked} messages, chain intact from genesis.`);
  console.log('      No message was inserted, removed, reordered, or altered.');

  if (gaps.found.length === 0) {
    console.log('');
    console.log('SKIP  completeness: no numbered attestations on this topic.');
  } else if (gaps.ok) {
    console.log('');
    console.log(`PASS  completeness: issuance numbers dense across ${gaps.issuers} issuer(s).`);
    console.log('      No decision was withheld from this log.');
  } else {
    console.log('');
    // Deliberately NOT phrased as "was withheld".
    //
    // From outside, a decision that is still OPEN is indistinguishable from one
    // that was suppressed: both are simply absent. The operator knows which;
    // an auditor cannot. Asserting suppression here would be the same species
    // of overclaim this tool exists to detect, and during a live run it fires
    // constantly because decisions resolve out of order.
    console.log(`FAIL  completeness: ${gaps.missing.length} issuance number(s) absent from this log.`);
    if (gaps.reason) console.log(`      ${gaps.reason}`);
    console.log(`      absent: ${gaps.missing.join(', ')}`);
    console.log('');
    console.log('      Two readings, and this tool cannot tell them apart:');
    console.log('        1. those decisions are still open and have not resolved yet');
    console.log('        2. they resolved and were never written to this log');
    console.log('      Re-run after they resolve. A hole that PERSISTS is the finding.');
    process.exit(1);
  }
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
