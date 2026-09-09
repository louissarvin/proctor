# Verifiable artefacts

Every claim below is checkable by a third party without contacting Proctor.
All artefacts are on **Hedera testnet**. The evidence topic was created 2026-09-06.

---

## The evidence log

| Artefact | Value |
|---|---|
| **Evidence topic** | [`0.0.10390147`](https://hashscan.io/testnet/topic/0.0.10390147) |
| Memo | `Proctor oversight evidence log` |
| Admin key | **none** |
| Submit key | ECDSA, operator-held |
| Creation tx | `0.0.10349667@1788684617.529727573` |

**No admin key.** Per Hedera's documentation, *"if no adminKey is specified the
topic is immutable"*. The topic cannot be updated or deleted by anyone,
**including us**. There is no undo, which is why the memo was fixed first.

**Why a submit key, and what it does not buy.** Without one, any account on
Hedera could append to this log and an auditor could not distinguish a genuine
attestation from an attacker's. We hold it, so we can still write a *false*
entry. What HCS prevents is us **retroactively editing or deleting** what we
already wrote, and it binds every entry to a timestamp we did not choose.

---

## Verify it yourself, in one command

```bash
bun verify/bin/verify.ts --topic 0.0.10359381
```

```
PASS  4 messages, chain intact from genesis.
      No message was inserted, removed, reordered, or altered.
```

Zero dependencies, `node:crypto` only. It contacts the public mirror node and
nothing of ours.

### Tamper detection, run against this exact topic

| Attack | Result |
|---|---|
| One bit flipped in sequence 4 | `FAIL at seq 4 (running hash mismatch)` |
| **The refusal at sequence 2 deleted** | `FAIL at seq 3 (sequence gap: expected 2, got 3)` |

The second row is the one that matters: **an inconvenient refusal cannot be
quietly removed.**

---

## The records on the topic

| Seq | Outcome | Bytes | `wid` | `ind` |
|---|---|---|---|---|
| 1 | APPROVE | 702 | present | crypto |
| 2 | REFUSE | 621 | **null** | policy |
| 3 | EXPIRE | 619 | **null** | policy |
| 4 | APPROVE | 702 | present | crypto |

All under the 1024-byte single-chunk ceiling, so each is one sequence number
and one consensus timestamp.

`wid: null` on a refusal is **correct, not missing**: refuse is the default
outcome and requires no liveness proof. `ind` records whether witness/operator
independence is cryptographic or a policy property of the rota, rather than
blurring the two.

---

## Measured: mirror node lag

Measured on this topic, 2026-09-04, submit to mirror-node confirmation:

```
min 725ms   p50 865ms   max 1663ms
```

**This contradicts our earlier research**, which recorded p50 4100ms and
advised holding roughly five seconds before opening a HashScan link on camera.
The measured figure is four to five times faster.

**Demo consequence:** a HashScan link is safe to open about two seconds after
consensus rather than five. Re-measure on the day, on the venue network, before
committing the shot.

---

## The x402 gate

**Proof the gate settles through Blocky402**, from a live 402 issued by this
repo. `extra.feePayer` is injected by the library from the facilitator's own
`/supported` response, so it identifies the settling facilitator as a fact
rather than a claim:

```json
{
  "x402Version": 2,
  "accepts": [{
    "scheme": "exact",
    "network": "hedera:testnet",
    "amount": "420000",
    "asset": "0.0.429274",
    "payTo": "0.0.10349677",
    "maxTimeoutSeconds": 180,
    "extra": { "feePayer": "0.0.7162784" }
  }]
}
```

| Field | Origin |
|---|---|
| `extra.feePayer` `0.0.7162784` | **Blocky402's** fee payer. `x402.org` would show `0.0.9185802` |
| `amount` `420000` | library converted `price: "$0.42"` |
| `asset` `0.0.429274` | resolved by `ExactHederaScheme`; USDC on Hedera is an **HTS token**, so every settlement moves HTS |

| Artefact | Status |
|---|---|
| Gate payment settlement tx | _pending: needs the paying agent_ |

---

## Accounts

| Role | Account | Type |
|---|---|---|
| Operator | [`0.0.10349667`](https://hashscan.io/testnet/account/0.0.10349667) | ECDSA secp256k1 |
| Treasury (`payTo`) | [`0.0.10349677`](https://hashscan.io/testnet/account/0.0.10349677) | ECDSA secp256k1 |

Both carry `maxAutomaticTokenAssociations = -1`, so they accept HTS tokens
including USDC `0.0.429274` without an explicit association step.

---

## Agent identity, HCS-14 (draft)

```
uaid:aid:9373hj8Dco351vuqrK3p4veDXreeN6848f5A2qQKBdQK4Azmi2BL7UB7rA3Fwiq4KU;uid=0;registry=proctor;proto=x402;nativeId=hedera:testnet:0.0.10349677
```

Generated per the draft specification, SHA-384 then Base58, with a fixed test
vector in `backend/test/uaid.test.ts` so any reader can reproduce the string.
