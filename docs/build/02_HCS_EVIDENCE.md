# Step 02 — HCS, the evidence substrate

**Goal:** an immutable topic, messages written to it, read back, and a **zero-dependency offline
verifier** that recomputes the running hash chain and proves nothing was inserted, removed,
reordered or altered, without trusting the mirror node.

**Prize linkage:** Hedera AI & Agentic Payments extra point *"Verifiable payment audit trails on
HCS"* (we hit this fully), and it is the entire basis of the Harness contribution in step 09.

**Day:** 1 to 2 (Sep 4-5). Budget 4 to 5 hours.

**This is the step that makes Proctor a product instead of a demo.** If the verifier passes on day
1, the central technical claim is proven on day 1.

---

## 1. Why HCS and not a contract

| Candidate | On chain? | Why |
|---|---|---|
| Per-decision attestation | **HCS, not a contract** | $0.0008 per message with a consensus timestamp and a running hash chain. A contract write costs more, has no better timestamp, and **gives up the chain property** |
| World proof verification | **Impossible anywhere** | Selfie Check returns a v3 proof; the on-chain legacy path is Orb-only. There is no World ID deployment on Hedera at all |
| Payments | **Off the EVM path** | The facilitator settles a native `TransferTransaction` |

We attest a **backend-verified outcome**, and publish the raw proof in the export so a third party
re-verifies it against **World's** endpoint, not against us. Say this accurately; do not imply
on-chain proof verification.

---

## 2. Create the topic

```ts
// src/lib/hedera/client.ts
import { Client, PrivateKey, AccountId } from '@hiero-ledger/sdk';
import { HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, HEDERA_NETWORK } from '../../config/main-config.ts';

export const hederaClient = (): Client => {
  const c = HEDERA_NETWORK === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
  c.setOperator(AccountId.fromString(HEDERA_OPERATOR_ID), PrivateKey.fromStringECDSA(HEDERA_OPERATOR_KEY));
  return c;
};
```

```ts
// scripts/create-topic.ts  — run ONCE, put the id in .env
import { TopicCreateTransaction, PrivateKey } from '@hiero-ledger/sdk';
import { hederaClient } from '../src/lib/hedera/client.ts';
import { HEDERA_OPERATOR_KEY } from '../src/config/main-config.ts';

const client = hederaClient();
const submitKey = PrivateKey.fromStringECDSA(HEDERA_OPERATOR_KEY);

const tx = await new TopicCreateTransaction()
  .setTopicMemo('Proctor oversight evidence log v1')   // 100 bytes max, PUBLIC
  .setSubmitKey(submitKey.publicKey)                    // authorship control
  // NO setAdminKey. This makes the topic IMMUTABLE and UNDELETABLE, by anyone, forever.
  .execute(client);

const receipt = await tx.getReceipt(client);
console.log('HEDERA_TOPIC_ID=', receipt.topicId!.toString());
```

### The two key decisions, and how to describe them honestly

**No admin key.** From the docs: *"If no adminKey is specified the topic is immutable."* Nobody can
delete or update it, **including us**. That is exactly what you want for an evidence log, and it is
the sentence to say in the video.

**There is no undo.** Get the memo right the first time. You cannot change it, ever.

**A submit key, yes.** Without one, any account on Hedera can append to your topic, and an auditor
could not distinguish a genuine attestation from an attacker's. With one, authorship is constrained.

**Be honest about what the submit key does not buy.** The deployer holds it, so the deployer can
still write a *false* entry. HCS is not preventing that. It prevents them **retroactively editing
or deleting what they already wrote**, and it binds each entry to a timestamp they did not choose.
Combined with a liveness proof and a nullifier issued by parties who are not the deployer, the
composite is what an auditor cannot obtain from a Postgres table. **Say this out loud.** A judge who
hears you name the limit trusts the rest.

---

## 3. Submit a message

```ts
// src/lib/hedera/submit.ts
import { TopicMessageSubmitTransaction, TopicId } from '@hiero-ledger/sdk';
import { hederaClient } from './client.ts';
import { HEDERA_TOPIC_ID } from '../../config/main-config.ts';

export const submitAttestation = async (body: string) => {
  const bytes = Buffer.from(body, 'utf8');
  if (bytes.length > 1024) throw new Error(`attestation ${bytes.length} bytes, max 1024`);

  const client = hederaClient();
  const tx = await new TopicMessageSubmitTransaction()
    .setTopicId(TopicId.fromString(HEDERA_TOPIC_ID))
    .setMessage(bytes)
    .setMaxChunks(1)            // one chunk = one sequence number = one verification story
    .execute(client);

  const receipt = await tx.getReceipt(client);
  return {
    sequenceNumber: receipt.topicSequenceNumber!.toString(),
    runningHash: Buffer.from(receipt.topicRunningHash!).toString('base64'),
    runningHashVersion: Number(receipt.topicRunningHashVersion ?? 3n),
    transactionId: tx.transactionId!.toString(),
  };
};
```

