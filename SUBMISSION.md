# Submission text

Round 1 is judged on the video and the written description, and nothing else. This file is
the written half, kept in the repo so it is versioned alongside the claims it makes.

---

## Tracks

**Submitting for:** Hedera — AI & Agentic Payments · Hedera — Open Source, Improve the
Hedera Harness · World — Selfie Check · Arc — Best Agentic Economy Application with
Circle Agent Stack

Three partner selections: **Hedera**, **World**, **Arc**. All tracks of a partner count as
one selection.

The partner is listed as **Arc** on the event (`/prizes/arc`); *Circle Agent Stack* is the
product name inside the track title. Selecting "Circle" would select nothing.

---

## One-liner (89 characters)

> An AI agent stops mid-payment and pays a live, verified human for permission to continue.

---

## Description

**An AI agent stops mid-payment and pays a live, verified human for permission to
continue.** It hits a policy threshold, is stopped by an HTTP 402, pays $0.42 to open a
decision, and a human who is *not* the operator approves or refuses inside 60 seconds. The
default is refuse. The agent resumes on its own, and the witness is paid for the seconds
of attention they actually spent.

**What the customer buys is not the approval. It is the evidence.** Every agent framework
already ships a human-approval interrupt — LangGraph `interrupt`, Temporal signals, OpenAI
`needsApproval` — all free, all already integrated. They produce the same artefact:

```
approved_by: user_44, 14:22:07
```

A row written by the system being audited, editable by the party being audited, containing
no evidence that a human rather than a service account produced it. Since 2 August 2026,
EU AI Act Article 12(3)(d) requires *"the identification of the natural persons involved in
the verification of the results"*, and Article 14(4) requires that high-risk systems be
*"effectively overseen by natural persons"* able to interrupt them. A self-written,
self-editable log satisfies neither.

Article 14(5) adds *"at least two natural persons"* — but only *"for high-risk AI systems
referred to in point 1(a) of Annex III"*, which is remote biometric identification. A
supplier-payment agent is not that. **We build to the two-person bar anyway**, because it
is the strictest standard the Act names and the evidence is identical either way, and we
state the scope rather than quoting past it.

**Proctor binds four things a self-hosted approve button cannot.** The decision hash, so
the liveness proof is bound to *this* decision and cannot be replayed. A liveness proof
issued by a party that is not the deployer. A nullifier showing the approver's account is
cryptographically distinct from the operator's. And a consensus timestamp on a log with no
admin key, which therefore cannot be deleted by anyone, including us.

**It answers a second question that tamper-evident logs cannot.** Integrity asks *"was
this altered?"*. Completeness asks *"is this all of it?"*. An operator suppressing an
inconvenient refusal forges nothing — they simply never write it, and the hash chain stays
perfectly intact. Proctor signs a dense per-org issuance number into every record, so a
withheld decision becomes a hole a third party can see. Both checks run offline, against
Hedera's public mirror node, in a verifier with **zero dependencies**.

```
PASS  15 messages, chain intact from genesis.
PASS  completeness: issuance numbers dense across 1 issuer(s).
```

**Hedera.** A live x402-gated service settled through the **Blocky402** facilitator, with a
real paid request end to end. Hedera Consensus Service is the evidence substrate: ordered,
sub-cent, and independently re-derivable through its running hash chain — which we
recompute locally in SHA-384 rather than trusting the mirror node's word for it. That
required reproducing Hedera's **Java-serialization framing**; the documented field list
alone produces a hash that never matches, with no diagnostic. Nothing else in the ecosystem
ships this. **The gate settles in an HTS token we minted, carrying a custom fractional fee
schedule** — the fee is visibly assessed on chain in every settlement. **On-call standby pay
is a Scheduled Transaction**, so the witness's next retainer fires from Hedera's clock
rather than ours and can be verified before they agree to be on call. The agent and the
gate each carry an HCS-14 UAID, and the gate publishes an A2A agent card.

**World.** Selfie Check is used as an **abuse-prevention and eligibility** signal, not an
identity signal: it is what stops the approval being satisfied by the agent's own service
account. The decision hash is the `signal`, which is the mechanism the whole product rests
on. **We do not claim it proves one-person-one-account** — it proves liveness and facial
continuity, and every attestation records in an explicit field which property it carries.
World granted the beta flag on 2026-09-09, "for the duration of the hackathon", so Selfie
Check itself is what runs, with `require_user_presence` alongside it. Selfie Check itself is one variable away: `selfieCheckLegacy` is
already wired, and our verifier is unit-tested against selfie-shaped proofs — it accepts
them, rejects a v4 proof on that path, and requires the stable nullifier the
operator-independence check depends on.

