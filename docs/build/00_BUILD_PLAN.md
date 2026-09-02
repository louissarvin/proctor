# Proctor Backend Build Plan

The master sequence. Every step is a separate file in this folder, each self-contained with its
goal, the sponsor requirement it satisfies, the official docs it is built against, exact packages,
and a definition of done you can actually check.

**Read this file first, then work the numbered files in order.**

---

## 0. The goal, in one sentence

> An AI agent stops mid-payment and pays a live, verified human for permission to continue,
> and the proof is admissible.

The customer buys **the evidence, not the approval**. Every design decision below follows from that.

---

## 1. COMPLIANCE GUARDRAIL. Read before writing any code.

ETHGlobal requires the submitted work to be done **during** the hackathon, with a repo "proving the
work was done during the hackathon, clearly distinguishing new from reused work." Large single
commits or missing history **may be disqualified**.

Hacking opens **Fri Sep 4, 12:00pm EDT**. It is currently Sep 2.

| Period | What is allowed | What is NOT allowed |
|---|---|---|
| **Now → Sep 4, 12:00** | Accounts, access requests, credentials, dependency verification, **throwaway spikes in `/tmp`**, planning docs | **Product code committed to the repo** |
| **Sep 4, 12:00 →** | Everything | Single giant commits |

**The rule we follow:** spikes live in `/tmp/proctor-spike/` and are never committed. Product code
starts Sep 4 at noon. The baseline commit (research docs + unmodified starter templates) is already
in, dated Sep 2, which is honest and correct: it is reused scaffolding, disclosed as such.

**Say this in the README**, under a "What predates the hackathon" heading:
- The two starter templates (Kwek Labs Fastify and TanStack Start), unmodified, committed Sep 2
- The research and planning documents, committed Sep 2
- Everything else, committed Sep 4 onward

Naming what you reused reads as judgement. Hiding it reads as a violation.

**Also required, and most teams will skip it:** spec files, prompts and planning artifacts must be
in the repo. Ship `docs/ai/`. We already have an unusually rich planning trail; this converts a
compliance rule into a differentiator.

---

## 2. What we are building, and what we are not

**Decided: zero Solidity.** No Foundry, no CREATE2, no HIP-1215, no contracts. Nothing on the
critical path needs one, and no prize bullet requires one. Enrolment records and trust roots go to
HCS, where the consensus timestamp is assigned by the network and cannot be backdated any more than
a contract event can.

**Four deliverables, not two:**

| Folder | What | Status |
|---|---|---|
| `backend/` | Fastify API: x402 gate, policy, HCS writer, World verify, TTL, payouts | starter, this plan |
| `web/` | Console **and** witness PWA, two routes in one app | starter |
| `agent/` | Circle Agent Stack fork, the terminal on camera | not created |
| `verify/` | Zero-dependency offline HCS verifier | not created |

**Explicitly out of scope** (each is a real temptation with a real reason):
multi-tenant onboarding, a witness marketplace (the word is **rota**), on-chain World proof
verification (impossible for Selfie Check on any chain), a Mini App, building on
`@worldcoin/human-in-the-loop`, self-hosting a facilitator, Circle Paymaster / Gas Station / CCTP,
HTS system-contract calls from Solidity, a generic policy language (four predicates), Redis or
queues (one Fastify process, one Postgres, one conditional UPDATE).

---

## 3. Backend layout, mapped onto the existing starter conventions

`backend/CLAUDE.md` mandates the structure. We extend it rather than fight it.

```
backend/
  index.ts                      register routes + workers
  src/
    config/main-config.ts       THE ONLY place process.env is read
    routes/
      gateRoutes.ts             /v1/gate/*      agent-facing, x402-paid
      witnessRoutes.ts          /v1/witness/*   phone-facing, witnessToken auth
      worldRoutes.ts            /v1/world/*     RP signature minting
      evidenceRoutes.ts         /v1/evidence/*  console + Article 12 export
      wellKnownRoutes.ts        /.well-known/*  public, no auth
    middlewares/
      authMiddleware.ts         exists (JWT) -> replaced by orgKeyMiddleware
      orgKeyMiddleware.ts       argon2id bearer key
      witnessTokenMiddleware.ts opaque token, single decision, dies with the TTL
    lib/
      prisma.ts                 exists
      hedera/                   HCS client, topic, submit, mirror node
      world/                    signRequest, verifyWitnessProof, presets
      x402/                     facilitator client, accepts[], plugin wiring
      attestation/              canonical, hash, sign, build
      hcsVerify/                running hash chain, ZERO deps (mirrors verify/)
    workers/
      ttlSweeper.ts             node-cron, fails decisions closed at expiry
    utils/                      errorHandler, validationUtils (exist)
```