### Size is a hard constraint, not a guideline

| Limit | Value |
|---|---|
| One HCS message (single chunk) | **1024 bytes** |
| Max transaction size incl. signatures | 6 KB |
| Default max chunks | 20 |

**Keep every attestation under 1024 bytes.** A chunked message becomes **N mirror node messages,
each with its own sequence number**, linked by `chunk_info`, and reassembly becomes your problem on
read. One chunk means one sequence number, one consensus timestamp, one running-hash link, and a
verification story a judge can follow in ten seconds.

Put **hashes** in the message, never payloads. Assert the size before submitting, in code, so this
can never silently regress.

---

## 4. Read it back

Two paths, and you need both for different reasons.

| Path | Latency | Use for |
|---|---|---|
| **gRPC `TopicMessageQuery`** | p50 **2.6s** after consensus | the live console feed |
| **Mirror REST** | p50 **4.1s**, p90 4.2s | backfill, export, deep links |

**Measured on live testnet over 200 seconds and 340 polls.**

### The finding that protects the video

**HashScan reads the REST API.** A HashScan link clicked the instant consensus lands **404s**. A
judge watching a 404 reload is the most damaging four seconds possible in the demo.

So:
- Drive the live console from the **gRPC stream**, which is push and 1.5s faster than polling
- **Render** the HashScan anchor immediately (you know the topic id and sequence number from the
  receipt) but **do not open it optimistically**. Hold about 5 seconds, or script the tab switch on
  a timer
- Use REST only for backfill and the deep link

```ts
// src/lib/hedera/mirror.ts
// NOTE: `sequencenumber` is ALL LOWERCASE in the query string. Not sequenceNumber.
export const getMessage = async (topicId: string, seq: string) => {
  const r = await fetch(`${MIRROR_NODE_URL}/api/v1/topics/${topicId}/messages/${seq}`);
  if (!r.ok) return null;                 // 404 is EXPECTED for ~4s after consensus
  return r.json();
};
```

**The mirror node cannot filter on anything inside your JSON.** Only topic, sequence number and
timestamp. That is precisely why Postgres is the index and HCS is the truth, and why every stored
row carries `sequenceNumber` and `consensusTimestamp` so it can be re-fetched and re-verified.

---

## 5. THE CENTRE OF THE PROJECT: the running hash chain

Each message's hash commits to the previous hash, the payer, the topic, the consensus timestamp,
the sequence number, and a digest of the message bytes. Recomputing the chain locally proves no
message was inserted, removed, reordered or altered, **with zero trust in the mirror node**.

Authoritative spec, from the consensus node protobuf, field `topicRunningHash`:

> This 48-byte field is the output of a SHA-384 digest with input data determined by the value of
> the `topicRunningHashVersion` field. All new transactions SHALL use `topicRunningHashVersion` 3.
> The bytes of each uint64 or uint32 encoded for the hash input MUST be in Big-Endian format.

Version 3 input order: previous running hash (48), version (8), payer shard/realm/num (8 each),
topic shard/realm/num (8 each), consensus seconds (8), nanos (4), sequence number (8), SHA-384 of
the message bytes (48).

### The footgun nobody documents, and it is our best story

**That field list is necessary but NOT sufficient.** The reference implementation serialises those
fields with a Java `ObjectOutputStream`, so the bytes actually hashed include **Java serialization
framing**: the 4-byte stream header, a class descriptor for `byte[]`, block-data records around the
primitives, and a back-reference for the second `byte[]`.

**Hashing the twelve fields concatenated raw produces the wrong answer, forever.** Implementing
straight from the documented field list gives you a hash that never matches and no clue why.

Verified 2026-08-31 against testnet topic `0.0.4320226`, sequence numbers 1 to 3 chained from
genesis. All three matched the mirror node's `running_hash`.

