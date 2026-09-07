# Add an HCS topic + running hash validator to the CHAIN stage

## The problem

The CHAIN stage provisions an ephemeral signer and verifies that **transactions**
landed via the mirror node. Nothing in the harness verifies **topic messages**,
and nothing verifies the **running hash chain**.

Those are different claims, and for any HCS feature the second is the one worth
asserting:

- *"A transaction succeeded"* says the agent called the network.
- *"Topic `0.0.X` contains a message matching this shape at a consensus
  timestamp inside this run, and the running hash chain from genesis is intact"*
  says the agent built a working, tamper-evident log.

Today an agent can produce an HCS feature that submits nothing, submits garbage,
or writes to the wrong topic, and the CHAIN stage passes.

## What this adds

An optional `chainValidation.hcs` block:

```yaml
chainValidation:
  enabled: true
  network: testnet
  hcs:
    topicIdEnv: HEDERA_TOPIC_ID
    expectMessagesMatching: '"type":"receipt"'
    minMessages: 1
    verifyRunningHashChain: true
    expectDenseSequence:        # optional
      field: seq
      groupBy: issuer
```

### `expectDenseSequence`, and the claim the chain cannot make

The running hash proves nothing was **altered, removed or reordered**. It cannot prove
nothing was **withheld**: an agent that simply never submits an inconvenient record breaks
no hash, and every integrity assertion still passes.

If the agent numbers its records, a hole in that numbering is the only thing that reveals
the omission. So this asserts a chosen field is dense.

Three deliberate constraints, each of which exists to avoid a false accusation — a check
that cries wolf gets ignored, which is worse than no check:

- **Bounded to the range observed**, `min..max`, never `1..max`. Otherwise every record
  written before the field existed, and everything outside a mirror query window, reports
  as withheld.
- **Grouped by issuer** when configured, because numbering restarts per issuer. Ungrouped,
  two interleaved issuers read as gaps and a second issuer's first record reads as a
  duplicate.
- **Unnumbered messages are counted, not failed.** A topic legitimately carries envelopes
  with no sequence field.

A repeated value is reported separately as renumbering rather than folded into "missing":
it is a different fault and needs a different repair.

The failure message says so explicitly, because a record still in flight looks identical to
one withheld from outside the topic:

```
problems: `seq` is not dense: 2 absent from the range observed. The running hash
          chain is intact, so nothing was deleted — those records were never
          written. NOTE: a record still in flight looks identical to one
          withheld, so re-run once the agent has settled.
```

The validator polls the mirror node until `timeoutMs`, counts messages matching
a substring or `/regex/`, and optionally recomputes the running hash chain from
genesis.

## Before and after

**Before** — an agent writes an HCS feature. CHAIN checks a transaction
succeeded. The topic is empty, or holds malformed messages, or is a different
topic entirely. Stage passes.

**After:**

```
status  : fail
problems: topic 0.0.10359381 has 4 message(s) but none matched
          "\"type\":\"receipt\"" after 30000ms.
```

Or, on a correct implementation:

```
status       : pass
messagesFound: 4
chainVerified: true
detail       : 2 matching message(s) on topic 0.0.10359381,
               running hash chain intact across 4 message(s)
```

## The part that is not obvious

The consensus protobuf documents twelve inputs to the SHA-384 running-hash
digest. **Hashing those twelve fields concatenated raw produces a hash that
never matches, with no diagnostic.**

The consensus node serialises them through a Java `ObjectOutputStream`, so the
bytes actually hashed include the stream header, a class descriptor for
`byte[]`, block-data records around the primitives, and a back-reference for the
second `byte[]`. `src/runningHash.ts` reproduces that framing byte for byte.

There is a test asserting **both** directions: that the framed implementation
reproduces consensus, and that the naive one does not. That second assertion is
what stops a future refactor quietly reintroducing the bug.

## Design notes, matching the harness's stated posture

- **Fails on uncertainty.** A lagging mirror node returns `pending`, never a
  false `pass`, and a transient mirror error retries rather than failing a
  correct implementation.
- **Every failure names the sequence number.** "Verification failed" is not an
  actionable repair signal; `chain broken at sequence number 3: sequence gap`
  is.
- **No new dependencies.** Mirror node REST plus `node:crypto`. The harness
  already ships `@hiero-ledger/sdk`, but this validator is read-only and needs
  no signer, so it cannot mutate a run.
- **Refuses unknown versions.** `running_hash_version` other than 3 is reported
  rather than assumed, so a future protocol bump surfaces instead of silently
  producing wrong hashes.

## How to run it

No dependencies beyond TypeScript and `@types/node`. The validator itself imports
nothing but `node:crypto`.

```bash
cd harness
npm install
npm test          # builds, then runs 17 tests -> 17 pass
npm run typecheck
```

**Against a live topic**, with no harness run and no keys, since the validator is
read-only and mirror-node-only:

```bash
node -e '
import("./dist/validation/hcsValidator.js").then(async (m) => {
  const r = await m.validateHcsTopic("0.0.10359381", {
    topicIdEnv: "HEDERA_TOPIC_ID",
    verifyRunningHashChain: true,
    minMessages: 1,
  });
  console.log(JSON.stringify(r, null, 2));
});'
```

```json
{
  "status": "pass",
  "topicId": "0.0.10359381",
  "messagesFound": 25,
  "messagesMatched": 25,
  "chainVerified": true,
  "brokeAtSequenceNumber": null,
  "missingSequenceValues": null,
  "problems": [],
  "detail": "25 matching message(s) on topic 0.0.10359381, running hash chain intact across 25 message(s)"
}
```

Point it at any public topic. To watch it **fail correctly**, pass a topic that
exists but holds nothing matching, or flip a byte in `test/fixture-topic.json` and
re-run the tests: the chain assertion breaks at the first altered message and
reports its sequence number rather than just returning false.

**Inside a harness run**, once wired, it is config only. The `hcs:` block below is
the whole surface area, quoted from `.harness/spec.yaml` in this PR:

```yaml
chainValidation:
  enabled: true
  network: testnet
  # ... existing operator / funding / expose keys, unchanged ...

  hcs:
    topicIdEnv: HEDERA_TOPIC_ID
    expectMessagesMatching: '"type":"receipt"'
    minMessages: 1
    verifyRunningHashChain: true
    expectDenseSequence:
      field: seq
    timeoutMs: 30000
```

Absent the `hcs:` block, the stage behaves exactly as it does today.

## Tests

```
node --test test/*.test.mjs
ℹ tests 17
ℹ pass 17
ℹ fail 0
```

Fixture is real mirror node output from testnet topic `0.0.4320226`, captured by
fetching the live node rather than hand-written. Covers: chain reproduction from
genesis, single flipped bit, removed message, reordering, unsupported version,
malformed topic id, invalid regex, and the naive-implementation trap.

For `expectDenseSequence`: a dense run, a withheld record, the observed-range bound,
per-issuer grouping, a gap inside one issuer, duplicate detection, numbers arriving as
decimal strings, and unnumbered messages being counted rather than failed.

Verified end to end against live testnet topic
[`0.0.10359381`](https://hashscan.io/testnet/topic/0.0.10359381).

## Scope

This PR is the validator, its tests, and an example recipe. It does not wire the
call site into `src/validation/index.ts`, because that touches stage
orchestration and I would rather agree the config shape first. Happy to add the
wiring in this PR or a follow-up, whichever you prefer.

Related: #8 discusses an optional validator on the deterministic ASSERT stage.
This one is CHAIN-stage and read-only, but the "optional, config-gated, fails
loudly" shape is the same.