**Conventions that are non-negotiable** (from `backend/CLAUDE.md`):
- Import env from `config/main-config.ts`, **never** `process.env` directly
- All errors through `handleError(reply, code, message, CODE)` from `utils/errorHandler.ts`
- Responses are `{ success, error, data }`
- Routes are Fastify plugins registered with a prefix in `index.ts`
- Workers use the `isRunning` flag pattern
- **NEVER run a destructive Prisma command.** Ask the user to run `db:push` themselves

---

## 4. The build sequence

Each step has its own file. Do not start a step until the previous one's definition of done passes.

| # | File | What | Unlocks | Prize |
|---|---|---|---|---|
| 01 | `01_FOUNDATIONS.md` | Deps, env contract, Prisma schema, migration, health | everything | - |
| 02 | `02_HCS_EVIDENCE.md` | HCS topic, submit, mirror read, running-hash verifier | the product claim | **Hedera** |
| 03 | `03_X402_GATE.md` | x402 paywall via **Blocky402**, one real paid request | the demo's first beat | **Hedera** (both bullets) |
| 04 | `04_WORLD_VERIFY.md` | RP signing, the verification assertions | the witness | **World** |
| 05 | `05_DECISION_LIFECYCLE.md` | Decision state machine, TTL fail-closed, dispatch | the 60s clock | - |
| 06 | `06_ATTESTATION.md` | canonical -> hash -> EIP-712 -> HCS write | the evidence record | **Hedera** |
| 07 | `07_EVIDENCE_API.md` | Console API, Article 12 export, `.well-known`, offline verify | "verify without trusting us" | **Hedera**, Arc |
| 08 | `08_METER_PAYOUTS.md` | Per-second meter, Circle Wallets payout | the meter on camera | **Arc/Circle** |
| 09 | `09_EXTRA_POINTS.md` | HCS-14 UAID, A2A agent card, discovery README | 1.5/7 -> 5.5/7 | **Hedera** |

**Steps 02 and 03 are the two that must not slip.** They are the Hedera track, which holds $3,000
across 5 seats and is the largest realistic line in the plan.

---

## 5. Day map

Hacking: Fri Sep 4 12:00 EDT -> Sun Sep 13 12:00 EDT. Freeze end of day 8. Submit day 9 morning.

| Day | Date | Backend work | Gate |
|---|---|---|---|
| 0 | Sep 2-3 | Access requests, spikes in `/tmp`, dependency verification | no product code |
| 1 | Sep 4 | Step 01 + step 02 spikes. **Go/no-go on HCS and x402** | H3, H4 green or the project changes |
| 2 | Sep 5 | Step 02 complete, step 03 started | a real 402 issued |
| 3 | Sep 6 | Step 03 complete, step 04 | **18:00 Selfie Check fallback decision** |
| 4 | Sep 7 | Step 05. **Measure Web Push p50/p95 over 30 samples** | p95 > 2s -> build WS fallback day 5 |
| 5 | Sep 8 | Step 06 | attestation lands on HCS |
| 6 | Sep 9 | Step 08 | **18:00 `METER_MODE` decision** |
| 7 | Sep 10 | Step 07, step 09, README, diagram, harness PR, feedback docs | all deliverables exist |
| 8 | Sep 11 | **FREEZE 12:00.** Video all afternoon and evening | one working take banked by 18:00 |
| 9 | Sep 12 | Submit early | submitted Friday evening |

---

## 6. Prize linkage, so effort lands where the money is