```ts
// verify/src/runningHash.ts   ZERO DEPENDENCIES. node:crypto only.
import crypto from 'node:crypto';

const sha384 = (b: Buffer) => crypto.createHash('sha384').update(b).digest();
const i64 = (v: string | number | bigint) => { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(v)); return b; };
const i32 = (v: string | number) => { const b = Buffer.alloc(4); b.writeInt32BE(Number(v)); return b; };

// --- Java ObjectOutputStream framing, reproduced byte for byte ---
const STREAM_HEADER = Buffer.from('aced0005', 'hex');
const BYTEARRAY_CLASSDESC = Buffer.from('757200025b42acf317f8060854e00200007870', 'hex');
const BYTEARRAY_BACKREF   = Buffer.from('7571007e0000', 'hex');
const blockData = (buf: Buffer) => Buffer.concat([Buffer.from([0x77, buf.length]), buf]);

export function nextRunningHash(a: {
  prevRunningHash: Buffer; version: number; payerAccountId: string; topicId: string;
  consensusTimestamp: string; sequenceNumber: string; messageBytes: Buffer;
}): Buffer {
  const [ps, pr, pn] = a.payerAccountId.split('.');
  const [ts, tr, tn] = a.topicId.split('.');
  const [secs, nanosRaw] = a.consensusTimestamp.split('.');
  const nanos = (nanosRaw ?? '').padEnd(9, '0');

  const primitives = Buffer.concat([
    i64(a.version),
    i64(ps), i64(pr), i64(pn),
    i64(ts), i64(tr), i64(tn),
    i64(secs), i32(nanos), i64(a.sequenceNumber),
  ]);

  return sha384(Buffer.concat([
    STREAM_HEADER,
    BYTEARRAY_CLASSDESC, i32(a.prevRunningHash.length), a.prevRunningHash,
    blockData(primitives),
    BYTEARRAY_BACKREF, i32(48), sha384(a.messageBytes),
  ]));
}
```

Genesis previous running hash is **48 zero bytes**.

### Why this lives in `verify/` with zero dependencies

The claim is *"an auditor verifies the whole record offline, with no install step beyond Node, and
without trusting us."* **Any dependency added here weakens the product.** `backend/src/lib/hcsVerify/`
may re-export it, but `verify/` is the artefact a judge runs.

---

## 6. The tamper demo. Rehearse it.

This is 15 seconds of the video and it is worth more than any architecture slide.

1. Export the evidence
2. `bun verify --topic 0.0.X` → **PASS**
3. Edit **one character** of the export
4. Re-run → **FAIL**, and the failure names the sequence number where the chain broke

One sentence over it: *"That is the difference between a record and evidence."*

The failure message must name the sequence number. A generic "verification failed" wastes the shot.

---

## 7. Definition of done

- [ ] Topic created with a submit key and **no admin key**; id in `.env`; creation tx on HashScan shows no admin key
- [ ] One message submitted, receipt returns sequence number + running hash + version
- [ ] Message read back via **both** gRPC stream and mirror REST
- [ ] Mirror lag measured and written down (expect 1.8 to 4.3s)
- [ ] `nextRunningHash` reproduces the mirror node's `running_hash` for **at least 3 chained messages from genesis**
- [ ] Tamper test: one edited character produces FAIL naming the sequence number
- [ ] Size assertion rejects any attestation over 1024 bytes
- [ ] `verify/` has **zero** dependencies in its package.json

---

## 8. Footguns specific to this step

| Footgun | Symptom | Fix |
|---|---|---|
| Naive running-hash concatenation | hash never matches, no clue why | Java framing above. **This is also the README's "hard part" story** |
| `sequenceNumber` in the REST query | empty result | `sequencenumber`, all lowercase |
| Attestation over 1024 bytes | silently becomes N messages with N sequence numbers | `setMaxChunks(1)` + assert before submit |
| Clicking HashScan immediately | 404 on camera | hold ~5s; drive the UI from gRPC |
| Two SDK copies | "invalid private key" on a valid key | one pinned `@hiero-ledger/sdk` |
| ED25519 operator | no EVM alias, Harness tier rejects it | ECDSA secp256k1 |
| Topic memo typo | permanent, no admin key means no update | check twice before running the script |
| Testnet reset Sep 4-13 | unrecoverable | subscribe to status.hedera.com on day 1 |

**Fee note:** the submit-message docs say $0.0001, the fee schedule table says $0.0008. Use
**$0.0008** in any written claim. Both support "under a tenth of a cent."
