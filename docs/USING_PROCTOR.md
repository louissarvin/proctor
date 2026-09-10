# Using Proctor

Four people touch this product, and each gets a surface built for them. Nothing below
needs a terminal.

| Who | Where they go | What they do |
|---|---|---|
| **Operator** | `/operator` | Describe an action, watch policy decide, hand it to a phone |
| **Witness** | `/w/<token>` | Approve or refuse, on a phone, in under a minute |
| **Auditor** | `/console` | Read the evidence, re-verify any record against Hedera |
| **Agent developer** | `POST /v1/gate/decisions` | Integrate the gate, pay through x402 |
| **MCP agent** | `npx -y proctor-mcp` | One tool, `request_human_approval`. Works in Claude Desktop, Cursor, anything MCP |

---

## The operator console

`/operator` is the screen that turns this from a set of scripts into a product.

Type an amount and a counterparty, press **Run the action**, and one of two things
happens. Most actions **proceed** — the policy returns `escalate: false`, the call was
free, and no human was interrupted. A gate that stops everything is a gate nobody
deploys, so the common path is the one shown first.

When the threshold fires, the agent is **held**. The screen shows the question a human
will actually answer, the deadline counting down, and a QR code. Someone else scans it
with their phone. The state updates live over SSE as they decide.

**One honest exception, stated on the screen itself.** The operator console opens
decisions **without settling an x402 payment**, and the API says so in its own response:

```json
{ "paid": false,
  "note": "Operator-initiated demo decision. No x402 payment was settled.
           A paying agent uses POST /v1/gate/decisions." }
```

Everything else about that decision is real: real policy evaluation, a real witness from
the rota, a real deadline, a real attestation on a topic nobody can edit. What is absent
is the paying agent, because on this screen a person is standing in for one.

The endpoint is **off unless `DEMO_MODE=true`**. A deployment that forgets it gets 404,
not an open door. It is rate limited to one run per 15s per caller and a ceiling of five
open decisions, so a hosted demo cannot be used to bury a witness rota.

### Why this is not a hole in the paywall

The gate is paid, and the witness token is a bearer credential the gate deliberately
**never returns to the payer** — otherwise an agent could approve its own decision, which
is the single property this product sells. That is also why `a2a.SendMessage` returns
`-32601` rather than opening a decision for free.

So the operator console is not a second, cheaper entrance to the same door. It is the
operator's own screen, showing a QR for a witness to scan, which is exactly what
`bun run open` prints to a terminal today.

---

## The witness

A witness needs no account, no wallet, and nothing installed except the World App they
will use anyway. They receive a link scoped to **one** decision, which dies with the
deadline.

The page shows one line — *"Release EUR 41,200 to Meridian Logistics?"* — and the full
record underneath for anyone who wants it. Two buttons. **Refuse needs no proof**, on
purpose: putting a liveness check between a person and a stop button is a failure mode
sitting on the brake pedal.

Approving runs World ID. The decision hash is passed as the `signal`, so the proof is
bound to that one decision and cannot be replayed against another.

---

## The auditor

`/console` lists decisions with their issuance numbers. Every record can be re-verified
against Hedera **without trusting us**:

```bash
cd verify && bun bin/verify.ts --topic <topicId>
```

That reads the public mirror node and recomputes the running hash chain from genesis. It
also checks the thing the chain cannot: whether any decision was **withheld**, by reading
the dense per-issuer issuance numbers out of the messages themselves.

---

## The agent developer

The integration is an HTTP 402. No SDK, no prior relationship, no account.

```
POST /v1/gate/decisions        → 402, challenge in the `payment-required` HEADER
POST /v1/gate/decisions        → 200, with a signed payment payload
GET  /v1/gate/decisions/:id/stream   → SSE while the human decides
POST /v1/gate/decisions/:id/release  → metered on real review seconds
```

Two rails are advertised on every challenge: Hedera through Blocky402, and Arc through
Circle's Gateway. The agent picks one. Discovery is in the usual places:

- `GET /.well-known/agent-card.json` — A2A, with `a2a.GetTask` at `POST /a2a`
- `GET /openapi.json`
- `GET /features` — what is built, and what is honestly blocked

---

## Running it yourself

```bash
cp backend/.env.example backend/.env      # DATABASE_URL is the only required edit
cd backend && bun install && bun run db:push && bun run seed
bun index.ts                              # terminal 1
cd ../web && bun dev                      # terminal 2
```

Then open `http://localhost:3200/operator`.

**`WITNESS_APP_URL` cannot be `localhost`** if you want to use a phone — a phone cannot
resolve your laptop's localhost. Use the LAN address:

```bash
WITNESS_APP_URL="http://$(ipconfig getifaddr en0):3200"
```

To check the whole system rather than one screen:

```bash
cd backend && bun run e2e        # agent pays, human refuses, evidence verified
bun run acceptance              # 16 claims checked against the running service
bun run doctor                  # what is configured, and what each gap costs
```


---

## MCP: the shortest path to adoption

MCP's own tools specification says there **SHOULD** always be a human in the loop with the
ability to deny a tool invocation, and then defines no mechanism for one. Clients each
build a local confirmation dialog, and nothing survives the click: no proof a person was
there, no proof they were independent of the operator, nothing an auditor can check.

[`proctor-mcp`](https://www.npmjs.com/package/proctor-mcp) is that mechanism, published on
npm and listed in the MCP Registry as `io.github.louissarvin/proctor`. One tool, one config
block, nothing to clone:

```jsonc
{ "mcpServers": { "proctor": {
    "command": "npx",
    "args": ["-y", "proctor-mcp"],
    "env": { "PROCTOR_API": "http://localhost:3700" } } } }
```

Any MCP-capable agent then gains attested human oversight without knowing anything about
Hedera, x402 or World ID. That is the difference between a hackathon project and something
another team can adopt in an afternoon.

Two behaviours are load-bearing and easy to get wrong:

- **A refusal is not an error.** It returns `isError: false`, so a model cannot treat it as
  a transient fault and retry around the human.
- **Unreachable is not refused.** An outage is reported as an error, never as a decision.
