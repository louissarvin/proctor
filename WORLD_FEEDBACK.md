# World ID feedback, ETHOnline 2026, from the Proctor build

Every item is dated, reproducible, and cites the page or file it came from.
Written as we hit each one, not reconstructed afterwards.

App: `app_e179f4985c290220a5598b841fd5e3da` · RP: `rp_4d44df4ba311add1`
SDK: `@worldcoin/idkit-core@4.2.4`

---

## 1. Selfie Check docs and integration flow

### 1.1 The docs contradict each other on nullifier stability, and it changes an integrator's design
*2026-09-02*

- [`/world-id/idkit/integrate`](https://docs.world.org/world-id/idkit/integrate): *"The same person verifying the same action always produces the same nullifier."*
- [`/world-id/4-0-migration`](https://docs.world.org/world-id/4-0-migration): *"In 3.0, many RPs treated nullifiers as persistent user identifiers. In 4.0, nullifiers are one-time-use, and `session_id` is the stable link across requests."*

These cannot both be true. We read the migration guide as the correction because it is
version-qualified, but nothing on the integrate page says it applies to 3.0 only.

**Why it mattered to us.** Our core security property is *the approving witness is not the
operator*, enforced by comparing nullifiers. That comparison is **meaningful on a v3 credential
and silently meaningless on a v4 uniqueness proof**, where two proofs from the same account
produce different nullifiers, so `witness !== operator` always passes. An integrator who reads
only the integrate page ships a check that looks like it works and does not.

**Suggestion:** version-qualify the sentence on the integrate page, and add one line naming
`session_id` as the v4 replacement.

### 1.2 `IDKitResult.environment` and the verify API disagree on valid values
*2026-09-03*

The shipped SDK type says:

```ts
/** The environment used for this request ("production", "staging", or "sandbox") */
environment: string;
```
`node_modules/@worldcoin/idkit-core/dist/index.d.ts`

The API reference for `POST /api/v4/verify/{rp_id}` documents `environment` as
`"production" | "staging"`, default `"production"`. **`sandbox` is absent.**

Since the Selfie Check track requires using the Sandbox App, an integrator cannot tell from the
docs whether `sandbox` is a valid verify-time environment.

### 1.3 `environment` is documented as an enum but is not validated
*2026-09-03*

```bash
curl -X POST https://developer.world.org/api/v4/verify/rp_4d44df4ba311add1 \
  -H 'content-type: application/json' \
  -d '{"protocol_version":"3.0","nonce":"0x00","action":"proctor-witness-approval","environment":"nonsense","responses":[]}'
# -> {"code":"validation_error","detail":"At least one response item is required","attribute":"responses"}
```

`"nonsense"` passes environment validation. `production`, `staging`, `sandbox` and garbage all
produce the same next error. If the enum is real, rejecting an unknown value with
`attribute: "environment"` would save an integrator a lot of guessing.

---

## 2. Developer Portal navigation, search, product discovery, and debugging guidance

### 2.1 `docs.world.org` serves clean markdown for any route, and an LLM index, and advertises neither
*2026-09-02*

Appending `.md` to any docs route returns clean markdown, and there is a full index at
[`/llms.txt`](https://docs.world.org/llms.txt). Nothing on the site links to or mentions either.

This is the single best discovery affordance the docs have and it is invisible. One line in the
footer would surface it.

### 2.2 A v4 action exposes only two fields, but the docs describe per-action environments
*2026-09-03*

`SKILL.md` states actions define *"what credential the user proves and **in which environment**"*
and advises: *"Create separate actions for simulator testing and production QA if both are
needed."*

In the live Portal, creating an action (`action_v4_...`) offers **only** `Identifier` and
`Short description`. There is no environment selector and no maximum-verifications field. The
documented two-action pattern is not constructible, and an integrator following it will look for
a control that does not exist.

---

## 3. Sandbox App states, proof flows, test users, errors, and edge cases

### 3.1 BLOCKER: iOS Sandbox enrollment silently requires an email-based Portal account
*2026-09-02*

A Developer Portal account created via **World ID sign-in** cannot request iOS enrollment. The
form rejects with:

> An email-based portal account is required to request iOS enrollment.

The message is accurate but appears **nowhere in the documentation**, and the error string
returns zero search results. There is no documented way to add an email credential to an existing
account or to convert account type. We resolved it by moving to an email-based account.

**This was the single most expensive item in our integration**, precisely because there was
nothing to search for. One sentence on the sandbox access page would remove it entirely.

### 3.2 Selfie Check access and Sandbox App access are two separate gates, on two different domains
*2026-09-02*

- Selfie Check feature flag: `developers@toolsforhumanity.com`
- Sandbox App access: `sandbox.access@toolsforhumanity.org`

Note `.com` versus `.org`. Nothing on the docs site states these are different requests, and the
sandbox page's *"request access through your World point of contact"* does not distinguish them.
We initially assumed one request covered both.

### 3.3 The Google Form predates the current distribution setup
*2026-09-02*

`https://forms.gle/mqbaiwMvX5MzmKdY8` is titled *"World ID Sandbox Beta Access Request"* and says
it grants **Firebase App Distribution** access. The docs say iOS is **TestFlight** and Android is
a private Google Play track. The form appears stale.

### 3.4 TestFlight's redeem-code prompt is a dead end for this flow
*2026-09-02*

With no betas installed, TestFlight shows a redeem-code prompt. The World flow issues no code:
approval is by email and the build then appears automatically. Minor, but it cost us time looking
for a code that does not exist. Worth one line in the iOS steps.

---

## 4. What was confusing, missing, broken, or hard to test

| # | Item | Impact |
|---|---|---|
| 1 | §3.1, the undocumented email-account requirement | **blocker**, unbounded time cost |
| 2 | §1.1, contradictory nullifier stability | **security-relevant**, changes the design |
| 3 | §3.2, two gates on two TLDs, undocumented | hours |
| 4 | §2.2, documented per-action environments that do not exist | confusion |
| 5 | §1.2 / §1.3, `environment` disagreement and non-validation | guesswork |
| 6 | No documented turnaround for either access gate | unplannable on a 9-day event |

**The one thing we would most want:** an "access" page that lists every gate, which channel opens
it, and a rough turnaround. All three of our access problems were about *which door to knock on*,
not about the product.

---

## 5. What is genuinely good  (unrequested, included anyway)

- **`signRequest` is pure JS with no WASM.** It ran under Bun with zero configuration on the first
  attempt. The docstring even names the Rust function it matches
  (`compute_rp_signature_msg` in `world-id-primitives`) and links the exact source line for nonce
  generation. That is unusually good provenance.
- **The shipped `.d.ts` files are excellent.** `issuer_schema_id` is documented inline
  (`1=proof_of_human, 11=selfie, 9303=passport, 9310=mnc`), and `signal_hash` is correctly typed
  as optional, which caught a real bug in our verifier at compile time.
- **`hashSignal` is exported from a subpath** rather than buried, so binding a proof to an
  application-specific value is a two-line change. This is the mechanism our whole product rests
  on and it was the easiest part of the integration.
- **Presets are a better API than `verification_level`.** `selfieCheckLegacy({ signal })` reads
  clearly and made our credential swap a single variable.
- **The 4.0 migration guide is direct about what broke.** Stating plainly that v2/v3 samples will
  not work saved us from trusting older material.
