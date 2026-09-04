# Hedera credentials: how to get them

Verified against the official docs and the live network on 2026-09-04.
About 20 minutes. Two accounts, both **ECDSA**.

**What this unlocks:** the HCS evidence topic, one real x402 settlement through
Blocky402, and the HashScan links for the README. Those are **both Hedera
qualification bullets**, worth $2,000 and $1,000 per seat.

---

## Before you start: one scheduling note

There is a **testnet upgrade to v0.77 on Wed 9 Sep, 17:00 UTC**, mid-hackathon,
lasting about 40 minutes.

```
$ curl -s https://status.hedera.com/api/v2/scheduled-maintenances/upcoming.json
Testnet Upgrade to v0.77 | 2026-09-09T17:00:00.000Z
"The upgrade will take approximately 40 minutes to complete, users should
 expect some disruption to network services during this time."
```

**This is an upgrade, not a reset.** Accounts, topics and messages survive. Do
not record the demo during that window, and do not panic if calls fail then.

Also announced: `AccountBalanceQuery` is deprecated in v0.77 (Oct 2026). We do
not use it — balances come from the mirror node REST API — so this does not
affect us.

---

## Step 1. Create two ECDSA accounts

Go to **https://portal.hedera.com** and sign in.

Create **two testnet accounts**, both **ECDSA**:

| Account | Purpose |
|---|---|
| **Operator** | Creates the HCS topic and submits attestations |
| **Treasury** | Receives the $0.42 gate payments (`PAY_TO_HEDERA`) |

For each, the portal shows an **Account ID** (`0.0.XXXXXXX`), a **DER-encoded
private key** (long hex), and an **EVM address**. Copy the account ID and the
private key.

### ECDSA, not ED25519. This is not a preference.

- ED25519 has **no EVM alias**, and the Hedera Harness tier requires an ECDSA
  operator, which is one of our two prize tracks.
- `ECRECOVER` cannot verify ED25519 signatures.
- Our client calls `PrivateKey.fromStringECDSA(...)` explicitly. An ED25519 key
  fails there with a confusing "invalid private key" error on a key that is
  obviously valid.

**If you pick the wrong type, make new accounts. Do not try to work around it.**

---

## Step 2. Fund them

The portal funds new accounts automatically. If you need more,
**https://portal.hedera.com/faucet** gives **100 testnet HBAR** per request.

You need very little. HCS messages cost **$0.0008** each and topic creation is
about $0.01.

---

## Step 3. COMPLETE THE HOLLOW ACCOUNTS. Do not skip this.

This is the single most common way to lose an hour, and it is documented
behaviour, not a bug. From Hedera's own faucet docs:

> "Auto Account Creation kicks in to establish a new Hedera account linked to
> your EVM address... you receive a hollow account with **an ID and alias but no
> key**. To complete the account, use it as the fee payer in a transaction
> signed with your ECDSA private key."

**A hollow account can RECEIVE but cannot PAY.** Your first x402 payment fails
with an error that looks like a code bug and is not.

Once both accounts are in `.env`, I can complete them with one script. Ten
seconds if you know; an hour if you do not.

---

## Step 4. USDC association

The x402 gate settles **USDC, token id `0.0.429274`** (an HTS token, which is
also how we satisfy the HTS extra-points bullet at zero cost).

An account that has never held USDC cannot receive it, and the failure surfaces
through the facilitator as the unhelpful
`invalid_exact_hedera_payload_preflight_failed`.

Hollow accounts created via auto-creation get `maxAutoAssociations = -1` under
HIP-904 and accept HTS tokens immediately. If association is still needed, I can
set it with `AccountUpdateTransaction`.

Testnet USDC comes from **https://faucet.circle.com** (select Hedera Testnet).

---

## Step 5. Put them in `backend/.env`

```bash
HEDERA_OPERATOR_ID=0.0.XXXXXXX
HEDERA_OPERATOR_KEY=<DER private key of the operator>
PAY_TO_HEDERA=0.0.YYYYYYY        # the TREASURY account id
```

`PAY_TO_HEDERA` is currently the placeholder `0.0.9185803`. It must become your
real treasury account before any settlement.

**Pay to a real `0.0.X`, never an EVM address.** Facilitators reject alias
`payTo` by default; the reference implementation defaults to `reject`.

The private key is a secret. `backend/.env` is gitignored, and it must never
appear in a `VITE_*` variable or a log line.

---

## Step 6. Tell me, and I run the rest

Once the two values are in `.env`:

1. Complete both hollow accounts, one trivial transaction each
2. Verify USDC association, set `maxAutoAssociations` if needed
3. **Create the HCS topic** with a submit key and **no admin key**, so it is
   immutable and undeletable by anyone including us. This is irreversible: the
   memo cannot be changed afterwards
4. Submit a first attestation and read it back through both gRPC and mirror REST
5. **Measure mirror lag**, which decides the video's HashScan timing
6. Run the verifier against our own topic
7. **Settle one real x402 payment through Blocky402** and save the transaction
   id and HashScan link to `docs/hashscan-links.md`

Step 7 is the artefact that converts Hedera's qualification bullet from an
argument into a fact.

---

## Quick reference

| | |
|---|---|
| Portal | https://portal.hedera.com |
| Faucet | https://portal.hedera.com/faucet (100 HBAR) |
| USDC faucet | https://faucet.circle.com |
| Status | https://status.hedera.com |
| Key type | **ECDSA secp256k1** |
| USDC token | `0.0.429274` |
| Facilitator | `https://api.testnet.blocky402.com` (fee payer `0.0.7162784`) |
| Mirror node | `https://testnet.mirrornode.hedera.com` |
| Explorer | `https://hashscan.io/testnet` |

## Traps, in order of how much time they cost

1. **ED25519 instead of ECDSA** — no EVM alias, Harness tier rejects it, our client throws
2. **Not completing the hollow account** — can receive, cannot pay, first payment fails
3. **USDC not associated** — settlement fails as `..._preflight_failed`
4. **An EVM address in `PAY_TO_HEDERA`** — facilitator rejects alias payees
5. **Recording during the Sep 9 upgrade window** — 40 minutes of disruption
