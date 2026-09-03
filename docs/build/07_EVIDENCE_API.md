# Step 07 — Evidence API, export, and offline verification

**Goal:** the console API, an Article 12 export, the public trust roots, and a CLI an auditor runs
with no install step and no access to us.

**Prize linkage:** Hedera (the audit-trail claim), Arc (a "working backend" with real documentation).
This step is what makes *"verify without trusting us"* checkable rather than asserted.

**Day:** 7 (Sep 10). Budget 4 hours.

---

## 1. Postgres is the index, HCS is the truth

**The mirror node cannot filter on anything inside your JSON.** Only topic, sequence number and
timestamp. So every console query is served from Postgres, and **every row carries
`sequenceNumber` and `consensusTimestamp`** so it can be re-fetched from the mirror node and
re-verified independently.

Say this in the README. It is an honest architecture, and a judge who sees Postgres in the diagram
will otherwise ask.

---

## 2. Routes

```
GET  /v1/evidence/decisions            list, filters: from,to,agentId,witnessId,outcome,cursor
GET  /v1/evidence/decisions/:id        full record: preimage, raw proof, attestation, payments, events
POST /v1/evidence/export               the Article 12 artefact
GET  /v1/evidence/decisions/:id/verify runs the SAME verifier server-side, for the console's tick
```

The server-side verify exists so the console can render a green tick. **The claim is only credible
because the identical code runs offline with no network access to us.** Do not let the two
implementations drift; import one module.

---

## 3. The export

```ts
type EvidenceExportV1 = {
  v: 1;
  generatedAt: string;
  anchors: {                        // everything a verifier needs that is NOT us
    topicId: string;
    mirrorNodeBaseUrl: string;
    attestorAddress: string;
    rpId: string;
    worldVerifyUrl: string;
  };
  hcsMessages: MirrorNodeTopicMessage[];   // RAW rows, UNMODIFIED, base64 message field intact
  records: Array<{
    decisionId: string;
    preimage: Record<string, unknown>;
    decisionHash: string;
    idkitResult: IDKitResult | null;       // null on a refusal
    attestation: { body: string; attestorSig: string; sequenceNumber: string };
    payments: Array<{ leg: string; rail: string; amountUsd: string; externalId: string | null }>;
  }>;
};
```

**`hcsMessages` are raw mirror rows, unmodified, base64 intact.** The moment you prettify them the
verifier cannot recompute the chain.

---

## 4. `/.well-known/proctor.json`

No auth. This is what makes offline verification possible for someone who has only an export.

```ts
type ProctorWellKnown = {
  v: 1;
  attestor: { address: string; eip712Domain: { name: string; version: string; chainId: number } };
  hcs: { topicId: string; mirrorNodeBaseUrl: string; network: 'hedera:testnet' };
  world: { rpId: string; action: string; verifyUrl: string; mode: WitnessMode };
  attestationSpec: 'https://<host>/docs/attestation-spec-v1.md';
};
```

**Be honest about its weakness.** We can edit a JSON file on our own host. Publish the same roots as
an HCS message at topic genesis, and say in the verification doc that **the HCS copy is
authoritative** because we cannot edit a past consensus record. That sentence costs nothing and
closes the obvious hole a good judge will find.

---

## 5. The verifier CLI

Lives in `verify/`. **Zero dependencies.** `node:crypto` only.

```bash
bun run verify --export ./evidence-2026-09-10.json
```

It must, without touching our servers:

1. Recompute `decisionHash` from each preimage and match the attestation
2. Recompute the running hash chain from genesis and match every mirror `running_hash`
3. Verify each EIP-712 attestor signature against the published address
4. Report **PASS**, or **FAIL naming the sequence number** where the chain broke

A generic "verification failed" wastes the demo shot. **Name the sequence number.**

---

## 6. Definition of done

- [ ] Console list and detail served from Postgres, every row carrying seq + consensus timestamp
- [ ] Export downloads, `hcsMessages` byte-identical to the mirror node's response
- [ ] `bun run verify` passes on a real export, **offline, with the API stopped**
- [ ] One edited character produces FAIL naming the sequence number
- [ ] `/.well-known/proctor.json` served, and the same roots published to HCS
- [ ] `verify/package.json` has an empty `dependencies` object
- [ ] README "Verify it yourself in two minutes" table, every row a link to a file range or an explorer
