# From project to product

A plan for making Proctor something other teams adopt, written against what the sponsors
actually reward and what the specs actually say. Ordered by leverage, not by appeal.

---

## The opening, in one paragraph

MCP's tools specification says, verbatim: *"For trust & safety and security, there
**SHOULD** always be a human in the loop with the ability to deny tool invocations."* It
then defines **no mechanism** for one. Every client ships a local confirmation dialog and
nothing survives the click. Simultaneously the paid-tool ecosystem is moving the other
way: Vercel's `x402-mcp` pitch is *"no account, no API key, **no human in the loop**."*

That is correct for a weather API and wrong for a wire transfer. **The gap between "a human
SHOULD be in the loop" and "here is proof one was" is the product.** Everything below
follows from that sentence.

---

## Where adoption actually comes from

Ranked by how many agents each unlocks per unit of work.

### 1. MCP server — DONE

One tool, `request_human_approval`, stdio JSON-RPC. Any MCP client — Claude Desktop,
Cursor, anything — gains attested oversight without knowing what Hedera, x402 or World ID
are. The oversight path has no dependencies; the x402 client is imported lazily and only
when a wallet is configured. See [`mcp/`](../mcp).

**Paid, as of 2026-09-10.** With `HEDERA_AGENT_ID`/`HEDERA_AGENT_KEY` set the tool settles
a real x402 payment through Blocky402 — verified on chain: agent `-420000`, treasury
`+415800`, `+4200` to the HTS custom fee collector, fee payer `0.0.7162784`. Policy is
evaluated first, for free, so most calls never pay.

**Published 2026-09-10.** On npm as [`proctor-mcp`](https://www.npmjs.com/package/proctor-mcp)
and in the MCP Registry as `io.github.louissarvin/proctor`. Adoption is now one config
block — `npx -y proctor-mcp` — with nothing to clone and nothing to build.

Three things worth recording, because each cost time:

- **npm scope must be one you own.** The account was `bapet`, so `@louissarvin/...` was a
  403. Unscoped `proctor-mcp` is also more discoverable. `mcpName` is independent of the
  npm name: it binds to the GitHub namespace the registry authenticates against.
- **A passkey is not a TOTP code.** npm needs a TTY to open the browser challenge, and
  redacts the auth URL to `***` without one. `script -q` surfaces it.
- **The registry caps `description` at 100 characters.** Ours was 240 and failed with 422.

**Remaining:** Hedera rail only. The gate advertises Arc through Circle's Gateway as well,
and `agent/` demonstrates it; the MCP client registers the Hedera scheme.

### 2. Deployment — NOT DONE, and it blocks three other things

A public URL is the only remaining prerequisite for **Circle's Agent Marketplace**. From
their own listing requirements, we already satisfy: returns 402 when unpaid, publishes an
OpenAPI spec, has a confirmed payout wallet. The single gap is *"a publicly reachable URL,
because listings are continuously health-checked."*

Deploying also:
- makes `agent-card.json` advertise a real URL instead of `localhost`, which is what
  "findable by other agents" means in practice
- lets the MCP server point at a hosted Proctor, so adopting it is one config block rather
  than "first, run our backend"
- satisfies Arc's *"working frontend and backend"* without a local checkout

**This is the highest-leverage infrastructure task and it is not started.**

### 3. An npm package for the gate — NOT DONE

Today integration is an HTTP 402, which is genuinely the point: no SDK, no lock-in. But
"no SDK" is a virtue for the protocol and a tax on the first hour. A thin
`@proctor/express` / `@proctor/fastify` middleware —

```ts
app.use(proctorGate({ threshold: 10_000, api: 'https://…' }))
```

— turns a day of reading into three lines, without changing the protocol underneath.

### 4. Policy as configuration — NOT DONE

`DEMO_POLICY` is hardcoded to one amount threshold. Real adopters need their own rules
(counterparty allowlists, per-agent limits, time-of-day). The policy hash is already in
every attestation, so the evidence format is ready for it; only the authoring surface is
missing.

---

## What each sponsor actually rewards

Checked against the live prize pages, not memory.

### Hedera — "AI & Agentic Payments"

Qualification is met. On extra points we hold **all seven**, two of them twice over
(ERC-8004 *and* HCS-14; an HTS token *and* a custom fee schedule assessed on chain). The
weakest is *"multi-agent negotiation and settlement via A2A"* — we serve the A2A binding
and map TaskState honestly, and we **do not claim negotiation**, because nothing here
bargains over price or terms.

**Done 2026-09-10:** the MCP tool pays. That makes *"an agent consumes that service and
completes a real paid request end to end"* true through the channel agents actually speak,
not only through our own `agent/` client.

**Best remaining move:** none that changes a bullet. The Arc rail in the MCP client is
tidiness, not points.

### Arc — "Best Agentic Economy with Circle Agent Stack"

Circle's Agent Stack is **Circle CLI, Agent Wallets, Agent Marketplace, and Nanopayments
powered by Circle Gateway**. We use the fourth genuinely: batched nanopayments through
`GatewayEvmScheme`, verified settling on Arc testnet.

**Best remaining move:** deploy, then list in the Agent Marketplace. That converts "we use
one component" into "we use two", and the listing is a durable artefact.

*Known external breakage, dated 2026-09-09:* Circle's Gateway TLS certificate has expired
(`certificate has expired` from `gateway-api-testnet.circle.com`). Our capability cache
keeps the rail advertised, but a live Arc settlement fails while their cert is broken.
Demo on the Hedera rail until it is fixed.

### World — Selfie Check

The scored deliverable is the **feedback document**, and ours is now nineteen dated,
reproducible findings written to their four required headings. The strongest is §2.5: a
WASM load failure reported to the integrator as `generic_error` with an **empty object**,
which made every credential fail identically for a full day.

**Best remaining move:** none. It is done, and further engineering here has no marginal
prize value.

---

## Sequencing, honestly

Extra points cannot rescue a track you did not qualify for. As of 2026-09-10 the
qualification blockers are **push the repo, open the harness PR, record two videos**, and
they gate roughly $5,000 across four entries. Everything in this document is worth less
than those three, and none of it should start until they are done.

After that, in order:

| # | Work | Why it is first |
|---|---|---|
| 1 | Deploy | Unblocks the marketplace listing, a real agent-card URL, and one-config MCP adoption |
| 2 | Arc rail in the MCP client | The gate advertises two rails; the MCP tool pays on one |
| 3 | Circle Agent Marketplace listing | A durable artefact; every other prerequisite is already met |
| 4 | `@proctor/*` middleware | Removes the first-hour tax without changing the protocol |
| 5 | Policy as configuration | The evidence format is already ready; only authoring is missing |

---

## What we will not build, and why

**Negotiation over price or terms.** It would be a real A2A extra point and we do not have
it. Claiming it because the words fit is the failure mode this repo has spent a week
removing.

**Our own facilitator.** Hedera's bullet names Blocky402 and settlement through a
third-party facilitator is a stronger claim than settling through ourselves.

**A custodial wallet for witnesses.** A witness is a person on a rota, not a crypto user.
Holding their funds turns an oversight product into a money transmitter.
