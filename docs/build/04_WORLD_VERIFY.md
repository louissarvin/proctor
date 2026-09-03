# Step 04 — World ID: RP signing and verification

**Goal:** mint RP signatures server-side, and verify a witness proof with every assertion, in the
right order, before the decision state is touched.

**Prize linkage:** World Selfie Check, **1 seat, $3,500, winner takes all**. The highest-variance
line in the plan.

**Day:** 3 (Sep 6). Budget 4 hours. **18:00 that day is the Selfie Check fallback decision.**

---

## 1. Credentials already provisioned

```
app_id   app_e179f4985c290220a5598b841fd5e3da
rp_id    rp_4d44df4ba311add1
action   proctor-witness-approval
key      backend/.env  WORLD_RP_SIGNING_KEY  (0x + 64 hex, verified)
```

Selfie Check flag requested 2026-09-02 19:22. Build against `deviceLegacy` on `staging` with the
simulator until it lands. **The swap is one variable.**

---

## 2. World ID 4.0 changed everything. Every v2/v3 sample online is wrong.

| v3 | v4 |
|---|---|
| `<IDKitWidget>` render prop | `<IDKitRequestWidget>`, **controlled** |
| `verification_level: "device" \| "orb"` | **presets**: `proofOfHuman`, `selfieCheckLegacy`, `deviceLegacy`, ... |
| `app_id` addresses the verifier | **`rp_id`** |
| `POST /api/v2/verify/{app_id}` | **`POST /api/v4/verify/{rp_id}`** |
| no server signing | **backend RP signature MANDATORY** |
| `ISuccessResult` | `IDKitResult` |

**Pin `^4.x`.** The mandatory backend signature is the single biggest schedule risk on this leg,
because it is a new required component that did not exist in v3.

**Server uses `@worldcoin/idkit-core`, never `@worldcoin/idkit`** (React). Bun's isolated linker has
no hoisting; importing the React package server-side fails hard. Defect A7.

---

## 3. RP signature minting

TTL is 300s by default. **Fetch it when the decision arrives, not on page load**, or you get
`rp_signature_expired` on a phone that took 40 seconds to reach.

```ts
// src/routes/worldRoutes.ts
import { signRequest } from '@worldcoin/idkit-core/signing';

app.post('/rp-signature', async (request, reply) => {
  const { witnessToken } = request.body as { witnessToken: string };

  const decision = await prismaQuery.decision.findFirst({
    where: { witnessTokenHash: hashToken(witnessToken), state: 'DISPATCHED' },
  });
  if (!decision) return handleError(reply, 404, 'Unknown token', 'UNKNOWN_TOKEN');
  if (decision.expiresAt < new Date())
    return handleError(reply, 410, 'Decision expired', 'DECISION_EXPIRED');

  const { sig, nonce, createdAt, expiresAt } = signRequest({
    signingKeyHex: WORLD_RP_SIGNING_KEY,
    action: WORLD_ACTION,
    ttl: 300,
  });

  // Single-use. Reuse returns duplicate_nonce from World.
  await prismaQuery.rpNonce.create({
    data: { nonce, action: WORLD_ACTION, decisionId: decision.id, expiresAt: new Date(expiresAt) },
  });

  return reply.code(200).send({
    success: true, error: null,
    data: { sig, nonce, created_at: createdAt, expires_at: expiresAt, rp_id: WORLD_RP_ID },
  });
});
```

**Never sign on the client. Never expose the key as a `VITE_*` var. Never log it.** If it leaks,
attackers forge proof requests from your app.

---

## 4. `signal` is the mechanism the entire product rests on

**The decision hash is the World `signal`.** That is what binds a liveness proof to *this exact
decision* rather than to "a human approved something at some point."

Without the re-derivation check in §5 step 4, **a valid proof for a different decision is accepted**.
That single comparison is the difference between Proctor and a paid captcha.

---

## 5. The seven assertions, in this order

Cheap local checks first, so a bad proof is rejected before spending a network round trip.

```ts
const EXPECTED = {
  SELFIE:          { identifier: 'selfie',         protocol: '3.0', presence: false },
  ORB_PRESENCE:    { identifier: 'proof_of_human', protocol: '4.0', presence: true  },
  DEVICE_DEV_ONLY: { identifier: 'device',         protocol: '3.0', presence: false },
} as const;
```

| # | Assertion | Failure code | Why |
|---|---|---|---|
| 1 | `now <= decision.expiresAt` | `decision_expired` | evaluated on arrival, **not** after the World round trip |
| 2 | `raw.protocol_version === want.protocol` | `protocol_mismatch` | v3 and v4 proof shapes are incompatible |
| 3 | `item.identifier === want.identifier` | `identifier_mismatch` | proves the credential is the one we asked for |
| 4 | **`hashSignal(decisionHash) === item.signal_hash`** | `signal_mismatch` | **THE ONE EVERYONE SKIPS** |
| 5 | liveness present when required | `no_liveness` | `require_user_presence` on the v4 path |
| 6 | RP nonce exists, unused, unexpired | `duplicate_nonce` | replay protection |
| 7 | `witnessNullifier !== operatorNullifier` | `witness_is_operator` | **segregation of duties** |

