# Step 08 — The meter and witness payouts

**Goal:** price the second call from real elapsed review seconds, and pay the witness into a wallet
they never signed up for.

**Prize linkage:** Arc / Circle, both pools. **Be honest about the value: about $25 total.**

**Day:** 6 (Sep 9). Budget 4 hours. **18:00 is the `METER_MODE` decision, and it is final.**

> **NEVER take schedule risk for Arc.** Hedera is worth $3,000 across 5 seats. Arc is worth $25.
> If this step threatens anything upstream, ship option B below and move on.

---

## 1. Two options. Decide at 18:00 on day 6 and never revisit.

**Hedera supports only the `exact` scheme.** No `upto`, no `auth-capture`, no `batch-settlement`.
So a true per-second meter cannot run on Hedera.

| | Option A: split the legs | Option B: meter in memory |
|---|---|---|
| Gate | Hedera `exact`, $0.42 | Hedera `exact`, $0.42 |
| Meter | **Arc Nanopayments**, gasless, batched | Hedera `exact`, one settle of `fee + rate x seconds` |
| Needs | Circle working, DNS unhijacked | nothing new |
| Story | two sponsors each doing what they do best | honest, slightly weaker |

**Take A if the Arc leg works by 18:00 on day 6. Otherwise B, `METER_MODE=HEDERA`, and say so in
the README.** The counter ticking on camera is identical either way, because it is derived from
real elapsed time in both.

---

## 2. The necessity argument, which is the whole Arc case

A single $0.42 payout does not need Nanopayments. **A per-second meter does.**

Put `witness attention: 4.2s · $0.0088` on screen, incrementing, during the eight seconds the
witness's face is on the phone. That is the Arc argument made visually, and it lives in exactly the
window that would otherwise be dead air.

`DynamicPrice` is a first-class x402 feature, so **the meter is not a hack**. Say that.

---

## 3. Circle Wallets: the claim that is actually distinctive

**Developer-controlled wallets.** We create them. The witness signs up for nothing, installs
nothing, holds no keys, and pays no gas. On Arc, USDC *is* the gas token, so their first payment
funds their own future gas.

*"Witnesses are paid into wallets they never created"* is the sentence. **Do not overclaim it into
"they can spend it anywhere."** There is no off-ramp in scope, and a judge who probes that will find
the gap.

---

## 4. The five things that will each cost an afternoon

| # | Trap | Symptom |
|---|---|---|
| 1 | **SCA wallet for the paying agent** | Gateway verifies EIP-3009 with `ecrecover` and does **not** support ERC-1271. An SCA **fails silently**. Use `accountType: "EOA"` |
| 2 | 18-decimal native USDC vs 6-decimal ERC-20 | same asset, two views, `1 ERC-20 unit = 10^12 wei`. Read balances **only** through the ERC-20 interface |
| 3 | `maxFeePerGas` below 20 Gwei | hangs forever or `transaction underpriced`. Live gas is ~21 Gwei. Set 20 Gwei minimum explicitly |
| 4 | `ExactEvmScheme` on the Arc seller leg | strips `extra.verifyingContract`, buyer signing breaks. Use **`GatewayEvmScheme`** |
| 5 | Short `maxTimeoutSeconds` | Gateway rejects authorizations valid under 3 days. `GatewayEvmScheme` writes `604900`. **Do not hand-roll 60** |

Also: `createTransaction` returning success is **not** done. Poll to `COMPLETE`. `DENIED` is a real
risk-screening outcome, and Arc's runtime blocklist is a second, independent revert path.

**Never test Arc semantics against `anvil`.** Arc states local simulators *"cannot reproduce
Arc-specific behavior"* including blocklist enforcement. Fork-test the real RPC.

---

## 5. Timing: the payout can never be on the critical path

**Circle settlement takes minutes.** Batch settlement is not instant.

- Fire the on-screen counter on the webhook `SENT` event, or an optimistic local total
- Use **webhooks, not polling**. That is the difference between the counter appearing at 0:14 and at 0:19
- Verify `x-circle-signature` and `x-circle-key-id` on the webhook
- **Say "paid". Never say "settled on-chain"** while the batch is pending. That claim would be false
  and a Circle engineer would know

---

## 6. Say why Paymaster is absent

Circle names Paymaster, Nanopayments and App Kits on the track. We use one. **Silence reads as a
gap; an explanation reads as understanding:**

> Circle Paymaster has no Arc support, and on Arc gas is already USDC, so it is structurally
> redundant.

One sentence, in the README. Same for Gas Station: it needs an ERC-4337 SCA, which is mutually
exclusive with the EOA that Nanopayments requires.

---

## 7. Operational note that has bitten before

**The Circle CLI session expires after 7 days.** Day 1 plus 7 is day 8, which is shoot day.
**Re-login before recording.** Also `circle wallet limit set` requires an interactive human OTP and
cannot be scripted, so keep it out of the demo.

Circle docs are reachable through `https://r.jina.ai/https://developers.circle.com/...` if the
direct hosts are intercepted. Every page has a `.md` variant.

---

## 8. Definition of done

- [ ] `METER_MODE` decided at 18:00 day 6, written into config, **never revisited**
- [ ] Release priced from real `reviewMs`, `amount > 0` asserted
- [ ] EXPIRE meters to zero per the step-05 decision, and does not throw
- [ ] Witness paid, `Payment` row reaches SETTLED (or SENT with the honest caveat)
- [ ] Circle webhook signature verified
- [ ] Agent wallet is `accountType: "EOA"`
- [ ] Meter visible on screen, incrementing per second
- [ ] README explains why Paymaster and Gas Station are absent
