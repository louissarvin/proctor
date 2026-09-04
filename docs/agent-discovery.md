# How another agent finds and pays for this service

Hedera's extra-points list asks for *"Agent discovery via UCP, **or a directory
that makes your service findable by other agents**."* This is the second clause,
answered with three artefacts that already exist.

**UCP is deliberately not used.** It standardises product catalogues, carts and
order tracking for retail. Proctor sells an oversight gate, not a SKU. Forcing a
cart schema onto it would be visible decoration.

---

## 1. The agent card, at a stable well-known URL

```
GET /.well-known/agent-card.json
```

An A2A agent card with the required fields, one declared skill
(`human-oversight-gate`), and `capabilities.pushNotifications: true`, which is
literally what the witness dispatcher does.

It also publishes the task model, because Proctor's control flow **is** an A2A
task rather than something A2A was bolted onto:

```json
{
  "taskModel": {
    "protocol": "A2A",
    "interruptedState": "TASK_STATE_AUTH_REQUIRED"
  }
}
```

From the A2A specification, verbatim:

> `TASK_STATE_AUTH_REQUIRED` — "Indicates that authentication is required to
> proceed. **This is an interrupted state.**"

An agent submits a task, the task is interrupted while a human is required, then
resolves to `TASK_STATE_COMPLETED` or `TASK_STATE_REJECTED`. That is a
one-to-one description of the gate. Every decision the API returns carries an
`a2a` view alongside Proctor's own state, so a calling agent never has to learn
our vocabulary.

**What we claim:** the gate is modelled as an A2A task in the interrupted
`auth-required` state, which is what that state exists for.
**What we do not claim:** multi-agent negotiation. There is no negotiation in
Proctor, and the JSON-RPC `message/send` binding was deliberately not built.

---

## 2. The 402 itself is a machine-readable price list

This is discovery by construction, and it costs nothing extra: any unpaid
request advertises the full terms.

```bash
curl -i -X POST https://<host>/v1/gate/decisions
```

```
HTTP/1.1 402 Payment Required
payment-required: <base64>
```

Decoded:

```json
{
  "x402Version": 2,
  "accepts": [{
    "scheme": "exact",
    "network": "hedera:testnet",
    "amount": "420000",
    "asset": "0.0.429274",
    "payTo": "0.0.9185803",
    "maxTimeoutSeconds": 180,
    "extra": { "feePayer": "0.0.7162784" }
  }]
}
```

Price, asset, network, payee and the settling facilitator, in one header, with
no registry lookup and no out-of-band agreement. `extra.feePayer` is injected by
the library from the facilitator's own `/supported` response, so it identifies
the settling facilitator as a fact rather than a claim.

---

## 3. The trust roots, for verification rather than payment

```
GET /.well-known/proctor.json
```

Carries the attestor address and EIP-712 domain, the HCS topic and mirror node,
the World RP id and action, the canonicalisation standard (RFC 8785), and the
gate's HCS-14 identifier.

It also states its own weakness: we can edit a file on our own host, so the copy
of these roots published on the HCS topic is the authoritative one. A verifier
that trusts this endpoint alone is trusting us; one that reads the topic is not.

---

## Agent identity: HCS-14

Both the gate and the paying agent carry a UAID generated per the HCS-14 draft
specification:

```
uaid:aid:9373hj8Dco351vuqrK3p4veDXreeN6848f5A2qQKBdQK4Azmi2BL7UB7rA3Fwiq4KU;uid=0;registry=proctor;proto=x402;nativeId=hedera:testnet:0.0.9185803
```

Generated from the six canonical fields the spec requires (`registry`, `name`,
`version`, `protocol`, `nativeId`, `skills`), normalised per its rules,
SHA-384 hashed and Base58 encoded. Implementation: `src/lib/attestation/uaid.ts`,
with a fixed test vector in `test/uaid.test.ts` so any reader can reproduce the
string exactly.

**Implemented without depending on `@hashgraphonline/standards-sdk.** HCS-14 is
Draft and the SDK is pre-1.0; a draft dependency must not be able to break the
evidence writer. It is about forty lines and needs no new primitive, since
SHA-384 is already present for the HCS running hash.

**We say "generated per the draft specification", not "HCS-14 compliant."**
Compliance is not ours to assert while the standard is in draft.

### Why HCS-14 and not ERC-8004

ERC-8004 needs three registries, a deployed and verified contract, and a hosted
registration file, and the spec wants per-chain singletons, so a self-deployed
registry is a weaker claim than registering in a canonical one. No canonical
ERC-8004 deployment exists on Hedera testnet. It is five to eight hours for a
worse version of a point HCS-14 gives in one to two, and Proctor ships zero
Solidity by design.
