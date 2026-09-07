<div align="center">

# PROCTOR · backend

**The gate, the witness flow, the evidence writer, and the money.**

<br />

![Runtime](https://img.shields.io/badge/Bun-1.2%2B-000000?style=flat-square)
![Fastify](https://img.shields.io/badge/Fastify-5-black?style=flat-square)
![Postgres](https://img.shields.io/badge/Postgres-15%2B-336791?style=flat-square)
![Tests](https://img.shields.io/badge/tests-185%20passing-EE6A55?style=flat-square)

<br />

One Fastify process, one Postgres, and one conditional `UPDATE`. It issues the HTTP 402 an
agent stops on, dispatches the decision to a human who is not the operator, verifies the
liveness proof against World, writes an attestation to a Hedera topic with no admin key,
and pays the witness.

**Postgres is the index. HCS is the truth.**

</div>

---

## Sixty seconds

```bash
cp .env.example .env          # DATABASE_URL is the only value you must edit
bun install
bun run db:push
bun run seed && bun run demo
```

That runs the whole oversight loop with **no wallet and no API keys**. It also tells you,
in its own closing line, that the record it just produced is *not* independently
verifiable — because it was signed with a published demo key and never reached a topic.

```
9. witness paid  : NOT SETTLED (witness_has_no_payout_account) - recorded as owed

   The agent is released. The oversight loop ran in full.
   NOT yet independently verifiable. Missing: ATTESTOR_PRIVATE_KEY (signed with the
   published demo key); HEDERA_OPERATOR_ID/KEY + HEDERA_TOPIC_ID (hedera_not_configured)
   Run `bun run doctor` for the full picture.
```

**The difference between "it ran" and "it produced evidence" is the entire product, so the
tooling refuses to blur it.** A cold clone used to crash here instead; see
[`docs/ai/`](../docs/ai/) for why that mattered more than it looked.

---

## The commands that matter

| Command | What it does |
|---|---|
| `bun run doctor` | Ten legs, each with **what breaks** without it, and one line: are these records independently verifiable, or not |
| `bun run live [ttl] [--pay]` | **The demo.** Opens a real decision, pops the operator handoff screen on this laptop, streams the state live, and prints the HCS sequence and payout when a phone resolves it |
| `bun run e2e` | **The whole journey in one command.** A real agent pays, a human refuses, the evidence lands on HCS, the witness is paid, and the verifier binary checks it as a separate process. Exit 1 on any failure |
| `bun run acceptance` | Sixteen claims checked against the running service. Tolerant about configuration, intolerant about correctness — exit 1 if a configured leg misbehaves |
| `bun run demo [refuse]` | The loop, library-level, no HTTP |
| `bun run rehearse [refuse]` | The loop through the **real HTTP routes**, with a per-leg latency budget for the video |
| `bun run open [ttl]` | Open one decision and print the witness + handoff URLs |
| `bun run topic:create` | Mint an evidence topic. **No admin key, no undo.** Dry run unless `--confirm` |
| `bun run token:create` / `token:fund` | Mint the HTS settlement token and fund the agent |
| `bun run arc:deposit` | Fund the Circle Gateway balance on Arc |
| `bun run retainer` | Commit the next on-call retainer as a Scheduled Transaction |
| `bun run marketplace` | Query Circle's Agent Marketplace. Reproduces "zero Hedera services listed" |

Every script that writes to a chain is a **dry run by default** and needs `--confirm`. An
irreversible write should not be one stray shell-history arrow away.

---

## Routes

| Route | Who calls it | Notes |
|---|---|---|
| `POST /v1/gate/evaluate` | agent | **Free.** Most actions stop here and proceed for nothing |
| `POST /v1/gate/decisions` | agent | **x402 paywalled.** Two rails advertised, each through a different facilitator |
| `POST /v1/gate/decisions/:id/release` | agent | Metered from real review seconds, not a flat charge |
| `GET /v1/gate/decisions/:id/stream` | agent | SSE at 4Hz. The on-camera wait |
| `GET /v1/witness/decisions/:token` | phone | Token-authenticated, scoped to one decision |
| `POST /v1/witness/rp-signature` | phone | ES256 RP signature, minted **per decision**, single-use nonce |
| `POST /v1/witness/decisions/:token/respond` | phone | The one route that decides everything |
| `GET /v1/evidence/decisions`, `/:id` | auditor | Postgres-served; every row carries the sequence number to re-verify |
| `GET /v1/evidence/gaps` | auditor | Completeness — a different question from integrity |
| `POST /v1/evidence/export` | auditor | The Article 12 export. Pass `orgId`, or you get every org |
| `GET /.well-known/proctor.json` | anyone | Trust roots. The authoritative copy is on the topic |
| `GET /.well-known/agent-card.json` | agents | A2A v1.0, with a URL another agent can actually call |
| `POST /v1/demo/run` | operator console | Opens a decision from the browser. **`DEMO_MODE` only**, rate limited, and its own response says `paid: false` |
| `POST /a2a` | agents | A2A JSON-RPC. `a2a.GetTask` returns a spec-shaped Task; the attestation comes back as an artifact |
| `GET /features` | reviewers | Everything built, and what is honestly blocked |
| `GET /openapi.json` | agents | Also a Circle marketplace listing prerequisite |

---

## Five decisions worth knowing

**It fails closed.** No answer inside the TTL is a `REFUSE`, arbitrated by one conditional
`updateMany`. Under READ COMMITTED Postgres re-evaluates the `WHERE` clause after blocking,
so the sweeper always wins when overdue and the approver always wins when valid. No
transactions, no `SELECT FOR UPDATE`, no Redis. `lifecycle.test.ts` races it 50 times in
both directions.

**A refusal requires no proof.** Making a human prove liveness to press a stop button puts
a failure mode between a person and a brake pedal. Every attestation carries
`wa: "proof" | "token"` so the record never overstates what authenticated the witness.

**Evidence writes are opt-in per org.** `Org.attestable` defaults to `false`. The topic has
no admin key, so anything written there is permanent for everyone forever — and the TTL
sweeper will happily attest leftover fixture rows on any dev server. It has done exactly
that, and those records cannot be removed.

**Issuance numbers are handed out inside the create transaction.** `orgSeq` is dense per
org and signed into every attestation as `sq`, which is what makes a *withheld* decision
visible. Incrementing outside the transaction would burn a number on failure, and a phantom
gap is a false accusation of hiding evidence — worse than no check. A database trigger now
refuses to let the counter go backwards.

**Money never touches a float.** Nullifiers are `Decimal(78,0)`, amounts are
`Decimal(38,18)`, and the meter is integer arithmetic on atomic units.

---

## Configuration

Only `DATABASE_URL` and `JWT_SECRET` are required. **Every other value disables exactly one
leg, loudly, rather than crashing** — `bun run doctor` prints what each gap costs.

`src/config/main-config.ts` is the only module allowed to read `process.env`. That is not a
style rule: it is what makes the mainnet-readiness claim structural. Zero chain literals in
source means porting is an env file, not a refactor.

```bash
grep -rn "process.env" src/ | grep -v config/main-config
```

Three hits, all of them the same test-runner guard
(`NODE_ENV === 'test' || BUN_TEST`) in `persist.ts`, `witness.ts` and `retainer.ts` — the
switch that stops fixtures reaching a topic nobody can clean. **No chain identifier, price
or endpoint appears outside the config module.**

Two that bite:

- **`WITNESS_APP_URL` cannot be `localhost`.** The witness flow ends on a phone, and a
  phone cannot resolve your localhost. Use the LAN address or a tunnel.
- **`GATE_ASSET=TOKEN`** settles in an HTS token you minted, which removes the faucet
  dependency entirely. `HBAR` needs no faucet. `USDC` needs one that has never delivered on
  Hedera testnet.

---

## Tests

```bash
bun test        # 185 pass
bun run typecheck
```

They run against a **real Postgres**, because the properties under test are concurrency
guarantees and a mock would prove nothing. Chain writes are disabled under the test runner
so fixtures can never reach the immutable topic.

The ones that carry weight:

- **`lifecycle.test.ts`** — approve vs sweep, raced both directions, invariant holds at the knife edge
- **`completeness.test.ts`** — a decision suppressed *before* submission is caught although no hash breaks, **and the residual weakness is asserted** so nobody upgrades it into an overclaim
- **`payout.test.ts`** — a refusal is paid too, three concurrent calls produce exactly one payment
- **`worldVerify.test.ts`** — seven assertions, including that a device proof without liveness is refused
- **`offerReceipt.test.ts`** — recovery *succeeding* on forged data is distinguished from recovery returning the *right* address

---

## Layout

```
src/
  routes/      gate · witness · evidence · well-known · features
  lib/
    x402/      two facilitators, boot preflight, capability cache
    world/     seven assertions, RP signing
    decision/  issuance, lifecycle, fail-closed sweeper
    attestation/  RFC 8785 → EIP-712 → HCS
    evidence/  export, completeness
    payout/    witness fee, on-call retainer
    hedera/    client, HCS
    arc/       chain, ERC-8004 identity
prisma/
  schema.prisma
  sql/         constraints Prisma cannot express, applied by db:push
scripts/       everything above, dry-run by default
```

---

<div align="center">

**Postgres is the index. HCS is the truth.**

</div>
