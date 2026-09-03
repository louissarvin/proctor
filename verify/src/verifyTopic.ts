/**
 * Walk an HCS topic and prove the running hash chain is intact.
 *
 * Proves, without trusting the mirror node, that no message was
 * inserted, removed, reordered, or altered.
 */
import { nextRunningHash, GENESIS_RUNNING_HASH } from './runningHash.ts';

export interface MirrorMessage {
  consensus_timestamp: string;
  message: string;              // base64
  payer_account_id: string;
  running_hash: string;         // base64
  running_hash_version: number;
  sequence_number: number;
  topic_id?: string;
}

export interface VerifyResult {
  ok: boolean;
  topicId: string;
  checked: number;
  /** Sequence number where the chain first broke. null when ok. */
  brokeAt: number | null;
  reason?: string;
  expected?: string;
  computed?: string;
}

/**
 * @param messages Mirror node rows in ASCENDING sequence order, UNMODIFIED.
 *                 The base64 `message` field must be byte-identical to what the
 *                 mirror node returned. Prettifying it breaks the chain.
 * @param startHash Previous running hash to chain from. Omit to start at genesis.
 */
export function verifyChain(
  topicId: string,
  messages: MirrorMessage[],
  startHash: Buffer = GENESIS_RUNNING_HASH,
): VerifyResult {
  let prev = startHash;
  let checked = 0;
  let expectedSeq: number | null = null;

  for (const m of messages) {
    // Gap detection: a removed message is as much a tamper as an altered one.
    if (expectedSeq !== null && m.sequence_number !== expectedSeq) {
      return {
        ok: false, topicId, checked, brokeAt: m.sequence_number,
        reason: `sequence gap: expected ${expectedSeq}, got ${m.sequence_number}`,
      };
    }

    const computed = nextRunningHash({
      prevRunningHash: prev,
      version: m.running_hash_version,
      payerAccountId: m.payer_account_id,
      topicId,
      consensusTimestamp: m.consensus_timestamp,
      sequenceNumber: m.sequence_number,
      messageBytes: Buffer.from(m.message, 'base64'),
    });

    const actual = Buffer.from(m.running_hash, 'base64');
    if (!computed.equals(actual)) {
      return {
        ok: false, topicId, checked, brokeAt: m.sequence_number,
        reason: 'running hash mismatch',
        expected: actual.toString('hex'),
        computed: computed.toString('hex'),
      };
    }

    prev = actual;
    checked++;
    expectedSeq = m.sequence_number + 1;
  }

  return { ok: true, topicId, checked, brokeAt: null };
}

/** Fetch every message on a topic, ascending, following pagination links. */
export async function fetchTopic(
  topicId: string,
  mirrorBase = 'https://testnet.mirrornode.hedera.com',
  limit = 100,
): Promise<MirrorMessage[]> {
  const out: MirrorMessage[] = [];
  let url: string | null =
    `${mirrorBase}/api/v1/topics/${topicId}/messages?limit=${limit}&order=asc`;

  while (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`mirror node ${res.status} for ${url}`);
    const page = (await res.json()) as { messages: MirrorMessage[]; links?: { next?: string | null } };
    out.push(...page.messages);
    const next = page.links?.next;
    url = next ? new URL(next, mirrorBase).toString() : null;
  }
  return out;
}