| Track | Seats x value | What the backend must produce |
|---|---|---|
| **Hedera AI & Agentic Payments** | 3 x $2,000 | Live x402 service **settled through Blocky402**, one real paid request end to end, README with setup/architecture/payment flow, video showing the payment execute |
| **Hedera Improve the Harness** | 2 x $1,000 | A PR against **`dev`**: an HCS message + running-hash validator, which nothing upstream has. Plus a separate 90-second demo video |
| **World Selfie Check** | 1 x $3,500 | Selfie Check as an **abuse-prevention** signal, decision hash as `signal`, server-side assertions, Sandbox App, `WORLD_FEEDBACK.md` |
| **Arc / Circle** | pools, ~$25 | Working frontend + backend + **architecture diagram**, video naming Nanopayments / Circle Wallets / Agent Stack |

**Never take schedule risk for Arc.** It is worth about $25. Hedera is worth $3,000.

### Verified live, 2026-09-02

```
Blocky402 testnet   hedera:testnet  scheme=exact  feePayer=0.0.7162784   LIVE
x402.org fallback   hedera:testnet  scheme=exact  feePayer=0.0.9185802   LIVE
```

Blocky402 advertises **3 kinds and no Arc entry**. Hedera settles through Blocky402; Arc must go
through Circle's facilitator. This is why the `accepts[]` array carries two entries from two
facilitators, and why the boot preflight in step 03 exists.

---

## 7. Standing rules

1. **Commit small and often.** Gradual history is From Scratch evidence; its absence is a stated
   disqualification criterion.
2. **`bun run typecheck` green before every commit.**
3. **Never read `process.env` outside `config/main-config.ts`.** This is what makes the
   mainnet-readiness claim structural rather than aspirational.
4. **No floats for money, ever.** `Decimal(38,18)` in Postgres, BigInt atomic arithmetic in code.
5. **The server clock is authoritative** for every TTL decision. Never trust a client timestamp.
6. **Fail closed.** The default outcome of a decision is REFUSE.
7. **Never claim a property we do not have.** Selfie Check proves liveness and facial continuity,
   not uniqueness. Independence between two humans is a policy property of the rota, not a
   cryptographic one, and the attestation records which.
8. Any spike that misses its deadline triggers its stated fallback **that day**. No spike gets a
   second day except the HCS and x402 go/no-gos.

---

## 8. The four build-breaking defects, already known

These were found by auditing the architecture doc before any code existed. Fix them as you go; each
step file flags the ones it touches.

| # | Defect | Where it bites | Fix |
|---|---|---|---|
| A1 | `canonical()` destroys nested objects, so **both evidence hashes are broken** | step 06 | recursive canonicaliser, sorted keys at every depth |
| A2 | `url = env("DATABASE_URL")` in the datasource is `P1012` on Prisma 7 | step 01 | move to the Prisma config file |
| A3 | x402 v2 sends the challenge in a **header**, not the body | step 03 | use `paymentMiddleware` from `@x402/fastify`, hand-roll nothing |
| A10 | Policy needs the request body, but the x402 hook runs at `onRequest` before parsing | step 03 | free `POST /v1/gate/evaluate`, paid route takes a static price |

Plus: `BigInt(d.toFixed(0))` never `BigInt(d.toString())` for nullifiers; `@worldcoin/idkit-core` on
the server never the React package; one pinned `@hiero-ledger/sdk` or every `instanceof` breaks.

---

## 9. Definition of done for the backend as a whole

- [ ] `POST /v1/gate/decisions` returns a real 402 and settles a real USDC payment on Hedera testnet **through Blocky402**, transaction id resolvable on HashScan
- [ ] An attestation is written to an HCS topic **with no admin key**, sequence number returned
- [ ] `verify` passes on a real export offline, and **fails** when one character is edited
- [ ] A World proof is verified server-side with the signal three-way matched to the decision hash
- [ ] A decision expires at 60s and fails **closed**, with a race test proving the sweeper cannot beat the approver
- [ ] The witness is paid, and the payment row is settled
- [ ] `/.well-known/proctor.json` serves the trust roots
- [ ] Every claim in the README links to a file and line range, or an explorer, or is cut
