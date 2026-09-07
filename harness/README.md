# HCS validator for the Hedera Harness

A CHAIN-stage validator that asserts an agent's HCS feature actually works:
that the topic holds messages matching an expected shape, and that the
**running hash chain verifies from genesis**.

Prepared as a contribution to [`hedera-dev/hedera-harness`](https://github.com/hedera-dev/hedera-harness).
See [`PR_DESCRIPTION.md`](PR_DESCRIPTION.md).

## Why

The harness CHAIN stage verifies transactions via the mirror node. Nothing
verifies **topic messages**, and nothing in the Hedera tooling ecosystem
verifies the **running hash chain**. An agent can ship an HCS feature that
submits nothing and the stage still passes.

## Usage

```yaml
# .harness/spec.yaml
chainValidation:
  enabled: true
  network: testnet
  hcs:
    topicIdEnv: HEDERA_TOPIC_ID
    expectMessagesMatching: '"type":"receipt"'   # substring or /regex/
    minMessages: 1
    verifyRunningHashChain: true
```

## Run

```bash
npm install
npm test        # 9 tests, real mirror node fixture
```

## The Java framing

The consensus protobuf documents twelve inputs to the SHA-384 digest. Hashing
them raw never matches, because the consensus node serialises through a Java
`ObjectOutputStream` and the framing bytes are part of the digest.

```
mirror node says : c91842fa5e802cc4ac04cf8dd3a5f6b2
naive (doc list) : 509d029eaf6b862d2f96cfb917943f82  <- WRONG
framed (ours)    : c91842fa5e802cc4ac04cf8dd3a5f6b2  <- MATCH
```

A test asserts both directions, so a refactor cannot quietly reintroduce the bug.

## Files

| Path | What |
|---|---|
| `src/runningHash.ts` | The chain computation. Zero dependencies, `node:crypto` only |
| `src/validation/hcsValidator.ts` | The validator, matching harness config conventions |
| `test/hcsValidator.test.mjs` | 17 tests, `node --test`, real captured fixture |
| `.harness/spec.yaml` | Example recipe exercising the validator |
