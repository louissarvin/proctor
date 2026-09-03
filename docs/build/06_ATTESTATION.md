# Step 06 — The attestation

**Goal:** turn a resolved decision into a canonical, hashed, signed record under 1024 bytes, write
it to HCS, and confirm it against the mirror node.

**Prize linkage:** Hedera, *"Verifiable payment audit trails on HCS"*. **This is the product.**

**Day:** 5 (Sep 8). Budget 5 hours.

---

## 1. DEFECT A1: `canonical()` destroys nested objects

The highest-severity defect found in the whole audit. The naive implementation silently drops every
nested object, so:

- `pol` hashes **identically for every policy**
- `mtr` is **not covered** by the attestor signature

**Both evidence hashes are broken, and nothing errors.** You would ship a product whose central
claim is false and whose tests pass.

```ts
// src/lib/attestation/canonical.ts
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;   // order PRESERVED
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();  // sorted at EVERY depth
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}
```

Rules: sorted keys **at every depth**, `undefined` dropped, **arrays order-preserved** (an array is
ordered data, sorting it would change meaning), no whitespace, UTF-8.

**The test table must include a nested object and an array of objects.** A flat-object-only test
suite passes against the broken version, which is exactly how this survived review.

---

## 2. What gets hashed and what gets signed

```
preimage  --canonical--> bytes --keccak256--> decisionHash   (= the World `signal`)
IDKitResult raw bytes    --sha256-->          wid
policy rules --canonical--> bytes --sha256--> pol
attestation core --canonical--> bytes --EIP-712 sign (viem) --> attestorSig
core + sig --utf8--> HCS message (<1024 bytes)
```

**The raw `IDKitResult` is hashed byte for byte as received.** Never re-serialise it, never
normalise it. The export publishes those exact bytes so a third party re-verifies against **World's**
endpoint, not against us. Re-serialising breaks the digest and the whole third-party story.

---

## 3. The record

Keep it under 1024 bytes so it is one chunk, one sequence number, one consensus timestamp, one
running-hash link. A real record measures ~915 bytes, leaving ~109 bytes of headroom. **Assert the
size before submitting.**

Fields that matter and why:

| Field | Binds |
|---|---|
| `dh` | the decision hash. What the witness actually saw |
| `wid` | sha256 of the raw World proof. `null` on a refusal, and that is correct |
| `wn` | the witness nullifier |
| `on` | the operator nullifier, so independence is checkable |
| `ind` | **whether independence is cryptographic or policy.** Do not skip this |
| `wa` | `"proof" \| "token"`. What authenticated the witness. Pre-empts the refusal attack narrative |
| `pol` | hash of the exact policy version that fired |
| `mtr` | the meter quote. **A quote at attestation time, not a settlement** |
| `out` | APPROVE / REFUSE / EXPIRE |

`mtr` and `fee` are **quotes, not settlements**. The field names read as facts, so say so in
`attestation-spec-v1.md` in one paragraph, and carry the settled `Payment` rows alongside in the
export.

Guard: refuse to create a decision for an org with no `operatorEnrolledAt`, since `on` is
non-nullable in the record but nullable in the schema.

---

## 4. Independence: state exactly what is guaranteed

| Property | Guaranteed by | Strength |
|---|---|---|
| The approver was a live human | World Selfie Check | **cryptographic** |
| The approver's World account differs from the operator's | nullifier comparison | **cryptographic**, and only on a v3 credential |
| The approver is a **different person** | the rota, an org policy | **policy, not cryptographic** |
| The record was not edited after the fact | HCS, no admin key | **cryptographic** |

**Two distinct nullifiers do not prove two humans.** One person can hold two World ID accounts. The
`ind` field records which of the two properties an attestation carries.

Reproduce this table verbatim in the README. It is why the World submission is credible.

---

## 5. Write to HCS, confirm, and do not trust the mirror node

```ts
const receipt = await submitAttestation(body);      // step 02
// receipt carries sequenceNumber + runningHash IMMEDIATELY. No waiting.
```

Then confirm asynchronously: fetch from the mirror node and compare its `running_hash` against the
receipt's. **Mirror lag is 1.8 to 4.3 seconds, so this is off the critical path by design.** The
agent is released on the receipt, not on the mirror confirmation.

`AttestationState`: `PENDING -> SUBMITTED -> CONFIRMED`, where CONFIRMED means the mirror returned
the message **and the running hash matched**.

---

## 6. Definition of done

- [ ] `canonical()` is recursive; tests include a nested object **and** an array of objects
- [ ] Two different policies produce two different `pol` hashes (the regression that catches A1)
- [ ] `decisionHash` reproducible from the stored preimage, offline, by a third party
- [ ] Record asserted under 1024 bytes before submit
- [ ] EIP-712 signature verifies against the published attestor address
- [ ] Approve, refuse and expire all produce a **complete** attestation
- [ ] `wid: null` + `wa: "token"` on refusal, and the verifier treats it as correct
- [ ] Mirror node running hash matches the receipt's
- [ ] Independence table in the README, `ind` field populated per record
