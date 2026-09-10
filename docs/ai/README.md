# How this project was built with AI

ETHOnline's rules require that spec files, prompts and planning artefacts ship in the
repo, because *"judges want to see how you directed the AI, not just the output."*

Everything is here. This page explains the process, and then spends most of its length on
the part that is actually useful: **where the AI-assisted work was wrong, how each defect
was caught, and what changed so it could not recur.**

---

## The artefacts

| Where | What |
|---|---|
| Research log, kept out of the repo | 26 documents, written before any code. Working notes rather than product documentation, so they are not published |
| [`../build/`](../build) | 10 build PRDs, one per subsystem, written before each was implemented |
| [`../../WORLD_ACCESS.md`](../../WORLD_ACCESS.md), [`../../HEDERA_SETUP.md`](../../HEDERA_SETUP.md) | Operational runbooks for the two gated integrations |
| [`../../WORLD_FEEDBACK.md`](../../WORLD_FEEDBACK.md) | Sponsor feedback, written as each item was hit rather than reconstructed |

The numbered documents are kept in their original order **including the ones that were
superseded**. `04`, `05`, `06`, `07`, `10`, `11`, `12`, `14` and `16` argue for products
that were then killed. They are retained because the reasoning that killed them is the
most reusable thing in the set.

---

## How the work was actually directed

**Research first, and specifically research that tries to kill the idea.** Five candidate
products were discarded before Proctor survived. The filter, from
the red-team pass in that research log, is four questions:

1. Who is *compelled* to pay — statute, contract, margin call?
2. What existing invoice shrinks?
3. What does user one get with zero other users?
4. Could the buyer produce this themselves for the same cost?

The corollary that killed the most ideas: in bonded, permissionless, adversarial designs,
**the only people who post the bond are the people who do not need to.** Those designs
demo beautifully and are economically inert.

**Docs-first, against the primary source.** Where a model's recollection of an API and the
published documentation disagreed, the documentation won; where the documentation
contradicted itself, that contradiction was recorded rather than resolved by guessing. The
World ID nullifier-stability contradiction ([`WORLD_FEEDBACK.md`](../../WORLD_FEEDBACK.md)
§1.1) decides whether this product's central security property is real, and it was found
by reading two pages that disagree rather than by writing code.

**Then: assume the output is wrong until it is executed.** This is the part that mattered
most, and the rest of this page is the evidence for it.

---

## What the AI got wrong

Every defect below was written by AI-assisted work, passed code review, passed a
type-checker, and passed a green test suite. Each was found by running the system and
comparing what it *did* against what the repo *claimed*.

They are grouped by what made them invisible.

### Placeholders that type-check

| Defect | Consequence |
|---|---|
| `rawDigest: ''` in the witness route | `persist.ts` reads `rawDigest \|\| null`, so an empty string made **`wid` null on every attestation ever written**, including real approvals. `wid` is the digest an auditor needs to re-verify a proof against World, so the headline "re-verify against World, not against us" was unsupported on the wire. `worldProofDigest()` already existed and had never been called. |
| Empty block in `verify/bin/verify.ts` | The README's single most prominent command, `bun verify/bin/verify.ts --topic …`, threw a `TypeError`. A judge running the one thing we ask them to run would have seen a stack trace. |

### Two sources of truth that drifted apart

| Defect | Consequence |
|---|---|
| The demo built an attestation in memory; `attestDecision` rebuilt it from the database | The console printed `ind=crypto`, the evidence log recorded `ind=policy, wid=null`. **The demo and the evidence disagreed** — the exact failure this product exists to detect, in our own output. |
| Export matched records to HCS messages by sequence number alone | Sequence numbers are **per-topic** and restart at 1. Records from an earlier topic collided with unrelated messages, and the Article 12 export failed its own verifier: *"this export is not evidence."* Nothing had been tampered with; the comparison was meaningless. |

### Checks that accused the innocent

A false accusation is worse than no check, because it trains a reader to ignore the check.

| Defect | Consequence |
|---|---|
| Completeness filtered out unresolved decisions before reconciling | Open decisions vanished from the map and reappeared as *withheld evidence*. Decisions resolve out of order, so this fired constantly. |
| Completeness checked density across a whole topic | Two organisations interleaving read as gaps, and a second org's `#1` read as a duplicate. Fixed by grouping on a discriminator already in every record. |
| Completeness started counting at `1` | Records predating the field, and mirror query windows that do not reach the first record, were both reported as suppressed. |
| The CLI asserted *"Something was never written"* | From outside a topic, an **open** decision and a **suppressed** one are both simply absent. The tool cannot tell them apart and must not pretend to. It now prints both readings and says a hole that *persists* is the finding. |

### A citation that did not survive being read to the end

`docs/regulatory-mapping.md`, the README and the submission text all quoted EU AI Act
Article 14(5) — *"at least two natural persons"* — as binding the worked example. It does
not. The provision opens **"For high-risk AI systems referred to in point 1(a) of Annex
III"**, which is *remote biometric identification*. A supplier-payment agent is not that.

The quote had been trimmed at exactly the clause that limits it, and the trimmed version
was load-bearing in the demand-side argument of a compliance-framed product. It was found
by fetching the Act rather than trusting the quotation already in the repo.

The claim is now scope-accurate and, in the process, stronger: Articles 12 and 14(4) bind
every high-risk deployer and Proctor satisfies both; 14(5) is the strictest bar the Act
names and Proctor builds to it regardless, while stating exactly where it applies. A test
asserts the scope qualifier so it cannot be dropped again.

### An invariant documented, then violated by its own author

`Decision.orgSeq` must be monotonic for the lifetime of an issuer. One session after
writing that down, a demo counter was reset by hand, and the topic permanently recorded
`sq 1,2,3` **and** `12,13,14` from one issuer with `4..11` unexplainable forever, on a log
with no admin key.

A comment was evidently not enough. It is now a database trigger
([`../../backend/prisma/sql/001_counter_monotonic.sql`](../../backend/prisma/sql/001_counter_monotonic.sql))
applied by `bun run db:push`.

### Defaults that were safe for the author and unsafe for everyone else

| Defect | Consequence |
|---|---|
| The TTL sweeper attested every expired decision | Any dev server with fixture rows wrote junk to a **permanent, undeletable** topic. `Org.attestable` now defaults to `false`; orgs opt in. |
| `bun run demo` threw without `ATTESTOR_PRIVATE_KEY` | The README promises *"no wallet, no API keys"*. A cold clone crashed. |
| `.env.example` documented 5 of 42 variables | It was still the starter template. Every Proctor variable was undocumented. |

---

## What changed in the process

**Claims are now executable.** `bun run acceptance` checks fifteen assertions against a
running service — that the 402 carries a signed offer, that the topic has no admin key,
that the evidence log is complete — and exits non-zero when a configured leg misbehaves.
A claim that cannot be executed is a claim nobody will check.

**Tooling refuses to blur "it ran" and "it produced evidence."** An unconfigured run
completes the whole oversight loop and then says, in its own closing line, that the record
is **not** independently verifiable and why. `bun run doctor` lists what each missing
value costs. That distinction is the product, so the tooling is not allowed to soften it.

**Residual weaknesses are asserted by tests.** Completeness cannot detect an operator who
stops writing entirely, and a test asserts exactly that, so that a future change cannot
quietly upgrade the claim into an overclaim.

---

## Auditing this page

Do not take it on trust. The defects above are visible in the git history, and every fix
carries a test named after the failure. The pattern in one line:

> Every one of these passed review, types and tests. All were found by running the system
> and checking its output against what the repository claimed about it.
