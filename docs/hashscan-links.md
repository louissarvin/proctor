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
bun verify/bin/verify.ts --topic 0.0.10390147
```

```
PASS  15 messages, chain intact from genesis.
      No message was inserted, removed, reordered, or altered.

PASS  completeness: issuance numbers dense across 1 issuer(s).
      No decision was withheld from this log.
```

**Two checks, two different claims.** The first proves nothing was altered, removed or
reordered. The second proves nothing was *withheld*: an operator who simply never submits
an inconvenient refusal breaks no hash at all, so integrity alone cannot catch them.

If you run this while a decision is still open you may see a transient completeness
failure. That is honest rather than broken: from outside the topic, an undecided decision
and a suppressed one are both simply absent. **A hole that persists is the finding.**

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
  "accepts": [
    {
      "scheme": "exact",
      "network": "hedera:testnet",
      "amount": "100000000",
      "asset": "0.0.0",
      "payTo": "0.0.10349677",
      "maxTimeoutSeconds": 180,
      "extra": { "feePayer": "0.0.7162784" }
    },
    {
      "scheme": "exact",
      "network": "eip155:5042002",
      "amount": "420000",
      "asset": "0x3600000000000000000000000000000000000000",
      "payTo": "0x361c196aF4d2ec35C39AD0BEd1afb7ed01553aEf",
      "maxTimeoutSeconds": 604900,
      "extra": {
        "name": "GatewayWalletBatched",
        "version": "1",
        "verifyingContract": "0x0077777d7eba4688bdef3e311b846f25870a19b9",
        "minValiditySeconds": 604800
      }
    }
  ]
}
```

Captured from the live service. Reproduce it with:

```bash
curl -s -i -X POST http://localhost:3700/v1/gate/decisions \
  -H 'content-type: application/json' \
  -d '{"action":{"kind":"transfer","amount":"41200.00"}}' \
  | grep -i '^payment-required' | cut -d' ' -f2 | base64 -d | jq
```

| Field | Origin |
|---|---|
| `extra.feePayer` `0.0.7162784` | **Blocky402's** fee payer. `x402.org` would show `0.0.9185802` |
| `asset` `0.0.0` on Hedera | HBAR. See "Why HBAR and not USDC" below. USDC on Hedera is `0.0.429274`, an **HTS token**, and the code still selects it behind `GATE_ASSET=USDC` |
| `asset` `0x3600…0000` on Arc | USDC, 6 decimals, at Arc's ERC-20 interface. `420000` = $0.42 |
| `maxTimeoutSeconds` `604900` on Arc | Circle Gateway rejects authorizations valid for under 7 days (`minValiditySeconds` 604800). The two rails legitimately differ |
| `verifyingContract` | Required for the buyer to build the right EIP-712 domain. `ExactEvmScheme` drops it; `GatewayEvmScheme` preserves it |

**Two rails, two facilitators.** No single facilitator serves both: Blocky402 has Hedera
and not Arc, Circle Gateway has Arc and not Hedera. The resource server takes an array and
routes each entry to whichever one advertises it.

| Artefact | Link |
|---|---|
| **Gate payment, settled through Blocky402** | [`0.0.7162784@1788535476.476844044`](https://hashscan.io/testnet/transaction/0.0.7162784-1788535476-476844044) |
| Most recent agent settlement | [`0.0.7162784@1788697690.139040175`](https://hashscan.io/testnet/transaction/0.0.7162784-1788697690-139040175) |
| **Witness fee, approval** | [`0.0.10349667@1788697676.088483944`](https://hashscan.io/testnet/transaction/0.0.10349667-1788697676-088483944) |
| **Witness fee, refusal** | [`0.0.10349667@1788697685.529738778`](https://hashscan.io/testnet/transaction/0.0.10349667-1788697685-529738778) |

The gate payments are `CRYPTOTRANSFER`, `result: SUCCESS`:

```
0.0.10359475  -1.0000 HBAR   the paying agent
0.0.10349677  +1.0000 HBAR   the Proctor treasury
fee payer     0.0.7162784    BLOCKY402
```

The fee payer is the proof: `0.0.7162784` is Blocky402's account, so the transaction was
submitted by the facilitator Hedera's qualification bullet names. `x402.org` would show
`0.0.9185802`.

**The witness fee transfers are the other half**, and they are the leg that separates this
from the free approve-button every agent framework ships. Note that a **refusal is paid
too**: paying only for approvals would price the witness to say yes.

### Why HBAR and not USDC

The scheme, the facilitator and the wire are identical either way; only the asset id
differs. USDC is the intended asset and the code still supports it behind `GATE_ASSET`,
but Circle's Hedera faucet did not deliver testnet USDC despite two confirmed "Tokens
sent" responses and an explicit `TokenAssociateTransaction`. HBAR settles today, so the
end-to-end claim is real rather than pending.

```bash
GATE_ASSET=HBAR   # settles now
GATE_ASSET=USDC   # one variable, when the faucet delivers
```

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
