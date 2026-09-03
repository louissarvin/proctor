# @proctor/verify

Offline verification of Proctor's evidence log. **Zero dependencies.** `node:crypto` only.

```bash
bun bin/verify.ts --topic 0.0.4320226
bun bin/verify.ts --export ./evidence.json   # fully offline, no network
```

## What PASS actually means

The verifier recomputes Hedera's running hash chain from genesis. If it prints PASS, then no
message on that topic was **inserted, removed, reordered, or altered** — and you did not have to
trust Proctor, or the mirror node operator, to learn that.

```
PASS  45 messages, chain intact from genesis.
      No message was inserted, removed, reordered, or altered.
```

A break names the sequence number:

```
FAIL  chain broken at sequence number 21
      reason: running hash mismatch
```

## The part the docs do not tell you

The protobuf documents twelve inputs to the SHA-384 digest. **Hashing those twelve fields
concatenated raw produces a hash that never matches, with no diagnostic.**

The consensus node serialises them through a Java `ObjectOutputStream`, so the bytes actually
hashed include the stream header, a class descriptor for `byte[]`, block-data records around the
primitives, and a back-reference for the second `byte[]`. That framing is reproduced byte for byte
in `src/runningHash.ts`.

Verified against live testnet topic `0.0.4320226`, 45 messages, chained from genesis:

```
mirror node says : c91842fa5e802cc4ac04cf8dd3a5f6b2
naive (doc list) : 509d029eaf6b862d2f96cfb917943f82  <- WRONG
framed (ours)    : c91842fa5e802cc4ac04cf8dd3a5f6b2  <- MATCH
```

`bun test` asserts both: that the framed version reproduces consensus, and that the naive version
does not.

## Why zero dependencies is a product requirement, not a preference

The claim is *"any third party verifies the evidence without trusting us."* That claim is only as
strong as this package's dependency list. Anything added here weakens the product.

## Tests

```bash
bun test
```

Hermetic. The fixture is real, unmodified mirror node output. Covers: chain reproduction from
genesis, single flipped bit, removed message, reordering, forged insertion, backdated timestamp,
and the naive-implementation trap.
