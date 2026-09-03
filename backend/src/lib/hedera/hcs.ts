/**
 * HCS: the evidence substrate.
 *
 * Why a topic and not a contract: an HCS message costs $0.0008, carries a
 * consensus timestamp assigned by the network, and links into a running hash
 * chain that a third party can recompute offline. A contract write costs more,
 * has no better timestamp, and gives up the chain property entirely.
 */
import { TopicCreateTransaction, TopicMessageSubmitTransaction, TopicId, PrivateKey } from '@hiero-ledger/sdk';
import { hederaClient } from './client.ts';
import {
  HEDERA_OPERATOR_KEY, HEDERA_TOPIC_ID, MIRROR_NODE_URL, HASHSCAN_BASE,
  ATTESTATION_MAX_BYTES,
} from '../../config/main-config.ts';

/** Protobuf: "All new transactions SHALL use topicRunningHashVersion 3." */
export const ASSUMED_RUNNING_HASH_VERSION = 3;

export interface SubmitReceipt {
  sequenceNumber: string;
  /** 48 bytes, base64, straight from the receipt. */
  runningHash: string;
  /**
   * SDK GAP: the consensus protobuf defines `topicRunningHashVersion` on the
   * receipt, but @hiero-ledger/sdk 2.85.0 does not surface it. The receipt
   * exposes only topicId, topicSequenceNumber and topicRunningHash.
   *
   * The protobuf states "All new transactions SHALL use
   * topicRunningHashVersion 3", so 3 is the correct assumption for anything
   * written today. We do not guess silently: the mirror node returns
   * `running_hash_version` per message and confirmAttestation() checks it, so
   * a future version bump surfaces as a mismatch rather than a wrong hash.
   */
  runningHashVersion: number;
  transactionId: string;
  topicId: string;
  explorerUrl: string;
}

/**
 * Create the evidence topic. Run ONCE; put the id in HEDERA_TOPIC_ID.
 *
 * NO ADMIN KEY. Per the Hedera docs: "If no adminKey is specified the topic is
 * immutable." Nobody can update or delete it, INCLUDING US. That is the point,
 * and it is the sentence to say out loud.
 *
 * There is no undo. The memo cannot be changed afterwards.
 *
 * A SUBMIT KEY, yes: without one, any account on Hedera can append to the
 * topic and an auditor could not distinguish a genuine attestation from an
 * attacker's. Be honest about what it does NOT buy: we hold it, so we can
 * still write a FALSE entry. HCS prevents us retroactively editing or deleting
 * what we already wrote, and binds each entry to a timestamp we did not
 * choose. Combined with a liveness proof and a nullifier issued by parties who
 * are not the deployer, the composite is what a Postgres table cannot give.
 */
export const createEvidenceTopic = async (memo: string): Promise<string> => {
  const client = hederaClient();
  const submitKey = PrivateKey.fromStringECDSA(HEDERA_OPERATOR_KEY);

  const tx = await new TopicCreateTransaction()
    .setTopicMemo(memo)                    // 100 bytes max, PUBLIC, PERMANENT
    .setSubmitKey(submitKey.publicKey)
    .execute(client);

  const receipt = await tx.getReceipt(client);
  return receipt.topicId!.toString();
};

/**
 * Submit one attestation.
 *
 * setMaxChunks(1) plus the size assertion keeps this to a single message: one
 * sequence number, one consensus timestamp, one running-hash link. A chunked
 * message becomes N mirror rows tied by chunk_info and reassembly becomes the
 * auditor's problem.
 */
export const submitAttestation = async (body: string, topicId = HEDERA_TOPIC_ID): Promise<SubmitReceipt> => {
  if (!topicId) throw new Error('HEDERA_TOPIC_ID is not configured');

  const bytes = Buffer.from(body, 'utf8');
  if (bytes.length > ATTESTATION_MAX_BYTES) {
    throw new Error(`attestation is ${bytes.length} bytes, max ${ATTESTATION_MAX_BYTES}`);
  }

  const client = hederaClient();
  const tx = await new TopicMessageSubmitTransaction()
    .setTopicId(TopicId.fromString(topicId))
    .setMessage(bytes)
    .setMaxChunks(1)
    .execute(client);

  const receipt = await tx.getReceipt(client);

  return {
    sequenceNumber: receipt.topicSequenceNumber!.toString(),
    runningHash: Buffer.from(receipt.topicRunningHash!).toString('base64'),
    // Not on the receipt in this SDK version. See SubmitReceipt.runningHashVersion.
    runningHashVersion: ASSUMED_RUNNING_HASH_VERSION,
    transactionId: tx.transactionId!.toString(),
    topicId,
    explorerUrl: `${HASHSCAN_BASE}/topic/${topicId}`,
  };
};

/**
 * Read a message back from the mirror node.
 *
 * Mirror REST lags consensus by 1.8 to 4.3 seconds (p50 ~4.1s), so a 404 here
 * immediately after submit is EXPECTED, not an error. HashScan reads this same
 * API, which is why a HashScan link clicked the instant consensus lands 404s
 * on camera. Render the link immediately, open it about five seconds later.
 *
 * NOTE: `sequencenumber` is all lowercase in the query string.
 */
export const getMessage = async (
  topicId: string,
  sequenceNumber: string,
): Promise<Record<string, unknown> | null> => {
  const res = await fetch(`${MIRROR_NODE_URL}/api/v1/topics/${topicId}/messages/${sequenceNumber}`);
  if (!res.ok) return null;
  return res.json() as Promise<Record<string, unknown>>;
};

/**
 * Confirm an attestation reached consensus AND the mirror agrees with the
 * receipt. Off the critical path by design: the agent is released on the
 * receipt, which carries the sequence number immediately.
 */
export const confirmAttestation = async (
  topicId: string,
  sequenceNumber: string,
  expectedRunningHash: string,
): Promise<{
  confirmed: boolean;
  consensusTimestamp?: string;
  runningHashVersion?: number;
  reason?: string;
}> => {
  const msg = await getMessage(topicId, sequenceNumber);
  if (!msg) return { confirmed: false, reason: 'not_yet_on_mirror' };

  const mirrorHash = String(msg.running_hash ?? '');
  if (mirrorHash !== expectedRunningHash) {
    return { confirmed: false, reason: 'running_hash_mismatch' };
  }

  // The mirror node DOES return the version. If Hedera ever moves past 3, this
  // surfaces as an explicit mismatch instead of a silently wrong offline hash.
  const version = Number(msg.running_hash_version ?? ASSUMED_RUNNING_HASH_VERSION);
  if (version !== ASSUMED_RUNNING_HASH_VERSION) {
    return { confirmed: false, runningHashVersion: version, reason: 'unexpected_running_hash_version' };
  }

  return {
    confirmed: true,
    consensusTimestamp: String(msg.consensus_timestamp ?? ''),
    runningHashVersion: version,
  };
};
