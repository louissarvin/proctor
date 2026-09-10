# Proctor MCP server

**The human-in-the-loop that MCP's specification asks for and does not provide.**

The MCP tools spec says, verbatim:

> "For trust & safety and security, there **SHOULD** always be a human in the loop with the
> ability to deny tool invocations."
>
> Applications **SHOULD** ... "Present confirmation prompts to the user for operations, to
> ensure a human is in the loop."

It then defines no mechanism for it. Every client builds its own confirmation dialog,
locally, and nothing survives the click. Three questions an auditor asks after an incident
have no answer:

| Question | What a local dialog can show |
|---|---|
| Was a human actually there? | Nothing. A dialog proves a click, not a person |
| Was it someone other than the agent's operator? | Nothing |
| Can you prove it to someone who does not trust you? | Nothing |

Meanwhile the direction of travel for paid MCP tools is explicitly the other way. Vercel's
`x402-mcp` pitch is *"no account, no API key, **no human in the loop**"*. That is correct
for a weather API and wrong for a wire transfer.

This server is the missing mechanism.

## What it does

One tool: **`request_human_approval`**.

It blocks the agent on a real person who is **not** the operator, fails closed on a
deadline, and returns a citation on a Hedera topic with no admin key — so the decision can
be proven to a third party later, without trusting the agent or us.

```
below threshold   → Proceed. Policy did not require a human (below_threshold).
above threshold   → blocks, hands a link to a phone, waits
approved          → Approved by a verified human. HCS sequence #41. You may proceed.
refused / expired → NOT approved (EXPIRE). Do not proceed.
```

**Most calls never reach a human.** An oversight tool that interrupts everything is one the
agent's owner switches off, so policy runs first and the common path is free.

## Install

Published on npm as [`proctor-mcp`](https://www.npmjs.com/package/proctor-mcp) and listed
in the [MCP Registry](https://registry.modelcontextprotocol.io) as
`io.github.louissarvin/proctor`.

```jsonc
// Claude Desktop: claude_desktop_config.json
{
  "mcpServers": {
    "proctor": {
      "command": "npx",
      "args": ["-y", "proctor-mcp"],
      "env": { "PROCTOR_API": "http://localhost:3700" }
    }
  }
}
```

Nothing to clone and nothing to build. Point `PROCTOR_API` at a Proctor instance; the
default is `http://localhost:3700`.

Verify it without a client:

```bash
printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | npx -y proctor-mcp
```

Works with any MCP client — Claude Desktop, Cursor, or your own. Transport is JSON-RPC 2.0
over stdio, protocol version `2025-06-18`.

Verify it without a client:

```bash
printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | bun src/index.ts
```

## Three decisions worth knowing

**A refusal is not a tool error.** It returns `isError: false` with `approved: false`.
Marking a refusal as an error invites a model to treat it as a transient fault and retry
around it, which is precisely the behaviour this tool exists to prevent.

**Unreachable is not refused.** If Proctor is down the tool says so explicitly and marks
`isError: true`. *"The gate is down"* and *"a human said no"* are different facts, and
collapsing them means an outage silently becomes a rejection — or worse, gets retried
until it isn't.

**No dependencies on the oversight path.** JSON-RPC over stdio is a loop, and adding an SDK
to a security tool is how it acquires a supply chain. The x402 client is imported lazily
and only when a wallet is configured, so pointing this at a hosted Proctor to ask a human
a question never loads a Hedera SDK.

## Paid mode

Set a wallet and the tool stops simulating and starts paying:

```jsonc
"env": {
  "PROCTOR_API": "http://localhost:3700",
  "HEDERA_AGENT_ID": "0.0.xxxxx",
  "HEDERA_AGENT_KEY": "302e…",
  "AGENT_ALLOWED_TOKENS": "0.0.10394781"
}
```

It then hits the real x402 gate and settles through the Blocky402 facilitator. A verified
run:

```
[proctor] paid the gate; a witness is being dispatched from the rota
structuredContent: { "approved": false, "outcome": "EXPIRE", "paid": true }
```

and the corresponding settlement on Hedera testnet:

```
0.0.10359475   -420000     the agent pays
0.0.10349677  +415800     treasury
0.0.10349667    +4200     1% HTS custom fee, assessed on chain
fee payer 0.0.7162784     Blocky402
```

**Policy runs first, and it is free.** `POST /v1/gate/evaluate` decides whether a human is
needed before any payment is made. An oversight tool that charges on every invocation is
one the agent's owner switches off within a day.

**Paid mode returns no witness link, on purpose.** The gate never hands the approval URL
back to the payer — an agent that could reach it could approve its own decision, which is
the single property this product sells. The human is reached through the operator's rota
instead. Unpaid operator mode does return a link, because there the caller *is* the
operator.

Without a wallet the tool falls back to Proctor's operator endpoint, which opens a real
decision but settles nothing, and says so in its own output (`paid: false`).

## What it does not do yet

The evidence citation may read `attestation pending` when a decision resolves faster than
consensus. The record lands afterwards, off the agent's critical path, and the sequence
number is durable in the decision's own record.

Only the Hedera rail is wired here. The gate advertises Arc through Circle's Gateway too,
and `agent/` demonstrates it; the MCP client registers the Hedera scheme only.
