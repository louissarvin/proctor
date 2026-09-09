# Regulatory mapping

Every claim below quotes the Act. Nothing is paraphrased, because the value of
this document is that a reader can check it.

**What Proctor does NOT claim:** that using it makes a deployer compliant.
Compliance is a property of the deployer's whole system. Proctor produces one
piece of evidence that is otherwise difficult to produce, and it is explicit
about what that evidence does and does not establish.

---

## Article 12, Record-keeping

> **12(1)** "High-risk AI systems shall technically allow for the automatic
> recording of events (logs) over the lifetime of the system."

The evidence log is a Hedera Consensus Service topic created with **no admin
key**. Per Hedera's own documentation, *"if no adminKey is specified the topic
is immutable"*. It cannot be updated or deleted by anyone, **including Proctor**.

> **12(3)(a)** "recording of the period of each use of the system (start date
> and time and end date and time of each use)"

Each record carries `issuedAt`, `dispatchedAt`, `respondedAt` and `expiresAt`,
plus a **consensus timestamp assigned by the Hedera network**. That last one
matters: it is a clock the deployer did not choose and cannot move.

> **12(3)(d)** "the identification of the natural persons involved in the
> verification of the results"

Each attestation binds the **witness nullifier**, an identifier issued by World
rather than by the deployer, to a liveness proof bound to that specific
decision via the `signal`.

This is the provision that a self-hosted approval button cannot satisfy. A row
reading `approved_by: user_44` is written by the system being audited, editable
by the party being audited, and contains no evidence that a human rather than a
service account produced it.

---

## Article 14, Human oversight

> **14(4)** high-risk AI systems shall be "effectively overseen by natural persons",
> who are enabled to "correctly interpret the … output", to "decide … not to use
> the high-risk AI system or to otherwise disregard, override or reverse the
> output", and to "intervene … or interrupt the system"

This binds **every** deployer of a high-risk system. Proctor's gate is that
interruption made explicit: the action does not proceed unless a person decides
it should, and the default is that it does not.

### 14(5), and its scope — read this before citing it

> **14(5)** "**For high-risk AI systems referred to in point 1(a) of Annex III**,
> the measures referred to in paragraph 3 of this Article shall be such as to
> ensure that, in addition, no action or decision is taken by the deployer on the
> basis of the identification resulting from the system unless that identification
> has been **separately verified and confirmed by at least two natural persons**
> with the necessary competence, training and authority"

**That opening clause matters, and it is routinely dropped when this provision is
quoted.** Annex III point 1(a) is *remote biometric identification* — systems that
compare a person's biometric data against a database to establish who they are.

**Proctor's worked example is not one of those.** An agent releasing a supplier
payment is not a remote biometric identification system, so **Article 14(5) does
not bind that deployer.** We say so plainly because a compliance claim that
collapses under one lookup is worth less than no claim at all.

So why build to it?

- **It is the strictest oversight bar the Act names**, and it is the one provision
  that specifies *how many people* and *how independent* they must be. Building to
  the strictest named standard and saying where it is actually mandatory is a
  defensible engineering position.
- **It binds directly** for any deployer whose system does fall under Annex III
  1(a) — and such a deployer needs exactly this evidence, produced by a party that
  is not them.
- **The evidence is the same either way.** Recording both nullifiers costs nothing
  extra and is what makes independence checkable rather than asserted, whichever
  provision a given deployer is answering.

Every attestation records both the operator nullifier and the witness nullifier,
so their distinctness is checkable by a third party rather than asserted by us.

The `ind` field states which property the record actually carries:

| `ind` | Meaning |
|---|---|
| `crypto` | The credential yields a stable nullifier and the two differ. Cryptographic. |
| `policy` | Distinctness is a property of the rota, not of the credential. |

**Why the distinction is not pedantry.** Selfie Check returns a World ID 3.0
proof whose nullifier is stable per (account, RP, action), so the comparison is
meaningful. On a World ID 4.0 uniqueness proof the nullifier is one-time-use, so
two proofs from the *same* account produce different nullifiers and the
comparison would pass trivially. A system that claimed `crypto` there would be
asserting a property it does not have.

> **14(4)(d)** "to decide, in any particular situation, not to use the high-risk
> AI system or to otherwise disregard, override or reverse the output"

The gate **fails closed**. The default outcome is refuse, a refusal requires no
proof, and an expiry never releases the agent. Requiring a liveness proof to
press a stop button would put a failure mode between a person and a brake pedal.

---

## What the evidence establishes, precisely

| Property | Established by | Strength |
|---|---|---|
| A live human approved | World Selfie Check | **cryptographic** |
| They approved **this** decision | decision hash as the World `signal` | **cryptographic** |
| Their account differs from the operator's | nullifier comparison | **cryptographic**, v3 credentials only |
| They are a different **person** | the rota, an org policy | **policy** |
| The record was not altered afterwards | HCS running hash chain, no admin key | **cryptographic** |
| The timestamp was not chosen by the deployer | Hedera consensus | **cryptographic** |

**Two distinct nullifiers do not prove two humans.** One person can hold two
World ID accounts. Proctor records which of the two properties it has rather
than blurring them, because an auditor who discovers the blur discounts the
whole record.

---

## Dates

The obligations for high-risk systems already on the market bit on
**2 August 2026**. That is what makes this a present problem rather than a
forecast.

---

## Sources

- Article 12: https://artificialintelligenceact.eu/article/12/
- Article 14: https://artificialintelligenceact.eu/article/14/
- Hedera topic immutability: https://docs.hedera.com/native/consensus/create-topic.md
- RFC 8785, JSON Canonicalization Scheme: https://www.rfc-editor.org/rfc/rfc8785