To be exact about what has been shown with the real credential: **World issued a genuine
Selfie Check proof to this app and the World App confirmed the connection on-device.** The
proof reached our verifier and was **rejected by our own single-use nonce check**, because
we minted the RP signature on page load rather than on commit and its 300s window expired
during the selfie. That is fixed, and the timing defect is written up as
[`WORLD_FEEDBACK.md`](WORLD_FEEDBACK.md) §3.8. We are not claiming a completed
proof-backed approval beyond that point.

**Circle and Arc.** Every 402 advertises **two rails**: Hedera via Blocky402, and Arc
testnet via **Circle's Gateway facilitator** — USDC at Arc's ERC-20 interface, using
`GatewayEvmScheme` so the EIP-712 verifying contract survives to the buyer. No single
facilitator serves both, so the resource server runs two. We had wrongly concluded Arc was
unsupported because we had only ever asked Blocky402; Circle's own facilitator serves it.

**The agent checks the price is signed before paying it.** x402 clients answer a 402
automatically, which means they pay whatever they are told. Ours fetches the challenge
unpaid, verifies the seller signed those exact terms, and checks the signer against the
published attestor address. Recovering *an* address always succeeds; recovering the *right*
one is the check.

**Prior art, named first.** World ships
[`@worldcoin/human-in-the-loop`](https://docs.world.org/agents/human-in-the-loop/integrate):
an agent pauses until a verified human approves. Same control flow, shipped by the sponsor,
and we are not pretending otherwise. What Proctor adds: the approver is a cryptographically
distinct account from the operator; the approval is a liveness proof bound to the decision
rather than a static credential; the output is an externally ordered evidence record rather
than a resumed function call; and **the witness is actually paid**, in a real transfer per
decision, with a refusal paid identically to an approval — because paying only for
approvals would price the witness to say yes.

**Not a marketplace.** Witnesses hold an org-issued role on a rota. Nobody lets an
anonymous stranger approve EUR 41,200, and Proctor does not propose that they should.

---

## What is real, and what is not

Testnet only. **Verified:** the evidence topic with no admin key, the running-hash chain
verified offline from genesis, tamper detection, completeness both locally and offline, a
Blocky402-settled payment, the witness paid on chain, both rails on the wire, signed offers
verified by the buyer, and an Article 12 export that passes its own verifier.

**Arc now settles.** Both rails work end to end: the agent pays $0.42 on Hedera (final on
chain) or on Arc through Circle Gateway (committed to a batch, on chain when the batch
settles). Gateway balance moved `2.000000 → 1.580000` USDC. Mainnet: not shipped. The Selfie Check flag was requested on 2 September and
has not arrived.

**192 tests.** `bun run acceptance` checks fifteen claims against a running service and
exits non-zero if a configured leg misbehaves, because a claim that cannot be executed is a
claim nobody will check.

---

## How this was built with AI

Every planning artefact is in the repo. [`docs/ai/`](docs/ai/) documents the process and
then spends most of its length on **the defects the AI-assisted work introduced** — a field
that was null on every record ever written, a demo whose console contradicted its own
evidence log, an export that failed its own verifier. Each passed review, types and a green
test suite; all were found by running the system and checking its output against what the
repository claimed.

---

## Links

| | |
|---|---|
| Evidence topic | `0.0.10390147` on Hedera testnet, no admin key |
| Verify it yourself | `bun verify/bin/verify.ts --topic 0.0.10390147` |
| Blocky402-settled payment | `0.0.7162784@1788535476.476844044` |
| HTS settlement + custom fee | `0.0.7162784@1788713352.579834930` |
| Gate settlement token | `0.0.10394781` (PGC), custom fractional fee |
| On-call retainer, scheduled | `0.0.10394981` — fired by Hedera at expiry, +500000 tinybar |
| Witness fee, on chain | `0.0.10349667@1788697676.088483944` |
| Arc agent identity | ERC-8004 `891434` on Circle's canonical registry |
| Architecture diagram | [`docs/architecture.png`](docs/architecture.png), rendered from [`.mmd`](docs/architecture.mmd) source |
| Sponsor feedback | [`WORLD_FEEDBACK.md`](WORLD_FEEDBACK.md) |
| Harness contribution | [`harness/PR_DESCRIPTION.md`](harness/PR_DESCRIPTION.md) |
