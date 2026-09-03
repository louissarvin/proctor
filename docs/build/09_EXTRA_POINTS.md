# Step 09 — Extra points and the Harness contribution

**Goal:** take Hedera's extra-points score from **1.5/7 to 5.5/7** for about 4 to 6 hours of work,
and ship the second Hedera submission.

**Prize linkage:** Hedera AI & Agentic Payments (extra points) and **Improve the Harness, 2 seats x
$1,000**, which is assessed as the least contested prize in the entire event.

**Day:** 7 (Sep 10).

> **This is the best marginal use of build time anywhere in the plan.** It sits on the track with
> the most money and the most seats, and most of it is writing rather than building.

---

## 1. The seven extra points, scored honestly

Verbatim from the track:

> - Pay-per-call inference, data, or compute metering rather than a flat per-request charge
> - Multi-agent negotiation and settlement via A2A or ACP
> - On-chain agent identity using ERC-8004 or HCS-14
> - Agent discovery via UCP, or a directory that makes your service findable by other agents
> - HTS tokens or custom fee schedules in the settlement path
> - Verifiable payment audit trails on HCS
> - Recurring or streamed payments using Scheduled Transactions

| # | Point | Today | Action | Hours |
|---|---|---|---|---|
| E1 | HCS audit trails | **YES, fully** | say the words *"verifiable payment audit trail"* out loud | 0 |
| E2 | Pay-per-call metering | partial | already on the plan (step 08) | 0 |
| E6 | HTS in the settlement path | **already true** | **claim it, build nothing** | 0.25 |
| E3 | HCS-14 agent identity | no | 30-line UAID generator | 1-2 |
| E5 | Discovery | no | take the **second clause** of the bullet | 0.5 |
| E4 | A2A | no | agent card + TaskState mapping | 2-3 |
| E7 | Scheduled Transactions | no | **skip**, we cut HIP-1215 | - |

**Ranks 1 to 5 total 3.75 to 6 hours and move the score from 1.5/7 to 5.5/7.**

---

## 2. E6, the free one: claim HTS correctly

**USDC on Hedera is an HTS token.** Every gate payment and every meter payment already moves an HTS
fungible token through the settlement path. That satisfies the bullet at zero cost.

Write in the README's payment-flow section: *"settlement moves HTS USDC, token id `0.0.429274`,
verifiable on HashScan."*

**Do NOT add a custom fee schedule.** It would fork settlement away from the USDC the facilitator
understands, and the facilitator is what the qualification bullet names. A judge reading *"we
invented a token so we could attach a fee schedule"* sees decoration. 4 to 6 hours, high risk, no
upside. **Do not do it.**

---

## 3. E3: HCS-14 UAID, ~30 lines, no SDK

Grammar: `uaid:{aid|did}:{id};{params}`. The AID form hashes exactly six fields:

```json
{ "registry": "string", "name": "string", "version": "string",
  "protocol": "string", "nativeId": "string", "skills": [0] }
```

Rules: lowercase and trim `registry` and `protocol`, trim the rest, sort `skills` numerically
ascending, serialise with sorted keys, **hash with SHA-384, Base58-encode**. Routing params follow
in order `uid`, `registry`, `proto`, `nativeId`, `domain`, with `nativeId` as CAIP-10.

**SHA-384 is already in the project** because of the running-hash verifier, so there is no new
primitive. Generate one UAID for the **paying agent** and one for the **gate service**, put both in
the attestation and the README, and ship a unit test with a fixed vector so a reader can reproduce
the string.

**Why HCS-14 and not ERC-8004.** ERC-8004 needs three registries, a deployed and verified contract,
a hosted registration file, and it wants per-chain singletons, so a self-deployed registry is a
weaker claim than registering in a canonical one. There is no canonical ERC-8004 deployment on
Hedera testnet. Cost 5 to 8 hours for a **worse** version of a point HCS-14 gives in 1 to 2. Also
we decided on zero Solidity. **Do not do ERC-8004.**

Caveat to state honestly: HCS-14 is **Draft**. Write *"we generate a HCS-14 UAID per the draft
specification, deterministically, without depending on the SDK"*, not *"we are HCS-14 compliant"*.

---

## 4. E4: A2A, and why Proctor already is one

Proctor's control flow **is** an A2A task, exactly. From the spec:

> `TASK_STATE_AUTH_REQUIRED` — Indicates that authentication is required to proceed. **This is an
> interrupted state.**

An agent submits a task, the task enters an interrupted state while a human is required, then
resolves to COMPLETED or REJECTED. That is a one-to-one description of the gate. `AgentCapabilities`
even has a first-class `pushNotifications` boolean, which is literally our dispatcher.

| Layer | What | Hours | Claim it earns |
|---|---|---|---|
| 1 | `GET /.well-known/agent-card.json`, one skill `human-oversight-gate`, `capabilities.pushNotifications: true` | 1 | "discoverable as an A2A agent" |
| 2 | Map the decision lifecycle onto A2A `TaskState`: SUBMITTED on 402, AUTH_REQUIRED while awaiting the witness, COMPLETED on approve, REJECTED on refuse or TTL | 1-2 | "the gate is an A2A task in the interrupted `auth-required` state" |
| 3 | JSON-RPC `message/send` binding | 3-6 | "multi-agent settlement" — **cut this first** |

