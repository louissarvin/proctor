# Prize re-check, 2026-09-04

> **SUPERSEDED 2026-09-09.** The Arc tracks below were restructured again after this was
> written, and **"Launch on Arc Testnet & Push to Mainnet" no longer exists as a track**.
> The live page (`/prizes/arc`) now lists:
>
> | Track | Amount |
> |---|---|
> | Best DeFi / Onchain Finance | $1,000 + **$2,500 bonus** if deployed to Arc by Sept 30 |
> | Best Agentic Economy with Circle Agent Stack | $1,000 + **$2,500 bonus** if deployed to Arc by Sept 30 |
> | Best DeFi or Agentic (Continuity only) | $1,000 + $2,000 bonus |
>
> Also note the partner is listed as **Arc**, not Circle — `/prizes/circle` 404s. Selecting
> "Circle" on the submission form would select nothing.
>
> The bonus deadline of **Sept 30 falls after the Sept 13 submission**, so it remains
> winnable after submitting.
>
> The World section below is also stale: that prize is now **up to 3 winners at $1,166**,
> not a single $3,500 seat, and the standalone Sandbox App bullet has been removed.
>
> Kept for the reasoning trail. Do not quote its numbers.


The planning documents were written 2026-08-30 to 09-01. Several tracks were
unpublished then. Re-read against the live prizes page today, two findings change
where effort should go.

---

## 1. Arc is worth ~$4,167, not ~$25

**The planning docs are wrong on this, and the error is large.** They recorded both Arc
prizes as `type: pool` with `quantity: 300`, worth about $25 combined, and concluded
*"never take schedule risk for Arc."*

Arc has since been restructured into **five tracks with flat winner slots**:

| Track | Prize |
|---|---|
| **Launch on Arc Testnet & Push to Mainnet** | **$2,500 first, $1,000 second** |
| Best Agentic Economy Application with Circle Agent Stack | $1,667 |
| Best DeFi / Onchain Finance Application | $1,667 |
| Launch on Arc (Continuity) | $1,500, 2 winners |
| Best DeFi or Agentic (Continuity) | $1,666 |

Two are open to us. **Addressable: up to $4,167**, comparable to Hedera's $3,000 across
five seats. Arc now deserves real investment.

### What the main track requires, verbatim

> Functional MVP and Diagram: Projects must demonstrate a working frontend and backend
> plus an architecture diagram. Video demonstration + presentation: succinctly outline
> the project's core functions and its effective use of Circle's developer tools,
> supported by detailed documentation. Link to GitHub/Replit repo

> Projects must be deployed or deployment-ready on Arc mainnet by September 30.

| Requirement | Status |
|---|---|
| Working frontend | witness PWA + evidence console |
| Working backend | Fastify API, 125 tests |
| Architecture diagram | [`docs/architecture.png`](architecture.png) |
| Detailed documentation | README + this docs tree |
| Video naming Circle tools | **not done** |
| GitHub repo | **not pushed** |
| Deployed or deployment-ready on Arc mainnet | see below |

**Arc mainnet does not exist yet.** Circle's own docs state: *"Arc is currently
available on Testnet only."* Since the September 30 date falls after the September 13
submission deadline, **"deployment-ready" is the operative word** for every entrant.

---

## 2. Arc has canonical ERC-8004 registries. Hedera does not.

The planning docs rejected ERC-8004 in favour of HCS-14, correctly, on this reasoning:
the spec wants per-chain singletons, so a self-deployed registry is a weaker claim than
registering in a canonical one, and no canonical ERC-8004 deployment existed on Hedera.

**That reasoning does not apply to Arc**, which ships canonical deployments:

| Contract | Address |
|---|---|
| IdentityRegistry | [`0x8004A818BFB912233c491871b3d84c89A494BD9e`](https://testnet.arcscan.app/address/0x8004A818BFB912233c491871b3d84c89A494BD9e) |
| ReputationRegistry | [`0x8004B663056A597Dffe9eCcC1965A193B7388713`](https://testnet.arcscan.app/address/0x8004B663056A597Dffe9eCcC1965A193B7388713) |
| ValidationRegistry | [`0x8004Cb1BF31DAf7788923b405b754f57acEB4272`](https://testnet.arcscan.app/address/0x8004Cb1BF31DAf7788923b405b754f57acEB4272) |

Verified live today:

```bash
curl -s -X POST https://rpc.testnet.arc.io -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
# {"result":"0x4cef52"}   = 5042002

curl -s -X POST https://rpc.testnet.arc.io -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","method":"eth_getCode",
       "params":["0x8004A818BFB912233c491871b3d84c89A494BD9e","latest"],"id":1}'
# bytecode present
```

**Registering the Proctor agent in Arc's IdentityRegistry gives us a real on-chain
artefact on Arc**, which is the strongest available evidence for "Launch on Arc Testnet"
short of a mainnet that does not exist. It complements HCS-14 rather than replacing it:
HCS-14 is the Hedera-native identifier, ERC-8004 is the Arc-native one, and the agent
carries both.

### Arc connection parameters

| | |
|---|---|
| Chain ID | `5042002` |
| RPC | `https://rpc.testnet.arc.io` |
| Explorer | `https://testnet.arcscan.app` |
| Gas token | **USDC, 18 decimals** |
| Live gas price | 25 Gwei |
| Faucet | `faucet.circle.com` |

Gas is USDC, so registering needs testnet USDC on Arc from the same faucet that has not
yet delivered on Hedera.

---

## 3. Unchanged, and confirmed

- **Blocky402 is still named** in Hedera's bullet: *"settled through the Blocky402
  facilitator."* Our compliance holds, and the settled transaction's fee payer proves it.
- Hedera remains $6,000 across 3 seats plus $2,000 across 2 for the Harness.
- World Selfie Check remains a single seat at $3,500.

## 4. New sponsor: Bazantic, $3,000

Not in the planning docs at all. Three tracks, all x402-shaped, including *"Best Recipe
that uses EthGlobal Hackathon Sponsor APIs"* and *"Agentify a New API."* Proctor is an
x402 service, so the fit is natural.

**We cannot take it.** The event caps partner selections at three, and Hedera ($3,000),
World ($3,500) and Arc ($4,167) all out-rank it. Recorded so the decision is deliberate
rather than an oversight.
