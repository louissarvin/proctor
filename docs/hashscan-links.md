# Verifiable artefacts

Every claim here is checkable by a third party. Facilitator named per link, because
Hedera's qualification bullet names one specifically.

## x402 gate

| Artefact | Facilitator | Link |
|---|---|---|
| Gate payment settlement tx | **Blocky402** (`api.testnet.blocky402.com`) | _pending: needs treasury account_ |
| Meter payment settlement tx | TBD by `METER_MODE` | _pending_ |

**Proof the gate settles through Blocky402**, from a live 402 issued by this repo on 2026-09-03.
`extra.feePayer` is injected by the library from the facilitator's own `/supported` response, so it
cannot be faked in source:

```json
{
  "x402Version": 2,
  "resource": { "url": "http://localhost:3700/v1/gate/decisions",
                "description": "Proctor human oversight decision" },
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

| Field | Where it came from |
|---|---|
| `extra.feePayer` = `0.0.7162784` | **Blocky402's** fee payer, from their live `/supported`. `x402.org` would show `0.0.9185802` |
| `amount` = `420000` | library converted `price: "$0.42"`. No hand-rolled decimal maths |
| `asset` = `0.0.429274` | resolved by `ExactHederaScheme`, never hardcoded |

## HCS evidence log

| Artefact | Link |
|---|---|
| Proctor evidence topic (no admin key) | _pending: needs operator account_ |
| Reference topic used to prove the verifier | [`0.0.4320226`](https://hashscan.io/testnet/topic/0.0.4320226) |

Verifier reproduces the running hash chain for all 45 messages of `0.0.4320226` from genesis:

```
$ bun verify/bin/verify.ts --topic 0.0.4320226
PASS  45 messages, chain intact from genesis.
```