**Do not claim "negotiation" unless layer 3 ships.** There is no negotiation in Proctor and a judge
who knows A2A will notice. Claim exactly: *"the gate is modelled as an A2A task in an interrupted
state, which is what A2A's `auth-required` state exists for."* True, specific, shows you read the spec.

**Skip ACP.** The acronym is ambiguous in Hedera's own bullet, and in 2026 it most commonly means
the OpenAI/Stripe Agentic Commerce Protocol, which is card-rail checkout and structurally unrelated.

---

## 5. E5: take the second clause

Read it again: *"Agent discovery via UCP, **or a directory that makes your service findable by other
agents**."* The second clause is a far lower bar and you already satisfy it.

Three artefacts you are building anyway:

1. The **A2A agent card** at a stable well-known URL
2. The **x402 `accepts[]` array itself**, which already advertises price, asset, network and
   facilitator in machine-readable form. **Discovery by construction, and most teams will not
   notice they have it**
3. The **OpenAPI spec** generated from the zod schemas

Then one README section: **"How another agent finds and pays for this service."** That section *is*
the deliverable. 30 to 60 minutes.

**Skip UCP.** It standardises product catalogues and carts for retail. Proctor sells an oversight
gate, not a SKU. Forcing a cart schema on it is visible decoration and costs a day.

---

## 6. THE HARNESS: 2 seats x $1,000, and almost nobody is watching

Repo health when last read: **1 star**, 1 fork, 5 open issues and PRs, created 2026-07-27, last push
2026-08-30, MIT. **Five weeks old, actively developed, and nearly unwatched. A competent PR will be
seen.**

Qualification, verbatim:

> - Either submit a meaningful contribution to the Hedera Harness (**open PR, not merged is fine**)
>   or build a new harness that extends or takes direct inspiration from it.
> - Public GitHub repo or PR link, with a README or PR description explaining the problem you solved
>   and how to run it.
> - **Demo video of five minutes or less showing the improvement working.**

**"Open PR, not merged is fine" is verbatim.** That removes the single biggest risk on this track.

### What the harness does NOT cover, which is exactly our competence

1. **No HCS validator.** It verifies transactions via mirror node but **nothing verifies topic
   messages**
2. **No running-hash chain verification anywhere in the Hedera tooling ecosystem**
3. No x402 payment validator
4. Issue **#8 is open and unclaimed**: *"Add an optional HOL Guard validator to the deterministic
   ASSERT stage"*, opened 2026-08-13, no PR. A stated, unassigned maintainer want

### Ship this

An **HCS attestation validator** plus a `docs/prds/` recipe that exercises it. Derived entirely from
work you already did in step 02. It closes the loop on our own pitch: the harness would be able to
*prove* that an agent-built oversight feature really wrote a tamper-evident record.

Plus the trivial four-line `skills-index.json` diff moving `x402-payments` out of `unmerged-skills`,
as a second, easily-mergeable contribution.

### Three things that will date your PR instantly

- **Base on `dev`, not `master`.** `master` is a stale snapshot; 15 PRs have merged into `dev` since
- **"Tier 3.5" and `contract` are retired vocabulary.** The current register is
  **ASSERT / SMOKE / EVALUATE / CHAIN**. Extend the **CHAIN** stage
- The harness **does not auto-load `.env`**; export vars in your shell. And Tier work requires an
  **ECDSA** operator, since ED25519 has no EVM alias

Write the PR description in the maintainers' register: **what broke, why, what changed.** The
CHANGELOG is detailed and opinionated, so they care about quality.

### DO NOT FORGET THE SECOND VIDEO

*"Demo video of five minutes or less showing the improvement working"* is a **separate deliverable**
from the main submission video. A 90-second screen recording of a harness run with the HCS
assertions failing, then passing. **Budget 30 minutes on day 7.** It is a $1,000-per-seat
requirement and the cheapest video anyone will ever shoot.

---

## 7. Definition of done

- [ ] README says "verifiable payment audit trail" and names HTS USDC `0.0.429274`
- [ ] `makeUaid()` shipped with a fixed test vector; two UAIDs in the attestation and README
- [ ] `/.well-known/agent-card.json` served with the 8 required fields
- [ ] Decision lifecycle mapped to A2A `TaskState` in the API and console
- [ ] README section "How another agent finds and pays for this service"
- [ ] Harness PR open **against `dev`**, in ASSERT/SMOKE/EVALUATE/CHAIN vocabulary
- [ ] `docs/prds/` recipe + `spec.yaml` (these double as the event's AI-attribution artefacts)
- [ ] **90-second harness demo video recorded**
- [ ] No ERC-8004, no UCP, no custom fee schedule, no HIP-1215
