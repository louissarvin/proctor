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


## Configuration

```bash
cp .env.example .env   # then fill in the three secrets from backend/.env
bun src/index.ts       # pays on whichever rail the gate offers first
PREFER_NETWORK=eip155:5042002 bun src/index.ts   # force Arc
```

**`AGENT_ALLOWED_TOKENS` is not optional.** The agent refuses to pay in an asset its
operator has not approved, which is the correct default for software that spends money
unattended. The gate settles in an HTS token, so that token id must be listed or every
payment is rejected by spend controls before it is even attempted — with an error that
says the requirements were rejected, not that the asset was unapproved.

**`ARC_PRIVATE_KEY` must be an EOA.** Circle Gateway verifies with `ecrecover`, not
ERC-1271, so a smart-contract wallet signs something that looks valid and is rejected at
settlement. Payments draw from a Gateway *balance*, not the wallet balance; fund it with
`bun run arc:deposit` in `backend/`.
