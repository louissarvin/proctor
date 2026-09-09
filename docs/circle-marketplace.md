# Circle Agent Marketplace

Circle's Agent Stack includes an [Agent Marketplace](https://agents.circle.com/services):
*"a curated, compliance-first catalog of x402 services that accept USDC, built for AI
agents to discover and pay per request."*

Proctor is an x402 service, so this is where other agents would find it.

## The listing prerequisites, and our status

From [Get listed](https://developers.circle.com/agent-stack/agent-marketplace/get-listed):

| Prerequisite | Status |
|---|---|
| Returns `402 Payment Required` when unpaid, serves the resource when paid | **met** |
| A published OpenAPI spec, so agents can read inputs and outputs | **met**, `GET /openapi.json` |
| A confirmed payout wallet, sanctions-screened at review | **met**, `0.0.10349677` |
| A publicly reachable URL, because listings are continuously health-checked | **not met**, the service is local |

The only gap is hosting. The intake form is
[forms.gle/7YFzvdmMcn1JH5tF6](https://forms.gle/7YFzvdmMcn1JH5tF6) and listings are
reviewed manually.

## What the catalog looks like today

```bash
cd backend && bun run marketplace
```

Sampling 50 services from the public Discovery API
(`GET https://api.circle.com/v2/x402/discovery/resources`, no API key):

```
networks by service count:
   49  eip155:8453      Base
   31  solana:5eykt...  Solana
   30  eip155:137       Polygon
   18  eip155:1         Ethereum
   18  eip155:43114     Avalanche
   18  eip155:42161     Arbitrum
   18  eip155:10        Optimism
   18  eip155:130       Unichain
   10  eip155:146       Sonic
   10  eip155:480       World Chain

Hedera services listed: NONE
```

**No Hedera x402 service appears in the catalog.** Every listed service settles on an
EVM chain or Solana. Reproduce it yourself with the command above; it needs no key.

That is the interesting part of this integration. Proctor settles on Hedera through
Blocky402, which is a rail the marketplace does not currently carry.

## Discovery by construction

We publish our own listing in the catalog's own shape, so an agent can evaluate the
gate with the same parser it uses for Circle's catalog rather than a Proctor-specific
one:

```json
{
  "resource": "https://<host>/v1/gate/decisions",
  "type": "http",
  "x402Version": 2,
  "accepts": [{
    "scheme": "exact",
    "network": "hedera:testnet",
    "asset": "0.0.429274",
    "payTo": "0.0.10349677",
    "amount": "420000",
    "maxTimeoutSeconds": 180
  }]
}
```

This is the same array the live 402 emits, so it cannot drift from what the service
actually charges.

## The obstacle we hit

`*.circle.com` is **intermittently DNS-hijacked** on the network this was built on.
`dig +short api.circle.com` returns `internetpositif.id`, an ISP interception host, and
the TLS handshake sometimes presents an expired certificate:

```
error: certificate has expired
  path: "https://api.circle.com/v2/x402/discovery/resources"
  code: "CERT_HAS_EXPIRED"
```

Intermittent is worse than broken: the same request succeeds under `curl` and fails
under Bun seconds later, which reads as a code fault. `fetchCatalog()` retries with
backoff and the script names the interception explicitly, so the next person does not
lose an hour to it.

Circle's docs are also unreachable directly on such a network. Every page has a `.md`
variant, and a reader proxy resolves them:

```bash
curl -s "https://r.jina.ai/https://developers.circle.com/agent-stack.md"
```
