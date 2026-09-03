/**
 * Hermetic tests. No network. Fixture is real mirror node output, unmodified.
 *
 * If these pass, the running hash implementation reproduces Hedera consensus
 * exactly, and any tamper is detected with the sequence number named.
 */
import { test, expect } from 'bun:test';
import { nextRunningHash, GENESIS_RUNNING_HASH } from '../src/runningHash.ts';
import { verifyChain, type MirrorMessage } from '../src/verifyTopic.ts';
import fixture from './fixture-topic-0.0.4320226.json';

const TOPIC = fixture.topicId;
const MESSAGES = fixture.messages as unknown as MirrorMessage[];
const clone = () => JSON.parse(JSON.stringify(MESSAGES)) as MirrorMessage[];

test('reproduces the real chain from genesis', () => {
  const r = verifyChain(TOPIC, MESSAGES);
  expect(r.ok).toBe(true);
  expect(r.checked).toBe(MESSAGES.length);
  expect(r.brokeAt).toBeNull();
});

test('first message chains from 48 zero bytes', () => {
  const m = MESSAGES[0]!;
  const computed = nextRunningHash({
    prevRunningHash: GENESIS_RUNNING_HASH,
    version: m.running_hash_version,
    payerAccountId: m.payer_account_id,
    topicId: TOPIC,
    consensusTimestamp: m.consensus_timestamp,
    sequenceNumber: m.sequence_number,
    messageBytes: Buffer.from(m.message, 'base64'),
  });
  expect(computed.toString('base64')).toBe(m.running_hash);
  expect(computed.length).toBe(48);
});

test('detects a single flipped bit', () => {
  const msgs = clone();
  const b = Buffer.from(msgs[3]!.message, 'base64');
  b[0] = b[0]! ^ 0x01;
  msgs[3]!.message = b.toString('base64');

  const r = verifyChain(TOPIC, msgs);
  expect(r.ok).toBe(false);
  expect(r.brokeAt).toBe(msgs[3]!.sequence_number);
  expect(r.reason).toBe('running hash mismatch');
});

test('detects a removed message as a sequence gap', () => {
  const msgs = clone();
  msgs.splice(3, 1);
  const r = verifyChain(TOPIC, msgs);
  expect(r.ok).toBe(false);
  expect(r.reason).toContain('sequence gap');
});

test('detects reordering', () => {
  const msgs = clone();
  [msgs[2], msgs[3]] = [msgs[3]!, msgs[2]!];
  expect(verifyChain(TOPIC, msgs).ok).toBe(false);
});

test('detects an inserted forged message', () => {
  const msgs = clone();
  msgs.splice(3, 0, { ...msgs[3]!, message: Buffer.from('forged').toString('base64') });
  expect(verifyChain(TOPIC, msgs).ok).toBe(false);
});

test('detects a backdated consensus timestamp', () => {
  const msgs = clone();
  msgs[3]!.consensus_timestamp = '1600000000.000000000';
  const r = verifyChain(TOPIC, msgs);
  expect(r.ok).toBe(false);
  expect(r.brokeAt).toBe(msgs[3]!.sequence_number);
});

test('THE FOOTGUN: hashing the documented field list alone is WRONG', () => {
  // The protobuf documents twelve fields. Concatenating them raw does not
  // reproduce consensus, because the node serialises through a Java
  // ObjectOutputStream and the framing bytes are part of the digest.
  const crypto = require('node:crypto');
  const sha384 = (b: Buffer) => crypto.createHash('sha384').update(b).digest();
  const i64 = (v: any) => { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(v)); return b; };
  const i32 = (v: any) => { const b = Buffer.alloc(4); b.writeInt32BE(Number(v)); return b; };

  const m = MESSAGES[0]!;
  const [ps, pr, pn] = m.payer_account_id.split('.');
  const [ts, tr, tn] = TOPIC.split('.');
  const [secs, nanos] = m.consensus_timestamp.split('.');

  const naive = sha384(Buffer.concat([
    GENESIS_RUNNING_HASH, i64(m.running_hash_version),
    i64(ps!), i64(pr!), i64(pn!), i64(ts!), i64(tr!), i64(tn!),
    i64(secs!), i32(nanos!.padEnd(9, '0')), i64(m.sequence_number),
    sha384(Buffer.from(m.message, 'base64')),
  ]));

  expect(naive.toString('base64')).not.toBe(m.running_hash);   // the trap
});