Then, and only then, `POST {WORLD_VERIFY_URL}/api/v4/verify/{rp_id}` with the payload **forwarded
untouched**. Never re-serialise, never normalise: the export publishes those exact bytes so a third
party re-verifies against World, not against us.

### Three type traps that will not compile or will 500 mid-demo

```ts
// A6: item.signal_hash is OPTIONAL in IDKitResult. Guard before dereferencing.
if (!item?.signal_hash) return { ok: false, reason: 'signal_mismatch' };

// B3: verified.nullifier is OPTIONAL. BigInt(undefined) throws a TypeError
//     inside the handler -> a 500 on camera instead of a clean 400.
if (!verified.nullifier) return { ok: false, reason: 'verification_failed' };

// A4: BigInt(decimal.toString()) THROWS on every real nullifier.
//     Values above 21 digits serialise in exponential notation.
const n = BigInt(orgOperatorNullifier.toFixed(0));   // never .toString()
```

Put `toFixed(0)` in one helper in `lib/` and **ban the inline form** in review.

---

## 6. A refusal requires no proof

Refuse is the **default outcome**. Making a human prove liveness to press a stop button is a
needless failure mode standing between a person and a brake pedal.

Approval is the only transition that costs anything and the only one that needs evidence. The
attestation records `wid: null` on a refusal, and the verification procedure treats that as
**correct**, not as a missing field.

Add `wa: "proof" | "token"` to the attestation core, 10 bytes. Otherwise a refusal names a witness
on bearer-token evidence alone, which is the obvious attack narrative. Pre-empt it.

---

## 7. THE FINDING THAT DECIDES THE FALLBACK

The docs contradict themselves on nullifier stability:

- `idkit/integrate`: *"The same person verifying the same action always produces the same nullifier."*
- `4-0-migration`: *"In 4.0, nullifiers are one-time-use, and `session_id` is the stable link."*

The migration guide is newer and version-qualified. It is the correction.

| Proof type | Stable nullifier? | Stable id |
|---|---|---|
| **World ID 3.0** (Selfie Check, all `*Legacy`) | **Yes**, per (account, RP, action) | `nullifier` |
| v4 uniqueness (`proofOfHuman`, `passport`) | **No, one-time-use** | none |
| v4 session (`IDKit.createSession`) | n/a | `session_id` |

**Assertion 7 works on Selfie Check and breaks SILENTLY on `proofOfHuman`.** Two proofs from the
*same* account produce different nullifiers there, so `witness !== operator` always passes. **The
load-bearing security property would be quietly false while appearing to work.**

If you end up on the v4 fallback: move to the session flow and compare `session_id`s, **or** state
plainly in the README that independence is a policy property of the rota, not a cryptographic one.
**Never claim a property the fallback does not have.**

Unverified and worth an hour on day 2: **can a v4 session proof carry a `signal`?** The documented
session response shows `signal_hash: "0x0"`. If it cannot, the v4 fallback cannot bind a proof to a
decision hash at all, and the central mechanism does not survive the move.

---

## 8. What to claim, and what not to

This is the only judgement bullet on a single-seat prize, so it is where the $3,500 is decided.

> Proctor treats Selfie Check as an **abuse-prevention** signal, not an identity signal: it is what
> stops the approval from being satisfied by the agent's own service account, which is the exact
> failure mode that makes today's human-oversight logs worthless to an auditor.

Immediately followed by the honesty paragraph:

> We do not claim Selfie Check proves one-person-one-account. It proves **liveness and facial
> continuity**. Our claim is narrower and sufficient: the approver was a live human, and their World
> ID account is cryptographically distinct from the operator's. Independence between the two humans
> is a policy property of the rota, and our attestation records which of the two it is in an
> explicit `ind` field.

**On a beta product, the team reading submissions is the team that built it.** Use their vocabulary
(risk, eligibility, fairness, continuity, abuse-prevention). Never say "identity" or "KYC".

---

## 9. Definition of done

- [ ] `POST /v1/world/rp-signature` returns a valid signature, nonce persisted single-use
- [ ] `hashSignal` unit-tested against the published vectors
- [ ] All seven assertions implemented **in order**, each with its own error code
- [ ] Signal mismatch is provably rejected: a proof for decision A fails against decision B
- [ ] `witness_is_operator` rejected with 403
- [ ] Refusal path requires no proof and records `wid: null`, `wa: "token"`
- [ ] Full flow green against the **simulator** on `staging` with `deviceLegacy`
- [ ] Signing key confirmed absent from `web/` and from all logs
- [ ] Disabled-flag error surfaces an actionable message, **never an infinite spinner**
- [ ] `WORLD_FEEDBACK.md` appended to, dated, as you go
