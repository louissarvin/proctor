# @proctor/agent

The paying agent. Stops on a 402, pays, and proceeds.

```bash
set -a; source ../backend/.env; set +a
bun src/index.ts
```

## What it demonstrates

1. **Asks the policy, free.** Most agent actions get `escalate: false` and
   proceed without touching a paywall. Charging an agent to be told "no" would
   be a worse product.
2. **Stops on a policy threshold.** `HOLD: action requires an attested human
   witness.` This is the red text in the first seconds of the demo.
3. **Pays the gate over x402** and retries automatically.

## Why `wrapFetchWithPayment` and not a hand-rolled client

The x402 v2 challenge rides in a base64 **`payment-required` response header**.
The body is `{}`. A hand-rolled client reads the body, finds nothing, and loses
an hour. The wrapper reads the header, selects an option, builds and signs the
payload, and retries.

## Two footguns hit while building this

**`network` must be CAIP-2.** `createClientHederaSigner`'s config documents
`network` as *"Optional explicit network. If omitted, defaults to testnet."*
That reads as though the short form is accepted. Passing `'testnet'` throws
`Unsupported Hedera network: testnet`. It requires `'hedera:testnet'`, i.e.
`HEDERA_TESTNET_CAIP2`.

**`invalid_exact_hedera_payload_preflight_failed` means the payer cannot fund
the transfer.** The facilitator preflights the transaction before settling. An
agent holding zero USDC, or an account that cannot hold the token, fails here.
The error names neither cause, so check, in order:

```bash
# does the payer hold USDC at all?
curl -s "https://testnet.mirrornode.hedera.com/api/v1/accounts/$HEDERA_AGENT_ID" | jq '.balance.tokens'

# can it receive HTS tokens without an explicit association?
# maxAutomaticTokenAssociations must be -1, or associate 0.0.429274 explicitly
```
