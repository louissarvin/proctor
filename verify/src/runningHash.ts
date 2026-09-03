/**
 * Hedera Consensus Service running hash chain, recomputed offline.
 *
 * WHY THIS FILE HAS NO DEPENDENCIES
 * ---------------------------------
 * The product claim is "any third party verifies the evidence without trusting us."
 * That claim is only as strong as the verifier's dependency list. node:crypto only.
 *
 * THE SPEC
 * --------
 * From the consensus node protobuf (transaction_receipt.proto, topicRunningHash):
 *
 *   "This 48-byte field is the output of a SHA-384 digest with input data determined
 *    by the value of the topicRunningHashVersion field. All new transactions SHALL use
 *    topicRunningHashVersion 3. The bytes of each uint64 or uint32 encoded for the hash
 *    input MUST be in Big-Endian format."
 *
 * Version 3 input order:
 *   1. previous running hash (48 bytes)
 *   2. topic_running_hash_version (8)
 *   3,4,5. payer account shard, realm, num (8 each)
 *   6,7,8. topic shard, realm, num (8 each)
 *   9. consensus seconds (8)
 *   10. consensus nanos (4)
 *   11. topic_sequence_number (8)
 *   12. SHA-384 of the message bytes (48)
 *
 * THE PART THE DOCS DO NOT TELL YOU
 * ---------------------------------
 * That field list is necessary but NOT sufficient. The consensus node serialises those
 * fields through a Java ObjectOutputStream, so the bytes actually hashed include Java
 * serialization framing: the stream header, a class descriptor for byte[], block-data
 * records around the primitives, and a back-reference for the second byte[].
 *
 * Hashing the twelve fields concatenated raw produces a hash that never matches, with
 * no diagnostic. The framing below is reproduced byte for byte.
 */
import crypto from 'node:crypto';

const sha384 = (b: Buffer): Buffer => crypto.createHash('sha384').update(b).digest();

const i64 = (v: string | number | bigint): Buffer => {
  const b = Buffer.alloc(8);
  b.writeBigInt64BE(BigInt(v));
  return b;
};

const i32 = (v: string | number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(Number(v));
  return b;
};

// --- Java ObjectOutputStream framing ---------------------------------------
/** STREAM_MAGIC 0xACED + STREAM_VERSION 0x0005 */
const STREAM_HEADER = Buffer.from('aced0005', 'hex');
/**
 * First writeObject(byte[]): full class descriptor for "[B".
 *   75 TC_ARRAY | 72 TC_CLASSDESC | 0002 "[B" | suid acf317f8060854e0
 *   | 02 SC_SERIALIZABLE | 0000 fields | 78 TC_ENDBLOCKDATA | 70 TC_NULL super
 */
const BYTEARRAY_CLASSDESC = Buffer.from('757200025b42acf317f8060854e00200007870', 'hex');
/** Second writeObject(byte[]): class descriptor back-reference, handle 0x7e0000 */
const BYTEARRAY_BACKREF = Buffer.from('7571007e0000', 'hex');
/** Primitives are buffered and emitted as one block: 77 TC_BLOCKDATA | 1-byte length */
const blockData = (buf: Buffer): Buffer =>
  Buffer.concat([Buffer.from([0x77, buf.length]), buf]);

export interface RunningHashInput {
  prevRunningHash: Buffer;
  version: number;
  payerAccountId: string;
  topicId: string;
  consensusTimestamp: string;
  sequenceNumber: string | number;
  messageBytes: Buffer;
}

/** The 48-byte running hash for one message, given the previous one. */
export function nextRunningHash(a: RunningHashInput): Buffer {
  const [ps, pr, pn] = a.payerAccountId.split('.');
  const [ts, tr, tn] = a.topicId.split('.');
  const [secs, nanosRaw] = a.consensusTimestamp.split('.');
  const nanos = (nanosRaw ?? '').padEnd(9, '0');

  const primitives = Buffer.concat([
    i64(a.version),
    i64(ps!), i64(pr!), i64(pn!),
    i64(ts!), i64(tr!), i64(tn!),
    i64(secs!),
    i32(nanos),
    i64(a.sequenceNumber),
  ]);

  return sha384(
    Buffer.concat([
      STREAM_HEADER,
      BYTEARRAY_CLASSDESC, i32(a.prevRunningHash.length), a.prevRunningHash,
      blockData(primitives),
      BYTEARRAY_BACKREF, i32(48), sha384(a.messageBytes),
    ]),
  );
}

/** The chain starts from 48 zero bytes. */
export const GENESIS_RUNNING_HASH = Buffer.alloc(48);
